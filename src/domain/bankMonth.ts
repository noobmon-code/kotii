// Consultor financeiro (beta): lançamentos do banco viram saídas mês a mês.
// Compra no cartão conta no dia da compra (não no da fatura). Compra
// parcelada conta parcela por parcela: a parcela n no mês da compra + (n-1),
// com o valor dela, como a pessoa paga; as que ainda vão ser cobradas
// aparecem como comprometidas (futureInstallments).

import type { FinAccount, FinConnection, FinTransaction } from '@/lib/types';

import { financeCategoryOfBank, isSensitiveBankTx, normalizeBankText } from './bankCategories';
import { type BankKind, classifyBankTransaction, isTransferLike, ownerHashes } from './bankClassify';
import {
  type CategoryRules,
  type CategorySource,
  chosenSensitive,
  NO_RULES,
  NO_SENSITIVE_KEYS,
  pickCategory,
  refundOfSaudeStore,
  saudeStores,
  type SensitiveKeys,
  similarRuleKey,
} from './bankRules';
import { addDays, addMonths, diffDays } from './dates';
import { type FinanceCategory, monthRange, shiftMonth } from './finance';

/** A compra parcelada de que uma parcela faz parte. */
export interface BankInstallment {
  /**
   * A compra inteira: "serie-<id da parcela de menor número vista>" (outra
   * chave que a das parcelas: o estorno da compra inteira não é o da 1ª).
   */
  seriesKey: string;
  /** Esta parcela. */
  number: number;
  total: number;
  /** Valor das parcelas que faltam: o da última vista (a 1ª às vezes leva a sobra dos centavos). */
  parcel: number;
  /** Data da compra: a que o banco mandou ou a estimada pela parcela. */
  purchaseDate: string;
  /** A data da compra veio do banco ou da 1ª parcela (não foi estimada por uma parcela posterior). */
  purchaseExact: boolean;
  /** Valor da compra inteira (vistas mais as que faltam pela de referência): só para texto e conferência. */
  purchaseAmount: number;
  /** Números das parcelas que vieram do banco. */
  seen: number[];
}

export interface BankPurchase {
  /** Única por lançamento e estável entre sincronizações: "tx-<id>", ou "parc-<id>" na parcela. */
  key: string;
  /** Dia em que conta: o da compra; na parcela n, o da compra + (n-1) meses. */
  date: string;
  /** Em R$; na parcela, o valor dela. */
  amount: number;
  description: string;
  merchantName: string | null;
  merchantCnpj: string | null;
  /** A escolhida pela pessoa (bankRules) ou, sem escolha, a automática. */
  category: FinanceCategory;
  /** A que o consultor deduziu sozinho (Pluggy, descrição, loja). */
  autoCategory: FinanceCategory;
  /** De onde veio `category`: automática, regra das parecidas ou escolha só para esta compra. */
  categorySource: CategorySource;
  /** Chave de "todas as parecidas" (bankRules); null quando a descrição é genérica demais. */
  similarKey: string | null;
  kind: BankKind;
  /** Ainda pendente no banco: aparece como "previsto". */
  pending: boolean;
  accountId: string;
  /** A compra parcelada, quando este lançamento é uma parcela. */
  installment: BankInstallment | null;
  /**
   * Onde gravar a escolha "Só esta" (a chave da compra, sem o "p:"). Na
   * parcela, vale para a compra inteira: a parcela que já tem a escolha, senão
   * a lançada de menor número (a prevista muda de id quando é lançada).
   */
  ruleKey: string;
  /**
   * Onde ler e apagar a escolha "Só esta": na parcela, a de cada parcela vista
   * da compra (e a da prevista que a lançada substituiu).
   */
  ruleKeys: string[];
  txIds: string[];
  /** PIX/transferência de ou para uma pessoa (CPF): o nome não vai para a IA. */
  personTransfer: boolean;
  /** Saúde, doações, religião...: só entra somado na categoria. */
  sensitive: boolean;
  /**
   * Nome que pode ir para a IA: a loja que a Pluggy reconheceu, a empresa
   * (CNPJ que não é de MEI) ou a descrição de uma compra com cartão. null
   * quando o texto do banco pode trazer nome de pessoa (boleto, depósito,
   * "dinheiro enviado a...", o vendedor depois do "*" da maquininha).
   */
  storeName: string | null;
  /**
   * Estorno: o que ele desfaz, na mesma conta: uma saída (key) ou a compra
   * parcelada inteira (seriesKey, "serie-..."). null quando não achou: aí não
   * abate nada (ver summarizeRange).
   */
  refundOf: string | null;
  /** Estorno: quanto ele abate de cada saída (na compra parcelada, parcela por parcela). */
  refundParts: { key: string; amount: number }[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Dia em que o lançamento conta: a data da compra no cartão, senão a do
 * banco. Data da compra mais de um ciclo de fatura antes do lançamento não é
 * desta cobrança (parcela que veio sem número, com a data original; cobrança
 * atrasada): aí vale a do lançamento, o mês em que foi cobrada.
 */
export function effectiveDate(tx: Pick<FinTransaction, 'purchase_on' | 'occurred_on'>): string {
  if (!tx.purchase_on) return tx.occurred_on;
  return diffDays(tx.purchase_on, tx.occurred_on) <= BILL_CYCLE_DAYS ? tx.purchase_on : tx.occurred_on;
}

// Maquininhas e carteiras que vêm antes do "*" na fatura ("MERCADOPAGO*LOJA").
const ACQUIRERS = new Set([
  'mercadopago', 'mercado pago', 'mp', 'mpago', 'mercadolivre', 'mercado livre', 'ml', 'meli', 'pag', 'pagseguro',
  'pagbank', 'ps', 'picpay', 'pp', 'paypal', 'ebanx', 'ebn', 'ifd', 'sumup', 'stone', 'ton', 'cielo', 'getnet',
  'rede', 'iz', 'izettle', 'dl', 'dlocal', 'pg', 'pagarme', 'pagar me', 'ec', 'stripe', 'adyen', 'zp', 'zoop',
  'asaas', 'infinitepay', 'ip', 'ame', 'sq', 'smp',
]);

/** Espaços e pontuação solta nas pontas. */
function tidy(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–·(|]+|[\s\-–·(|]+$/g, '')
    .trim();
}

// "Parcela 2/10", "PARC 02/10", "2/10", "2 de 10".
const PARCEL_MARKERS = [
  /[-–(]?\s*\bparc(?:ela)?\.?\s*\d{1,2}\s*(?:\/|de)\s*\d{1,2}\s*\)?/gi,
  /[-–(]?\s*\b\d{1,2}\s*\/\s*\d{1,2}\b\s*\)?/g,
  /[-–(]?\s*\b\d{1,2}\s+de\s+\d{1,2}\b\s*\)?/gi,
];

/** Descrição sem a marca da parcela, igual em todas as parcelas da compra. */
export function stripParcelMarker(description: string): string {
  return tidy(PARCEL_MARKERS.reduce((text, re) => text.replace(re, ' '), description));
}

interface ParcelMark {
  number: number;
  total: number;
  /** Veio dos campos de parcela do banco (na descrição, "03/10" também pode ser uma data). */
  fromFields: boolean;
}

/**
 * n/N de um lançamento: o que o banco mandou nos campos de parcela, senão a
 * marca na descrição ("ESTORNO LOJA 03/10"). Na descrição, "03/10" também
 * pode ser uma data, então só serve de pista, nunca de regra.
 */
function parcelMark(tx: FinTransaction): ParcelMark | null {
  if (tx.installment_number && tx.total_installments) {
    return { number: tx.installment_number, total: tx.total_installments, fromFields: true };
  }
  const match = tx.description.match(/\b(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\b/i);
  if (!match) return null;
  const number = Number(match[1]);
  const total = Number(match[2]);
  return number >= 1 && total > 1 && number <= total ? { number, total, fromFields: false } : null;
}

/** Loja depois do "*" da maquininha ("MERCADOPAGO*LOJA" -> "LOJA"); null se não houver. */
export function merchantFromDescriptor(description: string): string | null {
  const match = description.match(/^\s*([^*]{1,20}?)\s*\*\s*(.+)$/);
  if (!match || !ACQUIRERS.has(normalizeBankText(match[1]))) return null;
  return tidy(match[2]) || null;
}

/** Nome da loja: o da Pluggy, a empresa do PIX (CNPJ) ou o que vem depois do "*". */
function merchantNameOf(tx: FinTransaction, description: string): string | null {
  const company = tx.counterparty_doc_kind === 'CNPJ' ? tx.counterparty_name : null;
  return tx.merchant_name ?? company ?? merchantFromDescriptor(description);
}

// Razão social de MEI: o CNPJ (ou a raiz dele) ou o CPF (que a sincronização troca por "***") junto do
// nome da pessoa ("12.345.678 JOAO DA SILVA", "MARIA SOUZA ***").
const MEI_NAME = /\d{2}\.?\d{3}\.?\d{3}|[*•]{3}/;
// Compra no débito vista na conta ("COMPRA CARTAO DEB", "Compra no débito").
const DEBIT_CARD = /\bcompra\b.{0,20}\b(debito|deb|cartao)\b/;

// Palavras que dizem que o nome é de empresa ou loja, não de pessoa.
const BUSINESS_WORDS = new Set([
  'ltda', 'sa', 'me', 'epp', 'eireli', 'cia', 'comercio', 'comercial', 'com', 'br', 'brasil', 'servicos',
  'servico', 'serv', 'industria', 'ind', 'distribuidora', 'importadora', 'atacado', 'varejo', 'mercantil',
  'loja', 'lojas', 'magazine', 'store', 'shop', 'market', 'marketplace', 'outlet', 'center', 'shopping',
  'express', 'online', 'digital', 'tecnologia', 'pagamentos', 'grupo', 'holding', 'participacoes',
  'empreendimentos', 'construtora', 'engenharia', 'consultoria', 'assessoria', 'transportes', 'logistica',
  'seguros', 'seguradora', 'banco', 'bank', 'financeira', 'clube', 'club', 'associacao', 'instituto',
  'fundacao', 'cooperativa', 'coop', 'modas', 'moda', 'calcados', 'presentes', 'eletro', 'eletronicos',
  'informatica', 'cosmeticos', 'perfumaria', 'net', 'www', 'app', 'games',
]);
const NAME_LINKS = new Set(['de', 'da', 'do', 'dos', 'das', 'e']);

/**
 * Tem jeito de nome de pessoa: de 2 a 6 palavras só de letras ("MARCOS
 * ANTONIO ROCHA"), nenhuma de empresa. Firma individual tem o nome do dono
 * sem número nenhum; uma palavra só costuma ser marca.
 */
function looksLikePersonName(name: string): boolean {
  const words = normalizeBankText(name)
    .split(' ')
    .filter((w) => w && !/\d/.test(w) && !NAME_LINKS.has(w));
  if (words.length < 2 || words.length > 6) return false;
  return words.every((w) => /^[a-z]+$/.test(w) && !BUSINESS_WORDS.has(w));
}

/** Ver BankPurchase.storeName. */
function storeNameOf(
  tx: FinTransaction,
  account: FinAccount | undefined,
  description: string,
  category: FinanceCategory,
): string | null {
  // Nome de pessoa só passa quando a categoria é de loja (a Pluggy ou a descrição reconheceram o ramo).
  const shown = (name: string) => (category === 'outros' && looksLikePersonName(name) ? null : name);
  const company = (name: string) => (MEI_NAME.test(name) ? null : shown(name));
  if (tx.merchant_name) return company(tx.merchant_name);
  if (tx.counterparty_doc_kind === 'CNPJ' && tx.counterparty_name) return company(tx.counterparty_name);
  if (tx.counterparty_doc_kind === 'CPF') return null;
  const card =
    account?.type === 'CREDIT' ||
    (tx.operation_type ?? '').toUpperCase() === 'CARTAO' ||
    DEBIT_CARD.test(normalizeBankText(description));
  if (!card) return null;
  // Na maquininha, quem vende pode ser uma pessoa: o nome só vai com uma categoria de loja.
  const seller = merchantFromDescriptor(description);
  if (seller) return category === 'outros' ? null : seller;
  return shown(description);
}

/** Parcela de uma compra parcelada (n de N, com N > 1): as outras saídas contam inteiras. */
export const isParcel = (tx: FinTransaction) =>
  tx.direction === 'DEBIT' &&
  tx.installment_number != null &&
  tx.total_installments != null &&
  tx.total_installments > 1 &&
  tx.installment_number >= 1 &&
  tx.installment_number <= tx.total_installments;

/**
 * Lançamentos do banco -> compras. Lançamentos apagados na Pluggy ficam de
 * fora; a parcela prevista que o banco trocou pela lançada (outro id) só
 * empresta a chave dela (ver parcelPurchases). `rules` são as categorias que
 * a pessoa escolheu (bankRules) e `sensitiveKeys`, o que ela já pôs em Saúde
 * algum dia.
 */
export function groupPurchases(
  txs: FinTransaction[],
  accounts: FinAccount[],
  ownerDocHashes: Iterable<string> = ownerHashes(accounts),
  rules: CategoryRules = NO_RULES,
  sensitiveKeys: SensitiveKeys = NO_SENSITIVE_KEYS,
): BankPurchase[] {
  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  const owners = new Set(ownerDocHashes);
  const live = txs.filter((tx) => !tx.deleted_at);
  const kinds = new Map(live.map((tx) => [tx.id, classifyBankTransaction(tx, accountsById.get(tx.account_id), owners)]));
  pairOwnMoves(live, kinds, accountsById, owners);
  const saude = saudeStores(rules, sensitiveKeys);

  const purchases: BankPurchase[] = [];
  const parcels: RawParcel[] = [];
  // A prevista que sumiu da Pluggy quando a parcela foi lançada: não conta, só guarda a escolha feita nela.
  for (const tx of txs) if (tx.deleted_at && tx.status === 'PENDING' && isParcel(tx)) parcels.push({ tx, kind: 'spending', replaced: true });
  // Estorno que diz qual parcela desfaz ("ESTORNO LOJA 03/10"): ajuda a ligar à parcela certa.
  const refundMarks = new Map<string, ParcelMark>();
  for (const tx of live) {
    const kind = kinds.get(tx.id) as BankKind;
    if (isParcel(tx)) {
      parcels.push({ tx, kind });
      continue;
    }
    const description = tidy(tx.description);
    const key = `tx-${tx.id}`;
    if (kind === 'refund') {
      const mark = parcelMark(tx);
      if (mark) refundMarks.set(key, mark);
    }
    const merchantName = merchantNameOf(tx, description);
    const autoCategory = financeCategoryOfBank(tx);
    const similarKey = similarRuleKey(tx, merchantName ?? description);
    const { category, source } = pickCategory(rules, key, similarKey, autoCategory);
    // O estorno de uma loja posta em Saúde também: com o par, em linkRefunds; sem ele, pelo nome.
    const chosen =
      chosenSensitive(rules, sensitiveKeys, key, similarKey) ||
      (kind === 'refund' && refundOfSaudeStore(saude, tx, merchantName ?? description));
    purchases.push({
      key,
      date: effectiveDate(tx),
      amount: Number(tx.amount),
      description,
      merchantName,
      merchantCnpj: tx.merchant_cnpj ?? tx.counterparty_cnpj,
      category,
      autoCategory,
      categorySource: source,
      similarKey,
      kind,
      pending: tx.status === 'PENDING',
      accountId: tx.account_id,
      installment: null,
      ruleKey: key,
      ruleKeys: [key],
      txIds: [tx.id],
      personTransfer: tx.counterparty_doc_kind === 'CPF' && (kind === 'spending' || kind === 'income' || kind === 'refund'),
      // Saúde escolhida pela pessoa também só vai somada; tirar de saúde não tira o sigilo.
      sensitive: isSensitiveBankTx(tx) || category === 'saude' || chosen,
      // Nome de pessoa como loja só passa pela categoria automática, nunca pela escolha da pessoa.
      storeName: storeNameOf(tx, accountsById.get(tx.account_id), description, autoCategory),
      refundOf: null,
      refundParts: [],
    });
  }

  const groups = groupParcels(toParcels(parcels));
  const unsure = unsureReplacements(groups);
  for (const group of groups) {
    purchases.push(...parcelPurchases(group, accountsById, rules, sensitiveKeys, unsure));
  }
  linkRefunds(purchases, refundMarks);
  return purchases.sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount || a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------------------
// Dinheiro da pessoa que só muda de lugar

/** Dias de folga entre os dois lados de uma transferência entre as próprias contas. */
export const OWN_TRANSFER_DAYS = 2;
/** Dias entre pagar a fatura na conta e o cartão registrar o "Pagamento recebido". */
export const CARD_PAYMENT_DAYS = 3;
/** Saída que já diz "fatura": casa com o "Pagamento recebido" até uma semana (uns 5 dias úteis) de distância. */
export const NAMED_CARD_PAYMENT_DAYS = 7;

/**
 * Casa cada lançamento de `from` com o de `to` de mesmo valor mais perto na
 * data (até `days` dias), um para um.
 */
function pairUp(
  from: FinTransaction[],
  to: FinTransaction[],
  days: number,
  fits: (a: FinTransaction, b: FinTransaction) => boolean = () => true,
): [FinTransaction, FinTransaction][] {
  const used = new Set<string>();
  const pairs: [FinTransaction, FinTransaction][] = [];
  const ordered = [...from].sort((a, b) => a.occurred_on.localeCompare(b.occurred_on) || a.id.localeCompare(b.id));
  for (const a of ordered) {
    let best: FinTransaction | null = null;
    let bestGap = Infinity;
    for (const b of to) {
      if (used.has(b.id) || Math.abs(Number(a.amount) - Number(b.amount)) >= 0.005 || !fits(a, b)) continue;
      const gap = Math.abs(diffDays(a.occurred_on, b.occurred_on));
      if (gap <= days && (gap < bestGap || (gap === bestGap && best !== null && b.id < best.id))) {
        best = b;
        bestGap = gap;
      }
    }
    if (best) {
      used.add(best.id);
      pairs.push([a, best]);
    }
  }
  return pairs;
}

/** Palavras do nome de quem recebeu ou pagou, sem "de", "da"... e sem números. */
function personWords(name: string | null): string[] {
  return normalizeBankText(name)
    .split(' ')
    .filter((w) => w && !NAME_LINKS.has(w) && !/\d/.test(w));
}

/**
 * Mesmo nome, com o corte que cada banco faz: um é o começo do outro ("JOAO
 * DA SILVA" e "JOAO DA SILVA SAU") ou têm o mesmo primeiro e último nome
 * ("JOAO SILVA" e "JOAO PEDRO DA SILVA").
 */
function sameName(a: string[], b: string[]): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (!short.length) return false;
  if (short.every((w, i) => (i === short.length - 1 ? long[i].startsWith(w) : w === long[i]))) return true;
  return short.length >= 2 && short[0] === long[0] && short[short.length - 1] === long[long.length - 1];
}

/**
 * PIX/TED que sai de uma conta + entrada de mesmo valor em outra conta da
 * pessoa em até 2 dias: é dinheiro dela mudando de lugar. Casa primeiro o
 * que tem prova de ser da dona (um lado já é dela: o documento dela, o banco
 * dizendo "mesma titularidade" ou a poupança; ou os dois lados com o mesmo
 * documento ou nome) e depois, só pelo valor e pela data, o par em que um
 * dos lados não diz nada sobre o outro lado. Documento ou nome diferentes
 * nunca casam, nem dois documentos mascarados sem nome (o aluguel pago e o
 * PIX do cônjuge do mesmo valor não são a mesma transferência). Sabendo o
 * documento da dona, documento completo de outra pessoa nunca casa
 * (emprestar e receber de volta não é interno). O lado que não era da dona
 * fica com o tipo do outro (interno, ou aplicação quando o outro é a
 * poupança). Devolve os ids que acharam par.
 */
function pairTransfers(
  txs: FinTransaction[],
  kinds: Map<string, BankKind>,
  accountsById: Map<string, FinAccount>,
  owners: ReadonlySet<string>,
): Set<string> {
  const accountOf = (tx: FinTransaction) => accountsById.get(tx.account_id);
  const moves = txs.filter((tx) => accountOf(tx)?.type === 'BANK' && isTransferLike(tx));
  const anchors = new Set(
    moves
      .filter((tx) => {
        const kind = kinds.get(tx.id);
        return kind === 'internal' || (kind === 'investment' && accountOf(tx)?.subtype === 'SAVINGS_ACCOUNT');
      })
      .map((tx) => tx.id),
  );
  const open = (tx: FinTransaction) => kinds.get(tx.id) === (tx.direction === 'DEBIT' ? 'spending' : 'income');
  const candidates = moves.filter((tx) => anchors.has(tx.id) || open(tx));
  const words = new Map(candidates.map((tx) => [tx.id, personWords(tx.counterparty_name)]));
  const named = (tx: FinTransaction) => (words.get(tx.id) as string[]).length > 0;

  const hashOf = (tx: FinTransaction) => tx.counterparty_doc_hash;
  const stranger = (tx: FinTransaction) => Boolean(hashOf(tx)) && owners.size > 0 && !owners.has(hashOf(tx) as string);
  const silent = (tx: FinTransaction) => !tx.counterparty_doc_kind && !hashOf(tx) && !named(tx);
  const clash = (a: FinTransaction, b: FinTransaction) =>
    a.account_id === b.account_id ||
    stranger(a) ||
    stranger(b) ||
    Boolean(hashOf(a) && hashOf(b) && hashOf(a) !== hashOf(b)) ||
    (named(a) && named(b) && !sameName(words.get(a.id) as string[], words.get(b.id) as string[]));
  const proven = (a: FinTransaction, b: FinTransaction) =>
    !clash(a, b) &&
    (anchors.has(a.id) || anchors.has(b.id) || Boolean(hashOf(a) && hashOf(a) === hashOf(b)) || (named(a) && named(b)));
  const byAmount = (a: FinTransaction, b: FinTransaction) => !clash(a, b) && (silent(a) || silent(b));

  const out = candidates.filter((tx) => tx.direction === 'DEBIT');
  const into = candidates.filter((tx) => tx.direction === 'CREDIT');
  const pairs = pairUp(out, into, OWN_TRANSFER_DAYS, proven);
  const used = new Set(pairs.flat().map((tx) => tx.id));
  const free = (tx: FinTransaction) => !used.has(tx.id);
  pairs.push(...pairUp(out.filter(free), into.filter(free), OWN_TRANSFER_DAYS, byAmount));

  for (const [a, b] of pairs) {
    if (anchors.has(a.id) && anchors.has(b.id)) continue;
    if (anchors.has(a.id)) kinds.set(b.id, kinds.get(a.id) as BankKind);
    else if (anchors.has(b.id)) kinds.set(a.id, kinds.get(b.id) as BankKind);
    else {
      kinds.set(a.id, 'internal');
      kinds.set(b.id, 'internal');
    }
  }
  return new Set(pairs.flat().map((tx) => tx.id));
}

/**
 * O que o documento e o texto não dizem, o outro lado diz. O banco quase
 * nunca manda o CPF da dona (sem ele não há hash para comparar), e a fatura
 * paga por boleto ou PIX nem sempre diz "fatura". Na ordem:
 * 1. a saída que diz "fatura" fica com o "Pagamento recebido" do cartão de
 *    mesmo valor (até uma semana): cada pagamento casa uma vez só;
 * 2. transferências entre as próprias contas (pairTransfers): o PIX que leva
 *    o dinheiro para o banco do cartão não é a fatura;
 * 3. "Pagamento recebido" que sobrou + saída de mesmo valor na conta em até 3
 *    dias: a saída é a fatura (a compra já contou no cartão). Boleto ou
 *    empresa antes de PIX/TED.
 */
function pairOwnMoves(
  txs: FinTransaction[],
  kinds: Map<string, BankKind>,
  accountsById: Map<string, FinAccount>,
  owners: ReadonlySet<string>,
) {
  const typeOf = (tx: FinTransaction) => accountsById.get(tx.account_id)?.type;
  const kindIs = (kind: BankKind) => (tx: FinTransaction) => kinds.get(tx.id) === kind;

  const cardPayments = txs.filter((tx) => typeOf(tx) === 'CREDIT' && tx.direction === 'CREDIT' && kindIs('card_payment')(tx));
  // PIX para uma pessoa não paga fatura.
  const bankDebits = txs.filter((tx) => typeOf(tx) === 'BANK' && tx.direction === 'DEBIT' && tx.counterparty_doc_kind !== 'CPF');
  const named = new Set(
    pairUp(cardPayments, bankDebits.filter(kindIs('card_payment')), NAMED_CARD_PAYMENT_DAYS).map(([card]) => card.id),
  );

  const moved = pairTransfers(txs, kinds, accountsById, owners);

  const left = cardPayments.filter((tx) => !named.has(tx.id));
  const open = bankDebits.filter((tx) => kindIs('spending')(tx) && !moved.has(tx.id));
  const bills = pairUp(left, open.filter((tx) => !isTransferLike(tx)), CARD_PAYMENT_DAYS);
  const paid = new Set(bills.map(([card]) => card.id));
  bills.push(...pairUp(left.filter((tx) => !paid.has(tx.id)), open.filter(isTransferLike), CARD_PAYMENT_DAYS));
  for (const [, debit] of bills) kinds.set(debit.id, 'card_payment');
}

// ---------------------------------------------------------------------------
// Parcelas

interface RawParcel {
  tx: FinTransaction;
  kind: BankKind;
  /** A prevista que o banco trocou pela lançada (apagada na Pluggy): só empresta a chave. */
  replaced?: boolean;
}

interface Parcel {
  tx: FinTransaction;
  kind: BankKind;
  /** Ver RawParcel.replaced: nunca vira lançamento. */
  replaced: boolean;
  number: number;
  total: number;
  amount: number;
  /** Data que o banco mandou para a parcela: a da compra, se veio, senão a do lançamento. */
  date: string;
  /** `date` veio como data da compra (purchase_on). */
  fromPurchase: boolean;
  /** Data da compra: a do banco ou estimada pela parcela. */
  anchor: string;
  /** A data da compra veio do banco, igual em todas as parcelas (não foi estimada). */
  exact: boolean;
  /** Conta + total de parcelas + loja (sem a marca da parcela). */
  key: string;
}

/**
 * Estimativas da data da compra que caem até tantos dias uma da outra são a
 * mesma compra: dias de fatura variam de um mês para o outro.
 */
export const ESTIMATE_SLACK_DAYS = 4;
/** Um ciclo de fatura: a parcela lançada no dia da fatura cai até isso depois da compra. */
const BILL_CYCLE_DAYS = 35;
/**
 * Parcela n > 1 com a "data da compra" até tantos dias do lançamento foi
 * carimbada no dia dela (Santander), não na compra: a do Nubank, com a data
 * da compra de verdade, fica pelo menos um mês antes. Errar aqui empurraria
 * cada parcela n-1 meses para frente.
 */
const STAMPED_PARCEL_DAYS = 20;

const similarParcel = (a: { amount: number; total: number }, amount: number) =>
  Math.abs(a.amount - amount) <= 0.01 * a.total + 1e-9;

/**
 * Como a conta data as parcelas: com o dia da compra em todas ('compra') ou
 * com o dia de cada parcela ('parcela': a n caiu n-1 meses depois). O
 * Nubank manda a data da compra em todas; o Santander carimba a "data da
 * compra" parcela por parcela; sem data da compra, a do lançamento costuma
 * ser a da parcela. Cada par de parcelas da mesma loja vota: mesma data com
 * números diferentes é 'compra'; um mês por parcela de distância é
 * 'parcela'. Conta sem par nenhum (uma parcela só de cada compra na janela)
 * vota pela parcela n > 1 com data da compra: perto da do lançamento
 * (STAMPED_PARCEL_DAYS) é 'parcela'; bem antes é 'compra' (a compra de
 * verdade foi meses antes). Sem maioria, vale o costume de cada tipo de data.
 */
type ParcelDating = 'compra' | 'parcela';

const datingKey = (p: Pick<Parcel, 'tx' | 'fromPurchase'>) => `${p.tx.account_id}|${p.fromPurchase ? 'compra' : 'lancamento'}`;

function parcelDating(parcels: Parcel[]): Map<string, ParcelDating> {
  const votes = new Map<string, Record<ParcelDating, number>>();
  const byKey = new Map<string, Parcel[]>();
  for (const p of parcels) byKey.set(p.key, [...(byKey.get(p.key) ?? []), p]);
  for (const same of byKey.values()) {
    for (const a of same) {
      for (const b of same) {
        if (a.number >= b.number || a.fromPurchase !== b.fromPurchase || !similarParcel(a, b.amount)) continue;
        const vote = votes.get(datingKey(a)) ?? { compra: 0, parcela: 0 };
        if (a.date === b.date) vote.compra += 1;
        else if (Math.abs(diffDays(addMonths(a.date, b.number - a.number), b.date)) <= ESTIMATE_SLACK_DAYS) vote.parcela += 1;
        votes.set(datingKey(a), vote);
      }
    }
  }
  const single = new Map<string, Record<ParcelDating, number>>();
  for (const p of parcels) {
    if (!p.fromPurchase || p.number < 2) continue;
    const vote = single.get(datingKey(p)) ?? { compra: 0, parcela: 0 };
    if (Math.abs(diffDays(p.date, p.tx.occurred_on)) <= STAMPED_PARCEL_DAYS) vote.parcela += 1;
    else vote.compra += 1;
    single.set(datingKey(p), vote);
  }
  for (const [key, vote] of single) {
    const pairs = votes.get(key);
    if (!pairs || pairs.compra + pairs.parcela === 0) votes.set(key, vote);
  }
  const out = new Map<string, ParcelDating>();
  for (const [key, vote] of votes) {
    const usual: ParcelDating = key.endsWith('|compra') ? 'compra' : 'parcela';
    const other: ParcelDating = usual === 'compra' ? 'parcela' : 'compra';
    out.set(key, vote[other] > vote[usual] ? other : usual);
  }
  return out;
}

function toParcels(raw: RawParcel[]): Parcel[] {
  const parcels: Parcel[] = raw.map(({ tx, kind, replaced = false }) => ({
    tx,
    kind,
    replaced,
    number: tx.installment_number as number,
    total: tx.total_installments as number,
    amount: Number(tx.amount),
    date: tx.purchase_on ?? tx.occurred_on,
    fromPurchase: tx.purchase_on != null,
    anchor: '',
    exact: false,
    key: `${tx.account_id}|${tx.total_installments}|${normalizeBankText(stripParcelMarker(tx.description))}`,
  }));
  // A prevista substituída não vota: ela repetiria a lançada.
  const dating = parcelDating(parcels.filter((p) => !p.replaced));
  for (const p of parcels) {
    const mode = dating.get(datingKey(p)) ?? (p.fromPurchase ? 'compra' : 'parcela');
    p.anchor = mode === 'compra' ? p.date : addMonths(p.date, -(p.number - 1));
    p.exact = mode === 'compra' && p.fromPurchase;
  }
  return parcels;
}

interface Group {
  key: string;
  anchor: string;
  exact: boolean;
  /** Valor de referência da parcela (para comparar com a próxima). */
  parcel: number;
  total: number;
  members: Parcel[];
}

const numbers = (g: Group) => g.members.map((m) => m.number);

/**
 * Junta as parcelas de cada compra. Duas compras iguais (mesma loja, dia,
 * valor e número de parcelas) viram duas: um número de parcela repetido abre
 * outra compra. O valor pode variar uns centavos (a sobra da divisão costuma
 * ir na primeira parcela).
 */
function groupParcels(parcels: Parcel[]): Group[] {
  const sorted = [...parcels].sort(
    (a, b) => a.anchor.localeCompare(b.anchor) || a.number - b.number || a.tx.id.localeCompare(b.tx.id),
  );
  const groups: Group[] = [];
  for (const p of sorted) {
    let best: Group | null = null;
    let bestGap = Infinity;
    for (const g of groups) {
      // Número repetido abre outra compra (duas compras iguais), salvo a prevista e a lançada da mesma parcela.
      const repeated = g.members.some(
        (m) => m.number === p.number && (m.tx.status === 'PENDING') === (p.tx.status === 'PENDING'),
      );
      if (g.key !== p.key || repeated || !similarParcel({ amount: g.parcel, total: p.total }, p.amount)) {
        continue;
      }
      const gap = Math.abs(diffDays(g.anchor, p.anchor));
      if (gap <= (g.exact && p.exact ? 0 : ESTIMATE_SLACK_DAYS) && gap < bestGap) {
        best = g;
        bestGap = gap;
      }
    }
    if (!best) {
      groups.push({ key: p.key, anchor: p.anchor, exact: p.exact, parcel: p.amount, total: p.total, members: [p] });
      continue;
    }
    best.members.push(p);
    if (!best.exact && p.exact) {
      best.anchor = p.anchor;
      best.exact = true;
    }
  }
  return mergeLateParcels(groups);
}

/**
 * Banco que lança a 1ª parcela no dia da compra e as outras no dia da fatura
 * deixa a estimativa das outras uns dias depois da compra; separadas, cada
 * parte viraria uma compra inteira. Um grupo estimado sem a 1ª parcela entra
 * no grupo da mesma loja com as parcelas de antes, se a estimativa dele cair
 * até um ciclo de fatura depois (nunca antes).
 */
function mergeLateParcels(groups: Group[]): Group[] {
  const out: Group[] = [];
  const ordered = [...groups].sort((a, b) => Math.min(...numbers(a)) - Math.min(...numbers(b)) || a.anchor.localeCompare(b.anchor));
  for (const late of ordered) {
    const first = Math.min(...numbers(late));
    let target: Group | null = null;
    let bestGap = Infinity;
    if (!late.exact && first > 1) {
      for (const g of out) {
        if (g.key !== late.key || Math.max(...numbers(g)) >= first || !similarParcel({ amount: g.parcel, total: g.total }, late.parcel)) {
          continue;
        }
        // Só previstas já apagadas: não é a compra das parcelas de agora.
        if (g.members.every((m) => m.replaced)) continue;
        const gap = diffDays(g.anchor, late.anchor);
        if (gap >= 0 && gap <= BILL_CYCLE_DAYS && gap < bestGap) {
          target = g;
          bestGap = gap;
        }
      }
    }
    if (target) target.members.push(...late.members);
    else out.push(late);
  }
  return out;
}

/**
 * Previstas cuja troca pela lançada não é certa: mais de uma compra igual
 * (mesma conta, loja, total e data) tem a lançada daquele número. Aí não dá
 * para saber de qual compra era a prevista, e a chave dela (a escolha feita
 * antes de lançar) não vai para nenhuma.
 */
function unsureReplacements(groups: Group[]): Set<Parcel> {
  const unsure = new Set<Parcel>();
  for (const group of groups) {
    for (const m of group.members) {
      if (m.tx.status !== 'PENDING') continue;
      const twins = groups.filter(
        (g) =>
          g.key === m.key &&
          Math.abs(diffDays(g.anchor, m.anchor)) <= ESTIMATE_SLACK_DAYS &&
          g.members.some((o) => !o.replaced && o.tx.status !== 'PENDING' && o.number === m.number),
      );
      if (twins.length > 1) unsure.add(m);
    }
  }
  return unsure;
}

/**
 * Uma saída por parcela vista: a parcela n no mês da compra + (n-1), com o
 * valor dela. A compra inteira decide o que vale para todas as parcelas: a
 * descrição, a loja, a categoria (a escolha "Só esta" em qualquer parcela
 * vale para a compra), o sigilo e o nome que vai para a IA.
 */
function parcelPurchases(
  group: Group,
  accountsById: Map<string, FinAccount>,
  rules: CategoryRules,
  sensitiveKeys: SensitiveKeys,
  unsure: ReadonlySet<Parcel>,
): BankPurchase[] {
  // A prevista e a lançada da mesma parcela (ids diferentes, enquanto a prevista não some): vale a lançada.
  // A prevista que já sumiu da Pluggy nunca vira lançamento.
  const byNumber = new Map<number, Parcel>();
  for (const m of group.members) {
    if (m.replaced) continue;
    const other = byNumber.get(m.number);
    if (!other || (other.tx.status === 'PENDING' && m.tx.status !== 'PENDING')) byNumber.set(m.number, m);
  }
  if (!byNumber.size) return [];
  const members = [...byNumber.values()].sort((a, b) => a.number - b.number);
  const first = members[0];
  const last = members[members.length - 1];
  const total = first.total;
  // A parcela "normal" é a última vista; a primeira às vezes leva a sobra dos centavos.
  const parcel = last.amount;
  const seenSum = members.reduce((sum, m) => sum + m.amount, 0);
  const description = stripParcelMarker(first.tx.description);
  const seriesKey = `serie-${first.tx.id}`;
  // A escolha pode estar na prevista que a lançada substituiu (escolhida antes de a parcela ser lançada),
  // ainda na Pluggy ou já apagada lá, quando a troca é certa (unsureReplacements).
  const replaced = group.members.filter((m) => !members.includes(m) && !unsure.has(m));
  const ruleKeys = [...members, ...replaced].map((m) => `parc-${m.tx.id}`);
  const merchantName = merchantNameOf(first.tx, description);
  const autoCategory = financeCategoryOfBank(first.tx);
  const similarKey = similarRuleKey(first.tx, merchantName ?? description);
  const { category, source, ruleKey: chosenKey } = pickCategory(rules, ruleKeys, similarKey, autoCategory);
  const posted = members.find((m) => m.tx.status !== 'PENDING') ?? first;
  const ruleKey = chosenKey ?? `parc-${posted.tx.id}`;
  // Estimada, vale a da parcela mais antiga: é a que caiu mais perto da compra.
  const purchaseDate = group.exact ? group.anchor : first.anchor;
  const series = {
    seriesKey,
    total,
    parcel,
    purchaseDate,
    purchaseExact: group.exact || first.number === 1,
    purchaseAmount: round2(seenSum + (total - members.length) * parcel),
    seen: members.map((m) => m.number),
  };
  const sensitive =
    group.members.some((m) => isSensitiveBankTx(m.tx)) ||
    category === 'saude' ||
    chosenSensitive(rules, sensitiveKeys, ruleKeys, similarKey);
  const storeName = storeNameOf(first.tx, accountsById.get(first.tx.account_id), description, autoCategory);
  return members.map((m) => ({
    key: `parc-${m.tx.id}`,
    date: addMonths(purchaseDate, m.number - 1),
    amount: m.amount,
    description,
    merchantName,
    merchantCnpj: m.tx.merchant_cnpj ?? m.tx.counterparty_cnpj ?? first.tx.merchant_cnpj ?? first.tx.counterparty_cnpj,
    category,
    autoCategory,
    categorySource: source,
    similarKey,
    kind: first.kind,
    pending: m.tx.status === 'PENDING',
    accountId: m.tx.account_id,
    installment: { ...series, number: m.number },
    ruleKey,
    ruleKeys,
    txIds: [m.tx.id],
    personTransfer: false,
    sensitive,
    storeName,
    refundOf: null,
    refundParts: [],
  }));
}

// ---------------------------------------------------------------------------
// Estornos

// O que o estorno diz além do nome da loja ("Estorno de compra LOJA X").
const REFUND_FILLER = new Set([
  'estorno', 'estornado', 'estornada', 'estornos', 'devolucao', 'devolvido', 'devolvida', 'reembolso',
  'ressarcimento', 'chargeback', 'cancelamento', 'cancelado', 'cancelada', 'cashback', 'credito', 'compra',
  'pagamento', 'valor', 'parcial', 'total', 'ref', 'referente', 'pix', 'ted', 'de', 'da', 'do', 'a', 'o', 'em',
  'no', 'na',
]);

/** Nome da loja sem as palavras do estorno e sem números, tudo junto ("Estorno LOJA DE TV" -> "lojatv"). */
function storeKey(text: string | null): string {
  if (!text) return '';
  return normalizeBankText(stripParcelMarker(text))
    .split(' ')
    .filter((w) => w && !REFUND_FILLER.has(w) && !/\d/.test(w))
    .join('');
}

/** A compra e o estorno falam da mesma loja: um nome contém o outro (com pelo menos 4 letras). */
function sameStore(refund: BankPurchase, purchase: BankPurchase): boolean {
  const refundKeys = [storeKey(refund.description), storeKey(refund.merchantName)].filter((k) => k.length >= 4);
  const purchaseKeys = [storeKey(purchase.description), storeKey(purchase.merchantName)].filter((k) => k.length >= 4);
  return refundKeys.some((r) => purchaseKeys.some((p) => p.includes(r) || r.includes(p)));
}

const sameAmount = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * Estorno só desfaz o que foi cobrado até tantos meses antes dele: as
 * parcelas vêm buscadas desde bem antes, e um estorno sem o nome da loja
 * casaria pelo valor com uma parcela de anos atrás.
 */
const REFUND_MONTHS_BACK = 6;

interface RefundTarget {
  score: number;
  /** 0 à vista, 1 compra parcelada inteira, 2 parcela: no empate sem marca, a à vista vence a parcela. */
  rank: number;
  /** Mais recente primeiro, mas só até o mês do estorno (parcela já mandada para depois fica por último). */
  date: string;
  key: string;
  row?: BankPurchase;
  rows?: BankPurchase[];
}

/**
 * Liga cada estorno ao que ele desfaz, na mesma conta, de data até a dele e
 * cobrado nos REFUND_MONTHS_BACK meses antes:
 * - uma saída (à vista ou parcela), quando o valor cabe no que resta dela. A
 *   mesma loja, o mesmo valor e, na parcela, a mesma marca n/N pontuam; no
 *   empate, a mais recente até o mês do estorno, e sem marca a à vista
 *   antes da parcela;
 * - a compra parcelada inteira, quando o valor passa do que resta de
 *   qualquer parcela e cabe no da compra (as vistas mais as que faltam): o
 *   estorno do valor cheio ou da soma das já cobradas. Ele abate as parcelas
 *   vistas, das de até o mês do estorno (a mais nova primeiro) às
 *   posteriores; o resto fica de crédito para as que faltam
 *   (futureInstallments).
 * Estorno sem par (compra de antes da janela, ou que não deu para
 * reconhecer) não abate nada.
 */
function linkRefunds(purchases: BankPurchase[], marks: Map<string, ParcelMark>) {
  const left = new Map(purchases.filter((p) => p.kind === 'spending').map((p) => [p.key, p.amount]));
  const leftOf = (key: string) => left.get(key) ?? 0;
  const series = new Map<string, BankPurchase[]>();
  for (const p of purchases) {
    if (p.kind !== 'spending' || !p.installment) continue;
    series.set(p.installment.seriesKey, [...(series.get(p.installment.seriesKey) ?? []), p]);
  }
  const credit = new Map<string, number>();
  const refunds = purchases
    .filter((p) => p.kind === 'refund')
    .sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  for (const refund of refunds) {
    const mark = marks.get(refund.key) ?? null;
    const monthEnd = monthRange(refund.date.slice(0, 7)).end;
    const oldest = addMonths(refund.date, -REFUND_MONTHS_BACK);
    const recent = (date: string) => (date < monthEnd ? date : '');
    let best: RefundTarget | null = null;
    const consider = (t: RefundTarget) => {
      const wins =
        !best ||
        t.score > best.score ||
        (t.score === best.score &&
          (t.rank < best.rank ||
            (t.rank === best.rank &&
              (recent(t.date) > recent(best.date) || (recent(t.date) === recent(best.date) && t.key < best.key)))));
      if (wins) best = t;
    };
    for (const p of purchases) {
      if (!left.has(p.key) || p.accountId !== refund.accountId || p.date < oldest) continue;
      if ((p.installment?.purchaseDate ?? p.date) > refund.date || refund.amount > leftOf(p.key) + 0.005) continue;
      const store = sameStore(refund, p);
      // A marca da descrição só escolhe a parcela dentro da mesma loja: sozinha, "05/09" pode ser uma data.
      const markHit =
        !!mark &&
        (store || mark.fromFields) &&
        !!p.installment &&
        mark.number === p.installment.number &&
        mark.total === p.installment.total;
      const score = (store ? 2 : 0) + (sameAmount(refund.amount, p.amount) ? 1 : 0) + (markHit ? 2 : 0);
      if (score > 0) consider({ score, rank: p.installment ? 2 : 0, date: p.date, key: p.key, row: p });
    }
    for (const [seriesKey, rows] of series) {
      const info = rows[0].installment as BankInstallment;
      if (rows[0].accountId !== refund.accountId || info.purchaseDate > refund.date) continue;
      // Sem parcela nos últimos meses, ou o estorno cabe em cada parcela (aí é de uma delas).
      if (rows.every((r) => r.date < oldest || refund.amount <= leftOf(r.key) + 0.005)) continue;
      const missing = Math.max(0, info.total - rows.length) * info.parcel - (credit.get(seriesKey) ?? 0);
      const capacity = rows.reduce((sum, r) => sum + leftOf(r.key), 0) + Math.max(0, missing);
      if (refund.amount > capacity + 0.005) continue;
      // O valor cheio, ou o das parcelas vistas, ou o já cobrado até o mês do estorno (a que o banco já mandou
      // para depois ainda não foi cobrada).
      const seenSum = rows.reduce((sum, r) => sum + r.amount, 0);
      const charged = rows.filter((r) => r.date < monthEnd).reduce((sum, r) => sum + r.amount, 0);
      const fullValue =
        sameAmount(refund.amount, seenSum) || sameAmount(refund.amount, charged) || sameAmount(refund.amount, info.purchaseAmount);
      const score = (sameStore(refund, rows[0]) ? 2 : 0) + (fullValue ? 1 : 0);
      if (score > 0) consider({ score, rank: 1, date: info.purchaseDate, key: seriesKey, rows });
    }
    const target = best as RefundTarget | null;
    if (!target) continue;
    const parts: { key: string; amount: number }[] = [];
    if (target.row) {
      parts.push({ key: target.row.key, amount: refund.amount });
      left.set(target.row.key, leftOf(target.row.key) - refund.amount);
    } else {
      const rows = target.rows as BankPurchase[];
      const ordered = [
        ...rows.filter((r) => r.date < monthEnd).sort((a, b) => b.date.localeCompare(a.date)),
        ...rows.filter((r) => r.date >= monthEnd).sort((a, b) => a.date.localeCompare(b.date)),
      ];
      let rest = refund.amount;
      for (const r of ordered) {
        const take = Math.min(leftOf(r.key), rest);
        if (take < 0.005) continue;
        parts.push({ key: r.key, amount: round2(take) });
        left.set(r.key, leftOf(r.key) - take);
        rest -= take;
      }
      if (rest > 0.005) credit.set(target.key, (credit.get(target.key) ?? 0) + rest);
    }
    refund.refundOf = target.key;
    refund.refundParts = parts;
    // O estorno conta a mesma história da compra: se ela só vai somada para a IA, ele também.
    if ((target.row ?? (target.rows as BankPurchase[])[0]).sensitive) refund.sensitive = true;
  }
}

// ---------------------------------------------------------------------------
// Resumo do mês

export interface BankMonthSummary {
  /** Saídas do mês já sem os estornos: a soma de byCategory. */
  spending: number;
  income: number;
  /** Estornos que abateram saídas do mês (os das saídas do mês, mesmo que tenham caído depois). */
  refunds: number;
  /**
   * Estornos que caíram no mês sem a compra que desfazem (compra de antes da
   * janela ou que não deu para reconhecer): aparecem à parte e não abatem nada.
   */
  otherRefunds: number;
  /** Parte das saídas ainda pendente no banco ("previsto"), já sem os estornos: nunca passa das saídas. */
  pending: number;
  /** Saídas por categoria (sem os estornos), da maior para a menor. */
  byCategory: { category: FinanceCategory; amount: number }[];
  /** Quantos lançamentos de saída no período (cada parcela conta um), sem os estornados por inteiro. */
  count: number;
}

/** Quanto os estornos abatem de cada saída (key), parcela por parcela. */
function refundedByKey(purchases: BankPurchase[]): Map<string, number> {
  const refunded = new Map<string, number>();
  for (const p of purchases) {
    if (p.kind !== 'refund') continue;
    for (const part of p.refundParts) refunded.set(part.key, (refunded.get(part.key) ?? 0) + part.amount);
  }
  return refunded;
}

/**
 * Soma das saídas com data em [start, end): a compra pela data dela, a
 * parcela pelo mês dela. Transferência para si mesma, aplicação, fatura paga
 * e dívida contratada ficam de fora. O estorno abate a saída que ele desfaz
 * (linkRefunds), no mês e na categoria dela: estorno de uma compra de
 * setembro abate setembro, não outubro; o da compra parcelada inteira abate
 * cada parcela no mês dela. Estorno sem par não abate nada (vai em
 * otherRefunds).
 */
export function summarizeRange(purchases: BankPurchase[], range: { start: string; end: string }): BankMonthSummary {
  const inRange = (p: BankPurchase) => p.date >= range.start && p.date < range.end;
  const refunded = refundedByKey(purchases);
  const net = new Map<FinanceCategory, number>();
  let gross = 0;
  let income = 0;
  let otherRefunds = 0;
  let pending = 0;
  let count = 0;
  for (const p of purchases) {
    if (!inRange(p)) continue;
    if (p.kind === 'spending') {
      const left = Math.max(0, p.amount - (refunded.get(p.key) ?? 0));
      gross += p.amount;
      if (left < 0.005) continue;
      count += 1;
      if (p.pending) pending += left;
      net.set(p.category, (net.get(p.category) ?? 0) + left);
    } else if (p.kind === 'refund' && !p.refundOf) {
      otherRefunds += p.amount;
    } else if (p.kind === 'income') {
      income += p.amount;
    }
  }
  const byCategory = [...net]
    .map(([category, amount]) => ({ category, amount: round2(amount) }))
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const spending = round2(byCategory.reduce((sum, c) => sum + c.amount, 0));
  return {
    spending,
    income: round2(income),
    refunds: round2(Math.max(0, gross - spending)),
    otherRefunds: round2(otherRefunds),
    pending: round2(Math.min(pending, spending)),
    byCategory,
    count,
  };
}

/** Resumo de um mês ("YYYY-MM"): a compra pela data dela, a parcela pelo mês dela. */
export function monthSummary(purchases: BankPurchase[], month: string): BankMonthSummary {
  return summarizeRange(purchases, monthRange(month));
}

// ---------------------------------------------------------------------------
// Janela do consultor

/** Meses que o consultor mostra: o atual e os dois anteriores (o retrato compara com eles). */
export const FINANCE_MONTHS_BACK = 2;
/**
 * Dias buscados antes da janela só para juntar e parear (um ciclo de fatura
 * com folga): a 1ª parcela de uma compra do fim do mês anterior, o outro lado
 * de uma transferência ou da fatura paga, a compra que um estorno desfaz.
 */
export const FINANCE_LOOKBACK_DAYS = 40;

/** Primeiro dia da janela: o mês de hoje e os dois anteriores. */
export function financeWindowStart(today: string): string {
  return monthRange(shiftMonth(today.slice(0, 7), -FINANCE_MONTHS_BACK)).start;
}

/** Primeiro dia dos lançamentos buscados: um ciclo de fatura antes da janela. */
export function financeFetchStart(today: string): string {
  return addDays(financeWindowStart(today), -FINANCE_LOOKBACK_DAYS);
}

/**
 * Meses buscados para trás só das parcelas. A data da compra e a chave da
 * compra parcelada saem da parcela de menor número: sem ela nos dados, as
 * parcelas mudariam de mês e a escolha "Só esta" se perderia enquanto a
 * compra ainda cobra.
 */
export const FINANCE_INSTALLMENT_MONTHS_BACK = 24;

/** Primeiro dia buscado das parcelas (lançamentos com o número da parcela). */
export function financeInstallmentFetchStart(today: string): string {
  return addMonths(financeWindowStart(today), -FINANCE_INSTALLMENT_MONTHS_BACK);
}

/**
 * Lançamentos com data na janela: o que a tela e o retrato listam e conferem
 * com o Kotii. A parcela que o banco já mandou para um mês que ainda não
 * chegou fica de fora (ela aparece no comprometido).
 */
export function windowPurchases(purchases: BankPurchase[], today: string): BankPurchase[] {
  const start = financeWindowStart(today);
  const end = monthRange(shiftMonth(today.slice(0, 7), 1)).start;
  return purchases.filter((p) => p.date >= start && p.date < end);
}

export interface InstallmentMonth {
  month: string;
  amount: number;
  parcels: {
    /** Única na lista: "<seriesKey>-<número>". */
    key: string;
    seriesKey: string;
    description: string;
    number: number;
    total: number;
    amount: number;
    /** O banco já mandou esta parcela (com o valor dela); senão, é a que falta, pela de referência. */
    seen: boolean;
  }[];
}

/**
 * O que as compras parceladas ainda vão cobrar, mês a mês a partir do mês de
 * `today` (inclui dívida parcelada no cartão). No mês atual, só as parcelas
 * que o banco ainda não lançou; nos seguintes, também as que ele já mandou.
 * Cada compra entra uma vez. Não entram: a parcela que faltou no meio (não dá
 * para saber se veio de outro jeito) ou num mês que já passou; as que faltam
 * de uma compra que parou de cobrar (a parcela seguinte à última vista
 * passou mais de um ciclo de fatura sem vir: quitada antes ou cancelada); e
 * nada de uma compra cancelada: estornada por inteiro, ou com as parcelas já
 * cobradas devolvidas por um estorno da compra inteira ou parcela por
 * parcela (duas ou mais). Só a 1ª parcela cobrada e devolvida pode ser
 * estorno só dela: a compra segue até parar de cobrar. O crédito de estorno
 * que passou das parcelas cobradas abate as que faltam. Meses sem parcela
 * vêm com zero.
 */
export function futureInstallments(purchases: BankPurchase[], today: string, months = 6): InstallmentMonth[] {
  const currentMonth = today.slice(0, 7);
  const out: InstallmentMonth[] = Array.from({ length: months }, (_, i) => ({
    month: shiftMonth(currentMonth, i),
    amount: 0,
    parcels: [],
  }));
  const refunded = refundedByKey(purchases);
  const series = new Map<string, BankPurchase[]>();
  const seriesOfKey = new Map<string, string>();
  for (const p of purchases) {
    if (!p.installment || (p.kind !== 'spending' && p.kind !== 'financing')) continue;
    series.set(p.installment.seriesKey, [...(series.get(p.installment.seriesKey) ?? []), p]);
    seriesOfKey.set(p.key, p.installment.seriesKey);
    seriesOfKey.set(p.installment.seriesKey, p.installment.seriesKey);
  }
  const refundTotal = new Map<string, number>();
  // Estornos da compra inteira (refundOf é a seriesKey) e, à parte, o devolvido a cada parcela.
  const wholeRefunds = new Map<string, number>();
  const parcelRefunds = new Map<string, number>();
  const credit = new Map<string, number>();
  for (const p of purchases) {
    const seriesKey = p.kind === 'refund' && p.refundOf ? seriesOfKey.get(p.refundOf) : undefined;
    if (!seriesKey) continue;
    refundTotal.set(seriesKey, (refundTotal.get(seriesKey) ?? 0) + p.amount);
    if (p.refundOf === seriesKey) wholeRefunds.set(seriesKey, (wholeRefunds.get(seriesKey) ?? 0) + p.amount);
    else for (const part of p.refundParts) parcelRefunds.set(part.key, (parcelRefunds.get(part.key) ?? 0) + part.amount);
    const allocated = p.refundParts.reduce((sum, part) => sum + part.amount, 0);
    credit.set(seriesKey, (credit.get(seriesKey) ?? 0) + Math.max(0, p.amount - allocated));
  }
  const monthEnd = monthRange(currentMonth).end;
  for (const [seriesKey, rows] of series) {
    const info = rows[0].installment as BankInstallment;
    const seenSum = rows.reduce((sum, r) => sum + r.amount, 0);
    // A parcela que o banco já mandou para um mês que vem ainda não foi cobrada.
    const chargedRows = rows.filter((r) => r.date < monthEnd);
    const charged = chargedRows.reduce((sum, r) => sum + r.amount, 0);
    const refundSum = refundTotal.get(seriesKey) ?? 0;
    const byParcel =
      chargedRows.length >= 2 && chargedRows.every((r) => (parcelRefunds.get(r.key) ?? 0) >= r.amount - 0.005);
    const cancelled =
      (refundSum > 0 && refundSum >= info.purchaseAmount - 0.005) ||
      ((wholeRefunds.get(seriesKey) ?? 0) > 0 && (sameAmount(refundSum, seenSum) || sameAmount(refundSum, charged))) ||
      byParcel;
    if (cancelled) continue;
    const maxSeen = Math.max(...info.seen);
    const charging = maxSeen < info.total && diffDays(addMonths(info.purchaseDate, maxSeen), today) <= BILL_CYCLE_DAYS;
    let rest = credit.get(seriesKey) ?? 0;
    for (let n = 1; n <= info.total; n++) {
      const month = addMonths(info.purchaseDate, n - 1).slice(0, 7);
      const slot = out.find((m) => m.month === month);
      const row = rows.find((r) => r.installment?.number === n);
      let amount = 0;
      if (row) {
        if (month <= currentMonth) continue;
        amount = Math.max(0, row.amount - (refunded.get(row.key) ?? 0));
      } else {
        if (!charging || n < maxSeen || month < currentMonth) continue;
        amount = info.parcel;
        const used = Math.min(rest, amount);
        rest -= used;
        amount -= used;
      }
      if (!slot || amount < 0.005) continue;
      slot.parcels.push({
        key: `${seriesKey}-${n}`,
        seriesKey,
        description: rows[0].description,
        number: n,
        total: info.total,
        amount: round2(amount),
        seen: !!row,
      });
      slot.amount = round2(slot.amount + amount);
    }
  }
  for (const m of out) {
    m.parcels.sort((a, b) => b.amount - a.amount || a.description.localeCompare(b.description) || a.key.localeCompare(b.key));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Contas e faturas

/**
 * Nome curto de cada conta: rótulo do banco + "conta", "poupança" ou
 * "cartão" ("Nubank conta", "Nubank cartão"). Repetidos ganham número.
 */
export function accountLabels(
  accounts: Pick<FinAccount, 'id' | 'connection_id' | 'type' | 'subtype'>[],
  connections: Pick<FinConnection, 'id' | 'label'>[],
): Map<string, string> {
  const labelOf = new Map(connections.map((c) => [c.id, c.label.trim()]));
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const a of accounts) {
    const kind = a.type === 'CREDIT' ? 'cartão' : a.subtype === 'SAVINGS_ACCOUNT' ? 'poupança' : 'conta';
    const base = `${labelOf.get(a.connection_id) ?? 'Banco'} ${kind}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.set(a.id, n === 1 ? base : `${base} ${n}`);
  }
  return out;
}

/**
 * Contas que a Pluggy ainda devolve. Cada sincronização completa regrava as
 * contas que vieram com a mesma hora que marca no banco (updated_at =
 * last_synced_at); a que ficou com hora mais velha sumiu da Pluggy (cartão
 * trocado, produto fora do consentimento) e sai de saldos e faturas. Os
 * lançamentos dela continuam valendo: as compras aconteceram.
 */
export function currentAccounts<T extends Pick<FinAccount, 'connection_id' | 'updated_at'>>(
  accounts: T[],
  connections: Pick<FinConnection, 'id' | 'last_synced_at'>[],
): T[] {
  const syncedAt = new Map(connections.map((c) => [c.id, c.last_synced_at ? Date.parse(c.last_synced_at) : NaN]));
  return accounts.filter((a) => {
    const synced = syncedAt.get(a.connection_id);
    if (synced === undefined || Number.isNaN(synced)) return true;
    const updated = Date.parse(a.updated_at);
    return Number.isNaN(updated) || updated >= synced;
  });
}

export interface CardBill {
  accountId: string;
  label: string;
  /**
   * Limite usado no cartão, como o banco informa: a fatura aberta mais as
   * parcelas que ainda vão cair (não é o valor da próxima fatura).
   */
  amount: number | null;
  /** Vencimento da fatura que o banco informou; null se já passou (essa fatura é velha). */
  dueDate: string | null;
  closeDate: string | null;
  minimumPayment: number | null;
  creditLimit: number | null;
  availableCredit: number | null;
}

/**
 * Cartões do jeito que o banco informa (sem estimativa), pela data de
 * vencimento. Vencimento antes de `today` é de uma fatura que já passou: sai
 * com o fechamento e o mínimo dela, para ninguém ler como a fatura de agora.
 */
export function cardBills(accounts: FinAccount[], labels: Map<string, string>, today?: string): CardBill[] {
  return accounts
    .filter((a) => a.type === 'CREDIT')
    .map((a) => {
      const past = Boolean(today && a.bill_due_date && a.bill_due_date < today);
      return {
        accountId: a.id,
        label: labels.get(a.id) ?? 'Cartão',
        amount: a.balance,
        dueDate: past ? null : a.bill_due_date,
        closeDate: past ? null : a.bill_close_date,
        minimumPayment: past ? null : a.minimum_payment,
        creditLimit: a.credit_limit,
        availableCredit: a.available_credit,
      };
    })
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.label.localeCompare(b.label));
}

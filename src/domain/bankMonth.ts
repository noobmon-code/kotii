// Consultor financeiro (beta): lançamentos do banco viram compras na visão
// "data da compra". Compra no cartão conta no dia da compra (não no da
// fatura); compra parcelada conta inteira nesse dia, e as parcelas que
// faltam aparecem como comprometidas nos meses seguintes.

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

export interface BankPurchase {
  /** Estável entre sincronizações: "tx-<id>" ou "parc-<id da primeira parcela vista>". */
  key: string;
  /** Data da compra (YYYY-MM-DD). */
  date: string;
  /** Em R$; na compra parcelada, o valor inteiro. */
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
  installments: { seen: number[]; total: number; parcel: number } | null;
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
   * Estorno: a compra (key) que ele desfaz, na mesma conta e até a data dele.
   * null quando não achou: aí não abate nada (ver summarizeRange).
   */
  refundOf: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Dia em que o lançamento conta: a data da compra no cartão, senão a do banco. */
export function effectiveDate(tx: Pick<FinTransaction, 'purchase_on' | 'occurred_on'>): string {
  return tx.purchase_on ?? tx.occurred_on;
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

const isParcel = (tx: FinTransaction) =>
  tx.direction === 'DEBIT' &&
  tx.installment_number != null &&
  tx.total_installments != null &&
  tx.total_installments > 1 &&
  tx.installment_number >= 1 &&
  tx.installment_number <= tx.total_installments;

/**
 * Lançamentos do banco -> compras. Lançamentos apagados na Pluggy ficam de
 * fora. `rules` são as categorias que a pessoa escolheu (bankRules) e
 * `sensitiveKeys`, o que ela já pôs em Saúde algum dia.
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
  const parcels: { tx: FinTransaction; kind: BankKind }[] = [];
  for (const tx of live) {
    const kind = kinds.get(tx.id) as BankKind;
    if (isParcel(tx)) {
      parcels.push({ tx, kind });
      continue;
    }
    const description = tidy(tx.description);
    const key = `tx-${tx.id}`;
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
      installments: null,
      txIds: [tx.id],
      personTransfer: tx.counterparty_doc_kind === 'CPF' && (kind === 'spending' || kind === 'income' || kind === 'refund'),
      // Saúde escolhida pela pessoa também só vai somada; tirar de saúde não tira o sigilo.
      sensitive: isSensitiveBankTx(tx) || category === 'saude' || chosen,
      // Nome de pessoa como loja só passa pela categoria automática, nunca pela escolha da pessoa.
      storeName: storeNameOf(tx, accountsById.get(tx.account_id), description, autoCategory),
      refundOf: null,
    });
  }

  for (const group of groupParcels(toParcels(parcels))) {
    purchases.push(purchaseOfGroup(group, accountsById, rules, sensitiveKeys));
  }
  linkRefunds(purchases);
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

interface Parcel {
  tx: FinTransaction;
  kind: BankKind;
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
const ESTIMATE_SLACK_DAYS = 4;
/** Um ciclo de fatura: a parcela lançada no dia da fatura cai até isso depois da compra. */
const BILL_CYCLE_DAYS = 35;

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
 * vota pela parcela n > 1 com data da compra: igual (até uns dias) à do
 * lançamento é 'parcela' (a compra de verdade foi meses antes); bem antes é
 * 'compra'. Sem maioria, vale o costume de cada tipo de data.
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
    if (Math.abs(diffDays(p.date, p.tx.occurred_on)) <= ESTIMATE_SLACK_DAYS) vote.parcela += 1;
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

function toParcels(raw: { tx: FinTransaction; kind: BankKind }[]): Parcel[] {
  const parcels: Parcel[] = raw.map(({ tx, kind }) => ({
    tx,
    kind,
    number: tx.installment_number as number,
    total: tx.total_installments as number,
    amount: Number(tx.amount),
    date: tx.purchase_on ?? tx.occurred_on,
    fromPurchase: tx.purchase_on != null,
    anchor: '',
    exact: false,
    key: `${tx.account_id}|${tx.total_installments}|${normalizeBankText(stripParcelMarker(tx.description))}`,
  }));
  const dating = parcelDating(parcels);
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
      if (g.key !== p.key || numbers(g).includes(p.number) || !similarParcel({ amount: g.parcel, total: p.total }, p.amount)) {
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

function purchaseOfGroup(
  group: Group,
  accountsById: Map<string, FinAccount>,
  rules: CategoryRules,
  sensitiveKeys: SensitiveKeys,
): BankPurchase {
  const members = [...group.members].sort((a, b) => a.number - b.number);
  const first = members[0];
  const last = members[members.length - 1];
  const total = first.total;
  // A parcela "normal" é a última vista; a primeira às vezes leva a sobra dos centavos.
  const parcel = last.amount;
  const seenSum = members.reduce((sum, m) => sum + m.amount, 0);
  const description = stripParcelMarker(first.tx.description);
  const key = `parc-${first.tx.id}`;
  const merchantName = merchantNameOf(first.tx, description);
  const autoCategory = financeCategoryOfBank(first.tx);
  const similarKey = similarRuleKey(first.tx, merchantName ?? description);
  const { category, source } = pickCategory(rules, key, similarKey, autoCategory);
  return {
    key,
    // Estimada, vale a da parcela mais antiga: é a que caiu mais perto da compra.
    date: group.exact ? group.anchor : first.anchor,
    amount: round2(seenSum + (total - members.length) * parcel),
    description,
    merchantName,
    merchantCnpj: first.tx.merchant_cnpj ?? first.tx.counterparty_cnpj,
    category,
    autoCategory,
    categorySource: source,
    similarKey,
    kind: first.kind,
    pending: members.every((m) => m.tx.status === 'PENDING'),
    accountId: first.tx.account_id,
    installments: { seen: members.map((m) => m.number), total, parcel },
    txIds: members.map((m) => m.tx.id),
    personTransfer: false,
    sensitive:
      members.some((m) => isSensitiveBankTx(m.tx)) ||
      category === 'saude' ||
      chosenSensitive(rules, sensitiveKeys, key, similarKey),
    storeName: storeNameOf(first.tx, accountsById.get(first.tx.account_id), description, autoCategory),
    refundOf: null,
  };
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

/**
 * Liga cada estorno à compra que ele desfaz: na mesma conta, de data até a
 * do estorno, com valor que ainda cabe nela e com a mesma loja ou o mesmo
 * valor (a mesma loja e o mesmo valor primeiro; empate, a compra mais
 * recente). Estorno sem compra assim (compra de antes da janela, ou que não
 * deu para reconhecer) fica sem par.
 */
function linkRefunds(purchases: BankPurchase[]) {
  const left = new Map(purchases.filter((p) => p.kind === 'spending').map((p) => [p.key, p.amount]));
  const refunds = purchases
    .filter((p) => p.kind === 'refund')
    .sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  for (const refund of refunds) {
    let best: BankPurchase | null = null;
    let bestScore = 0;
    for (const p of purchases) {
      const remaining = left.get(p.key);
      if (remaining === undefined || p.accountId !== refund.accountId || p.date > refund.date) continue;
      if (refund.amount > remaining + 0.005) continue;
      const score = (sameStore(refund, p) ? 2 : 0) + (Math.abs(refund.amount - p.amount) < 0.005 ? 1 : 0);
      if (score === 0) continue;
      const better =
        !best || score > bestScore || (score === bestScore && (p.date > best.date || (p.date === best.date && p.key < best.key)));
      if (better) {
        best = p;
        bestScore = score;
      }
    }
    if (!best) continue;
    refund.refundOf = best.key;
    // O estorno conta a mesma história da compra: se ela só vai somada para a IA, ele também.
    if (best.sensitive) refund.sensitive = true;
    left.set(best.key, (left.get(best.key) as number) - refund.amount);
  }
}

// ---------------------------------------------------------------------------
// Resumo do mês

export interface BankMonthSummary {
  /** Saídas do mês já sem os estornos: a soma de byCategory. */
  spending: number;
  income: number;
  /** Estornos que abateram saídas do mês (os das compras do mês, mesmo que tenham caído depois). */
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
  /** Quantas compras (saídas) no período, sem as estornadas por inteiro. */
  count: number;
}

/**
 * Soma das compras com data em [start, end). Transferência para si mesma,
 * aplicação, fatura paga e dívida contratada ficam de fora das saídas. O
 * estorno abate da compra que ele desfaz (linkRefunds), no mês e na
 * categoria dela: estorno de uma compra de setembro abate setembro, não
 * outubro. Estorno sem compra ligada não abate nada (vai em otherRefunds).
 */
export function summarizeRange(purchases: BankPurchase[], range: { start: string; end: string }): BankMonthSummary {
  const inRange = (p: BankPurchase) => p.date >= range.start && p.date < range.end;
  const refunded = new Map<string, number>();
  for (const p of purchases) {
    if (p.kind === 'refund' && p.refundOf) refunded.set(p.refundOf, (refunded.get(p.refundOf) ?? 0) + p.amount);
  }
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

/** Resumo de um mês ("YYYY-MM") pela data da compra. */
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

/** Compras com data na janela: o que a tela e o retrato listam e conferem com o Kotii. */
export function windowPurchases(purchases: BankPurchase[], today: string): BankPurchase[] {
  const start = financeWindowStart(today);
  return purchases.filter((p) => p.date >= start);
}

export interface InstallmentMonth {
  month: string;
  amount: number;
  parcels: { key: string; description: string; number: number; total: number; amount: number }[];
}

/**
 * Parcelas de compras já feitas que caem em cada mês a partir de `fromMonth`
 * (a parcela n cai n-1 meses depois do mês da compra). Inclui dívida
 * parcelada no cartão; meses sem parcela vêm com zero.
 */
export function futureInstallments(purchases: BankPurchase[], fromMonth: string, months = 6): InstallmentMonth[] {
  const out: InstallmentMonth[] = Array.from({ length: months }, (_, i) => ({
    month: shiftMonth(fromMonth, i),
    amount: 0,
    parcels: [],
  }));
  for (const p of purchases) {
    if (!p.installments || (p.kind !== 'spending' && p.kind !== 'financing')) continue;
    const firstMonth = p.date.slice(0, 7);
    for (let n = 1; n <= p.installments.total; n++) {
      const slot = out.find((m) => m.month === shiftMonth(firstMonth, n - 1));
      if (!slot) continue;
      slot.parcels.push({ key: p.key, description: p.description, number: n, total: p.installments.total, amount: p.installments.parcel });
      slot.amount = round2(slot.amount + p.installments.parcel);
    }
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

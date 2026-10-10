// Consultor financeiro (beta): categorias que a própria pessoa escolheu para
// os lançamentos do banco. Valem só para ela (tabela fin_category_rules) e
// passam na frente da categoria automática (bankCategories), na tela e no
// retrato do Nuke. Uma regra vale para uma compra só ("p:tx-<id>") ou para
// todas as parecidas: o mesmo destinatário de PIX ("doc:<hash do CPF>") ou o
// mesmo nome de loja ou descrição ("m:<texto>"). Escolher Saúde deixa uma
// marca (fin_sensitive_keys) que trocar ou desfazer a escolha não apaga.

import type { FinTransaction } from '@/lib/types';

import { normalizeBankText } from './bankCategories';
import type { FinanceCategory } from './finance';

export interface FinCategoryRule {
  match_key: string;
  category: FinanceCategory;
}

/** match_key -> categoria escolhida. */
export type CategoryRules = ReadonlyMap<string, FinanceCategory>;

export const NO_RULES: CategoryRules = new Map();

export function categoryRulesOf(rules: readonly FinCategoryRule[]): CategoryRules {
  return new Map(rules.map((r) => [r.match_key, r.category]));
}

/** Chave da regra de uma compra só (a chave estável da compra: "tx-<id>" ou "parc-<id>"). */
export const purchaseRuleKey = (purchaseKey: string) => `p:${purchaseKey}`;

/** Tamanho máximo do texto de "m:" (o banco confere o mesmo). */
export const SIMILAR_TEXT_MAX = 80;

// Palavras que sozinhas não dizem de quem é a compra: "PIX enviado", "Compra
// no débito", "Pagamento de boleto" juntariam coisas que não têm nada a ver.
const GENERIC = new Set([
  'pix', 'ted', 'doc', 'tef', 'transf', 'transferencia', 'transferencias', 'enviado', 'enviada', 'enviados',
  'recebido', 'recebida', 'recebidos', 'pagamento', 'pagto', 'pgto', 'pag', 'pg', 'boleto', 'boletos', 'compra',
  'compras', 'debito', 'deb', 'credito', 'cred', 'cartao', 'no', 'na', 'nos', 'nas', 'de', 'da', 'do', 'dos', 'das',
  'para', 'p', 'a', 'o', 'e', 'em', 'com', 'conta', 'contas', 'saque', 'deposito', 'tarifa', 'via', 'app',
  'online', 'qr', 'code', 'qrcode', 'agendado', 'agendada', 'programado', 'programada', 'parcela', 'parc', 'valor',
  'mensal', 'automatico', 'automatica', 'operacao', 'lancamento', 'estorno', 'internacional', 'nacional', 'br',
]);

/**
 * Texto que junta as compras parecidas: o nome da loja (ou a descrição), sem
 * números (data, código, parcela) e sem as palavras genéricas. null quando
 * não sobra nada que diga de quem é.
 */
export function similarText(name: string): string | null {
  const words = normalizeBankText(name)
    .split(' ')
    .filter((w) => w && !/\d/.test(w));
  if (!words.some((w) => w.length > 1 && !GENERIC.has(w))) return null;
  const text = words.join(' ');
  return text.length > SIMILAR_TEXT_MAX ? text.slice(0, SIMILAR_TEXT_MAX).trimEnd() : text;
}

/**
 * Chave de "todas as parecidas" de um lançamento. PIX ou transferência para
 * uma pessoa: o destinatário (hash do CPF, nunca o nome). Senão, o nome da
 * loja ou a descrição (`name`, já sem a marca da parcela).
 */
export function similarRuleKey(
  tx: Pick<FinTransaction, 'counterparty_doc_kind' | 'counterparty_doc_hash'>,
  name: string,
): string | null {
  if (tx.counterparty_doc_kind === 'CPF') return tx.counterparty_doc_hash ? `doc:${tx.counterparty_doc_hash}` : null;
  const text = similarText(name);
  return text ? `m:${text}` : null;
}

// Palavras do estorno que a compra não tem.
const REFUND_WORDS = new Set([
  'estornado', 'estornada', 'estornos', 'devolucao', 'devolvido', 'devolvida', 'reembolso', 'ressarcimento',
  'chargeback', 'cancelamento', 'cancelado', 'cancelada',
]);

/**
 * O miolo do nome, igual na compra e no estorno dela: sem números, palavras
 * genéricas ou do estorno, tudo junto ("COMPRA CARTAO LOJA X" e "Estorno de
 * compra LOJA X" -> "lojax").
 */
function storeCore(text: string): string {
  return normalizeBankText(text)
    .split(' ')
    .filter((w) => w && !/\d/.test(w) && !GENERIC.has(w) && !REFUND_WORDS.has(w))
    .join('');
}

/** Lojas e pessoas que a pessoa já pôs em Saúde (regras de parecidas e marcas), para os estornos sem par. */
export interface SaudeStores {
  docs: ReadonlySet<string>;
  cores: readonly string[];
}

export function saudeStores(rules: CategoryRules, sensitiveKeys: SensitiveKeys): SaudeStores {
  const keys = [...sensitiveKeys, ...[...rules].filter(([, category]) => category === 'saude').map(([key]) => key)];
  return {
    docs: new Set(keys.filter((key) => key.startsWith('doc:'))),
    cores: [...new Set(keys.filter((key) => key.startsWith('m:')).map((key) => storeCore(key.slice(2))))].filter(
      (core) => core.length >= 4,
    ),
  };
}

/**
 * O estorno que chegou sem a compra (ela ficou fora da janela) é de uma loja
 * ou pessoa posta em Saúde? Pelo CPF, ou pelo miolo do nome dos dois lados
 * (um contém o outro, como na ligação do estorno com a compra).
 */
export function refundOfSaudeStore(
  stores: SaudeStores,
  tx: Pick<FinTransaction, 'counterparty_doc_kind' | 'counterparty_doc_hash'>,
  name: string,
): boolean {
  if (tx.counterparty_doc_kind === 'CPF') {
    return !!tx.counterparty_doc_hash && stores.docs.has(`doc:${tx.counterparty_doc_hash}`);
  }
  const core = storeCore(name);
  return core.length >= 4 && stores.cores.some((c) => c.includes(core) || core.includes(c));
}

export type CategorySource = 'auto' | 'similar' | 'manual';

const keyList = (purchaseKeys: string | readonly string[]) => (typeof purchaseKeys === 'string' ? [purchaseKeys] : purchaseKeys);

/**
 * Categoria da compra: a escolhida para ela, a das parecidas ou a automática.
 * A compra parcelada passa as chaves de todas as parcelas vistas (a escolha
 * pode estar em qualquer uma); vale a da primeira que tiver escolha, e
 * `ruleKey` diz qual foi (null sem escolha só para ela).
 */
export function pickCategory(
  rules: CategoryRules,
  purchaseKeys: string | readonly string[],
  similarKey: string | null,
  auto: FinanceCategory,
): { category: FinanceCategory; source: CategorySource; ruleKey: string | null } {
  for (const key of keyList(purchaseKeys)) {
    const own = rules.get(purchaseRuleKey(key));
    if (own) return { category: own, source: 'manual', ruleKey: key };
  }
  const similar = similarKey ? rules.get(similarKey) : undefined;
  if (similar) return { category: similar, source: 'similar', ruleKey: null };
  return { category: auto, source: 'auto', ruleKey: null };
}

/** match_key que a pessoa já pôs em Saúde (fin_sensitive_keys). */
export type SensitiveKeys = ReadonlySet<string>;

export const NO_SENSITIVE_KEYS: SensitiveKeys = new Set();

/**
 * A pessoa pôs esta compra, ou as parecidas, em Saúde: ela só vai somada
 * para a IA, mesmo depois de trocar de categoria ou desfazer (a marca fica)
 * e mesmo com "Só esta" em outra categoria por cima das parecidas em Saúde.
 * Na compra parcelada, a escolha em qualquer parcela vale para todas.
 */
export function chosenSensitive(
  rules: CategoryRules,
  sensitiveKeys: SensitiveKeys,
  purchaseKeys: string | readonly string[],
  similarKey: string | null,
): boolean {
  return [...keyList(purchaseKeys).map(purchaseRuleKey), similarKey].some(
    (key) => key !== null && (rules.get(key) === 'saude' || sensitiveKeys.has(key)),
  );
}

/**
 * Escolhas de Saúde só para uma compra que ainda não marcaram as parecidas
 * dela (feitas antes de a regra levar similar_key, ou num app antigo). Enquanto
 * a compra está aqui, dá para gravar a regra de novo com a chave das parecidas.
 * Na compra parcelada, a escolha pode estar em qualquer parcela (`ruleKeys`).
 */
export function missingSimilarMarks(
  purchases: readonly { key: string; ruleKeys?: readonly string[]; similarKey: string | null }[],
  rules: CategoryRules,
  sensitiveKeys: SensitiveKeys,
): { matchKey: string; similarKey: string }[] {
  const missing = new Map<string, string>();
  for (const p of purchases) {
    if (!p.similarKey || sensitiveKeys.has(p.similarKey)) continue;
    for (const key of p.ruleKeys ?? [p.key]) {
      const matchKey = purchaseRuleKey(key);
      if (rules.get(matchKey) === 'saude') missing.set(matchKey, p.similarKey);
    }
  }
  return [...missing].map(([matchKey, similarKey]) => ({ matchKey, similarKey }));
}

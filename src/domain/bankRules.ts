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

// Palavras do estorno que a compra não tem; depois delas, o que só liga
// ("Estorno de compra LOJA X" -> "loja x").
const REFUND_WORDS = new Set([
  'estorno', 'estornado', 'estornada', 'estornos', 'devolucao', 'devolvido', 'devolvida', 'reembolso',
  'ressarcimento', 'chargeback', 'cancelamento', 'cancelado', 'cancelada',
]);
const REFUND_LEAD = new Set(['de', 'da', 'do', 'compra', 'pagamento', 'pix', 'credito', 'valor', 'ref', 'referente', 'parcial', 'total']);

/**
 * Chave das parecidas da compra que um estorno desfaz: a do estorno, sem as
 * palavras do estorno. Serve para o estorno herdar o sigilo da compra mesmo
 * sem achar o par dela.
 */
export function refundSimilarKey(
  tx: Pick<FinTransaction, 'counterparty_doc_kind' | 'counterparty_doc_hash'>,
  name: string,
): string | null {
  const words = normalizeBankText(name)
    .split(' ')
    .filter((w) => w && !REFUND_WORDS.has(w));
  while (words.length && REFUND_LEAD.has(words[0])) words.shift();
  return similarRuleKey(tx, words.join(' '));
}

export type CategorySource = 'auto' | 'similar' | 'manual';

/** Categoria da compra: a escolhida para ela, a das parecidas ou a automática. */
export function pickCategory(
  rules: CategoryRules,
  purchaseKey: string,
  similarKey: string | null,
  auto: FinanceCategory,
): { category: FinanceCategory; source: CategorySource } {
  const own = rules.get(purchaseRuleKey(purchaseKey));
  if (own) return { category: own, source: 'manual' };
  const similar = similarKey ? rules.get(similarKey) : undefined;
  if (similar) return { category: similar, source: 'similar' };
  return { category: auto, source: 'auto' };
}

/** match_key que a pessoa já pôs em Saúde (fin_sensitive_keys). */
export type SensitiveKeys = ReadonlySet<string>;

export const NO_SENSITIVE_KEYS: SensitiveKeys = new Set();

/**
 * A pessoa pôs esta compra, ou as parecidas, em Saúde: ela só vai somada
 * para a IA, mesmo depois de trocar de categoria ou desfazer (a marca fica)
 * e mesmo com "Só esta" em outra categoria por cima das parecidas em Saúde.
 */
export function chosenSensitive(
  rules: CategoryRules,
  sensitiveKeys: SensitiveKeys,
  purchaseKey: string,
  similarKey: string | null,
): boolean {
  return [purchaseRuleKey(purchaseKey), similarKey].some(
    (key) => key !== null && (rules.get(key) === 'saude' || sensitiveKeys.has(key)),
  );
}

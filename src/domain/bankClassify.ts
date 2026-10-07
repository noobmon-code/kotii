// Consultor financeiro (beta): o que cada lançamento do banco é. Só "spending"
// entra nas saídas do mês; dinheiro entre contas da própria pessoa, aplicação
// (cofrinho, caixinha, porquinho, poupança) e pagamento de fatura não são
// gasto: a compra já contou no cartão, na data da compra.

import type { FinAccount, FinTransaction } from '@/lib/types';

import { financeCategoryOfBank, hasAnyTerm, normalizeBankText } from './bankCategories';

export type BankKind = 'spending' | 'income' | 'internal' | 'investment' | 'card_payment' | 'financing' | 'refund';

/** O que a classificação usa do lançamento. */
export type BankClassifyInput = Pick<
  FinTransaction,
  'direction' | 'description' | 'category' | 'category_id' | 'counterparty_doc_hash' | 'other_credits_type'
> &
  Partial<
    Pick<
      FinTransaction,
      | 'description_raw'
      | 'operation_type'
      | 'merchant_name'
      | 'counterparty_name'
      | 'counterparty_doc_kind'
      | 'card_bill_id'
      | 'purchase_on'
      | 'installment_number'
      | 'bill_forecast'
    >
  >;

/** Hashes do CPF/CNPJ de quem tem as contas (o mesmo documento dá o mesmo hash). */
export function ownerHashes(accounts: Pick<FinAccount, 'owner_doc_hash'>[]): Set<string> {
  return new Set(accounts.flatMap((a) => (a.owner_doc_hash ? [a.owner_doc_hash] : [])));
}

// Crédito contratado no cartão (parcelar a fatura, rotativo, empréstimo): é dívida, não compra.
const FINANCING_CREDITS = new Set(['BILL_INSTALLMENT', 'REVOLVING_CREDIT', 'LOAN']);

const REFUND_TERMS = [
  'estorno*', 'estornad*', 'devolucao', 'devolucoes', 'devolvid*', 'reembolso*', 'ressarcimento', 'chargeback',
  'cancelamento', 'cashback',
];

// Guardar e resgatar dinheiro no próprio banco. Mercado Pago: cofrinho, "Dinheiro
// reservado", "Rendimentos"; Nubank: caixinha, RDB; Inter: porquinho, CDB;
// Santander: poupança, aplicação, resgate (ContaMax).
const INVESTMENT_TERMS = [
  'cofrinho*', 'dinheiro reservado', 'dinheiro retirado', 'rendimento*', 'caixinha*', 'rdb', 'dinheiro guardado',
  'dinheiro resgatado', 'porquinho*', 'cdb', 'lci', 'lca', 'poupanca*', 'aplicacao', 'aplicacoes', 'aplic',
  'aplicado', 'resgate*', 'resg', 'investimento*', 'invest', 'tesouro direto', 'contamax', 'previdencia',
];

const PLUGGY_INVESTMENT = new Set([
  'investments', 'automatic investment', 'fixed income', 'mutual funds', 'variable income', 'margin',
  'proceeds interests and dividends', 'pension',
]);

const PLUGGY_LOANS = new Set(['loans and financing', 'loans', 'financing']);

const LOAN_TERMS = ['emprestimo*', 'credito pessoal', 'consignado', 'financiamento*'];

// Pagamento da fatura visto da conta corrente ("PAGTO CARTAO CREDITO", "Pagamento de fatura").
const BILL_PAYMENT = [
  /\b(pagamento|pagto|pgto|pag|pg)( (de|da|do))? (fatura|fat)\b/,
  /\bfatura( (de|da|do))? (cartao|cartoes|credito|nubank|inter|santander|mercado ?pago|mp)\b/,
  /\b(pagamento|pagto|pgto|pag|pg)( (de|da|do))? (cartao|cartoes)( (de|do))? credito\b/,
];

// No cartão, entrada com "pagamento" é a fatura paga ("Pagamento recebido").
// "PAG" sozinho fica de fora: é prefixo de maquininha ("PAG*Loja").
const CARD_PAYMENT_WORDS = ['pagamento*', 'pagto', 'pgto', 'fatura'];

const isPluggy = (tx: BankClassifyInput, names: Set<string>, group: string) =>
  (tx.category != null && names.has(normalizeBankText(tx.category))) ||
  (tx.category_id != null && new RegExp(`^${group}\\d{6,7}$`).test(tx.category_id));

const isCardPaymentCategory = (tx: BankClassifyInput) =>
  (tx.category != null && normalizeBankText(tx.category) === 'credit card payment') || tx.category_id === '05100000';

const isSamePersonCategory = (tx: BankClassifyInput) =>
  (tx.category != null && normalizeBankText(tx.category).startsWith('same person transfer')) ||
  (tx.category_id != null && /^04\d{6}$/.test(tx.category_id));

/** Cartão sem a conta carregada: só cartão tem fatura, parcela e data da compra. */
function looksLikeCard(tx: BankClassifyInput): boolean {
  return Boolean(tx.card_bill_id || tx.purchase_on || tx.installment_number || tx.bill_forecast);
}

/**
 * Tipo do lançamento. No cartão: entrada é fatura paga ou estorno; saída é
 * compra (tarifa, IOF e juros também são gasto) ou dívida contratada. Na conta:
 * fatura do cartão, aplicação, transferência para si mesma (o documento do
 * outro lado é o da dona), e o resto é gasto (saída) ou entrada/estorno.
 */
export function classifyBankTransaction(
  tx: BankClassifyInput,
  account: Pick<FinAccount, 'type'> | null | undefined,
  ownerDocHashes: Iterable<string>,
): BankKind {
  const text = normalizeBankText(tx.description, tx.description_raw);
  const type = account?.type ?? (looksLikeCard(tx) ? 'CREDIT' : 'BANK');

  if (type === 'CREDIT') {
    if (tx.direction === 'CREDIT') {
      if (hasAnyTerm(text, REFUND_TERMS)) return 'refund';
      if (isCardPaymentCategory(tx) || hasAnyTerm(text, CARD_PAYMENT_WORDS)) return 'card_payment';
      return 'refund';
    }
    if (tx.other_credits_type && FINANCING_CREDITS.has(tx.other_credits_type)) return 'financing';
    if (/\bparcelamento( (de|da))? fatura\b/.test(text)) return 'financing';
    return 'spending';
  }

  // Conta de luz chamada de "fatura" não é cartão.
  if (isCardPaymentCategory(tx) || (BILL_PAYMENT.some((re) => re.test(text)) && financeCategoryOfBank(tx) !== 'contas')) {
    return 'card_payment';
  }
  if (
    isPluggy(tx, PLUGGY_INVESTMENT, '03') ||
    hasAnyTerm(text, INVESTMENT_TERMS) ||
    /APLIC|RESGATE|RENDIMENTO/.test((tx.operation_type ?? '').toUpperCase())
  ) {
    return 'investment';
  }
  const owners: ReadonlySet<string> = ownerDocHashes instanceof Set ? ownerDocHashes : new Set(ownerDocHashes);
  if ((tx.counterparty_doc_hash && owners.has(tx.counterparty_doc_hash)) || isSamePersonCategory(tx)) return 'internal';
  if (tx.direction === 'DEBIT') return 'spending';
  if (hasAnyTerm(text, REFUND_TERMS)) return 'refund';
  // Empréstimo que caiu na conta é dívida, não renda.
  if (isPluggy(tx, PLUGGY_LOANS, '02') || hasAnyTerm(text, LOAN_TERMS)) return 'financing';
  return 'income';
}

// Conta e lançamento da Pluggy -> linhas de fin_accounts e fin_transactions.
// Puro (sem rede nem banco), testado em map.test.ts.
//
// Privacidade: CPF nunca fica cru, só o hash (HMAC-SHA256 de
// `${pessoa}:${dígitos}` com o segredo FIN_DOC_HASH_KEY, que só a função
// tem: sem ele, não dá para testar os ~10^9 CPFs possíveis contra o hash), que
// basta para reconhecer transferência para si mesma (o mesmo hash do titular
// da conta). CPF escrito na descrição (PIX e TED costumam trazer) ou no nome
// (razão social de MEI antigo) sai antes de gravar. Da conta, só os 4 últimos
// dígitos do número. CNPJ é de empresa e fica cru, para casar com as notas.

import type { PluggyAccount, PluggyParticipant, PluggyTransaction } from '../_shared/pluggy.ts';

export type DocKind = 'CPF' | 'CNPJ';

export interface FinAccountRow {
  connection_id: string;
  user_id: string;
  household_id: string;
  pluggy_account_id: string;
  type: 'BANK' | 'CREDIT';
  subtype: string | null;
  name: string | null;
  marketing_name: string | null;
  number_last4: string | null;
  owner_doc_hash: string | null;
  balance: number | null;
  currency_code: string | null;
  credit_limit: number | null;
  available_credit: number | null;
  bill_due_date: string | null;
  bill_close_date: string | null;
  minimum_payment: number | null;
  updated_at: string;
}

export interface FinTransactionRow {
  account_id: string;
  user_id: string;
  household_id: string;
  pluggy_transaction_id: string;
  status: 'PENDING' | 'POSTED';
  direction: 'DEBIT' | 'CREDIT';
  amount: number;
  original_amount: number | null;
  original_currency: string | null;
  occurred_on: string;
  purchase_on: string | null;
  description: string;
  description_raw: string | null;
  category_id: string | null;
  category: string | null;
  operation_type: string | null;
  payment_method: string | null;
  merchant_name: string | null;
  merchant_cnpj: string | null;
  counterparty_name: string | null;
  counterparty_doc_kind: DocKind | null;
  counterparty_doc_hash: string | null;
  counterparty_cnpj: string | null;
  boleto_barcode: string | null;
  installment_number: number | null;
  total_installments: number | null;
  card_bill_id: string | null;
  bill_forecast: string | null;
  other_credits_type: string | null;
  fee_type: string | null;
  /** Sempre null: o que voltou da Pluggy está vivo (desfaz uma marca antiga). */
  deleted_at: null;
  updated_at: string;
}

/** De quem são as linhas; `now` (ISO) vira updated_at; `hashKey` é o segredo dos hashes de documento. */
export interface RowOwner {
  userId: string;
  householdId: string;
  now: string;
  hashKey: string;
}

const SAO_PAULO = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Dia (AAAA-MM-DD) do instante no fuso de São Paulo. */
export function saoPauloDate(date: Date): string {
  const parts = Object.fromEntries(SAO_PAULO.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Dia do calendário de uma data da Pluggy. Meia-noite UTC em ponto é data
 * sem hora (o dia que o banco informou); com hora, vale o dia em São Paulo
 * (uma compra às 22h do dia 30 chega como 01h UTC do dia 1º).
 */
export function calendarDate(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  const date = new Date(ms);
  const midnight =
    date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;
  return midnight ? date.toISOString().slice(0, 10) : saoPauloDate(date);
}

/** Soma dias a uma data AAAA-MM-DD. */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Valor em centavos para numeric(14,2); fora da faixa da coluna vira null. */
export function money(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = (Math.sign(value) * Math.round((Math.abs(value) + Number.EPSILON) * 100)) / 100;
  if (Math.abs(rounded) >= 1e12) return null;
  return rounded === 0 ? 0 : rounded;
}

export function digitsOnly(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\D/g, '') : '';
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value < 1e6 ? value : null;
}

const hmacKeys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = hmacKeys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    hmacKeys.set(secret, key);
  }
  return key;
}

/**
 * HMAC-SHA256 (hex) de `${userId}:${dígitos}` com o segredo: o mesmo
 * documento dá o mesmo hash para a mesma pessoa, e sem o segredo não dá para
 * descobrir o CPF testando todos.
 */
export async function docHash(secret: string, userId: string, digits: string): Promise<string> {
  const bytes = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(`${userId}:${digits}`));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// CPF escrito na descrição: "123.456.789-00", "12345678900", "CPF 123 456 789 00", "CPF 123..." ou
// "Cp :12345678-NOME" (Inter). Os 11 dígitos soltos podem encostar num hífen ou numa barra
// ("12345678900-JOAO", "PIX-12345678900", "FULANO/12345678900"), mas não continuar em mais
// números com eles ("12345678901-2", "0001-12345678900"), nem ficar no meio de uma linha de boleto.
const CPF_PATTERNS = [
  /\b(?:cpf|cp)\s*[:.]?\s*\d{3}[\s.\-]?\d{3}[\s.\-]?\d{3}[\s.\-]?\d{2}(?!\d)/gi,
  /\b(?:cpf|cp)\s*[:.]?\s*[\d.\-•*]*[\d•*]/gi,
  /(?<![\d.])\d{3}\.\d{3}\.\d{3}-\d{2}(?![\d])/g,
  /(?<![\d.])(?<!\d[\-/])\d{9}-?\d{2}(?!\d|[\-/]\d)/g,
];

/** Texto sem CPF: o documento de quem recebeu ou pagou não fica cru na tabela (descrição e nomes). */
export function withoutCpf(text: string | null): string | null {
  if (text === null) return null;
  const clean = CPF_PATTERNS.reduce((out, re) => out.replace(re, (match) => (/^c/i.test(match) ? 'CPF ***' : '***')), text);
  return clean.replace(/\s+/g, ' ').trim() || null;
}

const DOC_LENGTH: Record<DocKind, number> = { CPF: 11, CNPJ: 14 };

/**
 * Documento de quem recebeu ou pagou. Mascarado (*** no meio, comum no Open
 * Finance) fica só o tipo: hash de pedaço de CPF não reconhece ninguém.
 */
async function participantDoc(
  participant: PluggyParticipant | null | undefined,
  owner: Pick<RowOwner, 'userId' | 'hashKey'>,
): Promise<{ kind: DocKind | null; hash: string | null; cnpj: string | null }> {
  const document = participant?.documentNumber;
  const digits = digitsOnly(document?.value);
  const declared = document?.type === 'CPF' || document?.type === 'CNPJ' ? document.type : null;
  const kind: DocKind | null = declared ?? (digits.length === 11 ? 'CPF' : digits.length === 14 ? 'CNPJ' : null);
  if (!kind) return { kind: null, hash: null, cnpj: null };
  const complete = digits.length === DOC_LENGTH[kind];
  return {
    kind,
    hash: complete ? await docHash(owner.hashKey, owner.userId, digits) : null,
    cnpj: kind === 'CNPJ' && complete ? digits : null,
  };
}

export async function mapAccount(
  account: PluggyAccount,
  owner: RowOwner & { connectionId: string },
): Promise<FinAccountRow | null> {
  if (!account || typeof account.id !== 'string' || !account.id) return null;
  if (account.type !== 'BANK' && account.type !== 'CREDIT') return null;
  const credit = account.creditData ?? null;
  const number = digitsOnly(account.number);
  const taxNumber = digitsOnly(account.taxNumber);
  return {
    connection_id: owner.connectionId,
    user_id: owner.userId,
    household_id: owner.householdId,
    pluggy_account_id: account.id,
    type: account.type,
    subtype: text(account.subtype),
    name: text(account.name),
    marketing_name: text(account.marketingName),
    number_last4: number ? number.slice(-4) : null,
    owner_doc_hash: taxNumber.length === 11 || taxNumber.length === 14 ? await docHash(owner.hashKey, owner.userId, taxNumber) : null,
    balance: money(account.balance),
    currency_code: text(account.currencyCode),
    credit_limit: money(credit?.creditLimit),
    available_credit: money(credit?.availableCreditLimit),
    bill_due_date: calendarDate(credit?.balanceDueDate),
    bill_close_date: calendarDate(credit?.balanceCloseDate),
    minimum_payment: money(credit?.minimumPayment),
    updated_at: owner.now,
  };
}

/**
 * null quando o lançamento não tem o mínimo (id, data, valor) ou quando é em
 * outra moeda sem o valor convertido para a da conta (somar dólar como real
 * erraria o mês): fica de fora sem derrubar a conta.
 */
export async function mapTransaction(
  tx: PluggyTransaction,
  owner: RowOwner & { accountId: string; accountCurrency?: string | null },
): Promise<FinTransactionRow | null> {
  if (!tx || typeof tx.id !== 'string' || !tx.id) return null;
  const occurredOn = calendarDate(tx.date);
  const currency = text(tx.currencyCode);
  // A Pluggy só manda o valor convertido quando a moeda é outra que a da conta (R$).
  const foreign = currency !== null && currency !== (text(owner.accountCurrency) ?? 'BRL');
  const converted = typeof tx.amountInAccountCurrency === 'number' && Number.isFinite(tx.amountInAccountCurrency);
  if (foreign && !converted) return null;
  // Compra em moeda estrangeira: o valor que pesa é o convertido para a conta (R$).
  const value = converted ? tx.amountInAccountCurrency : tx.amount;
  const amount = money(typeof value === 'number' ? Math.abs(value) : null);
  if (!occurredOn || amount === null) return null;

  // Sem o tipo (não deveria faltar), o sinal decide: na conta, saída vem negativa.
  const direction = tx.type === 'DEBIT' || tx.type === 'CREDIT' ? tx.type : (value as number) < 0 ? 'DEBIT' : 'CREDIT';
  const payment = tx.paymentData ?? null;
  const card = tx.creditCardMetadata ?? null;
  // Na saída interessa quem recebeu; na entrada, quem pagou.
  const party = direction === 'DEBIT' ? payment?.receiver : payment?.payer;
  const doc = await participantDoc(party, owner);
  const merchantCnpj = digitsOnly(tx.merchant?.cnpj);
  const boleto = digitsOnly(payment?.boletoMetadata?.barcode) || digitsOnly(payment?.boletoMetadata?.digitableLine);

  return {
    account_id: owner.accountId,
    user_id: owner.userId,
    household_id: owner.householdId,
    pluggy_transaction_id: tx.id,
    status: tx.status === 'PENDING' ? 'PENDING' : 'POSTED',
    direction,
    amount,
    original_amount: foreign ? money(Math.abs(tx.amount)) : null,
    original_currency: foreign ? currency : null,
    occurred_on: occurredOn,
    purchase_on: calendarDate(card?.purchaseDate),
    description: withoutCpf(text(tx.description) ?? text(tx.descriptionRaw)) ?? 'Lançamento sem descrição',
    description_raw: withoutCpf(text(tx.descriptionRaw)),
    category_id: text(tx.categoryId),
    category: text(tx.category),
    operation_type: text(tx.operationType),
    payment_method: text(payment?.paymentMethod),
    // Razão social de MEI antigo traz o CPF do dono junto do nome ("MARIA SOUZA 12345678900").
    merchant_name: withoutCpf(text(tx.merchant?.name) ?? text(tx.merchant?.businessName)),
    merchant_cnpj: merchantCnpj.length === 14 ? merchantCnpj : null,
    counterparty_name: withoutCpf(text(party?.name)),
    counterparty_doc_kind: doc.kind,
    counterparty_doc_hash: doc.hash,
    counterparty_cnpj: doc.cnpj,
    boleto_barcode: boleto || null,
    installment_number: positiveInt(card?.installmentNumber),
    total_installments: positiveInt(card?.totalInstallments),
    card_bill_id: text(card?.billId),
    bill_forecast: text(card?.billForecastDate),
    other_credits_type: text(card?.otherCreditsType),
    fee_type: text(card?.feeType),
    deleted_at: null,
    updated_at: owner.now,
  };
}

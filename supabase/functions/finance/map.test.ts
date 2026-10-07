import { assert, assertEquals } from '@std/assert';

import type { PluggyAccount, PluggyTransaction } from '../_shared/pluggy.ts';
import { addDays, calendarDate, docHash, mapAccount, mapTransaction, money, saoPauloDate } from './map.ts';

const NOW = '2026-10-07T12:00:00.000Z';
const owner = { userId: 'user-1', householdId: 'casa-1', now: NOW };
const CPF = '12345678909';
const CPF_HASH = 'aaa6cf8967dcc98cf017d68d220ba29e1c0ea4fd94910c45e692152cf31e0fd5';
const CNPJ = '11222333000181';
const CNPJ_HASH = 'df5ce4c8a7a5d050d2f79e2ab70f42de87fa0f67a2d16710fb8cae97d34e5e64';

const tx = (overrides: Partial<PluggyTransaction> = {}): PluggyTransaction => ({
  id: 'tx-1',
  accountId: 'acc-1',
  date: '2026-10-03T15:20:00.000Z',
  description: 'Mercado Bom Preço',
  descriptionRaw: 'MERCADO BOM PRECO SP',
  type: 'DEBIT',
  amount: -123.45,
  amountInAccountCurrency: null,
  currencyCode: 'BRL',
  category: 'Groceries',
  categoryId: '05050000',
  status: 'POSTED',
  operationType: 'PIX',
  paymentData: null,
  creditCardMetadata: null,
  merchant: null,
  ...overrides,
});

const mapTx = (input: PluggyTransaction) => mapTransaction(input, { ...owner, accountId: 'conta-db-1' });

Deno.test('calendarDate: meia-noite UTC em ponto é a data informada; com hora, o dia em São Paulo', () => {
  assertEquals(calendarDate('2026-10-01T00:00:00.000Z'), '2026-10-01');
  assertEquals(calendarDate('2026-10-01T02:30:00.000Z'), '2026-09-30');
  assertEquals(calendarDate('2026-10-01T03:00:00.000Z'), '2026-10-01');
  assertEquals(calendarDate('2026-09-30T23:59:59.000Z'), '2026-09-30');
  // Virada de mês e de ano.
  assertEquals(calendarDate('2026-11-01T02:59:59.999Z'), '2026-10-31');
  assertEquals(calendarDate('2027-01-01T01:00:00.000Z'), '2026-12-31');
  assertEquals(calendarDate('2026-12-31T00:00:00.000Z'), '2026-12-31');
  assertEquals(calendarDate('2027-01-01T00:00:00.001Z'), '2026-12-31');
  // Com fuso no texto e data pura.
  assertEquals(calendarDate('2026-10-31T22:30:00-03:00'), '2026-10-31');
  assertEquals(calendarDate('2026-10-31'), '2026-10-31');
  assertEquals(calendarDate('ontem'), null);
  assertEquals(calendarDate(null), null);
});

Deno.test('saoPauloDate e addDays atravessam mês e ano', () => {
  assertEquals(saoPauloDate(new Date('2026-10-01T01:00:00Z')), '2026-09-30');
  assertEquals(addDays('2026-10-07', -60), '2026-08-08');
  assertEquals(addDays('2026-10-07', -365), '2025-10-07');
  assertEquals(addDays('2026-12-31', 1), '2027-01-01');
});

Deno.test('money arredonda em centavos e recusa o que não cabe na coluna', () => {
  assertEquals(money(1.005), 1.01);
  assertEquals(money(-10.555), -10.56);
  assertEquals(money(0.1 + 0.2), 0.3);
  assertEquals(money(-0.001), 0);
  assertEquals(money(1e12), null);
  assertEquals(money(Number.NaN), null);
  assertEquals(money('10'), null);
});

Deno.test('docHash: SHA-256 hex de pessoa:dígitos', async () => {
  assertEquals(await docHash('user-1', CPF), CPF_HASH);
  assertEquals(await docHash('user-2', CPF) === CPF_HASH, false);
});

Deno.test('lançamento simples: valor absoluto, data, descrição e categoria', async () => {
  assertEquals(await mapTx(tx()), {
    account_id: 'conta-db-1',
    user_id: 'user-1',
    household_id: 'casa-1',
    pluggy_transaction_id: 'tx-1',
    status: 'POSTED',
    direction: 'DEBIT',
    amount: 123.45,
    original_amount: null,
    original_currency: null,
    occurred_on: '2026-10-03',
    purchase_on: null,
    description: 'Mercado Bom Preço',
    description_raw: 'MERCADO BOM PRECO SP',
    category_id: '05050000',
    category: 'Groceries',
    operation_type: 'PIX',
    payment_method: null,
    merchant_name: null,
    merchant_cnpj: null,
    counterparty_name: null,
    counterparty_doc_kind: null,
    counterparty_doc_hash: null,
    counterparty_cnpj: null,
    boleto_barcode: null,
    installment_number: null,
    total_installments: null,
    card_bill_id: null,
    bill_forecast: null,
    other_credits_type: null,
    fee_type: null,
    deleted_at: null,
    updated_at: NOW,
  });
});

Deno.test('compra em moeda estrangeira: vale o valor em reais e guarda o original', async () => {
  const row = await mapTx(tx({ amount: 25.5, amountInAccountCurrency: 141.236, currencyCode: 'USD' }));
  assertEquals([row?.amount, row?.original_amount, row?.original_currency], [141.24, 25.5, 'USD']);
});

Deno.test('previsto, entrada e lançamento sem tipo', async () => {
  assertEquals((await mapTx(tx({ status: 'PENDING' })))?.status, 'PENDING');
  assertEquals((await mapTx(tx({ status: null })))?.status, 'POSTED');
  const income = await mapTx(tx({ type: 'CREDIT', amount: 5000 }));
  assertEquals([income?.direction, income?.amount], ['CREDIT', 5000]);
  assertEquals((await mapTx(tx({ type: null, amount: -10 })))?.direction, 'DEBIT');
  assertEquals((await mapTx(tx({ type: null, amount: 10 })))?.direction, 'CREDIT');
});

Deno.test('cartão parcelado: data da compra, parcela, fatura e tipos de crédito/tarifa', async () => {
  const row = await mapTx(
    tx({
      date: '2026-10-10T00:00:00.000Z',
      amount: 100,
      creditCardMetadata: {
        installmentNumber: 3,
        totalInstallments: 10,
        purchaseDate: '2026-08-01T01:30:00.000Z',
        billId: 'bill-9',
        billForecastDate: '2026-11',
        otherCreditsType: 'BILL_INSTALLMENT',
        feeType: 'ANNUAL_FEE',
      },
    }),
  );
  assertEquals(row?.occurred_on, '2026-10-10');
  // 01h30 UTC do dia 1º ainda é dia 31 em São Paulo.
  assertEquals(row?.purchase_on, '2026-07-31');
  assertEquals([row?.installment_number, row?.total_installments], [3, 10]);
  assertEquals([row?.card_bill_id, row?.bill_forecast], ['bill-9', '2026-11']);
  assertEquals([row?.other_credits_type, row?.fee_type], ['BILL_INSTALLMENT', 'ANNUAL_FEE']);
  const odd = await mapTx(tx({ creditCardMetadata: { installmentNumber: 0, totalInstallments: 2.5 } }));
  assertEquals([odd?.installment_number, odd?.total_installments], [null, null]);
});

Deno.test('PIX para pessoa: CPF só como hash, nunca cru; nome fica (tabela privada)', async () => {
  const row = await mapTx(
    tx({
      paymentData: {
        paymentMethod: 'PIX',
        payer: { name: 'Eu Mesma', documentNumber: { type: 'CPF', value: '999.888.777-66' } },
        receiver: { name: 'Fulana de Tal', documentNumber: { type: 'CPF', value: '123.456.789-09' } },
      },
    }),
  );
  assertEquals(row?.counterparty_name, 'Fulana de Tal');
  assertEquals(row?.counterparty_doc_kind, 'CPF');
  assertEquals(row?.counterparty_doc_hash, CPF_HASH);
  assertEquals(row?.counterparty_cnpj, null);
  assertEquals(row?.payment_method, 'PIX');
  const stored = JSON.stringify(row);
  assert(!stored.includes(CPF) && !stored.includes('123.456.789-09') && !stored.includes('99988877766'));
});

Deno.test('entrada vinda de empresa: quem pagou, com CNPJ cru e hash', async () => {
  const row = await mapTx(
    tx({
      type: 'CREDIT',
      amount: 3000,
      paymentData: {
        payer: { name: 'Empresa X Ltda', documentNumber: { type: 'CNPJ', value: '11.222.333/0001-81' } },
        receiver: { name: 'Eu', documentNumber: { type: 'CPF', value: CPF } },
      },
    }),
  );
  assertEquals(
    [row?.counterparty_name, row?.counterparty_doc_kind, row?.counterparty_cnpj, row?.counterparty_doc_hash],
    ['Empresa X Ltda', 'CNPJ', CNPJ, CNPJ_HASH],
  );
});

Deno.test('documento mascarado ou sem tipo: só o tipo quando dá para saber, sem hash de pedaço', async () => {
  const masked = await mapTx(tx({ paymentData: { receiver: { documentNumber: { type: 'CPF', value: '***.456.789-**' } } } }));
  assertEquals([masked?.counterparty_doc_kind, masked?.counterparty_doc_hash, masked?.counterparty_cnpj], ['CPF', null, null]);
  const untyped = await mapTx(tx({ paymentData: { receiver: { documentNumber: { value: CPF } } } }));
  assertEquals([untyped?.counterparty_doc_kind, untyped?.counterparty_doc_hash], ['CPF', CPF_HASH]);
  const unknown = await mapTx(tx({ paymentData: { receiver: { documentNumber: { value: '123' } } } }));
  assertEquals(unknown?.counterparty_doc_kind, null);
});

Deno.test('estabelecimento (CNPJ só com 14 dígitos) e boleto (só dígitos)', async () => {
  const row = await mapTx(
    tx({
      merchant: { name: 'Padaria Pão Quente', businessName: 'PAO QUENTE LTDA', cnpj: '11.222.333/0001-81' },
      paymentData: { boletoMetadata: { barcode: null, digitableLine: '23793.38128 60000.000003 00000.000400 1 84340000012345' } },
    }),
  );
  assertEquals([row?.merchant_name, row?.merchant_cnpj], ['Padaria Pão Quente', CNPJ]);
  assertEquals(row?.boleto_barcode, '23793381286000000000300000000400184340000012345');
  const legal = await mapTx(tx({ merchant: { businessName: 'PAO QUENTE LTDA', cnpj: '123' } }));
  assertEquals([legal?.merchant_name, legal?.merchant_cnpj], ['PAO QUENTE LTDA', null]);
});

Deno.test('lançamento sem id, data ou valor fica de fora', async () => {
  assertEquals(await mapTx(tx({ id: '' })), null);
  assertEquals(await mapTx(tx({ date: 'quando?' })), null);
  assertEquals(await mapTx(tx({ amount: Number.NaN })), null);
  assertEquals((await mapTx(tx({ description: '  ', descriptionRaw: null })))?.description, 'Lançamento sem descrição');
});

const account = (overrides: Partial<PluggyAccount> = {}): PluggyAccount => ({
  id: 'pluggy-acc-1',
  itemId: 'item-1',
  type: 'BANK',
  subtype: 'CHECKING_ACCOUNT',
  number: '0001/12345-6',
  balance: 1520.333,
  name: 'Conta Corrente',
  marketingName: 'NuConta',
  taxNumber: '123.456.789-09',
  currencyCode: 'BRL',
  creditData: null,
  ...overrides,
});

const mapAcc = (input: PluggyAccount) => mapAccount(input, { ...owner, connectionId: 'conexao-1' });

Deno.test('conta: só os 4 últimos dígitos e o hash do titular (o mesmo do PIX para si mesma)', async () => {
  assertEquals(await mapAcc(account()), {
    connection_id: 'conexao-1',
    user_id: 'user-1',
    household_id: 'casa-1',
    pluggy_account_id: 'pluggy-acc-1',
    type: 'BANK',
    subtype: 'CHECKING_ACCOUNT',
    name: 'Conta Corrente',
    marketing_name: 'NuConta',
    number_last4: '3456',
    owner_doc_hash: CPF_HASH,
    balance: 1520.33,
    currency_code: 'BRL',
    credit_limit: null,
    available_credit: null,
    bill_due_date: null,
    bill_close_date: null,
    minimum_payment: null,
    updated_at: NOW,
  });
  const noDoc = await mapAcc(account({ number: null, taxNumber: '***.456.789-**' }));
  assertEquals([noDoc?.number_last4, noDoc?.owner_doc_hash], [null, null]);
});

Deno.test('cartão: limite, disponível, vencimento, fechamento e mínimo da fatura', async () => {
  const row = await mapAcc(
    account({
      type: 'CREDIT',
      subtype: 'CREDIT_CARD',
      number: '5502',
      balance: 2345.67,
      creditData: {
        creditLimit: 10000,
        availableCreditLimit: 7654.33,
        balanceDueDate: '2026-10-15T00:00:00.000Z',
        balanceCloseDate: '2026-10-08T03:00:00.000Z',
        minimumPayment: 351.85,
      },
    }),
  );
  assertEquals(
    [row?.type, row?.number_last4, row?.balance, row?.credit_limit, row?.available_credit],
    ['CREDIT', '5502', 2345.67, 10000, 7654.33],
  );
  assertEquals([row?.bill_due_date, row?.bill_close_date, row?.minimum_payment], ['2026-10-15', '2026-10-08', 351.85]);
});

Deno.test('conta de tipo desconhecido fica de fora', async () => {
  assertEquals(await mapAcc(account({ type: 'INVESTMENT' })), null);
  assertEquals(await mapAcc(account({ id: '' })), null);
});

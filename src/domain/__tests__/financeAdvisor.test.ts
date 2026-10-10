import { describe, expect, it } from '@jest/globals';

import type { FinAccount, FinConnection, FinTransaction } from '@/lib/types';

import type { BankPurchase } from '../bankMonth';
import {
  buildFinanceSnapshot,
  dayLabel,
  describeFinanceAction,
  FINANCE_SUGGESTIONS,
  type FinanceSnapshotInput,
  financeHistoryForApi,
  parseFinanceActions,
  purchaseLabel,
  scrubText,
  SNAPSHOT_MAX_CHARS,
} from '../financeAdvisor';

const OWNER = 'a'.repeat(64);
const STRANGER = 'b'.repeat(64);
const CNPJ = '12345678000199';

const connection = (over: Partial<FinConnection>): FinConnection => ({
  id: 'conn-nu',
  label: 'Nubank',
  pluggy_item_id: '00000000-0000-0000-0000-000000000001',
  status: 'UPDATED',
  error_message: null,
  item_updated_at: '2026-10-07T06:00:00Z',
  last_synced_at: '2026-10-07T14:00:00Z',
  created_at: '2026-10-01T00:00:00Z',
  ...over,
});

const account = (over: Partial<FinAccount>): FinAccount => ({
  id: 'nu-conta',
  connection_id: 'conn-nu',
  pluggy_account_id: `p-${over.id ?? 'nu-conta'}`,
  type: 'BANK',
  subtype: 'CHECKING_ACCOUNT',
  name: null,
  marketing_name: null,
  number_last4: '6789',
  owner_doc_hash: OWNER,
  balance: null,
  currency_code: 'BRL',
  credit_limit: null,
  available_credit: null,
  bill_due_date: null,
  bill_close_date: null,
  minimum_payment: null,
  // A sincronização grava as contas que vieram com a mesma hora de last_synced_at.
  updated_at: '2026-10-07T14:00:00Z',
  ...over,
});

let seq = 0;
const tx = (over: Partial<FinTransaction>): FinTransaction => {
  seq += 1;
  return {
    id: `t${seq}`,
    account_id: 'nu-conta',
    pluggy_transaction_id: `p${seq}`,
    status: 'POSTED',
    direction: 'DEBIT',
    amount: 10,
    original_amount: null,
    original_currency: null,
    occurred_on: '2026-10-05',
    purchase_on: null,
    description: 'COMPRA',
    description_raw: null,
    category_id: null,
    category: null,
    operation_type: null,
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
    first_seen_at: '2026-10-05T12:00:00Z',
    updated_at: '2026-10-05T12:00:00Z',
    ...over,
  };
};

const card = 'nu-cartao';

const input: FinanceSnapshotInput = {
  today: '2026-10-07',
  now: new Date('2026-10-07T15:00:00Z'),
  connections: [
    connection({}),
    connection({ id: 'conn-inter', label: 'Inter', pluggy_item_id: 'x2', item_updated_at: '2026-10-02T10:00:00Z' }),
  ],
  accounts: [
    account({ balance: 1234.56 }),
    account({
      id: card,
      type: 'CREDIT',
      subtype: 'CREDIT_CARD',
      balance: 2300,
      bill_due_date: '2026-10-10',
      bill_close_date: '2026-10-03',
      minimum_payment: 345,
      credit_limit: 6000,
      available_credit: 4000,
    }),
    account({ id: 'inter-conta', connection_id: 'conn-inter', balance: 50 }),
  ],
  transactions: [
    tx({ account_id: card, amount: 250, description: 'SUPERMERCADO GUANABARA', category: 'Groceries', occurred_on: '2026-10-04', purchase_on: '2026-10-04', merchant_cnpj: CNPJ }),
    tx({ account_id: card, amount: 89.9, description: 'DROGASIL 1234', category: 'Pharmacy', occurred_on: '2026-10-03' }),
    tx({ amount: 100, description: 'Pix enviado - IGREJA BATISTA CENTRAL', counterparty_name: 'Igreja Batista Central', counterparty_doc_kind: 'CNPJ', counterparty_cnpj: '98765432000110', occurred_on: '2026-10-02' }),
    tx({
      amount: 300,
      description: 'Transferência enviada pelo Pix - MARIA DA SILVA - •••.123.456-•• - NU PAGAMENTOS - IP (0260) Agência: 1 Conta: 12345678-9',
      counterparty_name: 'MARIA DA SILVA',
      counterparty_doc_kind: 'CPF',
      counterparty_doc_hash: STRANGER,
    }),
    tx({ amount: 500, description: 'Pix enviado', counterparty_doc_hash: OWNER }),
    tx({ account_id: 'inter-conta', amount: 500, direction: 'CREDIT', description: 'Pix recebido', counterparty_doc_hash: OWNER }),
    tx({ amount: 2000, description: 'Pagamento de fatura', occurred_on: '2026-10-06' }),
    tx({ account_id: card, amount: 150, description: 'MAGALU 01/10', installment_number: 1, total_installments: 10, purchase_on: '2026-09-01', occurred_on: '2026-09-01' }),
    tx({ account_id: card, amount: 150, description: 'MAGALU 02/10', installment_number: 2, total_installments: 10, purchase_on: '2026-09-01', occurred_on: '2026-10-01' }),
    tx({ amount: 5000, direction: 'CREDIT', description: 'Salário EMPRESA X', category: 'Salary' }),
    tx({ account_id: card, amount: 60, description: 'UBER *TRIP', status: 'PENDING', occurred_on: '2026-10-06' }),
    tx({ account_id: card, amount: 35, description: 'MERCADOPAGO*PADARIAREAL', occurred_on: '2026-10-01' }),
    tx({ amount: 40, description: 'PIX ENVIADO JOAO PEREIRA' }),
    tx({ account_id: card, amount: 400, description: 'SUPERMERCADO BOM', category: 'Groceries', occurred_on: '2026-09-03' }),
    tx({ account_id: card, amount: 300, description: 'SUPERMERCADO BOM', category: 'Groceries', occurred_on: '2026-08-10' }),
    tx({ amount: 999, description: 'APAGADO', deleted_at: '2026-10-06T00:00:00Z' }),
  ],
  budgets: [{ category: 'mercado', monthly_limit: 1200 }],
  kotiiRecords: [{ kind: 'nota', id: 'n1', amount: 250, date: '2026-10-04', label: 'Guanabara', cnpj: CNPJ }],
};

describe('buildFinanceSnapshot', () => {
  const text = buildFinanceSnapshot(input);

  it('resume o mês pela data da compra (da parcelada, só a parcela do mês), sem transferências, aplicação nem fatura paga', () => {
    expect(text).toContain('Hoje: quarta, 7/10/2026. Mês atual: outubro de 2026.');
    expect(text).toContain(
      'No banco em outubro de 2026 (pela data da compra; de compra parcelada, só a parcela do mês): saídas R$ 1.024,90 em 8 lançamentos (R$ 60,00 ainda previsto, pendente no banco); entradas R$ 5.000,00; estornos R$ 0,00 (já abatidos das saídas).',
    );
    expect(text).toContain(
      'Saídas por categoria em outubro de 2026: Mercado: R$ 250,00 de R$ 1.200,00 · faltam R$ 950,00; Outros: R$ 475,00 (sem orçamento); Compras: R$ 150,00 (sem orçamento); Saúde: R$ 89,90 (sem orçamento); Transporte: R$ 60,00 (sem orçamento).',
    );
  });

  it('compara com o mesmo período e com os dois meses anteriores', () => {
    expect(text).toContain('Até hoje: saídas R$ 1.024,90; em setembro até o dia 7: R$ 550,00 (R$ 474,90 a mais agora).');
    expect(text).toContain(
      'Meses anteriores inteiros: setembro de 2026: saídas R$ 550,00, entradas R$ 0,00 (maiores: Mercado R$ 400,00, Compras R$ 150,00); agosto de 2026: saídas R$ 300,00, entradas R$ 0,00 (maiores: Mercado R$ 300,00).',
    );
  });

  it('traz saldos, faturas, parcelas comprometidas, avisos e a conferência com o Kotii', () => {
    expect(text).toContain('Bancos conectados: Nubank (atualizado em 07/10); Inter (atualizado em 02/10).');
    expect(text).toContain('Avisos dos bancos: Inter sem atualizar há 5 dias. Reautorize no MeuPluggy.');
    expect(text).toContain('Saldos das contas: Nubank conta: R$ 1.234,56; Inter conta: R$ 50,00.');
    expect(text).toContain(
      'Cartões: Nubank cartão: limite usado R$ 2.300,00 (fatura aberta mais parcelas a vencer), vence sábado, 10/10, fecha sábado, 3/10, mínimo R$ 345,00, limite disponível R$ 4.000,00.',
    );
    // A Magalu entra uma vez por mês (não uma vez por parcela já vista), com o total pronto.
    expect(text).toContain(
      'Parcelas já comprometidas: novembro de 2026 R$ 150,00 (1 parcela); dezembro de 2026 R$ 150,00 (1 parcela); janeiro de 2027 R$ 150,00 (1 parcela); fevereiro de 2027 R$ 150,00 (1 parcela); março de 2027 R$ 150,00 (1 parcela); no total, R$ 1.200,00 em 8 parcelas até junho de 2027.',
    );
    expect(text).toContain(
      'Conferência de outubro de 2026 com o Kotii: R$ 250,00 em 1 lançamento já no Kotii (notas, contas ou gastos; a nota de uma compra parcelada vale para cada parcela); R$ 774,90 em 7 lançamentos só no banco.',
    );
  });

  it('lista os lançamentos recentes com apelidos, sem os sensíveis; a parcela no mês dela, com a compra ao lado', () => {
    const recent = text.slice(text.indexOf('Lançamentos recentes')).split('\n').slice(1);
    expect(recent).toEqual([
      't1 terça, 6/10 · saída · Transporte · UBER TRIP · R$ 60,00 · Nubank cartão · previsto',
      't2 segunda, 5/10 · entrada · Salário · R$ 5.000,00 · Nubank conta',
      't3 segunda, 5/10 · saída · Outros · PIX para pessoa física · R$ 300,00 · Nubank conta',
      't4 segunda, 5/10 · saída · Outros · PIX enviado · R$ 40,00 · Nubank conta',
      't5 domingo, 4/10 · saída · Mercado · SUPERMERCADO GUANABARA · R$ 250,00 · Nubank cartão',
      't6 quinta, 1/10 · saída · Compras · MAGALU · R$ 150,00 · Nubank cartão · parcela 2 de 10 de uma compra de R$ 1.500,00 (a 1ª em terça, 1/9)',
      // Depois do "*" da maquininha pode vir o nome de quem vende: sem categoria de loja, fica genérico.
      't7 quinta, 1/10 · saída · Outros · Pagamento · R$ 35,00 · Nubank cartão',
      't8 quinta, 3/9 · saída · Mercado · SUPERMERCADO BOM · R$ 400,00 · Nubank cartão',
      't9 terça, 1/9 · saída · Compras · MAGALU · R$ 150,00 · Nubank cartão · parcela 1 de 10 de uma compra de R$ 1.500,00 (a 1ª em terça, 1/9)',
      't10 segunda, 10/8 · saída · Mercado · SUPERMERCADO BOM · R$ 300,00 · Nubank cartão',
    ]);
  });

  it('compra parcelada de antes da janela: cada parcela no mês dela, casada com a nota da compra', () => {
    const store = '11222333000144';
    const loja = (n: number, day: string) =>
      tx({
        account_id: card,
        amount: 100,
        description: `LOJA M ${String(n).padStart(2, '0')}/10`,
        merchant_cnpj: store,
        installment_number: n,
        total_installments: 10,
        purchase_on: '2026-05-02',
        occurred_on: day,
      });
    const snapshot = buildFinanceSnapshot({
      ...input,
      transactions: [...input.transactions, loja(4, '2026-08-02'), loja(5, '2026-09-02'), loja(6, '2026-10-02')],
      kotiiRecords: [...input.kotiiRecords, { kind: 'nota', id: 'n2', amount: 1000, date: '2026-05-02', label: 'Loja M', cnpj: store }],
    });
    expect(snapshot).toContain('R$ 350,00 em 2 lançamentos já no Kotii');
    expect(snapshot).toContain('· LOJA M · R$ 100,00 · Nubank cartão · parcela 6 de 10 de uma compra de R$ 1.000,00 (a 1ª em sábado, 2/5)');
    expect(snapshot).toContain('novembro de 2026 R$ 250,00 (2 parcelas)');
  });

  it('parcela com a data da compra estimada sai só com o mês; tarifa em parcelas é cobrança, não compra', () => {
    const eletro = (n: number, day: string) =>
      tx({ account_id: card, amount: 200, description: `LOJA ELETRO ${n}/18`, installment_number: n, total_installments: 18, occurred_on: day });
    const fee = (n: number, day: string) =>
      tx({ account_id: card, amount: 55, description: `ANUIDADE DIFERENCIADA ${String(n).padStart(2, '0')}/12`, installment_number: n, total_installments: 12, purchase_on: day, occurred_on: day });
    const snapshot = buildFinanceSnapshot({
      ...input,
      transactions: [
        eletro(14, '2026-08-05'),
        eletro(15, '2026-09-05'),
        eletro(16, '2026-10-05'),
        fee(5, '2026-08-02'),
        fee(6, '2026-09-02'),
        fee(7, '2026-10-02'),
      ],
    });
    expect(snapshot).toContain('· R$ 200,00 · Nubank cartão · parcela 16 de 18 de uma compra de R$ 3.600,00 (a 1ª por volta de julho de 2025)');
    expect(snapshot).toContain('· R$ 55,00 · Nubank cartão · parcela 7 de 12 de uma cobrança de R$ 660,00 (a 1ª por volta de abril de 2026)');
  });

  it('a parcela deste mês que o banco ainda não lançou aparece no comprometido', () => {
    const snapshot = buildFinanceSnapshot({
      ...input,
      transactions: [
        tx({ account_id: card, amount: 40, description: 'LOJA B 01/03', installment_number: 1, total_installments: 3, purchase_on: '2026-09-20', occurred_on: '2026-09-20' }),
      ],
    });
    expect(snapshot).toContain(
      'Parcelas já comprometidas: outubro de 2026 R$ 40,00 (1 parcela ainda não lançada); novembro de 2026 R$ 40,00 (1 parcela); no total, R$ 80,00 em 2 parcelas até novembro de 2026.',
    );
  });

  it('compra parcelada posta em Saúde numa parcela some de todas e do estorno dela, e fica só somada', () => {
    const clinic = (n: number, day: string) =>
      tx({
        account_id: card,
        amount: 300,
        description: `ESPACO VIVER BEM ${String(n).padStart(2, '0')}/05`,
        merchant_name: 'Espaco Viver Bem Ltda',
        installment_number: n,
        total_installments: 5,
        purchase_on: '2026-08-20',
        occurred_on: day,
      });
    const first = clinic(1, '2026-08-20');
    const second = clinic(2, '2026-09-20');
    const refund = tx({ account_id: card, amount: 1500, direction: 'CREDIT', description: 'ESTORNO ESPACO VIVER BEM', occurred_on: '2026-10-05' });
    const withClinic = { ...input, transactions: [...input.transactions, first, second, refund] };
    // Sem a escolha, as parcelas e o estorno iriam com o nome da loja.
    expect(buildFinanceSnapshot(withClinic)).toMatch(/viver bem/i);
    const chosen = buildFinanceSnapshot({ ...withClinic, categoryRules: [{ match_key: `p:parc-${second.id}`, category: 'saude' as const }] });
    expect(chosen).not.toMatch(/espaco|viver bem/i);
    // Estornada por inteiro: as parcelas não contam em agosto nem em setembro, e nada dela fica comprometido.
    expect(chosen).toContain('agosto de 2026: saídas R$ 300,00');
    expect(chosen).toContain('Parcelas já comprometidas: novembro de 2026 R$ 150,00 (1 parcela);');
  });

  it('não manda CPF, conta, nome de pessoa nem loja de saúde ou religião', () => {
    expect(text).not.toMatch(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/);
    expect(text).not.toMatch(/\d{5,}/);
    for (const secret of ['MARIA', 'SILVA', 'JOAO', 'PEREIRA', 'DROGASIL', 'IGREJA', 'Igreja', 'BATISTA', '123.456', '0260', '6789', 'APAGADO']) {
      expect([secret, text.includes(secret)]).toEqual([secret, false]);
    }
    expect(text.length).toBeLessThanOrEqual(SNAPSHOT_MAX_CHARS);
  });

  it('compra que a pessoa já pôs em Saúde vai só somada, mesmo depois de trocar de categoria', () => {
    const withClinic = {
      ...input,
      transactions: [
        ...input.transactions,
        tx({ account_id: card, amount: 120, description: 'ESPACO VIVER BEM LTDA', merchant_name: 'Espaco Viver Bem Ltda', occurred_on: '2026-10-05' }),
      ],
      categoryRules: [{ match_key: 'm:espaco viver bem ltda', category: 'lazer' as const }],
    };
    // Sem a marca, a compra em Lazer iria com o nome da loja.
    expect(buildFinanceSnapshot(withClinic)).toMatch(/Lazer · Espaco Viver Bem Ltda · R\$ 120,00/i);
    const marked = buildFinanceSnapshot({ ...withClinic, sensitiveKeys: ['m:espaco viver bem ltda'] });
    expect(marked).not.toMatch(/espaco|viver bem/i);
    // Continua somada na categoria.
    expect(marked).toContain('Lazer: R$ 120,00');
  });

  it('o estorno de uma compra posta em Saúde também não leva o nome da loja', () => {
    const clinic = tx({ account_id: card, amount: 120, description: 'ESPACO VIVER BEM LTDA', merchant_name: 'Espaco Viver Bem Ltda', occurred_on: '2026-10-03' });
    const refund = tx({ account_id: card, amount: 120, direction: 'CREDIT', description: 'ESTORNO ESPACO VIVER BEM LTDA', occurred_on: '2026-10-05' });
    // Sem a marca, a compra e o estorno iriam com o nome.
    expect(buildFinanceSnapshot({ ...input, transactions: [...input.transactions, clinic, refund] })).toMatch(/viver bem/i);
    const marks = { sensitiveKeys: ['m:espaco viver bem ltda'] };
    expect(buildFinanceSnapshot({ ...input, ...marks, transactions: [...input.transactions, clinic, refund] })).not.toMatch(/espaco|viver bem/i);
    // A compra ficou de fora: o estorno sozinho também não leva.
    expect(buildFinanceSnapshot({ ...input, ...marks, transactions: [...input.transactions, refund] })).not.toMatch(/espaco|viver bem/i);
  });

  it('com muitos lançamentos, mostra só 15 e cabe no limite', () => {
    const many = Array.from({ length: 300 }, (_, i) =>
      tx({ account_id: card, amount: 10 + i, description: `LOJA ${'X'.repeat(80)} ${i}`, occurred_on: '2026-10-05' }),
    );
    const big = buildFinanceSnapshot({ ...input, transactions: many });
    expect(big.length).toBeLessThanOrEqual(SNAPSHOT_MAX_CHARS);
    expect(big).toContain('\nt15 ');
    expect(big).not.toContain('\nt16 ');
  });

  it('com bancos demais, corta numa linha inteira dentro do limite', () => {
    const connections = Array.from({ length: 60 }, (_, i) =>
      connection({ id: `c${i}`, label: `Banco com um nome bem comprido ${i}`, item_updated_at: '2026-09-01T00:00:00Z' }),
    );
    const accounts = connections.flatMap((c) => [
      account({ id: `${c.id}-conta`, connection_id: c.id, balance: 100 }),
      account({ id: `${c.id}-cartao`, connection_id: c.id, type: 'CREDIT', balance: 900, bill_due_date: '2026-10-20', minimum_payment: 90 }),
    ]);
    const big = buildFinanceSnapshot({ ...input, connections, accounts, transactions: [] });
    expect(big.length).toBeLessThanOrEqual(SNAPSHOT_MAX_CHARS);
    expect(big.startsWith('Hoje: quarta, 7/10/2026.')).toBe(true);
  });

  it('do rótulo digitado do banco vai só o nome da instituição', () => {
    const labelled = buildFinanceSnapshot({ ...input, connections: [connection({ label: 'Nubank 12345-6' })], transactions: [] });
    expect(labelled).toContain('Bancos conectados: Nubank (atualizado em 07/10).');
    expect(labelled).toContain('Saldos das contas: Nubank conta: R$ 1.234,56; Banco conta: R$ 50,00.');
    expect(labelled).not.toContain('12345');
  });

  it('rótulo com nome de pessoa vira "Banco 1", "Banco 2" no retrato todo (contas, cartões, avisos e lançamentos)', () => {
    const named = buildFinanceSnapshot({
      ...input,
      connections: [
        connection({ label: 'Conta da Maria', item_updated_at: '2026-10-01T10:00:00Z' }),
        connection({ id: 'conn-inter', label: 'Cartão do Zé Ruela', pluggy_item_id: 'x2', created_at: '2026-10-02T00:00:00Z' }),
      ],
    });
    expect(named).toContain('Bancos conectados: Banco 1 (atualizado em 01/10); Banco 2 (atualizado em 07/10).');
    expect(named).toContain('Avisos dos bancos: Banco 1 sem atualizar há 6 dias. Reautorize no MeuPluggy.');
    expect(named).toContain('Saldos das contas: Banco 1 conta: R$ 1.234,56; Banco 2 conta: R$ 50,00.');
    expect(named).toContain('Cartões: Banco 1 cartão: limite usado R$ 2.300,00');
    expect(named).toContain('t1 terça, 6/10 · saída · Transporte · UBER TRIP · R$ 60,00 · Banco 1 cartão · previsto');
    for (const secret of ['Maria', 'Conta da', 'Zé', 'Ruela']) {
      expect([secret, named.includes(secret)]).toEqual([secret, false]);
    }
  });

  it('rótulo com o banco e mais coisa vira o nome da instituição (sem acento no rótulo também)', () => {
    const known = buildFinanceSnapshot({
      ...input,
      connections: [
        connection({ label: 'nubank pessoal' }),
        connection({ id: 'conn-inter', label: 'Itau da Maria', pluggy_item_id: 'x2', item_updated_at: '2026-10-07T06:00:00Z' }),
      ],
      transactions: [],
    });
    expect(known).toContain('Bancos conectados: Nubank (atualizado em 07/10); Itaú (atualizado em 07/10).');
    expect(known).toContain('Saldos das contas: Nubank conta: R$ 1.234,56; Itaú conta: R$ 50,00.');
    expect(known).not.toContain('pessoal');
    expect(known).not.toContain('Maria');
  });

  it('nome de pessoa em texto livre da conta não vai (boleto, depósito, TEF, "dinheiro enviado a"), nem de MEI ou maquininha', () => {
    const people = buildFinanceSnapshot({
      ...input,
      transactions: [
        tx({ amount: 100, description: 'Pagamento de boleto efetuado - JOAO DA SILVA SAURO', boleto_barcode: '23793381286000000000300000004001843400000100' }),
        tx({ amount: 900, direction: 'CREDIT', description: 'DEPOSITO RECEBIDO JOSE CARLOS PEREIRA' }),
        tx({ amount: 80, description: 'Dinheiro enviado a Fernanda Lima' }),
        tx({ amount: 70, description: 'TEF ENVIADA FULANO BELTRANO' }),
        tx({ amount: 1500, direction: 'CREDIT', description: 'RECEBIMENTO ALUGUEL - ANA BEATRIZ COSTA' }),
        // MEI: a razão social é a raiz do CNPJ com o nome da pessoa.
        tx({
          amount: 60,
          description: 'Pix enviado',
          counterparty_name: '12.345.678 RENATA SOUZA',
          counterparty_doc_kind: 'CNPJ',
          counterparty_cnpj: '12345678000155',
        }),
        tx({ amount: 45, description: 'Compra', merchant_name: '45.678.901 CLAUDIO MOURA', merchant_cnpj: '45678901000122' }),
        tx({ account_id: card, amount: 30, description: 'PAG*JoaoDaSilva', occurred_on: '2026-10-04' }),
        tx({ account_id: card, amount: 25, description: 'SUPERMERCADO GUANABARA', category: 'Groceries', occurred_on: '2026-10-04' }),
      ],
    });
    for (const secret of ['JOAO', 'JoaoDaSilva', 'SAURO', 'JOSE', 'CARLOS', 'Fernanda', 'Lima', 'FULANO', 'BELTRANO', 'ANA', 'BEATRIZ', 'COSTA', 'RENATA', 'SOUZA', 'CLAUDIO', 'MOURA']) {
      expect([secret, new RegExp(`\\b${secret}\\b`, 'i').test(people)]).toEqual([secret, false]);
    }
    const recent = people.slice(people.indexOf('Lançamentos recentes')).split('\n').slice(1);
    expect(recent.map((line) => line.split(' · ').slice(1, 4).join(' · '))).toEqual([
      'entrada · Entrada · R$ 1.500,00',
      'entrada · Depósito · R$ 900,00',
      'saída · Outros · Boleto pago',
      'saída · Outros · Pagamento',
      'saída · Outros · Transferência enviada',
      'saída · Outros · PIX para empresa',
      'saída · Outros · Pagamento',
      'saída · Outros · Pagamento',
      'saída · Mercado · SUPERMERCADO GUANABARA',
    ]);
  });

  it('firma individual (nome de pessoa com CNPJ) e nome de pessoa na fatura não vão; compra de antes da janela não é listada', () => {
    const people = buildFinanceSnapshot({
      ...input,
      transactions: [
        tx({ amount: 350, description: 'PAGAMENTO DE BOLETO', counterparty_name: 'MARIANA FERREIRA LIMA', counterparty_doc_kind: 'CNPJ', counterparty_cnpj: '33444555000166', occurred_on: '2026-10-03' }),
        tx({ account_id: card, amount: 120, description: 'MARCOS ANTONIO ROCHA', occurred_on: '2026-10-02' }),
        tx({ account_id: card, amount: 80, description: 'Compra', merchant_name: 'JULIANA PRADO ALVES', merchant_cnpj: '22333444000155', occurred_on: '2026-10-01' }),
        // Buscada só para juntar parcelas e pares (um ciclo antes da janela, que começa em 1º/8).
        tx({ account_id: card, amount: 55, description: 'LOJA ANTIGA', occurred_on: '2026-07-20' }),
      ],
    });
    for (const secret of ['MARIANA', 'FERREIRA', 'MARCOS', 'ROCHA', 'JULIANA', 'PRADO', 'ALVES', 'ANTIGA']) {
      expect([secret, people.includes(secret)]).toEqual([secret, false]);
    }
    const recent = people.slice(people.indexOf('Lançamentos recentes')).split('\n').slice(1);
    expect(recent.map((line) => line.split(' · ').slice(1, 4).join(' · '))).toEqual([
      'saída · Outros · Boleto pago',
      'saída · Outros · Pagamento',
      'saída · Outros · Pagamento',
    ]);
  });

  it('estorno sem a compra nestes meses aparece à parte e não abate as saídas', () => {
    const refunded = buildFinanceSnapshot({
      ...input,
      transactions: [
        tx({ account_id: card, amount: 600, description: 'SUPERMERCADO BOM', category: 'Groceries', occurred_on: '2026-10-04' }),
        tx({ account_id: card, amount: 1000, direction: 'CREDIT', description: 'Estorno LOJA DE TV', occurred_on: '2026-10-03' }),
      ],
    });
    expect(refunded).toContain(
      'saídas R$ 600,00 em 1 lançamento; entradas R$ 0,00; estornos R$ 0,00 (já abatidos das saídas); mais R$ 1.000,00 em estornos sem a compra correspondente nestes meses (não abatidos).',
    );
  });

  it('data de atualização do banco no dia do aparelho, não no dia UTC', () => {
    // 22h30 de 7/10 no fuso do aparelho (em São Paulo, 01h30 UTC de 8/10).
    const late = new Date(2026, 9, 7, 22, 30).toISOString();
    const snapshot = buildFinanceSnapshot({ ...input, connections: [connection({ item_updated_at: late })], transactions: [] });
    expect(snapshot).toContain('Bancos conectados: Nubank (atualizado em 07/10).');
  });

  it('cartão: o saldo é limite usado; vencimento que já passou sai com o mínimo dele', () => {
    const paid = buildFinanceSnapshot({
      ...input,
      accounts: [
        account({
          id: card,
          type: 'CREDIT',
          balance: 5508.7,
          bill_due_date: '2026-09-11',
          bill_close_date: '2026-09-04',
          minimum_payment: 486.82,
          available_credit: 491.3,
        }),
      ],
      transactions: [],
    });
    expect(paid).toContain('Cartões: Nubank cartão: limite usado R$ 5.508,70 (fatura aberta mais parcelas a vencer), limite disponível R$ 491,30.');
    expect(paid).not.toContain('486,82');
    expect(paid).not.toContain('fatura atual');
  });

  it('conta que sumiu da Pluggy (cartão trocado) sai de saldos e cartões', () => {
    const replaced = buildFinanceSnapshot({
      ...input,
      accounts: [
        account({ balance: 1234.56 }),
        account({ id: 'cartao-velho', type: 'CREDIT', balance: 999, bill_due_date: '2026-10-20', updated_at: '2026-09-01T14:00:00Z' }),
        account({ id: 'conta-velha', balance: 77, updated_at: '2026-09-01T14:00:00Z' }),
      ],
      transactions: [],
    });
    expect(replaced).toContain('Saldos das contas: Nubank conta: R$ 1.234,56.');
    expect(replaced).toContain('Cartões: nenhum cartão.');
  });

  it('sem bancos nem lançamentos ainda monta o retrato', () => {
    const empty = buildFinanceSnapshot({ ...input, connections: [], accounts: [], transactions: [], budgets: [], kotiiRecords: [] });
    expect(empty).toContain('Nenhum banco conectado ainda.');
    expect(empty).toContain('Saídas por categoria em outubro de 2026: nenhuma.');
    expect(empty).toContain('Lançamentos recentes (o mais novo primeiro): nenhum.');
  });
});

describe('purchaseLabel / scrubText / dayLabel', () => {
  const purchase = (over: Partial<BankPurchase>): BankPurchase => ({
    key: 'k',
    date: '2026-10-05',
    amount: 10,
    description: 'COMPRA',
    merchantName: null,
    merchantCnpj: null,
    category: 'outros',
    autoCategory: 'outros',
    categorySource: 'auto',
    similarKey: null,
    kind: 'spending',
    pending: false,
    accountId: 'a',
    installment: null,
    ruleKey: 'k',
    ruleKeys: ['k'],
    txIds: [],
    personTransfer: false,
    sensitive: false,
    storeName: null,
    refundOf: null,
    refundParts: [],
    ...over,
  });

  it('transferência nunca leva nome', () => {
    expect(purchaseLabel(purchase({ description: 'Pix enviado', personTransfer: true }))).toBe('PIX para pessoa física');
    expect(purchaseLabel(purchase({ description: 'Pix recebido', personTransfer: true, kind: 'income' }))).toBe('PIX de pessoa física');
    expect(purchaseLabel(purchase({ description: 'TED enviada', personTransfer: true }))).toBe('Transferência para pessoa física');
    expect(purchaseLabel(purchase({ description: 'Pagamento de boleto', personTransfer: true }))).toBe('Boleto para pessoa física');
    expect(purchaseLabel(purchase({ description: 'Pix enviado', merchantName: 'Padaria Real', merchantCnpj: CNPJ }))).toBe('PIX para empresa');
    expect(purchaseLabel(purchase({ description: 'TED ENVIADA FULANO' }))).toBe('Transferência enviada');
    expect(purchaseLabel(purchase({ description: 'PIX RECEBIDO FULANO', kind: 'income' }))).toBe('PIX recebido');
  });

  it('compra leva a loja, sem números longos; sem nome de loja, um nome genérico', () => {
    expect(purchaseLabel(purchase({ description: 'MERCADOPAGO*LOJA', merchantName: 'LOJA', storeName: 'LOJA' }))).toBe('LOJA');
    expect(purchaseLabel(purchase({ description: 'NETFLIX.COM 0800123456', storeName: 'NETFLIX.COM 0800123456' }))).toBe('NETFLIX.COM');
    expect(purchaseLabel(purchase({ description: 'PAGAMENTO BOLETO 23793.38128 60000.000003 00000.000400 1 84340000010000' }))).toBe('Boleto pago');
    expect(purchaseLabel(purchase({ description: 'MERCADOPAGO*FULANODETAL', merchantName: 'FULANODETAL' }))).toBe('Pagamento');
    expect(purchaseLabel(purchase({ description: 'Salário EMPRESA X', kind: 'income' }))).toBe('Salário');
    expect(purchaseLabel(purchase({ description: 'Estorno de compra', kind: 'refund' }))).toBe('Estorno');
  });

  it('scrubText tira máscara, documento e e-mail', () => {
    expect(scrubText('Fulano ***.123.456-** conta 12345-6 fulano@email.com')).toBe('Fulano conta');
    expect(scrubText('Loja 12')).toBe('Loja 12');
  });

  it('dayLabel', () => {
    expect(dayLabel('2026-10-09')).toBe('sexta, 9/10');
    expect(dayLabel('2026-10-03')).toBe('sábado, 3/10');
  });
});

describe('ações do consultor', () => {
  it('parseFinanceActions segue as regras do servidor', () => {
    expect(
      parseFinanceActions([
        { type: 'open_screen', label: ' Ver orçamento ', screen: 'orcamento', category: null, amount: null },
        { type: 'open_screen', label: 'Ir', screen: 'despensa' },
        { type: 'set_budget', label: '', screen: null, category: 'mercado', amount: 1200.456 },
        { type: 'set_budget', label: 'Lazer', category: 'lazer', amount: 0 },
        { type: 'set_budget', label: 'Lazer', category: 'lazer', amount: 1_000_001 },
        { type: 'set_budget', label: 'Roupas', category: 'roupas', amount: 100 },
        { type: 'delete_all', label: 'Apagar' },
        null,
        { type: 'open_screen', label: 'Contas', screen: 'contas' },
        { type: 'open_screen', label: 'Notas', screen: 'notas' },
      ]),
    ).toEqual([
      { type: 'open_screen', label: 'Ver orçamento', screen: 'orcamento' },
      { type: 'set_budget', label: 'Definir orçamento', category: 'mercado', amount: 1200.46 },
      { type: 'open_screen', label: 'Contas', screen: 'contas' },
    ]);
    expect(parseFinanceActions('nada')).toEqual([]);
    expect(parseFinanceActions([{ type: 'open_screen', label: '', screen: 'consultor' }])).toEqual([
      { type: 'open_screen', label: 'Abrir', screen: 'consultor' },
    ]);
  });

  it('describeFinanceAction', () => {
    expect(describeFinanceAction({ type: 'set_budget', label: 'Definir', category: 'mercado', amount: 1200 })).toBe(
      'Mercado · R$ 1.200,00 por mês · vale para a casa toda',
    );
    expect(describeFinanceAction({ type: 'open_screen', label: 'Ver', screen: 'financas' })).toBe('');
  });

  it('histórico para a IA sem respostas que falharam', () => {
    expect(
      financeHistoryForApi([
        { id: '1', role: 'user', text: 'Oi' },
        { id: '2', role: 'assistant', text: 'Falhou', error: true },
        { id: '3', role: 'assistant', text: 'Olá!' },
        { id: '4', role: 'user', text: '  ' },
      ]),
    ).toEqual([
      { role: 'user', text: 'Oi' },
      { role: 'assistant', text: 'Olá!' },
    ]);
  });

  it('tem sugestões curtas para começar', () => {
    expect(FINANCE_SUGGESTIONS.length).toBeGreaterThanOrEqual(3);
    for (const s of FINANCE_SUGGESTIONS) expect(s.length).toBeLessThanOrEqual(50);
  });
});

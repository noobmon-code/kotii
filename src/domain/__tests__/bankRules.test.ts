import { describe, expect, it } from '@jest/globals';

import type { FinAccount, FinTransaction } from '@/lib/types';

import { groupPurchases, monthSummary } from '../bankMonth';
import {
  categoryRulesOf,
  chosenSensitive,
  NO_RULES,
  NO_SENSITIVE_KEYS,
  missingSimilarMarks,
  pickCategory,
  purchaseRuleKey,
  refundOfSaudeStore,
  saudeStores,
  similarRuleKey,
  similarText,
} from '../bankRules';

const PERSON = 'c'.repeat(64);

describe('similarText', () => {
  it('tira números, acentos e palavras genéricas da descrição', () => {
    expect(similarText('PADARIA SÃO JOÃO 0412')).toBe('padaria sao joao');
    expect(similarText('Compra no débito - LOJA DO ZÉ 12/10')).toBe('compra no debito loja do ze');
  });

  it('descrição só com palavras genéricas não junta nada', () => {
    expect(similarText('Pix enviado')).toBeNull();
    expect(similarText('Transferência enviada 123456')).toBeNull();
    expect(similarText('Pagamento de boleto')).toBeNull();
    expect(similarText('COMPRA CARTAO DEB 0410')).toBeNull();
  });

  it('corta textos longos', () => {
    expect(similarText(`loja ${'a'.repeat(200)}`)?.length).toBeLessThanOrEqual(80);
  });
});

describe('similarRuleKey', () => {
  it('PIX para pessoa: o hash do CPF, nunca o nome', () => {
    expect(similarRuleKey({ counterparty_doc_kind: 'CPF', counterparty_doc_hash: PERSON }, 'Maria Silva')).toBe(`doc:${PERSON}`);
    // Sem o hash (documento mascarado), não dá para saber se é a mesma pessoa.
    expect(similarRuleKey({ counterparty_doc_kind: 'CPF', counterparty_doc_hash: null }, 'Maria Silva')).toBeNull();
  });

  it('loja ou empresa: o nome', () => {
    expect(similarRuleKey({ counterparty_doc_kind: 'CNPJ', counterparty_doc_hash: null }, 'Padaria Real Ltda')).toBe(
      'm:padaria real ltda',
    );
    expect(similarRuleKey({ counterparty_doc_kind: null, counterparty_doc_hash: null }, 'Pix enviado')).toBeNull();
  });
});

describe('refundOfSaudeStore', () => {
  const store = { counterparty_doc_kind: null, counterparty_doc_hash: null } as const;

  it('reconhece a loja posta em Saúde pelo miolo do nome, dos dois lados', () => {
    // A compra sem nome de loja guardou a descrição inteira como chave das parecidas.
    const stores = saudeStores(NO_RULES, new Set(['m:compra cartao espaco viver bem ltda']));
    expect(refundOfSaudeStore(stores, store, 'ESTORNO DE COMPRA ESPACO VIVER BEM LTDA')).toBe(true);
    expect(refundOfSaudeStore(stores, store, 'Estorno ESPACO VIVER BEM 0412')).toBe(true);
    expect(refundOfSaudeStore(stores, store, 'Estorno PADARIA REAL')).toBe(false);
    // Só palavras genéricas: não junta com nada.
    expect(refundOfSaudeStore(stores, store, 'Estorno de compra')).toBe(false);
  });

  it('regra de parecidas em Saúde também conta, e outras categorias não', () => {
    const rules = categoryRulesOf([
      { match_key: 'm:clinica sorriso', category: 'saude' },
      { match_key: 'm:padaria real', category: 'mercado' },
    ]);
    const stores = saudeStores(rules, NO_SENSITIVE_KEYS);
    expect(refundOfSaudeStore(stores, store, 'Devolução CLINICA SORRISO')).toBe(true);
    expect(refundOfSaudeStore(stores, store, 'Estorno PADARIA REAL')).toBe(false);
  });

  it('devolução de PIX de uma pessoa: pelo hash do CPF', () => {
    const stores = saudeStores(NO_RULES, new Set([`doc:${PERSON}`]));
    expect(refundOfSaudeStore(stores, { counterparty_doc_kind: 'CPF', counterparty_doc_hash: PERSON }, 'Pix devolvido')).toBe(true);
    expect(refundOfSaudeStore(stores, { counterparty_doc_kind: 'CPF', counterparty_doc_hash: 'd'.repeat(64) }, 'Pix devolvido')).toBe(false);
  });
});

describe('missingSimilarMarks', () => {
  it('escolha de Saúde só para uma compra sem a marca das parecidas: grava de novo com a chave delas', () => {
    const rules = categoryRulesOf([
      { match_key: purchaseRuleKey('tx-1'), category: 'saude' },
      { match_key: purchaseRuleKey('tx-2'), category: 'saude' },
      { match_key: purchaseRuleKey('tx-3'), category: 'lazer' },
      { match_key: purchaseRuleKey('tx-4'), category: 'saude' },
    ]);
    const purchases = [
      { key: 'tx-1', similarKey: 'm:clinica sorriso' },
      { key: 'tx-2', similarKey: 'm:espaco viver bem' },
      { key: 'tx-3', similarKey: 'm:padaria real' },
      { key: 'tx-4', similarKey: null },
    ];
    // tx-2 já tem a marca das parecidas; tx-3 não é Saúde; tx-4 não tem parecidas.
    expect(missingSimilarMarks(purchases, rules, new Set(['m:espaco viver bem']))).toEqual([
      { matchKey: purchaseRuleKey('tx-1'), similarKey: 'm:clinica sorriso' },
    ]);
  });
});

describe('pickCategory', () => {
  const rules = categoryRulesOf([
    { match_key: 'm:padaria real', category: 'mercado' },
    { match_key: purchaseRuleKey('tx-1'), category: 'lazer' },
  ]);

  it('a escolha da compra vence a das parecidas, que vence a automática', () => {
    expect(pickCategory(rules, 'tx-1', 'm:padaria real', 'outros')).toEqual({ category: 'lazer', source: 'manual' });
    expect(pickCategory(rules, 'tx-2', 'm:padaria real', 'outros')).toEqual({ category: 'mercado', source: 'similar' });
    expect(pickCategory(rules, 'tx-2', 'm:outra loja', 'outros')).toEqual({ category: 'outros', source: 'auto' });
    expect(pickCategory(rules, 'tx-2', null, 'transporte')).toEqual({ category: 'transporte', source: 'auto' });
  });
});

describe('chosenSensitive', () => {
  const rules = categoryRulesOf([
    { match_key: 'm:clinica sorriso', category: 'saude' },
    { match_key: purchaseRuleKey('tx-1'), category: 'lazer' },
  ]);

  it('Saúde na compra ou nas parecidas, ou uma marca de Saúde antiga, deixam a compra sensível', () => {
    // "Só esta" em Lazer por cima das parecidas em Saúde não tira o sigilo.
    expect(chosenSensitive(rules, NO_SENSITIVE_KEYS, 'tx-1', 'm:clinica sorriso')).toBe(true);
    expect(chosenSensitive(rules, NO_SENSITIVE_KEYS, 'tx-2', 'm:padaria real')).toBe(false);
    // A regra já foi trocada ou desfeita, mas a marca ficou.
    expect(chosenSensitive(NO_RULES, new Set([purchaseRuleKey('tx-2')]), 'tx-2', 'm:padaria real')).toBe(true);
    expect(chosenSensitive(NO_RULES, new Set(['m:padaria real']), 'tx-2', 'm:padaria real')).toBe(true);
    expect(chosenSensitive(NO_RULES, new Set(['m:padaria real']), 'tx-2', null)).toBe(false);
  });
});

describe('groupPurchases com as categorias escolhidas', () => {
  const checking: FinAccount = {
    id: 'conta',
    connection_id: 'conn',
    pluggy_account_id: 'p-conta',
    type: 'BANK',
    subtype: 'CHECKING_ACCOUNT',
    name: null,
    marketing_name: null,
    number_last4: null,
    owner_doc_hash: 'a'.repeat(64),
    balance: null,
    currency_code: 'BRL',
    credit_limit: null,
    available_credit: null,
    bill_due_date: null,
    bill_close_date: null,
    minimum_payment: null,
    updated_at: '2026-10-07T12:00:00Z',
  };
  let seq = 0;
  const tx = (over: Partial<FinTransaction>): FinTransaction => {
    seq += 1;
    return {
      id: `t${seq}`,
      account_id: checking.id,
      pluggy_transaction_id: `p${seq}`,
      status: 'POSTED',
      direction: 'DEBIT',
      amount: 100,
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

  it('PIX para a mesma pessoa passa para a categoria escolhida, e o resumo do mês acompanha', () => {
    const rent = (day: string) =>
      tx({
        occurred_on: day,
        amount: 2000,
        description: 'Pix enviado',
        counterparty_name: 'Maria Silva',
        counterparty_doc_kind: 'CPF',
        counterparty_doc_hash: PERSON,
      });
    const txs = [rent('2026-09-05'), rent('2026-10-05'), tx({ description: 'XPTO SERVICOS', amount: 50 })];
    const before = groupPurchases(txs, [checking]);
    expect(before.filter((p) => p.amount === 2000).map((p) => p.category)).toEqual(['outros', 'outros']);

    const rules = categoryRulesOf([{ match_key: `doc:${PERSON}`, category: 'moradia' }]);
    const after = groupPurchases(txs, [checking], undefined, rules);
    const rents = after.filter((p) => p.amount === 2000);
    expect(rents.map((p) => [p.category, p.autoCategory, p.categorySource])).toEqual([
      ['moradia', 'outros', 'similar'],
      ['moradia', 'outros', 'similar'],
    ]);
    // O nome da pessoa continua fora do retrato, mesmo com uma categoria escolhida.
    expect(rents.every((p) => p.personTransfer && p.storeName === null)).toBe(true);
    expect(monthSummary(after, '2026-10').byCategory).toEqual([
      { category: 'moradia', amount: 2000 },
      { category: 'outros', amount: 50 },
    ]);
  });

  it('escolha só para uma compra não muda as parecidas', () => {
    const a = tx({ description: 'PADARIA REAL 01', amount: 10 });
    const b = tx({ description: 'PADARIA REAL 02', amount: 20 });
    const rules = categoryRulesOf([
      { match_key: 'm:padaria real', category: 'mercado' },
      { match_key: purchaseRuleKey(`tx-${b.id}`), category: 'lazer' },
    ]);
    const purchases = groupPurchases([a, b], [checking], undefined, rules);
    expect(purchases.map((p) => [p.amount, p.category, p.categorySource])).toEqual([
      [20, 'lazer', 'manual'],
      [10, 'mercado', 'similar'],
    ]);
  });

  it('escolher saúde deixa a compra sensível; tirar de saúde não tira o sigilo', () => {
    const clinic = tx({ description: 'ESPACO VIVER BEM', amount: 300 });
    const [chosen] = groupPurchases([clinic], [checking], undefined, categoryRulesOf([{ match_key: 'm:espaco viver bem', category: 'saude' }]));
    expect(chosen).toMatchObject({ category: 'saude', sensitive: true });

    const pharmacy = tx({ description: 'DROGASIL 123', category: 'Pharmacy' });
    const [moved] = groupPurchases([pharmacy], [checking], undefined, categoryRulesOf([{ match_key: 'm:drogasil', category: 'mercado' }]));
    expect(moved).toMatchObject({ category: 'mercado', sensitive: true });
  });

  it('Saúde que a pessoa trocou ou desfez continua sensível pela marca, e "Só esta" não tira o sigilo das parecidas', () => {
    const clinic = tx({ description: 'ESPACO VIVER BEM', amount: 300 });
    const [plain] = groupPurchases([clinic], [checking]);
    expect(plain.sensitive).toBe(false);

    const marks = new Set(['m:espaco viver bem']);
    const lazer = categoryRulesOf([{ match_key: 'm:espaco viver bem', category: 'lazer' }]);
    const [changed] = groupPurchases([clinic], [checking], undefined, lazer, marks);
    expect(changed).toMatchObject({ category: 'lazer', sensitive: true });
    const [undone] = groupPurchases([clinic], [checking], undefined, NO_RULES, marks);
    expect(undone).toMatchObject({ categorySource: 'auto', sensitive: true });

    const onlyThis = categoryRulesOf([
      { match_key: 'm:espaco viver bem', category: 'saude' },
      { match_key: purchaseRuleKey(`tx-${clinic.id}`), category: 'lazer' },
    ]);
    const [p] = groupPurchases([clinic], [checking], undefined, onlyThis);
    expect(p).toMatchObject({ category: 'lazer', categorySource: 'manual', sensitive: true });
  });

  it('estorno de compra posta em Saúde também é sensível, com ou sem o par', () => {
    const card: FinAccount = { ...checking, id: 'cartao', type: 'CREDIT', subtype: 'CREDIT_CARD' };
    const purchase = tx({ account_id: card.id, description: 'ESPACO VIVER BEM LTDA', amount: 300, occurred_on: '2026-10-03' });
    const refund = tx({
      account_id: card.id,
      direction: 'CREDIT',
      description: 'ESTORNO ESPACO VIVER BEM LTDA',
      amount: 300,
      occurred_on: '2026-10-06',
    });
    const accounts = [checking, card];
    const onlyThis = categoryRulesOf([{ match_key: purchaseRuleKey(`tx-${purchase.id}`), category: 'saude' }]);

    const plain = groupPurchases([purchase, refund], accounts);
    const plainRefund = plain.find((p) => p.kind === 'refund');
    expect(plainRefund).toMatchObject({ refundOf: `tx-${purchase.id}`, sensitive: false });

    // "Só esta" em Saúde: o estorno ligado à compra herda o sigilo.
    const linked = groupPurchases([purchase, refund], accounts, undefined, onlyThis);
    expect(linked.find((p) => p.kind === 'refund')).toMatchObject({ refundOf: `tx-${purchase.id}`, sensitive: true });

    // A compra ficou fora da janela: o estorno sozinho, pela marca da loja.
    const [alone] = groupPurchases([refund], accounts, undefined, NO_RULES, new Set(['m:espaco viver bem ltda']));
    expect(alone).toMatchObject({ kind: 'refund', refundOf: null, sensitive: true });
    // A compra tinha um prefixo do banco na descrição ("COMPRA CARTAO ..."), e o estorno outro.
    const prefixed = tx({ account_id: card.id, direction: 'CREDIT', description: 'ESTORNO DE COMPRA ESPACO VIVER BEM LTDA', amount: 300 });
    const [other] = groupPurchases([prefixed], accounts, undefined, NO_RULES, new Set(['m:compra cartao espaco viver bem ltda']));
    expect(other).toMatchObject({ kind: 'refund', sensitive: true });
  });

  it('compra parcelada também guarda o sigilo pela marca', () => {
    const card: FinAccount = { ...checking, id: 'cartao', type: 'CREDIT', subtype: 'CREDIT_CARD' };
    const parcel = (n: number, day: string) =>
      tx({
        account_id: card.id,
        description: `ESPACO VIVER BEM 0${n}/03`,
        amount: 200,
        installment_number: n,
        total_installments: 3,
        purchase_on: '2026-09-05',
        occurred_on: day,
      });
    const first = parcel(1, '2026-09-05');
    const txs = [first, parcel(2, '2026-10-05')];
    const [plain] = groupPurchases(txs, [checking, card]);
    expect(plain).toMatchObject({ key: `parc-${first.id}`, sensitive: false });
    const [marked] = groupPurchases(txs, [checking, card], undefined, NO_RULES, new Set([purchaseRuleKey(`parc-${first.id}`)]));
    expect(marked).toMatchObject({ key: `parc-${first.id}`, sensitive: true });
  });

  it('nome de pessoa na maquininha não vira loja só porque a pessoa escolheu uma categoria', () => {
    const card: FinAccount = { ...checking, id: 'cartao', type: 'CREDIT', subtype: 'CREDIT_CARD' };
    const sale = tx({ account_id: card.id, description: 'MERCADOPAGO*JULIANAPRADO' });
    const rules = categoryRulesOf([{ match_key: 'm:julianaprado', category: 'lazer' }]);
    const [p] = groupPurchases([sale], [checking, card], undefined, rules);
    expect(p).toMatchObject({ category: 'lazer', autoCategory: 'outros', storeName: null });
  });
});

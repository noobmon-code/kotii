import { describe, expect, it } from '@jest/globals';

import {
  type BankCategoryInput,
  financeCategoryOfBank,
  hasTerm,
  isSensitiveBankTx,
  normalizeBankText,
  pluggyFinanceCategory,
} from '../bankCategories';

const tx = (over: Partial<BankCategoryInput>): BankCategoryInput => ({
  category: null,
  category_id: null,
  description: '',
  ...over,
});

describe('normalizeBankText / hasTerm', () => {
  it('tira acento, caixa e pontuação', () => {
    expect(normalizeBankText('MERCADOPAGO*Padaria', null, 'Pão-de-Açúcar')).toBe('mercadopago padaria pao de acucar');
  });

  it('acha palavra inteira, ou começo de palavra com "*"', () => {
    expect(hasTerm('bar do ze', 'bar')).toBe(true);
    expect(hasTerm('barra da tijuca', 'bar')).toBe(false);
    expect(hasTerm('time de futebol', 'tim')).toBe(false);
    expect(hasTerm('clinica odontologia sorriso', 'odonto*')).toBe(true);
    expect(hasTerm('pao de acucar', 'pao de acucar')).toBe(true);
  });
});

describe('financeCategoryOfBank', () => {
  it('usa o nome da categoria da Pluggy', () => {
    const cases: [string, string][] = [
      ['Groceries', 'mercado'],
      ['Restaurants', 'lazer'],
      ['Eating out', 'lazer'],
      ['Food delivery', 'lazer'],
      ['Pharmacy', 'saude'],
      ['Gas stations', 'transporte'],
      ['Taxi and ride-hailing', 'transporte'],
      ['Rent', 'moradia'],
      ['Electricity', 'contas'],
      ['Water', 'contas'],
      ['Mobile', 'contas'],
      ['Streaming', 'assinaturas'],
      ['Video streaming', 'assinaturas'],
      ['Pet supplies and vet', 'pet'],
      ['University', 'educacao'],
    ];
    for (const [category, expected] of cases) {
      expect([category, financeCategoryOfBank(tx({ category, description: 'COMPRA' }))]).toEqual([category, expected]);
    }
  });

  it('sem o nome, usa o grupo do id da Pluggy', () => {
    expect(financeCategoryOfBank(tx({ category_id: '10000000', description: 'COMPRA 123' }))).toBe('mercado');
    expect(financeCategoryOfBank(tx({ category_id: '19050000', description: 'COMPRA 123' }))).toBe('transporte');
    expect(pluggyFinanceCategory(null, 'abc')).toBeNull();
  });

  it('categoria genérica (PIX, Shopping) deixa a descrição decidir', () => {
    expect(financeCategoryOfBank(tx({ category: 'Transfer - PIX', description: 'PIX ENVIADO PADARIA REAL' }))).toBe('mercado');
    expect(financeCategoryOfBank(tx({ category: 'Shopping', description: 'PETZ MORUMBI' }))).toBe('pet');
    expect(financeCategoryOfBank(tx({ category: 'Online shopping', description: 'MERCADOPAGO*FARMACIASAOJOAO' }))).toBe('saude');
    expect(financeCategoryOfBank(tx({ description: 'UBER *TRIP HELP.UBER.COM' }))).toBe('transporte');
    expect(financeCategoryOfBank(tx({ description: 'UBER EATS' }))).toBe('lazer');
    expect(financeCategoryOfBank(tx({ description: 'IFD*IFOOD' }))).toBe('lazer');
    expect(financeCategoryOfBank(tx({ description: 'Netflix.com' }))).toBe('assinaturas');
    expect(financeCategoryOfBank(tx({ description: 'ENEL DISTRIBUICAO SP' }))).toBe('contas');
    expect(financeCategoryOfBank(tx({ description: 'Pagamento de boleto', merchant_name: 'Condominio Ed. Flores' }))).toBe('moradia');
  });

  it('carteira ou marketplace com "mercado" no nome não é supermercado', () => {
    expect(financeCategoryOfBank(tx({ description: 'MERCADOPAGO*LOJA' }))).toBe('outros');
    expect(financeCategoryOfBank(tx({ description: 'Mercado Pago' }))).toBe('outros');
    expect(financeCategoryOfBank(tx({ description: 'MERCADO LIVRE' }))).toBe('outros');
    expect(financeCategoryOfBank(tx({ description: 'MERCADOPAGO*SUPERMERCADO BOM' }))).toBe('mercado');
  });

  it('não procura palavra-chave no nome de pessoa (CPF), só no de empresa', () => {
    expect(
      financeCategoryOfBank(
        tx({ description: 'Pix enviado', counterparty_name: 'Maria Mercado', counterparty_doc_kind: 'CPF' }),
      ),
    ).toBe('outros');
    expect(
      financeCategoryOfBank(
        tx({ description: 'Pix enviado', counterparty_name: 'Drogaria Sao Paulo SA', counterparty_doc_kind: 'CNPJ' }),
      ),
    ).toBe('saude');
  });

  it('sem pista nenhuma, outros', () => {
    expect(financeCategoryOfBank(tx({ category: 'Other', description: 'COMPRA 8812' }))).toBe('outros');
  });
});

describe('isSensitiveBankTx', () => {
  it('marca saúde, doações, religião, sindicato e partido', () => {
    expect(isSensitiveBankTx(tx({ category: 'Pharmacy', description: 'DROGASIL 1234' }))).toBe(true);
    expect(isSensitiveBankTx(tx({ description: 'CLINICA PSICOLOGIA VIVER' }))).toBe(true);
    expect(isSensitiveBankTx(tx({ category: 'Donations', description: 'PIX ENVIADO' }))).toBe(true);
    expect(isSensitiveBankTx(tx({ category_id: '13000000', description: 'PIX ENVIADO' }))).toBe(true);
    expect(isSensitiveBankTx(tx({ description: 'IGREJA BATISTA CENTRAL' }))).toBe(true);
    expect(isSensitiveBankTx(tx({ description: 'Dízimo outubro' }))).toBe(true);
    expect(isSensitiveBankTx(tx({ description: 'SINDICATO DOS BANCARIOS' }))).toBe(true);
    expect(isSensitiveBankTx(tx({ description: 'DIRETORIO NACIONAL PARTIDO X' }))).toBe(true);
  });

  it('não marca compra comum', () => {
    expect(isSensitiveBankTx(tx({ category: 'Groceries', description: 'SUPERMERCADO GUANABARA' }))).toBe(false);
    expect(isSensitiveBankTx(tx({ description: 'UBER *TRIP' }))).toBe(false);
  });
});

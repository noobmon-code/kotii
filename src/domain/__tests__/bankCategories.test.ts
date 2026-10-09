import { describe, expect, it } from '@jest/globals';

import {
  type BankCategoryInput,
  financeCategoryOfBank,
  hasTerm,
  isBankFee,
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
      ['Restaurants', 'alimentacao'],
      ['Eating out', 'alimentacao'],
      ['Food delivery', 'alimentacao'],
      ['Travel', 'viagem'],
      ['Airport and airlines', 'viagem'],
      ['Accomodation', 'viagem'],
      ['Clothing', 'compras'],
      ['Electronics', 'compras'],
      ['Bank fees', 'taxas'],
      ['Credit card fees', 'taxas'],
      ['Interests charged', 'taxas'],
      ['Tax on financial operations', 'taxas'],
      ['Cinema, theater and concerts', 'lazer'],
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
    expect(financeCategoryOfBank(tx({ category_id: '11010000', description: 'COMPRA 123' }))).toBe('alimentacao');
    expect(financeCategoryOfBank(tx({ category_id: '16030000', description: 'COMPRA 123' }))).toBe('taxas');
    expect(pluggyFinanceCategory(null, 'abc')).toBeNull();
  });

  it('categoria genérica (PIX, Shopping) deixa a descrição decidir', () => {
    expect(financeCategoryOfBank(tx({ category: 'Transfer - PIX', description: 'PIX ENVIADO PADARIA REAL' }))).toBe('mercado');
    expect(financeCategoryOfBank(tx({ category: 'Shopping', description: 'PETZ MORUMBI' }))).toBe('pet');
    expect(financeCategoryOfBank(tx({ category: 'Online shopping', description: 'MERCADOPAGO*FARMACIASAOJOAO' }))).toBe('saude');
    expect(financeCategoryOfBank(tx({ description: 'UBER *TRIP HELP.UBER.COM' }))).toBe('transporte');
    expect(financeCategoryOfBank(tx({ description: 'UBER EATS' }))).toBe('alimentacao');
    expect(financeCategoryOfBank(tx({ description: 'IFD*IFOOD' }))).toBe('alimentacao');
    expect(financeCategoryOfBank(tx({ description: 'Netflix.com' }))).toBe('assinaturas');
    expect(financeCategoryOfBank(tx({ description: 'ENEL DISTRIBUICAO SP' }))).toBe('contas');
    expect(financeCategoryOfBank(tx({ description: 'Pagamento de boleto', merchant_name: 'Condominio Ed. Flores' }))).toBe('moradia');
  });

  it('categorias novas pela descrição', () => {
    expect(financeCategoryOfBank(tx({ description: 'RESTAURANTE SABOR CASEIRO' }))).toBe('alimentacao');
    expect(financeCategoryOfBank(tx({ description: 'STARBUCKS PAULISTA' }))).toBe('alimentacao');
    expect(financeCategoryOfBank(tx({ description: 'PADARIA REAL' }))).toBe('mercado');
    expect(financeCategoryOfBank(tx({ description: 'BARBEARIA DO ZE' }))).toBe('cuidados');
    expect(financeCategoryOfBank(tx({ description: 'O BOTICARIO SHOPPING' }))).toBe('cuidados');
    // Estética vem antes de clínica (que seria Saúde).
    expect(financeCategoryOfBank(tx({ description: 'CLINICA DE ESTETICA BELLA' }))).toBe('cuidados');
    expect(financeCategoryOfBank(tx({ description: 'AIRBNB * HMXYZ' }))).toBe('viagem');
    expect(financeCategoryOfBank(tx({ description: 'HOTEL IBIS' }))).toBe('viagem');
    expect(financeCategoryOfBank(tx({ description: 'CLICKBUS PASSAGEM ONIBUS' }))).toBe('viagem');
    expect(financeCategoryOfBank(tx({ description: 'SHOPEE *LOJAX' }))).toBe('compras');
    expect(financeCategoryOfBank(tx({ description: 'AMAZON MARKETPLACE' }))).toBe('compras');
    expect(financeCategoryOfBank(tx({ description: 'AMAZON PRIME CANAIS' }))).toBe('assinaturas');
    expect(financeCategoryOfBank(tx({ description: 'TARIFA PACOTE DE SERVICOS' }))).toBe('taxas');
    expect(financeCategoryOfBank(tx({ description: 'IOF COMPRA INTERNACIONAL' }))).toBe('taxas');
    expect(financeCategoryOfBank(tx({ description: 'JUROS DE MORA' }))).toBe('taxas');
    expect(financeCategoryOfBank(tx({ description: 'ANUIDADE DIFERENCIADA' }))).toBe('taxas');
    expect(financeCategoryOfBank(tx({ description: 'DETRAN MULTA' }))).toBe('transporte');
  });

  it('"Shopping" e "Online shopping" da Pluggy só valem quando a descrição não diz nada', () => {
    expect(financeCategoryOfBank(tx({ category: 'Shopping', description: 'XPTO 123' }))).toBe('compras');
    expect(financeCategoryOfBank(tx({ category: 'Online shopping', description: 'MERCADOPAGO*JOAOSILVA' }))).toBe('compras');
    expect(financeCategoryOfBank(tx({ category_id: '08010000', description: 'XPTO 123' }))).toBe('compras');
    expect(financeCategoryOfBank(tx({ category: 'Shopping', description: 'SUPERMERCADO BOM' }))).toBe('mercado');
    expect(financeCategoryOfBank(tx({ category: 'Online shopping', description: 'MERCADOPAGO*FARMACIASAOJOAO' }))).toBe('saude');
  });

  it('carteira ou marketplace com "mercado" no nome não é supermercado', () => {
    expect(financeCategoryOfBank(tx({ description: 'MERCADOPAGO*JOAOSILVA' }))).toBe('outros');
    expect(financeCategoryOfBank(tx({ description: 'Mercado Pago' }))).toBe('outros');
    expect(financeCategoryOfBank(tx({ description: 'MERCADO LIVRE' }))).toBe('compras');
    expect(financeCategoryOfBank(tx({ description: 'MERCADOLIVRE*VENDEDOR' }))).toBe('compras');
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

describe('isBankFee', () => {
  it('tarifa pelo tipo do Open Finance, pela categoria da Pluggy ou pela descrição', () => {
    expect(isBankFee({ ...tx({ description: 'SERVICO CARTAO 01/12' }), fee_type: 'ANUIDADE' })).toBe(true);
    expect(isBankFee(tx({ description: 'PACOTE 03/12', category: 'Credit card fees' }))).toBe(true);
    expect(isBankFee(tx({ description: 'ANUIDADE DIFERENCIADA 05/12' }))).toBe(true);
    expect(isBankFee(tx({ description: 'IOF COMPRA INTERNACIONAL' }))).toBe(true);
    expect(isBankFee(tx({ description: 'TARIFA AVULSA SAQUE' }))).toBe(true);
  });

  it('compra parcelada não é tarifa, nem a "sem juros"', () => {
    expect(isBankFee(tx({ description: 'MAGALU 01/10', category: 'Electronics' }))).toBe(false);
    expect(isBankFee(tx({ description: 'LOJA X PARCELADO SEM JUROS 1/3' }))).toBe(false);
    expect(isBankFee({ ...tx({ description: 'AMAZON BR 02/10' }), fee_type: null })).toBe(false);
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

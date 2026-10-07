import { describe, expect, it } from '@jest/globals';

import { type BankClassifyInput, classifyBankTransaction, ownerHashes } from '../bankClassify';

const OWNER = 'a'.repeat(64);
const STRANGER = 'b'.repeat(64);
const owners = new Set([OWNER]);
const checking = { type: 'BANK' as const };
const card = { type: 'CREDIT' as const };

const tx = (over: Partial<BankClassifyInput>): BankClassifyInput => ({
  direction: 'DEBIT',
  description: 'COMPRA',
  category: null,
  category_id: null,
  counterparty_doc_hash: null,
  other_credits_type: null,
  ...over,
});

const onChecking = (over: Partial<BankClassifyInput>) => classifyBankTransaction(tx(over), checking, owners);
const onCard = (over: Partial<BankClassifyInput>) => classifyBankTransaction(tx(over), card, owners);

describe('classifyBankTransaction — guardar dinheiro no próprio banco', () => {
  it('Mercado Pago: cofrinho, dinheiro reservado e rendimentos', () => {
    expect(onChecking({ description: 'Dinheiro reservado' })).toBe('investment');
    expect(onChecking({ description: 'Dinheiro retirado', direction: 'CREDIT' })).toBe('investment');
    expect(onChecking({ description: 'Cofrinho Viagem' })).toBe('investment');
    expect(onChecking({ description: 'Rendimentos', direction: 'CREDIT' })).toBe('investment');
  });

  it('Nubank: caixinha e RDB', () => {
    expect(onChecking({ description: 'Dinheiro guardado na Caixinha Reserva' })).toBe('investment');
    expect(onChecking({ description: 'Aplicação RDB' })).toBe('investment');
    expect(onChecking({ description: 'Resgate RDB', direction: 'CREDIT' })).toBe('investment');
  });

  it('Inter: porquinho e CDB', () => {
    expect(onChecking({ description: 'Porquinho Inter' })).toBe('investment');
    expect(onChecking({ description: 'APLICACAO CDB' })).toBe('investment');
    expect(onChecking({ description: 'RESGATE CDB', direction: 'CREDIT' })).toBe('investment');
  });

  it('Santander: poupança, aplicação e resgate', () => {
    expect(onChecking({ description: 'POUPANCA' })).toBe('investment');
    expect(onChecking({ description: 'APLICACAO CONTAMAX' })).toBe('investment');
    expect(onChecking({ description: 'RESGATE CONTAMAX', direction: 'CREDIT' })).toBe('investment');
    expect(onChecking({ description: 'APLIC.AUT.POUP' })).toBe('investment');
  });

  it('pela categoria ou pelo tipo de operação da Pluggy', () => {
    expect(onChecking({ category: 'Fixed income', description: 'TED' })).toBe('investment');
    expect(onChecking({ category_id: '03020000', description: 'TED' })).toBe('investment');
    expect(onChecking({ operation_type: 'RESGATE_APLIC_FINANCEIRA', description: 'CREDITO', direction: 'CREDIT' })).toBe('investment');
  });

  it('"aplicativo" não é aplicação', () => {
    expect(onChecking({ description: 'COMPRA APLICATIVO UBER' })).toBe('spending');
  });
});

describe('classifyBankTransaction — entre contas da própria pessoa', () => {
  it('PIX para outra conta da dona (mesmo documento) é interno, nos dois lados', () => {
    expect(onChecking({ description: 'Pix enviado', counterparty_doc_hash: OWNER })).toBe('internal');
    expect(onChecking({ description: 'Pix recebido', direction: 'CREDIT', counterparty_doc_hash: OWNER })).toBe('internal');
  });

  it('a Pluggy pode dizer "Same person transfer"', () => {
    expect(onChecking({ description: 'TED', category: 'Same person transfer - PIX' })).toBe('internal');
    expect(onChecking({ description: 'TED', category_id: '04000000' })).toBe('internal');
  });

  it('PIX para outra pessoa é gasto; de outra pessoa, entrada', () => {
    expect(onChecking({ description: 'Pix enviado', counterparty_doc_hash: STRANGER })).toBe('spending');
    expect(onChecking({ description: 'Pix recebido', direction: 'CREDIT', counterparty_doc_hash: STRANGER })).toBe('income');
  });

  it('aceita os hashes como lista e tira os hashes das contas', () => {
    expect(classifyBankTransaction(tx({ counterparty_doc_hash: OWNER }), checking, [OWNER])).toBe('internal');
    expect([...ownerHashes([{ owner_doc_hash: OWNER }, { owner_doc_hash: null }, { owner_doc_hash: OWNER }])]).toEqual([OWNER]);
  });
});

describe('classifyBankTransaction — fatura do cartão', () => {
  it('pagamento da fatura na conta corrente', () => {
    expect(onChecking({ description: 'Pagamento de fatura' })).toBe('card_payment');
    expect(onChecking({ description: 'PAGTO CARTAO CREDITO' })).toBe('card_payment');
    expect(onChecking({ description: 'PAG FAT CARTAO SANTANDER' })).toBe('card_payment');
    expect(onChecking({ description: 'FATURA CARTAO INTER' })).toBe('card_payment');
    expect(onChecking({ description: 'Pagamento da fatura do cartão' })).toBe('card_payment');
    expect(onChecking({ description: 'Boleto', category: 'Credit card payment' })).toBe('card_payment');
    expect(onChecking({ description: 'Boleto', category_id: '05100000' })).toBe('card_payment');
  });

  it('"fatura" de conta de consumo não é cartão', () => {
    expect(onChecking({ description: 'PAG FATURA VIVO' })).toBe('spending');
  });

  it('no cartão, "pagamento recebido" é a fatura paga', () => {
    expect(onCard({ description: 'Pagamento recebido', direction: 'CREDIT' })).toBe('card_payment');
    expect(onCard({ description: 'PAGAMENTO EFETUADO', direction: 'CREDIT' })).toBe('card_payment');
  });

  it('outras entradas no cartão são estorno', () => {
    expect(onCard({ description: 'Estorno de "Loja X"', direction: 'CREDIT' })).toBe('refund');
    expect(onCard({ description: 'Devolução de pagamento', direction: 'CREDIT' })).toBe('refund');
    expect(onCard({ description: 'AMAZON MARKETPLACE', direction: 'CREDIT' })).toBe('refund');
    expect(onCard({ description: 'PAG*LOJA', direction: 'CREDIT' })).toBe('refund');
  });

  it('saída no cartão é compra, inclusive tarifa, IOF e juros', () => {
    expect(onCard({ description: 'SUPERMERCADO BOM' })).toBe('spending');
    expect(onCard({ description: 'IOF de compra internacional' })).toBe('spending');
    expect(onCard({ description: 'Anuidade' })).toBe('spending');
    expect(onCard({ description: 'Juros de atraso' })).toBe('spending');
    expect(onCard({ description: 'Outro', other_credits_type: 'OTHER' })).toBe('spending');
  });

  it('crédito contratado no cartão é dívida', () => {
    expect(onCard({ description: 'Parcelamento de fatura 2/12', other_credits_type: 'BILL_INSTALLMENT' })).toBe('financing');
    expect(onCard({ description: 'Rotativo', other_credits_type: 'REVOLVING_CREDIT' })).toBe('financing');
    expect(onCard({ description: 'Empréstimo no cartão', other_credits_type: 'LOAN' })).toBe('financing');
    expect(onCard({ description: 'Parcelamento de fatura 3/12' })).toBe('financing');
  });

  it('sem a conta carregada, reconhece o cartão pelos dados da fatura', () => {
    const payment = tx({ description: 'Pagamento recebido', direction: 'CREDIT', card_bill_id: 'bill-1' });
    expect(classifyBankTransaction(payment, undefined, owners)).toBe('card_payment');
    expect(classifyBankTransaction(tx({ description: 'Pagamento recebido', direction: 'CREDIT' }), undefined, owners)).toBe('income');
  });
});

describe('classifyBankTransaction — entradas na conta', () => {
  it('estorno e PIX devolvido abatem gasto', () => {
    expect(onChecking({ description: 'Estorno compra', direction: 'CREDIT' })).toBe('refund');
    expect(onChecking({ description: 'Pix devolvido', direction: 'CREDIT' })).toBe('refund');
  });

  it('salário é entrada; empréstimo que caiu é dívida', () => {
    expect(onChecking({ description: 'Salário', direction: 'CREDIT', category: 'Salary' })).toBe('income');
    expect(onChecking({ description: 'Crédito de empréstimo pessoal', direction: 'CREDIT' })).toBe('financing');
    expect(onChecking({ description: 'Crédito', direction: 'CREDIT', category: 'Loans' })).toBe('financing');
  });
});

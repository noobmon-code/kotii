import { describe, expect, it } from '@jest/globals';

import { knownBankName, safeBankLabels } from '../bankNames';

const conn = (id: string, label: string, created_at = '2026-10-01T00:00:00Z') => ({ id, label, created_at });

describe('knownBankName', () => {
  it('reconhece a instituição sem ligar para acento, maiúscula ou o resto do rótulo', () => {
    expect(knownBankName('nubank pessoal')).toBe('Nubank');
    expect(knownBankName('Itau')).toBe('Itaú');
    expect(knownBankName('ITAÚ Personnalité')).toBe('Itaú');
    expect(knownBankName('Cartão do João no Nubank')).toBe('Nubank');
    expect(knownBankName('Banco do Brasil - conta conjunta')).toBe('Banco do Brasil');
    expect(knownBankName('BB')).toBe('Banco do Brasil');
    expect(knownBankName('Banco do Nordeste do Brasil')).toBe('Banco do Nordeste');
    expect(knownBankName('Mercado Pago da Ana')).toBe('Mercado Pago');
    expect(knownBankName('C6 Bank')).toBe('C6 Bank');
    expect(knownBankName('PagSeguro')).toBe('PagBank');
    expect(knownBankName('99Pay')).toBe('99Pay');
    expect(knownBankName('Caixa Econômica')).toBe('Caixa');
  });

  it('só palavra inteira; sem instituição conhecida, null', () => {
    expect(knownBankName('Conta da Maria')).toBeNull();
    expect(knownBankName('Conta internacional')).toBeNull();
    expect(knownBankName('Panificadora')).toBeNull();
    expect(knownBankName('')).toBeNull();
  });

  it('citando dois bancos inequívocos, vale o primeiro do rótulo', () => {
    expect(knownBankName('Inter (antes Nubank)')).toBe('Inter');
  });

  it('nome que também é nome de gente ou palavra comum só vale com palavras genéricas em volta', () => {
    expect(knownBankName('Rico')).toBe('Rico');
    expect(knownBankName('Cora PJ')).toBe('Cora');
    expect(knownBankName('BB')).toBe('Banco do Brasil');
    expect(knownBankName('Conta BB 2')).toBe('Banco do Brasil');
    expect(knownBankName('Cartão de crédito Neon')).toBeNull();
    expect(knownBankName('Cartão crédito Neon')).toBe('Neon');
    expect(knownBankName('Stone Conta PJ')).toBe('Stone');
    expect(knownBankName('Banco Safra')).toBe('Safra');
    expect(knownBankName('Banco Original')).toBe('Banco Original');
    expect(knownBankName('Nu')).toBe('Nubank');
    expect(knownBankName('Pan')).toBe('Banco Pan');
    expect(knownBankName('Next')).toBe('Next');
  });

  it('nome de gente, sobrenome ou palavra comum não vira banco (o nome iria para a IA)', () => {
    expect(knownBankName('Conta do Rico')).toBeNull();
    expect(knownBankName('Maria Stone')).toBeNull();
    expect(knownBankName('Gabi BB')).toBeNull();
    expect(knownBankName('Cartão original')).toBeNull();
    expect(knownBankName('Peter Pan')).toBeNull();
    expect(knownBankName('Ame e Cora')).toBeNull();
    expect(knownBankName('Conta Panda')).toBeNull();
    expect(knownBankName('Ana Caixeta')).toBeNull();
  });

  it('banco inequívoco ganha de nome ambíguo em qualquer posição', () => {
    expect(knownBankName('Cartão da Cora (Itaú)')).toBe('Itaú');
    expect(knownBankName('Rico no Nubank')).toBe('Nubank');
    expect(knownBankName('Agi Santander')).toBe('Santander');
    expect(knownBankName('Next - Bradesco')).toBe('Bradesco');
  });
});

describe('safeBankLabels', () => {
  it('rótulo sem instituição conhecida vira "Banco 1"', () => {
    expect(safeBankLabels([conn('c1', 'Conta da Maria')]).get('c1')).toBe('Banco 1');
  });

  it('dois rótulos desconhecidos viram Banco 1 e Banco 2, pela ordem em que foram conectados', () => {
    const labels = safeBankLabels([
      conn('c-b', 'Conta do José', '2026-10-02T00:00:00Z'),
      conn('c-a', 'Conta da Maria', '2026-10-01T00:00:00Z'),
      conn('c-nu', 'Nubank da Maria', '2026-10-01T12:00:00Z'),
    ]);
    expect(Object.fromEntries(labels)).toEqual({ 'c-a': 'Banco 1', 'c-nu': 'Nubank', 'c-b': 'Banco 2' });
  });

  it('a mesma ordem não importa a ordem de entrada (mesma hora: pelo id)', () => {
    const a = conn('c1', 'Pessoal');
    const b = conn('c2', 'Empresa');
    expect(safeBankLabels([b, a]).get('c1')).toBe('Banco 1');
    expect(safeBankLabels([a, b]).get('c1')).toBe('Banco 1');
  });

  it('nome de gente que também é nome de banco não passa: vira "Banco N" ou o banco inequívoco do rótulo', () => {
    const labels = safeBankLabels([
      conn('rico', 'Conta do Rico'),
      conn('cora', 'Cartão da Cora (Itaú)', '2026-10-02T00:00:00Z'),
      conn('stone', 'Maria Stone', '2026-10-03T00:00:00Z'),
    ]);
    expect(Object.fromEntries(labels)).toEqual({ rico: 'Banco 1', cora: 'Itaú', stone: 'Banco 2' });
  });

  it('o segundo banco da mesma instituição ganha número', () => {
    const labels = safeBankLabels([conn('pf', 'Nubank PF'), conn('pj', 'Nubank PJ', '2026-10-03T00:00:00Z')]);
    expect([labels.get('pf'), labels.get('pj')]).toEqual(['Nubank', 'Nubank 2']);
  });
});

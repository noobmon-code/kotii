import { describe, expect, it } from '@jest/globals';

import { bankMod11, collectionMod11, dueDateFromFactor, mod10, parseBoleto } from '../boleto';

const TODAY = '2026-09-27';

/** Monta um código de barras bancário válido: banco, fator, valor em centavos e campo livre. */
function bankBarcode(bank: string, factor: number, cents: number, free = '1234567890123456789012345'): string {
  const body = `${bank}9${String(factor).padStart(4, '0')}${String(cents).padStart(10, '0')}${free}`;
  const dv = bankMod11(body);
  return body.slice(0, 4) + dv + body.slice(4);
}

/** Código de arrecadação válido: segmento, tipo de valor (6 = reais, mod 10) e valor. */
function collectionBarcode(segment: string, cents: number, valueType = '6'): string {
  const body = `8${segment}${valueType}${String(cents).padStart(11, '0')}00010000000000000123456789012`;
  const dv = valueType === '6' || valueType === '7' ? mod10(body) : collectionMod11(body);
  return body.slice(0, 3) + dv + body.slice(3);
}

describe('parseBoleto', () => {
  it('lê o código de barras de um boleto bancário: banco, valor e vencimento (ciclo novo do fator)', () => {
    // Fator 1000 = 22/02/2025 no ciclo novo; 1583 = 28/09/2026.
    const barcode = bankBarcode('341', 1583, 25990);
    const boleto = parseBoleto(barcode, TODAY)!;
    expect(boleto).toMatchObject({ kind: 'bancario', amount: 259.9, dueDate: '2026-09-28', suggestedName: 'Boleto Itaú' });
    expect(boleto.line.replace(/\D/g, '')).toHaveLength(47);
  });

  it('a linha digitável volta ao mesmo código de barras', () => {
    const barcode = bankBarcode('237', 1590, 12000);
    const line = parseBoleto(barcode, TODAY)!.line;
    expect(line).toMatch(/^\d{5}\.\d{5} \d{5}\.\d{6} \d{5}\.\d{6} \d \d{14}$/);
    expect(parseBoleto(line, TODAY)).toMatchObject({ barcode, amount: 120, suggestedName: 'Boleto Bradesco' });
  });

  it('recusa DV errado na linha ou no código', () => {
    const barcode = bankBarcode('001', 1600, 5000);
    const wrongDv = barcode.slice(0, 4) + ((Number(barcode[4]) + 1) % 10) + barcode.slice(5);
    expect(parseBoleto(wrongDv, TODAY)).toBeNull();
    const line = parseBoleto(barcode, TODAY)!.line.replace(/\D/g, '');
    const typo = line.slice(0, 12) + ((Number(line[12]) + 1) % 10) + line.slice(13);
    expect(parseBoleto(typo, TODAY)).toBeNull();
    expect(parseBoleto('123', TODAY)).toBeNull();
  });

  it('boleto sem valor e sem vencimento fica em aberto', () => {
    const boleto = parseBoleto(bankBarcode('104', 0, 0), TODAY)!;
    expect([boleto.amount, boleto.dueDate, boleto.suggestedName]).toEqual([null, null, 'Boleto Caixa']);
  });

  it('lê conta de concessionária (arrecadação): tipo pelo segmento e valor', () => {
    const barcode = collectionBarcode('3', 18745);
    const boleto = parseBoleto(barcode, TODAY)!;
    expect(boleto).toMatchObject({ kind: 'arrecadacao', amount: 187.45, dueDate: null, suggestedName: 'Energia e gás', suggestedCategory: 'contas' });
    expect(boleto.line).toMatch(/^(\d{11}-\d ){3}\d{11}-\d$/);
    expect(parseBoleto(boleto.line, TODAY)?.barcode).toBe(barcode);
  });

  it('arrecadação com módulo 11 e multa de trânsito', () => {
    const barcode = collectionBarcode('7', 29347, '8');
    expect(parseBoleto(barcode, TODAY)).toMatchObject({ amount: 293.47, suggestedName: 'Multa de trânsito', suggestedCategory: 'transporte' });
  });
});

describe('dueDateFromFactor', () => {
  it('escolhe o ciclo mais perto de hoje', () => {
    expect(dueDateFromFactor(9999, '2025-02-01')).toBe('2025-02-21');
    expect(dueDateFromFactor(1000, '2025-03-01')).toBe('2025-02-22');
    expect(dueDateFromFactor(1000, '2000-07-01')).toBe('2000-07-03');
    expect(dueDateFromFactor(0, TODAY)).toBeNull();
  });
});

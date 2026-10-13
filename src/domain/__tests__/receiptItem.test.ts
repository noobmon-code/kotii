import { describe, expect, it } from '@jest/globals';

import { parseUnitPrice, readReceiptItem } from '../receiptItem';

const form = (quantity: string, unitPrice: string, total: string, description = 'Item') => ({ description, quantity, unitPrice, total });
const saved = (quantity: string, unitPrice: string, total: string) => {
  const result = readReceiptItem(form(quantity, unitPrice, total));
  return result.ok ? [result.values.quantity, result.values.unit_price, result.values.total_price] : result.message;
};

describe('parseUnitPrice', () => {
  it('sozinho, o ponto é a vírgula decimal: o preço unitário tem três casas de verdade', () => {
    expect(parseUnitPrice('5.899', 40, null)).toBe(5.899);
    expect(parseUnitPrice('1.500', 1, null)).toBe(1.5);
    expect(parseUnitPrice('5,899', 40, null)).toBe(5.899);
    expect(parseUnitPrice('1500', 1, null)).toBe(1500);
    expect(parseUnitPrice('', 1, null)).toBeNull();
    expect(parseUnitPrice('abc', 1, 10)).toBeNull();
    expect(parseUnitPrice('1.500.000', 1, null)).toBe(1500000);
    expect(parseUnitPrice('12.345.678', 2, 10)).toBe(12345678);
  });

  it('com o total do item, "1.500" é lido do jeito que fecha com ele', () => {
    expect(parseUnitPrice('1.500', 1, 1500)).toBe(1500);
    expect(parseUnitPrice('1.500', 2, 3000)).toBe(1500);
    expect(parseUnitPrice('2.000', 3, 5400)).toBe(2000);
    // A gasolina: 40 litros a 5,899 dão 235,96, e não duzentos e trinta e cinco mil.
    expect(parseUnitPrice('5.899', 40, 235.96)).toBe(5.899);
    expect(parseUnitPrice('1.500', 1, 1.5)).toBe(1.5);
    // Com desconto no item o total não é exato: vale a leitura mais próxima.
    expect(parseUnitPrice('1.500', 1, 1350)).toBe(1500);
    expect(parseUnitPrice('5.899', 40, 230)).toBe(5.899);
    // Quando as duas leituras dão no mesmo (com vírgula, ou sem ponto), não há o que escolher.
    expect(parseUnitPrice('1.500,00', 1, 3)).toBe(1500);
    expect(parseUnitPrice('15.90', 2, 31800)).toBe(15.9);
    // Quatro casas existem no preço unitário (a coluna guarda 4): "1.5000" é 1,5, com total ou sem.
    expect(parseUnitPrice('1.5000', 2, 3)).toBe(1.5);
    expect(parseUnitPrice('1.5000', 2, 30000)).toBe(1.5);
  });
});

describe('readReceiptItem', () => {
  it('sem o preço unitário, ele sai do total; sem o total, do preço vezes a quantidade', () => {
    expect(saved('2', '', '15,80')).toEqual([2, 7.9, 15.8]);
    expect(saved('3', '', '1.000')).toEqual([3, 333.3333, 1000]);
    expect(saved('2', '7,90', '')).toEqual([2, 7.9, 15.8]);
    expect(saved('40', '5.899', '')).toEqual([40, 5.899, 235.96]);
    expect(saved('2,5', '10', ' ')).toEqual([2.5, 10, 25]);
  });

  it('"1.500" no total é mil e quinhentos, e o preço unitário acompanha', () => {
    expect(saved('1', '', '1.500')).toEqual([1, 1500, 1500]);
    expect(saved('1', '1.500', '1.500')).toEqual([1, 1500, 1500]);
    expect(saved('2', '1.500', '3.000')).toEqual([2, 1500, 3000]);
    // Quantidade "1.500" é um quilo e meio (três casas), e o total continua em reais.
    expect(saved('1.500', '', '1.500')).toEqual([1.5, 1000, 1500]);
    // A gasolina com os três campos: nada muda.
    expect(saved('40', '5.899', '235,96')).toEqual([40, 5.899, 235.96]);
    expect(saved('40.123', '5.899', '236.69')).toEqual([40.123, 5.899, 236.69]);
    // Só o preço unitário, sem total: fica a leitura de três casas (a tela mostra o item logo depois de salvar).
    expect(saved('1', '1.500', '')).toEqual([1, 1.5, 1.5]);
  });

  it('total preenchido que não deu para ler não vira o preço vezes a quantidade: avisa', () => {
    const unreadable = 'Confira o total do item, ou deixe em branco para calcular.';
    // A pessoa corrige o total de um item que já tinha preço e para em "1.350,".
    expect(saved('1', '1500', '1.350,')).toBe(unreadable);
    expect(saved('1', '1500', '1.350.')).toBe(unreadable);
    expect(saved('1', '1500', 'abc')).toBe(unreadable);
    expect(saved('1', '1500', '1.5000')).toBe(unreadable);
    expect(saved('1', '', '1.350,')).toBe(unreadable);
    // Em branco continua querendo dizer "calcule".
    expect(saved('1', '1500', '')).toEqual([1, 1500, 1500]);
    // O que o app mesmo escreve ao abrir um item salvo (sem ponto de milhar) é lido de volta igual.
    expect(saved('1', '1500', '1500')).toEqual([1, 1500, 1500]);
    expect(saved('2', '333,3333', '666,67')).toEqual([2, 333.3333, 666.67]);
  });

  it('o resto dos avisos é o de sempre', () => {
    const basics = 'Informe a descrição e uma quantidade maior que zero.';
    expect(readReceiptItem(form('1', '10', '', '  '))).toEqual({ ok: false, message: basics });
    expect(saved('0', '10', '')).toBe(basics);
    expect(saved('', '10', '')).toBe(basics);
    expect(saved('1', '', '')).toBe('Informe o preço unitário ou o total.');
    expect(saved('1', 'abc', '')).toBe('Informe o preço unitário ou o total.');
    // Dois pontos só têm uma leitura: são de milhar.
    expect(saved('1', '1.500.000', '')).toEqual([1, 1500000, 1500000]);
    // Preço unitário que não deu para ler, com o total legível: sai do total, como sempre.
    expect(saved('2', '1.350,', '2.700')).toEqual([2, 1350, 2700]);
    expect(readReceiptItem(form('1', '10', '', '  Arroz  '))).toEqual({
      ok: true,
      values: { raw_description: 'Arroz', quantity: 1, unit_price: 10, total_price: 10 },
    });
  });
});

import { describe, expect, it } from '@jest/globals';

import type { Unit } from '@/lib/types';
import {
  addOption,
  ambiguousQuantityHint,
  canRemoveOption,
  checkSentence,
  comparePrices,
  formatPerBase,
  initialOptions,
  MAX_OPTIONS,
  newOption,
  optionHint,
  optionLine,
  percentCheaper,
  PRICE_HINT,
  QUANTITY_HINT,
  readOption,
  priceFieldSpoken,
  quantityFieldSpoken,
  removeOption,
  removeOptionSpoken,
  unitChipSpoken,
  unitGroupSpoken,
  UNIT_SPOKEN,
  WAITING_SENTENCE,
  type CalcOption,
} from '../priceCalculator';

const opt = (price: string, quantity: string, unit: Unit): CalcOption => ({ price, quantity, unit });
/** O preço por kg (litro, unidade) como a tela escreve, ou a dica. */
const line = (price: string, quantity: string, unit: Unit) => optionLine(opt(price, quantity, unit), 0);
/** A dica embaixo do campo a conferir, ou null. */
const hint = (price: string, quantity: string, unit: Unit) => optionHint(opt(price, quantity, unit), 0);

describe('o preço por kg, litro ou unidade de cada opção', () => {
  it('peso vira preço por kg, de g e de kg', () => {
    expect(line('8,90', '500', 'g')).toBe('R$ 17,80 o kg');
    expect(line('16,50', '1', 'kg')).toBe('R$ 16,50 o kg');
    expect(line('24,75', '1,5', 'kg')).toBe('R$ 16,50 o kg');
    expect(line('5,99', '200', 'g')).toBe('R$ 29,95 o kg');
  });

  it('volume vira preço por litro, de ml e de l', () => {
    expect(line('2,60', '500', 'ml')).toBe('R$ 5,20 o litro');
    expect(line('10,40', '2', 'l')).toBe('R$ 5,20 o litro');
    expect(line('3,49', '350', 'ml')).toBe('R$ 9,97 o litro');
  });

  it('unidade fica por unidade', () => {
    expect(line('16,80', '12', 'un')).toBe('R$ 1,40 a unidade');
    expect(line('3', '1', 'un')).toBe('R$ 3,00 a unidade');
  });

  it('abaixo de R$ 1 vai até a terceira casa, para dois preços diferentes não aparecerem iguais', () => {
    expect(line('2,00', '100', 'un')).toBe('R$ 0,02 a unidade');
    expect(line('3,00', '200', 'un')).toBe('R$ 0,015 a unidade');
    expect(line('3,49', '50', 'un')).toBe('R$ 0,07 a unidade');
    expect(formatPerBase(0.5, 'l')).toBe('R$ 0,50 o litro');
  });

  it('arredonda o centavo sem o erro do ponto flutuante', () => {
    // 1,005 x 100 dá 100,49999 no ponto flutuante.
    expect(line('1,005', '1', 'kg')).toBe('R$ 1,01 o kg');
    expect(formatPerBase(17.805, 'kg')).toBe('R$ 17,81 o kg');
  });

  it('lê o preço como todo campo de dinheiro (parseMoney) e a quantidade com parseDecimal', () => {
    expect(line('R$ 8,90', '500', 'g')).toBe('R$ 17,80 o kg');
    expect(line('8.90', '500', 'g')).toBe('R$ 17,80 o kg');
    // Dinheiro: "1.000" é mil reais.
    expect(line('1.000', '1', 'un')).toBe('R$ 1.000,00 a unidade');
    expect(line('1.234,50', '1', 'un')).toBe('R$ 1.234,50 a unidade');
    // Quantidade com vírgula, com ponto decimal e com milhar e vírgula.
    expect(line('16,50', '1,5', 'kg')).toBe('R$ 11,00 o kg');
    expect(line('16,50', '1.5', 'kg')).toBe('R$ 11,00 o kg');
    expect(line('10', '1.000,0', 'g')).toBe('R$ 10,00 o kg');
    expect(line('8', '1.000,5', 'g')).toBe('R$ 8,00 o kg');
    expect(line('10', ' 500 ', 'g')).toBe('R$ 20,00 o kg');
  });
});

describe('o que não dá para ler', () => {
  it('opção vazia ou incompleta: nada embaixo, e fica fora do resultado', () => {
    expect(line('', '', 'g')).toBeNull();
    expect(line('8,90', '', 'g')).toBeNull();
    expect(line('', '500', 'g')).toBeNull();
    expect(line('  ', '500', 'g')).toBeNull();
    expect(hint('8,90', '', 'g')).toBeNull();
    expect(readOption(opt('8,90', '', 'g'), 0)).toEqual({ ok: false, hint: null });
  });

  it('a vírgula ou o ponto no fim, no meio da digitação, já valem: nem dica, nem a opção sai do resultado', () => {
    // "8,90" passa por "8," e "1,5" por "1,": o teclado do iPhone em português só tem a vírgula.
    expect(line('8,', '500', 'g')).toBe('R$ 16,00 o kg');
    expect(hint('8,', '500', 'g')).toBeNull();
    expect(line('8.', '500', 'g')).toBe('R$ 16,00 o kg');
    expect(line('16,50', '1,', 'kg')).toBe('R$ 16,50 o kg');
    expect(hint('16,50', '1,', 'kg')).toBeNull();
    expect(line('16,50', '1.', 'kg')).toBe('R$ 16,50 o kg');
    // Com a vírgula no fim, os pontos são de milhar: "1.000," é mil, sem a dúvida de "1.000".
    expect(line('10', '1.000,', 'g')).toBe('R$ 10,00 o kg');
    expect(comparePrices([opt('8,90', '500', 'g'), opt('16,', '1', 'kg')]).sentences).toEqual([
      'A opção 2 sai 10% mais barata que a opção 1.',
    ]);
  });

  it('zero ainda está sendo digitado ("0,99", "0,5 kg"): nem dica, e fica fora do resultado', () => {
    for (const price of ['0', '0,', '0,0', '0,00', '0.']) {
      expect(line(price, '500', 'g')).toBeNull();
      expect(hint(price, '500', 'g')).toBeNull();
    }
    for (const quantity of ['0', '0,', '0,0', '0.']) {
      expect(line('8,90', quantity, 'g')).toBeNull();
      expect(hint('8,90', quantity, 'g')).toBeNull();
    }
    expect(line('0,99', '0,5', 'kg')).toBe('R$ 1,98 o kg');
    expect(comparePrices([opt('8,90', '500', 'g'), opt('0', '1', 'kg')]).sentences).toEqual([WAITING_SENTENCE]);
  });

  it('preço negativo, sem número ou que nem chega a um centavo: confira o preço, embaixo do preço', () => {
    for (const price of ['0,001', '-5', 'abc', '8,9,0', '1.5000']) {
      expect(line(price, '500', 'g')).toBeNull();
      expect(hint(price, '500', 'g')).toEqual({ field: 'price', text: PRICE_HINT });
    }
    // Mesmo com a quantidade ainda vazia: o campo digitado já está errado.
    expect(hint('-5', '', 'g')).toEqual({ field: 'price', text: PRICE_HINT });
  });

  it('quantidade negativa ou sem número: confira a quantidade, embaixo da quantidade', () => {
    for (const quantity of ['-1', 'meio', '1,5,0']) {
      expect(line('8,90', quantity, 'g')).toBeNull();
      expect(hint('8,90', quantity, 'g')).toEqual({ field: 'quantity', text: QUANTITY_HINT });
    }
    expect(hint('', '-1', 'g')).toEqual({ field: 'quantity', text: QUANTITY_HINT });
  });

  it('quantidade com ponto de milhar ("1.500") pode ser mil e quinhentos ou um e meio: a dica diz as duas leituras', () => {
    expect(hint('8,90', '1.000', 'g')?.text).toBe('Com ponto, 1.000 pode ser 1000 ou 1: escreva sem o ponto, ou com vírgula.');
    expect(hint('8,90', '1.500', 'kg')?.text).toBe('Com ponto, 1.500 pode ser 1500 ou 1,5: escreva sem o ponto, ou com vírgula.');
    expect(hint('8,90', '12.500', 'g')?.text).toBe('Com ponto, 12.500 pode ser 12500 ou 12,5: escreva sem o ponto, ou com vírgula.');
    expect(hint('8,90', '2.250', 'l')?.text).toBe('Com ponto, 2.250 pode ser 2250 ou 2,25: escreva sem o ponto, ou com vírgula.');
    // Com mais de um ponto, só há a leitura de milhar.
    expect(hint('8,90', '1.000.000', 'g')?.text).toBe('Escreva a quantidade sem os pontos: 1000000.');
    expect(ambiguousQuantityHint('1.500')).toBe(hint('8,90', '1.500', 'g')?.text);
    for (const quantity of ['1.000', '12.500', '1.000.000']) {
      expect(line('8,90', quantity, 'g')).toBeNull();
      expect(hint('8,90', quantity, 'g')?.field).toBe('quantity');
    }
    // O ponto no fim, digitando, não muda a dúvida.
    expect(hint('8,90', '1.500.', 'kg')?.text).toBe(hint('8,90', '1.500', 'kg')?.text);
    // Com zero na frente, com vírgula ou com outra quantidade de casas, não há dúvida.
    expect(line('8,90', '0.500', 'kg')).toBe('R$ 17,80 o kg');
    expect(line('8,90', '1000', 'g')).toBe('R$ 8,90 o kg');
    expect(line('8,90', '1.0', 'kg')).toBe('R$ 8,90 o kg');
  });

  it('as opções com algo a conferir ficam fora da comparação, e o resultado diz o campo a corrigir', () => {
    const result = comparePrices([opt('8,90', '500', 'g'), opt('abc', '1', 'kg')]);
    expect(result.sentences).toEqual(['Confira o preço da opção 2.']);
    expect(result.announcement).toBe('Confira o preço da opção 2.');
    expect(result.cheapest).toEqual([]);
    expect(comparePrices([opt('8,90', '1.000', 'g'), opt('16,50', '-1', 'kg')]).sentences).toEqual([
      checkSentence('quantity', 0),
      'Confira a quantidade da opção 2.',
    ]);
    // Com outras opções que se comparam, o resultado diz a comparação e também o campo a corrigir: a opção some da
    // comparação, e quem usa leitor de tela não vê a dica vermelha embaixo do campo.
    const three = comparePrices([opt('8,90', '500', 'g'), opt('16,50', '1', 'kg'), opt('abc', '1', 'kg')]);
    expect(three.sentences).toEqual(['A opção 2 sai 7% mais barata que a opção 1.', 'Confira o preço da opção 3.']);
    expect(three.cheapest).toEqual([1]);
    const thousands = comparePrices([opt('8,90', '500', 'g'), opt('16,50', '1', 'kg'), opt('9,00', '1.500', 'g')]);
    expect(thousands.announcement).toBe('A opção 2 sai 7% mais barata que a opção 1. Confira a quantidade da opção 3.');
    // Com o ranking, o campo a corrigir vem antes dele no anúncio.
    const four = comparePrices([opt('8,90', '500', 'g'), opt('16,50', '1', 'kg'), opt('4,99', '250', 'g'), opt('x', '1', 'kg')]);
    expect(four.announcement).toBe(
      'A opção 2 sai 7% mais barata que a opção 1. Confira o preço da opção 4. 1ª: opção 2, R$ 16,50 o kg. 2ª: opção 1, R$ 17,80 o kg. 3ª: opção 3, R$ 19,96 o kg.',
    );
    // Com grandezas diferentes, depois da frase do que não se compara.
    expect(comparePrices([opt('8,90', '500', 'g'), opt('2', '1', 'un'), opt('abc', '1', 'kg')]).sentences).toEqual([
      'Não dá para comparar peso (opção 1) com unidade (opção 2).',
      'Confira o preço da opção 3.',
    ]);
  });
});

describe('a comparação', () => {
  it('500 g por R$ 8,90 contra 1 kg por R$ 16,50: a opção 2 sai 7% mais barata', () => {
    const result = comparePrices([opt('8,90', '500', 'g'), opt('16,50', '1', 'kg')]);
    expect(result.cheapest).toEqual([1]);
    expect(result.sentences).toEqual(['A opção 2 sai 7% mais barata que a opção 1.']);
    expect(result.ranking).toEqual([]);
    expect(result.announcement).toBe('A opção 2 sai 7% mais barata que a opção 1.');
  });

  it('a mais barata pode ser a primeira; ml contra l', () => {
    const result = comparePrices([opt('2,60', '500', 'ml'), opt('11,90', '2', 'l')]);
    expect(result.cheapest).toEqual([0]);
    // R$ 5,20 contra R$ 5,95 o litro: 0,75 de 5,95 são 12,6%.
    expect(result.sentences).toEqual(['A opção 1 sai 13% mais barata que a opção 2.']);
  });

  it('o porcento é do preço da seguinte, inteiro, com a metade para cima', () => {
    const [a, b] = [opt('9,25', '1', 'un'), opt('10', '1', 'un')].map((o, i) => {
      const reading = readOption(o, i);
      if (!reading.ok) throw new Error('não leu');
      return reading.option;
    });
    // 0,75 de 10 = 7,5%.
    expect(percentCheaper(a, b)).toBe(8);
    expect(comparePrices([opt('10', '1', 'un'), opt('9,25', '1', 'un')]).sentences).toEqual([
      'A opção 2 sai 8% mais barata que a opção 1.',
    ]);
    expect(comparePrices([opt('10', '1', 'un'), opt('9,26', '1', 'un')]).sentences).toEqual([
      'A opção 2 sai 7% mais barata que a opção 1.',
    ]);
  });

  it('nunca "100% mais barata"', () => {
    expect(comparePrices([opt('8,90', '500', 'kg'), opt('8,90', '500', 'g')]).sentences).toEqual([
      'A opção 1 sai 99% mais barata que a opção 2.',
    ]);
  });

  it('preços iguais: "Mesmo preço", sem destaque', () => {
    const result = comparePrices([opt('8,25', '500', 'g'), opt('16,50', '1', 'kg')]);
    expect(result.sentences).toEqual(['Mesmo preço: as opções 1 e 2 saem por R$ 16,50 o kg.']);
    expect(result.cheapest).toEqual([]);
  });

  it('iguais também quando a conta não fecha no ponto flutuante (R$ 1,01 por 0,67 kg e R$ 3,03 por 2,01 kg)', () => {
    // 2,01 kg vira 2009,9999999999998 g: sem a tolerância, 101 x 2010 e 303 x 670 sairiam diferentes.
    const result = comparePrices([opt('1,01', '0,67', 'kg'), opt('3,03', '2,01', 'kg')]);
    expect(result.sentences).toEqual(['Mesmo preço: as opções 1 e 2 saem por R$ 1,51 o kg.']);
    expect(result.cheapest).toEqual([]);
  });

  it('diferentes, mas abaixo de 0,5%: "quase o mesmo preço", nunca "0%"', () => {
    const result = comparePrices([opt('10,00', '1', 'kg'), opt('9,98', '1', 'kg')]);
    expect(result.cheapest).toEqual([1]);
    expect(result.sentences).toEqual(['Quase o mesmo preço: a opção 2 sai só um pouco mais barata que a opção 1.']);
    expect(result.sentences.join(' ')).not.toContain('0%');
  });

  it('o mesmo centavo por kg na tela, mas preços diferentes: quase o mesmo preço, e não "Mesmo preço"', () => {
    // R$ 17,98 e R$ 17,99 o kg, arredondados: R$ 5,99 por 333 g é 17,987.
    const result = comparePrices([opt('5,99', '333', 'g'), opt('17,99', '1', 'kg')]);
    expect(result.sentences).toEqual(['Quase o mesmo preço: a opção 1 sai só um pouco mais barata que a opção 2.']);
  });

  it('as incompletas ficam de fora até serem preenchidas', () => {
    expect(comparePrices(initialOptions()).sentences).toEqual([WAITING_SENTENCE]);
    expect(comparePrices([opt('8,90', '500', 'g'), opt('16,50', '', 'kg')]).sentences).toEqual([WAITING_SENTENCE]);
    const three = comparePrices([opt('8,90', '500', 'g'), opt('', '', 'g'), opt('16,50', '1', 'kg')]);
    expect(three.sentences).toEqual(['A opção 3 sai 7% mais barata que a opção 1.']);
    expect(three.cheapest).toEqual([2]);
    // Duas completas não fazem ranking.
    expect(three.ranking).toEqual([]);
  });
});

describe('com 3 ou 4 opções', () => {
  it('ordena da mais barata para a mais cara, e a frase compara a mais barata com a seguinte', () => {
    const result = comparePrices([opt('8,90', '500', 'g'), opt('16,50', '1', 'kg'), opt('4,99', '250', 'g'), opt('42', '2,5', 'kg')]);
    // 17,80 · 16,50 · 19,96 · 16,80.
    expect(result.cheapest).toEqual([1]);
    expect(result.sentences).toEqual(['A opção 2 sai 2% mais barata que a opção 4.']);
    expect(result.ranking.map((r) => r.text)).toEqual([
      '1ª: opção 2, R$ 16,50 o kg',
      '2ª: opção 4, R$ 16,80 o kg',
      '3ª: opção 1, R$ 17,80 o kg',
      '4ª: opção 3, R$ 19,96 o kg',
    ]);
    expect(result.announcement).toBe(
      'A opção 2 sai 2% mais barata que a opção 4. 1ª: opção 2, R$ 16,50 o kg. 2ª: opção 4, R$ 16,80 o kg. 3ª: opção 1, R$ 17,80 o kg. 4ª: opção 3, R$ 19,96 o kg.',
    );
  });

  it('empate na mais barata: as duas em destaque, com a mesma posição', () => {
    const result = comparePrices([opt('8,25', '500', 'g'), opt('18', '1', 'kg'), opt('16,50', '1', 'kg')]);
    expect(result.cheapest).toEqual([0, 2]);
    // 16,50 contra 18,00: 1,50 de 18 são 8,3%.
    expect(result.sentences).toEqual(['As opções 1 e 3 saem pelo mesmo preço, 8% mais baratas que a opção 2.']);
    expect(result.ranking.map((r) => [r.index, r.position])).toEqual([
      [0, 1],
      [2, 1],
      [1, 3],
    ]);
  });

  it('empate na mais barata e quase o mesmo da seguinte', () => {
    const result = comparePrices([opt('10', '1', 'kg'), opt('10', '1', 'kg'), opt('10,02', '1', 'kg')]);
    expect(result.sentences).toEqual(['As opções 1 e 2 saem pelo mesmo preço, só um pouco mais baratas que a opção 3.']);
  });

  it('empate logo depois da mais barata: a frase fala das duas', () => {
    const result = comparePrices([opt('20', '1', 'kg'), opt('16', '1', 'kg'), opt('10', '500', 'g')]);
    expect(result.sentences).toEqual(['A opção 2 sai 20% mais barata que as opções 1 e 3.']);
  });

  it('todas iguais: mesmo preço, sem destaque', () => {
    const result = comparePrices([opt('10', '1', 'l'), opt('5', '500', 'ml'), opt('20', '2', 'l')]);
    expect(result.sentences).toEqual(['Mesmo preço: as opções 1, 2 e 3 saem por R$ 10,00 o litro.']);
    expect(result.cheapest).toEqual([]);
    expect(result.ranking.every((r) => r.position === 1)).toBe(true);
  });
});

describe('grandezas diferentes não se comparam', () => {
  it('kg com unidade: diz quais não se comparam, sem chutar conversão', () => {
    const result = comparePrices([opt('8,90', '500', 'g'), opt('1,40', '1', 'un')]);
    expect(result.sentences).toEqual(['Não dá para comparar peso (opção 1) com unidade (opção 2).']);
    expect(result.cheapest).toEqual([]);
  });

  it('as da mesma grandeza se comparam entre si, e a outra fica de fora', () => {
    const result = comparePrices([opt('8,90', '500', 'g'), opt('16,50', '1', 'kg'), opt('5', '1', 'l')]);
    expect(result.sentences).toEqual([
      'A opção 2 sai 7% mais barata que a opção 1.',
      'Não dá para comparar peso (opções 1 e 2) com volume (opção 3).',
    ]);
    expect(result.cheapest).toEqual([1]);
    expect(result.ranking).toEqual([]);
  });

  it('duas grandezas com duas opções cada: uma comparação para cada', () => {
    const result = comparePrices([opt('8,90', '500', 'g'), opt('2,60', '500', 'ml'), opt('16,50', '1', 'kg'), opt('11,90', '2', 'l')]);
    expect(result.sentences).toEqual([
      'A opção 3 sai 7% mais barata que a opção 1.',
      'A opção 2 sai 13% mais barata que a opção 4.',
      'Não dá para comparar peso (opções 1 e 3) com volume (opções 2 e 4).',
    ]);
    expect(result.cheapest).toEqual([1, 2]);
  });

  it('três grandezas', () => {
    const result = comparePrices([opt('8,90', '500', 'g'), opt('5', '1', 'l'), opt('1', '1', 'un')]);
    expect(result.sentences).toEqual(['Não dá para comparar peso (opção 1), volume (opção 2) e unidade (opção 3) entre si.']);
  });
});

describe('as opções', () => {
  it('cada unidade tem um nome para o leitor de tela', () => {
    expect(UNIT_SPOKEN).toEqual({ g: 'gramas', kg: 'quilos', ml: 'mililitros', l: 'litros', un: 'unidades' });
  });

  it('os nomes de cada opção para o leitor de tela', () => {
    expect(priceFieldSpoken(0)).toBe('Preço da opção 1, em reais');
    expect(quantityFieldSpoken(1)).toBe('Quantidade da opção 2');
    expect(unitGroupSpoken(2)).toBe('Unidade da opção 3');
    expect(removeOptionSpoken(3)).toBe('Remover a opção 4');
    expect(unitChipSpoken('kg', 1)).toBe('quilos, opção 2');
    expect(unitChipSpoken('l', 0)).toBe('litros, opção 1');
  });

  it('começa com duas vazias, em g', () => {
    expect(initialOptions()).toEqual([newOption('g'), newOption('g')]);
  });

  it('"+ opção" vai até 4, com a unidade da última', () => {
    let options = [opt('', '', 'g'), opt('', '', 'l')];
    options = addOption(options);
    expect(options).toHaveLength(3);
    expect(options[2]).toEqual(newOption('l'));
    options = addOption(options);
    expect(options).toHaveLength(MAX_OPTIONS);
    expect(addOption(options)).toBe(options);
  });

  it('só as opções além da segunda saem', () => {
    const options = [opt('1', '1', 'g'), opt('2', '1', 'g'), opt('3', '1', 'g'), opt('4', '1', 'g')];
    expect(canRemoveOption(0)).toBe(false);
    expect(canRemoveOption(1)).toBe(false);
    expect(canRemoveOption(2)).toBe(true);
    expect(removeOption(options, 1)).toBe(options);
    expect(removeOption(options, 2).map((o) => o.price)).toEqual(['1', '2', '4']);
    expect(removeOption(options, 9)).toBe(options);
  });
});

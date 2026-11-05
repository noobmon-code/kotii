import { describe, expect, it } from '@jest/globals';

import { textWidth, TEXT_WIDTH_SAFETY } from '../greeting';
import { TILE_LABEL_MIN, tileColumns, tileLabelFit, tileRows, type TileRowMetrics } from '../tileRow';

// Os atalhos do Resumo da Saúde: todos numa linha enquanto a palavra mais larga de cada rótulo cabe no atalho; senão
// dois por linha; senão um. Uma palavra nunca quebra no meio.

const LABELS = ['Remédio', 'Consulta', 'Vacina', 'Exame'];
// As medidas do TileGrid: 8 entre os atalhos, borda 1 e margem 4 dos dois lados, rótulo de 14.
const grid = (width: number, fontScale = 1): TileRowMetrics => ({ width, gap: 8, inset: 10, labelSize: 14, fontScale });

describe('tileColumns', () => {
  it('quatro numa linha nos celulares de 360 (320 de fileira), 375 e na janela larga', () => {
    expect(tileColumns(LABELS, grid(320))).toBe(4);
    expect(tileColumns(LABELS, grid(335))).toBe(4);
    expect(tileColumns(LABELS, grid(680))).toBe(4);
  });

  it('com a letra do aparelho maior ou a tela estreita, dois por linha; com a letra enorme, um', () => {
    expect(tileColumns(LABELS, grid(320, 1.05))).toBe(2);
    expect(tileColumns(LABELS, grid(280))).toBe(2);
    expect(tileColumns(LABELS, grid(280, 2))).toBe(2);
    expect(tileColumns(LABELS, grid(280, 3))).toBe(1);
  });

  it('com o espaço de antes (12 entre os atalhos, margem 8), "Consulta" não caberia: por isso a grade é mais justa', () => {
    expect(tileColumns(LABELS, { ...grid(320), gap: 12, inset: 18 })).toBe(2);
  });

  it('só conta a palavra mais larga, não o rótulo inteiro', () => {
    const needed = textWidth('Cardápio', 14) * TEXT_WIDTH_SAFETY;
    // Uma fileira de três em que cada atalho tem lugar para "Cardápio", mas não para "Cardápio da semana".
    const width = 3 * (needed + 10) + 2 * 8;
    expect(tileColumns(['Cardápio da semana', 'Vacina', 'Exame'], grid(width))).toBe(3);
    expect(tileColumns(['Cardápio da semana', 'Vacina', 'Exame'], grid(width - 3))).toBe(2);
  });

  it('com três rótulos tenta três, depois dois, depois um', () => {
    const three = ['Consulta', 'Vacina', 'Exame'];
    expect(tileColumns(three, grid(320))).toBe(3);
    expect(tileColumns(three, grid(160))).toBe(2);
    expect(tileColumns(three, grid(100))).toBe(1);
  });

  it('sem rótulos, uma coluna', () => {
    expect(tileColumns([], grid(320))).toBe(1);
  });
});

describe('tileRows', () => {
  it('divide em linhas', () => {
    expect(tileRows(['a', 'b', 'c', 'd'], 2)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(tileRows(['a', 'b', 'c', 'd'], 4)).toEqual([['a', 'b', 'c', 'd']]);
    expect(tileRows(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']]);
    expect(tileRows(['a', 'b'], 0)).toEqual([['a'], ['b']]);
  });
});

describe('tileLabelFit (o rótulo que vem da pessoa: o nome da lista no atalho da tela Hoje)', () => {
  // Os três atalhos da tela Hoje: 12 entre eles, borda 1 e margem 8 dos dois lados. A 360dp, 320 de fileira.
  const hojeLabel = (screen: number) => (screen - 40 - 2 * 12) / 3 - 18;
  const fit = (label: string, screen: number, fontScale = 1) => tileLabelFit(label, { width: hojeLabel(screen), size: 14, lineHeight: 18, fontScale });
  const fitsWhole = (label: string, size: number, width: number, fontScale = 1) =>
    Math.max(...label.split(' ').map((word) => textWidth(word, size))) * fontScale * TEXT_WIDTH_SAFETY <= width;

  it('o nome que cabe fica como sempre, em duas linhas no máximo, quebrando só entre as palavras', () => {
    expect(fit('Mercado', 360)).toEqual({ size: 14, lineHeight: 18, lines: 2 });
    expect(fit('Listas de compras', 360)).toEqual({ size: 14, lineHeight: 18, lines: 2 });
    expect(fit('Feira da semana', 360)).toEqual({ size: 14, lineHeight: 18, lines: 2 });
  });

  it('"Supermercado" num celular de 360 não cabe com 14: a letra diminui até a palavra caber inteira', () => {
    expect(fitsWhole('Supermercado', 14, hojeLabel(360))).toBe(false);
    const shown = fit('Supermercado', 360);
    expect(shown.lines).toBe(2);
    expect(shown.size).toBeLessThan(14);
    expect(shown.size).toBeGreaterThanOrEqual(TILE_LABEL_MIN);
    expect(fitsWhole('Supermercado', shown.size, hojeLabel(360))).toBe(true);
    // O maior tamanho em que cabe, com a linha na mesma proporção.
    expect(fitsWhole('Supermercado', shown.size + 1, hojeLabel(360))).toBe(false);
    expect(shown.lineHeight).toBe(Math.round((18 * shown.size) / 14));
    // Numa janela larga, cabe com 14.
    expect(fit('Supermercado', 720).size).toBe(14);
  });

  it('nem no menor tamanho a palavra cabe: uma linha só, cortada com "…", em vez de quebrar a palavra', () => {
    expect(fit('Hortifrutigranjeiros', 360)).toEqual({ size: TILE_LABEL_MIN, lineHeight: Math.round((18 * TILE_LABEL_MIN) / 14), lines: 1 });
    // A letra do aparelho maior também conta.
    expect(fit('Supermercado', 360, 1.3).lines).toBe(1);
  });
});

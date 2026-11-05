// Uma fileira de atalhos (Tile) que pode não caber numa linha só: a palavra de um rótulo nunca quebra no meio
// ("Consul-ta"), então os atalhos vão todos numa linha enquanto a palavra mais larga de cada rótulo cabe no seu
// atalho; senão dois por linha; senão um. Os quatro atalhos do Resumo da Saúde cabem numa linha a partir de 360dp,
// no tamanho de letra padrão. A largura de cada palavra é a da Nunito ExtraBold (textWidth), vezes o tamanho de
// letra do aparelho, com a mesma folga da saudação da tela Hoje. O rótulo que vem da pessoa (o nome da lista no atalho
// da tela Hoje) não escolhe quantos atalhos vão por linha: a letra dele diminui até a palavra mais larga caber
// (tileLabelFit), e nem assim o rótulo vai numa linha só, cortado com "…".

import { textWidth, TEXT_WIDTH_SAFETY } from './greeting';

export interface TileRowMetrics {
  /** A largura da fileira inteira. */
  width: number;
  /** O espaço entre dois atalhos. */
  gap: number;
  /** O que cada atalho tira da largura dele antes do rótulo (borda e margem dos dois lados). */
  inset: number;
  /** O tamanho da letra do rótulo. */
  labelSize: number;
  /** O tamanho de letra do aparelho (1 no padrão). */
  fontScale: number;
}

/** A largura da palavra mais larga dos rótulos, com o tamanho de letra do aparelho e a folga. */
function widestWord(labels: readonly string[], labelSize: number, fontScale: number): number {
  const words = labels.flatMap((label) => label.split(/\s+/).filter(Boolean));
  const widest = Math.max(0, ...words.map((word) => textWidth(word, labelSize)));
  return widest * (fontScale || 1) * TEXT_WIDTH_SAFETY;
}

/** Quantos atalhos por linha: todos, metade (arredondada para cima) ou um. */
export function tileColumns(labels: readonly string[], m: TileRowMetrics): number {
  if (!labels.length) return 1;
  const needed = widestWord(labels, m.labelSize, m.fontScale);
  const candidates = [...new Set([labels.length, Math.ceil(labels.length / 2), 1])];
  for (const cols of candidates) {
    if ((m.width - (cols - 1) * m.gap) / cols - m.inset >= needed) return cols;
  }
  return 1;
}

/** Os atalhos em linhas de `columns`. */
export function tileRows<T>(items: readonly T[], columns: number): T[][] {
  const size = Math.max(1, Math.floor(columns) || 1);
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

/** O menor tamanho de letra do rótulo que vem da pessoa, antes de cortá-lo com "…". */
export const TILE_LABEL_MIN = 11;

export interface TileLabelMetrics {
  /** A largura do rótulo (a do atalho sem a borda e a margem). */
  width: number;
  /** O tamanho e a altura de linha de sempre do rótulo. */
  size: number;
  lineHeight: number;
  /** O tamanho de letra do aparelho (1 no padrão). */
  fontScale: number;
}

export interface TileLabelFit {
  size: number;
  lineHeight: number;
  /** 2: quebra só entre as palavras; 1: nem no menor tamanho a palavra cabe, e o rótulo é cortado com "…". */
  lines: 1 | 2;
}

/**
 * O tamanho do rótulo que vem da pessoa ("Supermercado" num atalho de 80 pontos de largura): o maior, de `size` até
 * TILE_LABEL_MIN, em que a palavra mais larga cabe no atalho, para ela nunca quebrar no meio ("Supermerca-do"); nem
 * no menor, uma linha só, cortada com "…" no fim. O rótulo que cabe fica como sempre.
 */
export function tileLabelFit(label: string, m: TileLabelMetrics): TileLabelFit {
  for (let size = m.size; size >= TILE_LABEL_MIN; size--) {
    if (widestWord([label], size, m.fontScale) <= m.width) {
      return { size, lineHeight: size === m.size ? m.lineHeight : Math.round((m.lineHeight * size) / m.size), lines: 2 };
    }
  }
  return { size: TILE_LABEL_MIN, lineHeight: Math.round((m.lineHeight * TILE_LABEL_MIN) / m.size), lines: 1 };
}

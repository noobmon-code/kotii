import { describe, expect, it } from '@jest/globals';

import { GRADIENTS, PALETTES, type Colors } from '../theme';

// Contraste de texto do tema (WCAG): 4,5:1 para texto pequeno, nos dois temas. Só pares de cores lisas; o vidro
// translúcido depende do que há por trás e não entra aqui.
const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const MIN = 4.5;

// [texto, fundo]: o texto de cada tom sobre o fundo em que ele aparece.
const PAIRS: [keyof Colors, keyof Colors][] = [
  ['text', 'background'],
  ['text', 'surface'],
  ['text', 'surfaceAlt'],
  ['textMuted', 'background'],
  ['textMuted', 'surface'],
  ['primary', 'background'],
  ['primary', 'surface'],
  ['onPrimary', 'primary'],
  ['danger', 'dangerSoft'],
  ['warning', 'warningSoft'],
  ['info', 'infoSoft'],
  ['primary', 'primarySoft'],
];

describe.each(['light', 'dark'] as const)('o tema %s', (scheme) => {
  const palette = PALETTES[scheme];

  it.each(PAIRS)('%s sobre %s tem contraste de texto', (fg, bg) => {
    expect(contrast(palette[fg] as string, palette[bg] as string)).toBeGreaterThanOrEqual(MIN);
  });

  it('os textos do topo e o título têm contraste nas duas pontas do gradiente', () => {
    for (const gradient of Object.values(GRADIENTS[scheme])) {
      for (const end of [gradient.from, gradient.to]) {
        expect(contrast(gradient.eyebrow, end)).toBeGreaterThanOrEqual(MIN);
        expect(contrast(gradient.subtitle, end)).toBeGreaterThanOrEqual(MIN);
        expect(contrast(palette.text, end)).toBeGreaterThanOrEqual(MIN);
      }
    }
  });
});

describe('os dois temas', () => {
  it('têm as mesmas cores', () => {
    expect(Object.keys(PALETTES.dark).sort()).toEqual(Object.keys(PALETTES.light).sort());
  });

  it('têm os mesmos gradientes', () => {
    expect(Object.keys(GRADIENTS.dark).sort()).toEqual(Object.keys(GRADIENTS.light).sort());
  });
});

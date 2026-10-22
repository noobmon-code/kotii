import { describe, expect, it } from '@jest/globals';

import { SKIES } from '@/domain/sky';
import { washStops } from '@/features/SkyHeader';
import { GRADIENTS, PALETTES, withAlpha, type Colors } from '../theme';

// Contraste de texto do tema (WCAG): 4,5:1 para texto pequeno, nos dois temas. Os pares de cores lisas, e os de
// vidro e véus que o desenho usa, com o vidro posto sobre o fundo liso da tela (o que há por trás na maior parte).
//
// Exceção conhecida, escolha do desenho que não passa e fica para o dono decidir:
// - o aro vazio do "Marcar" (`CheckCircle`, `ring`) sobre o vidro forte: 1,6:1 no claro e 2,7:1 no escuro, abaixo
//   dos 3:1 de um contorno.
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

/** A cor `fg` (#RRGGBB ou rgba) por cima de `bg` (#RRGGBB): a cor lisa que se vê. */
const over = (fg: string, bg: string) => {
  const rgba = fg.match(/rgba\(([^)]+)\)/);
  const [r, g, b, a] = rgba
    ? rgba[1].split(',').map(Number)
    : [1, 3, 5].map((i) => parseInt(fg.slice(i, i + 2), 16)).concat(1);
  const back = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16));
  return `#${[r, g, b].map((v, i) => Math.round(v * a + back[i] * (1 - a)).toString(16).padStart(2, '0')).join('')}`;
};

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
  // Os títulos de seção (`Section`) e o desenho laranja.
  ['brand', 'background'],
  ['brand', 'surface'],
  ['brand', 'brandSoft'],
];

describe.each(['light', 'dark'] as const)('o tema %s', (scheme) => {
  const palette = PALETTES[scheme];

  it.each(PAIRS)('%s sobre %s tem contraste de texto', (fg, bg) => {
    expect(contrast(palette[fg] as string, palette[bg] as string)).toBeGreaterThanOrEqual(MIN);
  });

  it('os textos sobre o vidro têm contraste: linhas dos cartões, a barra de abas e a aba aberta', () => {
    const glass = over(palette.glass, palette.background);
    const glassStrong = over(palette.glassStrong, palette.background);
    // Linhas dos cartões: título, texto de baixo e o "atrasada" da dose; o título de seção sobre o vidro.
    for (const fg of [palette.text, palette.textMuted, palette.warning, palette.brand]) {
      expect(contrast(fg, glass)).toBeGreaterThanOrEqual(MIN);
    }
    // A barra de abas: as abas fechadas, e a aberta no destaque azul a 12%; "Ver a agenda" na pílula.
    expect(contrast(palette.textMuted, glassStrong)).toBeGreaterThanOrEqual(MIN);
    expect(contrast(palette.primary, over(withAlpha(palette.primary, 0.12), glassStrong))).toBeGreaterThanOrEqual(MIN);
    expect(contrast(palette.primary, glassStrong)).toBeGreaterThanOrEqual(MIN);
  });

  it('o selo neutro tem contraste', () => {
    expect(contrast(palette.textMuted, palette.surfaceAlt)).toBeGreaterThanOrEqual(MIN);
  });

  it('o texto do topo da tela Hoje tem contraste onde o véu do céu é mais forte', () => {
    for (const sky of SKIES) {
      for (const stop of washStops(sky, scheme === 'dark')) {
        const veil = over(withAlpha(stop.color, stop.opacity ?? 1), palette.background);
        expect(contrast(palette.text, veil)).toBeGreaterThanOrEqual(MIN);
        // "Ver a agenda", na pílula de vidro sobre o véu.
        expect(contrast(palette.primary, over(palette.glassStrong, veil))).toBeGreaterThanOrEqual(MIN);
      }
    }
  });

  it('o tom de informação é o azul, longe do caramelo do aviso', () => {
    expect([palette.info, palette.infoSoft]).toEqual([palette.primary, palette.primarySoft]);
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

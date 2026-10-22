import { describe, expect, it } from '@jest/globals';

import { SKIES } from '@/domain/sky';
import { cssGradientLine, type GradientStop } from '@/ui/gradient';
import { MAX_WIDTH } from '@/ui/theme';
import { WASH_HEIGHT, washEdges, washStops } from '../SkyHeader';

describe('washStops', () => {
  it.each([false, true])('o véu de cada céu (escuro: %s) começa no canto e some, com as paradas em ordem', (dark) => {
    for (const sky of SKIES) {
      const stops = washStops(sky, dark);
      expect(stops).toHaveLength(3);
      expect(stops.map((s) => s.offset)).toEqual([...stops.map((s) => s.offset)].sort((a, b) => a - b));
      expect(stops[0].offset).toBe(0);
      expect(stops[2].opacity).toBe(0);
      for (const stop of stops) expect(stop.color).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it('o céu de poucas nuvens é o do desenho da tela', () => {
    expect(washStops('poucas-nuvens', false)).toEqual([
      { offset: 0, color: '#FFE9A8', opacity: 0.25 },
      { offset: 0.155, color: '#74D6FB', opacity: 0.5 },
      { offset: 0.62, color: '#74D6FB', opacity: 0 },
    ]);
  });
});

/** A opacidade de um gradiente na posição `t` (0 a 1) da linha dele. */
const opacityAt = (stops: readonly GradientStop[], t: number) => {
  if (t <= stops[0].offset) return stops[0].opacity ?? 1;
  for (let i = 1; i < stops.length; i++) {
    const [a, b] = [stops[i - 1], stops[i]];
    if (t <= b.offset) return (a.opacity ?? 1) + (((b.opacity ?? 1) - (a.opacity ?? 1)) * (t - a.offset)) / (b.offset - a.offset);
  }
  return stops[stops.length - 1].opacity ?? 1;
};

/** Onde o ponto (x, y) cai na linha do gradiente de `angle` graus, numa caixa de `width` x `height`. */
const positionAt = (angle: number, width: number, height: number, x: number, y: number) => {
  const line = cssGradientLine(angle, width, height);
  const [dx, dy] = [line.x2 - line.x1, line.y2 - line.y1];
  return ((x - line.x1) * dx + (y - line.y1) * dy) / (dx * dx + dy * dy);
};

describe('o véu em tela larga', () => {
  it.each([320, 360, 390, 414, 434, MAX_WIDTH])('no celular e até a largura da coluna (%i), nada muda', (width) => {
    expect(washEdges(width, '#FAF8F5')).toEqual([]);
  });

  it('mais larga que a coluna, o véu some na cor do fundo nos lados e no pé', () => {
    for (const width of [MAX_WIDTH + 1, 1024, 1440]) {
      const [sides, foot] = washEdges(width, '#121420');
      expect(sides.angle).toBe(90);
      expect(sides.stops.map((s) => s.opacity)).toEqual([1, 0, 0, 1]);
      expect(foot.angle).toBe(180);
      expect(foot.stops.map((s) => s.opacity)).toEqual([0, 1]);
      expect([...sides.stops, ...foot.stops].every((s) => s.color === '#121420')).toBe(true);
    }
  });

  it.each([false, true])('com o esmaecimento, o véu (escuro: %s) não deixa linha na borda da coluna nem no pé', (dark) => {
    const layers = washEdges(1440, '#FAF8F5');
    // O que aparece do véu num ponto: a opacidade dele, coberta pelo fundo na medida de cada esmaecimento.
    const visible = (stops: GradientStop[], x: number, y: number) =>
      layers.reduce(
        (shown, layer) => shown * (1 - opacityAt(layer.stops, positionAt(layer.angle, MAX_WIDTH, WASH_HEIGHT, x, y))),
        opacityAt(stops, positionAt(227, MAX_WIDTH, WASH_HEIGHT, x, y)),
      );
    for (const sky of SKIES) {
      const stops = washStops(sky, dark);
      // Sem os esmaecimentos, a borda direita da coluna tem véu de sobra (a linha dura).
      expect(opacityAt(stops, positionAt(227, MAX_WIDTH, WASH_HEIGHT, MAX_WIDTH, WASH_HEIGHT / 2))).toBeGreaterThan(0.1);
      for (let y = 0; y <= WASH_HEIGHT; y += 10) {
        expect(visible(stops, 0, y)).toBeCloseTo(0, 6);
        expect(visible(stops, MAX_WIDTH, y)).toBeCloseTo(0, 6);
      }
      for (let x = 0; x <= MAX_WIDTH; x += 5) expect(visible(stops, x, WASH_HEIGHT)).toBeCloseTo(0, 6);
    }
  });
});

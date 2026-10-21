import { describe, expect, it } from '@jest/globals';

import { SKIES } from '@/domain/sky';
import { washStops } from '../SkyHeader';

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

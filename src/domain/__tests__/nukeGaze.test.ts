import { describe, expect, it } from '@jest/globals';

import { centerOf, GAZE_HOLD_MS, GAZE_READ_MS, gazeAt, gazeHoldMs, gazeToward, sameGaze } from '../nukeGaze';

describe('para onde o Nuke olha', () => {
  it('o olhar é a direção do centro dele ao centro da mensagem, de tamanho 1', () => {
    expect(gazeToward({ x: 0, y: 0 }, { x: 30, y: 40 })).toEqual({ x: 0.6, y: 0.8 });
    expect(gazeToward({ x: 100, y: 50 }, { x: 100, y: 500 })).toEqual({ x: 0, y: 1 });
    expect(gazeToward({ x: 100, y: 50 }, { x: 10, y: 50 })).toEqual({ x: -1, y: 0 });
  });

  it('a mensagem de quem escreve fica à direita e a do Nuke à esquerda: os olhos vão para lados opostos', () => {
    const nuke = { x: 150, y: 20, width: 44, height: 44 };
    const mine = gazeAt(nuke, { x: 200, y: 400, width: 140, height: 44 })!;
    const theirs = gazeAt(nuke, { x: 52, y: 400, width: 120, height: 60 })!;
    expect(mine.x).toBeGreaterThan(0);
    expect(theirs.x).toBeLessThan(0);
    expect(mine.y).toBeGreaterThan(0.9);
    expect(theirs.y).toBeGreaterThan(0.9);
    for (const gaze of [mine, theirs]) expect(Math.hypot(gaze.x, gaze.y)).toBeCloseTo(1, 1);
  });

  it('duas medidas quase iguais dão o mesmo olhar (centésimos), e nunca um zero negativo', () => {
    const a = gazeToward({ x: 0, y: 0 }, { x: 100, y: 300 });
    const b = gazeToward({ x: 0, y: 0 }, { x: 100.4, y: 300.9 });
    expect(sameGaze(a, b)).toBe(true);
    expect(Object.is(gazeToward({ x: 5, y: 0 }, { x: 5, y: 90 })!.x, 0)).toBe(true);
  });

  it('sem para onde olhar: alvo em cima dele, medida que não é número, mensagem ainda sem tamanho', () => {
    expect(gazeToward({ x: 10, y: 10 }, { x: 11, y: 12 })).toBeNull();
    expect(gazeToward({ x: 10, y: 10 }, { x: Number.NaN, y: 12 })).toBeNull();
    expect(gazeToward({ x: 10, y: 10 }, { x: Number.POSITIVE_INFINITY, y: 12 })).toBeNull();
    const nuke = { x: 150, y: 20, width: 44, height: 44 };
    expect(gazeAt(nuke, { x: 0, y: 0, width: 0, height: 0 })).toBeNull();
    expect(gazeAt({ ...nuke, width: 0 }, { x: 0, y: 300, width: 100, height: 40 })).toBeNull();
  });

  it('o centro de um retângulo e a comparação de dois olhares', () => {
    expect(centerOf({ x: 10, y: 20, width: 100, height: 40 })).toEqual({ x: 60, y: 40 });
    expect(sameGaze(null, null)).toBe(true);
    expect(sameGaze(null, { x: 0, y: 1 })).toBe(false);
    expect(sameGaze({ x: 0.6, y: 0.8 }, { x: 0.6, y: 0.8 })).toBe(true);
    expect(sameGaze({ x: 0.6, y: 0.8 }, { x: -0.6, y: 0.8 })).toBe(false);
  });

  it('a resposta dele, ele olha por alguns segundos; a mensagem de quem escreve, só o tempo de ler', () => {
    expect(gazeHoldMs('assistant')).toBe(GAZE_HOLD_MS);
    expect(gazeHoldMs('user')).toBe(GAZE_READ_MS);
    expect(GAZE_HOLD_MS).toBeGreaterThanOrEqual(3000);
    expect(GAZE_HOLD_MS).toBeLessThanOrEqual(10000);
    expect(GAZE_READ_MS).toBeGreaterThanOrEqual(800);
    expect(GAZE_READ_MS).toBeLessThan(GAZE_HOLD_MS);
  });
});

import { describe, expect, it } from '@jest/globals';

import { cssGradientLine } from '../gradient';

describe('cssGradientLine', () => {
  it('180° desce pelo meio, de ponta a ponta da altura', () => {
    const line = cssGradientLine(180, 100, 200);
    expect(line.x1).toBeCloseTo(50);
    expect(line.x2).toBeCloseTo(50);
    expect(line.y1).toBeCloseTo(0);
    expect(line.y2).toBeCloseTo(200);
  });

  it('90° vai para a direita, de ponta a ponta da largura', () => {
    const line = cssGradientLine(90, 100, 200);
    expect(line.x1).toBeCloseTo(0);
    expect(line.x2).toBeCloseTo(100);
    expect(line.y1).toBeCloseTo(100);
    expect(line.y2).toBeCloseTo(100);
  });

  it('numa caixa quadrada, 135° vai do canto de cima à esquerda ao de baixo à direita', () => {
    const line = cssGradientLine(135, 100, 100);
    expect(line.x1).toBeCloseTo(0);
    expect(line.y1).toBeCloseTo(0);
    expect(line.x2).toBeCloseTo(100);
    expect(line.y2).toBeCloseTo(100);
  });

  it('o primeiro e o último ponto tocam os cantos, em qualquer ângulo', () => {
    // 227° (o véu do topo de Hoje) parte do canto de cima à direita e termina no de baixo à esquerda, só passando
    // por fora da caixa quando ela não é quadrada.
    const line = cssGradientLine(227, 390, 760);
    const length = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
    const rad = (227 * Math.PI) / 180;
    expect(length).toBeCloseTo(Math.abs(390 * Math.sin(rad)) + Math.abs(760 * Math.cos(rad)));
    expect((line.x1 + line.x2) / 2).toBeCloseTo(195);
    expect((line.y1 + line.y2) / 2).toBeCloseTo(380);
    expect(line.x1).toBeGreaterThan(195);
    expect(line.y1).toBeLessThan(380);
  });
});

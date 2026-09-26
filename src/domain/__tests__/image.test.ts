import { describe, expect, it } from '@jest/globals';

import { fitForVision, MAX_LONG_EDGE, MAX_PIXELS } from '../image';

describe('fitForVision', () => {
  it('keeps small images untouched', () => {
    expect(fitForVision(1200, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it('caps the long edge of a long receipt', () => {
    const { width, height } = fitForVision(1000, 5000);
    expect(height).toBe(MAX_LONG_EDGE);
    expect(width).toBe(515);
  });

  it('caps total pixels of a 12 MP phone photo', () => {
    const { width, height } = fitForVision(3000, 4000);
    expect(width * height).toBeLessThanOrEqual(MAX_PIXELS);
    expect(Math.max(width, height)).toBeLessThanOrEqual(MAX_LONG_EDGE);
    expect(width / height).toBeCloseTo(0.75, 2);
  });
});

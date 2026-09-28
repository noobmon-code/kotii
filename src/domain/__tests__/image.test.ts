import { describe, expect, it } from '@jest/globals';

import { fitForProductPhoto, fitForVision, MAX_LONG_EDGE, MAX_PIXELS } from '../image';

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

describe('fitForProductPhoto', () => {
  it('reduz o lado maior para 900 px, sem ampliar', () => {
    expect(fitForProductPhoto(3000, 4000)).toEqual({ width: 675, height: 900 });
    expect(fitForProductPhoto(4000, 3000)).toEqual({ width: 900, height: 675 });
    expect(fitForProductPhoto(600, 800)).toEqual({ width: 600, height: 800 });
  });
});

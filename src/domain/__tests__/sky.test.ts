import { describe, expect, it } from '@jest/globals';

import { currentSky, dayPeriodOf, defaultSky, HEAVY_RAIN_MM, skyFromCode } from '../sky';
import type { Forecast, WeatherHour } from '../weather';

const hour = (time: string, code: number | null, rain: number | null = null): WeatherHour => ({
  time,
  temp: 20,
  humidity: 60,
  rainChance: 10,
  rain,
  gusts: 10,
  uv: 3,
  code,
});

describe('dayPeriodOf', () => {
  it('dia das 6h às 18h, noite no resto', () => {
    expect([5, 6, 12, 17, 18, 23, 0].map(dayPeriodOf)).toEqual(['noite', 'dia', 'dia', 'dia', 'noite', 'noite', 'noite']);
  });
});

describe('skyFromCode', () => {
  it('céu limpo, poucas nuvens, parcial e nublado', () => {
    expect([0, 1, 2, 3].map((code) => skyFromCode(code))).toEqual(['limpo', 'poucas-nuvens', 'parcialmente-nublado', 'nublado']);
  });

  it('neblina e neve contam como nublado', () => {
    expect([45, 48, 71, 75, 77, 85, 86].map((code) => skyFromCode(code))).toEqual(Array(7).fill('nublado'));
  });

  it('garoa, chuva e pancadas são chuva; a forte pelo código ou pelos milímetros', () => {
    expect([51, 53, 55, 56, 61, 63, 66, 67, 80, 81].map((code) => skyFromCode(code))).toEqual(Array(10).fill('chuva'));
    expect([65, 82].map((code) => skyFromCode(code))).toEqual(['chuva-forte', 'chuva-forte']);
    expect(skyFromCode(63, HEAVY_RAIN_MM)).toBe('chuva-forte');
    expect(skyFromCode(63, HEAVY_RAIN_MM - 0.1)).toBe('chuva');
  });

  it('temporal é tempestade', () => {
    expect([95, 96, 99].map((code) => skyFromCode(code))).toEqual(Array(3).fill('tempestade'));
  });

  it('sem código, o céu do desenho', () => {
    expect(skyFromCode(null)).toBe('poucas-nuvens');
  });
});

describe('currentSky', () => {
  const forecast: Forecast = {
    hours: [hour('2026-10-21T14:00', 61, 1), hour('2026-10-21T15:00', 65), hour('2026-10-21T22:00', 0)],
    days: [],
    utcOffsetSeconds: -10800,
  };

  it('o céu da hora da casa', () => {
    // 15h em São Paulo = 18h UTC.
    expect(currentSky(forecast, new Date('2026-10-21T18:10:00Z'))).toEqual({ sky: 'chuva-forte', period: 'dia' });
    expect(currentSky(forecast, new Date('2026-10-22T01:30:00Z'))).toEqual({ sky: 'limpo', period: 'noite' });
  });

  it('null sem previsão ou sem a hora', () => {
    expect(currentSky(undefined)).toBeNull();
    expect(currentSky({ ...forecast, hours: [] })).toBeNull();
    expect(currentSky(forecast, new Date('2026-10-21T10:00:00Z'))).toBeNull();
  });
});

describe('defaultSky', () => {
  it('de dia, poucas nuvens; à noite, limpo', () => {
    expect(defaultSky(new Date(2026, 9, 21, 10))).toEqual({ sky: 'poucas-nuvens', period: 'dia' });
    expect(defaultSky(new Date(2026, 9, 21, 22))).toEqual({ sky: 'limpo', period: 'noite' });
  });
});

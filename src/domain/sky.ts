// O céu de agora, para o desenho do clima no topo da tela Hoje: um de sete tipos, de dia ou de noite, tirado da
// previsão hora a hora da casa (código WMO do Open-Meteo). Sem previsão, o céu é o do desenho de exemplo.

import { houseClock, type Forecast } from './weather';

export type Sky = 'limpo' | 'poucas-nuvens' | 'parcialmente-nublado' | 'nublado' | 'chuva' | 'chuva-forte' | 'tempestade';
export type DayPeriod = 'dia' | 'noite';

export const SKIES: readonly Sky[] = ['limpo', 'poucas-nuvens', 'parcialmente-nublado', 'nublado', 'chuva', 'chuva-forte', 'tempestade'];

/** Dia das 6h às 18h; o resto é noite. */
export function dayPeriodOf(hour: number): DayPeriod {
  return hour >= 6 && hour < 18 ? 'dia' : 'noite';
}

/** Chuva na hora (mm) a partir da qual a chuva é forte, mesmo com o código de chuva comum. */
export const HEAVY_RAIN_MM = 4;

/**
 * O céu de um código WMO. Neblina e neve (rara por aqui) contam como nublado; pancadas e chuva congelante como
 * chuva; temporal (95 a 99) é tempestade. `rain` (mm na hora) torna forte uma chuva que o código diz comum.
 */
export function skyFromCode(code: number | null, rain: number | null = null): Sky {
  if (code === null) return 'poucas-nuvens';
  if (code === 0) return 'limpo';
  if (code === 1) return 'poucas-nuvens';
  if (code === 2) return 'parcialmente-nublado';
  if (code === 3 || code === 45 || code === 48) return 'nublado';
  if (code >= 95) return 'tempestade';
  if (code === 65 || code === 82) return 'chuva-forte';
  const rainy = (code >= 51 && code <= 67) || (code >= 80 && code <= 82);
  if (rainy) return (rain ?? 0) >= HEAVY_RAIN_MM ? 'chuva-forte' : 'chuva';
  // 71 a 77 e 85 e 86: neve.
  return 'nublado';
}

/** O céu e o período da hora da casa agora; null quando a previsão não tem essa hora. */
export function currentSky(forecast: Forecast | undefined, now: Date = new Date()): { sky: Sky; period: DayPeriod } | null {
  if (!forecast?.hours.length) return null;
  const { date, hour } = houseClock(forecast, now);
  const stamp = `${date}T${String(hour).padStart(2, '0')}:00`;
  const entry = forecast.hours.find((h) => h.time === stamp);
  if (!entry) return null;
  return { sky: skyFromCode(entry.code, entry.rain), period: dayPeriodOf(hour) };
}

/** Sem previsão (casa sem bairro, sem internet e nada guardado): o céu do desenho, claro de dia e limpo à noite. */
export function defaultSky(now: Date = new Date()): { sky: Sky; period: DayPeriod } {
  const period = dayPeriodOf(now.getHours());
  return { sky: period === 'dia' ? 'poucas-nuvens' : 'limpo', period };
}

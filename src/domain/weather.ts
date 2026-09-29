// Dicas do clima: frases curtas e úteis para a casa ("hoje é dia de lavar
// roupa", "o jardim vai ser regado pela chuva"), tiradas da previsão hora a
// hora do bairro (Open-Meteo) por regras fixas, sem IA. A tela Hoje mostra
// as do dia; o aviso das 7h leva a mais importante (ver weatherMornings).

import type { IconName } from './categories';
import { addDays, toISODate } from './dates';
import { normalizeSearch } from './search';

// ---------------------------------------------------------------------------
// Previsão

export interface WeatherHour {
  /** Hora local da casa, "AAAA-MM-DDTHH:MM". */
  time: string;
  temp: number | null;
  /** Umidade relativa, %. */
  humidity: number | null;
  /** Chance de chuva na hora, %. */
  rainChance: number | null;
  /** Chuva na hora, mm. */
  rain: number | null;
  /** Rajadas de vento, km/h. */
  gusts: number | null;
  uv: number | null;
  /** Código WMO do tempo (95–99: temporal). */
  code: number | null;
}

export interface WeatherDay {
  date: string;
  max: number | null;
  min: number | null;
  /** Chuva no dia, mm. */
  rain: number | null;
  rainChance: number | null;
}

export interface Forecast {
  hours: WeatherHour[];
  days: WeatherDay[];
  /** Fuso da casa (os horários acima são locais dela); null se a resposta não trouxe. */
  utcOffsetSeconds: number | null;
}

/** Variáveis pedidas ao Open-Meteo (a resposta vem nestes nomes). */
export const FORECAST_HOURLY = [
  'temperature_2m',
  'relative_humidity_2m',
  'precipitation_probability',
  'precipitation',
  'wind_gusts_10m',
  'uv_index',
  'weather_code',
] as const;
export const FORECAST_DAILY = ['temperature_2m_max', 'temperature_2m_min', 'precipitation_sum', 'precipitation_probability_max'] as const;
/** Ontem (para "depois da chuva"), hoje e os dois próximos dias. */
export const FORECAST_PAST_DAYS = 1;
export const FORECAST_DAYS = 3;

function numbers(block: unknown, key: string, length: number): (number | null)[] {
  const values = (block as Record<string, unknown> | undefined)?.[key];
  return Array.from({ length }, (_, i) => {
    const value = Array.isArray(values) ? values[i] : null;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  });
}

function times(block: unknown): string[] {
  const values = (block as { time?: unknown } | undefined)?.time;
  return Array.isArray(values) ? values.filter((t): t is string => typeof t === 'string') : [];
}

/** Resposta do Open-Meteo (horários locais, timezone=auto) na forma que as regras usam. */
export function parseForecast(json: unknown): Forecast {
  const { hourly, daily, utc_offset_seconds: offset } = (json ?? {}) as { hourly?: unknown; daily?: unknown; utc_offset_seconds?: unknown };
  const hourTimes = times(hourly);
  const [temp, humidity, rainChance, rain, gusts, uv, code] = FORECAST_HOURLY.map((key) => numbers(hourly, key, hourTimes.length));
  const dayTimes = times(daily);
  const [max, min, dayRain, dayChance] = FORECAST_DAILY.map((key) => numbers(daily, key, dayTimes.length));
  return {
    hours: hourTimes.map((time, i) => ({
      time,
      temp: temp[i],
      humidity: humidity[i],
      rainChance: rainChance[i],
      rain: rain[i],
      gusts: gusts[i],
      uv: uv[i],
      code: code[i],
    })),
    days: dayTimes.map((date, i) => ({ date, max: max[i], min: min[i], rain: dayRain[i], rainChance: dayChance[i] })),
    utcOffsetSeconds: typeof offset === 'number' && Number.isFinite(offset) ? offset : null,
  };
}

/**
 * Dia e hora de agora na casa, pelo fuso da previsão: quem está viajando, ou
 * casa em outro fuso (Manaus, Rio Branco), vê as dicas do dia certo de lá.
 * Sem o fuso, vale o do aparelho.
 */
export function houseClock(forecast: Forecast, now: Date = new Date()): { date: string; hour: number } {
  // Previsão guardada antes de o fuso ser lido não tem o campo.
  if (typeof forecast.utcOffsetSeconds !== 'number') return { date: toISODate(now), hour: now.getHours() };
  const local = new Date(now.getTime() + forecast.utcOffsetSeconds * 1000);
  return { date: local.toISOString().slice(0, 10), hour: local.getUTCHours() };
}

// ---------------------------------------------------------------------------
// Dicas

/** O que a casa tem e muda a dica: pets, crianças, jardim (tarefa de regar) e carro. */
export interface WeatherContext {
  /** Nomes dos pets da casa. */
  pets: string[];
  kids: boolean;
  /** Próxima rega marcada (a mais cedo, AAAA-MM-DD), se a casa tem tarefa de regar. */
  wateringDueOn: string | null;
  car: boolean;
}

export type WeatherTipKey =
  | 'temporal'
  | 'vento'
  | 'jardim'
  | 'recolher'
  | 'calor'
  | 'frio'
  | 'ar_seco'
  | 'chuva'
  | 'roupa'
  | 'regar'
  | 'dengue'
  | 'uv'
  | 'umido'
  | 'carro';

export interface WeatherTip {
  key: WeatherTipKey;
  icon: IconName;
  title: string;
  body: string;
  /** Maior primeiro: segurança, depois o que muda o dia, por fim o que é bom saber. */
  priority: number;
}

/** Abaixo disto a dica aparece na tela, mas não vira aviso de manhã. */
export const NOTIFY_MIN_PRIORITY = 40;

const LAUNDRY_FROM = 8;
const LAUNDRY_UNTIL = 17;
const DAYTIME_FROM = 10;
const DAYTIME_UNTIL = 18;
const NIGHT_FROM = 20;
const NIGHT_UNTIL = 7;

const WATERING = /\b(regar|rega|regue|aguar|irrigar|irrigacao)\b/;

/** Tarefa de regar plantas, jardim ou horta (pelo título: "Regar as plantas", "Rega do jardim"). */
export function isWateringChore(title: string): boolean {
  return WATERING.test(normalizeSearch(title));
}

const hourOf = (time: string) => Number(time.slice(11, 13));
const round = (n: number) => Math.round(n);
const fmtMm = (mm: number) => `${mm < 10 ? mm.toFixed(1).replace('.', ',').replace(',0', '') : round(mm)} mm`;

/** Hora com chuva de verdade: chuva prevista, e não só uma chance pequena. */
function wet(h: WeatherHour): boolean {
  const mm = h.rain ?? 0;
  return mm >= 0.5 || (mm >= 0.1 && (h.rainChance ?? 0) >= 60);
}

function maxOf(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? Math.max(...known) : null;
}

function minOf(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? Math.min(...known) : null;
}

function avgOf(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null;
}

function sumOf(values: (number | null)[]): number {
  return values.reduce<number>((a, b) => a + (b ?? 0), 0);
}

/** "o Thor", "a Mel e o Thor" soaria errado sem saber o gênero: só os nomes. */
function petNames(pets: string[]): string {
  if (pets.length === 1) return pets[0];
  if (pets.length === 2) return `${pets[0]} e ${pets[1]}`;
  return 'os pets';
}

/**
 * Dicas do dia `date`, da mais importante para a menos. `fromHour`: a
 * partir de que hora olhar (hoje, a hora de agora; o aviso da manhã, 7).
 * `dayWord`: como chamar o dia no texto ("Hoje", "Amanhã").
 */
export function weatherTips(
  forecast: Forecast,
  { date, fromHour, dayWord, context }: { date: string; fromHour: number; dayWord: string; context: WeatherContext },
): WeatherTip[] {
  const day = forecast.hours.filter((h) => h.time.startsWith(date));
  const ahead = day.filter((h) => hourOf(h.time) >= fromHour);
  // Sem a previsão do resto do dia, nada a dizer.
  if (!ahead.length) return [];
  const lower = dayWord.toLowerCase();
  const tips: WeatherTip[] = [];
  const add = (tip: WeatherTip) => tips.push(tip);
  const between = (from: number, until: number) => ahead.filter((h) => hourOf(h.time) >= from && hourOf(h.time) <= until);

  const rainAhead = sumOf(ahead.map((h) => h.rain));
  const wetHours = ahead.filter(wet);
  const maxTemp = maxOf(ahead.map((h) => h.temp));
  const maxGusts = maxOf(ahead.map((h) => h.gusts));
  const maxUv = maxOf(between(DAYTIME_FROM, 16).map((h) => h.uv));
  const daytime = between(DAYTIME_FROM, DAYTIME_UNTIL);
  const minHumidity = minOf(daytime.map((h) => h.humidity));
  const avgHumidity = avgOf(daytime.map((h) => h.humidity));

  // Temporal e vento forte: o que pode estragar algo vem primeiro.
  const storm = ahead.find((h) => h.code !== null && h.code >= 95);
  if (storm) {
    add({
      key: 'temporal',
      icon: 'weather-lightning-rainy',
      title: `${dayWord} tem temporal previsto, por volta das ${hourOf(storm.time)}h`,
      body: 'Feche as janelas, recolha a roupa do varal e tire da tomada os aparelhos mais sensíveis.',
      priority: 100,
    });
  } else if (maxGusts !== null && maxGusts >= 60) {
    add({
      key: 'vento',
      icon: 'weather-windy',
      title: `Vento forte ${lower}: rajadas de até ${round(maxGusts)} km/h`,
      body: 'Feche as janelas e recolha ou prenda o que estiver no varal e na varanda.',
      priority: 95,
    });
  }

  // Jardim: só quando a casa tem tarefa de regar.
  if (context.wateringDueOn && rainAhead >= 5) {
    const due = context.wateringDueOn <= date;
    add({
      key: 'jardim',
      icon: 'sprout-outline',
      title: `${dayWord} o jardim vai ser regado pela chuva`,
      body: due ? `Previsão de ${fmtMm(rainAhead)} de chuva: dá para pular a rega.` : `Previsão de ${fmtMm(rainAhead)} de chuva.`,
      priority: due ? 90 : 45,
    });
  } else if (context.wateringDueOn && context.wateringDueOn <= date && maxTemp !== null && maxTemp >= 30 && rainAhead < 1) {
    add({
      key: 'regar',
      icon: 'watering-can-outline',
      title: 'Calor e nada de chuva: regue no fim da tarde',
      body: 'Com o sol forte, a água evapora antes de chegar às raízes e as folhas molhadas podem queimar.',
      priority: 45,
    });
  }

  // Chuva que chega depois de um começo seco: recolher a roupa a tempo.
  const firstWet = wetHours[0];
  if (firstWet) {
    const at = hourOf(firstWet.time);
    const dryBefore = between(Math.max(fromHour, LAUNDRY_FROM), at - 1);
    if (at >= 11 && at <= 20 && dryBefore.length >= 2) {
      add({
        key: 'recolher',
        icon: 'tshirt-crew-outline',
        title: `Roupa no varal? Recolha antes das ${at}h`,
        body: `A chuva deve chegar por volta das ${at}h.`,
        priority: 85,
      });
    }
  }

  if (maxTemp !== null && maxTemp >= 32) {
    add(
      context.pets.length
        ? {
            key: 'calor',
            icon: 'paw',
            title: `Calor de ${round(maxTemp)}° ${lower}: água fresca e sombra para ${petNames(context.pets)}`,
            body: 'Deixe mais de um pote de água e evite passeios no asfalto quente entre 10h e 16h.',
            priority: 70,
          }
        : {
            key: 'calor',
            icon: 'thermometer-high',
            title: `Calor de ${round(maxTemp)}° ${lower}`,
            body: 'Beba água, feche as cortinas do lado do sol e abra as janelas quando esfriar.',
            priority: 70,
          },
    );
  }

  // Noite fria: das 20h às 7h do dia seguinte.
  const nextDay = addDays(date, 1);
  const night = forecast.hours.filter(
    (h) => (h.time.startsWith(date) && hourOf(h.time) >= NIGHT_FROM) || (h.time.startsWith(nextDay) && hourOf(h.time) <= NIGHT_UNTIL),
  );
  const nightMin = minOf(night.map((h) => h.temp));
  if (nightMin !== null && nightMin <= 12) {
    const care = [context.kids ? 'Cobertor extra para as crianças' : 'Separe o cobertor', context.pets.length ? 'um cantinho quente para os pets' : null]
      .filter(Boolean)
      .join(' e ');
    add({
      key: 'frio',
      icon: 'snowflake',
      title: `${dayWord} à noite faz ${round(nightMin)}°`,
      body: `${care}. Feche as janelas antes de dormir.`,
      priority: 65,
    });
  }

  if (minHumidity !== null && minHumidity <= 30) {
    add({
      key: 'ar_seco',
      icon: 'water-percent',
      title: `Ar muito seco ${lower}: ${round(minHumidity)}% de umidade à tarde`,
      body: 'Beba água, deixe uma toalha molhada ou uma bacia com água no quarto e evite exercício entre 10h e 16h.',
      priority: 60,
    });
  }

  if (wetHours.length >= 2 && rainAhead >= 2) {
    const peak = wetHours.reduce((a, b) => ((b.rain ?? 0) > (a.rain ?? 0) ? b : a));
    add({
      key: 'chuva',
      icon: 'umbrella-outline',
      title: `${dayWord} é dia de guarda-chuva`,
      body: `Previsão de ${fmtMm(rainAhead)} de chuva, mais forte por volta das ${hourOf(peak.time)}h.`,
      priority: 55,
    });
  }

  // Dia de lavar roupa: sem chuva até o fim da tarde, ar não muito úmido,
  // sem vento forte e com tempo para secar.
  const laundry = between(Math.max(fromHour, LAUNDRY_FROM), LAUNDRY_UNTIL);
  const laundryHumidity = avgOf(laundry.map((h) => h.humidity));
  const laundryTemp = maxOf(laundry.map((h) => h.temp));
  const laundryGusts = maxOf(laundry.map((h) => h.gusts));
  if (
    laundry.length >= 5 &&
    laundry.every((h) => !wet(h) && (h.rainChance ?? 0) < 40) &&
    laundryHumidity !== null &&
    laundryHumidity <= 70 &&
    (laundryGusts ?? 0) < 50 &&
    (laundryTemp ?? 0) >= 18
  ) {
    const quick = laundryHumidity <= 55 && (laundryTemp ?? 0) >= 24;
    const why = `sem chuva até o fim da tarde e umidade de ${round(laundryHumidity)}%.`;
    add({
      key: 'roupa',
      icon: 'washing-machine',
      title: `${dayWord} é dia de lavar roupa`,
      body: quick ? `Seca rápido: ${why}` : `${why.charAt(0).toUpperCase()}${why.slice(1)}`,
      priority: 50,
    });
  }

  // Depois da chuva, sol e calor: água parada vira criadouro da dengue.
  const yesterday = forecast.hours.filter((h) => h.time.startsWith(addDays(date, -1)));
  const rainYesterday = sumOf(yesterday.map((h) => h.rain));
  const rainToday = sumOf(day.map((h) => h.rain));
  if (yesterday.length && rainYesterday >= 5 && rainToday < 1 && (maxOf(day.map((h) => h.temp)) ?? 0) >= 25) {
    add({
      key: 'dengue',
      icon: 'bug-outline',
      title: 'Depois da chuva, caça à água parada',
      body: 'Vire baldes e garrafas e olhe vasos, calhas e ralos: água parada vira criadouro do mosquito da dengue.',
      priority: 40,
    });
  }

  if (maxUv !== null && maxUv >= 8) {
    add({
      key: 'uv',
      icon: 'white-balance-sunny',
      title: `Sol forte ${lower}: índice UV ${round(maxUv)}`,
      body: 'Protetor solar e chapéu entre 10h e 16h.',
      priority: 35,
    });
  }

  if (!wetHours.length && avgHumidity !== null && avgHumidity >= 85) {
    add({
      key: 'umido',
      icon: 'water-outline',
      title: 'Tempo úmido: a roupa demora a secar',
      body: 'Estenda num lugar ventilado e deixe os armários abertos um pouco para não criar mofo.',
      priority: 20,
    });
  }

  // Carro: sem chuva hoje nem amanhã, a lavagem dura.
  if (context.car && !wetHours.length && rainAhead < 1) {
    const tomorrow = forecast.hours.filter((h) => h.time.startsWith(nextDay));
    if (tomorrow.length >= 20 && !tomorrow.some(wet) && sumOf(tomorrow.map((h) => h.rain)) < 1) {
      add({
        key: 'carro',
        icon: 'car-wash',
        title: `${dayWord} dá para lavar o carro`,
        body: 'Sem chuva prevista para hoje nem para amanhã.',
        priority: 15,
      });
    }
  }

  return tips.sort((a, b) => b.priority - a.priority);
}

/** Idade até a qual a pessoa conta como criança nas dicas (cobertor extra). */
const KID_MAX_AGE = 12;

/** O que a casa tem, a partir das fichas, das tarefas e dos aparelhos. */
export function weatherContext(
  people: { kind: string; name: string; birth_date: string | null }[],
  chores: { title: string; due_on: string; active: boolean }[],
  equipment: { category: string }[],
  today: string,
): WeatherContext {
  const [y, m, d] = today.split('-').map(Number);
  const kidSince = `${y - KID_MAX_AGE - 1}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const watering = chores.filter((c) => c.active && isWateringChore(c.title)).map((c) => c.due_on).sort();
  return {
    pets: people.filter((p) => p.kind === 'pet').map((p) => p.name),
    kids: people.some((p) => p.kind === 'pessoa' && p.birth_date !== null && p.birth_date > kidSince),
    wateringDueOn: watering[0] ?? null,
    car: equipment.some((e) => e.category === 'veiculo'),
  };
}

/** De que dia falar agora: o de hoje até as 18h; depois, o de amanhã. */
export function tipsDay(date: string, hour: number): { date: string; fromHour: number; dayWord: string } {
  return hour < 18 ? { date, fromHour: hour, dayWord: 'Hoje' } : { date: addDays(date, 1), fromHour: 7, dayWord: 'Amanhã' };
}

/** Resumo do dia para o topo da tela do clima. */
export function daySummary(forecast: Forecast, date: string): { max: number | null; min: number | null; rain: number; rainChance: number | null } | null {
  const day = forecast.days.find((d) => d.date === date);
  const hours = forecast.hours.filter((h) => h.time.startsWith(date));
  if (!day && !hours.length) return null;
  return {
    max: day?.max ?? maxOf(hours.map((h) => h.temp)),
    min: day?.min ?? minOf(hours.map((h) => h.temp)),
    rain: day?.rain ?? sumOf(hours.map((h) => h.rain)),
    rainChance: day?.rainChance ?? maxOf(hours.map((h) => h.rainChance)),
  };
}

/** "Máx 31° · mín 19° · chuva de 18 mm (70%)". */
export function describeSummary(summary: NonNullable<ReturnType<typeof daySummary>>): string {
  const parts = [
    summary.max !== null ? `máx ${round(summary.max)}°` : null,
    summary.min !== null ? `mín ${round(summary.min)}°` : null,
    summary.rain >= 0.5
      ? `chuva de ${fmtMm(summary.rain)}${summary.rainChance !== null ? ` (${round(summary.rainChance)}%)` : ''}`
      : 'sem chuva',
  ].filter(Boolean);
  const text = parts.join(' · ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------------------
// Aviso da manhã

export const WEATHER_REMINDER_TIME = '07:00';
const WEATHER_REMINDER_HOUR = 7;

export interface WeatherMorning {
  date: string;
  title: string;
  body: string;
}

/**
 * Um aviso por manhã (hoje, se ainda não deu 7h, e os próximos dias da
 * previsão), com a dica mais importante do dia; sem dica que valha o aviso,
 * a manhã fica em silêncio.
 */
export function weatherMornings(forecast: Forecast, context: WeatherContext, today: string): WeatherMorning[] {
  const dates = [...new Set(forecast.hours.map((h) => h.time.slice(0, 10)))].filter((d) => d >= today).sort();
  return dates.flatMap((date) => {
    // O dia precisa estar inteiro na previsão, das 7h à noite.
    const hours = forecast.hours.filter((h) => h.time.startsWith(date) && hourOf(h.time) >= WEATHER_REMINDER_HOUR);
    if (hours.length < 14) return [];
    const [top] = weatherTips(forecast, { date, fromHour: WEATHER_REMINDER_HOUR, dayWord: 'Hoje', context }).filter(
      (tip) => tip.priority >= NOTIFY_MIN_PRIORITY,
    );
    return top ? [{ date, title: top.title, body: top.body }] : [];
  });
}

// ---------------------------------------------------------------------------
// Local da casa

/** Coordenadas guardadas: duas casas decimais, cerca de 1 km (o bairro, não o endereço). */
export const roundCoordinate = (value: number) => Math.round(value * 100) / 100;

/** "01310-100", "01310100" → "01310100"; null se não tem 8 dígitos. */
export function normalizeCep(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  return digits.length === 8 ? digits : null;
}

/** Máscara do campo: "01310100" → "01310-100". */
export function maskCep(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

/** "Pinheiros, São Paulo"; sem bairro, só a cidade. */
export function placeLabel(neighborhood: string | null | undefined, city: string | null | undefined): string | null {
  const bairro = neighborhood?.trim();
  const cidade = city?.trim();
  if (bairro && cidade && normalizeSearch(bairro) !== normalizeSearch(cidade)) return `${bairro}, ${cidade}`;
  return cidade || bairro || null;
}

/** Resultado de busca do OpenStreetMap (Nominatim, format=jsonv2, addressdetails=1). */
export interface OsmPlace {
  lat: string;
  lon: string;
  addresstype?: string;
  address?: Record<string, string | undefined>;
}

const NEIGHBORHOOD_TYPES = new Set(['suburb', 'neighbourhood', 'quarter', 'city_district', 'residential', 'borough']);

export function osmCity(address: OsmPlace['address']): string | null {
  return address?.city ?? address?.town ?? address?.village ?? address?.municipality ?? null;
}

export function osmNeighborhood(address: OsmPlace['address']): string | null {
  return address?.suburb ?? address?.neighbourhood ?? address?.quarter ?? address?.city_district ?? null;
}

/**
 * O ponto do bairro entre os resultados da busca "bairro, cidade, UF": só
 * vale o que é mesmo naquela cidade (há bairros de mesmo nome em outras) e,
 * nela, o próprio bairro antes de uma rua ou prédio com o nome dele.
 */
export function pickNeighborhood(results: OsmPlace[], neighborhood: string, city: string): { latitude: number; longitude: number } | null {
  const want = normalizeSearch(city);
  const bairro = normalizeSearch(neighborhood);
  const inCity = results.filter((r) => {
    const found = osmCity(r.address);
    return found !== null && normalizeSearch(found) === want && Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lon));
  });
  const inNeighborhood = inCity.filter((r) => {
    const found = osmNeighborhood(r.address);
    return found !== null && normalizeSearch(found) === bairro;
  });
  const best =
    inNeighborhood.find((r) => NEIGHBORHOOD_TYPES.has(r.addresstype ?? '')) ?? inNeighborhood[0] ?? inCity.find((r) => NEIGHBORHOOD_TYPES.has(r.addresstype ?? ''));
  return best ? { latitude: Number(best.lat), longitude: Number(best.lon) } : null;
}

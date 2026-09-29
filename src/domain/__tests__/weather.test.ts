import { describe, expect, it } from '@jest/globals';

import {
  daySummary,
  houseClock,
  describeSummary,
  isWateringChore,
  maskCep,
  normalizeCep,
  parseForecast,
  pickNeighborhood,
  placeLabel,
  roundCoordinate,
  tipsDay,
  weatherContext,
  weatherMornings,
  weatherTips,
  type Forecast,
  type WeatherContext,
  type WeatherHour,
} from '../weather';

const TODAY = '2026-09-29';
const YESTERDAY = '2026-09-28';
const TOMORROW = '2026-09-30';

const home: WeatherContext = { pets: [], kids: false, wateringDueOn: null, car: false };

/** Um dia ameno e sem chuva; cada dia pode mudar algumas horas. */
function forecast(days: Record<string, (hour: number) => Partial<WeatherHour>>): Forecast {
  const hours = Object.entries(days).flatMap(([date, change]) =>
    Array.from({ length: 24 }, (_, hour) => ({
      time: `${date}T${String(hour).padStart(2, '0')}:00`,
      temp: hour < 7 || hour > 19 ? 17 : 24,
      humidity: hour < 7 || hour > 19 ? 80 : 60,
      rainChance: 5,
      rain: 0,
      gusts: 20,
      uv: hour >= 10 && hour <= 15 ? 6 : 1,
      code: 1,
      ...change(hour),
    })),
  );
  return { hours, days: [], utcOffsetSeconds: -10800 };
}

const calm = () => ({});
const tips = (f: Forecast, context: Partial<WeatherContext> = {}, fromHour = 7, date = TODAY) =>
  weatherTips(f, { date, fromHour, dayWord: 'Hoje', context: { ...home, ...context } });
const keys = (list: { key: string }[]) => list.map((t) => t.key);

describe('previsão do Open-Meteo', () => {
  it('lê as horas e os dias, com valores faltando como null', () => {
    const parsed = parseForecast({
      utc_offset_seconds: -10800,
      hourly: {
        time: ['2026-09-29T00:00', '2026-09-29T01:00'],
        temperature_2m: [18.2, null],
        relative_humidity_2m: [80, 82],
        precipitation_probability: [10],
        precipitation: [0, 0.4],
        wind_gusts_10m: [20.5, 18],
        uv_index: [0, 0],
        weather_code: [3, 61],
      },
      daily: {
        time: ['2026-09-29'],
        temperature_2m_max: [30.2],
        temperature_2m_min: [18],
        precipitation_sum: [18.4],
        precipitation_probability_max: [70],
      },
    });
    expect(parsed.hours).toEqual([
      { time: '2026-09-29T00:00', temp: 18.2, humidity: 80, rainChance: 10, rain: 0, gusts: 20.5, uv: 0, code: 3 },
      { time: '2026-09-29T01:00', temp: null, humidity: 82, rainChance: null, rain: 0.4, gusts: 18, uv: 0, code: 61 },
    ]);
    expect(parsed.days).toEqual([{ date: '2026-09-29', max: 30.2, min: 18, rain: 18.4, rainChance: 70 }]);
    expect(parsed.utcOffsetSeconds).toBe(-10800);
  });

  it('resposta sem dados vira previsão vazia', () => {
    expect(parseForecast(null)).toEqual({ hours: [], days: [], utcOffsetSeconds: null });
    expect(parseForecast({ error: true, reason: 'x' })).toEqual({ hours: [], days: [], utcOffsetSeconds: null });
  });
});

describe('dicas do clima', () => {
  it('dia seco, sem vento e sem chuva é dia de lavar roupa', () => {
    const [tip] = tips(forecast({ [TODAY]: calm }));
    expect(tip).toMatchObject({ key: 'roupa', title: 'Hoje é dia de lavar roupa' });
    expect(tip.body).toBe('Sem chuva até o fim da tarde e umidade de 60%.');
  });

  it('com sol e ar seco, a roupa seca rápido', () => {
    const [tip] = tips(forecast({ [TODAY]: (h) => (h >= 8 && h <= 17 ? { humidity: 45, temp: 27 } : {}) }));
    expect(tip.body).toBe('Seca rápido: sem chuva até o fim da tarde e umidade de 45%.');
  });

  it('não é dia de lavar roupa com ar úmido, vento forte ou pouco tempo de sol pela frente', () => {
    expect(keys(tips(forecast({ [TODAY]: () => ({ humidity: 78 }) })))).not.toContain('roupa');
    expect(keys(tips(forecast({ [TODAY]: (h) => (h === 14 ? { gusts: 55 } : {}) })))).not.toContain('roupa');
    // Às 14h, sobram só 4 horas até as 17h.
    expect(keys(tips(forecast({ [TODAY]: calm }), {}, 14))).not.toContain('roupa');
  });

  it('chuva à tarde depois de uma manhã seca: recolher a roupa antes, e guarda-chuva', () => {
    const list = tips(forecast({ [TODAY]: (h) => (h >= 15 && h <= 18 ? { rain: 2, rainChance: 80 } : {}) }));
    expect(keys(list)).toEqual(['recolher', 'chuva']);
    expect(list[0]).toMatchObject({ title: 'Roupa no varal? Recolha antes das 15h', body: 'A chuva deve chegar por volta das 15h.' });
    expect(list[1].body).toBe('Previsão de 8 mm de chuva, mais forte por volta das 15h.');
  });

  it('chance pequena de garoa não conta como chuva', () => {
    expect(keys(tips(forecast({ [TODAY]: (h) => (h === 15 ? { rain: 0.1, rainChance: 30 } : {}) })))).toEqual(['roupa']);
  });

  it('chuva e tarefa de regar: o jardim vai ser regado pela chuva', () => {
    const rainy = forecast({ [TODAY]: (h) => (h >= 9 && h <= 12 ? { rain: 3, rainChance: 90 } : {}) });
    const [due] = tips(rainy, { wateringDueOn: TODAY });
    expect(due).toMatchObject({
      key: 'jardim',
      title: 'Hoje o jardim vai ser regado pela chuva',
      body: 'Previsão de 12 mm de chuva: dá para pular a rega.',
      priority: 90,
    });
    // Rega marcada para outro dia: só informa, sem pedir para pular.
    const later = tips(rainy, { wateringDueOn: TOMORROW }).find((t) => t.key === 'jardim');
    expect(later).toMatchObject({ body: 'Previsão de 12 mm de chuva.', priority: 45 });
    // Sem jardim na casa (nenhuma tarefa de regar), nada de jardim.
    expect(keys(tips(rainy))).not.toContain('jardim');
  });

  it('calor sem chuva no dia da rega: regar no fim da tarde', () => {
    const hot = forecast({ [TODAY]: (h) => (h >= 11 && h <= 16 ? { temp: 31 } : {}) });
    expect(keys(tips(hot, { wateringDueOn: TODAY }))).toContain('regar');
    expect(keys(tips(hot))).not.toContain('regar');
  });

  it('temporal vem antes de tudo, com a hora', () => {
    const list = tips(forecast({ [TODAY]: (h) => (h === 19 ? { code: 95, rain: 6, rainChance: 90 } : {}) }));
    expect(list[0]).toMatchObject({ key: 'temporal', title: 'Hoje tem temporal previsto, por volta das 19h' });
  });

  it('vento forte sem temporal', () => {
    const list = tips(forecast({ [TODAY]: (h) => (h === 16 ? { gusts: 72.4 } : {}) }));
    expect(list[0]).toMatchObject({ key: 'vento', title: 'Vento forte hoje: rajadas de até 72 km/h' });
  });

  it('calor com pets: água e sombra para eles, pelo nome', () => {
    const hot = forecast({ [TODAY]: (h) => (h >= 12 && h <= 15 ? { temp: 33.6 } : {}) });
    expect(tips(hot, { pets: ['Thor'] }).find((t) => t.key === 'calor')?.title).toBe('Calor de 34° hoje: água fresca e sombra para Thor');
    expect(tips(hot, { pets: ['Thor', 'Mel', 'Bidu'] }).find((t) => t.key === 'calor')?.title).toBe(
      'Calor de 34° hoje: água fresca e sombra para os pets',
    );
    expect(tips(hot).find((t) => t.key === 'calor')?.title).toBe('Calor de 34° hoje');
  });

  it('calor só conta das horas que faltam', () => {
    const hot = forecast({ [TODAY]: (h) => (h >= 12 && h <= 15 ? { temp: 33 } : {}) });
    expect(keys(tips(hot, {}, 17))).not.toContain('calor');
  });

  it('noite fria: cobertor extra para as crianças e canto quente para os pets', () => {
    const cold = forecast({ [TODAY]: (h) => (h >= 20 ? { temp: 11 } : {}), [TOMORROW]: (h) => (h <= 7 ? { temp: 8.6 } : {}) });
    const tip = tips(cold, { kids: true, pets: ['Mel'] }).find((t) => t.key === 'frio');
    expect(tip).toMatchObject({
      title: 'Hoje à noite faz 9°',
      body: 'Cobertor extra para as crianças e um cantinho quente para os pets. Feche as janelas antes de dormir.',
    });
    expect(tips(cold).find((t) => t.key === 'frio')?.body).toBe('Separe o cobertor. Feche as janelas antes de dormir.');
  });

  it('ar muito seco à tarde', () => {
    const dry = forecast({ [TODAY]: (h) => (h >= 13 && h <= 17 ? { humidity: 24 } : {}) });
    expect(tips(dry).find((t) => t.key === 'ar_seco')?.title).toBe('Ar muito seco hoje: 24% de umidade à tarde');
  });

  it('depois de um dia de chuva, dia quente e seco: água parada e dengue', () => {
    const after = forecast({
      [YESTERDAY]: (h) => (h >= 14 && h <= 17 ? { rain: 4, rainChance: 90 } : {}),
      [TODAY]: (h) => (h >= 12 && h <= 15 ? { temp: 28 } : {}),
    });
    expect(keys(tips(after))).toContain('dengue');
    expect(keys(tips(forecast({ [TODAY]: (h) => (h >= 12 && h <= 15 ? { temp: 28 } : {}) })))).not.toContain('dengue');
  });

  it('sol forte pede protetor', () => {
    const sunny = forecast({ [TODAY]: (h) => (h === 12 ? { uv: 10.4 } : {}) });
    expect(tips(sunny).find((t) => t.key === 'uv')?.title).toBe('Sol forte hoje: índice UV 10');
  });

  it('tempo úmido sem chuva: a roupa demora a secar', () => {
    const humid = forecast({ [TODAY]: () => ({ humidity: 90 }) });
    expect(keys(tips(humid))).toEqual(['umido']);
  });

  it('carro: só quando a casa tem um e não chove hoje nem amanhã', () => {
    const dry = forecast({ [TODAY]: calm, [TOMORROW]: calm });
    expect(keys(tips(dry, { car: true }))).toContain('carro');
    expect(keys(tips(dry))).not.toContain('carro');
    const rainTomorrow = forecast({ [TODAY]: calm, [TOMORROW]: (h) => (h === 10 ? { rain: 3, rainChance: 80 } : {}) });
    expect(keys(tips(rainTomorrow, { car: true }))).not.toContain('carro');
  });

  it('o dia pode ser chamado de "Amanhã"', () => {
    const f = forecast({ [TOMORROW]: calm });
    expect(weatherTips(f, { date: TOMORROW, fromHour: 7, dayWord: 'Amanhã', context: home })[0].title).toBe('Amanhã é dia de lavar roupa');
  });

  it('sem a previsão do dia, nenhuma dica', () => {
    expect(tips(forecast({ [TOMORROW]: calm }))).toEqual([]);
  });

  it('tarefa de regar pelo título', () => {
    expect(isWateringChore('Regar as plantas')).toBe(true);
    expect(isWateringChore('Rega do jardim')).toBe(true);
    expect(isWateringChore('Aguar a horta')).toBe(true);
    expect(isWateringChore('Limpar o vaso sanitário')).toBe(false);
    expect(isWateringChore('Cortar a grama')).toBe(false);
  });
});

describe('aviso da manhã', () => {
  // Instante em que o aviso toca (o dia e a hora vêm no relógio do aparelho).
  const instant = (m: { date: string; time: string }) => new Date(`${m.date}T${m.time}`).toISOString();

  it('um por dia, às 7h da casa, com a dica mais importante; dia sem dica que valha o aviso fica em silêncio', () => {
    const f = forecast({
      [TODAY]: calm,
      [TOMORROW]: (h) => (h === 12 ? { uv: 9, humidity: 90 } : { humidity: 90 }),
      '2026-10-01': (h) => (h >= 15 && h <= 17 ? { rain: 3, rainChance: 90 } : {}),
    });
    // 5h da manhã na casa (UTC-3).
    const mornings = weatherMornings(f, home, new Date('2026-09-29T08:00:00Z'));
    expect(mornings.map((m) => [instant(m), m.title, m.body])).toEqual([
      ['2026-09-29T10:00:00.000Z', 'Hoje é dia de lavar roupa', 'Sem chuva até o fim da tarde e umidade de 60%.'],
      ['2026-10-01T10:00:00.000Z', 'Roupa no varal? Recolha antes das 15h', 'A chuva deve chegar por volta das 15h.'],
    ]);
  });

  it('quem viaja recebe o aviso na manhã da casa, e os dias contam pelo calendário de lá', () => {
    const f = forecast({ [TODAY]: calm, [TOMORROW]: calm });
    // 23h30 na casa, já dia 30 em Lisboa: amanhã, na casa, ainda é dia 30.
    const mornings = weatherMornings(f, home, new Date('2026-09-30T02:30:00Z'));
    expect(mornings.map(instant)).toEqual(['2026-09-29T10:00:00.000Z', '2026-09-30T10:00:00.000Z']);
  });

  it('sem o fuso na previsão, 7h do aparelho', () => {
    const f = forecast({ [TODAY]: calm });
    f.utcOffsetSeconds = null;
    expect(weatherMornings(f, home, new Date(2026, 8, 29, 5, 0))).toMatchObject([{ date: TODAY, time: '07:00' }]);
  });

  it('dias que já passaram e dia incompleto na previsão ficam de fora', () => {
    const f = forecast({ [YESTERDAY]: calm, [TODAY]: calm });
    f.hours = f.hours.filter((h) => h.time < `${TODAY}T12:00`);
    expect(weatherMornings(f, home, new Date('2026-09-29T15:00:00Z'))).toEqual([]);
  });
});

describe('local da casa', () => {
  it('CEP com ou sem traço', () => {
    expect(normalizeCep('05422-010')).toBe('05422010');
    expect(normalizeCep('0542201')).toBeNull();
    expect(maskCep('05422010')).toBe('05422-010');
    expect(maskCep('0542')).toBe('0542');
    expect(maskCep('05422-0109')).toBe('05422-010');
  });

  it('nome do lugar: bairro e cidade, ou só a cidade', () => {
    expect(placeLabel('Pinheiros', 'São Paulo')).toBe('Pinheiros, São Paulo');
    expect(placeLabel('', 'Brasília')).toBe('Brasília');
    expect(placeLabel('Brasília', 'Brasília')).toBe('Brasília');
    expect(placeLabel(null, null)).toBeNull();
  });

  it('coordenadas guardadas com cerca de 1 km', () => {
    expect(roundCoordinate(-23.5672842)).toBe(-23.57);
    expect(roundCoordinate(-46.701939)).toBe(-46.7);
  });

  it('o ponto do bairro vem da cidade certa, o próprio bairro antes de uma rua com o nome dele', () => {
    const results = [
      { lat: '-22.9', lon: '-43.2', addresstype: 'suburb', address: { suburb: 'Pinheiros', city: 'Outra Cidade' } },
      { lat: '-23.5672842', lon: '-46.701939', addresstype: 'railway', address: { suburb: 'Pinheiros', city: 'São Paulo' } },
      { lat: '-23.5635704', lon: '-46.6857037', addresstype: 'suburb', address: { suburb: 'Pinheiros', city: 'São Paulo' } },
    ];
    expect(pickNeighborhood(results, 'Pinheiros', 'Sao Paulo')).toEqual({ latitude: -23.5635704, longitude: -46.6857037 });
    expect(pickNeighborhood(results.slice(0, 2), 'Pinheiros', 'São Paulo')).toEqual({ latitude: -23.5672842, longitude: -46.701939 });
    expect(pickNeighborhood(results.slice(0, 1), 'Pinheiros', 'São Paulo')).toBeNull();
  });
});

describe('o que a casa tem', () => {
  it('pets, crianças (até 12 anos), tarefa de regar mais próxima e carro', () => {
    const context = weatherContext(
      [
        { kind: 'pet', name: 'Thor', birth_date: null },
        { kind: 'pessoa', name: 'Ana', birth_date: '1990-01-01' },
        { kind: 'pessoa', name: 'Bia', birth_date: '2014-09-30' },
      ],
      [
        { title: 'Regar as plantas', due_on: '2026-10-02', active: true },
        { title: 'Rega do jardim', due_on: '2026-09-30', active: true },
        { title: 'Regar a horta', due_on: '2026-09-01', active: false },
        { title: 'Lavar o banheiro', due_on: '2026-09-29', active: true },
      ],
      [{ category: 'veiculo' }],
      TODAY,
    );
    expect(context).toEqual({ pets: ['Thor'], kids: true, wateringDueOn: '2026-09-30', car: true });
  });

  it('13 anos já não conta como criança; sem ficha, sem tarefa e sem carro, nada', () => {
    expect(weatherContext([{ kind: 'pessoa', name: 'Bia', birth_date: '2013-09-29' }], [], [], TODAY)).toEqual({
      pets: [],
      kids: false,
      wateringDueOn: null,
      car: false,
    });
  });

  it('até as 18h fala de hoje; depois, de amanhã', () => {
    expect(tipsDay(TODAY, 9)).toEqual({ date: TODAY, fromHour: 9, dayWord: 'Hoje' });
    expect(tipsDay(TODAY, 18)).toEqual({ date: TOMORROW, fromHour: 7, dayWord: 'Amanhã' });
  });
});

describe('resumo do dia', () => {
  it('máxima, mínima e chuva, do dia da previsão ou das horas', () => {
    const f = forecast({ [TODAY]: (h) => (h === 15 ? { rain: 4.2, rainChance: 70 } : {}) });
    expect(describeSummary(daySummary(f, TODAY)!)).toBe('Máx 24° · mín 17° · chuva de 4,2 mm (70%)');
    f.days = [{ date: TODAY, max: 31.4, min: 18.6, rain: 0.2, rainChance: 10 }];
    expect(describeSummary(daySummary(f, TODAY)!)).toBe('Máx 31° · mín 19° · sem chuva');
    expect(daySummary(f, TOMORROW)).toBeNull();
  });
});

describe('dia e hora na casa', () => {
  const at = new Date('2026-09-30T02:30:00Z');
  it('pelo fuso da previsão, e não pelo do celular', () => {
    expect(houseClock({ hours: [], days: [], utcOffsetSeconds: -10800 }, at)).toEqual({ date: '2026-09-29', hour: 23 });
    // Manaus, uma hora a menos que Brasília.
    expect(houseClock({ hours: [], days: [], utcOffsetSeconds: -14400 }, at)).toEqual({ date: '2026-09-29', hour: 22 });
    expect(houseClock({ hours: [], days: [], utcOffsetSeconds: 3600 }, at)).toEqual({ date: '2026-09-30', hour: 3 });
  });

  it('sem o fuso, vale o do aparelho', () => {
    const now = new Date(2026, 8, 29, 14, 10);
    expect(houseClock({ hours: [], days: [], utcOffsetSeconds: null }, now)).toEqual({ date: '2026-09-29', hour: 14 });
    // Previsão guardada no aparelho antes de o fuso ser lido.
    expect(houseClock({ hours: [], days: [] } as unknown as Forecast, now)).toEqual({ date: '2026-09-29', hour: 14 });
  });
});

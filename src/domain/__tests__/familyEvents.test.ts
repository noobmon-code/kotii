import { describe, expect, it } from '@jest/globals';

import {
  ageText,
  birthdaysIn,
  bringText,
  calendarEntries,
  calendarLines,
  dayChangeOf,
  describeDayChange,
  driversOf,
  entryDetail,
  entryShortDetail,
  eventDatesIn,
  eventReminderTexts,
  formatTimeRange,
  isEventDate,
  NO_DAY_CHANGE,
  normalizeDayChange,
  occurrencesOf,
  parseTime,
  recurrenceHint,
  rideText,
  dayChangesAfterSave,
  staleDayDates,
  todayEntries,
  validateEventForm,
  type EventDayLike,
  type EventForm,
  type EventSeries,
  type FamilyCalendar,
  type FamilyEventLike,
  type PersonLike,
} from '../familyEvents';

// 12/10/2026 é uma segunda-feira.
const series = (patch: Partial<EventSeries>): EventSeries => ({ starts_on: '2026-10-12', recurrence: 'none', weekdays: null, until_on: null, ...patch });

const people: PersonLike[] = [
  { id: 'ana', name: 'Ana', kind: 'pessoa', birth_date: '2018-10-14' },
  { id: 'beto', name: 'Beto', kind: 'pessoa', birth_date: null },
  { id: 'carla', name: 'Carla', kind: 'pessoa', birth_date: null },
  { id: 'vo', name: 'Vó Maria', kind: 'pessoa', birth_date: null },
  { id: 'rex', name: 'Rex', kind: 'pet', birth_date: '2020-10-13' },
];

const swim: FamilyEventLike = {
  id: 'natacao',
  title: 'Natação da Ana',
  starts_on: '2026-10-13',
  start_time: '16:00',
  end_time: '17:00',
  person_id: 'ana',
  take_by: 'beto',
  pick_up_by: 'carla',
  location: 'Clube',
  bring: 'touca e toalha',
  recurrence: 'weekly',
  weekdays: [2, 4],
  until_on: null,
};

const day = (patch: Partial<EventDayLike>): EventDayLike => ({ ...NO_DAY_CHANGE, event_id: 'natacao', occurs_on: '2026-10-15', ...patch });

describe('eventDatesIn', () => {
  it('sem repetição: só o dia, se estiver no intervalo', () => {
    expect(eventDatesIn(series({}), '2026-10-01', '2026-10-31')).toEqual(['2026-10-12']);
    expect(eventDatesIn(series({}), '2026-10-13', '2026-10-31')).toEqual([]);
    // "Até" de um compromisso que não repete não vale nada.
    expect(eventDatesIn(series({ until_on: '2026-10-12' }), '2026-10-12', '2026-10-12')).toEqual(['2026-10-12']);
  });

  it('toda semana em vários dias, começando no meio da semana', () => {
    // Começa numa quarta, às terças e quintas: a primeira vez é a quinta.
    const weekly = series({ starts_on: '2026-10-14', recurrence: 'weekly', weekdays: [2, 4] });
    expect(eventDatesIn(weekly, '2026-10-12', '2026-10-25')).toEqual(['2026-10-15', '2026-10-20', '2026-10-22']);
    expect(isEventDate(weekly, '2026-10-13')).toBe(false);
    expect(isEventDate(weekly, '2026-10-20')).toBe(true);
    expect(isEventDate(weekly, '2026-10-21')).toBe(false);
  });

  it('todo mês no dia 31: último dia nos meses curtos, 29 no fevereiro bissexto', () => {
    const monthly = series({ starts_on: '2027-10-31', recurrence: 'monthly' });
    expect(eventDatesIn(monthly, '2027-11-01', '2028-04-30')).toEqual([
      '2027-11-30',
      '2027-12-31',
      '2028-01-31',
      '2028-02-29',
      '2028-03-31',
      '2028-04-30',
    ]);
    expect(eventDatesIn(monthly, '2027-02-01', '2027-02-28')).toEqual([]);
    expect(eventDatesIn(series({ starts_on: '2026-01-31', recurrence: 'monthly' }), '2026-02-01', '2026-03-31')).toEqual(['2026-02-28', '2026-03-31']);
  });

  it('todo ano em 29/02: em 28/02 nos anos sem ele', () => {
    const yearly = series({ starts_on: '2024-02-29', recurrence: 'yearly' });
    expect(eventDatesIn(yearly, '2024-01-01', '2028-12-31')).toEqual(['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29']);
  });

  it('"até" vale inclusive', () => {
    const weekly = series({ recurrence: 'weekly', weekdays: [1], until_on: '2026-10-26' });
    expect(eventDatesIn(weekly, '2026-10-01', '2026-11-30')).toEqual(['2026-10-12', '2026-10-19', '2026-10-26']);
    const monthly = series({ recurrence: 'monthly', until_on: '2026-12-12' });
    expect(eventDatesIn(monthly, '2026-10-01', '2027-03-31')).toEqual(['2026-10-12', '2026-11-12', '2026-12-12']);
    expect(eventDatesIn(series({ recurrence: 'yearly', until_on: '2027-10-11' }), '2026-01-01', '2030-12-31')).toEqual(['2026-10-12']);
    // Intervalo todo depois do fim.
    expect(eventDatesIn(weekly, '2026-11-01', '2026-11-30')).toEqual([]);
  });

  it('intervalo muito depois do começo: não conta desde o início', () => {
    expect(eventDatesIn(series({ starts_on: '2015-01-05', recurrence: 'weekly', weekdays: [1, 3] }), '2026-10-12', '2026-10-18')).toEqual([
      '2026-10-12',
      '2026-10-14',
    ]);
    expect(eventDatesIn(series({ starts_on: '1990-01-31', recurrence: 'monthly' }), '2026-02-01', '2026-03-31')).toEqual(['2026-02-28', '2026-03-31']);
    expect(eventDatesIn(series({ starts_on: '1988-02-29', recurrence: 'yearly' }), '2026-01-01', '2028-12-31')).toEqual([
      '2026-02-28',
      '2027-02-28',
      '2028-02-29',
    ]);
    // Mil compromissos criados há um século, uma semana de agenda: se contasse
    // desde o começo, seriam milhões de datas.
    const old = Array.from({ length: 1000 }, (_, i) =>
      series({ starts_on: '1926-10-12', recurrence: i % 2 ? 'weekly' : 'monthly', weekdays: i % 2 ? [1, 4] : null }),
    );
    const startedAt = Date.now();
    const total = old.reduce((sum, s) => sum + eventDatesIn(s, '2026-10-12', '2026-10-18').length, 0);
    expect(total).toBe(500 * 2 + 500);
    expect(Date.now() - startedAt).toBeLessThan(1500);
  });

  it('semanal sem dias gravados (não deveria): vale o dia da semana do começo', () => {
    expect(eventDatesIn(series({ recurrence: 'weekly', weekdays: null }), '2026-10-12', '2026-10-25')).toEqual(['2026-10-12', '2026-10-19']);
  });
});

describe('occurrencesOf (mudanças de um dia)', () => {
  const week = ['2026-10-12', '2026-10-25'] as const;
  const who = (days: EventDayLike[]) => occurrencesOf(swim, days, ...week).map((o) => [o.date, o.take_by, o.pick_up_by]);

  it('sem mudança, vale o de sempre', () => {
    expect(who([])).toEqual([
      ['2026-10-13', 'beto', 'carla'],
      ['2026-10-15', 'beto', 'carla'],
      ['2026-10-20', 'beto', 'carla'],
      ['2026-10-22', 'beto', 'carla'],
    ]);
  });

  it('"não vai ter neste dia" tira só aquele dia', () => {
    expect(who([day({ cancelled: true })]).map(([date]) => date)).toEqual(['2026-10-13', '2026-10-20', '2026-10-22']);
  });

  it('quem leva muda só naquele dia; "ninguém" é diferente de "como sempre"', () => {
    const changed = who([
      day({ override_take: true, take_by: 'vo' }),
      // Ninguém busca no dia 20; quem leva segue o de sempre.
      day({ occurs_on: '2026-10-20', override_pick_up: true, pick_up_by: null }),
      // Linha sem nada marcado: como sempre.
      day({ occurs_on: '2026-10-22', take_by: 'vo' }),
    ]);
    expect(changed).toEqual([
      ['2026-10-13', 'beto', 'carla'],
      ['2026-10-15', 'vo', 'carla'],
      ['2026-10-20', 'beto', null],
      ['2026-10-22', 'beto', 'carla'],
    ]);
  });

  it('mudança de um dia que não é do compromisso (ou de outro compromisso) não conta', () => {
    const days = [day({ occurs_on: '2026-10-14', cancelled: true }), day({ event_id: 'outro', cancelled: true })];
    expect(who(days)).toHaveLength(4);
    expect(staleDayDates(swim, days.filter((d) => d.event_id === 'natacao'))).toEqual(['2026-10-14']);
    // A regra mudou para só às terças: a mudança de uma quinta sobra.
    expect(staleDayDates({ ...swim, weekdays: [2] }, [day({}), day({ occurs_on: '2026-10-20' })])).toEqual(['2026-10-15']);
    expect(dayChangeOf('natacao', days, '2026-10-14')?.cancelled).toBe(true);
    expect(dayChangeOf('natacao', days, '2026-10-15')).toBeNull();
  });

  it('ao salvar o compromisso, a mudança de dia que ficou igual ao de sempre sai, e a que difere em parte fica só com a parte', () => {
    // Na quinta 15 a vó levava; na terça 20 a vó levava e o Beto buscava; na quinta 22 não ia ter.
    const changes = [
      day({ occurs_on: '2026-10-15', override_take: true, take_by: 'vo' }),
      day({ occurs_on: '2026-10-20', override_take: true, take_by: 'vo', override_pick_up: true, pick_up_by: 'beto' }),
      day({ occurs_on: '2026-10-22', cancelled: true, override_take: true, take_by: 'vo' }),
    ];
    // Nada mudou no compromisso: nada a fazer.
    expect(dayChangesAfterSave(swim, changes)).toEqual({ remove: [], rewrite: [] });
    // Agora quem leva sempre é a vó: a do dia 15 ficou igual e sai; as outras perdem só essa parte.
    expect(dayChangesAfterSave({ ...swim, take_by: 'vo' }, changes)).toEqual({
      remove: ['2026-10-15'],
      rewrite: [
        { occurs_on: '2026-10-20', cancelled: false, override_take: false, take_by: null, override_pick_up: true, pick_up_by: 'beto' },
        { occurs_on: '2026-10-22', cancelled: true, override_take: false, take_by: null, override_pick_up: false, pick_up_by: null },
      ],
    });
    // Sem a limpeza, voltar o compromisso para o Beto traria a vó de volta no dia 15 sem ninguém pedir;
    // com ela, o dia 15 segue o compromisso.
    const cleaned = changes.slice(1);
    expect(occurrencesOf(swim, cleaned, '2026-10-15', '2026-10-15').map((o) => o.take_by)).toEqual(['beto']);
    // O dia que saiu da regra (só às terças) sai junto, mesmo com mudança de verdade.
    expect(dayChangesAfterSave({ ...swim, weekdays: [2] }, changes).remove).toEqual(['2026-10-15', '2026-10-22']);
    // "Ninguém leva" continua sendo mudança enquanto o compromisso tiver alguém.
    expect(dayChangesAfterSave(swim, [day({ override_take: true, take_by: null })])).toEqual({ remove: [], rewrite: [] });
  });

  it('compromisso que passou a "Não repete": as mudanças de dias saem todas, e a que sobrar não vale', () => {
    // A natação virou uma aula só, na terça 13. Havia mudança nesse dia e na quinta.
    const once: FamilyEventLike = { ...swim, recurrence: 'none', weekdays: null };
    const cancelled = [day({ occurs_on: '2026-10-13', cancelled: true }), day({ cancelled: true })];
    expect(staleDayDates(once, cancelled)).toEqual(['2026-10-13', '2026-10-15']);
    // A limpeza pode falhar: mesmo com a linha guardada, a aula aparece (não
    // há mais "Só neste dia" na tela para desfazer), com quem leva sempre.
    const seen = (days: EventDayLike[]) => occurrencesOf(once, days, ...week).map((o) => [o.date, o.take_by, o.pick_up_by]);
    expect(seen(cancelled)).toEqual([['2026-10-13', 'beto', 'carla']]);
    expect(seen([day({ occurs_on: '2026-10-13', override_take: true, take_by: 'vo', override_pick_up: true })])).toEqual([['2026-10-13', 'beto', 'carla']]);
    const shown = calendarEntries({ events: [once], days: cancelled, people }, ...week).filter((e) => e.kind === 'compromisso');
    expect(shown.map((e) => [e.date, e.ride])).toEqual([['2026-10-13', 'Beto leva, Carla busca']]);
  });

  it('o que guardar para o dia: igual ao de sempre não é mudança', () => {
    expect(normalizeDayChange(swim, NO_DAY_CHANGE)).toBeNull();
    // Escolher o Beto (o de sempre) para o dia: nada a guardar.
    expect(normalizeDayChange(swim, { ...NO_DAY_CHANGE, override_take: true, take_by: 'beto' })).toBeNull();
    expect(normalizeDayChange(swim, { ...NO_DAY_CHANGE, override_take: true, take_by: null })).toEqual({
      ...NO_DAY_CHANGE,
      override_take: true,
    });
    // "Ninguém" quando já não há ninguém de sempre: nada a guardar.
    expect(normalizeDayChange({ take_by: null, pick_up_by: null }, { ...NO_DAY_CHANGE, override_take: true, take_by: null })).toBeNull();
    // Sem marcar a mudança, o nome que veio junto não fica.
    expect(normalizeDayChange(swim, { ...NO_DAY_CHANGE, cancelled: true, take_by: 'vo' })).toEqual({ ...NO_DAY_CHANGE, cancelled: true });
    expect(normalizeDayChange(swim, { ...NO_DAY_CHANGE, override_pick_up: true, pick_up_by: 'vo' })).toEqual({
      ...NO_DAY_CHANGE,
      override_pick_up: true,
      pick_up_by: 'vo',
    });
  });
});

describe('birthdaysIn', () => {
  const born = (id: string, birth_date: string | null, kind: PersonLike['kind'] = 'pessoa'): PersonLike => ({ id, name: id, kind, birth_date });

  it('um por ano, com a idade; pets também; sem data de nascimento, nada', () => {
    expect(birthdaysIn(people, '2026-10-01', '2026-10-31')).toEqual([
      { person_id: 'rex', name: 'Rex', date: '2026-10-13', age: 6 },
      { person_id: 'ana', name: 'Ana', date: '2026-10-14', age: 8 },
    ]);
  });

  it('29/02 é comemorado em 28/02 nos anos sem ele', () => {
    const leap = [born('Lia', '2020-02-29')];
    expect(birthdaysIn(leap, '2027-01-01', '2028-12-31').map((b) => [b.date, b.age])).toEqual([
      ['2027-02-28', 7],
      ['2028-02-29', 8],
    ]);
  });

  it('o ano do nascimento não é aniversário', () => {
    const baby = [born('Bia', '2026-03-10')];
    expect(birthdaysIn(baby, '2026-01-01', '2026-12-31')).toEqual([]);
    expect(birthdaysIn(baby, '2025-01-01', '2027-12-31').map((b) => [b.date, b.age])).toEqual([['2027-03-10', 1]]);
  });

  it('intervalo que atravessa a virada do ano', () => {
    const family = [born('Dez', '2010-12-30'), born('Jan', '2012-01-02')];
    expect(birthdaysIn(family, '2026-12-27', '2027-01-09').map((b) => [b.name, b.date, b.age])).toEqual([
      ['Dez', '2026-12-30', 16],
      ['Jan', '2027-01-02', 15],
    ]);
  });
});

describe('textos', () => {
  it('horário, quem leva e busca, o que levar e a idade', () => {
    expect(formatTimeRange('16:00', '17:00')).toBe('16:00–17:00');
    expect(formatTimeRange('16:00', null)).toBe('16:00');
    expect(formatTimeRange(null, null)).toBeNull();
    expect(rideText('Beto', 'Carla')).toBe('Beto leva, Carla busca');
    expect(rideText('Beto', 'Beto')).toBe('Beto leva e busca');
    expect(rideText('Beto', null)).toBe('Beto leva');
    expect(rideText(null, 'Carla')).toBe('Carla busca');
    expect(rideText(null, null)).toBeNull();
    // O dia em que ninguém leva (ou busca) quem costuma ser levado: a linha diz, em vez de só perder um nome.
    expect(rideText(null, 'Carla', { take: true })).toBe('Ninguém leva, Carla busca');
    expect(rideText('Beto', null, { pickUp: true })).toBe('Beto leva, ninguém busca');
    expect(rideText(null, null, { take: true, pickUp: true })).toBe('Ninguém leva nem busca');
    expect(rideText(null, null, { take: true })).toBe('Ninguém leva');
    expect(rideText(null, null, { pickUp: true })).toBe('Ninguém busca');
    // Com um nome, vale o nome.
    expect(rideText('Beto', 'Carla', { take: true, pickUp: true })).toBe('Beto leva, Carla busca');
    expect(bringText(' touca e toalha ')).toBe('Levar: touca e toalha');
    expect(bringText('  ')).toBeNull();
    expect(ageText(8)).toBe('faz 8 anos');
    expect(ageText(1)).toBe('faz 1 ano');
  });

  it('como a repetição cai no mês e no ano', () => {
    expect(recurrenceHint('monthly', '2026-10-12')).toBe('Todo dia 12.');
    expect(recurrenceHint('monthly', '2026-10-31')).toBe('Todo dia 31; nos meses mais curtos, no último dia.');
    expect(recurrenceHint('yearly', '2026-10-12')).toBe('Todo ano em 12/10.');
    expect(recurrenceHint('yearly', '2024-02-29')).toBe('Todo ano em 29/02; nos anos sem esse dia, em 28/02.');
    expect(recurrenceHint('weekly', '2026-10-12')).toBeNull();
    expect(recurrenceHint('monthly', null)).toBeNull();
  });

  it('toda semana em mais de um dia: a saída para "cada dia uma pessoa leva"', () => {
    expect(recurrenceHint('weekly', '2026-10-13', [2, 4])).toBe('Cada dia uma pessoa leva? Crie um compromisso para cada dia.');
    // Não depende da data (pode estar pela metade no formulário).
    expect(recurrenceHint('weekly', null, [1, 2, 3, 4, 5])).toBe('Cada dia uma pessoa leva? Crie um compromisso para cada dia.');
    expect(recurrenceHint('weekly', '2026-10-13', [2])).toBeNull();
    // Os dias que ficaram de quando era "toda semana" não mudam as outras dicas.
    expect(recurrenceHint('monthly', '2026-10-12', [2, 4])).toBe('Todo dia 12.');
    expect(recurrenceHint('none', '2026-10-12', [2, 4])).toBeNull();
  });

  it('o que mudou num dia', () => {
    const nameOf = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;
    expect(describeDayChange({ ...NO_DAY_CHANGE, cancelled: true, override_take: true, take_by: 'vo' }, nameOf)).toBe('Não vai ter');
    expect(describeDayChange({ ...NO_DAY_CHANGE, override_take: true, take_by: 'vo' }, nameOf)).toBe('Vó Maria leva');
    expect(describeDayChange({ ...NO_DAY_CHANGE, override_take: true, take_by: 'vo', override_pick_up: true }, nameOf)).toBe(
      'Vó Maria leva, ninguém busca',
    );
  });

  it('só gente leva e busca', () => {
    expect(driversOf(people).map((p) => p.name)).toEqual(['Ana', 'Beto', 'Carla', 'Vó Maria']);
  });
});

const calendar: FamilyCalendar = {
  events: [
    swim,
    { ...swim, id: 'reuniao', title: 'Reunião da escola', starts_on: '2026-10-13', start_time: null, end_time: null, person_id: null, take_by: null, pick_up_by: null, location: null, bring: null, recurrence: 'none', weekdays: null },
    { ...swim, id: 'festa', title: 'Festa do João', starts_on: '2026-10-13', start_time: '10:00', end_time: null, take_by: 'carla', location: null, bring: 'presente', recurrence: 'none', weekdays: null },
  ],
  days: [day({ cancelled: true }), day({ occurs_on: '2026-10-20', override_take: true, take_by: 'vo' })],
  people,
};

describe('calendarEntries', () => {
  it('compromissos e aniversários em ordem: o dia todo antes das horas marcadas', () => {
    const entries = calendarEntries(calendar, '2026-10-12', '2026-10-20');
    expect(entries.map((e) => [e.date, e.time, e.kind, e.title, entryDetail(e)])).toEqual([
      ['2026-10-13', null, 'aniversario', 'Aniversário de Rex', 'faz 6 anos'],
      ['2026-10-13', null, 'compromisso', 'Reunião da escola', null],
      ['2026-10-13', '10:00', 'compromisso', 'Festa do João', 'Ana · Carla leva e busca · Levar: presente'],
      ['2026-10-13', '16:00', 'compromisso', 'Natação da Ana', 'Ana · Beto leva, Carla busca · Levar: touca e toalha'],
      ['2026-10-14', null, 'aniversario', 'Aniversário de Ana', 'faz 8 anos'],
      // Dia 15 não vai ter; no dia 20 é a vó quem leva.
      ['2026-10-20', '16:00', 'compromisso', 'Natação da Ana', 'Ana · Vó Maria leva, Carla busca · Levar: touca e toalha'],
    ]);
    expect(entries[3]).toMatchObject({ id: 'natacao', endTime: '17:00', location: 'Clube' });
    expect(entries[0]).toMatchObject({ id: 'rex', age: 6 });
  });

  it('o detalhe curto, para o resumo de amanhã: de quem é e quem leva e busca, ou a idade; sem o local nem o que levar', () => {
    const entries = calendarEntries(calendar, '2026-10-13', '2026-10-14');
    expect(entries.map((e) => [e.title, entryShortDetail(e)])).toEqual([
      ['Aniversário de Rex', 'faz 6 anos'],
      ['Reunião da escola', null],
      ['Festa do João', 'Ana, Carla leva e busca'],
      ['Natação da Ana', 'Ana, Beto leva, Carla busca'],
      ['Aniversário de Ana', 'faz 8 anos'],
    ]);
    // Só de quem é; só quem busca.
    expect(entryShortDetail({ ...entries[3], ride: null })).toBe('Ana');
    expect(entryShortDetail({ ...entries[3], who: null, ride: 'Carla busca' })).toBe('Carla busca');
    // Aniversário sem a idade (não deveria: ela sai da data de nascimento): fica só o título.
    expect(entryShortDetail({ ...entries[0], age: null })).toBeNull();
    expect(entryShortDetail({ ...entries[0], age: 0 })).toBeNull();
  });

  it('o detalhe curto não repete o nome quando o compromisso é de quem leva (ou de quem só busca)', () => {
    // A natação é do Beto, e ele mesmo vai e volta. (15/10: um dia sem aniversário.)
    const own = (patch: Partial<FamilyEventLike>, family = people) =>
      calendarEntries({ events: [{ ...swim, person_id: 'beto', ...patch }], days: [], people: family }, '2026-10-15', '2026-10-15').map(entryShortDetail);
    expect(own({ take_by: 'beto', pick_up_by: 'beto' })).toEqual(['Beto leva e busca']);
    expect(own({ take_by: 'beto', pick_up_by: null })).toEqual(['Beto leva']);
    expect(own({ take_by: 'beto', pick_up_by: 'carla' })).toEqual(['Beto leva, Carla busca']);
    expect(own({ take_by: null, pick_up_by: 'beto' })).toEqual(['Beto busca']);
    // Outra pessoa leva: os dois nomes.
    expect(own({ take_by: 'carla', pick_up_by: null })).toEqual(['Beto, Carla leva']);
    // Só o nome inteiro vale: a Ana não é a Ana Paula, nem a Ana Paula é a Ana.
    const paula: PersonLike = { id: 'paula', name: 'Ana Paula', kind: 'pessoa', birth_date: null };
    expect(own({ person_id: 'ana', take_by: 'paula', pick_up_by: null }, [...people, paula])).toEqual(['Ana, Ana Paula leva']);
    expect(own({ person_id: 'ana', take_by: null, pick_up_by: 'paula' }, [...people, paula])).toEqual(['Ana, Ana Paula busca']);
    expect(own({ person_id: 'ana', take_by: 'paula', pick_up_by: 'paula' }, [...people, paula])).toEqual(['Ana, Ana Paula leva e busca']);
    expect(own({ person_id: 'paula', take_by: 'ana', pick_up_by: null }, [...people, paula])).toEqual(['Ana Paula, Ana leva']);
    // Nem o sobrenome que começa como o verbo (nomes digitados em minúsculas): "ana leva…" ali não é a ana levando.
    const lower: PersonLike[] = [
      { id: 'ana', name: 'ana', kind: 'pessoa', birth_date: null },
      { id: 'tia', name: 'ana levandowski', kind: 'pessoa', birth_date: null },
    ];
    expect(own({ person_id: 'ana', take_by: 'tia', pick_up_by: null }, lower)).toEqual(['ana, ana levandowski leva']);
    expect(own({ person_id: 'ana', take_by: 'tia', pick_up_by: 'ana' }, lower)).toEqual(['ana, ana levandowski leva, ana busca']);
  });

  it('ficha apagada (ou de quem saiu): o nome some, o compromisso fica', () => {
    const entries = calendarEntries({ ...calendar, people: people.filter((p) => p.id !== 'carla') }, '2026-10-22', '2026-10-22');
    expect(entries.map(entryDetail)).toEqual(['Ana · Beto leva · Levar: touca e toalha']);
  });

  it('o dia em que ninguém leva (ou busca) quem costuma ser levado: a linha, o aviso, a Hoje e o Nuke dizem', () => {
    const changed: FamilyCalendar = {
      events: [swim],
      days: [
        day({ occurs_on: '2026-10-13', override_take: true, take_by: null }),
        day({ occurs_on: '2026-10-15', override_pick_up: true, pick_up_by: null }),
        day({ occurs_on: '2026-10-20', override_take: true, take_by: null, override_pick_up: true, pick_up_by: null }),
      ],
      people: people.map((p) => ({ ...p, birth_date: null })),
    };
    const entries = calendarEntries(changed, '2026-10-13', '2026-10-22');
    expect(entries.map((e) => [e.date, e.ride, e.routine])).toEqual([
      ['2026-10-13', 'Ninguém leva, Carla busca', false],
      ['2026-10-15', 'Beto leva, ninguém busca', false],
      ['2026-10-20', 'Ninguém leva nem busca', false],
      ['2026-10-22', 'Beto leva, Carla busca', true],
    ]);
    expect(entryDetail(entries[0])).toBe('Ana · Ninguém leva, Carla busca · Levar: touca e toalha');
    expect(eventReminderTexts(entries[0]).body).toBe('Ana · Ninguém leva, Carla busca · Clube · Levar: touca e toalha');
    expect(todayEntries(changed, '2026-10-13')[0].subtitle).toBe('Hoje · 16:00–17:00 · Ana · Ninguém leva, Carla busca · Levar: touca e toalha');
    // No retrato do Nuke a linha é uma lista entre parênteses: "ninguém" em minúscula, no meio dela.
    expect(calendarLines(changed, '2026-10-13', 2)).toEqual([
      'hoje 16:00–17:00 Natação da Ana (Ana, ninguém leva, Carla busca, local: Clube, levar: touca e toalha)',
      'qui 15/10 16:00–17:00 Natação da Ana (Ana, Beto leva, ninguém busca, local: Clube, levar: touca e toalha)',
    ]);

    // Quem nunca teve quem leve não ganha "ninguém leva": não é mudança, e a linha segue como era.
    const alone: FamilyEventLike = { ...swim, take_by: null };
    expect(calendarEntries({ ...changed, events: [alone], days: [] }, '2026-10-13', '2026-10-13').map((e) => e.ride)).toEqual(['Carla busca']);
    // Nem a mudança que sobrou de quando havia alguém (o compromisso passou a não ter quem leve).
    expect(calendarEntries({ ...changed, events: [alone] }, '2026-10-13', '2026-10-13').map((e) => [e.ride, e.routine])).toEqual([['Carla busca', true]]);
    // A ficha que não está na lista (apagada, ou de quem saiu) não é "ninguém": o nome some, como antes.
    const gone = { ...changed, days: [], people: changed.people.filter((p) => p.id !== 'beto') };
    expect(calendarEntries(gone, '2026-10-13', '2026-10-13').map((e) => e.ride)).toEqual(['Carla busca']);
  });

  it('rotina: a vez de toda semana em que quem leva e quem busca são os de sempre', () => {
    const routine = (cal: FamilyCalendar) => calendarEntries(cal, '2026-10-13', '2026-10-22').map((e) => [e.date, e.title, e.routine]);
    expect(routine(calendar)).toEqual([
      ['2026-10-13', 'Aniversário de Rex', false],
      ['2026-10-13', 'Reunião da escola', false],
      ['2026-10-13', 'Festa do João', false],
      ['2026-10-13', 'Natação da Ana', true],
      ['2026-10-14', 'Aniversário de Ana', false],
      // No dia 20 a vó leva: não é a rotina.
      ['2026-10-20', 'Natação da Ana', false],
      ['2026-10-22', 'Natação da Ana', true],
    ]);
    // Guardado para o dia o mesmo de sempre: segue sendo a rotina. Todo mês não é rotina.
    const same = [day({ occurs_on: '2026-10-13', override_take: true, take_by: 'beto' })];
    const monthly: FamilyEventLike = { ...swim, id: 'pediatra', title: 'Pediatra', recurrence: 'monthly', weekdays: null };
    expect(routine({ events: [swim, monthly], days: same, people: [] }).slice(0, 2)).toEqual([
      ['2026-10-13', 'Natação da Ana', true],
      ['2026-10-13', 'Pediatra', false],
    ]);
  });
});

describe('todayEntries (tela Hoje)', () => {
  it('só hoje e amanhã, com o dia, o horário e os detalhes', () => {
    expect(todayEntries(calendar, '2026-10-12').map((e) => [e.key, e.title, e.subtitle])).toEqual([
      ['aniversario:rex:2026-10-13', 'Aniversário de Rex', 'Amanhã · faz 6 anos'],
      ['compromisso:reuniao:2026-10-13', 'Reunião da escola', 'Amanhã'],
      ['compromisso:festa:2026-10-13', 'Festa do João', 'Amanhã · 10:00 · Ana · Carla leva e busca · Levar: presente'],
      ['compromisso:natacao:2026-10-13', 'Natação da Ana', 'Amanhã · 16:00–17:00 · Ana · Beto leva, Carla busca · Levar: touca e toalha'],
    ]);
    expect(todayEntries(calendar, '2026-10-14').map((e) => [e.title, e.subtitle])).toEqual([['Aniversário de Ana', 'Hoje · faz 8 anos']]);
    expect(todayEntries(calendar, '2026-10-16')).toEqual([]);
  });
});

describe('calendarLines (retrato do Nuke)', () => {
  it('hoje, amanhã e o dia da semana já escritos; sem as observações', () => {
    expect(calendarLines(calendar, '2026-10-12')).toEqual([
      'amanhã Aniversário de Rex (faz 6 anos)',
      'amanhã Reunião da escola',
      'amanhã 10:00 Festa do João (Ana, Carla leva e busca, levar: presente)',
      'amanhã 16:00–17:00 Natação da Ana (Ana, Beto leva, Carla busca, local: Clube, levar: touca e toalha)',
      'qua 14/10 Aniversário de Ana (faz 8 anos)',
    ]);
    expect(calendarLines(calendar, '2026-10-13')[0]).toBe('hoje Aniversário de Rex (faz 6 anos)');
    // Só os próximos 7 dias.
    expect(calendarLines(calendar, '2026-10-12', 7).some((line) => line.includes('20/10'))).toBe(false);
    expect(calendarLines(calendar, '2026-10-13').at(-1)).toBe(
      'ter 20/10 16:00–17:00 Natação da Ana (Ana, Vó Maria leva, Carla busca, local: Clube, levar: touca e toalha)',
    );
  });

  it('local e "o que levar" compridos são cortados: 25 linhas cheias ficam longe do corte do servidor', () => {
    // Quatro compromissos de todo dia, com os textos no tamanho máximo do banco.
    const long: FamilyEventLike[] = ['a', 'b', 'c', 'd'].map((id) => ({
      ...swim,
      id,
      title: `${id} ${'t'.repeat(118)}`,
      location: 'l'.repeat(200),
      bring: 'b'.repeat(300),
      weekdays: [0, 1, 2, 3, 4, 5, 6],
    }));
    // (Sem as datas de nascimento, para só haver compromissos.)
    const noBirthdays = people.map((p) => ({ ...p, birth_date: null }));
    const lines = calendarLines({ events: long, days: [], people: noBirthdays }, '2026-10-13');
    expect(lines).toHaveLength(32);
    expect(lines[0]).toBe(
      `hoje 16:00–17:00 a ${'t'.repeat(118)} (Ana, Beto leva, Carla busca, local: ${'l'.repeat(59)}…, levar: ${'b'.repeat(119)}…)`,
    );
    // O retrato do Nuke leva até 25 linhas destas; o servidor corta tudo em 16000 letras.
    expect(lines.slice(0, 25).join('; ').length).toBeLessThan(10000);
    // Texto que cabe passa inteiro.
    const exact = calendarLines({ events: [{ ...swim, location: 'l'.repeat(60), bring: 'b'.repeat(120) }], days: [], people: noBirthdays }, '2026-10-13');
    expect(exact[0]).toContain(`local: ${'l'.repeat(60)}, levar: ${'b'.repeat(120)})`);
  });
});

describe('eventReminderTexts', () => {
  const entry = (title: string, from: string) => calendarEntries(calendar, from, from).find((e) => e.title === title)!;

  it('véspera, dia e detalhes; aniversário só no dia', () => {
    expect(eventReminderTexts(entry('Natação da Ana', '2026-10-13'))).toEqual({
      eve: 'Amanhã: Natação da Ana às 16:00',
      today: 'Hoje às 16:00: Natação da Ana',
      body: 'Ana · Beto leva, Carla busca · Clube · Levar: touca e toalha',
    });
    expect(eventReminderTexts(entry('Reunião da escola', '2026-10-13'))).toEqual({
      eve: 'Amanhã: Reunião da escola',
      today: 'Hoje: Reunião da escola',
      body: '',
    });
    expect(eventReminderTexts(entry('Aniversário de Ana', '2026-10-14'))).toEqual({
      eve: null,
      today: 'Hoje é aniversário de Ana',
      body: 'Faz 8 anos.',
    });
  });

  it('texto comprido é cortado para caber no aviso', () => {
    const long = { ...entry('Natação da Ana', '2026-10-13'), bring: 'x'.repeat(300), location: 'y'.repeat(200) };
    const texts = eventReminderTexts(long);
    expect(texts.body.length).toBeLessThanOrEqual(300);
    expect(texts.body.endsWith('…')).toBe(true);
  });
});

describe('parseTime', () => {
  it('aceita os jeitos comuns de escrever a hora', () => {
    expect(parseTime('16')).toBe('16:00');
    expect(parseTime('16h')).toBe('16:00');
    expect(parseTime('16:30')).toBe('16:30');
    expect(parseTime('16h30')).toBe('16:30');
    expect(parseTime(' 9.05 ')).toBe('09:05');
    expect(parseTime('7:5')).toBeNull();
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('12:60')).toBeNull();
    expect(parseTime('tarde')).toBeNull();
    expect(parseTime('')).toBeNull();
  });
});

describe('validateEventForm', () => {
  const form: EventForm = {
    title: ' Natação da Ana ',
    date: '13/10/2026',
    startTime: '16h',
    endTime: '17:00',
    personId: 'ana',
    takeBy: 'beto',
    pickUpBy: 'carla',
    location: ' Clube ',
    bring: 'touca e toalha',
    notes: '',
    recurrence: 'weekly',
    weekdays: [4, 2, 2],
    until: '',
  };
  const message = (patch: Partial<EventForm>) => {
    const result = validateEventForm({ ...form, ...patch });
    return result.ok ? null : result.message;
  };

  it('devolve o que gravar, já arrumado', () => {
    expect(validateEventForm(form)).toEqual({
      ok: true,
      values: {
        title: 'Natação da Ana',
        starts_on: '2026-10-13',
        start_time: '16:00',
        end_time: '17:00',
        person_id: 'ana',
        take_by: 'beto',
        pick_up_by: 'carla',
        location: 'Clube',
        bring: 'touca e toalha',
        notes: null,
        recurrence: 'weekly',
        weekdays: [2, 4],
        until_on: null,
      },
    });
  });

  it('sem repetição: os dias da semana e o "até" não são gravados; sem horário é o dia todo', () => {
    const result = validateEventForm({ ...form, recurrence: 'none', until: '01/12/2026', startTime: '', endTime: '' });
    expect(result).toMatchObject({ ok: true, values: { recurrence: 'none', weekdays: null, until_on: null, start_time: null, end_time: null } });
    expect(validateEventForm({ ...form, recurrence: 'monthly', until: '13/10/2026' })).toMatchObject({
      ok: true,
      values: { weekdays: null, until_on: '2026-10-13' },
    });
  });

  it('diz o que falta, numa frase', () => {
    expect(message({ title: '   ' })).toBe('Dê um nome ao compromisso.');
    expect(message({ title: 'x'.repeat(121) })).toBe('O nome pode ter até 120 letras.');
    expect(message({ date: '31/02/2026' })).toBe('Informe a data como dd/mm/aaaa.');
    expect(message({ startTime: '25h' })).toContain('Use um horário como 16:00');
    expect(message({ endTime: 'noite' })).toContain('Use um horário como 16:00');
    expect(message({ startTime: '' })).toBe('Para dizer a que horas termina, informe também a que horas começa.');
    expect(message({ endTime: '16:00' })).toBe('O fim precisa ser depois do começo.');
    expect(message({ endTime: '15:00' })).toBe('O fim precisa ser depois do começo.');
    expect(message({ weekdays: [] })).toBe('Escolha pelo menos um dia da semana.');
    expect(message({ until: 'depois' })).toBe('Informe até quando repete como dd/mm/aaaa, ou deixe em branco.');
    expect(message({ until: '12/10/2026' })).toBe('O "até" não pode ser antes da data do compromisso.');
    expect(message({ bring: 'x'.repeat(301) })).toBe('"O que levar" pode ter até 300 letras.');
    expect(message({ location: 'x'.repeat(201) })).toBe('O local pode ter até 200 letras.');
    expect(message({ notes: 'x'.repeat(2001) })).toBe('As observações podem ter até 2000 letras.');
    expect(message({})).toBeNull();
  });

  it('toda semana com "até": algum dos dias escolhidos precisa cair até lá', () => {
    // 14/10/2026 é uma quarta. Só às terças, até a segunda 19/10: não haveria vez nenhuma.
    expect(message({ date: '14/10/2026', weekdays: [2], until: '19/10/2026' })).toBe('Nenhum dos dias escolhidos cai até essa data.');
    expect(message({ date: '14/10/2026', weekdays: [1, 2], until: '18/10/2026' })).toBe('Nenhum dos dias escolhidos cai até essa data.');
    // Até a terça 20/10 já cabe uma vez; a data que a pessoa digitou não muda.
    expect(validateEventForm({ ...form, date: '14/10/2026', weekdays: [2], until: '20/10/2026' })).toMatchObject({
      ok: true,
      values: { starts_on: '2026-10-14', weekdays: [2], until_on: '2026-10-20' },
    });
    // No próprio dia da data, e sem "até" (sempre há uma próxima vez).
    expect(message({ date: '14/10/2026', weekdays: [3], until: '14/10/2026' })).toBeNull();
    expect(message({ date: '14/10/2026', weekdays: [2] })).toBeNull();
  });
});

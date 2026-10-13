import { describe, expect, it } from '@jest/globals';

import { addDays } from '../dates';
import { NO_DAY_CHANGE, type FamilyCalendar, type FamilyEventLike } from '../familyEvents';
import { pendingNextDoses } from '../health';
import {
  EVE_SUMMARY_TIME,
  eveSummary,
  HOUSE_REMINDER_KINDS,
  HOUSE_REMINDER_LIMIT,
  planHouseReminders,
  type HouseReminderInput,
} from '../houseReminders';

// Sem o resumo de amanhã (os testes dele vêm mais abaixo): com ele desligado, o plano é o de sempre.
const all = { bills: true, documents: true, chores: true, appointments: true, events: true, vaccines: true, weather: true, eve: false };
const base: HouseReminderInput = { kinds: all, bills: [], documents: [], chores: [], today: '2026-09-27', nowTime: '08:00' };
const bill = { id: 'b1', name: 'Luz', amount: 230, next_due_on: '2026-10-05', active: true, autopay: false };
const doc = { id: 'd1', title: 'Passaporte — Ana', expires_on: '2026-10-20', remind_days: 15 };
const chore = { id: 'c1', title: 'Limpar filtro do ar', due_on: '2026-09-30', active: true, equipment_id: 'e1' };

describe('planHouseReminders', () => {
  it('avisa conta na véspera e no dia, às 9h (atraso não é marcado de antemão)', () => {
    const plan = planHouseReminders({ ...base, bills: [bill] });
    expect(plan.map((r) => [r.date, r.time, r.title, r.body])).toEqual([
      ['2026-10-04', '09:00', 'Conta vence amanhã', 'Luz — R$ 230,00'],
      ['2026-10-05', '09:00', 'Conta vence hoje', 'Luz — R$ 230,00'],
    ]);
  });

  it('não avisa débito automático nem conta desativada', () => {
    const bills = [
      { ...bill, id: 'auto', autopay: true },
      { ...bill, id: 'off', active: false },
    ];
    expect(planHouseReminders({ ...base, bills })).toEqual([]);
  });

  it('conta atrasada avisa no próximo horário, uma vez só', () => {
    const late = { ...bill, id: 'late', amount: null, next_due_on: '2026-09-20' };
    expect(planHouseReminders({ ...base, nowTime: '10:00', bills: [late] })).toEqual([
      expect.objectContaining({
        key: 'bills:late:2026-09-28',
        title: 'Conta atrasada',
        body: 'Luz: venceu em 20/09/2026.',
        overdue: 'late:2026-09-20',
      }),
    ]);
    // Depois que o aviso tocou, o app marca e ele não se repete.
    expect(planHouseReminders({ ...base, nowTime: '10:00', bills: [late], overdueWarned: ['late:2026-09-20'] })).toEqual([]);
  });

  it('documento: quando abre o prazo de renovar, uma semana antes e no dia em que vence', () => {
    const plan = planHouseReminders({ ...base, documents: [doc, { ...doc, id: 'sem', expires_on: null }] });
    expect(plan.map((r) => [r.date, r.title, r.body])).toEqual([
      ['2026-10-05', 'Hora de renovar', 'Passaporte — Ana vence em 15 dias (20/10/2026).'],
      ['2026-10-13', 'Hora de renovar', 'Passaporte — Ana vence em 7 dias (20/10/2026).'],
      ['2026-10-20', 'Documento vence hoje', 'Passaporte — Ana'],
    ]);
  });

  it('documento ligado já dentro do prazo ainda recebe um lembrete antes do dia', () => {
    const plan = planHouseReminders({ ...base, today: '2026-10-10', documents: [doc] });
    expect(plan.map((r) => [r.date, r.title])).toEqual([
      ['2026-10-13', 'Hora de renovar'],
      ['2026-10-20', 'Documento vence hoje'],
    ]);
  });

  it('documento com prazo de 0 ou 1 dia: sem aviso repetido nem "1 dias"', () => {
    const zero = planHouseReminders({ ...base, documents: [{ ...doc, remind_days: 0 }] });
    expect(zero.map((r) => [r.key, r.title])).toEqual([['documents:d1:2026-10-20', 'Documento vence hoje']]);
    const one = planHouseReminders({ ...base, documents: [{ ...doc, remind_days: 1 }] });
    expect(one.map((r) => r.body)).toEqual(['Passaporte — Ana vence amanhã (20/10/2026).', 'Passaporte — Ana']);
  });

  it('tarefa e manutenção no dia; hoje só se o horário ainda não passou', () => {
    const today = { ...chore, id: 'hoje', title: 'Lavar a louça', due_on: '2026-09-27', equipment_id: null };
    expect(planHouseReminders({ ...base, chores: [chore, today] }).map((r) => r.title)).toEqual([
      'Tarefa de hoje',
      'Manutenção de hoje',
    ]);
    expect(planHouseReminders({ ...base, nowTime: '09:30', chores: [today] })).toEqual([]);
  });

  it('só o que a pessoa escolheu, dentro de 30 dias e com limite', () => {
    const kinds = { bills: false, documents: false, chores: true, appointments: false, events: false, vaccines: false, weather: false, eve: false };
    expect(planHouseReminders({ ...base, kinds, bills: [bill], documents: [doc], chores: [chore] })).toHaveLength(1);
    expect(planHouseReminders({ ...base, chores: [{ ...chore, due_on: '2026-11-30' }] })).toEqual([]);
    const many = Array.from({ length: 40 }, (_, i) => ({ ...chore, id: `c${i}` }));
    expect(planHouseReminders({ ...base, chores: many })).toHaveLength(HOUSE_REMINDER_LIMIT);
    // Com os remédios ocupando o teto do iPhone, só o que sobra.
    expect(planHouseReminders({ ...base, chores: many, limit: 3 })).toHaveLength(3);
    expect(planHouseReminders({ ...base, chores: many, limit: -5 })).toEqual([]);
  });

  it('avisa consulta na véspera às 19h e 2 horas antes', () => {
    const appointment = { id: 'a1', title: 'Pediatra', person: 'Lia', date: '2026-10-02', time: '14:30', location: 'Clínica Sol', status: 'agendada' };
    const plan = planHouseReminders({ ...base, appointments: [appointment, { ...appointment, id: 'a2', status: 'cancelada' }] });
    expect(plan.map((r) => [r.key, r.date, r.time, r.title, r.body])).toEqual([
      ['appointments:a1:2026-10-01:19:00', '2026-10-01', '19:00', 'Consulta amanhã', 'Pediatra — Lia, às 14:30 (Clínica Sol).'],
      ['appointments:a1:2026-10-02:12:30', '2026-10-02', '12:30', 'Consulta daqui a 2 horas', 'Pediatra — Lia, às 14:30 (Clínica Sol).'],
    ]);
    // Consulta às 7h: só a véspera.
    expect(planHouseReminders({ ...base, appointments: [{ ...appointment, time: '07:00' }] })).toHaveLength(1);
  });

  it('avisa vacina uma semana antes e no dia; atrasada, uma vez', () => {
    const vaccine = { id: 'v1', name: 'Tríplice viral', dose: '2ª dose', person: 'Lia', next_dose_on: '2026-10-10' };
    expect(planHouseReminders({ ...base, vaccines: [vaccine] }).map((r) => [r.date, r.title, r.body])).toEqual([
      ['2026-10-03', 'Vacina na semana que vem', 'Lia: Tríplice viral (2ª dose) em 10/10/2026.'],
      ['2026-10-10', 'Dia de vacina', 'Lia: Tríplice viral (2ª dose).'],
    ]);
    const late = planHouseReminders({ ...base, vaccines: [{ ...vaccine, next_dose_on: '2026-09-01' }] });
    expect(late.map((r) => [r.date, r.title, r.overdue])).toEqual([['2026-09-27', 'Vacina atrasada', 'v1:2026-09-01']]);
    // Depois que o aviso tocou, não se repete.
    const warned = { ...base, vaccines: [{ ...vaccine, next_dose_on: '2026-09-01' }], overdueWarned: ['v1:2026-09-01'] };
    expect(planHouseReminders(warned)).toEqual([]);
    expect(planHouseReminders({ ...base, vaccines: [{ ...vaccine, next_dose_on: '2026-05-01' }] })).toEqual([]);
  });

  it('dica do clima na hora marcada de cada manhã; a de hoje só se a hora ainda não passou', () => {
    const weather = [
      { date: '2026-09-27', time: '07:00', title: 'Hoje é dia de lavar roupa', body: 'Sem chuva até o fim da tarde e umidade de 60%.' },
      { date: '2026-09-28', time: '07:00', title: 'Roupa no varal? Recolha antes das 15h', body: 'A chuva deve chegar por volta das 15h.' },
    ];
    expect(planHouseReminders({ ...base, nowTime: '06:30', weather }).map((r) => [r.key, r.date, r.time, r.title])).toEqual([
      ['weather:dia:2026-09-27:07:00', '2026-09-27', '07:00', 'Hoje é dia de lavar roupa'],
      ['weather:dia:2026-09-28:07:00', '2026-09-28', '07:00', 'Roupa no varal? Recolha antes das 15h'],
    ]);
    expect(planHouseReminders({ ...base, weather }).map((r) => r.date)).toEqual(['2026-09-28']);
    expect(planHouseReminders({ ...base, kinds: { ...all, weather: false }, weather })).toEqual([]);
  });
});

describe('planHouseReminders: compromissos da família e aniversários', () => {
  // 27/09/2026 é um domingo; a natação é às terças e quintas.
  const swim: FamilyEventLike = {
    id: 'natacao',
    title: 'Natação da Ana',
    starts_on: '2026-09-01',
    start_time: '16:00',
    end_time: '17:00',
    person_id: 'ana',
    take_by: 'beto',
    pick_up_by: 'carla',
    location: 'Clube',
    bring: 'touca e toalha',
    recurrence: 'weekly',
    weekdays: [2, 4],
    until_on: '2026-10-01',
  };
  const once = (patch: Partial<FamilyEventLike>): FamilyEventLike => ({
    ...swim,
    id: 'reuniao',
    title: 'Reunião da escola',
    starts_on: '2026-09-29',
    start_time: null,
    end_time: null,
    person_id: null,
    take_by: null,
    pick_up_by: null,
    location: null,
    bring: null,
    recurrence: 'none',
    weekdays: null,
    until_on: null,
    ...patch,
  });
  const people: FamilyCalendar['people'] = [
    { id: 'ana', name: 'Ana', kind: 'pessoa', birth_date: null },
    { id: 'beto', name: 'Beto', kind: 'pessoa', birth_date: null },
    { id: 'carla', name: 'Carla', kind: 'pessoa', birth_date: null },
    { id: 'vo', name: 'Vó Maria', kind: 'pessoa', birth_date: null },
  ];
  const family = (events: FamilyEventLike[], days: FamilyCalendar['days'] = []): FamilyCalendar => ({ events, days, people });
  /** A mesma casa, com o aniversário da Ana em 30/09. */
  const withBirthday = (events: FamilyEventLike[], days: FamilyCalendar['days'] = []): FamilyCalendar => ({
    events,
    days,
    people: people.map((p) => (p.id === 'ana' ? { ...p, birth_date: '2018-09-30' } : p)),
  });
  const rows = (input: Partial<HouseReminderInput>) => planHouseReminders({ ...base, ...input }).map((r) => [r.key, r.date, r.time, r.title, r.body]);

  it('o tipo aparece na lista de avisos, com o texto do que ele faz', () => {
    expect(HOUSE_REMINDER_KINDS.find((k) => k.key === 'events')).toEqual({
      key: 'events',
      label: 'Compromissos e aniversários',
      hint: 'Na véspera, às 19h, e no dia, 1 hora antes do horário (sem horário, às 8h). Os de toda semana avisam só no dia',
    });
  });

  it('véspera às 19h e 1 hora antes; sem horário, às 8h; aniversário só no dia', () => {
    const body = 'Ana · Carla leva · Levar: presente';
    const party = once({ id: 'festa', title: 'Festa do João', start_time: '16:00', person_id: 'ana', take_by: 'carla', bring: 'presente' });
    expect(rows({ family: withBirthday([party, once({})]) })).toEqual([
      ['events:festa@2026-09-29:2026-09-28:19:00', '2026-09-28', '19:00', 'Amanhã: Festa do João às 16:00', body],
      ['events:reuniao@2026-09-29:2026-09-28:19:00', '2026-09-28', '19:00', 'Amanhã: Reunião da escola', ''],
      ['events:reuniao@2026-09-29:2026-09-29:08:00', '2026-09-29', '08:00', 'Hoje: Reunião da escola', ''],
      ['events:festa@2026-09-29:2026-09-29:15:00', '2026-09-29', '15:00', 'Hoje às 16:00: Festa do João', body],
      ['events:ana@2026-09-30:2026-09-30:08:00', '2026-09-30', '08:00', 'Hoje é aniversário de Ana', 'Faz 8 anos.'],
    ]);
    // Todo mês e todo ano também avisam na véspera.
    for (const recurrence of ['monthly', 'yearly'] as const) {
      expect(rows({ family: family([once({ recurrence })]) }).map(([, date, time]) => [date, time])).toEqual([
        ['2026-09-28', '19:00'],
        ['2026-09-29', '08:00'],
      ]);
    }
  });

  it('o de toda semana avisa só no dia; a véspera fica para o dia em que muda quem leva ou quem busca', () => {
    const body = 'Ana · Beto leva, Carla busca · Clube · Levar: touca e toalha';
    expect(rows({ family: family([swim]) })).toEqual([
      ['events:natacao@2026-09-29:2026-09-29:15:00', '2026-09-29', '15:00', 'Hoje às 16:00: Natação da Ana', body],
      ['events:natacao@2026-10-01:2026-10-01:15:00', '2026-10-01', '15:00', 'Hoje às 16:00: Natação da Ana', body],
    ]);
    // Na quinta é a vó quem busca: aí a véspera importa.
    const changed = 'Ana · Beto leva, Vó Maria busca · Clube · Levar: touca e toalha';
    const change = { ...NO_DAY_CHANGE, event_id: 'natacao', occurs_on: '2026-10-01', override_pick_up: true, pick_up_by: 'vo' };
    expect(rows({ family: family([swim], [change]) }).map(([key, , , title, text]) => [key, title, text])).toEqual([
      ['events:natacao@2026-09-29:2026-09-29:15:00', 'Hoje às 16:00: Natação da Ana', body],
      ['events:natacao@2026-10-01:2026-09-30:19:00', 'Amanhã: Natação da Ana às 16:00', changed],
      ['events:natacao@2026-10-01:2026-10-01:15:00', 'Hoje às 16:00: Natação da Ana', changed],
    ]);
    // Guardado para o dia o mesmo de sempre: não é mudança, segue sem véspera.
    expect(rows({ family: family([swim], [{ ...change, pick_up_by: 'carla' }]) })).toHaveLength(2);
    // Sem horário, só às 8h do dia.
    const allDay = once({ id: 'feira', title: 'Feira', recurrence: 'weekly', weekdays: [2], until_on: '2026-09-29' });
    expect(rows({ family: family([allDay]) }).map(([key]) => key)).toEqual(['events:feira@2026-09-29:2026-09-29:08:00']);
    // De madrugada não há aviso no dia: a véspera fica, para a vez não passar em branco.
    const dawn = once({ id: 'plantao', title: 'Plantão', start_time: '00:40', recurrence: 'weekly', weekdays: [2], until_on: '2026-09-29' });
    expect(rows({ family: family([dawn]) }).map(([key]) => key)).toEqual(['events:plantao@2026-09-29:2026-09-28:19:00']);
    // Cedo demais para o aviso do dia ser visto (toca antes das 7h): a véspera também fica.
    const early = once({ id: 'treino', title: 'Treino', start_time: '06:30', recurrence: 'weekly', weekdays: [2], until_on: '2026-09-29' });
    expect(rows({ family: family([early]) }).map(([key]) => key)).toEqual([
      'events:treino@2026-09-29:2026-09-28:19:00',
      'events:treino@2026-09-29:2026-09-29:05:30',
    ]);
    // Às 8h o aviso do dia toca às 7h: só ele.
    const morning = once({ id: 'aula', title: 'Aula', start_time: '08:00', recurrence: 'weekly', weekdays: [2], until_on: '2026-09-29' });
    expect(rows({ family: family([morning]) }).map(([key]) => key)).toEqual(['events:aula@2026-09-29:2026-09-29:07:00']);
  });

  it('chaves estáveis: o mesmo plano de novo, e nenhuma repetida', () => {
    const input = { family: family([swim, once({})]) };
    const keys = rows(input).map(([key]) => key);
    expect(rows(input).map(([key]) => key)).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
    // Dois dias seguidos às 20h, e no segundo a vó leva (por isso tem véspera):
    // o "1 hora antes" de um dia e a véspera do seguinte tocam juntos, às 19h,
    // e são dois avisos.
    const nightly = once({ id: 'ensaio', title: 'Ensaio', start_time: '20:00', recurrence: 'weekly', weekdays: [2, 3], until_on: '2026-09-30' });
    const days = [{ ...NO_DAY_CHANGE, event_id: 'ensaio', occurs_on: '2026-09-30', override_take: true, take_by: 'vo' }];
    const at19 = rows({ family: family([nightly], days) }).filter(([, date, time]) => date === '2026-09-29' && time === '19:00');
    expect(at19.map(([key, , , title]) => [key, title])).toEqual([
      ['events:ensaio@2026-09-29:2026-09-29:19:00', 'Hoje às 20:00: Ensaio'],
      ['events:ensaio@2026-09-30:2026-09-29:19:00', 'Amanhã: Ensaio às 20:00'],
    ]);
  });

  it('o que já passou não avisa', () => {
    const today = once({ id: 'hoje', title: 'Dentista', starts_on: '2026-09-27', start_time: '16:00' });
    const allDay = once({ id: 'dia', title: 'Feira de ciências', starts_on: '2026-09-27' });
    // Às 8h de hoje: o das 8h já não toca; o de 1 hora antes das 16h ainda sim.
    expect(rows({ family: family([today, allDay]) }).map(([key]) => key)).toEqual(['events:hoje@2026-09-27:2026-09-27:15:00']);
    expect(rows({ nowTime: '07:59', family: family([allDay]) }).map(([key]) => key)).toEqual(['events:dia@2026-09-27:2026-09-27:08:00']);
    expect(rows({ nowTime: '15:00', family: family([today, allDay]) })).toEqual([]);
    // Amanhã, visto hoje à noite: a véspera já passou, o do dia fica.
    const tomorrow = once({ starts_on: '2026-09-28', start_time: '10:00' });
    expect(rows({ nowTime: '21:00', family: family([tomorrow]) }).map(([, date, time]) => [date, time])).toEqual([['2026-09-28', '09:00']]);
    // Passado: nada.
    expect(rows({ family: family([once({ starts_on: '2026-09-20' })]) })).toEqual([]);
  });

  it('compromisso de madrugada fica só com a véspera', () => {
    const flight = once({ id: 'voo', title: 'Voo para Recife', start_time: '00:40' });
    expect(rows({ family: family([flight]) }).map(([, date, time, title]) => [date, time, title])).toEqual([
      ['2026-09-28', '19:00', 'Amanhã: Voo para Recife às 00:40'],
    ]);
    const early = once({ id: 'treino', title: 'Treino', start_time: '06:30' });
    expect(rows({ family: family([early]) }).map(([, date, time]) => [date, time])).toEqual([
      ['2026-09-28', '19:00'],
      ['2026-09-29', '05:30'],
    ]);
  });

  it('dia que não vai ter não avisa; quem leva naquele dia vai no aviso, e que ninguém busca também', () => {
    const days = [
      { ...NO_DAY_CHANGE, event_id: 'natacao', occurs_on: '2026-09-29', cancelled: true },
      { ...NO_DAY_CHANGE, event_id: 'natacao', occurs_on: '2026-10-01', override_take: true, take_by: 'vo', override_pick_up: true, pick_up_by: null },
    ];
    expect(rows({ family: withBirthday([swim], days) }).map(([key, , , , body]) => [key, body])).toEqual([
      ['events:ana@2026-09-30:2026-09-30:08:00', 'Faz 8 anos.'],
      ['events:natacao@2026-10-01:2026-09-30:19:00', 'Ana · Vó Maria leva, ninguém busca · Clube · Levar: touca e toalha'],
      ['events:natacao@2026-10-01:2026-10-01:15:00', 'Ana · Vó Maria leva, ninguém busca · Clube · Levar: touca e toalha'],
    ]);
  });

  it('quem ia levar só naquele dia teve a ficha apagada, num compromisso sem quem leve sempre: o dia sai da rotina e o aviso diz', () => {
    // A natação não tem quem leve sempre; em 01/10 a vó ia levar, e a ficha dela foi apagada: o banco deixa
    // a mudança marcada e sem pessoa.
    const alone = { ...swim, take_by: null };
    const days = [{ ...NO_DAY_CHANGE, event_id: 'natacao', occurs_on: '2026-10-01', override_take: true, take_by: null }];
    const planned = rows({ family: withBirthday([alone], days) }).map(([key, , , , body]) => [key, body]);
    // A véspera (19h) existe só para o dia que mudou, e diz que ninguém leva.
    expect(planned.filter(([key]) => String(key).endsWith(':19:00'))).toEqual([
      ['events:natacao@2026-10-01:2026-09-30:19:00', 'Ana · Ninguém leva, Carla busca · Clube · Levar: touca e toalha'],
    ]);
    expect(planned).toContainEqual(['events:natacao@2026-10-01:2026-10-01:15:00', 'Ana · Ninguém leva, Carla busca · Clube · Levar: touca e toalha']);
    // Sem a mudança, é rotina: nenhuma véspera.
    expect(rows({ family: withBirthday([alone], []) }).filter(([key]) => String(key).endsWith(':19:00'))).toEqual([]);
  });

  it('só na janela de 30 dias, com o limite, e os mais próximos primeiro', () => {
    // No último dia da janela: a véspera e o do dia; um dia depois, só a véspera.
    const last = once({ id: 'fim', starts_on: '2026-10-27' });
    const after = once({ id: 'depois', starts_on: '2026-10-28' });
    expect(rows({ family: family([last, after]) }).map(([key]) => key)).toEqual([
      'events:fim@2026-10-27:2026-10-26:19:00',
      'events:fim@2026-10-27:2026-10-27:08:00',
      'events:depois@2026-10-28:2026-10-27:19:00',
    ]);
    const daily = once({ id: 'aula', title: 'Aula', start_time: '10:00', recurrence: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6], starts_on: '2026-09-01' });
    expect(rows({ family: family([daily]) })).toHaveLength(HOUSE_REMINDER_LIMIT);
    // Com teto 3 e os dois avisos da conta, os compromissos ficam com 2 vagas
    // (metade, para cima); depois, tudo junto, os mais próximos primeiro.
    const limited = rows({ family: family([daily]), bills: [bill], limit: 3 });
    expect(limited.map(([key]) => key)).toEqual(['events:aula@2026-09-27:2026-09-27', 'events:aula@2026-09-28:2026-09-28', 'bills:b1:2026-10-04']);
    expect(rows({ family: family([daily]), limit: 0 })).toEqual([]);
  });

  it('os compromissos têm a sua parte do teto: a rotina não tira o aviso da conta nem do documento', () => {
    // Natação às terças e quintas, sem data para acabar: 9 avisos na janela.
    const routine = { ...swim, until_on: null };
    const house = { bills: [{ ...bill, next_due_on: '2026-10-25' }], documents: [{ ...doc, expires_on: '2026-10-26' }] };
    const others = ['documents:d1:2026-10-11', 'documents:d1:2026-10-19', 'bills:b1:2026-10-24', 'bills:b1:2026-10-25', 'documents:d1:2026-10-26'];
    const split = (plan: ReturnType<typeof planHouseReminders>) => ({
      events: plan.filter((r) => r.kind === 'events').map((r) => r.date),
      others: plan.filter((r) => r.kind !== 'events').map((r) => r.key),
    });
    // Duas casas dividem o teto (12): os 5 da conta e do documento entram
    // todos, e a natação fica com as 7 vagas que sobram, as mais próximas.
    const shared = planHouseReminders({ ...base, ...house, family: family([routine]), limit: 12 });
    expect(shared).toHaveLength(12);
    expect(split(shared)).toEqual({
      events: ['2026-09-29', '2026-10-01', '2026-10-06', '2026-10-08', '2026-10-13', '2026-10-15', '2026-10-20'],
      others,
    });
    // Com a escola de segunda a sexta junto, no teto de sempre: idem.
    const school = once({ id: 'escola', title: 'Escola', starts_on: '2026-09-01', start_time: '07:30', recurrence: 'weekly', weekdays: [1, 2, 3, 4, 5] });
    const full = planHouseReminders({ ...base, ...house, family: family([routine, school]) });
    expect(full).toHaveLength(HOUSE_REMINDER_LIMIT);
    expect(split(full).others).toEqual(others);
    expect(split(full).events).toHaveLength(HOUSE_REMINDER_LIMIT - others.length);
  });

  it('com poucos avisos dos outros tipos, os compromissos usam as vagas livres; com muitos, ficam com metade', () => {
    const daily = once({ id: 'aula', title: 'Aula', start_time: '10:00', recurrence: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6], starts_on: '2026-09-01' });
    const count = (input: Partial<HouseReminderInput>) => {
      const plan = planHouseReminders({ ...base, family: family([daily]), ...input });
      return [plan.filter((r) => r.kind === 'events').length, plan.filter((r) => r.kind !== 'events').length];
    };
    // Uma conta só (véspera e dia): nenhuma vaga fica vazia.
    expect(count({ bills: [{ ...bill, next_due_on: '2026-10-25' }] })).toEqual([HOUSE_REMINDER_LIMIT - 2, 2]);
    // Quarenta tarefas mais para a frente: sem a parte de cada um, as aulas de
    // todo dia ficariam com quase todas as vagas.
    const chores = Array.from({ length: 40 }, (_, i) => ({ ...chore, id: `c${i}`, due_on: '2026-10-20' }));
    expect(count({ chores })).toEqual([HOUSE_REMINDER_LIMIT / 2, HOUSE_REMINDER_LIMIT / 2]);
    // Teto ímpar: a metade arredonda para cima.
    expect(count({ chores, limit: 5 })).toEqual([3, 2]);
    expect(count({ chores, limit: 1 })).toEqual([1, 0]);
  });

  it('com o resumo de amanhã ligado: a parte dos compromissos é a mesma, e o resumo entra na vez dele', () => {
    const daily = once({ id: 'aula', title: 'Aula', start_time: '10:00', recurrence: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6], starts_on: '2026-09-01' });
    const chores = Array.from({ length: 40 }, (_, i) => ({ ...chore, id: `c${i}`, due_on: '2026-10-20' }));
    const input = { ...base, kinds: { ...all, eve: true }, family: family([daily]), bills: [{ ...bill, next_due_on: '2026-09-29' }], chores };
    // Teto 6: as aulas ficam com metade (as 3 mais próximas); a conta, com a
    // véspera e o dia; e o resumo da noite de 28/09 (que fala da conta do dia
    // 29) vem depois dos avisos até o dia 29 e antes das tarefas do dia 20/10.
    expect(planHouseReminders({ ...input, limit: 6 }).map((r) => r.key)).toEqual([
      'events:aula@2026-09-27:2026-09-27',
      'bills:b1:2026-09-28',
      'events:aula@2026-09-28:2026-09-28',
      'eve:amanha:2026-09-28:20:00',
      'bills:b1:2026-09-29',
      'events:aula@2026-09-29:2026-09-29',
    ]);
    // Uma vaga a menos: sai o resumo, e não um aviso do dia de que ele fala.
    expect(planHouseReminders({ ...input, limit: 5 }).map((r) => r.kind)).toEqual(['events', 'bills', 'events', 'bills', 'events']);
    // O resumo não fala dos compromissos (eles têm os avisos próprios): sem a conta, a noite de 28/09 não tem resumo.
    expect(planHouseReminders({ ...input, bills: [], limit: 6 }).filter((r) => r.date < '2026-10-19').map((r) => r.kind)).toEqual([
      'events',
      'events',
      'events',
    ]);
    // O resumo comum não conta entre "os outros tipos" na parte dos compromissos.
    // Com duas tarefas (02 e 03/10) e os resumos das noites de 01 e 02/10, as
    // aulas ficam com as 6 vagas que as tarefas deixam; pela fila, entram as
    // aulas até 02/10 e o resumo da noite de 01/10, e ficam para depois a
    // tarefa de 03/10 e o resumo da noite de 02/10 (os mais distantes).
    const two = [
      { ...chore, id: 'c1', due_on: '2026-10-02' },
      { ...chore, id: 'c2', due_on: '2026-10-03' },
    ];
    expect(planHouseReminders({ ...input, bills: [], chores: two, limit: 8 }).map((r) => r.key)).toEqual([
      'events:aula@2026-09-27:2026-09-27',
      'events:aula@2026-09-28:2026-09-28',
      'events:aula@2026-09-29:2026-09-29',
      'events:aula@2026-09-30:2026-09-30',
      'events:aula@2026-10-01:2026-10-01',
      'eve:amanha:2026-10-01:20:00',
      'chores:c1:2026-10-02',
      'events:aula@2026-10-02:2026-10-02',
    ]);
  });

  it('desligado, ou sem os dados carregados: nada', () => {
    expect(rows({ kinds: { ...all, events: false }, family: family([swim]) })).toEqual([]);
    expect(rows({ family: undefined })).toEqual([]);
    // Sem compromissos (a tabela ainda não existe): os aniversários avisam.
    expect(rows({ family: withBirthday([]) }).map(([, , , title]) => title)).toEqual(['Hoje é aniversário de Ana']);
  });
});

describe('eveSummary (resumo de amanhã)', () => {
  type Sources = Parameters<typeof eveSummary>[0];
  // 29/09/2026 é uma terça-feira.
  const day = '2026-09-29';
  const empty: Sources = { bills: [], documents: [], chores: [], appointments: [], vaccines: [], equipment: [] };
  const consulta = { id: 'a1', title: 'Pediatra', person: 'Bia', date: day, time: '09:00', location: 'Clínica Sol', status: 'agendada' };
  const luz = { id: 'b1', name: 'Luz', amount: 180, next_due_on: day, active: true, autopay: false };
  const vacina = { id: 'v1', name: 'Tríplice', dose: '2ª dose', person: 'Bia', next_dose_on: day };
  const lixo = { id: 'c1', title: 'Pôr o lixo para fora', due_on: day, active: true, equipment_id: null, recurrence: 'weekly' as const, interval_count: 1 };
  const filtro = { id: 'c2', title: 'Limpar o filtro', due_on: day, active: true, equipment_id: 'e1', recurrence: 'monthly' as const, interval_count: 3 };
  const cnh = { id: 'd1', title: 'CNH do Beto', expires_on: day, remind_days: 30 };
  const geladeira = { id: 'e2', name: 'Geladeira', warranty_until: day };
  const summary = (input: Partial<Sources>, on = day) => eveSummary({ ...empty, ...input }, on);

  it('um item só: o texto é o item, sem pontuação de lista', () => {
    const alone: [Partial<Sources>, string][] = [
      [{ appointments: [consulta] }, '9h Pediatra (Bia)'],
      [{ appointments: [{ ...consulta, time: '09:30' }] }, '9h30 Pediatra (Bia)'],
      [{ appointments: [{ ...consulta, time: '14:05', person: '' }] }, '14h05 Pediatra'],
      [{ bills: [luz] }, 'Luz (R$ 180,00)'],
      [{ bills: [{ ...luz, amount: null }] }, 'Conta: Luz'],
      // O nome que já diz que é conta não ganha a palavra de novo.
      [{ bills: [{ ...luz, name: 'Conta de luz', amount: null }] }, 'Conta de luz'],
      [{ bills: [{ ...luz, name: 'contas da casa', amount: null }] }, 'contas da casa'],
      [{ bills: [{ ...luz, name: 'Contador', amount: null }] }, 'Conta: Contador'],
      [{ vaccines: [vacina] }, 'Vacina de Bia: Tríplice (2ª dose)'],
      [{ vaccines: [{ ...vacina, dose: null, person: '' }] }, 'Vacina: Tríplice'],
      [{ chores: [lixo] }, 'Pôr o lixo para fora'],
      [{ chores: [filtro] }, 'Manutenção: Limpar o filtro'],
      [{ documents: [cnh] }, 'Vence: CNH do Beto'],
      [{ equipment: [geladeira] }, 'Fim da garantia: Geladeira'],
    ];
    for (const [input, text] of alone) {
      expect(summary(input)).toMatchObject({ title: 'Amanhã, terça-feira', body: text, written: 1 });
    }
  });

  it('o título diz que dia da semana é amanhã', () => {
    // 27/09/2026 é um domingo.
    const titles = Array.from({ length: 7 }, (_, i) => {
      const on = addDays('2026-09-27', i);
      return summary({ bills: [{ ...luz, next_due_on: on }] }, on)?.title;
    });
    expect(titles).toEqual([
      'Amanhã, domingo',
      'Amanhã, segunda-feira',
      'Amanhã, terça-feira',
      'Amanhã, quarta-feira',
      'Amanhã, quinta-feira',
      'Amanhã, sexta-feira',
      'Amanhã, sábado',
    ]);
  });

  it('tudo junto: consultas pela hora, depois contas, vacinas, tarefas e manutenções, documentos e garantias', () => {
    const dentista = { ...consulta, id: 'a2', title: 'Dentista', person: 'Beto', time: '16:30' };
    const everything = summary({
      equipment: [geladeira],
      documents: [cnh],
      chores: [lixo, filtro],
      vaccines: [vacina],
      bills: [luz],
      appointments: [dentista, consulta],
    });
    expect(everything?.items.map((i) => i.text)).toEqual([
      '9h Pediatra (Bia)',
      '16h30 Dentista (Beto)',
      'Luz (R$ 180,00)',
      'Vacina de Bia: Tríplice (2ª dose)',
      'Manutenção: Limpar o filtro',
      'Pôr o lixo para fora',
      'Vence: CNH do Beto',
      'Fim da garantia: Geladeira',
    ]);
    expect(everything).toMatchObject({ body: '9h Pediatra (Bia) · 16h30 Dentista (Beto) · Luz (R$ 180,00) e mais 5', written: 3 });
  });

  it('até 4 itens vão escritos; com mais, os 3 primeiros e "e mais N"', () => {
    expect(summary({ bills: [luz], documents: [cnh] })?.body).toBe('Luz (R$ 180,00) · Vence: CNH do Beto');
    expect(summary({ appointments: [consulta], bills: [luz], documents: [cnh], equipment: [geladeira] })?.body).toBe(
      '9h Pediatra (Bia) · Luz (R$ 180,00) · Vence: CNH do Beto · Fim da garantia: Geladeira',
    );
    expect(summary({ appointments: [consulta], bills: [luz], vaccines: [vacina], documents: [cnh], equipment: [geladeira] })?.body).toBe(
      '9h Pediatra (Bia) · Luz (R$ 180,00) · Vacina de Bia: Tríplice (2ª dose) e mais 2',
    );
  });

  it('dia sem nada não tem resumo; o que é de outro dia não entra', () => {
    const full = { appointments: [consulta], bills: [luz], vaccines: [vacina], chores: [lixo, filtro], documents: [cnh], equipment: [geladeira] };
    expect(summary({})).toBeNull();
    expect(summary(full, '2026-09-28')).toBeNull();
    expect(summary(full, '2026-09-30')).toBeNull();
  });

  it('ficam de fora: tarefa de todo dia, débito automático, o que está desativado e consulta que não está agendada', () => {
    const daily = { ...lixo, id: 'c3', title: 'Lavar a louça', recurrence: 'daily' as const };
    expect(summary({ chores: [daily] })).toBeNull();
    // A semanal que cai naquele dia entra.
    expect(summary({ chores: [daily, lixo, { ...filtro, active: false }] })?.body).toBe('Pôr o lixo para fora');
    expect(summary({ bills: [{ ...luz, autopay: true }, { ...luz, id: 'b2', active: false }] })).toBeNull();
    expect(summary({ appointments: [{ ...consulta, status: 'cancelada' }, { ...consulta, id: 'a2', status: 'realizada' }] })).toBeNull();
    expect(
      summary({
        documents: [{ ...cnh, expires_on: null }],
        equipment: [{ ...geladeira, warranty_until: null }],
        vaccines: [{ ...vacina, next_dose_on: null }],
      }),
    ).toBeNull();
  });

  it('vacina já tomada não entra (a sincronização só passa as doses por tomar)', () => {
    const records = [
      { id: 'v1', person_id: 'p1', name: 'Tríplice', dose: '1ª dose', applied_on: '2026-03-01', next_dose_on: day },
      // A 2ª dose foi aplicada antes da data marcada: a próxima dose do registro anterior já foi.
      { id: 'v2', person_id: 'p1', name: 'Tríplice', dose: '2ª dose', applied_on: '2026-09-20', next_dose_on: null },
    ];
    const pending = (list: typeof records) =>
      pendingNextDoses(list).map((v) => ({ id: v.id, name: v.name, dose: v.dose, person: 'Bia', next_dose_on: v.next_dose_on }));
    expect(summary({ vaccines: pending(records.slice(0, 1)) })?.body).toBe('Vacina de Bia: Tríplice (1ª dose)');
    expect(summary({ vaccines: pending(records) })).toBeNull();
  });

  it('tarefa de rotina (diária, a cada 2 ou 3 dias) fica de fora como a de todo dia; a cada 4 dias ou mais, entra', () => {
    const every = (interval_count: number) => ({
      ...lixo,
      id: `d${interval_count}`,
      title: `A cada ${interval_count} dias`,
      recurrence: 'daily' as const,
      interval_count,
    });
    expect(summary({ chores: [every(1), every(2), every(3)] })).toBeNull();
    expect(summary({ chores: [every(2), every(3), every(4), every(15)] })?.body).toBe('A cada 15 dias · A cada 4 dias');
    // "Uma vez" (ou sem a repetição nos dados), semanal e mensal: entram, em qualquer intervalo.
    const others = [
      { ...lixo, id: 'n', title: 'Uma vez', recurrence: 'none' as const, interval_count: 1 },
      { ...lixo, id: 's', title: 'Semanal', recurrence: 'weekly' as const, interval_count: 1 },
      { ...lixo, id: 'm', title: 'Mensal', recurrence: 'monthly' as const, interval_count: 2 },
      { id: 'x', title: 'Sem repetição', due_on: day, active: true, equipment_id: null },
    ];
    expect(summary({ chores: others })?.body).toBe('Mensal · Sem repetição · Semanal · Uma vez');
  });

  it('consulta cedo (sem o aviso de 2 horas antes) leva o local; as outras, não', () => {
    const at = (time: string, location: string | null = 'Clínica Crescer') =>
      summary({ appointments: [{ ...consulta, person: 'Theo', time, location }] })?.body;
    expect(at('08:30')).toBe('8h30 Pediatra (Theo), Clínica Crescer');
    expect(at('07:00')).toBe('7h Pediatra (Theo), Clínica Crescer');
    expect(at('08:59')).toBe('8h59 Pediatra (Theo), Clínica Crescer');
    // Das 9h em diante há o aviso de 2 horas antes, que diz o local.
    expect(at('09:00')).toBe('9h Pediatra (Theo)');
    expect(at('14:30')).toBe('14h30 Pediatra (Theo)');
    expect(at('08:30', null)).toBe('8h30 Pediatra (Theo)');
    // No meio dos outros itens, o local fica junto da consulta dele.
    const early = { ...consulta, person: 'Theo', time: '08:30', location: 'Clínica Crescer' };
    const dentista = { ...consulta, id: 'a2', title: 'Dentista', person: 'Beto', time: '16:30' };
    expect(summary({ appointments: [dentista, early], bills: [luz] })).toMatchObject({
      body: '8h30 Pediatra (Theo), Clínica Crescer · 16h30 Dentista (Beto) · Luz (R$ 180,00)',
      items: [{ text: '8h30 Pediatra (Theo)', place: 'Clínica Crescer' }, { text: '16h30 Dentista (Beto)' }, { text: 'Luz (R$ 180,00)' }],
    });
  });

  it('com o texto comprido, o local é o primeiro a encolher: os itens ficam inteiros e ele fica com o que sobra', () => {
    const early = { ...consulta, person: 'Theo', time: '08:30', location: 'Clínica Crescer, na Avenida Paulista' };
    const errand = (length: number) => ({ ...lixo, title: 'Buscar o bolo'.padEnd(length, '!') });
    // Os outros itens deixam 27 caracteres: o local é cortado, e nenhum item.
    const tight = summary({ appointments: [early], chores: [errand(130)] });
    expect(tight?.body).toBe(`8h30 Pediatra (Theo), Clínica Crescer, na Aven… · ${errand(130).title}`);
    expect(tight?.body).toHaveLength(180);
    // O corte não deixa uma vírgula solta antes do "…".
    expect(summary({ appointments: [early], chores: [errand(137)] })?.body).toBe(`8h30 Pediatra (Theo), Clínica Crescer… · ${errand(137).title}`);
    // Sobrando menos que o começo do nome, o local não entra (nada de ", C…").
    expect(summary({ appointments: [early], chores: [errand(150)] })?.body).toBe(`8h30 Pediatra (Theo) · ${errand(150).title}`);
    // Local curto que cabe inteiro no pouco que sobra: entra.
    expect(summary({ appointments: [{ ...early, location: 'UBS' }], chores: [errand(152)] })?.body).toBe(
      `8h30 Pediatra (Theo), UBS · ${errand(152).title}`,
    );
    // Item comprido demais: ele é que é cortado, como sempre, e o local não entra.
    const long = summary({ appointments: [{ ...early, title: 'Ortodontia'.repeat(30) }], bills: [luz] });
    expect(long?.body).toBe(`${`8h30 ${'Ortodontia'.repeat(30)} (Theo)`.slice(0, 161)}… · Luz (R$ 180,00)`);
    expect(long?.body).toHaveLength(180);
    // Duas consultas cedo: o que sobra vai primeiro para o local da primeira.
    const second = { ...early, id: 'a2', title: 'Exame de sangue', time: '08:45', location: 'Laboratório Central' };
    const both = summary({ appointments: [second, early], chores: [errand(80)] });
    expect(both?.body).toBe(
      `8h30 Pediatra (Theo), Clínica Crescer, na Avenida Paulista · 8h45 Exame de sangue (Theo), Labora… · ${errand(80).title}`,
    );
    expect(both?.body).toHaveLength(180);
    expect(summary({ appointments: [second, early], chores: [errand(96)] })?.body).toBe(
      `8h30 Pediatra (Theo), Clínica Crescer, na Avenida… · 8h45 Exame de sangue (Theo) · ${errand(96).title}`,
    );
  });

  it('várias vacinas da mesma pessoa viram um item só; uma só fica com o texto de sempre', () => {
    const hepatite = { ...vacina, id: 'v2', name: 'Hepatite A', dose: null };
    const gripe = { ...vacina, id: 'v3', name: 'Gripe', dose: null };
    const two = summary({ vaccines: [vacina, hepatite] });
    expect(two).toMatchObject({ body: 'Vacinas de Bia: Hepatite A e Tríplice (2ª dose)', written: 1 });
    expect(two?.items).toEqual([{ source: 'vaccines', id: 'v2+v1', text: 'Vacinas de Bia: Hepatite A e Tríplice (2ª dose)', sort: '' }]);
    // A ordem em que os dados chegam não muda o texto.
    expect(summary({ vaccines: [hepatite, vacina] })?.body).toBe(two?.body);
    expect(summary({ vaccines: [vacina, gripe, hepatite] })?.body).toBe('Vacinas de Bia: Gripe, Hepatite A e Tríplice (2ª dose)');
    expect(summary({ vaccines: [{ ...vacina, person: '' }, { ...hepatite, person: '' }] })?.body).toBe('Vacinas: Hepatite A e Tríplice (2ª dose)');
    // Cada pessoa tem o seu item.
    expect(summary({ vaccines: [vacina, hepatite, { ...gripe, person: 'Beto' }] })?.body).toBe(
      'Vacina de Beto: Gripe · Vacinas de Bia: Hepatite A e Tríplice (2ª dose)',
    );
    // Conta como um item: quatro itens vão escritos, e no "e mais N" ele vale um.
    expect(summary({ appointments: [consulta], bills: [luz], vaccines: [vacina, hepatite, gripe], documents: [cnh] })?.body).toBe(
      '9h Pediatra (Bia) · Luz (R$ 180,00) · Vacinas de Bia: Gripe, Hepatite A e Tríplice (2ª dose) · Vence: CNH do Beto',
    );
    expect(summary({ appointments: [consulta], bills: [luz], vaccines: [vacina, hepatite], documents: [cnh], equipment: [geladeira] })).toMatchObject({
      body: '9h Pediatra (Bia) · Luz (R$ 180,00) · Vacinas de Bia: Hepatite A e Tríplice (2ª dose) e mais 2',
      written: 3,
    });
    // O dia de vacinas do bebê cabe numa linha que dá para ler.
    const baby = ['Pentavalente', 'Pneumocócica 10V', 'Rotavírus', 'VIP'].map((name, i) => ({
      id: `b${i}`,
      name,
      dose: '2ª dose',
      person: 'Theo',
      next_dose_on: day,
    }));
    expect(summary({ vaccines: baby })?.body).toBe(
      'Vacinas de Theo: Pentavalente (2ª dose), Pneumocócica 10V (2ª dose), Rotavírus (2ª dose) e VIP (2ª dose)',
    );
  });

  it('nunca passa de 180 caracteres: o item comprido é cortado com "…" e os curtos ficam inteiros', () => {
    const long = { ...consulta, title: 'Ortodontia'.repeat(30) };
    const text = `9h ${long.title} (Bia)`;
    const cut = summary({ appointments: [long], bills: [luz], documents: [cnh], equipment: [geladeira] });
    expect(cut?.body).toBe(`${text.slice(0, 111)}… · Luz (R$ 180,00) · Vence: CNH do Beto · Fim da garantia: Geladeira`);
    expect(cut?.body).toHaveLength(180);
    // Sozinho, usa a linha toda.
    expect(summary({ appointments: [long] })?.body).toBe(`${text.slice(0, 179)}…`);
    // Dois compridos dividem o espaço.
    const contract = { ...cnh, title: 'Contrato'.repeat(40) };
    expect(summary({ appointments: [long], documents: [contract] })?.body).toBe(
      `${text.slice(0, 87)}… · ${`Vence: ${contract.title}`.slice(0, 87)}…`,
    );
    // Com "e mais N", ele também conta no limite.
    const many = summary({
      appointments: [long, { ...long, id: 'a2', time: '10:00' }, { ...long, id: 'a3', time: '11:00' }],
      bills: [luz],
      documents: [cnh],
    });
    expect(many?.body).toHaveLength(180);
    expect(many?.body.split(' · ').map((part) => part.slice(0, 12))).toEqual(['9h Ortodonti', '10h Ortodont', '11h Ortodont']);
    expect(many?.body.endsWith('… e mais 2')).toBe(true);
  });

  it('o corte não parte um emoji ao meio', () => {
    const teeth = { ...consulta, person: '', title: `A${'🦷'.repeat(120)}` };
    expect(summary({ appointments: [teeth] })?.body).toBe(`9h A${'🦷'.repeat(87)}…`);
  });
});

describe('planHouseReminders: resumo de amanhã', () => {
  const none = { bills: false, documents: false, chores: false, appointments: false, events: false, vaccines: false, weather: false, eve: false };
  const onlyEve = { ...none, eve: true };
  const both = { ...none, appointments: true, eve: true };
  const weekly = (due_on: string) => ({
    id: `t-${due_on}`,
    title: 'Trocar a roupa de cama',
    due_on,
    active: true,
    equipment_id: null,
    recurrence: 'weekly' as const,
    interval_count: 1,
  });
  const appointment = { id: 'a1', title: 'Pediatra', person: 'Lia', date: '2026-10-02', time: '14:30', location: 'Clínica Sol', status: 'agendada' };
  const keys = (plan: ReturnType<typeof planHouseReminders>) => plan.map((r) => r.key);

  it('toca às 20h da véspera, nas próximas 7 noites, só nas que têm algo no dia seguinte', () => {
    // Uma tarefa por dia, de hoje (domingo, 27/09) a 06/10: a de hoje e as de depois de 04/10 não têm noite na janela.
    const chores = Array.from({ length: 10 }, (_, i) => weekly(addDays(base.today, i)));
    const plan = planHouseReminders({ ...base, kinds: onlyEve, chores });
    const weekdays = ['segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado', 'domingo'];
    expect(plan.map((r) => [r.key, r.kind, r.date, r.time, r.title, r.body])).toEqual(
      weekdays.map((weekday, i) => {
        const evening = addDays(base.today, i);
        return [`eve:amanha:${evening}:20:00`, 'eve', evening, EVE_SUMMARY_TIME, `Amanhã, ${weekday}`, 'Trocar a roupa de cama'];
      }),
    );
    // A última noite é a de daqui a 6 dias (03/10), sobre o dia 04/10.
    expect(plan[plan.length - 1].date).toBe('2026-10-03');
    // Noite sem nada no dia seguinte fica em silêncio.
    const some = planHouseReminders({ ...base, kinds: onlyEve, chores: [weekly('2026-09-30'), weekly('2026-10-02')] });
    expect(some.map((r) => [r.date, r.title])).toEqual([
      ['2026-09-29', 'Amanhã, quarta-feira'],
      ['2026-10-01', 'Amanhã, sexta-feira'],
    ]);
    expect(planHouseReminders({ ...base, kinds: onlyEve })).toEqual([]);
  });

  it('a noite de hoje só entra se ainda não deu 20h', () => {
    const chores = [weekly('2026-09-28'), weekly('2026-09-29')];
    const evenings = (nowTime: string) => planHouseReminders({ ...base, kinds: onlyEve, nowTime, chores }).map((r) => r.date);
    expect(evenings('19:59')).toEqual(['2026-09-27', '2026-09-28']);
    expect(evenings('20:00')).toEqual(['2026-09-28']);
    expect(evenings('23:10')).toEqual(['2026-09-28']);
  });

  it('duas tarefas de dia sim, dia não, alternadas, não fazem o resumo tocar toda noite', () => {
    const everyOtherDay = (id: string, title: string, due_on: string) => ({
      id,
      title,
      due_on,
      active: true,
      equipment_id: null,
      recurrence: 'daily' as const,
      interval_count: 2,
    });
    // Dez manhãs seguidas, o app aberto em todas: uma das tarefas é de hoje e a outra, de amanhã.
    for (let i = 0; i < 10; i++) {
      const today = addDays(base.today, i);
      const chores = [
        everyOtherDay('plantas', 'Regar as plantas', addDays(today, i % 2)),
        everyOtherDay('areia', 'Limpar a caixa de areia', addDays(today, (i + 1) % 2)),
      ];
      expect(planHouseReminders({ ...base, today, kinds: onlyEve, chores })).toEqual([]);
      // Com outra coisa no dia seguinte, o resumo fala só dela.
      const withWeekly = planHouseReminders({ ...base, today, kinds: onlyEve, chores: [...chores, weekly(addDays(today, 1))] });
      expect(withWeekly.map((r) => [r.date, r.body])).toEqual([[today, 'Trocar a roupa de cama']]);
      // O aviso próprio delas, no dia, às 9h, continua.
      const own = planHouseReminders({ ...base, today, kinds: { ...onlyEve, chores: true }, chores });
      expect(keys(own)).toEqual([`chores:${i % 2 ? 'areia' : 'plantas'}:${today}`, `chores:${i % 2 ? 'plantas' : 'areia'}:${addDays(today, 1)}`]);
    }
  });

  it('a dica do resumo diz que a consulta de amanhã vem nele; a das consultas é a de sempre', () => {
    const hint = (key: string) => HOUSE_REMINDER_KINDS.find((kind) => kind.key === key)?.hint;
    expect(hint('eve')).toBe(
      'Toda noite, às 20h, o que a casa tem no dia seguinte: consultas, contas, tarefas, vacinas e documentos. Só quando há alguma coisa. Com ele ligado, a consulta de amanhã vem nele, no lugar do aviso das 19h',
    );
    expect(hint('appointments')).toBe('Na véspera, às 19h, e 2 horas antes');
  });

  it('com o resumo ligado, a consulta vai nele e o "Consulta amanhã" das 19h não toca junto', () => {
    const input = { ...base, appointments: [appointment] };
    expect(planHouseReminders({ ...input, kinds: both }).map((r) => [r.key, r.title, r.body])).toEqual([
      ['eve:amanha:2026-10-01:20:00', 'Amanhã, sexta-feira', '14h30 Pediatra (Lia)'],
      ['appointments:a1:2026-10-02:12:30', 'Consulta daqui a 2 horas', 'Pediatra — Lia, às 14:30 (Clínica Sol).'],
    ]);
    // Resumo desligado: os avisos da consulta são os de sempre.
    expect(keys(planHouseReminders({ ...input, kinds: { ...both, eve: false } }))).toEqual([
      'appointments:a1:2026-10-01:19:00',
      'appointments:a1:2026-10-02:12:30',
    ]);
    // Só o resumo ligado: a consulta aparece nele, sem os avisos de consulta.
    expect(keys(planHouseReminders({ ...input, kinds: onlyEve }))).toEqual(['eve:amanha:2026-10-01:20:00']);
  });

  it('consulta cuja véspera ainda não tem resumo (além das 7 noites) continua com o aviso das 19h', () => {
    const on = (date: string) => keys(planHouseReminders({ ...base, kinds: both, appointments: [{ ...appointment, date }] }));
    // Véspera daqui a 6 dias: a última noite com resumo.
    expect(on('2026-10-04')).toEqual(['eve:amanha:2026-10-03:20:00', 'appointments:a1:2026-10-04:12:30']);
    expect(on('2026-10-05')).toEqual(['appointments:a1:2026-10-04:19:00', 'appointments:a1:2026-10-05:12:30']);
    expect(on('2026-10-10')).toEqual(['appointments:a1:2026-10-09:19:00', 'appointments:a1:2026-10-10:12:30']);
  });

  it('consulta de amanhã, com a noite de hoje já passada: sem aviso à noite, com o resumo ou sem ele', () => {
    const tomorrow = { ...appointment, date: '2026-09-28' };
    const at = (nowTime: string, eve: boolean) => keys(planHouseReminders({ ...base, nowTime, kinds: { ...both, eve }, appointments: [tomorrow] }));
    expect(at('20:30', true)).toEqual(['appointments:a1:2026-09-28:12:30']);
    expect(at('20:30', false)).toEqual(['appointments:a1:2026-09-28:12:30']);
    // Entre as 19h e as 20h, o resumo ainda toca.
    expect(at('19:30', true)).toEqual(['eve:amanha:2026-09-27:20:00', 'appointments:a1:2026-09-28:12:30']);
    expect(at('19:30', false)).toEqual(['appointments:a1:2026-09-28:12:30']);
  });

  it('consulta que não coube escrita no resumo ("e mais N") fica com o aviso das 19h', () => {
    const five = ['08:00', '09:00', '10:00', '11:00', '15:00'].map((time, i) => ({ ...appointment, id: `a${i}`, time }));
    const night = planHouseReminders({ ...base, kinds: both, appointments: five }).filter((r) => r.date === '2026-10-01');
    expect(night.map((r) => [r.key, r.body])).toEqual([
      ['appointments:a3:2026-10-01:19:00', 'Pediatra — Lia, às 11:00 (Clínica Sol).'],
      ['appointments:a4:2026-10-01:19:00', 'Pediatra — Lia, às 15:00 (Clínica Sol).'],
      ['eve:amanha:2026-10-01:20:00', '8h Pediatra (Lia), Clínica Sol · 9h Pediatra (Lia) · 10h Pediatra (Lia) e mais 2'],
    ]);
  });

  // Uma casa com um pouco de tudo na semana (hoje é domingo, 27/09, 8h) e uma conta mais adiante.
  const house: HouseReminderInput = {
    ...base,
    kinds: { ...all, eve: true },
    bills: [
      { id: 'luz', name: 'Luz', amount: 180, next_due_on: '2026-09-29', active: true, autopay: false },
      { id: 'agua', name: 'Água', amount: null, next_due_on: '2026-10-01', active: true, autopay: false },
      { id: 'net', name: 'Internet', amount: 99.9, next_due_on: '2026-10-15', active: true, autopay: false },
    ],
    chores: [weekly('2026-10-04')],
    appointments: [{ ...appointment, id: 'ped', date: '2026-09-30', location: null }],
    vaccines: [{ id: 'vac', name: 'Tríplice viral', dose: '2ª dose', person: 'Lia', next_dose_on: '2026-10-03' }],
    equipment: [],
  };
  // Os avisos próprios dos dias do resumo (até 04/10), sem o "Consulta amanhã".
  const week = [
    'bills:luz:2026-09-28',
    'bills:luz:2026-09-29',
    'bills:agua:2026-09-30',
    'appointments:ped:2026-09-30:12:30',
    'bills:agua:2026-10-01',
    'vaccines:vac:2026-10-03',
    'chores:t-2026-10-04:2026-10-04',
  ];
  const later = ['bills:net:2026-10-14', 'bills:net:2026-10-15'];

  it('desligado: nenhum resumo, e o resto do plano é o de sempre', () => {
    const off = planHouseReminders({ ...house, kinds: all });
    expect(keys(off)).toEqual([...week.slice(0, 2), 'appointments:ped:2026-09-29:19:00', ...week.slice(2), ...later]);
    // Ligado: os mesmos avisos, mais os resumos, menos o "Consulta amanhã" da noite que tem resumo.
    const on = planHouseReminders(house);
    expect(on.filter((r) => r.kind !== 'eve')).toEqual(off.filter((r) => r.key !== 'appointments:ped:2026-09-29:19:00'));
    expect(on.filter((r) => r.kind === 'eve').map((r) => [r.date, r.time, r.title, r.body])).toEqual([
      ['2026-09-28', '20:00', 'Amanhã, terça-feira', 'Luz (R$ 180,00)'],
      ['2026-09-29', '20:00', 'Amanhã, quarta-feira', '14h30 Pediatra (Lia)'],
      ['2026-09-30', '20:00', 'Amanhã, quinta-feira', 'Conta: Água'],
      ['2026-10-02', '20:00', 'Amanhã, sábado', 'Vacina de Lia: Tríplice viral (2ª dose)'],
      ['2026-10-03', '20:00', 'Amanhã, domingo', 'Trocar a roupa de cama'],
    ]);
  });

  const summaryOf = (evening: string) => `eve:amanha:${evening}:20:00`;

  it('teto curto: o resumo de uma noite fica depois dos avisos próprios até o dia de que ele fala, e antes dos de depois', () => {
    const at = (limit: number) => keys(planHouseReminders({ ...house, limit }));
    // Com 8 vagas (o teto de cada casa para quem tem três): tudo até 01/10, com
    // os resumos dessas noites. O de 29/09 leva a consulta e fica no lugar do
    // "Consulta amanhã" dela.
    const upToOctober1st = [
      'bills:luz:2026-09-28',
      summaryOf('2026-09-28'),
      'bills:luz:2026-09-29',
      summaryOf('2026-09-29'),
      'bills:agua:2026-09-30',
      'appointments:ped:2026-09-30:12:30',
      summaryOf('2026-09-30'),
      'bills:agua:2026-10-01',
    ];
    expect(at(8)).toEqual(upToOctober1st);
    // O custo: sem o resumo, as mesmas 8 vagas iam até 04/10. Com ele, a vacina
    // de 03/10 e a tarefa de 04/10 esperam a janela andar (o plano é refeito
    // toda vez que o app abre).
    expect(keys(planHouseReminders({ ...house, kinds: all, limit: 8 }))).toEqual([
      'bills:luz:2026-09-28',
      'bills:luz:2026-09-29',
      'appointments:ped:2026-09-29:19:00',
      'bills:agua:2026-09-30',
      'appointments:ped:2026-09-30:12:30',
      'bills:agua:2026-10-01',
      'vaccines:vac:2026-10-03',
      'chores:t-2026-10-04:2026-10-04',
    ]);
    // Duas vagas a mais: a vacina de 03/10 e o resumo da véspera dela.
    expect(at(10)).toEqual([...upToOctober1st, summaryOf('2026-10-02'), 'vaccines:vac:2026-10-03']);
    // Com 12, a tarefa de 04/10 e o resumo dela; só a conta de mais adiante fica de fora.
    expect(at(12)).toEqual([...upToOctober1st, summaryOf('2026-10-02'), 'vaccines:vac:2026-10-03', summaryOf('2026-10-03'), 'chores:t-2026-10-04:2026-10-04']);
    // Com folga, tudo: os 5 resumos e os avisos de mais adiante.
    expect(at(24)).toEqual([...at(12), ...later]);
    // O resumo não passa na frente de aviso do dia de que ele fala: com 2 vagas, ficam os dois avisos da luz.
    expect(at(2)).toEqual(['bills:luz:2026-09-28', 'bills:luz:2026-09-29']);
    // E as noites mais distantes saem primeiro.
    expect(at(4)).toEqual(['bills:luz:2026-09-28', summaryOf('2026-09-28'), 'bills:luz:2026-09-29', summaryOf('2026-09-29')]);
  });

  // Muita coisa nos mesmos dias (hoje é domingo, 27/09, 8h): duas contas amanhã,
  // duas consultas e duas contas na terça, e uma conta por dia de 06/10 a 10/10.
  const billOn = (id: string, name: string, amount: number | null, next_due_on: string) => ({ id, name, amount, next_due_on, active: true, autopay: false });
  const busy: HouseReminderInput = {
    ...base,
    kinds: { ...none, bills: true, chores: true, appointments: true, eve: true },
    bills: [
      billOn('aluguel', 'Aluguel', 1850, '2026-09-28'),
      billOn('cond', 'Condomínio', 520, '2026-09-28'),
      billOn('escola', 'Escola', null, '2026-09-29'),
      billOn('luz', 'Luz', 180, '2026-09-29'),
      billOn('net', 'Internet', 99.9, '2026-09-30'),
      ...['06', '07', '08', '09', '10'].map((d) => billOn(`dia${d}`, `Conta do dia ${d}`, 50, `2026-10-${d}`)),
    ],
    chores: [{ ...weekly('2026-09-30'), id: 'lixo', title: 'Pôr o lixo para fora' }],
    appointments: [
      { id: 'ped', title: 'Pediatra', person: 'Lia', date: '2026-09-29', time: '08:00', location: 'Clínica Sol', status: 'agendada' },
      { id: 'dent', title: 'Dentista', person: 'Caio', date: '2026-09-29', time: '14:30', location: null, status: 'agendada' },
      { id: 'oft', title: 'Oftalmologista', person: 'Lia', date: '2026-10-01', time: '10:00', location: null, status: 'agendada' },
    ],
    vaccines: [],
    equipment: [],
  };

  it('teto com muitas contas e consultas nos mesmos dias: o resumo desta noite fica, e o que sai são os avisos de mais adiante', () => {
    const at = (limit: number) => keys(planHouseReminders({ ...busy, limit }));
    expect(planHouseReminders(busy).filter((r) => r.kind === 'eve').map((r) => [r.date, r.body])).toEqual([
      ['2026-09-27', 'Aluguel (R$ 1.850,00) · Condomínio (R$ 520,00)'],
      ['2026-09-28', '8h Pediatra (Lia), Clínica Sol · 14h30 Dentista (Caio) · Conta: Escola · Luz (R$ 180,00)'],
      ['2026-09-29', 'Internet (R$ 99,90) · Pôr o lixo para fora'],
      ['2026-09-30', '10h Oftalmologista (Lia)'],
    ]);
    // 8 vagas: hoje e amanhã inteiros. O resumo desta noite (fala de amanhã) e
    // o de amanhã à noite, que está no lugar dos dois "Consulta amanhã".
    const upToTomorrow = [
      'bills:aluguel:2026-09-27',
      'bills:cond:2026-09-27',
      summaryOf('2026-09-27'),
      'bills:aluguel:2026-09-28',
      'bills:cond:2026-09-28',
      'bills:escola:2026-09-28',
      'bills:luz:2026-09-28',
      summaryOf('2026-09-28'),
    ];
    expect(at(8)).toEqual(upToTomorrow);
    // 10 e 12: entram os avisos de terça, na ordem; as contas de quarta e o que vem depois ficam de fora.
    expect(at(10)).toEqual([...upToTomorrow, 'bills:escola:2026-09-29', 'bills:luz:2026-09-29']);
    const upToTuesday = [...upToTomorrow, 'bills:escola:2026-09-29', 'bills:luz:2026-09-29', 'bills:net:2026-09-29', 'appointments:dent:2026-09-29:12:30'];
    expect(at(12)).toEqual(upToTuesday);
    // 24 (uma casa): os 4 resumos e quase tudo. Saem os 3 avisos mais distantes.
    const upToOctober8th = [
      ...upToTuesday,
      summaryOf('2026-09-29'),
      'bills:net:2026-09-30',
      'chores:lixo:2026-09-30',
      summaryOf('2026-09-30'),
      'appointments:oft:2026-10-01:08:00',
      'bills:dia06:2026-10-05',
      'bills:dia06:2026-10-06',
      'bills:dia07:2026-10-06',
      'bills:dia07:2026-10-07',
      'bills:dia08:2026-10-07',
      'bills:dia08:2026-10-08',
      'bills:dia09:2026-10-08',
    ];
    expect(at(24)).toEqual(upToOctober8th);
    expect(at(27)).toEqual([...upToOctober8th, 'bills:dia09:2026-10-09', 'bills:dia10:2026-10-09', 'bills:dia10:2026-10-10']);
    // Sem o resumo, o teto de 24 chegava um aviso mais longe: os resumos de
    // hoje e de terça à noite ocupam duas vagas, e o de amanhã à noite fica com
    // a de dois "Consulta amanhã". Com ele ligado, o "vence hoje" de 09/10
    // espera a janela andar.
    const off = keys(planHouseReminders({ ...busy, kinds: { ...busy.kinds, eve: false }, limit: 24 }));
    expect(off.filter((key) => !at(24).includes(key))).toEqual([
      'appointments:dent:2026-09-28:19:00',
      'appointments:ped:2026-09-28:19:00',
      'appointments:oft:2026-09-30:19:00',
      'bills:dia09:2026-10-09',
    ]);
  });

  // A casa cheia da revisão (hoje é segunda, 12/10, 8h, tudo ligado): 7 contas,
  // 13 tarefas (3 de todo dia), 3 consultas, 2 vacinas, 1 documento e a dica do
  // clima toda manhã. São 14 avisos próprios só entre hoje e amanhã.
  const choreOn = (id: string, title: string, due_on: string, recurrence: 'daily' | 'weekly' | 'monthly', interval_count = 1) => ({
    id,
    title,
    due_on,
    active: true,
    equipment_id: null,
    recurrence,
    interval_count,
  });
  const family: HouseReminderInput = {
    kinds: { ...all, eve: true },
    today: '2026-10-12',
    nowTime: '08:00',
    bills: [
      billOn('cond', 'Condomínio', 780, '2026-10-13'),
      billOn('lia', 'Escola da Lia', null, '2026-10-13'),
      billOn('caio', 'Escola do Caio', null, '2026-10-13'),
      billOn('nat', 'Natação', 260, '2026-10-15'),
      billOn('luz', 'Luz', 310.55, '2026-10-16'),
      { ...billOn('net', 'Internet', 119.9, '2026-10-20'), autopay: true },
      billOn('agua', 'Água', 142, '2026-10-21'),
    ],
    documents: [{ id: 'pass', title: 'Passaporte da Lia', expires_on: '2026-10-19', remind_days: 30 }],
    chores: [
      choreOn('louca', 'Lavar a louça', '2026-10-12', 'daily'),
      choreOn('camas', 'Arrumar as camas', '2026-10-12', 'daily'),
      choreOn('thor', 'Dar comida ao Thor', '2026-10-12', 'daily'),
      choreOn('areia', 'Limpar a caixa de areia', '2026-10-13', 'daily', 2),
      choreOn('plantas', 'Regar as plantas', '2026-10-13', 'daily', 2),
      choreOn('roupa', 'Lavar roupa', '2026-10-13', 'daily', 3),
      choreOn('lixo', 'Pôr o lixo para fora', '2026-10-14', 'weekly'),
      choreOn('aspirador', 'Passar aspirador', '2026-10-15', 'weekly'),
      { ...choreOn('filtro', 'Limpar o filtro do ar-condicionado', '2026-10-16', 'monthly', 3), equipment_id: 'ar' },
      choreOn('feira', 'Feira', '2026-10-17', 'weekly'),
      choreOn('banheiro', 'Lavar o banheiro', '2026-10-17', 'weekly'),
      choreOn('banho', 'Banho no Thor', '2026-10-18', 'monthly'),
      choreOn('cama', 'Trocar a roupa de cama', '2026-10-18', 'weekly'),
    ],
    appointments: [
      { id: 'oft', title: 'Oftalmologista', person: 'Lia', date: '2026-10-14', time: '09:00', location: null, status: 'agendada' },
      { id: 'dent', title: 'Dentista', person: 'Caio', date: '2026-10-14', time: '14:30', location: 'Odonto Kids', status: 'agendada' },
      { id: 'vet', title: 'Veterinário', person: 'Thor', date: '2026-10-18', time: '11:00', location: null, status: 'agendada' },
    ],
    vaccines: [
      { id: 'hpv', name: 'HPV', dose: '2ª dose', person: 'Lia', next_dose_on: '2026-10-16' },
      { id: 'raiva', name: 'Antirrábica', dose: null, person: 'Thor', next_dose_on: '2026-10-18' },
    ],
    equipment: [{ id: 'maq', name: 'Máquina de lavar', warranty_until: '2026-10-15' }],
    weather: Array.from({ length: 6 }, (_, i) => ({
      date: addDays('2026-10-13', i),
      time: '07:00',
      title: 'Hoje é dia de lavar roupa',
      body: 'Sem chuva até o fim da tarde.',
    })),
  };

  it('casa cheia, uma casa só (teto 24): o resumo desta noite toca, em vez de ser o primeiro a sair', () => {
    const plan = planHouseReminders(family);
    expect(plan).toHaveLength(HOUSE_REMINDER_LIMIT);
    expect(plan.filter((r) => r.kind === 'eve').map((r) => [r.date, r.body])).toEqual([
      ['2026-10-12', 'Condomínio (R$ 780,00) · Conta: Escola da Lia · Conta: Escola do Caio'],
      ['2026-10-13', '9h Oftalmologista (Lia) · 14h30 Dentista (Caio) · Pôr o lixo para fora'],
    ]);
    // Os avisos próprios são os mesmos de quem não usa o resumo: os dois
    // resumos ficam com as vagas dos dois "Consulta amanhã" de 13/10.
    const off = keys(planHouseReminders({ ...family, kinds: all }));
    expect(keys(plan.filter((r) => r.kind !== 'eve'))).toEqual(off.filter((key) => !key.endsWith(':19:00')));
    expect(off.filter((key) => key.endsWith(':19:00'))).toEqual(['appointments:dent:2026-10-13:19:00', 'appointments:oft:2026-10-13:19:00']);
    // Com 8 vagas (três casas) nem os avisos próprios de hoje e de amanhã cabem: nenhum resumo, e o plano é o de quem não o usa.
    expect(planHouseReminders({ ...family, limit: 8 })).toEqual(planHouseReminders({ ...family, kinds: all, limit: 8 }));
    // Com 16, os 14 avisos de hoje e de amanhã e os dois resumos.
    expect(planHouseReminders({ ...family, limit: 16 }).filter((r) => r.kind === 'eve').map((r) => r.date)).toEqual(['2026-10-12', '2026-10-13']);
    expect(planHouseReminders({ ...family, limit: 15 }).filter((r) => r.kind === 'eve').map((r) => r.date)).toEqual(['2026-10-13']);
  });

  it('em qualquer teto: com o resumo de uma noite no plano, nenhum aviso próprio até o dia de que ele fala ficou de fora', () => {
    for (const input of [house, busy, family]) {
      const whole = planHouseReminders({ ...input, limit: 1000 });
      // Os resumos que não estão no lugar de um "Consulta amanhã" (esses valem pelo aviso das 19h que substituem).
      const carries = (evening: string) => {
        const summary = eveSummary(input, addDays(evening, 1));
        return !!summary && summary.items.slice(0, summary.written).some((item) => item.source === 'appointments');
      };
      const plain = whole.filter((r) => r.kind === 'eve' && !(input.kinds.appointments && carries(r.date)));
      const own = whole.filter((r) => !plain.includes(r));
      // A vez de cada aviso próprio na fila: o resumo que leva uma consulta entra às 19h, no lugar do aviso dela.
      const turnOf = (r: (typeof whole)[number]) => `${r.date} ${r.kind === 'eve' ? '19:00' : r.time}`;
      const inTurn = [...own].sort((a, b) => turnOf(a).localeCompare(turnOf(b)));
      expect(plain.length).toBeGreaterThan(1);
      for (let limit = 0; limit <= whole.length; limit++) {
        const plan = keys(planHouseReminders({ ...input, limit }));
        expect(plan).toHaveLength(limit);
        const kept = plain.filter((r) => plan.includes(r.key));
        // As noites mais distantes saem primeiro.
        expect(kept).toEqual(plain.slice(0, kept.length));
        // O resumo que leva uma consulta fica sempre que caberia sem resumo comum nenhum.
        const owed = inTurn.slice(0, limit).filter((r) => r.kind === 'eve');
        expect(plan).toEqual(expect.arrayContaining(keys(owed)));
        const lastOwed = owed.map(turnOf).sort().at(-1) ?? '';
        for (const summary of plain) {
          if (plan.includes(summary.key)) {
            // Ficou: todo aviso próprio até o dia de que ele fala também ficou.
            const upTo = addDays(summary.date, 1);
            expect(plan).toEqual(expect.arrayContaining(keys(own.filter((r) => r.date <= upTo))));
          } else {
            // Saiu: o que ficou de depois desse dia não passa do resumo que leva a consulta (foi para ele que a vaga foi).
            const after = addDays(summary.date, 2);
            expect(own.filter((r) => r.date >= after && plan.includes(r.key) && turnOf(r) > lastOwed)).toEqual([]);
          }
        }
      }
    }
  });

  it('consulta daqui a alguns dias: o resumo comum de uma noite anterior não tira a véspera dela', () => {
    // Segunda, 12/10. Quem tem três casas fica com 8 avisos por casa.
    const input: HouseReminderInput = {
      kinds: { ...all, weather: false, eve: true },
      today: '2026-10-12',
      nowTime: '08:00',
      bills: [
        { id: 'luz', name: 'Luz', amount: 180, next_due_on: '2026-10-13', active: true, autopay: false },
        { id: 'net', name: 'Internet', amount: 120, next_due_on: '2026-10-14', active: true, autopay: false },
      ],
      documents: [],
      chores: [
        { ...weekly('2026-10-14'), id: 'feira', title: 'Feira' },
        { ...weekly('2026-10-15'), id: 'lixo', title: 'Pôr o lixo para fora' },
      ],
      appointments: [{ ...appointment, id: 'ped', date: '2026-10-16', time: '10:00', location: null }],
      vaccines: [],
      equipment: [],
      limit: 8,
    };
    // Com o resumo desligado, as 8 vagas levam a véspera da consulta e as 2 horas antes.
    expect(keys(planHouseReminders({ ...input, kinds: { ...input.kinds, eve: false } })).slice(-2)).toEqual([
      'appointments:ped:2026-10-15:19:00',
      'appointments:ped:2026-10-16:08:00',
    ]);
    // Ligado: o resumo de quinta à noite leva a consulta e fica; quem sai é o resumo comum da noite mais
    // distante (o de terça). O de hoje à noite continua.
    const plan = planHouseReminders(input);
    expect(keys(plan)).toEqual([
      'bills:luz:2026-10-12',
      'eve:amanha:2026-10-12:20:00',
      'bills:luz:2026-10-13',
      'bills:net:2026-10-13',
      'bills:net:2026-10-14',
      'chores:feira:2026-10-14',
      'chores:lixo:2026-10-15',
      'eve:amanha:2026-10-15:20:00',
    ]);
    expect(plan.at(-1)).toMatchObject({ title: 'Amanhã, sexta-feira', body: '10h Pediatra (Lia)' });
    // Com uma vaga a mais, ninguém precisa sair.
    expect(keys(planHouseReminders({ ...input, limit: 9 }))).toEqual(expect.arrayContaining(['eve:amanha:2026-10-13:20:00', 'eve:amanha:2026-10-15:20:00']));
  });

  it('o resumo que leva a consulta não sai pelo teto antes do "Consulta amanhã" que ele substitui', () => {
    // Três vagas: sem o resumo, os dois avisos da luz e o "Consulta amanhã".
    expect(keys(planHouseReminders({ ...house, kinds: all, limit: 3 }))).toEqual([
      'bills:luz:2026-09-28',
      'bills:luz:2026-09-29',
      'appointments:ped:2026-09-29:19:00',
    ]);
    // Com ele, o resumo da consulta fica no mesmo lugar; o da noite anterior
    // (só a conta de luz), embora toque antes, é o que sai.
    expect(keys(planHouseReminders({ ...house, limit: 3 }))).toEqual(['bills:luz:2026-09-28', 'bills:luz:2026-09-29', 'eve:amanha:2026-09-29:20:00']);
    // Ele toca às 20h, mas entra na fila às 19h, a hora do aviso que substitui: um
    // aviso das 19h30 daquela noite (2 horas antes de uma consulta das 21h30) não passa na frente.
    const late = { ...appointment, id: 'noite', date: '2026-10-01', time: '21:30' };
    const two = { ...base, kinds: both, appointments: [appointment, late], limit: 2 };
    expect(keys(planHouseReminders({ ...two, kinds: { ...both, eve: false } }))).toEqual(['appointments:noite:2026-09-30:19:00', 'appointments:a1:2026-10-01:19:00']);
    expect(keys(planHouseReminders(two))).toEqual(['eve:amanha:2026-09-30:20:00', 'eve:amanha:2026-10-01:20:00']);
  });

  it('entre as 19h e as 20h, o resumo desta noite com a consulta de amanhã também não sai pelo teto', () => {
    // Às 19h30 o "Consulta amanhã" já não toca (com o resumo ligado, nem chegou
    // a ser agendado): só o resumo das 20h avisa da consulta.
    const input = { ...house, nowTime: '19:30', appointments: [{ ...appointment, id: 'ped', date: '2026-09-28' }] };
    expect(planHouseReminders({ ...input, limit: 2 }).map((r) => [r.key, r.body])).toEqual([
      ['eve:amanha:2026-09-27:20:00', '14h30 Pediatra (Lia)'],
      ['bills:luz:2026-09-28', 'Luz — R$ 180,00'],
    ]);
    // Com os avisos de consulta desligados, ele é um resumo como os outros:
    // depois do aviso de amanhã (o dia de que fala) e antes do de depois de amanhã.
    const plain = (limit: number) => keys(planHouseReminders({ ...input, kinds: { ...input.kinds, appointments: false }, limit }));
    expect(plain(1)).toEqual(['bills:luz:2026-09-28']);
    expect(plain(2)).toEqual(['eve:amanha:2026-09-27:20:00', 'bills:luz:2026-09-28']);
  });
});

import { describe, expect, it } from '@jest/globals';

import { NO_DAY_CHANGE, type FamilyCalendar, type FamilyEventLike } from '../familyEvents';
import { HOUSE_REMINDER_KINDS, HOUSE_REMINDER_LIMIT, planHouseReminders, type HouseReminderInput } from '../houseReminders';

const all = { bills: true, documents: true, chores: true, appointments: true, events: true, vaccines: true, weather: true };
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
    const kinds = { bills: false, documents: false, chores: true, appointments: false, events: false, vaccines: false, weather: false };
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

  it('dia que não vai ter não avisa; quem leva naquele dia vai no aviso', () => {
    const days = [
      { ...NO_DAY_CHANGE, event_id: 'natacao', occurs_on: '2026-09-29', cancelled: true },
      { ...NO_DAY_CHANGE, event_id: 'natacao', occurs_on: '2026-10-01', override_take: true, take_by: 'vo', override_pick_up: true, pick_up_by: null },
    ];
    expect(rows({ family: withBirthday([swim], days) }).map(([key, , , , body]) => [key, body])).toEqual([
      ['events:ana@2026-09-30:2026-09-30:08:00', 'Faz 8 anos.'],
      ['events:natacao@2026-10-01:2026-09-30:19:00', 'Ana · Vó Maria leva · Clube · Levar: touca e toalha'],
      ['events:natacao@2026-10-01:2026-10-01:15:00', 'Ana · Vó Maria leva · Clube · Levar: touca e toalha'],
    ]);
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

  it('desligado, ou sem os dados carregados: nada', () => {
    expect(rows({ kinds: { ...all, events: false }, family: family([swim]) })).toEqual([]);
    expect(rows({ family: undefined })).toEqual([]);
    // Sem compromissos (a tabela ainda não existe): os aniversários avisam.
    expect(rows({ family: withBirthday([]) }).map(([, , , title]) => title)).toEqual(['Hoje é aniversário de Ana']);
  });
});

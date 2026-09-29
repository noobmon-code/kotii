import { describe, expect, it } from '@jest/globals';

import { HOUSE_REMINDER_LIMIT, planHouseReminders, type HouseReminderInput } from '../houseReminders';

const all = { bills: true, documents: true, chores: true, appointments: true, vaccines: true, weather: true };
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
    const kinds = { bills: false, documents: false, chores: true, appointments: false, vaccines: false, weather: false };
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

  it('dica do clima às 7h de cada manhã; a de hoje só se ainda não deu 7h', () => {
    const weather = [
      { date: '2026-09-27', title: 'Hoje é dia de lavar roupa', body: 'Sem chuva até o fim da tarde e umidade de 60%.' },
      { date: '2026-09-28', title: 'Roupa no varal? Recolha antes das 15h', body: 'A chuva deve chegar por volta das 15h.' },
    ];
    expect(planHouseReminders({ ...base, nowTime: '06:30', weather }).map((r) => [r.key, r.date, r.time, r.title])).toEqual([
      ['weather:dia:2026-09-27:07:00', '2026-09-27', '07:00', 'Hoje é dia de lavar roupa'],
      ['weather:dia:2026-09-28:07:00', '2026-09-28', '07:00', 'Roupa no varal? Recolha antes das 15h'],
    ]);
    expect(planHouseReminders({ ...base, weather }).map((r) => r.date)).toEqual(['2026-09-28']);
    expect(planHouseReminders({ ...base, kinds: { ...all, weather: false }, weather })).toEqual([]);
  });
});

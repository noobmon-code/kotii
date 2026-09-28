import { describe, expect, it } from '@jest/globals';

import { HOUSE_REMINDER_LIMIT, planHouseReminders, type HouseReminderInput } from '../houseReminders';

const all = { bills: true, documents: true, chores: true };
const base: HouseReminderInput = { kinds: all, bills: [], documents: [], chores: [], today: '2026-09-27', nowTime: '08:00' };
const bill = { id: 'b1', name: 'Luz', amount: 230, next_due_on: '2026-10-05', active: true, autopay: false };
const doc = { id: 'd1', title: 'Passaporte — Ana', expires_on: '2026-10-20', remind_days: 15 };
const chore = { id: 'c1', title: 'Limpar filtro do ar', due_on: '2026-09-30', active: true, equipment_id: 'e1' };

describe('planHouseReminders', () => {
  it('avisa conta na véspera, no dia e, se ficar em aberto, no dia seguinte, às 9h', () => {
    const plan = planHouseReminders({ ...base, bills: [bill] });
    expect(plan.map((r) => [r.date, r.time, r.title, r.body])).toEqual([
      ['2026-10-04', '09:00', 'Conta vence amanhã', 'Luz — R$ 230,00'],
      ['2026-10-05', '09:00', 'Conta vence hoje', 'Luz — R$ 230,00'],
      ['2026-10-06', '09:00', 'Conta atrasada', 'Luz — R$ 230,00: venceu ontem.'],
    ]);
  });

  it('não avisa débito automático nem conta desativada', () => {
    const bills = [
      { ...bill, id: 'auto', autopay: true },
      { ...bill, id: 'off', active: false },
    ];
    expect(planHouseReminders({ ...base, bills })).toEqual([]);
  });

  it('conta atrasada avisa uma vez só, mesmo refazendo os avisos nos dias seguintes', () => {
    const late = { ...bill, id: 'late', amount: null, next_due_on: '2026-09-26' };
    // Na manhã seguinte ao vencimento, antes das 9h: um aviso.
    expect(planHouseReminders({ ...base, bills: [late] })).toEqual([
      expect.objectContaining({ key: 'bills:late:2026-09-27', title: 'Conta atrasada', body: 'Luz: venceu ontem.' }),
    ]);
    // Refeito depois do aviso, no mesmo dia ou nos seguintes: nada de novo.
    expect(planHouseReminders({ ...base, nowTime: '10:00', bills: [late] })).toEqual([]);
    expect(planHouseReminders({ ...base, today: '2026-09-28', bills: [late] })).toEqual([]);
    // Atrasada há dias (aparece na tela Hoje): sem aviso novo.
    expect(planHouseReminders({ ...base, bills: [{ ...late, next_due_on: '2026-09-20' }] })).toEqual([]);
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
    const kinds = { bills: false, documents: false, chores: true };
    expect(planHouseReminders({ ...base, kinds, bills: [bill], documents: [doc], chores: [chore] })).toHaveLength(1);
    expect(planHouseReminders({ ...base, chores: [{ ...chore, due_on: '2026-11-30' }] })).toEqual([]);
    const many = Array.from({ length: 40 }, (_, i) => ({ ...chore, id: `c${i}` }));
    expect(planHouseReminders({ ...base, chores: many })).toHaveLength(HOUSE_REMINDER_LIMIT);
    // Com os remédios ocupando o teto do iPhone, só o que sobra.
    expect(planHouseReminders({ ...base, chores: many, limit: 3 })).toHaveLength(3);
    expect(planHouseReminders({ ...base, chores: many, limit: -5 })).toEqual([]);
  });
});

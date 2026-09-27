import { describe, expect, it } from '@jest/globals';

import { HOUSE_REMINDER_LIMIT, planHouseReminders, type HouseReminderInput } from '../houseReminders';

const all = { bills: true, documents: true, chores: true };
const base: HouseReminderInput = { kinds: all, bills: [], documents: [], chores: [], today: '2026-09-27', nowTime: '08:00' };
const bill = { id: 'b1', name: 'Luz', amount: 230, next_due_on: '2026-10-05', active: true, autopay: false };
const doc = { id: 'd1', title: 'Passaporte — Ana', expires_on: '2026-10-20', remind_days: 15 };
const chore = { id: 'c1', title: 'Limpar filtro do ar', due_on: '2026-09-30', active: true, equipment_id: 'e1' };

describe('planHouseReminders', () => {
  it('avisa conta na véspera e no dia, às 9h', () => {
    const plan = planHouseReminders({ ...base, bills: [bill] });
    expect(plan.map((r) => [r.date, r.time, r.title, r.body])).toEqual([
      ['2026-10-04', '09:00', 'Conta vence amanhã', 'Luz — R$ 230,00'],
      ['2026-10-05', '09:00', 'Conta vence hoje', 'Luz — R$ 230,00'],
    ]);
  });

  it('não avisa débito automático nem conta desativada; atrasada avisa uma vez', () => {
    const plan = planHouseReminders({
      ...base,
      nowTime: '10:00',
      bills: [
        { ...bill, id: 'auto', autopay: true },
        { ...bill, id: 'off', active: false },
        { ...bill, id: 'late', amount: null, next_due_on: '2026-09-20' },
      ],
    });
    expect(plan).toEqual([
      expect.objectContaining({ key: 'bills:late:2026-09-28', title: 'Conta atrasada', body: 'Luz: venceu em 20/09/2026.' }),
    ]);
  });

  it('documento: quando abre o prazo de renovar e no dia em que vence', () => {
    const plan = planHouseReminders({ ...base, documents: [doc, { ...doc, id: 'sem', expires_on: null }] });
    expect(plan.map((r) => [r.date, r.title, r.body])).toEqual([
      ['2026-10-05', 'Hora de renovar', 'Passaporte — Ana vence em 15 dias (20/10/2026).'],
      ['2026-10-20', 'Documento vence hoje', 'Passaporte — Ana'],
    ]);
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
  });
});

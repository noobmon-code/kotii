import { describe, expect, it } from '@jest/globals';

import { addMonthsClamped, buildAgenda, monthGrid, type AgendaInput } from '../agenda';
import { toTimestamp } from '../health';

const empty: AgendaInput = {
  from: '2026-10-01',
  to: '2026-12-31',
  appointments: [],
  vaccines: [],
  bills: [],
  chores: [],
  documents: [],
  equipment: [],
};

describe('addMonthsClamped', () => {
  it('mantém o dia e usa o último dia nos meses curtos', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2026-02-28', 1, 31)).toBe('2026-03-31');
    expect(addMonthsClamped('2026-11-15', 2)).toBe('2027-01-15');
  });
});

describe('buildAgenda', () => {
  it('junta tudo no intervalo, com hora só nas consultas', () => {
    const events = buildAgenda({
      ...empty,
      appointments: [
        { id: 'a1', title: 'Pediatra', starts_at: toTimestamp('2026-10-05', '14:30'), status: 'agendada', person: 'Lucas' },
        { id: 'a2', title: 'Cancelada', starts_at: toTimestamp('2026-10-06', '10:00'), status: 'cancelada', person: null },
      ],
      vaccines: [{ id: 'v1', name: 'Gripe', dose: 'Anual', next_dose_on: '2026-10-05', person: 'Ana' }],
      documents: [
        { id: 'd1', title: 'CNH — Ana', expires_on: '2026-11-10' },
        { id: 'd2', title: 'Fora', expires_on: '2027-03-01' },
      ],
      equipment: [{ id: 'e1', name: 'Geladeira', warranty_until: '2026-12-01' }],
    });
    expect(events.map((e) => [e.date, e.time, e.kind, e.title, e.detail])).toEqual([
      ['2026-10-05', null, 'vacina', 'Vacina: Gripe', 'Ana · Anual'],
      ['2026-10-05', '14:30', 'consulta', 'Pediatra', 'Lucas'],
      ['2026-11-10', null, 'documento', 'CNH — Ana', 'Vence'],
      ['2026-12-01', null, 'garantia', 'Geladeira', 'Fim da garantia'],
    ]);
  });

  it('conta mensal: a próxima e as previstas, no dia de vencimento', () => {
    const events = buildAgenda({
      ...empty,
      bills: [
        { id: 'b1', name: 'Aluguel', recurrence: 'monthly', due_day: 31, next_due_on: '2026-10-31', active: true },
        { id: 'b2', name: 'IPTU', recurrence: 'once', due_day: null, next_due_on: '2026-11-05', active: true },
        { id: 'b3', name: 'Parada', recurrence: 'monthly', due_day: 10, next_due_on: '2026-10-10', active: false },
      ],
    });
    expect(events.map((e) => [e.date, e.title, e.planned])).toEqual([
      ['2026-10-31', 'Aluguel', false],
      ['2026-11-05', 'IPTU', false],
      ['2026-11-30', 'Aluguel', true],
      ['2026-12-31', 'Aluguel', true],
    ]);
  });

  it('tarefas semanais e mensais se repetem; diárias só mostram a próxima', () => {
    const events = buildAgenda({
      ...empty,
      to: '2026-10-31',
      chores: [
        { id: 'c1', title: 'Lixo reciclável', due_on: '2026-10-07', recurrence: 'weekly', interval_count: 2, active: true, equipment_id: null },
        { id: 'c2', title: 'Filtro do ar', due_on: '2026-10-15', recurrence: 'monthly', interval_count: 3, active: true, equipment_id: 'e1' },
        { id: 'c3', title: 'Louça', due_on: '2026-10-02', recurrence: 'daily', interval_count: 1, active: true, equipment_id: null },
      ],
    });
    expect(events.map((e) => [e.date, e.kind, e.title, e.planned])).toEqual([
      ['2026-10-02', 'tarefa', 'Louça', false],
      ['2026-10-07', 'tarefa', 'Lixo reciclável', false],
      ['2026-10-15', 'manutencao', 'Filtro do ar', false],
      ['2026-10-21', 'tarefa', 'Lixo reciclável', true],
    ]);
  });
});

describe('monthGrid', () => {
  it('semanas de domingo a sábado, completando com os meses vizinhos', () => {
    const grid = monthGrid('2026-10');
    expect(grid).toHaveLength(5);
    expect(grid[0][0]).toEqual({ date: '2026-09-27', inMonth: false });
    expect(grid[0][4]).toEqual({ date: '2026-10-01', inMonth: true });
    expect(grid[4][6]).toEqual({ date: '2026-10-31', inMonth: true });
    expect(monthGrid('2026-02')).toHaveLength(4);
    expect(monthGrid('2026-08')).toHaveLength(6);
  });
});

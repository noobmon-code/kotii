import { describe, expect, it } from '@jest/globals';

import { addMonthsClamped, buildAgenda, monthGrid, type AgendaInput } from '../agenda';
import { EMPTY_CALENDAR, NO_DAY_CHANGE, type FamilyEventLike } from '../familyEvents';
import { toTimestamp } from '../health';

const empty: AgendaInput = {
  from: '2026-10-01',
  to: '2026-12-31',
  today: '2026-10-01',
  appointments: [],
  vaccines: [],
  bills: [],
  chores: [],
  documents: [],
  equipment: [],
  calendar: EMPTY_CALENDAR,
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
      vaccines: [
        { id: 'v1', name: 'Gripe', dose: 'Anual', person_id: 'p1', applied_on: '2025-10-05', next_dose_on: '2026-10-05', person: 'Ana' },
      ],
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
  it('dose de vacina já tomada (há aplicação depois) sai da agenda', () => {
    const dose = { name: 'Hepatite B', person_id: 'p1', person: 'Lucas' };
    const events = buildAgenda({
      ...empty,
      vaccines: [
        { ...dose, id: 'v1', dose: '1ª dose', applied_on: '2026-09-01', next_dose_on: '2026-10-01' },
        { ...dose, id: 'v2', dose: '2ª dose', applied_on: '2026-10-01', next_dose_on: '2026-12-01' },
      ],
    });
    expect(events.map((e) => [e.id, e.date])).toEqual([['v2', '2026-12-01']]);
  });

  it('tarefa atrasada: a previsão conta de hoje, quando ela ainda pode ser feita', () => {
    const events = buildAgenda({
      ...empty,
      from: '2026-09-27',
      to: '2026-10-31',
      today: '2026-10-08',
      chores: [{ id: 'c1', title: 'Regar as plantas', due_on: '2026-10-01', recurrence: 'weekly', interval_count: 1, active: true, equipment_id: null }],
    });
    expect(events.map((e) => [e.date, e.planned])).toEqual([
      ['2026-10-01', false],
      ['2026-10-15', true],
      ['2026-10-22', true],
      ['2026-10-29', true],
    ]);
  });

  it('mês distante ainda mostra as repetições', () => {
    const events = buildAgenda({
      ...empty,
      from: '2032-03-01',
      to: '2032-03-31',
      bills: [{ id: 'b1', name: 'Aluguel', recurrence: 'monthly', due_day: 31, next_due_on: '2026-10-31', active: true }],
      chores: [{ id: 'c1', title: 'Lixo', due_on: '2026-10-07', recurrence: 'weekly', interval_count: 1, active: true, equipment_id: null }],
    });
    expect(events.map((e) => [e.date, e.title])).toEqual([
      ['2032-03-03', 'Lixo'],
      ['2032-03-10', 'Lixo'],
      ['2032-03-17', 'Lixo'],
      ['2032-03-24', 'Lixo'],
      ['2032-03-31', 'Aluguel'],
      ['2032-03-31', 'Lixo'],
    ]);
  });
});

describe('buildAgenda: compromissos da família e aniversários', () => {
  const swim: FamilyEventLike = {
    id: 'natacao',
    title: 'Natação da Ana',
    starts_on: '2026-10-06',
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
  const meeting: FamilyEventLike = {
    ...swim,
    id: 'reuniao',
    title: 'Reunião da escola',
    starts_on: '2026-10-08',
    start_time: null,
    end_time: null,
    person_id: null,
    take_by: null,
    pick_up_by: null,
    location: null,
    bring: null,
    recurrence: 'none',
    weekdays: null,
  };
  const people = [
    { id: 'ana', name: 'Ana', kind: 'pessoa' as const, birth_date: '2018-10-08' },
    { id: 'beto', name: 'Beto', kind: 'pessoa' as const, birth_date: null },
    { id: 'carla', name: 'Carla', kind: 'pessoa' as const, birth_date: null },
  ];
  const days = [
    { ...NO_DAY_CHANGE, event_id: 'natacao', occurs_on: '2026-10-13', cancelled: true },
    { ...NO_DAY_CHANGE, event_id: 'natacao', occurs_on: '2026-10-15', override_take: true, take_by: 'carla' },
  ];
  const input: AgendaInput = { ...empty, from: '2026-10-04', to: '2026-10-17', calendar: { events: [swim, meeting], days, people } };

  it('cada vez do compromisso é uma data certa (não previsão); o dia que não vai ter fica de fora', () => {
    const events = buildAgenda(input).filter((e) => e.kind === 'compromisso' && e.id === 'natacao');
    expect(events.map((e) => [e.key, e.time, e.endTime, e.detail, e.planned])).toEqual([
      ['compromisso:natacao:2026-10-06', '16:00', '17:00', 'Ana · Beto leva, Carla busca · Levar: touca e toalha', false],
      ['compromisso:natacao:2026-10-08', '16:00', '17:00', 'Ana · Beto leva, Carla busca · Levar: touca e toalha', false],
      // Dia 13 não vai ter; no dia 15 a Carla leva e busca.
      ['compromisso:natacao:2026-10-15', '16:00', '17:00', 'Ana · Carla leva e busca · Levar: touca e toalha', false],
    ]);
  });

  it('no dia: o dia todo primeiro (pelo título), depois as horas marcadas, de todos os tipos', () => {
    const events = buildAgenda({
      ...input,
      from: '2026-10-08',
      to: '2026-10-08',
      appointments: [{ id: 'a1', title: 'Pediatra', starts_at: toTimestamp('2026-10-08', '09:30'), status: 'agendada', person: 'Ana' }],
      documents: [{ id: 'd1', title: 'CNH — Beto', expires_on: '2026-10-08' }],
    });
    expect(events.map((e) => [e.time, e.kind, e.id, e.title, e.detail])).toEqual([
      [null, 'aniversario', 'ana', 'Aniversário de Ana', 'faz 8 anos'],
      [null, 'documento', 'd1', 'CNH — Beto', 'Vence'],
      [null, 'compromisso', 'reuniao', 'Reunião da escola', null],
      ['09:30', 'consulta', 'a1', 'Pediatra', 'Ana'],
      ['16:00', 'compromisso', 'natacao', 'Natação da Ana', 'Ana · Beto leva, Carla busca · Levar: touca e toalha'],
    ]);
  });

  it('sem compromissos (a tabela ainda não existe): os aniversários continuam', () => {
    const events = buildAgenda({ ...input, calendar: { events: [], days: [], people } });
    expect(events.map((e) => [e.date, e.kind, e.title])).toEqual([['2026-10-08', 'aniversario', 'Aniversário de Ana']]);
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

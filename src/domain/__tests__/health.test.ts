import { describe, expect, it } from '@jest/globals';

import {
  ageLabel,
  describeExercise,
  describeVaccineStatus,
  describeWeekdays,
  describeWhen,
  dietProblem,
  dietShoppingSelection,
  dueVaccines,
  isOverdueAppointment,
  nextSessionName,
  sessionsForToday,
  splitTimestamp,
  toTimestamp,
  upcomingAppointments,
  vaccineStatus,
  weekdayOf,
  workoutProblem,
  type WorkoutSession,
} from '../health';

const session = (name: string, weekdays: number[] = [], exercises = 1): WorkoutSession => ({
  name,
  weekdays,
  exercises: Array.from({ length: exercises }, (_, i) => ({
    name: `Exercício ${i + 1}`,
    sets: null,
    reps: null,
    load: null,
    rest: null,
    notes: null,
  })),
});

const log = (session_name: string, done_on: string, created_at = `${done_on}T10:00:00Z`) => ({
  session_name,
  done_on,
  created_at,
});

describe('ageLabel', () => {
  it('uses months under one year and whole years after', () => {
    expect(ageLabel('2026-09-20', '2026-09-26')).toBe('recém-nascido');
    expect(ageLabel('2026-08-26', '2026-09-26')).toBe('1 mês');
    expect(ageLabel('2026-01-27', '2026-09-26')).toBe('7 meses');
    expect(ageLabel('2025-09-26', '2026-09-26')).toBe('1 ano');
    expect(ageLabel('2015-09-27', '2026-09-26')).toBe('10 anos');
    expect(ageLabel('2027-01-01', '2026-09-26')).toBeNull();
  });
});

describe('vaccineStatus', () => {
  it('classifies the next dose', () => {
    expect(vaccineStatus(null, '2026-09-26')).toEqual({ kind: 'sem_proxima' });
    expect(vaccineStatus('2026-09-20', '2026-09-26')).toEqual({ kind: 'atrasada', days: 6 });
    expect(vaccineStatus('2026-10-26', '2026-09-26')).toEqual({ kind: 'em_breve', days: 30 });
    expect(vaccineStatus('2026-10-27', '2026-09-26').kind).toBe('agendada');
    expect(describeVaccineStatus({ kind: 'em_breve', days: 1 })).toBe('Próxima dose amanhã');
  });
});

describe('dueVaccines', () => {
  const v = (name: string, applied_on: string | null, next_dose_on: string | null, person_id = 'p1') => ({
    person_id,
    name,
    applied_on,
    next_dose_on,
  });

  it('keeps overdue and upcoming doses, skipping ones already applied later', () => {
    const due = dueVaccines(
      [
        v('Gripe', '2025-09-01', '2026-09-01'),
        v('gripe', '2026-09-10', '2027-09-10'),
        v('Hepatite B', '2026-08-01', '2026-10-01'),
        v('Hepatite B', null, '2026-09-20', 'p2'),
        v('Febre amarela', '2016-01-01', null),
        v('Tétano', null, '2026-12-01'),
      ],
      '2026-09-26',
    );
    expect(due.map((d) => [d.vaccine.name, d.vaccine.person_id, d.status.kind])).toEqual([
      ['Hepatite B', 'p2', 'atrasada'],
      ['Hepatite B', 'p1', 'em_breve'],
    ]);
  });

  it('a scheduled-only record is settled by an application near its date', () => {
    expect(dueVaccines([v('HPV', null, '2026-09-20'), v('HPV', '2026-09-05', null)], '2026-09-26')).toEqual([]);
  });
});

describe('appointments', () => {
  it('round-trips local date and time', () => {
    expect(splitTimestamp(toTimestamp('2026-10-05', '14:30'))).toEqual({ date: '2026-10-05', time: '14:30' });
  });

  it('describes when relative to today', () => {
    expect(describeWhen(toTimestamp('2026-09-26', '14:30'), '2026-09-26')).toBe('Hoje · 14:30');
    expect(describeWhen(toTimestamp('2026-09-27', '09:00'), '2026-09-26')).toBe('Amanhã · 09:00');
    expect(describeWhen(toTimestamp('2026-10-05', '08:15'), '2026-09-26')).toBe('Seg, 5 out · 08:15');
    expect(describeWhen(toTimestamp('2027-01-04', '08:15'), '2026-09-26')).toBe('Seg, 4 jan 2027 · 08:15');
  });

  it('lists scheduled appointments from today on, soonest first', () => {
    const at = (date: string, time: string, status: 'agendada' | 'realizada' | 'cancelada' = 'agendada') => ({
      starts_at: toTimestamp(date, time),
      status,
    });
    const list = [at('2026-10-10', '09:00'), at('2026-09-26', '08:00'), at('2026-09-25', '10:00'), at('2026-10-01', '10:00', 'cancelada')];
    expect(upcomingAppointments(list, '2026-09-26').map((a) => splitTimestamp(a.starts_at).date)).toEqual([
      '2026-09-26',
      '2026-10-10',
    ]);
    expect(isOverdueAppointment(list[2], '2026-09-26')).toBe(true);
    expect(isOverdueAppointment(list[1], '2026-09-26')).toBe(false);
  });
});

describe('workouts', () => {
  it('knows weekdays', () => {
    expect(weekdayOf('2026-09-26')).toBe(6);
    expect(describeWeekdays([5, 1, 3])).toBe('Seg, Qua, Sex');
    expect(describeWeekdays([0, 1, 2, 3, 4, 5, 6])).toBe('Todo dia');
  });

  it('describes an exercise compactly', () => {
    expect(describeExercise({ name: 'Supino', sets: '4', reps: '10-12', load: '20 kg', rest: '60s', notes: null })).toBe(
      '4 × 10-12 · 20 kg · desc. 60s',
    );
    expect(describeExercise({ name: 'Prancha', sets: '3', reps: null, load: null, rest: null, notes: null })).toBe('3 séries');
  });

  it('picks sessions by weekday when the plan has them', () => {
    const plan = [session('A', [1, 4]), session('B', [2, 5])];
    expect(sessionsForToday(plan, [], '2026-09-28').map((s) => s.name)).toEqual(['A']);
    expect(sessionsForToday(plan, [], '2026-09-26')).toEqual([]);
  });

  it('follows the A/B/C sequence when there are no weekdays', () => {
    const plan = [session('A'), session('B'), session('C')];
    expect(sessionsForToday(plan, [], '2026-09-26').map((s) => s.name)).toEqual(['A']);
    expect(sessionsForToday(plan, [log('A', '2026-09-24'), log('B', '2026-09-25')], '2026-09-26').map((s) => s.name)).toEqual(['C']);
    expect(sessionsForToday(plan, [log('C', '2026-09-25')], '2026-09-26').map((s) => s.name)).toEqual(['A']);
    expect(sessionsForToday(plan, [log('B', '2026-09-26'), log('A', '2026-09-25')], '2026-09-26').map((s) => s.name)).toEqual(['B']);
    expect(sessionsForToday(plan, [log('Antigo', '2026-09-25')], '2026-09-26').map((s) => s.name)).toEqual(['A']);
    // Pausa maior que o histórico carregado: recomeça do primeiro treino.
    expect(sessionsForToday(plan, [log('B', '2026-06-01')], '2026-09-26').map((s) => s.name)).toEqual(['A']);
  });

  it('names new sessions and validates before activating', () => {
    expect(nextSessionName([session('Treino A'), session('treino b')])).toBe('Treino C');
    expect(workoutProblem([session('A', [], 0)])).toMatch(/exercício/);
    expect(workoutProblem([session('A'), session('a')])).toMatch(/nome diferente/);
    expect(workoutProblem([session('A'), session('B', [], 0)])).toBeNull();
  });
});

describe('diets', () => {
  it('validates meals and marks shopping items already on the list', () => {
    expect(dietProblem([{ name: 'Café', time: null, options: [] }])).toMatch(/alimento/);
    expect(
      dietProblem([{ name: 'Café', time: '07:00', options: [{ label: null, items: [{ food: 'Ovo', quantity: '2', notes: null }] }] }]),
    ).toBeNull();
    expect(
      dietShoppingSelection(
        [
          { name: 'Aveia em flocos', category: 'graos' },
          { name: 'Feijão', category: 'graos' },
        ],
        ['feijao', 'Arroz'],
      ).map((i) => i.inList),
    ).toEqual([false, true]);
  });
});

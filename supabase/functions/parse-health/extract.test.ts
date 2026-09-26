import { assertEquals } from '@std/assert';
import { z } from 'zod';

import {
  cleanDate,
  cleanDiet,
  cleanExam,
  cleanTime,
  cleanWorkout,
  DietSchema,
  ExamSchema,
  type ExtractedDiet,
  type ExtractedWorkout,
  WorkoutSchema,
} from './extract.ts';

Deno.test('cleanDate and cleanTime accept only real values', () => {
  assertEquals(cleanDate('2026-02-28'), '2026-02-28');
  assertEquals(cleanDate('2026-02-30'), null);
  assertEquals(cleanDate('28/02/2026'), null);
  assertEquals(cleanDate('2026-10-01T00:00:00Z'), '2026-10-01');
  assertEquals(cleanTime('7:00'), '07:00');
  assertEquals(cleanTime('07h'), '07:00');
  assertEquals(cleanTime('7h30'), '07:30');
  assertEquals(cleanTime('25:00'), null);
  assertEquals(cleanTime('manhã'), null);
});

Deno.test('cleanWorkout drops empty exercises and sessions, fixes weekdays and duplicate names', () => {
  const extracted: ExtractedWorkout = {
    is_workout: true,
    title: '  Hipertrofia ',
    professional: null,
    valid_until: '2026-12-01',
    notes: '',
    sessions: [
      {
        name: 'Treino A',
        weekdays: [3, 1, 1, 9, -1],
        exercises: [
          { name: 'Supino reto', sets: '4', reps: '10-12', load: ' 20 kg ', rest: '60s', notes: null },
          { name: '  ', sets: null, reps: null, load: null, rest: null, notes: null },
        ],
      },
      { name: 'Vazio', weekdays: [], exercises: [] },
      {
        name: 'treino a',
        weekdays: [],
        exercises: [{ name: 'Agachamento', sets: '3', reps: '12', load: null, rest: null, notes: null }],
      },
      {
        name: ' ',
        weekdays: [],
        exercises: [{ name: 'Esteira', sets: null, reps: null, load: null, rest: null, notes: '20 min' }],
      },
    ],
  };
  const plan = cleanWorkout(extracted);
  assertEquals(plan.title, 'Hipertrofia');
  assertEquals(plan.notes, null);
  assertEquals(plan.sessions.map((s) => s.name), ['Treino A', 'treino a (2)', 'Treino C']);
  assertEquals(plan.sessions[0].weekdays, [1, 3]);
  assertEquals(plan.sessions[0].exercises.length, 1);
  assertEquals(plan.sessions[0].exercises[0].load, '20 kg');
});

Deno.test('cleanDiet keeps meals, normalizes times and dedupes shopping items', () => {
  const extracted: ExtractedDiet = {
    is_diet: true,
    title: null,
    professional: 'Dra. Ana CRN 1234',
    valid_until: null,
    notes: null,
    meals: [
      {
        name: 'Café da manhã',
        time: '7h',
        options: [
          { label: null, items: [{ food: 'Ovo mexido', quantity: '2 unidades', notes: null }] },
          { label: 'Opção 2', items: [{ food: ' ', quantity: null, notes: null }] },
        ],
      },
      { name: '', time: null, options: [] },
    ],
    guidelines: ['Beber 2 L de água', '  '],
    shopping_items: [
      { name: 'ovo', category: 'ovos' },
      { name: 'Ovo', category: 'ovos' },
      { name: 'Aveia em flocos', category: 'graos' },
    ],
  };
  const diet = cleanDiet(extracted);
  assertEquals(diet.meals.length, 1);
  assertEquals(diet.meals[0].time, '07:00');
  assertEquals(diet.meals[0].options.length, 1, 'empty option dropped');
  assertEquals(diet.guidelines, ['Beber 2 L de água']);
  assertEquals(diet.shopping_items, [
    { name: 'Ovo', category: 'ovos' },
    { name: 'Aveia em flocos', category: 'graos' },
  ]);
});

Deno.test('cleanExam keeps printed values and drops blank rows', () => {
  const exam = cleanExam({
    is_exam: true,
    kind: 'resultado',
    title: 'Hemograma',
    exam_date: '2026-09-01',
    lab: 'Lab X',
    requested_by: null,
    requested_exams: [],
    results: [
      { name: 'Hemoglobina', value: '13,2', unit: 'g/dL', reference: '12,0 a 16,0', flag: null },
      { name: 'Glicose', value: '', unit: 'mg/dL', reference: null, flag: 'alto' },
    ],
  });
  assertEquals(exam.results.length, 1);
  assertEquals(exam.results[0].value, '13,2');
});

Deno.test('schemas convert to JSON Schema for OpenRouter structured output', () => {
  for (const schema of [WorkoutSchema, DietSchema, ExamSchema]) {
    const json = z.toJSONSchema(schema) as { type: string };
    assertEquals(json.type, 'object');
  }
});

// Schemas, instruções e limpeza da leitura de fichas de treino, planos de
// dieta e exames. Os planos vêm de profissionais de fora, cada um no seu
// formato: a IA só organiza o que está escrito, e o usuário revisa antes de ativar.

import { z } from 'zod';

import { CATEGORY_KEYS, type CategoryKey } from '../_shared/categories.ts';

export const HEALTH_KINDS = ['workout', 'diet', 'exam'] as const;
export type HealthKind = (typeof HEALTH_KINDS)[number];

const text = z.string().nullable();

export const WorkoutSchema = z.object({
  is_workout: z.boolean(),
  title: text,
  professional: text,
  valid_until: text,
  notes: text,
  sessions: z.array(
    z.object({
      name: z.string(),
      weekdays: z.array(z.number().int()),
      exercises: z.array(
        z.object({
          name: z.string(),
          sets: text,
          reps: text,
          load: text,
          rest: text,
          notes: text,
        }),
      ),
    }),
  ),
});

export const DietSchema = z.object({
  is_diet: z.boolean(),
  title: text,
  professional: text,
  valid_until: text,
  notes: text,
  meals: z.array(
    z.object({
      name: z.string(),
      time: text,
      options: z.array(
        z.object({
          label: text,
          items: z.array(z.object({ food: z.string(), quantity: text, notes: text })),
        }),
      ),
    }),
  ),
  guidelines: z.array(z.string()),
  shopping_items: z.array(z.object({ name: z.string(), category: z.enum(CATEGORY_KEYS) })),
});

export const ExamSchema = z.object({
  is_exam: z.boolean(),
  kind: z.enum(['pedido', 'resultado']),
  title: text,
  exam_date: text,
  lab: text,
  requested_by: text,
  requested_exams: z.array(z.string()),
  results: z.array(
    z.object({
      name: z.string(),
      value: z.string(),
      unit: text,
      reference: text,
      flag: z.enum(['alto', 'baixo', 'alterado']).nullable(),
    }),
  ),
});

export type ExtractedWorkout = z.infer<typeof WorkoutSchema>;
export type ExtractedDiet = z.infer<typeof DietSchema>;
export type ExtractedExam = z.infer<typeof ExamSchema>;

const COMMON = `- Várias fotos podem ser páginas do mesmo documento: junte tudo em um resultado só, na ordem.
- Transcreva com fidelidade. Campo ilegível ou ausente: null. Não invente nem complete informação.
- Datas em AAAA-MM-DD.`;

export const PROMPTS: Record<HealthKind, { system: string; prompt: string; subject: string; notThis: string }> = {
  workout: {
    subject: 'a ficha de treino',
    notThis: 'A imagem não parece ser uma ficha de treino.',
    system:
      'Você digitaliza fichas de treino escritas por profissionais de educação física (papel, print, PDF fotografado). Cada profissional usa um formato; seu trabalho é organizar fielmente o que está escrito, sem criar exercícios.',
    prompt: `Organize esta ficha de treino.

- sessions: uma por treino/divisão (ex.: "Treino A", "Superiores", "Segunda-feira"), na ordem da ficha. Aquecimento, cardio e alongamento entram na sessão em que aparecem, ou numa sessão própria se estiverem à parte.
- weekdays: dias da semana indicados para a sessão, 0 = domingo, 1 = segunda ... 6 = sábado. Vazio se a ficha não disser.
- exercises: na ordem. name como escrito, expandindo abreviações óbvias ("Sup. reto c/ halt." -> "Supino reto com halteres"). sets, reps, load e rest como texto curto do jeito que está (ex.: sets "4", reps "10-12", load "20 kg", rest "60s"); "3x12" vira sets "3" e reps "12". Técnicas e observações em notes (ex.: "drop-set na última série", "bi-set com o próximo").
- title: nome do plano se houver (ex.: "Hipertrofia fase 1"). professional: nome e CREF, se visíveis. valid_until: data de troca/validade da ficha. notes: orientações gerais.
${COMMON}
- Se não for uma ficha de treino, is_workout=false e sessions vazio.`,
  },
  diet: {
    subject: 'o plano alimentar',
    notThis: 'A imagem não parece ser um plano alimentar.',
    system:
      'Você digitaliza planos alimentares escritos por nutricionistas (papel, print, PDF fotografado). Cada profissional usa um formato; seu trabalho é organizar fielmente o que está escrito, sem criar refeições nem alimentos.',
    prompt: `Organize este plano alimentar.

- meals: uma por refeição, na ordem (ex.: "Café da manhã", "Lanche da manhã", "Almoço"). time em "HH:MM" se houver horário.
- options: cada opção ou substituição da refeição ("Opção 1", "Opção 2", "ou"). Sem opções, uma única opção com label null.
- items: food como escrito; quantity como escrita (ex.: "2 fatias", "100 g", "1 col. sopa"); notes para observações do item (ex.: "sem açúcar").
- guidelines: orientações gerais (água, suplementos, o que evitar), uma frase curta cada.
- shopping_items: o que é preciso comprar no mercado ou na farmácia para seguir o plano, sem repetição, com nome genérico no singular ("Ovo", "Aveia em flocos", "Peito de frango", "Whey protein") e a categoria. Preparações viram ingredientes ("Omelete" -> "Ovo"). Não inclua água da torneira.
- title: nome do plano se houver. professional: nome e CRN, se visíveis. valid_until: data de retorno/validade. notes: observações gerais que não sejam orientações.
${COMMON}
- Se não for um plano alimentar, is_diet=false e meals vazio.`,
  },
  exam: {
    subject: 'o exame',
    notThis: 'A imagem não parece ser um pedido ou resultado de exame.',
    system:
      'Você transcreve pedidos médicos de exame e laudos de laboratório/imagem. Transcreva exatamente o que está impresso; não interprete, não comente e não dê diagnóstico.',
    prompt: `Transcreva este documento de exame.

- kind: "pedido" se for um pedido/guia de exames a fazer; "resultado" se for um laudo com resultados.
- title: nome do exame ou do conjunto (ex.: "Hemograma completo", "Exames de rotina", "Ultrassom de abdome").
- exam_date: data de coleta/realização (laudo) ou data do pedido.
- lab: laboratório ou clínica. requested_by: médico solicitante.
- requested_exams: no pedido, cada exame pedido; no laudo, vazio.
- results: no laudo, uma linha por item medido, na ordem. name como impresso; value como impresso (ex.: "13,2", "Não reagente"); unit; reference = valores de referência como impressos; flag só se o próprio laudo marcar o resultado como fora da referência (ex.: "H", "L", "*", "Alto", "Baixo"): "alto", "baixo" ou "alterado"; senão null. Laudo descritivo (imagem): um item com name "Conclusão" e value com a conclusão impressa.
${COMMON}
- Se não for pedido nem resultado de exame, is_exam=false e listas vazias.`,
  },
};

// ---------------------------------------------------------------------------
// Limpeza: o que a IA devolveu -> o que o app grava como rascunho.

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed : null;
}

export function cleanDate(value: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value?.trim() ?? '');
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
    ? match[0].slice(0, 10)
    : null;
}

/** "7:00", "07h", "7h30", "07:00" -> "07:00"; o resto -> null. */
export function cleanTime(value: string | null | undefined): string | null {
  const match = /^(\d{1,2})\s*(?:[:hH]\s*(\d{2})?)?$/.exec(value?.trim() ?? '');
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function dedupeKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface WorkoutDraft {
  title: string | null;
  professional: string | null;
  valid_until: string | null;
  notes: string | null;
  sessions: {
    name: string;
    weekdays: number[];
    exercises: {
      name: string;
      sets: string | null;
      reps: string | null;
      load: string | null;
      rest: string | null;
      notes: string | null;
    }[];
  }[];
}

export function cleanWorkout(extracted: ExtractedWorkout): WorkoutDraft {
  const sessions: WorkoutDraft['sessions'] = [];
  for (const session of extracted.sessions) {
    const exercises = session.exercises
      .map((e) => ({
        name: clean(e.name) ?? '',
        sets: clean(e.sets),
        reps: clean(e.reps),
        load: clean(e.load),
        rest: clean(e.rest),
        notes: clean(e.notes),
      }))
      .filter((e) => e.name);
    if (!exercises.length) continue;
    const weekdays = [...new Set(session.weekdays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
    sessions.push({
      name: clean(session.name) ?? `Treino ${String.fromCharCode(65 + sessions.length)}`,
      weekdays,
      exercises,
    });
  }
  // Nome repetido atrapalha o registro do dia (um por sessão e data).
  const seen = new Map<string, number>();
  for (const session of sessions) {
    const key = dedupeKey(session.name);
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count > 1) session.name = `${session.name} (${count})`;
  }
  return {
    title: clean(extracted.title),
    professional: clean(extracted.professional),
    valid_until: cleanDate(extracted.valid_until),
    notes: clean(extracted.notes),
    sessions,
  };
}

export interface DietDraft {
  title: string | null;
  professional: string | null;
  valid_until: string | null;
  notes: string | null;
  meals: {
    name: string;
    time: string | null;
    options: { label: string | null; items: { food: string; quantity: string | null; notes: string | null }[] }[];
  }[];
  guidelines: string[];
  shopping_items: { name: string; category: CategoryKey }[];
}

export function cleanDiet(extracted: ExtractedDiet): DietDraft {
  const meals: DietDraft['meals'] = [];
  for (const meal of extracted.meals) {
    const options = meal.options
      .map((o) => ({
        label: clean(o.label),
        items: o.items
          .map((i) => ({ food: clean(i.food) ?? '', quantity: clean(i.quantity), notes: clean(i.notes) }))
          .filter((i) => i.food),
      }))
      .filter((o) => o.items.length);
    const name = clean(meal.name);
    if (!name && !options.length) continue;
    meals.push({ name: name ?? `Refeição ${meals.length + 1}`, time: cleanTime(meal.time), options });
  }

  const shopping: DietDraft['shopping_items'] = [];
  const seen = new Set<string>();
  for (const item of extracted.shopping_items) {
    const name = clean(item.name);
    if (!name) continue;
    const key = dedupeKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    shopping.push({ name: name.charAt(0).toUpperCase() + name.slice(1), category: item.category });
  }

  return {
    title: clean(extracted.title),
    professional: clean(extracted.professional),
    valid_until: cleanDate(extracted.valid_until),
    notes: clean(extracted.notes),
    meals,
    guidelines: extracted.guidelines.map(clean).filter((g): g is string => Boolean(g)),
    shopping_items: shopping,
  };
}

export interface ExamDraft {
  kind: 'pedido' | 'resultado';
  title: string | null;
  exam_date: string | null;
  lab: string | null;
  requested_by: string | null;
  requested_exams: string[];
  results: {
    name: string;
    value: string;
    unit: string | null;
    reference: string | null;
    flag: 'alto' | 'baixo' | 'alterado' | null;
  }[];
}

export function cleanExam(extracted: ExtractedExam): ExamDraft {
  return {
    kind: extracted.kind,
    title: clean(extracted.title),
    exam_date: cleanDate(extracted.exam_date),
    lab: clean(extracted.lab),
    requested_by: clean(extracted.requested_by),
    requested_exams: extracted.requested_exams.map(clean).filter((e): e is string => Boolean(e)),
    results: extracted.results
      .map((r) => ({
        name: clean(r.name) ?? '',
        value: clean(r.value) ?? '',
        unit: clean(r.unit),
        reference: clean(r.reference),
        flag: r.flag,
      }))
      .filter((r) => r.name && r.value),
  };
}

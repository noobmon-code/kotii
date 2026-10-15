// Saúde: pessoas e pets da casa, consultas, vacinas, exames, treinos e dietas.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';

import { hasFilledResult } from '@/domain/examTrends';
import { supabase, unwrap } from '@/lib/supabase';
import type { Appointment, DietPlan, Exam, Person, Vaccine, WorkoutLog, WorkoutPlan } from '@/lib/types';
import { removeDocumentImages } from './house';
import { functionErrorMessage, removeImages, signedImageUrl, uploadImages } from './images';

function useInvalidate(...keys: string[]) {
  const queryClient = useQueryClient();
  return () => {
    for (const key of keys) queryClient.invalidateQueries({ queryKey: [key] });
  };
}

// ---------------------------------------------------------------------------
// Pessoas

const PERSON_COLUMNS =
  'id, name, kind, member_user_id, birth_date, blood_type, allergies, conditions, health_plan, health_plan_number, species, notes';

export async function fetchPeople(db: SupabaseClient = supabase): Promise<Person[]> {
  return unwrap(await db.from('people').select(PERSON_COLUMNS).order('kind').order('name')) as Person[];
}

export function usePeople() {
  return useQuery({ queryKey: ['people'], queryFn: () => fetchPeople() });
}

export type PersonValues = Omit<Person, 'id' | 'member_user_id'>;

export function useSavePerson() {
  // A pessoa que vira pet sai dos rodízios no servidor (a vez passa adiante): as tarefas e as ordens também mudam.
  // E deixa de levar e buscar nos compromissos (gatilho no banco).
  const invalidate = useInvalidate('people', 'medications', 'chores', 'choreRotations', 'familyEvents', 'familyEventDays');
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: PersonValues }) => {
      if (!id) {
        return unwrap(await supabase.from('people').insert(values).select(PERSON_COLUMNS).single()) as Person;
      }
      const saved = unwrap(
        await supabase.from('people').update(values).eq('id', id).select(PERSON_COLUMNS).single(),
      ) as Person;
      // O nome também aparece nos remédios (e nos lembretes).
      unwrap(await supabase.from('medications').update({ person_name: saved.name }).eq('person_id', id));
      return saved;
    },
    onSuccess: invalidate,
  });
}

export function useDeletePerson() {
  const invalidate = useInvalidate(
    'people',
    'appointments',
    'vaccines',
    'exams',
    'workoutPlans',
    'dietPlans',
    'medications',
    'documents',
    // A ficha apagada sai das tarefas e dos rodízios (a vez passa adiante).
    'chores',
    'choreRotations',
    // Os compromissos ficam, sem o nome de quem saiu.
    'familyEvents',
    'familyEventDays',
  );
  return useMutation({
    mutationFn: async (id: string) => {
      // O banco apaga exames, planos e documentos da pessoa em cascata; as
      // fotos deles ficam no storage, então saem aqui.
      const pathsOf = async (table: string) =>
        (unwrap(await supabase.from(table).select('file_paths').eq('person_id', id)) as { file_paths: string[] }[]).flatMap(
          (row) => row.file_paths,
        );
      const healthFiles = [
        ...(await pathsOf('exams')),
        ...(await pathsOf('workout_plans')),
        ...(await pathsOf('diet_plans')),
      ];
      const documentFiles = await pathsOf('documents');
      unwrap(await supabase.from('people').delete().eq('id', id));
      await removeHealthImages(healthFiles).catch(() => undefined);
      await removeDocumentImages(documentFiles).catch(() => undefined);
    },
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------
// Consultas e vacinas

const APPOINTMENT_COLUMNS = 'id, person_id, title, professional, location, starts_at, notes, status';

export async function fetchAppointments(db: SupabaseClient = supabase): Promise<Appointment[]> {
  return unwrap(await db.from('appointments').select(APPOINTMENT_COLUMNS).order('starts_at', { ascending: false }).limit(300)) as Appointment[];
}

export function useAppointments() {
  return useQuery({ queryKey: ['appointments'], queryFn: () => fetchAppointments() });
}

export type AppointmentValues = Omit<Appointment, 'id'>;

export function useSaveAppointment() {
  const invalidate = useInvalidate('appointments');
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: Partial<AppointmentValues> }) =>
      id
        ? unwrap(await supabase.from('appointments').update(values).eq('id', id))
        : unwrap(await supabase.from('appointments').insert(values)),
    onSuccess: invalidate,
  });
}

export function useDeleteAppointment() {
  const invalidate = useInvalidate('appointments');
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('appointments').delete().eq('id', id)),
    onSuccess: invalidate,
  });
}

const VACCINE_COLUMNS = 'id, person_id, name, dose, applied_on, next_dose_on, location, lot, notes';

export async function fetchVaccines(db: SupabaseClient = supabase): Promise<Vaccine[]> {
  return unwrap(
    await db.from('vaccines').select(VACCINE_COLUMNS).order('applied_on', { ascending: false, nullsFirst: true }).limit(500),
  ) as Vaccine[];
}

export function useVaccines() {
  return useQuery({ queryKey: ['vaccines'], queryFn: () => fetchVaccines() });
}

export type VaccineValues = Omit<Vaccine, 'id'>;

export function useSaveVaccine() {
  const invalidate = useInvalidate('vaccines');
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: VaccineValues }) =>
      id
        ? unwrap(await supabase.from('vaccines').update(values).eq('id', id))
        : unwrap(await supabase.from('vaccines').insert(values)),
    onSuccess: invalidate,
  });
}

export function useDeleteVaccine() {
  const invalidate = useInvalidate('vaccines');
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('vaccines').delete().eq('id', id)),
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------
// Fotos de documentos de saúde e leitura com IA

export type HealthDocumentKind = 'workout' | 'diet' | 'exam';

export function uploadHealthImages(householdId: string, uris: string[]): Promise<string[]> {
  return uploadImages('health', householdId, uris);
}

export function removeHealthImages(paths: string[]): Promise<void> {
  return removeImages('health', paths);
}

export function healthImageUrl(path: string): Promise<string | null> {
  return signedImageUrl('health', path);
}

/**
 * Lê as fotos (já no bucket "health") e devolve o documento organizado.
 * `unclaimed`: as fotos acabaram de subir e nenhum registro aponta para
 * elas; se a sessão acabou, saem antes de o app sair da conta (depois, sem
 * token, ninguém mais as apagaria).
 */
export async function readHealthDocument<T>(
  kind: HealthDocumentKind,
  paths: string[],
  { unclaimed = false }: { unclaimed?: boolean } = {},
): Promise<T> {
  const { data, error } = await supabase.functions.invoke<{ data: T }>('parse-health', {
    body: { kind, image_paths: paths },
  });
  if (error || !data) {
    const cleanup = unclaimed ? () => removeHealthImages(paths) : undefined;
    throw new Error(await functionErrorMessage(error, 'Não foi possível ler o documento. Tente novamente.', cleanup));
  }
  return data.data;
}

// ---------------------------------------------------------------------------
// Exames

const EXAM_COLUMNS =
  'id, person_id, title, status, exam_date, requested_by, lab, notes, file_paths, results, created_at';

export function useExams() {
  return useQuery({
    queryKey: ['exams'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('exams')
          .select(EXAM_COLUMNS)
          .order('exam_date', { ascending: false, nullsFirst: true })
          .order('created_at', { ascending: false })
          .limit(300),
      ) as Exam[],
  });
}

/** Até quantas páginas uma leitura inteira busca antes de desistir (ver readAllPages). */
const MAX_PAGES = 200;
export const TOO_MANY_ROWS = 'Há registros demais para ler de uma vez. Tente de novo mais tarde.';

/**
 * Lê uma busca inteira, página por página, até a página que vem incompleta.
 * A busca vem em ordem de id e cada página começa depois do id da última
 * linha lida, e não numa posição: se outro aparelho apaga ou cria um registro
 * no meio da leitura, nenhuma linha é pulada nem vem duas vezes (por posição,
 * a linha apagada puxaria as seguintes para trás e uma delas sumiria).
 * Se nem em MAX_PAGES acaba, falha: um histórico cortado nunca é entregue como
 * se fosse inteiro (a evolução mostraria como "último" um resultado antigo).
 * Com todas as páginas cheias, uma linha a mais é o que separa "exatamente o
 * teto" (vem tudo) de "registros demais".
 */
async function readAllPages<T extends { id: string }>(
  pageSize: number,
  fetchPage: (afterId: string | null, limit: number) => Promise<T[]>,
): Promise<T[]> {
  const all: T[] = [];
  let afterId: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const rows = await fetchPage(afterId, pageSize);
    all.push(...rows);
    if (rows.length < pageSize) return all;
    afterId = rows[rows.length - 1].id;
  }
  if ((await fetchPage(afterId, 1)).length) throw new Error(TOO_MANY_ROWS);
  return all;
}

/** Quantos exames cada busca traz (o servidor devolve até mil linhas por vez). */
const EXAM_PAGE = 500;

/**
 * Todos os exames de uma pessoa, do mais antigo para o mais novo. A lista da
 * casa (useExams) traz só os 300 mais recentes de todo mundo: numa casa com
 * muitos exames, a evolução e o resumo de quem faz poucos ficariam sem os
 * antigos, sem ninguém saber.
 */
export async function fetchPersonExams(personId: string, db: SupabaseClient = supabase): Promise<Exam[]> {
  const exams = await readAllPages(EXAM_PAGE, async (afterId, limit) => {
    const query = db.from('exams').select(EXAM_COLUMNS).eq('person_id', personId).order('id', { ascending: true });
    return unwrap(await (afterId ? query.gt('id', afterId) : query).limit(limit)) as Exam[];
  });
  // A leitura anda por id; a ordem entregue é a de sempre, a de criação.
  return exams.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Os exames de uma pessoa, inteiros (fetchPersonExams). A chave começa com 'exams': salvar ou excluir um exame já recarrega. */
export function usePersonExams(personId: string | undefined) {
  return useQuery({
    queryKey: ['exams', 'person', personId],
    enabled: Boolean(personId),
    queryFn: () => fetchPersonExams(personId!),
  });
}

/** Quantas linhas cada busca de "quem tem resultados" traz (o teto do servidor). */
const OWNER_PAGE = 1000;

/**
 * Quem tem exame realizado com resultados, na casa toda. Pela lista da casa
 * (useExams, só os 300 exames mais recentes), quem só tem resultados antigos
 * ficaria sem a entrada da evolução, ou a entrada de "Todos" levaria à pessoa
 * errada. Só a coluna da pessoa, em páginas.
 */
export async function fetchExamResultOwners(db: SupabaseClient = supabase): Promise<string[]> {
  const rows = await readAllPages(OWNER_PAGE, async (afterId, limit) => {
    const query = db.from('exams').select('id, person_id').eq('status', 'realizado').neq('results', '[]').order('id', { ascending: true });
    return unwrap(await (afterId ? query.gt('id', afterId) : query).limit(limit)) as { id: string; person_id: string }[];
  });
  const candidates = [...new Set(rows.map((row) => row.person_id))];
  // O filtro do servidor só sabe que a lista de resultados não está vazia. O laudo só com linhas de valor em
  // branco (a leitura de uma foto pode trazer) não conta para a evolução, e quem só tem laudos assim não é
  // "quem tem resultados": cada pessoa é conferida, lendo os resultados dela até achar um preenchido.
  const checked = await Promise.all(candidates.map(async (personId) => ((await hasFilledExamResult(personId, db)) ? personId : null)));
  return checked.filter((personId): personId is string => personId !== null);
}

/** Quantos exames a conferência de cada pessoa lê por vez (bem abaixo do teto do servidor: a página incompleta é o fim). */
const OWNER_CHECK_PAGE = 20;

/** A pessoa tem algum exame realizado com um resultado preenchido? Lê os resultados aos poucos e para no primeiro que tem. */
async function hasFilledExamResult(personId: string, db: SupabaseClient): Promise<boolean> {
  // Por id, como readAllPages: a página seguinte começa depois da última linha lida.
  for (let afterId: string | null = null; ; ) {
    const query = db
      .from('exams')
      .select('id, results')
      .eq('person_id', personId)
      .eq('status', 'realizado')
      .neq('results', '[]')
      .order('id', { ascending: true });
    const rows = unwrap(await (afterId ? query.gt('id', afterId) : query).limit(OWNER_CHECK_PAGE)) as { id: string; results: { value?: unknown }[] }[];
    if (rows.some((row) => hasFilledResult(row.results ?? []))) return true;
    if (rows.length < OWNER_CHECK_PAGE) return false;
    afterId = rows[rows.length - 1].id;
  }
}

/** Quem tem resultados de exame (fetchExamResultOwners). A chave começa com 'exams': salvar ou excluir um exame já recarrega. */
export function useExamResultOwners() {
  return useQuery({ queryKey: ['exams', 'owners'], queryFn: () => fetchExamResultOwners() });
}

export function useExam(id: string | undefined) {
  return useQuery({
    queryKey: ['exams', id],
    enabled: Boolean(id),
    queryFn: async () => unwrap(await supabase.from('exams').select(EXAM_COLUMNS).eq('id', id!).single()) as Exam,
  });
}

export type ExamValues = Omit<Exam, 'id' | 'created_at'>;

export function useSaveExam() {
  const invalidate = useInvalidate('exams');
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: ExamValues }) =>
      id
        ? (unwrap(await supabase.from('exams').update(values).eq('id', id).select(EXAM_COLUMNS).single()) as Exam)
        : (unwrap(await supabase.from('exams').insert(values).select(EXAM_COLUMNS).single()) as Exam),
    onSuccess: invalidate,
  });
}

export function useDeleteExam() {
  const invalidate = useInvalidate('exams');
  return useMutation({
    mutationFn: async (exam: Pick<Exam, 'id' | 'file_paths'>) => {
      unwrap(await supabase.from('exams').delete().eq('id', exam.id));
      await removeHealthImages(exam.file_paths).catch(() => undefined);
    },
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------
// Treinos

const WORKOUT_COLUMNS = 'id, person_id, title, professional, valid_until, notes, sessions, file_paths, status, created_at';

export function useWorkoutPlans() {
  return useQuery({
    queryKey: ['workoutPlans'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('workout_plans')
          .select(WORKOUT_COLUMNS)
          .neq('status', 'archived')
          .order('created_at', { ascending: false }),
      ) as WorkoutPlan[],
  });
}

export function useWorkoutPlan(id: string) {
  return useQuery({
    queryKey: ['workoutPlans', id],
    queryFn: async () =>
      unwrap(await supabase.from('workout_plans').select(WORKOUT_COLUMNS).eq('id', id).single()) as WorkoutPlan,
  });
}

export type WorkoutPlanValues = Omit<WorkoutPlan, 'id' | 'created_at'>;

export function useCreateWorkoutPlan() {
  const invalidate = useInvalidate('workoutPlans');
  return useMutation({
    mutationFn: async (values: WorkoutPlanValues) =>
      unwrap(await supabase.from('workout_plans').insert(values).select('id').single()) as { id: string },
    onSuccess: invalidate,
  });
}

export function useUpdateWorkoutPlan(id: string) {
  const invalidate = useInvalidate('workoutPlans');
  return useMutation({
    mutationFn: async (patch: Partial<WorkoutPlanValues>) =>
      unwrap(await supabase.from('workout_plans').update(patch).eq('id', id)),
    onSuccess: invalidate,
  });
}

export function useDeleteWorkoutPlan() {
  const invalidate = useInvalidate('workoutPlans', 'workoutLogs');
  return useMutation({
    mutationFn: async (plan: Pick<WorkoutPlan, 'id' | 'file_paths'>) => {
      unwrap(await supabase.from('workout_plans').delete().eq('id', plan.id));
      await removeHealthImages(plan.file_paths).catch(() => undefined);
    },
    onSuccess: invalidate,
  });
}

/** Registros de treino desde `since` (todas as fichas). */
export function useWorkoutLogs(since: string) {
  return useQuery({
    queryKey: ['workoutLogs', since],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('workout_logs')
          .select('id, plan_id, session_name, done_on, done_by, created_at')
          .gte('done_on', since)
          .order('done_on', { ascending: false }),
      ) as WorkoutLog[],
  });
}

export function useToggleWorkoutLog() {
  const invalidate = useInvalidate('workoutLogs');
  return useMutation({
    mutationFn: async ({ planId, sessionName, date, done }: { planId: string; sessionName: string; date: string; done: boolean }) => {
      if (done) {
        unwrap(
          await supabase
            .from('workout_logs')
            .upsert(
              { plan_id: planId, session_name: sessionName, done_on: date },
              { onConflict: 'plan_id,session_name,done_on', ignoreDuplicates: true },
            ),
        );
      } else {
        unwrap(
          await supabase
            .from('workout_logs')
            .delete()
            .eq('plan_id', planId)
            .eq('session_name', sessionName)
            .eq('done_on', date),
        );
      }
    },
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------
// Dietas

const DIET_COLUMNS =
  'id, person_id, title, professional, valid_until, notes, meals, guidelines, shopping_items, file_paths, status, created_at';

export function useDietPlans() {
  return useQuery({
    queryKey: ['dietPlans'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('diet_plans')
          .select(DIET_COLUMNS)
          .neq('status', 'archived')
          .order('created_at', { ascending: false }),
      ) as DietPlan[],
  });
}

export function useDietPlan(id: string) {
  return useQuery({
    queryKey: ['dietPlans', id],
    queryFn: async () => unwrap(await supabase.from('diet_plans').select(DIET_COLUMNS).eq('id', id).single()) as DietPlan,
  });
}

export type DietPlanValues = Omit<DietPlan, 'id' | 'created_at'>;

export function useCreateDietPlan() {
  const invalidate = useInvalidate('dietPlans');
  return useMutation({
    mutationFn: async (values: DietPlanValues) =>
      unwrap(await supabase.from('diet_plans').insert(values).select('id').single()) as { id: string },
    onSuccess: invalidate,
  });
}

export function useUpdateDietPlan(id: string) {
  const invalidate = useInvalidate('dietPlans');
  return useMutation({
    mutationFn: async (patch: Partial<DietPlanValues>) => unwrap(await supabase.from('diet_plans').update(patch).eq('id', id)),
    onSuccess: invalidate,
  });
}

export function useDeleteDietPlan() {
  const invalidate = useInvalidate('dietPlans');
  return useMutation({
    mutationFn: async (plan: Pick<DietPlan, 'id' | 'file_paths'>) => {
      unwrap(await supabase.from('diet_plans').delete().eq('id', plan.id));
      await removeHealthImages(plan.file_paths).catch(() => undefined);
    },
    onSuccess: invalidate,
  });
}

// Saúde: pessoas e pets da casa, consultas, vacinas, exames, treinos e dietas.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';

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
  const invalidate = useInvalidate('people', 'medications');
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

/** Lê as fotos (já no bucket "health") e devolve o documento organizado. */
export async function readHealthDocument<T>(kind: HealthDocumentKind, paths: string[]): Promise<T> {
  const { data, error } = await supabase.functions.invoke<{ data: T }>('parse-health', {
    body: { kind, image_paths: paths },
  });
  if (error || !data) {
    throw new Error(await functionErrorMessage(error, 'Não foi possível ler o documento. Tente novamente.'));
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

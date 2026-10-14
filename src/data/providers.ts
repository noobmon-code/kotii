// Prestadores e consertos: quem faz serviço para a casa e o que cada um fez.
//
// As duas tabelas chegam ao banco numa migração própria, e o app pode ser
// publicado antes dela. Por isso as listas daqui não derrubam ninguém: sem a
// tabela, respondem "nada" e dizem que ela falta (`missing`, isMissingTable).
// As telas que já existiam (aba Casa, tela do aparelho) tratam qualquer falha
// destas consultas como "sem serviços", nunca como tela de erro; a tela dos
// prestadores avisa que eles ainda não estão ativos, e salvar dá o mesmo aviso.
//
// Nomes e telefones são de gente de fora da casa: estas consultas não entram
// no cache guardado no aparelho (PERSISTED em lib/queryClient), não vão para
// o retrato do Nuke, e nada daqui é escrito em log.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { JobValues, ProviderValues } from '@/domain/providers';
import { errorMessage, supabase, unwrap } from '@/lib/supabase';
import type { ServiceJob, ServiceProvider } from '@/lib/types';

/** Nomes das consultas (um teste confere que não vão para o aparelho). */
export const PROVIDERS_KEY = 'serviceProviders';
export const JOBS_KEY = 'serviceJobs';

const PROVIDER_COLUMNS = 'id, name, trade, phone, phone_digits, notes, recommended, created_at';
const JOB_COLUMNS = 'id, provider_id, equipment_id, done_on, description, amount, warranty_until, notes, created_at';

/** O que a pessoa lê enquanto o banco ainda não tem as tabelas. */
export const PROVIDERS_UNAVAILABLE = 'Os prestadores ainda estão sendo ativados no Kotii. Tente de novo mais tarde.';
// Sem dizer quem apagou: pode ter sido a própria pessoa, em outro aparelho.
const GONE = 'Este cadastro não existe mais.';
const LINK_GONE = 'O prestador ou o aparelho deste serviço não existe mais. Volte e escolha de novo.';

/**
 * A tabela ainda não existe no banco (o app chegou antes da migração): o
 * PostgREST responde PGRST205 ("Could not find the table ... in the schema
 * cache") e o Postgres, 42P01 ("relation ... does not exist").
 */
export function isMissingTable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === 'PGRST205' || code === '42P01') return true;
  return (
    typeof message === 'string' &&
    /service_(providers|jobs)/.test(message) &&
    /does not exist|could not find the table|schema cache/i.test(message)
  );
}

/** O erro de abrir, salvar ou apagar um prestador ou serviço, em palavras de gente. */
export function providerErrorMessage(error: unknown): string {
  if (isMissingTable(error)) return PROVIDERS_UNAVAILABLE;
  // O serviço aponta para um prestador ou aparelho que acabou de ser apagado.
  if ((error as { code?: unknown } | null)?.code === '23503') return LINK_GONE;
  return errorMessage(error);
}

/** Uma lista destas tabelas. `missing`: o banco ainda não tem a tabela (e a lista vem vazia). */
export interface SoftList<T> {
  rows: T[];
  missing: boolean;
}

async function softList<T>(request: PromiseLike<{ data: unknown; error: unknown }>): Promise<SoftList<T>> {
  const result = await request;
  if (result.error && isMissingTable(result.error)) return { rows: [], missing: true };
  return { rows: (unwrap(result) ?? []) as T[], missing: false };
}

export function fetchServiceProviders(db: SupabaseClient = supabase): Promise<SoftList<ServiceProvider>> {
  return softList(db.from('service_providers').select(PROVIDER_COLUMNS).order('name'));
}

/**
 * Serviços, do mais recente para o mais antigo: todos, os de um prestador ou
 * os de um aparelho. O PostgREST entrega até 1000 linhas por pedido: numa casa
 * com mais serviços que isso, ficam os mais recentes.
 */
export function fetchServiceJobs(
  filter: { providerId?: string; equipmentId?: string } = {},
  db: SupabaseClient = supabase,
): Promise<SoftList<ServiceJob>> {
  let query = db.from('service_jobs').select(JOB_COLUMNS);
  if (filter.providerId) query = query.eq('provider_id', filter.providerId);
  if (filter.equipmentId) query = query.eq('equipment_id', filter.equipmentId);
  return softList(query.order('done_on', { ascending: false }).order('created_at', { ascending: false }));
}

/** Um serviço; null se não existe mais (ou se o banco ainda não tem a tabela). */
export async function fetchServiceJob(id: string, db: SupabaseClient = supabase): Promise<ServiceJob | null> {
  const result = await db.from('service_jobs').select(JOB_COLUMNS).eq('id', id).maybeSingle();
  if (result.error && isMissingTable(result.error)) return null;
  return (unwrap(result) ?? null) as ServiceJob | null;
}

/**
 * `fresh`: para quem vai editar (a tela do prestador) e para a tela do serviço (o ofício e o nome vão no gasto que
 * ela copia). Busca de novo ao abrir mesmo com a lista guardada ainda nova: o formulário copia o prestador uma vez
 * só, e o que está guardado pode ser de antes de uma mudança feita em outro celular. Sem internet a busca fica
 * parada e vale o guardado.
 */
export function useServiceProviders({ fresh = false }: { fresh?: boolean } = {}) {
  return useQuery({
    queryKey: [PROVIDERS_KEY],
    queryFn: () => fetchServiceProviders(),
    ...(fresh ? { refetchOnMount: 'always' as const } : {}),
  });
}

/** Todos os serviços da casa (o último de cada prestador e a busca saem daqui). */
export function useServiceJobs() {
  return useQuery({ queryKey: [JOBS_KEY], queryFn: () => fetchServiceJobs() });
}

export function useProviderJobs(providerId: string | undefined) {
  return useQuery({
    queryKey: [JOBS_KEY, 'provider', providerId],
    enabled: Boolean(providerId),
    queryFn: () => fetchServiceJobs({ providerId }),
  });
}

export function useEquipmentJobs(equipmentId: string | undefined) {
  return useQuery({
    queryKey: [JOBS_KEY, 'equipment', equipmentId],
    enabled: Boolean(equipmentId),
    queryFn: () => fetchServiceJobs({ equipmentId }),
  });
}

/**
 * Um serviço, para a tela que o edita: busca a cada vez que ela abre, mesmo com o guardado de menos de 30 s, para
 * a tela esperar o que está no banco (ver servico/[id].tsx). Sem internet a busca fica parada e vale o guardado.
 */
export function useServiceJob(id: string | undefined) {
  return useQuery({
    queryKey: [JOBS_KEY, 'job', id],
    enabled: Boolean(id),
    refetchOnMount: 'always',
    queryFn: () => fetchServiceJob(id!),
  });
}

/** Busca de novo prestadores e serviços; a promessa termina quando as listas na tela chegaram. */
function useInvalidateProviders() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: [PROVIDERS_KEY] }),
      queryClient.invalidateQueries({ queryKey: [JOBS_KEY] }),
    ]);
}

/** Cria ou muda uma linha e devolve o id; mudar uma que já foi apagada avisa, em vez de fingir que salvou. */
async function saveRow(table: 'service_providers' | 'service_jobs', id: string | undefined, values: object, db: SupabaseClient) {
  if (!id) return unwrap(await db.from(table).insert(values).select('id').single()) as { id: string };
  const row = unwrap(await db.from(table).update(values).eq('id', id).select('id').maybeSingle()) as { id: string } | null;
  if (!row) throw new Error(GONE);
  return row;
}

export function saveServiceProvider(input: { id?: string; values: ProviderValues }, db: SupabaseClient = supabase) {
  return saveRow('service_providers', input.id, input.values, db);
}

export function saveServiceJob(input: { id?: string; values: JobValues }, db: SupabaseClient = supabase) {
  return saveRow('service_jobs', input.id, input.values, db);
}

export function useSaveProvider() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateProviders();
  return useMutation({
    mutationFn: (input: { id?: string; values: ProviderValues }) => saveServiceProvider(input),
    onSuccess: (_saved, input) => {
      // A linha salva entra já na lista guardada, de onde o formulário copia o prestador: se a busca abaixo falhar
      // (ou a internet cair antes), abrir de novo mostra o que foi salvo, e não o de antes, que Salvar gravaria
      // por cima. Prestador novo não precisa: a tela dele espera a lista que chega com ele.
      if (input.id) {
        queryClient.setQueryData<SoftList<ServiceProvider>>([PROVIDERS_KEY], (old) =>
          old ? { ...old, rows: old.rows.map((p) => (p.id === input.id ? { ...p, ...input.values } : p)) } : undefined,
        );
      }
      // Espera a lista nova: a tela do prestador recém-criado abre em seguida e o procura nela.
      return invalidate();
    },
  });
}

export function useDeleteProvider() {
  const invalidate = useInvalidateProviders();
  return useMutation({
    // O histórico de serviços sai junto, em cascata no banco.
    mutationFn: async (id: string) => unwrap(await supabase.from('service_providers').delete().eq('id', id)),
    // Sem esperar: a tela fecha antes de a lista voltar sem ele.
    onSuccess: () => void invalidate(),
  });
}

export function useSaveServiceJob() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateProviders();
  return useMutation({
    mutationFn: (input: { id?: string; values: JobValues }) => saveServiceJob(input),
    onSuccess: (_saved, input) => {
      // O serviço salvo entra já no guardado de onde o formulário o copia: se a busca abaixo falhar (ou a internet
      // cair antes), abrir de novo sem internet mostra o que foi salvo, e não o de antes, que Salvar gravaria por
      // cima. As listas de serviços esperam a busca (a ordem e o filtro delas podem mudar com o que foi salvo).
      if (input.id) {
        queryClient.setQueryData<ServiceJob | null>([JOBS_KEY, 'job', input.id], (old) => (old ? { ...old, ...input.values } : undefined));
      }
      // Sem esperar a busca: o serviço já está salvo, e o gasto que a tela copia em seguida (e o fechar dela) não
      // pode ficar preso a uma internet que não responde. Quem abre o mesmo serviço logo depois espera a busca que
      // a tela dele pede ao abrir (e esta aqui já marcou o guardado como velho).
      void invalidate();
    },
  });
}

export function useDeleteServiceJob() {
  const invalidate = useInvalidateProviders();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('service_jobs').delete().eq('id', id)),
    onSuccess: () => void invalidate(),
  });
}

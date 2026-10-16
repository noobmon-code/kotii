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
import { useCallback } from 'react';

import type { JobValues, ProviderValues } from '@/domain/providers';
import { settledData } from '@/lib/settledData';
import { errorMessage, supabase, unwrap } from '@/lib/supabase';
import type { ServiceJob, ServiceProvider } from '@/lib/types';

import { isMissingFunction } from './missingSchema';

/** Nomes das consultas (um teste confere que não vão para o aparelho). */
export const PROVIDERS_KEY = 'serviceProviders';
export const JOBS_KEY = 'serviceJobs';

const PROVIDER_COLUMNS = 'id, name, trade, phone, phone_digits, notes, recommended, created_at';
const JOB_COLUMNS = 'id, provider_id, equipment_id, done_on, description, amount, warranty_until, notes, created_at';

/** O que a pessoa lê enquanto o banco ainda não tem as tabelas. */
export const PROVIDERS_UNAVAILABLE = 'Os prestadores ainda estão sendo ativados no Kotii. Tente de novo mais tarde.';
/** delete_service_provider recusou (NK010): o número de serviços da pergunta não é mais o do prestador. */
export const PROVIDER_JOBS_CHANGED = 'Os serviços deste prestador mudaram em outro aparelho, e nada foi excluído. Confira o histórico e tente de novo.';
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

/** Excluir o prestador foi recusado: outro aparelho registrou (ou apagou) um serviço dele depois da pergunta. */
export function isProviderJobsChanged(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'NK010';
}

/** O erro de abrir, salvar ou apagar um prestador ou serviço, em palavras de gente. */
export function providerErrorMessage(error: unknown): string {
  if (isMissingTable(error)) return PROVIDERS_UNAVAILABLE;
  // O serviço aponta para um prestador ou aparelho que acabou de ser apagado.
  if ((error as { code?: unknown } | null)?.code === '23503') return LINK_GONE;
  if (isProviderJobsChanged(error)) return PROVIDER_JOBS_CHANGED;
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

/** Os serviços de um prestador e quantos são ao todo (`total`; null quando o banco não disse). */
export interface ProviderJobList extends SoftList<ServiceJob> {
  total: number | null;
}

/**
 * Os serviços de um prestador, do mais recente para o mais antigo, com quantos ele tem ao todo contados pelo
 * banco: a lista pode vir cortada nos 1000 mais recentes, e a pergunta de excluir (que o banco confere) diz o
 * número de verdade.
 */
export async function fetchProviderJobs(providerId: string, db: SupabaseClient = supabase): Promise<ProviderJobList> {
  const result = await db
    .from('service_jobs')
    .select(JOB_COLUMNS, { count: 'exact' })
    .eq('provider_id', providerId)
    .order('done_on', { ascending: false })
    .order('created_at', { ascending: false });
  if (result.error && isMissingTable(result.error)) return { rows: [], missing: true, total: 0 };
  const rows = (unwrap(result) ?? []) as ServiceJob[];
  return { rows, missing: false, total: typeof result.count === 'number' ? result.count : null };
}

/** Quantos serviços o prestador tem, numa lista que chegou; null quando não se sabe. */
export function providerJobCount(list: ProviderJobList | undefined): number | null {
  return list && !list.missing && typeof list.total === 'number' ? list.total : null;
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

/**
 * `fresh`: para a pergunta de excluir, que conta os serviços. Busca de novo ao abrir mesmo com a lista guardada
 * ainda nova: outro celular pode ter registrado um serviço para ele há segundos.
 */
export function useProviderJobs(providerId: string | undefined, { fresh = false }: { fresh?: boolean } = {}) {
  return useQuery({
    queryKey: [JOBS_KEY, 'provider', providerId],
    enabled: Boolean(providerId),
    ...(fresh ? { refetchOnMount: 'always' as const } : {}),
    queryFn: () => fetchProviderJobs(providerId!),
  });
}

/** Quanto a pergunta de excluir espera a busca do toque; depois disso, ela fala do histórico todo. */
export const DELETE_CHECK_MS = 4000;

/**
 * Quantos serviços o prestador tem, para a pergunta de excluir. `known` só vem da busca desta visita à tela, e
 * só se ela chegou bem: antes disso, durante uma nova, depois de uma que falhou, ou sem internet (o guardado
 * pode ser de antes de um serviço registrado em outro celular), é null, e a pergunta fala do histórico todo.
 * `recount` busca de novo na hora do toque (com a tela aberta, outro celular pode ter registrado um serviço);
 * null se a busca falhar ou não responder em DELETE_CHECK_MS.
 */
export function useProviderJobCount(providerId: string | undefined) {
  const jobs = useProviderJobs(providerId, { fresh: true });
  const known = providerJobCount(jobs.isFetchedAfterMount ? settledData(jobs) : undefined);
  const { refetch } = jobs;
  const recount = useCallback(async (): Promise<number | null> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), DELETE_CHECK_MS);
    });
    try {
      return await Promise.race([refetch().then((result) => providerJobCount(settledData(result))), late]);
    } finally {
      clearTimeout(timer);
    }
  }, [refetch]);
  return { known, recount };
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

/** A lista com o prestador novo no lugar dele pela ordem do nome (a do banco), sem mexer nos outros. */
function withNewProvider(rows: ServiceProvider[], row: ServiceProvider): ServiceProvider[] {
  if (rows.some((p) => p.id === row.id)) return rows;
  const at = rows.findIndex((p) => p.name.localeCompare(row.name, 'pt-BR') > 0);
  return at < 0 ? [...rows, row] : [...rows.slice(0, at), row, ...rows.slice(at)];
}

export function useSaveProvider() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateProviders();
  return useMutation({
    mutationFn: (input: { id?: string; values: ProviderValues }) => saveServiceProvider(input),
    onSuccess: (saved, input) => {
      // A linha salva entra já na lista guardada, de onde o formulário copia o prestador: se a busca abaixo falhar
      // (ou a internet cair antes), abrir de novo mostra o que foi salvo, e não o de antes, que Salvar gravaria
      // por cima. O prestador novo também: a tela dele (ou a do serviço, vindo de um aparelho) abre em seguida e
      // o procura nesta lista, e com a busca parada sem internet diria que ele não existe mais. Sem lista
      // guardada não há o que mudar: a tela que abre busca a dela. O insert deu certo, então a tabela existe.
      queryClient.setQueryData<SoftList<ServiceProvider>>([PROVIDERS_KEY], (old) => {
        if (!old) return undefined;
        if (input.id) return { ...old, rows: old.rows.map((p) => (p.id === input.id ? { ...p, ...input.values } : p)) };
        return { rows: withNewProvider(old.rows, { id: saved.id, ...input.values, created_at: new Date().toISOString() }), missing: false };
      });
      // Sem esperar a busca, nem para o prestador novo (ele já está na lista guardada): o cadastro já foi salvo, e
      // fechar a tela não pode ficar preso a uma internet que não responde. A tela que abre em seguida espera a
      // busca que ela mesma pede ao abrir (e esta aqui já marcou o guardado como velho).
      void invalidate();
    },
  });
}

/**
 * Exclui o prestador (o histórico dele vai junto, em cascata no banco) pela função que confere, com ele travado,
 * o número de serviços que a pessoa leu na pergunta (`expectedJobs`; null quando a pergunta falou do histórico
 * todo). Número diferente: o banco recusa com NK010, sem apagar nada. Devolve false quando ele já não existia
 * (outro aparelho excluiu antes): o que a pessoa queria já está feito. Com o banco (ou o cache de esquema do
 * PostgREST) ainda sem a função, exclui do jeito de antes, sem a conferência.
 */
export async function deleteServiceProvider(input: { id: string; expectedJobs: number | null }, db: SupabaseClient = supabase): Promise<boolean> {
  const result = await db.rpc('delete_service_provider', { p_id: input.id, p_expected_jobs: input.expectedJobs });
  if (result.error && isMissingFunction(result.error, 'delete_service_provider')) {
    unwrap(await db.from('service_providers').delete().eq('id', input.id));
    return true;
  }
  return Boolean(unwrap(result));
}

export function useDeleteProvider() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateProviders();
  return useMutation({
    mutationFn: (input: { id: string; expectedJobs: number | null }) => deleteServiceProvider(input),
    // Sem esperar: a tela fecha antes de a lista voltar sem ele.
    onSuccess: () => void invalidate(),
    // O banco recusou porque os serviços dele mudaram em outro aparelho: o histórico na tela (e a contagem da
    // próxima pergunta) busca de novo.
    onError: (error) => (isProviderJobsChanged(error) ? void queryClient.invalidateQueries({ queryKey: [JOBS_KEY] }) : undefined),
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

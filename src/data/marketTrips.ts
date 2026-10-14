// "Estou indo ao mercado": as idas da casa (market_trips), avisar e encerrar
// (announce_market_trip e end_market_trip, que também cuidam do aviso nos
// navegadores dos outros) e a opção desse aviso neste navegador.
//
// O app pode ser publicado antes de a migração chegar ao banco: sem a tabela,
// a coluna ou as funções, nada daqui vira erro na tela. As idas voltam como
// "não há" (null: sem faixa e sem o botão de avisar), a opção dos avisos some
// e avisar, num toque antes dessa resposta, diz que o recurso ainda está
// sendo ativado.
//
// As idas ficam só na memória: a chave não entra em PERSISTED
// (lib/queryClient). Uma faixa de horas atrás, aberta sem internet, só
// enganaria.

import { onlineManager, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { TRIP_LIMIT_REACHED, TRIP_NOT_READY, TRIP_OFFLINE, type AnnounceResult, type MarketTrip } from '@/domain/marketTrips';
import { getMarketTripPush, marketTripPushSupported, setMarketTripPush } from '@/lib/reminders';
import { errorMessage, supabase, unwrap } from '@/lib/supabase';

export const MARKET_TRIPS_KEY = 'marketTrips';
export const MARKET_TRIP_PUSH_KEY = 'marketTripPush';

/** De quanto em quanto tempo as idas são conferidas com uma tela que as mostra aberta. */
const TRIPS_REFETCH_MS = 2 * 60 * 1000;

// Tabela (PGRST205, 42P01), função (PGRST202, 42883) ou coluna (PGRST204,
// 42703) que o banco não tem: os códigos do PostgREST e os do Postgres.
const NOT_DEPLOYED = new Set(['PGRST205', '42P01', 'PGRST202', '42883', 'PGRST204', '42703']);

const codeOf = (error: unknown): string | null =>
  error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : null;

/** O banco ainda não tem esta parte (a migração das idas não foi aplicada). */
export function isNotDeployed(error: unknown): boolean {
  return NOT_DEPLOYED.has(codeOf(error) ?? '');
}

/**
 * As idas da casa aberta que ainda podem valer (liveTrips, no domínio,
 * decide de novo a cada minuto da tela). null: o banco ainda não tem as idas.
 *
 * A lista vem junto (pelo FK da ida, que é de lista e casa): a faixa da tela
 * Hoje não espera as listas guardadas no aparelho, que não sabem da lista
 * que outra pessoa criou há pouco. No banco de antes das idas a resposta
 * continua sendo a da tabela que falta (PGRST205), antes de olhar a lista.
 */
export async function fetchMarketTrips(now: Date = new Date()): Promise<MarketTrip[] | null> {
  const { data, error } = await supabase
    .from('market_trips')
    .select('id, list_id, user_id, display_name, created_at, ends_at, ended_at, list:shopping_lists!inner(name, kind, archived_at)')
    .is('ended_at', null)
    .gt('ends_at', now.toISOString())
    .order('created_at', { ascending: false })
    .limit(50);
  if (!error) return (data ?? []) as unknown as MarketTrip[];
  if (isNotDeployed(error)) return null;
  throw error;
}

/**
 * As idas para a faixa da tela Hoje e da lista. Outra pessoa avisa a qualquer
 * momento: confere ao abrir a tela, ao voltar para o app e a cada 2 minutos
 * com a tela aberta. Quem usa não mostra erro: sem resposta, não há faixa.
 */
export function useMarketTrips() {
  return useQuery({
    queryKey: [MARKET_TRIPS_KEY],
    queryFn: () => fetchMarketTrips(),
    staleTime: 0,
    // No banco de antes das idas, só confere de novo ao voltar para o app.
    refetchInterval: (query) => (query.state.data === null ? false : TRIPS_REFETCH_MS),
    retry: false,
  });
}

/** Para o puxar-para-atualizar das telas que mostram a faixa. */
export function useRefreshMarketTrips() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: [MARKET_TRIPS_KEY] });
}

/** Avisa a casa aberta (announce_market_trip): a ida e o aviso nos navegadores dos outros. */
export async function announceMarketTrip(listId: string): Promise<AnnounceResult> {
  // Sem internet o pedido falharia com o texto do navegador.
  if (!onlineManager.isOnline()) throw new Error(TRIP_OFFLINE.announce);
  return unwrap(await supabase.rpc('announce_market_trip', { p_list_id: listId })) as AnnounceResult;
}

/** Encerra a própria ida para a casa toda (end_market_trip); devolve se encerrou. */
export async function endMarketTrip(tripId: string): Promise<boolean> {
  // Como em avisar: as mutações do app saem mesmo sem internet (networkMode 'always'), e no mercado o sinal some.
  if (!onlineManager.isOnline()) throw new Error(TRIP_OFFLINE.end);
  return unwrap(await supabase.rpc('end_market_trip', { p_trip_id: tripId })) as boolean;
}

export function useAnnounceMarketTrip() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: announceMarketTrip,
    // Sem esperar a busca: o resultado do aviso aparece já, a faixa logo em seguida.
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: [MARKET_TRIPS_KEY] }),
  });
}

/** Encerra a própria ida para a casa toda. */
export function useEndMarketTrip() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: endMarketTrip,
    onSuccess: (_ended, tripId) => {
      // A faixa some já; a busca confirma.
      queryClient.setQueryData<MarketTrip[] | null>([MARKET_TRIPS_KEY], (trips) => (trips ? trips.filter((trip) => trip.id !== tripId) : trips));
      void queryClient.invalidateQueries({ queryKey: [MARKET_TRIPS_KEY] });
    },
  });
}

/**
 * O pedido não chegou ao servidor: sinal fraco, com o aparelho ainda dizendo
 * que há internet (o que onlineManager não vê). O postgrest-js devolve o erro
 * do fetch sem código, com o nome e o texto dele na mensagem ("TypeError:
 * Network request failed" no celular, "TypeError: Failed to fetch" no Chrome).
 */
function isFetchFailure(error: unknown): boolean {
  if (codeOf(error)) return false;
  const message = error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : '';
  return message.startsWith('TypeError') || message.includes('Failed to fetch') || message.includes('Network request failed');
}

/**
 * A mensagem para um erro de avisar (`announce`), de encerrar (`end`) ou da
 * opção dos avisos (sem `action`: ali o pedido que não chegou fica como veio).
 */
export function marketTripErrorMessage(error: unknown, action?: keyof typeof TRIP_OFFLINE): string {
  if (isNotDeployed(error)) return TRIP_NOT_READY;
  if (action && isFetchFailure(error)) return TRIP_OFFLINE[action];
  const code = codeOf(error);
  if (code === 'NK005') return TRIP_LIMIT_REACHED;
  // A lista foi arquivada ou apagada por outra pessoa com a tela aberta.
  if (code === 'P0002') return 'Esta lista não está mais aberta. Volte para as listas e escolha outra.';
  return errorMessage(error);
}

/**
 * "Alguém indo ao mercado" neste navegador: ligado ou desligado. null: a
 * opção não existe aqui (no celular, num navegador sem avisos, ou com o
 * banco de antes da opção) e a tela não a mostra.
 */
export async function readMarketTripPush(): Promise<boolean | null> {
  if (!marketTripPushSupported) return null;
  try {
    return await getMarketTripPush();
  } catch (error) {
    if (isNotDeployed(error)) return null;
    throw error;
  }
}

/**
 * A opção em Família → "Avisos neste navegador". `value` undefined: ainda
 * lendo (ou não deu para ler). `set` liga ou desliga e devolve false quando
 * faltou a permissão do navegador. `pending`: uma mudança ainda no ar; até
 * ela terminar, outro toque não faz nada (devolve true: não há o que avisar).
 */
export function useMarketTripPush() {
  const queryClient = useQueryClient();
  const key = [MARKET_TRIP_PUSH_KEY];
  const query = useQuery({ queryKey: key, queryFn: readMarketTripPush, staleTime: 0, retry: false });
  const [pending, setPending] = useState(false);
  // O estado chega depois de um segundo toque rápido; a ref, não.
  const inFlight = useRef(false);
  async function set(enabled: boolean): Promise<boolean> {
    if (inFlight.current) return true;
    inFlight.current = true;
    setPending(true);
    // Primeiro o pedido: ligar pede a permissão, e o navegador só aceita dentro do toque.
    const request = setMarketTripPush(enabled);
    // Uma leitura que estivesse no ar não desfaz o que a pessoa acabou de escolher.
    void queryClient.cancelQueries({ queryKey: key });
    queryClient.setQueryData(key, enabled);
    try {
      const ok = await request;
      if (!ok) queryClient.setQueryData(key, !enabled);
      return ok;
    } catch (error) {
      queryClient.setQueryData(key, !enabled);
      throw error;
    } finally {
      inFlight.current = false;
      setPending(false);
      // O que vale é o que ficou no servidor.
      void queryClient.invalidateQueries({ queryKey: key });
    }
  }
  return { value: query.data, set, pending };
}

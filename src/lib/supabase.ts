import 'react-native-url-polyfill/auto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { accessErrorMessage } from './accessErrors';
import { fetchWithHousehold, HOUSEHOLD_HEADER } from './activeHousehold';
import { BUSY_TRY_AGAIN, isDeadlock } from './databaseErrors';
import { isNetworkFailure, OFFLINE_TRY_AGAIN } from './networkErrors';
import { sessionStorage } from './sessionStorage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

const projectUrl = url ?? 'http://localhost:54321';

/** Para o pedido que confere o link de recuperação fora do cliente (lib/recoveryLink). */
export const SUPABASE_URL = projectUrl;
export const SUPABASE_ANON_KEY = anonKey ?? 'not-configured';

/**
 * Onde a sessão fica guardada: o mesmo nome que o Supabase usaria sozinho
 * (sessões já guardadas continuam valendo), fixado aqui porque sair sem
 * internet precisa apagá-la direto (ver lib/session).
 */
export const SESSION_STORAGE_KEY = `sb-${new URL(projectUrl).hostname.split('.')[0]}-auth-token`;

/**
 * Prazo de cada pedido ao banco (PostgREST). Acima do de juntar produtos (MERGE_TIMEOUT_MS, 25 s), que tem o
 * próprio aviso, e do prazo que o Supabase dá aos comandos de quem entrou (8 s): só corta o pedido que ficou
 * sem resposta.
 */
export const DB_TIMEOUT_MS = 30_000;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // Cifrada no celular, com a chave no cofre do sistema (ver sessionStorage).
    storage: sessionStorage,
    storageKey: SESSION_STORAGE_KEY,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  // Todo pedido diz qual casa está aberta neste aparelho (ver activeHousehold).
  global: { fetch: fetchWithHousehold() },
  // No Android o pedido não tem prazo: com sinal fraco, um que nunca recebe resposta seguraria a fila da lista
  // (que anda um de cada vez) por minutos. Cortado, ele volta como falta de resposta e a fila tenta de novo.
  db: { timeout: DB_TIMEOUT_MS },
});

const householdClients = new Map<string, SupabaseClient>();

/**
 * Cliente preso a uma casa, com a sessão de quem entrou: para buscar, em
 * segundo plano, os dados de uma casa que não é a aberta (os avisos de todas).
 */
export function householdClient(householdId: string): SupabaseClient {
  let client = householdClients.get(householdId);
  if (!client) {
    client = createClient(url ?? 'http://localhost:54321', anonKey ?? 'not-configured', {
      accessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
      global: { headers: { [HOUSEHOLD_HEADER]: householdId } },
    });
    householdClients.set(householdId, client);
  }
  return client;
}

// Renova o token só com o app em primeiro plano.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

/** Lança o erro do Supabase ou devolve os dados. */
export function unwrap<T>(result: { data: T; error: unknown }): NonNullable<T> {
  if (result.error) throw result.error;
  return result.data as NonNullable<T>;
}

export function errorMessage(error: unknown): string {
  // Escrita barrada pela regra de acesso da casa: em vez do texto do Postgres
  // ("new row violates row-level security policy..."), o que aconteceu.
  const access = accessErrorMessage(error);
  if (access) return access;
  // Pedido desfeito pelo banco porque outra pessoa da casa mexeu na mesma coisa no mesmo instante.
  if (isDeadlock(error)) return BUSY_TRY_AGAIN;
  // O pedido não chegou ao servidor: em vez de "TypeError: Network request failed".
  if (isNetworkFailure(error)) return OFFLINE_TRY_AGAIN;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return 'Algo deu errado. Tente novamente.';
}

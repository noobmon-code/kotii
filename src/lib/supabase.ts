import 'react-native-url-polyfill/auto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { fetchWithHousehold, HOUSEHOLD_HEADER } from './activeHousehold';
import { sessionStorage } from './sessionStorage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase = createClient(url ?? 'http://localhost:54321', anonKey ?? 'not-configured', {
  auth: {
    // Cifrada no celular, com a chave no cofre do sistema (ver sessionStorage).
    storage: sessionStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  // Todo pedido diz qual casa está aberta neste aparelho (ver activeHousehold).
  global: { fetch: fetchWithHousehold() },
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
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return 'Algo deu errado. Tente novamente.';
}

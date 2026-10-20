// Aceite dos termos (domain/terms): as versões que a pessoa já aceitou, do banco (terms_acceptances, só as
// próprias linhas) e deste aparelho. É um aviso, nunca uma trava: erro na leitura é não mostrar o aviso.
//
// O "Entendi" fica no aparelho na hora e vai para o banco pela accept_terms, que grava com a hora do servidor.
// Sem internet, ou com o app publicado antes da migração (sem a tabela e a função no banco), ele fica só no
// aparelho: o aviso não volta, e o aceite vai para o banco na primeira leitura que achar a tabela.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { TERMS_ACCEPT_VERSION, termsNotice } from '@/domain/terms';
import { useAuth } from '@/lib/auth';
import { queryClient as appQueryClient } from '@/lib/queryClient';
import { supabase, unwrap } from '@/lib/supabase';

import { isMissingFunction, isMissingTable } from './missingSchema';

/** As versões aceitas neste aparelho, por conta (outra conta no mesmo aparelho tem as dela). */
const deviceKey = (userId: string) => `kotii:terms-accepted:${userId}`;

const termsQueryKey = (userId: string | undefined) => ['termsAccepted', userId] as const;

async function readDevice(userId: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(deviceKey(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

async function saveDevice(userId: string, version: string): Promise<void> {
  const saved = await readDevice(userId);
  if (saved.includes(version)) return;
  try {
    await AsyncStorage.setItem(deviceKey(userId), JSON.stringify([...saved, version]));
  } catch {
    // Sem armazenamento: o aviso some só enquanto o app está aberto.
  }
}

/** A conta foi apagada: as versões que ela aceitou saem deste aparelho (no banco, saem com a conta). */
export async function forgetTermsOnDevice(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(deviceKey(userId));
  } catch {
    // Sem armazenamento: não há o que apagar.
  }
}

/** Grava o aceite no banco. false: a função ainda não existe (o app chegou antes da migração); outro erro sobe. */
async function recordAcceptance(version: string, db: SupabaseClient): Promise<boolean> {
  const result = await db.rpc('accept_terms', { p_version: version });
  if (result.error && isMissingFunction(result.error, 'accept_terms')) return false;
  if (result.error) throw result.error;
  return true;
}

/**
 * As versões que a pessoa aceitou: as do banco e as deste aparelho. Sem a tabela no banco, só as do aparelho.
 * O aceite da versão atual que ficou só no aparelho vai para o banco agora (com a hora de agora, a primeira em
 * que deu para gravar); se não der, fica para a próxima leitura.
 */
export async function fetchAcceptedTerms(userId: string, db: SupabaseClient = supabase): Promise<string[]> {
  const device = await readDevice(userId);
  const result = await db.from('terms_acceptances').select('version').eq('user_id', userId);
  if (result.error && isMissingTable(result.error, 'terms_acceptances')) return device;
  const saved = ((unwrap(result) ?? []) as { version: string }[]).map((row) => row.version);
  if (device.includes(TERMS_ACCEPT_VERSION) && !saved.includes(TERMS_ACCEPT_VERSION)) {
    await recordAcceptance(TERMS_ACCEPT_VERSION, db).catch(() => false);
  }
  return [...new Set([...saved, ...device])];
}

/** "Entendi": no aparelho primeiro (o aviso não volta mesmo sem internet), depois no banco, se der. */
export async function acceptTerms(userId: string, version: string = TERMS_ACCEPT_VERSION, db: SupabaseClient = supabase) {
  await saveDevice(userId, version);
  await recordAcceptance(version, db).catch(() => false);
}

/**
 * Criou a conta ou entrou pela tela de entrar, que diz que continuar é concordar com os termos (e ter 18 anos
 * ou mais). A conta criada agora grava a versão atual; ao entrar, só a conta sem aceite nenhum (a que confirmou
 * o e-mail e entra pela primeira vez, ou a de antes do aviso): quem aceitou uma versão anterior vê na tela Hoje
 * que os termos mudaram. Nunca atrapalha a entrada: um erro aqui só deixa o aviso aparecer depois. No fim, o
 * aviso que a tela Hoje leu enquanto isso é lido de novo.
 */
export async function acceptTermsAtSignIn(userId: string, created: boolean, db: SupabaseClient = supabase): Promise<void> {
  try {
    if (created || !(await fetchAcceptedTerms(userId, db)).length) {
      // A tela Hoje pode abrir e ler o aceite antes de ele chegar ao aparelho e ao banco: essa leitura não pode
      // mostrar o aviso e tirá-lo sozinho logo depois. Como no "Entendi", o aviso sai antes de gravar.
      await appQueryClient.cancelQueries({ queryKey: termsQueryKey(userId) });
      appQueryClient.setQueryData<string[]>(termsQueryKey(userId), (old) =>
        old?.includes(TERMS_ACCEPT_VERSION) ? old : [...(old ?? []), TERMS_ACCEPT_VERSION],
      );
      await acceptTerms(userId, TERMS_ACCEPT_VERSION, db);
    }
  } catch {
    // Sem internet ou outro erro: o aviso da tela Hoje cobre.
  }
  await appQueryClient.invalidateQueries({ queryKey: termsQueryKey(userId) }).catch(() => undefined);
}

/**
 * O aviso dos termos para quem entrou: 'primeira', 'mudou' ou null (aceitou, ou ainda não se sabe). `accept`
 * tira o aviso na hora e grava o aceite. Fora do cache guardado no aparelho (lib/queryClient): sem internet,
 * sem aviso.
 */
export function useTermsNotice() {
  const userId = useAuth().session?.user.id;
  const queryClient = useQueryClient();
  const accepted = useQuery({
    queryKey: termsQueryKey(userId),
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
    queryFn: () => fetchAcceptedTerms(userId!),
  });
  const accept = useCallback(async () => {
    if (!userId) return;
    // Uma leitura que começou antes do toque não traz o aceite: ela não pode trazer o aviso de volta.
    await queryClient.cancelQueries({ queryKey: termsQueryKey(userId) });
    queryClient.setQueryData<string[]>(termsQueryKey(userId), (old) => [...(old ?? []), TERMS_ACCEPT_VERSION]);
    await acceptTerms(userId);
  }, [queryClient, userId]);
  return { notice: accepted.data ? termsNotice(accepted.data) : null, accept };
}

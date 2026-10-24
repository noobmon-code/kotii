import { describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { AppDashboardForbidden } from '@/data/appDashboard';
import {
  FEEDBACK_GONE,
  FEEDBACK_INBOX_NOT_READY,
  FEEDBACK_INVALID,
  FEEDBACK_LIMIT,
  FEEDBACK_LIST_LIMIT,
  FEEDBACK_MAX_LENGTH,
  FEEDBACK_NOT_READY,
} from '@/domain/appFeedback';

import { fetchAppFeedback, FeedbackGone, sendAppFeedback, setAppFeedback } from '../appFeedback';

// As três rpc dos recados com o banco de mentira: o que cada uma manda e como cada resposta do banco vira o que o
// app mostra (o banco sem a migração, o limite de 24 horas, a recusa de quem não mantém o app, o recado que sumiu).

jest.mock('@/lib/supabase', () => ({
  supabase: {},
  errorMessage: (error: { message?: string }) => error?.message ?? 'Algo deu errado. Tente novamente.',
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: null }) }));
jest.mock('@/ui/dialogs', () => ({ notify: jest.fn() }));

type Result = { data: unknown; error: unknown };

/** Um banco de mentira que responde `result` a qualquer rpc e guarda o que foi pedido. */
function fakeDb(result: Result) {
  const rpc = jest.fn(async (_name: string, _args?: Record<string, unknown>) => result);
  return { db: { rpc } as unknown as SupabaseClient, rpc };
}

const missing = (fn: string) => ({ data: null, error: { code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache` } });

const RAW_ITEM = {
  id: 'r1',
  created_at: '2026-10-24T13:00:00Z',
  updated_at: '2026-10-24T13:00:00Z',
  kind: 'problema',
  message: 'A lista não abre.',
  platform: 'web',
  app_version: '1.4.0',
  status: 'lido',
  note: null,
  email: 'ana@exemplo.com',
};

describe('sendAppFeedback', () => {
  it('manda o tipo, o texto aparado e cortado, o aparelho e a versão do app, e devolve o id', async () => {
    const { db, rpc } = fakeDb({ data: 'id-1', error: null });
    const long = `  ${'a'.repeat(FEEDBACK_MAX_LENGTH + 5)}  `;
    await expect(sendAppFeedback({ kind: 'sugestao', message: long }, db)).resolves.toBe('id-1');
    expect(rpc).toHaveBeenCalledWith('send_app_feedback', {
      p_kind: 'sugestao',
      p_message: 'a'.repeat(FEEDBACK_MAX_LENGTH),
      p_platform: Platform.OS,
      p_app_version: Constants.expoConfig?.version ?? null,
    });
  });

  it('sem a função no banco: ainda não dá; o limite de 24 horas (NK015): a frase dele; outro erro sobe como veio', async () => {
    await expect(sendAppFeedback({ kind: 'outro', message: 'Oi' }, fakeDb(missing('send_app_feedback')).db)).rejects.toThrow(FEEDBACK_NOT_READY);
    const limit = fakeDb({ data: null, error: { code: 'NK015', message: 'Você já mandou 10 recados nas últimas 24 horas. Tente de novo amanhã.' } });
    await expect(sendAppFeedback({ kind: 'outro', message: 'Oi' }, limit.db)).rejects.toThrow(FEEDBACK_LIMIT);
    const other = { code: '22023', message: 'O recado precisa ter de 1 a 2000 caracteres.' };
    await expect(sendAppFeedback({ kind: 'outro', message: 'Oi' }, fakeDb({ data: null, error: other }).db)).rejects.toBe(other);
  });
});

describe('fetchAppFeedback', () => {
  it('pede a situação e o limite e confere a resposta', async () => {
    const { db, rpc } = fakeDb({
      data: { counts: { novo: 0, lido: 1, resolvido: 0, arquivado: 0 }, total: 1, items: [RAW_ITEM] },
      error: null,
    });
    const list = await fetchAppFeedback('lido', db);
    expect(rpc).toHaveBeenCalledWith('app_feedback_list', { p_status: 'lido', p_limit: FEEDBACK_LIST_LIMIT });
    expect(list?.items.map((item) => [item.id, item.status, item.appVersion])).toEqual([['r1', 'lido', '1.4.0']]);
    await fetchAppFeedback(null, db);
    expect(rpc).toHaveBeenLastCalledWith('app_feedback_list', { p_status: null, p_limit: FEEDBACK_LIST_LIMIT });
  });

  it('sem a função no banco: null; a recusa (42501): a do painel; uma resposta quebrada: a frase dela', async () => {
    await expect(fetchAppFeedback(null, fakeDb(missing('app_feedback_list')).db)).resolves.toBeNull();
    const refusal = fakeDb({ data: null, error: { code: '42501', message: 'Este painel é só para quem mantém o app.' } });
    await expect(fetchAppFeedback(null, refusal.db)).rejects.toBeInstanceOf(AppDashboardForbidden);
    await expect(fetchAppFeedback(null, fakeDb({ data: { counts: {} }, error: null }).db)).rejects.toThrow(FEEDBACK_INVALID);
  });
});

describe('setAppFeedback', () => {
  it('manda a situação e a nota (null fica como está) e devolve o recado como ficou', async () => {
    const { db, rpc } = fakeDb({ data: { ...RAW_ITEM, status: 'resolvido' }, error: null });
    const item = await setAppFeedback({ id: 'r1', status: 'resolvido' }, db);
    expect(rpc).toHaveBeenCalledWith('set_app_feedback', { p_id: 'r1', p_status: 'resolvido', p_note: null });
    expect(item.status).toBe('resolvido');
    await setAppFeedback({ id: 'r1', note: '' }, db);
    expect(rpc).toHaveBeenLastCalledWith('set_app_feedback', { p_id: 'r1', p_status: null, p_note: '' });
  });

  it('o recado que sumiu (P0002), a recusa (42501) e o banco sem a função', async () => {
    const gone = fakeDb({ data: null, error: { code: 'P0002', message: 'Este recado não existe mais.' } });
    const error = await setAppFeedback({ id: 'r1', status: 'lido' }, gone.db).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(FeedbackGone);
    expect((error as Error).message).toBe(FEEDBACK_GONE);
    const refusal = fakeDb({ data: null, error: { code: '42501', message: 'Este painel é só para quem mantém o app.' } });
    await expect(setAppFeedback({ id: 'r1', status: 'lido' }, refusal.db)).rejects.toBeInstanceOf(AppDashboardForbidden);
    await expect(setAppFeedback({ id: 'r1', status: 'lido' }, fakeDb(missing('set_app_feedback')).db)).rejects.toThrow(FEEDBACK_INBOX_NOT_READY);
  });
});

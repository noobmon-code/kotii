// POST { householdId, deleteIfLast?: boolean } -> { status: 'left' | 'deleted' }
//                                               | 409 { code: 'last_member' }
//                                               | 404 { code: 'not_member' }
// POST { drain: true } -> { done, failed }   (pg_cron, de hora em hora,
//                                               com o segredo x-cleanup-secret)
//
// Tira quem chamou da casa que ela confirmou. A regra fica em
// public.leave_household (roda como a pessoa, com RLS): o dono passa
// adiante; o último só apaga a casa se confirmou (deleteIfLast), senão volta
// 409 para o app perguntar; já não é dessa casa, 404.
// A casa apagada entra numa fila no banco; esta função apaga as fotos da
// fila com a service role, que o app não tem, a cada saída e no modo drain,
// chamado pelo agendamento. O drain só limpa casas que já foram apagadas, e
// só roda com o segredo do agendamento (cleanup_cron_secret, no Vault): a
// chave anon é pública e não basta.

import { createClient } from '@supabase/supabase-js';

import { ALLOWED_HEADERS, callerHeaders } from '../_shared/caller.ts';
import { sameSecret } from '../_shared/secret.ts';
import { type CleanupQueue, drainCleanupQueue } from './cleanup.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': ALLOWED_HEADERS,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método não suportado.' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const queue: CleanupQueue = {
    pending: async (limit) => {
      const { data: rows, error: queueError } = await admin
        .from('household_file_cleanup')
        .select('household_id, attempts')
        .order('attempts')
        .order('requested_at')
        .limit(limit);
      if (queueError) throw queueError;
      return (rows ?? []).map((row) => ({ householdId: row.household_id as string, attempts: row.attempts as number }));
    },
    done: async (householdId) => {
      await admin.from('household_file_cleanup').delete().eq('household_id', householdId);
    },
    failed: async (householdId, attempts) => {
      await admin.from('household_file_cleanup').update({ attempts }).eq('household_id', householdId);
    },
  };
  const drain = () => drainCleanupQueue(queue, (name) => admin.storage.from(name));

  const body = (await req.json().catch(() => null)) as { drain?: unknown; householdId?: unknown; deleteIfLast?: unknown } | null;
  if (body?.drain === true) {
    const { data: secret, error: secretError } = await admin.rpc('cleanup_config');
    if (secretError || typeof secret !== 'string' || !secret) {
      console.error('cleanup secret missing', secretError);
      return json({ error: 'Limpeza agendada não configurada.' }, 503);
    }
    if (!sameSecret(req.headers.get('x-cleanup-secret'), secret)) return json({ error: 'Não autorizado.' }, 401);
    const result = await drain().catch((err) => {
      console.error('cleanup queue failed', err);
      return null;
    });
    return result ? json({ done: result.done.length, failed: result.failed.length }) : json({ error: 'Falhou.' }, 500);
  }

  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!, {
    global: { headers: callerHeaders(req) },
  });
  const { data: userData } = await asUser.auth.getUser();
  if (!userData.user) return json({ error: 'Entre na sua conta para sair da casa.' }, 401);

  const householdId = typeof body?.householdId === 'string' ? body.householdId : null;
  if (!householdId) return json({ error: 'Diga de qual casa sair.' }, 400);
  const { data, error } = await asUser.rpc('leave_household', {
    p_household_id: householdId,
    p_delete_if_last: body?.deleteIfLast === true,
  });
  if (error) {
    if (error.code === 'P0002') return json({ error: 'Você já não está nessa casa.', code: 'not_member' }, 404);
    if (error.code === 'NK001') {
      return json({ error: 'Você é a última pessoa da casa: sair apaga a casa.', code: 'last_member' }, 409);
    }
    console.error('leave_household failed', error);
    return json({ error: 'Não deu para sair da casa agora. Tente de novo.' }, 500);
  }
  const { status } = data as { status: 'left' | 'deleted'; household_id: string };

  // Limpa as fotos da fila: a casa que acabou de ser apagada e alguma que
  // tenha falhado antes. A saída já valeu; a limpeza não muda a resposta
  // (o que sobrar, o agendamento pega).
  if (status === 'deleted') await drain().catch((err) => console.error('cleanup queue failed', err));
  return json({ status });
});

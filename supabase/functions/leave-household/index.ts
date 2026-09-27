// POST { deleteIfLast?: boolean } -> { status: 'left' | 'deleted' }
//                                  | 409 { code: 'last_member' }
//
// Tira quem chamou da casa. A regra fica em public.leave_household (roda
// como a pessoa, com RLS): o dono passa adiante; o último só apaga a casa
// se confirmou (deleteIfLast), senão volta 409 para o app perguntar.
// A casa apagada entra numa fila no banco; esta função apaga as fotos da
// fila com a service role, que o app não tem, e o que falhar fica lá para
// a próxima vez.

import { createClient } from '@supabase/supabase-js';

import { type CleanupQueue, drainCleanupQueue } from './cleanup.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: userData } = await asUser.auth.getUser();
  if (!userData.user) return json({ error: 'Entre na sua conta para sair da casa.' }, 401);

  const body = (await req.json().catch(() => null)) as { deleteIfLast?: unknown } | null;
  const { data, error } = await asUser.rpc('leave_household', { p_delete_if_last: body?.deleteIfLast === true });
  if (error) {
    if (error.code === 'P0002') return json({ error: 'Você não está em nenhuma casa.' }, 404);
    if (error.code === 'NK001') {
      return json({ error: 'Você é a última pessoa da casa: sair apaga a casa.', code: 'last_member' }, 409);
    }
    console.error('leave_household failed', error);
    return json({ error: 'Não deu para sair da casa agora. Tente de novo.' }, 500);
  }
  const { status } = data as { status: 'left' | 'deleted'; household_id: string };

  // Limpa as fotos da fila: a casa que acabou de ser apagada e alguma que
  // tenha falhado antes. A saída já valeu; a limpeza não muda a resposta.
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
  await drainCleanupQueue(queue, (name) => admin.storage.from(name)).catch((err) => console.error('cleanup queue failed', err));
  return json({ status });
});

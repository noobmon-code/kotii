// POST {} -> { status: 'left' | 'deleted' }
//
// Tira quem chamou da casa. A regra fica em public.leave_household (roda
// como a pessoa, com RLS): o dono passa adiante, o último apaga a casa.
// Só depois que o banco confirma que a casa foi apagada, esta função apaga
// as fotos dela com a service role, que o app não tem.

import { createClient } from '@supabase/supabase-js';

import { removeHouseholdFiles } from './cleanup.ts';

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

  const { data: membership } = await asUser
    .from('household_members')
    .select('household_id')
    .eq('user_id', userData.user.id)
    .maybeSingle();
  if (!membership) return json({ error: 'Você não está em nenhuma casa.' }, 404);

  const { data: status, error } = await asUser.rpc('leave_household');
  if (error) {
    console.error('leave_household failed', error);
    return json({ error: 'Não deu para sair da casa agora. Tente de novo.' }, 500);
  }

  if (status === 'deleted') {
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    // A casa já não existe: se a limpeza falhar, as fotos ficam órfãs e
    // inacessíveis (as policies exigem ser da casa), mas a saída vale.
    await removeHouseholdFiles((name) => admin.storage.from(name), membership.household_id).catch((err) =>
      console.error('file cleanup failed', membership.household_id, err),
    );
  }
  return json({ status });
});

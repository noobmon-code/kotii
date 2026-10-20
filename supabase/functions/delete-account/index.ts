// POST { password, deleteHouseholds: [ids] } -> { status: 'deleted', deletedHouseholds }
//   | 403 { code: 'wrong_password' } | 409 { code: 'last_member' | 'houses_changed' } | 429 { code: 'too_many_attempts' }
//   | 500/503 { code, error }
//
// Apaga a conta de quem chamou (Família → Conta → "Apagar minha conta"). A
// ordem e as respostas ficam em account.ts; aqui, só as partes que falam com
// o Supabase: a pessoa pelo token dela (auth.getUser), a senha num cliente à
// parte, sem guardar sessão, e o resto com a chave secreta, que o app não
// tem (delete_account_data só aceita essa chave; auth.admin.deleteUser
// também). A plataforma confere o token antes (verify_jwt = true).

import { createClient, isAuthApiError } from '@supabase/supabase-js';

import { publishableKey, secretKey } from '../_shared/apiKeys.ts';
import { ALLOWED_HEADERS, callerHeaders } from '../_shared/caller.ts';
import { drainHouseholdFiles } from '../_shared/householdFiles.ts';
import { deleteAccount, type DeleteAccountDeps, parseDeleteAccountRequest, type PasswordCheck } from './account.ts';

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

const NO_SESSION = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método não suportado.' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const asUser = createClient(url, publishableKey(), { global: { headers: callerHeaders(req) }, auth: NO_SESSION });
  const { data: userData } = await asUser.auth.getUser();
  const user = userData.user;
  if (!user) return json({ error: 'Entre na sua conta para apagá-la.' }, 401);

  const request = parseDeleteAccountRequest(await req.json().catch(() => null));
  if (!request) return json({ error: 'Digite a sua senha para apagar a conta.', code: 'bad_request' }, 400);

  const admin = createClient(url, secretKey(), { auth: NO_SESSION });
  const deps: DeleteAccountDeps = {
    countAttempt: async (userId) => {
      const { data, error } = await admin.rpc('count_account_deletion_attempt', { p_user_id: userId });
      if (error) throw error;
      return data === true;
    },
    clearAttempts: async (userId) => {
      const { error } = await admin.rpc('clear_account_deletion_attempts', { p_user_id: userId });
      if (error) throw error;
    },
    checkPassword: async (userId, email, password): Promise<PasswordCheck> => {
      // Um cliente só para conferir: a sessão que nasce aqui sai em seguida
      // (e, de todo jeito, some com o usuário).
      const verifier = createClient(url, publishableKey(), { auth: NO_SESSION });
      const { data, error } = await verifier.auth.signInWithPassword({ email, password });
      if (error) {
        if (error.code === 'invalid_credentials' || (!error.code && /invalid login credentials/i.test(error.message))) {
          return 'wrong';
        }
        if (error.status === 429 || error.code === 'over_request_rate_limit') return 'too_many';
        console.error('password check failed', error);
        return 'failed';
      }
      await verifier.auth.signOut({ scope: 'local' }).catch(() => undefined);
      return data.user?.id === userId ? 'ok' : 'failed';
    },
    deleteData: async (userId, deleteHouseholds) => {
      const { data, error } = await admin.rpc('delete_account_data', {
        p_user_id: userId,
        p_delete_households: deleteHouseholds,
      });
      if (error) throw error;
      const result = data as { deleted?: string[]; left?: string[] } | null;
      return { deleted: result?.deleted ?? [], left: result?.left ?? [] };
    },
    cleanFiles: async () => {
      await drainHouseholdFiles(admin);
    },
    deleteUser: async (userId) => {
      const { error } = await admin.auth.admin.deleteUser(userId);
      // Já apagado (outra tentativa chegou antes): feito.
      if (error && !(isAuthApiError(error) && (error.status === 404 || error.code === 'user_not_found'))) throw error;
    },
  };

  const reply = await deleteAccount({ id: user.id, email: user.email }, request, deps);
  return json(reply.body, reply.status);
});

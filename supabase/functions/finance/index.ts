// POST { action: 'sync', force?: boolean } -> { synced, skipped, errors: [{ connectionId, label, message }] }
// POST { action: 'add_item', itemId, label } -> { connectionId, sync: { synced, skipped, errors } }
//                                            | 404 (item não existe na Pluggy) | 409 (já é de outra pessoa ou casa)
//
// Consultor financeiro (beta): traz os extratos dos bancos (itens do
// MeuPluggy) para as tabelas privadas fin_*. Só para quem tem a liberação
// (beta_access) na casa aberta. Confere quem chamou com o token dela; grava
// com a chave de serviço (o app só lê), sempre presa à pessoa e à casa.
// Desconectar um banco é pelo app, na RPC fin_remove_connection.
//
// Secrets: PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET e FIN_DOC_HASH_KEY (segredo
// dos hashes de CPF/CNPJ; trocar depois desfaz o reconhecimento de
// transferência entre as próprias contas nos lançamentos antigos).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { publishableKey, secretKey } from '../_shared/apiKeys.ts';
import { ALLOWED_HEADERS, callerHeaders } from '../_shared/caller.ts';
import { createPluggyClient } from '../_shared/pluggy.ts';
import { addItem, errorForLog, type FinanceDb, parseFinanceRequest, type SyncDeps, syncAll } from './sync.ts';

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

/** Leitura paginada: o PostgREST corta em 1000 linhas. */
const PAGE = 1000;
/** Ids por update: a lista vai na URL. */
const MARK_CHUNK = 100;

/** fin_* pela chave de serviço, sempre filtrado pela pessoa e pela casa (menos a busca de duplicado). */
function financeDb(admin: SupabaseClient, userId: string, householdId: string): FinanceDb {
  return {
    async listConnections() {
      const { data, error } = await admin
        .from('fin_connections')
        .select('id, label, pluggy_item_id, last_synced_at, item_updated_at')
        .eq('user_id', userId)
        .eq('household_id', householdId)
        .order('created_at');
      if (error) throw error;
      return data ?? [];
    },
    async findConnectionByItem(itemId) {
      const { data, error } = await admin
        .from('fin_connections')
        .select('id, label, pluggy_item_id, last_synced_at, item_updated_at, user_id, household_id')
        .eq('pluggy_item_id', itemId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    async insertConnection(row) {
      const { data, error } = await admin
        .from('fin_connections')
        .insert({ ...row, user_id: userId, household_id: householdId })
        .select('id')
        .single();
      if (error?.code === '23505') return 'conflict';
      if (error) throw error;
      return data;
    },
    async updateConnection(id, patch) {
      const { error } = await admin
        .from('fin_connections')
        .update(patch)
        .eq('id', id)
        .eq('user_id', userId)
        .eq('household_id', householdId);
      if (error) throw error;
    },
    async upsertAccounts(rows) {
      const { data, error } = await admin
        .from('fin_accounts')
        .upsert(rows, { onConflict: 'pluggy_account_id' })
        .select('id, pluggy_account_id');
      if (error) throw error;
      return data ?? [];
    },
    async upsertTransactions(rows) {
      const { error } = await admin.from('fin_transactions').upsert(rows, { onConflict: 'pluggy_transaction_id' });
      if (error) throw error;
    },
    async activeTransactionIds(accountId, fromDate) {
      const ids: string[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await admin
          .from('fin_transactions')
          .select('pluggy_transaction_id')
          .eq('account_id', accountId)
          .eq('user_id', userId)
          .eq('household_id', householdId)
          .is('deleted_at', null)
          .gte('occurred_on', fromDate)
          .order('pluggy_transaction_id')
          .range(from, from + PAGE - 1);
        if (error) throw error;
        ids.push(...(data ?? []).map((row) => row.pluggy_transaction_id as string));
        if ((data ?? []).length < PAGE) return ids;
      }
    },
    async markDeleted(accountId, pluggyIds, at) {
      for (let i = 0; i < pluggyIds.length; i += MARK_CHUNK) {
        const { error } = await admin
          .from('fin_transactions')
          .update({ deleted_at: at, updated_at: at })
          .eq('account_id', accountId)
          .eq('user_id', userId)
          .eq('household_id', householdId)
          .is('deleted_at', null)
          .in('pluggy_transaction_id', pluggyIds.slice(i, i + MARK_CHUNK));
        if (error) throw error;
      }
    },
    async purgeDeleted(accountId, before) {
      const { error } = await admin
        .from('fin_transactions')
        .delete()
        .eq('account_id', accountId)
        .eq('user_id', userId)
        .eq('household_id', householdId)
        .lt('deleted_at', before);
      if (error) throw error;
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método não suportado.' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  // Com a chave pública e o token de quem chamou: só segue quem está logado.
  const db = createClient(url, publishableKey(), {
    global: { headers: callerHeaders(req) },
  });
  const { data: userData } = await db.auth.getUser();
  const user = userData.user;
  if (!user) return json({ error: 'Entre na sua conta para usar o consultor financeiro.' }, 401);

  // Liberação e casa vêm do banco, na casa aberta no aparelho (x-household-id).
  const { data: allowed, error: betaError } = await db.rpc('has_beta', { p_feature: 'finance' });
  if (betaError) {
    console.error('has_beta failed', betaError);
    return json({ error: 'Não consegui conferir a liberação agora. Tente de novo.' }, 503);
  }
  if (allowed !== true) return json({ error: 'O consultor financeiro não está liberado para você nesta casa.' }, 403);

  const clientId = Deno.env.get('PLUGGY_CLIENT_ID')?.trim();
  const clientSecret = Deno.env.get('PLUGGY_CLIENT_SECRET')?.trim();
  if (!clientId || !clientSecret) {
    return json({ error: 'Pluggy não configurada: cadastre PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET nos secrets do Supabase.' }, 503);
  }
  // Sem o segredo, o hash do CPF seria um SHA-256 que se desfaz testando os CPFs possíveis.
  const hashKey = Deno.env.get('FIN_DOC_HASH_KEY')?.trim();
  if (!hashKey || hashKey.length < 32) {
    return json({ error: 'Falta o segredo FIN_DOC_HASH_KEY (32 caracteres ou mais) nos secrets do Supabase.' }, 503);
  }

  const request = parseFinanceRequest(await req.json().catch(() => null));
  if (typeof request === 'string') return json({ error: request }, 400);

  const { data: householdId, error: householdError } = await db.rpc('current_household_id');
  if (householdError || typeof householdId !== 'string') {
    console.error('current_household_id failed', householdError);
    return json({ error: 'Não consegui abrir a sua casa agora. Tente de novo.' }, 503);
  }

  const admin = createClient(url, secretKey());
  const deps: SyncDeps = {
    db: financeDb(admin, user.id, householdId),
    pluggy: createPluggyClient({ clientId, clientSecret }),
    userId: user.id,
    householdId,
    hashKey,
    now: () => new Date(),
  };

  try {
    if (request.action === 'sync') return json(await syncAll(deps, request.force));
    const added = await addItem(deps, request);
    if (!added.ok) return json({ error: added.error }, added.status);
    return json({ connectionId: added.connectionId, sync: added.sync });
  } catch (err) {
    console.error('finance failed', request.action, errorForLog(err));
    return json({ error: 'Não consegui atualizar os bancos agora. Tente de novo.' }, 500);
  }
});

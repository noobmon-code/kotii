// O caminho de um pedido ao consultor, com o que vem de fora injetado (banco,
// IA, devolução do limite) para dar para testar a ordem das portas:
// login (401) -> liberação do beta (403) -> chave da IA (503) -> pedido (400)
// -> limite do mês (429) -> IA. Sem a liberação, nada de limite gasto nem IA.

import { type AiTicket, QuotaError, takeAiQuota } from '../_shared/aiQuota.ts';
import { ALLOWED_HEADERS } from '../_shared/caller.ts';
import type { ChatInput } from '../_shared/chat.ts';
import { ExtractionError, type VisionConfig } from '../_shared/vision.ts';
import { buildSystem, cleanReply, type FinanceReplyRaw, FinanceReplySchema, parseRequest } from './advisor.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': ALLOWED_HEADERS,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const NOT_ALLOWED_MESSAGE = 'O consultor financeiro não está liberado para você nesta casa.';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/** O pedaço do cliente do Supabase que o consultor usa. */
export interface CallerClient {
  auth: { getUser(): PromiseLike<{ data: { user: unknown } }> };
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

export interface FinanceChatDeps {
  /** Cliente agindo como quem chamou, na casa aberta no aparelho (RLS, has_beta, use_ai). */
  callerClient(req: Request): CallerClient;
  /** Configuração da IA, ou a mensagem de erro quando falta a chave (ver config.ts). */
  config: VisionConfig | string;
  chat(input: ChatInput<typeof FinanceReplySchema>): Promise<FinanceReplyRaw>;
  refund(ticket: AiTicket): Promise<void>;
}

export function financeChatHandler(deps: FinanceChatDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'Método não suportado.' }, 405);

    // A chave anon também é um JWT válido: só conversa quem está logado.
    const db = deps.callerClient(req);
    const { data: userData } = await db.auth.getUser();
    if (!userData.user) return json({ error: 'Entre na sua conta para falar com o consultor.' }, 401);

    // Liberação por pessoa e por casa; se não deu para conferir, fecha.
    const { data: allowed, error: betaError } = await db.rpc('has_beta', { p_feature: 'finance' });
    if (betaError) {
      console.error('has_beta failed', betaError);
      return json({ error: 'Não consegui conferir a liberação do consultor agora. Tente de novo.' }, 503);
    }
    if (allowed !== true) return json({ error: NOT_ALLOWED_MESSAGE }, 403);

    const config = deps.config;
    if (typeof config === 'string') return json({ error: config }, 503);

    const parsed = parseRequest(await req.json().catch(() => null));
    if (typeof parsed === 'string') return json({ error: parsed }, 400);

    let ticket: AiTicket;
    try {
      ticket = await takeAiQuota(db, 'finance');
    } catch (err) {
      if (err instanceof QuotaError) return json({ error: err.message }, err.status);
      throw err;
    }
    try {
      const raw = await deps.chat({
        config,
        schema: FinanceReplySchema,
        schemaName: 'finance_reply',
        system: buildSystem(parsed.context, parsed.today),
        turns: parsed.turns,
      });
      return json(cleanReply(raw));
    } catch (err) {
      // Recusa ou resposta longa demais (422) contam: a IA trabalhou.
      if (!(err instanceof ExtractionError && err.status === 422)) await deps.refund(ticket);
      if (err instanceof ExtractionError) return json({ error: err.message }, err.status);
      // Só o erro vai para o log: nada do retrato nem da conversa.
      console.error('nuke-finance failed', err);
      return json({ error: 'Não consegui responder agora. Tente de novo.' }, 500);
    }
  };
}

// POST { messages: [{ role, text }], context, today } -> { reply, actions }
//
// O Nuke consultor financeiro (beta): conversa sobre orçamento, gastos, fluxo
// de caixa e dívidas com a pessoa liberada em beta_access, na casa aberta. O
// app manda o retrato financeiro já calculado (a IA não faz conta) e o
// histórico, que só existe na memória do aparelho. As ações voltam como
// sugestão: quem executa é o app, depois do toque da pessoa.
//
// Secrets: ANTHROPIC_API_KEY (obrigatório; nunca usa a OpenRouter) e
// FINANCE_MODEL opcional (padrão claude-haiku-5-5). Cada mensagem conta no
// limite mensal 'finance' (use_ai), que só vale com a liberação.

import { createClient } from '@supabase/supabase-js';

import { refundAiQuota } from '../_shared/aiQuota.ts';
import { publishableKey } from '../_shared/apiKeys.ts';
import { callerHeaders } from '../_shared/caller.ts';
import { chatStructured } from '../_shared/chat.ts';
import { financeConfig } from './config.ts';
import { financeChatHandler } from './handler.ts';

Deno.serve(
  financeChatHandler({
    callerClient: (req) =>
      createClient(Deno.env.get('SUPABASE_URL')!, publishableKey(), { global: { headers: callerHeaders(req) } }),
    config: financeConfig(),
    chat: chatStructured,
    refund: (ticket) => refundAiQuota(ticket),
  }),
);

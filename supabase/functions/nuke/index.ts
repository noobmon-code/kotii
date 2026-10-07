// POST { messages: [{ role, text }], context, today } -> { reply, actions }
// POST { mode: 'menu', context, today, weekStart, preferences } -> { days, shopping, note }
//
// O Nuke conversa sobre a casa. O app manda o retrato da casa (montado com os
// dados que a própria pessoa já vê, via RLS) e o histórico recente; a função
// só guarda a chave da IA. As ações voltam como sugestão: quem executa é o
// app, depois do toque da pessoa.
//
// Secrets: ANTHROPIC_API_KEY ou OPENROUTER_API_KEY; NUKE_PROVIDER e
// NUKE_MODEL opcionais (sem eles, valem RECEIPT_PROVIDER e RECEIPT_MODEL).
// Cada mensagem e cada cardápio contam no limite mensal de IA da casa (use_ai).

import { createClient } from '@supabase/supabase-js';

import { QuotaError, refundAiQuota, takeAiQuota } from '../_shared/aiQuota.ts';
import { publishableKey } from '../_shared/apiKeys.ts';
import { chatStructured } from '../_shared/chat.ts';
import { ExtractionError, visionConfig } from '../_shared/vision.ts';
import { ALLOWED_HEADERS, callerHeaders } from '../_shared/caller.ts';
import {
  buildMenuSystem,
  buildSystem,
  cleanMenu,
  cleanReply,
  MenuSchema,
  NukeReplySchema,
  parseMenuRequest,
  parseRequest,
} from './nuke.ts';

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

const config = visionConfig(['NUKE', 'RECEIPT']);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método não suportado.' }, 405);

  // A plataforma também deixa passar a chave pública no lugar do token: só
  // conversa quem está logado.
  const db = createClient(Deno.env.get('SUPABASE_URL')!, publishableKey(), { global: { headers: callerHeaders(req) } });
  const { data: userData } = await db.auth.getUser();
  if (!userData.user) return json({ error: 'Entre na sua conta para falar com o Nuke.' }, 401);

  const body = await req.json().catch(() => null);
  if ((body as { mode?: unknown } | null)?.mode === 'menu') {
    const menu = parseMenuRequest(body);
    if (typeof menu === 'string') return json({ error: menu }, 400);
    let ticket;
    try {
      ticket = await takeAiQuota(db, 'menu');
    } catch (err) {
      if (err instanceof QuotaError) return json({ error: err.message }, err.status);
      throw err;
    }
    try {
      const raw = await chatStructured({
        config,
        schema: MenuSchema,
        schemaName: 'nuke_menu',
        system: buildMenuSystem(menu.context, menu.today, menu.weekStart),
        turns: [{ role: 'user', text: menu.preferences || 'Monte o cardápio da semana.' }],
      });
      return json(cleanMenu(raw, menu.weekStart));
    } catch (err) {
      if (!(err instanceof ExtractionError && err.status === 422)) await refundAiQuota(ticket);
      if (err instanceof ExtractionError) return json({ error: err.message }, err.status);
      console.error('nuke menu failed', err);
      return json({ error: 'Não consegui montar o cardápio agora. Tente de novo.' }, 500);
    }
  }

  const parsed = parseRequest(body);
  if (typeof parsed === 'string') return json({ error: parsed }, 400);

  let ticket;
  try {
    ticket = await takeAiQuota(db, 'chat');
  } catch (err) {
    if (err instanceof QuotaError) return json({ error: err.message }, err.status);
    throw err;
  }
  try {
    const raw = await chatStructured({
      config,
      schema: NukeReplySchema,
      schemaName: 'nuke_reply',
      system: buildSystem(parsed.context, parsed.today),
      turns: parsed.turns,
    });
    return json(cleanReply(raw, parsed.today));
  } catch (err) {
    if (!(err instanceof ExtractionError && err.status === 422)) await refundAiQuota(ticket);
    if (err instanceof ExtractionError) return json({ error: err.message }, err.status);
    console.error('nuke failed', err);
    return json({ error: 'Não consegui responder agora. Tente de novo.' }, 500);
  }
});

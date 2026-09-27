// POST { messages: [{ role, text }], context, today } -> { reply, actions }
//
// O Nuke conversa sobre a casa. O app manda o retrato da casa (montado com os
// dados que a própria pessoa já vê, via RLS) e o histórico recente; a função
// só guarda a chave da IA. As ações voltam como sugestão: quem executa é o
// app, depois do toque da pessoa.
//
// Secrets: ANTHROPIC_API_KEY ou OPENROUTER_API_KEY. Com a chave da
// OpenRouter, o modelo é o DeepSeek V4.1 Flash (ver nukeConfig); NUKE_MODEL
// e NUKE_PROVIDER trocam.

import { createClient } from '@supabase/supabase-js';

import { chatStructured } from '../_shared/chat.ts';
import { ExtractionError } from '../_shared/vision.ts';
import { buildSystem, cleanReply, nukeConfig, NukeReplySchema, parseRequest } from './nuke.ts';

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

const config = nukeConfig();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método não suportado.' }, 405);

  // A chave anon também é um JWT válido: só conversa quem está logado.
  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
  );
  const { data: userData } = await db.auth.getUser();
  if (!userData.user) return json({ error: 'Entre na sua conta para falar com o Nuke.' }, 401);

  const parsed = parseRequest(await req.json().catch(() => null));
  if (typeof parsed === 'string') return json({ error: parsed }, 400);

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
    if (err instanceof ExtractionError) return json({ error: err.message }, err.status);
    console.error('nuke failed', err);
    return json({ error: 'Não consegui responder agora. Tente de novo.' }, 500);
  }
});

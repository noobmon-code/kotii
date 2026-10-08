// POST { url } -> NfcePage (mercado, data, total e itens da NFC-e)
//
// Busca a consulta pública da NFC-e (o link do QR code da nota) e devolve os
// itens, sem IA. Existe porque o navegador não deixa o app buscar a página
// da Sefaz direto. A busca (sefaz.ts) só faz GET em domínios .gov.br e para
// em CAPTCHA: Sefaz que pedem CAPTCHA (como a da Paraíba) respondem 422
// `captcha` e o app manda a pessoa para a foto. Quem cria o rascunho de nota
// é o app. Cada leitura conta no limite mensal da casa (use_ai, tipo nfce);
// quando ela volta está em reply.ts. Os logs nunca levam a chave, itens,
// preços ou CPF/CNPJ: só host + caminho e a estrutura das páginas.

import { createClient } from '@supabase/supabase-js';

import { QuotaError, refundAiQuota, takeAiQuota } from '../_shared/aiQuota.ts';
import { publishableKey } from '../_shared/apiKeys.ts';
import { ALLOWED_HEADERS, callerHeaders } from '../_shared/caller.ts';
import { safeLocation } from './page.ts';
import { isSefazUrl } from './parse.ts';
import { replyFor } from './reply.ts';
import { lookupNfce } from './sefaz.ts';

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

  const db = createClient(Deno.env.get('SUPABASE_URL')!, publishableKey(), {
    global: { headers: callerHeaders(req) },
  });
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return json({ error: 'Entre na sua conta para ler a nota.' }, 401);

  const body = (await req.json().catch(() => null)) as { url?: unknown } | null;
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  if (!isSefazUrl(url)) return json({ error: 'Esse QR code não é de uma nota fiscal (NFC-e) da Sefaz.' }, 400);

  let ticket;
  try {
    ticket = await takeAiQuota(db, 'nfce');
  } catch (err) {
    if (err instanceof QuotaError) return json({ error: err.message }, err.status);
    throw err;
  }

  const result = await lookupNfce(url);
  const reply = replyFor(result, url);
  const where = safeLocation(url);
  if (result.kind === 'ok') {
    console.log('nfce read', where, result.page.items.length);
  } else {
    // Sefaz fora do ar, CAPTCHA, nota não autorizada ou leiaute que o leitor
    // não conhece: o resumo mostra só a estrutura das páginas.
    const log = result.kind === 'down' ? console.error : console.warn;
    log(`nfce ${result.kind}`, where, JSON.stringify(result.trace));
  }
  if (reply.refund) await refundAiQuota(ticket);
  return json(reply.body, reply.status);
});

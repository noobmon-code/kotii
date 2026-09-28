// POST { url } -> NfcePage (mercado, data, total e itens da NFC-e)
//
// Busca a consulta pública da NFC-e (o link do QR code da nota) e devolve os
// itens, sem IA. Existe porque o navegador não deixa o app buscar a página
// da Sefaz direto. Só busca em domínios .gov.br, inclusive nos
// redirecionamentos. Quem cria o rascunho de nota é o app.

import { createClient } from '@supabase/supabase-js';

import { isSefazUrl, parseNfceHtml } from './parse.ts';

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

const MAX_BYTES = 3_000_000;
const MAX_REDIRECTS = 4;

/** Segue redirecionamentos à mão, só para outros endereços de Sefaz. */
async function fetchSefaz(start: string): Promise<Response> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
    });
    const location = response.headers.get('location');
    if (response.status < 300 || response.status >= 400 || !location) return response;
    await response.body?.cancel();
    url = new URL(location, url).toString();
    if (!isSefazUrl(url)) throw new Error(`redirect outside Sefaz: ${url}`);
  }
  throw new Error('too many redirects');
}

/** Até MAX_BYTES do corpo, sem guardar o resto na memória. */
async function readCapped(response: Response): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  await reader.cancel().catch(() => undefined);
  const bytes = new Uint8Array(Math.min(size, MAX_BYTES));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, bytes.length - offset);
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

/** Corpo em texto, respeitando o charset (várias Sefaz usam ISO-8859-1). */
async function readHtml(response: Response): Promise<string> {
  const bytes = await readCapped(response);
  const header = response.headers.get('content-type') ?? '';
  const sniff = new TextDecoder('latin1').decode(bytes.slice(0, 2048));
  const charset = (header.match(/charset=([\w-]+)/i) ?? sniff.match(/charset=["']?([\w-]+)/i))?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(charset.toLowerCase()).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método não suportado.' }, 405);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return json({ error: 'Entre na sua conta para ler a nota.' }, 401);

  const body = (await req.json().catch(() => null)) as { url?: unknown } | null;
  const url = typeof body?.url === 'string' ? body.url.trim() : '';
  if (!isSefazUrl(url)) return json({ error: 'Esse QR code não é de uma nota fiscal (NFC-e) da Sefaz.' }, 400);

  let html: string;
  try {
    const response = await fetchSefaz(url);
    if (!response.ok) {
      console.error('sefaz status', response.status, url);
      return json({ error: 'A Sefaz não respondeu agora. Tente de novo em alguns minutos ou tire foto da nota.', code: 'sefaz_down' }, 502);
    }
    html = await readHtml(response);
  } catch (err) {
    console.error('sefaz fetch failed', url, err);
    return json({ error: 'A Sefaz não respondeu agora. Tente de novo em alguns minutos ou tire foto da nota.', code: 'sefaz_down' }, 502);
  }

  const page = parseNfceHtml(html);
  if (!page.items.length) {
    // Página de verificação ("não sou robô"), nota ainda não autorizada ou
    // leiaute que o leitor não conhece.
    console.warn('no items parsed', url, html.length);
    return json(
      { error: 'A Sefaz não mostrou os itens desta nota. Tente de novo mais tarde ou tire foto da nota.', code: 'no_items' },
      422,
    );
  }
  return json(page);
});

// Busca a nota na Sefaz a partir do link do QR, só com GET e só em domínios
// .gov.br: segue redirecionamentos HTTP, meta refresh e redirecionamentos
// simples em JavaScript, com limite de saltos, de tempo e de tamanho. Não
// guarda cookies, não envia formulários e não abre iframes. Se a página pede
// CAPTCHA, para ali; o ATF da Paraíba (a consulta com CAPTCHA e o que vem
// depois dele) nunca é buscado, em nenhuma grafia do endereço, nem o link do
// QR (isCaptchaGated, antes de cada pedido). O `fetch` é injetado para os
// testes (sefaz.test.ts) não usarem rede.

import { type NfcePage, isSefazUrl, parseNfceHtml } from './parse.ts';
import { decodeHtml, describePage, type Fetched, isCaptchaGated, nextHop, type PageSummary, safeLocation } from './page.ts';

const MAX_BYTES = 3_000_000;
const MAX_REDIRECTS = 4;
/** Saltos de página (meta refresh, JavaScript) depois da página do QR. */
const MAX_PAGE_HOPS = 3;
const REQUEST_TIMEOUT = 15_000;
/** Tempo total da leitura, somando todas as buscas. */
const BUDGET = 45_000;

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
  'Accept-Language': 'pt-BR,pt;q=0.9',
};

export type TraceEntry =
  | PageSummary
  /** Busca que falhou (rede, tempo, status de erro, saída de .gov.br). */
  | { step: string; error: string }
  /** Endereço que pede CAPTCHA, reconhecido antes de buscar (host + caminho). */
  | { step: string; captchaGate: string };

export type Lookup =
  | { kind: 'ok'; page: NfcePage }
  /** A página pede CAPTCHA (ou leva ao ATF da PB): nada foi lido. */
  | { kind: 'captcha'; trace: TraceEntry[] }
  /** A página final (a que não leva a outra) respondeu 2xx, mas sem itens nem CAPTCHA. */
  | { kind: 'empty'; trace: TraceEntry[] }
  /**
   * Nenhuma página final respondeu 2xx: rede, tempo, status de erro, saída de
   * .gov.br, ou só páginas de redirecionamento (um salto que falhou, laço,
   * saltos demais).
   */
  | { kind: 'down'; trace: TraceEntry[] };

type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

/** Mensagem de erro sem endereços completos nem números longos (a chave pode estar na URL). */
export function safeError(err: unknown): string {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return text
    .replace(/https?:\/\/[^\s)'"<>]+/gi, (url) => safeLocation(url))
    .replace(/\d{4,}/g, '#')
    .slice(0, 200);
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

/**
 * GET de uma página, seguindo os redirecionamentos HTTP só para .gov.br.
 * Para antes de buscar um endereço do ATF da PB (`gate`), também o primeiro.
 */
async function get(fetchFn: FetchFn, start: string, deadline: number, referer?: string): Promise<{ page: Fetched } | { gate: string }> {
  let url = start;
  const redirects: string[] = [];
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (isCaptchaGated(url)) return { gate: url };
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('time budget exhausted');
    const response = await fetchFn(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT, remaining)),
      headers: referer ? { ...BASE_HEADERS, 'Referer': referer } : { ...BASE_HEADERS },
    });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      const next = new URL(location, url).toString();
      if (!isSefazUrl(next)) throw new Error(`redirect outside Sefaz: ${safeLocation(next)}`);
      redirects.push(safeLocation(url));
      url = next;
      continue;
    }
    const bytes = await readCapped(response);
    const contentType = response.headers.get('content-type');
    const challenge = (response.headers.get('cf-mitigated') ?? '').trim().toLowerCase() === 'challenge';
    return { page: { status: response.status, url, contentType, bytes: bytes.length, html: decodeHtml(bytes, contentType), redirects, challenge } };
  }
  throw new Error('too many redirects');
}

function ok(page: Fetched): boolean {
  return page.status >= 200 && page.status < 300;
}

/**
 * Lê a nota do link do QR (já validado com isSefazUrl). `trace` resume cada
 * página buscada sem dados da nota, para o log quando não saem itens.
 */
export async function lookupNfce(qrUrl: string, fetchFn: FetchFn = fetch, budget = BUDGET): Promise<Lookup> {
  const deadline = Date.now() + budget;
  const trace: TraceEntry[] = [];
  const visited = new Set<string>();
  let url = qrUrl;
  let referer: string | undefined;
  try {
    for (let hop = 0; hop <= MAX_PAGE_HOPS; hop++) {
      const step = hop === 0 ? 'qr' : `salto-${hop}`;
      visited.add(url);
      const got = await get(fetchFn, url, deadline, referer);
      if ('gate' in got) {
        trace.push({ step, captchaGate: safeLocation(got.gate) });
        return { kind: 'captcha', trace };
      }
      const { page } = got;
      const summary = describePage(step, page);
      trace.push(summary);
      if (ok(page)) {
        const parsed = parseNfceHtml(page.html);
        if (parsed.items.length) return { kind: 'ok', page: parsed };
      }
      // Sem itens e com CAPTCHA (mesmo num 403 de verificação): para aqui,
      // sem seguir nada desta página.
      if (summary.captcha) return { kind: 'captcha', trace };
      if (!ok(page)) throw new Error(`status ${page.status}`);
      const next = nextHop(page.html, page.url);
      // Página final (não leva a outra) com 2xx, sem itens nem CAPTCHA: a
      // Sefaz respondeu (`empty`, a leitura conta). Página que só redireciona
      // não basta: se o salto seguinte falha, é `down` (a leitura volta).
      if (!next) return { kind: 'empty', trace };
      if (visited.has(next)) throw new Error('page loop');
      if (hop === MAX_PAGE_HOPS) throw new Error('too many page hops');
      referer = page.url;
      url = next;
    }
  } catch (err) {
    trace.push({ step: 'erro', error: safeError(err) });
  }
  return { kind: 'down', trace };
}

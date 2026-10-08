// Páginas da Sefaz que não trazem os itens direto: achar o próximo endereço
// (meta refresh ou JavaScript simples), reconhecer CAPTCHA e resumir a página
// para o log. O resumo é só estrutura (status, host + caminho, tipo, tamanho,
// contagens, hosts, sim/não): nunca textos da página, nomes ou valores de
// campos, query, itens, preços, nomes, CPF/CNPJ ou a chave. Sem rede:
// testado em page.test.ts.

import { decodeEntities, isSefazUrl } from './parse.ts';

/** Uma resposta já lida da Sefaz (depois dos redirecionamentos HTTP). */
export interface Fetched {
  status: number;
  /** Endereço final, depois dos redirecionamentos. */
  url: string;
  contentType: string | null;
  bytes: number;
  html: string;
  /** Endereços (host + caminho) por onde os redirecionamentos passaram. */
  redirects: string[];
  /** A resposta veio com `cf-mitigated: challenge` (verificação da Cloudflare). */
  challenge: boolean;
}

/** Resumo de uma página para o log: só estrutura, nenhum texto livre. */
export interface PageSummary {
  step: string;
  status: number;
  /** Host + caminho, sem query. */
  url: string;
  /** Tipo do conteúdo (e o charset), se tiver o formato esperado. */
  type: string | null;
  bytes: number;
  /** Host + caminho de cada redirecionamento HTTP no caminho. */
  redirects: string[];
  forms: number;
  /** Iframes e frames. */
  iframes: number;
  scripts: number;
  /** Campos de formulário (input, select, textarea, button). */
  inputs: number;
  /** Host + caminho para onde os formulários enviam. */
  formActions: string[];
  /** Hosts dos iframes e frames. */
  frameHosts: string[];
  /** Hosts dos scripts externos. */
  scriptHosts: string[];
  /** Host + caminho do meta refresh. */
  refresh: string | null;
  captcha: boolean;
  /** Tem frameset, frame ou iframe. */
  frames: boolean;
  /** Tem redirecionamento em JavaScript que roda ao abrir. */
  jsRedirect: boolean;
}

/** Atributos de uma tag (`<iframe id=x src='y'>` -> {id: 'x', src: 'y'}), nomes em minúsculas. */
export function attributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const body = tag.replace(/^<\s*[\w:-]+/, '').replace(/\/?\s*>$/, '');
  for (const m of body.matchAll(/([^\s="'\/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g)) {
    const name = m[1].toLowerCase();
    if (!(name in attrs)) attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

/** Todas as tags de um tipo, com a posição no HTML e os atributos. */
export function tagsOf(html: string, name: string): { index: number; end: number; attrs: Record<string, string> }[] {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((m) => ({
    index: m.index!,
    end: m.index! + m[0].length,
    attrs: attributes(m[0]),
  }));
}

export interface Script {
  attrs: Record<string, string>;
  code: string;
}

/**
 * Separa o HTML vivo dos scripts, na ordem em que o navegador lê: um
 * comentário que começa antes engole o que vier dentro dele (até um script
 * comentado); um script que começa antes guarda o `<!--` de dentro, que no
 * JavaScript antigo é só um marcador. Sem fechamento, vai até o fim (como no
 * navegador, e sem varrer o resto de novo a cada abertura).
 */
export function splitScripts(html: string): { markup: string; scripts: Script[] } {
  const scripts: Script[] = [];
  const markup = html.replace(
    /<!--[\s\S]*?(?:-->|$)|<script\b([^>]*)>([\s\S]*?)(?:<\/script\s*>|$)/gi,
    (_match, attrs: string | undefined, code: string | undefined) => {
      if (attrs !== undefined) scripts.push({ attrs: attributes(`<script ${attrs}>`), code: code ?? '' });
      return ' ';
    },
  );
  return { markup, scripts };
}

/** Endereço absoluto, ou null se não der para montar. */
function resolve(raw: string, base: string): string | null {
  const value = raw.trim();
  if (!value || /^(javascript|about|data|mailto):/i.test(value)) return null;
  try {
    const url = new URL(value, base);
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function metaRefresh(markup: string): string | null {
  for (const { attrs } of tagsOf(markup, 'meta')) {
    if ((attrs['http-equiv'] ?? '').toLowerCase() !== 'refresh') continue;
    const target = (attrs.content ?? '').match(/url\s*=\s*['"]?([^'"]+)/i)?.[1];
    if (target) return target;
  }
  return null;
}

/** Posição da `}` que fecha a `{` em `open`, pulando textos entre aspas; o fim, se não fechar. */
function matchingBrace(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < code.length && code[i] !== c; i++) if (code[i] === '\\') i++;
    } else if (c === '{') {
      depth++;
    } else if (c === '}' && --depth === 0) {
      return i;
    }
  }
  return code.length - 1;
}

// Funções passadas para rodar ao carregar (ou logo depois) rodam sozinhas;
// as demais (`function voltar() {...}`, um onclick) só se alguém chamar.
const RUNS_BY_ITSELF = /(?:setTimeout\s*\(|onload\s*=|addEventListener\s*\(\s*['"](?:load|DOMContentLoaded)['"]\s*,|\$\(|\.ready\s*\()\s*$/;

/** O código sem o corpo das funções que não rodam sozinhas. */
function withoutDeferredFunctions(code: string): string {
  const starts = /\bfunction\b[^{;]{0,200}\{|=>\s*\{/g;
  let out = '';
  let from = 0;
  for (let m = starts.exec(code); m; m = starts.exec(code)) {
    const open = m.index + m[0].length - 1;
    // O que vem antes da função; numa arrow, antes dos parâmetros dela.
    let before = code.slice(Math.max(0, m.index - 120), m.index);
    if (m[0].startsWith('=>')) before = before.replace(/(?:\([^()]*\)|[\w$]+)\s*$/, '');
    // Roda sozinha: o corpo fica (e as funções de dentro são vistas a seguir).
    if (RUNS_BY_ITSELF.test(before)) continue;
    const close = matchingBrace(code, open);
    out += code.slice(from, m.index) + ' ';
    from = close + 1;
    starts.lastIndex = from;
  }
  return out + code.slice(from);
}

/**
 * O código sem comentários. `//` e os de bloco dentro de textos entre aspas
 * ficam ("https://host//atf"); no JavaScript dentro do HTML, `<!--` comenta o
 * resto da linha, e `-->` no começo da linha também.
 */
function withoutComments(source: string): string {
  const code = source.replace(/<!--.*$/gm, ' ').replace(/^\s*-->.*$/gm, ' ');
  const parts: string[] = [];
  let from = 0;
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === '"' || c === "'" || c === '`') {
      // Texto: até a mesma aspa (ou o fim da linha, fora do `), pulando os escapes.
      for (i++; i < code.length && code[i] !== c && (c === '`' || code[i] !== '\n'); i++) if (code[i] === '\\') i++;
      i++;
    } else if (c === '\\') {
      // Escape fora de texto (numa expressão regular, `\/\/`): não abre comentário.
      i += 2;
    } else if (c === '/' && (code[i + 1] === '/' || code[i + 1] === '*')) {
      const block = code[i + 1] === '*';
      const close = block ? code.indexOf('*/', i + 2) : code.indexOf('\n', i + 2);
      parts.push(code.slice(from, i), ' ');
      i = close < 0 ? code.length : block ? close + 2 : close;
      from = i;
    } else {
      i++;
    }
  }
  parts.push(code.slice(from));
  return parts.join('');
}

/** O JavaScript que roda ao abrir a página: sem comentários nem funções guardadas para depois. */
function liveCode(code: string): string {
  return withoutDeferredFunctions(withoutComments(code));
}

/** `location = '...'`, `location.href = "..."`, `location.replace('...')`; só texto literal. */
function scriptRedirect(markup: string, scripts: Script[]): string | null {
  const inline = scripts.filter(({ attrs }) => !('src' in attrs)).map(({ code }) => code);
  const onload = tagsOf(markup, 'body').map(({ attrs }) => attrs.onload ?? '');
  for (const code of [...inline, ...onload]) {
    const live = liveCode(code);
    const assign = live.match(/\blocation(?:\.href)?\s*=\s*(['"])([^'"]+)\1/);
    if (assign) return assign[2];
    const call = live.match(/\blocation\.(?:replace|assign)\(\s*(['"])([^'"]+)\1\s*\)/);
    if (call) return call[2];
  }
  return null;
}

/**
 * Próximo endereço de uma página sem itens: o meta refresh ou, sem ele, um
 * redirecionamento em JavaScript simples que roda ao abrir. Só endereços de
 * Sefaz (.gov.br), nunca a própria página; iframes, formulários e links não
 * são seguidos. null se não houver.
 */
export function nextHop(html: string, base: string): string | null {
  const { markup, scripts } = splitScripts(html);
  const current = resolve(base, base);
  for (const raw of [metaRefresh(markup), scriptRedirect(markup, scripts)]) {
    const url = raw ? resolve(raw, base) : null;
    if (url && isSefazUrl(url) && url !== current) return url;
  }
  return null;
}

/** Decodifica %XX, de novo enquanto mudar (até 4 vezes); um `%` solto fica como está. */
function percentDecode(text: string): string {
  let out = text;
  for (let i = 0; i < 4; i++) {
    const next = out.replace(/%([0-9a-f]{2})/gi, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * Caminho como o servidor o entende, em minúsculas: %XX decodificado, `\`
 * como `/`, sem `;parâmetros` (o `;jsessionid=` do Tomcat), barras repetidas
 * juntadas e `.` e `..` resolvidos.
 */
export function serverPath(url: URL): string {
  const segments: string[] = [];
  for (const raw of percentDecode(url.pathname).replace(/\\/g, '/').split('/')) {
    const segment = raw.split(';')[0];
    if (!segment || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return `/${segments.join('/')}`.toLowerCase();
}

/** Host da Paraíba (sefaz.pb.gov.br, receita.pb.gov.br, www4...). */
function isPbHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return host === 'pb.gov.br' || host.endsWith('.pb.gov.br');
}

/**
 * Marcas do ATF em qualquer host, comparadas em minúsculas depois de
 * decodificar: os arquivos das funções fiscais (fisf_*), o despachante de
 * funções (segf_acessarfuncao) e as funções de NFC-e (cdFuncao=FIS_14xx: a
 * FIS_1410 é o formulário da consulta, a FIS_1417 a nota depois do CAPTCHA).
 * "consultarnfce" sozinho não entra: é o nome da consulta pública do QR em
 * outros estados (AM, MA, AL, SE, RN).
 */
const ATF_MARK = /fisf_|segf_acessarfuncao|cdfuncao[\s+]*=[\s+]*fis_14\d\d/;

/**
 * Endereço do ATF da Paraíba (www4.sefaz.pb.gov.br/atf), onde fica a consulta
 * completa da NFC-e: o botão "Consultar" passa por um reCAPTCHA e a nota só
 * aparece depois dele. O app não busca nenhuma página do ATF (nem o
 * formulário nem o que vem depois do CAPTCHA), seja qual for a grafia do
 * endereço: em host da PB, todo caminho que começa com /atf depois de
 * decodificado e normalizado (serverPath); em qualquer host, as marcas do ATF.
 */
export function isCaptchaGated(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (isPbHost(url.hostname) && serverPath(url).startsWith('/atf')) return true;
  return ATF_MARK.test(percentDecode(`${url.pathname}${url.search}`).toLowerCase());
}

/** Script ou iframe de um provedor de CAPTCHA: reCAPTCHA (v2, v3, Enterprise), hCaptcha ou Turnstile. */
const CAPTCHA_PROVIDER = /(?:google\.com|recaptcha\.net)\/recaptcha\/|hcaptcha\.com\/|challenges\.cloudflare\.com\/turnstile\//i;

/** Classes dos widgets: reCAPTCHA v2 (também o invisível, num botão), hCaptcha e Turnstile. */
const WIDGET_CLASS = /(?:^|\s)(?:g-recaptcha|h-captcha|cf-turnstile)(?:\s|$)/i;

/** Código que monta ou dispara o CAPTCHA (o v3 e o Enterprise não têm caixa). */
const CAPTCHA_CALL = /\b(?:grecaptcha(?:\.enterprise)?|hcaptcha|turnstile)\.(?:execute|render)\s*\(/;

/**
 * Página de verificação da Cloudflare. O script de detecção que a Cloudflare
 * põe em páginas comuns (/cdn-cgi/challenge-platform/scripts/...) não conta.
 */
const CF_CHALLENGE = /_cf_chl_opt|\/cdn-cgi\/challenge-platform\/(?:h\/[a-z]\/)?orchestrate\//i;

interface Tag {
  name: string;
  attrs: Record<string, string>;
}

/** Todas as tags do HTML vivo, com o nome em minúsculas. */
function allTags(markup: string): Tag[] {
  return [...markup.matchAll(/<([a-z][\w:-]*)\b[^>]*>/gi)].map((m) => ({ name: m[1].toLowerCase(), attrs: attributes(m[0]) }));
}

/** A tag é o widget do CAPTCHA (ou o captcha de imagem: a imagem do código e o campo dele). */
function isCaptchaWidget({ name, attrs }: Tag): boolean {
  if (WIDGET_CLASS.test(attrs.class ?? '') || Object.hasOwn(attrs, 'data-sitekey')) return true;
  if (name === 'iframe' || name === 'frame') return CAPTCHA_PROVIDER.test(attrs.src ?? '');
  if (name === 'img' || name === 'input') return [attrs.src, attrs.name, attrs.id].some((value) => /captcha/i.test(value ?? ''));
  return false;
}

/**
 * A página pede CAPTCHA. Conta o que mostra o widget, não a palavra: a classe
 * dele, um data-sitekey, o iframe do provedor, imagem ou campo de captcha; o
 * script do provedor ou o código que o dispara, numa página com formulário;
 * a página de verificação da Cloudflare; ou ser o ATF da Paraíba ou apontar
 * para ele (iframe, formulário, link, meta refresh, JavaScript). Texto e
 * comentários não contam, nem o script do provedor sem formulário (um rodapé
 * do site inteiro). Quem chama só olha se a página não trouxe itens; o
 * cabeçalho `cf-mitigated: challenge` fica em Fetched.challenge.
 */
export function showsCaptcha(html: string, pageUrl: string): boolean {
  if (isCaptchaGated(pageUrl)) return true;
  const { markup, scripts } = splitScripts(html);
  const tags = allTags(markup);
  if (tags.some(isCaptchaWidget)) return true;
  const code = scripts.map(({ attrs, code }) => ('src' in attrs ? '' : withoutComments(code))).join('\n');
  const sources = scripts.map(({ attrs }) => attrs.src ?? '');
  if (CF_CHALLENGE.test(code) || sources.some((src) => CF_CHALLENGE.test(src))) return true;
  const hasForm = tags.some(({ name }) => name === 'form');
  if (hasForm && (sources.some((src) => CAPTCHA_PROVIDER.test(src)) || CAPTCHA_CALL.test(code))) return true;
  const targets = [
    ...[...tagsOf(markup, 'iframe'), ...tagsOf(markup, 'frame')].map(({ attrs }) => attrs.src),
    ...tagsOf(markup, 'form').map(({ attrs }) => attrs.action),
    ...tagsOf(markup, 'a').map(({ attrs }) => attrs.href),
    metaRefresh(markup),
    scriptRedirect(markup, scripts),
  ];
  return targets.some((raw) => {
    const url = raw ? resolve(raw, pageUrl) : null;
    return !!url && isCaptchaGated(url);
  });
}

/** Cada sequência de dígitos vira um "#": nem os números (CPF, CNPJ, chave) nem o tamanho deles. */
function maskDigits(text: string): string {
  return text.replace(/\d+/g, '#');
}

/**
 * Protocolo, host e caminho, sem query, fragmento, `;jsessionid=` nem
 * dígitos no caminho, para logar endereços. Fora de http(s) (about:,
 * javascript:) só o protocolo.
 */
export function safeLocation(value: string, base?: string): string {
  if (!value.trim()) return '(vazio)';
  try {
    const url = new URL(value.trim(), base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return url.protocol;
    return `${url.protocol}//${url.host.replace(/\d{4,}/g, '#')}${maskDigits(url.pathname.split(';')[0])}`;
  } catch {
    return '(inválido)';
  }
}

/** Só o host de um endereço (iframes, scripts externos). */
function safeHost(value: string, base: string): string {
  if (!value.trim()) return '(vazio)';
  try {
    const url = new URL(value.trim(), base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return url.protocol;
    return url.host.replace(/\d{4,}/g, '#');
  } catch {
    return '(inválido)';
  }
}

/** "text/html; charset=iso-8859-1"; outro formato vira "(outro)". */
function safeContentType(raw: string | null): string | null {
  if (!raw) return null;
  const [media, ...params] = raw.split(';');
  const type = media.trim().toLowerCase();
  if (!/^[a-z\d.+-]{1,40}\/[a-z\d.+-]{1,60}$/.test(type)) return '(outro)';
  const charset = params.map((param) => param.trim().match(/^charset\s*=\s*"?([\w.:-]{1,40})"?$/i)?.[1]).find(Boolean);
  return charset ? `${type}; charset=${charset.toLowerCase()}` : type;
}

function unique(values: string[], max: number): string[] {
  return [...new Set(values.filter(Boolean))].slice(0, max);
}

/** Resumo da página para o log (ver PageSummary). */
export function describePage(step: string, page: Fetched): PageSummary {
  const { markup, scripts } = splitScripts(page.html);
  const frames = [...tagsOf(markup, 'iframe'), ...tagsOf(markup, 'frame')];
  const forms = tagsOf(markup, 'form');
  const refresh = metaRefresh(markup);
  return {
    step,
    status: page.status,
    url: safeLocation(page.url),
    type: safeContentType(page.contentType),
    bytes: page.bytes,
    redirects: page.redirects,
    forms: forms.length,
    iframes: frames.length,
    scripts: scripts.length,
    inputs: ['input', 'select', 'textarea', 'button'].reduce((sum, name) => sum + tagsOf(markup, name).length, 0),
    formActions: unique(forms.map(({ attrs }) => safeLocation(attrs.action ?? '', page.url)), 10),
    frameHosts: unique(frames.map(({ attrs }) => safeHost(attrs.src ?? '', page.url)), 10),
    scriptHosts: unique(scripts.map(({ attrs }) => (attrs.src ? safeHost(attrs.src, page.url) : '')), 10),
    refresh: refresh ? safeLocation(refresh, page.url) : null,
    captcha: page.challenge || showsCaptcha(page.html, page.url),
    frames: frames.length > 0 || /<frameset\b/i.test(markup),
    jsRedirect: scriptRedirect(markup, scripts) !== null,
  };
}

/**
 * Corpo em texto, respeitando o charset declarado (várias Sefaz usam
 * ISO-8859-1). Sem declaração, tenta UTF-8 e cai para Windows-1252 se os
 * bytes não forem UTF-8 válido.
 */
export function decodeHtml(bytes: Uint8Array, contentType: string | null): string {
  const sniff = new TextDecoder('windows-1252').decode(bytes.subarray(0, 2048));
  const declared = (contentType?.match(/charset=["']?([\w-]+)/i) ?? sniff.match(/charset=["']?([\w-]+)/i))?.[1];
  if (declared) {
    try {
      return new TextDecoder(declared.toLowerCase()).decode(bytes);
    } catch {
      // Charset desconhecido: segue para a detecção abaixo.
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

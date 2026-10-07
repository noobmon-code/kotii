// Cliente mínimo da Pluggy (https://api.pluggy.ai) para o consultor
// financeiro: só lê o item do MeuPluggy, as contas e os lançamentos. Usa
// fetch puro (o pluggy-sdk é Node); caminhos, parâmetros e formatos seguem o
// pluggy-sdk 0.91: POST /auth devolve a apiKey (cabeçalho X-API-KEY, vale
// 2 h); GET /items/{id}; GET /accounts?itemId; GET /v2/transactions com
// cursor (`next` traz o link da próxima página, com `after`). Extrato que não
// dá para ler inteiro é erro, nunca metade: quem sincroniza marca como
// apagado o que não voltou.
//
// Secrets: PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET (lidos pela função).

export const PLUGGY_API_URL = 'https://api.pluggy.ai';

/** A apiKey vale 2 h; renova antes de vencer no meio de uma sincronização. */
export const PLUGGY_KEY_TTL_MS = 110 * 60 * 1000;
const TIMEOUT_MS = 30_000;
/** Como o SDK: até 2 novas tentativas quando a Pluggy pede pausa (429). */
const MAX_RETRIES = 2;
const MAX_RETRY_WAIT_MS = 5_000;
/** Trava contra cursor em laço; 200 páginas já são anos de extrato. */
const MAX_PAGES = 200;

export type PluggyErrorCode = 'not_found' | 'credentials' | 'rate_limited' | 'unavailable';

export class PluggyError extends Error {
  constructor(
    message: string,
    readonly code: PluggyErrorCode,
    /** Status HTTP da Pluggy (0 quando nem chegou resposta). */
    readonly status: number,
    /** Mensagem da Pluggy, só para o log. */
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'PluggyError';
  }
}

// Só os campos que o Nooky lê. Datas chegam como texto ISO (JSON cru).

export interface PluggyItem {
  id: string;
  /** UPDATED, UPDATING, LOGIN_ERROR, OUTDATED, WAITING_USER_INPUT... */
  status: string;
  executionStatus?: string | null;
  error?: { code?: string | null; message?: string | null; providerMessage?: string | null } | null;
  /** Última vez que a Pluggy buscou os dados no banco. */
  lastUpdatedAt?: string | null;
  connector?: { id?: number; name?: string | null } | null;
}

export interface PluggyAccount {
  id: string;
  itemId?: string;
  type: string;
  subtype?: string | null;
  number?: string | null;
  balance?: number | null;
  name?: string | null;
  marketingName?: string | null;
  taxNumber?: string | null;
  currencyCode?: string | null;
  creditData?: {
    balanceCloseDate?: string | null;
    balanceDueDate?: string | null;
    availableCreditLimit?: number | null;
    minimumPayment?: number | null;
    creditLimit?: number | null;
  } | null;
}

export interface PluggyParticipant {
  documentNumber?: { value?: string | null; type?: string | null } | null;
  name?: string | null;
}

export interface PluggyTransaction {
  id: string;
  accountId?: string;
  date: string;
  description?: string | null;
  descriptionRaw?: string | null;
  /** DEBIT (saiu da conta) ou CREDIT (entrou). */
  type?: string | null;
  amount: number;
  amountInAccountCurrency?: number | null;
  currencyCode?: string | null;
  category?: string | null;
  categoryId?: string | null;
  status?: string | null;
  operationType?: string | null;
  paymentData?: {
    payer?: PluggyParticipant | null;
    receiver?: PluggyParticipant | null;
    paymentMethod?: string | null;
    boletoMetadata?: { digitableLine?: string | null; barcode?: string | null } | null;
  } | null;
  creditCardMetadata?: {
    installmentNumber?: number | null;
    totalInstallments?: number | null;
    purchaseDate?: string | null;
    billId?: string | null;
    billForecastDate?: string | null;
    otherCreditsType?: string | null;
    feeType?: string | null;
  } | null;
  merchant?: { name?: string | null; businessName?: string | null; cnpj?: string | null } | null;
}

export interface PluggyClient {
  getItem(itemId: string): Promise<PluggyItem>;
  listAccounts(itemId: string): Promise<PluggyAccount[]>;
  /** Todos os lançamentos da conta desde dateFrom (AAAA-MM-DD), seguindo todas as páginas. */
  listTransactions(accountId: string, options: { dateFrom: string }): Promise<PluggyTransaction[]>;
}

export interface PluggyOptions {
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

// A apiKey fica no módulo: chamadas seguidas da função (instância quente)
// não pedem outra. Guarda a promessa para pedidos ao mesmo tempo dividirem
// uma autenticação só.
const keys = new Map<string, { key: Promise<string>; expiresAt: number }>();

const MESSAGES: Record<PluggyErrorCode, string> = {
  not_found: 'A Pluggy não achou este banco. Confira o Item ID no Dashboard da Pluggy (Items, ⋮ no card do banco).',
  credentials:
    'A Pluggy recusou o acesso. Confira o Item ID e os secrets PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET no Supabase.',
  rate_limited: 'A Pluggy pediu uma pausa. Tente de novo em alguns minutos.',
  unavailable: 'A Pluggy não respondeu agora. Tente de novo em alguns minutos.',
};

function failure(status: number, body: unknown): PluggyError {
  const raw = (body as { message?: unknown } | null)?.message;
  const detail = typeof raw === 'string' ? raw.slice(0, 300) : typeof body === 'string' ? body.slice(0, 300) : undefined;
  const code: PluggyErrorCode =
    status === 404 ? 'not_found' : status === 401 || status === 403 ? 'credentials' : status === 429 ? 'rate_limited' : 'unavailable';
  return new PluggyError(MESSAGES[code], code, status, detail);
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Espera pedida no Retry-After (em segundos), com teto para não estourar o tempo da função. */
function retryWait(header: string | null, attempt: number): number {
  const seconds = Number(header);
  const wanted = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 1000 * (attempt + 1);
  return Math.min(wanted, MAX_RETRY_WAIT_MS);
}

/**
 * Cursor da próxima página. Lido do texto cru do link: o cursor é base64 e
 * URLSearchParams trocaria um '+' sem escape por espaço.
 */
export function nextCursor(next: string): string | null {
  const match = /[?&]after=([^&#]*)/.exec(next);
  if (!match || !match[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export function createPluggyClient(options: PluggyOptions): PluggyClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = (options.baseUrl ?? PLUGGY_API_URL).replace(/\/+$/, '');
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const cacheKey = `${base}|${options.clientId}`;

  async function send(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch (err) {
        console.error('pluggy request failed', url.split('?')[0], err);
        throw new PluggyError(MESSAGES.unavailable, 'unavailable', 0);
      }
      if (res.status !== 429 || attempt >= MAX_RETRIES) return res;
      await res.body?.cancel();
      await sleep(retryWait(res.headers.get('retry-after'), attempt));
    }
  }

  async function authenticate(): Promise<string> {
    const res = await send(`${base}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ clientId: options.clientId, clientSecret: options.clientSecret, nonExpiring: false }),
    });
    const body = await readBody(res);
    if (!res.ok) {
      // Credencial errada volta 400/401/403 no /auth.
      const err = failure(res.status === 400 ? 401 : res.status, body);
      console.error('pluggy auth failed', res.status, err.detail);
      throw err;
    }
    const apiKey = (body as { apiKey?: unknown } | null)?.apiKey;
    if (typeof apiKey !== 'string' || !apiKey) throw new PluggyError(MESSAGES.unavailable, 'unavailable', res.status);
    return apiKey;
  }

  function apiKey(): Promise<string> {
    const cached = keys.get(cacheKey);
    if (cached && cached.expiresAt > now()) return cached.key;
    const key = authenticate();
    keys.set(cacheKey, { key, expiresAt: now() + PLUGGY_KEY_TTL_MS });
    // Falhou: a próxima chamada tenta de novo em vez de herdar o erro.
    key.catch(() => forget(key));
    return key;
  }

  function forget(key: Promise<string>) {
    if (keys.get(cacheKey)?.key === key) keys.delete(cacheKey);
  }

  async function get<T>(path: string, query: Record<string, string | undefined> = {}): Promise<T> {
    const url = new URL(`${base}/${path}`);
    for (const [name, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(name, value);
    for (let renewed = false; ; renewed = true) {
      const key = apiKey();
      const res = await send(url.toString(), { headers: { 'X-API-KEY': await key, Accept: 'application/json' } });
      const body = await readBody(res);
      if (res.ok) {
        if (body && typeof body === 'object') return body as T;
        throw new PluggyError(MESSAGES.unavailable, 'unavailable', res.status, 'resposta sem JSON');
      }
      // A apiKey pode ter caído antes da hora: pede outra uma vez.
      if (res.status === 401 && !renewed) {
        forget(key);
        continue;
      }
      const err = failure(res.status, body);
      console.error('pluggy request failed', path, res.status, err.detail);
      throw err;
    }
  }

  return {
    getItem: (itemId) => get<PluggyItem>(`items/${encodeURIComponent(itemId)}`),

    async listAccounts(itemId) {
      const page = await get<{ results?: unknown }>('accounts', { itemId });
      return Array.isArray(page.results) ? (page.results as PluggyAccount[]) : [];
    },

    async listTransactions(accountId, { dateFrom }) {
      const all: PluggyTransaction[] = [];
      const cursors = new Set<string>();
      let after: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const body = await get<{ results?: unknown; next?: unknown }>('v2/transactions', { accountId, dateFrom, after });
        if (!Array.isArray(body.results)) throw new PluggyError(MESSAGES.unavailable, 'unavailable', 200, 'página sem results');
        all.push(...(body.results as PluggyTransaction[]));
        if (body.next === null || body.next === undefined || body.next === '') return all;
        // Link de próxima página sem cursor (o SDK pararia aí): o resto do extrato ficaria de fora.
        const cursor = typeof body.next === 'string' ? nextCursor(body.next) : null;
        if (!cursor) throw new PluggyError(MESSAGES.unavailable, 'unavailable', 200, 'próxima página sem cursor');
        // Cursor repetido daria laço; parar no meio deixaria o extrato pela metade.
        if (cursors.has(cursor)) throw new PluggyError(MESSAGES.unavailable, 'unavailable', 200, 'cursor repetido');
        cursors.add(cursor);
        after = cursor;
      }
      throw new PluggyError(MESSAGES.unavailable, 'unavailable', 200, 'páginas demais');
    },
  };
}

import { assertEquals, assertRejects } from '@std/assert';

import { createPluggyClient, nextCursor, PLUGGY_KEY_TTL_MS, PluggyError } from './pluggy.ts';

interface Seen {
  method: string;
  path: string;
  query: Record<string, string>;
  rawQuery: string;
  apiKey: string | null;
  body: unknown;
}

type Route = (seen: Seen) => { status: number; body?: unknown; headers?: Record<string, string> } | Promise<never>;

// Pluggy falsa: cada pedido passa pelas rotas e fica anotado.
function fakePluggy(routes: Record<string, Route>) {
  const calls: Seen[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const seen: Seen = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      rawQuery: url.search,
      apiKey: new Headers(init?.headers).get('X-API-KEY'),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    };
    calls.push(seen);
    const route = routes[`${seen.method} ${seen.path}`];
    if (!route) return new Response(JSON.stringify({ code: 404, message: 'route not found' }), { status: 404 });
    const reply = await route(seen);
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: reply.headers,
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const auth = (key = 'chave-1'): Route => () => ({ status: 200, body: { apiKey: key } });
let ids = 0;
// Cada teste com o próprio clientId: a apiKey fica guardada no módulo.
const credentials = () => ({ clientId: `cliente-${++ids}`, clientSecret: 'segredo' });
const noWait = () => Promise.resolve();

Deno.test('autentica uma vez com clientId e clientSecret e reaproveita a apiKey entre clientes', async () => {
  const pluggy = fakePluggy({
    'POST /auth': auth(),
    'GET /items/item-1': () => ({ status: 200, body: { id: 'item-1', status: 'UPDATED' } }),
  });
  const creds = credentials();
  const client = createPluggyClient({ ...creds, fetchImpl: pluggy.fetchImpl });
  assertEquals((await client.getItem('item-1')).status, 'UPDATED');
  await createPluggyClient({ ...creds, fetchImpl: pluggy.fetchImpl }).getItem('item-1');

  const authCalls = pluggy.calls.filter((call) => call.path === '/auth');
  assertEquals(authCalls.length, 1);
  assertEquals(authCalls[0].body, { clientId: creds.clientId, clientSecret: 'segredo', nonExpiring: false });
  assertEquals(pluggy.calls.filter((call) => call.path === '/items/item-1').map((call) => call.apiKey), ['chave-1', 'chave-1']);
});

Deno.test('pedidos ao mesmo tempo dividem uma autenticação só', async () => {
  const pluggy = fakePluggy({
    'POST /auth': auth(),
    'GET /accounts': () => ({ status: 200, body: { results: [], page: 1, total: 0, totalPages: 1 } }),
  });
  const client = createPluggyClient({ ...credentials(), fetchImpl: pluggy.fetchImpl });
  await Promise.all([client.listAccounts('a'), client.listAccounts('b'), client.listAccounts('c')]);
  assertEquals(pluggy.calls.filter((call) => call.path === '/auth').length, 1);
});

Deno.test('pede outra apiKey perto das 2 h de validade', async () => {
  let clock = 1_000_000;
  let issued = 0;
  const pluggy = fakePluggy({
    'POST /auth': () => ({ status: 200, body: { apiKey: `chave-${++issued}` } }),
    'GET /items/x': () => ({ status: 200, body: { id: 'x', status: 'UPDATED' } }),
  });
  const client = createPluggyClient({ ...credentials(), fetchImpl: pluggy.fetchImpl, now: () => clock });
  await client.getItem('x');
  clock += PLUGGY_KEY_TTL_MS - 1;
  await client.getItem('x');
  clock += 2;
  await client.getItem('x');
  assertEquals(PLUGGY_KEY_TTL_MS < 2 * 60 * 60 * 1000, true);
  assertEquals(pluggy.calls.filter((call) => call.path === '/items/x').map((call) => call.apiKey), ['chave-1', 'chave-1', 'chave-2']);
});

Deno.test('apiKey recusada antes da hora: renova uma vez e refaz o pedido', async () => {
  let issued = 0;
  const pluggy = fakePluggy({
    'POST /auth': () => ({ status: 200, body: { apiKey: `chave-${++issued}` } }),
    'GET /items/x': (seen) =>
      seen.apiKey === 'chave-1' ? { status: 401, body: { message: 'expired' } } : { status: 200, body: { id: 'x', status: 'UPDATED' } },
  });
  const client = createPluggyClient({ ...credentials(), fetchImpl: pluggy.fetchImpl });
  assertEquals((await client.getItem('x')).id, 'x');
  assertEquals(pluggy.calls.map((call) => `${call.method} ${call.path} ${call.apiKey ?? ''}`.trim()), [
    'POST /auth',
    'GET /items/x chave-1',
    'POST /auth',
    'GET /items/x chave-2',
  ]);
});

Deno.test('erros com tipo: 404 é item que não existe; 401/403 é credencial', async () => {
  const pluggy = fakePluggy({
    'POST /auth': auth(),
    'GET /items/sumiu': () => ({ status: 404, body: { code: 404, message: 'Item not found' } }),
    'GET /items/alheio': () => ({ status: 403, body: { code: 403, message: 'Forbidden' } }),
    'GET /items/caiu': () => ({ status: 500, body: { code: 500, message: 'boom' } }),
  });
  const client = createPluggyClient({ ...credentials(), fetchImpl: pluggy.fetchImpl });
  const notFound = await assertRejects(() => client.getItem('sumiu'), PluggyError);
  assertEquals([notFound.code, notFound.status, notFound.detail], ['not_found', 404, 'Item not found']);
  assertEquals((await assertRejects(() => client.getItem('alheio'), PluggyError)).code, 'credentials');
  const down = await assertRejects(() => client.getItem('caiu'), PluggyError);
  assertEquals([down.code, down.message], ['unavailable', 'A Pluggy não respondeu agora. Tente de novo em alguns minutos.']);
});

Deno.test('clientId/clientSecret errados: erro de credencial, e a próxima chamada tenta autenticar de novo', async () => {
  let attempts = 0;
  const pluggy = fakePluggy({
    'POST /auth': () => (++attempts === 1 ? { status: 401, body: { message: 'Invalid credentials' } } : { status: 200, body: { apiKey: 'ok' } }),
    'GET /items/x': () => ({ status: 200, body: { id: 'x', status: 'UPDATED' } }),
  });
  const client = createPluggyClient({ ...credentials(), fetchImpl: pluggy.fetchImpl });
  const err = await assertRejects(() => client.getItem('x'), PluggyError);
  assertEquals(err.code, 'credentials');
  assertEquals(err.message.includes('PLUGGY_CLIENT_ID'), true);
  assertEquals((await client.getItem('x')).id, 'x');
});

Deno.test('sem rede: erro de indisponível', async () => {
  const fetchImpl = (() => Promise.reject(new TypeError('network down'))) as typeof fetch;
  const err = await assertRejects(() => createPluggyClient({ ...credentials(), fetchImpl }).getItem('x'), PluggyError);
  assertEquals([err.code, err.status], ['unavailable', 0]);
});

Deno.test('429: espera o Retry-After e tenta de novo; insistindo, desiste com erro próprio', async () => {
  let tries = 0;
  const waits: number[] = [];
  const pluggy = fakePluggy({
    'POST /auth': auth(),
    'GET /items/x': () => (++tries < 3 ? { status: 429, headers: { 'Retry-After': '2' } } : { status: 200, body: { id: 'x', status: 'UPDATED' } }),
    'GET /items/y': () => ({ status: 429, headers: { 'Retry-After': '60' } }),
  });
  const sleep = (ms: number) => {
    waits.push(ms);
    return Promise.resolve();
  };
  const client = createPluggyClient({ ...credentials(), fetchImpl: pluggy.fetchImpl, sleep });
  assertEquals((await client.getItem('x')).id, 'x');
  assertEquals(waits, [2000, 2000]);
  const err = await assertRejects(() => client.getItem('y'), PluggyError);
  assertEquals(err.code, 'rate_limited');
  // Espera com teto: a função não pode ficar parada um minuto.
  assertEquals(waits.slice(2), [5000, 5000]);
});

Deno.test('contas do item pelo /accounts?itemId', async () => {
  const pluggy = fakePluggy({
    'POST /auth': auth(),
    'GET /accounts': (seen) => ({
      status: 200,
      body: { results: [{ id: 'acc-1', type: 'BANK', itemId: seen.query.itemId }], page: 1, total: 1, totalPages: 1 },
    }),
  });
  const accounts = await createPluggyClient({ ...credentials(), fetchImpl: pluggy.fetchImpl }).listAccounts('item-9');
  assertEquals(accounts, [{ id: 'acc-1', type: 'BANK', itemId: 'item-9' }]);
  assertEquals(pluggy.calls.at(-1)?.query, { itemId: 'item-9' });
});

Deno.test('lançamentos: segue o cursor do /v2/transactions por todas as páginas, com dateFrom em todas', async () => {
  const cursor = 'MjAyNi0xMC0wNFQxMjowMDowMC4wMDBafGE+Yi9j==';
  const pages: Record<string, { results: { id: string }[]; next: string | null }> = {
    '': { results: [{ id: 't1' }, { id: 't2' }], next: `https://api.pluggy.ai/v2/transactions?accountId=acc-1&after=${encodeURIComponent(cursor)}` },
    [cursor]: { results: [{ id: 't3' }], next: '/v2/transactions?accountId=acc-1&dateFrom=2026-08-08&after=c3' },
    c3: { results: [{ id: 't4' }], next: null },
  };
  const pluggy = fakePluggy({
    'POST /auth': auth(),
    'GET /v2/transactions': (seen) => ({ status: 200, body: pages[seen.query.after ?? ''] }),
  });
  const client = createPluggyClient({ ...credentials(), fetchImpl: pluggy.fetchImpl });
  const all = await client.listTransactions('acc-1', { dateFrom: '2026-08-08' });
  assertEquals(all.map((tx) => tx.id), ['t1', 't2', 't3', 't4']);
  const pageCalls = pluggy.calls.filter((call) => call.path === '/v2/transactions');
  assertEquals(pageCalls.map((call) => call.query), [
    { accountId: 'acc-1', dateFrom: '2026-08-08' },
    { accountId: 'acc-1', dateFrom: '2026-08-08', after: cursor },
    { accountId: 'acc-1', dateFrom: '2026-08-08', after: 'c3' },
  ]);
  // O '+' do base64 vai escapado, senão chega à Pluggy como espaço.
  assertEquals(pageCalls[1].rawQuery.includes('%2B'), true);
});

Deno.test('cursor: lido do link cru (com ou sem escape) ou da query sozinha', () => {
  assertEquals(nextCursor('/v2/transactions?accountId=a&after=ab%2Bc%2F%3D%3D'), 'ab+c/==');
  assertEquals(nextCursor('/v2/transactions?accountId=a&after=ab+c/=='), 'ab+c/==');
  assertEquals(nextCursor('?after=xyz&accountId=a'), 'xyz');
  assertEquals(nextCursor('/v2/transactions?accountId=a'), null);
  assertEquals(nextCursor('/v2/transactions?accountId=a&after='), null);
});

Deno.test('lançamentos: link sem cursor encerra (como o SDK); cursor repetido é erro, não laço', async () => {
  const endless = fakePluggy({
    'POST /auth': auth(),
    'GET /v2/transactions': () => ({ status: 200, body: { results: [{ id: 't' }], next: '/v2/transactions?accountId=a&after=sempre' } }),
  });
  const err = await assertRejects(
    () => createPluggyClient({ ...credentials(), fetchImpl: endless.fetchImpl }).listTransactions('a', { dateFrom: '2026-01-01' }),
    PluggyError,
  );
  assertEquals(err.code, 'unavailable');
  assertEquals(endless.calls.filter((call) => call.path === '/v2/transactions').length, 2);

  const noCursor = fakePluggy({
    'POST /auth': auth(),
    'GET /v2/transactions': () => ({ status: 200, body: { results: [{ id: 't' }], next: '/v2/transactions?accountId=a' } }),
  });
  const all = await createPluggyClient({ ...credentials(), fetchImpl: noCursor.fetchImpl }).listTransactions('a', {
    dateFrom: '2026-01-01',
  });
  assertEquals(all.length, 1);
});

Deno.test('lançamentos: erro numa página do meio sobe (não devolve o extrato pela metade)', async () => {
  const pluggy = fakePluggy({
    'POST /auth': auth(),
    'GET /v2/transactions': (seen) =>
      seen.query.after ? { status: 502, body: { message: 'bad gateway' } } : { status: 200, body: { results: [{ id: 't1' }], next: '?after=c2' } },
  });
  const client = createPluggyClient({ ...credentials(), fetchImpl: pluggy.fetchImpl, sleep: noWait });
  const err = await assertRejects(() => client.listTransactions('a', { dateFrom: '2026-01-01' }), PluggyError);
  assertEquals(err.code, 'unavailable');
});

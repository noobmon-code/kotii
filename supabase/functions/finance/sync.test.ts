import { assert, assertEquals } from '@std/assert';

import { type PluggyAccount, type PluggyClient, PluggyError, type PluggyItem, type PluggyTransaction } from '../_shared/pluggy.ts';
import { docHash, type FinAccountRow, type FinTransactionRow } from './map.ts';
import {
  addItem,
  errorForLog,
  type FinanceDb,
  type FinConnectionOwnerRef,
  itemState,
  NOT_ALLOWED,
  parseFinanceRequest,
  shouldSync,
  type SyncDeps,
  syncAll,
  syncWindowStart,
} from './sync.ts';

const ITEM = '0b7c6a3e-1d2f-4e5a-9b8c-7d6e5f4a3b2c';
const HASH_KEY = 'segredo-de-teste-com-32-caracteres!';
const OTHER_ITEM = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

interface ConnectionRow extends FinConnectionOwnerRef {
  status: string | null;
  error_message: string | null;
  item_updated_at: string | null;
  sync_started_at: string | null;
}

/** Quanto vale a vez de sincronizar, como em fin_claim_sync. */
const LEASE_MS = 10 * 60 * 1000;

// Banco falso com as regras que importam: unique por id da Pluggy e tudo
// preso à pessoa e à casa, como o adaptador do index.ts.
function fakeStore() {
  const connections = new Map<string, ConnectionRow>();
  const accounts = new Map<string, FinAccountRow & { id: string }>();
  const transactions = new Map<string, FinTransactionRow & { id: string }>();
  const upsertBatches: number[] = [];
  let seq = 0;

  function dbFor(
    userId: string,
    householdId: string,
    options: { raceOnInsert?: FinConnectionOwnerRef; revoked?: boolean } = {},
  ): FinanceDb {
    const mine = (row: { user_id: string; household_id: string }) => row.user_id === userId && row.household_id === householdId;
    return {
      listConnections: () =>
        Promise.resolve(
          [...connections.values()].filter(mine).map(({ id, label, pluggy_item_id, last_synced_at, item_updated_at }) => ({
            id,
            label,
            pluggy_item_id,
            last_synced_at,
            item_updated_at,
          })),
        ),
      findConnectionByItem: (itemId) => Promise.resolve([...connections.values()].find((row) => row.pluggy_item_id === itemId) ?? null),
      insertConnection: (row) => {
        // Liberação tirada: a foreign key para beta_access recusa a linha.
        if (options.revoked) return Promise.resolve('not_allowed');
        if (options.raceOnInsert) {
          connections.set(options.raceOnInsert.id, { status: null, error_message: null, sync_started_at: null, ...options.raceOnInsert });
        }
        if ([...connections.values()].some((other) => other.pluggy_item_id === row.pluggy_item_id)) return Promise.resolve('conflict');
        const id = `con-${++seq}`;
        connections.set(id, { ...row, id, user_id: userId, household_id: householdId, last_synced_at: null, sync_started_at: null });
        return Promise.resolve({ id });
      },
      updateConnection: (id, patch) => {
        const row = connections.get(id);
        if (row && mine(row)) Object.assign(row, patch);
        return Promise.resolve();
      },
      // Como fin_claim_sync: livre, ou presa há mais de 10 min.
      claimSync: (id, at) => {
        const row = connections.get(id);
        if (!row || !mine(row)) return Promise.resolve(false);
        if (row.sync_started_at !== null && Date.parse(row.sync_started_at) >= Date.parse(at) - LEASE_MS) return Promise.resolve(false);
        row.sync_started_at = at;
        return Promise.resolve(true);
      },
      releaseSync: (id, at, done) => {
        const row = connections.get(id);
        if (row && mine(row) && row.sync_started_at === at) Object.assign(row, done, { sync_started_at: null });
        return Promise.resolve();
      },
      upsertAccounts: (rows) =>
        Promise.resolve(
          rows.map((row) => {
            const id = accounts.get(row.pluggy_account_id)?.id ?? `acc-db-${++seq}`;
            accounts.set(row.pluggy_account_id, { ...row, id });
            return { id, pluggy_account_id: row.pluggy_account_id };
          }),
        ),
      upsertTransactions: (rows) => {
        const ids = rows.map((row) => row.pluggy_transaction_id);
        if (new Set(ids).size !== ids.length) throw new Error('ON CONFLICT DO UPDATE command cannot affect row a second time');
        upsertBatches.push(rows.length);
        for (const row of rows) {
          transactions.set(row.pluggy_transaction_id, { ...row, id: transactions.get(row.pluggy_transaction_id)?.id ?? `tx-db-${++seq}` });
        }
        return Promise.resolve();
      },
      activeTransactionIds: (accountId, fromDate, runAt) =>
        Promise.resolve(
          [...transactions.values()]
            .filter((row) =>
              row.account_id === accountId && mine(row) && row.deleted_at === null && row.occurred_on >= fromDate && row.updated_at < runAt
            )
            .map((row) => row.pluggy_transaction_id),
        ),
      // Como o UPDATE do index.ts: a condição de updated_at vale na hora de marcar.
      markDeleted: (accountId, pluggyIds, at) => {
        for (const id of pluggyIds) {
          const row = transactions.get(id);
          if (row && row.account_id === accountId && mine(row) && row.deleted_at === null && row.updated_at < at) {
            Object.assign(row, { deleted_at: at, updated_at: at });
          }
        }
        return Promise.resolve();
      },
      purgeDeleted: (accountId, before) => {
        for (const [id, row] of transactions) {
          const deletedAt = (row as { deleted_at: string | null }).deleted_at;
          if (row.account_id === accountId && mine(row) && deletedAt !== null && deletedAt < before) transactions.delete(id);
        }
        return Promise.resolve();
      },
    };
  }
  return { connections, accounts, transactions, upsertBatches, dbFor };
}

interface FakeBank {
  item: PluggyItem;
  accounts: PluggyAccount[];
  /** Por id de conta da Pluggy. */
  transactions: Record<string, PluggyTransaction[]>;
}

// Pluggy falsa: devolve o que tem desde dateFrom (pela data UTC, como a API).
function fakePluggy(banks: Record<string, FakeBank | PluggyError>, failures: { transactions?: Record<string, Error> } = {}) {
  const calls: string[] = [];
  const bank = (itemId: string) => {
    const found = banks[itemId];
    if (!found) throw new PluggyError('não achou', 'not_found', 404);
    if (found instanceof PluggyError) throw found;
    return found;
  };
  const client: PluggyClient = {
    getItem: (itemId) => {
      calls.push(`item ${itemId}`);
      return Promise.resolve().then(() => bank(itemId).item);
    },
    listAccounts: (itemId) => {
      calls.push(`accounts ${itemId}`);
      return Promise.resolve().then(() => bank(itemId).accounts);
    },
    listTransactions: (accountId, { dateFrom }) => {
      calls.push(`transactions ${accountId} ${dateFrom}`);
      const failure = failures.transactions?.[accountId];
      if (failure) return Promise.reject(failure);
      const all = Object.values(banks).flatMap((b) => (b instanceof PluggyError ? [] : b.transactions[accountId] ?? []));
      return Promise.resolve(all.filter((tx) => tx.date.slice(0, 10) >= dateFrom));
    },
  };
  return { client, calls };
}

const item = (overrides: Partial<PluggyItem> = {}): PluggyItem => ({
  id: ITEM,
  status: 'UPDATED',
  error: null,
  lastUpdatedAt: '2026-10-07T09:00:00.000Z',
  ...overrides,
});

const pluggyTx = (id: string, date: string, overrides: Partial<PluggyTransaction> = {}): PluggyTransaction => ({
  id,
  date,
  description: `Compra ${id}`,
  type: 'DEBIT',
  amount: -10,
  status: 'POSTED',
  currencyCode: 'BRL',
  ...overrides,
});

const nubank = (transactions: PluggyTransaction[]): FakeBank => ({
  item: item(),
  accounts: [
    { id: 'p-conta', type: 'BANK', number: '12345-6', balance: 100, taxNumber: '12345678909', currencyCode: 'BRL' },
    { id: 'p-cartao', type: 'CREDIT', number: '5502', balance: 50, creditData: { creditLimit: 1000 } },
  ],
  transactions: { 'p-conta': transactions, 'p-cartao': [pluggyTx('c1', '2026-10-01T00:00:00.000Z')] },
});

function setup(banks: Record<string, FakeBank | PluggyError>, at = '2026-10-07T12:00:00.000Z') {
  const store = fakeStore();
  const pluggy = fakePluggy(banks);
  const clock = { now: new Date(at) };
  const deps = (userId = 'user-1', householdId = 'casa-1', extra: Partial<SyncDeps> = {}): SyncDeps => ({
    db: store.dbFor(userId, householdId),
    pluggy: pluggy.client,
    userId,
    householdId,
    hashKey: HASH_KEY,
    now: () => clock.now,
    ...extra,
  });
  const connect = (itemId = ITEM, label = 'Nubank', userId = 'user-1', householdId = 'casa-1') =>
    store.dbFor(userId, householdId).insertConnection({ label, pluggy_item_id: itemId, status: null, error_message: null, item_updated_at: null });
  return { store, pluggy, clock, deps, connect };
}

/** O banco de uma sincronização que, na primeira chamada de `method`, deixa outra rodar inteira antes. */
function pauseBefore(db: FinanceDb, method: 'activeTransactionIds' | 'markDeleted', other: () => Promise<unknown>): FinanceDb {
  let paused = false;
  const pause = async () => {
    if (paused) return;
    paused = true;
    await other();
  };
  return {
    ...db,
    activeTransactionIds: async (...args) => {
      if (method === 'activeTransactionIds') await pause();
      return db.activeTransactionIds(...args);
    },
    markDeleted: async (...args) => {
      if (method === 'markDeleted') await pause();
      return db.markDeleted(...args);
    },
  };
}

Deno.test('pedido: sync (force só se true) e add_item com Item ID em formato de uuid e nome de 1 a 40 letras', () => {
  assertEquals(parseFinanceRequest({ action: 'sync' }), { action: 'sync', force: false });
  assertEquals(parseFinanceRequest({ action: 'sync', force: 'sim' }), { action: 'sync', force: false });
  assertEquals(parseFinanceRequest({ action: 'sync', force: true }), { action: 'sync', force: true });
  assertEquals(parseFinanceRequest({ action: 'add_item', itemId: ` ${ITEM.toUpperCase()} `, label: '  Nubank   PF ' }), {
    action: 'add_item',
    itemId: ITEM,
    label: 'Nubank PF',
  });
  assertEquals(typeof parseFinanceRequest({ action: 'add_item', itemId: '12345', label: 'Nubank' }), 'string');
  assertEquals(typeof parseFinanceRequest({ action: 'add_item', itemId: ITEM, label: '   ' }), 'string');
  assertEquals(typeof parseFinanceRequest({ action: 'add_item', itemId: ITEM, label: 'x'.repeat(41) }), 'string');
  assertEquals(parseFinanceRequest({ action: 'add_item', itemId: ITEM, label: 'x'.repeat(40) }), { action: 'add_item', itemId: ITEM, label: 'x'.repeat(40) });
  assertEquals(typeof parseFinanceRequest({ action: 'apagar' }), 'string');
  assertEquals(typeof parseFinanceRequest(null), 'string');
});

Deno.test('intervalos: 6 h para a sincronização ao abrir, 2 min no Atualizar', () => {
  const now = new Date('2026-10-07T12:00:00.000Z');
  assertEquals(shouldSync(null, now, false), true);
  assertEquals(shouldSync('2026-10-07T06:00:01.000Z', now, false), false);
  assertEquals(shouldSync('2026-10-07T06:00:00.000Z', now, false), true);
  assertEquals(shouldSync('2026-10-07T11:58:30.000Z', now, true), false);
  assertEquals(shouldSync('2026-10-07T11:58:00.000Z', now, true), true);
});

Deno.test('janela: 365 dias sem dados ainda, 60 depois, contados do dia em São Paulo', () => {
  const now = new Date('2026-10-07T12:00:00.000Z');
  assertEquals(syncWindowStart(null, null, now), '2025-10-07');
  assertEquals(syncWindowStart('2026-10-06T12:00:00.000Z', '2026-10-06T09:00:00.000Z', now), '2026-08-08');
  // 01h UTC do dia 8 ainda é dia 7 em São Paulo.
  assertEquals(syncWindowStart('2026-10-07T12:00:00.000Z', '2026-10-07T09:00:00.000Z', new Date('2026-10-08T01:00:00.000Z')), '2026-08-08');
  // Sincronizou, mas a Pluggy ainda não tinha atualizado o banco (MeuPluggy recém-autorizado): o histórico ainda não veio.
  assertEquals(syncWindowStart('2026-10-06T12:00:00.000Z', null, now), '2025-10-07');
  assertEquals(syncWindowStart('x', '2026-10-06T09:00:00.000Z', now), '2025-10-07');
});

Deno.test('janela: meses sem abrir o consultor (ou banco parado que volta) começa uma semana antes do que já veio', () => {
  const now = new Date('2026-10-07T12:00:00.000Z');
  assertEquals(syncWindowStart('2026-07-01T12:00:00.000Z', '2026-07-01T09:00:00.000Z', now), '2026-06-24');
  // O banco parou na Pluggy em julho, mesmo sincronizando todo dia: vale a data do banco.
  assertEquals(syncWindowStart('2026-10-06T12:00:00.000Z', '2026-07-01T09:00:00.000Z', now), '2026-06-24');
  // Nunca mais que 365 dias.
  assertEquals(syncWindowStart('2025-01-01T12:00:00.000Z', '2025-01-01T09:00:00.000Z', now), '2025-10-07');
});

Deno.test('situação do item: status, erro e data da última atualização (data inválida vira null)', () => {
  assertEquals(itemState(item({ status: 'LOGIN_ERROR', error: { code: 'INVALID_CREDENTIALS', message: ' Invalid credentials ' } })), {
    status: 'LOGIN_ERROR',
    error_message: 'Invalid credentials',
    item_updated_at: '2026-10-07T09:00:00.000Z',
  });
  assertEquals(itemState(item({ lastUpdatedAt: 'ontem' })).item_updated_at, null);
  assertEquals(itemState(item({ lastUpdatedAt: null })).error_message, null);
});

Deno.test('primeira sincronização: 365 dias, contas e lançamentos da pessoa nesta casa, e a hora marcada', async () => {
  const { store, pluggy, deps, connect } = setup({
    [ITEM]: nubank([pluggyTx('t1', '2026-10-05T15:00:00.000Z'), pluggyTx('t-velho', '2025-12-01T15:00:00.000Z')]),
  });
  await connect();
  assertEquals(await syncAll(deps(), false), { synced: 1, skipped: 0, errors: [] });

  assert(pluggy.calls.includes('transactions p-conta 2025-10-06'));
  const connection = [...store.connections.values()][0];
  assertEquals(
    [connection.status, connection.item_updated_at, connection.last_synced_at],
    ['UPDATED', '2026-10-07T09:00:00.000Z', '2026-10-07T12:00:00.000Z'],
  );
  const conta = store.accounts.get('p-conta')!;
  assertEquals([conta.connection_id, conta.user_id, conta.household_id, conta.type], [connection.id, 'user-1', 'casa-1', 'BANK']);
  assertEquals(store.accounts.get('p-cartao')?.type, 'CREDIT');
  const t1 = store.transactions.get('t1')!;
  assertEquals([t1.account_id, t1.user_id, t1.household_id, t1.amount, t1.occurred_on], [conta.id, 'user-1', 'casa-1', 10, '2026-10-05']);
  assertEquals(store.transactions.get('c1')?.account_id, store.accounts.get('p-cartao')?.id);
  assertEquals(store.transactions.size, 3);
  // Cada linha leva a hora desta sincronização em updated_at (a marca que separa uma sincronização da outra).
  assertEquals([...store.transactions.values()].map((row) => row.updated_at), Array(3).fill('2026-10-07T12:00:00.000Z'));
});

Deno.test('depois, janela de 60 dias: o que sumiu da Pluggy vira apagado, também no primeiro dia dela; antes dela, fica; e volta se reaparecer', async () => {
  const live = [
    pluggyTx('fica', '2026-10-05T15:00:00.000Z'),
    pluggyTx('some', '2026-10-04T15:00:00.000Z'),
    // No próprio dia do dateFrom (só a data, e com hora em São Paulo): amanhã a
    // janela anda um dia e eles ficariam para trás sem conferência.
    pluggyTx('borda', '2026-08-08T00:00:00.000Z'),
    pluggyTx('no-dia', '2026-08-08T15:00:00.000Z'),
    pluggyTx('antigo', '2026-03-01T15:00:00.000Z'),
  ];
  const bank = nubank(live);
  const { store, pluggy, clock, deps, connect } = setup({ [ITEM]: bank });
  await connect();
  await syncAll(deps(), false);

  // Sete horas depois, a Pluggy só traz "fica". A busca começa um dia antes do dateFrom e a
  // conferência no próprio dateFrom: "borda" e "no-dia" saem; "antigo", antes da janela, fica.
  bank.transactions['p-conta'] = [live[0]];
  clock.now = new Date('2026-10-07T19:00:00.000Z');
  assertEquals(await syncAll(deps(), false), { synced: 1, skipped: 0, errors: [] });
  assert(pluggy.calls.includes('transactions p-conta 2026-08-07'));
  assertEquals(store.transactions.get('some')?.deleted_at, '2026-10-07T19:00:00.000Z');
  assertEquals(store.transactions.get('no-dia')?.deleted_at, '2026-10-07T19:00:00.000Z');
  assertEquals(store.transactions.get('fica')?.deleted_at, null);
  assertEquals(store.transactions.get('borda')?.deleted_at, '2026-10-07T19:00:00.000Z');
  assertEquals(store.transactions.get('antigo')?.deleted_at, null);

  bank.transactions['p-conta'] = [live[0], live[1]];
  clock.now = new Date('2026-10-08T02:00:00.000Z');
  await syncAll(deps(), false);
  assertEquals(store.transactions.get('some')?.deleted_at, null);
});

Deno.test('respeita os intervalos: ao abrir pula o que sincronizou há menos de 6 h; o Atualizar, há menos de 2 min', async () => {
  const { pluggy, clock, deps, connect } = setup({ [ITEM]: nubank([]) });
  await connect();
  await syncAll(deps(), false);
  const itemCalls = () => pluggy.calls.filter((call) => call.startsWith('item')).length;

  clock.now = new Date('2026-10-07T13:00:00.000Z');
  assertEquals(await syncAll(deps(), false), { synced: 0, skipped: 1, errors: [] });
  assertEquals(await syncAll(deps(), true), { synced: 1, skipped: 0, errors: [] });
  clock.now = new Date('2026-10-07T13:01:00.000Z');
  assertEquals(await syncAll(deps(), true), { synced: 0, skipped: 1, errors: [] });
  assertEquals(itemCalls(), 2);
});

Deno.test('só os bancos da pessoa na casa aberta: o do cônjuge e o da outra casa ficam de fora', async () => {
  const { store, pluggy, deps, connect } = setup({ [ITEM]: nubank([]), [OTHER_ITEM]: { ...nubank([]), item: item({ id: OTHER_ITEM }) } });
  await connect(ITEM, 'Nubank', 'user-1', 'casa-1');
  await connect(OTHER_ITEM, 'Inter', 'user-2', 'casa-1');
  assertEquals(await syncAll(deps(), false), { synced: 1, skipped: 0, errors: [] });
  assertEquals(await syncAll(deps('user-1', 'casa-2'), false), { synced: 0, skipped: 0, errors: [] });
  assertEquals(pluggy.calls.filter((call) => call.startsWith('item')), [`item ${ITEM}`]);
  assertEquals([...store.connections.values()].find((row) => row.pluggy_item_id === OTHER_ITEM)?.last_synced_at, null);
});

Deno.test('erro em um banco não para os outros, e o banco com erro não marca a hora', async () => {
  const { store, deps, connect } = setup({
    [ITEM]: nubank([pluggyTx('t1', '2026-10-05T15:00:00.000Z')]),
    [OTHER_ITEM]: new PluggyError('A Pluggy não respondeu agora. Tente de novo em alguns minutos.', 'unavailable', 500),
  });
  await connect(ITEM, 'Nubank');
  const inter = await connect(OTHER_ITEM, 'Inter');
  const result = await syncAll(deps(), false);
  assertEquals(result, {
    synced: 1,
    skipped: 0,
    errors: [
      {
        connectionId: (inter as { id: string }).id,
        label: 'Inter',
        message: 'A Pluggy não respondeu agora. Tente de novo em alguns minutos.',
      },
    ],
  });
  assertEquals(store.connections.get((inter as { id: string }).id)?.last_synced_at, null);
  assert(store.transactions.has('t1'));
});

Deno.test('extrato que falha no meio: nada é marcado como apagado, e a mensagem é genérica para erro que não é da Pluggy', async () => {
  const bank = nubank([pluggyTx('t1', '2026-10-05T15:00:00.000Z')]);
  const { store, clock, deps, connect } = setup({ [ITEM]: bank });
  await connect();
  await syncAll(deps(), false);

  const failing = fakePluggy({ [ITEM]: bank }, { transactions: { 'p-conta': new Error('timeout') } });
  clock.now = new Date('2026-10-08T12:00:00.000Z');
  const result = await syncAll(deps('user-1', 'casa-1', { pluggy: failing.client }), false);
  assertEquals(result.errors.map((error) => error.message), ['Não consegui atualizar este banco agora. Tente de novo.']);
  assertEquals(store.transactions.get('t1')?.deleted_at, null);
  assertEquals([...store.connections.values()][0].last_synced_at, '2026-10-07T12:00:00.000Z');
  // A vez volta mesmo com o erro: o próximo "Atualizar" não espera os 10 min.
  assertEquals([...store.connections.values()][0].sync_started_at, null);
  clock.now = new Date('2026-10-08T12:03:00.000Z');
  assertEquals(await syncAll(deps(), true), { synced: 1, skipped: 0, errors: [] });
});

Deno.test('lançamento repetido entre páginas vai uma vez só; lote grande sai em pedaços', async () => {
  const many = Array.from({ length: 1201 }, (_, i) => pluggyTx(`t${i}`, '2026-10-05T15:00:00.000Z'));
  const { store, deps, connect } = setup({ [ITEM]: nubank([...many, pluggyTx('t0', '2026-10-05T15:00:00.000Z', { amount: -99 })]) });
  await connect();
  assertEquals((await syncAll(deps(), false)).errors, []);
  assertEquals(store.upsertBatches, [500, 500, 201, 1]);
  assertEquals(store.transactions.get('t0')?.amount, 99);
});

Deno.test('lançamento que não dá para gravar fica de fora sem ser marcado como apagado', async () => {
  const bank = nubank([pluggyTx('t1', '2026-10-05T15:00:00.000Z')]);
  const { store, clock, deps, connect } = setup({ [ITEM]: bank });
  await connect();
  await syncAll(deps(), false);
  bank.transactions['p-conta'] = [pluggyTx('t1', '2026-10-05T15:00:00.000Z', { amount: Number.NaN })];
  clock.now = new Date('2026-10-08T12:00:00.000Z');
  assertEquals((await syncAll(deps(), false)).errors, []);
  assertEquals(store.transactions.get('t1')?.deleted_at, null);
  assertEquals(store.transactions.get('t1')?.amount, 10);
});

Deno.test('conectar: Item ID que a Pluggy não conhece -> 404 dizendo onde copiar, sem gravar nada', async () => {
  const { store, deps } = setup({});
  assertEquals(await addItem(deps(), { itemId: ITEM, label: 'Nubank' }), {
    ok: false,
    status: 404,
    error: 'Não achei esse Item ID na Pluggy. Copie de novo no Dashboard da Pluggy: Items, ⋮ no card do banco, "Copiar Item ID".',
  });
  assertEquals(store.connections.size, 0);
});

Deno.test('conectar: credencial recusada -> 503; Pluggy fora -> 502', async () => {
  const refused = setup({ [ITEM]: new PluggyError('recusou', 'credentials', 401) });
  assertEquals(await addItem(refused.deps(), { itemId: ITEM, label: 'Nubank' }), { ok: false, status: 503, error: 'recusou' });
  const down = setup({ [ITEM]: new PluggyError('fora', 'unavailable', 500) });
  assertEquals(await addItem(down.deps(), { itemId: ITEM, label: 'Nubank' }), { ok: false, status: 502, error: 'fora' });
});

Deno.test('conectar: grava com a situação do item, sincroniza na hora (sem pedir o item de novo) e devolve o id', async () => {
  const { store, pluggy, deps } = setup({ [ITEM]: nubank([pluggyTx('t1', '2026-10-05T15:00:00.000Z')]) });
  const result = await addItem(deps(), { itemId: ITEM, label: 'Nubank' });
  assert(result.ok);
  assertEquals(result.sync, { synced: 1, skipped: 0, errors: [] });
  const row = store.connections.get(result.connectionId)!;
  assertEquals([row.label, row.user_id, row.household_id, row.status], ['Nubank', 'user-1', 'casa-1', 'UPDATED']);
  assertEquals(row.last_synced_at, '2026-10-07T12:00:00.000Z');
  assert(store.transactions.has('t1'));
  assertEquals(pluggy.calls.filter((call) => call.startsWith('item')).length, 1);
});

Deno.test('conectar de novo o mesmo item: só troca o nome; sincroniza na janela curta, no intervalo do Atualizar', async () => {
  const { store, pluggy, clock, deps } = setup({ [ITEM]: nubank([]) });
  const first = await addItem(deps(), { itemId: ITEM, label: 'Nubank' });
  const listings = () => pluggy.calls.filter((call) => !call.startsWith('item')).length;
  const before = listings();

  // 30 s depois (dois Enter, ou um cliente insistindo): troca o nome, mas não busca o extrato de novo.
  clock.now = new Date('2026-10-07T12:00:30.000Z');
  const again = await addItem(deps(), { itemId: ITEM, label: 'Nubank PF' });
  assert(first.ok && again.ok);
  assertEquals(again.connectionId, first.connectionId);
  assertEquals(again.sync, { synced: 0, skipped: 1, errors: [] });
  assertEquals(listings(), before);
  assertEquals(store.connections.size, 1);
  assertEquals(store.connections.get(first.connectionId)?.label, 'Nubank PF');

  clock.now = new Date('2026-10-07T12:03:00.000Z');
  const later = await addItem(deps(), { itemId: ITEM, label: 'Nubank PF' });
  assert(later.ok);
  assertEquals(later.sync, { synced: 1, skipped: 0, errors: [] });
  assertEquals(pluggy.calls.filter((call) => call.startsWith('transactions p-conta')).at(-1), 'transactions p-conta 2026-08-07');
});

Deno.test('item que a Pluggy ainda não preencheu (MeuPluggy recém-autorizado): não marca a hora e a próxima busca 365 dias', async () => {
  const bank = nubank([pluggyTx('t1', '2026-10-05T15:00:00.000Z')]);
  const empty: FakeBank = { item: item({ status: 'UPDATING', lastUpdatedAt: null }), accounts: [], transactions: {} };
  const banks: Record<string, FakeBank> = { [ITEM]: empty };
  const { store, pluggy, clock, deps } = setup(banks);
  const added = await addItem(deps(), { itemId: ITEM, label: 'Nubank' });
  assert(added.ok);
  assertEquals(added.sync, { synced: 1, skipped: 0, errors: [] });
  assertEquals(store.connections.get(added.connectionId)?.last_synced_at, null);
  assertEquals(store.connections.get(added.connectionId)?.sync_started_at, null);

  // Contas chegando com o item ainda atualizando: marca a hora, mas o histórico de 365 dias ainda vem na próxima.
  banks[ITEM] = { ...bank, item: item({ status: 'UPDATING', lastUpdatedAt: null }) };
  clock.now = new Date('2026-10-07T12:05:00.000Z');
  assertEquals(await syncAll(deps(), true), { synced: 1, skipped: 0, errors: [] });
  assertEquals(store.connections.get(added.connectionId)?.last_synced_at, '2026-10-07T12:05:00.000Z');

  banks[ITEM] = bank;
  clock.now = new Date('2026-10-07T12:10:00.000Z');
  await syncAll(deps(), true);
  assertEquals(pluggy.calls.filter((call) => call.startsWith('transactions p-conta')), [
    'transactions p-conta 2025-10-06',
    'transactions p-conta 2025-10-06',
  ]);
  clock.now = new Date('2026-10-07T12:15:00.000Z');
  await syncAll(deps(), true);
  assertEquals(pluggy.calls.filter((call) => call.startsWith('transactions p-conta')).at(-1), 'transactions p-conta 2026-08-07');
});

Deno.test('meses sem sincronizar: busca desde uma semana antes da última vez, sem buraco', async () => {
  const { pluggy, clock, deps, connect } = setup({ [ITEM]: nubank([]) }, '2026-07-01T12:00:00.000Z');
  await connect();
  await syncAll(deps(), false);
  clock.now = new Date('2026-10-07T12:00:00.000Z');
  await syncAll(deps(), false);
  assertEquals(pluggy.calls.filter((call) => call.startsWith('transactions p-conta')).at(-1), 'transactions p-conta 2026-06-23');
});

Deno.test('banco parado que volta: se a 1ª sincronização falha no meio, a próxima ainda busca desde o banco parado', async () => {
  const bank = nubank([]);
  const { store, clock, deps, connect } = setup({ [ITEM]: bank });
  const { id } = (await connect()) as { id: string };
  // Sincronizava todo dia (as contas vinham), mas o banco estava parado na Pluggy desde julho.
  Object.assign(store.connections.get(id)!, { last_synced_at: '2026-10-06T12:00:00.000Z', item_updated_at: '2026-07-01T09:00:00.000Z' });

  // Reautorizado: a Pluggy atualizou o banco hoje às 9h, mas o extrato falha na primeira tentativa.
  const failing = fakePluggy({ [ITEM]: bank }, { transactions: { 'p-conta': new PluggyError('fora', 'unavailable', 502) } });
  const first = await syncAll(deps('user-1', 'casa-1', { pluggy: failing.client }), true);
  assertEquals(first.synced, 0);
  assertEquals(failing.calls.filter((call) => call.startsWith('transactions p-conta')), ['transactions p-conta 2026-06-23']);
  const afterFailure = store.connections.get(id)!;
  // A situação do banco já é a de agora; a marca de até onde buscamos, não.
  assertEquals([afterFailure.status, afterFailure.item_updated_at], ['UPDATED', '2026-07-01T09:00:00.000Z']);

  clock.now = new Date('2026-10-07T12:05:00.000Z');
  const retry = fakePluggy({ [ITEM]: bank });
  assertEquals((await syncAll(deps('user-1', 'casa-1', { pluggy: retry.client }), true)).synced, 1);
  assertEquals(retry.calls.filter((call) => call.startsWith('transactions p-conta')), ['transactions p-conta 2026-06-23']);
  const done = store.connections.get(id)!;
  assertEquals([done.item_updated_at, done.last_synced_at], ['2026-10-07T09:00:00.000Z', '2026-10-07T12:05:00.000Z']);
});

Deno.test('situação do item: lançamentos que não vieram nesta vez (PARTIAL_SUCCESS) seguram a data da última vez que vieram', () => {
  const partial = (transactions: { isUpdated: boolean; lastUpdatedAt: string | null }) => item({ statusDetail: { transactions } });
  assertEquals(itemState(partial({ isUpdated: false, lastUpdatedAt: '2026-07-01T09:00:00.000Z' })).item_updated_at, '2026-07-01T09:00:00.000Z');
  // Nunca vieram: como banco ainda sem dados (a próxima busca 365 dias).
  assertEquals(itemState(partial({ isUpdated: false, lastUpdatedAt: null })).item_updated_at, null);
  assertEquals(itemState(partial({ isUpdated: true, lastUpdatedAt: '2026-10-07T09:00:00.000Z' })).item_updated_at, '2026-10-07T09:00:00.000Z');
});

Deno.test('lançamento marcado como apagado há mais de 30 dias sai de vez', async () => {
  const bank = nubank([pluggyTx('fica', '2026-10-05T15:00:00.000Z'), pluggyTx('some', '2026-10-04T15:00:00.000Z')]);
  const { store, clock, deps, connect } = setup({ [ITEM]: bank });
  await connect();
  await syncAll(deps(), false);
  bank.transactions['p-conta'] = [pluggyTx('fica', '2026-10-05T15:00:00.000Z')];
  clock.now = new Date('2026-10-08T12:00:00.000Z');
  await syncAll(deps(), false);
  assertEquals(store.transactions.get('some')?.deleted_at, '2026-10-08T12:00:00.000Z');
  clock.now = new Date('2026-11-08T12:00:00.000Z');
  await syncAll(deps(), false);
  assertEquals(store.transactions.has('some'), false);
  assert(store.transactions.has('fica'));
});

Deno.test('hash do titular com o segredo da função', async () => {
  const { store, deps, connect } = setup({ [ITEM]: nubank([]) });
  await connect();
  await syncAll(deps(), false);
  assertEquals(store.accounts.get('p-conta')?.owner_doc_hash, await docHash(HASH_KEY, 'user-1', '12345678909'));
});

Deno.test('conectar item que já é de outra pessoa, ou da mesma pessoa em outra casa -> 409', async () => {
  const { store, deps, connect } = setup({ [ITEM]: nubank([]) });
  await connect(ITEM, 'Nubank dele', 'user-2', 'casa-1');
  const spouse = await addItem(deps(), { itemId: ITEM, label: 'Nubank' });
  assertEquals(spouse, { ok: false, status: 409, error: 'Esse banco já está conectado por outra pessoa ou em outra casa.' });
  assertEquals((await addItem(deps('user-2', 'casa-2'), { itemId: ITEM, label: 'Nubank' })).ok, false);
  assertEquals([...store.connections.values()].map((row) => row.label), ['Nubank dele']);
});

Deno.test('conectar com dois toques ao mesmo tempo: o insert que perde usa a conexão que ficou', async () => {
  const { store, deps } = setup({ [ITEM]: nubank([]) });
  const raced = {
    id: 'con-ganhou',
    label: 'Nubank',
    pluggy_item_id: ITEM,
    last_synced_at: null,
    item_updated_at: null,
    user_id: 'user-1',
    household_id: 'casa-1',
  };
  const result = await addItem(deps('user-1', 'casa-1', { db: store.dbFor('user-1', 'casa-1', { raceOnInsert: raced }) }), {
    itemId: ITEM,
    label: 'Nubank',
  });
  assert(result.ok);
  assertEquals(result.connectionId, 'con-ganhou');
  assertEquals(store.connections.size, 1);

  const other = fakeStore();
  const lost = await addItem(
    {
      ...deps(),
      db: other.dbFor('user-1', 'casa-1', { raceOnInsert: { ...raced, user_id: 'user-2' } }),
    },
    { itemId: ITEM, label: 'Nubank' },
  );
  assertEquals(lost.ok ? 0 : lost.status, 409);
});

Deno.test('sincronização que travou e perdeu a vez: a mais velha não apaga o que a mais nova gravou nem volta a hora', async () => {
  const fica = pluggyTx('fica', '2026-10-05T15:00:00.000Z');
  const soVelha = pluggyTx('so-velha', '2026-10-04T15:00:00.000Z');
  const sumiu = pluggyTx('sumiu', '2026-10-03T15:00:00.000Z');
  const nova = pluggyTx('nova', '2026-10-06T15:00:00.000Z');
  const bank = nubank([fica, soVelha, sumiu]);
  const { store, deps, connect } = setup({ [ITEM]: bank });
  await connect();
  await syncAll(deps(), false);

  // A mais velha ainda vê "so-velha"; a mais nova, mais de 10 min depois (a vez da velha venceu), já vê "nova".
  const view = (transactions: PluggyTransaction[]) => fakePluggy({ [ITEM]: { ...bank, transactions: { ...bank.transactions, 'p-conta': transactions } } });
  const older = { pluggy: view([fica, soVelha]).client, now: () => new Date('2026-10-07T19:00:00.000Z') };
  const newer = { pluggy: view([fica, nova]).client, now: () => new Date('2026-10-07T19:10:01.000Z') };
  // A mais velha gravou o extrato e, antes de procurar o que sumiu, a mais nova toma a vez e roda inteira.
  let newerResult: unknown;
  const runNewer = async () => (newerResult = await syncAll(deps('user-1', 'casa-1', newer), false));
  const olderDb = pauseBefore(store.dbFor('user-1', 'casa-1'), 'activeTransactionIds', runNewer);
  assertEquals((await syncAll(deps('user-1', 'casa-1', { ...older, db: olderDb }), false)).errors, []);
  assertEquals(newerResult, { synced: 1, skipped: 0, errors: [] });

  assertEquals(store.transactions.get('nova')?.deleted_at, null);
  assertEquals(store.transactions.get('fica')?.deleted_at, null);
  // O que só a mais velha viu (e o que já tinha sumido) a mais nova ainda apaga.
  assertEquals(store.transactions.get('so-velha')?.deleted_at, '2026-10-07T19:10:01.000Z');
  assertEquals(store.transactions.get('sumiu')?.deleted_at, '2026-10-07T19:10:01.000Z');
  // A mais velha já não tem a vez: não grava a hora dela por cima, e as contas continuam com a hora marcada.
  const connection = [...store.connections.values()][0];
  assertEquals([connection.last_synced_at, connection.sync_started_at], ['2026-10-07T19:10:01.000Z', null]);
  assertEquals([...store.accounts.values()].map((row) => row.updated_at), ['2026-10-07T19:10:01.000Z', '2026-10-07T19:10:01.000Z']);
});

Deno.test('sincronização que travou e perdeu a vez: o que a mais nova regrava entre a leitura e a marca da mais velha fica vivo', async () => {
  const fica = pluggyTx('fica', '2026-10-05T15:00:00.000Z');
  const x = pluggyTx('x', '2026-10-04T15:00:00.000Z');
  const bank = nubank([fica, x]);
  const { store, deps, connect } = setup({ [ITEM]: bank });
  await connect();
  await syncAll(deps(), false);

  // Para a mais velha, "x" sumiu (ela já leu os ativos); a mais nova traz "x" de volta antes da marca.
  const view = (transactions: PluggyTransaction[]) => fakePluggy({ [ITEM]: { ...bank, transactions: { ...bank.transactions, 'p-conta': transactions } } });
  const older = { pluggy: view([fica]).client, now: () => new Date('2026-10-07T19:00:00.000Z') };
  const newer = { pluggy: view([fica, x]).client, now: () => new Date('2026-10-07T19:10:01.000Z') };
  const runNewer = () => syncAll(deps('user-1', 'casa-1', newer), false);
  const olderDb = pauseBefore(store.dbFor('user-1', 'casa-1'), 'markDeleted', runNewer);
  assertEquals((await syncAll(deps('user-1', 'casa-1', { ...older, db: olderDb }), false)).errors, []);

  assertEquals(store.transactions.get('x')?.deleted_at, null);
  assertEquals(store.transactions.get('x')?.updated_at, '2026-10-07T19:10:01.000Z');

  // Sem outra sincronização no meio, a mesma visão apaga "x" normalmente.
  const later = { pluggy: view([fica]).client, now: () => new Date('2026-10-08T02:00:00.000Z') };
  await syncAll(deps('user-1', 'casa-1', later), false);
  assertEquals(store.transactions.get('x')?.deleted_at, '2026-10-08T02:00:00.000Z');
});

Deno.test('reabrir o consultor (ou outro aparelho) enquanto o banco sincroniza: a segunda pula o banco e os saldos continuam aparecendo', async () => {
  const fica = pluggyTx('fica', '2026-10-05T15:00:00.000Z');
  const sumiu = pluggyTx('sumiu', '2026-10-03T15:00:00.000Z');
  const bank = nubank([fica, sumiu]);
  const { store, deps, connect } = setup({ [ITEM]: bank });
  await connect();
  await syncAll(deps(), false);

  const view = (transactions: PluggyTransaction[]) => fakePluggy({ [ITEM]: { ...bank, transactions: { ...bank.transactions, 'p-conta': transactions } } });
  const first = { pluggy: view([fica]).client, now: () => new Date('2026-10-07T19:00:00.000Z') };
  const second = view([fica, sumiu]);
  // A primeira gravou contas e extrato; antes de procurar o que sumiu, o consultor abre de novo.
  let secondResult: unknown;
  const runSecond = async () => {
    secondResult = await syncAll(deps('user-1', 'casa-1', { pluggy: second.client, now: () => new Date('2026-10-07T19:00:05.000Z') }), false);
  };
  const firstDb = pauseBefore(store.dbFor('user-1', 'casa-1'), 'activeTransactionIds', runSecond);
  assertEquals(await syncAll(deps('user-1', 'casa-1', { ...first, db: firstDb }), false), { synced: 1, skipped: 0, errors: [] });

  // A segunda nem chamou a Pluggy nem gravou nada.
  assertEquals(secondResult, { synced: 0, skipped: 1, errors: [] });
  assertEquals(second.calls, []);
  assertEquals(store.transactions.get('sumiu')?.deleted_at, '2026-10-07T19:00:00.000Z');
  // Contas com a mesma hora que o banco marca: os saldos continuam valendo (currentAccounts, no app).
  const connection = [...store.connections.values()][0];
  assertEquals([connection.last_synced_at, connection.sync_started_at], ['2026-10-07T19:00:00.000Z', null]);
  assertEquals([...store.accounts.values()].map((row) => row.updated_at), ['2026-10-07T19:00:00.000Z', '2026-10-07T19:00:00.000Z']);
});

Deno.test('vez presa (a função caiu no meio): espera 10 min e depois é tomada; conectar de novo nesse meio tempo pula', async () => {
  const { store, pluggy, clock, deps, connect } = setup({ [ITEM]: nubank([pluggyTx('t1', '2026-10-05T15:00:00.000Z')]) });
  const { id } = (await connect()) as { id: string };
  store.connections.get(id)!.sync_started_at = '2026-10-07T11:50:00.000Z';

  clock.now = new Date('2026-10-07T11:59:59.000Z');
  assertEquals(await syncAll(deps(), true), { synced: 0, skipped: 1, errors: [] });
  const again = await addItem(deps(), { itemId: ITEM, label: 'Nubank' });
  assertEquals(again, { ok: true, connectionId: id, sync: { synced: 0, skipped: 1, errors: [] } });
  // Só o getItem do conectar: nada de contas nem extrato.
  assertEquals(pluggy.calls, [`item ${ITEM}`]);
  assertEquals(store.connections.get(id)?.sync_started_at, '2026-10-07T11:50:00.000Z');

  clock.now = new Date('2026-10-07T12:00:01.000Z');
  assertEquals(await syncAll(deps(), true), { synced: 1, skipped: 0, errors: [] });
  assertEquals([store.connections.get(id)?.last_synced_at, store.connections.get(id)?.sync_started_at], ['2026-10-07T12:00:01.000Z', null]);
  assert(store.transactions.has('t1'));
});

Deno.test('conectar depois que a liberação foi tirada (o banco recusa a linha) -> 403, sem sincronizar', async () => {
  const { store, pluggy, deps } = setup({ [ITEM]: nubank([pluggyTx('t1', '2026-10-05T15:00:00.000Z')]) });
  const result = await addItem(deps('user-1', 'casa-1', { db: store.dbFor('user-1', 'casa-1', { revoked: true }) }), {
    itemId: ITEM,
    label: 'Nubank',
  });
  assertEquals(result, { ok: false, status: 403, error: NOT_ALLOWED });
  assertEquals(NOT_ALLOWED, 'O consultor financeiro não está liberado para você nesta casa.');
  assertEquals(store.connections.size, 0);
  assertEquals(pluggy.calls, [`item ${ITEM}`]);
});

Deno.test('log sem dados do extrato: do erro do banco fica só código e mensagem', () => {
  const postgrest = { code: '23514', message: 'violates check constraint', details: 'Failing row contains (Fulana de Tal, ...)', hint: null };
  assertEquals(errorForLog(postgrest), { code: '23514', message: 'violates check constraint' });
  assertEquals(errorForLog(new PluggyError('x', 'not_found', 404, 'Item not found')), { pluggy: 'not_found', status: 404, detail: 'Item not found' });
  const plain = new Error('timeout');
  assertEquals(errorForLog(plain), plain);
});

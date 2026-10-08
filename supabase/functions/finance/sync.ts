// Sincronização dos bancos (itens do MeuPluggy) para as tabelas privadas
// fin_*. Sem webhooks: o app pede ao abrir o consultor (só se passou de 6 h)
// e no "Atualizar" (no máximo a cada 2 min por banco, também ao colar de novo
// o mesmo Item ID). Enquanto a Pluggy não tem os dados do banco, puxa 365
// dias; depois, uma janela que começa uma semana antes do que já veio (no
// mínimo 60 dias), que também marca como apagado o que sumiu da Pluggy
// (lançamento desfeito, ou previsto que virou outro). Uma sincronização por
// banco de cada vez (fin_claim_sync); a outra pula o banco. Erro em um banco
// não para os outros. Testado em sync.test.ts com uma Pluggy e um banco falsos.

import { type PluggyClient, PluggyError, type PluggyItem } from '../_shared/pluggy.ts';
import { addDays, type FinAccountRow, type FinTransactionRow, mapAccount, mapTransaction, saoPauloDate } from './map.ts';

export const FIRST_SYNC_DAYS = 365;
export const ROLLING_SYNC_DAYS = 60;
/** Folga antes do que já veio: lançamento que a Pluggy traz com alguns dias de atraso. */
export const OVERLAP_DAYS = 7;
export const AUTO_SYNC_AFTER_MS = 6 * 60 * 60 * 1000;
export const FORCED_SYNC_AFTER_MS = 2 * 60 * 1000;
/** Lançamento marcado como apagado há mais que isso sai de vez da tabela. */
export const PURGE_DELETED_AFTER_DAYS = 30;
const UPSERT_CHUNK = 500;

export interface FinConnectionRef {
  id: string;
  label: string;
  pluggy_item_id: string;
  /** Última sincronização que trouxe contas (só ela marca). */
  last_synced_at: string | null;
  /** Quando a Pluggy tinha atualizado o banco, na última sincronização (null: ainda sem dados). */
  item_updated_at: string | null;
}

export interface FinConnectionOwnerRef extends FinConnectionRef {
  user_id: string;
  household_id: string;
}

/** Situação do item na Pluggy, como fica em fin_connections. */
export interface ItemState {
  status: string | null;
  error_message: string | null;
  item_updated_at: string | null;
}

export type ConnectionPatch = Partial<ItemState> & { label?: string };

/** O que uma sincronização inteira grava no fim: até quando já buscamos. */
export interface SyncDone {
  last_synced_at: string;
  item_updated_at: string | null;
}

/**
 * O banco visto pela função, com a chave de serviço. Tudo, menos
 * findConnectionByItem, fica preso à pessoa e à casa de quem chamou.
 */
export interface FinanceDb {
  listConnections(): Promise<FinConnectionRef[]>;
  /** Procura em todas as casas: o mesmo item não entra duas vezes. */
  findConnectionByItem(itemId: string): Promise<FinConnectionOwnerRef | null>;
  /**
   * 'conflict' quando outro pedido gravou o mesmo item antes (unique);
   * 'not_allowed' quando a liberação (beta_access) já não existe (foreign key).
   */
  insertConnection(row: ItemState & { label: string; pluggy_item_id: string }): Promise<{ id: string } | 'conflict' | 'not_allowed'>;
  updateConnection(id: string, patch: ConnectionPatch): Promise<void>;
  /**
   * Pega a vez de sincronizar o banco (sync_started_at = at), numa instrução
   * só: false quando outra sincronização dele está rodando (começou há menos
   * de 10 min).
   */
  claimSync(id: string, at: string): Promise<boolean>;
  /**
   * Devolve a vez (sync_started_at = null) e grava `done`, só se a vez ainda é
   * desta sincronização (sync_started_at = at): a que travou e perdeu a vez
   * não grava hora velha por cima da mais nova.
   */
  releaseSync(id: string, at: string, done?: SyncDone): Promise<void>;
  upsertAccounts(rows: FinAccountRow[]): Promise<{ id: string; pluggy_account_id: string }[]>;
  /** Grava cada linha como veio, com o updated_at dela (a hora da sincronização que a trouxe). */
  upsertTransactions(rows: FinTransactionRow[]): Promise<void>;
  /**
   * Ids da Pluggy dos lançamentos não apagados da conta com occurred_on >=
   * fromDate gravados antes desta sincronização (updated_at < runAt).
   */
  activeTransactionIds(accountId: string, fromDate: string, runAt: string): Promise<string[]>;
  /**
   * Marca como apagados (deleted_at e updated_at = at) só os que ainda têm
   * updated_at < at, na mesma instrução: o que outra sincronização mais nova
   * regravou entre a leitura e esta marca fica vivo.
   */
  markDeleted(accountId: string, pluggyIds: string[], at: string): Promise<void>;
  /** Apaga de vez os lançamentos da conta marcados como apagados antes de `before`. */
  purgeDeleted(accountId: string, before: string): Promise<void>;
}

export interface SyncDeps {
  db: FinanceDb;
  pluggy: PluggyClient;
  userId: string;
  householdId: string;
  /** Segredo dos hashes de CPF/CNPJ (FIN_DOC_HASH_KEY). */
  hashKey: string;
  now: () => Date;
}

export interface SyncError {
  connectionId: string;
  label: string;
  message: string;
}

export interface SyncSummary {
  synced: number;
  skipped: number;
  errors: SyncError[];
}

export type FinanceRequest = { action: 'sync'; force: boolean } | { action: 'add_item'; itemId: string; label: string };

export type AddItemResult =
  | { ok: true; connectionId: string; sync: SyncSummary }
  | { ok: false; status: number; error: string };

const ITEM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const LABEL_MAX = 40;

export function parseFinanceRequest(body: unknown): FinanceRequest | string {
  const input = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (input.action === 'sync') return { action: 'sync', force: input.force === true };
  if (input.action === 'add_item') {
    const itemId = typeof input.itemId === 'string' ? input.itemId.trim().toLowerCase() : '';
    if (!ITEM_ID.test(itemId)) {
      return 'Cole o Item ID copiado no Dashboard da Pluggy (um código como 1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d).';
    }
    const label = typeof input.label === 'string' ? input.label.trim().replace(/\s+/g, ' ') : '';
    if (!label || label.length > LABEL_MAX) return `Dê um nome de até ${LABEL_MAX} letras para o banco (ex.: Nubank).`;
    return { action: 'add_item', itemId, label };
  }
  return 'Pedido inválido.';
}

/** Se já é hora de sincronizar: 6 h desde a última, ou 2 min quando a pessoa pede. */
export function shouldSync(lastSyncedAt: string | null, now: Date, force: boolean): boolean {
  if (!lastSyncedAt) return true;
  const last = Date.parse(lastSyncedAt);
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= (force ? FORCED_SYNC_AFTER_MS : AUTO_SYNC_AFTER_MS);
}

/**
 * Primeiro dia (AAAA-MM-DD) a buscar na Pluggy. Sem dados ainda (nunca
 * sincronizou, ou a Pluggy ainda não tinha atualizado o banco: o MeuPluggy
 * recém-autorizado chega vazio), 365 dias. Depois, uma semana antes do mais
 * velho entre a última sincronização e a última atualização do banco na
 * Pluggy, no mínimo 60 dias e no máximo 365: quem fica meses sem abrir o
 * consultor (ou banco parado que volta) não perde o meio do caminho.
 */
export function syncWindowStart(lastSyncedAt: string | null, itemUpdatedAt: string | null, now: Date): string {
  const today = saoPauloDate(now);
  const first = addDays(today, -FIRST_SYNC_DAYS);
  const synced = lastSyncedAt ? Date.parse(lastSyncedAt) : NaN;
  const updated = itemUpdatedAt ? Date.parse(itemUpdatedAt) : NaN;
  if (Number.isNaN(synced) || Number.isNaN(updated)) return first;
  const covered = addDays(saoPauloDate(new Date(Math.min(synced, updated))), -OVERLAP_DAYS);
  const rolling = addDays(today, -ROLLING_SYNC_DAYS);
  const start = covered < rolling ? covered : rolling;
  return start > first ? start : first;
}

const timestamp = (value: unknown) => (typeof value === 'string' ? Date.parse(value) : NaN);

/**
 * Situação do item. item_updated_at é até quando a Pluggy tem os lançamentos:
 * a última atualização do banco, ou, quando os lançamentos não vieram nesta
 * vez (PARTIAL_SUCCESS), a última vez que vieram (null se nunca vieram).
 */
export function itemState(item: PluggyItem): ItemState {
  let updated = timestamp(item.lastUpdatedAt);
  const transactions = item.statusDetail?.transactions;
  if (transactions && transactions.isUpdated === false) updated = Math.min(updated, timestamp(transactions.lastUpdatedAt));
  const message = item.error?.message;
  return {
    status: typeof item.status === 'string' && item.status ? item.status : null,
    error_message: typeof message === 'string' && message.trim() ? message.trim().slice(0, 500) : null,
    item_updated_at: Number.isNaN(updated) ? null : new Date(updated).toISOString(),
  };
}

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * Busca e grava um banco. 'busy' quando outra sincronização dele está
 * rodando (nada é buscado nem gravado). Erros sobem (quem chama junta por
 * banco), depois de devolver a vez.
 */
export async function syncConnection(connection: FinConnectionRef, deps: SyncDeps, knownItem?: PluggyItem): Promise<'synced' | 'busy'> {
  const at = deps.now().toISOString();
  if (!(await deps.db.claimSync(connection.id, at))) return 'busy';
  let done: SyncDone | undefined;
  try {
    done = await fetchAndStore(connection, deps, at, knownItem);
  } catch (err) {
    // A vez volta mesmo com erro: o próximo "Atualizar" não espera os 10 min.
    await deps.db.releaseSync(connection.id, at).catch((releaseErr) => {
      console.error('finance release failed', connection.id, errorForLog(releaseErr));
    });
    throw err;
  }
  await deps.db.releaseSync(connection.id, at, done);
  return 'synced';
}

/**
 * O trabalho de syncConnection, com a vez já pega. Só devolve o que marcar
 * (last_synced_at) quando a Pluggy devolveu alguma conta: item recém-criado,
 * ainda vazio, não conta como sincronizado (a próxima vez busca de novo).
 * A situação do banco (status, erro) é gravada na hora; item_updated_at, que
 * diz até quando já buscamos, só junto com last_synced_at, no fim de uma
 * sincronização inteira: se ela falha no meio, a próxima ainda volta até o
 * banco parado (sem buraco).
 */
async function fetchAndStore(
  connection: FinConnectionRef,
  deps: SyncDeps,
  at: string,
  knownItem?: PluggyItem,
): Promise<SyncDone | undefined> {
  const now = new Date(at);
  const owner = { userId: deps.userId, householdId: deps.householdId, now: at, hashKey: deps.hashKey };

  const item = knownItem ?? (await deps.pluggy.getItem(connection.pluggy_item_id));
  const state = itemState(item);
  await deps.db.updateConnection(connection.id, { status: state.status, error_message: state.error_message });

  // Pela situação de antes desta sincronização (a de agora só fica gravada no fim).
  const dateFrom = syncWindowStart(connection.last_synced_at, connection.item_updated_at, now);
  const accounts = (
    await Promise.all(
      (await deps.pluggy.listAccounts(connection.pluggy_item_id)).map((account) =>
        mapAccount(account, { ...owner, connectionId: connection.id })
      ),
    )
  ).filter((row): row is FinAccountRow => row !== null);
  const saved = accounts.length ? await deps.db.upsertAccounts(accounts) : [];
  const accountIds = new Map(saved.map((row) => [row.pluggy_account_id, row.id]));

  const purgeBefore = new Date(now.getTime() - PURGE_DELETED_AFTER_DAYS * 86_400_000).toISOString();
  for (const account of accounts) {
    const accountId = accountIds.get(account.pluggy_account_id);
    if (!accountId) throw new Error(`account ${account.pluggy_account_id} was not saved`);
    // Um dia antes do dateFrom: o dia de São Paulo de um lançamento pode cair
    // fora do dia que a Pluggy usa no filtro, e a conferência abaixo começa
    // no próprio dateFrom (a janela anda um dia por vez: o que some na borda
    // não pode ficar para trás).
    const transactions = await deps.pluggy.listTransactions(account.pluggy_account_id, { dateFrom: addDays(dateFrom, -1) });

    // Por id: o mesmo lançamento duas vezes no lote derruba o upsert. Cada
    // linha leva updated_at = at (owner.now), a marca desta sincronização.
    const rows = new Map<string, FinTransactionRow>();
    const returned = new Set<string>();
    for (const tx of transactions) {
      if (typeof tx?.id === 'string') returned.add(tx.id);
      const row = await mapTransaction(tx, { ...owner, accountId, accountCurrency: account.currency_code });
      if (row) rows.set(row.pluggy_transaction_id, { ...row, updated_at: at });
    }
    for (const batch of chunks([...rows.values()], UPSERT_CHUNK)) await deps.db.upsertTransactions(batch);

    // Só depois do extrato inteiro, desde o dateFrom (a busca começou um dia
    // antes, então tudo dali para a frente veio). Só o que foi gravado antes desta sincronização (updated_at < at): se uma
    // sincronização travou mais de 10 min e outra tomou a vez dela, a mais
    // velha não apaga o que a mais nova acabou de gravar; o que só a mais
    // velha viu, a mais nova ainda apaga.
    const active = await deps.db.activeTransactionIds(accountId, dateFrom, at);
    const gone = active.filter((id) => !returned.has(id));
    if (gone.length) await deps.db.markDeleted(accountId, gone, at);
    await deps.db.purgeDeleted(accountId, purgeBefore);
  }

  // A mesma hora das contas gravadas: conta com hora mais velha sumiu da Pluggy (currentAccounts, no app).
  return accounts.length ? { last_synced_at: at, item_updated_at: state.item_updated_at } : undefined;
}

/**
 * O erro para o log, sem dados do extrato: erro do banco (PostgREST) traz a
 * linha recusada em `details`; fica só o código e a mensagem.
 */
export function errorForLog(err: unknown): unknown {
  if (err instanceof PluggyError) return { pluggy: err.code, status: err.status, detail: err.detail };
  if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
    return { code: (err as { code: unknown }).code, message: (err as { message: unknown }).message };
  }
  return err;
}

/** Mensagem do erro de um banco, para a pessoa. */
export function syncErrorMessage(err: unknown): string {
  if (err instanceof PluggyError) return err.message;
  return 'Não consegui atualizar este banco agora. Tente de novo.';
}

/** Sincroniza cada banco; o que outra sincronização está rodando conta como pulado. */
async function syncEach(
  connections: FinConnectionRef[],
  deps: SyncDeps,
  knownItem?: PluggyItem,
): Promise<{ synced: number; busy: number; errors: SyncError[] }> {
  const results = await Promise.all(
    connections.map(async (connection) => {
      try {
        return await syncConnection(connection, deps, knownItem);
      } catch (err) {
        console.error('finance sync failed', connection.id, errorForLog(err));
        return { connectionId: connection.id, label: connection.label, message: syncErrorMessage(err) };
      }
    }),
  );
  return {
    synced: results.filter((result) => result === 'synced').length,
    busy: results.filter((result) => result === 'busy').length,
    errors: results.filter((result): result is SyncError => typeof result === 'object'),
  };
}

/** Sincroniza os bancos da pessoa na casa aberta que estão na hora. */
export async function syncAll(deps: SyncDeps, force: boolean): Promise<SyncSummary> {
  const connections = await deps.db.listConnections();
  const now = deps.now();
  const due = connections.filter((connection) => shouldSync(connection.last_synced_at, now, force));
  const { synced, busy, errors } = await syncEach(due, deps);
  return { synced, skipped: connections.length - due.length + busy, errors };
}

const ALREADY_CONNECTED = 'Esse banco já está conectado por outra pessoa ou em outra casa.';
export const NOT_ALLOWED = 'O consultor financeiro não está liberado para você nesta casa.';

/**
 * Grava o item para a pessoa nesta casa. 'taken' se ele já é de outra pessoa
 * ou casa; 'not_allowed' se a liberação foi tirada depois da conferência do
 * começo do pedido (o banco recusa a linha sem ela).
 */
async function claimConnection(
  deps: SyncDeps,
  request: { itemId: string; label: string },
  item: PluggyItem,
): Promise<FinConnectionRef | 'taken' | 'not_allowed'> {
  const existing = await deps.db.findConnectionByItem(request.itemId);
  if (!existing) {
    const inserted = await deps.db.insertConnection({ label: request.label, pluggy_item_id: request.itemId, ...itemState(item) });
    if (inserted === 'not_allowed') return inserted;
    if (inserted !== 'conflict') {
      return { id: inserted.id, label: request.label, pluggy_item_id: request.itemId, last_synced_at: null, item_updated_at: null };
    }
  }
  // Já existia, ou outro pedido gravou antes (dois toques no botão): vale o que ficou.
  const current = existing ?? (await deps.db.findConnectionByItem(request.itemId));
  if (!current || current.user_id !== deps.userId || current.household_id !== deps.householdId) return 'taken';
  if (current.label !== request.label) await deps.db.updateConnection(current.id, { label: request.label });
  return {
    id: current.id,
    label: request.label,
    pluggy_item_id: current.pluggy_item_id,
    last_synced_at: current.last_synced_at,
    item_updated_at: current.item_updated_at,
  };
}

const NOT_FOUND = 'Não achei esse Item ID na Pluggy. Copie de novo no Dashboard da Pluggy: Items, ⋮ no card do banco, "Copiar Item ID".';

/**
 * Conecta um item do MeuPluggy: confere na Pluggy, grava (ou só troca o nome,
 * se a pessoa já tinha esse item nesta casa) e sincroniza na hora. Colar de
 * novo um item já sincronizado respeita o intervalo do "Atualizar".
 */
export async function addItem(deps: SyncDeps, request: { itemId: string; label: string }): Promise<AddItemResult> {
  let item: PluggyItem;
  try {
    item = await deps.pluggy.getItem(request.itemId);
  } catch (err) {
    if (!(err instanceof PluggyError)) throw err;
    if (err.code === 'not_found') return { ok: false, status: 404, error: NOT_FOUND };
    return { ok: false, status: err.code === 'credentials' ? 503 : 502, error: err.message };
  }

  const connection = await claimConnection(deps, request, item);
  if (connection === 'taken') return { ok: false, status: 409, error: ALREADY_CONNECTED };
  if (connection === 'not_allowed') return { ok: false, status: 403, error: NOT_ALLOWED };
  if (!shouldSync(connection.last_synced_at, deps.now(), true)) {
    return { ok: true, connectionId: connection.id, sync: { synced: 0, skipped: 1, errors: [] } };
  }
  const { synced, busy, errors } = await syncEach([connection], deps, item);
  return { ok: true, connectionId: connection.id, sync: { synced, skipped: busy, errors } };
}

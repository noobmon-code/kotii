// Consultor financeiro (beta): a liberação (beta_access), os bancos
// conectados pelo MeuPluggy (tabelas fin_*, só leitura), a sincronização
// (função `finance`) e a conversa com o Nuke consultor (`nuke-finance`).
//
// Dados do banco ficam só na memória: nenhuma chave daqui entra em PERSISTED
// (lib/queryClient). As chaves levam a pessoa e a casa: a liberação é de uma
// pessoa numa casa, e o cônjuge nunca vê nada disso.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { useEffect, useMemo } from 'react';

import { useBudgets, useSaveBudgets } from '@/data/finance';
import { functionErrorMessage } from '@/data/images';
import { kotiiRecordsFrom, kotiiRecordsStart, type KotiiRecord } from '@/domain/bankMatch';
import {
  financeFetchStart,
  financeInstallmentFetchStart,
  financeWindowStart,
  groupPurchases,
  isParcel,
} from '@/domain/bankMonth';
import type { FinCategoryRule } from '@/domain/bankRules';
import { toISODate } from '@/domain/dates';
import { getFinanceCategory, type FinanceCategory } from '@/domain/finance';
import {
  buildFinanceSnapshot,
  parseFinanceActions,
  type FinanceAction,
  type FinanceScreen,
} from '@/domain/financeAdvisor';
import { formatBRL } from '@/domain/money';
import { useAuth, useHousehold } from '@/lib/auth';
import { supabase, unwrap } from '@/lib/supabase';
import type { FinAccount, FinConnection, FinTransaction } from '@/lib/types';

export type BetaFeature = 'finance';

/** Pessoa e casa abertas; null enquanto a casa não carregou. */
function useScope(): [string, string] | null {
  const userId = useAuth().session?.user.id;
  const householdId = useHousehold().data?.household.id;
  return userId && householdId ? [userId, householdId] : null;
}

/** A pessoa tem a liberação nesta casa (rpc has_beta, na casa aberta no aparelho). */
export function useBeta(feature: BetaFeature) {
  const scope = useScope();
  return useQuery({
    queryKey: ['beta', feature, ...(scope ?? [])],
    enabled: Boolean(scope),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('has_beta', { p_feature: feature });
      if (error) throw error;
      return data === true;
    },
  });
}

/** Chave das consultas fin_*; sem a liberação, nada é buscado. */
function useFinScope() {
  const scope = useScope();
  const allowed = useBeta('finance').data === true;
  return { key: scope ?? [], enabled: Boolean(scope) && allowed };
}

function useInvalidateFin() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['fin'] });
}

// ---------------------------------------------------------------------------
// Leitura (RLS: só a própria pessoa, na casa aberta, com a liberação)

/** O PostgREST corta em 1000 linhas (max_rows padrão do Supabase). */
const PAGE = 1000;

/** Busca página por página até vir uma incompleta. */
export async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const rows = (unwrap(await page(from, from + PAGE - 1)) ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** numeric pode chegar como texto: vira número (ou null). */
const num = (value: unknown): number | null => (value == null || value === '' ? null : Number(value));

export function toFinAccount(row: FinAccount): FinAccount {
  return {
    ...row,
    balance: num(row.balance),
    credit_limit: num(row.credit_limit),
    available_credit: num(row.available_credit),
    minimum_payment: num(row.minimum_payment),
  };
}

export function toFinTransaction(row: FinTransaction): FinTransaction {
  return {
    ...row,
    amount: Number(row.amount),
    original_amount: num(row.original_amount),
    installment_number: num(row.installment_number),
    total_installments: num(row.total_installments),
  };
}

const CONNECTION_COLUMNS = 'id, label, pluggy_item_id, status, error_message, item_updated_at, last_synced_at, created_at';
const ACCOUNT_COLUMNS =
  'id, connection_id, pluggy_account_id, type, subtype, name, marketing_name, number_last4, owner_doc_hash, balance, currency_code, credit_limit, available_credit, bill_due_date, bill_close_date, minimum_payment, updated_at';
const TRANSACTION_COLUMNS =
  'id, account_id, pluggy_transaction_id, status, direction, amount, original_amount, original_currency, occurred_on, purchase_on, description, description_raw, category_id, category, operation_type, payment_method, merchant_name, merchant_cnpj, counterparty_name, counterparty_doc_kind, counterparty_doc_hash, counterparty_cnpj, boleto_barcode, installment_number, total_installments, card_bill_id, bill_forecast, other_credits_type, fee_type, deleted_at, first_seen_at, updated_at';

export function useFinConnections() {
  const { key, enabled } = useFinScope();
  return useQuery({
    queryKey: ['fin', 'connections', ...key],
    enabled,
    queryFn: async () =>
      unwrap(await supabase.from('fin_connections').select(CONNECTION_COLUMNS).order('created_at')) as FinConnection[],
  });
}

export function useFinAccounts() {
  const { key, enabled } = useFinScope();
  return useQuery({
    queryKey: ['fin', 'accounts', ...key],
    enabled,
    queryFn: async () =>
      (unwrap(await supabase.from('fin_accounts').select(ACCOUNT_COLUMNS).order('type').order('id')) as FinAccount[]).map(
        toFinAccount,
      ),
  });
}

/**
 * Lançamentos com data no banco a partir de `fromDate` e, de antes, desde
 * `installmentsFrom`, só as parcelas e os créditos dos cartões (`cardIds`:
 * o estorno de uma compra parcelada antiga ainda abate as parcelas dela). Os
 * apagados na Pluggy ficam de fora, menos a parcela prevista que virou
 * lançada (groupPurchases só usa a chave dela). `cardIds` null: as contas
 * ainda não carregaram.
 */
export function useFinTransactions(fromDate: string, installmentsFrom: string, cardIds: string[] | null) {
  const { key, enabled } = useFinScope();
  return useQuery({
    queryKey: ['fin', 'transactions', ...key, fromDate, installmentsFrom, ...(cardIds ?? [])],
    enabled: enabled && cardIds !== null,
    queryFn: async () =>
      (
        await fetchAllPages<FinTransaction>((from, to) =>
          supabase
            .from('fin_transactions')
            .select(TRANSACTION_COLUMNS)
            .gte('occurred_on', installmentsFrom)
            .or(transactionsFilter(fromDate, cardIds ?? []))
            .order('occurred_on', { ascending: false })
            .order('id')
            .range(from, to),
        )
      ).map(toFinTransaction),
  });
}

/**
 * O filtro (PostgREST) de useFinTransactions, depois do `installmentsFrom`:
 * tudo desde `fromDate`; antes, a parcela de verdade (n de N, com N > 1,
 * como isParcel em bankMonth) e o crédito dos cartões. Dos apagados na
 * Pluggy, só a parcela prevista que o banco trocou pela lançada: ela guarda
 * a escolha "Só esta" feita antes de a parcela ser lançada.
 */
export function transactionsFilter(fromDate: string, cardIds: readonly string[]): string {
  const parcel = 'installment_number.not.is.null,total_installments.gt.1';
  const before = [`and(${parcel})`, ...(cardIds.length ? [`and(direction.eq.CREDIT,account_id.in.(${cardIds.join(',')}))`] : [])];
  return `and(deleted_at.is.null,or(occurred_on.gte.${fromDate},${before.join(',')})),and(status.eq.PENDING,${parcel})`;
}

/**
 * Ids das parcelas que guardam uma escolha "Só esta" ou uma marca de Saúde
 * (`p:parc-<id>`) e não vieram em `transactions`: a parcela de uma compra
 * parcelada mais longa que a busca (36x, 48x) sai dela antes de a compra
 * acabar, e a escolha se perderia.
 */
export function ruleParcelIds(matchKeys: readonly string[], transactions: readonly Pick<FinTransaction, 'id'>[]): string[] {
  const have = new Set(transactions.map((t) => t.id));
  const ids = new Set<string>();
  for (const key of matchKeys) {
    const id = key.startsWith('p:parc-') ? key.slice('p:parc-'.length) : null;
    if (id && !have.has(id)) ids.add(id);
  }
  return [...ids].sort();
}

/** O PostgREST aceita uma lista de ids no endereço até um tamanho: busca em partes. */
const IDS_PER_REQUEST = 100;

/** As parcelas de ruleParcelIds, em qualquer data (null: ainda não se sabe quais). */
export function useFinRuleParcels(ids: string[] | null) {
  const { key, enabled } = useFinScope();
  return useQuery({
    queryKey: ['fin', 'ruleParcels', ...key, ...(ids ?? [])],
    enabled: enabled && ids !== null,
    queryFn: async () => {
      const out: FinTransaction[] = [];
      const all = ids ?? [];
      for (let i = 0; i < all.length; i += IDS_PER_REQUEST) {
        const chunk = all.slice(i, i + IDS_PER_REQUEST);
        out.push(...(unwrap(await supabase.from('fin_transactions').select(TRANSACTION_COLUMNS).in('id', chunk)) as FinTransaction[]));
      }
      return out.map(toFinTransaction);
    },
  });
}

/**
 * Categorias que a pessoa escolheu para os lançamentos e o que ela já pôs em
 * Saúde algum dia (só dela, nesta casa). As marcas de Saúde vêm na mesma
 * consulta: escolher uma categoria recarrega as duas juntas.
 */
export function useFinCategoryRules() {
  const { key, enabled } = useFinScope();
  return useQuery({
    queryKey: ['fin', 'rules', ...key],
    enabled,
    queryFn: async () => {
      const [rules, sensitive] = await Promise.all([
        fetchAllPages<FinCategoryRule>((from, to) =>
          supabase.from('fin_category_rules').select('match_key, category').order('match_key').range(from, to),
        ),
        fetchAllPages<{ match_key: string }>((from, to) =>
          supabase.from('fin_sensitive_keys').select('match_key').order('match_key').range(from, to),
        ),
      ]);
      return { rules, sensitiveKeys: sensitive.map((k) => k.match_key) };
    },
  });
}

/**
 * Escolhe a categoria de uma compra ou das parecidas (match_key de bankRules).
 * Na escolha só para uma compra, `similarKey` são as parecidas dela: em Saúde,
 * o banco marca as duas, e o sigilo segue a loja mesmo se o lançamento mudar de id.
 */
export function useSetCategoryRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      matchKey,
      category,
      similarKey = null,
    }: {
      matchKey: string;
      category: FinanceCategory;
      similarKey?: string | null;
    }) => {
      unwrap(
        await supabase
          .from('fin_category_rules')
          .upsert(
            { match_key: matchKey, category, similar_key: similarKey, updated_at: new Date().toISOString() },
            { onConflict: 'user_id,household_id,match_key' },
          ),
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['fin', 'rules'] }),
  });
}

/**
 * Grava a chave das parecidas numa escolha de Saúde só para uma compra, se ela
 * ainda for Saúde: não volta uma troca feita em outro aparelho nem recria uma
 * escolha desfeita. O gatilho do banco marca as duas chaves.
 */
export async function repairSimilarMark(matchKey: string, similarKey: string): Promise<void> {
  unwrap(
    await supabase
      .from('fin_category_rules')
      .update({ similar_key: similarKey })
      .eq('match_key', matchKey)
      .eq('category', 'saude'),
  );
}

/** Por escolha: em andamento, feita, ou quantas vezes já falhou. */
export type RepairState = Map<string, 'running' | 'done' | number>;

export const REPAIR_TRIES = 3;

/**
 * Começa os reparos que faltam (nem em andamento, nem feitos, nem com falhas
 * demais). Um que falhe pode ser tentado de novo na próxima chamada, até
 * REPAIR_TRIES vezes enquanto o app está aberto.
 */
export function runRepairs(
  missing: readonly { matchKey: string; similarKey: string }[],
  state: RepairState,
  save: (matchKey: string, similarKey: string) => Promise<void>,
  onSaved: () => void,
): void {
  for (const { matchKey, similarKey } of missing) {
    const tries = state.get(matchKey) ?? 0;
    if (typeof tries !== 'number' || tries >= REPAIR_TRIES) continue;
    state.set(matchKey, 'running');
    save(matchKey, similarKey).then(
      () => {
        state.set(matchKey, 'done');
        onSaved();
      },
      () => state.set(matchKey, tries + 1),
    );
  }
}

const repairState: RepairState = new Map();

/**
 * Marca as parecidas das escolhas de Saúde só para uma compra que ainda não as
 * marcaram (missingSimilarMarks, em bankRules): assim o sigilo segue a loja
 * mesmo quando o lançamento ganha outro id. Uma falha é tentada de novo quando
 * os dados do consultor mudam (a sincronização ao abrir, outro mês).
 */
export function useRepairSimilarMarks(missing: readonly { matchKey: string; similarKey: string }[] | undefined) {
  const queryClient = useQueryClient();
  useEffect(() => {
    runRepairs(missing ?? [], repairState, repairSimilarMark, () => {
      void queryClient.invalidateQueries({ queryKey: ['fin', 'rules'] });
    });
  }, [missing, queryClient]);
}

/** Desfaz escolhas: a compra volta para a categoria das parecidas ou a automática. */
export function useRemoveCategoryRules() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (matchKeys: string[]) => {
      if (matchKeys.length) unwrap(await supabase.from('fin_category_rules').delete().in('match_key', matchKeys));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['fin', 'rules'] }),
  });
}

type ReceiptRow = { id: string; purchased_at: string; total: number | null; store: { name: string | null; cnpj: string | null } | null };
type PaymentRow = { id: string; paid_on: string; amount: number; bill: { name: string } | null };
type ExpenseRow = { id: string; spent_on: string; amount: number; description: string };

/**
 * Notas confirmadas, contas pagas e gastos avulsos desde `fromDate`, para a
 * conferência com o banco; null enquanto não se sabe desde quando. Quando a
 * data muda (chegou uma compra parcelada mais antiga), a tela e o Nuke
 * esperam a busca nova: a da data anterior deixaria a compra "só no banco".
 */
export function useFinKotiiRecords(fromDate: string | null) {
  const { enabled } = useFinScope();
  return useQuery({
    // Começa com 'spending': confirmar nota, pagar conta ou salvar gasto já recarrega.
    queryKey: ['spending', 'bankMatch', fromDate],
    enabled: enabled && fromDate !== null,
    queryFn: async (): Promise<KotiiRecord[]> => {
      const since = fromDate as string;
      // Data da compra no fuso do aparelho, como no resumo (useSpending).
      const [y, m, d] = since.split('-').map(Number);
      const startAt = new Date(y, m - 1, d).toISOString();
      // Desde a compra parcelada mais antiga, pode passar das 1000 linhas que o PostgREST devolve de uma vez.
      const [receipts, payments, expenses] = await Promise.all([
        fetchAllPages<ReceiptRow>((from, to) =>
          supabase
            .from('receipts')
            .select('id, purchased_at, total, store:stores(name, cnpj)')
            .eq('status', 'confirmed')
            .gte('purchased_at', startAt)
            .order('purchased_at')
            .order('id')
            .range(from, to),
        ),
        fetchAllPages<PaymentRow>((from, to) =>
          supabase
            .from('bill_payments')
            .select('id, paid_on, amount, bill:bills(name)')
            .gte('paid_on', since)
            .order('paid_on')
            .order('id')
            .range(from, to),
        ),
        fetchAllPages<ExpenseRow>((from, to) =>
          supabase
            .from('expenses')
            .select('id, spent_on, amount, description')
            .gte('spent_on', since)
            .order('spent_on')
            .order('id')
            .range(from, to),
        ),
      ]);
      return kotiiRecordsFrom({
        receipts: receipts.map((r) => ({
          id: r.id,
          date: toISODate(new Date(r.purchased_at)),
          total: num(r.total),
          store: r.store?.name ?? null,
          cnpj: r.store?.cnpj ?? null,
        })),
        payments: payments.map((p) => ({
          id: p.id,
          paid_on: p.paid_on,
          amount: Number(p.amount),
          bill_name: p.bill?.name ?? 'Conta',
        })),
        expenses: expenses.map((e) => ({ ...e, amount: Number(e.amount) })),
      });
    },
  });
}

// Janela do consultor (o mês de hoje e os dois anteriores), o ciclo de fatura buscado antes dela e o começo
// das parcelas buscadas.
export { financeFetchStart, financeInstallmentFetchStart, financeWindowStart };

export interface FinanceData {
  connections: FinConnection[];
  accounts: FinAccount[];
  transactions: FinTransaction[];
  budgets: { category: string; monthly_limit: number }[];
  kotiiRecords: KotiiRecord[];
  categoryRules: FinCategoryRule[];
  /** match_key que um dia foi Saúde: a compra continua só somada para a IA. */
  sensitiveKeys: string[];
}

export type FinanceDataState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown; retry: () => void }
  | { status: 'ready'; data: FinanceData };

/**
 * Tudo o que o consultor usa, na janela de `financeWindowStart(today)`. Os
 * lançamentos vêm desde um ciclo de fatura antes (`financeFetchStart`), só
 * para juntar parcelas e pares que começaram antes da janela, e as parcelas
 * (com os créditos dos cartões, onde caem os estornos delas) desde bem antes
 * (`financeInstallmentFetchStart`), para datar cada uma pela compra, e a
 * parcela que guarda uma escolha vem de qualquer data (ruleParcelIds); a
 * tela e o retrato mostram só a janela. Os registros do Kotii vêm
 * desde a compra parcelada mais antiga com parcela na janela
 * (`kotiiRecordsStart`): a nota dela é da data da compra. Só fica pronto com
 * tudo carregado: com uma consulta faltando, a tela e o Nuke diriam "nada"
 * onde não sabem.
 */
export function useFinanceData(today: string): FinanceDataState {
  const connections = useFinConnections();
  const accounts = useFinAccounts();
  const cardIds = useMemo(
    () => accounts.data?.filter((a) => a.type === 'CREDIT').map((a) => a.id).sort() ?? null,
    [accounts.data],
  );
  const transactions = useFinTransactions(financeFetchStart(today), financeInstallmentFetchStart(today), cardIds);
  const budgets = useBudgets();
  // Desde quando buscar os registros depende só das parcelas: agrupar só elas sai bem mais leve que tudo.
  const recordsFrom = useMemo(
    () =>
      transactions.data && accounts.data
        ? kotiiRecordsStart(groupPurchases(transactions.data.filter(isParcel), accounts.data), today)
        : null,
    [transactions.data, accounts.data, today],
  );
  const records = useFinKotiiRecords(recordsFrom);
  const rules = useFinCategoryRules();
  const oldIds = useMemo(
    () =>
      rules.data && transactions.data
        ? ruleParcelIds([...rules.data.rules.map((r) => r.match_key), ...rules.data.sensitiveKeys], transactions.data)
        : null,
    [rules.data, transactions.data],
  );
  const ruleParcels = useFinRuleParcels(oldIds);

  const queries = [connections, accounts, transactions, budgets, records, rules, ruleParcels];
  const failed = queries.find((q) => q.data === undefined && q.isError);
  const data = useMemo(
    () =>
      connections.data && accounts.data && transactions.data && budgets.data && records.data && rules.data && ruleParcels.data
        ? {
            connections: connections.data,
            accounts: accounts.data,
            transactions: [...transactions.data, ...ruleParcels.data],
            budgets: budgets.data,
            kotiiRecords: records.data,
            categoryRules: rules.data.rules,
            sensitiveKeys: rules.data.sensitiveKeys,
          }
        : null,
    [connections.data, accounts.data, transactions.data, budgets.data, records.data, rules.data, ruleParcels.data],
  );
  if (failed) {
    return {
      status: 'error',
      error: failed.error,
      // Só as que falharam: a dos registros espera os lançamentos para saber desde quando buscar.
      retry: () => queries.filter((q) => q.data === undefined && q.isError).forEach((q) => q.refetch()),
    };
  }
  return data ? { status: 'ready', data } : { status: 'loading' };
}

export type FinanceSnapshotState =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; context: string };

/** Retrato das finanças para o Nuke consultor (texto pronto, sem CPF, conta nem nome de pessoa). */
export function useFinanceSnapshot(today: string): FinanceSnapshotState {
  const state = useFinanceData(today);
  const data = state.status === 'ready' ? state.data : null;
  const context = useMemo(() => (data ? buildFinanceSnapshot({ today, now: new Date(), ...data }) : null), [data, today]);
  if (state.status === 'error') return { status: 'error', retry: state.retry };
  return context === null ? { status: 'loading' } : { status: 'ready', context };
}

// ---------------------------------------------------------------------------
// Sincronização e bancos conectados

export interface FinSyncError {
  connectionId: string;
  label: string;
  message: string;
}

export interface FinSyncResult {
  synced: number;
  skipped: number;
  errors: FinSyncError[];
}

/** Resposta da função `finance`, conferida (campo faltando vira zero ou lista vazia). */
export function parseSyncResult(raw: unknown): FinSyncResult {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
  const errors = Array.isArray(input.errors) ? input.errors : [];
  return {
    synced: count(input.synced),
    skipped: count(input.skipped),
    errors: errors
      .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === 'object')
      .map((e) => ({
        connectionId: String(e.connectionId ?? ''),
        label: typeof e.label === 'string' && e.label.trim() ? e.label.trim() : 'Banco',
        message: typeof e.message === 'string' && e.message.trim() ? e.message.trim() : 'Não consegui atualizar.',
      })),
  };
}

async function invokeFinance(body: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke('finance', { body });
  if (error || !data) throw new Error(await functionErrorMessage(error, 'Não consegui falar com os bancos agora. Tente de novo.'));
  return data;
}

/**
 * Traz os bancos da Pluggy. Sem `force`, só os que não atualizam há 6 h; com
 * `force` (o "Atualizar"), os de mais de 2 min. Erro de um banco vem na lista.
 */
export function useSyncFinance() {
  const invalidate = useInvalidateFin();
  return useMutation({
    mutationFn: async ({ force }: { force: boolean }) => parseSyncResult(await invokeFinance({ action: 'sync', force })),
    // Mesmo com erro, algum banco pode ter gravado antes.
    onSettled: invalidate,
  });
}

/** Conecta um item do MeuPluggy (a função confere o Item ID na Pluggy) e já sincroniza. */
export function useAddFinItem() {
  const invalidate = useInvalidateFin();
  return useMutation({
    mutationFn: async ({ itemId, label }: { itemId: string; label: string }) => {
      const data = (await invokeFinance({ action: 'add_item', itemId: itemId.trim(), label: label.trim() })) as Record<string, unknown>;
      return { connectionId: String(data.connectionId ?? ''), sync: parseSyncResult(data.sync) };
    },
    onSettled: invalidate,
  });
}

/** Desconecta um banco: os lançamentos dele saem junto (no MeuPluggy a conexão continua). */
export function useRemoveFinConnection() {
  const invalidate = useInvalidateFin();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('fin_remove_connection', { p_id: id });
      if (!error) return;
      // P0002: já saiu, é de outra pessoa ou a liberação acabou.
      if ((error as { code?: string }).code === 'P0002') throw new Error('Esse banco já não está conectado.');
      throw error;
    },
    onSettled: invalidate,
  });
}

// ---------------------------------------------------------------------------
// Nuke consultor

export interface FinanceAnswer {
  reply: string;
  actions: FinanceAction[];
}

export function useAskFinanceNuke() {
  return useMutation({
    mutationFn: async (input: { messages: { role: 'user' | 'assistant'; text: string }[]; context: string; today: string }) => {
      const { data, error } = await supabase.functions.invoke<{ reply: unknown; actions: unknown }>('nuke-finance', { body: input });
      if (error || !data) throw new Error(await functionErrorMessage(error, 'Não consegui responder agora. Tente de novo.'));
      return { reply: String(data.reply ?? ''), actions: parseFinanceActions(data.actions) } satisfies FinanceAnswer;
    },
  });
}

/** Para onde cada tela sugerida pelo consultor leva. */
export function financeScreenHref(screen: FinanceScreen): Href {
  switch (screen) {
    case 'consultor':
      return '/consultor';
    case 'orcamento':
      return '/orcamento';
    case 'financas':
      return { pathname: '/financas', params: { aba: 'resumo' } };
    case 'contas':
      return { pathname: '/financas', params: { aba: 'contas' } };
    case 'notas':
      return { pathname: '/financas', params: { aba: 'notas' } };
  }
}

/** Executa a ação que a pessoa confirmou, com as mesmas mutações das telas. */
export function useRunFinanceAction() {
  const saveBudgets = useSaveBudgets();
  return async (action: FinanceAction): Promise<string> => {
    switch (action.type) {
      case 'set_budget':
        await saveBudgets.mutateAsync({ [action.category]: action.amount });
        return `Orçamento de ${getFinanceCategory(action.category).label}: ${formatBRL(action.amount)} por mês.`;
      case 'open_screen':
        // A conversa abre por cima do consultor: fechar já volta para ele.
        router.back();
        if (action.screen !== 'consultor') router.navigate(financeScreenHref(action.screen));
        return '';
    }
  };
}

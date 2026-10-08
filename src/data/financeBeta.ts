// Consultor financeiro (beta): a liberação (beta_access), os bancos
// conectados pelo MeuPluggy (tabelas fin_*, só leitura), a sincronização
// (função `finance`) e a conversa com o Nuke consultor (`nuke-finance`).
//
// Dados do banco ficam só na memória: nenhuma chave daqui entra em PERSISTED
// (lib/queryClient). As chaves levam a pessoa e a casa: a liberação é de uma
// pessoa numa casa, e o cônjuge nunca vê nada disso.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { useMemo } from 'react';

import { useBudgets, useSaveBudgets } from '@/data/finance';
import { functionErrorMessage } from '@/data/images';
import { nookyRecordsFrom, type NookyRecord } from '@/domain/bankMatch';
import { financeFetchStart, financeWindowStart } from '@/domain/bankMonth';
import { toISODate } from '@/domain/dates';
import { getFinanceCategory } from '@/domain/finance';
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

/** Lançamentos com data no banco a partir de `fromDate` (os apagados na Pluggy ficam de fora). */
export function useFinTransactions(fromDate: string) {
  const { key, enabled } = useFinScope();
  return useQuery({
    queryKey: ['fin', 'transactions', ...key, fromDate],
    enabled,
    queryFn: async () =>
      (
        await fetchAllPages<FinTransaction>((from, to) =>
          supabase
            .from('fin_transactions')
            .select(TRANSACTION_COLUMNS)
            .gte('occurred_on', fromDate)
            .is('deleted_at', null)
            .order('occurred_on', { ascending: false })
            .order('id')
            .range(from, to),
        )
      ).map(toFinTransaction),
  });
}

type ReceiptRow = { id: string; purchased_at: string; total: number | null; store: { name: string | null; cnpj: string | null } | null };
type PaymentRow = { id: string; paid_on: string; amount: number; bill: { name: string } | null };
type ExpenseRow = { id: string; spent_on: string; amount: number; description: string };

/** Notas confirmadas, contas pagas e gastos avulsos desde `fromDate`, para a conferência com o banco. */
export function useFinNookyRecords(fromDate: string) {
  const { enabled } = useFinScope();
  return useQuery({
    // Começa com 'spending': confirmar nota, pagar conta ou salvar gasto já recarrega.
    queryKey: ['spending', 'bankMatch', fromDate],
    enabled,
    queryFn: async (): Promise<NookyRecord[]> => {
      // Data da compra no fuso do aparelho, como no resumo (useSpending).
      const [y, m, d] = fromDate.split('-').map(Number);
      const startAt = new Date(y, m - 1, d).toISOString();
      const [receipts, payments, expenses] = await Promise.all([
        supabase
          .from('receipts')
          .select('id, purchased_at, total, store:stores(name, cnpj)')
          .eq('status', 'confirmed')
          .gte('purchased_at', startAt),
        supabase.from('bill_payments').select('id, paid_on, amount, bill:bills(name)').gte('paid_on', fromDate),
        supabase.from('expenses').select('id, spent_on, amount, description').gte('spent_on', fromDate),
      ]);
      return nookyRecordsFrom({
        receipts: (unwrap(receipts) as unknown as ReceiptRow[]).map((r) => ({
          id: r.id,
          date: toISODate(new Date(r.purchased_at)),
          total: num(r.total),
          store: r.store?.name ?? null,
          cnpj: r.store?.cnpj ?? null,
        })),
        payments: (unwrap(payments) as unknown as PaymentRow[]).map((p) => ({
          id: p.id,
          paid_on: p.paid_on,
          amount: Number(p.amount),
          bill_name: p.bill?.name ?? 'Conta',
        })),
        expenses: (unwrap(expenses) as ExpenseRow[]).map((e) => ({ ...e, amount: Number(e.amount) })),
      });
    },
  });
}

// Janela do consultor (o mês de hoje e os dois anteriores) e o ciclo de fatura buscado antes dela.
export { financeFetchStart, financeWindowStart };

export interface FinanceData {
  connections: FinConnection[];
  accounts: FinAccount[];
  transactions: FinTransaction[];
  budgets: { category: string; monthly_limit: number }[];
  nookyRecords: NookyRecord[];
}

export type FinanceDataState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown; retry: () => void }
  | { status: 'ready'; data: FinanceData };

/**
 * Tudo o que o consultor usa, na janela de `financeWindowStart(today)`. Os
 * lançamentos vêm desde um ciclo de fatura antes (`financeFetchStart`), só
 * para juntar parcelas e pares que começaram antes da janela; a tela e o
 * retrato mostram só a janela. Só fica pronto com tudo carregado: com uma
 * consulta faltando, a tela e o Nuke diriam "nada" onde não sabem.
 */
export function useFinanceData(today: string): FinanceDataState {
  const fromDate = financeWindowStart(today);
  const connections = useFinConnections();
  const accounts = useFinAccounts();
  const transactions = useFinTransactions(financeFetchStart(today));
  const budgets = useBudgets();
  const records = useFinNookyRecords(fromDate);

  const queries = [connections, accounts, transactions, budgets, records];
  const failed = queries.find((q) => q.data === undefined && q.isError);
  const data = useMemo(
    () =>
      connections.data && accounts.data && transactions.data && budgets.data && records.data
        ? {
            connections: connections.data,
            accounts: accounts.data,
            transactions: transactions.data,
            budgets: budgets.data,
            nookyRecords: records.data,
          }
        : null,
    [connections.data, accounts.data, transactions.data, budgets.data, records.data],
  );
  if (failed) {
    return {
      status: 'error',
      error: failed.error,
      retry: () => queries.filter((q) => q.data === undefined).forEach((q) => q.refetch()),
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

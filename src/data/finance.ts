// Financeiro: contas a pagar, pagamentos, gastos avulsos e os gastos das notas.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';

import { toISODate } from '@/domain/dates';
import type { MedicalEntry } from '@/domain/incomeTax';
import {
  buildEntries,
  monthRange,
  type ExpenseForSpending,
  type PaymentForSpending,
  type ReceiptForSpending,
} from '@/domain/finance';
import { supabase, unwrap } from '@/lib/supabase';
import type { Bill, BillPayment, Budget, Expense } from '@/lib/types';

function useInvalidateFinance() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of ['bills', 'billPayments', 'expenses', 'spending', 'budgets']) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  };
}

// ---------------------------------------------------------------------------
// Contas

const BILL_COLUMNS = 'id, name, category, amount, recurrence, due_day, next_due_on, autopay, notes, active, boleto, deductible, provider_name, provider_doc';

export async function fetchBills(db: SupabaseClient = supabase): Promise<Bill[]> {
  return unwrap(await db.from('bills').select(BILL_COLUMNS).order('active', { ascending: false }).order('next_due_on')) as Bill[];
}

export function useBills() {
  return useQuery({ queryKey: ['bills'], queryFn: () => fetchBills() });
}

export function useBill(id: string | undefined) {
  return useQuery({
    queryKey: ['bills', id],
    enabled: Boolean(id),
    queryFn: async () => unwrap(await supabase.from('bills').select(BILL_COLUMNS).eq('id', id!).single()) as Bill,
  });
}

export type BillValues = Omit<Bill, 'id'>;

/** A conta mudou de vencimento (alguém pagou) enquanto a tela estava aberta. */
export class BillMovedError extends Error {
  constructor() {
    super('Esta conta mudou enquanto a tela estava aberta (alguém registrou o pagamento?). Abra a conta de novo e confira.');
  }
}

/**
 * Cria ou muda uma conta. `expectDueOn`: só muda se o vencimento ainda for
 * esse (o que a tela mostrava); senão, BillMovedError, em vez de gravar o
 * boleto ou a data da parcela já paga na próxima.
 */
export function useSaveBill() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async ({ id, values, expectDueOn }: { id?: string; values: Partial<BillValues>; expectDueOn?: string }) => {
      if (!id) return unwrap(await supabase.from('bills').insert(values));
      let update = supabase.from('bills').update(values).eq('id', id);
      if (expectDueOn) update = update.eq('next_due_on', expectDueOn);
      const rows = unwrap(await update.select('id')) as { id: string }[] | null;
      if (expectDueOn && !rows?.length) throw new BillMovedError();
      return rows;
    },
    onSuccess: invalidate,
    // Conta que mudou: a tela recarrega com o vencimento novo.
    onError: (err) => {
      if (err instanceof BillMovedError) invalidate();
    },
  });
}

export function useDeleteBill() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('bills').delete().eq('id', id)),
    onSuccess: invalidate,
  });
}

export function useBillPayments(billId: string | undefined) {
  return useQuery({
    queryKey: ['billPayments', billId],
    enabled: Boolean(billId),
    queryFn: async () =>
      unwrap(
        await supabase
          .from('bill_payments')
          .select('id, bill_id, due_on, paid_on, amount, paid_by')
          .eq('bill_id', billId!)
          .order('due_on', { ascending: false })
          .limit(24),
      ) as BillPayment[],
  });
}

/**
 * Paga o vencimento que a pessoa viu; se alguém já pagou, não paga de novo e
 * devolve `paid: false`.
 */
export function usePayBill() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: { bill: Pick<Bill, 'id' | 'next_due_on'>; amount: number | null; paidOn: string }) =>
      unwrap(
        await supabase.rpc('pay_bill', {
          p_bill_id: input.bill.id,
          p_due_on: input.bill.next_due_on,
          p_amount: input.amount,
          p_paid_on: input.paidOn,
        }),
      ) as { bill: Bill; paid: boolean },
    onSuccess: invalidate,
  });
}

export function useUndoBillPayment() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (paymentId: string) => unwrap(await supabase.rpc('undo_bill_payment', { p_payment_id: paymentId })),
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------
// Gastos avulsos

const EXPENSE_COLUMNS =
  'id, description, amount, spent_on, category, notes, paid_by, deductible, provider_name, provider_doc, patient_id';

export function useExpense(id: string | undefined) {
  return useQuery({
    queryKey: ['expenses', id],
    enabled: Boolean(id),
    queryFn: async () => unwrap(await supabase.from('expenses').select(EXPENSE_COLUMNS).eq('id', id!).single()) as Expense,
  });
}

type TaxFields = 'deductible' | 'provider_name' | 'provider_doc' | 'patient_id';
export type ExpenseValues = Omit<Expense, 'id' | 'paid_by' | TaxFields> & Partial<Pick<Expense, TaxFields | 'paid_by'>>;

export function useSaveExpense() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: ExpenseValues }) =>
      id
        ? unwrap(await supabase.from('expenses').update(values).eq('id', id))
        : unwrap(await supabase.from('expenses').insert(values)),
    onSuccess: invalidate,
  });
}

export function useDeleteExpense() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('expenses').delete().eq('id', id)),
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------
// Gastos de um período (notas confirmadas + contas pagas + gastos avulsos)

type ReceiptRow = {
  id: string;
  purchased_at: string;
  paid_by: string | null;
  total: number | null;
  store: { name: string } | null;
  receipt_items: { total_price: number; suggested_category: string | null; product: { category: string } | null }[];
};

type PaymentRow = {
  id: string;
  bill_id: string;
  paid_on: string;
  amount: number;
  paid_by: string | null;
  bill: { name: string; category: string } | null;
};

/** Lançamentos de `fromMonth` até `toMonth` (inclusive), no formato "AAAA-MM". */
export function useSpending(fromMonth: string, toMonth: string, enabled = true) {
  return useQuery({
    queryKey: ['spending', fromMonth, toMonth],
    enabled,
    queryFn: async () => {
      const start = monthRange(fromMonth).start;
      const end = monthRange(toMonth).end;
      // Data da compra no fuso do aparelho: limites do mês em hora local.
      const [sy, sm] = fromMonth.split('-').map(Number);
      const [ey, em] = toMonth.split('-').map(Number);
      const startAt = new Date(sy, sm - 1, 1).toISOString();
      const endAt = new Date(ey, em, 1).toISOString();

      const [receipts, payments, expenses] = await Promise.all([
        supabase
          .from('receipts')
          .select('id, purchased_at, total, paid_by, store:stores(name), receipt_items(total_price, suggested_category, product:products(category))')
          .eq('status', 'confirmed')
          .gte('purchased_at', startAt)
          .lt('purchased_at', endAt),
        supabase
          .from('bill_payments')
          .select('id, bill_id, paid_on, amount, paid_by, bill:bills(name, category)')
          .gte('paid_on', start)
          .lt('paid_on', end),
        supabase.from('expenses').select('id, spent_on, amount, category, description, paid_by').gte('spent_on', start).lt('spent_on', end),
      ]);

      const receiptRows = unwrap(receipts) as unknown as ReceiptRow[];
      const paymentRows = unwrap(payments) as unknown as PaymentRow[];
      const expenseRows = unwrap(expenses) as ExpenseForSpending[];

      const forSpending: ReceiptForSpending[] = receiptRows.map((r) => ({
        id: r.id,
        purchased_at_date: toISODate(new Date(r.purchased_at)),
        total: r.total,
        store_name: r.store?.name ?? null,
        paid_by: r.paid_by,
        items: r.receipt_items.map((i) => ({
          total_price: i.total_price,
          category: i.product?.category ?? i.suggested_category,
        })),
      }));
      const paid: PaymentForSpending[] = paymentRows.map((p) => ({
        id: p.id,
        bill_id: p.bill_id,
        paid_on: p.paid_on,
        amount: p.amount,
        bill_name: p.bill?.name ?? 'Conta',
        bill_category: p.bill?.category ?? 'contas',
        paid_by: p.paid_by,
      }));
      return buildEntries(forSpending, paid, expenseRows);
    },
  });
}

// ---------------------------------------------------------------------------
// Despesas médicas para o IR

/** Gastos e pagamentos de contas marcados como dedutíveis no ano. */
export function useMedicalExpenses(year: number) {
  return useQuery({
    // Começa com 'expenses': salvar gasto ou pagar conta já recarrega.
    queryKey: ['expenses', 'medical', year],
    queryFn: async (): Promise<MedicalEntry[]> => {
      const start = `${year}-01-01`;
      const end = `${year + 1}-01-01`;
      const [expenses, payments] = await Promise.all([
        supabase
          .from('expenses')
          .select('id, description, amount, spent_on, provider_name, provider_doc, patient:people(name)')
          .eq('deductible', true)
          .gte('spent_on', start)
          .lt('spent_on', end),
        supabase
          .from('bill_payments')
          .select('id, bill_id, paid_on, amount, bill:bills(name, deductible, provider_name, provider_doc)')
          .gte('paid_on', start)
          .lt('paid_on', end),
      ]);
      type ExpenseRow = Pick<Expense, 'id' | 'description' | 'amount' | 'spent_on' | 'provider_name' | 'provider_doc'> & {
        patient: { name: string } | null;
      };
      type PaymentRow = {
        id: string;
        bill_id: string;
        paid_on: string;
        amount: number;
        bill: Pick<Bill, 'name' | 'deductible' | 'provider_name' | 'provider_doc'> | null;
      };
      return [
        ...(unwrap(expenses) as unknown as ExpenseRow[]).map(
          (e): MedicalEntry => ({
            id: e.id,
            refId: e.id,
            source: 'gasto',
            date: e.spent_on,
            amount: Number(e.amount),
            description: e.description,
            providerName: e.provider_name,
            providerDoc: e.provider_doc,
            patientName: e.patient?.name ?? null,
          }),
        ),
        ...(unwrap(payments) as unknown as PaymentRow[])
          .filter((p) => p.bill?.deductible)
          .map(
            (p): MedicalEntry => ({
              id: p.id,
              refId: p.bill_id,
              source: 'conta',
              date: p.paid_on,
              amount: Number(p.amount),
              description: p.bill!.name,
              providerName: p.bill!.provider_name,
              providerDoc: p.bill!.provider_doc,
              patientName: null,
            }),
          ),
      ];
    },
  });
}

// ---------------------------------------------------------------------------
// Divisão de gastos entre moradores

export function useSplitWeights() {
  return useQuery({
    queryKey: ['split', 'weights'],
    queryFn: async () =>
      Object.fromEntries(
        (unwrap(await supabase.from('split_weights').select('user_id, weight')) as { user_id: string; weight: number }[]).map(
          (w) => [w.user_id, Number(w.weight)],
        ),
      ) as Record<string, number>,
  });
}

export function useSaveSplitWeights() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (weights: Record<string, number>) =>
      unwrap(
        await supabase
          .from('split_weights')
          .upsert(Object.entries(weights).map(([user_id, weight]) => ({ user_id, weight })), { onConflict: 'household_id,user_id' }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['split'] }),
  });
}

export interface Settlement {
  id: string;
  month: string;
  from_user: string;
  to_user: string;
  amount: number;
}

export function useSettlements(month: string) {
  return useQuery({
    queryKey: ['split', 'settlements', month],
    queryFn: async () =>
      (
        unwrap(
          await supabase.from('settlements').select('id, month, from_user, to_user, amount').eq('month', month).order('created_at'),
        ) as Settlement[]
      ).map((s) => ({ ...s, amount: Number(s.amount) })),
  });
}

export function useAddSettlement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (settlement: Omit<Settlement, 'id'>) => unwrap(await supabase.from('settlements').insert(settlement)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['split'] }),
  });
}

export function useDeleteSettlement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('settlements').delete().eq('id', id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['split'] }),
  });
}

/** Troca quem pagou um vencimento já registrado. */
export function useSetPaymentPayer() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async ({ billId, dueOn, paidBy }: { billId: string; dueOn: string; paidBy: string }) =>
      unwrap(await supabase.from('bill_payments').update({ paid_by: paidBy }).eq('bill_id', billId).eq('due_on', dueOn)),
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------
// Orçamento

export function useBudgets() {
  return useQuery({
    queryKey: ['budgets'],
    queryFn: async () =>
      (unwrap(await supabase.from('budgets').select('category, monthly_limit')) as Budget[]).map((b) => ({
        ...b,
        monthly_limit: Number(b.monthly_limit),
      })),
  });
}

/** Grava os limites: valor positivo cria ou muda; null tira o limite da categoria. */
export function useSaveBudgets() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (limits: Record<string, number | null>) => {
      const set = Object.entries(limits)
        .filter(([, limit]) => limit !== null)
        .map(([category, limit]) => ({ category, monthly_limit: limit!, updated_at: new Date().toISOString() }));
      const cleared = Object.entries(limits)
        .filter(([, limit]) => limit === null)
        .map(([category]) => category);
      if (set.length) unwrap(await supabase.from('budgets').upsert(set, { onConflict: 'household_id,category' }));
      if (cleared.length) unwrap(await supabase.from('budgets').delete().in('category', cleared));
    },
    onSuccess: invalidate,
  });
}

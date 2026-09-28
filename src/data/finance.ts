// Financeiro: contas a pagar, pagamentos, gastos avulsos e os gastos das notas.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { toISODate } from '@/domain/dates';
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

const BILL_COLUMNS = 'id, name, category, amount, recurrence, due_day, next_due_on, autopay, notes, active, boleto';

export function useBills() {
  return useQuery({
    queryKey: ['bills'],
    queryFn: async () =>
      unwrap(await supabase.from('bills').select(BILL_COLUMNS).order('active', { ascending: false }).order('next_due_on')) as Bill[],
  });
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

const EXPENSE_COLUMNS = 'id, description, amount, spent_on, category, notes, paid_by';

export function useExpense(id: string | undefined) {
  return useQuery({
    queryKey: ['expenses', id],
    enabled: Boolean(id),
    queryFn: async () => unwrap(await supabase.from('expenses').select(EXPENSE_COLUMNS).eq('id', id!).single()) as Expense,
  });
}

export type ExpenseValues = Omit<Expense, 'id' | 'paid_by'>;

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
  total: number | null;
  store: { name: string } | null;
  receipt_items: { total_price: number; suggested_category: string | null; product: { category: string } | null }[];
};

type PaymentRow = { id: string; bill_id: string; paid_on: string; amount: number; bill: { name: string; category: string } | null };

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
          .select('id, purchased_at, total, store:stores(name), receipt_items(total_price, suggested_category, product:products(category))')
          .eq('status', 'confirmed')
          .gte('purchased_at', startAt)
          .lt('purchased_at', endAt),
        supabase
          .from('bill_payments')
          .select('id, bill_id, paid_on, amount, bill:bills(name, category)')
          .gte('paid_on', start)
          .lt('paid_on', end),
        supabase.from('expenses').select('id, spent_on, amount, category, description').gte('spent_on', start).lt('spent_on', end),
      ]);

      const receiptRows = unwrap(receipts) as unknown as ReceiptRow[];
      const paymentRows = unwrap(payments) as unknown as PaymentRow[];
      const expenseRows = unwrap(expenses) as ExpenseForSpending[];

      const forSpending: ReceiptForSpending[] = receiptRows.map((r) => ({
        id: r.id,
        purchased_at_date: toISODate(new Date(r.purchased_at)),
        total: r.total,
        store_name: r.store?.name ?? null,
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
      }));
      return buildEntries(forSpending, paid, expenseRows);
    },
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

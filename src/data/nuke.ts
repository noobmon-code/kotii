// Nuke: monta o retrato da casa com o que o app já carrega e conversa com a
// função `nuke`. As ações sugeridas usam as mesmas mutações das telas.

import { useMutation, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';

import { useBills, useBudgets, useSaveExpense, useSpending } from '@/data/finance';
import { toSchedule, useChores, useDoses, useMedications, usePantry, useSaveChore } from '@/data/home';
import { useDocuments, useEquipmentList } from '@/data/house';
import { useAppointments, usePeople } from '@/data/health';
import { useAddToMarketList } from '@/data/market';
import { functionErrorMessage } from '@/data/images';
import { budgetProgress } from '@/domain/budget';
import { addDays } from '@/domain/dates';
import { describeDocumentStatus, documentsNeedingAttention } from '@/domain/documents';
import { describeWarranty, warrantyStatus } from '@/domain/equipment';
import { monthLabel, monthRange, previousMonth, shiftMonth, summarize } from '@/domain/finance';
import { upcomingAppointments } from '@/domain/health';
import { doseKey, dosesForDay } from '@/domain/medications';
import { buildNukeContext, parseActions, type NukeAction, type NukeScreen, type NukeSnapshot } from '@/domain/nuke';
import { expiryStatus } from '@/domain/pantry';
import { useHousehold } from '@/lib/auth';
import { supabase, unwrap } from '@/lib/supabase';

type PendingItem = { name: string; quantity: number; unit: string; list: { name: string; archived_at: string | null } | null };

/** Itens ainda não comprados, por lista ativa. */
function usePendingListItems() {
  return useQuery({
    queryKey: ['lists', 'pending-items'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('shopping_list_items')
          .select('name, quantity, unit, list:shopping_lists(name, archived_at)')
          .is('checked_at', null)
          .order('created_at')
          .limit(120),
      ) as unknown as PendingItem[],
  });
}

export type NukeContextState =
  | { status: 'loading' }
  | { status: 'error'; retry: () => void }
  | { status: 'ready'; context: string };

/**
 * Retrato da casa para o Nuke. Só fica pronto com todos os dados carregados:
 * com uma consulta faltando, ele diria "nada" onde não sabe.
 */
export function useNukeContext(today: string): NukeContextState {
  const household = useHousehold();
  const medications = useMedications();
  const doses = useDoses(today);
  const chores = useChores();
  const pantry = usePantry();
  const pending = usePendingListItems();
  const bills = useBills();
  const month = today.slice(0, 7);
  const spending = useSpending(shiftMonth(month, -1), month);
  const budgets = useBudgets();
  const appointments = useAppointments();
  const people = usePeople();
  const documents = useDocuments();
  const equipment = useEquipmentList();

  const queries = [household, medications, doses, chores, pantry, pending, bills, spending, budgets, appointments, people, documents, equipment];
  const missing = queries.filter((q) => q.data === undefined);
  if (missing.some((q) => q.isError)) {
    return { status: 'error', retry: () => missing.forEach((q) => q.refetch()) };
  }
  if (missing.length || !household.data) return { status: 'loading' };
  const { household: house, members, me } = household.data;
  const memberName = (id: string | null) => members.find((m) => m.user_id === id)?.display_name ?? null;

  const taken = new Set((doses.data ?? []).map((d) => doseKey(d.medication_id, d.scheduled_on, d.scheduled_time)));
  const weekAhead = addDays(today, 7);
  const monthAhead = addDays(today, 30);
  const inTwoWeeks = addDays(today, 14);

  const shopping = new Map<string, { name: string; quantity: number; unit: string }[]>();
  for (const item of pending.data ?? []) {
    if (!item.list || item.list.archived_at) continue;
    shopping.set(item.list.name, [...(shopping.get(item.list.name) ?? []), item]);
  }

  const entries = spending.data;
  const previous = entries ? previousMonth(entries, month, today) : null;

  const snapshot: NukeSnapshot = {
    today,
    household: house.name,
    me: me.display_name,
    members: members.map((m) => m.display_name),
    doses: dosesForDay((medications.data ?? []).map(toSchedule), today).map((d) => ({
      time: d.time,
      name: d.name,
      person: d.personName,
      taken: taken.has(doseKey(d.medicationId, d.date, d.time)),
    })),
    chores: (chores.data ?? [])
      .filter((c) => c.due_on <= weekAhead)
      .map((c) => ({ title: c.title, due_on: c.due_on, assignee: memberName(c.assigned_to) })),
    expiring: (pantry.data ?? [])
      .filter((p) => p.expires_on && ['vencido', 'vence_logo'].includes(expiryStatus(p.expires_on, today).kind))
      .map((p) => ({ name: p.name, expires_on: p.expires_on! })),
    pantry: (pantry.data ?? []).map((p) => p.name),
    shopping: [...shopping].map(([list, items]) => ({ list, items })),
    bills: (bills.data ?? [])
      .filter((b) => b.active && b.next_due_on <= monthAhead)
      .map((b) => ({ name: b.name, amount: b.amount, next_due_on: b.next_due_on, autopay: b.autopay })),
    spending:
      entries && previous
        ? (() => {
            const summary = summarize(entries, monthRange(month));
            return {
              month: monthLabel(month).split(' ')[0],
              total: summary.total,
              byCategory: summary.byCategory,
              previousMonth: monthLabel(previous.month).split(' ')[0],
              previousTotal: summarize(entries, monthRange(previous.month)).total,
              budgets: budgetProgress(budgets.data ?? [], summary.byCategory).map((b) => ({
                category: b.category,
                limit: b.limit,
                spent: b.spent,
              })),
            };
          })()
        : null,
    appointments: upcomingAppointments(appointments.data ?? [], today)
      .filter((a) => a.starts_at.slice(0, 10) <= inTwoWeeks)
      .map((a) => ({
        starts_at: a.starts_at,
        title: a.title,
        person: people.data?.find((p) => p.id === a.person_id)?.name ?? '',
      })),
    documents: documentsNeedingAttention(documents.data ?? [], today).map(({ document, status }) => ({
      title: document.title,
      status: describeDocumentStatus(status, document.expires_on),
    })),
    warranties: (equipment.data ?? [])
      .map((item) => ({ item, status: warrantyStatus(item.warranty_until, today) }))
      .filter(({ status }) => status.kind === 'acabando')
      .map(({ item, status }) => ({ name: item.name, status: describeWarranty(status) })),
  };
  return { status: 'ready', context: buildNukeContext(snapshot) };
}

export interface NukeAnswer {
  reply: string;
  actions: NukeAction[];
}

export function useAskNuke() {
  return useMutation({
    mutationFn: async (input: { messages: { role: 'user' | 'assistant'; text: string }[]; context: string; today: string }) => {
      const { data, error } = await supabase.functions.invoke<{ reply: string; actions: unknown }>('nuke', { body: input });
      if (error || !data) throw new Error(await functionErrorMessage(error, 'Não consegui responder agora. Tente de novo.'));
      return { reply: String(data.reply ?? ''), actions: parseActions(data.actions) } satisfies NukeAnswer;
    },
  });
}

const SCREEN_ROUTES: Record<NukeScreen, () => void> = {
  hoje: () => router.navigate('/'),
  compras: () => router.navigate({ pathname: '/casa', params: { aba: 'compras' } }),
  despensa: () => router.navigate({ pathname: '/casa', params: { aba: 'despensa' } }),
  tarefas: () => router.navigate({ pathname: '/casa', params: { aba: 'tarefas' } }),
  aparelhos: () => router.navigate({ pathname: '/casa', params: { aba: 'aparelhos' } }),
  financas: () => router.navigate({ pathname: '/financas', params: { aba: 'resumo' } }),
  contas: () => router.navigate({ pathname: '/financas', params: { aba: 'contas' } }),
  notas: () => router.navigate({ pathname: '/financas', params: { aba: 'notas' } }),
  precos: () => router.navigate('/precos'),
  saude: () => router.navigate('/saude'),
  familia: () => router.navigate('/familia'),
};

/** Executa a ação que a pessoa confirmou, com as mesmas regras das telas. */
export function useRunNukeAction() {
  const addToList = useAddToMarketList();
  const saveChore = useSaveChore();
  const saveExpense = useSaveExpense();
  return async (action: NukeAction): Promise<string> => {
    switch (action.type) {
      case 'add_to_list': {
        let added = 0;
        let listName = 'Mercado';
        for (const item of action.items) {
          const result = await addToList.mutateAsync({
            name: item.name,
            category: item.category,
            productId: null,
            quantity: item.quantity,
            unit: item.unit,
          });
          listName = result.name;
          if (result.added) added += 1;
        }
        const skipped = action.items.length - added;
        if (!added) return `Já estava tudo na lista "${listName}".`;
        return `${added} ${added === 1 ? 'item adicionado' : 'itens adicionados'} em "${listName}"${skipped ? ` (${skipped} já estava${skipped === 1 ? '' : 'm'} lá)` : ''}.`;
      }
      case 'create_chore':
        await saveChore.mutateAsync({
          values: {
            title: action.title,
            notes: null,
            recurrence: action.recurrence,
            interval_count: 1,
            due_on: action.due_on,
            assigned_to: null,
          },
        });
        return 'Tarefa criada.';
      case 'add_expense':
        await saveExpense.mutateAsync({
          values: {
            description: action.description,
            amount: action.amount,
            spent_on: action.spent_on,
            category: action.category,
            notes: null,
          },
        });
        return 'Gasto registrado.';
      case 'open_screen':
        router.back();
        SCREEN_ROUTES[action.screen]();
        return '';
    }
  };
}

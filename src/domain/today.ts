// A tela Hoje por urgência: o que entra em "Agora" (atrasado ou de hoje), em "Em breve" (dos próximos dias, ou sem
// data, como uma nota para revisar) e em que ordem; a conta da frase do topo e o "Tudo em dia"; o atalho "Lista de
// mercado". Quem decide se uma coisa está atrasada, é de hoje ou vem depois são as funções de estado de cada assunto
// (choreStatus, expiryStatus, documentStatus…): aqui só se traduz o estado de cada uma num lugar da tela, sem conta
// de data nova. "Sugestões" ("Acho que acabou", o cardápio de hoje, as listas abertas) não passa por aqui: não é
// pendência, não entra na conta nem segura o "Tudo em dia".

import type {
  Appointment,
  Bill,
  Chore,
  DietPlan,
  Equipment,
  HomeDocument,
  PantryItem,
  Receipt,
  Supply,
  Vaccine,
  WorkoutPlan,
} from '@/lib/types';
import type { BudgetLine } from './budget';
import { choreStatus, type ChoreStatus } from './chores';
import { addDays } from './dates';
import { documentsNeedingAttention, type DocumentStatus } from './documents';
import { warrantyStatus, type WarrantyStatus } from './equipment';
import type { TodayEntry } from './familyEvents';
import { billStatus, type BillStatus } from './finance';
import { splitTimestamp, type VaccineStatus, type WorkoutSession } from './health';
import type { RefillAlert, RefillRow } from './medicationStock';
import type { DoseSlot } from './medications';
import { expiryStatus, type ExpiryStatus } from './pantry';
import type { PendingReceipt } from './pendingReceipts';
import { suppliesNeedingAttention, type SupplyForecast, type SupplyRow } from './supplies';

/** Atrasado, de hoje, ou dos próximos dias (`days` a partir de hoje; null: sem data, como uma nota para revisar). */
export type Placement = { urgency: 'atrasado' } | { urgency: 'hoje' } | { urgency: 'breve'; days: number | null };

const LATE: Placement = { urgency: 'atrasado' };
const TODAY: Placement = { urgency: 'hoje' };
const soon = (days: number | null): Placement => ({ urgency: 'breve', days });

/** O que a tela Hoje mostra nos dois blocos de pendências, um tipo por assunto. */
export type TodayKind =
  | 'dose'
  | 'refill'
  | 'appointment'
  | 'vaccine'
  | 'workout'
  | 'event'
  | 'chore'
  | 'bill'
  | 'budget'
  | 'pantry'
  | 'supply'
  | 'document'
  | 'warranty'
  | 'pendingReceipt'
  | 'receipt'
  | 'plan';

/**
 * No mesmo nível de urgência, a ordem dos assuntos: o remédio e a saúde antes, depois o que tem hora marcada com
 * gente (compromissos), as tarefas e as contas, e por último o que é da despensa, dos papéis e das notas.
 */
export const TODAY_KIND_ORDER: readonly TodayKind[] = [
  'dose',
  'refill',
  'appointment',
  'vaccine',
  'workout',
  'event',
  'chore',
  'bill',
  'budget',
  'pantry',
  'supply',
  'document',
  'warranty',
  'pendingReceipt',
  'receipt',
  'plan',
];

export const TODAY_BLOCK_TITLES = { agora: 'Agora', emBreve: 'Em breve', sugestoes: 'Sugestões' } as const;

/** Os grupos de "Sugestões", nesta ordem. */
export const SUGGESTION_TITLES = { restock: 'Acho que acabou', menu: 'Cardápio de hoje', lists: 'Listas abertas' } as const;

// ---------------------------------------------------------------------------
// Onde cada coisa entra (pelo estado que o assunto já calcula)

/** A dose de hoje: atrasada quando o horário já passou (o mesmo "atrasada" da linha), senão de hoje. */
export function dosePlacement(time: string, nowTime: string): Placement {
  return time < nowTime ? LATE : TODAY;
}

/** A tarefa: atrasada ou de hoje. A próxima (amanhã em diante) não aparece na tela Hoje. */
export function chorePlacement(status: ChoreStatus): Placement | null {
  if (status.kind === 'atrasada') return LATE;
  if (status.kind === 'hoje') return TODAY;
  return null;
}

/** O item da despensa: vencido, vence hoje, ou vence logo (os outros não aparecem). */
export function expiryPlacement(status: ExpiryStatus): Placement | null {
  if (status.kind === 'vencido') return LATE;
  if (status.kind !== 'vence_logo') return null;
  return status.daysLeft <= 0 ? TODAY : soon(status.daysLeft);
}

/** Gás, água e ração: passou da data prevista, acaba hoje, ou está acabando (os outros não aparecem). */
export function supplyPlacement(forecast: SupplyForecast): Placement | null {
  if (forecast.state === 'passou') return LATE;
  if (forecast.state !== 'acabando') return null;
  return forecast.daysLeft <= 0 ? TODAY : soon(forecast.daysLeft);
}

/**
 * O remédio com a caixa acabando ou a receita vencendo, pelos avisos dele: o que já acabou ou venceu (os avisos em
 * vermelho) está atrasado; acaba ou vence hoje é de hoje; o resto, pelo aviso mais perto. Só aviso parado (o
 * neutro, que não pede atenção): nada.
 */
export function refillPlacement(alerts: readonly RefillAlert[]): Placement | null {
  const pressing = alerts.filter((alert) => alert.tone !== 'neutral');
  if (!pressing.length) return null;
  if (pressing.some((alert) => alert.tone === 'danger')) return LATE;
  const days = Math.min(...pressing.map((alert) => alert.days));
  return days <= 0 ? TODAY : soon(days);
}

/** O documento: vencido, vence hoje, ou a renovar (dentro da antecedência dele). */
export function documentPlacement(status: DocumentStatus): Placement | null {
  if (status.kind === 'vencido') return LATE;
  if (status.kind !== 'renovar') return null;
  return status.days <= 0 ? TODAY : soon(status.days);
}

/** A garantia: acaba hoje, ou nos últimos 30 dias. A que já acabou não aparece. */
export function warrantyPlacement(status: WarrantyStatus): Placement | null {
  if (status.kind !== 'acabando') return null;
  return status.days <= 0 ? TODAY : soon(status.days);
}

/**
 * A consulta agendada (das próximas, upcomingAppointments): a de hoje é de hoje, a de amanhã vem logo, e as
 * outras não aparecem. A que passou sem resposta ("Foi realizada?", isOverdueAppointment) é OVERDUE_APPOINTMENT.
 */
export function appointmentPlacement(startsAt: string, today: string): Placement | null {
  const { date } = splitTimestamp(startsAt);
  if (date === today) return TODAY;
  return date === addDays(today, 1) ? soon(1) : null;
}

export const OVERDUE_APPOINTMENT: Placement = LATE;

/** A vacina: só a dose atrasada aparece na tela Hoje (a próxima fica em Saúde). */
export function vaccinePlacement(status: VaccineStatus): Placement | null {
  return status.kind === 'atrasada' ? LATE : null;
}

/** O treino do dia que ainda não foi feito. */
export const WORKOUT_TODAY: Placement = TODAY;

/** Compromisso ou aniversário (todayEntries: os de hoje e os de amanhã). */
export function eventPlacement(date: string, today: string): Placement {
  return date === today ? TODAY : soon(1);
}

/** A conta (com Finanças ligada): vencida, vence hoje, ou vence nos próximos dias (billsDueSoon). */
export function billPlacement(status: BillStatus): Placement {
  if (status.kind === 'atrasada') return LATE;
  if (status.kind === 'hoje') return TODAY;
  return soon(status.days);
}

/** A categoria do orçamento do mês (com Finanças ligada): passou do limite é de agora, perto do limite vem logo. */
export function budgetPlacement(status: 'ok' | 'perto' | 'estourou'): Placement | null {
  if (status === 'estourou') return TODAY;
  return status === 'perto' ? soon(null) : null;
}

/** Nota para revisar (a pendente da Sefaz e o rascunho) e plano de treino ou dieta para revisar: sem data. */
export const TO_REVIEW: Placement = soon(null);

// ---------------------------------------------------------------------------
// As coisas da casa, cada uma com o seu lugar

type Item<K extends TodayKind, D> = { kind: K; placement: Placement; data: D };

/** Uma linha dos blocos da tela Hoje: o assunto, o lugar (pelo estado dela) e o que a linha mostra. */
export type TodayItem =
  | Item<'dose', DoseSlot>
  | Item<'refill', RefillRow>
  | Item<'appointment', { appointment: Appointment; overdue: boolean }>
  | Item<'vaccine', { vaccine: Vaccine; status: VaccineStatus }>
  | Item<'workout', { plan: WorkoutPlan; session: WorkoutSession; done: boolean }>
  | Item<'event', TodayEntry>
  | Item<'chore', { chore: Chore; status: ChoreStatus }>
  | Item<'bill', Bill>
  | Item<'budget', BudgetLine>
  | Item<'pantry', { item: PantryItem; status: ExpiryStatus }>
  | Item<'supply', SupplyRow<Supply>>
  | Item<'document', { document: HomeDocument; status: DocumentStatus }>
  | Item<'warranty', { item: Equipment; status: WarrantyStatus }>
  | Item<'pendingReceipt', PendingReceipt>
  | Item<'receipt', Receipt>
  | Item<'plan', { kind: 'workout'; plan: WorkoutPlan } | { kind: 'diet'; plan: DietPlan }>;

/** O que a casa tem hoje, como as telas já leem (as contas e o orçamento só com Finanças ligada; sem ela, vazios). */
export interface TodayInput {
  today: string;
  /** HH:MM de agora: a dose de antes disso está atrasada. */
  nowTime: string;
  /** As doses de hoje ainda não marcadas, pelo horário. */
  doses: DoseSlot[];
  /** Os remédios com a caixa acabando ou a receita vencendo que pedem atenção (useRefills().attention). */
  refills: RefillRow[];
  /** As consultas agendadas de hoje em diante (upcomingAppointments). */
  appointments: Appointment[];
  /** As que passaram sem dizer se foram realizadas (isOverdueAppointment). */
  overdueAppointments: Appointment[];
  /** As vacinas com a próxima dose atrasada ou perto (dueVaccines). */
  vaccines: { vaccine: Vaccine; status: VaccineStatus }[];
  workouts: { plan: WorkoutPlan; session: WorkoutSession; done: boolean }[];
  planDrafts: ({ kind: 'workout'; plan: WorkoutPlan } | { kind: 'diet'; plan: DietPlan })[];
  /** Compromissos e aniversários de hoje e de amanhã (todayEntries). */
  events: TodayEntry[];
  chores: Chore[];
  /** As contas que vencem nos próximos dias (billsDueSoon). */
  bills: Bill[];
  budgets: BudgetLine[];
  pantry: PantryItem[];
  supplies: Supply[];
  documents: HomeDocument[];
  equipment: Equipment[];
  pendingReceipts: PendingReceipt[];
  drafts: Receipt[];
}

const one = <K extends TodayKind, D>(kind: K, placement: Placement | null, data: D): Item<K, D>[] =>
  placement ? [{ kind, placement, data }] : [];

/**
 * Tudo o que entra nos blocos, cada coisa no lugar que o estado dela diz (as que o estado deixa de fora, como a
 * tarefa de amanhã ou a garantia que ainda vai longe, não entram). A ordem de cada assunto é a de sempre: o que
 * arrangeToday desempata por ela.
 */
export function todayItems(input: TodayInput): TodayItem[] {
  const { today } = input;
  return [
    ...input.doses.flatMap((dose) => one('dose', dosePlacement(dose.time, input.nowTime), dose)),
    ...input.refills.flatMap((row) => one('refill', refillPlacement(row.alerts), row)),
    ...input.appointments.flatMap((appointment) =>
      one('appointment', appointmentPlacement(appointment.starts_at, today), { appointment, overdue: false }),
    ),
    ...input.overdueAppointments.flatMap((appointment) => one('appointment', OVERDUE_APPOINTMENT, { appointment, overdue: true })),
    ...input.vaccines.flatMap((due) => one('vaccine', vaccinePlacement(due.status), due)),
    // O treino já feito hoje sai da tela Hoje (a tela Saúde continua mostrando, marcado).
    ...input.workouts.flatMap((workout) => one('workout', workout.done ? null : WORKOUT_TODAY, workout)),
    ...input.events.flatMap((entry) => one('event', eventPlacement(entry.date, today), entry)),
    ...input.chores.flatMap((chore) => {
      const status = choreStatus(chore.due_on, today);
      return one('chore', chorePlacement(status), { chore, status });
    }),
    ...input.bills.flatMap((bill) => one('bill', billPlacement(billStatus(bill.next_due_on, today)), bill)),
    ...input.budgets.flatMap((line) => one('budget', budgetPlacement(line.status), line)),
    ...input.pantry.flatMap((item) => {
      const status = expiryStatus(item.expires_on, today);
      return one('pantry', expiryPlacement(status), { item, status });
    }),
    ...suppliesNeedingAttention(input.supplies, today).flatMap((row) => one('supply', supplyPlacement(row.forecast), row)),
    ...documentsNeedingAttention(input.documents, today).flatMap((due) => one('document', documentPlacement(due.status), due)),
    ...input.equipment.flatMap((item) => {
      const status = warrantyStatus(item.warranty_until, today);
      return one('warranty', warrantyPlacement(status), { item, status });
    }),
    ...input.pendingReceipts.flatMap((pending) => one('pendingReceipt', TO_REVIEW, pending)),
    ...input.drafts.flatMap((receipt) => one('receipt', TO_REVIEW, receipt)),
    ...input.planDrafts.flatMap((draft) => one('plan', TO_REVIEW, draft)),
  ];
}

// ---------------------------------------------------------------------------
// Os dois blocos

export interface Placed {
  kind: TodayKind;
  placement: Placement;
}

export interface TodayBlockContent<T> {
  items: T[];
  /** O assunto que passou do teto no bloco (só a despensa tem) e quantos ele tinha: o "Ver todos" diz. */
  cut: { kind: TodayKind; total: number }[];
}

/** Quantos itens da despensa cada bloco mostra; o resto fica no "Ver todos" (depois de uma compra grande, seriam muitos). */
export const PANTRY_SHOWN = 6;

const LIMITS: Partial<Record<TodayKind, number>> = { pantry: PANTRY_SHOWN };

const rank = (kind: TodayKind) => TODAY_KIND_ORDER.indexOf(kind);

function limit<T extends Placed>(sorted: T[]): TodayBlockContent<T> {
  const seen = new Map<TodayKind, number>();
  const items = sorted.filter((item) => {
    const count = (seen.get(item.kind) ?? 0) + 1;
    seen.set(item.kind, count);
    const max = LIMITS[item.kind];
    return max === undefined || count <= max;
  });
  const cut = [...seen].flatMap(([kind, total]) => {
    const max = LIMITS[kind];
    return max !== undefined && total > max ? [{ kind, total }] : [];
  });
  return { items, cut };
}

/**
 * Agora e Em breve, o mais urgente primeiro. Em "Agora", o atrasado antes do que é de hoje; em "Em breve", o mais
 * perto antes (o sem data por último). No mesmo nível, a ordem dos assuntos (TODAY_KIND_ORDER) e, dentro do
 * assunto, a ordem em que eles vieram (a de cada um: as doses pelo horário, os documentos pela data…).
 */
export function arrangeToday<T extends Placed>(items: readonly T[]): { agora: TodayBlockContent<T>; emBreve: TodayBlockContent<T> } {
  const indexed = items.map((item, index) => ({ item, index }));
  const urgencyRank = (placement: Placement) => (placement.urgency === 'atrasado' ? 0 : 1);
  const daysOf = (placement: Placement) => (placement.urgency === 'breve' ? (placement.days ?? Infinity) : 0);
  const agora = indexed
    .filter(({ item }) => item.placement.urgency !== 'breve')
    .sort(
      (a, b) =>
        urgencyRank(a.item.placement) - urgencyRank(b.item.placement) || rank(a.item.kind) - rank(b.item.kind) || a.index - b.index,
    );
  const emBreve = indexed
    .filter(({ item }) => item.placement.urgency === 'breve')
    .sort((a, b) => {
      const days = daysOf(a.item.placement) - daysOf(b.item.placement);
      // Infinity - Infinity é NaN: dois sem data empatam aqui.
      return (Number.isNaN(days) ? 0 : days) || rank(a.item.kind) - rank(b.item.kind) || a.index - b.index;
    });
  return { agora: limit(agora.map(({ item }) => item)), emBreve: limit(emBreve.map(({ item }) => item)) };
}

/** O "Ver todos" do assunto cortado no bloco: "Ver todos da despensa (9)". */
export function seeAllLabel(cut: { kind: TodayKind; total: number }): string {
  return cut.kind === 'pantry' ? `Ver todos da despensa (${cut.total})` : `Ver todos (${cut.total})`;
}

// ---------------------------------------------------------------------------
// A frase do topo e o "Tudo em dia"

/**
 * Quantas coisas pedem atenção: tudo dos dois blocos (também o que ficou no "Ver todos"), menos os compromissos e
 * aniversários, que não são pendência (com uma rotina de toda semana, haveria um quase todo dia).
 */
export function todayAttention(items: readonly Placed[]): number {
  return items.filter((item) => item.kind !== 'event').length;
}

/** Só diz "tudo em dia" depois que tudo carregou, e sem nada que conte. */
export function nothingPending(loaded: boolean, attention: number): boolean {
  return loaded && attention === 0;
}

/** A frase do topo, a mesma conta do que está nos blocos. */
export function todaySummary(loaded: boolean, attention: number): string {
  if (nothingPending(loaded, attention)) return 'Tudo em dia por aqui.';
  if (attention > 0) return `${attention} ${attention === 1 ? 'coisa pede' : 'coisas pedem'} sua atenção.`;
  return 'Veja o que tem para hoje.';
}

export const ALL_CLEAR_TITLE = 'Tudo em dia';

/** O cartão do "Tudo em dia": com Finanças desligada, nada de conta. */
export function allClearMessage(finance: boolean): string {
  return finance
    ? 'Nenhum remédio, consulta, tarefa, conta, validade ou documento pedindo atenção agora.'
    : 'Nenhum remédio, consulta, tarefa, validade ou documento pedindo atenção agora.';
}

// ---------------------------------------------------------------------------
// O atalho "Lista de mercado"

export const MARKET_LIST_SHORTCUT = 'Lista de mercado';

export const MARKET_LIST_OFFLINE =
  'Sem internet agora, e este aparelho não tem uma lista de mercado aberta guardada. Tente de novo quando a conexão voltar.';

interface ListLike {
  id: string;
  kind: string;
  archived_at: string | null;
  created_at: string;
}

/**
 * O que o atalho faz: com internet, pergunta ao servidor (open_market_list: a lista de mercado aberta mais
 * recente da casa, ou uma nova; a que este aparelho guardou pode ter sido arquivada em outro, ou outra pessoa pode
 * ter criado uma agora). Sem internet, abre a mais recente das que o aparelho guardou; sem nenhuma, avisa (criar
 * lista precisa de internet).
 */
export function marketListShortcut(
  online: boolean,
  lists: readonly ListLike[] | undefined,
): { kind: 'ask' } | { kind: 'open'; id: string } | { kind: 'offline' } {
  if (online) return { kind: 'ask' };
  const newest = (lists ?? [])
    .filter((list) => list.kind === 'mercado' && !list.archived_at)
    .reduce<ListLike | null>((best, list) => (!best || list.created_at > best.created_at ? list : best), null);
  return newest ? { kind: 'open', id: newest.id } : { kind: 'offline' };
}

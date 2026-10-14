// Despensa, tarefas da casa e remédios.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';

import { SAME_PURCHASE_DAYS, type PantryEntry } from '@/domain/cartPantry';
import { addDays, diffDays } from '@/domain/dates';
import {
  DEFAULT_DOSE_UNITS,
  DEFAULT_WARN_DAYS,
  type StockChanges,
  type StockCount,
  type StockedMedication,
} from '@/domain/medicationStock';
import { doseKey, takenOn } from '@/domain/medications';
import type { PantryTake } from '@/domain/pantry';
import { supabase, unwrap } from '@/lib/supabase';
import type { Chore, Medication, MedicationDose, PantryItem, Unit } from '@/lib/types';

// ---------------------------------------------------------------------------
// Despensa

const PANTRY_COLUMNS =
  'id, product_id, name, category, quantity, unit, purchased_on, expires_on, expiry_source, consumed_at';

export function usePantry() {
  return useQuery({
    queryKey: ['pantry'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('pantry_items')
          .select(PANTRY_COLUMNS)
          .is('consumed_at', null)
          .order('expires_on', { ascending: true, nullsFirst: false })
          .order('name'),
      ) as PantryItem[],
  });
}

/**
 * Entradas da despensa que não vieram de nota (carrinho ou à mão), compradas
 * perto desta data: a nota que chega depois pergunta antes de repetir.
 */
export async function fetchPantryNear(purchasedOn: string): Promise<PantryEntry[]> {
  return unwrap(
    await supabase
      .from('pantry_items')
      .select('product_id, name, purchased_on')
      .is('receipt_item_id', null)
      .gte('purchased_on', addDays(purchasedOn, -SAME_PURCHASE_DAYS))
      .lte('purchased_on', addDays(purchasedOn, SAME_PURCHASE_DAYS)),
  ) as PantryEntry[];
}

export function usePantryItem(id: string | undefined) {
  return useQuery({
    queryKey: ['pantry', id],
    enabled: Boolean(id),
    queryFn: async () =>
      unwrap(await supabase.from('pantry_items').select(PANTRY_COLUMNS).eq('id', id!).single()) as PantryItem,
  });
}

export interface PantryValues {
  name: string;
  category: string;
  quantity: number;
  unit: Unit;
  purchased_on: string;
  expires_on: string | null;
  expiry_source: PantryItem['expiry_source'];
}

/** Quantos produtos a validade aprendida tenta alcançar: cada volta a mais é uma junção feita no meio do caminho. */
const LEARN_ATTEMPTS = 3;

/**
 * A validade corrigida à mão ensina o produto. O produto que a tela conhecia pode ter sido juntado com outro em
 * outro aparelho: a gravação não acha linha nenhuma, e o banco não reclama. Aí vale o produto em que o item da
 * despensa está agora (a junção passou o item para o que ficou), e a gravação é conferida de novo: esse também
 * pode ter sido juntado entre a leitura e a gravação. Para depois de LEARN_ATTEMPTS produtos, ou quando o item
 * aponta para um já tentado ou para nenhum. O item em si já está salvo: aqui nada falha.
 */
export async function learnShelfLife(productId: string, days: number, pantryItemId?: string): Promise<void> {
  const tried = new Set<string>();
  let target: string | null = productId;
  while (target && !tried.has(target) && tried.size < LEARN_ATTEMPTS) {
    tried.add(target);
    const learned = (unwrap(await supabase.from('products').update({ shelf_life_days: days }).eq('id', target).select('id')) ?? []) as { id: string }[];
    if (learned.length || !pantryItemId) return;
    const item = unwrap(await supabase.from('pantry_items').select('product_id').eq('id', pantryItemId).maybeSingle()) as { product_id: string | null } | null;
    target = item?.product_id ?? null;
  }
}

export function useSavePantryItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values, productId }: { id?: string; values: PantryValues; productId?: string | null }) => {
      if (id) unwrap(await supabase.from('pantry_items').update(values).eq('id', id));
      else unwrap(await supabase.from('pantry_items').insert(values));
      // Validade corrigida à mão ensina o produto: a próxima compra já vem certa.
      if (productId && values.expiry_source === 'manual' && values.expires_on) {
        const days = Math.max(1, diffDays(values.purchased_on, values.expires_on));
        await learnShelfLife(productId, days, id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pantry'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

/** Dá baixa nas compras (um produto inteiro na despensa, ou uma compra só). */
export function useConsumePantryItems() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) =>
      unwrap(await supabase.from('pantry_items').update({ consumed_at: new Date().toISOString() }).in('id', ids)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pantry'] }),
  });
}

/**
 * "Usei 1" (ver takeOne): desconta da compra mais antiga ou dá baixa nela.
 * Só grava se a compra ainda tem a quantidade lida: duas pessoas usando ao
 * mesmo tempo não contam uma vez só.
 */
export function useTakeOneFromPantry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, from, remaining }: PantryTake) => {
      const changed = unwrap(
        await supabase
          .from('pantry_items')
          .update(remaining == null ? { consumed_at: new Date().toISOString() } : { quantity: remaining })
          .eq('id', id)
          .eq('quantity', from)
          .is('consumed_at', null)
          .select('id'),
      ) as { id: string }[];
      if (!changed.length) throw new Error('A despensa mudou enquanto isso. Confira e tente de novo.');
    },
    // Também na falha: a tela mostra o que está na despensa agora.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['pantry'] }),
  });
}

// ---------------------------------------------------------------------------
// Tarefas

const CHORE_COLUMNS = 'id, title, notes, recurrence, interval_count, due_on, assigned_to, active, equipment_id, kid_id, points';

export async function fetchChores(db: SupabaseClient = supabase): Promise<Chore[]> {
  return unwrap(await db.from('chores').select(CHORE_COLUMNS).eq('active', true).order('due_on').order('title')) as Chore[];
}

export function useChores() {
  return useQuery({ queryKey: ['chores'], queryFn: () => fetchChores() });
}

export function useChore(id: string | undefined) {
  return useQuery({
    queryKey: ['chores', id],
    enabled: Boolean(id),
    queryFn: async () =>
      unwrap(await supabase.from('chores').select(CHORE_COLUMNS).eq('id', id!).single()) as Chore,
  });
}

export type ChoreValues = Pick<Chore, 'title' | 'notes' | 'recurrence' | 'interval_count' | 'due_on' | 'assigned_to'> &
  Partial<Pick<Chore, 'equipment_id' | 'kid_id' | 'points'>>;

export function useSaveChore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: ChoreValues }) =>
      id
        ? unwrap(await supabase.from('chores').update(values).eq('id', id))
        : unwrap(await supabase.from('chores').insert(values)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chores'] }),
  });
}

/** O que a conclusão fez: se registrou (toque repetido não registra), os pontos que deu e para quem. */
export interface CompleteChoreResult {
  completed: boolean;
  points: number;
  person_id: string | null;
  due_on: string;
  active: boolean;
}

export function useCompleteChore() {
  const queryClient = useQueryClient();
  return useMutation({
    // dueOn: o vencimento na tela. Se a tarefa já andou (toque duplo, outro
    // celular), o servidor não registra de novo nem credita pontos outra vez.
    mutationFn: async ({ id, today, dueOn }: { id: string; today: string; dueOn: string }) =>
      unwrap(await supabase.rpc('complete_chore', { p_chore_id: id, p_today: today, p_due_on: dueOn })) as CompleteChoreResult,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chores'] });
      queryClient.invalidateQueries({ queryKey: ['choreHistory'] });
      queryClient.invalidateQueries({ queryKey: ['kidPoints'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Pontos das crianças

/** Saldo de pontos por ficha (tarefas feitas menos prêmios trocados). */
export function useKidPoints() {
  return useQuery({
    queryKey: ['kidPoints'],
    queryFn: async () =>
      Object.fromEntries(
        (unwrap(await supabase.from('kid_points').select('person_id, balance')) as { person_id: string; balance: number }[]).map(
          (p) => [p.person_id, Number(p.balance)],
        ),
      ) as Record<string, number>,
  });
}

/**
 * Tarefas feitas e prêmios de uma criança (os mais recentes) e os pontos
 * ganhos desde `weekStart` (AAAA-MM-DD, local), somados à parte: o histórico
 * é cortado e a semana não pode ser.
 */
export function useKidHistory(personId: string, weekStart: string) {
  return useQuery({
    queryKey: ['kidPoints', personId, weekStart],
    queryFn: async () => {
      const [completions, redemptions, week] = await Promise.all([
        supabase
          .from('chore_completions')
          .select('id, points, completed_at, chore_title, chore:chores(title)')
          .eq('person_id', personId)
          .gt('points', 0)
          .order('completed_at', { ascending: false })
          .limit(30),
        supabase
          .from('point_redemptions')
          .select('id, points, created_at, title')
          .eq('person_id', personId)
          .order('created_at', { ascending: false })
          .limit(30),
        supabase
          .from('chore_completions')
          .select('points')
          .eq('person_id', personId)
          .gt('points', 0)
          .gte('completed_at', new Date(`${weekStart}T00:00:00`).toISOString()),
      ]);
      type CompletionRow = {
        id: string;
        points: number;
        completed_at: string;
        chore_title: string | null;
        chore: { title: string } | null;
      };
      return {
        completions: (unwrap(completions) as unknown as CompletionRow[]).map((c) => ({
          id: c.id,
          points: c.points,
          completed_at: c.completed_at,
          // Tarefa apagada: vale o nome guardado na conclusão.
          title: c.chore?.title ?? c.chore_title ?? 'Tarefa',
        })),
        redemptions: unwrap(redemptions) as { id: string; points: number; created_at: string; title: string }[],
        weekPoints: (unwrap(week) as { points: number }[]).reduce((sum, c) => sum + c.points, 0),
      };
    },
  });
}

export function useRedeemPoints() {
  const queryClient = useQueryClient();
  return useMutation({
    // Pela função: trava a ficha e não deixa dois prêmios ao mesmo tempo passarem do saldo.
    mutationFn: async (input: { person_id: string; title: string; points: number }) =>
      unwrap(await supabase.rpc('redeem_points', { p_person_id: input.person_id, p_title: input.title, p_points: input.points })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['kidPoints'] }),
  });
}

export function useDeleteChore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('chores').delete().eq('id', id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['chores'] }),
  });
}

// ---------------------------------------------------------------------------
// Remédios

/** doseKey de cada dose marcada (o que as regras leem). */
const takenKeys = (doses: MedicationDose[]) => new Set(doses.map((d) => doseKey(d.medication_id, d.scheduled_on, d.scheduled_time)));

function schedule(m: Medication, today: string, taken: ReadonlySet<string> | undefined): StockedMedication {
  return {
    id: m.id,
    personName: m.person_name,
    name: m.name,
    dosage: m.dosage,
    times: m.times,
    startOn: m.start_on,
    endOn: m.end_on,
    active: m.active,
    frequency: m.frequency,
    weekdays: m.weekdays,
    intervalDays: m.interval_days,
    totalDoses: m.total_doses,
    takenCount: m.taken_count,
    takenToday: taken && takenOn(m, today, taken),
    stockCount: m.stock_count,
    stockCountedOn: m.stock_counted_on,
    doseUnits: m.dose_units,
    warnDays: m.stock_warn_days,
    prescriptionUntil: m.prescription_until,
  };
}

/**
 * O remédio como as regras o leem. `doses` são as doses marcadas em `today`
 * (useDoses(today)); delas sai `takenToday`, que a conta do estoque de um
 * tratamento por número de doses usa para o estado não mudar a cada dose
 * marcada. undefined enquanto não carregaram: a conta segue sem elas. Os dois
 * são obrigatórios de propósito: a tela, o Nuke ou o aviso que montasse o
 * remédio sem as marcações de hoje daria uma resposta diferente dos outros.
 */
export function toSchedule(m: Medication, today: string, doses: MedicationDose[] | undefined): StockedMedication {
  return schedule(m, today, doses && takenKeys(doses));
}

/** Todos os remédios, como toSchedule. */
export function toSchedules(medications: Medication[], today: string, doses: MedicationDose[] | undefined): StockedMedication[] {
  const taken = doses && takenKeys(doses);
  return medications.map((m) => schedule(m, today, taken));
}

type StockColumn = 'stock_count' | 'stock_counted_on' | 'dose_units' | 'stock_warn_days' | 'prescription_until';

const BASE_COLUMNS =
  'id, person_id, person_name, name, dosage, times, start_on, end_on, notes, active, frequency, weekdays, interval_days, total_doses';
const STOCK_COLUMNS = 'stock_count, stock_counted_on, dose_units, stock_warn_days, prescription_until';
// Com a contagem de doses tomadas, para os tratamentos por número de doses.
const DOSES_COUNT = 'medication_doses(count)';
const MEDICATION_COLUMNS = `${BASE_COLUMNS}, ${STOCK_COLUMNS}, ${DOSES_COUNT}`;
/** As colunas de antes do estoque, para o banco que ainda não recebeu a migração dele. */
const LEGACY_MEDICATION_COLUMNS = `${BASE_COLUMNS}, ${DOSES_COUNT}`;

/** O que a pessoa lê quando tenta salvar o estoque e o banco ainda não tem as colunas dele. */
export const MEDICATION_STOCK_UNAVAILABLE = 'O estoque de remédios ainda está sendo ativado no Kotii. Tente de novo mais tarde.';

/**
 * As colunas do estoque ainda não existem no banco (o app chegou antes da
 * migração): numa leitura o Postgres responde 42703 ("column
 * medications.stock_count does not exist") e, numa gravação, o PostgREST
 * responde PGRST204 ("Could not find the 'stock_count' column of
 * 'medications' in the schema cache"). Só vale quando o erro fala de uma
 * delas: outra coluna que falte é erro de verdade.
 */
export function isMissingStockColumn(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof message !== 'string' || !/stock_count|stock_counted_on|dose_units|stock_warn_days|prescription_until/.test(message)) return false;
  return code === '42703' || code === 'PGRST204' || /does not exist|could not find/i.test(message);
}

type MedicationRow = Omit<Medication, 'taken_count' | StockColumn> &
  Partial<Pick<Medication, StockColumn>> & { medication_doses?: { count: number }[] };

const fromRow = ({ medication_doses, ...m }: MedicationRow): Medication => ({
  ...m,
  taken_count: medication_doses?.[0]?.count ?? 0,
  // Sem as colunas do estoque (banco de antes dele), o app não acompanha o estoque de nenhum remédio.
  stock_count: m.stock_count == null ? null : Number(m.stock_count),
  stock_counted_on: m.stock_counted_on ?? null,
  dose_units: Number(m.dose_units ?? DEFAULT_DOSE_UNITS),
  stock_warn_days: m.stock_warn_days ?? DEFAULT_WARN_DAYS,
  prescription_until: m.prescription_until ?? null,
});

type Answer = { data: unknown; error: unknown };

/**
 * Lê (ou grava e lê de volta) com as colunas do estoque; se o banco ainda não
 * as tem, repete com as de antes. A primeira tentativa não grava nada: a
 * coluna que falta derruba o pedido inteiro.
 */
async function withStockFallback(run: (columns: string) => PromiseLike<Answer>): Promise<{ answer: Answer; legacy: boolean }> {
  const answer = await run(MEDICATION_COLUMNS);
  return isMissingStockColumn(answer.error) ? { answer: await run(LEGACY_MEDICATION_COLUMNS), legacy: true } : { answer, legacy: false };
}

export async function fetchMedications(db: SupabaseClient = supabase): Promise<Medication[]> {
  const { answer } = await withStockFallback((columns) =>
    db.from('medications').select(columns).eq('active', true).order('person_name').order('name'),
  );
  return (unwrap(answer) as MedicationRow[]).map(fromRow);
}

export function useMedications() {
  return useQuery({ queryKey: ['medications'], queryFn: () => fetchMedications() });
}

export async function fetchMedication(id: string, db: SupabaseClient = supabase): Promise<Medication> {
  const { answer } = await withStockFallback((columns) => db.from('medications').select(columns).eq('id', id).single());
  return fromRow(unwrap(answer) as MedicationRow);
}

export function useMedication(id: string | undefined) {
  return useQuery({ queryKey: ['medications', id], enabled: Boolean(id), queryFn: () => fetchMedication(id!) });
}

export type MedicationValues = Pick<
  Medication,
  | 'person_id'
  | 'person_name'
  | 'name'
  | 'dosage'
  | 'times'
  | 'start_on'
  | 'end_on'
  | 'notes'
  | 'frequency'
  | 'weekdays'
  | 'interval_days'
  | 'total_doses'
>;

/** O que a seção "Estoque e receita" grava: só as colunas em que a pessoa mexeu. */
export type MedicationStockValues = Partial<Pick<Medication, StockColumn>>;

export function toStockValues(changes: StockChanges): MedicationStockValues {
  const values: MedicationStockValues = {};
  if (changes.stockCount !== undefined) values.stock_count = changes.stockCount;
  if (changes.stockCountedOn !== undefined) values.stock_counted_on = changes.stockCountedOn;
  if (changes.doseUnits !== undefined) values.dose_units = changes.doseUnits;
  if (changes.warnDays !== undefined) values.stock_warn_days = changes.warnDays;
  if (changes.prescriptionUntil !== undefined) values.prescription_until = changes.prescriptionUntil;
  return values;
}

export interface SavedMedication {
  medication: Medication;
  /** A pessoa mexeu no estoque e o banco ainda não tem as colunas dele: o resto foi salvo, o estoque não. */
  stockUnavailable: boolean;
}

/**
 * Cria ou muda o remédio, com o que mudou na seção do estoque (`stock`). Num
 * banco de antes do estoque, o remédio salva como sempre e `stockUnavailable`
 * diz se ficou algo do estoque de fora, para a tela avisar.
 */
export async function saveMedication(
  { id, values, stock }: { id?: string; values: MedicationValues; stock?: MedicationStockValues },
  db: SupabaseClient = supabase,
): Promise<SavedMedication> {
  const wantsStock = Boolean(stock && Object.keys(stock).length);
  const { answer, legacy } = await withStockFallback((columns) => {
    const body = columns === MEDICATION_COLUMNS ? { ...values, ...stock } : values;
    const table = db.from('medications');
    return (id ? table.update(body).eq('id', id) : table.insert(body)).select(columns).single();
  });
  return { medication: fromRow(unwrap(answer) as MedicationRow), stockUnavailable: legacy && wantsStock };
}

export function useSaveMedication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id?: string; values: MedicationValues; stock?: MedicationStockValues }) => saveMedication(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['medications'] }),
  });
}

/** "Comprei mais": grava a contagem nova (ver restock). Num banco de antes do estoque, avisa. */
export async function restockMedication({ id, count }: { id: string; count: StockCount }, db: SupabaseClient = supabase): Promise<void> {
  const result = await db
    .from('medications')
    .update({ stock_count: count.stockCount, stock_counted_on: count.stockCountedOn })
    .eq('id', id);
  if (isMissingStockColumn(result.error)) throw new Error(MEDICATION_STOCK_UNAVAILABLE);
  unwrap(result);
}

export function useRestockMedication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; count: StockCount }) => restockMedication(input),
    onSuccess: (_data, { id, count }) => {
      // Já na tela, sem esperar a busca: salvar o remédio logo em seguida parte da contagem nova.
      queryClient.setQueryData<Medication>(
        ['medications', id],
        (m) => m && { ...m, stock_count: count.stockCount, stock_counted_on: count.stockCountedOn },
      );
      queryClient.invalidateQueries({ queryKey: ['medications'] });
    },
  });
}

export function useArchiveMedication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      unwrap(await supabase.from('medications').update({ active: false }).eq('id', id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['medications'] }),
  });
}

/** As doses marcadas num dia. */
export async function fetchDoses(date: string, db: SupabaseClient = supabase): Promise<MedicationDose[]> {
  return unwrap(
    await db.from('medication_doses').select('id, medication_id, scheduled_on, scheduled_time, taken_at').eq('scheduled_on', date),
  ) as MedicationDose[];
}

export function useDoses(date: string) {
  return useQuery({ queryKey: ['doses', date], queryFn: () => fetchDoses(date) });
}

export function useToggleDose(date: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ medicationId, time, taken }: { medicationId: string; time: string; taken: boolean }) => {
      if (taken) {
        unwrap(
          await supabase
            .from('medication_doses')
            .upsert(
              { medication_id: medicationId, scheduled_on: date, scheduled_time: time },
              { onConflict: 'medication_id,scheduled_on,scheduled_time', ignoreDuplicates: true },
            ),
        );
      } else {
        unwrap(
          await supabase
            .from('medication_doses')
            .delete()
            .eq('medication_id', medicationId)
            .eq('scheduled_on', date)
            .eq('scheduled_time', time),
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['doses', date] });
      // A contagem de tomadas encerra os tratamentos por número de doses.
      queryClient.invalidateQueries({ queryKey: ['medications'] });
    },
  });
}

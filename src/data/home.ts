// Despensa, tarefas da casa e remédios.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';

import { SAME_PURCHASE_DAYS, type PantryEntry } from '@/domain/cartPantry';
import { groupRotations, isRotationRefused, isRotationUnavailable, ROTATION_NOT_READY, type ChoreRotations } from '@/domain/choreRotation';
import { choreGoneOnSave } from '@/domain/chores';
import { addDays, diffDays } from '@/domain/dates';
import type { MedicationSchedule } from '@/domain/medications';
import type { PantryTake } from '@/domain/pantry';
import { supabase, unwrap } from '@/lib/supabase';
import type { Chore, ChoreRotationRow, Medication, MedicationDose, PantryItem, Unit } from '@/lib/types';

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

/**
 * A tarefa inteira (o tipo Chore), para toda busca de tarefas: quem conclui passa a linha ao aviso da conclusão
 * (completionMessage), e sem kid_id a vez de uma criança pareceria ter passado em outro celular.
 */
export const CHORE_COLUMNS = 'id, title, notes, recurrence, interval_count, due_on, assigned_to, active, equipment_id, kid_id, points';

export async function fetchChores(db: SupabaseClient = supabase): Promise<Chore[]> {
  return unwrap(await db.from('chores').select(CHORE_COLUMNS).eq('active', true).order('due_on').order('title')) as Chore[];
}

export function useChores() {
  return useQuery({ queryKey: ['chores'], queryFn: () => fetchChores() });
}

/**
 * `fresh`: para o editor. Busca de novo ao abrir a tela, mesmo com o cache
 * recente: o formulário não pode partir de uma tarefa (ou de uma ordem de
 * rodízio) que outro celular já mudou, porque salvaria por cima.
 */
interface FreshOption {
  fresh?: boolean;
}

export function useChore(id: string | undefined, { fresh = false }: FreshOption = {}) {
  return useQuery({
    queryKey: ['chores', id],
    enabled: Boolean(id),
    refetchOnMount: fresh ? 'always' : true,
    queryFn: async () =>
      unwrap(await supabase.from('chores').select(CHORE_COLUMNS).eq('id', id!).single()) as Chore,
  });
}

/**
 * As ordens de rodízio da casa, por tarefa (ver domain/choreRotation). No
 * banco que ainda não tem o rodízio (o app pode chegar antes da migração),
 * nenhuma, sem erro: as telas seguem como se ninguém revezasse.
 */
export async function fetchChoreRotations(db: SupabaseClient = supabase): Promise<ChoreRotations> {
  const result = await db.from('chore_rotation').select('chore_id, person_id, position').order('position');
  if (result.error && isRotationUnavailable(result.error)) return {};
  return groupRotations(unwrap(result) as ChoreRotationRow[]);
}

export function useChoreRotations({ fresh = false }: FreshOption = {}) {
  return useQuery({ queryKey: ['choreRotations'], refetchOnMount: fresh ? 'always' : true, queryFn: () => fetchChoreRotations() });
}

// Sem assigned_to e kid_id, a edição não mexe no responsável (num rodízio, a vez fica com o banco); sem points, os
// pontos ficam como estão.
export type ChoreValues = Pick<Chore, 'title' | 'notes' | 'recurrence' | 'interval_count' | 'due_on'> &
  Partial<Pick<Chore, 'assigned_to' | 'equipment_id' | 'kid_id' | 'points'>>;

/** A tarefa salva. */
export interface SaveChoreResult {
  id: string;
  /** O banco ainda não tem o rodízio: a tarefa ficou salva, sem a ordem pedida. */
  rotationUnavailable?: true;
}

/**
 * Salva a tarefa inteira numa chamada só (save_chore): os campos, o
 * responsável e a ordem do rodízio (`rotation`; vazia: encerra o que havia;
 * sem ela, o formulário não mexe no rodízio), numa transação do banco. Ou
 * tudo fica gravado, ou nada: a recusa (a tarefa ganhou um rodízio em outro
 * celular, foi apagada, alguém da ordem saiu da casa) e a falha de rede sobem
 * como erro, e salvar de novo é seguro.
 *
 * O responsável (`assigned_to`, `kid_id`) só é mandado sem uma ordem a
 * gravar: aí é o que a pessoa escolheu. Com a ordem, a vez é do banco (do
 * primeiro, no rodízio novo), e o responsável que vier em `values` só serve
 * ao banco que ainda não tem a função (abaixo).
 *
 * `expectNone`: o formulário de uma tarefa que já existe abriu sem rodízio
 * (openedWithoutRotation). O banco confere, com a tarefa travada, que ela
 * segue sem rodízio, e recusa se outro celular criou um nesse meio-tempo
 * (isRotationChangedElsewhere).
 *
 * `shownRotation`: o formulário mostrou um rodízio gravado. Então o banco tem o rodízio, e a função faltar só pode
 * ser o cache do esquema da API: o salvar nunca vai direto na tabela (abaixo).
 */
export async function saveChore({
  id,
  values,
  rotation = null,
  expectNone = false,
  shownRotation = false,
}: {
  id?: string;
  values: ChoreValues;
  rotation?: string[] | null;
  expectNone?: boolean;
  shownRotation?: boolean;
}): Promise<SaveChoreResult> {
  const setsTurn = !rotation?.length && (values.assigned_to !== undefined || values.kid_id !== undefined);
  const { data, error } = await supabase.rpc('save_chore', {
    p_chore_id: id ?? null,
    p_title: values.title,
    p_notes: values.notes,
    p_recurrence: values.recurrence,
    p_interval_count: values.interval_count,
    p_due_on: values.due_on,
    // Nulo: os pontos ficam como estão (0 na tarefa nova).
    p_points: values.points ?? null,
    p_equipment_id: values.equipment_id ?? null,
    p_set_turn: setsTurn,
    p_assigned_to: setsTurn ? (values.assigned_to ?? null) : null,
    p_kid_id: setsTurn ? (values.kid_id ?? null) : null,
    p_people: rotation,
    // Na tarefa nova não há o que conferir.
    p_expect_none: Boolean(id) && expectNone,
  });
  if (!error) return { id: data as string };
  if (!isRotationUnavailable(error)) throw error;
  // Com o rodízio na tela, a gravação direta que mantém a vez (encerrar o rodízio com a mesma pessoa, uma ordem nova,
  // só o título) passaria pelo banco e deixaria a ordem como estava. Nada é gravado, e daqui a pouco vai pela função.
  if (shownRotation) throw new Error(ROTATION_NOT_READY);

  // A função falta. Gravar direto na tabela só vale no banco que também não tem a tabela do rodízio: com ela lá (a
  // migração chegou e a API ainda não enxerga a função nova), a gravação direta não mexeria na ordem, e a tarefa que
  // deixou o rodízio continuaria nele. Aí nada é gravado, e salvar de novo daqui a pouco usa a função. Esta olhada
  // passa pela mesma API: se ela também não enxerga a tabela, quem segura é o banco (abaixo).
  const table = await supabase.from('chore_rotation').select('chore_id').limit(1);
  if (!table.error) throw new Error(ROTATION_NOT_READY);
  if (!isRotationUnavailable(table.error)) throw table.error;

  // Banco que ainda não tem o rodízio (o app pode chegar antes da migração). Lá não há rodízio, nem a corrida por
  // ele: a tarefa vai direto na tabela, como antes de o rodízio existir, e a ordem pedida fica de fora.
  if (id) {
    const result = await supabase.from('chores').update(values).eq('id', id).select('id');
    // A API também não enxergava a tabela, mas o banco já tem o rodízio (o cache do esquema ficou para trás): ele
    // recusa a troca da vez de uma tarefa em rodízio. Nada foi gravado, e daqui a pouco o salvar passa pela função.
    if (result.error && isRotationRefused(result.error)) throw new Error(ROTATION_NOT_READY);
    const written = unwrap(result) as { id: string }[];
    // Apagada em outro aparelho: a gravação não acha a linha, e para a API isso não é erro.
    if (!written.length) throw choreGoneOnSave();
  }
  const saved = id ?? (unwrap(await supabase.from('chores').insert(values).select('id').single()) as { id: string }).id;
  return rotation?.length ? { id: saved, rotationUnavailable: true } : { id: saved };
}

export function useSaveChore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveChore,
    // Também na falha: se o banco recusou porque a tarefa ganhou um rodízio em outro celular, as telas passam a
    // mostrá-lo; e a chamada que falhou pela rede pode ter chegado ao banco e gravado a tarefa.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['chores'] });
      queryClient.invalidateQueries({ queryKey: ['choreRotations'] });
    },
  });
}

/** O que a conclusão fez: se registrou (toque repetido não registra), os pontos que deu e para quem. */
export interface CompleteChoreResult {
  completed: boolean;
  points: number;
  person_id: string | null;
  due_on: string;
  active: boolean;
  /** Rodízio: a ficha de quem passa a ser a vez. Não vem do banco que ainda não tem o rodízio. */
  next_person_id?: string | null;
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
      queryClient.invalidateQueries({ queryKey: ['choreRotations'] });
      queryClient.invalidateQueries({ queryKey: ['choreHistory'] });
      queryClient.invalidateQueries({ queryKey: ['kidPoints'] });
    },
  });
}

/**
 * "Pular a vez": passa a vez para o próximo do rodízio sem concluir a tarefa.
 * from: a ficha de quem a tela mostrava a vez; se ela já passou (outro
 * celular tocou antes), o servidor não passa de novo e devolve null.
 */
export function useSkipChoreTurn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, from }: { id: string; from: string | null }) => {
      const result = await supabase.rpc('skip_chore_turn', { p_chore_id: id, p_from: from });
      if (result.error) throw result.error;
      // De quem a vez passou a ser; null quando nada mudou.
      return result.data as string | null;
    },
    // Também quando nada mudou ou falhou: a tela mostra de quem é a vez agora.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['chores'] });
      queryClient.invalidateQueries({ queryKey: ['choreRotations'] });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chores'] });
      queryClient.invalidateQueries({ queryKey: ['choreRotations'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Remédios

export function toSchedule(m: Medication): MedicationSchedule {
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
  };
}

// Com a contagem de doses tomadas, para os tratamentos por número de doses.
const MEDICATION_COLUMNS =
  'id, person_id, person_name, name, dosage, times, start_on, end_on, notes, active, frequency, weekdays, interval_days, total_doses, medication_doses(count)';

type MedicationRow = Omit<Medication, 'taken_count'> & { medication_doses?: { count: number }[] };

const fromRow = ({ medication_doses, ...m }: MedicationRow): Medication => ({
  ...m,
  taken_count: medication_doses?.[0]?.count ?? 0,
});

export async function fetchMedications(db: SupabaseClient = supabase): Promise<Medication[]> {
  return (
    unwrap(await db.from('medications').select(MEDICATION_COLUMNS).eq('active', true).order('person_name').order('name')) as MedicationRow[]
  ).map(fromRow);
}

export function useMedications() {
  return useQuery({ queryKey: ['medications'], queryFn: () => fetchMedications() });
}

export function useMedication(id: string | undefined) {
  return useQuery({
    queryKey: ['medications', id],
    enabled: Boolean(id),
    queryFn: async () =>
      fromRow(unwrap(await supabase.from('medications').select(MEDICATION_COLUMNS).eq('id', id!).single()) as MedicationRow),
  });
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

export function useSaveMedication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: MedicationValues }) =>
      fromRow(
        (id
          ? unwrap(await supabase.from('medications').update(values).eq('id', id).select(MEDICATION_COLUMNS).single())
          : unwrap(await supabase.from('medications').insert(values).select(MEDICATION_COLUMNS).single())) as MedicationRow,
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['medications'] }),
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

export function useDoses(date: string) {
  return useQuery({
    queryKey: ['doses', date],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('medication_doses')
          .select('id, medication_id, scheduled_on, scheduled_time, taken_at')
          .eq('scheduled_on', date),
      ) as MedicationDose[],
  });
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

// Mercado: listas de compras, produtos, lojas e preços.

import {
  type QueryClient,
  type QueryFunctionContext,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect } from 'react';

import type { CartPantryEntry } from '@/domain/cartPantry';
import { LinkIndex, type ListLink, type OpenListItem } from '@/domain/listLinks';
import { PRICE_ALERT_HISTORY_DAYS } from '@/domain/priceAlert';
import type { PurchaseRecord } from '@/domain/recentPurchases';
import { RESTOCK_HISTORY_DAYS } from '@/domain/restock';
import { normalizeSearch } from '@/domain/search';
import { supabase, unwrap } from '@/lib/supabase';
import type {
  LatestPrice,
  PriceObservation,
  Product,
  ShoppingList,
  ShoppingListItem,
  Store,
  Unit,
} from '@/lib/types';

// ---------------------------------------------------------------------------
// Listas

/** Fila da lista (marcações e limpar o carrinho) ainda andando, inclusive a restaurada ao reabrir o app. */
export function useListQueueBusy() {
  return useIsMutating({ predicate: inListQueue }) > 0;
}

/**
 * Busca de listas e itens que respeita a fila: com marcações ainda por
 * enviar, a resposta do servidor desfaria na tela as que faltam. Então
 * qualquer busca (automática, puxar para atualizar, tentar de novo) devolve o
 * que já está no cache, e a busca de verdade vem quando a fila acaba
 * (registerListMutations).
 */
export function unlessListQueueBusy<T>(fetch: () => Promise<T>) {
  return async ({ client, queryKey }: QueryFunctionContext) => {
    const cached = client.getQueryData<T>(queryKey);
    if (cached !== undefined && listQueueBusy(client)) return cached;
    return fetch();
  };
}

type ListItemRef = { name: string; product_id: string | null; checked_at: string | null };
type ListSummary = ShoppingList & { pending: number; total: number; items: ListItemRef[] };

// O cache guardado no aparelho por versões anteriores tem listas sem `items`.
const withItems = (lists: ListSummary[]) => (lists.every((l) => l.items) ? lists : lists.map((l) => ({ ...l, items: l.items ?? [] })));

export function useShoppingLists() {
  return useQuery({
    queryKey: ['lists'],
    select: withItems,
    queryFn: unlessListQueueBusy(async () => {
      const rows = unwrap(
        await supabase
          .from('shopping_lists')
          .select('id, name, kind, archived_at, created_at, shopping_list_items(name, product_id, checked_at)')
          .is('archived_at', null)
          .order('created_at', { ascending: false }),
      ) as (ShoppingList & { shopping_list_items: ListItemRef[] })[];
      return rows.map(({ shopping_list_items, ...list }): ListSummary => ({
        ...list,
        pending: shopping_list_items.filter((i) => !i.checked_at).length,
        total: shopping_list_items.length,
        items: shopping_list_items,
      }));
    }),
  });
}

/** Item ainda numa lista aberta, com o nome da lista (a nota tira da lista o que a compra cumpriu). */
export interface OpenListEntry extends OpenListItem {
  list_id: string;
  list_name: string;
  checked_at: string | null;
}

/** Itens de todas as listas abertas, marcados no carrinho ou não. */
export function useOpenListItems() {
  return useQuery({
    queryKey: ['listItems', 'open'],
    queryFn: async (): Promise<OpenListEntry[]> => {
      const rows = unwrap(
        await supabase
          .from('shopping_list_items')
          .select('id, list_id, name, category, product_id, checked_at, list:shopping_lists!inner(name)')
          .is('list.archived_at', null)
          .order('created_at'),
      ) as unknown as (Omit<OpenListEntry, 'list_name'> & { list: { name: string } })[];
      return rows.map(({ list, ...item }) => ({ ...item, list_name: list.name }));
    },
  });
}

const fetchListLinks = async () =>
  unwrap(await supabase.from('list_item_links').select('name_key, product_id')) as ListLink[];

/** Vínculos nome da lista -> produto que a casa já confirmou. */
export function useListLinks() {
  return useQuery({ queryKey: ['listLinks'], queryFn: fetchListLinks, select: (links) => new LinkIndex(links) });
}

/** Os vínculos já carregados, ou buscados agora; null se não deu (sem internet e nunca vistos neste aparelho). */
export async function loadListLinks(queryClient: QueryClient): Promise<LinkIndex | null> {
  try {
    return new LinkIndex(await queryClient.ensureQueryData({ queryKey: ['listLinks'], queryFn: fetchListLinks }));
  } catch {
    return null;
  }
}

export function useShoppingList(id: string) {
  return useQuery({
    queryKey: ['list', id],
    queryFn: async () =>
      unwrap(
        await supabase.from('shopping_lists').select('id, name, kind, archived_at, created_at').eq('id', id).single(),
      ) as ShoppingList,
  });
}

export function useListItems(listId: string) {
  const queryClient = useQueryClient();

  // Duas pessoas no mercado com a mesma lista: mudanças chegam em tempo real.
  useEffect(() => {
    // Nome único: a lista e "onde comprar" podem estar montadas ao mesmo tempo.
    const channel = supabase
      .channel(`list-${listId}-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shopping_list_items', filter: `list_id=eq.${listId}` },
        () => onListItemsChange(queryClient, listId),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [listId, queryClient]);

  return useQuery({
    queryKey: ['listItems', listId],
    queryFn: unlessListQueueBusy(
      async () =>
        unwrap(
          await supabase
            .from('shopping_list_items')
            .select(
              'id, list_id, product_id, name, category, quantity, unit, notes, priority, photo_path, checked_at, checked_by, toggle_token, created_at',
            )
            .eq('list_id', listId)
            .order('created_at'),
        ) as ShoppingListItem[],
    ),
  });
}

/**
 * Mudança na lista vinda do tempo real. Com marcações ainda na fila, buscar
 * agora desfaria na tela as que faltam enviar: quem busca é a última
 * marcação, e ela cobre também as mudanças puladas aqui.
 */
export function onListItemsChange(queryClient: QueryClient, listId: string) {
  if (listQueueBusy(queryClient)) return;
  queryClient.invalidateQueries({ queryKey: ['listItems', listId] });
  queryClient.invalidateQueries({ queryKey: ['lists'] });
}

function useInvalidateLists(listId?: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['lists'] });
    if (listId) {
      queryClient.invalidateQueries({ queryKey: ['listItems', listId] });
      queryClient.invalidateQueries({ queryKey: ['list', listId] });
    }
  };
}

export function useCreateList() {
  const invalidate = useInvalidateLists();
  return useMutation({
    mutationFn: async (input: { name: string; kind: ShoppingList['kind'] }) =>
      unwrap(await supabase.from('shopping_lists').insert(input).select('id').single()) as { id: string },
    onSuccess: invalidate,
  });
}

export function useArchiveList(listId: string) {
  const invalidate = useInvalidateLists(listId);
  return useMutation({
    mutationFn: async () =>
      unwrap(
        await supabase.from('shopping_lists').update({ archived_at: new Date().toISOString() }).eq('id', listId),
      ),
    onSuccess: invalidate,
  });
}

export interface NewListItem {
  name: string;
  category: string;
  productId: string | null;
  quantity: number;
  unit: Unit;
}

export function useAddListItem(listId: string) {
  const invalidate = useInvalidateLists(listId);
  return useMutation({
    mutationFn: async (item: NewListItem) =>
      unwrap(
        await supabase.from('shopping_list_items').insert({
          list_id: listId,
          name: item.name,
          category: item.category,
          product_id: item.productId,
          quantity: item.quantity,
          unit: item.unit,
        }),
      ),
    onSuccess: invalidate,
  });
}

/** Nomes dos itens ainda não comprados de uma lista, para não duplicar. */
export function usePendingItemNames(listId: string | undefined) {
  return useQuery({
    queryKey: ['listItems', listId, 'pending'],
    enabled: Boolean(listId),
    queryFn: async () =>
      (
        unwrap(
          await supabase.from('shopping_list_items').select('name').eq('list_id', listId!).is('checked_at', null),
        ) as { name: string }[]
      ).map((row) => row.name),
  });
}

/**
 * A lista de mercado aberta mais recente da casa; sem nenhuma, cria uma com
 * `name`. No servidor, numa transação com trava por casa: duas pessoas ao
 * mesmo tempo não criam duas.
 */
async function openMarketList(name = 'Mercado'): Promise<{ id: string; name: string }> {
  return unwrap(await supabase.rpc('open_market_list', { p_name: name }).single()) as { id: string; name: string };
}

/**
 * Vários itens de uma vez; sem `listId`, cria uma lista de mercado nova. Com
 * `reuseMarketList`, usa a lista de mercado aberta mais recente (ou cria uma,
 * openMarketList) e não repete o que já está pendente nela: quem chama pode
 * ainda não ter visto uma lista ou um item postos agora há pouco.
 */
export function useAddItemsToList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      listId,
      newListName,
      reuseMarketList,
      items,
    }: {
      listId?: string;
      newListName: string;
      reuseMarketList?: boolean;
      items: NewListItem[];
    }) => {
      const id =
        listId ??
        (reuseMarketList
          ? (await openMarketList(newListName)).id
          : (
              unwrap(
                await supabase.from('shopping_lists').insert({ name: newListName, kind: 'mercado' }).select('id').single(),
              ) as { id: string }
            ).id);
      // Lista achada no servidor: a tela pode não ter visto o que alguém pôs
      // nela agora há pouco. O que já está pendente não entra de novo.
      let toAdd = items;
      if (reuseMarketList && items.length) {
        const pending = unwrap(
          await supabase.from('shopping_list_items').select('name').eq('list_id', id).is('checked_at', null),
        ) as { name: string }[];
        const names = new Set(pending.map((p) => normalizeSearch(p.name)));
        toAdd = items.filter((item) => !names.has(normalizeSearch(item.name)));
      }
      if (toAdd.length) {
        unwrap(
          await supabase.from('shopping_list_items').insert(
            toAdd.map((item) => ({
              list_id: id,
              name: item.name,
              category: item.category,
              product_id: item.productId,
              quantity: item.quantity,
              unit: item.unit,
            })),
          ),
        );
      }
      return { id };
    },
    onSuccess: ({ id }) => {
      queryClient.invalidateQueries({ queryKey: ['lists'] });
      queryClient.invalidateQueries({ queryKey: ['listItems', id] });
    },
  });
}

/**
 * Põe um item na lista de mercado aberta mais recente (ou cria "Mercado").
 * Usado pela despensa: "acabou -> comprar de novo". Se o item já está
 * pendente na lista, não duplica (`added: false`), então repetir é seguro.
 */
export function useAddToMarketList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (item: NewListItem): Promise<{ id: string; name: string; added: boolean }> => {
      const list = await openMarketList();
      const pending = unwrap(
        await supabase
          .from('shopping_list_items')
          .select('id')
          .eq('list_id', list.id)
          .is('checked_at', null)
          .ilike('name', item.name.replace(/[\\%_]/g, '\\$&'))
          .limit(1),
      ) as { id: string }[];
      if (pending.length) return { ...list, added: false };
      unwrap(
        await supabase.from('shopping_list_items').insert({
          list_id: list.id,
          name: item.name,
          category: item.category,
          product_id: item.productId,
          quantity: item.quantity,
          unit: item.unit,
        }),
      );
      return { ...list, added: true };
    },
    onSuccess: (list) => {
      queryClient.invalidateQueries({ queryKey: ['lists'] });
      queryClient.invalidateQueries({ queryKey: ['listItems', list.id] });
    },
  });
}

/**
 * Marcar ou desmarcar item. Sem internet (no mercado, é comum) a marcação
 * aparece na hora e vai para uma fila guardada no aparelho, enviada na ordem
 * quando a conexão volta, mesmo que o app tenha sido fechado no meio.
 */
export const TOGGLE_ITEM_KEY = ['toggleListItem'];

export interface ToggleItemInput {
  id: string;
  checked: boolean;
  userId: string;
  /** Hora do toque: a marcação enviada depois guarda quando foi feita. */
  at: string;
  /** Selo do item no toque: se alguém marcou depois, o selo mudou e esta não passa por cima. */
  token: string;
  /** Selo novo que esta marcação grava; o próximo toque no item parte dele. */
  nextToken: string;
}

/** Selo novo (formato uuid). Não precisa ser secreto, só não repetir. */
export function newToggleToken(): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  hex[12] = '4';
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/** Token vencido e ainda não renovado: o pedido iria com a chave pública e não gravaria nada. */
export class SessionPendingError extends Error {
  constructor() {
    super('Esperando a sessão ser renovada.');
  }
}

/** Marcação ou limpar feito por outra conta neste aparelho: não sai com a sessão de quem entrou agora. */
export class ForeignToggleError extends Error {
  constructor() {
    super('Ação de outra conta.');
  }
}

async function toggleListItem({ id, checked, userId, at, token, nextToken }: ToggleItemInput) {
  await requireQueueSession(userId);
  return unwrap(
    await supabase
      .from('shopping_list_items')
      .update(
        checked
          ? { checked_at: at, checked_by: userId, toggle_token: nextToken }
          : { checked_at: null, checked_by: null, toggle_token: nextToken },
      )
      .eq('id', id)
      .eq('toggle_token', token),
  );
}

/**
 * Marcar itens e limpar o carrinho andam numa fila só, na ordem dos toques:
 * um limpar nunca cruza com uma marcação (e as duas sobrevivem a fechar o
 * app, com o que ficou esperando a vez).
 */
export const LIST_QUEUE_SCOPE = { id: 'list-items' };
export const CLEAR_CHECKED_KEY = ['clearCheckedItems'];

export function inListQueue(mutation: { options: { scope?: { id: string } } }) {
  return mutation.options.scope?.id === LIST_QUEUE_SCOPE.id;
}

/** Ainda há algo na fila da lista (enviando, esperando a vez ou sem internet)? */
export function listQueueBusy(queryClient: QueryClient) {
  return queryClient.isMutating({ predicate: inListQueue }) > 0;
}

/**
 * Fila guardada no aparelho: pausa sem internet (ou com a sessão à espera de
 * renovação) em vez de falhar, e anda uma de cada vez, na ordem. Com a
 * sessão à espera (o Supabase tenta de novo a cada minuto), insiste por uns
 * 5 minutos em vez de desistir.
 */
export function queuedDefaults(scope: { id: string }) {
  return {
    networkMode: 'online',
    scope,
    retry: (failures: number, error: Error) =>
      !(error instanceof ForeignToggleError) && failures < (error instanceof SessionPendingError ? 20 : 3),
    retryDelay: (failures: number, error: Error) =>
      error instanceof SessionPendingError ? 15_000 : Math.min(1000 * 2 ** failures, 30_000),
  } as const;
}

/** Sessão desta conta, ou o erro que a fila entende (esperar a renovação; ação de outra conta). */
export async function requireQueueSession(userId: string) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new SessionPendingError();
  if (data.session.user.id !== userId) throw new ForeignToggleError();
}

/** O que a fila precisa para rodar uma marcação restaurada depois de o app reabrir. */
export function registerListMutations(queryClient: QueryClient) {
  const queued = queuedDefaults(LIST_QUEUE_SCOPE);
  queryClient.setMutationDefaults(TOGGLE_ITEM_KEY, {
    ...queued,
    mutationFn: (input: ToggleItemInput) => toggleListItem(input),
  });
  queryClient.setMutationDefaults(EDIT_ITEM_KEY, {
    ...queued,
    mutationFn: (input: EditItemInput) => editListItem(input),
  });
  queryClient.setMutationDefaults(CLEAR_CHECKED_KEY, {
    ...queued,
    mutationFn: (input: ClearCheckedInput) => clearCheckedItems(input),
    // Aqui e não no hook: vale também para o limpar que ficou na fila e sai
    // depois de reabrir o app.
    onSuccess: (moved: unknown, input: ClearCheckedInput) => {
      // Só quando saiu tudo o que estava no carrinho: se alguém mexeu num item
      // antes (o selo não bateu), o que saiu de fato vem com a busca do histórico.
      if (moved === input.items.length) recordClearedPurchases(queryClient, input);
      queryClient.invalidateQueries({ queryKey: ['lists'] });
      queryClient.invalidateQueries({ queryKey: ['listItems', input.listId] });
      queryClient.invalidateQueries({ queryKey: ['list', input.listId] });
      queryClient.invalidateQueries({ queryKey: ['purchaseRecords'] });
      if (input.pantry?.length) queryClient.invalidateQueries({ queryKey: ['pantry'] });
    },
  });
  // A fila acabou (o último da fila já terminou, não só está terminando):
  // agora sim busca listas e itens de todas as listas, o que cobre também
  // as buscas e mudanças do tempo real que esperaram a fila.
  queryClient.getMutationCache().subscribe((event) => {
    if (event.type !== 'updated' || !inListQueue(event.mutation)) return;
    if (event.mutation.state.status === 'pending' || listQueueBusy(queryClient)) return;
    queryClient.invalidateQueries({ queryKey: ['lists'] });
    queryClient.invalidateQueries({ queryKey: ['listItems'] });
    // Só marca como velho: durante as compras a faixa fica escondida, e buscar
    // o histórico (com as notas) a cada marcação seria desperdício.
    queryClient.invalidateQueries({ queryKey: ['purchaseRecords'], refetchType: 'none' });
  });
}

export function useToggleListItem(listId: string) {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, ToggleItemInput>({
    mutationKey: TOGGLE_ITEM_KEY,
    // Marca na hora; o servidor confirma depois.
    onMutate: async ({ id, checked, at, nextToken }) => {
      const key = ['listItems', listId];
      await queryClient.cancelQueries({ queryKey: key });
      // O selo novo vai junto: o próximo toque neste item parte dele.
      queryClient.setQueryData<ShoppingListItem[]>(key, (items) =>
        items?.map((i) => (i.id === id ? { ...i, checked_at: checked ? at : null, toggle_token: nextToken } : i)),
      );
      // O resumo das listas (itens pendentes) também, para ficar certo sem internet.
      await queryClient.cancelQueries({ queryKey: ['lists'] });
      queryClient.setQueryData<{ id: string; pending: number; total: number }[]>(['lists'], (lists) =>
        lists?.map((l) =>
          l.id === listId ? { ...l, pending: Math.min(l.total, Math.max(0, l.pending + (checked ? -1 : 1))) } : l,
        ),
      );
    },
  });
}

/**
 * Detalhes do item (nome, quantidade, descrição, prioridade): na mesma fila
 * das marcações, então valem sem internet e aparecem na hora.
 */
export const EDIT_ITEM_KEY = ['editListItem'];

export interface EditItemInput {
  id: string;
  listId: string;
  userId: string;
  /** Só os campos que mudaram; photo_path só para tirar a foto (null). */
  values: Partial<Pick<ShoppingListItem, 'name' | 'category' | 'quantity' | 'unit' | 'notes' | 'priority'>> & { photo_path?: null };
}

async function editListItem({ id, userId, values }: EditItemInput) {
  await requireQueueSession(userId);
  return unwrap(await supabase.from('shopping_list_items').update(values).eq('id', id));
}

export function useEditListItem(listId: string) {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, EditItemInput>({
    mutationKey: EDIT_ITEM_KEY,
    onMutate: async ({ id, values }) => {
      const key = ['listItems', listId];
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData<ShoppingListItem[]>(key, (items) => items?.map((i) => (i.id === id ? { ...i, ...values } : i)));
    },
  });
}

/** O que aconteceu ao tirar um item pelo catálogo. */
export type RemovePendingResult = 'removed' | 'in_cart' | 'has_details' | 'gone';

/**
 * Tira da lista um item que ainda está para comprar. Sem a confirmação da
 * pessoa (`plainOnly`), só apaga se ele continua sem descrição, foto e
 * prioridade. O que mudou enquanto isso (outra pessoa pôs no carrinho ou
 * detalhou o item) não é apagado: o resultado diz o quê.
 */
export function useRemovePendingListItem(listId: string) {
  const invalidate = useInvalidateLists(listId);
  return useMutation({
    mutationFn: async ({ id, plainOnly }: { id: string; plainOnly: boolean }): Promise<RemovePendingResult> => {
      let request = supabase.from('shopping_list_items').delete().eq('id', id).is('checked_at', null);
      if (plainOnly) request = request.is('notes', null).is('photo_path', null).eq('priority', 'normal');
      const gone = unwrap(await request.select('id')) as { id: string }[] | null;
      if (gone?.length) return 'removed';
      const row = unwrap(
        await supabase.from('shopping_list_items').select('checked_at').eq('id', id).maybeSingle(),
      ) as { checked_at: string | null } | null;
      if (!row) return 'gone';
      return row.checked_at ? 'in_cart' : 'has_details';
    },
    onSuccess: invalidate,
  });
}

export function useDeleteListItem(listId: string) {
  const invalidate = useInvalidateLists(listId);
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('shopping_list_items').delete().eq('id', id)),
    onSuccess: invalidate,
  });
}

export interface ClearCheckedInput {
  listId: string;
  /** Quem limpou: a fila não sai com a sessão de outra conta. */
  userId: string;
  /**
   * O que estava no carrinho no toque, com o selo de cada item. Só isso sai:
   * o que alguém marcar depois, antes de a fila andar, fica na lista.
   */
  items: { id: string; token: string }[];
  /** O que vai também para a despensa, com a quantidade confirmada (só sai o que saiu do carrinho). */
  pantry?: CartPantryEntry[];
}

/** Limpa o carrinho: os itens marcados saem da lista e vão para o histórico de compras. */
async function clearCheckedItems({ listId, userId, items, pantry }: ClearCheckedInput) {
  // Sem sessão válida, o pedido iria com a chave pública e não apagaria nada.
  await requireQueueSession(userId);
  if (!items.length) return 0;
  // O selo é único por marcação: id e selo batendo, o item está como no toque.
  return unwrap(
    await supabase.rpc('clear_checked_items', {
      p_list_id: listId,
      p_ids: items.map((i) => i.id),
      p_tokens: items.map((i) => i.token),
      p_pantry: pantry ?? [],
    }),
  ) as number;
}

/** Limpa o carrinho na vez dele na fila da lista (depois das marcações que vieram antes). */
/**
 * O que saiu do carrinho entra já no histórico guardado: a lista recarregada
 * não o mostra mais e, se o histórico ainda não tiver a compra (a busca dele
 * anda em separado e pode falhar), "Acho que acabou" o sugeriria de novo.
 */
function recordClearedPurchases(queryClient: QueryClient, { listId, items }: ClearCheckedInput) {
  const ids = new Set(items.map((i) => i.id));
  const cleared = (queryClient.getQueryData<ShoppingListItem[]>(['listItems', listId]) ?? []).filter(
    (i) => ids.has(i.id) && i.checked_at,
  );
  if (!cleared.length) return;
  queryClient.setQueryData<PurchaseRecord[]>(['purchaseRecords'], (records) => {
    if (!records) return records;
    const known = new Set(records.filter((r) => r.source === 'list').map((r) => `${r.name}|${r.at}`));
    const added = cleared
      .filter((i) => !known.has(`${i.name}|${i.checked_at}`))
      .map(
        (i): PurchaseRecord => ({
          name: i.name,
          category: i.category,
          productId: i.product_id,
          quantity: Number(i.quantity),
          unit: i.unit,
          at: i.checked_at!,
          source: 'list',
        }),
      );
    return added.length ? [...added, ...records] : records;
  });
}

export function useClearCheckedItems() {
  // Atualizar histórico e listas fica nos padrões da fila (registerListMutations).
  return useMutation<unknown, Error, ClearCheckedInput>({ mutationKey: CLEAR_CHECKED_KEY });
}

/**
 * O que a casa comprou nos últimos meses: carrinhos limpos (histórico),
 * itens ainda marcados nas listas e itens de notas confirmadas ligados a um
 * produto. recentPurchases e restockSuggestions (domínio) juntam e ordenam.
 */
export function usePurchaseRecords() {
  return useQuery({
    queryKey: ['purchaseRecords'],
    queryFn: async (): Promise<PurchaseRecord[]> => {
      const since = new Date(Date.now() - RESTOCK_HISTORY_DAYS * 86_400_000).toISOString();
      const [history, checked, receipts] = await Promise.all([
        supabase
          .from('purchase_history')
          .select('product_id, name, category, quantity, unit, bought_at')
          .gte('bought_at', since)
          .order('bought_at', { ascending: false })
          .limit(1000),
        supabase
          .from('shopping_list_items')
          .select('product_id, name, category, quantity, unit, checked_at')
          .gte('checked_at', since)
          .limit(1000),
        supabase
          .from('receipts')
          .select('purchased_at, receipt_items(product_id, quantity, unit, product:products(name, category))')
          .eq('status', 'confirmed')
          .gte('purchased_at', since)
          .order('purchased_at', { ascending: false })
          .limit(200),
      ]);
      type ListRow = { product_id: string | null; name: string; category: string; quantity: number; unit: Unit };
      type ReceiptRow = {
        purchased_at: string;
        receipt_items: { product_id: string | null; quantity: number; unit: Unit; product: { name: string; category: string } | null }[];
      };
      const fromList = (row: ListRow, at: string): PurchaseRecord => ({
        name: row.name,
        category: row.category,
        productId: row.product_id,
        quantity: Number(row.quantity),
        unit: row.unit,
        at,
        source: 'list',
      });
      return [
        ...(unwrap(history) as (ListRow & { bought_at: string })[]).map((row) => fromList(row, row.bought_at)),
        ...(unwrap(checked) as (ListRow & { checked_at: string })[]).map((row) => fromList(row, row.checked_at)),
        ...(unwrap(receipts) as unknown as ReceiptRow[]).flatMap((receipt) =>
          receipt.receipt_items.flatMap((item): PurchaseRecord[] =>
            item.product
              ? [
                  {
                    name: item.product.name,
                    category: item.product.category,
                    productId: item.product_id,
                    quantity: Number(item.quantity),
                    unit: item.unit,
                    at: receipt.purchased_at,
                    source: 'receipt',
                  },
                ]
              : [],
          ),
        ),
      ];
    },
  });
}

// ---------------------------------------------------------------------------
// Produtos, lojas, preços

export function useProducts() {
  return useQuery({
    queryKey: ['products'],
    queryFn: async () =>
      unwrap(await supabase.from('products').select('id, name, category, shelf_life_days').order('name')) as Product[],
  });
}

export function useStores() {
  return useQuery({
    queryKey: ['stores'],
    queryFn: async () =>
      unwrap(await supabase.from('stores').select('id, name, cnpj, address').order('name')) as Store[],
  });
}

export function useLatestPrices() {
  return useQuery({
    queryKey: ['latestPrices'],
    queryFn: async () =>
      unwrap(
        await supabase.from('latest_prices').select('product_id, store_id, unit, unit_price, purchased_at'),
      ) as LatestPrice[],
  });
}

export function usePriceHistory(productId: string) {
  return useQuery({
    queryKey: ['priceHistory', productId],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('price_observations')
          .select('product_id, store_id, unit, unit_price, purchased_at, receipt_id')
          .eq('product_id', productId)
          .order('purchased_at', { ascending: false })
          .limit(100),
      ) as PriceObservation[],
  });
}

/**
 * Preços de vários produtos nos meses antes de uma compra (alerta de preço na
 * nota). A janela sai da data da nota, não de hoje: uma nota antiga aberta
 * depois mostra os mesmos avisos. Dois dias de folga para o fuso.
 */
export function usePriceObservations(productIds: string[], purchasedAt: string | undefined) {
  return useQuery({
    queryKey: ['priceHistory', 'many', productIds, purchasedAt],
    enabled: productIds.length > 0 && !!purchasedAt,
    queryFn: async () => {
      const at = new Date(purchasedAt!).getTime();
      return unwrap(
        await supabase
          .from('price_observations')
          .select('product_id, store_id, unit, unit_price, purchased_at, receipt_id')
          .in('product_id', productIds)
          .gte('purchased_at', new Date(at - (PRICE_ALERT_HISTORY_DAYS + 2) * 86_400_000).toISOString())
          .lte('purchased_at', new Date(at + 2 * 86_400_000).toISOString())
          .order('purchased_at', { ascending: false })
          .limit(1000),
      ) as PriceObservation[];
    },
  });
}

export function useRenameProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name, category }: { id: string; name: string; category: string }) =>
      unwrap(await supabase.from('products').update({ name, category }).eq('id', id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['products'] }),
  });
}

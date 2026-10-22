// Mercado: listas de compras, produtos, lojas e preços.

import {
  type Mutation,
  onlineManager,
  type QueryClient,
  type QueryFunctionContext,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect } from 'react';

import { productNamed as productWithName } from '@/domain/barcode';
import type { CartPantryEntry } from '@/domain/cartPantry';
import { pendingSameItem } from '@/domain/genericItem';
import { LinkIndex, type ListLink, type OpenListItem } from '@/domain/listLinks';
import {
  cartPurchases,
  itemsWithNew,
  type ListItemRef,
  type ListSummaryCounts,
  planRemoval,
  type QueuedAction,
  type QueuedKind,
  queuedListItem,
  summaryWithItem,
  summaryWithout,
  wasAttempted,
} from '@/domain/listQueue';
import { PRICE_ALERT_HISTORY_DAYS, type PricePoint } from '@/domain/priceAlert';
import { toPurchases, type PurchaseLine } from '@/domain/priceHistory';
import { listsFor, newListKind, PANTRY_LIST_GONE, type ListChoice } from '@/domain/pantryList';
import { PRODUCT_MERGED_AWAY, PRODUCT_NAME_TAKEN } from '@/domain/productMerge';
import type { PurchaseRecord } from '@/domain/recentPurchases';
import { RESTOCK_HISTORY_DAYS } from '@/domain/restock';
import type { ProductName } from '@/domain/similarNames';
import { storePricesFromPurchases } from '@/domain/storePrices';
import { EXPECTS_ROWS_META } from '@/lib/accessErrors';
import { isTransientFailure, withStatus } from '@/lib/networkErrors';
import { supabase, unwrap } from '@/lib/supabase';
import type {
  LatestPrice,
  Product,
  ShoppingList,
  ShoppingListItem,
  Store,
  Unit,
} from '@/lib/types';

import { isMissingColumn, isMissingFunction } from './missingSchema';
import { isProductMergedAway, LISTED_PRODUCT_SOURCES, withFreshProducts } from './productMerge';

// ---------------------------------------------------------------------------
// Listas

/**
 * Busca de listas e itens que respeita a fila: com marcações ainda por
 * enviar, a resposta do servidor desfaria na tela as que faltam. Então
 * qualquer busca (automática, puxar para atualizar, tentar de novo) devolve o
 * que já está no cache, e a busca de verdade vem quando a fila acaba
 * (registerListMutations).
 */
export function unlessListQueueBusy<T>(fetch: (context: QueryFunctionContext) => Promise<T>) {
  return async (context: QueryFunctionContext) => {
    const cached = context.client.getQueryData<T>(context.queryKey);
    if (cached !== undefined && listQueueBusy(context.client)) return cached;
    return fetch(context);
  };
}

type ListSummary = ShoppingList & ListSummaryCounts;

// O cache guardado no aparelho por versões anteriores tem listas sem `items`.
const withItems = (lists: ListSummary[]) => (lists.every((l) => l.items) ? lists : lists.map((l) => ({ ...l, items: l.items ?? [] })));

/** As colunas do item que a tela da lista usa, sem a "Marca preferida" (o banco de antes dela). */
const LEGACY_LIST_ITEM_COLUMNS =
  'id, list_id, product_id, name, category, quantity, unit, notes, priority, photo_path, checked_at, checked_by, toggle_token, created_at';
const LIST_ITEM_COLUMNS = `${LEGACY_LIST_ITEM_COLUMNS}, brand_preferred`;

/** A coluna da "Marca preferida" ainda não está no banco (o app chegou antes da migração). */
const isMissingBrandColumn = (error: unknown) => isMissingColumn(error, 'brand_preferred');

/**
 * Lê os itens com a "Marca preferida"; num banco de antes dela, repete com as colunas de antes, e os itens vêm
 * sem o campo (nenhum tem marca preferida, e os detalhes do item não oferecem a escolha).
 */
async function readListItems(run: (columns: string) => PromiseLike<{ data: unknown; error: unknown }>): Promise<ShoppingListItem[]> {
  const answer = await run(LIST_ITEM_COLUMNS);
  return unwrap(isMissingBrandColumn(answer.error) ? await run(LEGACY_LIST_ITEM_COLUMNS) : answer) as ShoppingListItem[];
}

/**
 * Quantas listas abertas (as mais novas) já ficam com os itens guardados no
 * aparelho, sem precisar ter sido abertas nele: o bastante para o mercado sem
 * sinal, sem encher o armazenamento (no navegador, poucos MB para o cache todo).
 */
const PRELOADED_LISTS = 8;

const byCreation = (a: ShoppingListItem, b: ShoppingListItem) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0);

/**
 * Os itens das listas abertas mais novas, num pedido à parte do resumo, ficam
 * guardados como se cada lista tivesse sido aberta: a lista que outra pessoa
 * criou abre no mercado sem internet. Só com a fila parada (com ela, a
 * resposta desfaria o que ainda falta enviar, e nem vale buscar), e só onde o
 * que está guardado é mais velho que este pedido. Sem pressa e sem aviso: se
 * falhar, o resumo continua valendo e a lista é buscada quando for aberta.
 */
async function preloadListItems(client: QueryClient, listIds: string[]) {
  if (!listIds.length || listQueueBusy(client)) return;
  const startedAt = Date.now();
  let rows: ShoppingListItem[];
  try {
    rows = await readListItems((columns) =>
      supabase.from('shopping_list_items').select(columns).in('list_id', listIds).order('created_at'),
    );
  } catch {
    return;
  }
  if (listQueueBusy(client)) return;
  for (const id of listIds) {
    const key = ['listItems', id];
    const state = client.getQueryState(key);
    if (state && (state.dataUpdatedAt >= startedAt || state.fetchStatus === 'fetching')) continue;
    client.setQueryData(key, rows.filter((i) => i.list_id === id).sort(byCreation), { updatedAt: startedAt });
  }
}

/**
 * As listas abertas, com o nome, o produto e a marcação de cada item (o que as telas de fora da lista usam);
 * os itens inteiros só das mais novas, à parte (ver preloadListItems).
 */
async function fetchListSummaries({ client }: QueryFunctionContext): Promise<ListSummary[]> {
  const rows = unwrap(
    await supabase
      .from('shopping_lists')
      .select('id, name, kind, archived_at, created_at, shopping_list_items(name, product_id, checked_at)')
      .is('archived_at', null)
      .order('created_at', { ascending: false }),
  ) as (ShoppingList & { shopping_list_items: ListItemRef[] })[];
  void preloadListItems(
    client,
    rows.slice(0, PRELOADED_LISTS).map((row) => row.id),
  );
  return rows.map(({ shopping_list_items, ...list }): ListSummary => ({
    ...list,
    pending: shopping_list_items.filter((i) => !i.checked_at).length,
    total: shopping_list_items.length,
    items: shopping_list_items.map(({ name, product_id, checked_at }) => ({ name, product_id, checked_at })),
  }));
}

const listSummaries = unlessListQueueBusy(fetchListSummaries);

export function useShoppingLists() {
  return useQuery({ queryKey: ['lists'], select: withItems, queryFn: listSummaries });
}

/** Item ainda numa lista aberta, com o nome da lista (a nota tira da lista o que a compra cumpriu). */
export interface OpenListEntry extends OpenListItem {
  list_id: string;
  list_name: string;
  checked_at: string | null;
}

type OpenListRow = Omit<OpenListEntry, 'list_name' | 'brand'> & { brand_preferred?: boolean; list: { name: string } };

/**
 * Itens de todas as listas abertas, marcados no carrinho ou não. `brand` é a "Marca preferida" que a pessoa ligou;
 * num banco de antes da coluna, nenhum item a tem (o item com o nome de um produto casa com qualquer marca).
 */
export function useOpenListItems() {
  return useQuery({
    queryKey: ['listItems', 'open'],
    queryFn: async (): Promise<OpenListEntry[]> => {
      const read = (brand: string) =>
        supabase
          .from('shopping_list_items')
          .select(`id, list_id, name, category, product_id, checked_at${brand}, list:shopping_lists!inner(name)`)
          .is('list.archived_at', null)
          .order('created_at');
      const answer = await read(', brand_preferred');
      const rows = unwrap(isMissingBrandColumn(answer.error) ? await read('') : answer) as unknown as OpenListRow[];
      return rows.map(({ list, brand_preferred, ...item }) => ({ ...item, brand: brand_preferred === true, list_name: list.name }));
    },
  });
}

const fetchListLinks = async () =>
  unwrap(await supabase.from('list_item_links').select('name_key, product_id')) as ListLink[];

// Fora do hook: com a mesma função a cada render, o TanStack Query devolve o
// mesmo LinkIndex enquanto os vínculos não mudam (e um useMemo que depende
// dele não refaz a conta a cada letra digitada).
const toLinkIndex = (links: ListLink[]) => new LinkIndex(links);

/** Vínculos nome da lista -> produto que a casa já confirmou. */
export function useListLinks() {
  return useQuery({ queryKey: ['listLinks'], queryFn: fetchListLinks, select: toLinkIndex });
}

/** Os vínculos já carregados, ou buscados agora; null se não deu (sem internet e nunca vistos neste aparelho). */
export async function loadListLinks(queryClient: QueryClient): Promise<LinkIndex | null> {
  // Sem internet a busca ficaria parada esperando a conexão (sem dar certo nem errado), e quem espera a
  // resposta (o "Limpar", a geladeira) não faria nada: fica com o que estiver guardado.
  if (!onlineManager.isOnline()) {
    const cached = queryClient.getQueryData<ListLink[]>(['listLinks']);
    return cached ? new LinkIndex(cached) : null;
  }
  try {
    return new LinkIndex(await queryClient.ensureQueryData({ queryKey: ['listLinks'], queryFn: fetchListLinks }));
  } catch {
    return null;
  }
}

/** A lista como o resumo das listas a guardou (a que nunca foi aberta neste aparelho também está lá). */
function listFromSummary(queryClient: QueryClient, id: string): ShoppingList | undefined {
  const found = queryClient.getQueryData<ListSummary[]>(['lists'])?.find((l) => l.id === id);
  if (!found) return undefined;
  const { id: listId, name, kind, archived_at, created_at } = found;
  return { id: listId, name, kind, archived_at, created_at };
}

export function useShoppingList(id: string) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ['list', id],
    queryFn: async () =>
      unwrap(
        await supabase.from('shopping_lists').select('id, name, kind, archived_at, created_at').eq('id', id).single(),
      ) as ShoppingList,
    // Sem internet, a lista que nunca foi aberta aqui sai do resumo; com internet, a busca de sempre a confere.
    initialData: () => listFromSummary(queryClient, id),
    initialDataUpdatedAt: () => queryClient.getQueryState(['lists'])?.dataUpdatedAt,
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
      () =>
        readListItems((columns) =>
          supabase.from('shopping_list_items').select(columns).eq('list_id', listId).order('created_at'),
        ),
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

/**
 * Pôr item na lista, pela fila da lista: sem internet o item aparece na hora
 * e vai quando a conexão volta, na ordem dos toques. O id e o selo saem do
 * aparelho: a marcação, a edição e a foto que vierem antes de o servidor
 * responder já acham o item, e repetir o envio não o duplica. Nem o traz de
 * volta: se alguém tirou o item enquanto a resposta se perdia, o banco lembra
 * o id apagado e deixa o envio repetido de fora, sem erro.
 */
export const ADD_ITEM_KEY = ['addListItem'];

export interface AddItemInput extends NewListItem {
  /** O id do item, gerado no aparelho. */
  id: string;
  listId: string;
  /** Quem pôs: a fila não sai com a sessão de outra conta. */
  userId: string;
  /** O selo do item (toggle_token): a primeira marcação parte dele. */
  token: string;
}

/** Conflito na chave (23505): o único campo único do item é o id, então ele já foi numa tentativa anterior. */
const isSameIdAlreadySaved = (error: unknown) => (error as { code?: unknown } | null)?.code === '23505';

async function addListItem(queryClient: QueryClient, { id, listId, userId, token, ...item }: AddItemInput) {
  await requireQueueSession(userId);
  const row = {
    id,
    list_id: listId,
    name: item.name,
    category: item.category,
    product_id: item.productId,
    quantity: item.quantity,
    unit: item.unit,
    toggle_token: token,
  };
  const insert = async (values: typeof row) => {
    const { error, status } = await supabase.from('shopping_list_items').insert(values);
    // A resposta da tentativa anterior é que não chegou: o item já está lá.
    if (error && !isSameIdAlreadySaved(error)) throw withStatus(error, status);
  };
  try {
    await insert(row);
  } catch (error) {
    if (!isProductMergedAway(error)) throw error;
    // O produto foi juntado com outro em outro aparelho enquanto o item esperava a vez: ninguém está olhando
    // para responder, então o item entra pelo nome, sem o produto (as ligações da lista acham o preço).
    for (const key of LISTED_PRODUCT_SOURCES) void queryClient.invalidateQueries({ queryKey: [key] });
    await insert({ ...row, product_id: null });
  }
}

/** O item posto aparece já na lista e no resumo das listas. */
async function showAdded(queryClient: QueryClient, input: AddItemInput) {
  const createdAt = new Date().toISOString();
  const item = queuedListItem(input, createdAt);
  await queryClient.cancelQueries({ queryKey: ['listItems', input.listId] });
  queryClient.setQueryData<ShoppingListItem[]>(['listItems', input.listId], (items) =>
    items ? itemsWithNew(items, queuedListItem(input, createdAt, items.some((i) => typeof i.brand_preferred === 'boolean'))) : items,
  );
  await queryClient.cancelQueries({ queryKey: ['lists'] });
  queryClient.setQueryData<ListSummary[]>(['lists'], (lists) =>
    lists ? summaryWithItem(lists, input.listId, { name: item.name, product_id: item.product_id, checked_at: null }) : lists,
  );
}

export function useAddListItem(listId: string) {
  const queryClient = useQueryClient();
  const mutation = useMutation<unknown, Error, AddItemInput>({
    mutationKey: ADD_ITEM_KEY,
    onMutate: (input) => showAdded(queryClient, input),
  });
  return {
    /**
     * Põe o item; `onError` só vem quando a fila desiste (a lista apagada, por exemplo). O aviso à pessoa sai
     * da fila (registerListMutations), também para o pôr guardado que sai depois de reabrir o app.
     */
    add: (item: NewListItem, userId: string, options?: QueuedCallbacks) =>
      settle(mutation.mutateAsync({ ...item, id: newToggleToken(), listId, userId, token: newToggleToken() }), options),
  };
}

interface QueuedCallbacks {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Os avisos de cada toque, pela promessa dele: com dois toques seguidos, os callbacks de `mutate` só valeriam
 * para o último. Sem internet a promessa fica esperando a conexão, sem prender a tela.
 */
function settle(request: Promise<unknown>, options?: QueuedCallbacks) {
  request.then(
    () => options?.onSuccess?.(),
    (error: Error) => options?.onError?.(error),
  );
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
      // O mesmo item com outro nome também conta ("Leite IL Desnatado" para "Leite desnatado", domain/genericItem).
      let toAdd = items;
      if (reuseMarketList && items.length) {
        const pending = unwrap(
          await supabase.from('shopping_list_items').select('name, category').eq('list_id', id).is('checked_at', null),
        ) as { name: string; category?: string | null }[];
        toAdd = items.filter((item) => !pendingSameItem(item, pending));
      }
      if (toAdd.length) {
        // O produto de um item pode ter sido juntado com outro em outro aparelho (withFreshProducts).
        await withFreshProducts(queryClient, LISTED_PRODUCT_SOURCES, async () =>
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
 * A lista de farmácia aberta mais recente da casa; sem nenhuma, cria uma com
 * `name`. No servidor, como a de mercado: numa transação com trava por casa,
 * duas pessoas pondo remédio ao mesmo tempo não criam duas.
 */
async function openPharmacyList(name = 'Farmácia'): Promise<{ id: string; name: string }> {
  const opened = await supabase.rpc('open_pharmacy_list', { p_name: name }).single();
  if (!opened.error || !isMissingFunction(opened.error, 'open_pharmacy_list')) return unwrap(opened) as { id: string; name: string };
  // Banco sem a função: procura e cria daqui, sem a trava.
  const open = unwrap(
    await supabase
      .from('shopping_lists')
      .select('id, name')
      .eq('kind', 'farmacia')
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .limit(1),
  ) as { id: string; name: string }[];
  if (open.length) return open[0];
  return unwrap(await supabase.from('shopping_lists').insert({ name, kind: 'farmacia' }).select('id, name').single()) as {
    id: string;
    name: string;
  };
}

type ListedItem = { id: string; name: string; added: boolean };

/**
 * Põe o item na lista, a não ser que já esteja pendente nela (`added: false`): repetir é seguro. Pendente com este
 * nome ou com outro do mesmo item ("Leite desnatado" do Nuke com "Leite IL Desnatado" na lista: domain/genericItem).
 */
async function addItemOnce(queryClient: QueryClient, list: { id: string; name: string }, item: NewListItem): Promise<ListedItem> {
  const pending = unwrap(
    await supabase.from('shopping_list_items').select('name, category').eq('list_id', list.id).is('checked_at', null),
  ) as { name: string; category?: string | null }[];
  if (pendingSameItem(item, pending)) return { ...list, added: false };
  // O produto do item (o da despensa, na lista de mercado) pode ter sido juntado com outro em outro aparelho (withFreshProducts).
  await withFreshProducts(queryClient, LISTED_PRODUCT_SOURCES, async () =>
    unwrap(
      await supabase.from('shopping_list_items').insert({
        list_id: list.id,
        name: item.name,
        category: item.category,
        product_id: item.productId,
        quantity: item.quantity,
        unit: item.unit,
      }),
    ),
  );
  return { ...list, added: true };
}

function useAddToOpenList<T extends NewListItem>(add: (queryClient: QueryClient, item: T) => Promise<ListedItem>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (item: T) => add(queryClient, item),
    onSuccess: (list) => {
      queryClient.invalidateQueries({ queryKey: ['lists'] });
      queryClient.invalidateQueries({ queryKey: ['listItems', list.id] });
    },
    // Na falha (a lista foi arquivada no meio, por exemplo), o próximo menu já parte das listas de agora.
    onError: () => queryClient.invalidateQueries({ queryKey: ['lists'] }),
  });
}

/**
 * Põe um item na lista de mercado aberta mais recente (ou cria "Mercado").
 * Usado pela despensa: "acabou -> comprar de novo". Se o item já está
 * pendente na lista, não duplica (`added: false`), então repetir é seguro.
 */
export function useAddToMarketList() {
  return useAddToOpenList(async (queryClient, item: NewListItem) => addItemOnce(queryClient, await openMarketList(), item));
}

/**
 * O item que acabou na despensa. `listId`: a lista que a pessoa escolheu (sem ela, a mais nova). `shownListId`: a
 * "última lista" que o menu mostrou; vale enquanto estiver aberta, para o item ir para a lista que o menu disse,
 * mesmo que outra tenha sido criada depois em outro aparelho.
 */
export interface PantryListItem extends NewListItem {
  listId?: string;
  shownListId?: string;
}

/**
 * Despensa, "acabou": põe o item na lista escolhida ou, sem escolha, na lista
 * aberta mais nova em que ele cabe (listsFor), lida agora no servidor: a que
 * outra pessoa criou há pouco também conta. Sem nenhuma, a de mercado (ou a
 * de farmácia, para remédio) de sempre, achada ou criada sob a trava da casa.
 *
 * O item entra por add_to_list, que só grava se a lista ainda está aberta,
 * com a linha dela travada: arquivar no meio espera o item entrar. A escolhida
 * que já não está aberta não recebe nada (PANTRY_LIST_GONE); a que o app
 * escolheu e foi arquivada no meio dá lugar à próxima mais nova. Sem a função
 * (banco de antes da migração, ou o cache do PostgREST de antes dela), o
 * caminho de antes: addItemOnce, sem a trava.
 */
async function addToPantryList(queryClient: QueryClient, { listId, shownListId, ...item }: PantryListItem): Promise<ListedItem> {
  const tried = new Set<string>();
  for (;;) {
    const open = unwrap(
      await supabase.from('shopping_lists').select('id, name, kind, created_at').is('archived_at', null).order('created_at', { ascending: false }),
    ) as ListChoice[];
    let list: { id: string; name: string } | undefined;
    if (listId) {
      list = open.find((l) => l.id === listId);
      if (!list) throw new Error(PANTRY_LIST_GONE);
    } else {
      const fitting = listsFor(item.category, open).filter((l) => !tried.has(l.id));
      list = fitting.find((l) => l.id === shownListId) ?? fitting[0];
    }
    list ??= newListKind(item.category) === 'farmacia' ? await openPharmacyList() : await openMarketList();
    const target = { id: list.id, name: list.name };
    // add_to_list só não repete o mesmo nome. O mesmo item com outro nome, já pendente ("Leite IL Desnatado" para
    // "Leite desnatado", e o contrário: domain/genericItem), também não entra de novo.
    const pending = unwrap(
      await supabase.from('shopping_list_items').select('name, category').eq('list_id', target.id).is('checked_at', null),
    ) as { name: string; category?: string | null }[];
    if (pendingSameItem(item, pending)) return { ...target, added: false };
    const added = await supabase
      .rpc('add_to_list', {
        p_list_id: target.id,
        p_name: item.name,
        p_category: item.category,
        p_product_id: item.productId,
        p_quantity: item.quantity,
        p_unit: item.unit,
      })
      .single();
    if (added.error && isMissingFunction(added.error, 'add_to_list')) return addItemOnce(queryClient, target, item);
    if (added.error && isListNotOpen(added.error)) {
      // Arquivada entre a leitura e a trava. A escolhida não muda sozinha; a do app, sim (uma vez por lista).
      if (listId || tried.has(target.id)) throw new Error(PANTRY_LIST_GONE);
      tried.add(target.id);
      if (tried.size >= PANTRY_LIST_ATTEMPTS) throw new Error(PANTRY_LIST_GONE);
      continue;
    }
    // O produto foi juntado com outro em outro aparelho (como em withFreshProducts).
    if (added.error && isProductMergedAway(added.error)) {
      await Promise.all(LISTED_PRODUCT_SOURCES.map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
      throw new Error(PRODUCT_MERGED_AWAY);
    }
    const row = unwrap(added) as { list_id: string; list_name: string; added: boolean };
    return { id: row.list_id, name: row.list_name, added: row.added };
  }
}

/** Quantas listas o app tenta quando a que ele escolheu é arquivada no meio. */
const PANTRY_LIST_ATTEMPTS = 3;

/** add_to_list: a lista não está mais aberta (P0002). */
const isListNotOpen = (error: unknown) => (error as { code?: unknown } | null)?.code === 'P0002';

/** O item que acabou na despensa vai para a última lista criada, ou para a que a pessoa escolheu. */
export function useAddToPantryList() {
  return useAddToOpenList(addToPantryList);
}

/** O remédio que vai para a lista da farmácia; `altName`: o mesmo item com o nome de quem toma (ver onPharmacyList). */
export interface PharmacyItem extends NewListItem {
  altName?: string | null;
}

/**
 * Põe o remédio na lista da farmácia sem repetir. No servidor, numa vez só
 * (add_to_pharmacy_list): acha ou cria a lista e só põe o item se ele não
 * está pendente em nenhuma lista de farmácia aberta, com o nome ou com o nome
 * de quem toma, sob a trava da casa. Duas pessoas tocando ao mesmo tempo não o
 * põem duas vezes; `added: false` diz em que lista ele já estava. Sem a função
 * (banco de antes da migração, ou o cache do PostgREST de antes dela), o
 * caminho de antes: open_pharmacy_list e addItemOnce, que só confere a lista
 * aberta e o nome (sem o de quem toma).
 */
async function addToPharmacyList(queryClient: QueryClient, item: PharmacyItem): Promise<ListedItem> {
  const added = await supabase.rpc('add_to_pharmacy_list', { p_item: item.name, p_alt_item: item.altName ?? null }).single();
  if (!added.error || !isMissingFunction(added.error, 'add_to_pharmacy_list')) {
    const row = unwrap(added) as { list_id: string; list_name: string; added: boolean };
    return { id: row.list_id, name: row.list_name, added: row.added };
  }
  return addItemOnce(queryClient, await openPharmacyList(), item);
}

/** O mesmo, na lista de farmácia (ou cria "Farmácia"): o remédio que está acabando. */
export function useAddToPharmacyList() {
  return useAddToOpenList(addToPharmacyList);
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

/** Selo novo (formato uuid); também o id do item posto pela fila. Não precisa ser secreto, só não repetir. */
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
  return unwrapQueued(
    await supabase
      .from('shopping_list_items')
      .update(
        checked
          ? { checked_at: at, checked_by: userId, toggle_token: nextToken }
          : { checked_at: null, checked_by: null, toggle_token: nextToken },
      )
      .eq('id', id)
      .eq('toggle_token', token)
      // As linhas alcançadas: nenhuma pode ser a casa que deixou de ser da pessoa (ver wroteNoRows).
      .select('id'),
  );
}

/**
 * Pôr, marcar, editar e tirar itens e limpar o carrinho andam numa fila só,
 * na ordem dos toques: um limpar nunca cruza com uma marcação, e a marcação
 * de um item posto sem internet sai depois dele (e tudo sobrevive a fechar o
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

/** Os dados do pedido da fila, ou o erro dele com o status HTTP (um 502 do gateway espera, ver isTransientFailure). */
function unwrapQueued<T>(result: { data: T; error: unknown; status?: number }): NonNullable<T> {
  if (result.error) throw withStatus(result.error, result.status);
  return result.data as NonNullable<T>;
}

/** Por ação da fila (as variáveis dela, as mesmas a cada tentativa): quantas falhas contam para desistir. */
const countedFailures = new WeakMap<object, number>();
/** Por erro: a quantas falhas que contam ele levou a ação. */
const failureNumber = new WeakMap<object, number>();

/**
 * A função de uma ação da fila, contando só as falhas que não passam sozinhas:
 * o TanStack Query conta também as faltas de resposta, e depois de algumas
 * delas (sinal fraco) a primeira falha de verdade faria a fila desistir na hora.
 */
export function countingFailures<V, R>(fn: (input: V) => Promise<R>) {
  return async (input: V): Promise<R> => {
    try {
      return await fn(input);
    } catch (error) {
      if (input !== null && typeof input === 'object' && error !== null && typeof error === 'object' && !isTransientFailure(error)) {
        const count = (countedFailures.get(input) ?? 0) + 1;
        countedFailures.set(input, count);
        failureNumber.set(error, count);
      }
      throw error;
    }
  };
}

/**
 * Fila guardada no aparelho: pausa sem internet (ou com a sessão à espera de
 * renovação) em vez de falhar, e anda uma de cada vez, na ordem. Com a
 * sessão à espera (o Supabase tenta de novo a cada minuto), insiste por uns
 * 5 minutos em vez de desistir. O pedido que não chegou ao servidor (sinal
 * fraco, com o aparelho ainda dizendo que há internet; ou cortado pelo prazo)
 * e o que o servidor recusou só por agora (o 502 do gateway, o impasse com o
 * pedido de outra pessoa) esperam como sem internet: tenta de novo sem
 * desistir, no máximo a cada 30 s. Para desistir só contam as outras falhas
 * (countingFailures). Reenviar não repete nada: o pôr e o tirar vão pelo id,
 * a marcação e o limpar pelo selo.
 */
export function queuedDefaults(scope: { id: string }) {
  return {
    networkMode: 'online',
    scope,
    retry: (failures: number, error: Error) => {
      if (error instanceof ForeignToggleError) return false;
      if (isTransientFailure(error)) return true;
      // Sem a contagem da ação (o erro não é um objeto), vale a do TanStack Query.
      const counted = (error !== null && typeof error === 'object' ? failureNumber.get(error) : undefined) ?? failures + 1;
      return counted <= (error instanceof SessionPendingError ? 20 : 3);
    },
    retryDelay: (failures: number, error: Error) =>
      error instanceof SessionPendingError ? 15_000 : Math.min(1000 * 2 ** failures, 30_000),
  } as const;
}

/** O pôr que a fila desistiu de enviar (a pessoa precisa saber: o item digitado sai da tela). */
export interface ListQueueEvents {
  onAddDropped?: (input: AddItemInput, error: Error) => void;
}

/** Sessão desta conta, ou o erro que a fila entende (esperar a renovação; ação de outra conta). */
export async function requireQueueSession(userId: string) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new SessionPendingError();
  if (data.session.user.id !== userId) throw new ForeignToggleError();
}

/** O que a fila precisa para rodar uma marcação restaurada depois de o app reabrir. */
export function registerListMutations(queryClient: QueryClient, events: ListQueueEvents = {}) {
  const queued = queuedDefaults(LIST_QUEUE_SCOPE);
  queryClient.setMutationDefaults(ADD_ITEM_KEY, {
    ...queued,
    mutationFn: countingFailures((input: AddItemInput) => addListItem(queryClient, input)),
    // A fila desistiu (a lista foi apagada, por exemplo): o item que apareceu no toque sai da tela, e a pessoa
    // fica sabendo, também quando o pôr veio de uma fila guardada e a tela que o pôs já fechou.
    onError: async (error: Error, input: AddItemInput) => {
      await hideItems(queryClient, input.listId, new Set([input.id]));
      events.onAddDropped?.(input, error);
    },
  });
  queryClient.setMutationDefaults(REMOVE_ITEM_KEY, {
    ...queued,
    mutationFn: countingFailures((input: RemoveItemInput) => removeListItem(input)),
    meta: EXPECTS_ROWS_META,
  });
  queryClient.setMutationDefaults(TOGGLE_ITEM_KEY, {
    ...queued,
    mutationFn: countingFailures((input: ToggleItemInput) => toggleListItem(input)),
    meta: EXPECTS_ROWS_META,
  });
  queryClient.setMutationDefaults(EDIT_ITEM_KEY, {
    ...queued,
    mutationFn: countingFailures((input: EditItemInput) => editListItem(input)),
    meta: EXPECTS_ROWS_META,
  });
  queryClient.setMutationDefaults(CLEAR_CHECKED_KEY, {
    ...queued,
    mutationFn: countingFailures((input: ClearCheckedInput) => clearCheckedItems(input)),
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
  /**
   * Só os campos que mudaram; photo_path só para tirar a foto (null). A edição guardada por versões anteriores não
   * tem brand_preferred: a escolha de marca do item fica como está.
   */
  values: Partial<Pick<ShoppingListItem, 'name' | 'category' | 'quantity' | 'unit' | 'notes' | 'priority' | 'brand_preferred'>> & {
    photo_path?: null;
  };
  /**
   * Ao tirar a foto: a que estava no item no toque. Só ela sai: a foto que outra pessoa pôs depois (o envio
   * repetido, ou o que esperava a conexão, chega depois dela) fica. A edição guardada por versões anteriores
   * não tem: tira a que estiver.
   */
  expectedPhotoPath?: string;
}

/**
 * Grava os campos do item pelo id. Num banco de antes da "Marca preferida" (a edição esperou na fila enquanto a
 * coluna não chegou, por exemplo), o resto da edição grava sem ela, em vez de a fila desistir do item.
 */
async function updateListItem(id: string, values: EditItemInput['values']) {
  const result = await supabase.from('shopping_list_items').update(values).eq('id', id).select('id');
  if (!('brand_preferred' in values) || !isMissingBrandColumn(result.error)) return unwrapQueued(result);
  const { brand_preferred: _brand, ...rest } = values;
  // Só a marca, que o banco ainda não guarda: nada a gravar (e nenhuma linha a conferir, ver wroteNoRows).
  return Object.keys(rest).length
    ? unwrapQueued(await supabase.from('shopping_list_items').update(rest).eq('id', id).select('id'))
    : undefined;
}

async function editListItem({ id, userId, values, expectedPhotoPath }: EditItemInput) {
  await requireQueueSession(userId);
  const { photo_path: _photo, ...rest } = values;
  const clearsPhoto = 'photo_path' in values;
  if (!clearsPhoto || !expectedPhotoPath) return updateListItem(id, values);
  // Os outros campos pelo id; a foto só se ainda é a mesma (o gatilho manda a tirada para a lixeira).
  const rows = Object.keys(rest).length ? await updateListItem(id, rest) : undefined;
  const cleared = unwrapQueued(
    await supabase.from('shopping_list_items').update({ photo_path: null }).eq('id', id).eq('photo_path', expectedPhotoPath).select('id'),
  );
  return rows ?? cleared;
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

/**
 * Tirar item da lista, pela fila da lista (vale sem internet). Item posto
 * sem internet que ainda não saiu: os dois se cancelam (domain/listQueue).
 */
export const REMOVE_ITEM_KEY = ['removeListItem'];

export interface RemoveItemInput {
  id: string;
  listId: string;
  userId: string;
  /** Só se ainda está para comprar: o que alguém pôs no carrinho enquanto isso fica. */
  onlyPending?: boolean;
  /** Só se continua sem descrição, foto e prioridade (o catálogo tira sem perguntar o item simples). */
  plainOnly?: boolean;
}

async function removeListItem({ id, userId, onlyPending, plainOnly }: RemoveItemInput) {
  await requireQueueSession(userId);
  let request = supabase.from('shopping_list_items').delete().eq('id', id);
  if (onlyPending) request = request.is('checked_at', null);
  if (plainOnly) request = request.is('notes', null).is('photo_path', null).eq('priority', 'normal');
  return unwrapQueued(await request.select('id'));
}

/** O item sai já da lista e do resumo das listas. */
async function hideItems(queryClient: QueryClient, listId: string, ids: ReadonlySet<string>) {
  const key = ['listItems', listId];
  await queryClient.cancelQueries({ queryKey: key });
  const gone = (queryClient.getQueryData<ShoppingListItem[]>(key) ?? []).filter((i) => ids.has(i.id));
  queryClient.setQueryData<ShoppingListItem[]>(key, (items) => items?.filter((i) => !ids.has(i.id)));
  await queryClient.cancelQueries({ queryKey: ['lists'] });
  queryClient.setQueryData<ListSummary[]>(['lists'], (lists) =>
    lists ? summaryWithout(lists, listId, gone.map(({ name, product_id, checked_at }) => ({ name, product_id, checked_at }))) : lists,
  );
}

const QUEUE_KINDS: [readonly string[], QueuedKind][] = [
  [ADD_ITEM_KEY, 'add'],
  [TOGGLE_ITEM_KEY, 'toggle'],
  [EDIT_ITEM_KEY, 'edit'],
  [REMOVE_ITEM_KEY, 'remove'],
  [CLEAR_CHECKED_KEY, 'clear'],
];

/** A fila da lista como a regra de tirar item a enxerga (domain/listQueue), na ordem dos toques. */
function queuedActions(queryClient: QueryClient): QueuedAction<Mutation<unknown, Error, unknown, unknown>>[] {
  return queryClient
    .getMutationCache()
    .getAll()
    .filter((mutation) => inListQueue(mutation) && mutation.state.status === 'pending')
    .flatMap((mutation) => {
      const kind = QUEUE_KINDS.find(([key]) => key[0] === mutation.options.mutationKey?.[0])?.[1];
      if (!kind) return [];
      const variables = mutation.state.variables as { id?: string } | undefined;
      return [{ ref: mutation, kind, itemId: kind === 'clear' ? null : (variables?.id ?? null), started: wasAttempted(mutation.state) }];
    });
}

export function useRemoveListItem(listId: string) {
  const queryClient = useQueryClient();
  const mutation = useMutation<unknown, Error, RemoveItemInput>({
    mutationKey: REMOVE_ITEM_KEY,
    onMutate: (input) => hideItems(queryClient, listId, new Set([input.id])),
  });
  return {
    remove: (input: Omit<RemoveItemInput, 'listId'>, options?: QueuedCallbacks) => {
      const plan = planRemoval(queuedActions(queryClient), input.id);
      if (plan.send) {
        settle(mutation.mutateAsync({ ...input, listId }), options);
        return;
      }
      // Pôr e tirar antes de a conexão voltar: nada vai ao servidor.
      const cache = queryClient.getMutationCache();
      for (const queued of plan.drop) {
        // A ação nunca termina: sem prazo de limpeza, ela não fica agendando outra limpeza para sempre.
        queued.setOptions({ ...queued.options, gcTime: Infinity });
        cache.remove(queued);
      }
      void hideItems(queryClient, listId, new Set([input.id]));
      options?.onSuccess?.();
    },
  };
}

/**
 * Tirar item pelo catálogo vai pela fila quando não dá para perguntar ao
 * servidor como o item está agora: sem internet, ou com a fila ainda
 * enviando (a lista daqui pode não ser a de lá).
 */
export function removalWaitsForQueue(queryClient: QueryClient) {
  return listQueueBusy(queryClient) || !onlineManager.isOnline();
}

/**
 * O item posto pela fila e ainda não gravado (esperando a vez ou a conexão):
 * espera ele chegar ao servidor (ou sair da fila). A foto do item, que anda
 * numa fila própria, só sobe depois, senão não acharia o item.
 */
export function queuedAddSettled(queryClient: QueryClient, itemId: string): Promise<void> {
  const cache = queryClient.getMutationCache();
  const waiting = () =>
    cache.findAll({
      mutationKey: ADD_ITEM_KEY,
      status: 'pending',
      predicate: (mutation) => (mutation.state.variables as AddItemInput | undefined)?.id === itemId,
    }).length > 0;
  if (!waiting()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = cache.subscribe(() => {
      if (waiting()) return;
      unsubscribe();
      resolve();
    });
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
  /**
   * O que sai do carrinho, para o histórico guardado (cartPurchases). Vai junto porque a lista o tira da tela
   * já no toque. O limpar guardado por versões anteriores não tem: o histórico sai da lista guardada.
   */
  bought?: PurchaseRecord[];
}

/** Limpa o carrinho: os itens marcados saem da lista e vão para o histórico de compras. */
async function clearCheckedItems({ listId, userId, items, pantry }: ClearCheckedInput) {
  // Sem sessão válida, o pedido iria com a chave pública e não apagaria nada.
  await requireQueueSession(userId);
  if (!items.length) return 0;
  // O selo é único por marcação: id e selo batendo, o item está como no toque.
  return unwrapQueued(
    await supabase.rpc('clear_checked_items', {
      p_list_id: listId,
      p_ids: items.map((i) => i.id),
      p_tokens: items.map((i) => i.token),
      p_pantry: pantry ?? [],
    }),
  ) as number;
}

/**
 * O que saiu do carrinho entra já no histórico guardado: a lista recarregada
 * não o mostra mais e, se o histórico ainda não tiver a compra (a busca dele
 * anda em separado e pode falhar), "Acho que acabou" o sugeriria de novo.
 */
function recordClearedPurchases(queryClient: QueryClient, { listId, items, bought }: ClearCheckedInput) {
  const ids = new Set(items.map((i) => i.id));
  const cleared =
    bought ?? cartPurchases((queryClient.getQueryData<ShoppingListItem[]>(['listItems', listId]) ?? []).filter((i) => ids.has(i.id)));
  if (!cleared.length) return;
  queryClient.setQueryData<PurchaseRecord[]>(['purchaseRecords'], (records) => {
    if (!records) return records;
    const known = new Set(records.filter((r) => r.source === 'list').map((r) => `${r.name}|${r.at}`));
    const added = cleared.filter((r) => !known.has(`${r.name}|${r.at}`));
    return added.length ? [...added, ...records] : records;
  });
}

/**
 * Limpa o carrinho na vez dele na fila da lista (depois das marcações que
 * vieram antes). Os itens saem da tela já no toque, também sem internet.
 */
export function useClearCheckedItems(listId: string) {
  const queryClient = useQueryClient();
  // Atualizar histórico e listas fica nos padrões da fila (registerListMutations).
  return useMutation<unknown, Error, ClearCheckedInput>({
    mutationKey: CLEAR_CHECKED_KEY,
    onMutate: (input) => hideItems(queryClient, listId, new Set(input.items.map((i) => i.id))),
  });
}

/**
 * O que a casa comprou nos últimos meses: carrinhos limpos (histórico),
 * itens ainda marcados nas listas e itens de notas confirmadas ligados a um
 * produto. recentPurchases e restockSuggestions (domínio) juntam e ordenam.
 * `enabled: false` não busca: a nota já confirmada não usa esse histórico.
 */
export function usePurchaseRecords({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['purchaseRecords'],
    enabled,
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

/** Produtos por pedido (o servidor corta em max_rows, calado: 1000 no padrão do Supabase). */
const PRODUCT_PAGE = 1000;
/** Bem além de qualquer casa. Passando disso a busca falha, em vez de devolver o catálogo cortado. */
export const PRODUCT_MAX = 20000;

/**
 * Os produtos da casa, todos, na ordem do nome. Num pedido só, a casa com mais
 * de mil produtos receberia os primeiros mil, calada, e quem confere se um
 * produto ainda existe daria por juntado (ou apagado) o que só ficou fora da
 * página: a nota em revisão criaria um produto repetido, pelo nome da nota
 * (domain/receiptReview). Página por página, cada uma a partir do id do último
 * produto lido (um produto criado ou juntado no meio não desloca as outras),
 * com a contagem do servidor: página curta não é o fim (o servidor corta em
 * max_rows), o fim é a contagem dizer que não sobrou nada, ou a página vir
 * vazia. Página vazia logo depois de a contagem dizer que ainda havia produtos
 * não é o fim: a leitura falha, em vez de dar a parte lida como o catálogo
 * inteiro.
 */
export async function fetchProducts(): Promise<Product[]> {
  const products: Product[] = [];
  // O id do último produto lido: a página seguinte começa depois dele.
  let last: string | undefined;
  // Quantos produtos a contagem da página anterior disse que ainda faltavam depois dela.
  let promised = 0;
  for (;;) {
    let request = supabase.from('products').select('id, name, category, shelf_life_days', { count: 'exact' });
    if (last) request = request.gt('id', last);
    const result = await request.order('id').limit(PRODUCT_PAGE);
    const rows = (unwrap(result) ?? []) as Product[];
    // Quantos produtos ainda havia a partir daqui, contando os desta página.
    const left = result.count ?? null;
    if (products.length + (left ?? rows.length) > PRODUCT_MAX) {
      throw new Error('Não foi possível carregar os produtos da casa: são mais do que o app consegue ler de uma vez.');
    }
    // Com a sessão vencida no meio da leitura, o servidor responde sem erro e sem linha nenhuma. Um erro comum: a
    // busca tenta de novo, desde a primeira página.
    if (!rows.length && promised > 0) throw new Error('Não foi possível carregar todos os produtos da casa. Tente de novo.');
    products.push(...rows);
    if (!rows.length || (left != null && rows.length >= left)) break;
    promised = left == null ? 0 : left - rows.length;
    last = rows[rows.length - 1].id;
  }
  // A ordem de antes, pelo nome, agora feita no app: as páginas vêm por id.
  return products.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

export function useProducts() {
  return useQuery({ queryKey: ['products'], queryFn: fetchProducts });
}

export function useStores() {
  return useQuery({
    queryKey: ['stores'],
    queryFn: async () =>
      unwrap(await supabase.from('stores').select('id, name, cnpj, address').order('name')) as Store[],
  });
}

/** O servidor devolve até 1000 linhas por pedido (max_rows padrão do Supabase). */
const PRICE_PAGE = 1000;
/** 20 mil preços: bem além de qualquer casa. Passando disso (com um preço a mais que seja) a busca falha, em vez de devolver uma lista cortada. */
const PRICE_MAX_PAGES = 20;

/**
 * Os últimos preços da casa, todos: página por página, até vir uma
 * incompleta. Num pedido só, a casa com mais de mil preços receberia os
 * primeiros mil, calada, e a lista diria "todos os itens têm preço" sobre uma
 * conta cortada. A ordem é a chave da view (produto, mercado, unidade): sem
 * ela, as páginas não se encaixam.
 *
 * Um zero não é preço: é o item que ficou sem valor numa nota confirmada
 * (domain/receiptItem), que a view conta como compra. Ele sai do que a busca
 * devolve, e não da consulta: a view guarda uma linha só por produto, mercado
 * e unidade, então aqui o mercado fica sem preço daquele produto até a próxima
 * compra de verdade (o preço anterior só volta com `unit_price > 0` na view).
 */
export async function fetchLatestPrices(): Promise<LatestPrice[]> {
  const prices: LatestPrice[] = [];
  for (let page = 0; ; page++) {
    const from = page * PRICE_PAGE;
    // Lidas todas as páginas do teto, cheias: uma linha a mais é o que separa "exatamente o teto" de "preços demais".
    const beyond = page === PRICE_MAX_PAGES;
    const rows = (unwrap(
      await supabase
        .from('latest_prices')
        .select('product_id, store_id, unit, unit_price, purchased_at')
        .order('product_id')
        .order('store_id')
        .order('unit')
        .range(from, beyond ? from : from + PRICE_PAGE - 1),
    ) ?? []) as LatestPrice[];
    if (beyond) {
      if (rows.length) throw new Error('Não foi possível carregar todos os preços da casa: são mais do que o app consegue ler de uma vez.');
      return prices;
    }
    // A conta das páginas é com as linhas como vieram; o zero sai só do resultado.
    prices.push(...rows.filter((row) => row.unit_price > 0));
    if (rows.length < PRICE_PAGE) return prices;
  }
}

export function useLatestPrices() {
  return useQuery({ queryKey: ['latestPrices'], queryFn: fetchLatestPrices });
}

/** Linhas pedidas por vez para o alerta da nota. O servidor pode devolver menos (max_rows): a leitura segue de onde parou. */
const OBSERVATION_PAGE = 1000;
/** Bem além de qualquer nota. Passando disso a busca falha (a nota fica sem avisos), em vez de comparar com uma parte do histórico. */
export const OBSERVATION_MAX_LINES = 20000;

// As linhas de notas confirmadas, com a descrição (o tamanho da embalagem, como no histórico do produto) e a nota
// junto; o !inner faz os filtros da nota valerem para a linha.
const OBSERVATION_COLUMNS = 'id, product_id, receipt_id, raw_description, unit, unit_price, receipt:receipts!inner(purchased_at, store_id)';

type ObservationRow = {
  id: string;
  product_id: string;
  receipt_id: string;
  raw_description: string;
  unit: Unit;
  unit_price: number;
  receipt: { purchased_at: string; store_id: string | null };
};

/**
 * Preços de vários produtos nos meses antes de uma compra (alerta de preço na
 * nota), das linhas das notas confirmadas: com a descrição, que traz o
 * tamanho da embalagem (a view price_observations não a tem), para o pacote de
 * 5 kg não ser comparado com o preço do de 1 kg. A janela sai da data da nota,
 * não de hoje: uma nota antiga aberta depois mostra os mesmos avisos. Dois
 * dias de folga para o fuso. Só preço maior que zero, como no histórico do
 * produto: um item que ficou sem valor em outro mercado não vira "R$ 0,00 no
 * Assaí". Como a view, só as notas com mercado.
 *
 * Página por página, cada uma a partir do id da última linha lida, com a
 * contagem do servidor, como fetchProductPurchases: numa nota grande de uma
 * casa que compra muito, um pedido só cortaria calado os preços mais antigos
 * da janela, e o "acima do costume" sairia só dos recentes.
 */
export async function fetchPriceObservations(productIds: string[], purchasedAt: string): Promise<PricePoint[]> {
  const at = new Date(purchasedAt).getTime();
  const from = new Date(at - (PRICE_ALERT_HISTORY_DAYS + 2) * 86_400_000).toISOString();
  const to = new Date(at + 2 * 86_400_000).toISOString();
  const points: PricePoint[] = [];
  // Quantas linhas já vieram (com e sem mercado): é com elas que a contagem do servidor se confere.
  let read = 0;
  let last: string | undefined;
  let promised = 0;
  for (;;) {
    let request = supabase
      .from('receipt_items')
      .select(OBSERVATION_COLUMNS, { count: 'exact' })
      .in('product_id', productIds)
      .eq('receipt.status', 'confirmed')
      .gte('receipt.purchased_at', from)
      .lte('receipt.purchased_at', to)
      .gt('unit_price', 0);
    if (last) request = request.gt('id', last);
    const result = await request.order('id').limit(OBSERVATION_PAGE);
    const rows = (unwrap(result) ?? []) as unknown as ObservationRow[];
    const left = result.count ?? null;
    if (read + (left ?? rows.length) > OBSERVATION_MAX_LINES) {
      throw new Error('Não foi possível comparar os preços desta nota: são mais compras do que o app consegue ler de uma vez.');
    }
    // Com a sessão vencida no meio da leitura, o servidor responde sem erro e sem linha nenhuma: um erro comum.
    if (!rows.length && promised > 0) throw new Error('Não foi possível ler todos os preços para comparar. Tente de novo.');
    read += rows.length;
    for (const row of rows) {
      if (!row.receipt.store_id) continue;
      points.push({
        product_id: row.product_id,
        store_id: row.receipt.store_id,
        unit: row.unit,
        unit_price: Number(row.unit_price),
        purchased_at: row.receipt.purchased_at,
        receipt_id: row.receipt_id,
        description: row.raw_description,
      });
    }
    if (!rows.length || (left != null && rows.length >= left)) return points;
    promised = left == null ? 0 : left - rows.length;
    last = rows[rows.length - 1].id;
  }
}

export function usePriceObservations(productIds: string[], purchasedAt: string | undefined) {
  return useQuery({
    queryKey: ['priceHistory', 'many', productIds, purchasedAt],
    enabled: productIds.length > 0 && !!purchasedAt,
    queryFn: () => fetchPriceObservations(productIds, purchasedAt!),
  });
}

/** Linhas pedidas por vez. O servidor pode devolver menos (max_rows): a leitura segue de onde parou. */
const PURCHASE_PAGE = 1000;
/** 5 mil linhas de nota de um produto só: bem além de qualquer casa. Passando disso a busca falha, em vez de mostrar um histórico cortado. */
export const PURCHASE_MAX_LINES = 5000;

// Só as linhas de notas confirmadas: o !inner faz o filtro da nota valer para a linha (sem ele, a linha do
// rascunho viria com a nota vazia). O mercado vem junto; nota sem mercado conta, com `store` nulo.
// A descrição da linha traz o tamanho da embalagem ("ARROZ 5KG"), para comparar pacotes de tamanhos diferentes.
const PURCHASE_COLUMNS =
  'id, receipt_id, raw_description, quantity, unit, unit_price, total_price, receipt:receipts!inner(purchased_at, store_id, store:stores(name))';

type PurchaseLineRow = {
  id: string;
  receipt_id: string;
  raw_description: string;
  quantity: number;
  unit: Unit;
  unit_price: number;
  total_price: number;
  receipt: { purchased_at: string; store_id: string | null; store: { name: string } | null };
};

/**
 * Todas as linhas de notas confirmadas ligadas ao produto (o histórico de
 * preço, domain/priceHistory). Página por página, cada uma a partir do id da
 * última linha lida, com a contagem do servidor: página curta não é o fim (o
 * servidor corta em max_rows, calado), o fim é a contagem dizer que não
 * sobrou nada, ou a página vir vazia. Página vazia logo depois de a contagem
 * dizer que ainda havia linhas não é o fim: a leitura falha, em vez de dar a
 * parte lida como o histórico inteiro. Quem ordena e filtra é o app.
 */
export async function fetchProductPurchases(productId: string): Promise<PurchaseLine[]> {
  const lines: PurchaseLine[] = [];
  const tooMany = () =>
    new Error('Não foi possível carregar o histórico deste produto: são mais compras do que o app consegue ler de uma vez.');
  // O id da última linha lida: a página seguinte começa depois dela, mesmo que a lista mude no meio da leitura.
  let last: string | undefined;
  // Quantas linhas a contagem da página anterior disse que ainda faltavam depois dela.
  let promised = 0;
  for (;;) {
    let request = supabase
      .from('receipt_items')
      .select(PURCHASE_COLUMNS, { count: 'exact' })
      .eq('product_id', productId)
      .eq('receipt.status', 'confirmed');
    if (last) request = request.gt('id', last);
    const result = await request.order('id').limit(PURCHASE_PAGE);
    const rows = (unwrap(result) ?? []) as unknown as PurchaseLineRow[];
    // Quantas linhas ainda havia a partir daqui, contando as desta página.
    const left = result.count ?? null;
    if (lines.length + (left ?? rows.length) > PURCHASE_MAX_LINES) throw tooMany();
    // Com a sessão vencida no meio da leitura, o servidor responde sem erro e sem linha nenhuma. Um erro comum:
    // a busca tenta de novo, desde a primeira página (linhas apagadas de verdade dão uma contagem coerente na volta).
    if (!rows.length && promised > 0) throw new Error('Não foi possível carregar o histórico inteiro deste produto. Tente de novo.');
    for (const row of rows) {
      lines.push({
        id: row.id,
        receiptId: row.receipt_id,
        storeId: row.receipt.store_id,
        storeName: row.receipt.store?.name ?? null,
        purchasedAt: row.receipt.purchased_at,
        quantity: Number(row.quantity),
        unit: row.unit,
        unitPrice: Number(row.unit_price),
        totalPrice: Number(row.total_price),
        description: row.raw_description,
      });
    }
    if (!rows.length || (left != null && rows.length >= left)) return lines;
    promised = left == null ? 0 : left - rows.length;
    last = rows[rows.length - 1].id;
  }
}

const productPurchasesKey = (productId: string) => ['priceHistory', 'purchases', productId];

/**
 * As compras de um produto, da mais recente para a mais antiga. A chave
 * começa com 'priceHistory': confirmar ou excluir uma nota já recarrega. Não
 * fica guardado no aparelho (queryClient, PERSISTED): são até milhares de
 * linhas por produto aberto, e o armazenamento do aparelho (no navegador,
 * poucos MB para o cache todo) é para o que a lista usa no mercado. Sem
 * internet, o "Último preço por mercado" sai dos últimos preços, que ficam
 * guardados (`useStorePrices`, domain/storePrices).
 */
export function useProductPurchases(productId: string) {
  return useQuery({
    queryKey: productPurchasesKey(productId),
    queryFn: () => fetchProductPurchases(productId),
    // Fora do hook, a mesma função a cada render: as compras só são refeitas quando as linhas mudam.
    select: toPurchases,
  });
}

/**
 * O último preço de cada mercado, a partir das mesmas compras (a mesma chave:
 * uma busca só para as duas leituras), todas e não só as mais recentes: um
 * mercado onde a casa não compra há muito tempo continua na lista.
 */
export function useStorePrices(productId: string) {
  return useQuery({
    queryKey: productPurchasesKey(productId),
    queryFn: () => fetchProductPurchases(productId),
    select: storePricesFromPurchases,
  });
}

/**
 * O nome novo já é de outro produto da casa (products_household_name_key, sem contar maiúsculas). `other`: esse
 * produto, para a tela oferecer juntar os dois; null quando não deu para achá-lo (apagado no meio, por exemplo).
 */
export class ProductNameTakenError extends Error {
  constructor(readonly other: ProductName | null) {
    super(PRODUCT_NAME_TAKEN);
    this.name = 'ProductNameTakenError';
  }
}

/** Chave única violada (23505): na tabela de produtos, só o nome pode repetir. */
const isUniqueViolation = (error: unknown) => (error as { code?: unknown } | null)?.code === '23505';

/** Teto do pedido do outro produto com o mesmo nome: sem *, vem um só; com *, os outros que casam são poucos. */
const PRODUCT_NAMED_MAX = 200;

/**
 * O outro produto com esse nome: a mesma comparação do banco (lower), com ilike e o nome escapado. O PostgREST lê
 * o * do nome como %, sem escape possível: "arroz*" também acha "Arroz Integral". O pedido traz todos os que
 * casam (o outro produto está sempre entre eles) e fica o de nome igual sem contar maiúsculas; sem ele, só quando
 * veio um único, que então é o que o banco recusou.
 */
async function productNamed(name: string, exceptId: string): Promise<ProductName | null> {
  const found = await supabase
    .from('products')
    .select('id, name, category')
    .ilike('name', name.replace(/[\\%_]/g, '\\$&'))
    .neq('id', exceptId)
    .limit(PRODUCT_NAMED_MAX);
  if (found.error) return null;
  const rows = (found.data ?? []) as ProductName[];
  const key = name.toLowerCase();
  return rows.find((row) => row.name.toLowerCase() === key) ?? (rows.length === 1 ? rows[0] : null);
}

export function useRenameProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name, category }: { id: string; name: string; category: string }) => {
      // O banco não reclama de uma gravação que não acha linha nenhuma. O produto pode ter sido juntado com
      // outro em outro aparelho: a gravação pede a linha de volta e, sem ela, falha com a frase de sempre, com
      // os produtos já buscados de novo (a tela deixa de mostrar o que não existe mais).
      const updated = await supabase.from('products').update({ name, category }).eq('id', id).select('id');
      // O nome já é de outro produto: em vez do texto do banco, qual é ele (a tela oferece juntar os dois).
      if (updated.error && isUniqueViolation(updated.error)) throw new ProductNameTakenError(await productNamed(name, id));
      const saved = (unwrap(updated) ?? []) as { id: string }[];
      if (saved.length) return;
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      throw new Error(PRODUCT_MERGED_AWAY);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      // A categoria do produto decide onde o item entra no resumo de gastos, e o nome aparece no mercado do mês.
      queryClient.invalidateQueries({ queryKey: ['spending'] });
    },
  });
}

/**
 * Cria um produto da casa (o código de barras novo de um produto que a casa ainda não tem). O nome que já é de
 * outro produto (o banco não deixa dois iguais, sem contar maiúsculas: criado há pouco em outro aparelho) dá
 * esse produto, com os produtos já buscados de novo: é o que a pessoa quis dizer.
 */
export function useCreateProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, category }: { name: string; category: string }): Promise<Product> => {
      const created = await supabase.from('products').insert({ name, category }).select('id, name, category, shelf_life_days');
      if (created.error && isUniqueViolation(created.error)) {
        const products = await queryClient.fetchQuery({ queryKey: ['products'], queryFn: fetchProducts, staleTime: 0 });
        const existing = productWithName(products, name);
        if (existing) return existing;
      }
      const rows = (unwrap(created) ?? []) as Product[];
      if (!rows.length) throw new Error('Não foi possível criar o produto. Tente de novo.');
      return rows[0];
    },
    onSuccess: (product) => {
      // O produto novo já aparece nas telas, antes de a busca nova chegar.
      queryClient.setQueryData<Product[]>(['products'], (products) =>
        products && !products.some((p) => p.id === product.id)
          ? [...products, product].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
          : products,
      );
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

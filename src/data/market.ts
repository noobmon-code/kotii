// Mercado: listas de compras, produtos, lojas e preços.

import { type QueryClient, useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

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

/**
 * Marcações ainda na fila (inclusive as restauradas ao reabrir o app): buscar
 * a lista agora desfaria na tela as que faltam enviar. A última marcação
 * busca listas e itens; até lá, fica o que está no cache.
 */
function useTogglesQueued() {
  return useIsMutating({ mutationKey: TOGGLE_ITEM_KEY }) > 0;
}

export function useShoppingLists() {
  const queued = useTogglesQueued();
  return useQuery({
    queryKey: ['lists'],
    enabled: !queued,
    queryFn: async () => {
      const rows = unwrap(
        await supabase
          .from('shopping_lists')
          .select('id, name, kind, archived_at, created_at, shopping_list_items(checked_at)')
          .is('archived_at', null)
          .order('created_at', { ascending: false }),
      ) as (ShoppingList & { shopping_list_items: { checked_at: string | null }[] })[];
      return rows.map(({ shopping_list_items, ...list }) => ({
        ...list,
        pending: shopping_list_items.filter((i) => !i.checked_at).length,
        total: shopping_list_items.length,
      }));
    },
  });
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

  const queued = useTogglesQueued();
  return useQuery({
    queryKey: ['listItems', listId],
    enabled: !queued,
    queryFn: async () =>
      unwrap(
        await supabase
          .from('shopping_list_items')
          .select('id, list_id, product_id, name, category, quantity, unit, checked_at, checked_by, toggle_token, created_at')
          .eq('list_id', listId)
          .order('created_at'),
      ) as ShoppingListItem[],
  });
}

/**
 * Mudança na lista vinda do tempo real. Com marcações ainda na fila, buscar
 * agora desfaria na tela as que faltam enviar: quem busca é a última
 * marcação, e ela cobre também as mudanças puladas aqui.
 */
export function onListItemsChange(queryClient: QueryClient, listId: string) {
  if (togglesQueued(queryClient)) return;
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

/** Vários itens de uma vez; sem `listId`, cria uma lista de mercado nova. */
export function useAddItemsToList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ listId, newListName, items }: { listId?: string; newListName: string; items: NewListItem[] }) => {
      const id =
        listId ??
        (
          unwrap(
            await supabase.from('shopping_lists').insert({ name: newListName, kind: 'mercado' }).select('id').single(),
          ) as { id: string }
        ).id;
      if (items.length) {
        unwrap(
          await supabase.from('shopping_list_items').insert(
            items.map((item) => ({
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
      const existing = unwrap(
        await supabase
          .from('shopping_lists')
          .select('id, name')
          .eq('kind', 'mercado')
          .is('archived_at', null)
          .order('created_at', { ascending: false })
          .limit(1),
      ) as { id: string; name: string }[];
      const list =
        existing[0] ??
        (unwrap(
          await supabase.from('shopping_lists').insert({ name: 'Mercado', kind: 'mercado' }).select('id, name').single(),
        ) as { id: string; name: string });
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

/** Marcação feita por outra conta neste aparelho: não sai com a sessão de quem entrou agora. */
export class ForeignToggleError extends Error {
  constructor() {
    super('Marcação de outra conta.');
  }
}

async function toggleListItem({ id, checked, userId, at, token, nextToken }: ToggleItemInput) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new SessionPendingError();
  if (data.session.user.id !== userId) throw new ForeignToggleError();
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

/** Ainda há marcação na fila, fora as `settling` que estão terminando agora? */
function togglesQueued(queryClient: QueryClient, settling = 0) {
  return queryClient.isMutating({ mutationKey: TOGGLE_ITEM_KEY }) > settling;
}

/**
 * Com outras marcações na fila, buscar a lista agora desfaria na tela as que
 * ainda não foram: só a última busca listas e itens (de todas as listas, já
 * que o tempo real pulou as mudanças enquanto a fila andava).
 */
function refreshAfterToggle(queryClient: QueryClient) {
  if (togglesQueued(queryClient, 1)) return;
  queryClient.invalidateQueries({ queryKey: ['lists'] });
  queryClient.invalidateQueries({ queryKey: ['listItems'] });
}

/** O que a fila precisa para rodar uma marcação restaurada depois de o app reabrir. */
export function registerListMutations(queryClient: QueryClient) {
  queryClient.setMutationDefaults(TOGGLE_ITEM_KEY, {
    mutationFn: (input: ToggleItemInput) => toggleListItem(input),
    // Pausa sem internet em vez de falhar, e uma de cada vez, na ordem.
    networkMode: 'online',
    scope: { id: 'list-items' },
    // Sessão à espera de renovação (o Supabase tenta de novo a cada minuto):
    // insiste por uns 5 minutos em vez de desistir da marcação.
    retry: (failures, error) =>
      !(error instanceof ForeignToggleError) && failures < (error instanceof SessionPendingError ? 20 : 3),
    retryDelay: (failures, error) =>
      error instanceof SessionPendingError ? 15_000 : Math.min(1000 * 2 ** failures, 30_000),
    // Fila restaurada ao reabrir o app.
    onSettled: () => refreshAfterToggle(queryClient),
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
    onSettled: () => refreshAfterToggle(queryClient),
  });
}

export function useDeleteListItem(listId: string) {
  const invalidate = useInvalidateLists(listId);
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('shopping_list_items').delete().eq('id', id)),
    onSuccess: invalidate,
  });
}

export function useClearCheckedItems(listId: string) {
  const invalidate = useInvalidateLists(listId);
  return useMutation({
    mutationFn: async () =>
      unwrap(
        await supabase.from('shopping_list_items').delete().eq('list_id', listId).not('checked_at', 'is', null),
      ),
    onSuccess: invalidate,
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

export function useRenameProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name, category }: { id: string; name: string; category: string }) =>
      unwrap(await supabase.from('products').update({ name, category }).eq('id', id)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['products'] }),
  });
}

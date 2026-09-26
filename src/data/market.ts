// Mercado: listas de compras, produtos, lojas e preços.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

export function useShoppingLists() {
  return useQuery({
    queryKey: ['lists'],
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
        () => {
          queryClient.invalidateQueries({ queryKey: ['listItems', listId] });
          queryClient.invalidateQueries({ queryKey: ['lists'] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [listId, queryClient]);

  return useQuery({
    queryKey: ['listItems', listId],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('shopping_list_items')
          .select('id, list_id, product_id, name, category, quantity, unit, checked_at, checked_by, created_at')
          .eq('list_id', listId)
          .order('created_at'),
      ) as ShoppingListItem[],
  });
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

/**
 * Põe um item na lista de mercado aberta mais recente (ou cria "Mercado").
 * Usado pela despensa: "acabou -> comprar de novo".
 */
export function useAddToMarketList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (item: NewListItem) => {
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
      return list;
    },
    onSuccess: (list) => {
      queryClient.invalidateQueries({ queryKey: ['lists'] });
      queryClient.invalidateQueries({ queryKey: ['listItems', list.id] });
    },
  });
}

export function useToggleListItem(listId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateLists(listId);
  return useMutation({
    mutationFn: async ({ id, checked, userId }: { id: string; checked: boolean; userId: string }) =>
      unwrap(
        await supabase
          .from('shopping_list_items')
          .update(checked ? { checked_at: new Date().toISOString(), checked_by: userId } : { checked_at: null, checked_by: null })
          .eq('id', id),
      ),
    // Marca na hora; o servidor confirma depois.
    onMutate: async ({ id, checked }) => {
      const key = ['listItems', listId];
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData<ShoppingListItem[]>(key, (items) =>
        items?.map((i) => (i.id === id ? { ...i, checked_at: checked ? new Date().toISOString() : null } : i)),
      );
    },
    onSettled: invalidate,
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

// Notas fiscais: leitura por foto (IA), revisão e confirmação.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ConfirmItem } from '@/domain/receiptReview';
import { supabase, unwrap } from '@/lib/supabase';
import type { Receipt, ReceiptItem, Unit } from '@/lib/types';
import { functionErrorMessage, pickImages, signedImageUrl, uploadImage, type ScanSource } from './images';

const RECEIPT_COLUMNS =
  'id, store_id, purchased_at, total, access_key, image_path, source, status, created_at, store:stores(id, name)';
const ITEM_COLUMNS =
  'id, receipt_id, position, raw_description, suggested_name, suggested_category, product_id, quantity, unit, unit_price, total_price';

export function useReceipts() {
  return useQuery({
    queryKey: ['receipts'],
    queryFn: async () =>
      unwrap(
        await supabase
          .from('receipts')
          .select(`${RECEIPT_COLUMNS}, receipt_items(count)`)
          .order('purchased_at', { ascending: false })
          .limit(200),
      ) as unknown as (Receipt & { receipt_items: { count: number }[] })[],
  });
}

export function useReceipt(id: string) {
  return useQuery({
    queryKey: ['receipt', id],
    queryFn: async () => {
      const receipt = unwrap(
        await supabase.from('receipts').select(RECEIPT_COLUMNS).eq('id', id).single(),
      ) as unknown as Receipt;
      const items = unwrap(
        await supabase.from('receipt_items').select(ITEM_COLUMNS).eq('receipt_id', id).order('position'),
      ) as ReceiptItem[];
      return { receipt, items };
    },
  });
}

function useInvalidateReceipt(id?: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['receipts'] });
    if (id) queryClient.invalidateQueries({ queryKey: ['receipt', id] });
  };
}

// ---------------------------------------------------------------------------
// Leitura por foto

export type { ScanSource } from './images';

/** Abre câmera ou galeria; null se o usuário desistir. */
export async function pickReceiptImage(source: ScanSource): Promise<string | null> {
  return (await pickImages(source))[0] ?? null;
}

/**
 * Foto escolhida -> upload -> leitura por IA -> rascunho de nota. Devolve o
 * id da nota para a tela de revisão.
 */
export function useScanReceipt(householdId: string | undefined) {
  const invalidate = useInvalidateReceipt();
  return useMutation({
    mutationFn: async (uri: string) => {
      if (!householdId) throw new Error('Família não carregada.');
      const path = await uploadImage('receipts', householdId, uri);

      const { data, error } = await supabase.functions.invoke<{ receipt_id: string; duplicate: boolean }>(
        'parse-receipt',
        { body: { image_path: path } },
      );
      if (error || !data) {
        throw new Error(await functionErrorMessage(error, 'Não foi possível ler a nota. Tente novamente.'));
      }
      if (data.duplicate) await supabase.storage.from('receipts').remove([path]);
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useCreateManualReceipt() {
  const invalidate = useInvalidateReceipt();
  return useMutation({
    mutationFn: async () =>
      unwrap(await supabase.from('receipts').insert({ source: 'manual' }).select('id').single()) as { id: string },
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------
// Revisão

export function useUpdateReceipt(id: string) {
  const invalidate = useInvalidateReceipt(id);
  return useMutation({
    mutationFn: async (patch: Partial<Pick<Receipt, 'store_id' | 'purchased_at' | 'total'>>) =>
      unwrap(await supabase.from('receipts').update(patch).eq('id', id)),
    onSuccess: invalidate,
  });
}

export function useSetReceiptStore(receiptId: string) {
  const invalidate = useInvalidateReceipt(receiptId);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (store: { id: string } | { name: string }) => {
      let storeId: string;
      if ('id' in store) {
        storeId = store.id;
      } else {
        const created = unwrap(
          await supabase.from('stores').insert({ name: store.name }).select('id').single(),
        ) as { id: string };
        storeId = created.id;
      }
      unwrap(await supabase.from('receipts').update({ store_id: storeId }).eq('id', receiptId));
    },
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['stores'] });
    },
  });
}

export interface ItemValues {
  raw_description: string;
  quantity: number;
  unit: Unit;
  unit_price: number;
  total_price: number;
}

export function useSaveReceiptItem(receiptId: string) {
  const invalidate = useInvalidateReceipt(receiptId);
  return useMutation({
    mutationFn: async ({ id, values, position }: { id?: string; values: ItemValues; position?: number }) =>
      id
        ? unwrap(await supabase.from('receipt_items').update(values).eq('id', id))
        : unwrap(
            await supabase
              .from('receipt_items')
              .insert({ ...values, receipt_id: receiptId, position: position ?? 0 }),
          ),
    onSuccess: invalidate,
  });
}

export function useDeleteReceiptItem(receiptId: string) {
  const invalidate = useInvalidateReceipt(receiptId);
  return useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('receipt_items').delete().eq('id', id)),
    onSuccess: invalidate,
  });
}

export function useConfirmReceipt(receiptId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (items: ConfirmItem[]) =>
      unwrap(await supabase.rpc('confirm_receipt', { p_receipt_id: receiptId, p_items: items })),
    onSuccess: () => {
      for (const key of ['receipts', 'receipt', 'products', 'latestPrices', 'priceHistory', 'pantry']) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

export function useDeleteReceipt(receiptId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (imagePath: string | null) => {
      unwrap(await supabase.from('receipts').delete().eq('id', receiptId));
      if (imagePath) await supabase.storage.from('receipts').remove([imagePath]);
    },
    onSuccess: () => {
      for (const key of ['receipts', 'latestPrices', 'priceHistory']) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

export function receiptImageUrl(path: string): Promise<string | null> {
  return signedImageUrl('receipts', path);
}

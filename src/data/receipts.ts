// Notas fiscais: leitura por foto (IA), revisão e confirmação.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { decode } from 'base64-arraybuffer';
import { SaveFormat, ImageManipulator } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { fitForVision } from '@/domain/image';
import type { ConfirmItem } from '@/domain/receiptReview';
import { supabase, unwrap } from '@/lib/supabase';
import type { Receipt, ReceiptItem, Unit } from '@/lib/types';

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

export type ScanSource = 'camera' | 'library';

/** Abre câmera ou galeria; null se o usuário desistir. */
export async function pickReceiptImage(source: ScanSource): Promise<string | null> {
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error(
      source === 'camera'
        ? 'Sem acesso à câmera. Libere nas configurações do aparelho.'
        : 'Sem acesso às fotos. Libere nas configurações do aparelho.',
    );
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
  const result =
    source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets[0]) return null;
  return result.assets[0].uri;
}

async function prepareImage(uri: string): Promise<string> {
  const context = ImageManipulator.manipulate(uri);
  const original = await context.renderAsync();
  const target = fitForVision(original.width, original.height);
  let image = original;
  if (target.width < original.width) {
    context.resize(target);
    image = await context.renderAsync();
  }
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
  if (!saved.base64) throw new Error('Não foi possível processar a imagem.');
  return saved.base64;
}

async function functionErrorMessage(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (typeof body?.error === 'string') return body.error;
    } catch {
      // corpo não era JSON
    }
  }
  return 'Não foi possível ler a nota. Tente novamente.';
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
      const base64 = await prepareImage(uri);

      const path = `${householdId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('receipts')
        .upload(path, decode(base64), { contentType: 'image/jpeg' });
      if (uploadError) throw uploadError;

      const { data, error } = await supabase.functions.invoke<{ receipt_id: string; duplicate: boolean }>(
        'parse-receipt',
        { body: { image_path: path } },
      );
      if (error || !data) throw new Error(await functionErrorMessage(error));
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

export async function receiptImageUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from('receipts').createSignedUrl(path, 600);
  return data?.signedUrl ?? null;
}

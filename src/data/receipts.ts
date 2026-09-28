// Notas fiscais: leitura por foto (IA), revisão e confirmação.

import { FunctionsHttpError } from '@supabase/supabase-js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { localDateTimeToISO, nfceItemsToDraft, type NfceItem, type NfceQr } from '@/domain/nfce';
import type { ConfirmItem } from '@/domain/receiptReview';
import { supabase, unwrap } from '@/lib/supabase';
import type { Receipt, ReceiptItem, Unit } from '@/lib/types';
import { functionErrorMessage, pickImages, signedImageUrl, uploadImage, type ScanSource } from './images';

const RECEIPT_COLUMNS =
  'id, store_id, purchased_at, total, access_key, image_path, source, status, created_at, paid_by, store:stores(id, name)';
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
    // Mercado, data, total e quem pagou mudam o resumo de gastos.
    queryClient.invalidateQueries({ queryKey: ['spending'] });
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
        // A função respondeu com erro: nenhuma nota foi criada com essa foto,
        // então ela sai do storage. Em falha de rede o resultado é incerto
        // (a nota pode ter sido salva) e a foto fica.
        if (error instanceof FunctionsHttpError) {
          await supabase.storage.from('receipts').remove([path]).catch(() => undefined);
        }
        throw new Error(await functionErrorMessage(error, 'Não foi possível ler a nota. Tente novamente.'));
      }
      if (data.duplicate) await supabase.storage.from('receipts').remove([path]);
      return data;
    },
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------------
// Leitura pelo QR code (consulta pública da Sefaz, sem IA)

interface NfcePageResult {
  store: { name: string | null; cnpj: string | null; address: string | null };
  /** Hora local da nota, sem fuso. */
  issuedAtLocal: string | null;
  total: number | null;
  items: NfceItem[];
}

/** Mercado pelo CNPJ (ou nome), criando se ainda não existe, como na leitura por foto. */
async function findOrCreateStore(store: { name: string | null; cnpj: string | null; address: string | null }) {
  if (!store.name && !store.cnpj) return null;
  const lookup = store.cnpj
    ? supabase.from('stores').select('id').eq('cnpj', store.cnpj)
    : supabase.from('stores').select('id').is('cnpj', null).ilike('name', store.name!.replace(/[\\%_]/g, '\\$&'));
  const existing = unwrap(await lookup.limit(1).maybeSingle()) as { id: string } | null;
  if (existing) return existing.id;
  const created = unwrap(
    await supabase
      .from('stores')
      .insert({ name: store.name ?? `CNPJ ${store.cnpj}`, cnpj: store.cnpj, address: store.address })
      .select('id')
      .single(),
  ) as { id: string };
  return created.id;
}

/**
 * QR code da nota -> itens da Sefaz (função `nfce`) -> rascunho de nota,
 * com produtos já conhecidos pelos apelidos e categoria pelas palavras.
 * Nota já importada (mesma chave) abre a existente.
 */
export function useImportNfce() {
  const invalidate = useInvalidateReceipt();
  return useMutation({
    mutationFn: async (qr: NfceQr): Promise<{ receipt_id: string; duplicate: boolean }> => {
      const dup = unwrap(
        await supabase.from('receipts').select('id, source, status, receipt_items(count)').eq('access_key', qr.accessKey).maybeSingle(),
      ) as { id: string; source: string; status: string; receipt_items: { count: number }[] } | null;
      if (dup) {
        // Rascunho do QR code sem itens é uma importação que parou no meio (o
        // app fechou entre gravar a nota e os itens): apaga e importa de novo.
        // O de foto fica: tem a foto e pode ser completado à mão.
        const unfinished = dup.source === 'qrcode' && dup.status === 'draft' && (dup.receipt_items[0]?.count ?? 0) === 0;
        if (!unfinished) return { receipt_id: dup.id, duplicate: true };
        unwrap(await supabase.from('receipts').delete().eq('id', dup.id));
      }
      if (!qr.url) throw new Error('Só com a chave não dá para ver os itens: leia o QR code da nota ou tire uma foto dela.');

      const { data: page, error } = await supabase.functions.invoke<NfcePageResult>('nfce', { body: { url: qr.url } });
      if (error || !page) throw new Error(await functionErrorMessage(error, 'Não deu para buscar a nota na Sefaz agora.'));

      const descriptions = page.items.map((item) => item.description.trim().replace(/\s+/g, ' '));
      const aliasRows = unwrap(await supabase.rpc('match_aliases', { p_descriptions: descriptions })) as
        | { description: string; product_id: string }[]
        | null;
      const productIds = [...new Set((aliasRows ?? []).map((row) => row.product_id))];
      const products = productIds.length
        ? (unwrap(await supabase.from('products').select('id, category').in('id', productIds)) as { id: string; category: string }[])
        : [];
      const categoryOf = new Map(products.map((p) => [p.id, p.category]));
      const aliases = new Map(
        (aliasRows ?? []).map((row) => [row.description, { productId: row.product_id, category: categoryOf.get(row.product_id) ?? 'outros' }]),
      );

      const storeId = await findOrCreateStore({ ...page.store, cnpj: page.store.cnpj ?? qr.cnpj });
      const receipt = unwrap(
        await supabase
          .from('receipts')
          .insert({
            store_id: storeId,
            purchased_at: (page.issuedAtLocal && localDateTimeToISO(page.issuedAtLocal)) ?? new Date().toISOString(),
            total: page.total,
            access_key: qr.accessKey,
            source: 'qrcode',
            status: 'draft',
          })
          .select('id')
          .single(),
      ) as { id: string };
      const items = nfceItemsToDraft(page.items, aliases).map((item) => ({ ...item, receipt_id: receipt.id }));
      const { error: itemsError } = await supabase.from('receipt_items').insert(items);
      if (itemsError) {
        await supabase.from('receipts').delete().eq('id', receipt.id);
        throw itemsError;
      }
      return { receipt_id: receipt.id, duplicate: false };
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
    mutationFn: async (patch: Partial<Pick<Receipt, 'store_id' | 'purchased_at' | 'total' | 'paid_by'>>) =>
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
      for (const key of ['receipts', 'receipt', 'products', 'latestPrices', 'priceHistory', 'pantry', 'spending', 'purchaseRecords']) {
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
      for (const key of ['receipts', 'latestPrices', 'priceHistory', 'spending', 'purchaseRecords']) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

export function receiptImageUrl(path: string): Promise<string | null> {
  return signedImageUrl('receipts', path);
}

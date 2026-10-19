// Notas fiscais: leitura por foto (IA), revisão e confirmação.

import { FunctionsHttpError } from '@supabase/supabase-js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { nfceItemsToDraft, nfceReceiptRow, type NfceItem, type NfceQr } from '@/domain/nfce';
import type { ConfirmItem } from '@/domain/receiptReview';
import { supabase, unwrap } from '@/lib/supabase';
import type { Receipt, ReceiptItem, Unit } from '@/lib/types';
import {
  FunctionError,
  functionErrorDetails,
  functionErrorMessage,
  pickImages,
  removeImages,
  signedImageUrl,
  uploadImages,
  type ScanSource,
} from './images';
import { withFreshProducts } from './productMerge';

const RECEIPT_COLUMNS =
  'id, store_id, purchased_at, total, access_key, image_path, extra_image_paths, source, status, created_at, paid_by, store:stores(id, name)';
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

/**
 * De quando é a nota guardada (a leitura mais recente que chegou do banco), vista na hora da chamada e não no
 * render: a tela da nota marca com isso a leitura que ficou atrás de uma gravação dela.
 */
export function useReceiptReadAt(id: string) {
  const queryClient = useQueryClient();
  return () => queryClient.getQueryState(['receipt', id])?.dataUpdatedAt ?? 0;
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

/** Nota comprida vai em partes: até 4 fotos por nota. */
export const MAX_RECEIPT_PHOTOS = 4;

/** Abre câmera (uma foto) ou galeria (até `limit`, em ordem); vazio se o usuário desistir. */
export async function pickReceiptImages(source: ScanSource, limit = 1): Promise<string[]> {
  return pickImages(source, limit);
}

export interface ReceiptPhotos {
  /** Fotos em ordem, de cima para baixo. */
  uris: string[];
  /**
   * Chave de acesso já conhecida (do QR code, quando a Sefaz pediu o "não sou
   * robô"): a nota lida guarda essa chave, e ler o QR de novo abre esta nota.
   */
  accessKey?: string | null;
}

/**
 * Fotos da nota -> upload -> leitura por IA -> rascunho de nota. Devolve o
 * id da nota para a tela de revisão (ou o da nota que já tinha essa chave).
 */
export async function scanReceiptPhotos(
  householdId: string | undefined,
  { uris, accessKey }: ReceiptPhotos,
): Promise<{ receipt_id: string; duplicate: boolean }> {
  if (!householdId) throw new Error('Família não carregada.');
  // Falha no envio de uma parte apaga as que já subiram.
  const paths = await uploadImages('receipts', householdId, uris.slice(0, MAX_RECEIPT_PHOTOS));
  const removeAll = () => removeImages('receipts', paths).catch(() => undefined);

  const { data, error } = await supabase.functions.invoke<{ receipt_id: string; duplicate: boolean }>('parse-receipt', {
    body: accessKey ? { image_paths: paths, access_key: accessKey } : { image_paths: paths },
  });
  if (error || !data) {
    // A função respondeu com erro: nenhuma nota foi criada com essas
    // fotos, então elas saem do storage. Em falha de rede o resultado é
    // incerto (a nota pode ter sido salva) e as fotos ficam.
    if (error instanceof FunctionsHttpError) await removeAll();
    throw new Error(await functionErrorMessage(error, 'Não foi possível ler a nota. Tente novamente.'));
  }
  // Nota que já estava no app (mesma chave): as fotos novas sobram.
  if (data.duplicate) await removeAll();
  return data;
}

export function useScanReceipt(householdId: string | undefined) {
  const invalidate = useInvalidateReceipt();
  return useMutation({
    mutationFn: (photos: ReceiptPhotos) => scanReceiptPhotos(householdId, photos),
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
  /** A leitura que a função gravou no servidor (receipt_reads); ausente na função de antes, nula se não deu para gravar. */
  readId?: string | null;
}

/** Mesmo nome de loja, sem caixa nem espaços nas pontas (num ILIKE, "%", "_" e "*" seriam curingas). */
const sameStoreName = (a: string, b: string) => a.trim().toLocaleLowerCase('pt-BR') === b.trim().toLocaleLowerCase('pt-BR');

const STORE_PAGE = 1000;

/** A loja sem CNPJ com este nome, página a página (a API devolve até 1000 linhas por pedido). */
async function findUnnamedStore(name: string): Promise<{ id: string } | null> {
  for (let from = 0; ; from += STORE_PAGE) {
    const page = unwrap(
      await supabase.from('stores').select('id, name').is('cnpj', null).order('id').range(from, from + STORE_PAGE - 1),
    ) as { id: string; name: string }[];
    const found = page.find((s) => sameStoreName(s.name, name));
    if (found) return found;
    if (page.length < STORE_PAGE) return null;
  }
}

/** Mercado pelo CNPJ (ou nome), criando se ainda não existe, como na leitura por foto. */
async function findOrCreateStore(store: { name: string | null; cnpj: string | null; address: string | null }) {
  if (!store.name && !store.cnpj) return null;
  const existing = store.cnpj
    ? (unwrap(await supabase.from('stores').select('id').eq('cnpj', store.cnpj).limit(1).maybeSingle()) as { id: string } | null)
    : await findUnnamedStore(store.name!);
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
 * Busca a nota na Sefaz (função `nfce`). Se falhar, o erro (FunctionError)
 * traz o código da função: com 'captcha', a tela leva para a foto da nota.
 */
export async function fetchNfcePage(url: string): Promise<NfcePageResult> {
  const { data, error } = await supabase.functions.invoke<NfcePageResult>('nfce', { body: { url } });
  if (error || !data) {
    const { message, code } = await functionErrorDetails(error, 'Não deu para buscar a nota na Sefaz agora.');
    throw new FunctionError(message, code);
  }
  return data;
}

/**
 * QR code da nota -> itens da Sefaz (função `nfce`) -> rascunho de nota,
 * com produtos já conhecidos pelos apelidos e categoria pelas palavras.
 * Nota já importada (mesma chave, também pela foto) abre a existente.
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

      const page = await fetchNfcePage(qr.url);

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
      // Com o id da leitura do servidor, quando a função devolveu um: é o que deixa a nota compartilhar preço.
      const receipt = await insertNfceReceipt(nfceReceiptRow(page, qr, storeId));
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

/**
 * Grava o rascunho da nota do QR code. A leitura do servidor leva a casa junto
 * (chave estrangeira com household_id): se a pessoa trocou de casa entre a
 * leitura e a gravação, o banco recusa o read_id (23503) e a nota é gravada de
 * novo sem ele. Ela não se perde por isso, só não compartilha preço.
 */
export async function insertNfceReceipt(row: ReturnType<typeof nfceReceiptRow>): Promise<{ id: string }> {
  const first = await supabase.from('receipts').insert(row).select('id').single();
  if (first.error && 'read_id' in row && (first.error as { code?: string }).code === '23503') {
    const { read_id: _refused, ...withoutRead } = row;
    return unwrap(await supabase.from('receipts').insert(withoutRead).select('id').single()) as { id: string };
  }
  return unwrap(first) as { id: string };
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
    mutationFn: async (patch: Partial<Pick<Receipt, 'store_id' | 'purchased_at' | 'paid_by'>>) =>
      unwrap(await supabase.from('receipts').update(patch).eq('id', id)),
    onSuccess: invalidate,
  });
}

/**
 * O total da nota, que só a revisão deixa corrigir: a gravação só acha a nota
 * enquanto ela é rascunho. Confirmada em outro aparelho, nada é gravado, e a
 * nota relida (a tela vira a da nota confirmada) é o aviso. É uma gravação à
 * parte da de data e de quem pagou, com o próprio "salvando": uma em andamento
 * não segura a outra.
 */
export function useSetReceiptTotal(id: string) {
  const invalidate = useInvalidateReceipt(id);
  return useMutation({
    // Pede a linha de volta: a nota confirmada em outro aparelho não é achada (o filtro é o rascunho), e o banco
    // não reclama. Quem chamou precisa saber que nada foi gravado, para não seguir como se a nota fosse rascunho.
    mutationFn: async (total: number | null): Promise<{ saved: boolean }> => {
      const rows = unwrap(await supabase.from('receipts').update({ total }).eq('id', id).eq('status', 'draft').select('id')) as { id: string }[] | null;
      return { saved: Boolean(rows?.length) };
    },
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
    // Devolve o id do item. O do item novo é o banco que dá, e a tela precisa dele antes de a nota voltar: o zero
    // digitado de propósito é "deixar sem valor", e o item novo não pode perguntar pelo valor quando aparecer.
    mutationFn: async ({ id, values, position }: { id?: string; values: ItemValues; position?: number }): Promise<{ id: string }> => {
      if (id) {
        unwrap(await supabase.from('receipt_items').update(values).eq('id', id));
        return { id };
      }
      return unwrap(
        await supabase
          .from('receipt_items')
          .insert({ ...values, receipt_id: receiptId, position: position ?? 0 })
          .select('id')
          .single(),
      ) as { id: string };
    },
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
    // Um produto da nota pode ter sido juntado com outro em outro aparelho, com esta revisão aberta: os
    // produtos e a nota são buscados de novo, os dois, antes de a gravação terminar. Só com os produtos de
    // agora e a nota de antes, o item desse produto pareceria um produto novo, e confirmar o criaria de novo.
    mutationFn: (items: ConfirmItem[]) =>
      withFreshProducts(queryClient, ['products', 'receipt'], async () =>
        unwrap(await supabase.rpc('confirm_receipt', { p_receipt_id: receiptId, p_items: items })),
      ),
    onSuccess: () => {
      for (const key of [
        'receipts',
        'receipt',
        'products',
        'latestPrices',
        'priceHistory',
        'pantry',
        'spending',
        'purchaseRecords',
        'lists',
        'listItems',
        'listLinks',
        // A nota ensina apelidos novos, e é por eles que os preços de outras casas chegam aos produtos desta.
        'sharedPrices',
        // A leitura do QR code pode ter criado o mercado, e é pelo nome dele que a casa reconhece "os seus mercados".
        'stores',
      ]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

/**
 * O que mostra os itens de uma nota já confirmada: comparativo, histórico de preço, gastos, compras recentes e os
 * preços de outras casas (a compra da casa esconde a linha de fora daquele mercado, e a casa sem nota confirmada
 * nenhuma não vê preço de fora).
 */
const CONFIRMED_ITEM_KEYS = ['receipts', 'latestPrices', 'priceHistory', 'spending', 'purchaseRecords', 'sharedPrices'];

export function useDeleteReceipt(receiptId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (imagePaths: string[]) => {
      unwrap(await supabase.from('receipts').delete().eq('id', receiptId));
      if (imagePaths.length) await supabase.storage.from('receipts').remove(imagePaths);
    },
    onSuccess: () => {
      for (const key of CONFIRMED_ITEM_KEYS) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

/**
 * Dar valor ao item que ficou sem (total zerado): o caminho de "Usar R$ …",
 * na revisão e na nota confirmada, e o único conserto que a nota confirmada
 * aceita. A descrição não vai no pedido, e o filtro do total zerado deixa
 * quieto o item que já ganhou valor em outro aparelho: `filled` diz se o item
 * foi gravado, para a tela avisar em vez de sumir calada com o valor
 * escolhido. Na nota confirmada esse item já conta nos preços e nos gastos:
 * salvar atualiza o mesmo que excluir a nota (na revisão a nota pode ter sido
 * confirmada em outro aparelho, e refazer essas buscas não custa).
 */
export function useFillReceiptItemValue(receiptId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    // Só o preço e o total. A quantidade e a unidade ficam como estão: na nota confirmada elas já foram para a
    // despensa (confirm_receipt copia as duas para o item de lá), e mudá-las aqui deixaria as duas telas em
    // desacordo.
    mutationFn: async ({ id, values }: { id: string; values: Pick<ItemValues, 'unit_price' | 'total_price'> }): Promise<{ filled: boolean }> => {
      const { unit_price, total_price } = values;
      const rows = unwrap(
        await supabase
          .from('receipt_items')
          .update({ unit_price, total_price })
          .eq('id', id)
          .eq('receipt_id', receiptId)
          .eq('total_price', 0)
          .select('id'),
      ) as { id: string }[] | null;
      return { filled: Boolean(rows?.length) };
    },
    onSuccess: () => {
      for (const key of CONFIRMED_ITEM_KEYS) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      queryClient.invalidateQueries({ queryKey: ['receipt', receiptId] });
    },
  });
}

export function receiptImageUrl(path: string): Promise<string | null> {
  return signedImageUrl('receipts', path);
}

// Os códigos de barras da casa (product_barcodes): qual produto é cada código.
// A nota confirmada ensina (confirm_receipt) e a leitura pela câmera também,
// quando a pessoa diz qual produto é um código novo (features/ProductBarcode).
//
// A tabela chega na migração 20261021150000_store_codes.sql, e o app pode ser
// publicado antes dela. Sem a tabela, os códigos vêm como null e as telas não
// mostram os botões de ler código; gravar avisa que a função ainda está sendo
// ativada.

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { BARCODES_NOT_READY } from '@/domain/barcode';
import { supabase, unwrap } from '@/lib/supabase';

import { isMissingTable } from './missingSchema';
import { withFreshProducts } from './productMerge';

export interface ProductBarcode {
  /** Os 14 dígitos da gtin_key. */
  gtin: string;
  product_id: string;
}

export const BARCODES_KEY = ['productBarcodes'] as const;

/** O servidor devolve até 1000 linhas por pedido (max_rows padrão do Supabase). */
const PAGE = 1000;

const notReady = (error: unknown) => isMissingTable(error, 'product_barcodes');

/**
 * Todos os códigos da casa, página por página (na ordem da chave, para as
 * páginas se encaixarem); null quando o banco ainda não tem a tabela. Ficam
 * guardados no aparelho (lib/queryClient, PERSISTED): no mercado, com sinal
 * fraco, o código lido acha o produto mesmo assim.
 */
export async function fetchBarcodes(): Promise<ProductBarcode[] | null> {
  const codes: ProductBarcode[] = [];
  for (let from = 0; ; from += PAGE) {
    const result = await supabase
      .from('product_barcodes')
      .select('gtin, product_id')
      .order('gtin')
      .range(from, from + PAGE - 1);
    if (result.error && notReady(result.error)) return null;
    const rows = (unwrap(result) ?? []) as ProductBarcode[];
    codes.push(...rows);
    if (rows.length < PAGE) return codes;
  }
}

export function useBarcodes() {
  return useQuery({ queryKey: BARCODES_KEY, queryFn: fetchBarcodes });
}

/**
 * De quem o código é agora, perguntado ao banco: outra pessoa da casa pode ter
 * ligado o código há pouco, ou uma nota confirmada ensinou. null: de ninguém.
 */
export async function fetchBarcodeOwner(gtin: string): Promise<string | null> {
  const result = await supabase.from('product_barcodes').select('product_id').eq('gtin', gtin).limit(1);
  if (result.error && notReady(result.error)) throw new Error(BARCODES_NOT_READY);
  const rows = (unwrap(result) ?? []) as { product_id: string }[];
  return rows[0]?.product_id ?? null;
}

/** Os códigos guardados já com a mudança, antes de a busca nova chegar: a tela mostra na hora. */
function patchBarcodes(queryClient: QueryClient, change: (codes: ProductBarcode[]) => ProductBarcode[]) {
  queryClient.setQueryData<ProductBarcode[] | null>(BARCODES_KEY, (codes) => (codes ? change(codes) : codes));
  queryClient.invalidateQueries({ queryKey: BARCODES_KEY });
}

/**
 * Liga o código ao produto (o código que era de outro passa a ser deste: quem
 * chama pergunta antes). O produto juntado com outro em outro aparelho volta
 * com a frase de sempre, com os produtos já buscados de novo.
 */
export function useLinkBarcode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ gtin, productId }: { gtin: string; productId: string }) =>
      withFreshProducts(queryClient, ['products'], async () => {
        const { error } = await supabase
          .from('product_barcodes')
          .upsert({ gtin, product_id: productId, updated_at: new Date().toISOString() }, { onConflict: 'household_id,gtin' });
        if (error && notReady(error)) throw new Error(BARCODES_NOT_READY);
        if (error) throw error;
      }),
    onSuccess: (_data, { gtin, productId }) =>
      patchBarcodes(queryClient, (codes) => [...codes.filter((code) => code.gtin !== gtin), { gtin, product_id: productId }]),
  });
}

/** Desliga o código do produto. Só se ainda for dele: se outra pessoa o passou para outro produto, fica lá. */
export function useUnlinkBarcode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ gtin, productId }: { gtin: string; productId: string }) => {
      const { error } = await supabase.from('product_barcodes').delete().eq('gtin', gtin).eq('product_id', productId);
      if (error && notReady(error)) throw new Error(BARCODES_NOT_READY);
      if (error) throw error;
    },
    onSuccess: (_data, { gtin, productId }) =>
      patchBarcodes(queryClient, (codes) => codes.filter((code) => !(code.gtin === gtin && code.product_id === productId))),
  });
}

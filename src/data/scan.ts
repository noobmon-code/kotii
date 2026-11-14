// O "Escanear" da tela Hoje (domain/scan): a foto que a IA diz se é nota, produto ou prateleira, e os produtos
// achados indo para a despensa. A leitura passa pela função da nota (parse-receipt, com `classify`): a nota vira o
// rascunho de sempre, os produtos voltam para a tela conferir, e nada deles fica guardado no servidor.

import { FunctionsHttpError } from '@supabase/supabase-js';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { MAX_RECEIPT_PHOTOS } from '@/domain/receiptPhotos';
import { pantryRowsFromScan, parseScanReply, type ScanClassify, type ScanItem, type ScanReply } from '@/domain/scan';
import { supabase, unwrap } from '@/lib/supabase';

import { FunctionError, functionErrorDetails, removeImages, uploadImages } from './images';

const READ_FAILED = 'Não foi possível ler a foto. Tente novamente.';

export interface ScanPhotos {
  /** As fotos, em ordem (as partes de uma nota comprida, ou uma foto só). */
  uris: string[];
  /** `any`: pode ser nota ou produtos. `products`: só produtos (a nota não é lida). */
  classify: ScanClassify;
}

/**
 * Fotos -> envio -> a IA diz o que são. A nota lida guarda as fotos, como na leitura de sempre; produto,
 * prateleira ou nada, elas saem do armazenamento (a função também as apaga). O erro leva o código da função
 * (FunctionError): com o das fotos de produto no fim do mês, a tela mostra o aviso do limite.
 */
export async function scanPhotos(householdId: string | undefined, { uris, classify }: ScanPhotos): Promise<ScanReply> {
  if (!householdId) throw new Error('Família não carregada.');
  const paths = await uploadImages('receipts', householdId, uris.slice(0, MAX_RECEIPT_PHOTOS));
  const removeAll = () => removeImages('receipts', paths).catch(() => undefined);

  const { data, error } = await supabase.functions.invoke<unknown>('parse-receipt', { body: { image_paths: paths, classify } });
  if (error || !data) {
    // A função respondeu com erro: nada ficou dessas fotos. Em falha de rede o resultado é incerto (a nota pode
    // ter sido salva) e as fotos ficam, como na leitura da nota.
    if (error instanceof FunctionsHttpError) await removeAll();
    const { message, code } = await functionErrorDetails(error, READ_FAILED);
    throw new FunctionError(message, code);
  }
  const reply = parseScanReply(data);
  if (reply?.kind !== 'nota') await removeAll();
  if (!reply) throw new Error(READ_FAILED);
  return reply;
}

export function useScanPhotos(householdId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (photos: ScanPhotos) => scanPhotos(householdId, photos),
    onSettled: (reply) => {
      // A leitura gastou a cota (a de produto ou a de foto), também quando a foto não serviu.
      queryClient.invalidateQueries({ queryKey: ['aiUsage'] });
      if (reply?.kind === 'nota') {
        queryClient.invalidateQueries({ queryKey: ['receipts'] });
        queryClient.invalidateQueries({ queryKey: ['spending'] });
      }
    },
  });
}

/** O banco recusou a linha por causa do produto (juntado com outro em outro aparelho, e apagado). */
const isProductGone = (error: { code?: string; message?: string; details?: string } | null) =>
  error?.code === '23503' && `${error.message ?? ''} ${error.details ?? ''}`.includes('product');

/**
 * Os produtos achados vão para a despensa, todos de uma vez (ou nenhum). O produto que sumiu no meio do caminho
 * (juntado com outro em outro aparelho) não segura os outros: as linhas entram só com o nome.
 */
export async function saveScanToPantry(items: readonly ScanItem[], today: string): Promise<number> {
  const rows = pantryRowsFromScan(items, today);
  if (!rows.length) return 0;
  const first = await supabase.from('pantry_items').insert(rows);
  if (first.error && isProductGone(first.error)) {
    unwrap(await supabase.from('pantry_items').insert(rows.map((row) => ({ ...row, product_id: null }))));
  } else {
    unwrap(first);
  }
  return rows.length;
}

export function useSaveScanToPantry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ items, today }: { items: readonly ScanItem[]; today: string }) => saveScanToPantry(items, today),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pantry'] });
    },
  });
}

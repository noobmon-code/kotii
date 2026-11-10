// O que os "Primeiros passos" da tela Hoje (domain/firstSteps) precisam saber e a tela ainda não tem: se a casa já
// teve uma lista (também arquivada: a tela só lê as abertas) e se já tem uma nota (também confirmada: a tela só lê
// os rascunhos). Uma linha por pergunta, e só quando o que a tela já tem não responde (`enabled`). As chaves começam
// com 'lists' e 'receipts': criar, arquivar ou reabrir uma lista e criar, confirmar ou excluir uma nota já buscam de
// novo.
//
// O que a tela vê também responde (`seen`: uma lista aberta, um rascunho): o "sim" fica na resposta guardada, para
// ela não voltar a "não" sem o servidor dizer. Sem isso, a casa que teve um rascunho (confirmado em outro celular)
// e nenhuma lista lida ainda guardaria o "não" de antes, e o passo feito voltaria a aparecer por fazer.

import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect } from 'react';

import { supabase, unwrap } from '@/lib/supabase';

const ANY_LIST_KEY = ['lists', 'any'] as const;
const ANY_RECEIPT_KEY = ['receipts', 'any'] as const;

/** Guarda o "sim" que a tela viu (a troca de casa apaga a resposta junto com o resto). */
function useSeenAnswer(queryKey: QueryKey, seen: boolean) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (seen && queryClient.getQueryData<boolean>(queryKey) !== true) queryClient.setQueryData(queryKey, true);
  }, [seen, queryClient, queryKey]);
}

/** A casa já teve uma lista, aberta ou arquivada, de qualquer tipo. `seen`: a tela tem uma lista aberta. */
export function useAnyList(enabled: boolean, seen = false) {
  useSeenAnswer(ANY_LIST_KEY, seen);
  return useQuery({
    queryKey: ANY_LIST_KEY,
    enabled,
    queryFn: async () => (unwrap(await supabase.from('shopping_lists').select('id').limit(1)) as { id: string }[]).length > 0,
  });
}

/** A casa já tem uma nota, rascunho ou confirmada. `seen`: a tela tem um rascunho. */
export function useAnyReceipt(enabled: boolean, seen = false) {
  useSeenAnswer(ANY_RECEIPT_KEY, seen);
  return useQuery({
    queryKey: ANY_RECEIPT_KEY,
    enabled,
    queryFn: async () => (unwrap(await supabase.from('receipts').select('id').limit(1)) as { id: string }[]).length > 0,
  });
}

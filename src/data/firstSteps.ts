// O que os "Primeiros passos" da tela Hoje (domain/firstSteps) precisam saber e a tela ainda não tem: se a casa já
// teve uma lista (também arquivada: a tela só lê as abertas) e se já tem uma nota (também confirmada: a tela só lê
// os rascunhos). Uma linha por pergunta, e só quando o que a tela já tem não responde (`enabled`). As chaves começam
// com 'lists' e 'receipts': criar, arquivar ou reabrir uma lista e criar, confirmar ou excluir uma nota já buscam de
// novo.

import { useQuery } from '@tanstack/react-query';

import { supabase, unwrap } from '@/lib/supabase';

/** A casa já teve uma lista, aberta ou arquivada, de qualquer tipo. */
export function useAnyList(enabled: boolean) {
  return useQuery({
    queryKey: ['lists', 'any'],
    enabled,
    queryFn: async () => (unwrap(await supabase.from('shopping_lists').select('id').limit(1)) as { id: string }[]).length > 0,
  });
}

/** A casa já tem uma nota, rascunho ou confirmada. */
export function useAnyReceipt(enabled: boolean) {
  return useQuery({
    queryKey: ['receipts', 'any'],
    enabled,
    queryFn: async () => (unwrap(await supabase.from('receipts').select('id').limit(1)) as { id: string }[]).length > 0,
  });
}

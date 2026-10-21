// Notas pendentes (domain/pendingReceipts): a Sefaz pediu o "não sou robô" e a
// nota espera os prints. Ficam no aparelho, por pessoa (lib/pendingReceipts;
// cada pendente diz de que casa é): saindo do Kotii para abrir a Sefaz, o
// navegador pode recarregar o app, e a chave não se perde. No banco não entra nada até a leitura dos
// prints criar a nota de verdade (parse-receipt, com a chave do QR, como antes).
// A pendente que já virou nota na casa (pelos prints, pelo QR ou por outra
// pessoa) some sozinha: a busca de quais chaves a casa já tem começa com
// 'receipts', e toda gravação de nota a refaz.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo } from 'react';

import { pendingOfHousehold, pendingReceiptCnpj } from '@/domain/pendingReceipts';
import { useAuth, useHouseholdId } from '@/lib/auth';
import { dropPendingReceipts, readPendingReceipts, savePendingReceipt } from '@/lib/pendingReceipts';
import { supabase, unwrap } from '@/lib/supabase';

const pendingQueryKey = (userId: string | undefined) => ['pendingReceipts', userId] as const;

export interface PendingStatus {
  /** As chaves que já viraram nota na casa. */
  inHouse: string[];
  /** O nome do mercado da casa por CNPJ (o da chave), para a pendente não ficar sem nome. */
  stores: Record<string, string>;
}

/**
 * Quais pendentes a casa já tem como nota (a RLS só mostra as da casa aberta) e o nome dos mercados delas. Sem os
 * mercados (erro na busca), as pendentes aparecem sem nome; sem as notas, a busca falha e as pendentes aparecem
 * todas (nunca some uma que ainda não foi lida).
 */
export async function fetchPendingStatus(accessKeys: readonly string[]): Promise<PendingStatus> {
  if (!accessKeys.length) return { inHouse: [], stores: {} };
  const cnpjs = [...new Set(accessKeys.map(pendingReceiptCnpj))];
  const [receipts, stores] = await Promise.all([
    supabase.from('receipts').select('access_key').in('access_key', [...accessKeys]),
    supabase.from('stores').select('cnpj, name').in('cnpj', cnpjs),
  ]);
  const found = (unwrap(receipts) ?? []) as { access_key: string | null }[];
  const names: Record<string, string> = {};
  for (const store of (stores.error ? [] : (stores.data ?? [])) as { cnpj: string | null; name: string }[]) {
    if (store.cnpj && !names[store.cnpj]) names[store.cnpj] = store.name;
  }
  return { inHouse: found.flatMap((r) => (r.access_key ? [r.access_key] : [])), stores: names };
}

/**
 * As pendentes da casa aberta (as que ainda não viraram nota), o nome do mercado de cada uma (quando a casa o
 * conhece) e como guardar e descartar. `ready`: a lista do aparelho já foi lida.
 */
export function usePendingReceipts() {
  const userId = useAuth().session?.user.id;
  const householdId = useHouseholdId();
  const queryClient = useQueryClient();
  const stored = useQuery({
    queryKey: pendingQueryKey(userId),
    enabled: Boolean(userId),
    queryFn: () => readPendingReceipts(userId!),
  });
  const keys = useMemo(() => pendingOfHousehold(stored.data ?? [], householdId).map((p) => p.accessKey), [stored.data, householdId]);
  const status = useQuery({
    queryKey: ['receipts', 'pendingStatus', householdId, keys],
    enabled: Boolean(householdId) && keys.length > 0,
    queryFn: () => fetchPendingStatus(keys),
  });
  const inHouse = status.data?.inHouse;
  const pending = useMemo(
    () => pendingOfHousehold(stored.data ?? [], householdId, new Set(inHouse ?? [])),
    [stored.data, householdId, inHouse],
  );

  // A que já virou nota sai do aparelho também (a lista já não a mostra). Só com a busca feita agora: a guardada
  // de antes pode ter a nota que alguém apagou depois, e a pendente nova da mesma chave sairia junto.
  const freshInHouse = status.isFetchedAfterMount && !status.isFetching ? inHouse : undefined;
  useEffect(() => {
    if (!userId || !householdId || !freshInHouse?.length) return;
    dropPendingReceipts(userId, householdId, freshInHouse).then(
      (next) => queryClient.setQueryData(pendingQueryKey(userId), next),
      () => undefined,
    );
  }, [freshInHouse, userId, householdId, queryClient]);

  /** Guarda a nota do QR como pendente; false se não deu (sem conta, sem casa ou sem armazenamento). */
  const save = useCallback(
    async (qr: { accessKey: string; url: string | null }): Promise<boolean> => {
      if (!userId || !householdId) return false;
      try {
        const next = await savePendingReceipt(userId, { ...qr, householdId, savedAt: new Date().toISOString() });
        queryClient.setQueryData(pendingQueryKey(userId), next);
        return true;
      } catch {
        return false;
      }
    },
    [userId, householdId, queryClient],
  );

  const discard = useCallback(
    async (accessKey: string): Promise<void> => {
      if (!userId || !householdId) return;
      const next = await dropPendingReceipts(userId, householdId, [accessKey]);
      queryClient.setQueryData(pendingQueryKey(userId), next);
    },
    [userId, householdId, queryClient],
  );

  return {
    pending,
    storeNames: status.data?.stores ?? {},
    // Sem a casa aberta ainda não se sabe quais são as dela.
    ready: !userId || (stored.isSuccess && Boolean(householdId)),
    save,
    discard,
  };
}

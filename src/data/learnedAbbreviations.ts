// As abreviações que a casa ensinou com as notas confirmadas (domain/learnedAbbreviations): os apelidos
// (product_aliases: a descrição da nota -> o produto) com o nome que a casa deu a cada produto.

import { onlineManager, type QueryClient, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { learnAbbreviations, NO_LEARNED, type LearnedAbbreviations } from '@/domain/learnedAbbreviations';
import { supabase, unwrap } from '@/lib/supabase';
import type { Product } from '@/lib/types';
import { fetchProducts, useProducts } from './market';

interface AliasRow {
  alias: string;
  product_id: string;
}

/** Os apelidos mais novos: as notas de agora dizem como os mercados de agora abreviam, e a conta fica leve. */
const ALIAS_LIMIT = 2000;

const ALIASES_KEY = ['productAliases'];
const ALIASES_STALE_MS = 10 * 60 * 1000;

const fetchProductAliases = async () =>
  (unwrap(
    await supabase.from('product_aliases').select('alias, product_id').order('created_at', { ascending: false }).limit(ALIAS_LIMIT),
  ) ?? []) as AliasRow[];

/** O que os apelidos e os produtos ensinam; o apelido de um produto que não está no catálogo fica de fora. */
function learnedFrom(aliases: readonly AliasRow[], products: readonly Pick<Product, 'id' | 'name'>[]): LearnedAbbreviations {
  const names = new Map(products.map((product) => [product.id, product.name]));
  const pairs = aliases.flatMap((row) => {
    const productName = names.get(row.product_id);
    return productName && typeof row.alias === 'string' ? [{ description: row.alias, productName }] : [];
  });
  return learnAbbreviations(pairs, [...names.values()]);
}

/**
 * As abreviações aprendidas, para a revisão da nota e a despensa. Enquanto os apelidos ou os produtos não chegam
 * (ou sem internet, ou se a leitura falhar), nada aprendido: as regras de sempre continuam valendo, sem aviso.
 */
export function useLearnedAbbreviations(): LearnedAbbreviations {
  // Os apelidos só mudam quando uma nota é confirmada, e a confirmação já pede de novo (useConfirmReceipt): a
  // lista aberta no mercado não lê tudo outra vez a cada volta para a tela.
  const aliases = useQuery({ queryKey: ALIASES_KEY, queryFn: fetchProductAliases, staleTime: ALIASES_STALE_MS });
  const products = useProducts();
  return useMemo(
    () => (aliases.data && products.data ? learnedFrom(aliases.data, products.data) : NO_LEARNED),
    [aliases.data, products.data],
  );
}

/** As abreviações aprendidas para quem não é tela (a leitura do QR code); nada aprendido se a leitura falhar. */
export async function loadLearnedAbbreviations(queryClient: QueryClient): Promise<LearnedAbbreviations> {
  // Sem internet a busca ficaria parada esperando a conexão: fica com o que estiver guardado.
  if (!onlineManager.isOnline()) {
    const aliases = queryClient.getQueryData<AliasRow[]>(ALIASES_KEY);
    const products = queryClient.getQueryData<Product[]>(['products']);
    return aliases && products ? learnedFrom(aliases, products) : NO_LEARNED;
  }
  try {
    const [aliases, products] = await Promise.all([
      queryClient.ensureQueryData({ queryKey: ALIASES_KEY, queryFn: fetchProductAliases }),
      queryClient.ensureQueryData({ queryKey: ['products'], queryFn: fetchProducts }),
    ]);
    return learnedFrom(aliases, products);
  } catch {
    return NO_LEARNED;
  }
}

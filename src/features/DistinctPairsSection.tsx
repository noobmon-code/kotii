import { useQueryClient } from '@tanstack/react-query';
import { useRef, type RefObject } from 'react';
import type { View } from 'react-native';

import { useProducts } from '@/data/market';
import { useDistinctPairs, useUndoDistinct } from '@/data/productMerge';
import {
  DISTINCT_TITLE,
  DISTINCT_UNDO_GONE,
  DISTINCT_UNDO_GONE_TITLE,
  DISTINCT_UNDONE,
  distinctFrom,
  distinctIntro,
  UNDO_DISTINCT,
  UNDO_DISTINCT_FAILED_TITLE,
  undoDistinctLabel,
} from '@/domain/productMerge';
import type { ProductName } from '@/domain/similarNames';
import { errorMessage } from '@/lib/supabase';
import { useAnnounce } from '@/ui/announce';
import { notify } from '@/ui/dialogs';
import { moveFocus } from '@/ui/focus';
import { Button, CategoryIcon, ListCard, ListRow, Section, Text } from '@/ui/primitives';

/**
 * "Marcados como diferentes", na tela de um produto: os produtos que a casa disse não serem o mesmo que este, cada
 * um com "Desfazer". Só aparece com os pares carregados e pelo menos um par deste produto cujo outro produto está
 * no catálogo (distinctFrom): enquanto carrega, sem a tabela, sem internet e sem nada guardado, ou sem par, nada.
 *
 * Desfazer não pergunta antes: não apaga dado nenhum, e a sugestão pode ser recusada de novo no cartão de cima.
 * A linha sai na hora, o foco vai para o próximo "Desfazer" (o anterior, quando era a última; "Juntar com outro
 * produto", `afterLast`, quando não sobra nenhuma) e o leitor de tela ouve DISTINCT_UNDONE.
 */
export function DistinctPairsSection({ product, afterLast }: { product: ProductName; afterLast: RefObject<View | null> }) {
  const queryClient = useQueryClient();
  const products = useProducts();
  const pairs = useDistinctPairs();
  const undo = useUndoDistinct();
  // A região do navegador fica fora da seção: quando a última linha sai, a seção some, e o anúncio não pode ir junto.
  const { announce, clear, region } = useAnnounce('distinct-undone-region');
  // O botão de cada linha, para levar o foco ao vizinho depois de desfazer.
  const buttons = useRef(new Map<string, View | null>());
  const others = distinctFrom(product.id, pairs.data, products.data);

  const rowRef = (id: string) => (node: View | null) => {
    if (node) buttons.current.set(id, node);
    else buttons.current.delete(id);
  };

  async function undoPair(other: ProductName) {
    clear();
    const at = others.findIndex((o) => o.id === other.id);
    const neighbour = others[at + 1] ?? others[at - 1] ?? null;
    try {
      const rows = await undo.mutateAsync({ a: product.id, b: other.id });
      if (rows.length) {
        // O vizinho é lido no quadro seguinte, quando a linha desfeita já saiu da tela.
        moveFocus(neighbour ? { get current() { return buttons.current.get(neighbour.id) ?? null; } } : afterLast);
        announce(DISTINCT_UNDONE);
      } else {
        notify(DISTINCT_UNDO_GONE_TITLE, DISTINCT_UNDO_GONE);
        // Um dos dois pode ter sido juntado ou excluído: a lista de produtos da tela ficou velha.
        queryClient.invalidateQueries({ queryKey: ['products'] });
      }
    } catch (err) {
      notify(UNDO_DISTINCT_FAILED_TITLE, errorMessage(err));
    }
  }

  return (
    <>
      {others.length ? (
        <Section title={DISTINCT_TITLE}>
          <Text variant="muted">{distinctIntro(product.name)}</Text>
          <ListCard>
            {others.map((other) => (
              <ListRow
                key={other.id}
                left={<CategoryIcon category={other.category} name={other.name} size={32} />}
                title={other.name}
                right={
                  <Button
                    ref={rowRef(other.id)}
                    title={UNDO_DISTINCT}
                    variant="secondary"
                    compact
                    accessibilityLabel={undoDistinctLabel(product.name, other.name)}
                    loading={undo.isPending && undo.variables?.b === other.id}
                    disabled={undo.isPending}
                    onPress={() => void undoPair(other)}
                  />
                }
              />
            ))}
          </ListCard>
        </Section>
      ) : null}
      {region}
    </>
  );
}

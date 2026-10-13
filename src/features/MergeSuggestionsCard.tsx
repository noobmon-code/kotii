import { Fragment, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { mergeErrorNotice, useMarkDistinct } from '@/data/productMerge';
import { distinctLabel, joinLabel, purchasesLabel, type MergeSuggestion } from '@/domain/productMerge';
import type { ProductName } from '@/domain/similarNames';
import { notify } from '@/ui/dialogs';
import { Button, Card, CategoryIcon, IconBadge, Row, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

import { MergeProductsModal } from './MergeProductsModal';
import { useMergeSuggestions } from './useProductMerge';

/**
 * "Parecem o mesmo produto": pares de produtos da casa com nomes que as regras
 * dos nomes parecidos tratam como o mesmo. O app só sugere: "Juntar" abre a
 * confirmação e "São diferentes" guarda a resposta para a casa toda. Não
 * aparece sem sugestão (nem antes de o banco guardar o "São diferentes").
 * Com `productId`, só as sugestões desse produto.
 */
export function MergeSuggestionsCard({ productId, onMerged }: { productId?: string; onMerged: (keptId: string) => void }) {
  const c = useColors();
  const { suggestions, purchases } = useMergeSuggestions(productId);
  const markDistinct = useMarkDistinct();
  const [merging, setMerging] = useState<MergeSuggestion | null>(null);

  const product = ({ id, name, category }: ProductName) => (
    <Row gap={space.md}>
      <CategoryIcon category={category} name={name} size={32} />
      <View style={styles.flex}>
        <Text variant="body" numberOfLines={2}>
          {name}
        </Text>
        <Text variant="muted">{purchasesLabel(purchases[id] ?? 0)}</Text>
      </View>
    </Row>
  );

  return (
    <>
      {suggestions.length ? (
        <Card style={styles.card}>
          <Row gap={space.md}>
            <IconBadge icon="call-merge" tone="info" size={36} />
            <View style={styles.flex}>
              <Text variant="label">Parecem o mesmo produto</Text>
              <Text variant="muted">Juntando, as compras e os preços dos dois ficam num produto só. Você decide.</Text>
            </View>
          </Row>
          {suggestions.map((suggestion) => {
            const { keep, other } = suggestion;
            const marking = markDistinct.isPending && markDistinct.variables?.a === keep.id && markDistinct.variables?.b === other.id;
            return (
              <Fragment key={`${keep.id} ${other.id}`}>
                <View style={[styles.divider, { backgroundColor: c.border }]} />
                {product(keep)}
                {product(other)}
                <Row>
                  <Button
                    title="Juntar"
                    accessibilityLabel={joinLabel(keep.name, other.name)}
                    icon="call-merge"
                    compact
                    style={styles.flex}
                    disabled={marking}
                    onPress={() => setMerging(suggestion)}
                  />
                  <Button
                    title="São diferentes"
                    accessibilityLabel={distinctLabel(keep.name, other.name)}
                    variant="secondary"
                    compact
                    style={styles.flex}
                    loading={marking}
                    disabled={markDistinct.isPending}
                    onPress={() =>
                      markDistinct.mutate(
                        { a: keep.id, b: other.id },
                        {
                          onError: (error) => {
                            const { title, message } = mergeErrorNotice(error);
                            notify(title, message);
                          },
                        },
                      )
                    }
                  />
                </Row>
              </Fragment>
            );
          })}
        </Card>
      ) : null}
      {merging ? (
        <MergeProductsModal
          opened={merging.keep}
          other={merging.other}
          onClose={() => setMerging(null)}
          onMerged={(keptId) => {
            setMerging(null);
            onMerged(keptId);
          }}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: space.md },
  divider: { height: StyleSheet.hairlineWidth },
});

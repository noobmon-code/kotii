// Lista no mercado: quanto a lista deve dar (pelo último preço pago, ou pelos
// preços do mercado em que a pessoa está) e o que está na despensa.

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  cartSplitLine,
  describeEstimate,
  describePantryHits,
  estimateHeadline,
  storeOptionNote,
  type ListEstimate,
} from '@/domain/listEstimate';
import { formatBRL } from '@/domain/money';
import type { ListKind } from '@/lib/types';
import { PickerModal } from '@/ui/PickerModal';
import { Button, Card, Chip, Icon, IconBadge, Row, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

export function ListEstimateCard({
  estimate,
  kind,
  storeId,
  storeNames,
  onChangeStore,
  inPantry,
}: {
  estimate: ListEstimate;
  /** Lista de farmácia fala em farmácia, não em mercado. */
  kind: ListKind;
  /** O mercado em que a pessoa está; null: qualquer um (último preço pago). */
  storeId: string | null;
  /** Os nomes dos mercados; sem eles (ainda não carregaram), não há como dizer onde se está. */
  storeNames?: ReadonlyMap<string, string>;
  onChangeStore: (storeId: string | null) => void;
  /** Nomes dos itens a comprar que estão na despensa. */
  inPantry: string[];
}) {
  const [choosing, setChoosing] = useState(false);
  const priced = estimate.pricedCount > 0;
  if (!priced && !inPantry.length) return null;
  const cartSplit = cartSplitLine(estimate);
  const storeName = storeId ? storeNames?.get(storeId) : undefined;
  const place = kind === 'farmacia' ? 'farmácia' : 'mercado';

  return (
    <Card style={styles.card}>
      {priced ? (
        <>
          <Row gap={space.md}>
            <IconBadge icon="cash-multiple" tone="primary" />
            <View style={styles.flex}>
              <Text variant="small">{estimateHeadline(estimate)}</Text>
              <Text variant="heading">{`~${formatBRL(estimate.total)}`}</Text>
            </View>
          </Row>
          <Text variant="muted">{describeEstimate(estimate, storeName ?? null)}</Text>
          {cartSplit ? <Text variant="muted">{cartSplit}</Text> : null}
          {storeNames ? (
            <Row style={styles.wrap}>
              <Chip
                label={storeName ? `Onde estou: ${storeName}` : 'Onde você está comprando?'}
                icon="store-outline"
                selected={Boolean(storeName)}
                onPress={() => setChoosing(true)}
              />
            </Row>
          ) : null}
        </>
      ) : null}
      {inPantry.length ? (
        <Row gap={space.sm} style={styles.top}>
          <Icon name="fridge-outline" color="primary" />
          <Text variant="muted" style={styles.flex}>
            {describePantryHits(inPantry)}
          </Text>
        </Row>
      ) : null}

      {storeNames ? (
        <PickerModal
          visible={choosing}
          title="Onde você está comprando?"
          placeholder={`Buscar ${place}`}
          options={estimate.stores
            .flatMap((store) => {
              const title = storeNames.get(store.storeId);
              return title ? [{ id: store.storeId, title, known: store.knownCount, subtitle: storeOptionNote(store.knownCount) }] : [];
            })
            // Quem tem preço para mais itens da lista primeiro; no empate (os sem nenhum, por exemplo), pelo nome.
            .sort((a, b) => b.known - a.known || a.title.localeCompare(b.title, 'pt-BR'))}
          onClose={() => setChoosing(false)}
          onSelect={(id) => {
            onChangeStore(id);
            setChoosing(false);
          }}
          extraActions={() =>
            storeId ? (
              <Button
                title={`Qualquer ${place} (último preço pago)`}
                icon="store-off-outline"
                variant="ghost"
                compact
                onPress={() => {
                  onChangeStore(null);
                  setChoosing(false);
                }}
              />
            ) : null
          }
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: space.sm },
  wrap: { flexWrap: 'wrap' },
  top: { alignItems: 'flex-start' },
});

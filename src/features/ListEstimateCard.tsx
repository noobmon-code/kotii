// Lista no mercado: quanto a lista deve dar (pelo último preço pago, ou pelos
// preços do mercado em que a pessoa está) e o que já tem na despensa.

import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { joinNames } from '@/domain/cartPantry';
import { describeEstimate, type ListEstimate } from '@/domain/listEstimate';
import { formatBRL } from '@/domain/money';
import { PickerModal } from '@/ui/PickerModal';
import { Button, Card, Chip, Icon, IconBadge, Row, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

export function ListEstimateCard({
  estimate,
  storeId,
  storeName,
  onChangeStore,
  inPantry,
}: {
  estimate: ListEstimate;
  /** O mercado em que a pessoa está; null: qualquer um (último preço pago). */
  storeId: string | null;
  storeName: (storeId: string) => string;
  onChangeStore: (storeId: string | null) => void;
  /** Nomes dos itens a comprar que já estão na despensa. */
  inPantry: string[];
}) {
  const [choosing, setChoosing] = useState(false);
  const priced = estimate.pricedCount > 0;
  if (!priced && !inPantry.length) return null;
  const shopping = estimate.cartTotal > 0 && estimate.pendingTotal > 0;

  return (
    <Card style={styles.card}>
      {priced ? (
        <>
          <Row gap={space.md}>
            <IconBadge icon="cash-multiple" tone="primary" />
            <View style={styles.flex}>
              <Text variant="small">A lista deve dar</Text>
              <Text variant="heading">{`~${formatBRL(estimate.total)}`}</Text>
            </View>
          </Row>
          <Text variant="muted">{describeEstimate(estimate, storeId ? storeName(storeId) : null)}</Text>
          {shopping ? (
            <Text variant="muted">
              {`No carrinho: ~${formatBRL(estimate.cartTotal)}. Falta comprar: ~${formatBRL(estimate.pendingTotal)}.`}
            </Text>
          ) : null}
          <Row style={styles.wrap}>
            <Chip
              label={storeId ? `Estou no ${storeName(storeId)}` : 'Em qual mercado você está?'}
              icon="store-outline"
              selected={Boolean(storeId)}
              onPress={() => setChoosing(true)}
            />
          </Row>
        </>
      ) : null}
      {inPantry.length ? (
        <Row gap={space.sm} style={styles.top}>
          <Icon name="fridge-outline" color="primary" />
          <Text variant="muted" style={styles.flex}>
            {`Já tem em casa: ${joinNames(inPantry)}. Confira a despensa antes de comprar de novo.`}
          </Text>
        </Row>
      ) : null}

      <PickerModal
        visible={choosing}
        title="Em qual mercado você está?"
        placeholder="Buscar mercado"
        options={estimate.stores.map((store) => ({
          id: store.storeId,
          title: storeName(store.storeId),
          subtitle: `${store.knownCount} ${store.knownCount === 1 ? 'item da lista com preço' : 'itens da lista com preço'}`,
        }))}
        onClose={() => setChoosing(false)}
        onSelect={(id) => {
          onChangeStore(id);
          setChoosing(false);
        }}
        extraActions={() =>
          storeId ? (
            <Button
              title="Qualquer mercado (último preço pago)"
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
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: space.sm },
  wrap: { flexWrap: 'wrap' },
  top: { alignItems: 'flex-start' },
});

// Lista no mercado: quanto a lista deve dar (pelo último preço pago, ou pelos
// preços do mercado em que a pessoa está, com os de outras casas onde a casa
// não tem preço) e o que está na despensa. Antes da lista, recolhido numa
// linha (o total e o "i"); o "i" abre o resto ali mesmo.
//
// O aberto e a escolha do lugar ficam com a tela, e a escolha (StorePicker) é
// desenhada por ela fora das colunas do computador (ui/desktop): o que está
// aberto não depende de como as colunas se arrumam em cada largura, e a janela
// do navegador que cruza a largura do computador não recolhe o cartão nem
// apaga a busca digitada na escolha aberta.

import { Platform, StyleSheet, View } from 'react-native';

import {
  cartSplitLine,
  describeEstimate,
  describePantryHits,
  ESTIMATE_MORE_LABEL,
  estimateHeadline,
  estimateMarker,
  estimateShortLine,
  storeOptionNote,
  uncheckedPricesNote,
  type ListEstimate,
} from '@/domain/listEstimate';
import { formatBRL } from '@/domain/money';
import { SHARED_PRICES_NOTICE } from '@/domain/sharedPrices';
import type { ListKind } from '@/lib/types';
import { PickerModal } from '@/ui/PickerModal';
import { Button, Card, Chip, Icon, IconBadge, IconButton, Row, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

// Como buscar de novo o que não chegou. No navegador não existe puxar para atualizar: lá é recarregar a página.
const RETRY_HINT = Platform.OS === 'web' ? 'Recarregue a página para tentar de novo.' : 'Puxe a lista para baixo para tentar de novo.';

export function ListEstimateCard({
  estimate,
  storeId,
  storeNames,
  sourcesLoaded,
  inPantry,
  open,
  onToggle,
  onChooseStore,
}: {
  estimate: ListEstimate;
  /** O mercado em que a pessoa está; null: qualquer um (último preço pago). */
  storeId: string | null;
  /** Os nomes dos mercados; sem eles (ainda não carregaram), não há como dizer onde se está. */
  storeNames?: ReadonlyMap<string, string>;
  /** false: as ligações ou os produtos não chegaram, e item sem preço pode ser só item que não deu para conferir. */
  sourcesLoaded: boolean;
  /** Nomes dos itens a comprar que estão na despensa. */
  inPantry: string[];
  /** Aberto pelo "i": recolhido ao abrir a lista (só na memória, como o resto da tela). */
  open: boolean;
  onToggle: () => void;
  /** O chip "Onde estou" abre a escolha do lugar (StorePicker, desenhada pela tela). */
  onChooseStore: () => void;
}) {
  const priced = estimate.pricedCount > 0;
  const unchecked = uncheckedPricesNote(estimate, sourcesLoaded);
  // Sem conta e sem nada na despensa, o cartão só aparece para dizer que não deu para conferir os preços.
  if (!priced && !inPantry.length && !unchecked) return null;
  const cartSplit = cartSplitLine(estimate);
  const storeName = storeId ? storeNames?.get(storeId) : undefined;
  // Recolhido, o total diz o lugar escolhido e que há preço de outras casas nele: aberto, a frase de baixo já diz.
  const marker = open ? null : estimateMarker(estimate, storeName ?? null);
  const more = <IconButton icon="information-outline" label={ESTIMATE_MORE_LABEL} color="primary" expanded={open} onPress={onToggle} />;

  return (
    <Card style={styles.card}>
      {priced ? (
        <Row gap={space.md}>
          <IconBadge icon="cash-multiple" tone="primary" />
          <View style={styles.flex}>
            <Text variant="small">{estimateHeadline(estimate)}</Text>
            <Text variant="heading">{`~${formatBRL(estimate.total)}`}</Text>
            {marker ? <Text variant="small">{marker}</Text> : null}
          </View>
          {more}
        </Row>
      ) : (
        // Nenhum item com preço: a linha diz, curto, o que o cartão tem (os preços que não deu para conferir, a despensa).
        <Row gap={space.md}>
          <IconBadge icon={unchecked ? 'cash-multiple' : 'fridge-outline'} tone={unchecked ? 'neutral' : 'primary'} />
          <Text variant="muted" style={styles.flex}>
            {estimateShortLine({ unchecked: Boolean(unchecked), inPantry })}
          </Text>
          {more}
        </Row>
      )}
      {open ? (
        <>
          {priced ? <Text variant="muted">{describeEstimate(estimate, storeName ?? null)}</Text> : null}
          {/* Parte da conta é de preços vistos em outras casas: sempre com o aviso de que não são em tempo real. */}
          {priced && estimate.sharedCount ? <Text variant="small">{SHARED_PRICES_NOTICE}</Text> : null}
          {unchecked ? <Text variant="muted">{`${unchecked} ${RETRY_HINT}`}</Text> : null}
          {priced && cartSplit ? <Text variant="muted">{cartSplit}</Text> : null}
          {priced && storeNames ? (
            <Row style={styles.wrap}>
              <Chip
                label={storeName ? `Onde estou: ${storeName}` : 'Onde você está comprando?'}
                icon="store-outline"
                selected={Boolean(storeName)}
                onPress={onChooseStore}
              />
            </Row>
          ) : null}
          {inPantry.length ? (
            <Row gap={space.sm} style={styles.top}>
              <Icon name="fridge-outline" color="primary" />
              <Text variant="muted" style={styles.flex}>
                {describePantryHits(inPantry)}
              </Text>
            </Row>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

/** "Onde você está comprando?": a escolha do lugar que o chip do cartão da conta abre. */
export function StorePicker({
  estimate,
  kind,
  storeId,
  storeNames,
  visible,
  onChangeStore,
  onClose,
}: {
  estimate: ListEstimate;
  /** Lista de farmácia fala em farmácia, não em mercado. */
  kind: ListKind;
  storeId: string | null;
  /** Sem os nomes dos mercados (ainda não carregaram), não há o que escolher. */
  storeNames?: ReadonlyMap<string, string>;
  visible: boolean;
  onChangeStore: (storeId: string | null) => void;
  onClose: () => void;
}) {
  if (!storeNames) return null;
  const place = kind === 'farmacia' ? 'farmácia' : 'mercado';
  return (
    <PickerModal
      visible={visible}
      title="Onde você está comprando?"
      placeholder={`Buscar ${place}`}
      options={estimate.stores
        .flatMap((store) => {
          const title = storeNames.get(store.storeId);
          return title ? [{ id: store.storeId, title, known: store.knownCount, subtitle: storeOptionNote(store.knownCount) }] : [];
        })
        // Quem tem preço para mais itens da lista primeiro; no empate (os sem nenhum, por exemplo), pelo nome.
        .sort((a, b) => b.known - a.known || a.title.localeCompare(b.title, 'pt-BR'))}
      onClose={onClose}
      onSelect={(id) => {
        onChangeStore(id);
        onClose();
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
              onClose();
            }}
          />
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: space.sm },
  wrap: { flexWrap: 'wrap' },
  top: { alignItems: 'flex-start' },
});

import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { useLatestPrices, useProductPurchases, useProducts, useRenameProduct, useStorePrices, useStores } from '@/data/market';
import { CATEGORIES, getCategory } from '@/domain/categories';
import { formatShortDate, toISODate } from '@/domain/dates';
import { formatBRL } from '@/domain/money';
import { noStorePriceSentence } from '@/domain/priceHistory';
import {
  NO_SAVED_PRICES_ERROR,
  NO_SAVED_PRICES_OFFLINE,
  SAVED_PRICES_ERROR,
  SAVED_PRICES_OFFLINE,
  storePricesView,
} from '@/domain/storePrices';
import { StaleNotice } from '@/features/health/StaleNotice';
import { PriceHistorySection } from '@/features/market/PriceHistorySection';
import { MergeProductsModal } from '@/features/MergeProductsModal';
import { MergeSuggestionsCard } from '@/features/MergeSuggestionsCard';
import { SharedPricesSection } from '@/features/SharedPrices';
import { errorMessage } from '@/lib/supabase';
import { notify } from '@/ui/dialogs';
import { PickerModal } from '@/ui/PickerModal';
import {
  Badge,
  Button,
  Card,
  CategoryIcon,
  Chip,
  ErrorNotice,
  IconBadge,
  ListCard,
  ListRow,
  Loading,
  Row,
  Screen,
  Section,
  Text,
  TextField,
} from '@/ui/primitives';
import { space } from '@/ui/theme';

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // O produto e os mercados ficam guardados no aparelho (lib/queryClient, PERSISTED): sem internet, a tela abre.
  const products = useProducts();
  const stores = useStores();
  // As compras inteiras, as mesmas que a seção do histórico lê (a mesma busca, uma vez só): a nota sem mercado
  // não entra no "por mercado", e a frase de lá não pode dizer que não há nota nenhuma.
  const purchases = useProductPurchases(id);
  // O último preço de cada mercado, das mesmas compras (todas, não só as mais recentes).
  const fromHistory = useStorePrices(id);
  // Os últimos preços da casa, guardados no aparelho: o que a lista mostra sem internet, ou com a busca que falhou.
  const saved = useLatestPrices();
  const rename = useRenameProduct();
  const [name, setName] = useState<string | null>(null);
  const [pickingCategory, setPickingCategory] = useState(false);
  const [joining, setJoining] = useState(false);

  // Sem internet e sem o produto ou os mercados no aparelho, a busca fica parada (e segue sozinha quando a
  // conexão volta): um aviso, em vez de girar sem fim. Com eles guardados, a tela abre com o que há.
  if ([products, stores].some((query) => query.data === undefined && query.fetchStatus === 'paused')) {
    return <ErrorNotice error={{ message: 'Sem internet: os preços deste produto aparecem quando a conexão voltar.' }} />;
  }
  // Uma atualização que falhou não troca o que já está na tela por um erro de tela cheia.
  if (products.data === undefined || stores.data === undefined) {
    const error = products.error ?? stores.error;
    return error ? <ErrorNotice error={error} /> : <Loading />;
  }
  const product = products.data.find((p) => p.id === id);
  if (!product) return <ErrorNotice error={{ message: 'Produto não encontrado.' }} />;

  const byStore = storePricesView(
    { data: fromHistory.data, paused: fromHistory.fetchStatus === 'paused', failed: fromHistory.isError },
    saved.data,
    product.id,
  );
  const storeName = (storeId: string) => stores.data.find((s) => s.id === storeId)?.name ?? 'Mercado';

  function save(category = product!.category) {
    const newName = (name ?? product!.name).trim();
    if (!newName) return;
    rename.mutate(
      { id: product!.id, name: newName, category },
      { onSuccess: () => setName(null), onError: (err) => notify('Erro', errorMessage(err)) },
    );
  }

  // Juntou: se o nome que ficou foi o do outro produto, este deixou de existir e a tela passa a ser a dele.
  function onMerged(keptId: string) {
    setJoining(false);
    if (keptId !== id) router.replace({ pathname: '/produto/[id]', params: { id: keptId } });
  }

  const offline = byStore.source === 'saved-offline';
  const prices = byStore.prices;

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: product.name }} />
      <Card style={styles.gap}>
        <Row>
          <CategoryIcon category={product.category} name={product.name} size={48} />
          <Chip label={getCategory(product.category).label} icon="tag-outline" onPress={() => setPickingCategory(true)} />
        </Row>
        <TextField label="Nome do produto" value={name ?? product.name} onChangeText={setName} onSubmitEditing={() => save()} />
        {name != null && name !== product.name ? (
          <Button title="Salvar nome" compact onPress={() => save()} loading={rename.isPending} />
        ) : null}
        {product.shelf_life_days ? (
          <Text variant="small">Validade aprendida: {product.shelf_life_days} dias após a compra.</Text>
        ) : null}
      </Card>

      <MergeSuggestionsCard productId={product.id} onMerged={onMerged} />

      <Section title="Último preço por mercado">
        {prices === undefined ? (
          <Loading />
        ) : prices.length === 0 ? (
          // Sem o histórico, a frase de sempre diria "nenhum preço ainda" sobre o que só não se sabe agora.
          <Text variant="muted">
            {byStore.source === 'history' ? noStorePriceSentence(purchases.data) : offline ? NO_SAVED_PRICES_OFFLINE : NO_SAVED_PRICES_ERROR}
          </Text>
        ) : (
          <>
            {byStore.source !== 'history' ? <StaleNotice message={offline ? SAVED_PRICES_OFFLINE : SAVED_PRICES_ERROR} /> : null}
            <ListCard>
              {prices.map((price, index) => (
                <ListRow
                  key={price.storeId}
                  left={<IconBadge icon="store-outline" tone={index === 0 ? 'primary' : 'neutral'} />}
                  title={storeName(price.storeId)}
                  subtitle={`em ${formatShortDate(toISODate(new Date(price.purchasedAt)))}`}
                  right={
                    <Row>
                      {index === 0 && prices.length > 1 ? <Badge label="Mais barato" tone="primary" /> : null}
                      <Text variant="label">
                        {formatBRL(price.unitPrice)}/{price.unit}
                      </Text>
                    </Row>
                  }
                />
              ))}
            </ListCard>
          </>
        )}
      </Section>

      <SharedPricesSection productId={product.id} />

      <PriceHistorySection productId={product.id} productName={product.name} />

      <Button title="Juntar com outro produto" icon="call-merge" variant="secondary" onPress={() => setJoining(true)} />

      {joining ? <MergeProductsModal opened={product} onClose={() => setJoining(false)} onMerged={onMerged} /> : null}

      <PickerModal
        visible={pickingCategory}
        title="Categoria"
        options={CATEGORIES.map((cat) => ({ id: cat.key, title: cat.label, left: <CategoryIcon category={cat.key} size={32} /> }))}
        onClose={() => setPickingCategory(false)}
        onSelect={(category) => {
          setPickingCategory(false);
          save(category);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { gap: space.md },
});

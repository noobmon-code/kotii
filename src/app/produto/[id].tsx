import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { usePriceHistory, useProductPurchases, useProducts, useRenameProduct, useStores } from '@/data/market';
import { CATEGORIES, getCategory } from '@/domain/categories';
import { formatShortDate, toISODate } from '@/domain/dates';
import { formatBRL } from '@/domain/money';
import { noStorePriceSentence } from '@/domain/priceHistory';
import { PriceHistorySection } from '@/features/market/PriceHistorySection';
import { MergeProductsModal } from '@/features/MergeProductsModal';
import { MergeSuggestionsCard } from '@/features/MergeSuggestionsCard';
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
  const products = useProducts();
  const history = usePriceHistory(id);
  // As compras inteiras, as mesmas que a seção do histórico lê (a mesma busca, uma vez só): a nota sem mercado
  // não entra no "por mercado", e a frase de lá não pode dizer que não há nota nenhuma.
  const purchases = useProductPurchases(id);
  const stores = useStores();
  const rename = useRenameProduct();
  const [name, setName] = useState<string | null>(null);
  const [pickingCategory, setPickingCategory] = useState(false);
  const [joining, setJoining] = useState(false);

  const product = products.data?.find((p) => p.id === id);

  // Histórico vem do mais recente ao mais antigo: o primeiro de cada loja é o atual.
  const latest = new Map<string, NonNullable<typeof history.data>[number]>();
  for (const obs of history.data ?? []) if (!latest.has(obs.store_id)) latest.set(obs.store_id, obs);
  const latestByStore = [...latest.values()].sort((a, b) => a.unit_price - b.unit_price);

  // Sem internet, o que não está guardado no aparelho fica com a busca parada (e ela segue sozinha quando a
  // conexão volta): um aviso, em vez de girar sem fim.
  if ([products, history, stores].some((query) => query.isPending && query.fetchStatus === 'paused')) {
    return <ErrorNotice error={{ message: 'Sem internet: os preços deste produto aparecem quando a conexão voltar.' }} />;
  }
  if (products.isPending || history.isPending || stores.isPending) return <Loading />;
  const error = products.error ?? history.error ?? stores.error;
  if (error) return <ErrorNotice error={error} />;
  if (!product) return <ErrorNotice error={{ message: 'Produto não encontrado.' }} />;

  const storeName = (storeId: string) => stores.data?.find((s) => s.id === storeId)?.name ?? 'Mercado';

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
        {latestByStore.length === 0 ? (
          <Text variant="muted">{noStorePriceSentence(purchases.data)}</Text>
        ) : (
          <ListCard>
            {latestByStore.map((obs, index) => (
              <ListRow
                key={obs.store_id}
                left={<IconBadge icon="store-outline" tone={index === 0 ? 'primary' : 'neutral'} />}
                title={storeName(obs.store_id)}
                subtitle={`em ${formatShortDate(toISODate(new Date(obs.purchased_at)))}`}
                right={
                  <Row>
                    {index === 0 && latestByStore.length > 1 ? <Badge label="Mais barato" tone="primary" /> : null}
                    <Text variant="label">
                      {formatBRL(obs.unit_price)}/{obs.unit}
                    </Text>
                  </Row>
                }
              />
            ))}
          </ListCard>
        )}
      </Section>

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

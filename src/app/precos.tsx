import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { useLatestPrices, useProducts, useStores } from '@/data/market';
import { useSharedPrices } from '@/data/sharedPrices';
import { formatBRL } from '@/domain/money';
import { pricesByProduct, summarizePrices } from '@/domain/prices';
import { normalizeSearch } from '@/domain/search';
import { cheaperSharedHint, cheaperSharedPrice, SHARED_PRICES_NOTICE, type SharedPriceRow, sharedRowsByProduct } from '@/domain/sharedPrices';
import { StaleNotice } from '@/features/health/StaleNotice';
import { MergeSuggestionsCard } from '@/features/MergeSuggestionsCard';
import { useProductBarcode } from '@/features/ProductBarcode';
import { settledData } from '@/lib/settledData';
import {
  CategoryIcon,
  EmptyState,
  ErrorNotice,
  IconButton,
  ListRow,
  Loading,
  Row,
  Screen,
  Text,
  TextField,
} from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

/** O texto de sempre embaixo do produto e, quando outra casa viu mais barato, uma linha pequena a mais. */
function withSeenCheaper(text: string, cheaper: SharedPriceRow | null) {
  if (!cheaper) return text;
  return (
    <>
      <Text variant="muted">{text}</Text>
      <Text variant="small">{cheaperSharedHint(cheaper)}</Text>
    </>
  );
}

export default function PricesScreen() {
  const c = useColors();
  const products = useProducts();
  const prices = useLatestPrices();
  const stores = useStores();
  // Preços de outras casas: só a linha a mais embaixo do produto. Enquanto não chegam (ou se o banco ainda não
  // tem a função), a tela é a de sempre.
  const shared = useSharedPrices();
  const [query, setQuery] = useState('');
  // No mercado: o código de barras da embalagem abre o produto, com o último preço, o histórico e os outros mercados.
  const barcode = useProductBarcode({ onProduct: (product) => router.push({ pathname: '/produto/[id]', params: { id: product.id } }) });

  // Só com os preços e os mercados da casa em dia: durante uma busca nova, o que ficou guardado é de antes, e
  // "mais barato que o da casa" seria dito contra um preço que talvez já não seja o dela.
  const settledPrices = settledData(prices);
  const settledStores = settledData(stores);
  const seenElsewhere = useMemo(
    () => (shared.data && settledPrices && settledStores ? sharedRowsByProduct(shared.data, settledPrices, settledStores) : null),
    [shared.data, settledPrices, settledStores],
  );

  // Os preços de cada produto (g já por kg, ml por litro), agrupados uma vez só, e o nome de cada produto pronto
  // para a busca: digitar uma letra só filtra os produtos.
  const byProduct = useMemo(() => pricesByProduct(prices.data ?? []), [prices.data]);
  const searchable = useMemo(() => (products.data ?? []).map((product) => ({ product, key: normalizeSearch(product.name) })), [products.data]);
  const storeName = useMemo(() => new Map((stores.data ?? []).map((s) => [s.id, s.name])), [stores.data]);

  const rows = useMemo(() => {
    const q = normalizeSearch(query);
    return searchable
      .filter(({ key }) => !q || key.includes(q))
      .map(({ product }) => {
        const own = byProduct.get(product.id) ?? [];
        const summary = summarizePrices(own);
        // Só quando outra casa viu mais barato que o menor preço da casa, na mesma unidade.
        return summary ? { product, summary, cheaper: cheaperSharedPrice(own, seenElsewhere?.get(product.id) ?? [], summary.unit) } : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }, [searchable, byProduct, seenElsewhere, query]);

  const queries = [products, prices, stores];
  // Sem internet e sem nada guardado no aparelho, a busca fica parada (e segue sozinha quando a conexão volta):
  // um aviso, em vez de girar sem fim.
  if (queries.some((q) => q.data === undefined && q.fetchStatus === 'paused')) {
    return <ErrorNotice error={{ message: 'Sem internet: os preços aparecem quando a conexão voltar.' }} />;
  }
  // Sem a primeira leitura, o erro (ou o carregando). Com os dados já na tela, uma atualização que falhou não os
  // tira dali: o aviso fica em cima da lista.
  if (products.data === undefined || prices.data === undefined || stores.data === undefined) {
    const error = products.error ?? prices.error ?? stores.error;
    return error ? <ErrorNotice error={error} onRetry={() => queries.forEach((q) => q.refetch())} /> : <Loading />;
  }
  const failed = queries.some((q) => q.isError);
  const searching = Boolean(normalizeSearch(query));

  return (
    <Screen edges={[]} scroll={false}>
      <FlatList
        style={styles.flex}
        data={rows}
        keyExtractor={(row) => row.product.id}
        keyboardShouldPersistTaps="handled"
        refreshing={prices.isRefetching}
        onRefresh={() => prices.refetch()}
        ListHeaderComponent={
          <View style={styles.header}>
            {failed ? <StaleNotice onRetry={() => queries.forEach((q) => q.refetch())} /> : null}
            <Row>
              <View style={styles.flex}>
                <TextField value={query} onChangeText={setQuery} placeholder="Buscar produto" autoCorrect={false} />
              </View>
              {barcode.available ? (
                <IconButton
                  icon="barcode-scan"
                  label="Ler código de barras"
                  color="primary"
                  disabled={barcode.busy}
                  onPress={barcode.start}
                />
              ) : null}
            </Row>
            {/* Com uma busca digitada a pessoa procura um produto: a sugestão de juntar só aparece sem ela. */}
            {query.trim() ? null : <MergeSuggestionsCard onMerged={(id) => router.push({ pathname: '/produto/[id]', params: { id } })} />}
          </View>
        }
        ListEmptyComponent={
          searching ? (
            <EmptyState icon="magnify" title="Nenhum produto com esse nome" message="Confira como está escrito ou busque por outra palavra." />
          ) : (
            <EmptyState icon="chart-line" title="Sem preços ainda" message="Cada nota confirmada registra o preço de cada produto naquele mercado." />
          )
        }
        // A lista é um cartão de vidro só, desenhado por partes: cada linha leva o seu pedaço (a primeira, as
        // bordas de cima; a última, as de baixo). Assim só as linhas à vista são desenhadas.
        renderItem={({ item: { product, summary, cheaper }, index }) => {
          const { unit, cheapest, highest, storeCount, otherUnits } = summary;
          const first = index === 0;
          const last = index === rows.length - 1;
          return (
            <View
              style={[
                styles.segment,
                { backgroundColor: c.glass, borderColor: c.glassEdge, borderLeftColor: c.glassBorder },
                first && [styles.segmentFirst, { borderTopColor: c.glassBorder }],
                last && styles.segmentLast,
              ]}>
              {first ? null : <View style={[styles.divider, { backgroundColor: c.border }]} />}
              <ListRow
                left={<CategoryIcon category={product.category} name={product.name} size={36} />}
                title={product.name}
                subtitle={withSeenCheaper(
                  [
                    storeCount > 1
                      ? `Mais barato: ${storeName.get(cheapest.store_id) ?? 'mercado'} · ${storeCount} mercados`
                      : `Só em ${storeName.get(cheapest.store_id) ?? 'um mercado'}`,
                    otherUnits.length ? `também vendido por ${otherUnits.join(', ')}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · '),
                  cheaper,
                )}
                right={
                  <Text variant="label">
                    {formatBRL(cheapest.unit_price)}
                    {storeCount > 1 && highest > cheapest.unit_price ? `–${formatBRL(highest).replace('R$ ', '')}` : ''}
                    {unit === 'un' ? '' : `/${unit}`}
                  </Text>
                }
                onPress={() => router.push({ pathname: '/produto/[id]', params: { id: product.id } })}
              />
            </View>
          );
        }}
        // O aviso de que não é em tempo real, uma vez só, quando alguma linha mostra preço de outra casa.
        ListFooterComponent={
          rows.some((row) => row.cheaper) ? (
            <Text variant="small" style={styles.footer}>
              {SHARED_PRICES_NOTICE}
            </Text>
          ) : null
        }
      />
      {barcode.element}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { gap: space.xl, paddingBottom: space.xl },
  footer: { paddingTop: space.xl },
  // Os mesmos espaços e bordas do ListCard (um Card com divisor só entre as linhas).
  segment: { borderLeftWidth: 1, borderRightWidth: 1, paddingHorizontal: space.lg + 2 },
  segmentFirst: { borderTopWidth: 1, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: space.xs },
  segmentLast: { borderBottomWidth: 1, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg, paddingBottom: space.xs },
  divider: { height: StyleSheet.hairlineWidth },
});

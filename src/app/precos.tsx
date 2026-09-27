import { router } from 'expo-router';
import { useMemo, useState } from 'react';

import { useLatestPrices, useProducts, useStores } from '@/data/market';
import { formatBRL } from '@/domain/money';
import { summarizePrices } from '@/domain/prices';
import { normalizeSearch } from '@/domain/search';
import {
  CategoryIcon,
  EmptyState,
  ErrorNotice,
  ListCard,
  ListRow,
  Loading,
  Screen,
  Text,
  TextField,
} from '@/ui/primitives';

export default function PricesScreen() {
  const products = useProducts();
  const prices = useLatestPrices();
  const stores = useStores();
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const storeName = new Map((stores.data ?? []).map((s) => [s.id, s.name]));
    const q = normalizeSearch(query);
    return (products.data ?? [])
      .filter((p) => !q || normalizeSearch(p.name).includes(q))
      .map((p) => {
        const summary = summarizePrices((prices.data ?? []).filter((pr) => pr.product_id === p.id));
        return summary ? { product: p, summary, storeName } : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }, [products.data, prices.data, stores.data, query]);

  if (products.isPending || prices.isPending || stores.isPending) return <Loading />;
  const error = products.error ?? prices.error ?? stores.error;
  if (error) return <ErrorNotice error={error} onRetry={() => [products, prices, stores].forEach((q) => q.refetch())} />;

  return (
    <Screen edges={[]} refreshing={prices.isRefetching} onRefresh={() => prices.refetch()}>
      <TextField value={query} onChangeText={setQuery} placeholder="Buscar produto" autoCorrect={false} />
      {rows.length === 0 ? (
        <EmptyState
          icon="chart-line"
          title="Sem preços ainda"
          message="Cada nota confirmada registra o preço de cada produto naquele mercado."
        />
      ) : (
        <ListCard>
          {rows.map(({ product, summary: { unit, cheapest, highest, storeCount, otherUnits }, storeName }) => (
            <ListRow
              key={product.id}
              left={<CategoryIcon category={product.category} name={product.name} size={36} />}
              title={product.name}
              subtitle={[
                storeCount > 1
                  ? `Mais barato: ${storeName.get(cheapest.store_id) ?? 'mercado'} · ${storeCount} mercados`
                  : `Só em ${storeName.get(cheapest.store_id) ?? 'um mercado'}`,
                otherUnits.length ? `também vendido por ${otherUnits.join(', ')}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              right={
                <Text variant="label">
                  {formatBRL(cheapest.unit_price)}
                  {storeCount > 1 && highest > cheapest.unit_price ? `–${formatBRL(highest).replace('R$ ', '')}` : ''}
                  {unit === 'un' ? '' : `/${unit}`}
                </Text>
              }
              onPress={() => router.push({ pathname: '/produto/[id]', params: { id: product.id } })}
            />
          ))}
        </ListCard>
      )}
    </Screen>
  );
}

import { router } from 'expo-router';
import { useMemo, useState } from 'react';

import { useLatestPrices, useProducts, useStores } from '@/data/market';
import { useSharedPrices } from '@/data/sharedPrices';
import { formatBRL } from '@/domain/money';
import { summarizePrices } from '@/domain/prices';
import { normalizeSearch } from '@/domain/search';
import { cheaperSharedHint, cheaperSharedPrice, SHARED_PRICES_NOTICE, type SharedPriceRow, sharedRowsByProduct } from '@/domain/sharedPrices';
import { settledData } from '@/lib/settledData';
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
  const products = useProducts();
  const prices = useLatestPrices();
  const stores = useStores();
  // Preços de outras casas: só a linha a mais embaixo do produto. Enquanto não chegam (ou se o banco ainda não
  // tem a função), a tela é a de sempre.
  const shared = useSharedPrices();
  const [query, setQuery] = useState('');

  // Só com os preços e os mercados da casa em dia: durante uma busca nova, o que ficou guardado é de antes, e
  // "mais barato que o da casa" seria dito contra um preço que talvez já não seja o dela.
  const settledPrices = settledData(prices);
  const settledStores = settledData(stores);
  const seenElsewhere = useMemo(
    () => (shared.data && settledPrices && settledStores ? sharedRowsByProduct(shared.data, settledPrices, settledStores) : null),
    [shared.data, settledPrices, settledStores],
  );

  const rows = useMemo(() => {
    const storeName = new Map((stores.data ?? []).map((s) => [s.id, s.name]));
    const q = normalizeSearch(query);
    return (products.data ?? [])
      .filter((p) => !q || normalizeSearch(p.name).includes(q))
      .map((p) => {
        const own = (prices.data ?? []).filter((pr) => pr.product_id === p.id);
        const summary = summarizePrices(own);
        // Só quando outra casa viu mais barato que o menor preço da casa, na mesma unidade.
        return summary ? { product: p, summary, storeName, cheaper: cheaperSharedPrice(own, seenElsewhere?.get(p.id) ?? [], summary.unit) } : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }, [products.data, prices.data, stores.data, seenElsewhere, query]);

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
          {rows.map(({ product, summary: { unit, cheapest, highest, storeCount, otherUnits }, storeName, cheaper }) => (
            <ListRow
              key={product.id}
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
          ))}
        </ListCard>
      )}
      {/* O aviso de que não é em tempo real, uma vez só, quando alguma linha mostra preço de outra casa. */}
      {rows.some((row) => row.cheaper) ? <Text variant="small">{SHARED_PRICES_NOTICE}</Text> : null}
    </Screen>
  );
}

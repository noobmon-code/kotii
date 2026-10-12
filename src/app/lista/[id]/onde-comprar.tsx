import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useLatestPrices, useListItems, useListLinks, useProducts, useStores } from '@/data/market';
import { formatItemCost, listStorePrices, storePriceNote, unpricedNote } from '@/domain/listEstimate';
import { formatBRL, formatQuantity } from '@/domain/money';
import { storePriceIndex } from '@/domain/priceLevel';
import { recommendStores, type StorePlan } from '@/domain/recommendation';
import type { ShoppingListItem } from '@/lib/types';
import {
  Badge,
  Button,
  Card,
  CategoryIcon,
  EmptyState,
  ErrorNotice,
  IconBadge,
  ListCard,
  ListRow,
  Loading,
  Row,
  Screen,
  Section,
  Segmented,
  Text,
} from '@/ui/primitives';
import { space } from '@/ui/theme';

type Mode = '1' | '2' | '3';

export default function WhereToBuyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const items = useListItems(id);
  const prices = useLatestPrices();
  const stores = useStores();
  const links = useListLinks();
  const products = useProducts();
  const [mode, setMode] = useState<Mode>('1');

  const pending = useMemo(() => (items.data ?? []).filter((i) => !i.checked_at), [items.data]);
  // A mesma conta da estimativa na tela da lista: o preço de cada item em cada mercado vem de lá
  // (domain/listEstimate, listStorePrices), com todos os preços da casa. Dele saem os totais e cada linha.
  const account = useMemo(() => {
    const quotes = (prices.data ?? []).map((p) => ({
      productId: p.product_id,
      storeId: p.store_id,
      unit: p.unit,
      unitPrice: Number(p.unit_price),
      purchasedAt: p.purchased_at,
    }));
    const wanted = pending.map((i) => ({ id: i.id, name: i.name, productId: i.product_id, quantity: Number(i.quantity), unit: i.unit }));
    return {
      quotes,
      wanted: wanted.map((i) => ({ key: i.id, productId: i.productId, quantity: i.quantity, unit: i.unit })),
      priceAt: listStorePrices(wanted, quotes, { links: links.data, products: products.data ?? [] }),
      storeIndex: storePriceIndex(quotes),
    };
  }, [pending, prices.data, links.data, products.data]);
  const recommendation = useMemo(
    () => recommendStores(account.wanted, account.quotes, Number(mode), { storeIndex: account.storeIndex, priceAt: account.priceAt }),
    [account, mode],
  );

  // As ligações e os produtos dão preço ao item digitado solto: sem esperar por eles, o total sairia sem esses
  // itens e mudaria logo depois. Busca parada (sem internet) não segura a tela: cai no aviso de que não carregou.
  const onTheWay = (query: { isPending: boolean; fetchStatus: string }) => query.isPending && query.fetchStatus !== 'paused';
  if (items.isPending || prices.isPending || stores.isPending || onTheWay(links) || onTheWay(products)) {
    return <Loading label="Comparando preços…" />;
  }
  const error = items.error ?? prices.error ?? stores.error;
  if (error) return <ErrorNotice error={error} onRetry={() => [items, prices, stores].forEach((q) => q.refetch())} />;
  // Se não chegaram (a busca falhou, ou sem internet e nunca vistos neste aparelho), item sem preço pode ser só
  // item que não deu para conferir: a tela diz isso e oferece tentar de novo.
  const sourcesLoaded = links.data !== undefined && products.data !== undefined;

  const storeName = (storeId: string) => stores.data?.find((s) => s.id === storeId)?.name ?? 'Mercado';
  const productName = (productId: string) => products.data?.find((p) => p.id === productId)?.name;
  const itemByKey = new Map(pending.map((i) => [i.id, i]));
  const best = recommendation.plans[0];
  const singlePlans = recommendation.plans.filter((p) => p.storeIds.length === 1);
  const bestSingle = singlePlans[0];
  const unpriced = recommendation.unpricedKeys.map((k) => itemByKey.get(k)!).filter(Boolean);

  return (
    <Screen edges={[]}>
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: '1', label: 'Um mercado' },
          { value: '2', label: 'Até 2' },
          { value: '3', label: 'Até 3' },
        ]}
      />

      {!best ? (
        <EmptyState
          icon="store-search-outline"
          title="Ainda sem preços para comparar"
          message="Importe notas fiscais das suas compras. Itens da lista escolhidos pela sugestão de produto passam a ter preço por mercado."
        />
      ) : (
        <>
          <PlanSummary
            plan={best}
            storeName={storeName}
            itemCount={pending.length}
            savings={best.storeIds.length > 1 && bestSingle ? bestSingle.total - best.total : 0}
          />

          {best.storeIds.map((storeId) => {
            const assignments = best.assignments.filter((a) => a.storeId === storeId);
            return (
              <Section key={storeId} title={best.storeIds.length > 1 ? `Comprar no ${storeName(storeId)}` : 'Itens'}>
                <ListCard>
                  {assignments.map((a) => {
                    const item = itemByKey.get(a.itemKey)!;
                    // O custo e a nota da linha saem da mesma resposta que entrou no total.
                    const price = account.priceAt(a.itemKey, a.storeId)!;
                    return (
                      <ListRow
                        key={a.itemKey}
                        left={<CategoryIcon category={item.category} name={item.name} size={36} />}
                        title={item.name}
                        subtitle={storePriceNote(price, productName) ?? formatQuantity(item.quantity, item.unit)}
                        right={
                          <Text variant="label" color={price.kind === 'estimated' ? 'textMuted' : 'text'}>
                            {formatItemCost(price)}
                          </Text>
                        }
                      />
                    );
                  })}
                </ListCard>
              </Section>
            );
          })}

          {singlePlans.length > 1 ? (
            <Section title="Ranking por mercado">
              <ListCard>
                {singlePlans.map((plan, index) => {
                  const storeId = plan.storeIds[0];
                  const idx = recommendation.storeIndex.get(storeId) ?? 1;
                  return (
                    <ListRow
                      key={storeId}
                      left={<IconBadge icon="store-outline" tone={index === 0 ? 'primary' : 'neutral'} />}
                      title={storeName(storeId)}
                      subtitle={`${describeIndex(idx)} · ${plan.knownCount} com preço real`}
                      right={<Text variant="label">{formatBRL(plan.total)}</Text>}
                    />
                  );
                })}
              </ListCard>
            </Section>
          ) : null}
        </>
      )}

      {unpriced.length ? (
        <Section title="Sem preço registrado">
          <ListCard>
            {unpriced.map((item: ShoppingListItem) => (
              <ListRow
                key={item.id}
                left={<CategoryIcon category={item.category} name={item.name} size={36} />}
                title={item.name}
                subtitle={unpricedNote({ productId: item.product_id }, sourcesLoaded)}
              />
            ))}
          </ListCard>
          <Text variant="small">Esses itens ficam fora dos totais.</Text>
          {!sourcesLoaded ? (
            <>
              <Text variant="small">
                Não deu para carregar os produtos que as notas já ligaram aos itens da lista. Com eles, estes itens podem ter preço.
              </Text>
              <Button
                title="Tentar de novo"
                variant="secondary"
                compact
                onPress={() => [links, products].forEach((q) => void q.refetch())}
              />
            </>
          ) : null}
        </Section>
      ) : null}
    </Screen>
  );
}

function describeIndex(index: number): string {
  const pct = Math.round((index - 1) * 100);
  if (pct === 0) return 'Na média';
  return pct < 0 ? `${-pct}% abaixo da média` : `${pct}% acima da média`;
}

function PlanSummary({
  plan,
  storeName,
  itemCount,
  savings,
}: {
  plan: StorePlan;
  storeName: (id: string) => string;
  itemCount: number;
  savings: number;
}) {
  const names = plan.storeIds.map(storeName).join(' + ');
  return (
    <Card style={styles.summary}>
      <Row>
        <IconBadge icon="trophy-outline" tone="primary" />
        <View style={styles.flex}>
          <Text variant="small">Melhor opção</Text>
          <Text variant="heading">{names}</Text>
        </View>
      </Row>
      <Text variant="title">{formatBRL(plan.total)}</Text>
      <Row style={styles.wrap}>
        <Badge label={`${plan.knownCount} preços reais`} tone="primary" />
        {plan.estimatedCount ? <Badge label={`${plan.estimatedCount} estimados`} tone="warning" /> : null}
        {plan.knownCount + plan.estimatedCount < itemCount ? (
          <Badge label={`${itemCount - plan.knownCount - plan.estimatedCount} sem preço`} />
        ) : null}
        {savings > 0.009 ? <Badge label={`Economia de ${formatBRL(savings)} vs. um mercado`} tone="info" /> : null}
      </Row>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { flexWrap: 'wrap' },
  summary: { gap: space.md },
});

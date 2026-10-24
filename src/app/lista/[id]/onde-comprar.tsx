import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useLatestPrices, useListItems, useListLinks, useProducts, useStores } from '@/data/market';
import { useSharedPrices } from '@/data/sharedPrices';
import {
  formatItemCost,
  listSharedElsewhere,
  listSharedOnly,
  listStorePrices,
  sharedOnlyNote,
  storePriceNote,
  unpricedNote,
} from '@/domain/listEstimate';
import { formatBRL, formatQuantity } from '@/domain/money';
import { storePriceIndex } from '@/domain/priceLevel';
import { describeSharedOffer, recommendStores, sharedStoreOffers, type StorePlan } from '@/domain/recommendation';
import { SHARED_PRICES_NOTICE, SHARED_PRICES_OTHERS, sharedQuotes } from '@/domain/sharedPrices';
import { goBackOr } from '@/lib/navigation';
import { chooseStore } from '@/lib/storeChoice';
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
  // Preços de outras casas: onde a casa não tem preço num mercado dela, e à parte os mercados que não são dela.
  // Sem a função no banco (null) ou com a busca falhando, a tela segue só com os preços da casa.
  const shared = useSharedPrices();
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
    // Os mercados da casa se reconhecem pelo CNPJ, e o preço da casa sempre vence: sem os mercados ou sem os
    // preços da casa carregados, nada de outras casas (eles ocupariam o lugar dos dela).
    const seenElsewhere = shared.data && stores.data && prices.data ? sharedQuotes(shared.data, prices.data, stores.data) : [];
    const sources = { links: links.data, products: products.data ?? [], shared: seenElsewhere };
    const all = pending.map((i) => ({ id: i.id, name: i.name, productId: i.product_id, quantity: Number(i.quantity), unit: i.unit }));
    // O item sem preço nenhum da casa, só com o de outras casas, fica fora dos planos (não há preço dele em todo
    // mercado nem média da casa para estimar) e aparece à parte, com o preço que a lista mostra.
    const sharedOnly = listSharedOnly(all, quotes, sources);
    const wanted = all.filter((i) => !sharedOnly.has(i.id));
    return {
      quotes,
      wanted: wanted.map((i) => ({ key: i.id, productId: i.productId, quantity: i.quantity, unit: i.unit })),
      priceAt: listStorePrices(wanted, quotes, sources),
      elsewhere: listSharedElsewhere(all, quotes, sources),
      sharedOnly,
      storeIndex: storePriceIndex(quotes),
    };
  }, [pending, prices.data, links.data, products.data, shared.data, stores.data]);
  const recommendation = useMemo(
    () => recommendStores(account.wanted, account.quotes, Number(mode), { storeIndex: account.storeIndex, priceAt: account.priceAt }),
    [account, mode],
  );
  const offers = useMemo(() => sharedStoreOffers(account.elsewhere, recommendation.plans[0]), [account, recommendation]);

  // As ligações e os produtos dão preço ao item digitado solto: sem esperar por eles, o total sairia sem esses
  // itens e mudaria logo depois. Os preços de outras casas também mudam o total: a primeira busca deles é
  // esperada, mas a que falha (ou a função que não existe) não segura nada. Busca parada (sem internet) não segura
  // a tela: cai no aviso de que não carregou.
  const onTheWay = (query: { isPending: boolean; fetchStatus: string }) => query.isPending && query.fetchStatus !== 'paused';
  if (items.isPending || prices.isPending || stores.isPending || onTheWay(links) || onTheWay(products) || onTheWay(shared)) {
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
  // "Preço real" é o da casa, do próprio produto naquele mercado; o de outro produto com o mesmo nome e o visto em
  // outras casas contam à parte.
  const sourceCount = (plan: StorePlan, source: 'otherProduct' | 'shared') =>
    plan.assignments.filter((a) => account.priceAt(a.itemKey, a.storeId)?.source === source).length;
  const otherProductCount = (plan: StorePlan) => sourceCount(plan, 'otherProduct');
  const sharedCount = (plan: StorePlan) => sourceCount(plan, 'shared');
  const best = recommendation.plans[0];
  const singlePlans = recommendation.plans.filter((p) => p.storeIds.length === 1);
  const bestSingle = singlePlans[0];
  const unpriced = recommendation.unpricedKeys.map((k) => itemByKey.get(k)!).filter(Boolean);
  // "Vou neste": o mercado vira o "Onde estou" da lista (lib/storeChoice) e a pessoa volta para ela.
  const goTo = (storeId: string) => {
    chooseStore(id, storeId);
    goBackOr({ pathname: '/lista/[id]', params: { id } });
  };
  const sharedOnly = pending.flatMap((item) => {
    const price = account.sharedOnly.get(item.id);
    return price ? [[item, price] as const] : [];
  });

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
            itemCount={account.wanted.length}
            otherProduct={otherProductCount(best)}
            shared={sharedCount(best)}
            savings={best.storeIds.length > 1 && bestSingle ? bestSingle.total - best.total : 0}
            onGo={best.storeIds.length === 1 ? () => goTo(best.storeIds[0]) : undefined}
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
                  const seen = sharedCount(plan);
                  return (
                    <ListRow
                      key={storeId}
                      left={<IconBadge icon="store-outline" tone={index === 0 ? 'primary' : 'neutral'} />}
                      title={storeName(storeId)}
                      subtitle={`${describeIndex(idx)} · ${plan.knownCount - otherProductCount(plan) - seen} com preço real${seen ? ` · ${seen} de outras casas` : ''}`}
                      right={
                        <View style={styles.rankRight}>
                          <Text variant="label">{formatBRL(plan.total)}</Text>
                          <Button
                            title="Vou neste"
                            accessibilityLabel={`Vou neste: ${storeName(storeId)}`}
                            variant="ghost"
                            compact
                            onPress={() => goTo(storeId)}
                          />
                        </View>
                      }
                    />
                  );
                })}
              </ListCard>
            </Section>
          ) : null}
        </>
      )}

      {offers.length ? (
        <Section title={SHARED_PRICES_OTHERS}>
          <Text variant="small">
            Mercados onde outras casas viram itens desta lista. Ficam fora da comparação acima: a casa não tem preço do resto da
            lista lá.
          </Text>
          {offers.map((offer) => (
            <View key={offer.storeCnpj} style={styles.offer}>
              <Text variant="label">{offer.storeLabel}</Text>
              <Text variant="muted">{describeSharedOffer(offer)}</Text>
              <ListCard>
                {offer.items.map(({ itemKey, price }) => {
                  const item = itemByKey.get(itemKey)!;
                  return (
                    <ListRow
                      key={itemKey}
                      left={<CategoryIcon category={item.category} name={item.name} size={36} />}
                      title={item.name}
                      subtitle={storePriceNote(price, productName) ?? undefined}
                      right={<Text variant="label">{formatItemCost(price)}</Text>}
                    />
                  );
                })}
              </ListCard>
            </View>
          ))}
        </Section>
      ) : null}

      {sharedOnly.length ? (
        <Section title="Só com preço de outras casas">
          <ListCard>
            {sharedOnly.map(([item, price]) => (
              <ListRow
                key={item.id}
                left={<CategoryIcon category={item.category} name={item.name} size={36} />}
                title={item.name}
                subtitle={sharedOnlyNote(price, (storeId) => stores.data?.find((s) => s.id === storeId)?.name)}
                right={<Text variant="label">{formatItemCost(price)}</Text>}
              />
            ))}
          </ListCard>
          <Text variant="small">A casa ainda não comprou esses itens: ficam fora da comparação e dos totais acima.</Text>
        </Section>
      ) : null}

      {/* Algum preço da tela é de outras casas: o aviso de que não são em tempo real, uma vez. */}
      {(best && sharedCount(best)) || offers.length || sharedOnly.length ? <Text variant="small">{SHARED_PRICES_NOTICE}</Text> : null}

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
  otherProduct,
  shared,
  savings,
  onGo,
}: {
  plan: StorePlan;
  storeName: (id: string) => string;
  itemCount: number;
  /** Itens cujo preço, nesse plano, é de outro produto com o mesmo nome. */
  otherProduct: number;
  /** Itens cujo preço, nesse plano, é o visto em outras casas (a casa não tem preço deles lá). */
  shared: number;
  savings: number;
  /** "Vou neste", no plano de um mercado só. */
  onGo?: () => void;
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
        <Badge label={`${plan.knownCount - otherProduct - shared} preços reais`} tone="primary" />
        {otherProduct ? <Badge label={`${otherProduct} de outro produto`} tone="warning" /> : null}
        {shared ? <Badge label={`${shared} de outras casas`} tone="info" /> : null}
        {plan.estimatedCount ? <Badge label={`${plan.estimatedCount} estimados`} tone="warning" /> : null}
        {plan.knownCount + plan.estimatedCount < itemCount ? (
          <Badge label={`${itemCount - plan.knownCount - plan.estimatedCount} sem preço`} />
        ) : null}
        {savings > 0.009 ? <Badge label={`Economia de ${formatBRL(savings)} vs. um mercado`} tone="info" /> : null}
      </Row>
      {onGo ? <Button title="Vou neste" icon="map-marker-check-outline" variant="secondary" compact onPress={onGo} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { flexWrap: 'wrap' },
  summary: { gap: space.md },
  offer: { gap: space.sm },
  rankRight: { alignItems: 'flex-end' },
});

import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useProductAliases } from '@/data/learnedAbbreviations';
import { useLatestPrices, useListItems, useListLinks, useProducts, usePurchaseRecords, useStores } from '@/data/market';
import { useOpenSharedPrices, useSharedPrices } from '@/data/sharedPrices';
import { CHEAPER_BRAND_BADGE, cheaperBrandRankPart } from '@/domain/cheaperBrand';
import {
  brandSearchItems,
  formatItemCost,
  listSharedElsewhere,
  openCandidates,
  listSharedOnly,
  listStorePrices,
  planPriceCounts,
  sharedOnlyNote,
  storePriceNote,
  unpricedNote,
  usualAmounts,
} from '@/domain/listEstimate';
import { formatBRL, formatQuantity } from '@/domain/money';
import { storePriceIndex } from '@/domain/priceLevel';
import {
  describeSharedOffer,
  recommendStores,
  SHARED_ONLY_TITLE,
  sharedOffersIntro,
  sharedOnlyFooter,
  sharedStoreOffers,
  unpricedFooter,
  WHERE_TO_BUY_EMPTY,
  WHERE_TO_BUY_SHARED_ONLY,
  type StorePlan,
} from '@/domain/recommendation';
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
  // O que a casa costuma levar dos produtos vendidos a peso: a mesma conta da lista para o item em "un" com preço por kg.
  const purchases = usePurchaseRecords();
  // Preços de outras casas: onde a casa não tem preço num mercado dela, e à parte os mercados que não são dela.
  // Sem a função no banco (null) ou com a busca falhando, a tela segue só com os preços da casa.
  const shared = useSharedPrices();
  // As descrições de nota dos produtos da casa: a troca de marca não as traz da base aberta como "outra marca".
  const aliases = useProductAliases();
  const [mode, setMode] = useState<Mode>('1');

  const pending = useMemo(() => (items.data ?? []).filter((i) => !i.checked_at), [items.data]);
  // Os preços da casa como a conta os lê.
  const quotes = useMemo(
    () =>
      (prices.data ?? []).map((p) => ({
        productId: p.product_id,
        storeId: p.store_id,
        unit: p.unit,
        unitPrice: Number(p.unit_price),
        purchasedAt: p.purchased_at,
        // Quantos vinham na embalagem desse preço (os ovos da cartela de 10): os detalhes do item dizem.
        packCount: p.pack_count ?? null,
        // A descrição da nota, de onde sai o tamanho do pacote (a troca de marca compara por kg ou litro).
        description: p.raw_description ?? null,
      })),
    [prices.data],
  );
  // A lista toda como a conta a lê (a "Marca preferida" decide se o item pode sair por outra marca), para as buscas
  // da base aberta serem as mesmas da tela da lista.
  const allItems = useMemo(
    () =>
      (items.data ?? []).map((i) => ({
        id: i.id,
        name: i.name,
        productId: i.product_id,
        quantity: Number(i.quantity),
        unit: i.unit,
        category: i.category,
        brandPreferred: i.brand_preferred === true,
      })),
    [items.data],
  );
  // O que a casa costuma levar dos produtos vendidos a peso.
  const usual = useMemo(() => usualAmounts(purchases.data ?? []), [purchases.data]);
  // Os mercados da casa se reconhecem pelo CNPJ, e o preço da casa sempre vence: sem os mercados ou sem os
  // preços da casa carregados, nada de outras casas (eles ocupariam o lugar dos dela).
  const seenElsewhere = useMemo(
    () => (shared.data && stores.data && prices.data ? sharedQuotes(shared.data, prices.data, stores.data) : []),
    [shared.data, stores.data, prices.data],
  );
  // A base aberta, com a mesma busca da tela da lista: a lista toda (no carrinho e a comprar), para a resposta guardada
  // servir às duas telas sem pedir de novo. Só os itens a comprar usam os preços.
  const priceSourcesSettled =
    prices.data !== undefined &&
    stores.data !== undefined &&
    links.data !== undefined &&
    products.data !== undefined &&
    (shared.data !== undefined || shared.isError);
  const openItems = useMemo(
    () =>
      priceSourcesSettled
        ? openCandidates(allItems, quotes, { links: links.data ?? undefined, products: products.data ?? [], shared: seenElsewhere })
        : null,
    [priceSourcesSettled, allItems, quotes, links.data, products.data, seenElsewhere],
  );
  // As marcas que só outras casas compraram, para a troca de marca: as mesmas buscas da tela da lista (a lista toda).
  const brandItems = useMemo(
    () =>
      priceSourcesSettled && aliases.data
        ? brandSearchItems(allItems, quotes, { links: links.data ?? undefined, products: products.data ?? undefined, shared: seenElsewhere, usual }, aliases.data)
        : null,
    [priceSourcesSettled, aliases.data, allItems, quotes, links.data, products.data, seenElsewhere, usual],
  );
  const openPrices = useOpenSharedPrices(openItems, stores.data ?? undefined, brandItems);
  // A mesma conta da estimativa na tela da lista: o preço de cada item em cada mercado vem de lá
  // (domain/listEstimate, listStorePrices), com todos os preços da casa. Dele saem os totais e cada linha.
  const account = useMemo(() => {
    // Sem o histórico de compras (a busca falhou, ou parada): o costume não entra, e a linha do item diz isso. A tela
    // só mostra a conta depois da primeira busca (ver onTheWay, abaixo).
    // Os produtos sem `?? []`: undefined é "não carregados", e aí não há troca de marca nem o produto do mesmo item.
    const sources = {
      links: links.data,
      products: products.data,
      shared: seenElsewhere,
      open: openPrices.quotes,
      brandKeys: openPrices.brandQuotes,
      usual,
      historyMissing: purchases.data === undefined,
    };
    // A categoria vai junto: nos ovos, "12 un" são doze ovos, como na lista. A "Marca preferida" também.
    const pendingIds = new Set(pending.map((i) => i.id));
    const all = allItems.filter((i) => pendingIds.has(i.id));
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
  }, [pending, allItems, quotes, links.data, products.data, seenElsewhere, openPrices.quotes, openPrices.brandQuotes, usual, purchases.data]);
  const recommendation = useMemo(
    () => recommendStores(account.wanted, account.quotes, Number(mode), { storeIndex: account.storeIndex, priceAt: account.priceAt }),
    [account, mode],
  );
  const offers = useMemo(() => sharedStoreOffers(account.elsewhere, recommendation.plans[0]), [account, recommendation]);

  // As ligações e os produtos dão preço ao item digitado solto: sem esperar por eles, o total sairia sem esses
  // itens e mudaria logo depois. Os preços de outras casas também mudam o total: a primeira busca deles é
  // esperada, mas a que falha (ou a função que não existe) não segura nada; o mesmo com as compras, de onde sai o que
  // a casa costuma levar do que é vendido a peso. Busca parada (sem internet) não segura a tela: cai no aviso de que
  // não carregou.
  const onTheWay = (query: { isPending: boolean; fetchStatus: string }) => query.isPending && query.fetchStatus !== 'paused';
  if (
    items.isPending ||
    prices.isPending ||
    stores.isPending ||
    onTheWay(links) ||
    onTheWay(products) ||
    onTheWay(shared) ||
    onTheWay(purchases) ||
    // As descrições da casa abrem a busca das outras marcas (a troca de marca): a primeira leitura é esperada.
    onTheWay(aliases) ||
    // A base aberta também muda o total: a primeira busca é esperada (uma parada, um erro ou a função que não existe
    // não seguram nada), também a das outras marcas.
    openPrices.waiting
  ) {
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
  // "Preço real" é o da casa, do próprio produto naquele mercado; o de outro produto com o mesmo nome, o visto em
  // outras casas e o de outra marca mais barata contam à parte (somam os preços conhecidos do plano).
  const counts = (plan: StorePlan) => planPriceCounts(plan.assignments, account.priceAt);
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
        // Sem plano: com preços de outras casas (a primeira compra), a tela diz que só há esses; sem nada, o de sempre.
        <EmptyState
          icon="store-search-outline"
          {...(offers.length || sharedOnly.length ? WHERE_TO_BUY_SHARED_ONLY : WHERE_TO_BUY_EMPTY)}
        />
      ) : (
        <>
          <PlanSummary
            plan={best}
            storeName={storeName}
            itemCount={account.wanted.length}
            counts={counts(best)}
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
                  const { real, shared: seen, cheaperBrand } = counts(plan);
                  return (
                    <ListRow
                      key={storeId}
                      left={<IconBadge icon="store-outline" tone={index === 0 ? 'primary' : 'neutral'} />}
                      title={storeName(storeId)}
                      subtitle={`${describeIndex(idx)} · ${real} com preço real${seen ? ` · ${seen} de outras casas` : ''}${cheaperBrandRankPart(cheaperBrand)}`}
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
          <Text variant="small">{sharedOffersIntro(Boolean(best))}</Text>
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
        <Section title={SHARED_ONLY_TITLE}>
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
          <Text variant="small">{sharedOnlyFooter(Boolean(best))}</Text>
        </Section>
      ) : null}

      {/* Algum preço da tela é de outras casas: o aviso de que não são em tempo real, uma vez. */}
      {(best && counts(best).anyShared) || offers.length || sharedOnly.length ? <Text variant="small">{SHARED_PRICES_NOTICE}</Text> : null}

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
          <Text variant="small">{unpricedFooter(Boolean(best))}</Text>
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
  counts,
  savings,
  onGo,
}: {
  plan: StorePlan;
  storeName: (id: string) => string;
  itemCount: number;
  /**
   * Os preços conhecidos do plano em quatro partes (planPriceCounts): os reais; os de outro produto com o mesmo nome;
   * os vistos em outras casas (a casa não tem preço deles lá); e os da marca mais barata de lá.
   */
  counts: ReturnType<typeof planPriceCounts>;
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
        <Badge label={`${counts.real} preços reais`} tone="primary" />
        {counts.otherProduct ? <Badge label={`${counts.otherProduct} de outro produto`} tone="warning" /> : null}
        {counts.shared ? <Badge label={`${counts.shared} de outras casas`} tone="info" /> : null}
        {counts.cheaperBrand ? <Badge label={CHEAPER_BRAND_BADGE(counts.cheaperBrand)} tone="info" /> : null}
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

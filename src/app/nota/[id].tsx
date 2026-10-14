import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchPantryNear } from '@/data/home';
import {
  useListLinks,
  useOpenListItems,
  usePriceObservations,
  useProducts,
  usePurchaseRecords,
  useStores,
} from '@/data/market';
import {
  receiptImageUrl,
  useConfirmReceipt,
  useDeleteReceipt,
  useDeleteReceiptItem,
  useReceipt,
  useSaveReceiptItem,
  useSetReceiptStore,
  useUpdateReceipt,
  type ItemValues,
} from '@/data/receipts';
import { joinNames, receiptPantryRepeats } from '@/domain/cartPantry';
import { CATEGORIES, getCategory } from '@/domain/categories';
import { COMMON_ITEMS } from '@/domain/commonItems';
import { formatBRDate, formatShortDate, parseBRDate, toISODate } from '@/domain/dates';
import {
  applyListChoices,
  forgottenLinks,
  LinkIndex,
  listRemovals,
  matchListItems,
  type ListChoice,
  type ReceiptLine,
} from '@/domain/listLinks';
import { receiptTotalMismatch } from '@/domain/marketSpend';
import { formatBRL, formatQuantity } from '@/domain/money';
import { describePriceAlert, priceAlerts, totalSaving, type AlertItem, type PriceAlert } from '@/domain/priceAlert';
import { houseNameOverride, keptName, noteNames, sameProduct, typedNameActions, withEntry } from '@/domain/receiptNames';
import {
  buildConfirmPayload,
  allArrived,
  confirmBlock,
  GONE_CHOICE_HINT,
  goneProducts,
  REFRESH_FAILED_NOTICE,
  resolveItem,
  type CatalogProduct,
  type ConfirmItem,
  type ItemOverride,
  type ResolvedItem,
} from '@/domain/receiptReview';
import {
  existingNameLabel,
  indexNames,
  nameCandidates,
  nameSourceLabel,
  sameListedName,
  similarNameHint,
  similarNames,
  suggestedName,
  type NameCandidate,
  type NameIndex,
  type SimilarName,
} from '@/domain/similarNames';
import { PayerChips } from '@/features/finance/PayerChips';
import { ReceiptItemEditor } from '@/features/ReceiptItemEditor';
import { ReceiptListSection } from '@/features/ReceiptListSection';
import { errorMessage } from '@/lib/supabase';
import type { ReceiptItem } from '@/lib/types';
import { Backdrop } from '@/ui/Backdrop';
import { askYesNo, confirmAction, notify } from '@/ui/dialogs';
import { PickerModal } from '@/ui/PickerModal';
import {
  Badge,
  Button,
  Card,
  CategoryIcon,
  Chip,
  DateField,
  ErrorNotice,
  Icon,
  IconButton,
  ListRow,
  Loading,
  Row,
  Screen,
  Section,
  Text,
} from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

type Picker =
  | { kind: 'store' }
  | { kind: 'product'; itemId: string; query: string }
  | { kind: 'category'; itemId: string };

type Editing = { item?: ReceiptItem } | null;

/** No seletor de produto: opção que é só um nome da casa (sem produto), pela chave do nome. */
const NAME_OPTION = 'nome:';
/** Idem, para um nome que a pessoa deu a outro item desta nota. */
const NOTE_OPTION = 'nota:';

/** Como o item estava antes de "Usar": é o que "Desfazer" põe de volta. */
type BeforeUse = { override: ItemOverride | undefined; keptName: string | undefined };

export default function ReceiptScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const receiptQuery = useReceipt(id);
  const products = useProducts();
  const stores = useStores();
  const setStore = useSetReceiptStore(id);
  const updateReceipt = useUpdateReceipt(id);
  const saveItem = useSaveReceiptItem(id);
  const deleteItem = useDeleteReceiptItem(id);
  const confirm = useConfirmReceipt(id);
  const deleteReceipt = useDeleteReceipt(id);
  const openList = useOpenListItems();
  const links = useListLinks();
  // As compras recentes só servem aos nomes parecidos, que só aparecem na nota em revisão.
  const purchases = usePurchaseRecords({ enabled: receiptQuery.data?.receipt.status === 'draft' });

  const [overrides, setOverrides] = useState<Record<string, ItemOverride>>({});
  const [listChoices, setListChoices] = useState<Record<string, ListChoice>>({});
  // Nome que a pessoa digitou para um produto novo, já vendo os parecidos: o item não sugere outro de novo.
  const [keptNames, setKeptNames] = useState<Record<string, string>>({});
  // Itens em que a pessoa acabou de usar um nome da casa, com o que havia antes (para "Desfazer").
  const [beforeUse, setBeforeUse] = useState<Record<string, BeforeUse>>({});
  const [picker, setPicker] = useState<Picker | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [dateText, setDateText] = useState<string | null>(null);
  const [imageUrls, setImageUrls] = useState<string[] | null>(null);
  const [checkingPantry, setCheckingPantry] = useState(false);
  // Trava já no toque: o estado só muda no próximo render.
  const confirming = useRef(false);
  // Os itens cujo produto sumiu do catálogo e para os quais a busca nova dos produtos E da nota já chegou.
  const refreshedGone = useRef<string[]>([]);

  const catalog = useMemo(
    () => new Map<string, CatalogProduct>((products.data ?? []).map((p) => [p.id, p])),
    [products.data],
  );

  // Os nomes que a casa já usa (produtos, listas abertas, compras recentes e
  // itens comuns): o nome de um produto novo é conferido com eles, para a
  // mesma coisa não virar vários itens (domain/similarNames).
  const houseNames = useMemo(
    () =>
      indexNames(
        nameCandidates({
          products: products.data ?? [],
          listItems: openList.data ?? [],
          purchases: purchases.data ?? [],
          common: COMMON_ITEMS,
        }),
      ),
    [products.data, openList.data, purchases.data],
  );

  // Produtos ligados aos itens (os escolhidos na revisão valem): o histórico
  // deles alimenta o alerta de preço.
  const linkedProducts = useMemo(() => {
    const ids = new Set<string>();
    for (const item of receiptQuery.data?.items ?? []) {
      const chosen = overrides[item.id]?.product;
      const productId = chosen ? (chosen.kind === 'existing' ? chosen.productId : null) : item.product_id;
      if (productId) ids.add(productId);
    }
    return [...ids].sort();
  }, [receiptQuery.data, overrides]);
  const priceHistory = usePriceObservations(linkedProducts, receiptQuery.data?.receipt.purchased_at);

  const onError = (err: unknown) => notify('Erro', errorMessage(err));

  if (receiptQuery.isPending || products.isPending) return <Loading />;
  if (receiptQuery.isError) return <ErrorNotice error={receiptQuery.error} onRetry={() => receiptQuery.refetch()} />;

  const { receipt, items } = receiptQuery.data;
  const isDraft = receipt.status === 'draft';
  const purchasedOn = toISODate(new Date(receipt.purchased_at));
  const itemsTotal = Math.round(items.reduce((s, i) => s + i.total_price, 0) * 100) / 100;
  // A mesma conta, em centavos, que a tela "Mercado do mês" usa para dizer quais notas abrir para conferir.
  const totalMismatch = receiptTotalMismatch(receipt.total, itemsTotal);

  const resolvedItems = new Map(items.map((item) => [item.id, resolveItem(item, overrides[item.id], catalog, purchasedOn)]));
  // Produto que sumiu do catálogo com a revisão aberta (foi juntado com outro em outro aparelho).
  const gone = goneProducts(items, overrides, catalog);
  const alertItems: AlertItem[] = items.flatMap((item) => {
    const product = resolvedItems.get(item.id)!.product;
    return product.kind === 'existing'
      ? [{ id: item.id, productId: product.productId, unit: item.unit, unitPrice: item.unit_price, quantity: item.quantity }]
      : [];
  });
  const alerts = priceAlerts(alertItems, priceHistory.data ?? [], { receiptId: receipt.id, storeId: receipt.store_id, purchasedOn });
  const saving = totalSaving(alerts);
  const storeName = (storeId: string) => stores.data?.find((s) => s.id === storeId)?.name;
  const alertText = (alert: PriceAlert | undefined) =>
    alert ? describePriceAlert(alert, alert.kind === 'cheaper_elsewhere' ? storeName(alert.storeId) : undefined) : null;

  // Itens das listas abertas que esta compra cumpre (ver domain/listLinks).
  const receiptLines: ReceiptLine[] = items.map((item) => {
    const resolved = resolvedItems.get(item.id)!;
    return {
      id: item.id,
      productId: resolved.product.kind === 'existing' ? resolved.product.productId : null,
      name: resolved.productName,
      names: [resolved.productName, item.suggested_name, item.raw_description].filter((n): n is string => Boolean(n)),
      category: resolved.category,
    };
  });
  const listItems = isDraft ? (openList.data ?? []) : [];
  // A confirmação tira itens da lista e aprende ligações: só com as duas
  // carregadas e atualizadas (o que estava guardado pode ter mudado em outro
  // aparelho; o banco ainda confere o nome de cada item antes de tirar).
  const listPending = isDraft && (openList.isPending || links.isPending || openList.isFetching || links.isFetching);
  const listFailed = isDraft && (openList.isError || links.isError);
  // "Mesmo nome" aqui é o dos nomes parecidos: "Limões" da lista sai marcado com o produto "Limão"; "Molho de
  // tomate" não sai com "Tomate para molho" (as mesmas palavras em outra ordem só sugerem).
  const suggestedMatches = matchListItems(listItems, receiptLines, links.data ?? new LinkIndex(), sameListedName);
  const listMatches = applyListChoices(suggestedMatches, listChoices);

  const override = (itemId: string, patch: ItemOverride) =>
    setOverrides((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }));

  /** O produto ou a categoria do item mudou por outro caminho: o "Desfazer" de antes não vale mais. */
  const forgetUndo = (itemId: string) => setBeforeUse((prev) => (itemId in prev ? withEntry(prev, itemId, undefined) : prev));

  /** Nome de produto novo que a pessoa digitou ou escolheu: o item não sugere outro de novo. */
  const keepName = (itemId: string, change: ItemOverride) => {
    const name = keptName(change);
    if (name != null) setKeptNames((prev) => ({ ...prev, [itemId]: name }));
  };

  /**
   * "Usar": o item fica com um nome que a casa já usa (o que muda está em
   * domain/receiptNames). Como o item estava fica guardado, para "Desfazer".
   */
  function applyHouseName(itemId: string, chosen: Pick<NameCandidate, 'name' | 'category' | 'productId'>) {
    const current = resolvedItems.get(itemId);
    if (!current) return;
    const change = houseNameOverride(chosen, current, catalog);
    keepName(itemId, change);
    // O item já estava com esse produto: nada muda, nada a desfazer.
    if (sameProduct(change.product, current.product)) return;
    setBeforeUse((prev) => ({ ...prev, [itemId]: { override: overrides[itemId], keptName: keptNames[itemId] } }));
    override(itemId, change);
  }

  /**
   * "Desfazer": o item volta exatamente a como estava antes de "Usar". Não
   * passa por `override`, que mistura com o que há agora e deixaria a
   * categoria e a despensa novas; sem nada guardado antes, a chave sai.
   */
  function undoHouseName(itemId: string) {
    const before = beforeUse[itemId];
    if (!before) return;
    setOverrides((prev) => withEntry(prev, itemId, before.override));
    // Com o nome de antes de volta, a sugestão volta junto (se a pessoa não a tinha dispensado).
    setKeptNames((prev) => withEntry(prev, itemId, before.keptName));
    forgetUndo(itemId);
  }

  /** O produto do item muda por outro caminho que não "Usar": nome digitado, produto da lista, não acompanhar. */
  function changeProduct(itemId: string, change: ItemOverride) {
    override(itemId, change);
    keepName(itemId, change);
    forgetUndo(itemId);
  }

  function commitDate() {
    if (dateText == null) return;
    const iso = parseBRDate(dateText);
    if (!iso) {
      notify('Data inválida', 'Use o formato dd/mm/aaaa.');
      return;
    }
    // Meio-dia local: a data não "vira" ao converter para UTC.
    updateReceipt.mutate({ purchased_at: new Date(`${iso}T12:00:00`).toISOString() }, { onError });
    setDateText(null);
  }

  /**
   * O que já foi para a despensa pelo carrinho (ou à mão) numa data próxima:
   * pergunta antes de repetir. Sem repetir, esses itens salvam só na nota.
   */
  async function skipPantryRepeats(payload: ConfirmItem[]): Promise<ConfirmItem[]> {
    const repeats = receiptPantryRepeats(payload, purchasedOn, await fetchPantryNear(purchasedOn), links.data);
    if (!repeats.length) return payload;
    const dates = new Set(repeats.map((r) => r.since));
    const names = joinNames(repeats.map((r) => r.name));
    const again = await askYesNo(
      'Já está na despensa',
      `${names} ${repeats.length === 1 ? 'já está' : 'já estão'} na despensa, ${
        dates.size === 1 ? `da compra de ${formatShortDate([...dates][0])}` : 'de compras destes dias'
      }. Colocar de novo?`,
      'Colocar de novo',
      'Não colocar',
    );
    if (again) return payload;
    const skip = new Set(repeats.map((r) => r.id));
    return payload.map((p) => (skip.has(p.id) ? { ...p, pantry: undefined } : p));
  }

  async function doConfirm() {
    if (confirming.current || confirm.isPending || listPending || listFailed) return;
    // Um produto desta nota foi juntado com outro: confirmar agora criaria de novo, pelo nome da nota, o
    // produto que deixou de existir. A escolha que sumiu é refeita pela pessoa; o produto do próprio item
    // volta com uma busca nova da nota e dos produtos.
    const block = confirmBlock(gone, refreshedGone.current);
    if (block) {
      if (block.kind === 'refresh') {
        const asked = gone.own;
        confirming.current = true;
        let arrived = false;
        try {
          arrived = await allArrived([() => products.refetch(), () => receiptQuery.refetch()]);
        } finally {
          confirming.current = false;
        }
        // Só com as duas buscas na mão o item deixa de pedir a busca: com uma delas falhando, o catálogo pode
        // continuar sem o produto, e a próxima confirmação o criaria de novo.
        if (!arrived) {
          notify(REFRESH_FAILED_NOTICE.title, REFRESH_FAILED_NOTICE.message);
          return;
        }
        refreshedGone.current = [...new Set([...refreshedGone.current, ...asked])];
      }
      notify(block.title, block.message);
      return;
    }
    const removals = listRemovals(listMatches, listItems);
    const forgotten = forgottenLinks(suggestedMatches, listChoices, listItems);
    let payload = buildConfirmPayload(items, overrides, catalog, purchasedOn).map((entry) => ({
      ...entry,
      ...(removals.has(entry.id) ? { list_items: removals.get(entry.id) } : {}),
      ...(forgotten.has(entry.id) ? { forget_links: forgotten.get(entry.id) } : {}),
    }));
    const listCount = [...removals.values()].reduce((n, list) => n + list.length, 0);
    confirming.current = true;
    setCheckingPantry(true);
    try {
      payload = await skipPantryRepeats(payload);
    } catch (err) {
      onError(err);
      return;
    } finally {
      confirming.current = false;
      setCheckingPantry(false);
    }
    const run = () =>
      confirm.mutate(payload, {
        onSuccess: () => {
          const pantryCount = payload.filter((p) => p.pantry).length;
          const done = [
            pantryCount ? `${pantryCount} ${pantryCount === 1 ? 'item foi' : 'itens foram'} para a despensa.` : null,
            listCount ? `${listCount} ${listCount === 1 ? 'item saiu' : 'itens saíram'} da lista.` : null,
          ].filter(Boolean);
          notify('Nota salva', done.length ? done.join(' ') : undefined);
          router.back();
        },
        onError,
      });
    if (!receipt.store_id) {
      confirmAction(
        'Nota sem mercado',
        'Sem o mercado, os preços desta nota não entram no comparativo. Salvar mesmo assim?',
        'Salvar',
        run,
        false,
      );
    } else {
      run();
    }
  }

  const photos = receipt.image_path ? [receipt.image_path, ...(receipt.extra_image_paths ?? [])] : [];

  async function showImages() {
    const urls = (await Promise.all(photos.map((path) => receiptImageUrl(path)))).filter((url): url is string => Boolean(url));
    if (urls.length) setImageUrls(urls);
    else notify('Imagem indisponível');
  }

  function saveEditedItem(values: ItemValues) {
    saveItem.mutate(
      { id: editing?.item?.id, values, position: items.length },
      { onSuccess: () => setEditing(null), onError },
    );
  }

  const pickerItem = picker && picker.kind !== 'store' ? items.find((i) => i.id === picker.itemId) : undefined;
  // Os nomes que a pessoa já deu a outros itens desta nota: o seletor confere com eles também ("Pitaya" e
  // "Pitayas" na mesma nota). Ficam num índice pequeno à parte, para o da casa não ser refeito a cada escolha.
  const noteIndex = indexNames(
    pickerItem && picker?.kind === 'product'
      ? noteNames(
          items.map((item) => ({ id: item.id, product: resolvedItems.get(item.id)!.product })),
          keptNames,
          pickerItem.id,
        )
      : [],
  );

  return (
    <Screen
      edges={[]}
      footer={
        isDraft ? (
          <Button
            title={`Confirmar nota (${items.length} ${items.length === 1 ? 'item' : 'itens'})`}
            icon="check"
            onPress={doConfirm}
            loading={confirm.isPending || checkingPantry || listPending}
            disabled={!items.length || listFailed}
          />
        ) : undefined
      }>
      <Stack.Screen options={{ title: isDraft ? 'Revisar nota' : 'Nota fiscal' }} />

      <Card style={styles.gap}>
        <Pressable disabled={!isDraft} onPress={() => setPicker({ kind: 'store' })} style={styles.storeRow}>
          <Icon name="store-outline" color="primary" />
          <View style={styles.flex}>
            <Text variant="small">Mercado</Text>
            <Text variant="heading">{receipt.store?.name ?? 'Toque para escolher'}</Text>
          </View>
          {isDraft ? <Icon name="chevron-right" color="textMuted" /> : null}
        </Pressable>
        {isDraft ? (
          <DateField
            label="Data da compra"
            value={dateText ?? formatBRDate(purchasedOn)}
            onChangeText={setDateText}
            onBlur={commitDate}
            onSubmitEditing={commitDate}
          />
        ) : (
          <Text variant="muted">Compra em {formatShortDate(purchasedOn)}</Text>
        )}
        <Row style={styles.between}>
          <Text variant="muted">Soma dos itens</Text>
          <Text variant="label">{formatBRL(itemsTotal)}</Text>
        </Row>
        {receipt.total != null ? (
          <Row style={styles.between}>
            <Text variant="muted">Total da nota</Text>
            <Text variant="label">{formatBRL(receipt.total)}</Text>
          </Row>
        ) : null}
        {totalMismatch ? (
          <Badge label="A soma não bate com o total: confira itens e descontos" tone="warning" />
        ) : null}
        <PayerChips value={receipt.paid_by} onChange={(paidBy) => updateReceipt.mutate({ paid_by: paidBy }, { onError })} />
        {photos.length ? (
          <Button
            title={photos.length > 1 ? `Ver fotos da nota (${photos.length})` : 'Ver foto da nota'}
            icon="image-outline"
            variant="secondary"
            compact
            onPress={showImages}
          />
        ) : null}
      </Card>

      {alerts.size ? (
        <Card style={styles.gapSm}>
          <Row>
            <Icon name="tag-arrow-up-outline" color="warning" />
            <Text variant="heading" style={styles.flex}>
              {alerts.size === 1 ? 'Um item saiu mais caro' : `${alerts.size} itens saíram mais caros`}
            </Text>
          </Row>
          <Text variant="muted">
            Comparando com o que a casa pagou nos últimos meses, dava para economizar cerca de {formatBRL(saving)}. Os avisos
            estão nos itens.
          </Text>
        </Card>
      ) : null}

      {listFailed ? (
        <Card style={styles.gapSm}>
          <Text variant="muted">
            Não deu para carregar a lista de compras. A nota é confirmada junto com o que sai da lista: tente de novo.
          </Text>
          <Button
            title="Tentar de novo"
            icon="refresh"
            variant="secondary"
            compact
            onPress={() => {
              if (openList.isError) void openList.refetch();
              if (links.isError) void links.refetch();
            }}
          />
        </Card>
      ) : null}

      {listItems.length && !listFailed ? (
        <ReceiptListSection
          listItems={listItems}
          matches={listMatches}
          receipt={items.map((item) => {
            const resolved = resolvedItems.get(item.id)!;
            return {
              id: item.id,
              name: resolved.productName ?? item.suggested_name ?? item.raw_description,
              category: resolved.category,
            };
          })}
          onChoose={(listItemId, choice) => setListChoices((prev) => ({ ...prev, [listItemId]: choice }))}
        />
      ) : null}

      {isDraft ? (
        <Text variant="muted">
          Confira cada item. Produtos ligam a mesma coisa entre mercados diferentes — é isso que permite comparar preços.
        </Text>
      ) : null}

      <Section
        title={`Itens (${items.length})`}
        action={isDraft ? <Button title="Item" icon="plus" variant="ghost" compact onPress={() => setEditing({})} /> : null}>
        {items.map((item) => {
          const resolved = resolvedItems.get(item.id)!;
          const alert = alertText(alerts.get(item.id));
          const before = beforeUse[item.id];
          return isDraft ? (
            <DraftItemCard
              key={item.id}
              item={item}
              resolved={resolved}
              alert={gone.chosen.includes(item.id) ? GONE_CHOICE_HINT : alert}
              onEdit={() => setEditing({ item })}
              onPickProduct={() =>
                setPicker({ kind: 'product', itemId: item.id, query: resolved.productName ?? item.suggested_name ?? '' })
              }
              onPickCategory={() => setPicker({ kind: 'category', itemId: item.id })}
              onTogglePantry={() => override(item.id, { pantry: !resolved.pantry })}
              onChangeExpiry={(iso) => override(item.id, { expiryManual: true, expiresOn: iso })}
              houseNames={houseNames}
              keepsName={keptNames[item.id] === resolved.productName}
              onUseName={(name) => applyHouseName(item.id, name)}
              onKeepName={() => {
                const name = resolved.productName;
                if (name) setKeptNames((prev) => ({ ...prev, [item.id]: name }));
              }}
              previousName={before ? resolveItem(item, before.override, catalog, purchasedOn).productName : undefined}
              onUndoName={() => undoHouseName(item.id)}
            />
          ) : (
            <Card key={item.id}>
              <ListRow
                left={<CategoryIcon category={resolved.category} name={catalog.get(item.product_id ?? '')?.name ?? item.raw_description} size={36} />}
                title={item.product_id ? (catalog.get(item.product_id)?.name ?? item.raw_description) : item.raw_description}
                subtitle={
                  <View style={styles.gapXs}>
                    <Text variant="muted">{`${formatQuantity(item.quantity, item.unit)} × ${formatBRL(item.unit_price)}`}</Text>
                    {alert ? <Badge label={alert} tone="warning" /> : null}
                  </View>
                }
                right={<Text variant="label">{formatBRL(item.total_price)}</Text>}
                onPress={item.product_id ? () => router.push({ pathname: '/produto/[id]', params: { id: item.product_id! } }) : undefined}
              />
            </Card>
          );
        })}
      </Section>

      <Button
        title={isDraft ? 'Descartar nota' : 'Excluir nota'}
        variant="danger"
        icon="trash-can-outline"
        onPress={() =>
          confirmAction(
            isDraft ? 'Descartar nota' : 'Excluir nota',
            isDraft ? 'Os itens lidos serão apagados.' : 'Os preços desta nota saem do comparativo. Itens já na despensa continuam.',
            isDraft ? 'Descartar' : 'Excluir',
            () => deleteReceipt.mutate(photos, { onSuccess: () => router.back(), onError }),
          )
        }
      />

      <PickerModal
        visible={picker?.kind === 'store'}
        title="Mercado"
        placeholder="Buscar ou criar mercado"
        options={(stores.data ?? []).map((s) => ({ id: s.id, title: s.name, subtitle: s.address ?? undefined }))}
        onClose={() => setPicker(null)}
        onSelect={(storeId) => {
          setPicker(null);
          setStore.mutate({ id: storeId }, { onError });
        }}
        extraActions={(query) =>
          query ? (
            <Button
              title={`Criar "${query}"`}
              icon="plus"
              variant="secondary"
              compact
              onPress={() => {
                setPicker(null);
                setStore.mutate({ name: query }, { onError });
              }}
            />
          ) : null
        }
      />

      <PickerModal
        visible={picker?.kind === 'product'}
        title="Qual produto é este?"
        initialQuery={picker?.kind === 'product' ? picker.query : ''}
        options={(products.data ?? []).map((p) => ({
          id: p.id,
          title: p.name,
          subtitle: getCategory(p.category).label,
          left: <CategoryIcon category={p.category} name={p.name} size={32} />,
        }))}
        onClose={() => setPicker(null)}
        suggestionsTitle="Nomes parecidos"
        suggestions={(query) => {
          if (!pickerItem || !query) return [];
          const current = resolvedItems.get(pickerItem.id);
          return similarNames(query, houseNames, {
            category: current?.category,
            exceptProductId: current?.product.kind === 'existing' ? current.product.productId : null,
            also: noteIndex,
          }).map((name) => ({
            id: name.productId ?? `${name.source === 'nota' ? NOTE_OPTION : NAME_OPTION}${name.key}`,
            title: name.name,
            subtitle: nameSourceLabel(name),
            left: <CategoryIcon category={name.category} name={name.name} size={32} />,
          }));
        }}
        onSelect={(optionId) => {
          if (pickerItem) changeProduct(pickerItem.id, { product: { kind: 'existing', productId: optionId } });
          setPicker(null);
        }}
        onSelectSuggestion={(optionId) => {
          // Um nome parecido: produto da casa, nome da casa sem produto ou nome dado a outro item desta nota.
          const product = catalog.get(optionId);
          const chosen = product
            ? { name: product.name, category: product.category, productId: product.id }
            : optionId.startsWith(NOTE_OPTION)
              ? noteIndex.byKey.get(optionId.slice(NOTE_OPTION.length))
              : houseNames.byKey.get(optionId.slice(NAME_OPTION.length));
          if (pickerItem && chosen) applyHouseName(pickerItem.id, chosen);
          setPicker(null);
        }}
        extraActions={(query) => {
          const current = pickerItem ? resolvedItems.get(pickerItem.id) : undefined;
          if (!pickerItem || !current) return null;
          // O mesmo nome com outra grafia ("Bananas", com "Banana" na casa): usar o que já existe vem antes de criar outro.
          const { existing, create } = typedNameActions(query, houseNames, noteIndex, current, catalog);
          return (
            <View style={styles.gapSm}>
              {existing ? (
                <Button
                  title={existingNameLabel(existing)}
                  icon="swap-horizontal"
                  variant="secondary"
                  compact
                  onPress={() => {
                    applyHouseName(pickerItem.id, existing);
                    setPicker(null);
                  }}
                />
              ) : null}
              {create ? (
                <Button
                  title={create.title}
                  icon="plus"
                  variant={existing ? 'ghost' : 'secondary'}
                  compact
                  onPress={() => {
                    changeProduct(pickerItem.id, create.override);
                    setPicker(null);
                  }}
                />
              ) : null}
              <Button
                title="Não acompanhar preço deste item"
                icon="eye-off-outline"
                variant="ghost"
                compact
                onPress={() => {
                  changeProduct(pickerItem.id, { product: { kind: 'none' }, pantry: false });
                  setPicker(null);
                }}
              />
            </View>
          );
        }}
      />

      <PickerModal
        visible={picker?.kind === 'category'}
        title="Categoria"
        options={CATEGORIES.map((cat) => ({ id: cat.key, title: cat.label, left: <CategoryIcon category={cat.key} size={32} /> }))}
        onClose={() => setPicker(null)}
        onSelect={(category) => {
          if (pickerItem) {
            const current = resolveItem(pickerItem, overrides[pickerItem.id], catalog, purchasedOn);
            if (current.product.kind === 'new') {
              override(pickerItem.id, { product: { ...current.product, category }, pantry: undefined });
              forgetUndo(pickerItem.id);
            }
          }
          setPicker(null);
        }}
      />

      {editing ? (
        <ReceiptItemEditor
          initial={editing.item}
          saving={saveItem.isPending}
          onClose={() => setEditing(null)}
          onSave={saveEditedItem}
          onDelete={
            editing.item
              ? () => {
                  const target = editing.item!;
                  setEditing(null);
                  deleteItem.mutate(target.id, { onError });
                }
              : undefined
          }
        />
      ) : null}

      <ImageViewer urls={imageUrls} onClose={() => setImageUrls(null)} />
    </Screen>
  );
}

function DraftItemCard({
  item,
  resolved,
  alert,
  onEdit,
  onPickProduct,
  onPickCategory,
  onTogglePantry,
  onChangeExpiry,
  houseNames,
  keepsName,
  onUseName,
  onKeepName,
  previousName,
  onUndoName,
}: {
  item: ReceiptItem;
  resolved: ResolvedItem;
  /** Aviso de preço já descrito (describePriceAlert). */
  alert: string | null;
  onEdit: () => void;
  onPickProduct: () => void;
  onPickCategory: () => void;
  onTogglePantry: () => void;
  onChangeExpiry: (iso: string | null) => void;
  /** Os nomes que a casa já usa (domain/similarNames). */
  houseNames: NameIndex;
  /** A pessoa já decidiu o nome deste produto novo: sem sugestão. */
  keepsName: boolean;
  onUseName: (name: SimilarName) => void;
  onKeepName: () => void;
  /** Depois de "Usar": o nome que o item tinha antes (null se não tinha produto); undefined sem nada a desfazer. */
  previousName?: string | null;
  onUndoName: () => void;
}) {
  const [expiryText, setExpiryText] = useState<string | null>(null);
  const { product } = resolved;
  // Produto novo com o nome que veio da leitura: se a casa já usa um nome que serve, a sugestão fica no próprio item.
  const newName = product.kind === 'new' ? product.name : null;
  const similar = useMemo(
    () => (newName && !keepsName ? suggestedName(newName, houseNames, { category: resolved.category }) : null),
    [newName, keepsName, houseNames, resolved.category],
  );

  function commitExpiry() {
    if (expiryText == null) return;
    if (!expiryText.trim()) {
      onChangeExpiry(null);
    } else {
      const iso = parseBRDate(expiryText);
      if (!iso) {
        notify('Data inválida', 'Use o formato dd/mm/aaaa.');
        return;
      }
      onChangeExpiry(iso);
    }
    setExpiryText(null);
  }

  const productLabel =
    product.kind === 'existing'
      ? resolved.productName ?? 'Produto'
      : product.kind === 'new'
        ? `Novo: ${product.name}`
        : 'Sem acompanhamento de preço';
  // O desenho segue o produto escolhido: "LT INT ITALAC" ligado a "Leite integral" vira leite.
  const artName =
    product.kind === 'existing'
      ? resolved.productName ?? item.raw_description
      : product.kind === 'new'
        ? product.name
        : item.raw_description;

  return (
    <Card style={styles.gapSm}>
      <Row>
        <CategoryIcon category={resolved.category} name={artName} size={36} />
        <View style={styles.flex}>
          <Text variant="small">{item.raw_description}</Text>
          <Text variant="muted">
            {formatQuantity(item.quantity, item.unit)} × {formatBRL(item.unit_price)}
          </Text>
        </View>
        <Text variant="label">{formatBRL(item.total_price)}</Text>
        <IconButton icon="pencil-outline" label={`Editar ${item.raw_description}`} onPress={onEdit} />
      </Row>
      {alert ? <Badge label={alert} tone="warning" /> : null}
      <Row style={styles.wrap}>
        <Chip
          label={productLabel}
          icon={product.kind === 'existing' ? 'link-variant' : product.kind === 'new' ? 'plus-circle-outline' : 'eye-off-outline'}
          selected={product.kind === 'existing'}
          onPress={onPickProduct}
        />
        {product.kind === 'new' ? (
          <Chip label={getCategory(resolved.category).label} icon="tag-outline" onPress={onPickCategory} />
        ) : null}
      </Row>
      {similar ? (
        <View style={styles.gapXs}>
          <Text variant="small">{similarNameHint(similar)}</Text>
          <Row style={styles.wrap}>
            <Chip label={`Usar "${similar.name}"`} icon="swap-horizontal" onPress={() => onUseName(similar)} />
            <Chip label="Manter o nome" onPress={onKeepName} />
          </Row>
        </View>
      ) : null}
      {previousName !== undefined ? (
        <Row style={styles.wrap}>
          {previousName ? <Text variant="small">{`Antes: "${previousName}"`}</Text> : null}
          <Chip label="Desfazer" icon="undo-variant" onPress={onUndoName} />
        </Row>
      ) : null}
      {product.kind !== 'none' ? (
        <Row style={styles.wrap}>
          <Chip
            label={resolved.pantry ? 'Vai para a despensa' : 'Não vai para a despensa'}
            icon="fridge-outline"
            selected={resolved.pantry}
            onPress={onTogglePantry}
          />
          {resolved.pantry ? (
            <View style={styles.expiry}>
              <DateField
                value={expiryText ?? (resolved.expiresOn ? formatBRDate(resolved.expiresOn) : '')}
                placeholder="Validade"
                onChangeText={setExpiryText}
                onBlur={commitExpiry}
                onSubmitEditing={commitExpiry}
                accessibilityLabel={`Validade de ${item.raw_description}`}
              />
            </View>
          ) : null}
        </Row>
      ) : null}
      {resolved.pantry && resolved.expiresOn && resolved.expirySource !== 'manual' ? (
        <Text variant="small">
          Validade estimada {resolved.expirySource === 'produto' ? 'pelo histórico do produto' : 'pela categoria'} — ajuste se quiser.
        </Text>
      ) : null}
    </Card>
  );
}

/** Fotos da nota; nota comprida vem em partes, uma embaixo da outra. */
function ImageViewer({ urls, onClose }: { urls: string[] | null; onClose: () => void }) {
  const c = useColors();
  return (
    <Modal visible={Boolean(urls?.length)} animationType="fade" onRequestClose={onClose}>
      <SafeAreaView style={[styles.flex, { backgroundColor: c.background }]}>
        <Backdrop />
        <Row style={styles.viewerHeader}>
          <Text variant="heading" style={styles.flex}>
            {urls && urls.length > 1 ? `Fotos da nota (${urls.length})` : 'Foto da nota'}
          </Text>
          <IconButton icon="close" label="Fechar" onPress={onClose} />
        </Row>
        {urls?.length === 1 ? (
          <Image source={{ uri: urls[0] }} style={styles.flex} contentFit="contain" />
        ) : (
          <ScrollView contentContainerStyle={styles.photos}>
            {urls?.map((url, index) => (
              <Image
                key={url}
                source={{ uri: url }}
                style={styles.photo}
                contentFit="contain"
                accessibilityLabel={`Parte ${index + 1} da nota`}
              />
            ))}
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space.md },
  gapSm: { gap: space.sm },
  gapXs: { gap: space.xs },
  wrap: { flexWrap: 'wrap' },
  between: { justifyContent: 'space-between' },
  storeRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  expiry: { width: 140 },
  viewerHeader: { padding: space.lg },
  photos: { gap: space.sm, paddingBottom: space.xl },
  photo: { width: '100%', aspectRatio: 3 / 4 },
});

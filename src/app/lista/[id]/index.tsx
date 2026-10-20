import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { usePantry } from '@/data/home';
import {
  dropPendingPhotos,
  emptyPhotoTrash,
  keepPendingPhoto,
  useListPhotoUrls,
  usePendingListPhotos,
  usePendingPhotoUri,
  useSetListItemPhoto,
} from '@/data/listPhotos';
import {
  type EditItemInput,
  loadListLinks,
  newToggleToken,
  removalWaitsForQueue,
  useAddListItem,
  useArchiveList,
  useClearCheckedItems,
  useListLinks,
  useEditListItem,
  useLatestPrices,
  useListItems,
  useProducts,
  usePurchaseRecords,
  useRemoveListItem,
  useRemovePendingListItem,
  useShoppingList,
  useStores,
  useToggleListItem,
} from '@/data/market';
import { useRefreshMarketTrips } from '@/data/marketTrips';
import { useSharedPrices } from '@/data/sharedPrices';
import { cartPantryRows, type CartPantryEntry, type CartPantryRow } from '@/domain/cartPantry';
import { compareByAisle, getCategory } from '@/domain/categories';
import {
  currentStoreChoice,
  estimateList,
  formatItemCost,
  itemFacts,
  pantryHits,
  seePricesProduct,
  type PantryHit,
  type StoreChoice,
} from '@/domain/listEstimate';
import { compareForShopping } from '@/domain/listItem';
import { searchCommonItems, type CommonItem } from '@/domain/commonItems';
import { todayISO } from '@/domain/dates';
import { cartPurchases } from '@/domain/listQueue';
import { parseDecimal } from '@/domain/money';
import { fitsList, recentPurchases, type RecentItem } from '@/domain/recentPurchases';
import { ranOutItems, restockFrom } from '@/domain/restock';
import { guessCategory, normalizeSearch } from '@/domain/search';
import { sharedQuotes } from '@/domain/sharedPrices';
import { CartPantryModal } from '@/features/CartPantryModal';
import { CommonItemsPicker } from '@/features/CommonItemsPicker';
import { ListEstimateCard } from '@/features/ListEstimateCard';
import { ListItemEditor, type ItemDetails, type PhotoChange } from '@/features/ListItemEditor';
import { ListShareSheet } from '@/features/ListShareSheet';
import { MarketTripAction, MarketTripBanner } from '@/features/MarketTrip';
import { OfflineNotice } from '@/features/OfflineNotice';
import { RecentPurchases, RestockStrip, useJustListed } from '@/features/RecentPurchases';
import { ShoppingGrid, type ItemHint } from '@/features/ShoppingGrid';
import { useAuth, useHouseholdId } from '@/lib/auth';
import { errorMessage } from '@/lib/supabase';
import { UNITS, type Product, type ShoppingListItem, type Unit } from '@/lib/types';
import { askYesNo, confirmAction, notify } from '@/ui/dialogs';
import {
  Button,
  Card,
  CategoryIcon,
  Chip,
  EmptyState,
  ErrorNotice,
  ListRow,
  Loading,
  Row,
  Screen,
  Section,
  Text,
  TextField,
} from '@/ui/primitives';
import { space } from '@/ui/theme';

/**
 * O mercado em que a pessoa disse estar, por lista, e quando disse: vale por
 * uma ida ao mercado (currentStoreChoice), enquanto o app está aberto.
 */
const chosenStores = new Map<string, StoreChoice>();

export default function ShoppingListScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const list = useShoppingList(id);
  const items = useListItems(id);
  const products = useProducts();
  const purchases = usePurchaseRecords();
  const addItem = useAddListItem(id);
  const toggle = useToggleListItem(id);
  const remove = useRemoveListItem(id);
  const removePending = useRemovePendingListItem(id);
  // Limpar vale com a fila andando (e sem internet): ele entra nela depois das marcações, e os itens saem da tela
  // já no toque, então não há como limpar o mesmo carrinho duas vezes.
  const clearChecked = useClearCheckedItems(id);
  const archive = useArchiveList(id);
  const pantry = usePantry();
  const links = useListLinks();
  const prices = useLatestPrices();
  const stores = useStores();
  // Preços de outras casas: só onde a casa não tem preço (domain/listEstimate). Sem a função no banco (null), com a
  // busca a caminho ou depois de uma que falhou, a conta sai só com os preços da casa: nunca vira erro na tela.
  const shared = useSharedPrices();
  const edit = useEditListItem(id);
  const setPhoto = useSetListItemPhoto();
  const householdId = useHouseholdId();
  const queryClient = useQueryClient();
  const refreshTrips = useRefreshMarketTrips();

  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState<Unit>('un');
  const [pickerOpen, setPickerOpen] = useState(false);
  // Guardar na despensa: um item (botão do item) ou o carrinho todo (Limpar),
  // com o carrinho como estava no toque.
  const [storing, setStoring] = useState<{
    items: ShoppingListItem[];
    rows: CartPantryRow[];
    single: boolean;
    pantryUnknown: boolean;
  } | null>(null);
  const [editing, setEditing] = useState<ShoppingListItem | null>(null);
  const [sharing, setSharing] = useState(false);
  const [storeChoice, setStoreChoice] = useState<StoreChoice | null>(() => chosenStores.get(id) ?? null);
  // Some da faixa já no toque; volta quando a lista carregada trouxer o item e ele sair dela depois.
  const justAdded = useJustListed(items.data);

  // Fotos dos itens: as enviadas (links guardados para ver sem internet) e as que esperam internet.
  const photos = {
    signed: useListPhotoUrls((items.data ?? []).flatMap((i) => (i.photo_path ? [i.photo_path] : []))),
    pending: usePendingListPhotos(),
  };
  const editingPendingUri = usePendingPhotoUri(editing ? photos.pending.get(editing.id) : undefined);

  // Foto trocada ou de item que saiu da lista: apaga do storage o que ficou na lixeira.
  useEffect(() => {
    emptyPhotoTrash();
  }, []);

  const shelfLifeDays = useMemo(
    () => new Map((products.data ?? []).map((p) => [p.id, p.shelf_life_days])),
    [products.data],
  );

  const productByName = useMemo(
    () => new Map((products.data ?? []).map((p) => [normalizeSearch(p.name), p])),
    [products.data],
  );

  // Produtos com histórico de preço primeiro; depois itens comuns da casa.
  const suggestions = useMemo(() => {
    const q = normalizeSearch(name);
    if (q.length < 2) return { products: [], common: [] };
    const matched = (products.data ?? []).filter((p) => normalizeSearch(p.name).includes(q)).slice(0, 4);
    const common = searchCommonItems(q, 6)
      .filter((i) => !productByName.has(normalizeSearch(i.name)))
      .slice(0, Math.max(2, 6 - matched.length));
    return { products: matched, common };
  }, [name, products.data, productByName]);

  const onError = (err: unknown) => notify('Erro', errorMessage(err));

  function resetForm() {
    setName('');
    setQuantity('1');
    setUnit('un');
  }

  // Pôr item vai pela fila da lista: aparece na hora, também sem internet, e o campo já fica livre para o próximo.
  function add(product?: Product) {
    const itemName = product?.name ?? name.trim();
    if (!itemName) return;
    const qty = parseDecimal(quantity) ?? 1;
    addItem.add(
      {
        name: itemName,
        category: product?.category ?? guessCategory(itemName),
        productId: product?.id ?? null,
        quantity: qty > 0 ? qty : 1,
        unit,
      },
      session!.user.id,
      { onError },
    );
    resetForm();
  }

  /** Item comum: liga ao produto da casa de mesmo nome, se existir. */
  function addCommon(item: CommonItem, fromForm = false) {
    const product = productByName.get(normalizeSearch(item.name));
    const qty = fromForm ? (parseDecimal(quantity) ?? 1) : 1;
    addItem.add(
      {
        name: product?.name ?? item.name,
        category: product?.category ?? item.category,
        productId: product?.id ?? null,
        quantity: qty > 0 ? qty : 1,
        // A unidade do catálogo vale, a menos que o usuário tenha escolhido outra.
        unit: fromForm && unit !== 'un' ? unit : item.unit,
      },
      session!.user.id,
      { onError },
    );
    if (fromForm) resetForm();
  }

  /**
   * Catálogo de itens comuns: um toque põe na lista, outro tira (o que está
   * para comprar com esse nome). Item com descrição, foto ou prioridade
   * pergunta antes de sair. Devolve se deu certo.
   */
  async function toggleCommon(item: CommonItem, add: boolean): Promise<boolean> {
    try {
      if (add) {
        const product = productByName.get(normalizeSearch(item.name));
        addItem.add(
          {
            name: product?.name ?? item.name,
            category: product?.category ?? item.category,
            productId: product?.id ?? null,
            quantity: 1,
            unit: item.unit,
          },
          session!.user.id,
          { onError },
        );
        return true;
      }
      const key = normalizeSearch(item.name);
      const matches = (items.data ?? []).filter((i) => !i.checked_at && normalizeSearch(i.name) === key);
      if (!matches.length) return false;
      // Foto que ainda espera internet também conta (o item ainda não tem photo_path).
      const detailed = matches.some(
        (i) => i.notes || i.photo_path || photos.pending.has(i.id) || (i.priority ?? 'normal') !== 'normal',
      );
      const confirmRemoval = (name: string, when: string) =>
        askYesNo('Tirar da lista?', `${name} ${when} descrição, foto ou prioridade. Tirar da lista mesmo assim?`, 'Tirar', 'Manter');
      if (detailed && !(await confirmRemoval(matches[0].name, 'tem'))) return false;
      // Sem internet, ou com a fila ainda enviando (a lista daqui pode não ser a de lá): tirar vai pela fila, depois
      // do que veio antes, e no servidor só apaga o que ainda está para comprar (e, sem a confirmação, sem detalhes).
      // O que outra pessoa mudou enquanto isso volta para a lista quando ela recarregar.
      if (removalWaitsForQueue(queryClient)) {
        for (const match of matches) {
          remove.remove({ id: match.id, userId: session!.user.id, onlyPending: true, plainOnly: !detailed }, { onError });
          dropPendingPhotos(queryClient, match.id);
        }
        return true;
      }
      // A foto que espera internet só sai depois que o item saiu: se apagar
      // falhar (sem internet), o item fica com ela. Só apaga o que ainda está
      // para comprar e, sem a confirmação, o que ainda está sem detalhes: o
      // que outra pessoa mudou enquanto isso não some sem perguntar.
      let inCart = 0;
      let kept = 0;
      for (const match of matches) {
        let result = await removePending.mutateAsync({ id: match.id, plainOnly: !detailed });
        if (result === 'has_details') {
          result = (await confirmRemoval(match.name, 'ganhou'))
            ? await removePending.mutateAsync({ id: match.id, plainOnly: false })
            : 'has_details';
        }
        if (result === 'removed') dropPendingPhotos(queryClient, match.id);
        else if (result === 'in_cart') inCart += 1;
        else if (result === 'has_details') kept += 1;
      }
      emptyPhotoTrash();
      if (inCart) notify('Já está no carrinho', `${matches[0].name} foi para o carrinho e continua lá.`);
      // Ficou algum na lista: a marca volta ao que a lista mostrar.
      return kept === 0;
    } catch (err) {
      onError(err);
      return false;
    }
  }

  // A falha de cada toque devolve o próprio item à faixa (cada pedido tem o seu onError, mesmo com toques seguidos).
  function addRecent(item: Omit<RecentItem, 'times'>) {
    justAdded.add([item.name]);
    addItem.add(
      {
        name: item.name,
        category: item.category,
        productId: item.productId,
        quantity: item.quantity,
        unit: item.unit,
      },
      session!.user.id,
      {
        onError: (err) => {
          justAdded.drop([item.name]);
          onError(err);
        },
      },
    );
  }


  const listKind = list.data?.kind;
  const today = todayISO();
  // O que já passou do intervalo de costume: a leitura do histórico inteiro, que não depende da lista nem do tipo
  // dela (a vitamina posta na lista do mercado também acaba). Só refaz quando o histórico ou o dia mudam; a faixa
  // "Acho que acabou" e o selo "Na despensa" partem do resultado, sem ler tudo de novo a cada item posto no carrinho.
  const ranOut = useMemo(
    // Fim do dia de hoje: entram as compras de qualquer hora, e o dia novo refaz.
    () => ranOutItems(purchases.data ?? [], { now: new Date(`${today}T23:59:59.999`) }),
    [purchases.data, today],
  );
  // Sem o histórico carregado não dá para saber o que acabou: histórico vazio seria outra coisa.
  const historyKnown = purchases.data !== undefined;

  // Do histórico, menos o que já está na lista (a comprar ou no carrinho); o
  // que "acabou" não se repete em "comprados recentemente". O histórico pode
  // ter milhares de linhas: só refaz quando ele ou a lista mudam, não a cada
  // letra digitada no campo.
  const strips = useMemo(() => {
    if (!listKind || !items.data) return { restock: [], recent: [] };
    const inList = {
      names: new Set([...items.data.map((i) => normalizeSearch(i.name)), ...justAdded.pending]),
      productIds: new Set(items.data.flatMap((i) => (i.product_id ? [i.product_id] : []))),
    };
    // A faixa só sugere o que cabe neste tipo de lista (remédio não entra na do mercado).
    const restock = restockFrom(ranOut.filter((i) => fitsList(i.category, listKind)), { exclude: inList });
    const recent = recentPurchases(purchases.data ?? [], {
      now: new Date(`${today}T23:59:59.999`),
      listKind,
      exclude: { ...inList, names: new Set([...inList.names, ...restock.map((i) => normalizeSearch(i.name))]) },
    });
    return { restock, recent };
  }, [ranOut, purchases.data, items.data, listKind, justAdded.pending, today]);

  // O mercado escolhido só entra na conta com o nome dele carregado: enquanto os mercados não chegam (ou se
  // ele não está entre eles), a escolha fica guardada e a conta sai pelo último preço pago.
  const storeNames = useMemo(
    () => (stores.data ? new Map(stores.data.map((store) => [store.id, store.name])) : undefined),
    [stores.data],
  );
  const chosenStore = currentStoreChoice(storeChoice);
  const storeId = chosenStore && storeNames?.has(chosenStore) ? chosenStore : null;

  // Os mercados da casa se reconhecem pelo CNPJ, e o preço da casa sempre vence: sem os mercados ou sem os preços
  // da casa carregados, os de outras casas ficam de fora (ocupariam o lugar dos dela).
  const seenElsewhere = useMemo(
    () => (shared.data && stores.data && prices.data ? sharedQuotes(shared.data, prices.data, stores.data) : []),
    [shared.data, prices.data, stores.data],
  );
  // Lista no mercado (domain/listEstimate): quanto deve dar e o que está na despensa. Sem os preços, as
  // ligações ou a despensa carregados (sem internet e nunca vistos neste aparelho), mostra o que der. Só o selo
  // "Na despensa" espera o histórico de compras: sem ele, apareceria justamente no que acabou. O aparelho que
  // nunca carregou o histórico fica sem selo nenhum.
  const market = useMemo(() => {
    const all = items.data ?? [];
    const estimate = estimateList(
      all.map((i) => ({
        id: i.id,
        name: i.name,
        productId: i.product_id,
        quantity: Number(i.quantity),
        unit: i.unit,
        inCart: Boolean(i.checked_at),
      })),
      (prices.data ?? []).map((p) => ({
        productId: p.product_id,
        storeId: p.store_id,
        unit: p.unit,
        unitPrice: Number(p.unit_price),
        purchasedAt: p.purchased_at,
      })),
      { links: links.data, products: products.data ?? [], shared: seenElsewhere, storeId },
    );
    // O que o app acha que acabou não é "na despensa": tudo o que passou do costume (ranOut), sem tirar o que
    // já está na lista (é dela que se trata) e sem os cortes da faixa "Acho que acabou".
    const inPantry = historyKnown
      ? pantryHits(
          all.filter((i) => !i.checked_at).map((i) => ({ id: i.id, name: i.name, productId: i.product_id })),
          pantry.data ?? [],
          { links: links.data, today, ranOut },
        )
      : new Map<string, PantryHit>();
    const hints = new Map<string, ItemHint>();
    for (const i of all) {
      const cost = estimate.byItem.get(i.id);
      if (cost || inPantry.has(i.id)) hints.set(i.id, { cost: cost ? formatItemCost(cost) : undefined, inPantry: inPantry.has(i.id) });
    }
    return { estimate, inPantry, hints };
  }, [items.data, prices.data, links.data, products.data, seenElsewhere, pantry.data, ranOut, historyKnown, storeId, today]);

  // As ligações e os produtos dão preço ao item digitado solto. Se não chegaram (a busca falhou, ou sem internet e
  // nunca vistos neste aparelho), o cartão diz que não deu para conferir o que ficou sem preço. A lista não espera
  // por eles (abre sem internet), e enquanto a primeira busca ainda anda não há o que avisar.
  const missed = (query: { data: unknown; isPending: boolean; fetchStatus: string }) =>
    query.data === undefined && !(query.isPending && query.fetchStatus !== 'paused');
  const sourcesLoaded = !missed(links) && !missed(products);

  // Na ordem dos corredores do mercado: frescos, despensa, bebidas, casa…
  // Urgentes no topo.
  const pending = (items.data ?? []).filter((i) => !i.checked_at).sort(compareForShopping);
  const checked = (items.data ?? []).filter((i) => i.checked_at).sort(compareByAisle);
  const pendingNames = new Set(pending.map((i) => normalizeSearch(i.name)));

  // Sem internet e nunca aberta neste aparelho (nem veio com o resumo das listas): a busca fica parada até a
  // conexão voltar, e a tela diz isso em vez de girar sem fim.
  if ((list.isPending && list.fetchStatus === 'paused') || (items.isPending && items.fetchStatus === 'paused')) {
    return (
      <Screen edges={[]}>
        <Stack.Screen options={{ title: list.data?.name ?? 'Lista' }} />
        <EmptyState
          icon="wifi-off"
          title="Sem internet"
          message="Esta lista ainda não foi aberta neste aparelho. Ela aparece aqui quando a conexão voltar."
          mood="calm"
        />
      </Screen>
    );
  }
  if (list.isPending || items.isPending) return <Loading />;
  if (list.isError) return <ErrorNotice error={list.error} onRetry={() => list.refetch()} />;
  if (items.isError) return <ErrorNotice error={items.error} onRetry={() => items.refetch()} />;

  const { restock: restockItems, recent: recentItems } = strips;

  const toggleItem = (item: ShoppingListItem) =>
    toggle.mutate(
      {
        id: item.id,
        checked: !item.checked_at,
        userId: session!.user.id,
        at: new Date().toISOString(),
        token: item.toggle_token,
        nextToken: newToggleToken(),
      },
      { onError },
    );
  // Despensa não carregada (sem internet e nunca vista neste aparelho) não é
  // despensa vazia. Sem as ligações da lista também não dá para saber o que a
  // nota já guardou ("Filtro de café" é o filtro Melitta): a pessoa escolhe.
  const openStore = async (cart: ShoppingListItem[], single: boolean) => {
    const linkIndex = links.data ?? (await loadListLinks(queryClient));
    const known = pantry.data !== undefined && linkIndex !== null;
    setStoring({
      items: cart,
      rows: cartPantryRows(cart, known ? pantry.data! : null, { single, today, links: linkIndex ?? undefined }),
      single,
      pantryUnknown: !known,
    });
  };
  const clearCart = (cart: ShoppingListItem[], toPantry: CartPantryEntry[]) => {
    setStoring(null);
    clearChecked.mutate(
      {
        listId: id,
        userId: session!.user.id,
        items: cart.map((i) => ({ id: i.id, token: i.toggle_token })),
        pantry: toPantry,
        bought: cartPurchases(cart),
      },
      { onSuccess: () => emptyPhotoTrash(), onError },
    );
  };
  // Tirar vai pela fila da lista (vale sem internet). A foto que esperava internet sai junto: o item não volta.
  const removeItem = (item: ShoppingListItem) =>
    confirmAction('Remover item', `Remover "${item.name}" da lista?`, 'Remover', () => {
      setEditing(null);
      remove.remove({ id: item.id, userId: session!.user.id }, { onSuccess: () => emptyPhotoTrash(), onError });
      dropPendingPhotos(queryClient, item.id);
    });

  /**
   * "Ver preços" nos detalhes do item: leva ao produto de onde o preço sai ou, sem preço, ao produto do item
   * (o dele ou o que as notas ligaram ao nome), onde estão o histórico e os preços de outras casas.
   */
  function seePricesOf(item: ShoppingListItem) {
    const productId = seePricesProduct(
      { name: item.name, productId: item.product_id },
      market.estimate.byItem.get(item.id)?.productId,
      links.data,
    );
    if (!productId) return undefined;
    return () => {
      setEditing(null);
      router.push({ pathname: '/produto/[id]', params: { id: productId } });
    };
  }

  /** Detalhes vão pela fila da lista (valem sem internet); a foto, pela fila de fotos. */
  async function saveDetails(item: ShoppingListItem, details: ItemDetails, photo: PhotoChange) {
    setEditing(null);
    const userId = session!.user.id;
    const values: EditItemInput['values'] = {};
    if (details.name !== item.name) {
      values.name = details.name;
      // Item sem produto: a categoria (e a ilustração) segue o nome novo quando ele diz qual é.
      const guessed = guessCategory(details.name);
      if (!item.product_id && guessed !== 'outros' && guessed !== item.category) values.category = guessed;
    }
    if (details.quantity !== Number(item.quantity)) values.quantity = details.quantity;
    if (details.unit !== item.unit) values.unit = details.unit;
    if (details.notes !== (item.notes ?? null)) values.notes = details.notes;
    if (details.priority !== (item.priority ?? 'normal')) values.priority = details.priority;
    if (photo.kind !== 'keep') dropPendingPhotos(queryClient, item.id);
    if (photo.kind === 'remove' && item.photo_path) values.photo_path = null;
    if (Object.keys(values).length) edit.mutate({ id: item.id, listId: id, userId, values }, { onError });
    if (photo.kind === 'new') {
      try {
        if (!householdId) throw new Error('Família não carregada.');
        const photoKey = await keepPendingPhoto(photo.uri);
        setPhoto.mutate({ itemId: item.id, listId: id, householdId, userId, photoKey }, { onError });
      } catch (err) {
        notify('Não foi possível guardar a foto', errorMessage(err));
      }
    }
  }

  return (
    <Screen
      edges={[]}
      // Puxar atualiza também os preços (os da casa e os de outras casas), a despensa, as ligações, os produtos, os
      // mercados e o histórico: só os itens chegam sozinhos (tempo real). O indicador segue os itens, para as outras
      // buscas não o fazerem piscar.
      refreshing={items.isRefetching}
      onRefresh={() => {
        [items, prices, pantry, links, products, stores, purchases, shared].forEach((query) => void query.refetch());
        refreshTrips();
      }}
      footer={
        pending.length && list.data.kind !== 'outros' ? (
          <Button
            title="Onde comprar mais barato?"
            icon="store-search-outline"
            onPress={() => router.push({ pathname: '/lista/[id]/onde-comprar', params: { id } })}
          />
        ) : undefined
      }>
      <Stack.Screen options={{ title: list.data.name }} />
      <OfflineNotice />
      {/* Alguém da casa (ou a própria pessoa) avisou que está indo às compras desta lista. */}
      <MarketTripBanner listId={list.data.id} />

      <Card style={styles.addCard}>
        <Row>
          <View style={styles.flex}>
            <TextField
              value={name}
              onChangeText={setName}
              placeholder="Adicionar item"
              returnKeyType="done"
              onSubmitEditing={() => add()}
            />
          </View>
          <View style={styles.qty}>
            <TextField value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" accessibilityLabel="Quantidade" />
          </View>
        </Row>
        <Row style={styles.wrap}>
          {UNITS.map((u) => (
            <Chip key={u} label={u} selected={unit === u} onPress={() => setUnit(u)} />
          ))}
        </Row>
        {suggestions.products.map((p) => (
          <ListRow
            key={p.id}
            left={<CategoryIcon category={p.category} name={p.name} size={32} />}
            title={p.name}
            subtitle="Produto com histórico de preço"
            onPress={() => add(p)}
          />
        ))}
        {suggestions.common.map((item) => (
          <ListRow
            key={item.name}
            left={<CategoryIcon category={item.category} name={item.name} size={32} />}
            title={item.name}
            subtitle={getCategory(item.category).label}
            onPress={() => addCommon(item, true)}
          />
        ))}
        {name.trim() ? (
          <Button title={`Adicionar "${name.trim()}"`} icon="plus" compact onPress={() => add()} />
        ) : (
          <Button title="Escolher dos itens comuns" icon="playlist-plus" variant="secondary" compact onPress={() => setPickerOpen(true)} />
        )}
      </Card>

      {/* "Acabou" vale também no meio das compras; o resto é para montar a lista. */}
      {name.trim() ? null : <RestockStrip items={restockItems} onAdd={addRecent} />}
      {name.trim() || checked.length ? null : <RecentPurchases items={recentItems} onAdd={addRecent} />}

      {pending.length === 0 && checked.length === 0 && !recentItems.length && !restockItems.length ? (
        <EmptyState
          icon="cart-outline"
          title="Lista vazia"
          message="Digite um item ou escolha do catálogo de itens comuns da casa."
        />
      ) : null}

      {list.data.kind !== 'outros' && (pending.length || checked.length) ? (
        <ListEstimateCard
          estimate={market.estimate}
          kind={list.data.kind}
          storeId={storeId}
          storeNames={storeNames}
          sourcesLoaded={sourcesLoaded}
          onChangeStore={(store) => {
            const choice = store ? { storeId: store, at: Date.now() } : null;
            if (choice) chosenStores.set(id, choice);
            else chosenStores.delete(id);
            setStoreChoice(choice);
          }}
          inPantry={pending.filter((i) => market.inPantry.has(i.id)).map((i) => i.name)}
        />
      ) : null}

      {/* Vale com a lista vazia também: é para os outros porem o que falta. Arquivada, não. */}
      {list.data.archived_at ? null : <MarketTripAction list={list.data} />}

      {pending.length ? (
        <Section
          title={`Para comprar (${pending.length})`}
          // Para quem vai às compras e não tem o app; sem nada para comprar não há o que mandar.
          action={<Button title="Mandar a lista" variant="ghost" compact onPress={() => setSharing(true)} />}>
          <ShoppingGrid items={pending} photos={photos} hints={market.hints} onToggle={toggleItem} onOpen={setEditing} />
        </Section>
      ) : checked.length ? (
        <EmptyState
          icon="cart-check"
          title="Tudo no carrinho!"
          message="Quando guardar as compras, limpe o carrinho."
          tint="green"
        />
      ) : null}

      {checked.length ? (
        <Section
          title={`No carrinho (${checked.length})`}
          action={
            <Button title="Limpar" variant="ghost" compact onPress={() => void openStore(checked, false)} />
          }>
          <ShoppingGrid
            items={checked}
            inCart
            onToggle={toggleItem}
            photos={photos}
            hints={market.hints}
            onOpen={setEditing}
            onStore={(item) => void openStore([item], true)}
          />
        </Section>
      ) : null}

      {pending.length || checked.length ? (
        <Text variant="small" style={styles.center}>
          Toque num item para pôr no carrinho; toque de novo para devolver. Segure para ver os detalhes: foto,
          descrição e prioridade.
          {checked.length ? ' No carrinho, a geladeira guarda o item na despensa.' : ''}
        </Text>
      ) : null}
      {editing ? (
        <ListItemEditor
          item={editing}
          photoUri={editingPendingUri ?? (editing.photo_path ? (photos.signed?.[editing.photo_path] ?? null) : null)}
          photoPending={Boolean(editingPendingUri)}
          facts={(priority) =>
            itemFacts(market.estimate.byItem.get(editing.id), market.inPantry.get(editing.id), {
              storeName: (store) => storeNames?.get(store),
              chosenStore: storeId,
              promotionOnly: priority === 'promocao',
              today,
              productName: (product) => products.data?.find((p) => p.id === product)?.name,
            })
          }
          onSeePrices={seePricesOf(editing)}
          onSave={(details, photo) => saveDetails(editing, details, photo)}
          onRemove={() => removeItem(editing)}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {storing ? (
        <CartPantryModal
          rows={storing.rows}
          single={storing.single}
          pantryUnknown={storing.pantryUnknown}
          shelfLifeDays={shelfLifeDays}
          onConfirm={(toPantry) => clearCart(storing.items, toPantry)}
          onClose={() => setStoring(null)}
        />
      ) : null}
      <ListShareSheet visible={sharing} list={list.data} items={items.data} onClose={() => setSharing(false)} />
      <CommonItemsPicker
        visible={pickerOpen}
        listKind={list.data.kind}
        inList={pendingNames}
        onToggle={toggleCommon}
        onClose={() => setPickerOpen(false)}
      />
      <Button
        title="Arquivar lista"
        variant="danger"
        icon="archive-outline"
        onPress={() =>
          confirmAction('Arquivar lista', 'A lista some das telas, mas as notas e preços continuam.', 'Arquivar', () =>
            archive.mutate(undefined, { onSuccess: () => router.back(), onError }),
          )
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  wrap: { flexWrap: 'wrap' },
  qty: { width: 72 },
  addCard: { gap: space.md },
});

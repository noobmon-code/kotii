import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, type ColorValue } from 'react-native';

import { usePantry } from '@/data/home';
import { useLearnedAbbreviations } from '@/data/learnedAbbreviations';
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
  type NewListItem,
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
  useReopenList,
  useShoppingList,
  useStores,
  useToggleListItem,
} from '@/data/market';
import { marketTripErrorMessage, tripsOnline, useEndMarketTrip, useMarketTrips, useRefreshMarketTrips } from '@/data/marketTrips';
import { useOpenSharedPrices, useSharedPrices } from '@/data/sharedPrices';
import { scannedListItem } from '@/domain/barcode';
import { cartPantryRows, joinNames, type CartPantryEntry, type CartPantryRow } from '@/domain/cartPantry';
import { compareByAisle, getCategory } from '@/domain/categories';
import {
  chosenItemQuantity,
  currentStoreChoice,
  estimateList,
  openCandidates,
  formatItemCost,
  itemFacts,
  pantryHits,
  seePricesProduct,
  usualAmounts,
  type PantryHit,
} from '@/domain/listEstimate';
import { compareForShopping, repeatedQuantity } from '@/domain/listItem';
import { readListLine, type PastedItem } from '@/domain/listPaste';
import { shoppingSections } from '@/domain/listSections';
import { searchCommonItems, type CommonItem } from '@/domain/commonItems';
import { todayISO } from '@/domain/dates';
import { brandChoice, genericItem, pendingSameItem, productSuggestions, sameListItem } from '@/domain/genericItem';
import { listNameKey } from '@/domain/listLinks';
import {
  ADD_FIELD_PLACEHOLDER,
  addCardShape,
  addLineButton,
  addOptionsLabel,
  BARCODE_BUTTON,
  emptyListMessage,
  listMode,
  showsAddOptionsButton,
  showsEmptyList,
  showsSuggestions,
  suggestionRow,
  type ListMenuAction,
} from '@/domain/listMode';
import {
  ALL_IN_CART_MESSAGE,
  afterReceipt,
  asksEndTripAfterClear,
  END_TRIP_AFTER_CLEAR,
  endTripTitle,
  FINISH_LABEL,
  listFooter,
  type ConfirmedReceipt,
} from '@/domain/finishPurchase';
import { cartPurchases } from '@/domain/listQueue';
import { newDuringTrip, ownLiveTrip, type MarketTrip } from '@/domain/marketTrips';
import { formatQuantity } from '@/domain/money';
import { fitsList, listExclusion, recentPurchases, type RecentItem } from '@/domain/recentPurchases';
import { ranOutItems, restockFrom } from '@/domain/restock';
import { guessCategory, normalizeSearch } from '@/domain/search';
import { sharedQuotes } from '@/domain/sharedPrices';
import { CartPantryModal } from '@/features/CartPantryModal';
import { CommonItemsPicker } from '@/features/CommonItemsPicker';
import { useFinishPurchase } from '@/features/FinishPurchase';
import { ListEstimateCard, StorePicker } from '@/features/ListEstimateCard';
import { ListItemEditor, type ItemDetails, type PhotoChange } from '@/features/ListItemEditor';
import { ListMenu, ListMenuButton } from '@/features/ListMenu';
import { ListShareSheet } from '@/features/ListShareSheet';
import { FirstListFlow } from '@/features/onboarding/FirstListFlow';
import { MarketTripAction, MarketTripBanner, MarketTripConfirm } from '@/features/MarketTrip';
import { OfflineNotice } from '@/features/OfflineNotice';
import { PasteListModal } from '@/features/PasteListModal';
import { PriceCalculator, PriceCalculatorButton } from '@/features/PriceCalculator';
import { RenameListModal } from '@/features/RenameListModal';
import { useProductBarcode } from '@/features/ProductBarcode';
import { RecentPurchases, RestockStrip, useJustListed } from '@/features/RecentPurchases';
import { ShoppingGrid, type ItemHint } from '@/features/ShoppingGrid';
import { StaleNotice } from '@/features/health/StaleNotice';
import { useAuth, useHouseholdId } from '@/lib/auth';
import { isNetworkFailure } from '@/lib/networkErrors';
import { pruneAddedItems, useAddedItems } from '@/lib/addedItems';
import { chooseStore, restoreStoreChoice, useStoreChoice } from '@/lib/storeChoice';
import { errorMessage } from '@/lib/supabase';
import type { Product, ShoppingListItem, Unit } from '@/lib/types';
import { ActionSheet, type SheetAction } from '@/ui/ActionSheet';
import { Actions, Columns, useDesktop } from '@/ui/desktop';
import { afterPaint, askYesNo, confirmAction, notify } from '@/ui/dialogs';
import {
  Button,
  Card,
  CategoryIcon,
  EmptyState,
  ErrorNotice,
  IconBadge,
  IconButton,
  ListRow,
  Loading,
  Row,
  Screen,
  Section,
  Text,
  TextField,
} from '@/ui/primitives';
import { space } from '@/ui/theme';

/** A lista na tela é a guardada: a busca não chegou ao servidor. */
const STALE_OFFLINE = 'Sem internet agora. Mostrando a lista como estava da última vez.';

/**
 * O item que a pessoa pôs e que já está para comprar: a tela pergunta se soma a quantidade. `otherName`: digitado
 * com outro nome ("Leite" com "Leite IL Desnatado" na lista), que pode ser outro pedido. `adds`: quanto a soma põe
 * no da lista, na medida dele ("30 ovos" no "Ovos (30 un)" é uma cartela a mais, e não trinta).
 */
interface Repeated {
  listed: ShoppingListItem;
  item: NewListItem;
  otherName: boolean;
  adds: number;
  /** Veio do código lido: a pergunta não mexe no campo, onde está o que se digitou depois, para outro item. */
  scanned: boolean;
}

export default function ShoppingListScreen() {
  // `primeira=1`: a lista de mercado logo depois de criar a casa no começo (features/onboarding/FirstListFlow), com o
  // catálogo de itens comuns já aberto e a faixa que leva a chamar a casa.
  const { id, primeira } = useLocalSearchParams<{ id: string; primeira?: string }>();
  const firstList = primeira === '1';
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
  const reopen = useReopenList();
  // A ida ao mercado de quem está com o app nesta lista: o selo "Novo" e a pergunta depois de "Limpar".
  const trips = useMarketTrips();
  const endTrip = useEndMarketTrip();
  const pantry = usePantry();
  const links = useListLinks();
  // O que a despensa já tem com o nome da nota ("Az gallo 500ml") é o "Azeite" do carrinho (domain/cartPantry).
  const learned = useLearnedAbbreviations();
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

  // O que se digita no campo: o item e, quando a linha diz, a quantidade ("2 kg arroz", "leite x2"), lidos como o
  // "Colar lista" lê cada linha (domain/listPaste). Sem quantidade na linha, 1 un.
  const [name, setName] = useState('');
  const line = useMemo(() => readListLine(name), [name]);
  const [pickerOpen, setPickerOpen] = useState(firstList);
  // Guardar na despensa: um item (botão do item) ou o carrinho todo (Limpar),
  // com o carrinho como estava no toque. `finishing`: veio do "Finalizar compra" (sem a nota), e por isso termina
  // com a pergunta de encerrar a ida; `notice`: o aviso desse caminho (sem internet).
  const [storing, setStoring] = useState<{
    items: ShoppingListItem[];
    rows: CartPantryRow[];
    single: boolean;
    pantryUnknown: boolean;
    finishing: boolean;
    notice?: string;
  } | null>(null);
  const [editing, setEditing] = useState<ShoppingListItem | null>(null);
  const [sharing, setSharing] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [repeated, setRepeated] = useState<Repeated | null>(null);
  // Um menu que não chegou a aparecer (no iOS, aberto enquanto outro Modal descia) não pode prender os próximos:
  // a pergunta nova monta um menu novo.
  const [repeatedKey, setRepeatedKey] = useState(0);
  const [renaming, setRenaming] = useState(false);
  // A calculadora de preço e o menu da lista (renomear, arquivar ou reabrir), no canto de cima à direita. A
  // calculadora fica só na memória: fechar esquece o que foi digitado. O menu é desenhado pela tela, não pelo
  // cabeçalho, que só tem os dois botões.
  const [calculating, setCalculating] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const headerButtons = useCallback(
    ({ tintColor }: { tintColor?: ColorValue }) => (
      <View style={styles.headerButtons}>
        <PriceCalculatorButton tintColor={tintColor} onPress={() => setCalculating(true)} />
        <ListMenuButton tintColor={tintColor} onPress={() => setMenuOpen(true)} />
      </View>
    ),
    [],
  );
  // "Onde estou": guardado por lista neste aparelho (lib/storeChoice), também escolhido em "Onde comprar".
  const storeChoice = useStoreChoice(id);
  // O cartão da conta aberto pelo "i" e a escolha do lugar aberta pelo chip dele: aqui, e a escolha desenhada fora das
  // colunas, para o que está aberto não depender de como as colunas se arrumam em cada largura (ui/desktop): a janela
  // do navegador que cruza a largura do computador não recolhe o cartão nem fecha a escolha com a busca digitada.
  const [estimateOpen, setEstimateOpen] = useState(false);
  const [choosingStore, setChoosingStore] = useState(false);
  // A confirmação de "Estou indo ao mercado" aberta: aqui, e desenhada fora das colunas, pelo mesmo motivo.
  const [askingTrip, setAskingTrip] = useState(false);
  // Some da faixa já no toque; volta quando a lista carregada trouxer o item e ele sair dela depois.
  const justAdded = useJustListed(items.data);

  // Na ida ao mercado de quem está com o app: o selo "Novo", o modo compra e a pergunta de encerrar no fim do
  // "Finalizar compra".
  const myTrip = ownLiveTrip(trips.data ?? [], { listId: id, userId: session?.user.id, now: new Date() });
  // Montar a lista ou fazer a compra (domain/listMode): com item no carrinho (de qualquer pessoa da casa) ou com a
  // própria ida nesta lista, o cartão de pôr item recolhe ao campo, e as faixas de sugestão saem da frente.
  const mode = listMode({
    archived: Boolean(list.data?.archived_at),
    inCart: (items.data ?? []).filter((i) => i.checked_at).length,
    ownTrip: Boolean(myTrip),
  });
  // "Mais opções", no modo compra: os itens comuns, colar a lista e o código de barras de volta. Ao entrar no modo
  // compra (e ao sair dele) recolhe: a quantidade está no texto do campo, que fica, e recolher não muda o que entra.
  const [moreOptions, setMoreOptions] = useState(false);
  const [shownMode, setShownMode] = useState(mode);
  if (mode !== shownMode) {
    setShownMode(mode);
    setMoreOptions(false);
  }
  const card = addCardShape(mode, moreOptions);
  // No computador (ui/desktop) a lista fica na coluna principal: a "Lista vazia" vai para lá.
  const desktop = useDesktop();

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

  // Produtos com histórico de preço primeiro; depois itens comuns da casa. O produto aparece e entra na lista sem
  // a marca ("Leite desnatado", e não "Leite IL Desnatado"), com ele como dica de preço: a marca se escolhe na hora,
  // ou em "Marca preferida" nos detalhes. Marcas do mesmo item são uma sugestão só, com o produto que a casa usou
  // por último (a última compra ou o último preço).
  const lastUsed = useMemo(() => {
    const at = new Map<string, number>();
    const use = (productId: string | null, when: string) => {
      const time = Date.parse(when);
      if (productId && !Number.isNaN(time) && time > (at.get(productId) ?? -Infinity)) at.set(productId, time);
    };
    for (const record of purchases.data ?? []) use(record.productId, record.at);
    for (const price of prices.data ?? []) use(price.product_id, price.purchased_at);
    return at;
  }, [purchases.data, prices.data]);

  // As sugestões procuram o nome, sem a quantidade ("2 kg arr" procura "arr").
  const suggestions = useMemo(() => {
    const q = normalizeSearch(line?.name ?? '');
    if (q.length < 2) return { products: [], common: [] };
    const matched = productSuggestions(products.data ?? [], q, lastUsed);
    const seen = new Set(matched.map(({ product }) => genericItem(product.name, product.category).key));
    const common = searchCommonItems(q, 6)
      .filter((i) => !productByName.has(normalizeSearch(i.name)) && !seen.has(genericItem(i.name, i.category).key))
      .slice(0, Math.max(2, 6 - matched.length));
    return { products: matched, common };
  }, [line, products.data, productByName, lastUsed]);

  const onError = (err: unknown) => notify('Erro', errorMessage(err));

  function resetForm() {
    setName('');
  }

  /**
   * A quantidade que a linha digitada disse ("2 kg arroz"); sem ela, 1 un, a de sempre. As duas contam como pedidas,
   * como quando o campo da quantidade começava em 1: o item que já está em outra unidade pergunta se entra como
   * outro item. `counted`: a linha disse a quantidade (o item comum sem ela fica na unidade do catálogo).
   */
  const typedAmount = (): { quantity: number; unit: Unit; counted: boolean } =>
    line?.counted ? { quantity: line.quantity, unit: line.unit, counted: true } : { quantity: 1, unit: 'un', counted: false };

  /**
   * A quantidade digitada, no item escolhido nas sugestões (o produto, o item comum): a mesma, a não ser nos ovos,
   * em que vão os mesmos ovos que a linha pede ("30 ovos" é 1 "Ovos (30 un)", e não trinta cartelas;
   * chosenItemQuantity). Sem quantidade digitada, a de sempre.
   */
  const chosenQuantity = (itemName: string, category: string): number => {
    const amount = typedAmount();
    return amount.counted && line ? chosenItemQuantity(line, { name: itemName, category }) : amount.quantity;
  };

  /**
   * O item que o produto escolhido na busca põe: sem a marca (`itemName`, de genericItem), com ele como dica de preço
   * e com a quantidade que a pessoa digitou antes de escolher (o código lido não leva a linha: `scannedItem`).
   */
  const productItem = (product: Product, itemName: string): NewListItem => ({
    name: itemName,
    category: product.category,
    productId: product.id,
    quantity: chosenQuantity(itemName, product.category),
    unit: typedAmount().unit,
  });

  /** O item comum das sugestões: ligado ao produto da casa de mesmo nome, se existir. */
  const commonListItem = (item: CommonItem): NewListItem => {
    const product = productByName.get(normalizeSearch(item.name));
    const category = product?.category ?? item.category;
    const amount = typedAmount();
    return {
      name: item.name,
      category,
      productId: product?.id ?? null,
      // "30 ovos" no "Ovos (30 un)" do catálogo: uma cartela (chosenQuantity).
      quantity: chosenQuantity(item.name, category),
      // A quantidade digitada vale inteira ("2 kg banana"); sem ela, 1 na unidade do catálogo (a banana, em kg).
      unit: amount.counted ? amount.unit : item.unit,
    };
  };

  /**
   * A linha de baixo da sugestão: com a quantidade digitada, ela diz quanto o toque põe (domain/listMode,
   * suggestionRow), também quando a conta dos ovos a mudou; sem ela, a de sempre.
   */
  const suggestionLine = (item: NewListItem, subtitle: string) => suggestionRow(item.name, subtitle, line?.counted ? item : null);

  // Pôr item vai pela fila da lista: aparece na hora, também sem internet, e o campo já fica livre para o próximo.
  // Se a fila desistir, o aviso sai dela (lib/queryClient), também com a tela já fechada. O produto escolhido na
  // busca entra sem a marca (`productName`, de genericItem), com ele como dica de preço, e com a quantidade que a
  // pessoa digitou antes de escolher.
  function add(product?: Product, productName?: string) {
    if (product) {
      put(productItem(product, productName ?? product.name), false);
      return;
    }
    // A linha que não diz o que comprar ("2 kg", só um número) não põe nada.
    if (!line) return;
    const amount = typedAmount();
    put({ name: line.name, category: line.category, productId: null, quantity: amount.quantity, unit: amount.unit }, true);
  }

  /**
   * O item que o código de barras lido põe: o produto como a sugestão da busca (sem a marca, com ele como dica de
   * preço, com as mesmas travas de item repetido), com 1 un, e nunca com a linha do campo. O botão só aparece com o
   * campo vazio, e o campo não aceita texto com o leitor aberto; o que se digita enquanto o código ainda é procurado no
   * banco (a câmera já fechou) é o próximo item: não é a quantidade do produto lido, e fica no campo (`put`).
   */
  const scannedItem = (product: Product): NewListItem => ({
    name: scannedListItem(product).name,
    category: product.category,
    productId: product.id,
    quantity: 1,
    unit: 'un',
  });

  const barcode = useProductBarcode({ onProduct: (product) => put(scannedItem(product), false, true) });

  /** Item comum das sugestões: liga ao produto da casa de mesmo nome, se existir. */
  function addCommon(item: CommonItem) {
    put(commonListItem(item), false);
  }

  /**
   * Põe o item do cartão (o digitado, a sugestão da busca ou o código lido), com a quantidade digitada. O mesmo
   * item já para comprar nesta lista, com este nome ou outro ("Leite IL Desnatado" e "Leite desnatado"), não entra
   * de novo sem a pessoa dizer: ela escolhe entre somar a quantidade, pôr como outro item ou deixar como está.
   * `typed`: o nome digitado, que, diferente do pendente ("Leite" com "Leite IL Desnatado"), pode ser outro pedido.
   * Sem quantidade na linha, o item vai com 1 un, que conta como pedida (o cartão sempre pôs 1 un assim): em outra
   * unidade, a pessoa escolhe entre pôr como outro item ou deixar como está. `scanned`: o código lido, que não leva
   * a linha do campo nem limpa o campo, nem aqui nem na pergunta do item repetido (o que está nele foi digitado
   * depois de ler o código, para outro item).
   */
  function put(item: NewListItem, typed: boolean, scanned = false) {
    const listed = pendingSameItem(item, items.data ?? []);
    if (listed) {
      const otherName = typed && listNameKey(listed.name) !== listNameKey(item.name);
      if (repeated) setRepeatedKey((key) => key + 1);
      setRepeated({ listed, item, otherName, adds: scanned ? item.quantity : addsTo(listed, item), scanned });
      return;
    }
    addItem.add(item, session!.user.id);
    if (!scanned) resetForm();
  }

  /**
   * Quanto o item posto soma no mesmo item que já está na lista: a quantidade dele, a não ser quando ela veio da linha
   * digitada e o da lista é de ovos, em que vão os mesmos ovos que a linha pede, nas cartelas do da lista ("30 ovos"
   * num "Ovos (30 un)" é uma cartela a mais, "1 dz ovos" num "Ovos (dúzia)" também; chosenItemQuantity, a conta das
   * sugestões). Pôr como outro item leva o item como foi posto ("Ovos", 30 un: trinta ovos). O código lido não passa
   * por aqui: soma o 1 un dele (`put`).
   */
  const addsTo = (listed: ShoppingListItem, item: NewListItem): number =>
    line?.counted && listed.category === 'ovos' ? chosenItemQuantity(line, { name: listed.name, category: listed.category }) : item.quantity;

  /**
   * O item repetido como está agora na lista (outra pessoa pode ter mudado a quantidade); null se saiu ou foi para o
   * carrinho. No desenho, os itens dele; no toque, os guardados agora (a escolha do menu roda depois que ele fecha).
   */
  const currentListed = (listed: ShoppingListItem, from = items.data) => {
    const now = (from ?? []).find((i) => i.id === listed.id);
    return now && !now.checked_at ? now : null;
  };

  /** "Somar", no toque: soma ao item como está agora; sem ele para comprar (ou em outra unidade), um item novo. */
  function sumRepeated({ listed, item, adds, scanned }: Repeated) {
    if (!scanned) resetForm();
    const now = currentListed(listed, queryClient.getQueryData<ShoppingListItem[]>(['listItems', id]) ?? items.data);
    const again = now ? repeatedQuantity(now, { quantity: adds, unit: item.unit }) : null;
    if (now && again?.kind === 'sum') {
      edit.mutate({ id: now.id, listId: id, userId: session!.user.id, values: { quantity: again.quantity } }, { onError });
    } else addItem.add(item, session!.user.id);
  }

  /** "Já está na lista": na mesma unidade, somar; em outra unidade (ou com outro nome digitado), pôr como outro item. */
  function repeatedActions(asked: Repeated): SheetAction[] {
    const { listed, item, otherName, adds, scanned } = asked;
    const choice = repeatedQuantity(currentListed(listed) ?? listed, { quantity: adds, unit: item.unit });
    const actions: SheetAction[] = [];
    if (choice.kind === 'sum') {
      actions.push({
        label: `Somar: fica ${formatQuantity(choice.quantity, item.unit)}`,
        icon: 'plus-circle-outline',
        // A soma sai do item como está no toque, e não de quando a pergunta abriu. A quantidade nova vai pela fila de
        // edições, como nos detalhes do item: aparece na hora, também sem internet. O item que saiu da lista, foi para
        // o carrinho ou mudou de unidade nesse meio-tempo não leva a soma: a quantidade entra como um item novo.
        onPress: () => sumRepeated(asked),
      });
    }
    if (choice.kind === 'other_unit' || otherName) {
      actions.push({
        label: otherName ? `Pôr "${item.name}" como outro item` : `Pôr ${formatQuantity(item.quantity, item.unit)} como outro item`,
        icon: 'playlist-plus',
        onPress: () => {
          addItem.add(item, session!.user.id);
          if (!scanned) resetForm();
        },
      });
    }
    return actions;
  }

  function repeatedMessage({ listed: asked, item, adds }: Repeated): string {
    const listed = currentListed(asked) ?? asked;
    const now = formatQuantity(Number(listed.quantity), listed.unit);
    return repeatedQuantity(listed, item).kind === 'sum'
      ? `${listed.name} já está na lista (${now}). Somar mais ${formatQuantity(adds, item.unit)}?`
      : `${listed.name} já está na lista com ${now}, e ${formatQuantity(item.quantity, item.unit)} é outra unidade. Pôr como outro item ou deixar como está?`;
  }

  /**
   * "Colar lista": cada item novo vai pela fila, como pôr um item (aparece na hora, também sem internet). O produto
   * da casa de mesmo nome vai junto como dica de preço, como no item comum.
   */
  function addPasted(pasted: PastedItem[]) {
    setPasting(false);
    for (const item of pasted) {
      const product = productByName.get(normalizeSearch(item.name));
      addItem.add(
        {
          name: item.name,
          category: product?.category ?? item.category,
          productId: product?.id ?? null,
          quantity: item.quantity,
          unit: item.unit,
        },
        session!.user.id,
      );
    }
  }

  /**
   * Catálogo de itens comuns: um toque põe na lista, outro tira (o que está
   * para comprar com esse nome, ou o mesmo item com a marca). Pergunta antes
   * quando sai item com descrição, foto ou prioridade, com outro nome, com
   * "Marca preferida" ou mais de um. Devolve se deu certo.
   */
  async function toggleCommon(item: CommonItem, add: boolean): Promise<boolean> {
    try {
      if (add) {
        const product = productByName.get(normalizeSearch(item.name));
        // Já pendente com outro nome (a marca): o catálogo marca o item como na lista, sem pôr de novo.
        if (pendingSameItem({ name: item.name, category: item.category }, items.data ?? [])) return true;
        addItem.add(
          {
            name: item.name,
            category: product?.category ?? item.category,
            productId: product?.id ?? null,
            quantity: 1,
            unit: item.unit,
          },
          session!.user.id,
        );
        return true;
      }
      // O mesmo item, com este nome ou com a marca ("Leite desnatado" tira o "Leite IL Desnatado").
      const matches = (items.data ?? []).filter((i) => !i.checked_at && sameListItem({ name: item.name, category: item.category }, i));
      if (!matches.length) return false;
      // Foto que ainda espera internet também conta (o item ainda não tem photo_path).
      const detailed = matches.some(
        (i) => i.notes || i.photo_path || photos.pending.has(i.id) || (i.priority ?? 'normal') !== 'normal',
      );
      const confirmRemoval = (name: string, when: string) =>
        askYesNo('Tirar da lista?', `${name} ${when} descrição, foto ou prioridade. Tirar da lista mesmo assim?`, 'Tirar', 'Manter');
      // Sem perguntar, só o próprio item do catálogo, sem marca escolhida. Com outro nome ("Shampoo Seda" para
      // "Shampoo"), mais de um item ou "Marca preferida" ligada, a pessoa vê tudo o que sai antes.
      const onlyThis = matches.length === 1 && !matches[0].brand_preferred && listNameKey(matches[0].name) === listNameKey(item.name);
      if (!onlyThis) {
        const names = joinNames(matches.map((i) => i.name));
        const details = detailed ? ', com descrição, foto ou prioridade' : '';
        const leave = matches.length > 1 ? 'saem' : 'sai';
        if (!(await askYesNo('Tirar da lista?', `${names} ${leave} da lista${details}. Tirar mesmo assim?`, 'Tirar', 'Manter'))) return false;
      } else if (detailed && !(await confirmRemoval(matches[0].name, 'tem'))) return false;
      // Sem internet, ou com a fila ainda enviando (a lista daqui pode não ser a de lá): tirar vai pela fila, depois
      // do que veio antes, e no servidor só apaga o que ainda está para comprar (e, sem a confirmação, sem detalhes).
      // O que outra pessoa mudou enquanto isso volta para a lista quando ela recarregar. A foto que espera internet
      // só sai quando o item sai de verdade (data/listPhotos).
      if (removalWaitsForQueue(queryClient)) {
        for (const match of matches) {
          remove.remove({ id: match.id, userId: session!.user.id, onlyPending: true, plainOnly: !detailed }, { onError });
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
  // O aviso da falha sai da fila (lib/queryClient), como nos outros jeitos de pôr item.
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
      { onError: () => justAdded.drop([item.name]) },
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
  // Não carregou de vez (a busca falhou, ou sem internet e nunca vista neste aparelho): o costume do queijo não se conhece,
  // e a conta diz isso. Enquanto a primeira busca anda, não há o que dizer.
  const historyMissing = !historyKnown && !(purchases.isPending && purchases.fetchStatus !== 'paused');

  // Do histórico, menos o que já está na lista (a comprar ou no carrinho); o
  // que "acabou" não se repete em "comprados recentemente". O histórico pode
  // ter milhares de linhas: só refaz quando ele ou a lista mudam, não a cada
  // letra digitada no campo.
  const strips = useMemo(() => {
    if (!listKind || !items.data) return { restock: [], recent: [] };
    // Também o mesmo item com outro nome: "Leite IL Desnatado" na lista tira "Leite desnatado" das faixas.
    const inList = listExclusion(items.data, justAdded.pending);
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
  // Os preços da casa como a conta os lê.
  const estimatePrices = useMemo(
    () =>
      (prices.data ?? []).map((p) => ({
        productId: p.product_id,
        storeId: p.store_id,
        unit: p.unit,
        unitPrice: Number(p.unit_price),
        purchasedAt: p.purchased_at,
        // Quantos vinham na embalagem desse preço (os ovos da cartela de 10): os detalhes do item dizem.
        packCount: p.pack_count ?? null,
      })),
    [prices.data],
  );
  // A base aberta (domain/openPrices): o item sem preço nenhum, nem da casa nem de outras casas pelo produto, procura
  // o mesmo item, de qualquer marca, nas notas de outras casas do estado. Só depois de tudo o que dá preço ter
  // chegado (os preços, os mercados, as ligações, os produtos e os de outras casas, que podem ter falhado): antes
  // disso, todo item pareceria sem preço. A lista nunca espera por esta busca: a conta sai sem esses itens e muda
  // quando a resposta chega; parada, com erro ou sem as funções no banco, não há preço aberto e nada a dizer.
  const priceSourcesSettled =
    prices.data !== undefined &&
    stores.data !== undefined &&
    links.data !== undefined &&
    products.data !== undefined &&
    (shared.data !== undefined || shared.isError);
  const openItems = useMemo(
    () =>
      priceSourcesSettled
        ? openCandidates(
            (items.data ?? []).map((i) => ({
              id: i.id,
              name: i.name,
              productId: i.product_id,
              quantity: Number(i.quantity),
              unit: i.unit,
              category: i.category,
              brandPreferred: i.brand_preferred === true,
            })),
            estimatePrices,
            { links: links.data ?? undefined, products: products.data ?? [], shared: seenElsewhere },
          )
        : null,
    [priceSourcesSettled, items.data, estimatePrices, links.data, products.data, seenElsewhere],
  );
  const openPrices = useOpenSharedPrices(openItems, stores.data ?? undefined);
  // Na ida ao mercado de quem está com o app, o que a casa pôs depois do aviso ganha o selo "Novo".
  const tripStart = myTrip?.created_at ?? null;
  // O que este aparelho pôs nesta lista (também por outras telas e antes de reabrir o app) não ganha o selo.
  const added = useAddedItems(id);
  const newIds = useMemo(
    () => newDuringTrip(items.data ?? [], tripStart ? { created_at: tripStart } : null, added),
    [items.data, tripStart, added],
  );
  // Com as idas conhecidas: sem ida, a lista esquece o que este aparelho pôs; com ida, o que veio bem antes dela.
  const tripsKnown = Array.isArray(trips.data);
  useEffect(() => {
    if (tripsKnown) pruneAddedItems(id, tripStart);
  }, [id, tripsKnown, tripStart, added]);

  // O queijo pedido em "un" com o preço por kg conta o que a casa costuma levar dele (das notas), não 1 kg. Sem o
  // histórico (a busca falhou, ou sem internet e ele nunca chegou neste aparelho), é o 1 kg, e o detalhe do item diz
  // que o histórico não carregou. Enquanto a primeira busca ainda anda, o detalhe não diz isso.
  const usual = useMemo(() => usualAmounts(purchases.data ?? []), [purchases.data]);
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
        // Nos ovos, "12 un" (o "1 dz" colado) são doze ovos, não doze cartelas.
        category: i.category,
      })),
      estimatePrices,
      { links: links.data, products: products.data ?? [], shared: seenElsewhere, open: openPrices.quotes, usual, storeId, historyMissing },
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
      const isNew = newIds.has(i.id);
      if (cost || inPantry.has(i.id) || isNew) {
        hints.set(i.id, { cost: cost ? formatItemCost(cost) : undefined, inPantry: inPantry.has(i.id), ...(isNew ? { isNew } : {}) });
      }
    }
    return { estimate, inPantry, hints };
  }, [items.data, estimatePrices, links.data, products.data, seenElsewhere, openPrices.quotes, usual, pantry.data, ranOut, historyKnown, historyMissing, storeId, today, newIds]);

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
  // O catálogo marca o item que já está na lista, também com a marca no nome ("Leite IL Desnatado" é "Leite desnatado").
  const pendingNames = new Set(pending.flatMap((i) => [normalizeSearch(i.name), normalizeSearch(genericItem(i.name, i.category).name)]));

  // Despensa não carregada (sem internet e nunca vista neste aparelho) não é
  // despensa vazia. Sem as ligações da lista também não dá para saber o que a
  // nota já guardou ("Filtro de café" é o filtro Melitta): a pessoa escolhe.
  const openStore = async (cart: ShoppingListItem[], single: boolean, { finishing = false, notice }: { finishing?: boolean; notice?: string } = {}) => {
    const linkIndex = links.data ?? (await loadListLinks(queryClient));
    const known = pantry.data !== undefined && linkIndex !== null;
    setStoring({
      items: cart,
      rows: cartPantryRows(cart, known ? pantry.data! : null, { single, today, links: linkIndex ?? undefined, learned }),
      single,
      pantryUnknown: !known,
      finishing,
      notice,
    });
  };
  /** A ida desta lista de quem está com o app, agora. */
  const myLiveTrip = () => ownLiveTrip(trips.data ?? [], { listId: id, userId: session?.user.id, now: new Date() });
  /**
   * "Encerrar a ida?": encerrar é um pedido ao servidor; se der errado, o aviso de sempre do "Encerrar". true quando
   * a ida acabou.
   */
  const askEndTrip = async (trip: MarketTrip, title: string, message: string) => {
    if (!(await askYesNo(title, message, 'Encerrar', 'Agora não'))) return false;
    try {
      await endTrip.mutateAsync(trip.id);
      return true;
    } catch (err) {
      notify('Não deu para encerrar', marketTripErrorMessage(err, 'end'));
      return false;
    }
  };
  /**
   * Depois de limpar pelo "Finalizar compra", quem avisou que estava indo às compras desta lista decide se a ida
   * acabou. Só com internet.
   */
  const offerEndTrip = () => {
    const trip = myLiveTrip();
    if (trip && tripsOnline()) void askEndTrip(trip, endTripTitle(trip.list.kind), END_TRIP_AFTER_CLEAR);
  };
  // "Finalizar compra" (domain/finishPurchase): a nota antes de limpar. Sem a nota, o "Limpar" do carrinho todo, com o
  // carrinho como está no toque, e a pergunta de encerrar a ida no fim. Com ela, a revisão tira da lista o que casou e
  // volta para cá: aqui vem o que ela fez e, uma vez, no fim do fluxo, a pergunta de encerrar a ida. O que a nota não
  // tirou continua no carrinho.
  const finish = useFinishPurchase(id, {
    withoutReceipt: (notice) => void openStore(checked, false, { finishing: true, notice }),
    receiptConfirmed: (receipt: ConfirmedReceipt, now: number) => {
      const trip = myLiveTrip();
      const outcome = afterReceipt(receipt, {
        cart: checked.map((i) => i.id),
        trip: trip ? { kind: trip.list.kind } : null,
        online: tripsOnline(),
        now,
      });
      // A nota esvaziou o carrinho: as compras acabaram, como no "Limpar" do carrinho todo, e o mercado de "Onde
      // estou" não vale para a próxima. Com algo ainda no carrinho a pessoa pode estar no mercado: a escolha fica,
      // até ela encerrar a ida (ou limpar).
      if (outcome.cartEmpty) chooseStore(id, null);
      // Depois de a lista aparecer de novo: o aviso não sai por cima da revisão que está saindo.
      afterPaint(() => {
        if (outcome.kind === 'endTrip' && trip) {
          void askEndTrip(trip, outcome.title, outcome.message).then((ended) => {
            if (ended) chooseStore(id, null);
          });
        } else notify(outcome.title, outcome.message);
      });
    },
  });

  // Sem internet e nunca aberta neste aparelho (nem veio com o resumo das listas): a busca fica parada até a
  // conexão voltar, e a tela diz isso em vez de girar sem fim.
  if ((list.isPending && list.fetchStatus === 'paused') || (items.isPending && items.fetchStatus === 'paused')) {
    return (
      <Screen edges={[]}>
        <Stack.Screen options={{ title: list.data?.name ?? 'Lista', headerRight: undefined }} />
        <EmptyState
          icon="wifi-off"
          title="Sem internet"
          message="Esta lista ainda não foi aberta neste aparelho. Ela aparece aqui quando a conexão voltar."
        />
      </Screen>
    );
  }
  // A calculadora e o menu são só da lista carregada: o Stack junta as opções, então quem volta a carregar (a casa
  // trocada zera as buscas) tira os dois ícones, que aqui não abririam nada.
  const noHeaderButtons = <Stack.Screen options={{ headerRight: undefined }} />;
  if (list.isPending || items.isPending) {
    return (
      <>
        {noHeaderButtons}
        <Loading />
      </>
    );
  }
  // O erro só toma a tela quando não há o que mostrar. Com a lista já carregada (ou guardada), a busca que falhou
  // (voltar ao app com sinal fraco, puxar para atualizar) deixa a lista na tela, com um aviso em cima.
  if (!list.data || !items.data) {
    const failed = list.data ? items : list;
    return (
      <>
        {noHeaderButtons}
        <ErrorNotice error={failed.error} onRetry={() => failed.refetch()} />
      </>
    );
  }
  const staleError = list.isError ? list.error : items.isError ? items.error : null;

  const { restock: restockItems, recent: recentItems } = strips;
  // Arquivada (aberta pelas "Listas arquivadas"): só para ver; mexer nela é depois de "Reabrir".
  const archived = Boolean(list.data.archived_at);
  const footerAction = listFooter({ pending: pending.length, inCart: checked.length, kind: list.data.kind, archived });
  const footerButton =
    footerAction === 'finish' ? (
      <Button title={FINISH_LABEL} icon="receipt-text-check-outline" loading={finish.busy} onPress={finish.start} />
    ) : footerAction === 'whereToBuy' ? (
      <Button
        title="Onde comprar mais barato?"
        icon="store-search-outline"
        onPress={() => router.push({ pathname: '/lista/[id]/onde-comprar', params: { id } })}
      />
    ) : null;

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
  /**
   * `single`: só um item guardado pela geladeira; o "Limpar" do carrinho todo é que encerra as compras.
   * `finishing`: o limpar veio do "Finalizar compra", e só então termina com a pergunta de encerrar a ida; o "Limpar"
   * da seção "No carrinho" só esvazia (domain/finishPurchase, `asksEndTripAfterClear`).
   */
  const clearCart = (cart: ShoppingListItem[], toPantry: CartPantryEntry[], single: boolean, finishing: boolean) => {
    setStoring(null);
    // As compras acabaram: o mercado de "Onde estou" não vale para a próxima (e volta se o limpar falhar).
    const previousStore = storeChoice;
    if (!single) chooseStore(id, null);
    // A pergunta da ida se decide no toque: sem internet o limpar espera na fila, e a resposta que chegasse com a
    // conexão de volta faria a pergunta aparecer do nada. Nem depois de muito tempo, com a fila demorando.
    const onlineAtTap = !single && tripsOnline();
    const tappedAt = Date.now();
    clearChecked.mutate(
      {
        listId: id,
        userId: session!.user.id,
        items: cart.map((i) => ({ id: i.id, token: i.toggle_token })),
        pantry: toPantry,
        bought: cartPurchases(cart),
      },
      {
        onSuccess: () => {
          emptyPhotoTrash();
          if (asksEndTripAfterClear({ finishing, onlineAtTap, tappedAt, answeredAt: Date.now() })) offerEndTrip();
        },
        onError: (err) => {
          if (!single) restoreStoreChoice(id, previousStore);
          onError(err);
        },
      },
    );
  };
  // Tirar vai pela fila da lista (vale sem internet). A foto que esperava internet sai quando o item sai de verdade
  // (data/listPhotos): se o tirar não der certo, o item volta com ela.
  const removeItem = (item: ShoppingListItem) =>
    confirmAction('Remover item', `Remover "${item.name}" da lista?`, 'Remover', () => {
      setEditing(null);
      remove.remove({ id: item.id, userId: session!.user.id }, { onSuccess: () => emptyPhotoTrash(), onError });
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

  // Aberta pelas "Arquivadas" do painel das listas: daqui ela também volta (pelo cartão do aviso ou pelo menu).
  const reopenList = () => reopen.mutate(list.data!.id, { onError });
  /** O menu do cabeçalho: as mesmas perguntas e avisos dos botões que ficavam no fim da tela. */
  const onMenuAction = (action: ListMenuAction) => {
    if (action === 'rename') setRenaming(true);
    else if (action === 'reopen') reopenList();
    else {
      confirmAction('Arquivar lista', 'A lista some das telas, mas as notas e preços continuam.', 'Arquivar', () =>
        archive.mutate(undefined, { onSuccess: () => router.back(), onError }),
      );
    }
  };

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
    // A categoria escolhida nos detalhes vale mais que o chute pelo nome: o item muda de seção na tela e no texto.
    if (details.category !== item.category) values.category = details.category;
    if (details.quantity !== Number(item.quantity)) values.quantity = details.quantity;
    if (details.unit !== item.unit) values.unit = details.unit;
    if (details.notes !== (item.notes ?? null)) values.notes = details.notes;
    if (details.priority !== (item.priority ?? 'normal')) values.priority = details.priority;
    // "Marca preferida": só quando a pessoa mudou a escolha (os detalhes só a oferecem com o banco que a guarda).
    if (details.brandPreferred !== undefined && details.brandPreferred !== (item.brand_preferred === true)) {
      values.brand_preferred = details.brandPreferred;
    }
    if (photo.kind !== 'keep') dropPendingPhotos(queryClient, item.id);
    // Tira só a foto que estava no item: a que outra pessoa puser antes de esta edição chegar ao servidor fica.
    const expectedPhotoPath = photo.kind === 'remove' && item.photo_path ? item.photo_path : undefined;
    if (expectedPhotoPath) values.photo_path = null;
    if (Object.keys(values).length) edit.mutate({ id: item.id, listId: id, userId, values, expectedPhotoPath }, { onError });
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

  // "Lista vazia": no celular, onde sempre esteve (depois das faixas, que no modo de montar a lista já mostram por
  // onde começar); no computador, sempre na coluna dos itens, também com as faixas na coluna do lado (sem ela, a
  // coluna mais larga ficaria em branco), e então o texto diz que o campo e as faixas estão ao lado, e não acima.
  const suggestionCount = recentItems.length + restockItems.length;
  const stripsShown = showsSuggestions(mode, Boolean(name.trim())) && suggestionCount > 0;
  const emptyList = showsEmptyList({ mode, items: pending.length + checked.length, suggestions: suggestionCount, desktop }) ? (
    <EmptyState icon="cart-outline" title="Lista vazia" message={emptyListMessage(mode, desktop, stripsShown)} />
  ) : null;
  const addButton = line ? addLineButton(line) : null;
  // O cartão da conta só nas listas de compra com item (a de "outros" não tem preço). A escolha do lugar sai com ele.
  const estimateShown = list.data.kind !== 'outros' && pending.length + checked.length > 0;
  if (choosingStore && !estimateShown) setChoosingStore(false);
  // Arquivada (aqui ou em outro aparelho), a ida sai com a confirmação aberta, que não volta aberta ao reabrir.
  if (askingTrip && archived) setAskingTrip(false);

  return (
    <Screen
      edges={[]}
      // No computador, a largura das abas: os itens numa coluna, o cartão de pôr item e a conta na outra.
      wide
      // Puxar atualiza também os preços (os da casa e os de outras casas), a despensa, as ligações, os produtos, os
      // mercados e o histórico: só os itens chegam sozinhos (tempo real). O indicador segue os itens, para as outras
      // buscas não o fazerem piscar.
      refreshing={items.isRefetching}
      onRefresh={() => {
        [items, prices, pantry, links, products, stores, purchases, shared].forEach((query) => void query.refetch());
        void openPrices.refetch();
        refreshTrips();
      }}
      // Rodapé por contexto: com item no carrinho, "Finalizar compra"; com o carrinho vazio, "Onde comprar mais barato?".
      // No computador, encostado à direita, embaixo da coluna do lado, como as ações da revisão da nota.
      footer={footerButton && desktop ? <Actions end>{footerButton}</Actions> : (footerButton ?? undefined)}>
      <Stack.Screen options={{ title: list.data.name, headerRight: headerButtons }} />
      <OfflineNotice />
      {staleError ? (
        <StaleNotice
          message={isNetworkFailure(staleError) ? STALE_OFFLINE : undefined}
          onRetry={() => [list, items].forEach((query) => void query.refetch())}
        />
      ) : null}
      {/* Alguém da casa (ou a própria pessoa) avisou que está indo às compras desta lista. */}
      <MarketTripBanner listId={list.data.id} />
      {firstList && !archived ? (
        <FirstListFlow onCatalog={() => setPickerOpen(true)} onFinish={() => router.setParams({ primeira: undefined })} />
      ) : null}

      {/* No computador (ui/desktop): os itens na coluna principal; o cartão de pôr item, as faixas, a conta e a ida, na
          do lado, que vem primeiro na ordem do teclado e do leitor de tela, como no celular. No celular, tudo em
          sequência, como sempre. */}
      <Columns
        sideFirst
        side={
          <>
            {archived ? (
              // A lista arquivada é só para ver: reabrir fica aqui, à vista, e também no menu do cabeçalho.
              <Card style={styles.archivedCard}>
                <Row gap={space.md}>
                  <IconBadge icon="archive-outline" tone="neutral" />
                  <Text variant="body" style={styles.flex}>
                    Esta lista está arquivada. Reabra para mexer nela.
                  </Text>
                </Row>
                <Button
                  title="Reabrir lista"
                  variant="secondary"
                  icon="archive-arrow-up-outline"
                  loading={reopen.isPending}
                  onPress={reopenList}
                />
              </Card>
            ) : (
              <>
                <Card style={styles.addCard}>
                  {/* O campo é o mesmo nos dois jeitos do cartão (o primeiro filho da primeira linha): o modo compra que
                      começa no meio da digitação (alguém pôs no carrinho) não tira o teclado nem o texto. A quantidade
                      vem do que se digita ("2 kg arroz"), e o botão de pôr mostra como ficou. "Mais opções" só abre o
                      que fica embaixo do campo vazio: com o texto, o botão de pôr toma esse lugar, e ele sai junto
                      (aberto, não mostraria nada). */}
                  <Row>
                    <View style={styles.flex}>
                      <TextField
                        value={name}
                        onChangeText={setName}
                        placeholder={ADD_FIELD_PLACEHOLDER}
                        returnKeyType="done"
                        onSubmitEditing={() => add()}
                      />
                    </View>
                    {showsAddOptionsButton(mode, Boolean(name.trim())) ? (
                      <IconButton
                        icon={moreOptions ? 'chevron-up' : 'tune-variant'}
                        label={addOptionsLabel(barcode.available)}
                        color="primary"
                        expanded={moreOptions}
                        onPress={() => setMoreOptions(!moreOptions)}
                      />
                    ) : null}
                  </Row>
                  {/* Com a quantidade digitada, cada sugestão diz quanto põe ("Frutas e verduras · 2 kg"), como o botão de pôr. */}
                  {suggestions.products.map(({ product, name: itemName }) => {
                    const row = suggestionLine(productItem(product, itemName), 'Produto com histórico de preço');
                    return (
                      <ListRow
                        key={product.id}
                        left={<CategoryIcon category={product.category} name={itemName} size={32} />}
                        title={itemName}
                        subtitle={row.subtitle}
                        accessibilityLabel={row.label}
                        onPress={() => add(product, itemName)}
                      />
                    );
                  })}
                  {suggestions.common.map((item) => {
                    const row = suggestionLine(commonListItem(item), getCategory(item.category).label);
                    return (
                      <ListRow
                        key={item.name}
                        left={<CategoryIcon category={item.category} name={item.name} size={32} />}
                        title={item.name}
                        subtitle={row.subtitle}
                        accessibilityLabel={row.label}
                        onPress={() => addCommon(item)}
                      />
                    );
                  })}
                  {addButton ? (
                    <Button title={addButton.title} accessibilityLabel={addButton.label} icon="plus" compact onPress={() => add()} />
                  ) : !name.trim() && card === 'inteiro' ? (
                    <>
                      <Button title="Escolher dos itens comuns" icon="playlist-plus" variant="secondary" compact onPress={() => setPickerOpen(true)} />
                      {/* Colar e ler o código numa linha só; sem o código de barras (o banco sem a tabela), colar sozinho. */}
                      <Row style={styles.tools}>
                        <Button
                          title="Colar lista"
                          icon="clipboard-text-outline"
                          variant="ghost"
                          compact
                          style={styles.tool}
                          onPress={() => setPasting(true)}
                        />
                        {barcode.available ? (
                          <Button
                            title={BARCODE_BUTTON.title}
                            accessibilityLabel={BARCODE_BUTTON.label}
                            icon="barcode-scan"
                            variant="ghost"
                            compact
                            style={styles.tool}
                            loading={barcode.busy}
                            onPress={barcode.start}
                          />
                        ) : null}
                      </Row>
                    </>
                  ) : null}
                </Card>
                {/* Para montar a lista; no modo compra (e enquanto se digita) saem da frente, e a lista sobe. */}
                {showsSuggestions(mode, Boolean(name.trim())) ? (
                  <>
                    <RestockStrip items={restockItems} onAdd={addRecent} />
                    <RecentPurchases items={recentItems} onAdd={addRecent} />
                  </>
                ) : null}
              </>
            )}

            {desktop ? null : emptyList}

            {estimateShown ? (
              <ListEstimateCard
                estimate={market.estimate}
                storeId={storeId}
                storeNames={storeNames}
                sourcesLoaded={sourcesLoaded}
                inPantry={pending.filter((i) => market.inPantry.has(i.id)).map((i) => i.name)}
                open={estimateOpen}
                onToggle={() => setEstimateOpen((open) => !open)}
                onChooseStore={() => setChoosingStore(true)}
              />
            ) : null}

            {/* Vale com a lista vazia também: é para os outros porem o que falta. Arquivada, não. */}
            {archived ? null : <MarketTripAction list={list.data} onPress={() => setAskingTrip(true)} />}
          </>
        }>
        {desktop ? emptyList : null}

        {pending.length ? (
          <Section
            title={`Para comprar (${pending.length})`}
            // Para quem vai às compras e não tem o app; sem nada para comprar não há o que mandar.
            action={<Button title="Mandar a lista" variant="ghost" compact onPress={() => setSharing(true)} />}>
            {/* Lista longa: os urgentes e depois os corredores, com os mesmos títulos do texto do WhatsApp. */}
            {shoppingSections(pending).map((section) => (
              <View key={section.title ?? 'lista'} style={styles.aisle}>
                {section.title ? (
                  <Text variant="small" accessibilityRole="header">
                    {section.title}
                  </Text>
                ) : null}
                <ShoppingGrid
                  items={section.items}
                  photos={photos}
                  hints={market.hints}
                  readOnly={archived}
                  onToggle={toggleItem}
                  onOpen={setEditing}
                />
              </View>
            ))}
          </Section>
        ) : checked.length && !archived ? (
          // O "Finalizar compra" também aqui, no estado (o do rodapé, o primário, fica no mesmo lugar de sempre).
          <EmptyState
            icon="cart-check"
            title="Tudo no carrinho!"
            message={ALL_IN_CART_MESSAGE}
            tint="green"
            action={
              <Button title={FINISH_LABEL} icon="receipt-text-check-outline" variant="secondary" loading={finish.busy} onPress={finish.start} />
            }
          />
        ) : null}

        {checked.length ? (
          <Section
            title={`No carrinho (${checked.length})`}
            action={
              archived ? undefined : <Button title="Limpar" variant="ghost" compact onPress={() => void openStore(checked, false)} />
            }>
            <ShoppingGrid
              items={checked}
              inCart
              readOnly={archived}
              onToggle={toggleItem}
              photos={photos}
              hints={market.hints}
              onOpen={setEditing}
              onStore={archived ? undefined : (item) => void openStore([item], true)}
            />
          </Section>
        ) : null}

        {(pending.length || checked.length) && !archived ? (
          <Text variant="small" style={styles.center}>
            Toque num item para pôr no carrinho; toque de novo para devolver. Segure para ver os detalhes: foto,
            descrição, prioridade e categoria.
            {checked.length ? ' No carrinho, a geladeira guarda o item na despensa.' : ''}
          </Text>
        ) : null}
      </Columns>
      {/* As janelas que o cartão de pôr item, o da conta e a ida abrem ficam fora das colunas, e o aberto delas, com a
          tela: nada disso depende de como as colunas se arrumam em cada largura (ui/desktop), e a janela do navegador
          que cruza a largura do computador mantém o código digitado no leitor, a busca de "Qual produto é este?" e a de
          "Onde você está comprando?", e a pergunta de avisar a casa aberta. */}
      {archived ? null : barcode.element}
      {archived ? null : <MarketTripConfirm list={list.data} visible={askingTrip} onClose={() => setAskingTrip(false)} />}
      {estimateShown ? (
        <StorePicker
          estimate={market.estimate}
          kind={list.data.kind}
          storeId={storeId}
          storeNames={storeNames}
          visible={choosingStore}
          onChangeStore={(store) => chooseStore(id, store)}
          onClose={() => setChoosingStore(false)}
        />
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
              category: editing.category,
            })
          }
          brand={editing.product_id ? brandChoice(products.data?.find((p) => p.id === editing.product_id)) : null}
          onSeePrices={seePricesOf(editing)}
          // Arquivada: os detalhes só para ver.
          onSave={archived ? undefined : (details, photo) => saveDetails(editing, details, photo)}
          onRemove={archived ? undefined : () => removeItem(editing)}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {storing ? (
        <CartPantryModal
          rows={storing.rows}
          single={storing.single}
          pantryUnknown={storing.pantryUnknown}
          notice={storing.notice}
          shelfLifeDays={shelfLifeDays}
          onConfirm={(toPantry) => clearCart(storing.items, toPantry, storing.single, storing.finishing)}
          onClose={() => setStoring(null)}
        />
      ) : null}
      <ListShareSheet visible={sharing} list={list.data} items={items.data} onClose={() => setSharing(false)} />
      {pasting ? <PasteListModal pending={items.data} onAdd={addPasted} onClose={() => setPasting(false)} /> : null}
      <ActionSheet
        key={repeatedKey}
        visible={Boolean(repeated)}
        title="Já está na lista"
        message={repeated ? repeatedMessage(repeated) : undefined}
        actions={repeated ? repeatedActions(repeated) : []}
        cancelLabel="Deixar como está"
        // Deixar como está limpa o campo, como antes; o nome digitado diferente do da lista fica nele, para pôr depois, e
        // o código lido não mexe nele (o que está lá foi digitado depois, para outro item).
        onClose={() => {
          if (repeated && !repeated.otherName && !repeated.scanned) resetForm();
          setRepeated(null);
        }}
      />
      <CommonItemsPicker
        visible={pickerOpen}
        listKind={list.data.kind}
        inList={pendingNames}
        onToggle={toggleCommon}
        onClose={() => setPickerOpen(false)}
      />
      <ListMenu
        visible={menuOpen}
        title={list.data.name}
        archived={archived}
        onAction={onMenuAction}
        onClose={() => setMenuOpen(false)}
      />
      {renaming ? <RenameListModal listId={list.data.id} name={list.data.name} onClose={() => setRenaming(false)} /> : null}
      {calculating ? <PriceCalculator onClose={() => setCalculating(false)} /> : null}
      {finish.element}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  // "Colar lista" e o código de barras lado a lado, cada um com a sua metade (do tamanho do rótulo, no mínimo); num
  // celular de 320 que não os comporta, o segundo desce.
  tools: { flexWrap: 'wrap' },
  tool: { flexGrow: 1, paddingHorizontal: space.xs },
  addCard: { gap: space.md },
  archivedCard: { gap: space.md },
  aisle: { gap: space.sm },
  headerButtons: { flexDirection: 'row', alignItems: 'center' },
});

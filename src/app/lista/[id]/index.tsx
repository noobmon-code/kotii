import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

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
  useShoppingList,
  useStores,
  useToggleListItem,
} from '@/data/market';
import { useRefreshMarketTrips } from '@/data/marketTrips';
import { useSharedPrices } from '@/data/sharedPrices';
import { scannedListItem } from '@/domain/barcode';
import { cartPantryRows, joinNames, type CartPantryEntry, type CartPantryRow } from '@/domain/cartPantry';
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
import { compareForShopping, repeatedQuantity } from '@/domain/listItem';
import type { PastedItem } from '@/domain/listPaste';
import { shoppingSections } from '@/domain/listSections';
import { searchCommonItems, type CommonItem } from '@/domain/commonItems';
import { todayISO } from '@/domain/dates';
import { brandChoice, genericItem, pendingSameItem, productSuggestions, sameListItem } from '@/domain/genericItem';
import { listNameKey } from '@/domain/listLinks';
import { cartPurchases } from '@/domain/listQueue';
import { formatQuantity, parseDecimal } from '@/domain/money';
import { fitsList, listExclusion, recentPurchases, type RecentItem } from '@/domain/recentPurchases';
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
import { PasteListModal } from '@/features/PasteListModal';
import { useProductBarcode } from '@/features/ProductBarcode';
import { RecentPurchases, RestockStrip, useJustListed } from '@/features/RecentPurchases';
import { ShoppingGrid, type ItemHint } from '@/features/ShoppingGrid';
import { StaleNotice } from '@/features/health/StaleNotice';
import { useAuth, useHouseholdId } from '@/lib/auth';
import { isNetworkFailure } from '@/lib/networkErrors';
import { errorMessage } from '@/lib/supabase';
import { UNITS, type Product, type ShoppingListItem, type Unit } from '@/lib/types';
import { ActionSheet, type SheetAction } from '@/ui/ActionSheet';
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

/** A lista na tela é a guardada: a busca não chegou ao servidor. */
const STALE_OFFLINE = 'Sem internet agora. Mostrando a lista como estava da última vez.';

/**
 * O mercado em que a pessoa disse estar, por lista, e quando disse: vale por
 * uma ida ao mercado (currentStoreChoice), enquanto o app está aberto.
 */
const chosenStores = new Map<string, StoreChoice>();

/**
 * O item que a pessoa pôs e que já está para comprar: a tela pergunta se soma a quantidade. `otherName`: digitado
 * com outro nome ("Leite" com "Leite IL Desnatado" na lista), que pode ser outro pedido.
 */
interface Repeated {
  listed: ShoppingListItem;
  item: NewListItem;
  otherName: boolean;
  /** A pessoa disse a quantidade (o campo preenchido ou outra unidade escolhida). */
  given: boolean;
}

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
  const [pasting, setPasting] = useState(false);
  const [repeated, setRepeated] = useState<Repeated | null>(null);
  // Um menu que não chegou a aparecer (no iOS, aberto enquanto outro Modal descia) não pode prender os próximos:
  // a pergunta nova monta um menu novo.
  const [repeatedKey, setRepeatedKey] = useState(0);
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

  const suggestions = useMemo(() => {
    const q = normalizeSearch(name);
    if (q.length < 2) return { products: [], common: [] };
    const matched = productSuggestions(products.data ?? [], q, lastUsed);
    const seen = new Set(matched.map(({ product }) => genericItem(product.name, product.category).key));
    const common = searchCommonItems(q, 6)
      .filter((i) => !productByName.has(normalizeSearch(i.name)) && !seen.has(genericItem(i.name, i.category).key))
      .slice(0, Math.max(2, 6 - matched.length));
    return { products: matched, common };
  }, [name, products.data, productByName, lastUsed]);

  const onError = (err: unknown) => notify('Erro', errorMessage(err));

  function resetForm() {
    setName('');
    setQuantity('1');
    setUnit('un');
  }

  /** O campo da quantidade preenchido ou outra unidade escolhida: a pessoa disse quanto quer. */
  const quantityGiven = () => quantity.trim() !== '' || unit !== 'un';

  // Pôr item vai pela fila da lista: aparece na hora, também sem internet, e o campo já fica livre para o próximo.
  // Se a fila desistir, o aviso sai dela (lib/queryClient), também com a tela já fechada. O produto escolhido na
  // busca entra sem a marca (`productName`, de genericItem), com ele como dica de preço.
  function add(product?: Product, productName?: string) {
    const itemName = productName ?? product?.name ?? name.trim();
    if (!itemName) return;
    const qty = parseDecimal(quantity) ?? 1;
    put(
      {
        name: itemName,
        category: product?.category ?? guessCategory(itemName),
        productId: product?.id ?? null,
        quantity: qty > 0 ? qty : 1,
        unit,
      },
      !product && !productName,
      quantityGiven(),
    );
  }

  // O código de barras lido põe o produto como a sugestão da busca: sem a marca, com ele como dica de preço, e com
  // as mesmas travas de item repetido.
  const barcode = useProductBarcode({ onProduct: (product) => add(product, scannedListItem(product).name) });

  /** Item comum das sugestões: liga ao produto da casa de mesmo nome, se existir. */
  function addCommon(item: CommonItem) {
    const product = productByName.get(normalizeSearch(item.name));
    const qty = parseDecimal(quantity) ?? 1;
    put(
      {
        name: item.name,
        category: product?.category ?? item.category,
        productId: product?.id ?? null,
        quantity: qty > 0 ? qty : 1,
        // A unidade do catálogo vale, a menos que o usuário tenha escolhido outra.
        unit: unit !== 'un' ? unit : item.unit,
      },
      false,
      quantityGiven(),
    );
  }

  /**
   * Põe o item do cartão (o digitado, a sugestão da busca ou o código lido), com a quantidade do campo. O mesmo
   * item já para comprar nesta lista, com este nome ou outro ("Leite IL Desnatado" e "Leite desnatado"), não entra
   * de novo sem a pessoa dizer: ela escolhe entre somar a quantidade, pôr como outro item ou deixar como está.
   * `typed`: o nome digitado, que, diferente do pendente ("Leite" com "Leite IL Desnatado"), pode ser outro pedido.
   * `given`: a pessoa disse a quantidade; sem ela, o item que já está em outra unidade só ganha o aviso, como antes.
   */
  function put(item: NewListItem, typed: boolean, given: boolean) {
    const listed = pendingSameItem(item, items.data ?? []);
    if (listed) {
      const otherName = typed && listNameKey(listed.name) !== listNameKey(item.name);
      if (!otherName && repeatedQuantity(listed, { ...item, given }).kind === 'listed') {
        notify('Já estava na lista', `${listed.name} já está na lista para comprar.`);
        resetForm();
        return;
      }
      if (repeated) setRepeatedKey((key) => key + 1);
      setRepeated({ listed, item, otherName, given });
      return;
    }
    addItem.add(item, session!.user.id);
    resetForm();
  }

  /**
   * O item repetido como está agora na lista (outra pessoa pode ter mudado a quantidade); null se saiu ou foi para o
   * carrinho. No desenho, os itens dele; no toque, os guardados agora (a escolha do menu roda depois que ele fecha).
   */
  const currentListed = (listed: ShoppingListItem, from = items.data) => {
    const now = (from ?? []).find((i) => i.id === listed.id);
    return now && !now.checked_at ? now : null;
  };

  /** "Somar", no toque: soma ao item como está agora; sem ele para comprar (ou em outra unidade), um item novo. */
  function sumRepeated(listed: ShoppingListItem, item: NewListItem) {
    resetForm();
    const now = currentListed(listed, queryClient.getQueryData<ShoppingListItem[]>(['listItems', id]) ?? items.data);
    const again = now ? repeatedQuantity(now, item) : null;
    if (now && again?.kind === 'sum') {
      edit.mutate({ id: now.id, listId: id, userId: session!.user.id, values: { quantity: again.quantity } }, { onError });
    } else addItem.add(item, session!.user.id);
  }

  /** "Já está na lista": na mesma unidade, somar; em outra unidade (ou com outro nome digitado), pôr como outro item. */
  function repeatedActions({ listed, item, otherName, given }: Repeated): SheetAction[] {
    const choice = repeatedQuantity(currentListed(listed) ?? listed, { ...item, given });
    const actions: SheetAction[] = [];
    if (choice.kind === 'sum') {
      actions.push({
        label: `Somar: fica ${formatQuantity(choice.quantity, item.unit)}`,
        icon: 'plus-circle-outline',
        // A soma sai do item como está no toque, e não de quando a pergunta abriu. A quantidade nova vai pela fila de
        // edições, como nos detalhes do item: aparece na hora, também sem internet. O item que saiu da lista, foi para
        // o carrinho ou mudou de unidade nesse meio-tempo não leva a soma: a quantidade entra como um item novo.
        onPress: () => sumRepeated(listed, item),
      });
    }
    if (choice.kind === 'other_unit' || otherName) {
      actions.push({
        label: otherName ? `Pôr "${item.name}" como outro item` : `Pôr ${formatQuantity(item.quantity, item.unit)} como outro item`,
        icon: 'playlist-plus',
        onPress: () => {
          addItem.add(item, session!.user.id);
          resetForm();
        },
      });
    }
    return actions;
  }

  function repeatedMessage({ listed: asked, item, given }: Repeated): string {
    const listed = currentListed(asked) ?? asked;
    const now = formatQuantity(Number(listed.quantity), listed.unit);
    const more = formatQuantity(item.quantity, item.unit);
    if (repeatedQuantity(listed, { ...item, given }).kind === 'listed') return `${listed.name} já está na lista (${now}).`;
    return repeatedQuantity(listed, item).kind === 'sum'
      ? `${listed.name} já está na lista (${now}). Somar mais ${more}?`
      : `${listed.name} já está na lista com ${now}, e ${more} é outra unidade. Pôr como outro item ou deixar como está?`;
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
  // O catálogo marca o item que já está na lista, também com a marca no nome ("Leite IL Desnatado" é "Leite desnatado").
  const pendingNames = new Set(pending.flatMap((i) => [normalizeSearch(i.name), normalizeSearch(genericItem(i.name, i.category).name)]));

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
        />
      </Screen>
    );
  }
  if (list.isPending || items.isPending) return <Loading />;
  // O erro só toma a tela quando não há o que mostrar. Com a lista já carregada (ou guardada), a busca que falhou
  // (voltar ao app com sinal fraco, puxar para atualizar) deixa a lista na tela, com um aviso em cima.
  if (!list.data) return <ErrorNotice error={list.error} onRetry={() => list.refetch()} />;
  if (!items.data) return <ErrorNotice error={items.error} onRetry={() => items.refetch()} />;
  const staleError = list.isError ? list.error : items.isError ? items.error : null;

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
      rows: cartPantryRows(cart, known ? pantry.data! : null, { single, today, links: linkIndex ?? undefined, learned }),
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
      {staleError ? (
        <StaleNotice
          message={isNetworkFailure(staleError) ? STALE_OFFLINE : undefined}
          onRetry={() => [list, items].forEach((query) => void query.refetch())}
        />
      ) : null}
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
        {suggestions.products.map(({ product, name: itemName }) => (
          <ListRow
            key={product.id}
            left={<CategoryIcon category={product.category} name={itemName} size={32} />}
            title={itemName}
            subtitle="Produto com histórico de preço"
            onPress={() => add(product, itemName)}
          />
        ))}
        {suggestions.common.map((item) => (
          <ListRow
            key={item.name}
            left={<CategoryIcon category={item.category} name={item.name} size={32} />}
            title={item.name}
            subtitle={getCategory(item.category).label}
            onPress={() => addCommon(item)}
          />
        ))}
        {name.trim() ? (
          <Button title={`Adicionar "${name.trim()}"`} icon="plus" compact onPress={() => add()} />
        ) : (
          <>
            <Button title="Escolher dos itens comuns" icon="playlist-plus" variant="secondary" compact onPress={() => setPickerOpen(true)} />
            <Button
              title="Colar lista"
              icon="clipboard-text-outline"
              variant="ghost"
              compact
              onPress={() => setPasting(true)}
            />
          </>
        )}
        {barcode.available ? (
          <Button
            title="Ler código de barras"
            icon="barcode-scan"
            variant="ghost"
            compact
            loading={barcode.busy}
            onPress={barcode.start}
          />
        ) : null}
      </Card>
      {barcode.element}

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
          {/* Lista longa: os urgentes e depois os corredores, com os mesmos títulos do texto do WhatsApp. */}
          {shoppingSections(pending).map((section) => (
            <View key={section.title ?? 'lista'} style={styles.aisle}>
              {section.title ? (
                <Text variant="small" accessibilityRole="header">
                  {section.title}
                </Text>
              ) : null}
              <ShoppingGrid items={section.items} photos={photos} hints={market.hints} onToggle={toggleItem} onOpen={setEditing} />
            </View>
          ))}
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
          descrição, prioridade e categoria.
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
          brand={editing.product_id ? brandChoice(products.data?.find((p) => p.id === editing.product_id)) : null}
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
      {pasting ? <PasteListModal pending={items.data} onAdd={addPasted} onClose={() => setPasting(false)} /> : null}
      <ActionSheet
        key={repeatedKey}
        visible={Boolean(repeated)}
        title="Já está na lista"
        message={repeated ? repeatedMessage(repeated) : undefined}
        actions={repeated ? repeatedActions(repeated) : []}
        cancelLabel="Deixar como está"
        // Deixar como está limpa o campo, como antes; o nome digitado diferente do da lista fica nele, para pôr depois.
        onClose={() => {
          if (repeated && !repeated.otherName) resetForm();
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
  aisle: { gap: space.sm },
});

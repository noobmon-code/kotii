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
  newToggleToken,
  useAddListItem,
  useArchiveList,
  useClearCheckedItems,
  useListQueueBusy,
  useDeleteListItem,
  useEditListItem,
  useListItems,
  useProducts,
  usePurchaseRecords,
  useShoppingList,
  useToggleListItem,
} from '@/data/market';
import { cartPantryRows, type CartPantryEntry, type CartPantryRow } from '@/domain/cartPantry';
import { compareByAisle, getCategory } from '@/domain/categories';
import { compareForShopping } from '@/domain/listItem';
import { searchCommonItems, type CommonItem } from '@/domain/commonItems';
import { todayISO } from '@/domain/dates';
import { parseDecimal } from '@/domain/money';
import { recentPurchases, type RecentItem } from '@/domain/recentPurchases';
import { restockSuggestions } from '@/domain/restock';
import { guessCategory, normalizeSearch } from '@/domain/search';
import { CartPantryModal } from '@/features/CartPantryModal';
import { CommonItemsPicker } from '@/features/CommonItemsPicker';
import { ListItemEditor, type ItemDetails, type PhotoChange } from '@/features/ListItemEditor';
import { OfflineNotice } from '@/features/OfflineNotice';
import { RecentPurchases, RestockStrip, useJustListed } from '@/features/RecentPurchases';
import { ShoppingGrid } from '@/features/ShoppingGrid';
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

export default function ShoppingListScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const list = useShoppingList(id);
  const items = useListItems(id);
  const products = useProducts();
  const purchases = usePurchaseRecords();
  const addItem = useAddListItem(id);
  const toggle = useToggleListItem(id);
  const remove = useDeleteListItem(id);
  const clearChecked = useClearCheckedItems();
  // Limpar só com a fila da lista vazia: as marcações guardadas já chegaram
  // ao servidor e não há outro limpar andando.
  const syncing = useListQueueBusy();
  const archive = useArchiveList(id);
  const pantry = usePantry();
  const edit = useEditListItem(id);
  const setPhoto = useSetListItemPhoto();
  const householdId = useHouseholdId();
  const queryClient = useQueryClient();

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

  function add(product?: Product) {
    const itemName = product?.name ?? name.trim();
    if (!itemName) return;
    const qty = parseDecimal(quantity) ?? 1;
    addItem.mutate(
      {
        name: itemName,
        category: product?.category ?? guessCategory(itemName),
        productId: product?.id ?? null,
        quantity: qty > 0 ? qty : 1,
        unit,
      },
      { onSuccess: resetForm, onError },
    );
  }

  /** Item comum: liga ao produto da casa de mesmo nome, se existir. */
  function addCommon(item: CommonItem, fromForm = false) {
    const product = productByName.get(normalizeSearch(item.name));
    const qty = fromForm ? (parseDecimal(quantity) ?? 1) : 1;
    addItem.mutate(
      {
        name: product?.name ?? item.name,
        category: product?.category ?? item.category,
        productId: product?.id ?? null,
        quantity: qty > 0 ? qty : 1,
        // A unidade do catálogo vale, a menos que o usuário tenha escolhido outra.
        unit: fromForm && unit !== 'un' ? unit : item.unit,
      },
      { onSuccess: fromForm ? resetForm : undefined, onError },
    );
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
        await addItem.mutateAsync({
          name: product?.name ?? item.name,
          category: product?.category ?? item.category,
          productId: product?.id ?? null,
          quantity: 1,
          unit: item.unit,
        });
        return true;
      }
      const key = normalizeSearch(item.name);
      const matches = (items.data ?? []).filter((i) => !i.checked_at && normalizeSearch(i.name) === key);
      if (!matches.length) return false;
      // Foto que ainda espera internet também conta (o item ainda não tem photo_path).
      const detailed = matches.some(
        (i) => i.notes || i.photo_path || photos.pending.has(i.id) || (i.priority ?? 'normal') !== 'normal',
      );
      if (
        detailed &&
        !(await askYesNo(
          'Tirar da lista?',
          `${matches[0].name} tem descrição, foto ou prioridade. Tirar da lista mesmo assim?`,
          'Tirar',
          'Manter',
        ))
      ) {
        return false;
      }
      // A foto que espera internet só sai depois que o item saiu: se apagar
      // falhar (sem internet), o item fica com ela.
      for (const match of matches) {
        await remove.mutateAsync(match.id);
        dropPendingPhotos(queryClient, match.id);
      }
      emptyPhotoTrash();
      return true;
    } catch (err) {
      onError(err);
      return false;
    }
  }

  // mutateAsync: com dois toques seguidos, os callbacks de mutate só valem
  // para o último, e uma falha do primeiro deixaria o item escondido.
  async function addRecent(item: Omit<RecentItem, 'times'>) {
    justAdded.add([item.name]);
    try {
      await addItem.mutateAsync({
        name: item.name,
        category: item.category,
        productId: item.productId,
        quantity: item.quantity,
        unit: item.unit,
      });
    } catch (err) {
      justAdded.drop([item.name]);
      onError(err);
    }
  }


  // Do histórico, menos o que já está na lista (a comprar ou no carrinho); o
  // que "acabou" não se repete em "comprados recentemente". O histórico pode
  // ter milhares de linhas: só refaz quando ele ou a lista mudam, não a cada
  // letra digitada no campo.
  const listKind = list.data?.kind;
  const today = todayISO();
  const strips = useMemo(() => {
    if (!listKind || !items.data) return { restock: [], recent: [] };
    const inList = {
      names: new Set([...items.data.map((i) => normalizeSearch(i.name)), ...justAdded.pending]),
      productIds: new Set(items.data.flatMap((i) => (i.product_id ? [i.product_id] : []))),
    };
    // Fim do dia de hoje: entram as compras de qualquer hora, e o dia novo refaz.
    const now = new Date(`${today}T23:59:59.999`);
    const restock = restockSuggestions(purchases.data ?? [], { now, listKind, exclude: inList });
    const recent = recentPurchases(purchases.data ?? [], {
      now,
      listKind,
      exclude: { ...inList, names: new Set([...inList.names, ...restock.map((i) => normalizeSearch(i.name))]) },
    });
    return { restock, recent };
  }, [purchases.data, items.data, listKind, justAdded.pending, today]);

  // Na ordem dos corredores do mercado: frescos, despensa, bebidas, casa…
  // Urgentes no topo.
  const pending = (items.data ?? []).filter((i) => !i.checked_at).sort(compareForShopping);
  const checked = (items.data ?? []).filter((i) => i.checked_at).sort(compareByAisle);
  const pendingNames = new Set(pending.map((i) => normalizeSearch(i.name)));

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
  // Despensa não carregada (sem internet e nunca vista neste aparelho) não é despensa vazia.
  const openStore = (cart: ShoppingListItem[], single: boolean) =>
    setStoring({
      items: cart,
      rows: cartPantryRows(cart, pantry.data ?? null, { single, today }),
      single,
      pantryUnknown: pantry.data === undefined,
    });
  const clearCart = (cart: ShoppingListItem[], toPantry: CartPantryEntry[]) => {
    setStoring(null);
    clearChecked.mutate(
      { listId: id, userId: session!.user.id, items: cart.map((i) => ({ id: i.id, token: i.toggle_token })), pantry: toPantry },
      { onSuccess: () => emptyPhotoTrash(), onError },
    );
  };
  const removeItem = (item: ShoppingListItem) =>
    confirmAction('Remover item', `Remover "${item.name}" da lista?`, 'Remover', () => {
      setEditing(null);
      void removeWithPhoto(item.id);
    });

  /**
   * Apaga o item e só então a foto que esperava internet (se apagar falhar, o
   * item fica com ela). mutateAsync: com duas remoções seguidas, os callbacks
   * de mutate só valeriam para a última.
   */
  async function removeWithPhoto(itemId: string) {
    try {
      await remove.mutateAsync(itemId);
      dropPendingPhotos(queryClient, itemId);
      emptyPhotoTrash();
    } catch (err) {
      onError(err);
    }
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
      refreshing={items.isRefetching}
      onRefresh={() => items.refetch()}
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
          <Button title={`Adicionar "${name.trim()}"`} icon="plus" compact onPress={() => add()} loading={addItem.isPending} />
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

      {pending.length ? (
        <Section title={`Para comprar (${pending.length})`}>
          <ShoppingGrid items={pending} photos={photos} onToggle={toggleItem} onOpen={setEditing} />
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
            <Button
              title="Limpar"
              variant="ghost"
              compact
              disabled={syncing}
              onPress={() => openStore(checked, false)}
            />
          }>
          <ShoppingGrid
            items={checked}
            inCart
            onToggle={toggleItem}
            photos={photos}
            onOpen={setEditing}
            onStore={syncing ? undefined : (item) => openStore([item], true)}
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

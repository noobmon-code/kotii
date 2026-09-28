import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  newToggleToken,
  useAddListItem,
  useArchiveList,
  useClearCheckedItems,
  useListQueueBusy,
  useDeleteListItem,
  useListItems,
  useProducts,
  useShoppingList,
  useToggleListItem,
} from '@/data/market';
import { compareByAisle, getCategory } from '@/domain/categories';
import { searchCommonItems, type CommonItem } from '@/domain/commonItems';
import { parseDecimal } from '@/domain/money';
import { guessCategory, normalizeSearch } from '@/domain/search';
import { CommonItemsPicker } from '@/features/CommonItemsPicker';
import { OfflineNotice } from '@/features/OfflineNotice';
import { ShoppingGrid } from '@/features/ShoppingGrid';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/supabase';
import { UNITS, type Product, type ShoppingListItem, type Unit } from '@/lib/types';
import { confirmAction, notify } from '@/ui/dialogs';
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
  const addItem = useAddListItem(id);
  const toggle = useToggleListItem(id);
  const remove = useDeleteListItem(id);
  const clearChecked = useClearCheckedItems(id);
  // Limpar só com a fila da lista vazia: as marcações guardadas já chegaram
  // ao servidor e não há outro limpar andando.
  const syncing = useListQueueBusy();
  const archive = useArchiveList(id);

  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState<Unit>('un');
  const [pickerOpen, setPickerOpen] = useState(false);

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

  // Na ordem dos corredores do mercado: frescos, despensa, bebidas, casa…
  const pending = (items.data ?? []).filter((i) => !i.checked_at).sort(compareByAisle);
  const checked = (items.data ?? []).filter((i) => i.checked_at).sort(compareByAisle);
  const pendingNames = new Set(pending.map((i) => normalizeSearch(i.name)));

  if (list.isPending || items.isPending) return <Loading />;
  if (list.isError) return <ErrorNotice error={list.error} onRetry={() => list.refetch()} />;
  if (items.isError) return <ErrorNotice error={items.error} onRetry={() => items.refetch()} />;

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
  const removeItem = (item: ShoppingListItem) =>
    confirmAction('Remover item', `Remover "${item.name}" da lista?`, 'Remover', () => remove.mutate(item.id, { onError }));

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

      {pending.length === 0 && checked.length === 0 ? (
        <EmptyState
          icon="cart-outline"
          title="Lista vazia"
          message="Digite um item ou escolha do catálogo de itens comuns da casa."
        />
      ) : null}

      {pending.length ? (
        <Section title={`Para comprar (${pending.length})`}>
          <ShoppingGrid items={pending} onToggle={toggleItem} onRemove={removeItem} />
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
              onPress={() => clearChecked.mutate({ listId: id }, { onError })}
            />
          }>
          <ShoppingGrid items={checked} inCart onToggle={toggleItem} onRemove={removeItem} />
        </Section>
      ) : null}

      {pending.length || checked.length ? (
        <Text variant="small" style={styles.center}>
          Toque num item para pôr no carrinho; toque de novo para devolver. Segure para remover.
        </Text>
      ) : null}
      <CommonItemsPicker
        visible={pickerOpen}
        listKind={list.data.kind}
        inList={pendingNames}
        onAdd={(item) => addCommon(item)}
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

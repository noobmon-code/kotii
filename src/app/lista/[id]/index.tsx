import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  useAddListItem,
  useArchiveList,
  useClearCheckedItems,
  useDeleteListItem,
  useListItems,
  useProducts,
  useShoppingList,
  useToggleListItem,
} from '@/data/market';
import { getCategory } from '@/domain/categories';
import { searchCommonItems, type CommonItem } from '@/domain/commonItems';
import { formatQuantity, parseDecimal } from '@/domain/money';
import { guessCategory, normalizeSearch } from '@/domain/search';
import { CommonItemsPicker } from '@/features/CommonItemsPicker';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/supabase';
import { UNITS, type Product, type ShoppingListItem, type Unit } from '@/lib/types';
import { confirmAction, notify } from '@/ui/dialogs';
import {
  Button,
  Card,
  CategoryIcon,
  CheckCircle,
  Chip,
  EmptyState,
  ErrorNotice,
  ListCard,
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

  const pending = (items.data ?? []).filter((i) => !i.checked_at);
  const checked = (items.data ?? []).filter((i) => i.checked_at);
  const pendingNames = new Set(pending.map((i) => normalizeSearch(i.name)));
  const groups = new Map<string, ShoppingListItem[]>();
  for (const item of pending) groups.set(item.category, [...(groups.get(item.category) ?? []), item]);
  const byCategory = [...groups.entries()].sort(([a], [b]) =>
    getCategory(a).label.localeCompare(getCategory(b).label),
  );

  if (list.isPending || items.isPending) return <Loading />;
  if (list.isError) return <ErrorNotice error={list.error} onRetry={() => list.refetch()} />;
  if (items.isError) return <ErrorNotice error={items.error} onRetry={() => items.refetch()} />;

  const renderItem = (item: ShoppingListItem) => (
    <ListRow
      key={item.id}
      left={<CategoryIcon category={item.category} size={36} />}
      title={item.name}
      subtitle={formatQuantity(item.quantity, item.unit)}
      dimmed={Boolean(item.checked_at)}
      onLongPress={() =>
        confirmAction('Remover item', `Remover "${item.name}" da lista?`, 'Remover', () =>
          remove.mutate(item.id, { onError }),
        )
      }
      right={
        <CheckCircle
          checked={Boolean(item.checked_at)}
          label={`Marcar ${item.name}`}
          onPress={() => toggle.mutate({ id: item.id, checked: !item.checked_at, userId: session!.user.id }, { onError })}
        />
      }
    />
  );

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
            left={<CategoryIcon category={p.category} size={32} />}
            title={p.name}
            subtitle="Produto com histórico de preço"
            onPress={() => add(p)}
          />
        ))}
        {suggestions.common.map((item) => (
          <ListRow
            key={item.name}
            left={<CategoryIcon category={item.category} size={32} />}
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

      {byCategory.map(([category, categoryItems]) => (
        <Section key={category} title={getCategory(category).label}>
          <ListCard>{categoryItems.map(renderItem)}</ListCard>
        </Section>
      ))}

      {checked.length ? (
        <Section
          title={`No carrinho (${checked.length})`}
          action={<Button title="Limpar" variant="ghost" compact onPress={() => clearChecked.mutate(undefined, { onError })} />}>
          <ListCard>{checked.map(renderItem)}</ListCard>
        </Section>
      ) : null}

      <Text variant="small" style={styles.center}>
        Toque e segure um item para removê-lo.
      </Text>
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

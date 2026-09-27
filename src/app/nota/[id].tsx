import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useProducts, useStores } from '@/data/market';
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
import { CATEGORIES, getCategory } from '@/domain/categories';
import { formatBRDate, formatShortDate, parseBRDate, toISODate } from '@/domain/dates';
import { formatBRL, formatQuantity } from '@/domain/money';
import {
  buildConfirmPayload,
  resolveItem,
  type CatalogProduct,
  type ItemOverride,
  type ResolvedItem,
} from '@/domain/receiptReview';
import { ReceiptItemEditor } from '@/features/ReceiptItemEditor';
import { errorMessage } from '@/lib/supabase';
import type { ReceiptItem } from '@/lib/types';
import { confirmAction, notify } from '@/ui/dialogs';
import { PickerModal } from '@/ui/PickerModal';
import {
  Badge,
  Button,
  Card,
  CategoryIcon,
  Chip,
  ErrorNotice,
  Icon,
  IconButton,
  ListRow,
  Loading,
  Row,
  Screen,
  Section,
  Text,
  TextField,
} from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

type Picker =
  | { kind: 'store' }
  | { kind: 'product'; itemId: string; query: string }
  | { kind: 'category'; itemId: string };

type Editing = { item?: ReceiptItem } | null;

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

  const [overrides, setOverrides] = useState<Record<string, ItemOverride>>({});
  const [picker, setPicker] = useState<Picker | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [dateText, setDateText] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const catalog = useMemo(
    () => new Map<string, CatalogProduct>((products.data ?? []).map((p) => [p.id, p])),
    [products.data],
  );

  const onError = (err: unknown) => notify('Erro', errorMessage(err));

  if (receiptQuery.isPending || products.isPending) return <Loading />;
  if (receiptQuery.isError) return <ErrorNotice error={receiptQuery.error} onRetry={() => receiptQuery.refetch()} />;

  const { receipt, items } = receiptQuery.data;
  const isDraft = receipt.status === 'draft';
  const purchasedOn = toISODate(new Date(receipt.purchased_at));
  const itemsTotal = Math.round(items.reduce((s, i) => s + i.total_price, 0) * 100) / 100;
  const totalMismatch = receipt.total != null && Math.abs(receipt.total - itemsTotal) > 0.05;

  const override = (itemId: string, patch: ItemOverride) =>
    setOverrides((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }));

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

  function doConfirm() {
    const payload = buildConfirmPayload(items, overrides, catalog, purchasedOn);
    const run = () =>
      confirm.mutate(payload, {
        onSuccess: () => {
          const pantryCount = payload.filter((p) => p.pantry).length;
          notify(
            'Nota salva',
            pantryCount ? `${pantryCount} ${pantryCount === 1 ? 'item foi' : 'itens foram'} para a despensa.` : undefined,
          );
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

  async function showImage() {
    if (!receipt.image_path) return;
    const url = await receiptImageUrl(receipt.image_path);
    if (url) setImageUrl(url);
    else notify('Imagem indisponível');
  }

  function saveEditedItem(values: ItemValues) {
    saveItem.mutate(
      { id: editing?.item?.id, values, position: items.length },
      { onSuccess: () => setEditing(null), onError },
    );
  }

  const pickerItem = picker && picker.kind !== 'store' ? items.find((i) => i.id === picker.itemId) : undefined;

  return (
    <Screen
      edges={[]}
      footer={
        isDraft ? (
          <Button
            title={`Confirmar nota (${items.length} ${items.length === 1 ? 'item' : 'itens'})`}
            icon="check"
            onPress={doConfirm}
            loading={confirm.isPending}
            disabled={!items.length}
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
          <TextField
            label="Data da compra"
            value={dateText ?? formatBRDate(purchasedOn)}
            onChangeText={setDateText}
            onBlur={commitDate}
            onSubmitEditing={commitDate}
            keyboardType="numbers-and-punctuation"
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
        {receipt.image_path ? <Button title="Ver foto da nota" icon="image-outline" variant="secondary" compact onPress={showImage} /> : null}
      </Card>

      {isDraft ? (
        <Text variant="muted">
          Confira cada item. Produtos ligam a mesma coisa entre mercados diferentes — é isso que permite comparar preços.
        </Text>
      ) : null}

      <Section
        title={`Itens (${items.length})`}
        action={isDraft ? <Button title="Item" icon="plus" variant="ghost" compact onPress={() => setEditing({})} /> : null}>
        {items.map((item) => {
          const resolved = resolveItem(item, overrides[item.id], catalog, purchasedOn);
          return isDraft ? (
            <DraftItemCard
              key={item.id}
              item={item}
              resolved={resolved}
              onEdit={() => setEditing({ item })}
              onPickProduct={() =>
                setPicker({ kind: 'product', itemId: item.id, query: resolved.productName ?? item.suggested_name ?? '' })
              }
              onPickCategory={() => setPicker({ kind: 'category', itemId: item.id })}
              onTogglePantry={() => override(item.id, { pantry: !resolved.pantry })}
              onChangeExpiry={(iso) => override(item.id, { expiryManual: true, expiresOn: iso })}
            />
          ) : (
            <Card key={item.id}>
              <ListRow
                left={<CategoryIcon category={resolved.category} name={catalog.get(item.product_id ?? '')?.name ?? item.raw_description} size={36} />}
                title={item.product_id ? (catalog.get(item.product_id)?.name ?? item.raw_description) : item.raw_description}
                subtitle={`${formatQuantity(item.quantity, item.unit)} × ${formatBRL(item.unit_price)}`}
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
            () => deleteReceipt.mutate(receipt.image_path, { onSuccess: () => router.back(), onError }),
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
        onSelect={(productId) => {
          if (pickerItem) override(pickerItem.id, { product: { kind: 'existing', productId } });
          setPicker(null);
        }}
        extraActions={(query) =>
          pickerItem ? (
            <View style={styles.gapSm}>
              {query ? (
                <Button
                  title={`Novo produto "${query}"`}
                  icon="plus"
                  variant="secondary"
                  compact
                  onPress={() => {
                    const current = resolveItem(pickerItem, overrides[pickerItem.id], catalog, purchasedOn);
                    override(pickerItem.id, { product: { kind: 'new', name: query, category: current.category } });
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
                  override(pickerItem.id, { product: { kind: 'none' }, pantry: false });
                  setPicker(null);
                }}
              />
            </View>
          ) : null
        }
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

      <ImageViewer url={imageUrl} onClose={() => setImageUrl(null)} />
    </Screen>
  );
}

function DraftItemCard({
  item,
  resolved,
  onEdit,
  onPickProduct,
  onPickCategory,
  onTogglePantry,
  onChangeExpiry,
}: {
  item: ReceiptItem;
  resolved: ResolvedItem;
  onEdit: () => void;
  onPickProduct: () => void;
  onPickCategory: () => void;
  onTogglePantry: () => void;
  onChangeExpiry: (iso: string | null) => void;
}) {
  const [expiryText, setExpiryText] = useState<string | null>(null);
  const { product } = resolved;

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

  return (
    <Card style={styles.gapSm}>
      <Row>
        <CategoryIcon category={resolved.category} name={item.raw_description} size={36} />
        <View style={styles.flex}>
          <Text variant="small">{item.raw_description}</Text>
          <Text variant="muted">
            {formatQuantity(item.quantity, item.unit)} × {formatBRL(item.unit_price)}
          </Text>
        </View>
        <Text variant="label">{formatBRL(item.total_price)}</Text>
        <IconButton icon="pencil-outline" label={`Editar ${item.raw_description}`} onPress={onEdit} />
      </Row>
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
              <TextField
                value={expiryText ?? (resolved.expiresOn ? formatBRDate(resolved.expiresOn) : '')}
                placeholder="Validade"
                onChangeText={setExpiryText}
                onBlur={commitExpiry}
                onSubmitEditing={commitExpiry}
                keyboardType="numbers-and-punctuation"
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

function ImageViewer({ url, onClose }: { url: string | null; onClose: () => void }) {
  const c = useColors();
  return (
    <Modal visible={Boolean(url)} animationType="fade" onRequestClose={onClose}>
      <SafeAreaView style={[styles.flex, { backgroundColor: c.background }]}>
        <Row style={styles.viewerHeader}>
          <Text variant="heading" style={styles.flex}>
            Foto da nota
          </Text>
          <IconButton icon="close" label="Fechar" onPress={onClose} />
        </Row>
        {url ? <Image source={{ uri: url }} style={styles.flex} contentFit="contain" /> : null}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space.md },
  gapSm: { gap: space.sm },
  wrap: { flexWrap: 'wrap' },
  between: { justifyContent: 'space-between' },
  storeRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  expiry: { width: 140 },
  viewerHeader: { padding: space.lg },
});

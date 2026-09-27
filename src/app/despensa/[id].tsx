import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { usePantryItem, useSavePantryItem } from '@/data/home';
import { CATEGORIES, getCategory } from '@/domain/categories';
import { formatBRDate, parseBRDate, todayISO } from '@/domain/dates';
import { parseDecimal } from '@/domain/money';
import { estimateExpiry } from '@/domain/pantry';
import { guessCategory } from '@/domain/search';
import { errorMessage } from '@/lib/supabase';
import { UNITS, type PantryItem, type Unit } from '@/lib/types';
import { notify } from '@/ui/dialogs';
import { PickerModal } from '@/ui/PickerModal';
import { Button, CategoryIcon, Chip, ErrorNotice, Loading, Row, Screen, Text, TextField } from '@/ui/primitives';
import { space } from '@/ui/theme';

export default function PantryItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'novo';
  const item = usePantryItem(isNew ? undefined : id);

  if (!isNew && item.isPending) return <Loading />;
  if (!isNew && item.isError) return <ErrorNotice error={item.error} />;
  return <PantryForm item={isNew ? undefined : item.data} />;
}

function PantryForm({ item }: { item?: PantryItem }) {
  const save = useSavePantryItem();
  const [name, setName] = useState(item?.name ?? '');
  const [category, setCategory] = useState<string | null>(item?.category ?? null);
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 1).replace('.', ','));
  const [unit, setUnit] = useState<Unit>(item?.unit ?? 'un');
  const [purchased, setPurchased] = useState(formatBRDate(item?.purchased_on ?? todayISO()));
  // null = validade não tocada pelo usuário nesta tela.
  const [expires, setExpires] = useState<string | null>(null);
  const [pickingCategory, setPickingCategory] = useState(false);

  const effectiveCategory = category ?? guessCategory(name);
  const purchasedISO = parseBRDate(purchased);
  const estimate = purchasedISO ? estimateExpiry({ purchasedOn: purchasedISO, category: effectiveCategory }) : null;
  const untouchedExpires = item
    ? item.expires_on
      ? formatBRDate(item.expires_on)
      : ''
    : estimate?.expiresOn
      ? formatBRDate(estimate.expiresOn)
      : '';
  const expiresText = expires ?? untouchedExpires;
  const typed = expires != null;

  function submit() {
    const qty = parseDecimal(quantity);
    if (!name.trim() || !qty || qty <= 0 || !purchasedISO) {
      notify('Confira os dados', 'Nome, quantidade e data da compra (dd/mm/aaaa) são obrigatórios.');
      return;
    }
    const expiresISO = expiresText.trim() ? parseBRDate(expiresText) : null;
    if (expiresText.trim() && !expiresISO) {
      notify('Validade inválida', 'Use o formato dd/mm/aaaa ou deixe em branco.');
      return;
    }
    save.mutate(
      {
        id: item?.id,
        productId: item?.product_id,
        values: {
          name: name.trim(),
          category: effectiveCategory,
          quantity: qty,
          unit,
          purchased_on: purchasedISO,
          expires_on: expiresISO,
          expiry_source: !expiresISO ? null : typed ? 'manual' : item ? item.expiry_source : (estimate?.source ?? null),
        },
      },
      { onSuccess: () => router.back(), onError: (err) => notify('Erro', errorMessage(err)) },
    );
  }

  return (
    <Screen edges={[]}>
      <TextField label="Item" value={name} onChangeText={setName} placeholder="Ex.: Leite integral" autoFocus={!item} />
      <Row>
        <CategoryIcon category={effectiveCategory} name={name} />
        <Chip label={getCategory(effectiveCategory).label} icon="tag-outline" onPress={() => setPickingCategory(true)} />
      </Row>
      <Row gap={space.md}>
        <View style={styles.flex}>
          <TextField label="Quantidade" value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" />
        </View>
        <View style={styles.flex}>
          <TextField label="Comprado em" value={purchased} onChangeText={setPurchased} keyboardType="numbers-and-punctuation" />
        </View>
      </Row>
      <Row style={styles.wrap}>
        {UNITS.map((u) => (
          <Chip key={u} label={u} selected={unit === u} onPress={() => setUnit(u)} />
        ))}
      </Row>
      <TextField
        label="Validade"
        value={expiresText}
        onChangeText={setExpires}
        placeholder="dd/mm/aaaa"
        keyboardType="numbers-and-punctuation"
        hint={
          !item && !typed && estimate?.expiresOn
            ? 'Estimada pela categoria. Corrija se precisar.'
            : item?.product_id
              ? 'Se você corrigir, o produto aprende a validade para a próxima compra.'
              : 'Deixe em branco para itens sem validade.'
        }
      />
      <Button title="Salvar" onPress={submit} loading={save.isPending} />
      {item?.product_id ? (
        <Text variant="small">Item ligado a um produto com histórico de preço.</Text>
      ) : null}

      <PickerModal
        visible={pickingCategory}
        title="Categoria"
        options={CATEGORIES.map((c) => ({ id: c.key, title: c.label, left: <CategoryIcon category={c.key} size={32} /> }))}
        onClose={() => setPickingCategory(false)}
        onSelect={(key) => {
          setCategory(key);
          setPickingCategory(false);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { flexWrap: 'wrap' },
});

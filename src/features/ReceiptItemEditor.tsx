import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { ItemValues } from '@/data/receipts';
import { parseDecimal } from '@/domain/money';
import { UNITS, type Unit } from '@/lib/types';
import { notify } from '@/ui/dialogs';
import { Button, Chip, IconButton, Row, Text, TextField } from '@/ui/primitives';
import { MAX_WIDTH, space, useColors } from '@/ui/theme';

const toField = (n: number | undefined, digits: number) =>
  n == null ? '' : n.toLocaleString('pt-BR', { maximumFractionDigits: digits, useGrouping: false });

/** Formulário de um item de nota (corrigir leitura da IA ou digitar à mão). */
export function ReceiptItemEditor({
  initial,
  onSave,
  onDelete,
  onClose,
  saving,
}: {
  initial?: ItemValues;
  onSave: (values: ItemValues) => void;
  onDelete?: () => void;
  onClose: () => void;
  saving?: boolean;
}) {
  const c = useColors();
  const [description, setDescription] = useState(initial?.raw_description ?? '');
  const [quantity, setQuantity] = useState(toField(initial?.quantity ?? 1, 3));
  const [unit, setUnit] = useState<Unit>(initial?.unit ?? 'un');
  const [unitPrice, setUnitPrice] = useState(toField(initial?.unit_price, 4));
  const [total, setTotal] = useState(toField(initial?.total_price, 2));

  function save() {
    const qty = parseDecimal(quantity);
    const price = parseDecimal(unitPrice);
    const sum = parseDecimal(total);
    if (!description.trim() || !qty || qty <= 0) {
      notify('Confira o item', 'Informe a descrição e uma quantidade maior que zero.');
      return;
    }
    if (price == null && sum == null) {
      notify('Confira o item', 'Informe o preço unitário ou o total.');
      return;
    }
    const unit_price = price ?? Math.round(((sum ?? 0) / qty) * 10000) / 10000;
    const total_price = sum ?? Math.round(unit_price * qty * 100) / 100;
    onSave({ raw_description: description.trim(), quantity: qty, unit, unit_price, total_price });
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.flex, { backgroundColor: c.background }]}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Row>
            <Text variant="heading" style={styles.flex}>
              {initial ? 'Editar item' : 'Novo item'}
            </Text>
            <IconButton icon="close" label="Fechar" onPress={onClose} />
          </Row>
          <TextField label="Descrição" value={description} onChangeText={setDescription} autoFocus={!initial} />
          <Row gap={space.md}>
            <View style={styles.flex}>
              <TextField label="Quantidade" value={quantity} onChangeText={setQuantity} keyboardType="decimal-pad" />
            </View>
            <View style={styles.flex}>
              <TextField label="Preço unitário" value={unitPrice} onChangeText={setUnitPrice} keyboardType="decimal-pad" placeholder="0,00" />
            </View>
          </Row>
          <Row style={styles.wrap}>
            {UNITS.map((u) => (
              <Chip key={u} label={u} selected={unit === u} onPress={() => setUnit(u)} />
            ))}
          </Row>
          <TextField
            label="Total do item"
            value={total}
            onChangeText={setTotal}
            keyboardType="decimal-pad"
            placeholder="Calculado se vazio"
            hint="Com desconto no item, use o valor pago."
          />
          <Button title="Salvar item" onPress={save} loading={saving} />
          {onDelete ? <Button title="Remover item" variant="danger" icon="trash-can-outline" onPress={onDelete} /> : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { flexWrap: 'wrap' },
  content: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', padding: space.lg, gap: space.lg },
});

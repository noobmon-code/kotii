import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { ItemValues } from '@/data/receipts';
import { FILL_VALUE_LABEL, SAVE_VALUE_LABEL } from '@/domain/receiptGap';
import { readReceiptItem, receiptItemForm } from '@/domain/receiptItem';
import { UNITS, type Unit } from '@/lib/types';
import { Backdrop } from '@/ui/Backdrop';
import { notify } from '@/ui/dialogs';
import { Button, Chip, IconButton, Row, Text, TextField } from '@/ui/primitives';
import { MAX_WIDTH, space, useColors } from '@/ui/theme';

/**
 * Formulário de um item de nota (corrigir leitura da IA ou digitar à mão).
 * `valueOnly` é o da nota já confirmada: só o valor do item que ficou sem
 * (quantidade, preço, unidade e total); a descrição aparece, mas não muda.
 */
export function ReceiptItemEditor({
  initial,
  valueOnly,
  onSave,
  onDelete,
  onClose,
  saving,
}: {
  initial?: ItemValues;
  valueOnly?: boolean;
  onSave: (values: ItemValues) => void;
  onDelete?: () => void;
  onClose: () => void;
  saving?: boolean;
}) {
  const c = useColors();
  // Como o formulário abre (o item sem valor, com os preços em branco) está em domain/receiptItem.
  const [start] = useState(() => receiptItemForm(initial));
  const [description, setDescription] = useState(start.description);
  const [quantity, setQuantity] = useState(start.quantity);
  const [unit, setUnit] = useState<Unit>(initial?.unit ?? 'un');
  const [unitPrice, setUnitPrice] = useState(start.unitPrice);
  const [total, setTotal] = useState(start.total);

  function save() {
    // Com o item como abriu: o que abriu sem valor ganha o aviso que fala do zero.
    const result = readReceiptItem({ description, quantity, unitPrice, total }, initial);
    if (!result.ok) return notify('Confira o item', result.message);
    onSave({ ...result.values, unit });
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.flex, { backgroundColor: c.background }]}>
        <Backdrop />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Row>
            <Text variant="heading" style={styles.flex}>
              {valueOnly ? FILL_VALUE_LABEL : initial ? 'Editar item' : 'Novo item'}
            </Text>
            <IconButton icon="close" label="Fechar" onPress={onClose} />
          </Row>
          {valueOnly ? (
            <Text variant="muted">{description}</Text>
          ) : (
            <TextField label="Descrição" value={description} onChangeText={setDescription} autoFocus={!initial} />
          )}
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
          <Button title={valueOnly ? SAVE_VALUE_LABEL : 'Salvar item'} onPress={save} loading={saving} />
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

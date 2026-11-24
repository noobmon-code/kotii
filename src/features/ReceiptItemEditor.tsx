import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import type { ItemValues } from '@/data/receipts';
import type { FreezeDays } from '@/domain/freezer';
import { ADD_ITEM_INTRO, ADD_ITEM_SAVE, ADD_ITEM_TITLE, type AddedItemPantry, type AddedItemPantryChoice } from '@/domain/receiptCorrection';
import { FILL_VALUE_LABEL, SAVE_VALUE_LABEL } from '@/domain/receiptGap';
import { readReceiptItem, receiptItemForm } from '@/domain/receiptItem';
import { ReceiptPantryChoice } from '@/features/ReceiptPantryChoice';
import { UNITS, type Unit } from '@/lib/types';
import { notify } from '@/ui/dialogs';
import { Button, Chip, IconButton, Row, Text, TextField } from '@/ui/primitives';
import { SheetModal } from '@/ui/SheetModal';
import { MAX_WIDTH, space } from '@/ui/theme';

/** O que a tela passa ao formulário do item que faltou numa nota confirmada (domain/receiptCorrection). */
export interface AddingItem {
  /** "Produto: Feijão carioca (Grãos, massas e cereais)". */
  productLine: string;
  /** A descrição com que o campo abre: o nome do produto. */
  description: string;
  /** A despensa começa no padrão da categoria, como na revisão. */
  pantryDefault: boolean;
  /** A despensa como o cartão mostra, pelo que está nos campos (addedItemPantry): o "Congelei" depende do nome e da unidade. */
  pantryOf: (choice: AddedItemPantryChoice, description: string, unit: Unit) => AddedItemPantry;
  /** Os dias do congelador (useFreezer): null sem ele no banco. */
  freezer: FreezeDays | null;
}

const DEFAULT_TOTAL_HINT = 'Com desconto no item, use o valor pago.';

/**
 * Formulário de um item de nota (corrigir leitura da IA ou digitar à mão).
 * `valueOnly` é o da nota já confirmada: só o valor do item que ficou sem
 * (quantidade, preço, unidade e total); a descrição aparece, mas não muda.
 * `adding` é o do item que faltou numa nota confirmada: o produto já foi
 * escolhido, e o formulário tem a despensa (o chip e o "Congelei") e nada de
 * remover; `onSave` recebe também o que foi escolhido da despensa.
 */
export function ReceiptItemEditor({
  initial,
  valueOnly,
  adding,
  gapHint,
  onSave,
  onDelete,
  onClose,
  saving,
}: {
  initial?: ItemValues;
  valueOnly?: boolean;
  adding?: AddingItem;
  /** Embaixo do total, no item que faltou: quanto falta para o total da nota (domain/receiptGap addedItemHint). */
  gapHint?: string | null;
  onSave: (values: ItemValues, pantry: AddedItemPantryChoice) => void;
  onDelete?: () => void;
  onClose: () => void;
  saving?: boolean;
}) {
  // Como o formulário abre (o item sem valor, com os preços em branco) está em domain/receiptItem.
  const [start] = useState(() => (adding ? { ...receiptItemForm(), description: adding.description } : receiptItemForm(initial)));
  const [description, setDescription] = useState(start.description);
  const [quantity, setQuantity] = useState(start.quantity);
  const [unit, setUnit] = useState<Unit>(initial?.unit ?? 'un');
  const [unitPrice, setUnitPrice] = useState(start.unitPrice);
  const [total, setTotal] = useState(start.total);
  // A despensa do item que faltou: o chip e o "Congelei" (undefined: o que o nome diz, como na revisão).
  const [pantry, setPantry] = useState(adding?.pantryDefault ?? false);
  const [frozen, setFrozen] = useState<boolean | undefined>(undefined);

  function save() {
    // Com o item como abriu: o que abriu sem valor ganha o aviso que fala do zero.
    const result = readReceiptItem({ description, quantity, unitPrice, total }, initial);
    if (!result.ok) return notify('Confira o item', result.message);
    onSave({ ...result.values, unit }, { pantry, frozen });
  }

  const title = adding ? ADD_ITEM_TITLE : valueOnly ? FILL_VALUE_LABEL : initial ? 'Editar item' : 'Novo item';
  return (
    <SheetModal onClose={onClose}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Row>
          <Text variant="heading" style={styles.flex}>
            {title}
          </Text>
          <IconButton icon="close" label="Fechar" onPress={onClose} />
        </Row>
        {adding ? (
          <View style={styles.gapXs}>
            <Text variant="small">{adding.productLine}</Text>
            <Text variant="muted">{ADD_ITEM_INTRO}</Text>
          </View>
        ) : null}
        {valueOnly ? (
          <Text variant="muted">{description}</Text>
        ) : (
          // O item que faltou abre com o nome do produto na descrição: o teclado só abre quando a pessoa toca.
          <TextField label="Descrição" value={description} onChangeText={setDescription} autoFocus={!initial && !adding} />
        )}
        {valueOnly ? (
          // Na nota confirmada a quantidade e a unidade já foram para a despensa: aqui só se lê, e só o preço muda.
          <>
            <Text variant="muted">
              {quantity} {unit}
            </Text>
            <TextField label="Preço unitário" value={unitPrice} onChangeText={setUnitPrice} keyboardType="decimal-pad" placeholder="0,00" />
          </>
        ) : (
          <>
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
          </>
        )}
        <TextField
          label="Total do item"
          value={total}
          onChangeText={setTotal}
          keyboardType="decimal-pad"
          placeholder="Calculado se vazio"
          hint={(adding ? gapHint : null) ?? DEFAULT_TOTAL_HINT}
        />
        {adding ? (
          <ReceiptPantryChoice
            rawDescription={description}
            resolved={adding.pantryOf({ pantry, frozen }, description, unit)}
            freezer={adding.freezer}
            onTogglePantry={() => setPantry((on) => !on)}
            onToggleFrozen={setFrozen}
          />
        ) : null}
        <Button title={adding ? ADD_ITEM_SAVE : valueOnly ? SAVE_VALUE_LABEL : 'Salvar item'} onPress={save} loading={saving} />
        {onDelete && !adding ? <Button title="Remover item" variant="danger" icon="trash-can-outline" onPress={onDelete} /> : null}
      </ScrollView>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { flexWrap: 'wrap' },
  gapXs: { gap: space.xs },
  content: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', padding: space.lg, gap: space.lg },
});

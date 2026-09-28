import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { cartPantryPayload, type CartPantryEntry, type CartPantryRow } from '@/domain/cartPantry';
import { formatShortDate } from '@/domain/dates';
import { formatQuantity, parseDecimal } from '@/domain/money';
import { Backdrop } from '@/ui/Backdrop';
import { Button, CategoryIcon, CheckCircle, IconButton, ListCard, Row, Text, TextField } from '@/ui/primitives';
import { MAX_WIDTH, space, useColors } from '@/ui/theme';

/**
 * Confirmação de "guardar na despensa": o item do botão (single) ou o
 * carrinho inteiro no limpar. A pessoa marca o que vai e confere quanto
 * comprou. Renderize só quando aberto.
 */
export function CartPantryModal({
  rows,
  single,
  shelfLifeDays,
  onConfirm,
  onClose,
}: {
  rows: CartPantryRow[];
  single: boolean;
  shelfLifeDays: Map<string, number | null>;
  onConfirm: (pantry: CartPantryEntry[]) => void;
  onClose: () => void;
}) {
  const c = useColors();
  const [include, setInclude] = useState(() => Object.fromEntries(rows.map((r) => [r.id, r.include])));
  const [quantity, setQuantity] = useState(() =>
    Object.fromEntries(rows.map((r) => [r.id, formatQuantity(r.quantity, r.unit).split(' ')[0]])),
  );

  const chosen = Object.fromEntries(
    rows.map((r) => [r.id, { include: include[r.id], quantity: parseDecimal(quantity[r.id]) }]),
  );
  const invalid = rows.some((r) => chosen[r.id].include && !(chosen[r.id].quantity! > 0));
  const count = rows.filter((r) => chosen[r.id].include).length;

  const title = single ? 'Guardar na despensa' : 'Limpar o carrinho';
  const action = single
    ? 'Guardar na despensa'
    : count
      ? `Limpar e guardar ${count} na despensa`
      : 'Limpar sem guardar';

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.flex, { backgroundColor: c.background }]}>
        <Backdrop />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Row>
            <Text variant="heading" style={styles.flex}>
              {title}
            </Text>
            <IconButton icon="close" label="Fechar" onPress={onClose} />
          </Row>
          <Text variant="muted">
            {single
              ? 'O item sai do carrinho e vai para a despensa. Confira quanto você comprou.'
              : 'Os itens saem do carrinho. Marque o que vai para a despensa e confira quanto você comprou.'}
          </Text>
          <ListCard>
            {rows.map((row) => {
              const on = include[row.id];
              const note = row.alreadySince
                ? `Já está na despensa, de ${formatShortDate(row.alreadySince)}`
                : on
                  ? null
                  : 'Não vai para a despensa';
              // Linha sem toque próprio: o campo de quantidade recebe o toque (e o leitor de tela não o vê como desativado).
              return (
                <View key={row.id} style={styles.row}>
                  {single ? null : (
                    <CheckCircle
                      checked={on}
                      label={`Guardar ${row.name} na despensa`}
                      onPress={() => setInclude((prev) => ({ ...prev, [row.id]: !prev[row.id] }))}
                    />
                  )}
                  <CategoryIcon category={row.category} name={row.name} size={36} dimmed={!on} />
                  <View style={styles.flex}>
                    <Text variant="body" numberOfLines={2}>
                      {row.name}
                    </Text>
                    {note ? <Text variant="muted">{note}</Text> : null}
                  </View>
                  {on ? (
                    <Row style={styles.qty}>
                      <View style={styles.qtyField}>
                        <TextField
                          value={quantity[row.id]}
                          onChangeText={(text) => setQuantity((prev) => ({ ...prev, [row.id]: text }))}
                          keyboardType="decimal-pad"
                          accessibilityLabel={`Quantidade comprada de ${row.name}`}
                          selectTextOnFocus
                        />
                      </View>
                      <Text variant="muted">{row.unit}</Text>
                    </Row>
                  ) : null}
                </View>
              );
            })}
          </ListCard>
          {invalid ? (
            <Text variant="small" color="danger">
              Confira as quantidades: precisam ser maiores que zero.
            </Text>
          ) : null}
          <Button
            title={action}
            icon={count ? 'fridge-outline' : 'cart-remove'}
            disabled={invalid || (single && !count)}
            onPress={() => onConfirm(cartPantryPayload(rows, chosen, shelfLifeDays))}
          />
          <Button title="Cancelar" variant="secondary" onPress={onClose} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', padding: space.lg, gap: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  qty: { alignItems: 'center' },
  qtyField: { width: 72 },
});

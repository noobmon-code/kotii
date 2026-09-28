import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { formatQuantity } from '@/domain/money';
import type { RecentItem } from '@/domain/recentPurchases';
import { CategoryIcon, Icon, Section, Text, useCategoryTint } from '@/ui/primitives';
import { radius, space } from '@/ui/theme';

const TILE = 92;

/**
 * Faixa "Comprados recentemente": o que a casa costuma comprar, do mais
 * frequente ao menos. Um toque põe o item na lista com a quantidade de sempre.
 */
export function RecentPurchases({ items, onAdd }: { items: RecentItem[]; onAdd: (item: RecentItem) => void }) {
  if (!items.length) return null;
  return (
    <Section title="Comprados recentemente">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="handled">
        {items.map((item) => (
          <Tile key={item.name} item={item} onPress={() => onAdd(item)} />
        ))}
      </ScrollView>
    </Section>
  );
}

function Tile({ item, onPress }: { item: RecentItem; onPress: () => void }) {
  const tint = useCategoryTint(item.category);
  const quantity = formatQuantity(item.quantity, item.unit);
  const times = item.times > 1 ? `, comprado ${item.times} vezes` : '';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Adicionar ${item.name}, ${quantity}${times}`}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, { backgroundColor: tint.bg }, pressed && styles.pressed]}>
      <CategoryIcon category={item.category} name={item.name} size={44} backdrop={false} />
      <Text variant="small" color="text" numberOfLines={2} style={styles.center}>
        {item.name}
      </Text>
      <Text variant="small" style={styles.center}>
        {quantity}
      </Text>
      <View style={styles.plus}>
        <Icon name="plus-circle" size={18} color="primary" />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.sm },
  tile: {
    width: TILE,
    alignItems: 'center',
    gap: space.xs,
    borderRadius: radius.lg,
    paddingHorizontal: space.xs,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  pressed: { transform: [{ scale: 0.95 }] },
  center: { textAlign: 'center' },
  plus: { position: 'absolute', top: space.xs, right: space.xs },
});

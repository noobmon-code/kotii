import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { formatQuantity } from '@/domain/money';
import type { RecentItem } from '@/domain/recentPurchases';
import { describeRestock, type RestockItem } from '@/domain/restock';
import { CategoryIcon, Icon, Section, Text, useCategoryTint } from '@/ui/primitives';
import { radius, space } from '@/ui/theme';

const TILE = 92;

type StripItem = Omit<RecentItem, 'times'>;

/**
 * Faixa "Comprados recentemente": o que a casa costuma comprar, do mais
 * frequente ao menos. Um toque põe o item na lista com a quantidade de sempre.
 */
export function RecentPurchases({ items, onAdd }: { items: RecentItem[]; onAdd: (item: RecentItem) => void }) {
  return (
    <Strip
      title="Comprados recentemente"
      items={items}
      onAdd={onAdd}
      caption={(item) => formatQuantity(item.quantity, item.unit)}
      describe={(item) =>
        `${formatQuantity(item.quantity, item.unit)}${item.times > 1 ? `, comprado ${item.times} vezes` : ''}`
      }
    />
  );
}

/** Faixa "Acho que acabou": o que já passou do intervalo de costume (restockSuggestions). */
export function RestockStrip({ items, onAdd }: { items: RestockItem[]; onAdd: (item: RestockItem) => void }) {
  return (
    <Strip
      title="Acho que acabou"
      items={items}
      onAdd={onAdd}
      caption={(item) => `há ${item.daysSince} dias`}
      describe={(item) => `${formatQuantity(item.quantity, item.unit)}. ${describeRestock(item)}`}
    />
  );
}

function Strip<T extends StripItem>({
  title,
  items,
  onAdd,
  caption,
  describe,
}: {
  title: string;
  items: T[];
  onAdd: (item: T) => void;
  caption: (item: T) => string;
  describe: (item: T) => string;
}) {
  if (!items.length) return null;
  return (
    <Section title={title}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="handled">
        {items.map((item) => (
          <Tile key={item.name} item={item} caption={caption(item)} label={describe(item)} onPress={() => onAdd(item)} />
        ))}
      </ScrollView>
    </Section>
  );
}

function Tile({ item, caption, label, onPress }: { item: StripItem; caption: string; label: string; onPress: () => void }) {
  const tint = useCategoryTint(item.category);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Adicionar ${item.name}, ${label}`}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, { backgroundColor: tint.bg }, pressed && styles.pressed]}>
      <CategoryIcon category={item.category} name={item.name} size={44} backdrop={false} />
      <Text variant="small" color="text" numberOfLines={2} style={styles.center}>
        {item.name}
      </Text>
      <Text variant="small" style={styles.center}>
        {caption}
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

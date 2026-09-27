import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { formatQuantity } from '@/domain/money';
import type { ShoppingListItem } from '@/lib/types';
import { CategoryIcon, Icon, Text, useCategoryTint } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

const GAP = space.md;
const MIN_TILE = 100;
const MAX_COLUMNS = 5;

/**
 * Itens da lista em grade, com a ilustração da categoria: um toque põe no
 * carrinho (ou devolve para a lista), segurar remove.
 */
export function ShoppingGrid({
  items,
  inCart = false,
  onToggle,
  onRemove,
}: {
  items: ShoppingListItem[];
  inCart?: boolean;
  onToggle: (item: ShoppingListItem) => void;
  onRemove: (item: ShoppingListItem) => void;
}) {
  const [width, setWidth] = useState(0);
  // Colunas pela largura: 3 num celular comum, até 5 em telas largas.
  const columns = Math.min(MAX_COLUMNS, Math.max(2, Math.floor((width + GAP) / (MIN_TILE + GAP))));
  const tileWidth = Math.floor((width - GAP * (columns - 1)) / columns);
  return (
    <View style={styles.grid} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0
        ? items.map((item) => (
            <Tile
              key={item.id}
              item={item}
              width={tileWidth}
              inCart={inCart}
              onPress={() => onToggle(item)}
              onLongPress={() => onRemove(item)}
            />
          ))
        : null}
    </View>
  );
}

function Tile({
  item,
  width,
  inCart,
  onPress,
  onLongPress,
}: {
  item: ShoppingListItem;
  width: number;
  inCart: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const c = useColors();
  const tint = useCategoryTint(item.category);
  const quantity = formatQuantity(item.quantity, item.unit);
  const artSize = Math.min(64, Math.round(width * 0.55));
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: inCart }}
      accessibilityLabel={`${item.name}, ${quantity}`}
      accessibilityHint={inCart ? 'Toque para devolver à lista' : 'Toque para pôr no carrinho'}
      accessibilityActions={[{ name: 'longpress', label: 'Remover da lista' }]}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === 'longpress' && onLongPress()}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.tile,
        { width, backgroundColor: inCart ? c.surfaceAlt : tint.bg },
        pressed && styles.pressed,
      ]}>
      <CategoryIcon category={item.category} size={artSize} backdrop={false} dimmed={inCart} />
      <Text
        variant="label"
        numberOfLines={2}
        color={inCart ? 'textMuted' : 'text'}
        style={[styles.center, inCart && styles.done]}>
        {item.name}
      </Text>
      <Text variant="small" style={styles.center}>
        {quantity}
      </Text>
      {inCart ? (
        <View style={[styles.badge, { backgroundColor: c.primary }]}>
          <Icon name="check" size={14} color="onPrimary" />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  tile: {
    alignItems: 'center',
    gap: space.xs,
    borderRadius: radius.lg,
    paddingHorizontal: space.sm,
    paddingTop: space.md,
    paddingBottom: space.md,
  },
  pressed: { transform: [{ scale: 0.95 }] },
  center: { textAlign: 'center' },
  done: { textDecorationLine: 'line-through' },
  badge: {
    position: 'absolute',
    top: space.sm,
    right: space.sm,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

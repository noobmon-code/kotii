import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { usePendingPhotoUri } from '@/data/listPhotos';
import { priorityBadge } from '@/domain/listItem';
import { formatQuantity } from '@/domain/money';
import type { ShoppingListItem } from '@/lib/types';
import { Badge, CategoryIcon, Icon, Row, Text, useCategoryTint } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

/** Fotos dos itens: links das já enviadas (por caminho) e as que esperam internet (por item). */
export interface ItemPhotos {
  signed?: Record<string, string>;
  pending: Map<string, string>;
}

const GAP = space.md;
const MIN_TILE = 100;
const MAX_COLUMNS = 5;

/**
 * Itens da lista em grade, com a foto do produto (ou a ilustração da
 * categoria): um toque põe no carrinho (ou devolve para a lista), segurar
 * abre os detalhes. No carrinho, o botão da geladeira guarda o item na despensa.
 */
export function ShoppingGrid({
  items,
  inCart = false,
  photos,
  onToggle,
  onOpen,
  onStore,
}: {
  items: ShoppingListItem[];
  inCart?: boolean;
  photos: ItemPhotos;
  onToggle: (item: ShoppingListItem) => void;
  onOpen: (item: ShoppingListItem) => void;
  /** Sem ele (ex.: carrinho sincronizando), o botão não aparece. */
  onStore?: (item: ShoppingListItem) => void;
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
              photoUrl={item.photo_path ? photos.signed?.[item.photo_path] : undefined}
              pendingKey={photos.pending.get(item.id)}
              onPress={() => onToggle(item)}
              onLongPress={() => onOpen(item)}
              onStore={onStore ? () => onStore(item) : undefined}
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
  photoUrl,
  pendingKey,
  onPress,
  onLongPress,
  onStore,
}: {
  item: ShoppingListItem;
  width: number;
  inCart: boolean;
  photoUrl?: string;
  pendingKey?: string;
  onPress: () => void;
  onLongPress: () => void;
  onStore?: () => void;
}) {
  const c = useColors();
  const tint = useCategoryTint(item.category);
  const quantity = formatQuantity(item.quantity, item.unit);
  const artSize = Math.min(64, Math.round(width * 0.55));
  const pendingUri = usePendingPhotoUri(pendingKey);
  // A foto que espera internet vale mais que a antiga; a enviada usa o
  // caminho como chave do cache, então aparece sem internet se já foi vista.
  const photo = pendingUri
    ? { uri: pendingUri }
    : photoUrl && item.photo_path
      ? { uri: photoUrl, cacheKey: item.photo_path }
      : null;
  const badge = inCart ? null : priorityBadge(item.priority);
  const notes = item.notes?.trim();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: inCart }}
      accessibilityLabel={[item.name, quantity, badge?.label, notes].filter(Boolean).join(', ')}
      accessibilityHint={inCart ? 'Toque para devolver à lista' : 'Toque para pôr no carrinho'}
      accessibilityActions={[{ name: 'longpress', label: 'Detalhes do item' }]}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === 'longpress' && onLongPress()}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.tile,
        { width, backgroundColor: inCart ? c.surfaceAlt : tint.bg },
        pressed && styles.pressed,
      ]}>
      {photo ? (
        <Image
          source={photo}
          style={[styles.photo, { width: artSize, height: artSize, opacity: inCart ? 0.45 : 1 }]}
          contentFit="cover"
          accessible={false}
        />
      ) : (
        <CategoryIcon category={item.category} name={item.name} size={artSize} backdrop={false} dimmed={inCart} />
      )}
      <Text
        variant="label"
        numberOfLines={2}
        color={inCart ? 'textMuted' : 'text'}
        style={[styles.center, inCart && styles.done]}>
        {item.name}
      </Text>
      <Row gap={space.xs} style={styles.meta}>
        <Text variant="small" style={styles.center}>
          {quantity}
        </Text>
        {notes ? <Icon name="note-text-outline" size={14} color="textMuted" /> : null}
      </Row>
      {badge ? <Badge label={badge.label} tone={badge.tone} /> : null}
      {inCart ? (
        <View style={[styles.badge, { backgroundColor: c.primary }]}>
          <Icon name="check" size={14} color="onPrimary" />
        </View>
      ) : null}
      {inCart && onStore ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Guardar ${item.name} na despensa`}
          hitSlop={8}
          onPress={onStore}
          style={({ pressed }) => [
            styles.store,
            { backgroundColor: c.glassStrong, borderColor: c.glassBorder },
            pressed && styles.pressed,
          ]}>
          <Icon name="fridge-outline" size={16} color="primary" />
        </Pressable>
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
  photo: { borderRadius: radius.md },
  meta: { justifyContent: 'center' },
  center: { textAlign: 'center' },
  done: { textDecorationLine: 'line-through' },
  store: {
    position: 'absolute',
    top: space.xs,
    left: space.xs,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
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

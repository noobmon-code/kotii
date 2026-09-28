import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { formatQuantity } from '@/domain/money';
import type { RecentItem } from '@/domain/recentPurchases';
import { describeRestock, type RestockItem } from '@/domain/restock';
import { normalizeSearch } from '@/domain/search';
import { CategoryIcon, Icon, Section, Text, useCategoryTint } from '@/ui/primitives';
import { radius, space } from '@/ui/theme';

const TILE = 92;

/**
 * Itens postos na lista por uma faixa: somem no toque e ficam escondidos até
 * os dados carregados (`listed`) trazerem o item. A busca pode falhar ou, com
 * a fila da lista andando, devolver o cache de antes; soltar sem ver o item
 * faria a sugestão voltar, e um novo toque o poria em dobro. Depois que o
 * item aparece, quem o esconde é a própria lista; se sair dela, volta.
 */
export function useJustListed(listed: { name: string }[] | undefined) {
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  // Dados novos: solta o que já aparece neles (ajuste durante a renderização,
  // como o React recomenda para estado que depende de outro valor).
  const [seen, setSeen] = useState(listed);
  if (listed !== seen) {
    setSeen(listed);
    const names = new Set((listed ?? []).map((i) => normalizeSearch(i.name)));
    if ([...pending].some((key) => names.has(key))) setPending(new Set([...pending].filter((key) => !names.has(key))));
  }
  const add = useCallback((names: string[]) => setPending((prev) => new Set([...prev, ...names.map(normalizeSearch)])), []);
  /** A inclusão falhou: a sugestão volta. */
  const drop = useCallback((names: string[]) => {
    const keys = new Set(names.map(normalizeSearch));
    setPending((prev) => new Set([...prev].filter((key) => !keys.has(key))));
  }, []);
  return { pending, add, drop };
}

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

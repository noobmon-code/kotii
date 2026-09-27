import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, SectionList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getCategory } from '@/domain/categories';
import { commonItemsByCategory, type CommonItem } from '@/domain/commonItems';
import { normalizeSearch } from '@/domain/search';
import { Backdrop } from '@/ui/Backdrop';
import { Badge, Button, CategoryIcon, Chip, Icon, IconButton, Text, TextField } from '@/ui/primitives';
import { MAX_WIDTH, space, useColors } from '@/ui/theme';

/**
 * Catálogo de itens comuns da casa, por categoria. Cada toque adiciona o item
 * à lista; o que já está na lista aparece marcado.
 */
export function CommonItemsPicker({
  visible,
  listKind,
  inList,
  onAdd,
  onClose,
}: {
  visible: boolean;
  listKind: string;
  /** Nomes normalizados (normalizeSearch) dos itens pendentes da lista. */
  inList: Set<string>;
  onAdd: (item: CommonItem) => void;
  onClose: () => void;
}) {
  const c = useColors();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  // Marca na hora, antes de a lista recarregar do servidor.
  const [justAdded, setJustAdded] = useState<Set<string>>(new Set());

  const groups = useMemo(() => commonItemsByCategory(listKind), [listKind]);
  const sections = useMemo(() => {
    const q = normalizeSearch(query);
    return groups
      .filter((g) => !category || g.category === category)
      .map((g) => ({
        title: getCategory(g.category).label,
        category: g.category,
        data: q ? g.items.filter((i) => normalizeSearch(i.name).includes(q)) : g.items,
      }))
      .filter((s) => s.data.length > 0);
  }, [groups, category, query]);

  const isInList = (item: CommonItem) => {
    const key = normalizeSearch(item.name);
    return inList.has(key) || justAdded.has(key);
  };

  function add(item: CommonItem) {
    if (isInList(item)) return;
    setJustAdded((prev) => new Set(prev).add(normalizeSearch(item.name)));
    onAdd(item);
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      onShow={() => {
        setQuery('');
        setCategory(null);
        setJustAdded(new Set());
      }}>
      <SafeAreaView style={[styles.flex, { backgroundColor: c.background }]}>
        <Backdrop />
        <View style={styles.inner}>
          <View style={styles.header}>
            <Text variant="heading" style={styles.flex}>
              Itens comuns
            </Text>
            <IconButton icon="close" label="Fechar" onPress={onClose} />
          </View>
          <TextField value={query} onChangeText={setQuery} placeholder="Buscar item" autoCorrect={false} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.chipsContent}>
            <Chip label="Todas" selected={category === null} onPress={() => setCategory(null)} />
            {groups.map((g) => (
              <Chip
                key={g.category}
                label={getCategory(g.category).label}
                selected={category === g.category}
                onPress={() => setCategory(category === g.category ? null : g.category)}
              />
            ))}
          </ScrollView>
          <SectionList
            sections={sections}
            keyExtractor={(item) => item.name}
            keyboardShouldPersistTaps="handled"
            stickySectionHeadersEnabled
            renderSectionHeader={({ section }) => (
              <View style={[styles.sectionHeader, { backgroundColor: c.glassStrong }]}>
                <CategoryIcon category={section.category} size={28} />
                <Text variant="label">{section.title}</Text>
              </View>
            )}
            renderItem={({ item }) => {
              const added = isInList(item);
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={added ? `${item.name} já está na lista` : `Adicionar ${item.name}`}
                  onPress={() => add(item)}
                  style={({ pressed }) => [
                    styles.row,
                    { borderBottomColor: c.border },
                    pressed && !added && { backgroundColor: c.surfaceAlt },
                  ]}>
                  <Text variant="body" color={added ? 'textMuted' : 'text'} style={styles.flex}>
                    {item.name}
                  </Text>
                  {item.unit !== 'un' ? <Text variant="small">{item.unit}</Text> : null}
                  {added ? <Badge label="Na lista" tone="primary" /> : <Icon name="plus-circle-outline" color="primary" />}
                </Pressable>
              );
            }}
            ListEmptyComponent={<Text variant="muted">Nada encontrado. Digite o item na lista para adicioná-lo.</Text>}
          />
          <Button title="Pronto" onPress={onClose} />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  inner: { flex: 1, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', padding: space.lg, gap: space.md },
  header: { flexDirection: 'row', alignItems: 'center' },
  chips: { flexGrow: 0, flexShrink: 0 },
  chipsContent: { gap: space.sm },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingTop: space.lg, paddingBottom: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});

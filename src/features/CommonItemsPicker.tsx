import { useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, SectionList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getCategory } from '@/domain/categories';
import { commonItemsByCategory, type CommonItem } from '@/domain/commonItems';
import { normalizeSearch } from '@/domain/search';
import { Backdrop } from '@/ui/Backdrop';
import { Badge, Button, CategoryIcon, Chip, Icon, IconButton, Text, TextField } from '@/ui/primitives';
import { MAX_WIDTH, space, useColors } from '@/ui/theme';

/**
 * Catálogo de itens comuns da casa, por categoria. Um toque põe o item na
 * lista; outro toque tira. O que já está na lista aparece marcado.
 */
export function CommonItemsPicker({
  visible,
  listKind,
  inList,
  onToggle,
  onClose,
}: {
  visible: boolean;
  listKind: string;
  /** Nomes normalizados (normalizeSearch) dos itens pendentes da lista. */
  inList: Set<string>;
  /** Põe (add) ou tira o item da lista; false se não deu (erro ou a pessoa desistiu). */
  onToggle: (item: CommonItem, add: boolean) => Promise<boolean>;
  onClose: () => void;
}) {
  const c = useColors();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  // Marca (ou desmarca) na hora, antes de a lista recarregar do servidor:
  // nome -> se deve estar na lista. Sai quando a lista carregada confirma.
  const [wanted, setWanted] = useState<Map<string, boolean>>(new Map());
  // Dois toques no mesmo render não mandam duas vezes.
  const sending = useRef(new Set<string>());

  // A lista carregada mudou: o que ela já confirma deixa de valer.
  const [seenList, setSeenList] = useState(inList);
  if (seenList !== inList) {
    setSeenList(inList);
    const open = [...wanted].filter(([key, want]) => inList.has(key) !== want);
    if (open.length !== wanted.size) setWanted(new Map(open));
  }

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
    return wanted.get(key) ?? inList.has(key);
  };

  async function toggle(item: CommonItem) {
    const key = normalizeSearch(item.name);
    // O toque anterior neste item ainda não chegou à lista: espera.
    if (wanted.has(key) || sending.current.has(key)) return;
    const add = !inList.has(key);
    sending.current.add(key);
    setWanted((prev) => new Map(prev).set(key, add));
    const done = await onToggle(item, add).catch(() => false);
    sending.current.delete(key);
    if (!done) {
      setWanted((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      onShow={() => {
        setQuery('');
        setCategory(null);
        setWanted(new Map());
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
              <View style={[styles.sectionHeader, { backgroundColor: c.background }]}>
                <CategoryIcon category={section.category} size={28} />
                <Text variant="label">{section.title}</Text>
              </View>
            )}
            renderItem={({ item }) => {
              const added = isInList(item);
              return (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: added }}
                  accessibilityLabel={item.name}
                  accessibilityHint={added ? 'Toque para tirar da lista' : 'Toque para pôr na lista'}
                  onPress={() => toggle(item)}
                  style={({ pressed }) => [
                    styles.row,
                    { borderBottomColor: c.border },
                    pressed && { backgroundColor: c.surfaceAlt },
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

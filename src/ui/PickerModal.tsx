import { useMemo, useState, type ReactNode } from 'react';
import { FlatList, Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { normalizeSearch } from '@/domain/search';
import { Backdrop } from './Backdrop';
import { IconButton, ListRow, Text, TextField } from './primitives';
import { MAX_WIDTH, space, useColors } from './theme';

export interface PickerOption {
  id: string;
  title: string;
  subtitle?: string;
  left?: ReactNode;
}

/**
 * Lista pesquisável em tela cheia. `extraActions` aparecem no topo (ex.:
 * "Criar produto 'X'"), recebendo o texto digitado.
 */
export function PickerModal({
  visible,
  title,
  options,
  onSelect,
  onClose,
  placeholder = 'Buscar',
  extraActions,
  initialQuery = '',
}: {
  visible: boolean;
  title: string;
  options: PickerOption[];
  onSelect: (id: string) => void;
  onClose: () => void;
  placeholder?: string;
  extraActions?: (query: string) => ReactNode;
  initialQuery?: string;
}) {
  const c = useColors();
  const [query, setQuery] = useState(initialQuery);
  const filtered = useMemo(() => {
    const q = normalizeSearch(query);
    if (!q) return options;
    return options.filter((o) => normalizeSearch(o.title).includes(q));
  }, [options, query]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} onShow={() => setQuery(initialQuery)}>
      <SafeAreaView style={[styles.flex, { backgroundColor: c.background }]}>
        <Backdrop />
        <View style={styles.inner}>
          <View style={styles.header}>
            <Text variant="heading" style={styles.flex}>
              {title}
            </Text>
            <IconButton icon="close" label="Fechar" onPress={onClose} />
          </View>
          <TextField value={query} onChangeText={setQuery} placeholder={placeholder} autoFocus autoCorrect={false} />
          {extraActions?.(query.trim())}
          <FlatList
            data={filtered}
            keyExtractor={(o) => o.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <ListRow left={item.left} title={item.title} subtitle={item.subtitle} onPress={() => onSelect(item.id)} />
            )}
            ListEmptyComponent={<Text variant="muted">Nada encontrado.</Text>}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  inner: { flex: 1, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', padding: space.lg, gap: space.md },
  header: { flexDirection: 'row', alignItems: 'center' },
});

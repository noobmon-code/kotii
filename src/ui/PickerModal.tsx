import { useMemo, useState, type ReactNode } from 'react';
import { FlatList, Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { normalizeSearch } from '@/domain/search';
import { Backdrop } from './Backdrop';
import { IconButton, ListCard, ListRow, Text, TextField } from './primitives';
import { MAX_WIDTH, space, useColors } from './theme';

export interface PickerOption {
  id: string;
  title: string;
  subtitle?: string;
  left?: ReactNode;
}

/**
 * Lista pesquisável em tela cheia. `extraActions` aparecem no topo (ex.:
 * "Criar produto 'X'"), recebendo o texto digitado. `suggestions` são opções
 * para o texto digitado que a busca por trecho não acha (ex.: nomes
 * parecidos); vêm antes da lista, sob `suggestionsTitle`, e o toque numa delas
 * vai para `onSelectSuggestion` quando a tela precisa saber de onde veio.
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
  suggestions,
  suggestionsTitle,
  onSelectSuggestion = onSelect,
  message,
}: {
  visible: boolean;
  title: string;
  options: PickerOption[];
  onSelect: (id: string) => void;
  onClose: () => void;
  placeholder?: string;
  extraActions?: (query: string) => ReactNode;
  initialQuery?: string;
  suggestions?: (query: string) => PickerOption[];
  suggestionsTitle?: string;
  onSelectSuggestion?: (id: string) => void;
  /** Uma frase logo abaixo do título: o que a escolha muda. */
  message?: string;
}) {
  const c = useColors();
  const [query, setQuery] = useState(initialQuery);
  const suggested = useMemo(() => (visible && suggestions ? suggestions(query.trim()) : []), [visible, suggestions, query]);
  const filtered = useMemo(() => {
    const q = normalizeSearch(query);
    // O que já está nas sugestões não se repete na lista.
    const shown = new Set(suggested.map((o) => o.id));
    return options.filter((o) => !shown.has(o.id) && (!q || normalizeSearch(o.title).includes(q)));
  }, [options, query, suggested]);

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
          {message ? <Text variant="muted">{message}</Text> : null}
          <TextField value={query} onChangeText={setQuery} placeholder={placeholder} autoFocus autoCorrect={false} />
          {extraActions?.(query.trim())}
          <FlatList
            data={filtered}
            keyExtractor={(o) => o.id}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              suggested.length ? (
                <View style={styles.suggestions}>
                  {suggestionsTitle ? <Text variant="small">{suggestionsTitle}</Text> : null}
                  <ListCard>
                    {suggested.map((item) => (
                      <ListRow
                        key={item.id}
                        left={item.left}
                        title={item.title}
                        subtitle={item.subtitle}
                        onPress={() => onSelectSuggestion(item.id)}
                      />
                    ))}
                  </ListCard>
                </View>
              ) : null
            }
            renderItem={({ item }) => (
              <ListRow left={item.left} title={item.title} subtitle={item.subtitle} onPress={() => onSelect(item.id)} />
            )}
            ListEmptyComponent={suggested.length ? null : <Text variant="muted">Nada encontrado.</Text>}
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
  suggestions: { gap: space.sm, paddingBottom: space.md },
});

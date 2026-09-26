import { router } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';

import type { Person } from '@/lib/types';
import { Chip } from '@/ui/primitives';
import { space } from '@/ui/theme';

/** Escolha de pessoa/pet em linha rolável. `onAdd` mostra "+ Pessoa". */
export function PersonChips({
  people,
  value,
  onChange,
  allLabel,
  onAdd,
}: {
  people: Person[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** Com rótulo, mostra a opção "todos" (valor null). */
  allLabel?: string;
  onAdd?: () => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.row} contentContainerStyle={styles.content}>
      {allLabel ? <Chip label={allLabel} selected={value === null} onPress={() => onChange(null)} /> : null}
      {people.map((p) => (
        <Chip
          key={p.id}
          label={p.name}
          icon={p.kind === 'pet' ? 'paw' : undefined}
          selected={value === p.id}
          onPress={() => onChange(p.id)}
        />
      ))}
      {onAdd ? <Chip label="Pessoa ou pet" icon="plus" onPress={onAdd} /> : null}
    </ScrollView>
  );
}

export function openNewPerson() {
  router.push({ pathname: '/pessoa/[id]', params: { id: 'nova' } });
}

export function personName(people: Person[] | undefined, id: string | null | undefined): string {
  return people?.find((p) => p.id === id)?.name ?? '';
}

const styles = StyleSheet.create({
  row: { flexGrow: 0, flexShrink: 0 },
  content: { gap: space.sm },
});

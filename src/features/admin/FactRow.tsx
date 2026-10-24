import { StyleSheet, View } from 'react-native';

import type { DashboardFact } from '@/domain/appDashboard';
import { Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

/**
 * Um número com nome, sem barra ("Contas sem casa: 1 de 5 contas (20%)"): o nome à esquerda, o número à direita
 * e o detalhe embaixo, em letra pequena. O leitor de tela lê a linha numa frase só.
 */
export function FactRow({ fact }: { fact: DashboardFact }) {
  return (
    <View accessible accessibilityLabel={fact.accessibilityLabel} style={styles.fact}>
      <View style={styles.header}>
        <Text variant="body" style={styles.flex}>
          {fact.label}
        </Text>
        <Text variant="label" style={styles.value}>
          {fact.value}
        </Text>
      </View>
      {fact.detail ? <Text variant="small">{fact.detail}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  fact: { gap: 2 },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  // "1 de 5 contas (20%)" e o nome dividem a linha num celular de 320 dp: cada um quebra do seu lado.
  value: { flexShrink: 1, maxWidth: '55%', textAlign: 'right' },
});

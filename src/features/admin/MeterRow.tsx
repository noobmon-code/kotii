import { StyleSheet, View } from 'react-native';

import type { DashboardMeterRow } from '@/domain/appDashboard';
import { Text } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

/**
 * Uma linha com barra de proporção do painel (as funções, os usos da IA, os aparelhos), como as do uso da IA na
 * aba Família: o nome à esquerda, o número à direita, a barra e, embaixo, o detalhe. O leitor de tela lê a linha
 * inteira numa frase só (`accessibilityLabel`, pronta em domain/appDashboard).
 */
export function MeterRow({ row }: { row: DashboardMeterRow }) {
  const c = useColors();
  return (
    <View accessible accessibilityLabel={row.accessibilityLabel} style={styles.row}>
      <View style={styles.header}>
        <Text variant="small" color="text" style={styles.flex}>
          {row.label}
        </Text>
        <Text variant="small" style={styles.value}>
          {row.value}
        </Text>
      </View>
      <View style={[styles.track, { backgroundColor: c.surfaceAlt }]}>
        {row.ratio > 0 ? (
          <View style={[styles.bar, { width: `${Math.min(1, row.ratio) * 100}%`, backgroundColor: c.primary }]} />
        ) : null}
      </View>
      {row.detail ? <Text variant="small">{row.detail}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { gap: space.xs },
  header: { flexDirection: 'row', gap: space.sm },
  // Num celular estreito o número quebra a linha do lado dele em vez de empurrar o nome para fora.
  value: { flexShrink: 1, textAlign: 'right' },
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  bar: { height: 8, borderRadius: radius.pill },
});

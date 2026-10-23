import { StyleSheet, View } from 'react-native';

import type { DashboardStat } from '@/domain/appDashboard';
import { Card, Text } from '@/ui/primitives';
import { radius, space } from '@/ui/theme';

/**
 * Os números grandes do topo do painel, numa grade 2×2 de cartões de vidro: o nome, o número (com a palavra
 * pequena ao lado, quando há) e a linha de baixo. Num celular de 320 dp ainda cabem dois por linha; abaixo disso,
 * um por linha. Cada cartão é lido numa frase só.
 */
export function StatGrid({ items }: { items: DashboardStat[] }) {
  return (
    <View style={styles.grid}>
      {items.map((stat) => (
        <View key={stat.key} accessible accessibilityLabel={stat.accessibilityLabel} style={styles.cell}>
          <Card style={styles.tile}>
            <Text variant="small">{stat.label}</Text>
            <View style={styles.number}>
              <Text variant="title">{stat.value}</Text>
              {stat.unit ? (
                <Text variant="small" style={styles.unit}>
                  {stat.unit}
                </Text>
              ) : null}
            </View>
            <Text variant="small">{stat.detail}</Text>
          </Card>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // A base em porcentagem deixa sempre dois por linha (nunca três e um sozinho numa tela larga); o mínimo manda
  // para uma coluna só quando dois não cabem.
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  cell: { flexGrow: 1, flexBasis: '45%', minWidth: 120 },
  tile: { flex: 1, gap: 2, padding: space.lg, borderRadius: radius.tile },
  number: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: space.xs },
  unit: { paddingBottom: 2 },
});

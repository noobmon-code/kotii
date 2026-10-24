import { StyleSheet, View } from 'react-native';

import type { DashboardStat } from '@/domain/appDashboard';
import { Card, Text } from '@/ui/primitives';
import { radius, space } from '@/ui/theme';

/**
 * Os números grandes do topo do painel, numa grade 2×2 de cartões de vidro: o nome, o número (com a palavra
 * pequena ao lado, quando há) e a linha de baixo. Num celular de 320 dp ainda cabem dois por linha; abaixo disso,
 * um por linha. Na janela larga (`columns` 4, de domain/panelLayout), os quatro numa linha só. Cada cartão é lido
 * numa frase só.
 */
export function StatGrid({ items, columns = 2 }: { items: DashboardStat[]; columns?: 2 | 4 }) {
  return (
    <View style={styles.grid}>
      {items.map((stat) => (
        <View
          key={stat.key}
          accessible
          accessibilityLabel={stat.accessibilityLabel}
          style={[styles.cell, columns === 4 && styles.quarter]}>
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
  // Quatro por linha: a base de um quarto menos o espaço entre eles (o flexGrow completa a linha).
  quarter: { flexBasis: '22%' },
  tile: { flex: 1, gap: 2, padding: space.lg, borderRadius: radius.tile },
  number: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: space.xs },
  unit: { paddingBottom: 2 },
});

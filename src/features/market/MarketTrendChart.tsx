import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';

import type { MarketTrend } from '@/domain/marketSpend';
import { Card, Text } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

const HEIGHT = 112;
/** A barra mais baixa que ainda aparece: um mês de poucos reais não some ao lado de um de mil. */
const MIN_BAR = 3;

/**
 * Cartão da tendência do mercado: uma barra por mês, o mês corrente (só até hoje) em tom claro com a borda
 * tracejada, e a média dos meses fechados como uma linha tracejada. Só desenha: os valores, os textos e a frase
 * para o leitor de tela vêm prontos de `marketTrend` (domain/marketSpend). Para o leitor de tela o gráfico é uma
 * imagem só, com tudo dito em ordem.
 */
export function MarketTrendChart({ trend }: { trend: MarketTrend }) {
  const c = useColors();
  // A largura da área das barras, medida na tela: a linha da média vai de uma ponta à outra.
  const [width, setWidth] = useState(0);
  const height = (cents: number) => (trend.maxCents > 0 ? (cents / trend.maxCents) * HEIGHT : 0);
  const averageY = trend.averageCents != null && trend.maxCents > 0 ? HEIGHT - height(trend.averageCents) : null;

  return (
    <Card style={styles.card}>
      <Text variant="label">{trend.title}</Text>
      <View accessible accessibilityRole="image" accessibilityLabel={trend.accessibilityLabel} style={styles.chart}>
        <View style={styles.plot} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
          {trend.bars.map((bar) => (
            <View key={bar.month} style={styles.column}>
              {bar.hasNotes && bar.cents > 0 ? (
                <View
                  style={[
                    styles.bar,
                    { height: Math.max(MIN_BAR, height(bar.cents)) },
                    bar.partial
                      ? { backgroundColor: c.primarySoft, borderColor: c.primary, borderWidth: 1.5, borderStyle: 'dashed' }
                      : { backgroundColor: c.primary },
                  ]}
                />
              ) : (
                // Mês sem nota (ou sem nada da categoria): só o pé da barra, para o mês não sumir.
                <View style={[styles.empty, { backgroundColor: c.border }]} />
              )}
            </View>
          ))}
          {averageY != null && width > 0 ? (
            <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={width} height={HEIGHT}>
              <Line x1={0} y1={averageY} x2={width} y2={averageY} stroke={c.textMuted} strokeWidth={1.5} strokeDasharray={[5, 4]} />
            </Svg>
          ) : null}
        </View>
        <View style={styles.labels}>
          {trend.bars.map((bar) => (
            <View key={bar.month} style={styles.column}>
              <Text variant="small" color={bar.partial ? 'primary' : undefined}>
                {bar.label}
              </Text>
              <Text variant="small" color={bar.hasNotes ? 'text' : undefined} numberOfLines={2} style={styles.center}>
                {bar.short}
              </Text>
              {bar.note ? (
                <Text variant="small" numberOfLines={2} style={styles.center}>
                  {bar.note}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      </View>
      {trend.average ? (
        <View style={styles.legend}>
          <Svg width={22} height={4}>
            <Line x1={0} y1={2} x2={22} y2={2} stroke={c.textMuted} strokeWidth={1.5} strokeDasharray={[5, 4]} />
          </Svg>
          <Text variant="small" style={styles.flex}>
            {trend.average}
          </Text>
        </View>
      ) : null}
      {trend.averageNote ? <Text variant="small">{trend.averageNote}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: space.md },
  chart: { gap: space.xs },
  plot: { height: HEIGHT, flexDirection: 'row', alignItems: 'flex-end', gap: space.xs },
  column: { flex: 1, alignItems: 'center' },
  // Começa reta no eixo, ponta de cima arredondada.
  bar: { width: '64%', maxWidth: 32, borderTopLeftRadius: radius.sm / 2, borderTopRightRadius: radius.sm / 2 },
  empty: { width: '64%', maxWidth: 32, height: 2, borderRadius: 1 },
  labels: { flexDirection: 'row', gap: space.xs },
  center: { textAlign: 'center' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});

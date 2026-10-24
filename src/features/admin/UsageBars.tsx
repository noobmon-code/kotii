import { StyleSheet, View } from 'react-native';

import type { DashboardBar, DashboardBars } from '@/domain/appDashboard';
import { Text } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

/** A altura cheia: a maior barra do gráfico. */
const HEIGHT = 88;
/** A barra mais baixa que ainda aparece: um dia de 1 pessoa não some ao lado de um de cem. */
const MIN_BAR = 3;

/**
 * Um gráfico de barras do painel (domain/appDashboard), desenhado com Views como o da tendência do mercado: só
 * desenha o que vem pronto. Nos gráficos por dia (30 colunas), as datas da ponta embaixo; nos por mês, o mês e o
 * valor embaixo de cada barra. Barra sem registro (`null`): só o pé, na cor da borda; zero: nada; estimativa (o
 * dia reconstruído quando o painel foi instalado): tom claro com borda fina; hoje ou o mês corrente, ainda
 * contando: tom claro com a borda tracejada. Para o leitor de tela é uma imagem só, com a frase pronta (que já
 * inclui a nota de baixo); sem nada para desenhar, a frase de `empty` vai no lugar.
 */
export function UsageBars({ chart }: { chart: DashboardBars }) {
  const c = useColors();
  if (chart.empty) return <Text variant="muted">{chart.empty}</Text>;
  const perMonth = chart.bars.some((bar) => bar.label != null);
  const height = (value: number) => (chart.max > 0 ? Math.max(MIN_BAR, (value / chart.max) * HEIGHT) : 0);

  const bar = (item: DashboardBar) => {
    if (item.value == null) return <View style={[styles.stub, { backgroundColor: c.border }]} />;
    if (item.value === 0 || chart.max === 0) return null;
    const look = item.partial
      ? { backgroundColor: c.primarySoft, borderColor: c.primary, borderWidth: 1, borderStyle: 'dashed' as const }
      : item.estimate
        ? { backgroundColor: c.primarySoft, borderColor: c.primary, borderWidth: StyleSheet.hairlineWidth }
        : { backgroundColor: c.primary };
    return <View style={[styles.bar, perMonth ? styles.monthBar : null, { height: height(item.value) }, look]} />;
  };

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={chart.accessibilityLabel} style={styles.chart}>
      <View style={[styles.plot, perMonth ? styles.wide : null, { borderBottomColor: c.hairline }]}>
        {chart.bars.map((item) => (
          <View key={item.key} style={styles.column}>
            {bar(item)}
          </View>
        ))}
      </View>
      {perMonth ? (
        // Seis colunas em 320 dp: em letra pequena, o que não cabe quebra a linha, nunca é cortado.
        <View style={[styles.labelsRow, styles.wide]}>
          {chart.bars.map((item) => (
            <View key={item.key} style={styles.labels}>
              <Text variant="small" color={item.partial ? 'primary' : undefined} style={styles.tiny}>
                {item.label}
              </Text>
              <Text variant="small" color="text" style={styles.tiny}>
                {item.short}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.ends}>
          <Text variant="small">{chart.startLabel}</Text>
          <Text variant="small" color="primary" style={styles.end}>
            {chart.endLabel}
          </Text>
        </View>
      )}
      {chart.note ? <Text variant="small">{chart.note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chart: { gap: space.xs },
  // Todas as colunas com a mesma altura: as barras começam no mesmo eixo, a linha fina de baixo.
  plot: { flexDirection: 'row', gap: 1, borderBottomWidth: StyleSheet.hairlineWidth },
  // Seis colunas têm folga entre elas; trinta, só o fio.
  wide: { gap: 2 },
  column: { flex: 1, height: HEIGHT, justifyContent: 'flex-end', alignItems: 'center' },
  // Começa reta no eixo, ponta de cima arredondada. 30 colunas em 320 dp dão uns 7 dp a cada uma.
  bar: { width: '80%', maxWidth: 14, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  monthBar: { width: '64%', maxWidth: 32, borderTopLeftRadius: radius.sm / 2, borderTopRightRadius: radius.sm / 2 },
  stub: { width: '80%', maxWidth: 14, height: 2, borderRadius: 1 },
  labelsRow: { flexDirection: 'row', gap: 1 },
  labels: { flex: 1, alignItems: 'center' },
  tiny: { fontSize: 11, lineHeight: 14, textAlign: 'center' },
  ends: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  end: { textAlign: 'right' },
});

import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Line } from 'react-native-svg';

import { MARKET_TREND_HINT, type MarketTrend, type MarketTrendBar } from '@/domain/marketSpend';
import { Card, Text } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

const HEIGHT = 112;
/** Folga em cima da maior barra: a linha da média, quando é a altura cheia, não sai cortada ao meio. */
const TOP = 6;
/** A barra mais baixa que ainda aparece: um mês de poucos reais não some ao lado de um de mil. */
const MIN_BAR = 3;

/**
 * Cartão da tendência do mercado: uma barra por mês, o mês corrente (só até hoje) em tom claro com a borda
 * tracejada, e a média dos meses fechados como uma linha tracejada. Só desenha: os valores, os textos e as frases
 * para o leitor de tela vêm prontos de `marketTrend` (domain/marketSpend). O título é lido como cabeçalho. Cada
 * mês (a barra e os textos embaixo dela) é um botão que abre aquele mês (`onSelect` recebe a barra tocada), e o
 * leitor de tela lê mês a mês; o último é o mês aberto na tela, marcado, e o toque nele não faz nada. O rótulo
 * diz "Mês aberto": na web, o estado "selecionado" de um botão não chega ao leitor de tela.
 */
export function MarketTrendChart({ trend, onSelect }: { trend: MarketTrend; onSelect: (bar: MarketTrendBar) => void }) {
  const c = useColors();
  // A largura da área das barras, medida na tela: a linha da média vai de uma ponta à outra.
  const [width, setWidth] = useState(0);
  const height = (cents: number) => (trend.maxCents > 0 ? (cents / trend.maxCents) * HEIGHT : 0);
  const averageY = trend.averageCents != null && trend.maxCents > 0 ? TOP + HEIGHT - height(trend.averageCents) : null;
  // Só há a linha do ano quando a janela atravessa o ano; aí todas as colunas a têm, para os meses ficarem alinhados.
  const showYears = trend.bars.some((bar) => bar.year);
  // O gráfico termina no mês da tela.
  const open = trend.bars[trend.bars.length - 1]?.month;

  const column = (bar: MarketTrendBar) => (
    <>
      <View style={styles.barArea}>
        {bar.hasTrips && bar.cents > 0 ? (
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
          // Mês sem ida (ou sem nada da categoria): só o pé da barra, para o mês não sumir.
          <View style={[styles.empty, { backgroundColor: c.border }]} />
        )}
      </View>
      {/* Seis colunas cabem em 320 dp com folga só em letra pequena: o que não cabe quebra a linha, nunca é cortado. */}
      <View style={styles.labels}>
        {showYears ? (
          <Text variant="small" style={styles.tiny}>
            {bar.year ?? ' '}
          </Text>
        ) : null}
        <Text variant="small" color={bar.partial ? 'primary' : undefined} style={styles.tiny}>
          {bar.label}
        </Text>
        <Text variant="small" color={bar.hasTrips && !bar.noItems ? 'text' : undefined} style={styles.tiny}>
          {bar.short}
        </Text>
        {bar.note ? (
          <Text variant="small" color="primary" style={styles.tiny}>
            {bar.note}
          </Text>
        ) : null}
      </View>
    </>
  );

  return (
    <Card style={styles.card}>
      <Text variant="label" accessibilityRole="header">
        {trend.title}
      </Text>
      <View style={styles.plot} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {trend.bars.map((bar) => (
          <Pressable
            key={bar.month}
            accessibilityRole="button"
            accessibilityState={{ selected: bar.month === open }}
            accessibilityLabel={bar.accessibilityLabel}
            // O mês da tela já está aberto.
            disabled={bar.month === open}
            onPress={() => onSelect(bar)}
            style={({ pressed }) => [styles.column, pressed && styles.pressed]}>
            {column(bar)}
          </Pressable>
        ))}
        {averageY != null && width > 0 ? (
          <Svg pointerEvents="none" style={styles.averageLine} width={width} height={TOP + HEIGHT}>
            <Line x1={0} y1={averageY} x2={width} y2={averageY} stroke={c.textMuted} strokeWidth={1.5} strokeDasharray={[5, 4]} />
          </Svg>
        ) : null}
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
      <Text variant="small">{MARKET_TREND_HINT}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: space.md },
  plot: { flexDirection: 'row', gap: 2 },
  column: { flex: 1, alignItems: 'center', gap: space.xs },
  // A área das barras tem a mesma altura em todas as colunas: as barras começam todas no mesmo eixo.
  barArea: { alignSelf: 'stretch', height: TOP + HEIGHT, justifyContent: 'flex-end', alignItems: 'center' },
  averageLine: { position: 'absolute', top: 0, left: 0 },
  // Começa reta no eixo, ponta de cima arredondada.
  bar: { width: '64%', maxWidth: 32, borderTopLeftRadius: radius.sm / 2, borderTopRightRadius: radius.sm / 2 },
  empty: { width: '64%', maxWidth: 32, height: 2, borderRadius: 1 },
  labels: { alignSelf: 'stretch', alignItems: 'center' },
  // "1,2 mil" e "sem ida" numa coluna de 38 dp (320 dp de tela, menos as margens, em seis).
  tiny: { fontSize: 11, lineHeight: 14, textAlign: 'center' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  pressed: { opacity: 0.6 },
});

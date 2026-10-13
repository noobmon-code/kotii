import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import type { ChartPoint, PriceChart as PriceChartData } from '@/domain/priceHistory';
import { Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

const HEIGHT = 132;
/** Folga em volta da área do gráfico: o ponto da ponta (e o destaque do último) cabe inteiro. */
const PAD = 10;
/** Com muitas compras, as bolinhas de cada uma viram um borrão: fica só a linha e o destaque da última. */
const MAX_DOTS = 40;

/**
 * Gráfico de linha do preço ao longo do tempo. Só desenha: os pontos (0..1),
 * as legendas e a frase para leitor de tela vêm prontos de domain/priceHistory.
 */
export function PriceChart({ chart }: { chart: PriceChartData }) {
  const c = useColors();
  // A largura é a do cartão, medida na tela: o desenho não estica nem corta em 320 px.
  const [width, setWidth] = useState(0);
  // Quem diz que o preço não variou é o domínio, pela mesma regra das frases (os centavos).
  const { flat } = chart;
  const x = (point: ChartPoint) => PAD + point.x * (width - 2 * PAD);
  const y = (point: ChartPoint) => HEIGHT - PAD - point.y * (HEIGHT - 2 * PAD);
  const latest = chart.points.find((point) => point.latest);

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={chart.label} style={styles.row}>
      <View style={[styles.prices, flat && styles.pricesFlat]}>
        <Text variant="small">{chart.highLabel}</Text>
        {flat ? null : <Text variant="small">{chart.lowLabel}</Text>}
      </View>
      {/* As datas ficam sob a área do gráfico, não sob os preços: a primeira embaixo do primeiro ponto. */}
      <View style={styles.area}>
        <View style={styles.plot} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
          {width > 2 * PAD ? (
            <Svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`}>
              {flat ? null : (
                <>
                  <Line x1={0} y1={PAD} x2={width} y2={PAD} stroke={c.border} strokeWidth={1} strokeDasharray={[4, 4]} />
                  <Line x1={0} y1={HEIGHT - PAD} x2={width} y2={HEIGHT - PAD} stroke={c.border} strokeWidth={1} strokeDasharray={[4, 4]} />
                </>
              )}
              <Path
                d={chart.points.map((point, index) => `${index ? 'L' : 'M'}${x(point)} ${y(point)}`).join(' ')}
                stroke={c.textMuted}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                fill="none"
              />
              {chart.points.length <= MAX_DOTS
                ? chart.points.map((point) => (point.latest ? null : <Circle key={point.key} cx={x(point)} cy={y(point)} r={3} fill={c.textMuted} />))
                : null}
              {latest ? <Circle cx={x(latest)} cy={y(latest)} r={5.5} fill={c.primary} stroke={c.surface} strokeWidth={2} /> : null}
            </Svg>
          ) : null}
        </View>
        <View style={styles.dates}>
          <Text variant="small">{chart.firstDate}</Text>
          <Text variant="small">{chart.lastDate}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  // O maior preço na altura da linha de cima, o menor na de baixo.
  prices: { height: HEIGHT, justifyContent: 'space-between', alignItems: 'flex-end', paddingVertical: 1 },
  pricesFlat: { justifyContent: 'center' },
  area: { flex: 1, gap: space.xs },
  plot: { height: HEIGHT },
  dates: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
});

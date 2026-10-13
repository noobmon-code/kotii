import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import type { ChartPoint } from '@/domain/examTrends';
import { useColors } from '@/ui/theme';

// Folga para as bolinhas não cortarem na borda.
const PAD = 6;

/**
 * Gráfico de linha pequeno com os pontos de um item de exame (já de 0 a 1).
 * Uma cor só, neutra: mostra o caminho dos valores, sem dizer se é bom ou
 * ruim; o último ponto é só maior. `label` diz os valores em palavras para
 * leitores de tela.
 */
export function TrendChart({
  points,
  label,
  width = 92,
  height = 48,
}: {
  points: ChartPoint[];
  label: string;
  width?: number;
  height?: number;
}) {
  const c = useColors();
  const dots = points.map((p) => ({
    x: PAD + p.x * (width - 2 * PAD),
    y: PAD + (1 - p.y) * (height - 2 * PAD),
  }));
  const line = dots.map((d, index) => `${index ? 'L' : 'M'}${d.x.toFixed(1)} ${d.y.toFixed(1)}`).join(' ');
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label}>
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <Path d={line} stroke={c.textMuted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        {dots.map((d, index) => {
          const last = index === dots.length - 1;
          return <Circle key={index} cx={d.x} cy={d.y} r={last ? 4 : 2.5} fill={last ? c.primary : c.textMuted} />;
        })}
      </Svg>
    </View>
  );
}

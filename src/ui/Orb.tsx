// Orbe de vidro: o fundo redondo de um ícone, como a bolha do Nuke, mas sem o
// rosto. Disco claro e translúcido, brilho colorido por dentro e borda de luz.

import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { useSvgId } from './svgId';
import { useColors, useScheme } from './theme';

export function Orb({ size = 44, glow, children }: { size?: number; glow: string; children?: ReactNode }) {
  const c = useColors();
  const scheme = useScheme();
  const id = useSvgId('orb');
  const r = size / 2;
  return (
    <View style={{ width: size, height: size, borderRadius: r, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <RadialGradient id={id} cx="50%" cy="38%" r="62%">
            <Stop offset={0} stopColor={glow} stopOpacity={scheme === 'dark' ? 0.5 : 0.6} />
            <Stop offset={1} stopColor={glow} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={r} cy={r} r={r - 0.5} fill={c.glass} />
        <Circle cx={r} cy={r} r={r - 0.5} fill={`url(#${id})`} stroke={c.glassBorder} strokeWidth={1} />
      </Svg>
      {children}
    </View>
  );
}

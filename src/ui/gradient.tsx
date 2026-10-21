// Gradientes do desenho: em diagonal, de cima à esquerda para baixo à direita,
// com um clarão branco no canto de cima (o vidro pegando luz). Só em topos de
// tela e cartões grandes; o resto é vidro liso.

import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { useSvgId } from './svgId';
import { radius, shadows, useGradient, useScheme, type GradientName } from './theme';

export function GradientFill({
  from,
  to,
  fromOpacity = 1,
  toOpacity = 1,
  highlight = false,
}: {
  from: string;
  to: string;
  fromOpacity?: number;
  toOpacity?: number;
  /** O clarão branco no canto de cima (mais discreto à noite). */
  highlight?: boolean;
}) {
  const id = useSvgId('gf');
  const dark = useScheme() === 'dark';
  return (
    <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset={0} stopColor={from} stopOpacity={fromOpacity} />
          <Stop offset={1} stopColor={to} stopOpacity={toOpacity} />
        </LinearGradient>
        <LinearGradient id={`${id}h`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset={0} stopColor="#FFFFFF" stopOpacity={dark ? 0.1 : 0.6} />
          <Stop offset={0.45} stopColor="#FFFFFF" stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect width={100} height={100} fill={`url(#${id}g)`} />
      {highlight ? <Rect width={100} height={100} fill={`url(#${id}h)`} /> : null}
    </Svg>
  );
}

/** Cartão com o gradiente de uma tela por trás do conteúdo, cantos redondos e sombra de vidro. */
export function GradientCard({
  gradient,
  borderRadius = radius.xl,
  style,
  children,
}: {
  gradient: GradientName;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const g = useGradient(gradient);
  return (
    <View style={[{ borderRadius, borderCurve: 'continuous', boxShadow: shadows.glass }, style]}>
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { borderRadius, borderCurve: 'continuous', overflow: 'hidden' }]}>
        <GradientFill from={g.from} to={g.to} highlight />
      </View>
      {children}
    </View>
  );
}

// Gradientes do desenho: em diagonal, de cima à esquerda para baixo à direita,
// com um clarão branco no canto de cima (o vidro pegando luz). Só em topos de
// tela e cartões grandes; o resto é vidro liso.

import { useState, type ReactNode } from 'react';
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

export interface GradientStop {
  offset: number;
  color: string;
  opacity?: number;
}

/**
 * A linha de um gradiente em CSS, "linear-gradient(<ângulo>deg, …)" numa caixa de `width` x `height`: o ângulo
 * é medido de cima para a direita (0° aponta para cima, 90° para a direita, 180° para baixo), e a linha é longa
 * o bastante para o primeiro e o último ponto tocarem os cantos.
 */
export function cssGradientLine(angle: number, width: number, height: number) {
  const rad = (angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2;
  const cx = width / 2;
  const cy = height / 2;
  return { x1: cx - dx * half, y1: cy - dy * half, x2: cx + dx * half, y2: cy + dy * half };
}

/** Preenche o pai com um gradiente em ângulo (como no CSS do desenho), sem pegar toque. */
export function AngledGradient({ angle, stops, style }: { angle: number; stops: readonly GradientStop[]; style?: StyleProp<ViewStyle> }) {
  const [size, setSize] = useState({ width: 100, height: 100 });
  const id = useSvgId('ag');
  const line = cssGradientLine(angle, size.width, size.height);
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, style]}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        if (width > 0 && height > 0) setSize((old) => (old.width === width && old.height === height ? old : { width, height }));
      }}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${size.width} ${size.height}`}>
        <Defs>
          <LinearGradient id={id} gradientUnits="userSpaceOnUse" x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2}>
            {stops.map((stop) => (
              <Stop key={stop.offset} offset={stop.offset} stopColor={stop.color} stopOpacity={stop.opacity ?? 1} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect width={size.width} height={size.height} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

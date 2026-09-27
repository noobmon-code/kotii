// Fundo das telas: manchas pastel bem suaves (as cores do Nuke) atrás dos
// cartões de vidro. Some perto do topo e do rodapé para emendar com o
// cabeçalho e a barra de abas.

import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

import { useBackdrop, useColors } from './theme';

const BLOBS = [
  { key: 'blue', cx: 8, cy: 22, r: 62 },
  { key: 'green', cx: 100, cy: 48, r: 56 },
  { key: 'warm', cx: 18, cy: 92, r: 58 },
] as const;

export function Backdrop() {
  const c = useColors();
  const colors = useBackdrop();
  const id = `bd${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs>
          {BLOBS.map((b) => (
            <RadialGradient key={b.key} id={`${id}${b.key}`} cx={b.cx} cy={b.cy} r={b.r} gradientUnits="userSpaceOnUse">
              <Stop offset={0} stopColor={colors[b.key]} stopOpacity={0.9} />
              <Stop offset={0.55} stopColor={colors[b.key]} stopOpacity={0.35} />
              <Stop offset={1} stopColor={colors[b.key]} stopOpacity={0} />
            </RadialGradient>
          ))}
          <LinearGradient id={`${id}fade`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset={0} stopColor={c.background} stopOpacity={1} />
            <Stop offset={0.08} stopColor={c.background} stopOpacity={0} />
            <Stop offset={0.94} stopColor={c.background} stopOpacity={0} />
            <Stop offset={1} stopColor={c.background} stopOpacity={0.7} />
          </LinearGradient>
        </Defs>
        <Rect width={100} height={100} fill={c.background} />
        {BLOBS.map((b) => (
          <Rect key={b.key} width={100} height={100} fill={`url(#${id}${b.key})`} />
        ))}
        <Rect width={100} height={100} fill={`url(#${id}fade)`} />
      </Svg>
    </View>
  );
}

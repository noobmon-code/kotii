// Ilustrações do Kotii em SVG, sem imagens: escalam em qualquer tela. Aqui não há
// personagens com rosto: o único é o Nuke (NukeLive e NukeAvatar).

import { useEffect, type ReactNode } from 'react';
import { Text as RNText, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { fonts, useColors } from './theme';

/** Brilho de quatro pontas. */
function sparkle(x: number, y: number, r: number) {
  return `M${x} ${y - r} Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y} Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r} Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y} Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r} Z`;
}

export type Period = 'morning' | 'afternoon' | 'night';

export function periodOf(date: Date): Period {
  const h = date.getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 18) return 'afternoon';
  return 'night';
}

/** Sol de dia, lua à noite: o cartão de saudação da tela Hoje. */
export function SkyArt({ period, size = 120 }: { period: Period; size?: number }) {
  if (period === 'night') {
    return (
      <Svg width={size} height={size} viewBox="0 0 120 120">
        <Path d={sparkle(22, 26, 7)} fill="#FFE39A" />
        <Path d={sparkle(98, 20, 5)} fill="#FFE39A" opacity={0.8} />
        <Circle cx={104} cy={70} r={3} fill="#FFE39A" opacity={0.7} />
        {/* Lua crescente: um disco com a mordida de outro. */}
        <Path
          d="M74 24 C52 24 36 42 36 62 C36 84 54 100 76 100 C86 100 94 97 100 92 C96 93 92 94 88 94 C68 94 52 79 52 60 C52 46 60 33 74 24 Z"
          fill="#FFE39A"
        />
      </Svg>
    );
  }
  const sun = period === 'morning' ? '#FFC23D' : '#FF8A4C';
  const rays = Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2;
    const [x1, y1] = [60 + Math.cos(a) * 46, 62 + Math.sin(a) * 46];
    const [x2, y2] = [60 + Math.cos(a) * 55, 62 + Math.sin(a) * 55];
    return `M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }).join(' ');
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120">
      <Path d={rays} stroke={sun} strokeWidth={5} strokeLinecap="round" />
      <G>
        <Circle cx={60} cy={62} r={34} fill={sun} />
        {/* O brilho do vidro, no alto à esquerda. */}
        <Path d="M40 52 C43 42 51 36 60 35" stroke="#FFFFFF" strokeWidth={5} strokeLinecap="round" fill="none" opacity={0.7} />
      </G>
    </Svg>
  );
}

/**
 * Flutua de leve, para cima e para baixo. Com "reduzir movimento" ligado no
 * aparelho, o Reanimated não anima.
 */
export function Floating({ children, distance = 6, duration = 1400 }: { children: ReactNode; distance?: number; duration?: number }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }), -1, true));
  }, [progress, duration]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: -distance * progress.get() }] }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

/** Marca: a bolinha laranja e o nome. */
export function Logo({ size = 32 }: { size?: number }) {
  const c = useColors();
  return (
    <View style={styles.logo} accessibilityRole="header" accessibilityLabel="Kotii">
      <View style={{ width: size * 0.9, height: size * 0.9, borderRadius: size, backgroundColor: c.brand }} />
      <RNText style={[styles.logoText, { fontSize: size, lineHeight: size * 1.15, color: c.text }]}>kotii</RNText>
    </View>
  );
}

const styles = StyleSheet.create({
  logo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logoText: { fontFamily: fonts.heavy, letterSpacing: -0.5 },
});

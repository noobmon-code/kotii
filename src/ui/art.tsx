// Ilustrações do Nooky: personagens redondos com rosto simples e formas
// soltas (bolinhas, brilhos), no espírito do Headspace. Tudo em SVG, sem
// imagens: escala em qualquer tela e muda de cor com o tema.

import { useEffect, type ReactNode } from 'react';
import { Text as RNText, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';

import { fonts, INK, useColors, useTint, type Tint } from './theme';

export type Mood = 'happy' | 'calm' | 'wow' | 'sleep' | 'think';
export type Shape = 'round' | 'bean' | 'drop';

// Corpos num quadro de 100 x 100.
export const BODIES: Record<Shape, string> = {
  round: 'M50 10 C73 10 90 26 90 51 C90 75 73 90 50 90 C27 90 10 75 10 51 C10 26 27 10 50 10 Z',
  bean: 'M52 12 C75 12 91 27 90 50 C89 73 74 90 50 90 C28 90 10 77 10 55 C10 40 18 33 24 26 C31 17 40 12 52 12 Z',
  drop: 'M50 6 C60 20 88 34 88 60 C88 79 71 92 50 92 C29 92 12 79 12 60 C12 34 40 20 50 6 Z',
};

export const CHEEK = '#FF6F91';

/** Rosto num quadro de 100 x 100, centrado em (50, 55). */
function Face({ mood, cheeks = true }: { mood: Mood; cheeks?: boolean }) {
  const stroke = { stroke: INK, strokeWidth: 3.4, strokeLinecap: 'round' as const, fill: 'none' };
  const closedEyes = (
    <>
      <Path d="M35 50 Q39 54 43 50" {...stroke} />
      <Path d="M57 50 Q61 54 65 50" {...stroke} />
    </>
  );
  const openEyes = (dx = 0, dy = 0) => (
    <>
      <Ellipse cx={39 + dx} cy={50 + dy} rx={3.4} ry={4.4} fill={INK} />
      <Ellipse cx={61 + dx} cy={50 + dy} rx={3.4} ry={4.4} fill={INK} />
    </>
  );
  return (
    <G>
      {mood === 'calm' || mood === 'sleep' ? closedEyes : mood === 'think' ? openEyes(2, -3) : openEyes()}
      {mood === 'wow' ? (
        <Ellipse cx={50} cy={64} rx={4} ry={5} fill={INK} />
      ) : mood === 'think' ? (
        <Path d="M45 64 L56 63" {...stroke} />
      ) : mood === 'sleep' ? (
        <Path d="M45 63 Q50 66 55 63" {...stroke} />
      ) : (
        <Path d="M41 61 Q50 70 59 61" {...stroke} />
      )}
      {cheeks ? (
        <>
          <Ellipse cx={30} cy={60} rx={5.5} ry={3.4} fill={CHEEK} opacity={0.35} />
          <Ellipse cx={70} cy={60} rx={5.5} ry={3.4} fill={CHEEK} opacity={0.35} />
        </>
      ) : null}
    </G>
  );
}

/** Um personagem: corpo colorido com rosto. */
export function Mascot({
  size = 64,
  color,
  shape = 'round',
  mood = 'happy',
}: {
  size?: number;
  color: string;
  shape?: Shape;
  mood?: Mood;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Path d={BODIES[shape]} fill={color} />
      <Face mood={mood} />
    </Svg>
  );
}

/** Brilho de quatro pontas. */
export function sparkle(x: number, y: number, r: number) {
  return `M${x} ${y - r} Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y} Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r} Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y} Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r} Z`;
}

/** Personagem num círculo pastel com brilhos: estados vazios e boas-vindas. */
export function Spot({
  tint = 'orange',
  size = 132,
  mood = 'happy',
  shape = 'round',
}: {
  tint?: Tint;
  size?: number;
  mood?: Mood;
  shape?: Shape;
}) {
  const t = useTint(tint);
  const c = useColors();
  return (
    <Svg width={size} height={size} viewBox="0 0 140 140">
      <Circle cx={70} cy={70} r={64} fill={t.bg} />
      <Path d={sparkle(28, 34, 8)} fill={t.art} opacity={0.7} />
      <Circle cx={114} cy={44} r={5} fill={c.brand} opacity={0.6} />
      <Circle cx={24} cy={98} r={3.5} fill={t.art} opacity={0.5} />
      <G transform="translate(30 32) scale(0.8)">
        <Path d={BODIES[shape]} fill={t.art} />
        <Face mood={mood} />
      </G>
    </Svg>
  );
}

export type Period = 'morning' | 'afternoon' | 'night';

export function periodOf(date: Date): Period {
  const h = date.getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 18) return 'afternoon';
  return 'night';
}

/** Sol sorridente de dia, lua dormindo à noite: o cartão de saudação da tela Hoje. */
export function SkyArt({ period, size = 120 }: { period: Period; size?: number }) {
  if (period === 'night') {
    return (
      <Svg width={size} height={size} viewBox="0 0 120 120">
        <Path d={sparkle(22, 26, 7)} fill="#FFE39A" />
        <Path d={sparkle(98, 20, 5)} fill="#FFE39A" opacity={0.8} />
        <Circle cx={104} cy={70} r={3} fill="#FFE39A" opacity={0.7} />
        <G transform="translate(18 24) scale(0.84)">
          <Path d={BODIES.round} fill="#FFE39A" />
          <Face mood="sleep" />
        </G>
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
      <G transform="translate(22 24) scale(0.76)">
        <Path d={BODIES.round} fill={sun} />
        <Face mood="happy" />
      </G>
    </Svg>
  );
}

/** Família de personagens: telas de entrada. */
export function FamilyArt({ width = 240 }: { width?: number }) {
  const blue = useTint('blue').art;
  const yellow = useTint('yellow').art;
  const pink = useTint('pink').art;
  const c = useColors();
  return (
    <Svg width={width} height={width * 0.62} viewBox="0 0 240 150">
      <Circle cx={120} cy={150} r={112} fill={c.brandSoft} />
      <Path d={sparkle(30, 34, 9)} fill={yellow} />
      <Path d={sparkle(214, 50, 7)} fill={c.brand} opacity={0.8} />
      <G transform="translate(22 62) scale(0.72)">
        <Path d={BODIES.bean} fill={blue} />
        <Face mood="happy" />
      </G>
      <G transform="translate(72 18) scale(1.02)">
        <Path d={BODIES.round} fill={c.brand} />
        <Face mood="happy" />
      </G>
      <G transform="translate(152 62) scale(0.56)">
        <Path d={BODIES.drop} fill={yellow} />
        <Face mood="wow" />
      </G>
      <G transform="translate(204 108) scale(0.32)">
        <Path d={BODIES.round} fill={pink} />
        <Face mood="calm" cheeks={false} />
      </G>
    </Svg>
  );
}

/** O Nuke: o personagem laranja com brilhos de IA ao lado, o assistente da casa. */
export function NukeAvatar({ size = 64, mood = 'happy' }: { size?: number; mood?: Mood }) {
  const c = useColors();
  return (
    <Svg width={size} height={size} viewBox="0 0 112 112" accessibilityLabel="Nuke">
      <G transform="translate(0 12)">
        <Path d={BODIES.round} fill={c.brand} />
        <Face mood={mood} />
      </G>
      <Path d={sparkle(94, 16, 11)} fill="#FFC23D" />
      <Path d={sparkle(106, 36, 5)} fill="#FFC23D" />
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
    <View style={styles.logo} accessibilityRole="header" accessibilityLabel="Nooky">
      <View style={{ width: size * 0.9, height: size * 0.9, borderRadius: size, backgroundColor: c.brand }} />
      <RNText style={[styles.logoText, { fontSize: size, lineHeight: size * 1.15, color: c.text }]}>nooky</RNText>
    </View>
  );
}

const styles = StyleSheet.create({
  logo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logoText: { fontFamily: fonts.heavy, letterSpacing: -0.5 },
});

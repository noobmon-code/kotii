// O Nuke vivo: o mesmo personagem do NukeAvatar, em camadas animadas. Parado,
// ele respira, pisca, olha para os lados e os brilhos cintilam; pensando,
// olha para cima e balança mais rápido; falando, mexe a boca. Com "reduzir
// movimento" ligado no aparelho, o Reanimated não anima e ele fica parado.

import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Ellipse, G, Path } from 'react-native-svg';

import { BODIES, CHEEK, sparkle } from './art';
import { INK, useColors } from './theme';

export type NukeState = 'idle' | 'think' | 'talk' | 'wow';

// Quadro de 112 x 112, como o NukeAvatar: corpo descido 12 para caber os brilhos.
const BOX = 112;
const EYES = { y: 62, band: 14 };
const MOUTH = { y: 70, band: 16 };
const SPARKLES = [
  { x: 94, y: 16, r: 11, delay: 0 },
  { x: 106, y: 36, r: 5, delay: 450 },
];
const STROKE = { stroke: INK, strokeWidth: 3.4, strokeLinecap: 'round' as const, fill: 'none' };
const sine = Easing.inOut(Easing.sin);

export function NukeLive({ size = 64, state = 'idle', hop = false }: { size?: number; state?: NukeState; hop?: boolean }) {
  const c = useColors();
  const k = size / BOX;

  const breath = useSharedValue(0);
  const blink = useSharedValue(1);
  const look = useSharedValue(0);
  const up = useSharedValue(0);
  const talk = useSharedValue(0);
  const jump = useSharedValue(0);
  const sparkA = useSharedValue(0);
  const sparkB = useSharedValue(0);

  useEffect(() => {
    const thinking = state === 'think';
    breath.set(withRepeat(withTiming(1, { duration: thinking ? 650 : 1700, easing: sine }), -1, true));
    sparkA.set(withRepeat(withTiming(1, { duration: thinking ? 500 : 1300, easing: sine }), -1, true));
    sparkB.set(withDelay(SPARKLES[1].delay, withRepeat(withTiming(1, { duration: thinking ? 420 : 1100, easing: sine }), -1, true)));
    up.set(withTiming(thinking ? 1 : 0, { duration: 250 }));
    // Pisca de tempos em tempos, às vezes duas vezes seguidas.
    blink.set(
      withRepeat(
        withSequence(
          withDelay(2600, withTiming(0.1, { duration: 70 })),
          withTiming(1, { duration: 110 }),
          withDelay(3100, withTiming(0.1, { duration: 70 })),
          withTiming(1, { duration: 110 }),
          withDelay(120, withTiming(0.1, { duration: 70 })),
          withTiming(1, { duration: 110 }),
        ),
        -1,
      ),
    );
    // Olha para um lado e para o outro quando está à toa.
    look.set(
      thinking
        ? withTiming(0, { duration: 200 })
        : withRepeat(
            withSequence(
              withDelay(3400, withTiming(1, { duration: 280, easing: sine })),
              withDelay(900, withTiming(0, { duration: 280, easing: sine })),
              withDelay(2600, withTiming(-1, { duration: 280, easing: sine })),
              withDelay(900, withTiming(0, { duration: 280, easing: sine })),
            ),
            -1,
          ),
    );
    talk.set(
      state === 'talk'
        ? withRepeat(withSequence(withTiming(1, { duration: 130 }), withTiming(0.25, { duration: 150 })), -1)
        : withTiming(0, { duration: 120 }),
    );
  }, [state, breath, blink, look, up, talk, sparkA, sparkB]);

  useEffect(() => {
    if (!hop) return;
    jump.set(withSequence(withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) }), withSpring(0, { damping: 6, stiffness: 180 })));
  }, [hop, jump]);

  const wow = state === 'wow';
  const thinking = state === 'think';

  const bodyStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -jump.get() * size * 0.14 - (thinking ? breath.get() * size * 0.03 : 0) },
      { scaleX: 1 - 0.02 * breath.get() },
      { scaleY: 1 + 0.035 * breath.get() },
    ],
  }));
  const eyesStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: (look.get() * 2.6 + up.get() * 2) * k },
      { translateY: -up.get() * 3 * k },
      { scaleX: wow ? 1.15 : 1 },
      { scaleY: blink.get() * (wow ? 1.15 : 1) },
    ],
  }));
  const mouthStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: 0.3 + 0.7 * talk.get() }] }));
  const sparkStyles = [
    useAnimatedStyle(() => ({
      transform: [{ scale: 0.7 + 0.45 * sparkA.get() }, { rotate: `${(thinking ? 90 : 18) * sparkA.get()}deg` }],
      opacity: 0.75 + 0.25 * sparkA.get(),
    })),
    useAnimatedStyle(() => ({
      transform: [{ scale: 0.6 + 0.6 * sparkB.get() }, { rotate: `${(thinking ? -90 : -18) * sparkB.get()}deg` }],
      opacity: 0.6 + 0.4 * sparkB.get(),
    })),
  ];

  const band = (y: number, h: number) => ({ top: (y - h / 2) * k, height: h * k, width: size });

  return (
    <View style={{ width: size, height: size }} accessibilityLabel="Nuke" accessibilityRole="image">
      <Animated.View style={[StyleSheet.absoluteFill, styles.feet, bodyStyle]} pointerEvents="none">
        <Svg width={size} height={size} viewBox={`0 0 ${BOX} ${BOX}`}>
          <G transform="translate(0 12)">
            <Path d={BODIES.round} fill={c.brand} />
            <Ellipse cx={30} cy={60} rx={5.5} ry={3.4} fill={CHEEK} opacity={0.35} />
            <Ellipse cx={70} cy={60} rx={5.5} ry={3.4} fill={CHEEK} opacity={0.35} />
          </G>
        </Svg>
        <Animated.View style={[styles.layer, band(EYES.y, EYES.band), eyesStyle]}>
          <Svg width={size} height={EYES.band * k} viewBox={`0 ${EYES.y - EYES.band / 2} ${BOX} ${EYES.band}`}>
            <Ellipse cx={39} cy={EYES.y} rx={3.4} ry={4.4} fill={INK} />
            <Ellipse cx={61} cy={EYES.y} rx={3.4} ry={4.4} fill={INK} />
          </Svg>
        </Animated.View>
        {state === 'talk' ? (
          <Animated.View style={[styles.layer, styles.mouthTop, band(MOUTH.y + MOUTH.band / 2, MOUTH.band), mouthStyle]}>
            <Svg width={size} height={MOUTH.band * k} viewBox={`0 ${MOUTH.y} ${BOX} ${MOUTH.band}`}>
              <Path d="M41 72 Q50 86 59 72 Z" fill={INK} />
            </Svg>
          </Animated.View>
        ) : (
          <Svg style={StyleSheet.absoluteFill} width={size} height={size} viewBox={`0 0 ${BOX} ${BOX}`}>
            {wow ? (
              <Ellipse cx={50} cy={76} rx={4} ry={5} fill={INK} />
            ) : thinking ? (
              <Path d="M45 76 L56 75" {...STROKE} />
            ) : (
              <Path d="M41 73 Q50 82 59 73" {...STROKE} />
            )}
          </Svg>
        )}
      </Animated.View>
      {SPARKLES.map((s, i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={[styles.layer, { left: (s.x - s.r) * k, top: (s.y - s.r) * k, width: 2 * s.r * k, height: 2 * s.r * k }, sparkStyles[i]]}>
          <Svg width={2 * s.r * k} height={2 * s.r * k} viewBox={`${s.x - s.r} ${s.y - s.r} ${2 * s.r} ${2 * s.r}`}>
            <Path d={sparkle(s.x, s.y, s.r)} fill="#FFC23D" />
          </Svg>
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: 0 },
  // Respira a partir dos pés, não do meio.
  feet: { transformOrigin: '50% 91%' },
  mouthTop: { transformOrigin: '50% 0%' },
});

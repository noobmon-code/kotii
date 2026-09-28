// O Nuke vivo: a bolha de vidro do NukeAvatar em camadas animadas. Parado, ele
// flutua e respira (a sombra encolhe quando ele sobe), as cores de dentro
// balançam devagar, ele pisca e olha para os lados. Pensando, as cores dão
// voltas rápidas e a luz do meio pulsa; falando, mexe a boca; "uau" e alegre dão um
// pulinho que amassa ao cair; "ops" balança; dormindo, respira devagar. Com
// "reduzir movimento" ligado no aparelho, ou fora de vista (`paused`), fica
// parado na pose de repouso do humor.

import { useEffect, type ReactNode } from 'react';
import { StyleSheet, useColorScheme, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import {
  basePart,
  blushPart,
  browsPart,
  eyeCenterY,
  eyesPart,
  frameFor,
  glossPart,
  glowPart,
  hasOpenEyes,
  Layer,
  mouthPart,
  MOUTH_TOP,
  ORB,
  originOf,
  shadowPart,
  tintsPart,
  useGradientId,
  type NukeMood,
} from './NukeArt';

export type NukeState = NukeMood;

const sine = Easing.inOut(Easing.sin);

/** Balanço das cores de dentro: ms de um lado ao outro e ângulo máximo. Pensando, dão voltas. */
const SWAY: Record<Exclude<NukeMood, 'think'>, [number, number]> = {
  idle: [5000, 35],
  joy: [1800, 40],
  talk: [2200, 30],
  wow: [3000, 40],
  sleep: [9000, 15],
  oops: [5000, 35],
};
const SPIN_MS = 2200;
/** Respiração (subir e descer), em ms, e quanto sobe, no quadro de 120. */
const FLOAT: Record<NukeMood, [number, number]> = {
  idle: [2000, 3],
  joy: [1400, 3],
  think: [900, 1.6],
  talk: [650, 1.4],
  wow: [2000, 3],
  sleep: [3400, 1.4],
  oops: [2000, 2],
};

export function NukeLive({
  size = 64,
  state = 'idle',
  hop = false,
  shadow = size >= 56,
  paused = false,
}: {
  size?: number;
  state?: NukeState;
  hop?: boolean;
  /** Sombra embaixo; nos tamanhos pequenos a bolha ocupa o quadro todo. */
  shadow?: boolean;
  /** Fora de vista (atrás de outra tela): para as animações. */
  paused?: boolean;
}) {
  const dark = useColorScheme() === 'dark';
  const id = useGradientId();
  const frame = frameFor(shadow);
  const k = size / frame.w;
  const openEyes = hasOpenEyes(state);
  const reduceMotion = useReducedMotion();
  const still = paused || reduceMotion;

  const float = useSharedValue(0);
  const swirl = useSharedValue(0);
  const glow = useSharedValue(0);
  const blink = useSharedValue(1);
  const look = useSharedValue(0);
  const talk = useSharedValue(0);
  const jump = useSharedValue(0);
  const shake = useSharedValue(0);

  useEffect(() => {
    if (still) {
      // Parado: tudo em repouso, na hora (boca inteira, cores no lugar).
      for (const value of [float, swirl, glow, blink, look, talk, jump, shake]) cancelAnimation(value);
      float.set(0);
      swirl.set(Math.round(swirl.get() / 360) * 360);
      glow.set(0);
      blink.set(1);
      look.set(0);
      talk.set(1);
      jump.set(0);
      shake.set(0);
      return;
    }
    const [floatMs] = FLOAT[state];
    float.set(withRepeat(withTiming(1, { duration: floatMs, easing: sine }), -1, true));
    if (state === 'think') {
      // Voltas contínuas a partir de onde estava.
      const from = swirl.get() % 360;
      swirl.set(from);
      swirl.set(withRepeat(withTiming(from + 360, { duration: SPIN_MS, easing: Easing.linear }), -1, false));
    } else {
      // Volta para perto da posição de repouso (azul em cima, verde à direita) e balança.
      const rest = Math.round(swirl.get() / 360) * 360;
      const [ms, angle] = SWAY[state];
      swirl.set(
        withSequence(
          withTiming(rest - angle, { duration: ms / 2, easing: sine }),
          withRepeat(withTiming(rest + angle, { duration: ms, easing: sine }), -1, true),
        ),
      );
    }
    glow.set(
      state === 'think'
        ? withRepeat(withTiming(1, { duration: 600, easing: sine }), -1, true)
        : withTiming(0, { duration: 300 }),
    );
    // Pisca de tempos em tempos, às vezes duas vezes seguidas.
    blink.set(
      openEyes
        ? withRepeat(
            withSequence(
              withDelay(2600, withTiming(0.1, { duration: 70 })),
              withTiming(1, { duration: 110 }),
              withDelay(3100, withTiming(0.1, { duration: 70 })),
              withTiming(1, { duration: 110 }),
              withDelay(120, withTiming(0.1, { duration: 70 })),
              withTiming(1, { duration: 110 }),
            ),
            -1,
          )
        : withTiming(1, { duration: 0 }),
    );
    // À toa, olha para um lado e para o outro.
    look.set(
      state === 'idle'
        ? withRepeat(
            withSequence(
              withDelay(3400, withTiming(1, { duration: 280, easing: sine })),
              withDelay(900, withTiming(0, { duration: 280, easing: sine })),
              withDelay(2600, withTiming(-1, { duration: 280, easing: sine })),
              withDelay(900, withTiming(0, { duration: 280, easing: sine })),
            ),
            -1,
          )
        : withTiming(0, { duration: 200 }),
    );
    talk.set(
      state === 'talk'
        ? withRepeat(withSequence(withTiming(1, { duration: 130 }), withTiming(0.25, { duration: 150 })), -1)
        : withTiming(0, { duration: 120 }),
    );
    if (state === 'wow' || state === 'joy') {
      jump.set(withSequence(withTiming(1, { duration: 200, easing: Easing.out(Easing.quad) }), withSpring(0, { damping: 7, stiffness: 200 })));
    }
    if (state === 'oops') {
      shake.set(
        withSequence(
          withTiming(1, { duration: 60 }),
          withTiming(-1, { duration: 90 }),
          withTiming(0.6, { duration: 80 }),
          withTiming(-0.3, { duration: 80 }),
          withTiming(0, { duration: 80 }),
        ),
      );
    }
  }, [still, state, openEyes, float, swirl, glow, blink, look, talk, jump, shake]);

  useEffect(() => {
    if (!hop || still) return;
    jump.set(withSequence(withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) }), withSpring(0, { damping: 6, stiffness: 180 })));
  }, [hop, still, jump]);

  const floatHeight = FLOAT[state][1];

  const bodyStyle = useAnimatedStyle(() => {
    const f = float.get();
    const up = Math.max(0, jump.get());
    // A mola passa do zero ao cair: abaixo de zero, amassa.
    const squash = Math.min(0, jump.get()) * 0.3;
    return {
      transform: [
        { translateX: shake.get() * 3 * k },
        { translateY: -(f * floatHeight + up * 14) * k },
        { scaleX: 1 - 0.012 * f - squash - up * 0.03 },
        { scaleY: 1 + 0.02 * f + squash + up * 0.05 },
      ],
    };
  });
  const shadowStyle = useAnimatedStyle(() => {
    const lift = float.get() * (floatHeight / 3) + Math.max(0, jump.get()) * 2;
    return { transform: [{ scaleX: 1 - 0.1 * lift }], opacity: 1 - 0.25 * lift };
  });
  const swirlStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${swirl.get()}deg` }] }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: 1 - 0.45 * glow.get(), transform: [{ scale: 1 + 0.12 * glow.get() }] }));
  const eyesStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: look.get() * 1.8 * k }, { scaleY: blink.get() }],
  }));
  const mouthStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: state === 'talk' ? 0.35 + 0.65 * talk.get() : 1 }] }));

  const center = originOf(frame, ORB.cx, ORB.cy);
  const layer = (children: ReactNode) => <Layer size={size} frame={frame}>{children}</Layer>;

  return (
    <View style={{ width: size, height: size }} accessibilityLabel="Nuke" accessibilityRole="image">
      {shadow ? (
        <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: originOf(frame, 60, 109) }, shadowStyle]} pointerEvents="none">
          {layer(shadowPart(id, dark))}
        </Animated.View>
      ) : null}
      <Animated.View
        style={[StyleSheet.absoluteFill, { transformOrigin: originOf(frame, ORB.cx, ORB.bottom) }, bodyStyle]}
        pointerEvents="none">
        <View style={StyleSheet.absoluteFill}>{layer(basePart(id))}</View>
        <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: center }, swirlStyle]}>{layer(tintsPart(id))}</Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: center }, glowStyle]}>{layer(glowPart(id))}</Animated.View>
        <View style={StyleSheet.absoluteFill}>
          {layer(
            <>
              {glossPart(id, dark)}
              {blushPart(id)}
              {browsPart(state)}
            </>,
          )}
        </View>
        <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: originOf(frame, ORB.cx, eyeCenterY(state)) }, eyesStyle]}>
          {layer(eyesPart(state))}
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: originOf(frame, ORB.cx, MOUTH_TOP) }, mouthStyle]}>
          {layer(mouthPart(state))}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

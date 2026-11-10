// O Nuke vivo: a bolha de vidro do NukeAvatar em camadas animadas, com os movimentos da página "11 · Nuke em
// movimento" do Figma. Parado, ele respira, as cores de dentro balançam devagar, pisca e olha para os lados (o
// visor acompanha um pouco); nos tamanhos grandes, com sombra, também flutua. Pensando, olha para cima, as cores
// dão voltas e a luz do meio pulsa; falando, o corpo quica no ritmo da fala; alegre, dá um pulo e sorri com os
// olhos; "uau" arregala os olhos; "ops" balança e murcha; dormindo, respira devagar de olhos fechados. Com `gaze`
// ele vira os olhos para um ponto (a mensagem que chegou) e com `pressed` encolhe sob o dedo. Com "reduzir
// movimento" ligado no aparelho, ou fora de vista (`paused`), fica parado na pose do humor.

import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import type { Gaze } from '@/domain/nukeGaze';

import {
  arcsPart,
  basePart,
  EYE_POSES,
  EYE_X,
  EYE_Y,
  eyePart,
  frameFor,
  glossPart,
  glowPart,
  Layer,
  ORB,
  originOf,
  SHADOW,
  shadowPart,
  tintsPart,
  useGradientId,
  visorPart,
  type NukeMood,
} from './NukeArt';
import { useScheme } from './theme';

export type NukeState = NukeMood;

const sine = Easing.inOut(Easing.sin);
const POSE = { duration: 220, easing: Easing.out(Easing.cubic) };
const GAZE = { duration: 280, easing: Easing.out(Easing.cubic) };

// As medidas daqui são do quadro de 120 (a bolha tem 88 de diâmetro); no Figma o boneco tem 195.

/** O relógio de cada humor, em ms: olhos e corpo leem o mesmo, para a piscada cair logo antes do olhar. */
const LOOP_MS: Record<NukeMood, number> = { idle: 8000, joy: 8000, wow: 8000, oops: 8000, think: 2400, talk: 1600, sleep: 7000 };
/** Subir e descer: ms de ida, quanto sobe, quanto estica e quanto afina. Parado, só sobe quem tem sombra. */
const FLOAT: Record<NukeMood, [ms: number, lift: number, stretch: number, slim: number]> = {
  idle: [2000, 3.2, 0.02, 0.01],
  joy: [2000, 3.2, 0.02, 0.01],
  wow: [2000, 3.2, 0.02, 0.01],
  oops: [2000, 3.2, 0.02, 0.01],
  think: [600, 1.35, 0.01, 0.005],
  talk: [2000, 0, 0, 0],
  sleep: [3500, 0, 0.035, 0.012],
};
/** Balanço das cores de dentro: ms de um lado ao outro e ângulo máximo. Pensando, dão voltas. */
const SWAY: Record<Exclude<NukeMood, 'think'>, [number, number]> = {
  idle: [4000, 25],
  joy: [4000, 25],
  wow: [4000, 25],
  oops: [4000, 25],
  talk: [2200, 20],
  sleep: [3500, 8],
};
const SPIN_MS = 2400;
/** As reações que acontecem uma vez, ao entrar no humor, e quanto duram. */
const SHOT_MS: Partial<Record<NukeMood, number>> = { joy: 1000, wow: 1350, oops: 1400 };

const fractions = (seconds: number[], total: number) => seconds.map((s) => s / total);

/** Piscadas num laço de `total` segundos: em cada instante, fecha em 70 ms e abre em 110. */
function blinks(at: number[], total: number): [times: number[], lids: number[]] {
  const times = [0];
  const lids = [1];
  for (const t of at) {
    times.push(t, t + 0.07, t + 0.18);
    lids.push(1, 0.1, 1);
  }
  times.push(total);
  lids.push(1);
  return [fractions(times, total), lids];
}

// Parado (8 s): olha para a direita, volta, olha para a esquerda, volta; pisca cinco vezes, duas delas seguidas.
const LOOK_T = fractions([0, 2.2, 2.5, 3.5, 3.8, 5.6, 5.9, 6.8, 7.1, 8], 8);
const LOOK = [0, 0, 1, 1, 0, 0, -1, -1, 0, 0];
const [IDLE_BLINK_T, IDLE_BLINK] = blinks([1.2, 2.14, 4.6, 4.82, 5.54], 8);
/** Quanto os olhos andam ao olhar para o lado, e a parte disso que o visor acompanha. */
const LOOK_REACH = 3.6;
const VISOR_LOOK = 0.375;

// Falando (1,6 s): o corpo estica e encolhe como sílabas, com o pé no chão; pisca uma vez.
const TALK_T = fractions([0, 0.12, 0.28, 0.42, 0.6, 0.78, 0.95, 1.1, 1.3, 1.6], 1.6);
const TALK_STRETCH = [1, 1.045, 0.99, 1.035, 1, 1.05, 0.99, 1.03, 1, 1];
const [TALK_BLINK_T, TALK_BLINK] = blinks([1.36], 1.6);

// Alegre (1 s): agacha, pula, cai e amassa.
const JOY_T = [0, 0.12, 0.38, 0.62, 0.72, 1];
const JOY_STRETCH = [1, 0.92, 1.08, 1, 0.9, 1];
const JOY_WIDEN = [1, 1.06, 0.95, 1, 1.07, 1];
const JOY_LIFT = [0, 0, 8.2, 0, 0, 0];
const JOY_TURN = [0, 0, 30, 0, 0, 0];

// "Uau" (1,35 s): cresce de susto, segura e volta.
const WOW_T = fractions([0, 0.18, 1.1, 1.35], 1.35);
const WOW_POP = [0, 1, 1, 0];

// "Ops" (1,4 s): balança de um lado para o outro e depois murcha, meio de lado.
const OOPS_SHAKE_T = fractions([0, 0.06, 0.15, 0.23, 0.31, 0.39, 1.4], 1.4);
const OOPS_SHAKE = [0, 3.6, -3.6, 2.3, -1.35, 0, 0];
const OOPS_SLUMP_T = fractions([0, 0.39, 0.6, 1.05, 1.4], 1.4);
const OOPS_SLUMP = [0, 0, 1, 1, 0];

/** Seguindo um ponto: quanto os olhos andam de lado e para baixo, a parte do visor e a inclinação do corpo. */
const GAZE_X = 9.9;
const GAZE_Y = 3.6;
const VISOR_GAZE = 0.4;
const GAZE_TILT = 5.8;

export function NukeLive({
  size = 64,
  state = 'idle',
  hop = false,
  shadow = size >= 56,
  paused = false,
  gaze = null,
  pressed = false,
}: {
  size?: number;
  state?: NukeState;
  hop?: boolean;
  /** Sombra embaixo; nos tamanhos pequenos a bolha ocupa o quadro todo. */
  shadow?: boolean;
  /** Fora de vista (atrás de outra tela): para as animações. */
  paused?: boolean;
  /** Para onde olhar (domain/nukeGaze). Sem isto, parado, ele olha em volta sozinho. */
  gaze?: Gaze | null;
  /** O dedo está em cima dele (o botão do Nuke): encolhe e fecha os olhos; ao soltar, volta com mola. */
  pressed?: boolean;
}) {
  const dark = useScheme() === 'dark';
  const id = useGradientId();
  const frame = frameFor(shadow);
  const k = size / frame.w;
  const reduceMotion = useReducedMotion();
  const still = paused || reduceMotion;
  // Dormindo não segue ninguém. Pensando, o olhar para um ponto toma o lugar do olhar para cima (ele lê a
  // mensagem e só depois pensa).
  const follows = state !== 'sleep';
  const yields = state === 'think';
  const [, lift, stretch, slim] = FLOAT[state];
  const floatUp = state === 'think' || shadow ? lift : 0;
  const gazeToX = gaze?.x ?? null;
  const gazeToY = gaze?.y ?? null;

  const clock = useSharedValue(0);
  const shot = useSharedValue(1);
  const float = useSharedValue(0);
  const swirl = useSharedValue(0);
  const glow = useSharedValue(0);
  const jump = useSharedValue(0);
  const press = useSharedValue(0);
  const wink = useSharedValue(1);
  const eyeX = useSharedValue(EYE_POSES[state].dx);
  const eyeY = useSharedValue(EYE_POSES[state].dy);
  const eyeWide = useSharedValue(EYE_POSES[state].sx);
  const eyeTall = useSharedValue(EYE_POSES[state].sy);
  const visorX = useSharedValue(EYE_POSES[state].visorDx);
  const visorY = useSharedValue(EYE_POSES[state].visorDy);
  const arcs = useSharedValue(EYE_POSES[state].arcs ? 1 : 0);
  const gazeX = useSharedValue(0);
  const gazeY = useSharedValue(0);
  const gazeOn = useSharedValue(0);

  // Os laços do humor.
  useEffect(() => {
    if (still) {
      // Parado: tudo em repouso, na hora (cores no lugar, olhos abertos).
      for (const value of [clock, shot, float, swirl, glow, jump, wink]) cancelAnimation(value);
      clock.set(0);
      shot.set(1);
      float.set(0);
      swirl.set(Math.round(swirl.get() / 360) * 360);
      glow.set(0);
      jump.set(0);
      wink.set(1);
      return;
    }
    clock.set(0);
    clock.set(withRepeat(withTiming(1, { duration: LOOP_MS[state], easing: Easing.linear }), -1, false));
    // Volta ao chão e sobe e desce dali (o vaivém repete a partir de onde começa).
    const [floatMs] = FLOAT[state];
    float.set(
      withSequence(
        withTiming(0, { duration: Math.round(300 * float.get()) }),
        withRepeat(withTiming(1, { duration: floatMs, easing: sine }), -1, true),
      ),
    );
    if (state === 'think') {
      // Voltas contínuas a partir de onde estava.
      const from = swirl.get() % 360;
      swirl.set(from);
      swirl.set(withRepeat(withTiming(from + 360, { duration: SPIN_MS, easing: Easing.linear }), -1, false));
    } else {
      // Volta para perto da posição de repouso (laranja em cima, lilás à direita) e balança.
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
    const shotMs = SHOT_MS[state];
    if (shotMs) {
      shot.set(0);
      shot.set(withTiming(1, { duration: shotMs, easing: Easing.linear }));
    } else {
      cancelAnimation(shot);
      shot.set(1);
    }
  }, [still, state, clock, shot, float, swirl, glow, jump, wink]);

  // A pose dos olhos e do visor no humor: vai de uma à outra sem pulo.
  useEffect(() => {
    const pose = EYE_POSES[state];
    const move = (value: SharedValue<number>, target: number, timing = POSE) => value.set(still ? target : withTiming(target, timing));
    // No susto, os olhos crescem passando um pouco do ponto.
    const grow = state === 'wow' ? { duration: 240, easing: Easing.out(Easing.back(2.4)) } : POSE;
    move(eyeX, pose.dx);
    move(eyeY, pose.dy);
    move(eyeWide, pose.sx, grow);
    move(eyeTall, pose.sy, grow);
    move(visorX, pose.visorDx);
    move(visorY, pose.visorDy);
    move(arcs, pose.arcs ? 1 : 0, { duration: 120, easing: Easing.linear });
  }, [still, state, eyeX, eyeY, eyeWide, eyeTall, visorX, visorY, arcs]);

  // Seguindo um ponto: vira os olhos para lá, piscando na troca.
  useEffect(() => {
    if (still || gazeToX === null || gazeToY === null) {
      gazeOn.set(still ? 0 : withTiming(0, GAZE));
      return;
    }
    gazeX.set(withTiming(gazeToX, GAZE));
    gazeY.set(withTiming(gazeToY, GAZE));
    gazeOn.set(withTiming(1, GAZE));
    wink.set(withSequence(withTiming(0.1, { duration: 70 }), withTiming(1, { duration: 110 })));
  }, [still, gazeToX, gazeToY, gazeX, gazeY, gazeOn, wink]);

  useEffect(() => {
    if (still) {
      cancelAnimation(press);
      press.set(0);
      return;
    }
    press.set(pressed ? withTiming(1, { duration: 80 }) : withSpring(0, { damping: 9, stiffness: 260 }));
  }, [still, pressed, press]);

  useEffect(() => {
    if (!hop || still) return;
    jump.set(withSequence(withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) }), withSpring(0, { damping: 6, stiffness: 180 })));
  }, [hop, still, jump]);

  const bodyStyle = useAnimatedStyle(() => {
    const f = float.get();
    const up = Math.max(0, jump.get());
    // A mola passa do zero ao cair: abaixo de zero, amassa.
    const squash = Math.min(0, jump.get()) * 0.3;
    const t = clock.get();
    const s = shot.get();
    let x = 0;
    let rise = f * floatUp + up * 14;
    let wide = 1 - slim * f - squash - up * 0.03;
    let tall = 1 + stretch * f + squash + up * 0.05;
    let turn = follows ? gazeOn.get() * gazeX.get() * GAZE_TILT : 0;
    if (state === 'talk') {
      const beat = interpolate(t, TALK_T, TALK_STRETCH) - 1;
      tall += beat;
      wide -= 0.6 * beat;
    } else if (state === 'joy') {
      tall *= interpolate(s, JOY_T, JOY_STRETCH);
      wide *= interpolate(s, JOY_T, JOY_WIDEN);
      rise += interpolate(s, JOY_T, JOY_LIFT);
    } else if (state === 'wow') {
      const pop = interpolate(s, WOW_T, WOW_POP);
      tall *= 1 + 0.07 * pop;
      wide *= 1 + 0.07 * pop;
      rise += 2.7 * pop;
    } else if (state === 'oops') {
      x = interpolate(s, OOPS_SHAKE_T, OOPS_SHAKE);
      const slump = interpolate(s, OOPS_SLUMP_T, OOPS_SLUMP);
      tall *= 1 - 0.04 * slump;
      turn += 4 * slump;
    }
    // Sob o dedo encolhe em volta do meio (a camada cresce a partir do pé).
    const squeeze = 1 - 0.1 * press.get();
    rise += (1 - squeeze) * ORB.r;
    return {
      transform: [
        { translateX: x * k },
        { translateY: -rise * k },
        { rotate: `${turn}deg` },
        { scaleX: wide * squeeze },
        { scaleY: tall * squeeze },
      ],
    };
  });
  const shadowStyle = useAnimatedStyle(() => {
    let rise = float.get() * (floatUp / 3.2) + Math.max(0, jump.get()) * 2;
    if (state === 'joy') rise += interpolate(shot.get(), JOY_T, JOY_LIFT) / 4.1;
    return { transform: [{ scaleX: Math.max(0.6, 1 - 0.14 * rise) }], opacity: Math.max(0.45, 1 - 0.3 * rise) };
  });
  const tintsStyle = useAnimatedStyle(() => {
    let kick = 0;
    if (state === 'joy') kick = interpolate(shot.get(), JOY_T, JOY_TURN);
    else if (state === 'wow') kick = 40 * interpolate(shot.get(), WOW_T, WOW_POP);
    return { transform: [{ rotate: `${swirl.get() + kick}deg` }] };
  });
  const glowStyle = useAnimatedStyle(() => {
    const dim = state === 'sleep' ? 0.3 + 0.15 * float.get() : 0.5 * glow.get();
    return { opacity: 1 - dim, transform: [{ scale: 1 + 0.1 * glow.get() }] };
  });
  const visorStyle = useAnimatedStyle(() => {
    const t = clock.get();
    const g = follows ? gazeOn.get() : 0;
    const own = yields ? 1 - g : 1;
    let dx = visorX.get() * own + g * gazeX.get() * GAZE_X * VISOR_GAZE;
    const dy = visorY.get() * own + g * gazeY.get() * GAZE_Y * VISOR_GAZE;
    if (state === 'idle') dx += (1 - g) * LOOK_REACH * VISOR_LOOK * interpolate(t, LOOK_T, LOOK);
    else if (state === 'think') dx -= own * 0.25 * Math.cos(2 * Math.PI * t);
    return { transform: [{ translateX: dx * k }, { translateY: dy * k }] };
  });
  const eyeStyle = useAnimatedStyle(() => {
    const t = clock.get();
    const g = follows ? gazeOn.get() : 0;
    const own = yields ? 1 - g : 1;
    let dx = eyeX.get() * own + g * gazeX.get() * GAZE_X;
    let dy = eyeY.get() * own + g * gazeY.get() * GAZE_Y;
    let lid = wink.get();
    if (state === 'idle') {
      dx += (1 - g) * LOOK_REACH * interpolate(t, LOOK_T, LOOK);
      lid *= interpolate(t, IDLE_BLINK_T, IDLE_BLINK);
    } else if (state === 'talk') {
      // Os olhos sobem um pouco mais que o corpo quando ele estica.
      dy -= (interpolate(t, TALK_T, TALK_STRETCH) - 1) * 22;
      lid *= interpolate(t, TALK_BLINK_T, TALK_BLINK);
    } else if (state === 'think') {
      dx -= own * 0.7 * Math.cos(2 * Math.PI * t);
    }
    lid *= 1 - 0.9 * Math.min(1, Math.max(0, press.get()));
    return {
      opacity: 1 - arcs.get(),
      transform: [{ translateX: dx * k }, { translateY: dy * k }, { scaleX: eyeWide.get() }, { scaleY: eyeTall.get() * lid }],
    };
  });
  const arcsStyle = useAnimatedStyle(() => {
    const g = follows ? gazeOn.get() : 0;
    const shown = arcs.get();
    return {
      opacity: shown,
      transform: [
        { translateX: g * gazeX.get() * GAZE_X * k },
        { translateY: g * gazeY.get() * GAZE_Y * k },
        { scaleY: 0.3 + 0.7 * shown },
      ],
    };
  });

  const center = originOf(frame, ORB.cx, ORB.cy);
  const layer = (children: ReactNode) => <Layer size={size} frame={frame}>{children}</Layer>;
  // O recorte redondo da bolha: o visor não sai dela quando acompanha o olhar.
  const orbLeft = (ORB.cx - ORB.r - frame.x) * k;
  const orbTop = (ORB.cy - ORB.r - frame.y) * k;
  const orbSize = 2 * ORB.r * k;

  return (
    <View style={{ width: size, height: size }} accessibilityLabel="Nuke" accessibilityRole="image">
      {shadow ? (
        <Animated.View style={[styles.fill, { transformOrigin: originOf(frame, SHADOW.cx, SHADOW.cy) }, shadowStyle]}>
          {layer(shadowPart(id, dark))}
        </Animated.View>
      ) : null}
      <Animated.View style={[styles.fill, { transformOrigin: originOf(frame, ORB.cx, ORB.bottom) }, bodyStyle]}>
        <View style={StyleSheet.absoluteFill}>{layer(basePart(id))}</View>
        <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: center }, tintsStyle]}>{layer(tintsPart(id))}</Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: center }, glowStyle]}>{layer(glowPart(id))}</Animated.View>
        <View style={[styles.clip, { left: orbLeft, top: orbTop, width: orbSize, height: orbSize, borderRadius: orbSize / 2 }]}>
          <Animated.View style={[styles.layer, { left: -orbLeft, top: -orbTop, width: size, height: size }, visorStyle]}>
            {layer(visorPart(id))}
          </Animated.View>
        </View>
        <View style={StyleSheet.absoluteFill}>{layer(glossPart(id, dark))}</View>
        {([0, 1] as const).map((index) => (
          <Animated.View
            key={index}
            style={[StyleSheet.absoluteFill, { transformOrigin: originOf(frame, EYE_X[index], EYE_Y) }, eyeStyle]}>
            {layer(eyePart(id, index))}
          </Animated.View>
        ))}
        <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: originOf(frame, ORB.cx, EYE_Y) }, arcsStyle]}>
          {layer(arcsPart())}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // As camadas de fora não recebem o toque: ele é de quem está em volta (o botão do Nuke).
  fill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, pointerEvents: 'none' },
  clip: { position: 'absolute', overflow: 'hidden' },
  layer: { position: 'absolute' },
});

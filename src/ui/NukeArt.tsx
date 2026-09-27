// O Nuke: uma bolha de vidro fosco com cores pastel por dentro (azul, verde,
// amarelo), bochechas e um rostinho. Desenhado em partes para o NukeLive
// animar cada uma (sombra, vidro, cores girando, brilho, olhos, boca); o
// NukeAvatar junta tudo num SVG parado, para listas.

import { useId, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';

export type NukeMood = 'idle' | 'joy' | 'think' | 'talk' | 'wow' | 'sleep' | 'oops';

/** Quadro de 120 x 120: bolha com centro em (60, 56) e raio 44, sombra embaixo. */
export const ORB = { cx: 60, cy: 56, r: 44, bottom: 100 };
export const EYE_Y = 47;
export const MOUTH_TOP = 54.5;
/** Traço do rosto: marrom bem escuro, como na referência. */
export const NUKE_INK = '#2A1F1A';

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}
const FULL: Frame = { x: 0, y: 0, w: 120, h: 120 };
/** Só a bolha, sem sombra: para tamanhos pequenos (cabeçalho, mensagens, botão). */
const TIGHT: Frame = { x: 14, y: 10, w: 92, h: 92 };

export const frameFor = (shadow: boolean) => (shadow ? FULL : TIGHT);
export const viewBoxOf = (f: Frame) => `${f.x} ${f.y} ${f.w} ${f.h}`;
/** Ponto do quadro em porcentagem, para o transformOrigin das camadas. */
export const originOf = (f: Frame, x: number, y: number) => `${((x - f.x) / f.w) * 100}% ${((y - f.y) / f.h) * 100}%`;

/** Prefixo único dos gradientes: no web, ids repetidos na página se confundem. */
export function useGradientId(): string {
  return `nk${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
}

type Stops = [offset: number, color: string, opacity?: number][];

function Radial({ id, cx, cy, r, stops }: { id: string; cx: string; cy: string; r: string; stops: Stops }) {
  return (
    <RadialGradient id={id} cx={cx} cy={cy} r={r} fx={cx} fy={cy}>
      {stops.map(([offset, color, opacity = 1]) => (
        <Stop key={offset} offset={offset} stopColor={color} stopOpacity={opacity} />
      ))}
    </RadialGradient>
  );
}

const orbCircle = (fill: string) => <Circle cx={ORB.cx} cy={ORB.cy} r={ORB.r} fill={fill} />;

// ---------------------------------------------------------------------------
// Partes (cada uma com seus gradientes: no nativo, um SVG não enxerga os do outro)

export function shadowPart(id: string, dark: boolean): ReactNode {
  return (
    <>
      <Defs>
        <Radial
          id={`${id}sh`}
          cx="50%"
          cy="50%"
          r="50%"
          stops={
            dark
              ? [[0, '#F2C45A', 0.55], [0.5, '#C99A48', 0.22], [1, '#C99A48', 0]]
              : [[0, '#E9B94F', 0.55], [0.45, '#C9A56A', 0.28], [1, '#8C7A66', 0]]
          }
        />
      </Defs>
      <Ellipse cx={60} cy={109} rx={36} ry={5.5} fill={`url(#${id}sh)`} />
    </>
  );
}

/** O vidro: creme por dentro, um pouco mais frio na borda. */
export function basePart(id: string): ReactNode {
  return (
    <>
      <Defs>
        <Radial id={`${id}ba`} cx="50%" cy="52%" r="50%" stops={[[0, '#FFF7D6'], [0.55, '#FBF3D8'], [1, '#EFEBDD']]} />
      </Defs>
      {orbCircle(`url(#${id}ba)`)}
    </>
  );
}

/** As cores de dentro (azul em cima, verde à direita, pêssego embaixo): giram devagar no NukeLive. */
export function tintsPart(id: string): ReactNode {
  return (
    <>
      <Defs>
        <Radial id={`${id}pe`} cx="30%" cy="86%" r="45%" stops={[[0, '#F7E0A8', 0.8], [1, '#F7E0A8', 0]]} />
        <Radial id={`${id}bl`} cx="22%" cy="22%" r="62%" stops={[[0, '#7DB8EC', 0.95], [0.5, '#A9D0EE', 0.5], [1, '#A9D0EE', 0]]} />
        <Radial id={`${id}gr`} cx="86%" cy="66%" r="58%" stops={[[0, '#6FC79A', 0.9], [0.5, '#A5DDB8', 0.45], [1, '#A5DDB8', 0]]} />
      </Defs>
      {orbCircle(`url(#${id}pe)`)}
      {orbCircle(`url(#${id}bl)`)}
      {orbCircle(`url(#${id}gr)`)}
    </>
  );
}

/** A luz quente do meio. */
export function glowPart(id: string): ReactNode {
  return (
    <>
      <Defs>
        <Radial id={`${id}gl`} cx="50%" cy="46%" r="38%" stops={[[0, '#FFF8D2'], [0.6, '#FFF6D4', 0.6], [1, '#FFF6D4', 0]]} />
      </Defs>
      {orbCircle(`url(#${id}gl)`)}
    </>
  );
}

/** Borda clara do vidro e o reflexo em cima, à esquerda (a luz não gira com as cores). */
export function glossPart(id: string, dark: boolean): ReactNode {
  return (
    <>
      <Defs>
        <Radial id={`${id}ri`} cx="50%" cy="50%" r="50%" stops={[[0.78, '#FFFFFF', 0], [0.93, '#FFFFFF', 0.28], [1, '#FFFFFF', 0.7]]} />
        <LinearGradient id={`${id}gs`} x1="0" y1="0" x2="0.6" y2="1">
          <Stop offset={0} stopColor="#FFFFFF" stopOpacity={0.95} />
          <Stop offset={1} stopColor="#FFFFFF" stopOpacity={0} />
        </LinearGradient>
      </Defs>
      {orbCircle(`url(#${id}ri)`)}
      <Circle cx={ORB.cx} cy={ORB.cy} r={ORB.r - 0.4} fill="none" stroke="#FFFFFF" strokeOpacity={dark ? 0.35 : 0.6} strokeWidth={0.8} />
      <Path d="M27 38 C31 25 44 16.5 58 15.5 C47 19.5 36 27 31 40 C30 42.5 26 41.5 27 38 Z" fill={`url(#${id}gs)`} opacity={0.8} />
    </>
  );
}

export function blushPart(id: string): ReactNode {
  return (
    <>
      <Defs>
        <Radial id={`${id}bu`} cx="50%" cy="50%" r="50%" stops={[[0, '#FF946E', 0.6], [0.55, '#FFA886', 0.35], [1, '#FFB899', 0]]} />
      </Defs>
      <Ellipse cx={37} cy={58} rx={9.5} ry={6.5} fill={`url(#${id}bu)`} />
      <Ellipse cx={83} cy={58} rx={9.5} ry={6.5} fill={`url(#${id}bu)`} />
    </>
  );
}

const STROKE = { stroke: NUKE_INK, strokeWidth: 1.9, strokeLinecap: 'round' as const, fill: 'none' };

function openEyes(dx = 0, dy = 0, grow = 1, squint = 1) {
  return [49, 71].map((x) => (
    <G key={x}>
      <Ellipse cx={x + dx} cy={EYE_Y + dy} rx={3.3 * grow} ry={4.3 * grow * squint} fill={NUKE_INK} />
      <Circle cx={x - 1 + dx} cy={EYE_Y - 1.6 * grow + dy} r={1.1 * grow} fill="#FFFFFF" />
    </G>
  ));
}

/** Olhos abertos piscam; os fechados (alegre, dormindo) não. */
export const hasOpenEyes = (mood: NukeMood) => mood !== 'joy' && mood !== 'sleep';

export function eyesPart(mood: NukeMood): ReactNode {
  switch (mood) {
    case 'joy':
      return (
        <>
          <Path d="M45.5 48 Q49 43.5 52.5 48" {...STROKE} strokeWidth={2.2} />
          <Path d="M67.5 48 Q71 43.5 74.5 48" {...STROKE} strokeWidth={2.2} />
        </>
      );
    case 'sleep':
      return (
        <>
          <Path d="M45.5 47.5 Q49 50.5 52.5 47.5" {...STROKE} />
          <Path d="M67.5 47.5 Q71 50.5 74.5 47.5" {...STROKE} />
        </>
      );
    case 'think':
      return openEyes(2.2, -2.6);
    case 'wow':
      return openEyes(0, -1, 1.2);
    case 'oops':
      return openEyes(0, 1.5, 1, 0.92);
    default:
      return openEyes();
  }
}

/** Sobrancelhas só no "ops": preocupado, pontas de dentro para cima. */
export function browsPart(mood: NukeMood): ReactNode {
  if (mood !== 'oops') return null;
  return (
    <>
      <Path d="M45.5 42.4 L51.5 40.6" {...STROKE} strokeWidth={1.5} />
      <Path d="M74.5 42.4 L68.5 40.6" {...STROKE} strokeWidth={1.5} />
    </>
  );
}

export function mouthPart(mood: NukeMood): ReactNode {
  switch (mood) {
    case 'joy':
      return <Path d="M54.5 54.5 Q60 61.5 65.5 54.5 Z" fill={NUKE_INK} />;
    case 'think':
      return <Ellipse cx={62} cy={57} rx={1.9} ry={1.6} fill={NUKE_INK} />;
    case 'talk':
      return (
        <>
          <Path d="M55.5 54.5 Q60 62.5 64.5 54.5 Z" fill={NUKE_INK} />
          <Path d="M57.5 58.2 Q60 60.3 62.5 58.2" fill="#E87A6A" />
        </>
      );
    case 'wow':
      return <Ellipse cx={60} cy={57.5} rx={2.8} ry={3.4} fill={NUKE_INK} />;
    case 'sleep':
      return <Path d="M58 56.5 Q60 57.6 62 56.5" {...STROKE} />;
    case 'oops':
      return <Path d="M56 57.5 Q58 55.8 60 57.5 Q62 59.2 64 57.5" {...STROKE} />;
    default:
      return <Path d="M56 55.5 Q60 59 64 55.5" {...STROKE} />;
  }
}

/** Uma camada do Nuke: um SVG do tamanho do quadro. */
export function Layer({ size, frame, children }: { size: number; frame: Frame; children: ReactNode }) {
  return (
    <Svg width={size} height={(size * frame.h) / frame.w} viewBox={viewBoxOf(frame)}>
      {children}
    </Svg>
  );
}

/** O Nuke parado (listas de mensagens). Sombra só nos tamanhos grandes. */
export function NukeAvatar({ size = 64, mood = 'idle', shadow = size >= 56 }: { size?: number; mood?: NukeMood; shadow?: boolean }) {
  const dark = useColorScheme() === 'dark';
  const id = useGradientId();
  const frame = frameFor(shadow);
  return (
    <Svg width={size} height={(size * frame.h) / frame.w} viewBox={viewBoxOf(frame)} accessibilityLabel="Nuke">
      {shadow ? shadowPart(id, dark) : null}
      {basePart(id)}
      {tintsPart(id)}
      {glowPart(id)}
      {glossPart(id, dark)}
      {blushPart(id)}
      {eyesPart(mood)}
      {browsPart(mood)}
      {mouthPart(mood)}
    </Svg>
  );
}

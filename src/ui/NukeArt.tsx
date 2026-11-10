// O Nuke: uma bolha de vidro com cores quentes por dentro (pêssego, laranja, um lilás na borda) e, na frente, um
// visor creme com dois olhos. Sem boca, bochecha nem sobrancelha: o humor está nos olhos e no corpo. Desenhado em
// partes para o NukeLive animar cada uma (sombra, vidro, cores girando, luz, visor, olhos); o NukeAvatar junta
// tudo num SVG parado, para listas. As medidas vêm do componente "Nuke - Iddle" do kit do Figma (68 x 68),
// levadas ao quadro de 120 daqui.

import type { ReactNode } from 'react';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { useSvgId } from './svgId';
import { useScheme } from './theme';

export type NukeMood = 'idle' | 'joy' | 'think' | 'talk' | 'wow' | 'sleep' | 'oops';

/** Quadro de 120 x 120: bolha com centro em (60, 56) e raio 44, sombra embaixo. */
export const ORB = { cx: 60, cy: 56, r: 44, bottom: 100 };
/**
 * O contorno do visor (a "Union" do Figma): quase uma elipse de 74,4 x 67,6, um pouco mais cheia embaixo. São os
 * pontos da curva (M, C, C, L, C, C, L, C, C), com o centro em (60, 61,4).
 */
const VISOR_CENTER = { x: 60, y: 61.415 };
const VISOR_POINTS: [command: 'M' | 'C' | 'L', ...points: number[]][] = [
  ['M', 60, 27.59],
  ['C', 79.28, 27.59, 95.12, 40.56, 97.02, 57.19],
  ['C', 97.14, 57.91, 97.21, 58.64, 97.21, 59.38],
  ['L', 97.21, 62.29],
  ['C', 97.21, 80.49, 80.55, 95.24, 60, 95.24],
  ['C', 39.45, 95.24, 22.79, 80.49, 22.79, 62.29],
  ['L', 22.79, 59.38],
  ['C', 22.79, 58.64, 22.86, 57.91, 22.98, 57.19],
  ['C', 24.88, 40.56, 40.72, 27.59, 60, 27.59],
];
/** Os olhos: duas pílulas em pé, à mesma distância do meio. */
const EYE = { gap: 12.85, y: 60.74, w: 8.12, h: 12.18 };
/** O centro de cada olho (esquerdo, direito) e a altura deles. */
export const EYE_X: readonly [number, number] = [ORB.cx - EYE.gap, ORB.cx + EYE.gap];
export const EYE_Y = EYE.y;
/** A sombra no chão, embaixo da bolha. */
export const SHADOW = { cx: 60, cy: 106.3, rx: 26.5, ry: 3.6 };
/** A cor dos olhos: um grafite quente. */
export const NUKE_INK = '#3A3838';

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

/** Prefixo único dos gradientes do Nuke. */
export const useGradientId = () => useSvgId('nk');

/**
 * A pose dos olhos em cada humor, no quadro de 120: quanto os olhos saem do lugar, quanto alargam e achatam,
 * quanto o visor acompanha e se, no lugar das pílulas, entram os arcos de sorriso.
 */
export interface EyePose {
  dx: number;
  dy: number;
  sx: number;
  sy: number;
  visorDx: number;
  visorDy: number;
  arcs: boolean;
}
const REST: EyePose = { dx: 0, dy: 0, sx: 1, sy: 1, visorDx: 0, visorDy: 0, arcs: false };
export const EYE_POSES: Record<NukeMood, EyePose> = {
  idle: REST,
  // Falando, os olhos ficam como parados: quem fala é o corpo.
  talk: REST,
  // Pensando, olha para cima e para o lado, com os olhos um pouco apertados.
  think: { ...REST, dx: 3.4, dy: -3.2, sy: 0.85, visorDx: 1.35, visorDy: -1.1 },
  joy: { ...REST, dy: -0.45, arcs: true },
  wow: { ...REST, dy: -1.35, sx: 1.35, sy: 1.35 },
  // "Ops": olhos baixos e achatados.
  oops: { ...REST, dy: 1.8, sy: 0.45 },
  sleep: { ...REST, dy: 1.35, sx: 1.25, sy: 0.13 },
};

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
      <Ellipse cx={SHADOW.cx} cy={SHADOW.cy} rx={SHADOW.rx} ry={SHADOW.ry} fill={`url(#${id}sh)`} />
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

/** As cores de dentro (laranja em cima, lilás à direita, pêssego embaixo): giram devagar no NukeLive. */
export function tintsPart(id: string): ReactNode {
  return (
    <>
      <Defs>
        <Radial id={`${id}pe`} cx="30%" cy="86%" r="45%" stops={[[0, '#F7E0A8', 0.8], [1, '#F7E0A8', 0]]} />
        <Radial id={`${id}or`} cx="22%" cy="22%" r="62%" stops={[[0, '#FF7A45', 0.26], [0.5, '#FF7A45', 0.1], [1, '#FFFFFF', 0.49]]} />
        <Radial id={`${id}li`} cx="86%" cy="66%" r="58%" stops={[[0.19, '#FFF8EB', 1], [1, '#A0B8FF', 0]]} />
      </Defs>
      {orbCircle(`url(#${id}pe)`)}
      {orbCircle(`url(#${id}or)`)}
      {orbCircle(`url(#${id}li)`)}
    </>
  );
}

/** A luz do meio. */
export function glowPart(id: string): ReactNode {
  return (
    <>
      <Defs>
        <Radial id={`${id}gl`} cx="50%" cy="46%" r="38%" stops={[[0, '#FFFFFF', 0.95], [0.6, '#FFFFFF', 0.5], [1, '#FFFFFF', 0]]} />
      </Defs>
      {orbCircle(`url(#${id}gl)`)}
    </>
  );
}

/** O contorno do visor, encolhido em volta do centro (`scale` abaixo de 1 dá o fio de dentro da borda). */
const visorPath = (scale = 1) => {
  const at = (value: number, center: number) => Math.round((center + (value - center) * scale) * 100) / 100;
  const parts = VISOR_POINTS.map(([command, ...points]) => {
    const scaled = points.map((value, index) => at(value, index % 2 === 0 ? VISOR_CENTER.x : VISOR_CENTER.y));
    return `${command}${scaled.join(' ')}`;
  });
  return `${parts.join(' ')} Z`;
};
const VISOR_PATH = visorPath();
/** O fio dourado tem 0,9 de largura e fica por dentro da borda. */
const VISOR_EDGE_PATH = visorPath(0.988);

/** O visor creme, um pouco mais escuro na borda (a sombra de dentro), com um fio dourado em volta. */
export function visorPart(id: string): ReactNode {
  return (
    <>
      <Defs>
        <Radial id={`${id}vi`} cx="89%" cy="81%" r="95%" stops={[[0, '#EDDDC2'], [1, '#F6EFDB']]} />
        <Radial id={`${id}vs`} cx="50%" cy="53%" r="50%" stops={[[0.84, '#5A3A1E', 0], [1, '#5A3A1E', 0.1]]} />
      </Defs>
      <Path d={VISOR_PATH} fill={`url(#${id}vi)`} />
      <Path d={VISOR_PATH} fill={`url(#${id}vs)`} />
      <Path d={VISOR_EDGE_PATH} fill="none" stroke="#E2B872" strokeOpacity={0.7} strokeWidth={0.9} />
    </>
  );
}

/** Borda clara do vidro e o reflexo em cima, à esquerda (a luz não gira com as cores). */
export function glossPart(id: string, dark: boolean): ReactNode {
  return (
    <>
      <Defs>
        <LinearGradient id={`${id}gs`} x1="0" y1="0" x2="0.6" y2="1">
          <Stop offset={0} stopColor="#FFFFFF" stopOpacity={0.95} />
          <Stop offset={1} stopColor="#FFFFFF" stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Circle cx={ORB.cx} cy={ORB.cy} r={ORB.r - 0.4} fill="none" stroke="#FFFFFF" strokeOpacity={dark ? 0.35 : 0.6} strokeWidth={0.8} />
      <Path d="M27 38 C31 25 44 16.5 58 15.5 C47 19.5 36 27 31 40 C30 42.5 26 41.5 27 38 Z" fill={`url(#${id}gs)`} opacity={0.65} />
    </>
  );
}

/** Um olho aberto: a pílula, mais clara na borda. `index` 0 é o esquerdo. */
export function eyePart(id: string, index: 0 | 1, pose: EyePose = REST): ReactNode {
  const w = EYE.w * pose.sx;
  const h = EYE.h * pose.sy;
  const gradient = `${id}e${index}`;
  return (
    <>
      <Defs>
        <Radial id={gradient} cx="50%" cy="54%" r="60%" stops={[[0, NUKE_INK], [0.6, NUKE_INK], [1, '#5C5959']]} />
      </Defs>
      <Rect
        x={EYE_X[index] + pose.dx - w / 2}
        y={EYE_Y + pose.dy - h / 2}
        width={w}
        height={h}
        rx={Math.min(w, h) / 2}
        fill={`url(#${gradient})`}
      />
    </>
  );
}

/** Os olhos de alegria: dois arcos, no lugar das pílulas. */
export function arcsPart(pose: EyePose = EYE_POSES.joy): ReactNode {
  return EYE_X.map((x) => {
    const cx = x + pose.dx;
    const cy = EYE_Y + pose.dy;
    return (
      <Path
        key={x}
        d={`M${cx - 4.06} ${cy + 2.26} Q${cx} ${cy - 5.41} ${cx + 4.06} ${cy + 2.26}`}
        fill="none"
        stroke={NUKE_INK}
        strokeWidth={2.9}
        strokeLinecap="round"
      />
    );
  });
}

/** Uma camada do Nuke: um SVG do tamanho do quadro. */
export function Layer({ size, frame, children }: { size: number; frame: Frame; children: ReactNode }) {
  return (
    <Svg width={size} height={(size * frame.h) / frame.w} viewBox={viewBoxOf(frame)}>
      {children}
    </Svg>
  );
}

/** O Nuke parado (listas de mensagens), na pose do humor. Sombra só nos tamanhos grandes. */
export function NukeAvatar({ size = 64, mood = 'idle', shadow = size >= 56 }: { size?: number; mood?: NukeMood; shadow?: boolean }) {
  const dark = useScheme() === 'dark';
  const id = useGradientId();
  const frame = frameFor(shadow);
  const pose = EYE_POSES[mood];
  return (
    <Svg width={size} height={(size * frame.h) / frame.w} viewBox={viewBoxOf(frame)} accessibilityLabel="Nuke">
      {shadow ? shadowPart(id, dark) : null}
      {basePart(id)}
      {tintsPart(id)}
      {glowPart(id)}
      <G transform={`translate(${pose.visorDx} ${pose.visorDy})`}>{visorPart(id)}</G>
      {glossPart(id, dark)}
      {pose.arcs ? (
        arcsPart(pose)
      ) : (
        <>
          {eyePart(id, 0, pose)}
          {eyePart(id, 1, pose)}
        </>
      )}
    </Svg>
  );
}

import { describe, expect, it } from '@jest/globals';
import { Path, Rect } from 'react-native-svg';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { EYE_POSES, EYE_X, EYE_Y, NUKE_INK, NukeAvatar, ORB, SHADOW, type NukeMood } from '../NukeArt';

// O Nuke novo: bolha, visor e dois olhos. Sem boca, bochecha nem sobrancelha: o humor está nos olhos.

const MOODS = Object.keys(EYE_POSES) as NukeMood[];

async function draw(mood: NukeMood, size = 64) {
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(<NukeAvatar size={size} mood={mood} />);
  });
  const rects = renderer!.root.findAllByType(Rect).map((node) => node.props);
  const paths = renderer!.root.findAllByType(Path).map((node) => node.props);
  await act(async () => renderer!.unmount());
  return { rects, paths };
}

/** Os pontos por onde um caminho SVG passa: o fim de cada trecho (os pontos de controle das curvas ficam de fora). */
const points = (d: string) =>
  [...d.matchAll(/[MLC]([^MLCZ]+)/g)].map(([, numbers]) => {
    const [y, x] = numbers.trim().split(/\s+/).map(Number).reverse();
    return { x, y };
  });

describe('o desenho do Nuke', () => {
  it('tem os sete humores, cada um com a sua pose de olhos', () => {
    expect(MOODS.sort()).toEqual(['idle', 'joy', 'oops', 'sleep', 'talk', 'think', 'wow']);
    // Falando, quem fala é o corpo: os olhos ficam como parados.
    expect(EYE_POSES.talk).toEqual(EYE_POSES.idle);
    expect(EYE_POSES.idle).toEqual({ dx: 0, dy: 0, sx: 1, sy: 1, visorDx: 0, visorDy: 0, arcs: false });
  });

  it('o rosto são só os dois olhos: nada mais leva a cor deles (sem boca)', async () => {
    for (const mood of MOODS) {
      const { rects, paths } = await draw(mood);
      const inked = paths.filter((path) => path.stroke === NUKE_INK || path.fill === NUKE_INK);
      if (EYE_POSES[mood].arcs) {
        // Alegre: dois arcos de sorriso no lugar das pílulas.
        expect(rects).toHaveLength(0);
        expect(inked).toHaveLength(2);
        for (const arc of inked) expect(arc).toMatchObject({ fill: 'none', strokeLinecap: 'round' });
      } else {
        expect(rects).toHaveLength(2);
        expect(inked).toHaveLength(0);
      }
    }
  });

  it('os olhos são pílulas iguais, à mesma distância do meio, na pose do humor', async () => {
    expect((EYE_X[0] + EYE_X[1]) / 2).toBeCloseTo(ORB.cx, 5);
    for (const mood of MOODS.filter((m) => !EYE_POSES[m].arcs)) {
      const pose = EYE_POSES[mood];
      const { rects } = await draw(mood);
      const [left, right] = rects;
      expect(left.width).toBeCloseTo(right.width, 5);
      expect(left.height).toBeCloseTo(right.height, 5);
      // Cantos de pílula: o raio é metade do lado menor.
      expect(left.rx).toBeCloseTo(Math.min(left.width, left.height) / 2, 5);
      expect(left.x + left.width / 2).toBeCloseTo(EYE_X[0] + pose.dx, 5);
      expect(right.x + right.width / 2).toBeCloseTo(EYE_X[1] + pose.dx, 5);
      expect(left.y + left.height / 2).toBeCloseTo(EYE_Y + pose.dy, 5);
    }
    // Parado, a pílula fica em pé; de susto cresce; no "ops" e dormindo achata.
    const idle = (await draw('idle')).rects[0];
    expect(idle.height).toBeGreaterThan(idle.width);
    expect((await draw('wow')).rects[0].height).toBeGreaterThan(idle.height);
    expect((await draw('oops')).rects[0].height).toBeLessThan(idle.height / 2);
    expect((await draw('sleep')).rects[0].height).toBeLessThan(idle.height / 4);
  });

  it('o visor é simétrico, cabe na bolha e os olhos de todo humor cabem nele', async () => {
    const { paths } = await draw('idle', 120);
    const visor = paths.find((path) => typeof path.d === 'string' && path.d.endsWith('Z') && String(path.fill).includes('vi'))!;
    const outline = points(visor.d);
    const xs = outline.map((point) => point.x);
    const ys = outline.map((point) => point.y);
    const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    expect((left + right) / 2).toBeCloseTo(ORB.cx, 1);
    // Os pontos da curva de um lado têm o espelho do outro.
    for (const point of outline) {
      expect(outline.some((other) => Math.abs(other.x - (2 * ORB.cx - point.x)) < 0.02 && Math.abs(other.y - point.y) < 0.02)).toBe(true);
    }
    for (const point of outline) expect(Math.hypot(point.x - ORB.cx, point.y - ORB.cy)).toBeLessThan(ORB.r);
    for (const mood of MOODS.filter((m) => !EYE_POSES[m].arcs)) {
      const pose = EYE_POSES[mood];
      for (const eye of (await draw(mood, 120)).rects) {
        expect(eye.x).toBeGreaterThan(left + pose.visorDx);
        expect(eye.x + eye.width).toBeLessThan(right + pose.visorDx);
        expect(eye.y).toBeGreaterThan(top + pose.visorDy);
        expect(eye.y + eye.height).toBeLessThan(bottom + pose.visorDy);
      }
    }
  });

  it('a sombra fica no chão, embaixo da bolha, dentro do quadro de 120', () => {
    expect(SHADOW.cx).toBe(ORB.cx);
    expect(SHADOW.cy - SHADOW.ry).toBeGreaterThan(ORB.bottom);
    expect(SHADOW.cy + SHADOW.ry).toBeLessThan(120);
    expect(SHADOW.rx).toBeLessThan(ORB.r);
  });
});

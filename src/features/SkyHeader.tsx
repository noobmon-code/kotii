// O topo da tela Hoje ("Hora dourada"): sem cartão, o céu de agora vira um véu de cor que desce do canto de cima
// à direita e some, com o desenho do clima por cima. De dia o véu é claro; no tema da noite, o céu da noite.

import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { DayPeriod, Sky } from '@/domain/sky';
import { ClimaArt, CLIMA_BOX } from '@/ui/climaArt';
import { AngledGradient, type GradientStop } from '@/ui/gradient';
import { SCREEN_PADDING, space, useScheme } from '@/ui/theme';

/** A margem do desenho: o tamanho da barra de estado quando o aparelho não diz (navegador, Android sem recorte). */
const MIN_TOP = 44;
/** Até onde o véu desce, a partir do alto da tela. */
const WASH_HEIGHT = 760;
const ART_RIGHT = 22;

// As cores do véu de dia, por céu: a de cima (no canto) e a do meio. O céu de poucas nuvens é o do desenho da
// tela; os outros saem das cores dos topos de cada céu.
const DAY: Record<Sky, [string, string, number]> = {
  limpo: ['#FFF4D4', '#FFC13D', 0.4],
  'poucas-nuvens': ['#FFE9A8', '#74D6FB', 0.5],
  'parcialmente-nublado': ['#C1D3ED', '#E5F9FF', 0.5],
  nublado: ['#D6DBE4', '#EAEEEF', 0.55],
  chuva: ['#CBD0D8', '#DBE1E3', 0.55],
  'chuva-forte': ['#BEC7CA', '#D8DCE3', 0.55],
  tempestade: ['#CAC7BE', '#A9B0BA', 0.55],
};
const NIGHT: Record<Sky, [string, string]> = {
  limpo: ['#1A2350', '#33427E'],
  'poucas-nuvens': ['#1C2552', '#3A4985'],
  'parcialmente-nublado': ['#222A4E', '#414D7E'],
  nublado: ['#22263A', '#3E445E'],
  chuva: ['#1C2236', '#364061'],
  'chuva-forte': ['#171B2A', '#2C3248'],
  tempestade: ['#13151F', '#2A2D3D'],
};

/** As paradas do véu: começa no canto de cima à direita (227°), pega cor nos primeiros 15% e some aos 62%. */
export function washStops(sky: Sky, dark: boolean): GradientStop[] {
  if (dark) {
    const [from, to] = NIGHT[sky];
    return [
      { offset: 0, color: from, opacity: 0.9 },
      { offset: 0.155, color: to, opacity: 0.75 },
      { offset: 0.62, color: to, opacity: 0 },
    ];
  }
  const [from, to, strength] = DAY[sky];
  return [
    { offset: 0, color: from, opacity: sky === 'poucas-nuvens' ? 0.25 : strength - 0.15 },
    { offset: 0.155, color: to, opacity: strength },
    { offset: 0.62, color: to, opacity: 0 },
  ];
}

export function SkyHeader({ sky, period, children }: { sky: Sky; period: DayPeriod; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const dark = useScheme() === 'dark';
  const top = Math.max(insets.top, MIN_TOP);
  return (
    // Sem a margem da tela: o véu vai de uma borda à outra e começa no alto, atrás da barra de estado.
    <View style={[styles.header, { paddingTop: top + 12 }]}>
      <View pointerEvents="none" style={styles.wash}>
        <AngledGradient angle={227} stops={washStops(sky, dark)} />
      </View>
      <View pointerEvents="none" style={[styles.art, { top: top - 9, right: ART_RIGHT }]}>
        <ClimaArt sky={sky} period={period} />
      </View>
      <View style={styles.text}>{children}</View>
    </View>
  );
}

/** A largura que o título e a data deixam para o desenho do clima. */
export const SKY_ART_ROOM = CLIMA_BOX.width + ART_RIGHT - space.md;

const styles = StyleSheet.create({
  header: {
    marginHorizontal: -SCREEN_PADDING,
    marginTop: -SCREEN_PADDING,
    paddingLeft: SCREEN_PADDING + 24,
    paddingRight: SCREEN_PADDING,
    paddingBottom: 6,
  },
  wash: { position: 'absolute', top: 0, left: 0, right: 0, height: WASH_HEIGHT },
  art: { position: 'absolute' },
  text: { gap: 6 },
});

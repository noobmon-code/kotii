import { useColorScheme } from 'react-native';

// Identidade do Nooky: tons quentes, formas redondas e personagens simples,
// na linha do Headspace, com um toque de vidro: cartões translúcidos sobre um
// fundo com manchas pastel (as cores do Nuke). De dia, creme; à noite, azul
// profundo.

const light = {
  background: '#FBF8F4',
  surface: '#FFFFFF',
  surfaceAlt: '#F3EEE8',
  border: '#EAE3DA',
  text: '#2B2A3A',
  textMuted: '#6F6C7D',
  primary: '#3656F4',
  primarySoft: '#E6EBFF',
  onPrimary: '#FFFFFF',
  brand: '#FF7A45',
  brandSoft: '#FFE3D6',
  danger: '#C42B33',
  dangerSoft: '#FDE6E6',
  warning: '#955300',
  warningSoft: '#FFF1D6',
  info: '#6A4FD8',
  infoSoft: '#EEE9FF',
  // Vidro: cartões e botões claros translúcidos, com borda de luz.
  glass: 'rgba(255, 255, 255, 0.62)',
  glassStrong: 'rgba(255, 255, 255, 0.84)',
  glassBorder: 'rgba(255, 255, 255, 0.95)',
  glassEdge: 'rgba(255, 255, 255, 0.55)',
};

export type Colors = typeof light;

const dark: Colors = {
  background: '#141733',
  surface: '#1E2244',
  surfaceAlt: '#282D55',
  border: '#343A66',
  text: '#F5F3FF',
  textMuted: '#A9A7C9',
  primary: '#8FA2FF',
  primarySoft: '#2A3470',
  onPrimary: '#10132B',
  brand: '#FF8A5B',
  brandSoft: '#3B2A3A',
  danger: '#FF7B7B',
  dangerSoft: '#4A2330',
  warning: '#F2B94B',
  warningSoft: '#43381F',
  info: '#B9A5FF',
  infoSoft: '#342C63',
  glass: 'rgba(255, 255, 255, 0.07)',
  glassStrong: 'rgba(30, 34, 68, 0.86)',
  glassBorder: 'rgba(255, 255, 255, 0.16)',
  glassEdge: 'rgba(255, 255, 255, 0.08)',
};

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

/** Manchas do fundo (Backdrop): azul no alto, verde à direita, quente embaixo. */
const BACKDROP = {
  light: { blue: '#BFDDF7', green: '#CDEFD9', warm: '#FDE7B5' },
  dark: { blue: '#2A3B85', green: '#1B4D4A', warm: '#4A3160' },
};

export function useBackdrop() {
  return BACKDROP[useColorScheme() === 'dark' ? 'dark' : 'light'];
}

/** Sombras suaves do vidro (boxShadow, em todas as plataformas). */
export const shadows = {
  glass: '0px 8px 24px rgba(43, 42, 58, 0.07), 0px 1px 2px rgba(43, 42, 58, 0.05)',
  float: '0px 10px 28px rgba(43, 42, 58, 0.16)',
  primary: '0px 6px 16px rgba(54, 86, 244, 0.28)',
} as const;

/** Cores dos cartões e personagens: fundo pastel, personagem saturado, texto em tinta. */
export type Tint = 'orange' | 'yellow' | 'blue' | 'green' | 'pink' | 'purple';

const TINTS: Record<'light' | 'dark', Record<Tint, { bg: string; art: string }>> = {
  light: {
    orange: { bg: '#FFE3D6', art: '#FF7A45' },
    yellow: { bg: '#FFF1C9', art: '#FFC23D' },
    blue: { bg: '#E2E8FF', art: '#4F6BFF' },
    green: { bg: '#DDF5E8', art: '#35B97F' },
    pink: { bg: '#FFE1EA', art: '#FF7FA6' },
    purple: { bg: '#ECE6FF', art: '#8B6CF0' },
  },
  dark: {
    // À noite os cartões ficam em tons de céu (ameixa, índigo), com o personagem colorido.
    orange: { bg: '#40294A', art: '#FF8A5B' },
    yellow: { bg: '#35305A', art: '#FFC94D' },
    blue: { bg: '#2C3368', art: '#7087FF' },
    green: { bg: '#1F3B38', art: '#45C98E' },
    pink: { bg: '#3D2640', art: '#FF8FB1' },
    purple: { bg: '#30295C', art: '#9D82F5' },
  },
};

// Fundos coloridos translúcidos: vidro colorido sobre as manchas do fundo.
const translucent = (hex: string, alpha: number) =>
  `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, ${alpha})`;
const GLASS_TINTS = Object.fromEntries(
  Object.entries(TINTS).map(([scheme, tints]) => [
    scheme,
    Object.fromEntries(Object.entries(tints).map(([key, t]) => [key, { bg: translucent(t.bg, 0.78), art: t.art }])),
  ]),
) as typeof TINTS;

export function useTint(tint: Tint) {
  return GLASS_TINTS[useColorScheme() === 'dark' ? 'dark' : 'light'][tint];
}

/** Traço dos rostos dos personagens: sempre escuro, sobre cor saturada. */
export const INK = '#2B2A3A';

export const fonts = {
  regular: 'Nunito_400Regular',
  semibold: 'Nunito_600SemiBold',
  bold: 'Nunito_700Bold',
  heavy: 'Nunito_800ExtraBold',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 12, md: 16, lg: 24, xl: 32, pill: 999 } as const;
export const MAX_WIDTH = 720;

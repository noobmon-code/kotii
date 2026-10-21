import { useColorScheme } from 'react-native';

// Identidade do Kotii, "Hora dourada": fundo quase branco e liso, cartões de
// vidro claro com sombra quente e suave, gradiente só em topos de tela e
// cartões grandes, azul como cor de ação. Só o Nuke tem rosto. À noite vale a
// versão "Noite": o mesmo desenho num cinza quente bem escuro, sem o índigo.

const light = {
  background: '#FAF8F5',
  surface: '#FFFFFF',
  surfaceAlt: '#F4EFE9',
  border: '#EBE3DB',
  text: '#33262A',
  textMuted: '#7A6460',
  primary: '#3656F4',
  primarySoft: '#E6EBFF',
  onPrimary: '#FFFFFF',
  brand: '#FF7A45',
  brandSoft: '#FFE7D6',
  danger: '#B4233C',
  dangerSoft: '#FDE3E6',
  warning: '#8A4B00',
  warningSoft: '#FFEBC7',
  // O roxo saiu: no lugar dele, o caramelo.
  info: '#8A5A2B',
  infoSoft: '#FBEDDC',
  // Vidro: cartões e botões claros translúcidos, com borda de luz.
  glass: 'rgba(255, 255, 255, 0.72)',
  glassStrong: 'rgba(255, 255, 255, 0.88)',
  glassBorder: 'rgba(255, 255, 255, 0.95)',
  glassEdge: 'rgba(255, 255, 255, 0.55)',
  // Divisor fino entre linhas: o texto 2 a 12%.
  hairline: 'rgba(122, 100, 96, 0.12)',
};

export type Colors = typeof light;

const dark: Colors = {
  background: '#121420',
  surface: '#1E2029',
  surfaceAlt: '#272A35',
  border: '#2F3240',
  text: '#F5EFE8',
  textMuted: '#B4ACA6',
  primary: '#8FA2FF',
  primarySoft: '#272F5E',
  onPrimary: '#121420',
  brand: '#FF8A5B',
  brandSoft: '#3A2420',
  danger: '#FF8FA0',
  dangerSoft: '#44232C',
  warning: '#FFD08A',
  warningSoft: '#3E3320',
  info: '#EBC89F',
  infoSoft: '#3B2F22',
  glass: 'rgba(255, 255, 255, 0.06)',
  glassStrong: 'rgba(30, 32, 41, 0.88)',
  glassBorder: 'rgba(255, 255, 255, 0.12)',
  glassEdge: 'rgba(255, 255, 255, 0.06)',
  hairline: 'rgba(245, 239, 232, 0.1)',
};

export const PALETTES = { light, dark } as const;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

/** O tema em uso: para quem escolhe entre dois valores que não cabem nas cores. */
export function useScheme(): 'light' | 'dark' {
  return useColorScheme() === 'dark' ? 'dark' : 'light';
}

/** Sombras suaves do vidro (boxShadow, em todas as plataformas), num marrom quente. */
export const shadows = {
  glass: '0px 10px 30px rgba(120, 64, 40, 0.08), 0px 1px 2px rgba(120, 64, 40, 0.05)',
  float: '0px 14px 34px rgba(120, 64, 40, 0.16)',
  primary: '0px 6px 16px rgba(54, 86, 244, 0.28)',
} as const;

/**
 * Gradientes dos topos de tela e dos cartões grandes, em diagonal (de cima à
 * esquerda para baixo à direita). Cada tela tem o seu: Pêssego é a Casa e as
 * listas, Rosa-argila é a Saúde. `eyebrow` e `subtitle` são as cores dos textos
 * pequenos sobre o gradiente; o título usa o texto do tema.
 */
export type GradientName = 'pessego' | 'rosa' | 'salvia';

export interface GradientPalette {
  from: string;
  to: string;
  eyebrow: string;
  subtitle: string;
}

export const GRADIENTS: Record<'light' | 'dark', Record<GradientName, GradientPalette>> = {
  light: {
    pessego: { from: '#FFE7D6', to: '#FFC2A0', eyebrow: '#654B3E', subtitle: '#4A3A36' },
    rosa: { from: '#FFE6E3', to: '#F7B9B5', eyebrow: '#654B3E', subtitle: '#4A3A36' },
    salvia: { from: '#EDF4E1', to: '#C4DFAF', eyebrow: '#4F5A44', subtitle: '#3B4533' },
  },
  dark: {
    pessego: { from: '#3A2420', to: '#5C3426', eyebrow: '#E3BFA8', subtitle: '#D9C3B6' },
    rosa: { from: '#3A1F2A', to: '#5C2E3D', eyebrow: '#E8BCC6', subtitle: '#DCC4CA' },
    salvia: { from: '#1F2E26', to: '#2F4A3A', eyebrow: '#B7D3BE', subtitle: '#C9DACD' },
  },
};

export function useGradient(name: GradientName): GradientPalette {
  return GRADIENTS[useScheme()][name];
}

/** Cores dos cartões e atalhos: fundo pastel, tom saturado para o desenho. */
export type Tint = 'orange' | 'yellow' | 'blue' | 'green' | 'pink' | 'purple';

// `purple` ficou como nome para não mexer em quem já o usa, mas a cor é o caramelo.
const TINTS: Record<'light' | 'dark', Record<Tint, { bg: string; art: string }>> = {
  light: {
    orange: { bg: '#FFE7D6', art: '#FF7A45' },
    yellow: { bg: '#FFF4D4', art: '#FFC23D' },
    blue: { bg: '#E7EEFF', art: '#4F6BFF' },
    green: { bg: '#EDF4E1', art: '#4DAA6E' },
    pink: { bg: '#FFE6E3', art: '#E8776F' },
    purple: { bg: '#FBEDDC', art: '#D49A5A' },
  },
  dark: {
    // À noite os cartões ficam em tons escuros e quentes, com o desenho colorido.
    orange: { bg: '#3A2420', art: '#FF8A5B' },
    yellow: { bg: '#3A3020', art: '#FFC94D' },
    blue: { bg: '#232B55', art: '#8FA2FF' },
    green: { bg: '#1F3A30', art: '#4FC98E' },
    pink: { bg: '#3A1F2A', art: '#FF8FA0' },
    purple: { bg: '#3B2F22', art: '#EBC89F' },
  },
};

/** A cor `#RRGGBB` com transparência: vidro colorido sobre o fundo liso. */
export const withAlpha = (hex: string, alpha: number) =>
  `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, ${alpha})`;
const GLASS_TINTS = Object.fromEntries(
  Object.entries(TINTS).map(([scheme, tints]) => [
    scheme,
    Object.fromEntries(Object.entries(tints).map(([key, t]) => [key, { bg: withAlpha(t.bg, 0.78), art: t.art }])),
  ]),
) as typeof TINTS;

export function useTint(tint: Tint) {
  return GLASS_TINTS[useScheme()][tint];
}

/** O brilho colorido de uma orbe (o vidro por trás de um ícone): o tom do desenho, mais claro. */
const GLOWS: Record<'light' | 'dark', Record<Tint, string>> = {
  light: { orange: '#FFB48F', yellow: '#FFD98A', blue: '#A0B8FF', green: '#B5DC9C', pink: '#F7B9B5', purple: '#EBC89F' },
  dark: { orange: '#FF8A5B', yellow: '#FFC94D', blue: '#8FA2FF', green: '#4FC98E', pink: '#FF8FA0', purple: '#EBC89F' },
};

export function useGlow(tint: Tint): string {
  return GLOWS[useScheme()][tint];
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
// Curvas do desenho: campos 15, tiles e itens 20, cartões e listas 25, topos 30.
export const radius = { sm: 12, md: 15, tile: 20, lg: 25, xl: 30, pill: 999 } as const;
export const MAX_WIDTH = 720;

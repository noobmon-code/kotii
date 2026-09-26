import { useColorScheme } from 'react-native';

const light = {
  background: '#F6F5F1',
  surface: '#FFFFFF',
  surfaceAlt: '#EFEEE8',
  border: '#E2E0D8',
  text: '#1C1B18',
  textMuted: '#6B6960',
  primary: '#2E7D5B',
  primarySoft: '#DCEFE5',
  onPrimary: '#FFFFFF',
  danger: '#C8372D',
  dangerSoft: '#FBE3E1',
  warning: '#9A6412',
  warningSoft: '#FBF0D9',
  info: '#2F6FB0',
  infoSoft: '#E1ECF8',
};

export type Colors = typeof light;

const dark: Colors = {
  background: '#121311',
  surface: '#1C1D1A',
  surfaceAlt: '#262723',
  border: '#33342F',
  text: '#F2F1EC',
  textMuted: '#A3A198',
  primary: '#5CC08F',
  primarySoft: '#1E3A2D',
  onPrimary: '#0E1A14',
  danger: '#F07167',
  dangerSoft: '#3D2220',
  warning: '#E0A84A',
  warningSoft: '#3A2E17',
  info: '#7FB2E5',
  infoSoft: '#1D2A38',
};

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
export const MAX_WIDTH = 720;

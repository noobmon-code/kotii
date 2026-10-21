// Fundo das telas: liso, quase branco de dia e cinza quente à noite. Quem dá cor
// à tela são o topo em gradiente e os cartões de vidro, não o fundo.

import { StyleSheet, View } from 'react-native';

import { useColors } from './theme';

export function Backdrop() {
  const c = useColors();
  return <View style={[StyleSheet.absoluteFill, { backgroundColor: c.background }]} pointerEvents="none" />;
}

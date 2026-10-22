// A marca do Kotii, sem imagem: escala em qualquer tela. Sem rosto: o único personagem com rosto é o Nuke
// (NukeLive e NukeAvatar).

import { Text as RNText, StyleSheet, View } from 'react-native';

import { fonts, useColors } from './theme';

/** Marca: a bolinha laranja e o nome. */
export function Logo({ size = 32 }: { size?: number }) {
  const c = useColors();
  return (
    <View style={styles.logo} accessibilityRole="header" accessibilityLabel="Kotii">
      <View style={{ width: size * 0.9, height: size * 0.9, borderRadius: size, backgroundColor: c.brand }} />
      <RNText style={[styles.logoText, { fontSize: size, lineHeight: size * 1.15, color: c.text }]}>kotii</RNText>
    </View>
  );
}

const styles = StyleSheet.create({
  logo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logoText: { fontFamily: fonts.heavy, letterSpacing: -0.5 },
});

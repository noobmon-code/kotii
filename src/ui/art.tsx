// A marca do Kotii, sem imagem: escala em qualquer tela. É o "k" laranja do ícone do app e o nome. Sem rosto: o
// único personagem com rosto é o Nuke (NukeLive e NukeAvatar).

import { Text as RNText, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { fonts, useColors } from './theme';

/** O laranja da marca, o mesmo do ícone do app. Não é o `brand` do tema, que é o tom dos textos. */
export const LOGO_ORANGE = '#FF5A00';

// O "k" e a bolinha, do componente "Logo" do Figma: quadro de 42,41 x 42,54 ao lado do nome em corpo 32.
const MARK = { width: 42.41, height: 42.54, besideText: 32 };
const MARK_PATHS = [
  'M32 16.51C31.45 15.52 31.7 14.28 32.59 13.58L39.07 8.43C38.55 8.43 38.05 8.6 37.65 8.92L22.85 20.46V2.32C22.85 1.04 21.82 0 20.54 0H13.16C11.88 0 10.85 1.04 10.85 2.32V28.69C10.85 29.4 10.52 30.07 9.96 30.51L0 38.28H0.97L20.87 22.85C22 21.97 23.65 22.32 24.33 23.58L31.54 37.05C31.94 37.81 32.72 38.28 33.58 38.28H40.09C41.86 38.28 42.97 36.39 42.12 34.84L32 16.51Z',
  'M18.82 42.54C15.54 42.54 12.88 39.88 12.88 36.59C12.88 33.3 15.54 30.65 18.82 30.65C22.1 30.65 24.77 33.31 24.77 36.59C24.77 39.87 22.11 42.54 18.82 42.54Z',
];

/** Marca: o "k" laranja e o nome. `size` é o corpo do nome; o "k" acompanha, na proporção do Figma. */
export function Logo({ size = 32 }: { size?: number }) {
  const c = useColors();
  const markHeight = (size * MARK.height) / MARK.besideText;
  return (
    <View style={[styles.logo, { gap: size / 4 }]} accessibilityRole="header" accessibilityLabel="Kotii">
      <Svg
        width={(markHeight * MARK.width) / MARK.height}
        height={markHeight}
        viewBox={`0 0 ${MARK.width} ${MARK.height}`}
        accessible={false}>
        {MARK_PATHS.map((d) => (
          <Path key={d} d={d} fill={LOGO_ORANGE} />
        ))}
      </Svg>
      <RNText style={[styles.logoText, { fontSize: size, lineHeight: size * 1.15, color: c.text }]}>kotii</RNText>
    </View>
  );
}

const styles = StyleSheet.create({
  logo: { flexDirection: 'row', alignItems: 'center' },
  logoText: { fontFamily: fonts.heavy, letterSpacing: -0.5 },
});

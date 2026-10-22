// Ícones 3D de vidro das ações e dos remédios (do Figma, WebP com fundo transparente em 3x). Cada imagem leva
// uma folga em volta (a sombra e o brilho do vidro): o ícone ocupa o tamanho do desenho e a folga sobra para fora.

import { Image } from 'expo-image';
import { View } from 'react-native';

/** Folga, em pontos, de cada lado do desenho. */
export const ICON_ART_PAD = 6;

export const ICON_ART = {
  camera: { source: require('../../assets/Icones/atalho-camera.webp'), width: 48, height: 48 },
  carrinho: { source: require('../../assets/Icones/atalho-carrinho.webp'), width: 48, height: 48 },
  tarefa: { source: require('../../assets/Icones/atalho-tarefa.webp'), width: 48, height: 48 },
  capsula: { source: require('../../assets/Icones/remedio-capsula.webp'), width: 44, height: 43 },
  seringa: { source: require('../../assets/Icones/remedio-seringa.webp'), width: 44, height: 44 },
} as const;

export type IconArtName = keyof typeof ICON_ART;

export function IconArt({ name, scale = 1 }: { name: IconArtName; scale?: number }) {
  const art = ICON_ART[name];
  const pad = ICON_ART_PAD * scale;
  return (
    <View style={{ width: art.width * scale, height: art.height * scale }}>
      <Image
        source={art.source}
        contentFit="fill"
        accessible={false}
        style={{ position: 'absolute', left: -pad, top: -pad, width: art.width * scale + 2 * pad, height: art.height * scale + 2 * pad }}
      />
    </View>
  );
}

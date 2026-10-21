// O desenho do clima no topo da tela Hoje (do Figma): sol, lua, nuvens de vidro, chuva e tempestade, em 14
// combinações (7 céus, de dia e de noite). WebP com fundo transparente em 3x, com folga em volta para o brilho.

import { Image } from 'expo-image';
import { View } from 'react-native';

import type { DayPeriod, Sky } from '@/domain/sky';

/** O tamanho do desenho e a folga, em pontos, de cada lado dele. */
export const CLIMA_BOX = { width: 131, height: 100, pad: 14 } as const;

export const CLIMA_ART: Record<`${DayPeriod}-${Sky}`, number> = {
  'dia-limpo': require('../../assets/Clima/dia-limpo.webp'),
  'dia-poucas-nuvens': require('../../assets/Clima/dia-poucas-nuvens.webp'),
  'dia-parcialmente-nublado': require('../../assets/Clima/dia-parcialmente-nublado.webp'),
  'dia-nublado': require('../../assets/Clima/dia-nublado.webp'),
  'dia-chuva': require('../../assets/Clima/dia-chuva.webp'),
  'dia-chuva-forte': require('../../assets/Clima/dia-chuva-forte.webp'),
  'dia-tempestade': require('../../assets/Clima/dia-tempestade.webp'),
  'noite-limpo': require('../../assets/Clima/noite-limpo.webp'),
  'noite-poucas-nuvens': require('../../assets/Clima/noite-poucas-nuvens.webp'),
  'noite-parcialmente-nublado': require('../../assets/Clima/noite-parcialmente-nublado.webp'),
  'noite-nublado': require('../../assets/Clima/noite-nublado.webp'),
  'noite-chuva': require('../../assets/Clima/noite-chuva.webp'),
  'noite-chuva-forte': require('../../assets/Clima/noite-chuva-forte.webp'),
  'noite-tempestade': require('../../assets/Clima/noite-tempestade.webp'),
};

export function ClimaArt({ sky, period }: { sky: Sky; period: DayPeriod }) {
  const { width, height, pad } = CLIMA_BOX;
  return (
    <View style={{ width, height }} accessible={false} importantForAccessibility="no-hide-descendants">
      <Image
        source={CLIMA_ART[`${period}-${sky}`]}
        contentFit="fill"
        accessible={false}
        style={{ position: 'absolute', left: -pad, top: -pad, width: width + 2 * pad, height: height + 2 * pad }}
      />
    </View>
  );
}

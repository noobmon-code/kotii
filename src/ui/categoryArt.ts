import type { ImageProps } from 'expo-image';

import type { Tint } from './theme';

// Ilustrações das categorias de produto: desenhos no estilo do Kotii, com
// fundo transparente (144px, WebP), sobre uma orbe de vidro da cor `tint`.
// categoryArt.test.ts garante uma para cada categoria de categories.ts.
export const CATEGORY_ART: Record<string, { image: ImageProps['source']; tint: Tint }> = {
  hortifruti: { image: require('../../assets/Itens-Novos/hortifruti.webp'), tint: 'green' },
  carnes: { image: require('../../assets/Itens-Novos/carnes.webp'), tint: 'pink' },
  peixes: { image: require('../../assets/Itens-Novos/peixes.webp'), tint: 'blue' },
  laticinios: { image: require('../../assets/Itens-Novos/laticinios.webp'), tint: 'yellow' },
  ovos: { image: require('../../assets/Itens-Novos/ovos.webp'), tint: 'yellow' },
  padaria: { image: require('../../assets/Itens-Novos/padaria.webp'), tint: 'orange' },
  graos: { image: require('../../assets/Itens-Novos/graos.webp'), tint: 'yellow' },
  congelados: { image: require('../../assets/Itens-Novos/congelados.webp'), tint: 'blue' },
  frios: { image: require('../../assets/categories/frios.webp'), tint: 'pink' },
  doces: { image: require('../../assets/Itens-Novos/doces.webp'), tint: 'pink' },
  snacks: { image: require('../../assets/Itens-Novos/snacks.webp'), tint: 'yellow' },
  temperos: { image: require('../../assets/Itens-Novos/temperos.webp'), tint: 'green' },
  oleos: { image: require('../../assets/Itens-Novos/oleos.webp'), tint: 'green' },
  bebidas: { image: require('../../assets/Itens-Novos/bebidas.webp'), tint: 'orange' },
  alcoolicas: { image: require('../../assets/Itens-Novos/alcoolicas.webp'), tint: 'purple' },
  cafe_cha: { image: require('../../assets/Itens-Novos/cafe_cha.webp'), tint: 'orange' },
  limpeza: { image: require('../../assets/Itens-Novos/limpeza.webp'), tint: 'blue' },
  higiene: { image: require('../../assets/Itens-Novos/higiene.webp'), tint: 'green' },
  papel: { image: require('../../assets/Itens-Novos/papel.webp'), tint: 'blue' },
  bebe: { image: require('../../assets/Itens-Novos/bebe.webp'), tint: 'pink' },
  pet: { image: require('../../assets/Itens-Novos/pet.webp'), tint: 'orange' },
  medicamentos: { image: require('../../assets/Itens-Novos/medicamentos.webp'), tint: 'purple' },
  suplementos: { image: require('../../assets/Itens-Novos/suplementos.webp'), tint: 'green' },
  primeiros_socorros: { image: require('../../assets/Itens-Novos/primeiros_socorros.webp'), tint: 'pink' },
  outros: { image: require('../../assets/Itens-Novos/outros.webp'), tint: 'orange' },
};

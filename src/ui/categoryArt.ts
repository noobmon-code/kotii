import type { ImageProps } from 'expo-image';

import type { Tint } from './theme';

// Ilustrações das categorias de produto: desenhos no estilo do Kotii, com
// fundo transparente (144px, WebP), sobre um círculo pastel da cor `tint`.
// categoryArt.test.ts garante uma para cada categoria de categories.ts.
export const CATEGORY_ART: Record<string, { image: ImageProps['source']; tint: Tint }> = {
  hortifruti: { image: require('../../assets/categories/hortifruti.webp'), tint: 'green' },
  carnes: { image: require('../../assets/categories/carnes.webp'), tint: 'pink' },
  peixes: { image: require('../../assets/categories/peixes.webp'), tint: 'blue' },
  laticinios: { image: require('../../assets/categories/laticinios.webp'), tint: 'yellow' },
  ovos: { image: require('../../assets/categories/ovos.webp'), tint: 'yellow' },
  padaria: { image: require('../../assets/categories/padaria.webp'), tint: 'orange' },
  graos: { image: require('../../assets/categories/graos.webp'), tint: 'yellow' },
  congelados: { image: require('../../assets/categories/congelados.webp'), tint: 'blue' },
  frios: { image: require('../../assets/categories/frios.webp'), tint: 'pink' },
  doces: { image: require('../../assets/categories/doces.webp'), tint: 'pink' },
  snacks: { image: require('../../assets/categories/snacks.webp'), tint: 'yellow' },
  temperos: { image: require('../../assets/categories/temperos.webp'), tint: 'green' },
  oleos: { image: require('../../assets/categories/oleos.webp'), tint: 'green' },
  bebidas: { image: require('../../assets/categories/bebidas.webp'), tint: 'orange' },
  alcoolicas: { image: require('../../assets/categories/alcoolicas.webp'), tint: 'purple' },
  cafe_cha: { image: require('../../assets/categories/cafe_cha.webp'), tint: 'orange' },
  limpeza: { image: require('../../assets/categories/limpeza.webp'), tint: 'blue' },
  higiene: { image: require('../../assets/categories/higiene.webp'), tint: 'green' },
  papel: { image: require('../../assets/categories/papel.webp'), tint: 'blue' },
  bebe: { image: require('../../assets/categories/bebe.webp'), tint: 'pink' },
  pet: { image: require('../../assets/categories/pet.webp'), tint: 'orange' },
  medicamentos: { image: require('../../assets/categories/medicamentos.webp'), tint: 'purple' },
  suplementos: { image: require('../../assets/categories/suplementos.webp'), tint: 'green' },
  primeiros_socorros: { image: require('../../assets/categories/primeiros_socorros.webp'), tint: 'pink' },
  outros: { image: require('../../assets/categories/outros.webp'), tint: 'orange' },
};

import type { ComponentProps } from 'react';
import type MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export interface Category {
  key: string;
  label: string;
  icon: IconName;
  /** Validade padrão a partir da compra; null = não controla validade. */
  shelfLifeDays: number | null;
  /** Vai para a despensa por padrão ao confirmar uma nota. */
  pantry: boolean;
}

// Fonte da verdade das categorias. As chaves são repetidas em
// supabase/functions/_shared/categories.ts (a IA classifica nelas);
// categories.test.ts garante que as duas listas batem.
// Prazos padrão são conservadores: melhor alertar cedo ("dá uma olhada")
// do que tarde. O usuário corrige e o produto aprende.
export const CATEGORIES: readonly Category[] = [
  { key: 'hortifruti', label: 'Frutas e verduras', icon: 'food-apple', shelfLifeDays: 7, pantry: true },
  { key: 'carnes', label: 'Carnes', icon: 'food-steak', shelfLifeDays: 3, pantry: true },
  { key: 'peixes', label: 'Peixes e frutos do mar', icon: 'fish', shelfLifeDays: 2, pantry: true },
  { key: 'laticinios', label: 'Laticínios', icon: 'cheese', shelfLifeDays: 20, pantry: true },
  { key: 'ovos', label: 'Ovos', icon: 'egg', shelfLifeDays: 21, pantry: true },
  { key: 'padaria', label: 'Padaria', icon: 'bread-slice', shelfLifeDays: 5, pantry: true },
  { key: 'graos', label: 'Grãos, massas e cereais', icon: 'rice', shelfLifeDays: 180, pantry: true },
  { key: 'congelados', label: 'Congelados', icon: 'snowflake', shelfLifeDays: 90, pantry: true },
  { key: 'frios', label: 'Frios e embutidos', icon: 'sausage', shelfLifeDays: 10, pantry: true },
  { key: 'doces', label: 'Doces e sobremesas', icon: 'candy', shelfLifeDays: 120, pantry: true },
  { key: 'snacks', label: 'Snacks', icon: 'popcorn', shelfLifeDays: 90, pantry: true },
  { key: 'temperos', label: 'Temperos e molhos', icon: 'shaker-outline', shelfLifeDays: 365, pantry: true },
  { key: 'oleos', label: 'Óleos e azeites', icon: 'oil', shelfLifeDays: 365, pantry: true },
  { key: 'bebidas', label: 'Bebidas', icon: 'bottle-soda', shelfLifeDays: 180, pantry: true },
  { key: 'alcoolicas', label: 'Bebidas alcoólicas', icon: 'glass-wine', shelfLifeDays: null, pantry: false },
  { key: 'cafe_cha', label: 'Café e chá', icon: 'coffee', shelfLifeDays: 180, pantry: true },
  { key: 'limpeza', label: 'Limpeza', icon: 'spray-bottle', shelfLifeDays: null, pantry: false },
  { key: 'higiene', label: 'Higiene pessoal', icon: 'toothbrush-paste', shelfLifeDays: null, pantry: false },
  { key: 'papel', label: 'Papel e descartáveis', icon: 'paper-roll', shelfLifeDays: null, pantry: false },
  { key: 'bebe', label: 'Bebê', icon: 'baby-bottle-outline', shelfLifeDays: null, pantry: false },
  { key: 'pet', label: 'Pet', icon: 'paw', shelfLifeDays: null, pantry: false },
  { key: 'medicamentos', label: 'Medicamentos', icon: 'pill', shelfLifeDays: 365, pantry: true },
  { key: 'suplementos', label: 'Vitaminas e suplementos', icon: 'bottle-tonic-plus', shelfLifeDays: 365, pantry: true },
  { key: 'primeiros_socorros', label: 'Primeiros socorros', icon: 'bandage', shelfLifeDays: null, pantry: false },
  { key: 'outros', label: 'Outros', icon: 'shopping-outline', shelfLifeDays: null, pantry: false },
];

const BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));
const FALLBACK = BY_KEY.get('outros')!;

export function getCategory(key: string | null | undefined): Category {
  return (key && BY_KEY.get(key)) || FALLBACK;
}

const AISLE = new Map(CATEGORIES.map((c, i) => [c.key, i]));

/**
 * Ordem de corredor para a lista de compras: a ordem de CATEGORIES (frescos,
 * despensa, bebidas, casa, farmácia, outros) e, dentro dela, o nome.
 */
export function compareByAisle(a: { category: string; name: string }, b: { category: string; name: string }): number {
  const byCategory = AISLE.get(getCategory(a.category).key)! - AISLE.get(getCategory(b.category).key)!;
  return byCategory || a.name.localeCompare(b.name, 'pt-BR');
}

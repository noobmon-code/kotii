// O preço de um pacote comparado por kg ou litro, e quantos pacotes inteiros
// cumprem uma quantidade. A base aberta de preços (domain/openPrices: o item
// pedido em kg ou litro na lista, com o preço do pacote visto em outras casas)
// usa estas regras, e a troca de marca da lista vai usar as mesmas: uma
// quantidade, numa loja, segue uma regra só. Fica à parte de packageSize.ts,
// que tem um espelho no servidor (supabase/functions/_shared/packageSize.ts)
// e não pode ganhar o que o servidor não lê.

import { pricePerBase } from './units';
import type { PackageSize } from './packageSize';

/** No máximo tantos pacotes inteiros para uma unidade da lista (5 de 1 kg para "Arroz 5 kg"; 12 de 1 L). */
export const MAX_WHOLE_PACKAGES = 12;

/** O preço por kg ou litro de um preço, com o pacote de onde ele saiu, quando saiu de um. */
export interface ComparablePrice {
  base: 'kg' | 'l';
  perBase: number;
  /** O pacote do preço por unidade; null no preço a granel. */
  pack: PackageSize | null;
  /** O preço do pacote; null no preço a granel. */
  packagePrice: number | null;
}

/** Peso ou volume de um pacote só ("5 kg", "900 ml"): kg ou l, sem "N x". null para o resto (contagem, multipack). */
export function plainSize(size: PackageSize | null | undefined): PackageSize | null {
  if (!size || (size.unit !== 'kg' && size.unit !== 'l') || size.of != null || / x /.test(size.label)) return null;
  return size.amount > 0 ? size : null;
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;
const round8 = (n: number) => Math.round(n * 1e8) / 1e8;

/**
 * O preço por kg ou litro: a granel (kg, g, l, ml, pelo pricePerBase, com 4 casas) ou "un" com um pacote de peso ou
 * volume (plainSize; o preço ÷ o tamanho, com 8 casas). null com preço que não é maior que zero, ou sem como comparar
 * (a contagem, o multipack, o "un" sem tamanho).
 */
export function comparablePrice(unit: string, unitPrice: number, size: PackageSize | null | undefined): ComparablePrice | null {
  if (!(unitPrice > 0)) return null;
  const base = pricePerBase(unitPrice, unit);
  if (base.unit === 'kg' || base.unit === 'l') return { base: base.unit, perBase: round4(base.unitPrice), pack: null, packagePrice: null };
  if (base.unit !== 'un') return null;
  const plain = plainSize(size);
  return plain ? { base: plain.unit as 'kg' | 'l', perBase: round8(unitPrice / plain.amount), pack: plain, packagePrice: unitPrice } : null;
}

/**
 * Quantos pacotes inteiros de `size` dão a quantidade: `perUnit` (na unidade do tamanho, por unidade da lista) dividido
 * pelo tamanho tem de ser um inteiro de 1 a MAX_WHOLE_PACKAGES (nunca um pacote maior que a unidade), e vezes
 * `units`, outro inteiro. null quando não fecha: 1 kg com o pacote de 5 kg, 5 kg com o de 2 kg.
 */
export function packagesFor(perUnit: number, units: number, size: PackageSize): number | null {
  if (!(perUnit > 0) || !(units > 0) || !(size.amount > 0)) return null;
  const ratio = perUnit / size.amount;
  const whole = Math.round(ratio);
  if (Math.abs(ratio - whole) > 1e-9 || whole < 1 || whole > MAX_WHOLE_PACKAGES) return null;
  const total = whole * units;
  const count = Math.round(total);
  return Math.abs(total - count) > 1e-9 ? null : count;
}

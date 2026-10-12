// Unidades da lista e do preço. Dentro da mesma grandeza a conversão é exata
// (g <-> kg, ml <-> l); "un" não vira peso nem volume. Vale para a estimativa
// da lista (listEstimate) e para "Onde comprar" (recommendation).

const SCALES: Record<string, { measures: 'peso' | 'volume'; inBase: number }> = {
  kg: { measures: 'peso', inBase: 1000 },
  g: { measures: 'peso', inBase: 1 },
  l: { measures: 'volume', inBase: 1000 },
  ml: { measures: 'volume', inBase: 1 },
};

/** `quantity` de `from` na unidade `to` (200 g -> 0,2 kg); null quando não dá para converter (un x kg). */
export function convertQuantity(quantity: number, from: string, to: string): number | null {
  if (from === to) return quantity;
  const a = SCALES[from];
  const b = SCALES[to];
  if (!a || !b || a.measures !== b.measures) return null;
  return (quantity * a.inBase) / b.inBase;
}

/** As duas unidades medem a mesma coisa: a mesma unidade, g e kg, ou ml e l. */
export function sameDimension(a: string, b: string): boolean {
  return convertQuantity(1, a, b) != null;
}

/**
 * Quantas unidades do preço a lista pede (200 g com preço por kg: 0,2). Quando
 * não dá para converter (3 un de banana com preço por kg), vale 1 unidade do
 * preço, qualquer que seja a quantidade: 500 ml nunca viram 500 x o preço da
 * unidade. Aí a quantidade é aproximada.
 */
export function priceQuantity(quantity: number, listUnit: string, priceUnit: string): { quantity: number; approximate: boolean } {
  const converted = convertQuantity(quantity, listUnit, priceUnit);
  return converted == null ? { quantity: 1, approximate: true } : { quantity: converted, approximate: false };
}

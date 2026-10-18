import { assertEquals } from '@std/assert';

import { nfceReadDay, nfceReadLines } from './readLines.ts';

Deno.test('nfceReadLines: descrição, unidade do app e preço unitário como no rascunho', () => {
  assertEquals(
    nfceReadLines([
      { description: '  ARROZ  T.JOAO 5KG ', quantity: 1, unit: 'UN', unitPrice: 22.9, totalPrice: 22.9 },
      { description: 'BANANA PRATA', quantity: 0.535, unit: 'kg ', unitPrice: 6.99, totalPrice: 3.74 },
      // Sem preço unitário na página: o total dividido pela quantidade.
      { description: 'PAO FRANCES', quantity: 0.3, unit: 'KGS', unitPrice: 0, totalPrice: 5.37 },
      { description: 'LEITE', quantity: 0, unit: 'LT', unitPrice: 0, totalPrice: 4.59 },
      // Sem descrição ou com total negativo: nem o rascunho nem a leitura têm a linha.
      { description: '  ', quantity: 1, unit: 'UN', unitPrice: 1, totalPrice: 1 },
      { description: 'DESCONTO', quantity: 1, unit: 'UN', unitPrice: 1, totalPrice: -1 },
    ]),
    [
      { description: 'ARROZ T.JOAO 5KG', unit: 'un', unit_price: 22.9 },
      { description: 'BANANA PRATA', unit: 'kg', unit_price: 6.99 },
      { description: 'PAO FRANCES', unit: 'kg', unit_price: 17.9 },
      { description: 'LEITE', unit: 'l', unit_price: 4.59 },
    ],
  );
});

Deno.test('nfceReadDay: o dia como a nota mostra', () => {
  assertEquals(nfceReadDay('2026-10-09T23:59:00'), '2026-10-09');
  assertEquals(nfceReadDay(null), null);
  assertEquals(nfceReadDay('09/10/2026'), null);
});

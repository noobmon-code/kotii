import { assertEquals } from '@std/assert';

import {
  afterClassification,
  classifyMode,
  cleanPhoto,
  type ExtractedPhoto,
  MAX_FOUND_PRODUCTS,
  MAX_PRODUCT_NAME,
  MAX_PRODUCT_QUANTITY,
  photoInstructions,
  PhotoSchema,
} from './products.ts';

const product = (patch: Partial<ExtractedPhoto['products'][number]> = {}): ExtractedPhoto['products'][number] => ({
  name: 'Arroz Tio João Tipo 1 5kg',
  category: 'graos',
  quantity: 1,
  ...patch,
});

Deno.test('classify: true e "any" aceitam nota ou produtos; "products", só produtos; o resto é a leitura de nota', () => {
  assertEquals(classifyMode(true), 'any');
  assertEquals(classifyMode('any'), 'any');
  assertEquals(classifyMode('products'), 'products');
  for (const value of [undefined, null, false, 'true', 1, 'nota', {}]) assertEquals(classifyMode(value), null);
});

Deno.test('a nota só segue para a leitura quando o app aceita nota', () => {
  assertEquals(afterClassification('any', 'nota'), 'read');
  assertEquals(afterClassification('products', 'nota'), 'answer');
  for (const mode of ['any', 'products'] as const) {
    assertEquals(afterClassification(mode, 'produtos'), 'answer');
    assertEquals(afterClassification(mode, 'nada'), 'answer');
  }
});

Deno.test('nota e nada nunca trazem produtos, mesmo que a IA mande algum', () => {
  assertEquals(cleanPhoto({ kind: 'nota', products: [product()] }), { kind: 'nota', products: [] });
  assertEquals(cleanPhoto({ kind: 'nada', products: [product()] }), { kind: 'nada', products: [] });
});

Deno.test('os produtos saem limpos: espaços sobrando e o tamanho do nome', () => {
  const { kind, products } = cleanPhoto({
    kind: 'produtos',
    products: [product({ name: '  Detergente   Ypê\nNeutro 500ml ', category: 'limpeza', quantity: 2 }), product({ name: 'x'.repeat(300) })],
  });
  assertEquals(kind, 'produtos');
  assertEquals(products[0], { name: 'Detergente Ypê Neutro 500ml', category: 'limpeza', quantity: 2 });
  assertEquals(products[1].name.length, MAX_PRODUCT_NAME);
});

Deno.test('a quantidade é um inteiro de 1 a 99: ilegível, zero, negativa ou quebrada viram o que dá para confiar', () => {
  const quantities = [null, 0, -3, 2.9, 1000, Number.NaN];
  const { products } = cleanPhoto({ kind: 'produtos', products: quantities.map((quantity, i) => product({ name: `Item ${i}`, quantity })) });
  assertEquals(products.map((p) => p.quantity), [1, 1, 1, 2, MAX_PRODUCT_QUANTITY, 1]);
});

Deno.test('o mesmo nome duas vezes é um produto só, com as quantidades somadas', () => {
  const { products } = cleanPhoto({
    kind: 'produtos',
    products: [product({ quantity: 2 }), product({ name: 'arroz tio joão tipo 1 5KG', quantity: 3 }), product({ name: 'Leite Italac 1L', category: 'laticinios' })],
  });
  assertEquals(products.map((p) => [p.name, p.quantity]), [['Arroz Tio João Tipo 1 5kg', 5], ['Leite Italac 1L', 1]]);
});

Deno.test('sem nome nenhum, ou sem nenhum produto que sobre, a foto não tem o que guardar: nada', () => {
  assertEquals(cleanPhoto({ kind: 'produtos', products: [] }), { kind: 'nada', products: [] });
  assertEquals(cleanPhoto({ kind: 'produtos', products: [product({ name: '   ' })] }), { kind: 'nada', products: [] });
});

Deno.test('uma prateleira cheia devolve até o limite de produtos', () => {
  const many = Array.from({ length: MAX_FOUND_PRODUCTS + 20 }, (_, i) => product({ name: `Produto ${i}` }));
  assertEquals(cleanPhoto({ kind: 'produtos', products: many }).products.length, MAX_FOUND_PRODUCTS);
});

Deno.test('o schema aceita a quantidade ilegível, e recusa categoria ou tipo de foto desconhecidos', () => {
  const parsed = PhotoSchema.parse({ kind: 'produtos', products: [{ name: 'Café Pilão 500g', category: 'cafe_cha', quantity: null }] });
  assertEquals(parsed.products[0].quantity, null);
  assertEquals(PhotoSchema.safeParse({ kind: 'produtos', products: [{ name: 'Café', category: 'inventada', quantity: 1 }] }).success, false);
  assertEquals(PhotoSchema.safeParse({ kind: 'foto', products: [] }).success, false);
});

Deno.test('o pedido de várias imagens diz que são da mesma coisa', () => {
  assertEquals(photoInstructions(1).includes('imagens da mesma coisa'), false);
  assertEquals(photoInstructions(3).includes('São 3 imagens da mesma coisa'), true);
});

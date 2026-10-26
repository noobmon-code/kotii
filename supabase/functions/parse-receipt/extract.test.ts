import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { assertEquals } from '@std/assert';
import { z } from 'zod';

import { extractStructured, type VisionConfig } from '../_shared/vision.ts';
import {
  boughtProducts,
  type CatalogProduct,
  cleanReceipt,
  type ExtractedReceipt,
  ExtractedReceiptSchema,
  genericName,
  imagePathsError,
  insertItems,
  instructions,
  isMissingColumn,
  itemStoreCodes,
  lineTotalFromPrinted,
  MAX_GENERIC_NAME,
  MAX_PHOTOS,
  MAX_TOTAL_IMAGE_BYTES,
  missingItemColumn,
  promptCatalog,
  sameStoreName,
  storeCodeMatches,
  storeWithName,
  SYSTEM,
  TOO_MANY_PHOTOS,
  weighedUnitPrice,
  withStoreCodes,
} from './extract.ts';

// Chave fictícia com o verificador certo, do CNPJ 11.222.333/0001-81 (também válido).
const KEY = '35261011222333000181650010000123451000012341';
const CNPJ = '11222333000181';

const base: ExtractedReceipt = {
  is_receipt: true,
  store_name: ' Mercado Bom ',
  cnpj: '11.222.333/0001-81',
  address: null,
  purchased_at: '2026-09-20T10:15:00-03:00',
  access_key: KEY.match(/.{4}/g)!.join(' '),
  total: 30.5,
  items: [
    {
      raw_description: 'ARROZ T.JOAO 5KG',
      code: '001234',
      normalized_name: 'Arroz Tio João 5kg',
      generic_name: 'arroz',
      category: 'graos',
      quantity: 1,
      unit: 'un',
      unit_price: 25,
      total_price: 25,
      matched_product_id: 'invented-id',
    },
    {
      raw_description: 'BANANA PRATA',
      code: null,
      normalized_name: 'Banana prata',
      generic_name: 'banana prata',
      category: 'hortifruti',
      quantity: 0.535,
      unit: 'kg',
      unit_price: 0,
      total_price: 3.21,
      matched_product_id: 'p-banana',
    },
    {
      raw_description: '   ',
      code: null,
      normalized_name: '',
      generic_name: null,
      category: 'outros',
      quantity: 1,
      unit: 'un',
      unit_price: 1,
      total_price: 1,
      matched_product_id: null,
    },
  ],
};

Deno.test('cleans identifiers, dates and items', () => {
  const r = cleanReceipt(base, new Set(['p-banana', 'p-arroz']), new Map([['ARROZ T.JOAO 5KG', 'p-arroz']]));
  assertEquals(r.storeName, 'Mercado Bom');
  assertEquals(r.cnpj, CNPJ);
  assertEquals(r.accessKey, KEY);
  assertEquals(r.purchasedAt, '2026-09-20T13:15:00.000Z');
  assertEquals(r.items.length, 2, 'blank line dropped');
  assertEquals(r.items[0].product_id, 'p-arroz', 'alias wins over model suggestion');
  assertEquals(r.items[1].product_id, 'p-banana', 'valid model suggestion kept');
  assertEquals(r.items[1].unit_price, 6, 'unit price derived from total / weight');
  assertEquals(r.readLines, [
    { description: 'ARROZ T.JOAO 5KG', unit: 'un', unit_price: 25 },
    { description: 'BANANA PRATA', unit: 'kg', unit_price: 6 },
  ]);
});

Deno.test('drops invalid identifiers and unknown product ids', () => {
  const r = cleanReceipt(
    { ...base, cnpj: '123', access_key: null, purchased_at: 'ontem' },
    new Set(),
    new Map(),
  );
  assertEquals(r.cnpj, null);
  assertEquals(r.accessKey, null);
  assertEquals(r.purchasedAt, null);
  assertEquals(r.items[0].product_id, null);
});

/** Uma linha da nota como a IA devolve, com o que o teste mudar. */
const line = (over: Partial<ExtractedReceipt['items'][number]>): ExtractedReceipt['items'][number] => ({
  raw_description: 'LEITE ITALAC 1L',
  code: null,
  normalized_name: 'Leite Italac 1L',
  generic_name: 'leite',
  category: 'laticinios',
  quantity: 1,
  unit: 'un',
  unit_price: 4.59,
  total_price: 4.59,
  matched_product_id: null,
  ...over,
});

Deno.test('chave e CNPJ: só com o verificador certo; com a chave válida, o CNPJ é o dela', () => {
  const clean = (access_key: string | null, cnpj: string | null) => {
    const r = cleanReceipt({ ...base, access_key, cnpj }, new Set(), new Map());
    return [r.accessKey, r.cnpj];
  };
  // Um dígito da chave lido errado: a chave fica de fora, e o CNPJ lido (válido) fica.
  const typo = `${KEY.slice(0, 30)}9${KEY.slice(31)}`;
  assertEquals(clean(typo, '11.222.333/0001-81'), [null, CNPJ]);
  // CNPJ que falha no módulo 11, sem chave: nenhum. Os 14 iguais também não são CNPJ.
  assertEquals(clean(null, '11.222.333/0001-82'), [null, null]);
  assertEquals(clean(null, '00000000000000'), [null, null]);
  // Com a chave válida, o CNPJ sai dela: o lido errado, ou outro válido, não vale.
  assertEquals(clean(KEY, '11.222.333/0001-82'), [KEY, CNPJ]);
  assertEquals(clean(KEY, '12.345.678/0001-95'), [KEY, CNPJ]);
  assertEquals(clean(KEY, null), [KEY, CNPJ]);
});

Deno.test('preço ilegível (null) passa no schema e vira 0, o "sem valor" que a revisão pergunta', () => {
  const unread = { ...base, items: [line({ unit_price: null, total_price: null }), line({ raw_description: 'PAO', unit_price: 12.9, total_price: null, quantity: null })] };
  assertEquals(ExtractedReceiptSchema.safeParse(unread).success, true);
  const r = cleanReceipt(unread, new Set(), new Map());
  assertEquals(r.items.map((i) => [i.raw_description, i.quantity, i.unit_price, i.total_price]), [
    ['LEITE ITALAC 1L', 1, 0, 0],
    // Sem a quantidade, o preço unitário lido fica e o total não é calculado: a revisão pergunta.
    ['PAO', 1, 12.9, 0],
  ]);
  // O preço unitário impresso vai para a leitura do servidor; o leite, sem preço nenhum, não.
  assertEquals(r.readLines, [{ description: 'PAO', unit: 'un', unit_price: 12.9 }]);
});

Deno.test('valor do item cortado no print da Sefaz: com a quantidade e o preço unitário lidos, é a conta dos dois', () => {
  // Um print real da Sefaz-PB (21/10/2026) com a coluna "Vl Total" cortada na borda da tela: as 19 linhas têm a
  // quantidade e o preço unitário inteiros, e a conta dá o total impresso da nota, R$ 349,38.
  const printed: Array<[string, number, 'un' | 'kg', number]> = [
    ['BANANA PRATA GNEL KG', 0.642, 'kg', 7.48],
    ['AZEITE CHI EV O LIVE', 1, 'un', 34.99],
    ['WRAP RAP 10 INTEG', 1, 'un', 16.49],
    ['MACA GALA KG', 0.88, 'kg', 14.98],
    ['MILHO QUERO lt 170G', 1, 'un', 4.79],
    ['OVOS VM SEL OME C/10', 2, 'un', 5.19],
    ['MANT GAL C/S PT 200G', 1, 'un', 12.9],
    ['COTTAGE S/LACTOSE C', 1, 'un', 17.29],
    ['PTO.PERU SADIA.200G', 1, 'un', 16.9],
    ['QA AGUA SANITARIA 1L', 2, 'un', 2.37],
    ['FILE SADIA 1KG', 1, 'un', 28.9],
    ['PAO FRA SEMI AS CONG', 0.21, 'kg', 17.88],
    ['PIZZA CONG MARGUERIT', 2, 'un', 14.18],
    ['CAF 3C GOR C M 250G', 1, 'un', 34.99],
    ['MAMAO FORM CORTE KG', 1.85, 'kg', 6.99],
    ['IOG NAT DAN INT 160G', 5, 'un', 4.63],
    ['PASSATA RUSTI BOTTI', 2, 'un', 20.79],
    ['CR RIC LIGHT 200G', 1, 'un', 10.9],
    ['PIZZA MUSS SAD 440G', 2, 'un', 14.18],
  ];
  const r = cleanReceipt(
    {
      ...base,
      total: 349.38,
      items: printed.map(([raw_description, quantity, unit, unit_price]) => line({ raw_description, quantity, unit, unit_price, total_price: null })),
    },
    new Set(),
    new Map(),
  );
  assertEquals(r.items.slice(0, 4).map((i) => i.total_price), [4.8, 34.99, 16.49, 13.18]);
  assertEquals(r.items.map((i) => i.quantity), printed.map(([, quantity]) => quantity));
  assertEquals(Math.round(r.items.reduce((sum, i) => sum + i.total_price * 100, 0)), 34938);
  // O valor lido continua valendo (com desconto, ele é menor que a conta), e sem a quantidade ou o preço unitário
  // não há conta: a revisão pergunta.
  const mixed = cleanReceipt(
    {
      ...base,
      items: [
        line({ raw_description: 'PIZZA', quantity: 2, unit_price: 14.18, total_price: 26.36 }),
        line({ raw_description: 'PAO', quantity: null, unit_price: 12.9, total_price: null }),
        line({ raw_description: 'CAFE', quantity: 1, unit_price: null, total_price: null }),
      ],
    },
    new Set(),
    new Map(),
  );
  assertEquals(mixed.items.map((i) => [i.raw_description, i.total_price]), [['PIZZA', 26.36], ['PAO', 0], ['CAFE', 0]]);
  // A conta não muda a quantidade nem o preço unitário lidos, e o preço da leitura do servidor é o lido.
  assertEquals([r.items[0].quantity, r.items[0].unit_price], [0.642, 7.48]);
  assertEquals(r.readLines[0], { description: 'BANANA PRATA GNEL KG', unit: 'kg', unit_price: 7.48 });
});

Deno.test('valor do item calculado: só com o total da nota lido, e só quando a soma não passa dele', () => {
  const read = (total: number | null, items: ExtractedReceipt['items']) =>
    cleanReceipt({ ...base, total, items }, new Set(), new Map()).items.map((i) => [i.raw_description, i.total_price]);
  const pizza = line({ raw_description: 'PIZZA CONG', quantity: 2, unit_price: 14.18, total_price: null });
  const cafe = line({ raw_description: 'CAF 3C GOR', quantity: 1, unit_price: 34.99, total_price: 34.99 });
  // A soma bate com o total: a conta fica.
  assertEquals(read(63.35, [pizza, cafe]), [['PIZZA CONG', 28.36], ['CAF 3C GOR', 34.99]]);
  // Sem o total da nota não há como conferir: a revisão pergunta, como antes.
  assertEquals(read(null, [pizza, cafe]), [['PIZZA CONG', 0], ['CAF 3C GOR', 34.99]]);
  // A pizza tinha R$ 4,00 de desconto, que não teve onde entrar: a soma passa do total e a revisão pergunta.
  assertEquals(read(59.35, [pizza, cafe]), [['PIZZA CONG', 0], ['CAF 3C GOR', 34.99]]);
  // A vírgula do peso se perdeu (642 kg): passa do total, e nenhuma conta fica.
  const banana = line({ raw_description: 'BANANA KG', unit: 'kg', quantity: 642, unit_price: 7.48, total_price: null });
  assertEquals(read(68.15, [pizza, cafe, banana]), [['PIZZA CONG', 0], ['CAF 3C GOR', 34.99], ['BANANA KG', 0]]);
  // Com outra linha ainda sem valor, a soma não confere nada: os R$ 10,00 do sabão esconderiam os R$ 4,00 de desconto
  // perdidos da pizza (a soma 63,35 cabe no total 69,35), então a revisão pergunta as duas.
  const sabao = line({ raw_description: 'SABAO', quantity: null, unit_price: null, total_price: null });
  assertEquals(read(69.35, [pizza, cafe, sabao]), [['PIZZA CONG', 0], ['CAF 3C GOR', 34.99], ['SABAO', 0]]);
  // Até 1 centavo por conta (o caixa que trunca) mais o arredondamento da revisão.
  assertEquals(read(63.29, [pizza, cafe]), [['PIZZA CONG', 28.36], ['CAF 3C GOR', 34.99]]);
  assertEquals(read(63.28, [pizza, cafe]), [['PIZZA CONG', 0], ['CAF 3C GOR', 34.99]]);
});

Deno.test('lineTotalFromPrinted: o centavo da conta não depende do ponto flutuante', () => {
  assertEquals(lineTotalFromPrinted(0.642, 'kg', 7.48), 4.8);
  assertEquals(lineTotalFromPrinted(1.85, 'kg', 6.99), 12.93);
  assertEquals(lineTotalFromPrinted(0.21, 'kg', 17.88), 3.75);
  // 1,005 × 1 é 1,00499... em ponto flutuante; a conta em inteiros arredonda o meio centavo para cima.
  assertEquals(lineTotalFromPrinted(1.005, 'l', 1), 1.01);
  assertEquals(lineTotalFromPrinted(3, 'un', 0.1), 0.3);
  // Quantidade com 4 casas.
  assertEquals(lineTotalFromPrinted(1.2345, 'kg', 99.9), 123.33);
  assertEquals(lineTotalFromPrinted(null, 'un', 5), 0);
  assertEquals(lineTotalFromPrinted(2, 'un', null), 0);
  assertEquals(lineTotalFromPrinted(0, 'un', 5), 0);
  // Em g e ml o preço por unidade tem mais casas do que a leitura guarda: sem conta.
  assertEquals(lineTotalFromPrinted(200, 'g', 12.9), 0);
  assertEquals(lineTotalFromPrinted(2000, 'ml', 0.004495), 0);
  // Número absurdo (vira Infinity na escala) não derruba a leitura.
  assertEquals(lineTotalFromPrinted(1e305, 'un', 1), 0);
});

Deno.test('weighedUnitPrice: o preço da bandeja impresso no lugar do preço por kg vira o preço por kg', () => {
  // As duas linhas do pedido que imprimiu o preço da bandeja: 0,202 kg × R$ 72,90 = R$ 14,73.
  assertEquals(weighedUnitPrice('Queijo Muçarela Importado Fatiado 200g', 0.202, 'kg', 14.58, 14.73), 72.9);
  assertEquals(weighedUnitPrice('Bife De Lagarto Bovino À Vácuo Resfriado 500g', 0.412, 'kg', 29.95, 24.68), 59.9);
  assertEquals(weighedUnitPrice('PRESUNTO FAT 1.000G', 0.35, 'kg', 39.9, 13.97), 39.9);
  assertEquals(weighedUnitPrice('FRIOS BANDEJA 250 G', 0.26, 'kg', 9.98, 10.38), 39.92);
  // A conta já fecha (o preço é por kg), ou o valor é menor (desconto do item): o preço lido fica.
  assertEquals(weighedUnitPrice('QJ MUSS IFAT KG', 0.2, 'kg', 72.9, 14.58), 72.9);
  assertEquals(weighedUnitPrice('Queijo Muçarela Fatiado 200g', 0.202, 'kg', 72.9, 12.0), 72.9);
  // Sem tamanho na descrição, a diferença pode ser o peso mal lido: o preço lido fica.
  assertEquals(weighedUnitPrice('QUEIJO MUSSARELA', 0.202, 'kg', 14.58, 14.73), 14.58);
  // O tamanho escrito não explica a conta, ou são dois tamanhos, ou é de outra grandeza: fica.
  assertEquals(weighedUnitPrice('Queijo Fatiado 300g', 0.202, 'kg', 14.58, 14.73), 14.58);
  assertEquals(weighedUnitPrice('Kit 200g + 300g', 0.202, 'kg', 14.58, 14.73), 14.58);
  assertEquals(weighedUnitPrice('Suco 200ml', 0.202, 'kg', 14.58, 14.73), 14.58);
  // Só peso e volume; em un, ou sem quantidade lida, nada muda.
  assertEquals(weighedUnitPrice('Queijo 200g', 1, 'un', 14.58, 29.16), 14.58);
  assertEquals(weighedUnitPrice('Queijo 200g', null, 'kg', 14.58, 14.73), 14.58);
});

Deno.test('weighedUnitPrice: o tamanho colado a um ponto e as unidades por extenso (GRS, GRAMAS, LITROS, LTS) contam', () => {
  // "SADIA.200G": o ponto depois da marca não tira o tamanho. Os casos são de 0,202 kg de uma bandeja de 200 g a R$ 14,58.
  assertEquals(weighedUnitPrice('PTO.PERU SADIA.200G', 0.202, 'kg', 14.58, 14.73), 72.9);
  assertEquals(weighedUnitPrice('QJ.MUSS.200G', 0.202, 'kg', 14.58, 14.73), 72.9);
  assertEquals(weighedUnitPrice('QJ MUSS FAT 200GRS', 0.202, 'kg', 14.58, 14.73), 72.9);
  assertEquals(weighedUnitPrice('QJ MUSS FAT 200 GRAMAS', 0.202, 'kg', 14.58, 14.73), 72.9);
  assertEquals(weighedUnitPrice('QJ MUSS FAT 200GRAMA', 0.202, 'kg', 14.58, 14.73), 72.9);
  assertEquals(weighedUnitPrice('FRIOS BANDEJA 250 GRS', 0.26, 'kg', 9.98, 10.38), 39.92);
  assertEquals(weighedUnitPrice('AGUA 0,5 LITROS', 2, 'l', 2, 8), 4);
  assertEquals(weighedUnitPrice('AGUA 0,5 LTS', 2, 'l', 2, 8), 4);
  // Número depois de dígito, com ponto ou vírgula no meio, não é tamanho: "1.234,5KG" não lê nada, e a conta fica.
  assertEquals(weighedUnitPrice('PACOTE 1.234,5kg', 0.202, 'kg', 14.58, 14.73), 14.58);
  // Nem a conta com o preço da bandeja sobre o tamanho fecha (0,5 kg a R$ 30): o preço lido fica.
  assertEquals(weighedUnitPrice('QJ.MUSS.200G', 0.5, 'kg', 14.58, 30), 14.58);
});

Deno.test('preço da bandeja na linha pesada: a nota e a leitura do servidor guardam o preço por kg', () => {
  const r = cleanReceipt(
    {
      ...base,
      items: [
        line({ raw_description: 'Queijo Muçarela Importado Fatiado 200g', unit: 'kg', quantity: 0.202, unit_price: 14.58, total_price: 14.73 }),
        line({ raw_description: 'BANANA PRATA KG', unit: 'kg', quantity: 0.535, unit_price: 5.99, total_price: 3.2 }),
      ],
    },
    new Set(),
    new Map(),
  );
  assertEquals(r.items.map((i) => [i.quantity, i.unit_price, i.total_price]), [
    [0.202, 72.9, 14.73],
    [0.535, 5.99, 3.2],
  ]);
  assertEquals(r.readLines.map((l) => l.unit_price), [72.9, 5.99]);
});

Deno.test('instructions: o total da nota é o valor pago, depois dos descontos', () => {
  assertEquals(instructions([]).includes('total: o valor pago pela nota, já com os descontos ("Valor a pagar", "TOTAL NOTA")'), true);
});

Deno.test('preço ilegível não derruba a nota pela OpenRouter', async () => {
  const answer = { ...base, items: [line({ unit_price: null, total_price: null })] };
  const fetchImpl = (() =>
    Promise.resolve(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answer) } }] })))) as typeof fetch;
  const config: VisionConfig = { provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash', modelEnv: 'RECEIPT_MODEL', apiKey: 'k' };
  const extracted = await extractStructured({
    config,
    schema: ExtractedReceiptSchema,
    schemaName: 'receipt',
    system: 'Sistema.',
    prompt: instructions([]),
    images: [{ base64: 'AAAA', mediaType: 'image/jpeg' }],
    subject: 'a nota',
    fetchImpl,
  });
  assertEquals(cleanReceipt(extracted, new Set(), new Map()).items[0].total_price, 0);
});

Deno.test('linha negativa (cancelamento, desconto como item) fica de fora, em vez de virar item sem valor', () => {
  const r = cleanReceipt(
    {
      ...base,
      items: [
        line({}),
        line({ raw_description: 'CANCELAMENTO ITEM 001', unit_price: -4.59, total_price: -4.59 }),
        line({ raw_description: 'DESCONTO', unit_price: null, total_price: -1 }),
        line({ raw_description: 'ARROZ 5KG', unit_price: 25, total_price: 25 }),
      ],
    },
    new Set(),
    new Map(),
  );
  assertEquals(r.items.map((i) => [i.position, i.raw_description]), [[0, 'LEITE ITALAC 1L'], [1, 'ARROZ 5KG']]);
});

Deno.test('instructions: preço ilegível é null, nunca estimado; item cancelado e desconto em linha separada', () => {
  const text = instructions([]);
  assertEquals(text.includes('Preço ou quantidade que não dá para ler: null. Nunca estime'), true);
  assertEquals(text.includes('Número cortado, com algum dígito faltando ou pela metade, é ilegível: null. Nunca complete o número.'), true);
  assertEquals(text.includes('Item cancelado fica de fora, junto com a linha que o cancela'), true);
  assertEquals(text.includes('também quando vem impresso numa linha separada'), true);
});

Deno.test('promptCatalog: primeiro os mais comprados (empate: o comprado por último), depois os cadastrados por último', () => {
  const p = (id: string): CatalogProduct => ({ id, name: `Produto ${id}` });
  // Linhas de nota da mais nova para a mais antiga.
  const bought = [p('leite'), p('arroz'), p('leite'), p('cafe'), p('arroz'), p('leite'), p('zebra')];
  const newest = [p('novo'), p('leite'), p('antigo')];
  assertEquals(promptCatalog(bought, newest).map((x) => x.id), ['leite', 'arroz', 'cafe', 'zebra', 'novo', 'antigo']);
  // O limite vale para a soma, sem repetir produto.
  assertEquals(promptCatalog(bought, newest, 3).map((x) => x.id), ['leite', 'arroz', 'cafe']);
  assertEquals(promptCatalog([], newest, 2).map((x) => x.id), ['novo', 'leite']);
  // Numa casa com mais produtos que o limite, o do fim do alfabeto comprado sempre entra.
  const many = Array.from({ length: 500 }, (_, i) => p(`a${String(i).padStart(3, '0')}`));
  assertEquals(promptCatalog([p('zebra')], many).some((x) => x.id === 'zebra'), true);
  assertEquals(promptCatalog([p('zebra')], many).length, 400);
});

Deno.test('boughtProducts: da nota mais nova para a mais antiga, cada uma na ordem impressa, sem as linhas sem produto', () => {
  const p = (id: string): CatalogProduct => ({ id, name: `Produto ${id}` });
  const bought = boughtProducts([
    { receipt_items: [{ position: 1, product: p('arroz') }, { position: 0, product: p('leite') }, { position: 2, product: null }] },
    { receipt_items: null },
    { receipt_items: [{ position: 0, product: [p('cafe')] }] },
  ]);
  assertEquals(bought.map((x) => x.id), ['leite', 'arroz', 'cafe']);
});

Deno.test('quantidade ilegível: sai do total e do preço unitário lidos; sem o preço, a linha não vai para a leitura do servidor', () => {
  const r = cleanReceipt(
    {
      ...base,
      items: [
        // Peso ilegível, R$/kg e total legíveis: o peso sai da conta.
        line({ raw_description: 'BANANA PRATA KG', unit: 'kg', quantity: null, unit_price: 5.99, total_price: 3.2 }),
        // Peso e R$/kg ilegíveis, só o total: 1 kg × total no rascunho, mas esse R$/kg não foi impresso.
        line({ raw_description: 'TOMATE KG', unit: 'kg', quantity: null, unit_price: null, total_price: 3.21 }),
        // Em "un", com desconto no total, a quantidade é inteira.
        line({ raw_description: 'IOGURTE', quantity: null, unit_price: 3.5, total_price: 9 }),
        // Quantidade lida e preço unitário ilegível: o preço sai do total e da quantidade, que foram lidos.
        line({ raw_description: 'BATATA KG', unit: 'kg', quantity: 1.25, unit_price: null, total_price: 7.5 }),
        // Quantidade e preço unitário ilegíveis em "un": também não vai.
        line({ raw_description: 'SABAO', quantity: null, unit_price: null, total_price: 12 }),
      ],
    },
    new Set(),
    new Map(),
  );
  assertEquals(r.items.map((i) => [i.raw_description, i.quantity, i.unit_price, i.total_price]), [
    ['BANANA PRATA KG', 0.534, 5.99, 3.2],
    ['TOMATE KG', 1, 3.21, 3.21],
    ['IOGURTE', 3, 3.5, 9],
    ['BATATA KG', 1.25, 6, 7.5],
    ['SABAO', 1, 12, 12],
  ]);
  assertEquals(r.readLines, [
    { description: 'BANANA PRATA KG', unit: 'kg', unit_price: 5.99 },
    { description: 'IOGURTE', unit: 'un', unit_price: 3.5 },
    { description: 'BATATA KG', unit: 'kg', unit_price: 6 },
  ]);
  // Nenhuma linha da leitura leva o preço que a nota não imprimiu.
  assertEquals(r.readLines.some((l) => l.unit_price === 3.21 || l.unit_price === 12), false);
});

Deno.test('instructions explain the overlap when the receipt comes in several photos', () => {
  assertEquals(instructions([], 1).includes('A nota veio em'), false);
  const text = instructions([], 3);
  assertEquals(text.includes('A nota veio em 3 imagens'), true);
  assertEquals(text.includes('todas são partes da mesma nota'), true);
  assertEquals(text.includes('entra uma vez só'), true);
});

Deno.test('print da página da Sefaz é nota: o sistema e as instruções dizem isso, também com uma imagem só', () => {
  assertEquals(SYSTEM.includes('print (captura de tela) da página de consulta da nota no site da Sefaz'), true);
  const one = instructions([], 1);
  assertEquals(one.includes('A imagem pode ser a foto do papel ou um print da página de consulta da NFC-e no site da Sefaz'), true);
  assertEquals(one.includes('Um print com só uma parte da nota'), true);
  assertEquals(one.includes('Ignore os dados do consumidor (CPF, nome)'), true);
  // O is_receipt=false fica para o que não é nota nem print dela.
  assertEquals(one.includes('nem foto do papel nem print da nota na Sefaz), is_receipt=false'), true);
  assertEquals(instructions([], 4).includes('prints da página da Sefaz (o topo com o mercado, a lista de itens, o rodapé com a data e a chave)'), true);
});

Deno.test('prints da Sefaz em várias imagens: o pedido leva todas e o texto que diz que é nota; a resposta parcial passa no schema', async () => {
  // Um print só dos itens: sem mercado, CNPJ, data nem chave (o rodapé veio em outro print, ilegível).
  const answer: ExtractedReceipt = {
    ...base,
    store_name: null,
    cnpj: null,
    purchased_at: null,
    access_key: null,
    items: [line({}), line({ raw_description: 'ARROZ 5KG', unit_price: 25, total_price: 25 })],
  };
  let sent: { messages: { content: { type: string; text?: string }[] }[] } | null = null;
  const fetchImpl = ((_url: string, init: RequestInit) => {
    sent = JSON.parse(String(init.body));
    return Promise.resolve(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answer) } }] })));
  }) as typeof fetch;
  const config: VisionConfig = { provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash', modelEnv: 'RECEIPT_MODEL', apiKey: 'k' };
  const images = Array.from({ length: MAX_PHOTOS }, () => ({ base64: 'AAAA', mediaType: 'image/png' as const }));
  const extracted = await extractStructured({
    config,
    schema: ExtractedReceiptSchema,
    schemaName: 'receipt',
    system: SYSTEM,
    prompt: instructions([], images.length),
    images,
    subject: 'a nota',
    fetchImpl,
  });
  const content = sent!.messages[0].content;
  assertEquals(content.filter((part) => part.type === 'image_url').length, MAX_PHOTOS);
  const text = content.find((part) => part.type === 'text')?.text ?? '';
  assertEquals(text.includes('print (captura de tela)'), true);
  assertEquals(text.includes(`A nota veio em ${MAX_PHOTOS} imagens`), true);
  assertEquals(extracted.is_receipt, true);
  const r = cleanReceipt(extracted, new Set(), new Map());
  assertEquals([r.storeName, r.cnpj, r.purchasedAt, r.accessKey], [null, null, null, null]);
  assertEquals(r.items.length, 2);
});

Deno.test('imagePathsError: até MAX_PHOTOS imagens da casa; a mais, a recusa diz o limite com o código', () => {
  const paths = (n: number, prefix = 'h1/') => Array.from({ length: n }, (_, i) => `${prefix}${i}.jpg`);
  assertEquals(MAX_PHOTOS, 6);
  assertEquals(imagePathsError(paths(1), 'h1'), null);
  assertEquals(imagePathsError(paths(MAX_PHOTOS), 'h1'), null);
  assertEquals(imagePathsError(paths(MAX_PHOTOS + 1), 'h1'), { error: 'Mande até 6 fotos ou prints por nota.', code: TOO_MANY_PHOTOS });
  assertEquals(imagePathsError([], 'h1'), { error: 'Imagem inválida.' });
  assertEquals(imagePathsError(paths(2, 'h2/'), 'h1'), { error: 'Imagem inválida.' });
  assertEquals(imagePathsError([undefined], 'h1'), { error: 'Imagem inválida.' });
  // As maiores fotos que a IA aceita, todas juntas, chegam perto do pedido: a soma tem teto, abaixo dos 32 MB em base64.
  assertEquals(MAX_TOTAL_IMAGE_BYTES * 4 / 3 < 32_000_000, true);
});

Deno.test('sameStoreName: mesmo nome sem caixa nem espaços; curingas são texto', () => {
  assertEquals(sameStoreName(' Mercado Bom ', 'mercado bom'), true);
  assertEquals(sameStoreName('Mercado Bom', 'Mercado Bom Demais'), false);
  assertEquals(sameStoreName('*', 'Mercado Bom'), false);
  assertEquals(sameStoreName('%', 'Mercado Bom'), false);
  assertEquals(sameStoreName('M_rcado', 'Mercado'), false);
});

Deno.test('storeWithName: a loja renomeada pela casa é achada também pelo nome impresso na nota', () => {
  const stores = [
    { id: 'a', name: 'Mercadinho do Zé', printed_name: 'JOSE DA SILVA MERCEARIA' },
    { id: 'b', name: 'Feira Livre', printed_name: null },
    { id: 'c', name: 'Sacolão' },
  ];
  assertEquals(storeWithName(stores, ' jose da silva mercearia ')?.id, 'a');
  assertEquals(storeWithName(stores, 'Mercadinho do Zé')?.id, 'a');
  assertEquals(storeWithName(stores, 'feira livre')?.id, 'b');
  // O banco antes da coluna: só o nome.
  assertEquals(storeWithName(stores, 'SACOLÃO')?.id, 'c');
  assertEquals(storeWithName(stores, 'Outro'), undefined);
});

Deno.test('isMissingColumn: só a coluna que falta, pelo nome inteiro', () => {
  assertEquals(isMissingColumn({ code: '42703', message: 'column stores.printed_name does not exist' }, 'printed_name'), true);
  assertEquals(isMissingColumn({ code: 'PGRST204', message: "Could not find the 'printed_name' column" }, 'printed_name'), true);
  assertEquals(isMissingColumn({ code: '42703', message: 'column stores.printed_name_x does not exist' }, 'printed_name'), false);
  assertEquals(isMissingColumn({ code: '42703', message: 'column stores.other does not exist' }, 'printed_name'), false);
  assertEquals(isMissingColumn({ code: '23505', message: 'printed_name' }, 'printed_name'), false);
  assertEquals(isMissingColumn(null, 'printed_name'), false);
});

Deno.test('item genérico: o schema aceita o texto e null; o modelo que o esquece ou manda outra coisa não derruba a nota', () => {
  const items = (generic: unknown) => ({ ...base, items: [{ ...line({}), generic_name: generic }] });
  const parsed = (generic: unknown) => {
    const result = ExtractedReceiptSchema.safeParse(items(generic));
    return result.success ? result.data.items[0].generic_name : 'falhou';
  };
  assertEquals(parsed('café em pó'), 'café em pó');
  assertEquals(parsed(null), null);
  assertEquals(parsed(42), null);
  const { generic_name: _generic, ...withoutGeneric } = line({});
  assertEquals(ExtractedReceiptSchema.safeParse({ ...base, items: [withoutGeneric] }).success, true);
  assertEquals(ExtractedReceiptSchema.parse({ ...base, items: [withoutGeneric] }).items[0].generic_name, null);
});

Deno.test('item genérico: limpo para o banco (espaços, minúsculas, tamanho), e fora da leitura do servidor', () => {
  assertEquals(genericName('  Café   em Pó '), 'café em pó');
  assertEquals(genericName('PAPEL HIGIÊNICO'), 'papel higiênico');
  assertEquals(genericName('   '), null);
  assertEquals(genericName(null), null);
  assertEquals(genericName(undefined), null);
  // A descrição inteira repetida (com marca e tamanho) não é um genérico: fica de fora em vez de ser cortada.
  assertEquals(genericName('a'.repeat(MAX_GENERIC_NAME)), 'a'.repeat(MAX_GENERIC_NAME));
  assertEquals(genericName('a'.repeat(MAX_GENERIC_NAME + 1)), null);

  const r = cleanReceipt(
    {
      ...base,
      items: [
        line({ raw_description: 'CAF TORR MOIDO 3COR 500G', generic_name: ' Café em  pó ', unit_price: 18.9, total_price: 18.9 }),
        line({ raw_description: 'GILLETTE APARELHO', generic_name: 'Aparelho de barbear' }),
        line({ raw_description: 'PASTILHA MENTOS', generic_name: null }),
        line({ raw_description: 'COISA', generic_name: '' }),
      ],
    },
    new Set(),
    new Map(),
  );
  assertEquals(r.items.map((i) => [i.raw_description, i.generic_name]), [
    ['CAF TORR MOIDO 3COR 500G', 'café em pó'],
    ['GILLETTE APARELHO', 'aparelho de barbear'],
    ['PASTILHA MENTOS', null],
    ['COISA', null],
  ]);
  // A leitura do servidor (que pode ir para os preços compartilhados) continua só com descrição, unidade e preço.
  assertEquals(r.readLines.every((l) => Object.keys(l).sort().join() === 'description,unit,unit_price'), true);
});

Deno.test('instructions: o item genérico tem exemplos, não acrescenta o tipo que a nota não diz e não leva a lista de compras', () => {
  const text = instructions([{ id: 'p1', name: 'Café Pilão 500g' }]);
  assertEquals(text.includes('- generic_name: o item como alguém escreveria na lista de compras'), true);
  assertEquals(text.includes('"CAF TORR MOIDO 3COR 500G" -> "café em pó"'), true);
  assertEquals(text.includes('"GILLETTE MACH3 APARELHO" -> "aparelho de barbear"'), true);
  assertEquals(text.includes('"LEITE UHT PARMALAT 1L" -> "leite" (a nota não diz se é integral ou desnatado: não acrescente)'), true);
  assertEquals(text.includes('Não dá para saber o que é: null.'), true);
  // O que vai para a IA é o de antes: as imagens e o catálogo da casa (nada da lista de compras).
  assertEquals(/lista de compras da casa|itens da lista/i.test(text), false);
  assertEquals(text.endsWith('Produtos já cadastrados (id | nome):\np1 | Café Pilão 500g'), true);
});

Deno.test('item genérico pela OpenRouter: vai no schema pedido, como campo obrigatório que aceita null', async () => {
  const answer = { ...base, items: [line({ generic_name: 'leite' }), line({ raw_description: 'ARROZ 5KG', generic_name: null })] };
  let sent: { response_format: { json_schema: { schema: { properties: { items: { items: { required: string[]; properties: Record<string, unknown> } } } } } } } | null =
    null;
  const fetchImpl = ((_url: string, init: RequestInit) => {
    sent = JSON.parse(String(init.body));
    return Promise.resolve(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answer) } }] })));
  }) as typeof fetch;
  const config: VisionConfig = { provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash', modelEnv: 'RECEIPT_MODEL', apiKey: 'k' };
  const extracted = await extractStructured({
    config,
    schema: ExtractedReceiptSchema,
    schemaName: 'receipt',
    system: SYSTEM,
    prompt: instructions([]),
    images: [{ base64: 'AAAA', mediaType: 'image/jpeg' }],
    subject: 'a nota',
    fetchImpl,
  });
  const itemSchema = sent!.response_format.json_schema.schema.properties.items.items;
  assertEquals(itemSchema.required.includes('generic_name'), true);
  assertEquals(itemSchema.properties.generic_name, { type: ['string', 'null'] });
  // Saída estrita (strict: true) recusa "default" ("'default' is not permitted"): o schema enviado não tem nenhum.
  assertEquals(JSON.stringify(sent!.response_format.json_schema.schema).includes('"default"'), false);
  assertEquals(JSON.stringify(z.toJSONSchema(ExtractedReceiptSchema)).includes('"default"'), false);
  // Pela Anthropic, o campo vai sem descrição inventada (um "{default: null}" puxaria o modelo para o null).
  const anthropicItem = (betaZodOutputFormat(ExtractedReceiptSchema).schema as unknown as { properties: { items: { items: { properties: Record<string, unknown> } } } })
    .properties.items.items;
  assertEquals(anthropicItem.properties.generic_name, { type: ['string', 'null'] });
  assertEquals(cleanReceipt(extracted, new Set(), new Map()).items.map((i) => i.generic_name), ['leite', null]);
});

Deno.test('insertItems: grava com o item genérico; sem a coluna no banco, grava de novo sem ele', async () => {
  const rows = [
    { raw_description: 'CAF TORR MOIDO', generic_name: 'café em pó', receipt_id: 'r1' },
    { raw_description: 'PASTILHA', generic_name: null, receipt_id: 'r1' },
  ];
  // O banco com a coluna: uma gravação, com o genérico de cada linha.
  const written: unknown[][] = [];
  const ok = await insertItems((batch) => {
    written.push(batch);
    return Promise.resolve({ error: null });
  }, rows);
  assertEquals(ok.error, null);
  assertEquals(written, [rows]);

  // O banco de antes da migração: o PostgREST recusa a coluna que não conhece; a segunda vai sem ela.
  for (const missing of [
    { code: 'PGRST204', message: "Could not find the 'generic_name' column of 'receipt_items' in the schema cache" },
    { code: '42703', message: 'column "generic_name" of relation "receipt_items" does not exist' },
  ]) {
    const tries: unknown[][] = [];
    const retried = await insertItems((batch) => {
      tries.push(batch);
      return Promise.resolve({ error: tries.length === 1 ? missing : null });
    }, rows);
    assertEquals(retried.error, null);
    assertEquals(tries, [rows, [{ raw_description: 'CAF TORR MOIDO', receipt_id: 'r1' }, { raw_description: 'PASTILHA', receipt_id: 'r1' }]]);
  }

  // Outro erro (o check de tamanho, a RLS, outra coluna) volta como veio, sem segunda gravação.
  for (const other of [
    { code: '23514', message: 'new row for relation "receipt_items" violates check constraint "receipt_items_generic_name_check"' },
    { code: 'PGRST204', message: "Could not find the 'suggested_name' column of 'receipt_items' in the schema cache" },
    { code: '42501', message: 'new row violates row-level security policy for table "receipt_items"' },
  ]) {
    let calls = 0;
    const failed = await insertItems(() => {
      calls++;
      return Promise.resolve({ error: other });
    }, rows);
    assertEquals([failed.error, calls], [other, 1]);
  }
  assertEquals(missingItemColumn(null), null);
});

// O código do produto na linha ------------------------------------------------------------------------------

Deno.test('código: o schema aceita o texto e null; o modelo que o esquece ou manda outra coisa não derruba a nota', () => {
  const parsed = (code: unknown) => {
    const result = ExtractedReceiptSchema.safeParse({ ...base, items: [{ ...line({}), code }] });
    return result.success ? result.data.items[0].code : 'falhou';
  };
  assertEquals(parsed('7891000100103'), '7891000100103');
  assertEquals(parsed(null), null);
  // Número em vez de texto perderia os zeros da frente: vale null, como o que não é texto.
  assertEquals(parsed(7891000100103), null);
  assertEquals(parsed({ code: '1' }), null);
  const { code: _code, ...withoutCode } = line({});
  assertEquals(ExtractedReceiptSchema.parse({ ...base, items: [withoutCode] }).items[0].code, null);
});

Deno.test('instructions: o código é o impresso na linha, sem completar nem inventar, e null sem código', () => {
  const text = instructions([]);
  assertEquals(
    text.includes(
      '- code: o código do produto impresso na linha, como está na nota: na página da Sefaz, o "Código" do item; no papel, o número que vem antes da descrição, logo depois do número do item (001, 002...).',
    ),
    true,
  );
  assertEquals(text.includes('"002 250474 BANANA PRATA KG" -> "250474"'), true);
  assertEquals(text.includes('Só o que está impresso e legível: nunca complete nem invente um código. A linha que não mostra código: null.'), true);
  // O número do item não é o código, e o rótulo da página da Sefaz fica de fora.
  assertEquals(text.includes('O número do item (001, 002...) nunca é o código; a linha que só tem o número do item: null.'), true);
  assertEquals(text.includes('na página da Sefaz, "(Código: 250474 )" -> "250474", sem a palavra "Código"'), true);
});

Deno.test('código: o rótulo que a IA copiou da página da Sefaz sai antes da chave; o código sem rótulo fica inteiro', () => {
  const codes = (...values: (string | null)[]) =>
    cleanReceipt({ ...base, items: values.map((code, i) => line({ raw_description: `ITEM ${i}`, code })) }, new Set(), new Map())
      .items.map((i) => i.store_code);
  assertEquals(codes('Código: 250474', '(Código: 7891000100103 )', 'Cód.:A123', 'CODA123', 'COD123'), [
    '250474',
    '7891000100103',
    'A123',
    'CODA123',
    'COD123',
  ]);
  // Mercadinho usa códigos curtos em sequência de verdade: nada é descartado por parecer o número do item.
  assertEquals(codes('1', '2', '3', '001'), ['1', '2', '3', '001']);
  assertEquals(codes('Código:', ':', null), [null, null, null]);
});

Deno.test('código: limpo pela chave do banco na linha da nota; na leitura do servidor, só o código de barras', () => {
  const r = cleanReceipt(
    {
      ...base,
      items: [
        line({ raw_description: 'LEITE ITALAC 1L', code: ' 7891000100103 ' }),
        line({ raw_description: 'QUEIJO MUSS', code: 'mç-12' }),
        line({ raw_description: 'BANANA PRATA', code: '250474' }),
        line({ raw_description: 'SACOLA', code: null }),
        line({ raw_description: 'AVULSO', code: ' / ' }),
        line({ raw_description: 'COMPRIDO', code: '9'.repeat(61) }),
        // O código da balança (faixa 2) é do mercado: fica na linha, fora da leitura.
        line({ raw_description: 'PATINHO KG', code: 'Código: 2000000000008' }),
        // O código de 8 ou 12 dígitos passa na conta por acaso (o interno do mercado, 1 em 10): fica na linha.
        line({ raw_description: 'QUEIJO DA CASA', code: '12345670' }),
        line({ raw_description: 'CAFE IMPORTADO', code: '036000291452' }),
        line({ raw_description: 'SUCO CAIXA 12', code: '17891000100100' }),
      ],
    },
    new Set(),
    new Map(),
  );
  assertEquals(r.items.map((i) => i.store_code), [
    '7891000100103', 'MC12', '250474', null, null, null, '2000000000008', '12345670', '036000291452', '17891000100100',
  ]);
  assertEquals(r.readLines.map((l) => [l.description, l.gtin ?? '-']), [
    ['LEITE ITALAC 1L', '07891000100103'],
    ['QUEIJO MUSS', '-'],
    ['BANANA PRATA', '-'],
    ['SACOLA', '-'],
    ['AVULSO', '-'],
    ['COMPRIDO', '-'],
    ['PATINHO KG', '-'],
    ['QUEIJO DA CASA', '-'],
    ['CAFE IMPORTADO', '-'],
    ['SUCO CAIXA 12', '17891000100100'],
  ]);
  assertEquals(r.readLines.filter((l) => 'gtin' in l).length, 2);
  const codes = ['7891000100103', 'MC12', '250474', '2000000000008', '12345670', '036000291452', '17891000100100'];
  assertEquals(itemStoreCodes(r.items), codes);
  assertEquals(itemStoreCodes([...r.items, ...r.items]), codes);
});

Deno.test('código pela OpenRouter e pela Anthropic: campo obrigatório que aceita null, sem default', async () => {
  const answer = { ...base, items: [line({ code: '250474' }), line({ raw_description: 'ARROZ 5KG', code: null })] };
  let sent: { response_format: { json_schema: { schema: { properties: { items: { items: { required: string[]; properties: Record<string, unknown> } } } } } } } | null =
    null;
  const fetchImpl = ((_url: string, init: RequestInit) => {
    sent = JSON.parse(String(init.body));
    return Promise.resolve(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(answer) } }] })));
  }) as typeof fetch;
  const config: VisionConfig = { provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash', modelEnv: 'RECEIPT_MODEL', apiKey: 'k' };
  const extracted = await extractStructured({
    config,
    schema: ExtractedReceiptSchema,
    schemaName: 'receipt',
    system: SYSTEM,
    prompt: instructions([]),
    images: [{ base64: 'AAAA', mediaType: 'image/jpeg' }],
    subject: 'a nota',
    fetchImpl,
  });
  const itemSchema = sent!.response_format.json_schema.schema.properties.items.items;
  assertEquals(itemSchema.required.includes('code'), true);
  assertEquals(itemSchema.properties.code, { type: ['string', 'null'] });
  assertEquals(JSON.stringify(sent!.response_format.json_schema.schema).includes('"default"'), false);
  assertEquals(JSON.stringify(z.toJSONSchema(ExtractedReceiptSchema)).includes('"default"'), false);
  const anthropicItem = (betaZodOutputFormat(ExtractedReceiptSchema).schema as unknown as { properties: { items: { items: { properties: Record<string, unknown> } } } })
    .properties.items.items;
  assertEquals(anthropicItem.properties.code, { type: ['string', 'null'] });
  assertEquals(cleanReceipt(extracted, new Set(), new Map()).items.map((i) => i.store_code), ['250474', null]);
});

Deno.test('withStoreCodes: o produto que o código já ensinou vence o apelido e a sugestão da IA', () => {
  const r = cleanReceipt(
    {
      ...base,
      items: [
        // O apelido diz arroz, o código diz outro produto da casa: vale o código.
        line({ raw_description: 'ARROZ T.JOAO 5KG', code: '001234', matched_product_id: 'p-arroz' }),
        // A IA sugere um produto do catálogo; o código ensinou outro, fora do catálogo que a IA viu: vale o código.
        line({ raw_description: 'LEITE DESN 1L', code: '7891000100103', matched_product_id: 'p-leite' }),
        // Código que a casa ainda não aprendeu: fica o que o apelido e a IA disseram.
        line({ raw_description: 'BANANA PRATA', code: '250474', matched_product_id: 'p-banana' }),
        // Sem código: nada muda.
        line({ raw_description: 'SACOLA', code: null }),
      ],
    },
    new Set(['p-arroz', 'p-leite', 'p-banana']),
    new Map([['ARROZ T.JOAO 5KG', 'p-arroz']]),
  );
  const learned = new Map([
    ['001234', 'p-arroz-camil'],
    ['7891000100103', 'p-leite-desnatado'],
  ]);
  const items = withStoreCodes(r.items, learned);
  assertEquals(items.map((i) => [i.raw_description, i.product_id]), [
    ['ARROZ T.JOAO 5KG', 'p-arroz-camil'],
    ['LEITE DESN 1L', 'p-leite-desnatado'],
    ['BANANA PRATA', 'p-banana'],
    ['SACOLA', null],
  ]);
  // O resto da linha não muda, e a lista de antes também não.
  assertEquals({ ...items[0], product_id: 'p-arroz' }, r.items[0]);
  assertEquals(r.items[0].product_id, 'p-arroz');
  assertEquals(withStoreCodes(r.items, new Map()), r.items);
});

Deno.test('storeCodeMatches: os produtos por código; o banco sem a função, ou um erro, é nenhum', () => {
  assertEquals(
    storeCodeMatches([{ code: '250474', product_id: 'p1' }, { code: '7891000100103', product_id: 'p2' }], null),
    new Map([['250474', 'p1'], ['7891000100103', 'p2']]),
  );
  assertEquals(storeCodeMatches(null, null), new Map());
  assertEquals(storeCodeMatches(null, { code: 'PGRST202', message: 'Could not find the function public.match_store_codes' }), new Map());
  assertEquals(storeCodeMatches(null, { code: '42883', message: 'function public.match_store_codes(text, text[]) does not exist' }), new Map());
  assertEquals(storeCodeMatches(null, { code: '57014', message: 'canceling statement due to statement timeout' }), new Map());
});

Deno.test('insertItems: sem a coluna do código, grava sem ele; sem as duas, sem cada uma, uma de cada vez', async () => {
  const rows = [
    { raw_description: 'LEITE ITALAC 1L', generic_name: 'leite', store_code: '7891000100103', receipt_id: 'r1' },
    { raw_description: 'BANANA PRATA', generic_name: null, store_code: '250474', receipt_id: 'r1' },
  ];
  const keys = (batch: unknown[]) => Object.keys(batch[0] as object).sort().join();
  const db = (has: string[]) => {
    const tries: unknown[][] = [];
    const insert = (batch: unknown[]) => {
      tries.push(batch);
      const missing = ['generic_name', 'store_code'].find((c) => c in (batch[0] as object) && !has.includes(c));
      return Promise.resolve({
        error: missing ? { code: 'PGRST204', message: `Could not find the '${missing}' column of 'receipt_items' in the schema cache` } : null,
      });
    };
    return { tries, insert };
  };

  const all = db(['generic_name', 'store_code']);
  assertEquals((await insertItems(all.insert, rows)).error, null);
  assertEquals(all.tries, [rows]);

  const noCode = db(['generic_name']);
  assertEquals((await insertItems(noCode.insert, rows)).error, null);
  assertEquals(noCode.tries.map(keys), ['generic_name,raw_description,receipt_id,store_code', 'generic_name,raw_description,receipt_id']);

  const noGeneric = db(['store_code']);
  assertEquals((await insertItems(noGeneric.insert, rows)).error, null);
  assertEquals(noGeneric.tries.map(keys), ['generic_name,raw_description,receipt_id,store_code', 'raw_description,receipt_id,store_code']);

  const neither = db([]);
  assertEquals((await insertItems(neither.insert, rows)).error, null);
  assertEquals(neither.tries.map(keys), [
    'generic_name,raw_description,receipt_id,store_code',
    'raw_description,receipt_id,store_code',
    'raw_description,receipt_id',
  ]);

  // O check do código (o nome da coluna dentro do nome do check) é erro de verdade.
  const check = { code: '23514', message: 'new row for relation "receipt_items" violates check constraint "receipt_items_store_code_check"' };
  assertEquals(missingItemColumn(check), null);
  assertEquals(missingItemColumn({ code: '42703', message: 'column "store_code" of relation "receipt_items" does not exist' }), 'store_code');
  assertEquals(missingItemColumn({ code: 'PGRST204', message: "Could not find the 'store_code' column of 'receipt_items' in the schema cache" }, ['generic_name']), null);
});

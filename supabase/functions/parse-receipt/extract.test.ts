import { assertEquals } from '@std/assert';

import { extractStructured, type VisionConfig } from '../_shared/vision.ts';
import {
  boughtProducts,
  type CatalogProduct,
  cleanReceipt,
  type ExtractedReceipt,
  ExtractedReceiptSchema,
  imagePathsError,
  instructions,
  MAX_PHOTOS,
  MAX_TOTAL_IMAGE_BYTES,
  promptCatalog,
  sameStoreName,
  SYSTEM,
  TOO_MANY_PHOTOS,
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
      normalized_name: 'Arroz Tio João 5kg',
      category: 'graos',
      quantity: 1,
      unit: 'un',
      unit_price: 25,
      total_price: 25,
      matched_product_id: 'invented-id',
    },
    {
      raw_description: 'BANANA PRATA',
      normalized_name: 'Banana prata',
      category: 'hortifruti',
      quantity: 0.535,
      unit: 'kg',
      unit_price: 0,
      total_price: 3.21,
      matched_product_id: 'p-banana',
    },
    {
      raw_description: '   ',
      normalized_name: '',
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
  normalized_name: 'Leite Italac 1L',
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
    // O preço unitário lido fica; o total não é calculado (pode ter desconto), a revisão pergunta.
    ['PAO', 1, 12.9, 0],
  ]);
  // O preço unitário impresso vai para a leitura do servidor; o leite, sem preço nenhum, não.
  assertEquals(r.readLines, [{ description: 'PAO', unit: 'un', unit_price: 12.9 }]);
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

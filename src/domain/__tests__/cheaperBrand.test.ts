import { describe, expect, it } from '@jest/globals';

import {
  BRAND_CATEGORIES,
  BRAND_KEY_SIZES,
  BRAND_MAX_CALLS,
  BRAND_OPT_OUT,
  brandFreeKey,
  brandGroupCalls,
  brandHead,
  brandItemsSignature,
  brandKeyGroups,
  brandKeyQuotes,
  brandTileName,
  candidateFits,
  CHEAPER_BRAND_BADGE,
  cheaperBrandRankPart,
  KEY_BRAND_FACT,
  keyCandidate,
  packPriceLabel,
  perBaseLabel,
  quantitySentence,
  quantityShort,
  quoteSize,
  type BrandGroup,
  type BrandSearchItem,
} from '../cheaperBrand';
import { genericItem } from '../genericItem';
import {
  groupSignature,
  OPEN_KEYS_PER_ENTRY,
  OPEN_MAX_ENTRIES,
  openGroupArgument,
  openSearchPlan,
  type OpenKeysAnswer,
  type OpenPricesAnswer,
  type SharedItemKey,
  type SharedItemPrice,
} from '../openPrices';
import { comparablePrice } from '../packagePrice';
import { SHARED_CATEGORIES } from '../sharedPrices';

// A marca mais barata (domain/cheaperBrand): quem pode trocar de marca, o que é o mesmo item, o tamanho do preço, a
// busca das marcas que só outras casas compraram e os textos curtos. A disputa em si está nos testes de listEstimate.

const KG = (amount: number) => ({ unit: 'kg' as const, amount, label: `${amount} kg` });

describe('quem pode trocar de marca (brandFreeKey)', () => {
  const free = (name: string, category: string | null, extra: { brandPreferred?: boolean; quantity?: number; unit?: string } = {}) =>
    brandFreeKey({ name, category, quantity: extra.quantity ?? 1, unit: extra.unit ?? 'un', brandPreferred: extra.brandPreferred });

  it('o item sem marca das categorias de mercado: a chave sem marca', () => {
    expect(free('Arroz', 'graos')).toBe('i:arroz');
    expect(free('Arroz 5kg', 'graos')).toBe('i:arroz');
    expect(free('Leite desnatado', 'laticinios')).toBe('i:leite|2=desnatado');
    expect(free('Coca-Cola', 'bebidas')).toBe('i:refrigerante|4=coca');
    expect(free('Feijão carioca', 'graos')).toBe('i:feijao|10=carioca');
    expect(free('Queijo mussarela', 'frios')).toBe('i:mussarela');
    expect(free('Cerveja', 'alcoolicas')).toBe('i:cerveja');
    expect(free('Arroz', 'graos', { quantity: 2, unit: 'kg' })).toBe('i:arroz');
  });

  it('nunca: a marca no nome, a "Marca preferida", fora das categorias, sem quantidade ou em outra unidade', () => {
    for (const [name, category] of [
      ['Biscoito Oreo', 'doces'],
      ['Café Pilão', 'cafe_cha'],
      ['Leite IL Desnatado', 'laticinios'],
      ['Arroz Tio João', 'graos'],
      // A palavra de outro produto que o leitor toma por marca: fica com o produto dele.
      ['Arroz pronto', 'graos'],
      ['Café gelado', 'cafe_cha'],
      // Variedade, corte ou classificação: o leitor deixa de lado.
      ['Carne moída', 'carnes'],
      ['Banana', 'hortifruti'],
      ['Tilápia', 'peixes'],
      ['Papel higiênico', 'papel'],
      ['Ovos', 'ovos'],
      ['Shampoo', 'higiene'],
      ['Ração', 'pet'],
      ['Arroz', 'outros'],
      ['Arroz', null],
    ] as const) {
      expect([name, free(name, category)]).toEqual([name, null]);
    }
    expect(free('Arroz', 'graos', { brandPreferred: true })).toBeNull();
    expect(free('Arroz', 'graos', { quantity: 0 })).toBeNull();
    expect(free('Arroz', 'graos', { unit: 'cx' })).toBeNull();
  });

  it('as categorias são de mercado e todas da base comum', () => {
    expect(BRAND_CATEGORIES).toHaveLength(13);
    for (const category of BRAND_CATEGORIES) expect(SHARED_CATEGORIES).toContain(category);
    for (const out of ['hortifruti', 'carnes', 'peixes', 'ovos', 'papel', 'bebe', 'pet']) expect(BRAND_CATEGORIES).not.toContain(out);
  });
});

describe('o tamanho do preço da casa (quoteSize) e o preço por kg', () => {
  it('a leitura estrita da descrição, só peso ou volume de um pacote', () => {
    expect(quoteSize('ARROZ T1 TIO JOAO 5KG')).toEqual(KG(5));
    expect(quoteSize('OLEO SOJA LIZA 900ML')?.label).toBe('900 ml');
    expect(quoteSize('CERV SKOL LT 350ML C/12')).toBeNull();
    expect(quoteSize('OVOS BRANCOS C/12')).toBeNull();
    // Um número que a leitura não explica deixa em dúvida.
    expect(quoteSize('CAFE 3 CORACOES 500G')).toBeNull();
    expect(quoteSize(null)).toBeNull();
    expect(quoteSize('')).toBeNull();
  });

  it('o preço por unidade com o pacote vira preço por kg; o sem tamanho não compara', () => {
    expect(comparablePrice('un', 24.9, quoteSize('ARROZ T1 TIO JOAO 5KG'))).toEqual({ base: 'kg', perBase: 4.98, pack: KG(5), packagePrice: 24.9 });
    expect(comparablePrice('un', 24.9, quoteSize('ARROZ TIO JOAO'))).toBeNull();
    expect(comparablePrice('kg', 49.9, null)).toEqual({ base: 'kg', perBase: 49.9, pack: null, packagePrice: null });
  });
});

describe('a marca de um produto da casa (brandHead)', () => {
  it('a primeira palavra que não é do item, de tamanho nem de descrição', () => {
    expect(brandHead({ name: 'Arroz Tio João 5kg', category: 'graos' })).toBe('tio');
    expect(brandHead({ name: 'Leite Integral Italac 1L', category: 'laticinios' })).toBe('italac');
    expect(brandHead({ name: 'Café Pilão Tradicional 500g', category: 'cafe_cha' })).toBe('pilao');
    expect(brandHead({ name: 'Arroz Branco Camil Tipo 1 5kg', category: 'graos' })).toBe('camil');
    expect(brandHead({ name: 'Refrigerante Coca-Cola 2l', category: 'bebidas' })).toBeNull();
    expect(brandHead({ name: 'Arroz 5kg', category: 'graos' })).toBeNull();
  });
});

describe('o mesmo item de outra marca (candidateFits)', () => {
  const fits = (list: string, category: string, referenceName: string, candidate: string, candidateCategory?: string) => {
    const reference = { key: genericItem(referenceName, category).key, name: referenceName };
    const named = candidate === candidate.toUpperCase() ? keyCandidate(candidate) : { name: candidate, category: candidateCategory ?? category };
    return candidateFits({ name: list, category }, reference, named);
  };

  it('arroz: as marcas de arroz branco; nunca quebrado, tipo 2, vermelho, arbório, integral, parboilizado ou japonês', () => {
    for (const ok of ['Arroz Prato Fino 5kg', 'Arroz Camil 1kg', 'ARROZ BRANCO T1 KICALDO 5KG', 'ARROZ AGULHINHA T1 5KG', 'ARROZ T1 KICALDO 1KG']) {
      expect([ok, fits('Arroz', 'graos', 'Arroz Tio João 5kg', ok)]).toEqual([ok, true]);
    }
    for (const no of [
      'ARROZ QUEBRADO 5KG',
      'ARROZ T2 5KG',
      'ARROZ TIPO 2 5KG',
      'ARROZ VERMELHO 1KG',
      'ARROZ ARBORIO 1KG',
      'ARROZ INTEGRAL CAMIL 1KG',
      'ARROZ PARBOILIZADO 5KG',
      'ARROZ JAPONES 1KG',
    ]) {
      expect([no, fits('Arroz', 'graos', 'Arroz Tio João 5kg', no)]).toEqual([no, false]);
    }
  });

  it('o tamanho que a lista diz conta: "Arroz 5kg" não leva o pacote de 1 kg', () => {
    expect(fits('Arroz 5kg', 'graos', 'Arroz Tio João 5kg', 'Arroz Camil 1kg')).toBe(false);
    expect(fits('Arroz 5kg', 'graos', 'Arroz Tio João 5kg', 'Arroz Prato Fino 5kg')).toBe(true);
  });

  it('o leite que a casa compra integral compara só integral', () => {
    expect(fits('Leite', 'laticinios', 'Leite Integral Italac 1L', 'LEITE UHT INT PIRACANJUBA 1L')).toBe(true);
    for (const no of ['LEITE UHT DESN ITALAC 1L', 'LEITE UHT SEMI 1L', 'LEITE CABRA 1L', 'LEITE UHT INTEGRAL ZERO LACTOSE 1L']) {
      expect([no, fits('Leite', 'laticinios', 'Leite Integral Italac 1L', no)]).toEqual([no, false]);
    }
  });

  it('detergente, óleo, feijão, queijo, café e cerveja: nunca outro produto do mesmo item', () => {
    for (const no of ['DETERGENTE INDUSTRIAL 5L', 'DETERGENTE PARA ROUPAS 2L', 'DETERGENTE EM PO']) {
      expect([no, fits('Detergente', 'limpeza', 'Detergente Ypê Neutro 500ml', no)]).toEqual([no, false]);
    }
    expect(fits('Detergente', 'limpeza', 'Detergente Ypê Neutro 500ml', 'DETERG LIMPOL NEUTRO 500ML')).toBe(true);
    for (const no of ['OLEO MINERAL 100ML', 'OLEO COMPOSTO 500ML', 'OLEO MOTOR 1L']) {
      expect([no, fits('Óleo', 'oleos', 'Óleo de soja Liza 900ml', no)]).toEqual([no, false]);
    }
    expect(fits('Óleo', 'oleos', 'Óleo de soja Liza 900ml', 'OLEO SOJA COCAMAR 900ML')).toBe(true);
    for (const no of ['FEIJAO EM LATA', 'FEIJAO COZIDO', 'FEIJAO PRETO CAMIL 1KG', 'FEIJAO CARIOCA TIPO 2 1KG']) {
      expect([no, fits('Feijão', 'graos', 'Feijão Carioca Camil 1kg', no)]).toEqual([no, false]);
    }
    expect(fits('Feijão', 'graos', 'Feijão Carioca Camil 1kg', 'FEIJAO CARIOCA KICALDO 1KG')).toBe(true);
    for (const no of ['QUEIJO TIPO MUSSARELA KG', 'QUEIJO MUSSARELA BUFALA']) {
      expect([no, fits('Queijo mussarela', 'frios', 'Queijo Mussarela Tirolez kg', no)]).toEqual([no, false]);
    }
    for (const no of ['CAFE GELADO', 'CAFE SOLUVEL NESCAFE 100G', 'CAFE CAPSULA', 'CAFE EM GRAOS 1KG']) {
      expect([no, fits('Café', 'cafe_cha', 'Café Pilão Tradicional 500g', no)]).toEqual([no, false]);
    }
    expect(fits('Café', 'cafe_cha', 'Café Pilão Tradicional 500g', 'CAFE MELITTA EXTRA FORTE 500G')).toBe(true);
    expect(fits('Cerveja', 'alcoolicas', 'Cerveja Skol lata 350ml', 'CERVEJA SEM ALCOOL 350ML')).toBe(false);
    expect(fits('Cerveja', 'alcoolicas', 'Cerveja Skol lata 350ml', 'CERV BRAHMA LT 350ML')).toBe(true);
  });

  it('a marca de outro produto que o de sempre tem vale, e passa a ser exigida: quem compra leite de cabra leva leite de cabra', () => {
    expect(fits('Leite', 'laticinios', 'Leite Cabra Caprilat 1L', 'LEITE CABRA 1L')).toBe(true);
    expect(fits('Leite', 'laticinios', 'Leite Cabra Caprilat 1L', 'LEITE UHT SEMI 1L')).toBe(false);
    // A lista que diz a marca também a aceita (o mesmo item, pela chave do de sempre).
    expect(fits('Leite de cabra', 'laticinios', 'Leite de cabra Caprilat 1L', 'LEITE DE CABRA CAPRIMIL 1L')).toBe(true);
  });
});

describe('os textos', () => {
  it('o nome curto do quadrinho', () => {
    expect(brandTileName('Arroz Prato Fino 5kg', 'graos')).toBe('Prato Fino 5kg');
    expect(brandTileName('Leite Integral Italac 1L', 'laticinios')).toBe('Italac 1L');
    expect(brandTileName('Arroz Camil 1kg', 'graos')).toBe('Camil 1kg');
    // Sobraria só o tamanho: o nome inteiro.
    expect(brandTileName('Refrigerante Coca-Cola 2l', 'bebidas')).toBe('Refrigerante Coca-Cola 2l');
  });

  it('o preço por kg ou litro, o do pacote e os pacotes', () => {
    const five = { base: 'kg' as const, perBase: 3.98, pack: KG(1), packagePrice: 5.49, amount: 5, packages: 5, sayQuantity: true };
    expect(perBaseLabel({ base: 'kg', perBase: 4.58 })).toBe('R$ 4,58/kg');
    expect(perBaseLabel({ base: 'l', perBase: 4.79 })).toBe('R$ 4,79/l');
    expect(packPriceLabel({ pack: KG(5), packagePrice: 22.9 })).toBe('5 kg por R$ 22,90');
    expect(packPriceLabel({ pack: null, packagePrice: null })).toBeNull();
    expect(quantitySentence(five)).toBe('A conta usa 5 kg: 5 pacotes de 1 kg.');
    expect(quantityShort(five)).toBe('5 pacotes de 1 kg');
    expect(quantitySentence({ ...five, amount: 0.5, packages: 1, pack: { unit: 'kg', amount: 0.5, label: '500 g' } })).toBe('A conta usa 500 g: 1 pacote de 500 g.');
    expect(quantitySentence({ ...five, sayQuantity: false })).toBeNull();
    expect(quantityShort({ ...five, packages: null })).toBeNull();
  });

  it('o selo, o ranking e as frases fixas', () => {
    expect(CHEAPER_BRAND_BADGE(1)).toBe('1 pela marca mais barata');
    expect(CHEAPER_BRAND_BADGE(2)).toBe('2 pela marca mais barata');
    expect(cheaperBrandRankPart(2)).toBe(' · 2 pela marca mais barata');
    expect(cheaperBrandRankPart(0)).toBe('');
    expect(KEY_BRAND_FACT).toBe('A marca não aparece: é o menor preço desse tamanho que outras casas viram nesse mercado, naquela semana.');
    expect(BRAND_OPT_OUT).toBe('Para a conta ficar com o de sempre, ligue "Marca preferida".');
  });
});

// ---------------------------------------------------------------------------
// A base aberta: as marcas que só outras casas compraram

const searchItem = (id: string, name: string, extra: Partial<BrandSearchItem> = {}): BrandSearchItem => ({
  id,
  name,
  category: 'graos',
  quantity: 1,
  unit: 'un',
  brandPreferred: false,
  referenceKey: 'i:arroz',
  referenceName: 'Arroz Tio João 5kg',
  base: 'kg',
  amounts: [1, 5],
  excludedKeys: [],
  houseHeads: ['tio'],
  ...extra,
});
const key = (k: string, unit: SharedItemKey['unit'] = 'un', seen = 1, week = '2026-11-09'): SharedItemKey => ({ key: k, unit, week, seen });

/** O plano (os itens da troca de marca como `extra`) e uma resposta do passo 1 que dá a cada busca as chaves pedidas. */
function brandAnswered(items: BrandSearchItem[], keysOf: (item: BrandSearchItem) => SharedItemKey[]) {
  const plan = openSearchPlan([], items);
  const bySignature = new Map<string, SharedItemKey[]>();
  for (const one of items) {
    const signature = plan.entryOf.get(one.id);
    if (signature) bySignature.set(signature, [...(bySignature.get(signature) ?? []), ...keysOf(one)]);
  }
  const answers: OpenKeysAnswer[] = plan.calls.map((call) => ({
    entries: call.map((entry) => entry.signature),
    keys: call.map((entry) => bySignature.get(entry.signature) ?? []),
    more: call.map(() => false),
  }));
  return { plan, answers, groups: brandKeyGroups(items, answers, plan) };
}

describe('a busca das marcas (brandKeyGroups)', () => {
  const ARROZ = [
    key('ARROZ BRANCO T1 KICALDO 5KG', 'un', 4),
    key('ARROZ T1 KICALDO 1KG', 'un', 3),
    key('ARROZ T1 TIO JOAO 5KG', 'un', 9),
    key('ARROZ QUEBRADO 5KG', 'un', 9),
    key('ARROZ ARBORIO 1KG', 'un', 2),
    key('ARROZ PRATO FINO T1 5KG', 'un', 5),
    key('ARROZ AGULHINHA 2KG', 'un', 1),
    key('ARROZ A GRANEL', 'kg', 2),
  ];

  it('um grupo por tamanho que cabe, e um a peso; sem as da casa, as de outro produto e as que não cabem', () => {
    const { groups } = brandAnswered([searchItem('a', 'Arroz', { excludedKeys: ['ARROZ PRATO FINO T1 5KG'] })], () => ARROZ);
    const byRank = [...groups].sort((a, b) => a.rank - b.rank);
    expect(byRank.map((group) => [group.rank, group.keys, group.weightOnly, group.expected?.label ?? null])).toEqual([
      [0, [], ['ARROZ A GRANEL'], null],
      // 5 kg é o mais visto (o Tio João, da casa, e o quebrado não contam); 2 kg não cabe em 1 kg nem em 5 kg.
      [1, ['ARROZ BRANCO T1 KICALDO 5KG'], [], '5 kg'],
      [2, ['ARROZ T1 KICALDO 1KG'], [], '1 kg'],
    ]);
    for (const group of groups) {
      expect(group.signature).toBe(groupSignature(group.keys, group.weightOnly, group.expected));
      expect(group.items).toEqual([{ id: 'a', base: 'kg', size: group.expected, referenceKey: 'i:arroz' }]);
    }
  });

  it('a quantidade que a lista diz só pergunta os tamanhos que cabem inteiros nela', () => {
    const { groups } = brandAnswered([searchItem('a', 'Arroz 5kg', { amounts: [5] })], () => ARROZ);
    expect(groups.filter((group) => group.expected).map((group) => group.expected!.label)).toEqual(['5 kg']);
  });

  it('no máximo BRAND_KEY_SIZES tamanhos, os mais vistos; grupos iguais de itens diferentes viram um, com o menor rank', () => {
    const sizes = ['500G', '1KG', '2KG', '3KG', '5KG', '10KG'].map((size, at) => key(`ARROZ MARCA${'ABCDEF'[at]} ${size}`, 'un', 10 - at));
    const { groups } = brandAnswered(
      [searchItem('a', 'Arroz', { amounts: [0.5, 1, 2, 3, 5, 10] }), searchItem('b', 'Arroz', { id: 'b', amounts: [5] })],
      () => sizes,
    );
    const ofA = groups.filter((group) => group.items.some((one) => one.id === 'a') && group.expected);
    expect(ofA).toHaveLength(BRAND_KEY_SIZES);
    // Para 5 kg cabem 10 de 500 g, 5 de 1 kg e 1 de 5 kg: os de 500 g e 1 kg são os mesmos grupos de "a".
    expect(groups.filter((group) => group.items.length === 2).map((group) => [group.expected?.label, group.rank])).toEqual([
      ['500 g', 1],
      ['1 kg', 2],
    ]);
    expect(groups.filter((group) => group.items.length === 1 && group.items[0].id === 'b').map((group) => [group.expected?.label, group.rank])).toEqual([
      ['5 kg', 3],
    ]);
  });

  it('cada grupo leva no máximo OPEN_KEYS_PER_ENTRY descrições (as da semana mais nova, as mais vistas), em ordem', () => {
    const name = (n: number) => `ARROZ MARCA${'ABCDEFGHIJ'[Math.floor(n / 10)]}${'ABCDEFGHIJ'[n % 10]} 5KG`;
    const many = Array.from({ length: OPEN_KEYS_PER_ENTRY + 5 }, (_, n) => key(name(n), 'un', n, n < 3 ? '2026-10-05' : '2026-11-09'));
    const { groups } = brandAnswered([searchItem('a', 'Arroz', { houseHeads: [] })], () => many);
    const [five] = groups;
    expect(five.keys).toHaveLength(OPEN_KEYS_PER_ENTRY);
    expect(five.keys).toEqual([...five.keys].sort());
    // As da semana mais velha ficam de fora primeiro.
    expect(five.keys).not.toContain(name(0));
  });

  it('o que vai ao banco é o que ele aceita', () => {
    const { groups } = brandAnswered([searchItem('a', 'Arroz')], () => ARROZ);
    for (const group of groups) {
      const argument = openGroupArgument(group);
      expect(argument.k.length + (argument.w?.length ?? 0)).toBeGreaterThan(0);
      expect(argument.w?.some((one) => argument.k.includes(one)) ?? false).toBe(false);
    }
  });
});

describe('as chamadas das marcas (brandGroupCalls)', () => {
  const group = (signature: string, rank: number): BrandGroup => ({ signature, keys: [signature], weightOnly: [], expected: null, items: [], rank });

  it('pelo rank e pela assinatura, sem o que a base aberta já pede, no máximo BRAND_MAX_CALLS chamadas', () => {
    const groups = [group('C', 2), group('A', 1), group('B', 0), group('D', 1)];
    expect(brandGroupCalls(groups, new Set(['D'])).map((call) => call.map((one) => one.signature))).toEqual([['B', 'A', 'C']]);
    const many = Array.from({ length: OPEN_MAX_ENTRIES * (BRAND_MAX_CALLS + 1) }, (_, n) => group(`G${String(n).padStart(3, '0')}`, n % 3));
    const calls = brandGroupCalls(many, new Set());
    expect(calls).toHaveLength(BRAND_MAX_CALLS);
    expect(calls.flat().every((one) => one.rank <= 1)).toBe(true);
  });
});

describe('os preços das marcas (brandKeyQuotes)', () => {
  const STORES = [
    { id: 'assai', cnpj: '11111111000111', name: 'Assaí' },
    { id: 'assai2', cnpj: '11111111000111', name: 'Assaí Norte' },
    { id: 'dia', cnpj: '22222222000122', name: 'Dia' },
  ];
  const row = (group: number, cnpj: string, unit: string, price: number, extra: Partial<SharedItemPrice> = {}): SharedItemPrice => ({
    group,
    store_cnpj: cnpj,
    store_name: 'MERCADO',
    store_uf: '35',
    unit,
    unit_price: price,
    seen_on: '2026-11-09',
    mine: true,
    ...extra,
  });
  const five: BrandGroup = {
    signature: groupSignature(['ARROZ BRANCO T1 KICALDO 5KG'], [], KG(5)),
    keys: ['ARROZ BRANCO T1 KICALDO 5KG'],
    weightOnly: [],
    expected: KG(5),
    items: [{ id: 'a', base: 'kg', size: KG(5), referenceKey: 'i:arroz' }],
    rank: 1,
  };
  const loose: BrandGroup = {
    signature: groupSignature([], ['ARROZ A GRANEL'], null),
    keys: [],
    weightOnly: ['ARROZ A GRANEL'],
    expected: null,
    items: [{ id: 'a', base: 'kg', size: null, referenceKey: 'i:arroz' }],
    rank: 0,
  };

  it('pela assinatura, só dos mercados da casa (cada um com o CNPJ), por kg: o pacote do grupo e o a granel', () => {
    const answer: OpenPricesAnswer = {
      groups: [five.signature, loose.signature],
      rows: [
        row(0, '11111111000111', 'un', 19.9),
        // Fora da casa: não entra.
        row(0, '99999999000199', 'un', 15, { mine: false }),
        // A casa diz que é dela, mas o CNPJ não está nos mercados carregados.
        row(0, '33333333000133', 'un', 15),
        // O servidor leu outro tamanho.
        row(0, '22222222000122', 'un', 4.79, { pack_unit: 'kg', pack_amount: 1, pack_of: null }),
        row(1, '22222222000122', 'g', 0.0045),
      ],
    };
    const quotes = brandKeyQuotes([answer], [five, loose], STORES).get('a')!;
    expect(quotes.map((quote) => [quote.storeId, quote.price.perBase, quote.price.pack?.label ?? null, quote.group])).toEqual([
      ['assai', 3.98, '5 kg', five.signature],
      ['assai2', 3.98, '5 kg', five.signature],
      ['dia', 4.5, null, loose.signature],
    ]);
    const [first] = quotes;
    expect(first.quote).toMatchObject({ productId: null, storeId: 'assai', storeName: 'Assaí', unit: 'un', unitPrice: 19.9, seenWeek: '2026-11-09', pack: KG(5) });
    // Não é o preço do item sem preço: sem `open`, e os detalhes não falam da base aberta.
    expect(first.quote.open).toBeUndefined();
    expect(first.referenceKey).toBe('i:arroz');
  });

  it('a resposta de outra lista, ou de antes, não põe preço: só a assinatura de agora', () => {
    const answer: OpenPricesAnswer = { groups: ['OUTRA'], rows: [row(0, '11111111000111', 'un', 19.9)] };
    expect(brandKeyQuotes([answer], [five], STORES).size).toBe(0);
  });
});

describe('a assinatura dos itens das marcas', () => {
  it('muda com o que a busca usa, e não com a ordem dos campos de fora', () => {
    const one = searchItem('a', 'Arroz');
    expect(brandItemsSignature([one])).toBe(brandItemsSignature([{ ...one }]));
    expect(brandItemsSignature([one])).not.toBe(brandItemsSignature([{ ...one, amounts: [5] }]));
    expect(brandItemsSignature([one])).not.toBe(brandItemsSignature([{ ...one, excludedKeys: ['ARROZ X'] }]));
    expect(brandItemsSignature(null)).toBe('[]');
  });
});

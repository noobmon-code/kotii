import { describe, expect, it } from '@jest/globals';

import { COMMON_ITEMS } from '../commonItems';
import {
  defaultKeep,
  differentSizes,
  factsLine,
  mergeCandidates,
  mergeResult,
  mergeSuggestions,
  mergeSummary,
  mergeWarnings,
  orderedPair,
  productFacts,
  purchasesLabel,
  similarProducts,
  type MergePair,
  type MergeSide,
  type ProductFacts,
} from '../productMerge';
import { indexNames, nameCandidates, nameSizes, sameProductPairs, sizeLabel, suggestedName, type ProductName } from '../similarNames';

/** Produtos com o id pelo lugar na lista ("p00", "p01"...): a ordem dos ids é a dos nomes dados. */
const products = (...names: string[]): ProductName[] =>
  names.map((name, at) => ({ id: `p${String(at).padStart(2, '0')}`, name, category: 'outros' }));

/** Os pares como nomes, cada par e a lista em ordem, para comparar sem depender de quem veio primeiro. */
function pairNames(list: readonly ProductName[], common = COMMON_ITEMS): string[] {
  const byId = new Map(list.map((product) => [product.id, product.name]));
  return sameProductPairs(list, common)
    .map(({ ids, closeness }) => `${ids.map((id) => byId.get(id)).sort().join(' = ')} (${closeness})`)
    .sort();
}

const noFacts: ProductFacts = { purchases: 0, lastPrice: null, inPantry: false, onList: false, units: [] };
const side = (name: string, facts: Partial<ProductFacts> = {}): MergeSide => ({ name, facts: { ...noFacts, ...facts } });

describe('nameSizes', () => {
  it('lê o tamanho escrito de vários jeitos como um só', () => {
    expect(nameSizes('Arroz Tio João 5 Kg').sizes).toEqual(['5kg']);
    expect(nameSizes('Arroz 5 quilos').sizes).toEqual(['5kg']);
    expect(nameSizes('Água 1,5 L').sizes).toEqual(['1p5l']);
    expect(nameSizes('Coca-Cola 2 Litros').sizes).toEqual(['2l']);
    expect(nameSizes('Ovos (dúzia)').sizes).toEqual(['12un']);
    expect(nameSizes('Coca-Cola Lata 350ml c/12').sizes).toEqual(['12un', '350ml']);
  });

  it('unidade solta, versão e letra não são tamanho', () => {
    expect(nameSizes('Banana Prata Kg').sizes).toEqual([]);
    expect(nameSizes('Arroz Tipo 1').sizes).toEqual([]);
    expect(nameSizes('Vitamina C').sizes).toEqual([]);
    expect(nameSizes('Arroz').sizes).toEqual([]);
  });

  it('marca o tamanho que veio depois de um algarismo solto', () => {
    expect(nameSizes('Agua 1 5l')).toEqual({ sizes: ['5l'], doubtful: true });
    expect(nameSizes('Água 1,5L').doubtful).toBe(false);
  });

  it('o tamanho como a pessoa lê', () => {
    expect(sizeLabel('5kg')).toBe('5 kg');
    expect(sizeLabel('1p5l')).toBe('1,5 L');
    expect(sizeLabel('350ml')).toBe('350 ml');
    expect(sizeLabel('12un')).toBe('12 un');
  });
});

describe('sameProductPairs: os produtos que parecem o mesmo', () => {
  it('o mesmo nome com outro acento, plural, unidade solta ou ordem das palavras', () => {
    expect(pairNames(products('Limão', 'Limões', 'Banana Prata Kg', 'Banana prata', 'Feijão Preto', 'Preto, feijões', 'Açúcar', 'acucar'))).toEqual([
      'Açúcar = acucar (igual)',
      'Banana Prata Kg = Banana prata (igual)',
      'Feijão Preto = Preto, feijões (igual)',
      'Limão = Limões (igual)',
    ]);
    expect(pairNames(products('Arroz 5 Kg', 'Arroz 5kg', 'Ovos c/12', 'Ovos (dúzia)'))).toEqual([
      'Arroz 5 Kg = Arroz 5kg (igual)',
      'Ovos (dúzia) = Ovos c/12 (igual)',
    ]);
  });

  it('três com o mesmo nome fazem par entre todos', () => {
    expect(pairNames(products('Banana', 'Bananas', 'banana kg'))).toEqual([
      'Banana = Bananas (igual)',
      'Banana = banana kg (igual)',
      'Bananas = banana kg (igual)',
    ]);
  });

  it('com a marca ou sem: o nome de um cabe no começo do outro', () => {
    expect(pairNames(products('Arroz', 'Arroz Tio João 5kg'))).toEqual(['Arroz = Arroz Tio João 5kg (parecido)']);
    expect(pairNames(products('Leite Integral Italac 1L', 'Leite'))).toEqual(['Leite = Leite Integral Italac 1L (parecido)']);
    expect(pairNames(products('Detergente Ypê 500ml', 'Deterg Ype 500ml'))).toEqual(['Deterg Ype 500ml = Detergente Ypê 500ml (parecido)']);
    // O produto com tamanho escrito com o tipo na frente e a embalagem.
    expect(pairNames(products('Coca-Cola 2L', 'Refrigerante Coca-Cola 2l Pet'))).toEqual(['Coca-Cola 2L = Refrigerante Coca-Cola 2l Pet (parecido)']);
    expect(pairNames(products('Coca-Cola 350ml', 'Coca-Cola Lata 350ml'))).toEqual(['Coca-Cola 350ml = Coca-Cola Lata 350ml (parecido)']);
  });

  it('cada produto faz par com o nome mais completo que cabe nele, não com todos', () => {
    expect(pairNames(products('Leite', 'Leite integral', 'Leite Integral Italac 1L'))).toEqual([
      'Leite = Leite integral (parecido)',
      'Leite Integral Italac 1L = Leite integral (parecido)',
    ]);
  });

  it('produto que tem outro com o mesmo nome fica só com esse par', () => {
    expect(pairNames(products('Banana', 'Banana prata', 'Bananas prata'))).toEqual(['Banana prata = Bananas prata (igual)']);
  });

  it('nunca: tamanhos diferentes', () => {
    expect(pairNames(products('Arroz Tio João 5kg', 'Arroz Tio João 1kg'))).toEqual([]);
    expect(pairNames(products('Coca-Cola 2L', 'Coca-Cola 350ml', 'Coca-Cola Lata 350ml c/12'))).toEqual([]);
    expect(pairNames(products('Água 1,5L', 'Água 5L', 'Agua 1 5l'))).toEqual([]);
    expect(pairNames(products('Ovos c/12', 'Ovos 30un'))).toEqual([]);
  });

  it('nunca: produto com tamanho e outro com mais que a embalagem no nome (a regra não sabe se é marca ou outro tipo)', () => {
    expect(pairNames(products('Coca-Cola 2L', 'Coca-Cola Zero 2L'))).toEqual([]);
    expect(pairNames(products('Arroz 5kg', 'Arroz Tio João 5 kg'))).toEqual([]);
  });

  it('nunca: o nome mais comprido é outra coisa', () => {
    expect(pairNames(products('Leite', 'Leite de coco', 'Leite condensado', 'Leite cond moca'))).toEqual([]);
    expect(pairNames(products('Pão', 'Pão de queijo', 'Batata', 'Batata-doce', 'Batata palha'))).toEqual([]);
    expect(pairNames(products('Alho', 'Molho de alho'))).toEqual([]);
  });

  it('nunca: as mesmas palavras em outra ordem, quando a ordem faz parte do nome', () => {
    expect(pairNames(products('Suco de laranja', 'Laranja para suco'))).toEqual([]);
    expect(pairNames(products('Molho de tomate', 'Tomate para molho'))).toEqual([]);
  });

  it('nunca: versão, letra ou "sem" diferentes', () => {
    expect(pairNames(products('Vitamina C', 'Vitamina D', 'Fralda Pampers G', 'Fralda Pampers M'))).toEqual([]);
    expect(pairNames(products('Manteiga sem sal', 'Manteiga com sal'))).toEqual([]);
    expect(pairNames(products('Feijão Tipo 1', 'Feijão Tipo 2'))).toEqual([]);
  });

  it('nome sem letra nem número não entra', () => {
    expect(pairNames(products('---', '!!!', 'Arroz'))).toEqual([]);
    expect(sameProductPairs([])).toEqual([]);
  });

  // A regra é a da sugestão do item da nota: para cada produto sem outro de mesmo nome, o par é o que
  // `suggestedName` daria se o nome chegasse agora numa nota, com os outros produtos e o catálogo.
  it('dá o mesmo que a sugestão do item da nota, conferindo cada nome com os outros produtos', () => {
    const list = products(
      'Arroz 5kg', 'Arroz Tio João 5 kg', 'Arroz', 'Arroz Tio João', 'Arroz integral', 'Arroz Tio João 1kg',
      'Leite', 'Leite de coco', 'Leite Integral Italac 1L', 'Leite condensado', 'Leite cond moca',
      'Coca-Cola 2L', 'Coca-Cola Zero 2L', 'Refrigerante Coca-Cola 2l Pet', 'Coca-Cola Lata 350ml', 'Coca-Cola 350ml',
      'Pão', 'Pão de queijo', 'Detergente Ypê 500ml', 'Deterg Ype 500ml', 'Açúcar', 'Acucar Uniao 1kg',
      'Batata', 'Batata-doce', 'Batata palha', 'Ovos c/12', 'Ovos 30un', 'Vitamina C', 'Vitamina D',
      'Água 1,5L', 'Agua 1 5l', 'Água 5L', 'Manteiga sem sal', 'Manteiga com sal', 'Manteiga', 'Sardinha Molho de Tomate', 'Molho de tomate',
    );
    const expected = list.flatMap((product) => {
      const others = list.filter((other) => other.id !== product.id);
      const found = suggestedName(product.name, indexNames(nameCandidates({ products: others, listItems: [], purchases: [], common: COMMON_ITEMS })), {
        category: product.category,
      });
      return found?.productId ? [[product.name, found.name].sort().join(' = ')] : [];
    });
    expect(expected.length).toBeGreaterThan(8);
    expect(pairNames(list).map((pair) => pair.replace(/ \(\w+\)$/, ''))).toEqual([...new Set(expected)].sort());
  });
});

describe('differentSizes', () => {
  it('só quando os dois nomes trazem tamanho e não é o mesmo', () => {
    expect(differentSizes('Arroz 5kg', 'Arroz 1kg')).toBe(true);
    expect(differentSizes('Coca-Cola 2L', 'Coca-Cola Lata 350ml')).toBe(true);
    expect(differentSizes('Ovos c/12', 'Ovos 30un')).toBe(true);
    expect(differentSizes('Arroz 5kg', 'Arroz Tio João 5 Kg')).toBe(false);
    expect(differentSizes('Arroz', 'Arroz Tio João 5kg')).toBe(false);
    expect(differentSizes('Banana kg', 'Banana')).toBe(false);
  });
});

describe('mergeCandidates', () => {
  const list = products('Limão', 'Limões', 'Arroz', 'Arroz Tio João 5kg', 'Arroz Tio João 1kg', 'Feijão carioca');
  const names = (pairs: readonly MergePair[]) => pairs.map((pair) => pair.map((product) => product.name).sort().join(' = ')).sort();

  it('os pares que parecem o mesmo produto', () => {
    expect(names(mergeCandidates(list, []))).toEqual(['Arroz = Arroz Tio João 1kg', 'Arroz = Arroz Tio João 5kg', 'Limão = Limões']);
  });

  it('o par que a casa disse ser diferente não volta, em qualquer ordem dos ids', () => {
    expect(names(mergeCandidates(list, [{ product_a: 'p00', product_b: 'p01' }]))).toEqual(['Arroz = Arroz Tio João 1kg', 'Arroz = Arroz Tio João 5kg']);
    expect(names(mergeCandidates(list, [{ product_a: 'p03', product_b: 'p02' }]))).toEqual(['Arroz = Arroz Tio João 1kg', 'Limão = Limões']);
  });

  it('nunca traz dois nomes com tamanhos diferentes nem um produto com ele mesmo', () => {
    const pairs = mergeCandidates(products('Arroz Tio João 5kg', 'Arroz Tio João 1kg', 'Coca-Cola 2L', 'Coca-Cola 350ml', 'Arroz', 'Limão', 'Limões'), []);
    expect(pairs.length).toBeGreaterThan(0);
    for (const [a, b] of pairs) {
      expect(a.id).not.toBe(b.id);
      expect(differentSizes(a.name, b.name)).toBe(false);
    }
  });

  it('casa sem pares: nada', () => {
    expect(mergeCandidates(products('Arroz', 'Feijão carioca', 'Leite de coco'), [])).toEqual([]);
    expect(mergeCandidates([], [])).toEqual([]);
  });
});

describe('defaultKeep', () => {
  it('fica o de mais compras; no empate, o que a pessoa abriu', () => {
    expect(defaultKeep('a', 'b', { a: 1, b: 12 })).toBe('b');
    expect(defaultKeep('a', 'b', { a: 12, b: 1 })).toBe('a');
    expect(defaultKeep('a', 'b', { a: 3, b: 3 })).toBe('a');
    expect(defaultKeep('b', 'a', { a: 3, b: 3 })).toBe('b');
    // Sem compras conhecidas vale zero.
    expect(defaultKeep('a', 'b', {})).toBe('a');
    expect(defaultKeep('a', 'b', { b: 1 })).toBe('b');
  });
});

describe('mergeSuggestions', () => {
  const list = products('Limão', 'Limões', 'Arroz', 'Arroz Tio João 5kg', 'Banana', 'Bananas', 'Açúcar', 'acucar');
  const [limao, limoes, arroz, arrozTj, banana, bananas, acucar, acucar2] = list;
  const candidates = mergeCandidates(list, []);
  const shown = (purchases: Record<string, number>, options?: Parameters<typeof mergeSuggestions>[2], from = candidates) =>
    mergeSuggestions(from, purchases, options).map(({ keep, other }) => `${keep.name} <- ${other.name}`);

  it('no máximo 3, os pares com mais compras primeiro', () => {
    const purchases = { [limao.id]: 1, [limoes.id]: 1, [arroz.id]: 2, [arrozTj.id]: 10, [banana.id]: 4, [bananas.id]: 1, [acucar.id]: 0, [acucar2.id]: 1 };
    expect(candidates).toHaveLength(4);
    expect(shown(purchases)).toEqual(['Arroz Tio João 5kg <- Arroz', 'Banana <- Bananas', 'Limão <- Limões']);
  });

  it('os outros aparecem conforme os primeiros são resolvidos', () => {
    const purchases = { [arrozTj.id]: 10, [banana.id]: 4, [limao.id]: 2, [acucar2.id]: 1 };
    const rest = mergeCandidates(list, [orderedPair(arroz.id, arrozTj.id)]);
    expect(shown(purchases, undefined, rest)).toEqual(['Banana <- Bananas', 'Limão <- Limões', 'acucar <- Açúcar']);
  });

  it('em cada par fica por padrão o de mais compras', () => {
    expect(shown({ [limoes.id]: 5, [limao.id]: 1 }, { limit: 1 })).toEqual(['Limões <- Limão']);
    expect(shown({ [limoes.id]: 1, [limao.id]: 5 }, { limit: 1 })).toEqual(['Limão <- Limões']);
  });

  it('sem compras conhecidas, a ordem é a dos nomes', () => {
    expect(shown({})).toEqual(['Açúcar <- acucar', 'Arroz Tio João 5kg <- Arroz', 'Banana <- Bananas']);
  });

  it('cada produto aparece num par só de cada vez: resolvido um, vem o outro', () => {
    const rice = products('Arroz', 'Arroz Tio João 5kg', 'Arroz Tio João 1kg', 'Limão', 'Limões');
    const purchases = { p00: 1, p01: 12, p02: 3, p03: 1, p04: 1 };
    const all = mergeCandidates(rice, []);
    expect(all).toHaveLength(3);
    expect(shown(purchases, undefined, all)).toEqual(['Arroz Tio João 5kg <- Arroz', 'Limão <- Limões']);
    // "São diferentes" no primeiro: o outro par do "Arroz" entra.
    const rest = mergeCandidates(rice, [orderedPair('p00', 'p01')]);
    expect(shown(purchases, undefined, rest)).toEqual(['Arroz Tio João 1kg <- Arroz', 'Limão <- Limões']);
    // Na tela do "Arroz", um par de cada vez.
    expect(shown(purchases, { productId: 'p00' }, all)).toEqual(['Arroz Tio João 5kg <- Arroz']);
  });

  it('na tela do produto, só os pares dele; no empate fica o produto aberto', () => {
    expect(shown({}, { productId: limoes.id })).toEqual(['Limões <- Limão']);
    expect(shown({}, { productId: limao.id })).toEqual(['Limão <- Limões']);
    expect(shown({ [limao.id]: 3 }, { productId: limoes.id })).toEqual(['Limão <- Limões']);
    expect(shown({}, { productId: 'p99' })).toEqual([]);
  });
});

describe('similarProducts', () => {
  it('os de nome mais parecido primeiro, sem o próprio produto', () => {
    const list = products('Arroz 5kg', 'Arroz Tio João 5 kg', 'Arroz Tio João 1kg', 'Arroz', 'Feijão carioca', 'Arroz 5 Kg');
    const found = similarProducts(list[0], list).map((product) => product.name);
    // O mesmo nome com outra grafia, o nome que cabe inteiro neste, o do mesmo tamanho e, por último, o de outro tamanho.
    expect(found).toEqual(['Arroz 5 Kg', 'Arroz', 'Arroz Tio João 5 kg', 'Arroz Tio João 1kg']);
  });

  it('respeita o limite e não acha nada sem parecidos', () => {
    const list = products('Leite', 'Leite integral', 'Leite desnatado', 'Leite em pó', 'Feijão carioca');
    expect(similarProducts(list[0], list, 2)).toHaveLength(2);
    expect(similarProducts(list[4], list)).toEqual([]);
  });
});

describe('productFacts', () => {
  const source = {
    purchases: { arroz: 12 },
    prices: [
      { product_id: 'arroz', store_id: 's1', unit: 'un', unit_price: 27.5, purchased_at: '2026-09-20T12:00:00-03:00' },
      { product_id: 'arroz', store_id: 's2', unit: 'un', unit_price: 25.9, purchased_at: '2026-10-10T12:00:00-03:00' },
      { product_id: 'arroz', store_id: 's1', unit: 'kg', unit_price: 6, purchased_at: '2026-08-01T12:00:00-03:00' },
      { product_id: 'outro', store_id: 's1', unit: 'un', unit_price: 1, purchased_at: '2026-10-12T12:00:00-03:00' },
    ],
    stores: [
      { id: 's1', name: 'Mercado Bom' },
      { id: 's2', name: 'Assaí' },
    ],
    pantry: [{ product_id: 'arroz' }, { product_id: null }],
    listItems: [{ product_id: 'outro' }],
  };

  it('junta o que as telas já carregaram', () => {
    expect(productFacts('arroz', source)).toEqual({
      purchases: 12,
      lastPrice: { unitPrice: 25.9, unit: 'un', store: 'Assaí', on: '2026-10-10' },
      inPantry: true,
      onList: false,
      units: ['un', 'kg'],
    });
  });

  it('produto que o app não conhece de lugar nenhum', () => {
    expect(productFacts('novo', source)).toEqual(noFacts);
  });

  it('mercado apagado: o preço fica sem o nome dele', () => {
    expect(productFacts('arroz', { ...source, stores: [] }).lastPrice?.store).toBeNull();
  });
});

describe('factsLine', () => {
  it('compras, último preço, despensa e lista', () => {
    const facts: ProductFacts = {
      purchases: 12,
      lastPrice: { unitPrice: 25.9, unit: 'un', store: 'Assaí', on: '2026-10-10' },
      inPantry: true,
      onList: true,
      units: ['un'],
    };
    expect(factsLine(facts, 2026)).toBe('12 compras · último preço R$ 25,90 em 10 out (Assaí) · na despensa · na lista');
  });

  it('singular, preço por kg, outro ano e mercado apagado', () => {
    const facts: ProductFacts = { ...noFacts, purchases: 1, lastPrice: { unitPrice: 6.5, unit: 'kg', store: null, on: '2025-12-03' } };
    expect(factsLine(facts, 2026)).toBe('1 compra · último preço R$ 6,50/kg em 3 dez 2025');
  });

  it('sem compra nenhuma', () => {
    expect(factsLine(noFacts, 2026)).toBe('nenhuma compra');
    expect(factsLine({ ...noFacts, onList: true }, 2026)).toBe('nenhuma compra · na lista');
    expect(purchasesLabel(0)).toBe('nenhuma compra');
    expect(purchasesLabel(1)).toBe('1 compra');
    expect(purchasesLabel(2)).toBe('2 compras');
  });
});

describe('mergeWarnings', () => {
  const MIXES = 'Juntar mistura os preços dos dois no histórico.';

  it('tamanhos diferentes nos nomes', () => {
    expect(mergeWarnings(side('Arroz Tio João 5 kg'), side('Arroz Tio João 1kg'))).toEqual([`Parecem tamanhos diferentes (5 kg e 1 kg). ${MIXES}`]);
    expect(mergeWarnings(side('Água 1,5L'), side('Água 500ml'))).toEqual([`Parecem tamanhos diferentes (1,5 L e 500 ml). ${MIXES}`]);
    expect(mergeWarnings(side('Coca-Cola Lata 350ml c/12'), side('Coca-Cola 2L'))).toEqual([`Parecem tamanhos diferentes (12 un + 350 ml e 2 L). ${MIXES}`]);
  });

  it('tamanho lido com dúvida avisa sem afirmar o número', () => {
    expect(mergeWarnings(side('Agua 1 5l'), side('Água 1,5L'))).toEqual([`Os nomes parecem trazer tamanhos diferentes. ${MIXES}`]);
  });

  it('o mesmo tamanho, ou só um dos nomes com tamanho, não avisa', () => {
    expect(mergeWarnings(side('Arroz 5kg'), side('Arroz Tio João 5 Kg'))).toEqual([]);
    expect(mergeWarnings(side('Arroz'), side('Arroz Tio João 5kg'))).toEqual([]);
    expect(mergeWarnings(side('Banana kg'), side('Bananas'))).toEqual([]);
  });

  it('comprados em medidas diferentes: um por peso, o outro por unidade', () => {
    expect(mergeWarnings(side('Banana', { units: ['kg'] }), side('Bananas', { units: ['un'] }))).toEqual([
      `As compras de "Banana" são por peso, e as de "Bananas", por unidade. ${MIXES}`,
    ]);
    expect(mergeWarnings(side('Leite', { units: ['l', 'ml'] }), side('Leite Italac', { units: ['un'] }))).toEqual([
      `As compras de "Leite" são por volume, e as de "Leite Italac", por unidade. ${MIXES}`,
    ]);
  });

  it('a mesma medida em alguma compra, ou um dos dois sem compra, não avisa', () => {
    expect(mergeWarnings(side('Banana', { units: ['kg'] }), side('Bananas', { units: ['g'] }))).toEqual([]);
    expect(mergeWarnings(side('Banana', { units: ['kg', 'un'] }), side('Bananas', { units: ['un'] }))).toEqual([]);
    expect(mergeWarnings(side('Banana', { units: ['kg'] }), side('Bananas'))).toEqual([]);
  });

  it('os dois avisos juntos', () => {
    expect(mergeWarnings(side('Queijo 500g', { units: ['kg'] }), side('Queijo 1kg', { units: ['un'] }))).toHaveLength(2);
  });
});

describe('mergeSummary', () => {
  const keep = 'Arroz Tio João 5 kg';
  const end = `para "${keep}". Não dá para desfazer.`;

  it('compras, despensa e lista', () => {
    expect(mergeSummary(side('Arroz 5kg', { purchases: 12, inPantry: true, onList: true }), keep)).toBe(
      `As 12 compras, o que está na despensa e na lista de "Arroz 5kg" passam ${end}`,
    );
  });

  it('uma compra só e várias, no singular e no plural', () => {
    expect(mergeSummary(side('Arroz 5kg', { purchases: 1 }), keep)).toBe(`A compra de "Arroz 5kg" passa ${end}`);
    expect(mergeSummary(side('Arroz 5kg', { purchases: 2 }), keep)).toBe(`As 2 compras de "Arroz 5kg" passam ${end}`);
  });

  it('compras com um lugar só', () => {
    expect(mergeSummary(side('Arroz 5kg', { purchases: 1, inPantry: true }), keep)).toBe(`A compra e o que está na despensa de "Arroz 5kg" passam ${end}`);
    expect(mergeSummary(side('Arroz 5kg', { purchases: 3, onList: true }), keep)).toBe(`As 3 compras e o que está na lista de "Arroz 5kg" passam ${end}`);
  });

  it('sem compras', () => {
    expect(mergeSummary(side('Arroz 5kg', { inPantry: true }), keep)).toBe(`O que está na despensa de "Arroz 5kg" passa ${end}`);
    expect(mergeSummary(side('Arroz 5kg', { onList: true }), keep)).toBe(`O que está na lista de "Arroz 5kg" passa ${end}`);
    expect(mergeSummary(side('Arroz 5kg', { inPantry: true, onList: true }), keep)).toBe(`O que está na despensa e na lista de "Arroz 5kg" passa ${end}`);
  });

  it('produto sem nada: só deixa de existir', () => {
    expect(mergeSummary(side('Arroz 5kg'), keep)).toBe(`"Arroz 5kg" deixa de existir e fica só "${keep}". Não dá para desfazer.`);
  });
});

describe('mergeResult', () => {
  const done = '"Arroz 5kg" passou a ser "Arroz Tio João 5 kg".';
  const result = (purchases: number, pantry: number, list: number) => mergeResult('Arroz 5kg', 'Arroz Tio João 5 kg', { purchases, pantry, list });

  it('diz o que passou, no singular e no plural', () => {
    expect(result(12, 1, 2)).toBe(`${done} Foram junto 12 compras, 1 item da despensa e 2 itens da lista.`);
    expect(result(1, 0, 0)).toBe(`${done} Foi junto 1 compra.`);
    expect(result(0, 1, 0)).toBe(`${done} Foi junto 1 item da despensa.`);
    expect(result(0, 0, 1)).toBe(`${done} Foi junto 1 item da lista.`);
    expect(result(1, 1, 0)).toBe(`${done} Foram junto 1 compra e 1 item da despensa.`);
    expect(result(2, 0, 3)).toBe(`${done} Foram junto 2 compras e 3 itens da lista.`);
    expect(result(0, 2, 0)).toBe(`${done} Foram junto 2 itens da despensa.`);
  });

  it('sem nada para passar, só o que aconteceu', () => {
    expect(result(0, 0, 0)).toBe(done);
  });
});

describe('orderedPair', () => {
  it('o id menor primeiro, como o banco guarda', () => {
    const [low, high] = ['0a1f6c1e-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000000'];
    expect(orderedPair(high, low)).toEqual({ product_a: low, product_b: high });
    expect(orderedPair(low, high)).toEqual({ product_a: low, product_b: high });
  });
});

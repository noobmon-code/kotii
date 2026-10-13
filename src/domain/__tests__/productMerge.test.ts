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
import {
  indexNames,
  kindWords,
  nameCandidates,
  nameSizes,
  sameProductPairs,
  sameSizes,
  saysAnotherKind,
  sizeLabel,
  suggestedName,
  type ProductName,
} from '../similarNames';

/** Produtos com o id pelo lugar na lista ("p00", "p01"...): a ordem dos ids é a dos nomes dados. */
const products = (...names: string[]): ProductName[] =>
  names.map((name, at) => ({ id: `p${String(at).padStart(2, '0')}`, name, category: 'outros' }));

/** Os pares como nomes, cada par e a lista em ordem, para comparar sem depender de quem veio primeiro. */
function pairNames(list: readonly ProductName[], common: readonly { name: string; category: string }[] = COMMON_ITEMS): string[] {
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

describe('sameSizes: a mesma quantidade, em qualquer unidade', () => {
  it('compara a quantidade, não o texto', () => {
    expect(sameSizes(['5kg'], ['5kg'])).toBe(true);
    expect(sameSizes(['1kg'], ['1000g'])).toBe(true);
    expect(sameSizes(['500g'], ['0p5kg'])).toBe(true);
    expect(sameSizes(['1l'], ['1000ml'])).toBe(true);
    expect(sameSizes(['1p5l'], ['1500ml'])).toBe(true);
    expect(sameSizes(['12un', '350ml'], ['0p35l', '12un'])).toBe(true);
  });

  it('quantidade diferente, outra grandeza ou outro número de tamanhos não é o mesmo', () => {
    expect(sameSizes(['5kg'], ['1kg'])).toBe(false);
    expect(sameSizes(['1kg'], ['1l'])).toBe(false);
    expect(sameSizes(['1kg'], ['1un'])).toBe(false);
    expect(sameSizes(['350ml'], ['12un', '350ml'])).toBe(false);
    expect(sameSizes(['350ml', '350ml'], ['350ml', '2l'])).toBe(false);
    // Unidade que o app não converte só é igual a ela mesma.
    expect(sameSizes(['5kg'], ['5k'])).toBe(false);
    expect(sameSizes(['500mg'], ['500mg'])).toBe(true);
    expect(sameSizes(['500mg'], ['0p5g'])).toBe(false);
  });
});

describe('saysAnotherKind: as palavras a mais dizem outro tipo de produto', () => {
  const KINDS = kindWords(COMMON_ITEMS);

  // Como na chave dos nomes: sem acento e no singular ("france" é o "francês" de "Pão francês").
  it.each(['integral', 'desnatado', 'lactose', 'gas', 'france', 'mascavo', 'prato', 'preto', 'dental', 'liquido', 'moida', 'condensado', 'doce'])(
    'palavra de um nome do catálogo: %s',
    (word) => {
      expect(saysAnotherKind([word], KINDS)).toBe(true);
      // Vem do catálogo, não de uma lista escrita à mão.
      expect(saysAnotherKind([word], new Set())).toBe(false);
    },
  );

  it('"sem" muda o item, com a palavra que vier', () => {
    expect(saysAnotherKind(['sem-sal'], KINDS)).toBe(true);
    expect(saysAnotherKind(['sem-alcool'], KINDS)).toBe(true);
    expect(saysAnotherKind(['sem-gluten'], new Set())).toBe(true);
    expect(saysAnotherKind(['sem'], new Set())).toBe(true);
  });

  it.each(['zero', 'light', 'diet', 'lite'])('versão que o catálogo não tem: %s', (word) => {
    expect(saysAnotherKind([word], new Set())).toBe(true);
    // A lista fechada não repete o catálogo.
    expect(KINDS.has(word)).toBe(false);
  });

  it.each(['pp', 'p', 'm', 'g', 'gg', 'xg', 'xxg', 'eg'])('tamanho de roupa ou de fralda sozinho: %s', (word) => {
    expect(saysAnotherKind(['pampers', word], new Set())).toBe(true);
  });

  it('marca não diz outro tipo, nem embalagem, mesmo a que está no catálogo', () => {
    expect(saysAnotherKind([], KINDS)).toBe(false);
    expect(saysAnotherKind(['tio', 'joao'], KINDS)).toBe(false);
    expect(saysAnotherKind(['camil'], KINDS)).toBe(false);
    expect(saysAnotherKind(['italac'], KINDS)).toBe(false);
    expect(saysAnotherKind(['ype'], KINDS)).toBe(false);
    expect(saysAnotherKind(['siciliano'], KINDS)).toBe(false);
    // "Sardinha em lata" e "Suco de caixinha" são do catálogo; lata e caixinha continuam sendo embalagem.
    expect(KINDS.has('lata') && KINDS.has('caixinha')).toBe(true);
    expect(saysAnotherKind(['lata', 'caixinha', 'pet', 'garrafa', 'caixa'], KINDS)).toBe(false);
  });

  it('basta uma palavra', () => {
    expect(saysAnotherKind(['italac', 'integral'], KINDS)).toBe(true);
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
    expect(pairNames(products('Arroz Tio João', 'Arroz'))).toEqual(['Arroz = Arroz Tio João (parecido)']);
    expect(pairNames(products('Leite Italac 1L', 'Leite'))).toEqual(['Leite = Leite Italac 1L (parecido)']);
    expect(pairNames(products('Detergente Ypê 500ml', 'Deterg Ype 500ml'))).toEqual(['Deterg Ype 500ml = Detergente Ypê 500ml (parecido)']);
    // O produto com tamanho escrito com o tipo na frente e a embalagem.
    expect(pairNames(products('Coca-Cola 2L', 'Refrigerante Coca-Cola 2l Pet'))).toEqual(['Coca-Cola 2L = Refrigerante Coca-Cola 2l Pet (parecido)']);
    expect(pairNames(products('Coca-Cola 350ml', 'Coca-Cola Lata 350ml'))).toEqual(['Coca-Cola 350ml = Coca-Cola Lata 350ml (parecido)']);
  });

  it('cada produto faz par com o nome mais completo que cabe nele, não com todos', () => {
    expect(pairNames(products('Arroz', 'Arroz Tio João', 'Arroz Tio João Tipo 1'))).toEqual([
      'Arroz = Arroz Tio João (parecido)',
      'Arroz Tio João = Arroz Tio João Tipo 1 (parecido)',
    ]);
    // "Integral" é outro tipo para o "Leite", não para o "Leite integral".
    expect(pairNames(products('Leite', 'Leite integral', 'Leite Integral Italac 1L'))).toEqual(['Leite Integral Italac 1L = Leite integral (parecido)']);
  });

  // O nome mais curto, sem tamanho, cabe no começo do outro, mas o que o outro tem a mais diz outro tipo de produto.
  it.each([
    ['Leite', 'Leite integral'],
    ['Leite', 'Leite desnatado'],
    ['Leite', 'Leite sem lactose'],
    ['Arroz', 'Arroz integral'],
    ['Coca-Cola', 'Coca-Cola Zero'],
    ['Manteiga', 'Manteiga sem sal'],
    ['Cerveja', 'Cerveja sem álcool'],
    ['Água', 'Água com gás'],
    ['Água', 'Água sem gás'],
    ['Pão', 'Pão francês'],
    ['Pão', 'Pão integral'],
    ['Açúcar', 'Açúcar mascavo'],
    ['Queijo', 'Queijo prato'],
    ['Feijão', 'Feijão preto'],
    ['Iogurte', 'Iogurte light'],
    ['Creme', 'Creme dental'],
    ['Sabonete', 'Sabonete líquido'],
    ['Carne', 'Carne moída'],
    ['Fralda Pampers', 'Fralda Pampers G'],
    // Com a marca junto, continua sendo outro tipo.
    ['Leite', 'Leite Integral Italac 1L'],
    ['Refrigerante', 'Refrigerante Coca-Cola Zero 2L'],
    ['Fralda Pampers', 'Fralda Pampers Confort Sec XG'],
  ])('nunca: o que o nome tem a mais diz outro tipo de produto (%s e %s)', (generic, kind) => {
    expect(pairNames(products(generic, kind))).toEqual([]);
    expect(pairNames(products(kind, generic))).toEqual([]);
  });

  // A palavra de versão que vem com o número ("Tipo 1") diz a versão: não vira outro tipo nem se um item do
  // catálogo passar a tê-la no nome.
  it('palavra de versão com o número não é outro tipo, mesmo estando num nome do catálogo', () => {
    const common = [...COMMON_ITEMS, { name: 'Farinha tipo 1', category: 'graos' }];
    expect(kindWords(common).has('tipo')).toBe(true);
    expect(pairNames(products('Arroz Tio João', 'Arroz Tio João Tipo 1'), common)).toEqual(['Arroz Tio João = Arroz Tio João Tipo 1 (parecido)']);
    expect(pairNames(products('Arroz Tio João 5kg', 'Arroz Tio João Tipo 1 5kg'), common)).toEqual(['Arroz Tio João 5kg = Arroz Tio João Tipo 1 5kg (parecido)']);
  });

  it('variedade que não dá para separar de marca continua sugerida: custa um "São diferentes"', () => {
    expect(pairNames(products('Limão', 'Limão siciliano'))).toEqual(['Limão = Limão siciliano (parecido)']);
  });

  it('os dois nomes com o mesmo tamanho: a marca dentro ou fora', () => {
    expect(pairNames(products('Arroz 5kg', 'Arroz Tio João 5 kg'))).toEqual(['Arroz 5kg = Arroz Tio João 5 kg (parecido)']);
    // A mesma quantidade em outra unidade.
    expect(pairNames(products('Arroz Tio João 1000g', 'Arroz 1kg'))).toEqual(['Arroz 1kg = Arroz Tio João 1000g (parecido)']);
    expect(pairNames(products('Leite 1L', 'Leite 1000ml'))).toEqual(['Leite 1000ml = Leite 1L (parecido)']);
    // O nome cortado como na nota fiscal.
    expect(pairNames(products('Detergente 500ml', 'Deterg Ype 500ml'))).toEqual(['Deterg Ype 500ml = Detergente 500ml (parecido)']);
  });

  it('o par do mesmo tamanho vem junto com o do nome sem tamanho', () => {
    expect(pairNames(products('Arroz', 'Arroz 5kg', 'Arroz Tio João 5 kg'))).toEqual([
      'Arroz 5kg = Arroz Tio João 5 kg (parecido)',
      'Arroz = Arroz 5kg (parecido)',
      'Arroz = Arroz Tio João 5 kg (parecido)',
    ]);
  });

  it.each([
    // Outro tipo.
    ['Coca-Cola 2L', 'Coca-Cola Zero 2L'],
    ['Leite 1L', 'Leite Integral 1L'],
    ['Fralda Pampers 20un', 'Fralda Pampers G 20un'],
    ['Leite 1L', 'Leite de coco 1L'],
    ['Batata 1kg', 'Batata palha 1kg'],
    // Outra coisa que o catálogo não tem: "de" com outra palavra, e as que fazem outra coisa mesmo sem "de".
    ['Leite 1L', 'Leite de cabra 1L'],
    ['Água 500ml', 'Água tônica 500ml'],
    ['Óleo 1L', 'Óleo motor 1L'],
    // A versão escrita antes do nome do produto.
    ['Coca-Cola 2L', 'Refrigerante Zero Coca-Cola 2L'],
    // As palavras de um não são o começo das do outro.
    ['Leite Italac 1L', 'Leite Integral Italac 1L'],
    ['Arroz Tio João 5kg', 'Arroz Camil 5kg'],
    // Outra quantidade.
    ['Arroz 5kg', 'Arroz Tio João 1kg'],
    ['Arroz 1kg', 'Arroz Tio João 1L'],
    ['Coca-Cola 350ml', 'Coca-Cola Lata 350ml c/12'],
    // Outra versão.
    ['Vitamina C 500mg', 'Vitamina D 500mg'],
    ['Feijão Tipo 1 1kg', 'Feijão Tipo 2 1kg'],
    // Tamanho lido com dúvida.
    ['Água 5L', 'Agua Crystal 1 5l'],
  ])('nunca: os dois nomes com tamanho (%s e %s)', (shorter, longer) => {
    expect(pairNames(products(shorter, longer))).toEqual([]);
    expect(pairNames(products(longer, shorter))).toEqual([]);
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

  // A base é a sugestão do item da nota: para cada produto sem outro de mesmo nome, o par que `suggestedName`
  // daria se o nome chegasse agora numa nota, com os outros produtos e o catálogo. As sugestões de juntar são
  // isso, menos os pares em que o nome mais comprido diz outro tipo de produto, mais os do mesmo tamanho com a
  // marca dentro ou fora. O resto tem de bater par a par, inclusive o nome com hífen ("Banana-prata") e a marca
  // cortada ("Biscoito Passat"), que só batem se o produto conferido não contar como nome que a casa já conhecia.
  it('é a sugestão do item da nota, menos os pares de outro tipo e mais os do mesmo tamanho', () => {
    const list = products(
      'Arroz 5kg', 'Arroz Tio João 5 kg', 'Arroz', 'Arroz Tio João', 'Arroz integral', 'Arroz Tio João 1kg',
      'Leite', 'Leite de coco', 'Leite Integral Italac 1L', 'Leite condensado', 'Leite cond moca',
      'Coca-Cola 2L', 'Coca-Cola Zero 2L', 'Refrigerante Coca-Cola 2l Pet', 'Coca-Cola Lata 350ml', 'Coca-Cola 350ml',
      'Pão', 'Pão de queijo', 'Detergente Ypê 500ml', 'Deterg Ype 500ml', 'Açúcar', 'Acucar Uniao 1kg',
      'Batata', 'Batata-doce', 'Batata palha', 'Ovos c/12', 'Ovos 30un', 'Vitamina C', 'Vitamina D',
      'Água 1,5L', 'Agua 1 5l', 'Água 5L', 'Manteiga sem sal', 'Manteiga com sal', 'Manteiga', 'Sardinha Molho de Tomate', 'Molho de tomate',
      'Banana', 'Banana-prata', 'Guaraná', 'Guaraná-Antarctica 2L', 'Couve', 'Couve-flor',
      'Biscoito Passatempo', 'Biscoito Passat', 'Sabonete Palmolive', 'Sabonete Palmol', 'Café Pilão 500g', 'Café 0,5kg',
    );
    const review = [
      ...new Set(
        list.flatMap((product) => {
          const others = list.filter((other) => other.id !== product.id);
          const found = suggestedName(product.name, indexNames(nameCandidates({ products: others, listItems: [], purchases: [], common: COMMON_ITEMS })), {
            category: product.category,
          });
          return found?.productId ? [[product.name, found.name].sort().join(' = ')] : [];
        }),
      ),
    ];
    // A nota sugeriria; aqui não: "integral", "sal" (do catálogo) e "sem sal" dizem outro tipo.
    const otherKind = ['Arroz = Arroz integral', 'Leite = Leite Integral Italac 1L', 'Manteiga = Manteiga com sal', 'Manteiga = Manteiga sem sal'];
    // A nota não sugere; aqui sim: o mesmo tamanho nos dois nomes, com a marca dentro ou fora.
    const sameSize = ['Arroz 5kg = Arroz Tio João 5 kg', 'Café 0,5kg = Café Pilão 500g'];
    for (const pair of otherKind) expect(review).toContain(pair);
    for (const pair of sameSize) expect(review).not.toContain(pair);
    expect(review).toEqual(expect.arrayContaining(['Banana = Banana-prata', 'Guaraná = Guaraná-Antarctica 2L', 'Biscoito Passat = Biscoito Passatempo']));
    expect(review).not.toContain('Couve = Couve-flor');
    expect(pairNames(list).map((pair) => pair.replace(/ \(\w+\)$/, ''))).toEqual([...review.filter((pair) => !otherKind.includes(pair)), ...sameSize].sort());
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

  it('a mesma quantidade em outra unidade é o mesmo tamanho', () => {
    expect(differentSizes('Leite 1L', 'Leite 1000ml')).toBe(false);
    expect(differentSizes('Café Pilão 500g', 'Café Pilão 0,5kg')).toBe(false);
    expect(differentSizes('Arroz 1kg', 'Arroz 1000 g')).toBe(false);
    expect(differentSizes('Arroz 1kg', 'Arroz 100 g')).toBe(true);
    // "k" não é unidade que o app saiba converter: fica como tamanho diferente.
    expect(differentSizes('Sabão 5 kg', 'Sabão 5k')).toBe(true);
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

  // "São diferentes" foi dito para "Limão siciliano" e "Limão"; depois uma nota criou "Limao", o mesmo nome do
  // "Limão". Sem valer para o nome, a pergunta voltava com o "Limao" quando ele vinha antes na lista.
  it('"São diferentes" vale para os outros produtos com o mesmo nome, venham antes ou depois na lista', () => {
    const marked = (list: ProductName[]) => {
      const id = (name: string) => list.find((product) => product.name === name)!.id;
      return names(mergeCandidates(list, [orderedPair(id('Limão'), id('Limão siciliano'))]));
    };
    expect(marked(products('Limao', 'Limão', 'Limão siciliano'))).toEqual(['Limao = Limão']);
    expect(marked(products('Limão', 'Limão siciliano', 'Limao'))).toEqual(['Limao = Limão']);
    expect(marked(products('Limão siciliano', 'Limões', 'Limão', 'limao kg'))).toEqual(['Limão = Limões', 'Limão = limao kg', 'Limões = limao kg']);
    // Sem a resposta, o "Limão siciliano" faz par com um dos dois.
    expect(names(mergeCandidates(products('Limao', 'Limão', 'Limão siciliano'), []))).toEqual(['Limao = Limão', 'Limao = Limão siciliano']);
  });

  it('"São diferentes" entre dois com o mesmo nome só tira esse par', () => {
    const list = products('Limão', 'Limões', 'Limao');
    expect(names(mergeCandidates(list, [orderedPair('p00', 'p01')]))).toEqual(['Limao = Limão', 'Limao = Limões']);
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
    // "Limão" e "Limões" empatam nas compras e na grafia: fica o nome mais comprido.
    expect(shown(purchases)).toEqual(['Arroz Tio João 5kg <- Arroz', 'Banana <- Bananas', 'Limões <- Limão']);
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
    expect(shown({})).toEqual(['Açúcar <- acucar', 'Arroz Tio João 5kg <- Arroz', 'Bananas <- Banana']);
  });

  // Em Preços ninguém abriu produto nenhum. Antes ficava o primeiro do par, que num par `parecido` é o nome
  // conferido: o cortado da nota fiscal.
  it('em Preços, no empate de compras fica o nome mais bem escrito; depois o mais comprido; depois a ordem em que vieram', () => {
    const kept = (purchases: Record<string, number>, ...names: string[]) => shown(purchases, undefined, mergeCandidates(products(...names), []));
    const ties: Record<string, number>[] = [{}, { p00: 1, p01: 1 }, { p00: 3, p01: 3 }];
    for (const purchases of ties) {
      expect(kept(purchases, 'Detergente Ypê 500ml', 'Deterg Ype 500ml')).toEqual(['Detergente Ypê 500ml <- Deterg Ype 500ml']);
      expect(kept(purchases, 'Deterg Ype 500ml', 'Detergente Ypê 500ml')).toEqual(['Detergente Ypê 500ml <- Deterg Ype 500ml']);
      expect(kept(purchases, 'Cafe Pilao 500 g', 'Café Pilão 500g')).toEqual(['Café Pilão 500g <- Cafe Pilao 500 g']);
      expect(kept(purchases, 'Café Pilão 500g', 'Cafe Pilao 500 g')).toEqual(['Café Pilão 500g <- Cafe Pilao 500 g']);
      expect(kept(purchases, 'ARROZ 5KG', 'Arroz 5 kg')).toEqual(['Arroz 5 kg <- ARROZ 5KG']);
      // A mesma grafia (sem acento, só a inicial maiúscula): o mais comprido.
      expect(kept(purchases, 'Bisc Passatempo', 'Biscoito Passatempo')).toEqual(['Biscoito Passatempo <- Bisc Passatempo']);
      expect(kept(purchases, 'Biscoito Passatempo', 'Bisc Passatempo')).toEqual(['Biscoito Passatempo <- Bisc Passatempo']);
      expect(kept(purchases, 'Arroz', 'Arroz Tio João 5kg')).toEqual(['Arroz Tio João 5kg <- Arroz']);
      // Nada separa os dois: o primeiro do par.
      expect(kept(purchases, 'Feijao preto', 'Preto feijao')).toEqual(['Feijao preto <- Preto feijao']);
      expect(kept(purchases, 'Preto feijao', 'Feijao preto')).toEqual(['Preto feijao <- Feijao preto']);
    }
    // Com mais compras, fica o de mais compras, por pior que seja o nome.
    expect(kept({ p00: 2, p01: 1 }, 'Deterg Ype 500ml', 'Detergente Ypê 500ml')).toEqual(['Deterg Ype 500ml <- Detergente Ypê 500ml']);
  });

  it('na tela do produto, no empate fica o aberto, mesmo com o outro nome mais bem escrito', () => {
    const list = products('Deterg Ype 500ml', 'Detergente Ypê 500ml');
    const pairs = mergeCandidates(list, []);
    expect(shown({}, { productId: 'p00' }, pairs)).toEqual(['Deterg Ype 500ml <- Detergente Ypê 500ml']);
    expect(shown({}, { productId: 'p01' }, pairs)).toEqual(['Detergente Ypê 500ml <- Deterg Ype 500ml']);
  });

  it('cada produto aparece num par só de cada vez: resolvido um, vem o outro', () => {
    const rice = products('Arroz', 'Arroz Tio João 5kg', 'Arroz Tio João 1kg', 'Limão', 'Limões');
    const purchases = { p00: 1, p01: 12, p02: 3, p03: 1, p04: 1 };
    const all = mergeCandidates(rice, []);
    expect(all).toHaveLength(3);
    expect(shown(purchases, undefined, all)).toEqual(['Arroz Tio João 5kg <- Arroz', 'Limões <- Limão']);
    // "São diferentes" no primeiro: o outro par do "Arroz" entra.
    const rest = mergeCandidates(rice, [orderedPair('p00', 'p01')]);
    expect(shown(purchases, undefined, rest)).toEqual(['Arroz Tio João 1kg <- Arroz', 'Limões <- Limão']);
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

  // "Agua 1 5l" pode ser 1,5 L ou 5 L: o app não afirma número nem que são diferentes, só pede para conferir.
  it('tamanho lido com dúvida: pede para conferir, tenha o outro nome o número que tiver', () => {
    const check = `Confira se são do mesmo tamanho. ${MIXES}`;
    expect(mergeWarnings(side('Agua 1 5l'), side('Água 1,5L'))).toEqual([check]);
    // Lidos, os dois dão "5 L": antes passava sem aviso.
    expect(mergeWarnings(side('Agua 1 5l'), side('Água 5L'))).toEqual([check]);
    expect(mergeWarnings(side('Água 5L'), side('Agua 1 5l'))).toEqual([check]);
    expect(mergeWarnings(side('Agua Crystal 1 5l'), side('Agua 2 5l'))).toEqual([check]);
  });

  it('tamanho lido com dúvida não avisa com um nome só com tamanho, nem no mesmo nome com outra grafia', () => {
    expect(mergeWarnings(side('Agua 1 5l'), side('Água'))).toEqual([]);
    expect(mergeWarnings(side('Agua 1 5l'), side('ÁGUA 1 5L'))).toEqual([]);
  });

  it('o mesmo tamanho, ou só um dos nomes com tamanho, não avisa', () => {
    expect(mergeWarnings(side('Arroz 5kg'), side('Arroz Tio João 5 Kg'))).toEqual([]);
    expect(mergeWarnings(side('Arroz'), side('Arroz Tio João 5kg'))).toEqual([]);
    expect(mergeWarnings(side('Banana kg'), side('Bananas'))).toEqual([]);
  });

  it('a mesma quantidade em outra unidade não avisa', () => {
    expect(mergeWarnings(side('Leite 1L'), side('Leite 1000ml'))).toEqual([]);
    expect(mergeWarnings(side('Café Pilão 500g'), side('Café Pilão 0,5kg'))).toEqual([]);
    expect(mergeWarnings(side('Arroz 1kg'), side('Arroz 1000 g'))).toEqual([]);
    expect(mergeWarnings(side('Arroz 1kg'), side('Arroz 100 g'))).toEqual([`Parecem tamanhos diferentes (1 kg e 100 g). ${MIXES}`]);
  });

  // O preço é o sujeito: a frase não depende de quantas compras cada um tem nem adivinha o gênero do nome.
  it('comprados em medidas diferentes: um por peso, o outro por unidade', () => {
    expect(mergeWarnings(side('Banana', { units: ['kg'], purchases: 6 }), side('Bananas', { units: ['un'], purchases: 1 }))).toEqual([
      `O preço de "Banana" é por peso, e o de "Bananas", por unidade. ${MIXES}`,
    ]);
    expect(mergeWarnings(side('Leite', { units: ['l', 'ml'] }), side('Leite Italac', { units: ['un'] }))).toEqual([
      `O preço de "Leite" é por volume, e o de "Leite Italac", por unidade. ${MIXES}`,
    ]);
    // Um dos dois com duas medidas.
    expect(mergeWarnings(side('Queijo', { units: ['kg', 'un'] }), side('Queijo líquido', { units: ['ml'] }))).toEqual([
      `O preço de "Queijo" é por peso e por unidade, e o de "Queijo líquido", por volume. ${MIXES}`,
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

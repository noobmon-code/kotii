import { describe, expect, it } from '@jest/globals';

import { COMMON_ITEMS } from '../commonItems';
import {
  indexNames,
  nameCandidates,
  nameSourceLabel,
  similarNameHint,
  similarNameKey,
  similarNames,
  suggestedName,
  type NameCandidate,
} from '../similarNames';

const candidate = (
  name: string,
  source: NameCandidate['source'] = 'comum',
  extra: Partial<NameCandidate> = {},
): NameCandidate => ({ name, category: 'outros', productId: null, source, listItemIds: [], ...extra });

const product = (name: string, id: string, category = 'outros') => candidate(name, 'produto', { productId: id, category });
const listed = (name: string, id: string) => candidate(name, 'lista', { listItemIds: [id] });

const names = (list: { name: string }[]) => list.map((item) => item.name);

describe('similarNameKey', () => {
  it('é a mesma para acento, maiúscula, pontuação, plural e ordem das palavras', () => {
    const key = similarNameKey('Feijão Preto');
    expect(similarNameKey('feijao  preto')).toBe(key);
    expect(similarNameKey('Preto, feijões')).toBe(key);
    expect(similarNameKey('FEIJÃO DE PRETO')).toBe(key);
    expect(similarNameKey('Feijão carioca')).not.toBe(key);
  });

  it('conhece os plurais do português', () => {
    expect(similarNameKey('Limões')).toBe(similarNameKey('Limão'));
    expect(similarNameKey('Pães')).toBe(similarNameKey('Pão'));
    expect(similarNameKey('Papéis')).toBe(similarNameKey('Papel'));
    expect(similarNameKey('Atuns')).toBe(similarNameKey('Atum'));
    expect(similarNameKey('Colheres')).toBe(similarNameKey('Colher'));
    expect(similarNameKey('Ovos')).toBe(similarNameKey('Ovo'));
    // "Sals" é abreviação de salsicha, não plural de sal.
    expect(similarNameKey('Sals')).not.toBe(similarNameKey('Sal'));
  });

  it('tamanho diferente é outro nome; o mesmo tamanho escrito de outro jeito, não', () => {
    expect(similarNameKey('Coca-Cola 2L')).not.toBe(similarNameKey('Coca-Cola 350ml'));
    expect(similarNameKey('Coca Cola 2 L')).toBe(similarNameKey('Coca-Cola 2L'));
    expect(similarNameKey('Coca 1,5 L')).toBe(similarNameKey('Coca 1,5l'));
    expect(similarNameKey('Ovos 30un')).toBe(similarNameKey('Ovos (30 un)'));
    expect(similarNameKey('Ovos c/12')).toBe(similarNameKey('Ovos (dúzia)'));
    expect(similarNameKey('Arroz 5 Kg')).toBe(similarNameKey('Arroz 5kg'));
    // Unidade solta não é tamanho.
    expect(similarNameKey('Banana Prata Kg')).toBe(similarNameKey('Banana prata'));
  });

  it('"sem" muda o item: com sal e sem sal são nomes diferentes', () => {
    expect(similarNameKey('Manteiga sem sal')).not.toBe(similarNameKey('Manteiga com sal'));
    expect(similarNameKey('Água sem gás')).not.toBe(similarNameKey('Água com gás'));
    expect(similarNameKey('Agua s/gas')).toBe(similarNameKey('Água sem gás'));
    expect(similarNameKey('Manteiga c/ sal')).toBe(similarNameKey('Manteiga com sal'));
    expect(similarNameKey('Uva sem semente')).not.toBe(similarNameKey('Uva com semente'));
  });

  it('a letra que distingue a versão conta', () => {
    expect(similarNameKey('Vitamina A')).not.toBe(similarNameKey('Vitamina E'));
    expect(similarNameKey('Vitamina C')).not.toBe(similarNameKey('Vitamina D'));
    expect(similarNameKey('Vitamina C')).not.toBe(similarNameKey('Vitamina'));
    expect(similarNameKey('Fralda Pampers G')).not.toBe(similarNameKey('Fralda Pampers M'));
    // No meio do nome, "e" só liga as palavras.
    expect(similarNameKey('Arroz e feijão')).toBe(similarNameKey('Feijão, arroz'));
  });

  it('nome sem letra nem número não tem chave', () => {
    expect(similarNameKey('  ')).toBe('');
    expect(similarNameKey('---')).toBe('');
  });
});

describe('similarNames', () => {
  it('o mesmo nome com outra grafia é igual, e traz o produto', () => {
    const index = indexNames([product('Banana', 'p-banana', 'hortifruti')]);
    expect(similarNames('Bananas', index)).toEqual([
      {
        name: 'Banana',
        category: 'hortifruti',
        productId: 'p-banana',
        source: 'produto',
        listItemIds: [],
        key: similarNameKey('banana'),
        closeness: 'igual',
        confident: true,
      },
    ]);
    // Digitado exatamente como o produto: é ele.
    expect(similarNames('Banana', index)[0]).toMatchObject({ productId: 'p-banana', closeness: 'igual' });
  });

  it('nome idêntico que não traz produto não é sugestão', () => {
    const index = indexNames([candidate('Arroz')]);
    expect(similarNames('Arroz', index)).toEqual([]);
    expect(similarNames('arroz', index)).toEqual([]);
    // Outra grafia: vale mostrar a da casa.
    expect(names(similarNames('Arrozes', index))).toEqual(['Arroz']);
    // Idêntico ao item de uma lista aberta: a revisão já mostra esse item em "Lista de compras".
    expect(similarNames('Arroz', indexNames([listed('Arroz', 'li-1')]))).toEqual([]);
    // Outra grafia do item da lista: a sugestão leva o item junto.
    expect(similarNames('Arrozes', indexNames([listed('Arroz', 'li-1')]))[0]).toMatchObject({
      name: 'Arroz',
      closeness: 'igual',
      listItemIds: ['li-1'],
    });
  });

  it('o nome da casa que cabe no começo do nome da nota é parecido e dá para sugerir', () => {
    const index = indexNames([candidate('Arroz'), candidate('Arroz integral'), candidate('Feijão carioca')]);
    const found = similarNames('Arroz Tio João 5kg', index);
    expect(names(found)).toEqual(['Arroz']);
    expect(found[0]).toMatchObject({ closeness: 'parecido', confident: true });
  });

  it('com e sem não se parecem', () => {
    const index = indexNames([
      product('Manteiga com sal', 'p-com'),
      product('Manteiga sem sal', 'p-sem'),
      candidate('Água com gás'),
      candidate('Água mineral'),
    ]);
    // Os dois produtos continuam separados.
    expect(index.entries.filter((entry) => entry.source === 'produto')).toHaveLength(2);
    expect(similarNames('Manteiga sem Sal Aviação 200g', index).map((s) => s.productId)).toEqual(['p-sem']);
    expect(similarNames('Manteiga sem sal', index, { onlySame: true })[0]).toMatchObject({ productId: 'p-sem' });
    expect(names(similarNames('Água Mineral sem Gás Crystal 500ml', index))).toEqual(['Água mineral']);
    expect(names(similarNames('Agua min s/gas crystal 500ml', index, { onlyConfident: true }))).toEqual([]);
    expect(similarNames('Água sem gás', index)).toEqual([]);
  });

  it('tamanho diferente é parecido, mas não para sugerir sozinho; o mesmo tamanho vem primeiro', () => {
    const index = indexNames([product('Coca-Cola 2L', 'p-2l'), product('Coca-Cola 350ml', 'p-lata'), product('Coca-Cola 600ml', 'p-600')]);
    const lata = similarNames('Coca-Cola Lata 350ml', index);
    expect(lata.map((s) => [s.productId, s.confident])).toEqual([
      ['p-lata', true],
      ['p-2l', false],
      ['p-600', false],
    ]);
    expect(similarNames('Coca Cola 350 ml', index)[0]).toMatchObject({ productId: 'p-lata', closeness: 'igual' });
    expect(similarNames('Coca Cola Lt 600 Ml', index, { onlyConfident: true }).map((s) => s.productId)).toEqual(['p-600']);
    // Tamanho que a casa não tem: nenhum serve sem a pessoa escolher.
    expect(similarNames('Coca-Cola 1,5L', index, { onlyConfident: true })).toEqual([]);
    expect(similarNames('Coca-Cola 1,5L', index)).toHaveLength(3);
  });

  it('produto da casa com tamanho é um produto certo: outra versão não é ele', () => {
    const index = indexNames([product('Coca-Cola 2L', 'p-2l'), product('Leite Italac 1L', 'p-leite')]);
    expect(similarNames('Coca-Cola Zero 2L', index)[0]).toMatchObject({ productId: 'p-2l', confident: false });
    expect(similarNames('Leite Italac Desnatado 1L', index, { onlyConfident: true })).toEqual([]);
    // Embalagem não muda o produto.
    expect(similarNames('Coca-Cola Garrafa Pet 2L', index, { onlyConfident: true })[0]).toMatchObject({ productId: 'p-2l' });
    expect(similarNames('Refrigerante Coca-Cola 2l', index, { onlyConfident: true })[0]).toMatchObject({ productId: 'p-2l' });
    expect(similarNames('Refrigerante Coca-Cola Zero 2l', index, { onlyConfident: true })).toEqual([]);
  });

  it('nome da casa com tamanho não serve para nome sem tamanho', () => {
    const index = indexNames([candidate('Ovos (30 un)'), candidate('Ovos (dúzia)'), candidate('Álcool 70%')]);
    expect(names(similarNames('Ovos Brancos 12un', index, { onlyConfident: true }))).toEqual(['Ovos (dúzia)']);
    expect(names(similarNames('Ovos Brancos Grandes c/12', index, { onlyConfident: true }))).toEqual(['Ovos (dúzia)']);
    expect(similarNames('Ovos caipiras', index, { onlyConfident: true })).toEqual([]);
    expect(similarNames('Álcool 46 1l', index, { onlyConfident: true })).toEqual([]);
    expect(names(similarNames('Álcool Líquido 70 1l', index, { onlyConfident: true }))).toEqual(['Álcool 70%']);
  });

  it('a letra da versão precisa bater', () => {
    const index = indexNames([candidate('Vitamina C'), candidate('Vitamina D'), product('Fralda Pampers M', 'p-m')]);
    expect(names(similarNames('Vitamina D 2000UI', index, { onlyConfident: true }))).toEqual(['Vitamina D']);
    expect(similarNames('Vitamina E 400ui', index, { onlyConfident: true })).toEqual([]);
    expect(similarNames('Vitamina B12', index, { onlyConfident: true })).toEqual([]);
    expect(similarNames('Fralda Pampers G 60un', index, { onlyConfident: true })).toEqual([]);
    expect(similarNames('Fralda Pampers M 80un', index, { onlyConfident: true })[0]).toMatchObject({ productId: 'p-m' });
  });

  it('"X de Y" é outra coisa: parecido, mas não para sugerir sozinho', () => {
    const index = indexNames([listed('leite', 'li-leite'), listed('pão', 'li-pao'), listed('sabão', 'li-sabao'), candidate('Pão de queijo congelado')]);
    expect(similarNames('Leite de Coco Sococo 200ml', index)[0]).toMatchObject({ name: 'leite', confident: false });
    expect(similarNames('Leite de Coco Sococo 200ml', index, { onlyConfident: true })).toEqual([]);
    expect(similarNames('Pão de Queijo Forno de Minas 400g', index, { onlyConfident: true })).toEqual([]);
    expect(similarNames('Sabão em Pó Omo 1,6kg', index, { onlyConfident: true })).toEqual([]);
    // Marca ou tipo depois do nome continuam servindo.
    expect(names(similarNames('Leite Integral Italac 1L', index, { onlyConfident: true }))).toEqual(['leite']);
    expect(names(similarNames('Pão Francês Kg', index, { onlyConfident: true }))).toEqual(['pão']);
  });

  it('palavra em comum fora do começo é parecido, mas não para sugerir sozinho', () => {
    const index = indexNames([candidate('Alho'), listed('Coca', 'li-coca'), candidate('Batata chips'), product('Queijo Minas', 'p-minas')]);
    expect(similarNames('Molho de alho', index)[0]).toMatchObject({ name: 'Alho', closeness: 'parecido', confident: false });
    expect(similarNames('Refrigerante Coca-Cola 2L', index)[0]).toMatchObject({ name: 'Coca', confident: false });
    // "Chips" aqui é a marca; as palavras do nome da casa têm de vir em sequência.
    expect(similarNames('Batata Palha Elma Chips 120g', index)[0]).toMatchObject({ name: 'Batata chips', confident: false });
    expect(similarNames('Pão de Queijo Forno de Minas 400g', index).find((s) => s.productId === 'p-minas')).toMatchObject({ confident: false });
  });

  it('produto da casa com a marca na frente serve, e vem antes do item comum', () => {
    const index = indexNames([product('Coca-Cola 2L', 'p-coca'), product('Omo Lavagem Perfeita 1,6kg', 'p-omo'), candidate('Refrigerante'), candidate('Sabão em pó')]);
    expect(similarNames('Refrigerante Coca-Cola 2l', index, { onlyConfident: true }).map((s) => s.name)).toEqual(['Coca-Cola 2L', 'Refrigerante']);
    expect(similarNames('Sabão em Pó Omo Lavagem Perfeita 1,6kg', index, { onlyConfident: true })[0]).toMatchObject({ productId: 'p-omo' });
    // Uma palavra só não basta fora do começo.
    expect(similarNames('Refrigerante Coca-Cola 2l', indexNames([product('Coca', 'p-c')]), { onlyConfident: true })).toEqual([]);
  });

  it('nome mais específico que o digitado é parecido, mas não para sugerir sozinho', () => {
    const index = indexNames([product('Leite integral Italac 1L', 'p-leite')]);
    expect(similarNames('Leite', index)[0]).toMatchObject({ productId: 'p-leite', closeness: 'parecido', confident: false });
  });

  it('entende a abreviação da nota fiscal quando ela tem uma leitura só', () => {
    const index = indexNames([
      candidate('Detergente'),
      candidate('Refrigerante'),
      candidate('Feijão carioca'),
      candidate('Açúcar'),
      candidate('Farinha de trigo'),
      candidate('Salsicha'),
      candidate('Sal'),
      candidate('Azeite'),
      candidate('Azeitona'),
      candidate('Bacon'),
      candidate('Papelão'),
      candidate('Papel toalha'),
      product('Tangerina', 'p-tang'),
    ]);
    const best = (name: string) => similarNames(name, index, { onlyConfident: true, limit: 1 })[0]?.name;
    expect(best('Deterg Ype 500ml')).toBe('Detergente');
    expect(best('Refrig Coca Cola 2l')).toBe('Refrigerante');
    expect(best('Feij Carioca Camil 1kg')).toBe('Feijão carioca');
    expect(best('Acuc Refinado Uniao 1kg')).toBe('Açúcar');
    expect(best('Farin Trigo Dona Benta 1kg')).toBe('Farinha de trigo');
    expect(best('Sals Hot Dog Sadia 500g')).toBe('Salsicha');
    // Duas leituras ("azeite" e "azeitona"): aparece no seletor, não no item.
    expect(best('Azeit Gallo Extra Virgem 500ml')).toBeUndefined();
    expect(names(similarNames('Azeit Gallo Extra Virgem 500ml', index)).sort()).toEqual(['Azeite', 'Azeitona']);
    // Palavra inteira não é abreviação de outra maior.
    expect(similarNames('Baconzitos Elma Chips 55g', index)).toEqual([]);
    expect(names(similarNames('Papel toalha Snob', index))).toEqual(['Papel toalha']);
    // Trecho curto demais para a palavra ("Tang" é uma marca de suco).
    expect(best('Tang Laranja 25g')).toBeUndefined();
  });

  it('nomes de coisas diferentes não se parecem', () => {
    const index = indexNames([candidate('Leite integral'), candidate('Pão de queijo'), candidate('Sabonete')]);
    expect(similarNames('Leite desnatado', index)).toEqual([]);
    expect(similarNames('Queijo prato', index)).toEqual([]);
    expect(similarNames('Sabão em pó', index)).toEqual([]);
  });

  it('nome que já é da casa não ganha sugestão de outro mais genérico', () => {
    const index = indexNames([candidate('Batata'), candidate('Batata-doce'), listed('Leite', 'li-leite'), candidate('Leite condensado')]);
    expect(similarNames('Batata-doce', index, { onlyConfident: true })).toEqual([]);
    expect(similarNames('Leite condensado', index, { onlyConfident: true })).toEqual([]);
    // No seletor, quem está mudando o nome ainda vê os parecidos.
    expect(names(similarNames('Batata-doce', index))).toEqual(['Batata']);
  });

  it('com o mesmo grau de parecença, vale a fonte mais forte e depois a categoria', () => {
    const index = indexNames([
      candidate('Queijo ralado', 'comum', { category: 'laticinios' }),
      candidate('Queijo fresco', 'comprado', { category: 'laticinios' }),
      candidate('Queijo coalho', 'produto', { productId: 'p-coalho', category: 'laticinios' }),
      candidate('Queijo vegano', 'comprado', { category: 'outros' }),
    ]);
    expect(names(similarNames('Queijo', index, { category: 'laticinios' }))).toEqual([
      'Queijo coalho',
      'Queijo fresco',
      'Queijo vegano',
      'Queijo ralado',
    ]);
  });

  it('respeita o limite, o produto já escolhido e o filtro de só iguais', () => {
    const index = indexNames([product('Banana', 'p-banana'), product('Banana prata', 'p-prata'), product('Banana nanica', 'p-nanica')]);
    expect(similarNames('Bananas', index, { limit: 2 })).toHaveLength(2);
    expect(names(similarNames('Bananas', index, { exceptProductId: 'p-banana' }))).toEqual(['Banana prata', 'Banana nanica']);
    expect(names(similarNames('Bananas', index, { onlySame: true }))).toEqual(['Banana']);
    expect(similarNames('Banana da terra', index, { onlySame: true })).toEqual([]);
  });

  it('nome vazio ou só com pontuação não tem parecidos', () => {
    const index = indexNames([candidate('Arroz')]);
    expect(similarNames('', index)).toEqual([]);
    expect(similarNames(' - ', index)).toEqual([]);
  });
});

describe('suggestedName', () => {
  it('sugere no item só o nome que a casa usa de verdade', () => {
    const index = indexNames([product('Banana', 'p-banana'), listed('Arroz', 'li-arroz'), candidate('Feijão carioca'), candidate('Arroz')]);
    expect(suggestedName('Bananas Prata Kg', index)).toMatchObject({ productId: 'p-banana' });
    expect(suggestedName('Arroz Tj 5kg', index)).toMatchObject({ name: 'Arroz', source: 'lista', listItemIds: ['li-arroz'] });
    // Só o catálogo de itens comuns conhece: a casa nunca usou.
    expect(suggestedName('Feijão Carioca Camil 1kg', index)).toBeNull();
    expect(suggestedName('Carregador Usb', index)).toBeNull();
  });

  it('quando o que melhor serve é um item comum, não empurra o nome genérico da casa', () => {
    const index = indexNames([listed('Leite', 'li-leite'), listed('Água', 'li-agua'), candidate('Leite condensado'), candidate('Água sanitária')]);
    expect(suggestedName('Leite Condensado Moça 395g', index)).toBeNull();
    expect(suggestedName('Água Sanitária Qboa 2l', index)).toBeNull();
    expect(suggestedName('Leite Integral Italac 1L', index)).toMatchObject({ name: 'Leite' });
  });

  it('casa sem histórico: nenhuma sugestão no item', () => {
    const index = indexNames(nameCandidates({ products: [], listItems: [], purchases: [], common: COMMON_ITEMS }));
    for (const name of ['Arroz Tio João Tipo 1 5kg', 'Sal de Frutas Eno 100g', 'Batata Palha Elma Chips 120g', 'Couve-flor', 'Bananas']) {
      expect(suggestedName(name, index)).toBeNull();
    }
  });
});

describe('indexNames', () => {
  it('junta a mesma grafia de fontes diferentes, com o nome da mais forte', () => {
    const index = indexNames([
      candidate('arroz', 'lista', { listItemIds: ['li-1'], category: 'outros' }),
      candidate('Arroz', 'comum', { category: 'graos' }),
      candidate('Arroz', 'produto', { productId: 'p-arroz', category: 'graos' }),
      candidate('ARROZ', 'lista', { listItemIds: ['li-2'] }),
    ]);
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0]).toMatchObject({
      name: 'Arroz',
      source: 'produto',
      productId: 'p-arroz',
      category: 'graos',
      listItemIds: ['li-1', 'li-2'],
    });
  });

  it('o produto de uma fonte mais fraca continua valendo', () => {
    const index = indexNames([
      candidate('Leite integral', 'lista', { listItemIds: ['li-1'] }),
      candidate('Leite integral', 'comprado', { productId: 'p-leite' }),
    ]);
    expect(index.entries[0]).toMatchObject({ source: 'lista', productId: 'p-leite', listItemIds: ['li-1'] });
  });

  it('ignora nome vazio', () => {
    expect(indexNames([candidate('  '), candidate('--')]).entries).toEqual([]);
  });
});

describe('nameCandidates', () => {
  it('monta os nomes da casa de todas as fontes; produto apagado deixa só o nome', () => {
    const all = nameCandidates({
      products: [{ id: 'p-1', name: 'Arroz', category: 'graos' }],
      listItems: [
        { id: 'li-1', name: 'Arroz', category: 'graos', product_id: 'p-1' },
        { id: 'li-2', name: 'Coca', category: 'bebidas', product_id: 'p-apagado' },
      ],
      purchases: [{ name: 'Sabão em pó', category: 'limpeza', productId: null }],
      common: [{ name: 'Feijão carioca', category: 'graos' }],
    });
    expect(all).toEqual([
      { name: 'Arroz', category: 'graos', productId: 'p-1', source: 'produto', listItemIds: [] },
      { name: 'Arroz', category: 'graos', productId: 'p-1', source: 'lista', listItemIds: ['li-1'] },
      { name: 'Coca', category: 'bebidas', productId: null, source: 'lista', listItemIds: ['li-2'] },
      { name: 'Sabão em pó', category: 'limpeza', productId: null, source: 'comprado', listItemIds: [] },
      { name: 'Feijão carioca', category: 'graos', productId: null, source: 'comum', listItemIds: [] },
    ]);
  });

  it('compra ou item de lista de um produto renomeado entra com o nome de agora', () => {
    const index = indexNames(
      nameCandidates({
        products: [{ id: 'p-1', name: 'Banana', category: 'hortifruti' }],
        listItems: [{ id: 'li-1', name: 'Banana prata', category: 'hortifruti', product_id: 'p-1' }],
        purchases: [{ name: 'Banana prata', category: 'hortifruti', productId: 'p-1' }],
        common: [],
      }),
    );
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0]).toMatchObject({ name: 'Banana', productId: 'p-1', listItemIds: ['li-1'] });
  });

  it('com os itens comuns, o seletor acha o nome simples para a nota do mercado', () => {
    const index = indexNames(nameCandidates({ products: [], listItems: [], purchases: [], common: COMMON_ITEMS }));
    const best = (name: string) => similarNames(name, index, { onlyConfident: true, limit: 1 })[0]?.name;
    expect(best('Arroz Tj 5kg')).toBe('Arroz');
    expect(best('Leite Condensado Moca 395g')).toBe('Leite condensado');
    expect(best('Deterg Liq Ype 500ml')).toBe('Detergente');
    expect(best('Banana Prata Kg')).toBe('Banana');
    expect(best('Molho De Tomate Fugini 300g')).toBe('Molho de tomate');
    expect(best('Cerveja Heineken 330ml')).toBe('Cerveja');
    expect(best('Pilha Alcalina Aa')).toBe('Pilhas');
    expect(best('Água Mineral sem Gás Crystal 500ml')).toBe('Água mineral');
    expect(best('Ovos Brancos 12un')).toBe('Ovos (dúzia)');
    expect(best('Vitamina D 2000ui')).toBe('Vitamina D');
    expect(best('Sals Hot Dog Sadia 500g')).toBe('Salsicha');
    expect(best('Vitamina E 400ui')).toBeUndefined();
    expect(best('Azeit Gallo Extra Virgem 500ml')).toBeUndefined();
    expect(best('Carregador Usb')).toBeUndefined();
  });
});

describe('textos', () => {
  it('diz de onde o nome vem', () => {
    expect(nameSourceLabel({ source: 'produto', listItemIds: [] })).toBe('Produto da casa');
    expect(nameSourceLabel({ source: 'produto', listItemIds: ['li-1'] })).toBe('Produto da casa, na lista de compras');
    expect(nameSourceLabel({ source: 'lista', listItemIds: ['li-1'] })).toBe('Está na lista de compras');
    expect(nameSourceLabel({ source: 'comprado', listItemIds: [] })).toBe('Comprado antes');
    expect(nameSourceLabel({ source: 'comum', listItemIds: [] })).toBe('Item comum da lista');
  });

  it('apresenta a sugestão conforme o que o toque faz', () => {
    expect(similarNameHint({ closeness: 'igual', productId: 'p-1', listItemIds: [] })).toBe('A casa já tem este produto:');
    expect(similarNameHint({ closeness: 'parecido', productId: 'p-1', listItemIds: ['li-1'] })).toBe('A casa já tem um produto parecido:');
    expect(similarNameHint({ closeness: 'igual', productId: null, listItemIds: ['li-1'] })).toBe('Está na lista de compras como:');
    expect(similarNameHint({ closeness: 'parecido', productId: null, listItemIds: ['li-1'] })).toBe('Parece com um item da lista de compras:');
    expect(similarNameHint({ closeness: 'igual', productId: null, listItemIds: [] })).toBe('A casa já usa este nome:');
    expect(similarNameHint({ closeness: 'parecido', productId: null, listItemIds: [] })).toBe('A casa já usa um nome parecido:');
  });
});

import { describe, expect, it } from '@jest/globals';

import { COMMON_ITEMS } from '../commonItems';
import { LinkIndex, matchListItems, type ReceiptLine } from '../listLinks';
import {
  existingNameLabel,
  indexNames,
  knownName,
  nameCandidates,
  nameSourceLabel,
  sameListedName,
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
const bought = (name: string) => candidate(name, 'comprado');

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

  it('tamanho com vírgula ou ponto é um tamanho só', () => {
    expect(similarNameKey('Água 1,5L')).not.toBe(similarNameKey('Água 5L'));
    expect(similarNameKey('Água 1.5 l')).toBe(similarNameKey('Água 1,5L'));
    expect(similarNameKey('Ração 2,5kg')).not.toBe(similarNameKey('Ração 5kg'));
    // Zero no fim não muda o tamanho.
    expect(similarNameKey('Coca 1,50L')).toBe(similarNameKey('Coca 1,5L'));
    expect(similarNameKey('Coca 1,0L')).toBe(similarNameKey('Coca 1L'));
    // Com espaço não dá para saber ("Tipo 1 5kg" não é 1,5 kg): não junta.
    expect(similarNameKey('Agua 1 5l')).not.toBe(similarNameKey('Água 1,5L'));
    // Depois de "tipo", o número é a versão: não vira tamanho com a unidade solta.
    expect(similarNameKey('Feijão Tipo 1 Kg')).toBe(similarNameKey('Feijão Tipo 1'));
  });

  it('unidade por extenso é a mesma unidade; solta, não diz nada', () => {
    expect(similarNameKey('Coca-Cola 2 Litros')).toBe(similarNameKey('Coca-Cola 2L'));
    expect(similarNameKey('Leite 1 litro')).toBe(similarNameKey('Leite 1L'));
    expect(similarNameKey('Arroz 5 quilos')).toBe(similarNameKey('Arroz 5kg'));
    expect(similarNameKey('Arroz 5 Kilos')).toBe(similarNameKey('Arroz 5kg'));
    expect(similarNameKey('Queijo 500 gramas')).toBe(similarNameKey('Queijo 500g'));
    expect(similarNameKey('Ovos 12 unidades')).toBe(similarNameKey('Ovos 12un'));
    expect(similarNameKey('Banana Quilo')).toBe(similarNameKey('Banana'));
    expect(similarNameKey('Alface Unidade')).toBe(similarNameKey('Alface'));
    // "Dz" é dúzia.
    expect(similarNameKey('Ovos Dz')).toBe(similarNameKey('Ovos (dúzia)'));
    expect(similarNameKey('Ovos 1 Dz')).toBe(similarNameKey('Ovos c/12'));
    expect(similarNameKey('Ovos 2 dúzias')).toBe(similarNameKey('Ovos 24un'));
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

describe('sameListedName', () => {
  it('é o mesmo nome com outra grafia: acento, plural, unidade solta', () => {
    expect(sameListedName('Limões', 'Limão')).toBe(true);
    expect(sameListedName('bananas', 'Banana')).toBe(true);
    expect(sameListedName('Banana kg', 'Banana')).toBe(true);
    expect(sameListedName('Preto, feijões', 'Feijão preto')).toBe(true);
    expect(sameListedName('Banana prata', 'Banana')).toBe(false);
    expect(sameListedName('Coca 2L', 'Coca 350ml')).toBe(false);
    // Nome sem letra nem número não é nome nenhum.
    expect(sameListedName('!!!', '---')).toBe(false);
  });

  it('com "de", "para" ou "com", a ordem das palavras conta, como na sugestão', () => {
    expect(sameListedName('Molho de tomate', 'Tomate para Molho Kg')).toBe(false);
    expect(sameListedName('Molho de tomate', 'Tomate Molho Kg')).toBe(false);
    expect(sameListedName('Suco de laranja', 'Laranja p/ Suco Kg')).toBe(false);
    expect(sameListedName('Café com leite', 'Leite com Café')).toBe(false);
    // Na mesma ordem, com ou sem a ligação, é o mesmo nome.
    expect(sameListedName('Molho de tomate', 'Molho Tomate')).toBe(true);
    expect(sameListedName('Suco de laranja', 'Sucos de Laranja')).toBe(true);
  });

  it('na revisão da nota, marca o item da lista com o mesmo nome e só sugere o de palavras trocadas', () => {
    const line = (id: string, name: string, productId: string | null = null): ReceiptLine => ({ id, productId, name, names: [name], category: 'outros' });
    const receipt = [
      line('r-limao', 'Limão', 'p-limao'),
      line('r-banana', 'Banana'),
      line('r-tomate', 'Tomate para Molho Kg'),
      line('r-laranja', 'Laranja p/ Suco Kg'),
      line('r-leite', 'Leite com Café'),
      line('r-lenco', 'Papel Lenço Kleenex'),
    ];
    const list = ['Limões', 'bananas', 'Banana kg', 'Molho de tomate', 'Suco de laranja', 'Café com leite', 'Lenço de papel'].map((name, at) => ({
      id: 'l' + (at + 1),
      name,
      category: 'outros',
      product_id: null,
    }));
    expect(matchListItems(list, receipt, new LinkIndex(), sameListedName).map((m) => [m.listItemId, m.receiptItemId, m.checked])).toEqual([
      ['l1', 'r-limao', true],
      ['l2', 'r-banana', true],
      ['l3', 'r-banana', true],
      // As mesmas palavras em outra ordem: continua aparecendo, desmarcado, para a pessoa decidir. Quando o app sabe
      // que é outro item (tomate para molho é tomate, laranja para suco é laranja: domain/sameItem), nem sugere.
      ['l7', 'r-lenco', false],
    ]);
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
    expect(names(similarNames('Agua min s/gas crystal 500ml', index))).not.toContain('Água com gás');
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

  it('tamanho decimal não se confunde com o inteiro', () => {
    const index = indexNames([product('Água Crystal 5L', 'p-5l'), product('Ração Golden 5kg', 'p-racao'), listed('Água 5L', 'li-agua')]);
    expect(similarNames('Água Crystal 1,5L', index, { onlyConfident: true })).toEqual([]);
    expect(similarNames('Água Mineral Crystal 1,5L', index, { onlyConfident: true })).toEqual([]);
    expect(similarNames('Ração Golden 2,5kg', index, { onlyConfident: true })).toEqual([]);
    expect(similarNames('Água Crystal 5 L', index)[0]).toMatchObject({ productId: 'p-5l', closeness: 'igual' });
    // No seletor o de 5 litros continua aparecendo.
    expect(similarNames('Água Crystal 1,5L', index).map((s) => s.productId)).toContain('p-5l');
  });

  it('algarismo solto antes do tamanho deixa o tamanho em dúvida: nem "5L" nem "1,5L" sem a pessoa pedir', () => {
    const index = indexNames([product('Água Crystal 5L', 'p-5l'), product('Água Crystal 1,5L', 'p-15l'), listed('Arroz 5kg', 'li-arroz')]);
    expect(similarNames('Agua crystal 1 5l', index, { onlyConfident: true })).toEqual([]);
    expect(similarNames('Agua crystal 1 5l', index).map((s) => s.productId).sort()).toEqual(['p-15l', 'p-5l']);
    // Depois de "tipo", o número é a versão do arroz: o tamanho é 5kg mesmo.
    expect(names(similarNames('Arroz Tipo 1 5kg', index, { onlyConfident: true }))).toEqual(['Arroz 5kg']);
    expect(names(similarNames('Arroz Tio João Tp 1 5kg', index, { onlyConfident: true }))).toEqual(['Arroz 5kg']);
  });

  it('"T.1" e "Nº 5" antes do tamanho são a versão, como "Tipo 1": o tamanho não fica em dúvida', () => {
    const index = indexNames([
      product('Arroz Tio João 5kg', 'p-arroz'),
      product('Feijão Carioca Camil 1kg', 'p-feijao'),
      product('Macarrão Barilla 500g', 'p-macarrao'),
      listed('Arroz 5kg', 'li-arroz'),
    ]);
    const best = (name: string) => similarNames(name, index, { onlyConfident: true, limit: 1 })[0]?.name;
    for (const name of ['Arroz tio joao t.1 5kg', 'Arroz Tio João T-1 5kg', 'Arroz Tio João T 1 5kg', 'ARROZ TIO JOAO T1 5KG']) {
      expect([name, best(name)]).toEqual([name, 'Arroz Tio João 5kg']);
    }
    expect(best('Arroz T.1 5kg')).toBe('Arroz 5kg');
    expect(best('Feijão Carioca Camil T.1 1kg')).toBe('Feijão Carioca Camil 1kg');
    for (const name of ['Macarrão Barilla Nº 5 500g', 'Macarrão Barilla N 5 500g', 'Macarrão Barilla No 5 500g', 'Macarrao barilla n.5 500g']) {
      expect([name, best(name)]).toEqual([name, 'Macarrão Barilla 500g']);
    }
    // Sem a marca, o algarismo solto continua deixando o tamanho em dúvida.
    expect(best('Arroz Tio João 1 5kg')).toBeUndefined();
    // Depois da marca, o número não vira tamanho com a unidade solta.
    expect(similarNameKey('Feijão T.1 Kg')).toBe(similarNameKey('Feijão T 1'));
  });

  it('depois de uma marca curta ("N", "T"), número de mais de um dígito com a unidade é o tamanho', () => {
    const index = indexNames([product('Detergente Ypê 500ml', 'p-det'), product('Café Pilão 500g', 'p-cafe'), product('Ovos 12un', 'p-ovos')]);
    const best = (name: string) => similarNames(name, index, { onlyConfident: true, limit: 1 })[0]?.name;
    expect(best('DETERGENTE YPE N 500 ML')).toBe('Detergente Ypê 500ml');
    expect(best('CAFE PILAO T 500 G')).toBe('Café Pilão 500g');
    expect(best('Ovos N 12 un')).toBe('Ovos 12un');
    expect(similarNameKey('Detergente N 500 ml')).toBe(similarNameKey('Detergente N 500ml'));
    // Um dígito só continua sendo a versão.
    expect(similarNameKey('Feijão T 1 Kg')).toBe(similarNameKey('Feijão T 1'));
  });

  it('a palavra de versão com o número ("Tipo 1") depois do produto certo não é outra versão dele', () => {
    const index = indexNames([product('Arroz Tio João 5kg', 'p-arroz'), product('Fralda Pampers 60un', 'p-fralda')]);
    const best = (name: string) => similarNames(name, index, { onlyConfident: true, limit: 1 })[0]?.productId;
    expect(best('Arroz Tio João Tipo 1 5kg')).toBe('p-arroz');
    expect(best('Arroz Tio João Tp 1 5kg')).toBe('p-arroz');
    expect(best('Arroz Tio João 5kg Tipo 1')).toBe('p-arroz');
    // Outra palavra junto continua sendo outra versão.
    expect(best('Arroz Tio João Integral Tipo 1 5kg')).toBeUndefined();
    // Palavra de versão sem número não é marca: "Tam G" diz o tamanho da fralda.
    expect(best('Fralda Pampers Tam G 60un')).toBeUndefined();
  });

  it('letra ou número de versão não faz do produto um produto certo: a marca depois dele não atrapalha', () => {
    const index = indexNames([
      product('Vitamina C', 'p-c'),
      product('Ômega 3', 'p-omega'),
      product('Álcool 70%', 'p-alcool'),
      product('Fralda Pampers M', 'p-m'),
    ]);
    const best = (name: string) => similarNames(name, index, { onlyConfident: true, limit: 1 })[0]?.productId;
    expect(best('Vitamina C Sundown 60 cápsulas')).toBe('p-c');
    expect(best('Vitamina C Cebion 1g')).toBe('p-c');
    expect(best('Ômega 3 Sundown 60 Cáps')).toBe('p-omega');
    expect(best('Álcool 70% Zulu 1L')).toBe('p-alcool');
    expect(best('Fralda Pampers M Confort Sec 80un')).toBe('p-m');
    expect(best('Fralda Pampers M 80un')).toBe('p-m');
    // A letra ou o número ainda precisam bater.
    expect(best('Vitamina D 2000ui')).toBeUndefined();
    expect(best('Fralda Pampers G 60un')).toBeUndefined();
    expect(best('Álcool 46 Zulu 1L')).toBeUndefined();
  });

  it('fardo ou caixa com várias unidades não é o produto da unidade', () => {
    const index = indexNames([product('Skol 350ml', 'p-skol'), product('Coca-Cola 2L', 'p-coca'), product('Iogurte Nestlé 170g', 'p-iogurte')]);
    for (const name of ['Skol 350ml c/12', 'Skol Lata 350ml Pack 12un', 'Coca-Cola 2L c/6', 'Coca-Cola Fardo 6un 2L', 'Iogurte Nestlé 170g c/6']) {
      expect(similarNames(name, index, { onlyConfident: true })).toEqual([]);
    }
    expect(similarNames('Skol Lata 350ml', index, { onlyConfident: true })[0]).toMatchObject({ productId: 'p-skol' });
    // No seletor, o produto da unidade continua aparecendo.
    expect(similarNames('Skol 350ml c/12', index)[0]).toMatchObject({ productId: 'p-skol', confident: false });
  });

  it('no meio do nome só serve o produto certo (com tamanho): sabor ou ingrediente não é o produto', () => {
    const index = indexNames([
      product('Molho de tomate', 'p-molho'),
      product('Leite condensado', 'p-condensado'),
      product('Carne moída', 'p-carne'),
      product('Pão de queijo', 'p-pao'),
      product('Coca-Cola 2L', 'p-coca'),
      product('Omo Lavagem Perfeita 1,6kg', 'p-omo'),
    ]);
    for (const name of [
      'Sardinha Molho de Tomate Coqueiro 125g',
      'Bolo Leite Condensado Pullman 250g',
      'Lasanha Carne Moída Sadia 600g',
      'Sorvete de Leite Condensado Kibon 1,5L',
      'Mistura para Pão de Queijo Yoki 250g',
    ]) {
      expect(similarNames(name, index, { onlyConfident: true })).toEqual([]);
    }
    expect(similarNames('Refrigerante Coca-Cola 2l', index, { onlyConfident: true })[0]).toMatchObject({ productId: 'p-coca' });
    expect(similarNames('Sabão em Pó Omo Lavagem Perfeita 1,6kg', index, { onlyConfident: true })[0]).toMatchObject({ productId: 'p-omo' });
    // No começo do nome, o produto sem tamanho continua servindo.
    expect(similarNames('Molho de Tomate Fugini 300g', index, { onlyConfident: true })[0]).toMatchObject({ productId: 'p-molho' });
  });

  it('"em" ou "de" seguido de embalagem não muda o produto', () => {
    const index = indexNames([product('Skol 350ml', 'p-skol'), product('Sabonete Dove', 'p-dove'), product('Cerveja Brahma', 'p-brahma')]);
    const best = (name: string) => similarNames(name, index, { onlyConfident: true, limit: 1 })[0]?.productId;
    expect(best('Skol em Lata 350ml')).toBe('p-skol');
    expect(best('Sabonete Dove em Barra 90g')).toBe('p-dove');
    expect(best('Cerveja Brahma em Lata 350ml')).toBe('p-brahma');
    // Outra palavra depois de "de" continua sendo outra coisa.
    expect(best('Sabonete Dove de Aveia 90g')).toBeUndefined();
  });

  it('outra coisa mesmo sem "de": a nota fiscal corta a ligação', () => {
    const index = indexNames([
      listed('Leite', 'li-leite'),
      listed('Molho', 'li-molho'),
      listed('Farinha', 'li-farinha'),
      product('Batata', 'p-batata'),
      candidate('Molho de tomate'),
      candidate('Farinha de trigo'),
    ]);
    const best = (name: string) => similarNames(name, index, { onlyConfident: true }).find((s) => s.source !== 'comum')?.name;
    // Palavras que fazem outra coisa depois de qualquer nome.
    expect(best('Leite coco sococo 200ml')).toBeUndefined();
    expect(best('Leite Fermentado Yakult 480g')).toBeUndefined();
    expect(best('Batata Palha Yoki 140g')).toBeUndefined();
    expect(best('Batatas Doces Kg')).toBeUndefined();
    // "X de Y" que a casa ou o catálogo conhecem, escrito sem o "de".
    expect(best('Molho Tomate Fugini 300g')).toBeUndefined();
    expect(best('Farinha Trigo Dona Benta 1kg')).toBeUndefined();
    // Marca, tipo ou sabor continuam servindo.
    expect(best('Leite Integral Italac 1L')).toBe('Leite');
    expect(best('Molho Shoyu Sakura 150ml')).toBe('Molho');
    expect(best('Batata Inglesa Kg')).toBe('Batata');
  });

  it('palavra colada por um hífen faz outra coisa quando a casa ou o catálogo conhece o par', () => {
    const index = indexNames([
      listed('Couve', 'li-couve'),
      listed('Papel', 'li-papel'),
      listed('Coca', 'li-coca'),
      listed('Pão', 'li-pao'),
      product('Batata', 'p-batata'),
      product('Banana', 'p-banana'),
      product('Coca-Cola 2L', 'p-coca'),
      candidate('Couve-flor'),
      candidate('Papel-alumínio'),
    ]);
    // Só o que a casa usa de verdade (o catálogo aparece no seletor).
    const best = (name: string) => suggestedName(name, index)?.name;
    for (const name of ['Couve-flor', 'Couve-flor Kg', 'COUVE-FLOR UN', 'Couve Flor Un', 'Papel-alumínio Wyda 7,5m', 'Batata-doce Kg', 'Coca-Cola 350ml']) {
      expect([name, best(name)]).toEqual([name, undefined]);
    }
    // Variedade escrita com hífen, que ninguém conhece como outro nome, continua sendo o item da casa.
    expect(best('Banana-prata Kg')).toBe('Banana');
    expect(best('Pão-francês Kg')).toBe('Pão');
    // No seletor, quem procura ainda vê o nome da casa.
    expect(similarNames('Couve-flor Kg', index).find((found) => found.name === 'Couve')).toMatchObject({ closeness: 'parecido', confident: false });
    // Hífen com espaço em volta só separa; e o hífen dentro do próprio nome da casa não atrapalha.
    expect(best('Couve - Maço')).toBe('Couve');
    expect(best('Couve Manteiga Maço')).toBe('Couve');
    expect(best('Coca-Cola Pet 2L')).toBe('Coca-Cola 2L');
    expect(best('Refrigerante Coca-Cola 2l')).toBe('Coca-Cola 2L');
  });

  it('o nome com hífen do catálogo segura a sugestão também quando a nota escreve sem o hífen', () => {
    const house = [listed('Couve', 'li-couve'), listed('Papel', 'li-papel')];
    const alone = indexNames(house);
    const withCatalog = indexNames([...house, candidate('Couve-flor'), candidate('Papel-alumínio')]);
    expect(suggestedName('Couve Flor Un', alone)).toMatchObject({ name: 'Couve' });
    expect(suggestedName('Couve Flor Un', withCatalog)).toBeNull();
    expect(suggestedName('Papel aluminio wyda 7 5m', withCatalog)).toBeNull();
    // Outra couve continua ganhando o nome da lista.
    expect(suggestedName('Couve Manteiga Maço', withCatalog)).toMatchObject({ name: 'Couve' });
  });

  it('"frita" e "frito" depois do nome da casa fazem outra coisa', () => {
    const index = indexNames([product('Batata', 'p-batata'), listed('Frango', 'li-frango'), listed('Mandioca', 'li-mandioca')]);
    const best = (name: string) => similarNames(name, index, { onlyConfident: true, limit: 1 })[0]?.name;
    for (const name of ['Batata Frita Congelada McCain 1kg', 'Batatas Fritas 400g', 'Frango Frito Kg', 'Mandioca frita congelada 1kg']) {
      expect([name, best(name)]).toEqual([name, undefined]);
    }
    expect(best('Batata Lavada Kg')).toBe('Batata');
    expect(best('Frango Inteiro Congelado Kg')).toBe('Frango');
  });

  it('abreviação que só existe em nome de produto não vira palavra da casa', () => {
    const index = indexNames(
      nameCandidates({
        products: [
          { id: 'p-deterg', name: 'Deterg liq ype clear 500ml', category: 'limpeza' },
          { id: 'p-refrig', name: 'Refrig coca cola 350ml lt', category: 'bebidas' },
          { id: 'p-cerv', name: 'Cerv brahma duplo malte lt 350ml', category: 'alcoolicas' },
        ],
        listItems: [
          { id: 'li-1', name: 'Detergente', category: 'limpeza', product_id: null },
          { id: 'li-2', name: 'Refrigerante', category: 'bebidas', product_id: null },
        ],
        // A compra pela nota chega com o nome do produto: também não conta como palavra.
        purchases: [
          { name: 'Cerveja', category: 'alcoolicas', productId: null },
          { name: 'Deterg liq ype clear 500ml', category: 'limpeza', productId: 'p-deterg' },
        ],
        common: COMMON_ITEMS,
      }),
    );
    expect(suggestedName('Deterg liq limpol neutro 500ml', index)).toMatchObject({ name: 'Detergente', source: 'lista' });
    expect(suggestedName('Refrig fanta laranja 2l', index)).toMatchObject({ name: 'Refrigerante', source: 'lista' });
    expect(suggestedName('Cerv skol lt 350ml', index)).toMatchObject({ name: 'Cerveja', source: 'comprado' });
    expect(index.vocabulary.has('deterg')).toBe(false);
    // Palavra de produto que não é começo de outra continua sendo palavra.
    expect(index.vocabulary.has('brahma')).toBe(true);
  });

  it('trecho que termina em vogal parece palavra inteira: não é abreviação para sugerir sozinho', () => {
    const index = indexNames([product('Goiabada', 'p-goiabada'), product('Cocada', 'p-cocada'), listed('limão', 'li-limao')]);
    expect(similarNames('Goiaba Kg', index, { onlyConfident: true })).toEqual([]);
    expect(similarNames('Coca Cola 2L', index, { onlyConfident: true })).toEqual([]);
    expect(similarNames('Lima Kg', index, { onlyConfident: true })).toEqual([]);
    // No seletor ainda aparece.
    expect(names(similarNames('Goiaba Kg', index))).toEqual(['Goiabada']);
  });

  it('as mesmas palavras em outra ordem só são o mesmo nome sem "de", "para", "com"', () => {
    const index = indexNames([product('Suco de laranja', 'p-suco'), product('Molho de tomate', 'p-molho'), product('Feijão Preto', 'p-feijao')]);
    expect(similarNames('Laranja para suco', index)[0]).toMatchObject({ productId: 'p-suco', closeness: 'parecido', confident: false });
    expect(similarNames('Laranja para suco', index, { onlySame: true })).toEqual([]);
    expect(similarNames('Tomate p/ Molho Kg', index, { onlyConfident: true })).toEqual([]);
    // Na mesma ordem, com ou sem a ligação, é o mesmo nome.
    expect(similarNames('Suco laranja', index)[0]).toMatchObject({ productId: 'p-suco', closeness: 'igual' });
    // Sem ligação nenhuma, a ordem não importa.
    expect(similarNames('Preto, feijões', index)[0]).toMatchObject({ productId: 'p-feijao', closeness: 'igual' });
    expect(similarNames('FEIJÃO DE PRETO', index)[0]).toMatchObject({ productId: 'p-feijao', closeness: 'igual' });
  });

  it('grafia da casa sem acento não é sugestão para o nome bem escrito', () => {
    const index = indexNames([listed('acucar', 'li-acucar'), listed('feijao', 'li-feijao')]);
    expect(similarNames('Açúcar', index)).toEqual([]);
    expect(similarNames('Feijão', index)).toEqual([]);
    expect(similarNames('Açúcar', index, { onlySame: true })).toEqual([]);
    expect(suggestedName('Açúcar', index)).toBeNull();
    // O contrário vale mostrar: a casa escreve com acento e a pessoa digitou sem.
    expect(similarNames('acucar', indexNames([listed('Açúcar', 'li-acucar')]))[0]).toMatchObject({ name: 'Açúcar', closeness: 'igual' });
    // Com produto, sempre vale: escolher liga o item a ele.
    expect(similarNames('Açúcar', indexNames([product('acucar', 'p-acucar')]))[0]).toMatchObject({ productId: 'p-acucar' });
  });

  it('no seletor, os nomes da casa vêm antes do catálogo, tenham tamanho ou não', () => {
    const index = indexNames(
      nameCandidates({
        products: [
          { id: 'p-italac', name: 'Leite Integral Italac 1L', category: 'laticinios' },
          { id: 'p-pira', name: 'Leite Piracanjuba Desnatado 1L', category: 'laticinios' },
        ],
        listItems: [],
        purchases: [],
        common: COMMON_ITEMS,
      }),
    );
    const found = similarNames('Leite', index);
    expect(found).toHaveLength(5);
    expect(found.slice(0, 2).map((s) => s.productId)).toEqual(['p-italac', 'p-pira']);
    expect(found.slice(2).every((s) => s.source === 'comum')).toBe(true);
  });

  it('nomes desta nota entram junto quando pedidos, e o da casa vale no lugar do repetido', () => {
    const house = indexNames([listed('Arroz', 'li-arroz'), candidate('Banana')]);
    const note = indexNames([candidate('Pitaya', 'nota', { category: 'hortifruti' }), candidate('arroz', 'nota')]);
    expect(similarNames('Pitayas', house)).toEqual([]);
    expect(similarNames('Pitayas', house, { also: note })[0]).toMatchObject({ name: 'Pitaya', source: 'nota', closeness: 'igual' });
    expect(similarNames('Pitaya Vermelha Kg', house, { also: note })[0]).toMatchObject({ name: 'Pitaya', source: 'nota', closeness: 'parecido' });
    expect(similarNames('Arroz Tio João 5kg', house, { also: note }).map((s) => [s.name, s.source])).toEqual([['Arroz', 'lista']]);
  });

  it('nome desta nota que só o catálogo tem aparece como "Nesta nota", com a categoria que a pessoa deu', () => {
    const house = indexNames([candidate('Banana', 'comum', { category: 'hortifruti' }), bought('Tomate'), product('Uva', 'p-uva', 'hortifruti')]);
    const note = indexNames([
      candidate('Banana', 'nota', { category: 'doces' }),
      candidate('tomate', 'nota', { category: 'doces' }),
      candidate('Uva', 'nota', { category: 'doces' }),
    ]);
    // Só o catálogo tem: vale o desta nota, uma vez só.
    expect(similarNames('Bananas', house, { also: note }).map((s) => [s.name, s.source, s.category])).toEqual([['Banana', 'nota', 'doces']]);
    expect(similarNames('Banana Prata Kg', house, { also: note }).map((s) => [s.name, s.source])).toEqual([['Banana', 'nota']]);
    // O desta nota que é só o digitado sem os acentos não é oferecido: aí a grafia do catálogo continua aparecendo.
    const plain = indexNames([candidate('acucar', 'nota', { category: 'doces' })]);
    const catalog = indexNames([candidate('Açúcar', 'comum', { category: 'graos' })]);
    expect(similarNames('Açucar', catalog, { also: plain }).map((s) => [s.name, s.source])).toEqual([['Açúcar', 'comum']]);
    expect(similarNames('Açúcares', catalog, { also: plain }).map((s) => [s.name, s.source])).toEqual([['acucar', 'nota']]);
    // A casa já usa (compra, produto): vale o da casa.
    expect(similarNames('Tomates', house, { also: note }).map((s) => [s.name, s.source])).toEqual([['Tomate', 'comprado']]);
    expect(similarNames('Uvas', house, { also: note }).map((s) => [s.name, s.source, s.productId])).toEqual([['Uva', 'produto', 'p-uva']]);
    // Sem os nomes da nota, o catálogo continua aparecendo.
    expect(similarNames('Bananas', house).map((s) => [s.name, s.source, s.category])).toEqual([['Banana', 'comum', 'hortifruti']]);
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

  it('o catálogo não cala o nome genérico da casa; só quando o nome mais comprido é outra coisa', () => {
    const index = indexNames(
      nameCandidates({
        products: [],
        listItems: ['Leite', 'Ovos', 'Pão', 'Queijo', 'Macarrão'].map((name) => ({ id: 'li-' + name, name, category: 'outros', product_id: null })),
        purchases: [],
        common: COMMON_ITEMS,
      }),
    );
    const chip = (name: string) => suggestedName(name, index)?.name ?? null;
    expect(chip('Leite Integral Italac 1L')).toBe('Leite');
    expect(chip('Leite uht int italac 1l')).toBe('Leite');
    expect(chip('Ovos Vermelhos 12 un')).toBe('Ovos');
    expect(chip('Pão Francês Kg')).toBe('Pão');
    expect(chip('Queijo Muçarela Fatiado 150g')).toBe('Queijo');
    // Outra coisa, escrita por inteiro, abreviada ou com "em".
    expect(chip('Leite Condensado Moça 395g')).toBeNull();
    expect(chip('Leite cond moca 395g')).toBeNull();
    expect(chip('Leite em Pó Ninho 400g')).toBeNull();
    expect(chip('Macarrão Instantâneo Nissin 85g')).toBeNull();
  });

  it('um nome da casa mais comprido que é outra coisa também segura a sugestão do genérico', () => {
    const index = indexNames([listed('Leite', 'li-leite'), product('Leite condensado', 'p-condensado'), candidate('Condicionador')]);
    // "cond" tem duas leituras: não dá para sugerir o leite condensado, e também não o leite.
    expect(suggestedName('Leite cond moca 395g', index)).toBeNull();
    expect(suggestedName('Leite Condensado Moça 395g', index)).toMatchObject({ productId: 'p-condensado' });
    expect(suggestedName('Leite Italac 1L', index)).toMatchObject({ name: 'Leite' });
  });

  it('sugere o melhor nome da casa mesmo com um nome de catálogo na frente', () => {
    const index = indexNames([product('Ovos', 'p-ovos'), candidate('Ovos (dúzia)'), candidate('Ovos (30 un)'), bought('Feijão'), candidate('Feijão preto')]);
    expect(similarNames('Ovos Vermelhos 12 un', index, { onlyConfident: true })[0]).toMatchObject({ name: 'Ovos (dúzia)', source: 'comum' });
    expect(suggestedName('Ovos Vermelhos 12 un', index)).toMatchObject({ productId: 'p-ovos' });
    expect(suggestedName('Ovos Brancos 30 un', index)).toMatchObject({ productId: 'p-ovos' });
    expect(suggestedName('Feijão Preto Kicaldo 1kg', index)).toMatchObject({ name: 'Feijão', source: 'comprado' });
  });

  it('nome que já é da casa não ganha o genérico; nome que só o catálogo tem, ganha', () => {
    const index = indexNames([listed('Carne', 'li-carne'), bought('Carne moída'), listed('Pão', 'li-pao'), candidate('Pão francês')]);
    // O nome da casa com outra grafia é o que aparece, nunca o genérico "Carne".
    expect(suggestedName('Carne Moída Kg', index)).toMatchObject({ name: 'Carne moída', closeness: 'igual' });
    expect(suggestedName('Carne moída', index)).toBeNull();
    expect(suggestedName('Pão Francês Kg', index)).toMatchObject({ name: 'Pão' });
  });

  it('casa sem histórico: nenhuma sugestão no item', () => {
    const index = indexNames(nameCandidates({ products: [], listItems: [], purchases: [], common: COMMON_ITEMS }));
    for (const name of ['Arroz Tio João Tipo 1 5kg', 'Sal de Frutas Eno 100g', 'Batata Palha Elma Chips 120g', 'Couve-flor', 'Bananas']) {
      expect(suggestedName(name, index)).toBeNull();
    }
  });
});

describe('uma casa de verdade, com o catálogo junto', () => {
  // Como a tela monta: produtos, listas abertas, compras recentes e os itens comuns num índice só.
  const index = indexNames(
    nameCandidates({
      products: [
        { id: 'p-batata', name: 'Batata', category: 'hortifruti' },
        { id: 'p-alho', name: 'Alho', category: 'hortifruti' },
        { id: 'p-frango', name: 'Frango', category: 'carnes' },
        { id: 'p-banana', name: 'Banana', category: 'hortifruti' },
        { id: 'p-coca', name: 'Coca-Cola 2L', category: 'bebidas' },
        { id: 'p-skol', name: 'Skol 350ml', category: 'alcoolicas' },
        { id: 'p-agua5', name: 'Água Crystal 5L', category: 'bebidas' },
        { id: 'p-vitc', name: 'Vitamina C', category: 'suplementos' },
        { id: 'p-molho', name: 'Molho de tomate', category: 'temperos' },
        { id: 'p-suco', name: 'Suco de laranja', category: 'bebidas' },
        { id: 'p-goiabada', name: 'Goiabada', category: 'doces' },
        { id: 'p-arroz', name: 'Arroz Tio João 5kg', category: 'graos' },
        // Nomes que uma nota lida pelo QR code deixou.
        { id: 'p-deterg', name: 'Deterg liq ype clear 500ml', category: 'limpeza' },
        { id: 'p-refrig', name: 'Refrig coca cola 350ml lt', category: 'bebidas' },
        { id: 'p-cerv', name: 'Cerv brahma duplo malte lt 350ml', category: 'alcoolicas' },
      ],
      listItems: [
        ...['Leite', 'Água', 'Pão', 'Iogurte', 'Queijo', 'Macarrão', 'Ovos', 'Detergente', 'Refrigerante', 'acucar', 'Couve', 'Papel'].map((name) => ({
          id: 'li-' + name,
          name,
          category: 'outros',
          product_id: null,
        })),
        { id: 'li-banana', name: 'Bananas', category: 'hortifruti', product_id: 'p-banana' },
      ],
      purchases: [
        { name: 'Sal', category: 'temperos', productId: null },
        { name: 'Óleo', category: 'oleos', productId: null },
        { name: 'Cerveja', category: 'alcoolicas', productId: null },
        { name: 'Deterg liq ype clear 500ml', category: 'limpeza', productId: 'p-deterg' },
      ],
      common: COMMON_ITEMS,
    }),
  );
  const chip = (name: string) => suggestedName(name, index)?.name ?? null;

  it('nota lida pela foto (nomes da IA): o nome da casa aparece para a mesma coisa', () => {
    expect(chip('Leite Integral Italac 1L')).toBe('Leite');
    expect(chip('Pão Francês Kg')).toBe('Pão');
    expect(chip('Banana Prata Kg')).toBe('Banana');
    expect(chip('Iogurte Morango')).toBe('Iogurte');
    expect(chip('Ovos Vermelhos 12 un')).toBe('Ovos');
    expect(chip('Queijo Muçarela Fatiado 150g')).toBe('Queijo');
    expect(chip('Refrigerante Coca-Cola 2l')).toBe('Coca-Cola 2L');
    expect(chip('Coca-Cola 2 Litros')).toBe('Coca-Cola 2L');
    expect(chip('Skol em Lata 350ml')).toBe('Skol 350ml');
    expect(chip('Vitamina C Sundown 60 cápsulas')).toBe('Vitamina C');
    expect(chip('Molho de Tomate Fugini 300g')).toBe('Molho de tomate');
    expect(chip('Batata Lavada Kg')).toBe('Batata');
    expect(chip('Couve Manteiga Maço')).toBe('Couve');
    expect(chip('Arroz Tio João Tipo 1 5kg')).toBe('Arroz Tio João 5kg');
    // O item da lista escrito sem acento aparece com a grafia do catálogo.
    expect(suggestedName('Açúcar Refinado União 1kg', index)).toMatchObject({ name: 'Açúcar', source: 'lista', listItemIds: ['li-acucar'] });
    // O produto da casa leva junto o item da lista ligado a ele.
    expect(suggestedName('Banana Prata Kg', index)).toMatchObject({ productId: 'p-banana', listItemIds: ['li-banana'] });
  });

  it('nota lida pela foto: outra coisa, outro tamanho ou só o catálogo não ganham sugestão', () => {
    for (const name of [
      'Leite Condensado Moça 395g',
      'Leite em Pó Ninho 400g',
      'Leite Fermentado Yakult 480g',
      'Água Oxigenada 10 volumes 100ml',
      'Água Tônica Schweppes 350ml',
      'Batata Palha Yoki 140g',
      'Alho Poró Un',
      'Frango Empanado Sadia 300g',
      'Macarrão Instantâneo Nissin 85g',
      // Colado por hífen, ou o nome com hífen do catálogo escrito sem ele.
      'Couve-flor',
      'Couve-flor Kg',
      'Couve Flor Un',
      'Batata-doce Kg',
      'Papel-alumínio Wyda 7,5m',
      'Batata Frita Congelada McCain 1kg',
      'Sardinha Molho de Tomate Coqueiro 125g',
      'Sorvete de Leite Condensado Kibon 1,5L',
      'Laranja para Suco Kg',
      'Goiaba Kg',
      'Skol 350ml c/12',
      'Coca-Cola Lata 350ml',
      'Açúcar',
      'Feijão Carioca Camil 1kg',
      'Carregador Usb',
    ]) {
      expect([name, chip(name)]).toEqual([name, null]);
    }
    // Garrafa de 1,5 L não é o galão de 5 L da casa: fica o nome genérico da lista.
    expect(chip('Água Crystal 1,5L')).toBe('Água');
  });

  it('nota lida pelo QR code (texto da nota fiscal): abreviada e sem "de"', () => {
    expect(chip('Leite uht int italac 1l')).toBe('Leite');
    expect(chip('Deterg liq limpol neutro 500ml')).toBe('Detergente');
    expect(chip('Refrig fanta laranja 2l')).toBe('Refrigerante');
    expect(chip('Cerv skol lt 350ml')).toBe('Cerveja');
    expect(chip('Agua crystal 1 5l')).toBe('Água');
    expect(chip('Arroz tio joao t.1 5kg')).toBe('Arroz Tio João 5kg');
    for (const name of [
      'Leite coco sococo 200ml',
      'Leite cond moca 395g',
      'Pao queijo forno minas 400g',
      'Pao alho santa massa 300g',
      'Sal frutas eno 100g',
      'Oleo motor lubrax 1l',
      'Couve flor un',
      'Papel aluminio wyda 7 5m',
      'Batata frita cong mccain 1kg',
    ]) {
      expect([name, chip(name)]).toEqual([name, null]);
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

  it('entre nomes sem produto com as mesmas letras, mostra o mais bem escrito, de qualquer fonte', () => {
    const index = indexNames([
      candidate('papel higienico', 'lista', { listItemIds: ['li-1'], category: 'outros' }),
      candidate('Papel higiênico', 'comum', { category: 'papel' }),
      candidate('BANANA', 'comprado'),
      candidate('Banana', 'comum'),
      candidate('Feijão', 'comum'),
      candidate('feijao', 'lista', { listItemIds: ['li-2'] }),
    ]);
    expect(index.entries.map((entry) => [entry.name, entry.source, entry.listItemIds])).toEqual([
      ['Papel higiênico', 'lista', ['li-1']],
      ['Banana', 'comprado', []],
      ['Feijão', 'lista', ['li-2']],
    ]);
    // Outras letras (plural): continua valendo o nome da fonte mais forte.
    expect(indexNames([candidate('bananas', 'lista', { listItemIds: ['li-1'] }), candidate('Banana', 'comum')]).entries[0].name).toBe('bananas');
  });

  it('o nome de um produto aparece como ele é', () => {
    const index = indexNames([
      candidate('Açúcar', 'comum', { category: 'doces' }),
      candidate('acucar', 'produto', { productId: 'p-acucar', category: 'outros' }),
      candidate('leite integral', 'lista', { listItemIds: ['li-1'], category: 'outros' }),
      candidate('Leite Integral', 'comprado', { productId: 'p-leite', category: 'laticinios' }),
    ]);
    expect(index.entries).toHaveLength(2);
    expect(index.entries[0]).toMatchObject({ name: 'acucar', productId: 'p-acucar', category: 'outros', source: 'produto' });
    expect(index.entries[1]).toMatchObject({ name: 'Leite Integral', productId: 'p-leite', category: 'laticinios', source: 'lista', listItemIds: ['li-1'] });
  });

  it('dois produtos com as mesmas palavras em outra ordem ficam os dois', () => {
    const index = indexNames([product('Suco de laranja', 'p-suco'), product('Laranja para suco', 'p-laranja')]);
    expect(index.entries).toHaveLength(2);
    expect(similarNames('Laranja para Suco Kg', index)[0]).toMatchObject({ productId: 'p-laranja', closeness: 'igual' });
    expect(similarNames('Suco de laranja', index)[0]).toMatchObject({ productId: 'p-suco', closeness: 'igual' });
    expect(knownName('laranja p/ suco', index)).toMatchObject({ productId: 'p-laranja' });
  });

  it('acha o nome da casa que é o mesmo nome', () => {
    const index = indexNames([product('Banana', 'p-banana'), listed('Feijão Preto', 'li-1')]);
    expect(knownName('bananas', index)).toMatchObject({ name: 'Banana', productId: 'p-banana' });
    expect(knownName('FEIJAO PRETO', index)).toMatchObject({ name: 'Feijão Preto' });
    expect(knownName('Banana prata', index)).toBeNull();
    expect(knownName('  ', index)).toBeNull();
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
    expect(nameSourceLabel({ source: 'comum', listItemIds: [] })).toBe('Item comum (catálogo)');
    expect(nameSourceLabel({ source: 'nota', listItemIds: [] })).toBe('Nesta nota');
  });

  it('o botão de usar o que já existe só diz "já existe" para um nome que a casa usa', () => {
    expect(existingNameLabel({ name: 'Banana', source: 'produto' })).toBe('Usar "Banana" (já existe)');
    expect(existingNameLabel({ name: 'Arroz', source: 'lista' })).toBe('Usar "Arroz" (já existe)');
    expect(existingNameLabel({ name: 'Sal', source: 'comprado' })).toBe('Usar "Sal" (já existe)');
    expect(existingNameLabel({ name: 'Açúcar', source: 'comum' })).toBe('Usar "Açúcar"');
    expect(existingNameLabel({ name: 'Pitaya', source: 'nota' })).toBe('Usar "Pitaya" (já está nesta nota)');
  });

  it('apresenta a sugestão conforme o que o toque faz', () => {
    expect(similarNameHint({ closeness: 'igual', productId: 'p-1', listItemIds: [] })).toBe('A casa já tem este produto:');
    expect(similarNameHint({ closeness: 'parecido', productId: 'p-1', listItemIds: ['li-1'] })).toBe('A casa já tem um produto parecido:');
    expect(similarNameHint({ closeness: 'igual', productId: null, listItemIds: ['li-1'] })).toBe(
      'Está na lista de compras como (sai dela ao confirmar):',
    );
    expect(similarNameHint({ closeness: 'parecido', productId: null, listItemIds: ['li-1'] })).toBe(
      'Parece com um item da lista de compras (sai dela ao confirmar):',
    );
    expect(similarNameHint({ closeness: 'igual', productId: null, listItemIds: [] })).toBe('A casa já usa este nome:');
    expect(similarNameHint({ closeness: 'parecido', productId: null, listItemIds: [] })).toBe('A casa já usa um nome parecido:');
  });
});

import { describe, expect, it } from '@jest/globals';

import { COMMON_ITEMS } from '../commonItems';
import {
  indexNames,
  nameCandidates,
  nameSourceLabel,
  similarNameKey,
  similarNames,
  type NameCandidate,
} from '../similarNames';

const candidate = (
  name: string,
  source: NameCandidate['source'] = 'comum',
  extra: Partial<NameCandidate> = {},
): NameCandidate => ({ name, category: 'outros', productId: null, source, listItemIds: [], ...extra });

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
  });

  it('tamanho diferente é outro nome', () => {
    expect(similarNameKey('Coca-Cola 2L')).not.toBe(similarNameKey('Coca-Cola 350ml'));
  });

  it('nome sem letra nem número não tem chave', () => {
    expect(similarNameKey('  ')).toBe('');
    expect(similarNameKey('---')).toBe('');
  });
});

describe('similarNames', () => {
  it('o mesmo nome com outra grafia é igual, e traz o produto', () => {
    const index = indexNames([candidate('Banana', 'produto', { productId: 'p-banana', category: 'hortifruti' })]);
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
    // Outra grafia: vale sugerir a da casa.
    expect(names(similarNames('Arrozes', index))).toEqual(['Arroz']);
    // Idêntico ao item de uma lista aberta: a revisão já mostra esse item em "Lista de compras".
    const listed = indexNames([candidate('Arroz', 'lista', { listItemIds: ['li-1'] })]);
    expect(similarNames('Arroz', listed)).toEqual([]);
    // Outra grafia do item da lista: a sugestão leva o item junto.
    expect(similarNames('Arrozes', listed)[0]).toMatchObject({ name: 'Arroz', closeness: 'igual', listItemIds: ['li-1'] });
  });

  it('o nome da casa que cabe no nome da nota é parecido e dá para sugerir', () => {
    const index = indexNames([candidate('Arroz'), candidate('Arroz integral'), candidate('Feijão carioca')]);
    const found = similarNames('Arroz Tio João 5kg', index);
    expect(names(found)).toEqual(['Arroz']);
    expect(found[0]).toMatchObject({ closeness: 'parecido', confident: true });
  });

  it('tamanho e quantidade não contam para parecer', () => {
    const index = indexNames([candidate('Coca-Cola 350ml', 'produto', { productId: 'p-lata' })]);
    expect(similarNames('Coca Cola 2 L', index)[0]).toMatchObject({ name: 'Coca-Cola 350ml', closeness: 'parecido' });
  });

  it('o mais parecido vem antes: "Leite condensado" antes de "Leite"', () => {
    const index = indexNames([
      candidate('Leite', 'lista', { listItemIds: ['li-leite'] }),
      candidate('Leite condensado'),
      candidate('Leite integral'),
    ]);
    expect(names(similarNames('Leite Condensado Moça 395g', index))).toEqual(['Leite condensado', 'Leite']);
  });

  it('palavra em comum no meio do nome é parecido, mas não para sugerir sozinho', () => {
    const index = indexNames([candidate('Alho'), candidate('Coca', 'lista', { listItemIds: ['li-coca'] })]);
    expect(similarNames('Molho de alho', index)[0]).toMatchObject({ name: 'Alho', closeness: 'parecido', confident: false });
    expect(similarNames('Molho de alho', index, { onlyConfident: true })).toEqual([]);
    expect(similarNames('Refrigerante Coca-Cola 2L', index)[0]).toMatchObject({ name: 'Coca', confident: false });
  });

  it('nome mais específico que o digitado é parecido, mas não para sugerir sozinho', () => {
    const index = indexNames([candidate('Leite integral Italac 1L', 'produto', { productId: 'p-leite' })]);
    expect(similarNames('Leite', index)[0]).toMatchObject({ productId: 'p-leite', closeness: 'parecido', confident: false });
  });

  it('entende a abreviação da nota fiscal', () => {
    const index = indexNames([candidate('Detergente'), candidate('Refrigerante'), candidate('Papelão')]);
    expect(similarNames('Deterg Ype 500ml', index)[0]).toMatchObject({ name: 'Detergente', confident: true });
    expect(names(similarNames('Refrig Coca Cola 2l', index))).toEqual(['Refrigerante']);
    // "papel" é palavra inteira, não abreviação de "papelão".
    expect(similarNames('Papel toalha', index)).toEqual([]);
  });

  it('nomes de coisas diferentes não se parecem', () => {
    const index = indexNames([candidate('Leite integral'), candidate('Pão de queijo'), candidate('Sabonete')]);
    expect(similarNames('Leite desnatado', index)).toEqual([]);
    expect(similarNames('Queijo prato', index)).toEqual([]);
    expect(similarNames('Sabão em pó', index)).toEqual([]);
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
    const index = indexNames([
      candidate('Banana', 'produto', { productId: 'p-banana' }),
      candidate('Banana prata', 'produto', { productId: 'p-prata' }),
      candidate('Banana nanica', 'produto', { productId: 'p-nanica' }),
    ]);
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

  it('com os itens comuns, a nota do mercado acha o nome simples', () => {
    const index = indexNames(nameCandidates({ products: [], listItems: [], purchases: [], common: COMMON_ITEMS }));
    const best = (name: string) => similarNames(name, index, { onlyConfident: true, limit: 1 })[0]?.name;
    expect(best('Arroz Tj 5kg')).toBe('Arroz');
    expect(best('Leite Condensado Moca 395g')).toBe('Leite condensado');
    expect(best('Deterg Liq Ype 500ml')).toBe('Detergente');
    expect(best('Banana Prata Kg')).toBe('Banana');
    expect(best('Molho De Tomate Fugini 300g')).toBe('Molho de tomate');
    expect(best('Cerveja Heineken 330ml')).toBe('Cerveja');
    expect(best('Pilha Alcalina Aa')).toBe('Pilhas');
    expect(best('Carregador Usb')).toBeUndefined();
  });
});

describe('nameSourceLabel', () => {
  it('diz de onde o nome vem', () => {
    expect(nameSourceLabel({ source: 'produto', listItemIds: [] })).toBe('Produto da casa');
    expect(nameSourceLabel({ source: 'produto', listItemIds: ['li-1'] })).toBe('Produto da casa, na lista de compras');
    expect(nameSourceLabel({ source: 'lista', listItemIds: ['li-1'] })).toBe('Está na lista de compras');
    expect(nameSourceLabel({ source: 'comprado', listItemIds: [] })).toBe('Comprado antes');
    expect(nameSourceLabel({ source: 'comum', listItemIds: [] })).toBe('Item comum da lista');
  });
});

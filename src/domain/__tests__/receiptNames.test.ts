import { describe, expect, it } from '@jest/globals';

import { houseNameOverride, keptName, noteNames, sameProduct, typedNameActions, typedNameOverride, withEntry } from '../receiptNames';
import type { ItemOverride } from '../receiptReview';
import { existingNameLabel, indexNames, type NameCandidate } from '../similarNames';

const candidate = (name: string, source: NameCandidate['source'], extra: Partial<NameCandidate> = {}): NameCandidate => ({
  name,
  category: 'outros',
  productId: null,
  source,
  listItemIds: [],
  ...extra,
});

const products = new Set(['p-banana', 'p-arroz']);
const house = indexNames([
  candidate('Banana', 'produto', { productId: 'p-banana', category: 'hortifruti' }),
  candidate('Arroz', 'produto', { productId: 'p-arroz', category: 'graos' }),
  candidate('leite', 'lista', { listItemIds: ['li-leite'], category: 'laticinios' }),
  candidate('banana prata', 'lista', { listItemIds: ['li-prata'] }),
  candidate('FEIJAO', 'comprado', { category: 'graos' }),
  candidate('Tomate', 'comprado', { category: 'hortifruti' }),
  candidate('Açúcar', 'comum', { category: 'doces' }),
]);
const none = indexNames([]);
const doces = { category: 'doces' };

describe('houseNameOverride', () => {
  it('nome de um produto da casa: liga o item a ele', () => {
    expect(houseNameOverride({ name: 'Banana', category: 'hortifruti', productId: 'p-banana' }, doces, products)).toEqual({
      product: { kind: 'existing', productId: 'p-banana' },
    });
  });

  it('nome sem produto: produto novo com a grafia e a categoria da casa, e a despensa volta ao padrão da categoria', () => {
    const change = houseNameOverride({ name: 'leite', category: 'laticinios', productId: null }, doces, products);
    expect(change.product).toEqual({ kind: 'new', name: 'leite', category: 'laticinios' });
    // A chave vem presente e vazia: é ela que desfaz a escolha de despensa feita antes.
    expect('pantry' in change).toBe(true);
    expect(change.pantry).toBeUndefined();
  });

  it('nome da casa em "Outros" fica com a categoria que a nota já tinha, sem mexer na despensa', () => {
    const change = houseNameOverride({ name: 'banana prata', category: 'outros', productId: null }, { category: 'hortifruti' }, products);
    expect(change).toEqual({ product: { kind: 'new', name: 'banana prata', category: 'hortifruti' } });
    expect('pantry' in change).toBe(false);
  });

  it('mesma categoria: a escolha de despensa fica', () => {
    const change = houseNameOverride({ name: 'Açúcar', category: 'doces', productId: null }, doces, products);
    expect('pantry' in change).toBe(false);
  });

  it('produto que não existe mais vira produto novo com o nome', () => {
    expect(houseNameOverride({ name: 'Coca', category: 'bebidas', productId: 'p-apagado' }, { category: 'bebidas' }, products).product).toEqual({
      kind: 'new',
      name: 'Coca',
      category: 'bebidas',
    });
  });
});

describe('typedNameOverride', () => {
  const typed = (name: string, indexes = [house, none]) => typedNameOverride(name, indexes, doces, products).product;

  it('as mesmas letras de um produto da casa: é ele', () => {
    expect(typed('banana')).toEqual({ kind: 'existing', productId: 'p-banana' });
    expect(typed(' ARROZ ')).toEqual({ kind: 'existing', productId: 'p-arroz' });
  });

  it('as mesmas letras de um nome sem produto: vale o que a pessoa digitou, com a categoria do item', () => {
    // A lista tem "leite", minúsculo e em Laticínios: nada disso passa para o produto novo.
    expect(typed('Leite')).toEqual({ kind: 'new', name: 'Leite', category: 'doces' });
    expect(typed('Feijao')).toEqual({ kind: 'new', name: 'Feijao', category: 'doces' });
  });

  it('digitado tudo minúsculo ou tudo maiúsculo: vale a grafia da casa, se ela for melhor', () => {
    expect(typed('tomate')).toEqual({ kind: 'new', name: 'Tomate', category: 'doces' });
    expect(typed('TOMATE')).toEqual({ kind: 'new', name: 'Tomate', category: 'doces' });
    // A da casa também é tudo minúsculo ou maiúsculo: fica o digitado.
    expect(typed('LEITE')).toEqual({ kind: 'new', name: 'LEITE', category: 'doces' });
    expect(typed('feijao')).toEqual({ kind: 'new', name: 'feijao', category: 'doces' });
  });

  it('outra grafia (acento, plural) ou nome que a casa não tem: produto novo como digitado', () => {
    expect(typed('acucar')).toEqual({ kind: 'new', name: 'acucar', category: 'doces' });
    expect(typed('Bananas')).toEqual({ kind: 'new', name: 'Bananas', category: 'doces' });
    expect(typed('Pitaya')).toEqual({ kind: 'new', name: 'Pitaya', category: 'doces' });
  });

  it('confere também os nomes desta nota', () => {
    const note = indexNames([candidate('Pitaya', 'nota', { category: 'hortifruti' })]);
    expect(typed('pitaya', [house, note])).toEqual({ kind: 'new', name: 'Pitaya', category: 'doces' });
  });
});

describe('typedNameActions', () => {
  const note = indexNames([candidate('Pitaya', 'nota', { category: 'hortifruti' })]);
  const actions = (name: string) => {
    const { existing, create } = typedNameActions(name, house, note, doces, products);
    return { existing: existing?.name ?? null, create: create?.title ?? null, product: create?.override.product ?? null };
  };

  it('nome novo: só o botão de criar', () => {
    expect(actions('Carregador')).toEqual({
      existing: null,
      create: 'Novo produto "Carregador"',
      product: { kind: 'new', name: 'Carregador', category: 'doces' },
    });
  });

  it('outra grafia de um nome da casa: usar o que já existe vem antes de criar', () => {
    expect(actions('Bananas')).toEqual({
      existing: 'Banana',
      create: 'Criar "Bananas" mesmo assim',
      product: { kind: 'new', name: 'Bananas', category: 'doces' },
    });
    expect(actions('Pitayas')).toMatchObject({ existing: 'Pitaya', create: 'Criar "Pitayas" mesmo assim' });
  });

  it('nome que só o catálogo tem não "já existe": criar não é "mesmo assim"', () => {
    expect(actions('acucar')).toMatchObject({ existing: 'Açúcar', create: 'Novo produto "acucar"' });
  });

  it('nome do catálogo que a pessoa já deu a outro item desta nota: usar o desta nota, com a categoria que ela deu', () => {
    const sugar = indexNames([candidate('Açúcar', 'nota', { category: 'graos' })]);
    const { existing, create } = typedNameActions('acucar', house, sugar, doces, products);
    expect(existing).toMatchObject({ name: 'Açúcar', source: 'nota', category: 'graos' });
    expect(existingNameLabel(existing!)).toBe('Usar "Açúcar" (já está nesta nota)');
    expect(create?.title).toBe('Criar "acucar" mesmo assim');
  });

  it('as mesmas letras de um produto da casa: só dá para usar o produto', () => {
    expect(actions('banana')).toEqual({ existing: 'Banana', create: null, product: null });
  });

  it('as mesmas letras de um nome sem produto: o botão mostra o nome que vai ficar', () => {
    expect(actions('tomate')).toEqual({ existing: null, create: 'Novo produto "Tomate"', product: { kind: 'new', name: 'Tomate', category: 'doces' } });
    expect(actions('Leite')).toMatchObject({ existing: null, create: 'Novo produto "Leite"' });
  });

  it('sem texto, nada a oferecer', () => {
    expect(typedNameActions('  ', house, note, doces, products)).toEqual({ existing: null, create: null });
  });
});

describe('keptName', () => {
  it('produto novo é um nome que a pessoa decidiu; produto da casa ou nenhum, não', () => {
    expect(keptName({ product: { kind: 'new', name: 'Pitaya', category: 'hortifruti' } })).toBe('Pitaya');
    expect(keptName({ product: { kind: 'existing', productId: 'p-banana' } })).toBeNull();
    expect(keptName({ product: { kind: 'none' } })).toBeNull();
    expect(keptName({ pantry: true })).toBeNull();
  });
});

describe('sameProduct', () => {
  it('o mesmo produto da casa, ou o mesmo nome e categoria de produto novo', () => {
    expect(sameProduct({ kind: 'existing', productId: 'p-1' }, { kind: 'existing', productId: 'p-1' })).toBe(true);
    expect(sameProduct({ kind: 'existing', productId: 'p-1' }, { kind: 'existing', productId: 'p-2' })).toBe(false);
    expect(sameProduct({ kind: 'new', name: 'Arroz', category: 'graos' }, { kind: 'new', name: 'Arroz', category: 'graos' })).toBe(true);
    expect(sameProduct({ kind: 'new', name: 'Arroz', category: 'graos' }, { kind: 'new', name: 'arroz', category: 'graos' })).toBe(false);
    expect(sameProduct({ kind: 'new', name: 'Arroz', category: 'graos' }, { kind: 'new', name: 'Arroz', category: 'outros' })).toBe(false);
    expect(sameProduct({ kind: 'none' }, { kind: 'none' })).toBe(true);
    expect(sameProduct({ kind: 'none' }, { kind: 'existing', productId: 'p-1' })).toBe(false);
    expect(sameProduct(undefined, { kind: 'none' })).toBe(false);
  });
});

describe('noteNames', () => {
  const items = [
    { id: 'r1', product: { kind: 'new', name: 'Pitaya', category: 'hortifruti' } as const },
    { id: 'r2', product: { kind: 'new', name: 'Detergente Ypê Neutro 500ml', category: 'limpeza' } as const },
    { id: 'r3', product: { kind: 'existing', productId: 'p-banana' } as const },
    { id: 'r4', product: { kind: 'new', name: 'Bananas', category: 'hortifruti' } as const },
  ];

  it('só os nomes que a pessoa deu a produtos novos em outros itens, não a leitura que ninguém tocou', () => {
    const kept = { r1: 'Pitaya', r3: 'Banana', r4: 'Banana nanica' };
    expect(noteNames(items, kept, 'r2')).toEqual([{ name: 'Pitaya', category: 'hortifruti', productId: null, source: 'nota', listItemIds: [] }]);
    // O próprio item não é candidato para ele mesmo.
    expect(noteNames(items, kept, 'r1')).toEqual([]);
    expect(noteNames(items, {}, 'r2')).toEqual([]);
  });
});

describe('withEntry', () => {
  const before: Record<string, ItemOverride> = { r1: { pantry: false }, r2: { product: { kind: 'none' } } };

  it('põe o valor de volta, ou tira a chave quando não havia nada', () => {
    expect(withEntry(before, 'r1', { pantry: true })).toEqual({ r1: { pantry: true }, r2: { product: { kind: 'none' } } });
    const without = withEntry(before, 'r2', undefined);
    expect(without).toEqual({ r1: { pantry: false } });
    expect('r2' in without).toBe(false);
    // O original não muda.
    expect(Object.keys(before)).toEqual(['r1', 'r2']);
  });
});

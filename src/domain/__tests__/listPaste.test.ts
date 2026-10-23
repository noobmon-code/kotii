import { describe, expect, it } from '@jest/globals';

import { listShareText, type ShareItem } from '../listShare';
import { PASTE_MAX_ITEMS, parsePastedList, pastePreview, pasteToAdd, type PastedItem } from '../listPaste';

/** Nome, quantidade e unidade de cada item lido. */
const read = (text: string) => parsePastedList(text).items.map(({ name, quantity, unit }) => [name, quantity, unit]);

describe('parsePastedList: os formatos', () => {
  it('um item por linha, com marcadores e emojis no começo, e as linhas vazias de fora', () => {
    const text = ['- Arroz', '', '• Feijão', '* Óleo', '✅ Café', '🍌 banana', '   ', '1. Sal', '2) Açúcar', '[ ] Leite', '[x] Pão', '> Ovos', '— Sabonete'].join('\n');
    expect(read(text).map(([name]) => name)).toEqual(['Arroz', 'Feijão', 'Óleo', 'Café', 'Banana', 'Sal', 'Açúcar', 'Leite', 'Pão', 'Ovos', 'Sabonete']);
    expect(read(text).every(([, quantity, unit]) => quantity === 1 && unit === 'un')).toBe(true);
  });

  it('quantidade e unidade no começo: "- 2 kg arroz", "2x leite", "2kg de arroz", "500g queijo", "1,5 l suco"', () => {
    expect(read('- 2 kg arroz')).toEqual([['Arroz', 2, 'kg']]);
    expect(read('2x leite')).toEqual([['Leite', 2, 'un']]);
    expect(read('2 x leite')).toEqual([['Leite', 2, 'un']]);
    expect(read('2kg de arroz')).toEqual([['Arroz', 2, 'kg']]);
    expect(read('500g queijo muçarela')).toEqual([['Queijo muçarela', 500, 'g']]);
    expect(read('1,5 l suco de uva')).toEqual([['Suco de uva', 1.5, 'l']]);
    expect(read('1.5 litros de leite')).toEqual([['Leite', 1.5, 'l']]);
    expect(read('3 leite')).toEqual([['Leite', 3, 'un']]);
    // Embalagem conta como unidade.
    expect(read('2 pacotes de macarrão')).toEqual([['Macarrão', 2, 'un']]);
    expect(read('1 cx. de leite')).toEqual([['Leite', 1, 'un']]);
  });

  it('quantidade depois do nome: "leite (2)", "leite x2", "leite 2x", "arroz (5 kg)"', () => {
    expect(read('leite (2)')).toEqual([['Leite', 2, 'un']]);
    expect(read('Leite x2')).toEqual([['Leite', 2, 'un']]);
    expect(read('Leite 2x')).toEqual([['Leite', 2, 'un']]);
    expect(read('Arroz (5 kg)')).toEqual([['Arroz', 5, 'kg']]);
    expect(read('- Pão francês (10x)')).toEqual([['Pão francês', 10, 'un']]);
  });

  it('a observação entre parênteses sai do nome; parênteses que são o nome do item comum ficam', () => {
    expect(read('Leite (sem lactose)')).toEqual([['Leite', 1, 'un']]);
    expect(read('Leite (marca X (ou Y))')).toEqual([['Leite', 1, 'un']]);
    expect(read('Ovos (dúzia)')).toEqual([['Ovos (dúzia)', 1, 'un']]);
    expect(read('Ovos (30 un)')).toEqual([['Ovos (30 un)', 1, 'un']]);
    expect(read('Ovos (dúzia) (caipira)')).toEqual([['Ovos (dúzia)', 1, 'un']]);
  });

  it('vírgulas e ponto e vírgula separam itens numa linha só, mas não "1,5 kg" nem a observação', () => {
    expect(read('arroz, feijão; óleo')).toEqual([['Arroz', 1, 'un'], ['Feijão', 1, 'un'], ['Óleo', 1, 'un']]);
    expect(read('1,5 kg tomate, alface')).toEqual([['Tomate', 1.5, 'kg'], ['Alface', 1, 'un']]);
    expect(read('Sabão em pó (o de 1,6 kg, caixa azul), detergente')).toEqual([['Sabão em pó', 1, 'un'], ['Detergente', 1, 'un']]);
  });

  it('títulos da pessoa ("Feira:"), linhas só com número ou só com símbolos não viram item', () => {
    expect(read(['Lista do mercado:', 'Feira:', '2', '---', '🛒🛒', '- Banana'].join('\n'))).toEqual([['Banana', 1, 'un']]);
  });

  it('emojis e pontuação no fim saem; o que a pessoa escreveu com maiúscula fica como está', () => {
    expect(read('Leite 🥛!!')).toEqual([['Leite', 1, 'un']]);
    expect(read('Leite 0%')).toEqual([['Leite 0%', 1, 'un']]);
    expect(read('café Pilão')).toEqual([['café Pilão', 1, 'un']]);
  });

  it('a categoria: a do item comum de mesmo nome, ou o chute pelo nome', () => {
    const items = parsePastedList('Rúcula\nArroz\nDetergente\nCoisa estranha').items;
    expect(items.map((i) => i.category)).toEqual(['hortifruti', 'graos', 'limpeza', 'outros']);
  });

  it(`até ${PASTE_MAX_ITEMS} itens; o resto é contado para a prévia dizer`, () => {
    const text = Array.from({ length: PASTE_MAX_ITEMS + 7 }, (_, i) => `Item ${i + 1}`).join('\n');
    const { items, cut } = parsePastedList(text);
    expect(items).toHaveLength(PASTE_MAX_ITEMS);
    expect(items[PASTE_MAX_ITEMS - 1].name).toBe(`Item ${PASTE_MAX_ITEMS}`);
    expect(cut).toBe(7);
    expect(parsePastedList('Arroz').cut).toBe(0);
  });

  it('texto vazio: nada', () => {
    expect(parsePastedList('')).toEqual({ items: [], cut: 0 });
    expect(parsePastedList('\n\n  \n')).toEqual({ items: [], cut: 0 });
  });
});

describe('parsePastedList: o texto que o próprio app manda', () => {
  const item = (name: string, over: Partial<ShareItem> = {}): ShareItem => ({
    name,
    category: 'outros',
    quantity: 1,
    unit: 'un',
    notes: null,
    priority: 'normal',
    checked_at: null,
    ...over,
  });
  const longList: ShareItem[] = [
    item('Detergente', { category: 'limpeza', quantity: 2 }),
    item('Arroz', { category: 'graos', quantity: 5, unit: 'kg' }),
    item('Tomate', { category: 'hortifruti', quantity: 0.5, unit: 'kg' }),
    item('Leite integral', { category: 'laticinios', quantity: 6, priority: 'urgente' }),
    item('Banana', { category: 'hortifruti' }),
    item('Queijo minas', { category: 'laticinios', priority: 'se_der' }),
    item('Sabão em pó', { category: 'limpeza', notes: 'o de 1,6 kg, caixa azul', priority: 'promocao' }),
    item('Fralda', { category: 'bebe', notes: 'tamanho G', priority: 'urgente' }),
    item('Suco de uva', { category: 'bebidas', quantity: 1.5, unit: 'l' }),
    item('Presunto', { category: 'frios', quantity: 500, unit: 'g' }),
    item('Ovos (dúzia)', { category: 'ovos', quantity: 2 }),
    item('Papel higiênico', { category: 'papel', quantity: 1500.5, unit: 'g' }),
    item('Café', { category: 'cafe_cha', checked_at: '2026-10-12T10:00:00Z' }),
  ];
  const same = (items: readonly ShareItem[]) =>
    items
      .filter((i) => !i.checked_at)
      .map((i) => [i.name, i.quantity, i.unit])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const back = (text: string) => read(text).sort((a, b) => String(a[0]).localeCompare(String(b[0])));

  it('ida e volta, com seções: o título e as seções ficam de fora, e a observação e a prioridade saem', () => {
    const text = listShareText({ name: 'Mercado da semana' }, longList)!;
    expect(text).toContain('*Urgente*');
    expect(text).toContain('· só em promoção');
    expect(back(text)).toEqual(same(longList));
  });

  it('ida e volta, lista curta (sem seções) e com um item só (sem a contagem)', () => {
    const short = longList.slice(0, 5);
    expect(back(listShareText({ name: 'Feira' }, short)!)).toEqual(same(short));
    const one = [item('Dipirona', { category: 'medicamentos', notes: 'em gotas' })];
    expect(listShareText({ name: 'Farmácia' }, one)).toBe('*Farmácia*\n- Dipirona (em gotas)');
    expect(back(listShareText({ name: 'Farmácia' }, one)!)).toEqual([['Dipirona', 1, 'un']]);
  });
});

describe('pastePreview', () => {
  const pasted = (name: string, quantity = 1, unit: PastedItem['unit'] = 'un', category = 'outros'): PastedItem => ({ name, quantity, unit, category });
  const pending = [
    { name: 'Leite IL Desnatado', category: 'laticinios', checked_at: null },
    { name: 'Café', category: 'cafe_cha', checked_at: null },
    // No carrinho: não está "para comprar", então entra.
    { name: 'Banana', category: 'hortifruti', checked_at: '2026-10-20T10:00:00Z' },
  ];

  it('o que já está para comprar (com este nome ou com a marca) aparece como "já está na lista" e não entra', () => {
    const rows = pastePreview(
      [pasted('Leite desnatado', 2, 'un', 'laticinios'), pasted('café', 1, 'un', 'cafe_cha'), pasted('Banana', 1, 'kg', 'hortifruti'), pasted('Arroz', 5, 'kg', 'graos')],
      pending,
    );
    expect(rows.map((r) => [r.item.name, r.listed])).toEqual([
      ['Leite desnatado', 'Leite IL Desnatado'],
      ['café', 'Café'],
      ['Banana', null],
      ['Arroz', null],
    ]);
    expect(pasteToAdd(rows).map((i) => i.name)).toEqual(['Banana', 'Arroz']);
  });

  it('o mesmo item duas vezes no texto: na mesma unidade, um só com a soma; em outra unidade, os dois', () => {
    const rows = pastePreview(
      [pasted('Arroz', 2, 'kg', 'graos'), pasted('arroz', 1, 'kg', 'graos'), pasted('Arroz', 1, 'un', 'graos'), pasted('Café'), pasted('Café')],
      pending,
    );
    expect(rows.map((r) => [r.item.name, r.item.quantity, r.item.unit, r.listed])).toEqual([
      ['Arroz', 3, 'kg', null],
      ['Arroz', 1, 'un', null],
      ['Café', 1, 'un', 'Café'],
    ]);
  });
});

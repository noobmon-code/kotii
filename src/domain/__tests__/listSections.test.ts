import { describe, expect, it } from '@jest/globals';

import { listShareText } from '../listShare';
import { SECTIONS_ABOVE, shoppingSections, type SectionItem } from '../listSections';

const item = (name: string, category: string, priority: string | null = 'normal'): SectionItem & { quantity: number; unit: string } => ({
  name,
  category,
  priority,
  quantity: 1,
  unit: 'un',
});

/** 10 itens fora de ordem, com dois urgentes. */
const many = [
  item('Detergente', 'limpeza'),
  item('Arroz', 'graos'),
  item('Tomate', 'hortifruti'),
  item('Leite', 'laticinios', 'urgente'),
  item('Banana', 'hortifruti'),
  item('Fralda', 'bebe', 'urgente'),
  item('Feijão', 'graos'),
  item('Suco', 'bebidas'),
  item('Coisa', 'nao_existe'),
  item('Papel higiênico', 'papel'),
];

describe('shoppingSections', () => {
  it('com muitos itens: urgentes primeiro, depois cada corredor na ordem do mercado, e o desconhecido em "Outros"', () => {
    expect(shoppingSections(many).map((s) => [s.title, s.items.map((i) => i.name)])).toEqual([
      ['Urgente', ['Leite', 'Fralda']],
      ['Frutas e verduras', ['Banana', 'Tomate']],
      ['Grãos, massas e cereais', ['Arroz', 'Feijão']],
      ['Bebidas', ['Suco']],
      ['Limpeza', ['Detergente']],
      ['Papel e descartáveis', ['Papel higiênico']],
      ['Outros', ['Coisa']],
    ]);
  });

  it('a mesma ordem e os mesmos títulos do texto do WhatsApp', () => {
    const text = listShareText({ name: 'Mercado' }, many)!;
    const fromText = text
      .split('\n')
      // As seções; o título ("*Mercado* · 10 itens") tem a contagem depois.
      .filter((line) => /^\*.*\*$/.test(line))
      .map((line) => line.slice(1, -1));
    expect(fromText).toEqual(shoppingSections(many).map((s) => s.title));
    const names = text
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2));
    expect(names).toEqual(shoppingSections(many).flatMap((s) => s.items.map((i) => i.name)));
  });

  it(`até ${SECTIONS_ABOVE} itens, como hoje: uma seção sem título, na ordem de "Para comprar"`, () => {
    const few = many.slice(0, SECTIONS_ABOVE);
    const sections = shoppingSections(few);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBeNull();
    expect(sections[0].items.map((i) => i.name)).toEqual(['Leite', 'Fralda', 'Banana', 'Tomate', 'Arroz', 'Feijão', 'Suco', 'Detergente']);
  });

  it('muitos itens de uma seção só: sem título', () => {
    const all = Array.from({ length: 12 }, (_, i) => item(`Item ${i + 1}`, 'limpeza'));
    expect(shoppingSections(all).map((s) => s.title)).toEqual([null]);
  });

  it('sem itens, nenhuma seção; a lista recebida não muda de ordem', () => {
    expect(shoppingSections([])).toEqual([]);
    const copy = [...many];
    shoppingSections(many);
    expect(many).toEqual(copy);
  });
});

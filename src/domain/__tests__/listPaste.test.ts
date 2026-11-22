import { readFileSync } from 'fs';
import { join } from 'path';

import { describe, expect, it } from '@jest/globals';

import { listShareText, type ShareItem } from '../listShare';
import { PASTE_MAX_ITEMS, parsePastedList, pastePreview, pasteToAdd, readListLine, type PastedItem } from '../listPaste';

/** Nome, quantidade e unidade de cada item lido. */
const read = (text: string) => parsePastedList(text).items.map(({ name, quantity, unit }) => [name, quantity, unit]);
/** A linha digitada no campo de pôr item: nome, quantidade, unidade e se ela disse a quantidade. */
const typed = (text: string) => {
  const line = readListLine(text);
  return line && [line.name, line.quantity, line.unit, line.counted];
};

describe('readListLine: a linha digitada no campo de pôr item', () => {
  it('lê a quantidade como a colagem: na frente, com unidade, embalagem, dúzia e fração', () => {
    expect(typed('2 kg arroz')).toEqual(['Arroz', 2, 'kg', true]);
    expect(typed('2kg de arroz')).toEqual(['Arroz', 2, 'kg', true]);
    expect(typed('500 g queijo')).toEqual(['Queijo', 500, 'g', true]);
    expect(typed('1 dz ovos')).toEqual(['Ovos', 12, 'un', true]);
    expect(typed('2 pacotes de arroz')).toEqual(['Arroz', 2, 'un', true]);
    expect(typed('½ kg presunto')).toEqual(['Presunto', 0.5, 'kg', true]);
    expect(typed('1,5 l suco de uva')).toEqual(['Suco de uva', 1.5, 'l', true]);
    expect(typed('3 leite')).toEqual(['Leite', 3, 'un', true]);
    expect(typed('2x leite')).toEqual(['Leite', 2, 'un', true]);
  });

  it('a quantidade depois do nome também conta como dita: "leite (2)", "leite x2", "arroz (5 kg)"', () => {
    expect(typed('leite (2)')).toEqual(['Leite', 2, 'un', true]);
    expect(typed('Leite x2')).toEqual(['Leite', 2, 'un', true]);
    expect(typed('Leite 2x')).toEqual(['Leite', 2, 'un', true]);
    expect(typed('Arroz (5 kg)')).toEqual(['Arroz', 5, 'kg', true]);
  });

  it('sem quantidade na linha, 1 un, e não conta como dita', () => {
    expect(typed('arroz')).toEqual(['Arroz', 1, 'un', false]);
    expect(typed('  Leite desnatado ')).toEqual(['Leite desnatado', 1, 'un', false]);
  });

  it('o tamanho que é parte do nome fica no nome, como na colagem; o número que é do nome também', () => {
    expect(typed('Café Pilão 500g')).toEqual(['Café Pilão 500g', 1, 'un', false]);
    expect(typed('arroz 2kg')).toEqual(['Arroz 2kg', 1, 'un', false]);
    expect(typed('Coca 2l')).toEqual(['Coca 2l', 1, 'un', false]);
    expect(typed('2 em 1 shampoo')).toEqual(['2 em 1 shampoo', 1, 'un', false]);
    expect(typed('Ovos (dúzia)')).toEqual(['Ovos (dúzia)', 1, 'un', false]);
  });

  it('a mesma leitura da linha colada: cada exemplo dá o mesmo item nos dois caminhos', () => {
    for (const text of ['2 kg arroz', 'arroz 2kg', '500 g queijo', '1 dz ovos', '2 pacotes de arroz', '½ kg presunto', 'leite (2)', 'Leite (marca X)', '- Café']) {
      const line = readListLine(text)!;
      const { name, quantity, unit, category } = line;
      expect([{ name, quantity, unit, category }]).toEqual(parsePastedList(text).items);
    }
  });

  it('a observação entre parênteses sai, como na colagem, menos a que diz o que se pode comprar', () => {
    expect(typed('Leite (marca X)')).toEqual(['Leite', 1, 'un', false]);
    expect(typed('Leite (sem lactose)')).toEqual(['Leite (sem lactose)', 1, 'un', false]);
    expect(typed('Pão de forma (sem glúten)')).toEqual(['Pão de forma (sem glúten)', 1, 'un', false]);
    expect(typed('Refrigerante (zero)')).toEqual(['Refrigerante (zero)', 1, 'un', false]);
    expect(typed('Leite em pó (Ninho)')).toEqual(['Leite em pó (Ninho)', 1, 'un', false]);
    expect(typed('2 pão (sem glúten)')).toEqual(['Pão (sem glúten)', 2, 'un', true]);
    expect(typed('fralda (infantil) x3')).toEqual(['Fralda (infantil)', 3, 'un', true]);
    expect(typed('2 kg arroz (integral)')).toEqual(['Arroz (integral)', 2, 'kg', true]);
    // A quantidade depois dela continua sendo a quantidade; a observação que não decide nada, depois dela, sai.
    expect(typed('Leite (sem lactose) (2)')).toEqual(['Leite (sem lactose)', 2, 'un', true]);
    expect(typed('Leite (desnatado) (o de caixinha)')).toEqual(['Leite (desnatado)', 1, 'un', false]);
  });

  it('a quantidade escrita antes da observação que fica também é lida, e não fica no nome', () => {
    expect(typed('Leite x2 (sem lactose)')).toEqual(['Leite (sem lactose)', 2, 'un', true]);
    expect(typed('Leite 2x (zero lactose)')).toEqual(['Leite (zero lactose)', 2, 'un', true]);
    expect(typed('Pão de forma 2x (integral)')).toEqual(['Pão de forma (integral)', 2, 'un', true]);
    expect(typed('Leite (sem lactose) x2')).toEqual(['Leite (sem lactose)', 2, 'un', true]);
    // Com a observação que não decide nada, como sempre.
    expect(typed('Leite x2 (marca X)')).toEqual(['Leite', 2, 'un', true]);
  });

  it('a observação que decide a compra: colada, ela sai sempre, porque é onde o texto do app escreve a descrição', () => {
    // Digitada, "(sem lactose)" é o pedido; colada, pode ser a descrição de um item que já está na lista (listShare).
    for (const [text, name] of [
      ['Leite (sem lactose)', 'Leite'],
      ['Leite x2 (sem lactose)', 'Leite'],
      ['Arroz (integral)', 'Arroz'],
    ] as const) {
      expect(readListLine(text)!.name).toBe(`${name} (${text.split('(')[1]}`);
      expect(parsePastedList(text).items.map((i) => i.name)).toEqual([name]);
      expect(readListLine(text)!.quantity).toBe(parsePastedList(text).items[0].quantity);
    }
  });

  it('um item só: a vírgula fica no nome (na colagem ela separa itens), e "1,5 kg" continua a quantidade', () => {
    expect(typed('arroz, feijão')).toEqual(['Arroz, feijão', 1, 'un', false]);
    expect(typed('1,5 kg tomate')).toEqual(['Tomate', 1.5, 'kg', true]);
  });

  it('a mesma linha não dá o mesmo nos dois caminhos: a vírgula, o título e a observação que decide a compra', () => {
    // A vírgula: digitada, fica no nome de um item só; colada, separa itens.
    expect(typed('2 kg arroz, integral')).toEqual(['Arroz, integral', 2, 'kg', true]);
    expect(read('2 kg arroz, integral')).toEqual([['Arroz', 2, 'kg'], ['Integral', 1, 'un']]);
    expect(typed('arroz, feijão')).toEqual(['Arroz, feijão', 1, 'un', false]);
    expect(read('arroz, feijão')).toEqual([['Arroz', 1, 'un'], ['Feijão', 1, 'un']]);
    expect(typed('Pão, de preferência integral')).toEqual(['Pão, de preferência integral', 1, 'un', false]);
    expect(read('Pão, de preferência integral')).toEqual([['Pão', 1, 'un'], ['De preferência integral', 1, 'un']]);
    // O título: a primeira linha em negrito, colada, é o título da lista; digitada, é o item.
    expect(typed('*Arroz*')).toEqual(['Arroz', 1, 'un', false]);
    expect(read('*Arroz*')).toEqual([]);
    expect(typed('*Laticínios*')).toEqual(['Laticínios', 1, 'un', false]);
    expect(read('- Leite\n*Laticínios*')).toEqual([['Leite', 1, 'un']]);
    // A observação que decide a compra: digitada, fica no nome; colada, sai.
    expect(typed('Leite (sem lactose)')).toEqual(['Leite (sem lactose)', 1, 'un', false]);
    expect(read('Leite (sem lactose)')).toEqual([['Leite', 1, 'un']]);
  });

  it('a caixinha sai inteira depois de um emoji ou de outro marcador, digitada e colada', () => {
    // Antes, digitada, o "[" saía sozinho com o emoji e o "x] " ficava no nome: "X] 2 kg arroz" a 1 un.
    expect(typed('✅ [x] 2 kg arroz')).toEqual(['Arroz', 2, 'kg', true]);
    expect(read('✅ [x] 2 kg arroz')).toEqual([['Arroz', 2, 'kg']]);
    expect(typed('✅ [x] Arroz')).toEqual(['Arroz', 1, 'un', false]);
    expect(typed('☑ [x] leite')).toEqual(['Leite', 1, 'un', false]);
    expect(typed('🛒 [X] pão')).toEqual(['Pão', 1, 'un', false]);
    // A lista de tarefas do Markdown ("- [x] arroz") e a numerada também: antes, nos dois caminhos, "X] arroz".
    for (const text of ['- [x] arroz', '* [x] arroz', '1. [x] arroz', '- ✅ [x] arroz', '✅ - [x] arroz', '• [✓] arroz']) {
      expect(typed(text)).toEqual(['Arroz', 1, 'un', false]);
      expect(read(text)).toEqual([['Arroz', 1, 'un']]);
    }
  });

  it('fora as três diferenças, as duas leituras dão o mesmo item: linhas ao acaso com marcadores, emojis e quantidades', () => {
    const tokens = ['✅', '☑', '🛒', '🍌', '1️⃣', '🔟', '©', '-', '•', '*', '_', '>', '—', '[x]', '[X]', '[ ]', '[✓]', '[', ']',
      'x', '×', '2', '1.', '2)', '1,5', '½', 'kg', 'g', 'un', 'dz', 'pacotes', 'de', 'em', 'arroz', 'leite', 'pão', 'Ovos',
      '(2)', '(2 kg)', '(marca X)', '(', ')', 'x2', '2x', '·', 'urgente', ':', '!', '#', '*Arroz*', '_Feira_'];
    // Sorteio com semente (mulberry32): as mesmas linhas a cada rodada.
    let state = 20261122;
    const next = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = Math.imul(state ^ (state >>> 15), state | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const differ: string[] = [];
    for (let n = 0; n < 20000; n++) {
      const parts = Array.from({ length: 1 + Math.floor(next() * 6) }, () => tokens[Math.floor(next() * tokens.length)]);
      const text = parts.join(next() < 0.7 ? ' ' : '');
      // A primeira diferença (a vírgula, o ponto e vírgula) não entra: nenhum token os tem.
      // A segunda: o título, como a colagem o vê numa linha só (a primeira), depois dos emojis do começo.
      const shown = text.replace(/^[\s\p{Extended_Pictographic}\uFE0F\u20E3]+/u, '').trim();
      if (/^\*[^*]+\*\s*·.*$/.test(shown) || /^\*[^*]+\*$/.test(shown) || /^_[^_]+_$/.test(shown)) continue;
      // A terceira (a observação que decide a compra) não entra: nenhum token a tem.
      const line = readListLine(text);
      const one = line ? [{ name: line.name, quantity: line.quantity, unit: line.unit, category: line.category }] : [];
      if (JSON.stringify(one) !== JSON.stringify(parsePastedList(text).items)) differ.push(text);
    }
    expect(differ).toEqual([]);
  });

  it('o cabeçalho de listPaste.ts e o TypedLine contam as três diferenças, e não uma só', () => {
    const source = readFileSync(join(__dirname, '..', 'listPaste.ts'), 'utf8');
    const header = source.slice(0, source.indexOf('\nimport ')).toLowerCase();
    const typedDoc = source.slice(source.lastIndexOf('/**', source.indexOf('export interface TypedLine')), source.indexOf('export interface TypedLine')).toLowerCase();
    for (const doc of [header, typedDoc]) {
      expect(doc).toContain('vírgula');
      expect(doc).toContain('título');
      expect(doc).toContain('sem lactose');
      expect(doc).toContain('três');
      expect(doc).not.toMatch(/diferença só|única diferença|a não ser pela observação/);
    }
  });

  it('a linha que não diz o que comprar não é item: só a quantidade, só um número, vazia', () => {
    for (const text of ['', '   ', '2', '2 kg', '2 kg de', '3x', '---']) expect(readListLine(text)).toBeNull();
  });

  it('a categoria: a do item comum de mesmo nome, ou o chute pelo nome', () => {
    expect(readListLine('2 kg banana')!.category).toBe('hortifruti');
    expect(readListLine('detergente')!.category).toBe('limpeza');
  });
});

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
    expect(read('Café (o de sempre)')).toEqual([['Café', 1, 'un']]);
    expect(read('Ovos (dúzia)')).toEqual([['Ovos (dúzia)', 1, 'un']]);
    expect(read('Ovos (30 un)')).toEqual([['Ovos (30 un)', 1, 'un']]);
    expect(read('Ovos (dúzia) (caipira)')).toEqual([['Ovos (dúzia)', 1, 'un']]);
  });

  it('a observação sai também quando diz o que se pode comprar: é onde o texto do app escreve a descrição', () => {
    // Colado de volta (listShare escreve "- 2 un Leite (sem lactose)"), o item é o "Leite" que já está na lista.
    expect(read('Pão de forma (sem glúten)')).toEqual([['Pão de forma', 1, 'un']]);
    expect(read('Refrigerante (zero)')).toEqual([['Refrigerante', 1, 'un']]);
    expect(read('Arroz (integral)')).toEqual([['Arroz', 1, 'un']]);
    expect(read('2 kg arroz (integral)')).toEqual([['Arroz', 2, 'kg']]);
    // A quantidade escrita antes dela é lida, e não fica no nome.
    expect(read('Leite x2 (sem lactose)')).toEqual([['Leite', 2, 'un']]);
    expect(read('Leite 2x (zero lactose)')).toEqual([['Leite', 2, 'un']]);
    expect(read('Pão de forma 2x (integral)')).toEqual([['Pão de forma', 2, 'un']]);
    // Só um parêntese no fim sai: o de antes da quantidade fica, como sempre.
    expect(read('Leite (sem lactose) (2)')).toEqual([['Leite (sem lactose)', 2, 'un']]);
    // Cada linha, um item: a vírgula dentro da observação não separa.
    expect(read('Pão (sem glúten, sem lactose), café')).toEqual([['Pão', 1, 'un'], ['Café', 1, 'un']]);
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
    expect(parsePastedList('')).toEqual({ items: [], cut: 0, more: false });
    expect(parsePastedList('\n\n  \n')).toEqual({ items: [], cut: 0, more: false });
  });

  it('numeração em outros formatos: "1- ", "1 - ", "1.Arroz", "3)Óleo" e o número em emoji não viram quantidade', () => {
    expect(read('1- Arroz\n2- Feijão\n3 - Óleo\n4 – Sal')).toEqual([['Arroz', 1, 'un'], ['Feijão', 1, 'un'], ['Óleo', 1, 'un'], ['Sal', 1, 'un']]);
    expect(read('1 - 2 kg arroz\n2 - leite (2)')).toEqual([['Arroz', 2, 'kg'], ['Leite', 2, 'un']]);
    expect(read('1.Arroz\n3)Óleo')).toEqual([['Arroz', 1, 'un'], ['Óleo', 1, 'un']]);
    const keycap = (n: string) => n + String.fromCodePoint(0xfe0f, 0x20e3);
    expect(read(`${keycap('1')} Arroz\n${keycap('3')} Óleo\n${keycap('4')}Sal`)).toEqual([['Arroz', 1, 'un'], ['Óleo', 1, 'un'], ['Sal', 1, 'un']]);
  });

  it('sem a sequência 1, 2, 3, o número com traço continua sendo a quantidade; "1.5 kg" também', () => {
    expect(read('2 - leite')).toEqual([['Leite', 2, 'un']]);
    expect(read('3 - leite\n5 - pão')).toEqual([['Leite', 3, 'un'], ['Pão', 5, 'un']]);
    expect(read('1.5 kg arroz\n2.5 kg feijão')).toEqual([['Arroz', 1.5, 'kg'], ['Feijão', 2.5, 'kg']]);
  });

  it('frações: "1/2 kg", "1 1/2 kg", "½ kg", "1½ l", "(1/2 kg)"; o que não é fração fica no nome', () => {
    expect(read('1/2 kg queijo')).toEqual([['Queijo', 0.5, 'kg']]);
    expect(read('1 1/2 kg carne')).toEqual([['Carne', 1.5, 'kg']]);
    expect(read('½ kg presunto')).toEqual([['Presunto', 0.5, 'kg']]);
    expect(read('1½ l leite')).toEqual([['Leite', 1.5, 'l']]);
    expect(read('1/3 kg de queijo')).toEqual([['Queijo', 0.333, 'kg']]);
    expect(read('Queijo (1/2 kg)')).toEqual([['Queijo', 0.5, 'kg']]);
    expect(read('23/10 compras')).toEqual([['23/10 compras', 1, 'un']]);
  });

  it('só a quantidade, sem o que comprar, não vira item; "(2) leite", "x2 leite" e dúzia valem', () => {
    expect(read('2 kg\n2 kg de\n3x\n2 un')).toEqual([]);
    // A embalagem sozinha continua sendo o nome.
    expect(read('2 garrafas\n3 latas de')).toEqual([['Garrafas', 2, 'un'], ['Latas', 3, 'un']]);
    expect(read('(2) leite\n(2 kg) arroz\nx2 pão')).toEqual([['Leite', 2, 'un'], ['Arroz', 2, 'kg'], ['Pão', 2, 'un']]);
    expect(read('1 dz ovos\n2 dúzias de ovos caipira\nBanana (1 dz)')).toEqual([['Ovos', 12, 'un'], ['Ovos caipira', 24, 'un'], ['Banana', 12, 'un']]);
  });

  it('em gramas e mililitros, "1.000" é mil; em quilos e litros, "1.500" continua um e meio', () => {
    expect(read('1.000 g farinha\n2.000 ml água\n1.500 kg carne\n1,5 g fermento')).toEqual([
      ['Farinha', 1000, 'g'],
      ['Água', 2000, 'ml'],
      ['Carne', 1.5, 'kg'],
      ['Fermento', 1.5, 'g'],
    ]);
  });

  it('negrito ou itálico no meio da lista é o item em destaque; título só na primeira linha, nas seções e com "· N itens"', () => {
    expect(read('- Arroz\n*Feijão*\n_óleo_')).toEqual([['Arroz', 1, 'un'], ['Feijão', 1, 'un'], ['Óleo', 1, 'un']]);
    expect(read('*Feira*\n- Arroz\n*Laticínios*\n- Leite\n_Urgente_\n- Pão\n*Mercado* · 3 itens\n- Sal')).toEqual([
      ['Arroz', 1, 'un'],
      ['Leite', 1, 'un'],
      ['Pão', 1, 'un'],
      ['Sal', 1, 'un'],
    ]);
  });

  it('"2 em 1" é do nome; "3 Corações" (a marca) vira 3 un de "Corações": um número na frente é a quantidade', () => {
    expect(read('2 em 1 shampoo')).toEqual([['2 em 1 shampoo', 1, 'un']]);
    // Limite conhecido: sem saber as marcas, "3 Corações" é lido como "3 leite". Quem cola corrige na lista.
    expect(read('- 3 Corações')).toEqual([['Corações', 3, 'un']]);
  });

  it('um texto enorme não trava: a linha comprida é cortada e a conta para bem depois do limite', () => {
    const lines = Array.from({ length: 1500 }, (_, i) => `item ${i + 1}`).join('\n');
    expect(parsePastedList(lines)).toMatchObject({ cut: 1000, more: true });
    expect(parsePastedList(lines).items).toHaveLength(PASTE_MAX_ITEMS);
    const long = parsePastedList('arroz,'.repeat(40000));
    expect(long.items).toHaveLength(PASTE_MAX_ITEMS);
    expect(long.more).toBe(false);
    expect(long.cut).toBeLessThan(1000);
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

  it('ida e volta: a descrição sai também quando diz o que se pode comprar ("sem lactose", "integral", "zero")', () => {
    const text = listShareText({ name: 'Mercado' }, [
      item('Leite', { category: 'laticinios', notes: 'sem lactose', quantity: 2 }),
      item('Pão de forma', { category: 'padaria', notes: 'o integral' }),
      item('Sabão em pó', { category: 'limpeza', notes: 'caixa azul' }),
    ])!;
    expect(text).toBe('*Mercado* · 3 itens\n- 2 un Leite (sem lactose)\n- Pão de forma (o integral)\n- Sabão em pó (caixa azul)');
    expect(read(text)).toEqual([['Leite', 2, 'un'], ['Pão de forma', 1, 'un'], ['Sabão em pó', 1, 'un']]);
  });

  it('o texto do app colado de volta na mesma lista: tudo "já está na lista", e só o que a pessoa acrescentou entra', () => {
    // A lista mandada para quem não tem o app, que acrescenta o que faltou e manda de volta. As descrições (também as
    // que decidem o que se pode comprar) e as prioridades vêm no texto; os nomes da lista não as têm.
    const sent: ShareItem[] = [
      item('Leite', { category: 'laticinios', notes: 'sem lactose', quantity: 2 }),
      item('Pão de forma', { category: 'padaria', notes: 'o integral' }),
      item('Refrigerante', { category: 'bebidas', notes: 'zero', priority: 'urgente' }),
      item('Arroz', { category: 'graos', notes: 'integral', quantity: 5, unit: 'kg' }),
      item('Shampoo', { category: 'higiene', notes: 'infantil' }),
      item('Sabão em pó', { category: 'limpeza', notes: 'caixa azul', priority: 'promocao' }),
      item('Ovos (dúzia)', { category: 'ovos', quantity: 2 }),
      ...longList,
    ];
    const text = `${listShareText({ name: 'Mercado' }, sent)!}\n- Café\n- 2 kg batata`;
    const pending = sent.filter((i) => !i.checked_at);
    const rows = pastePreview(parsePastedList(text).items, pending);
    expect(rows.filter((row) => !row.listed).map((row) => row.item.name)).toEqual(['Café', 'Batata']);
    expect(rows.filter((row) => row.listed).map((row) => row.listed).sort()).toEqual([...new Set(pending.map((i) => i.name))].sort());
    expect(pasteToAdd(rows).map((i) => [i.name, i.quantity, i.unit])).toEqual([['Café', 1, 'un'], ['Batata', 2, 'kg']]);
  });

  it('limites conhecidos: vírgula no nome separa em dois itens, e parêntese sem par na descrição fica no nome', () => {
    // A vírgula é o jeito mais comum de pôr vários itens numa linha ("arroz, feijão"); o nome com vírgula é raro.
    const text = listShareText({ name: 'Padaria' }, [
      item('Pão, queijo', { category: 'padaria' }),
      item('Sabão', { category: 'limpeza', notes: 'o de 1,6 kg (azul' }),
    ])!;
    expect(text).toBe('*Padaria* · 2 itens\n- Pão, queijo\n- Sabão (o de 1,6 kg (azul)');
    expect(read(text)).toEqual([['Pão', 1, 'un'], ['Queijo', 1, 'un'], ['Sabão (o de 1,6 kg', 1, 'un']]);
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

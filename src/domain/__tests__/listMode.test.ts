import { describe, expect, it } from '@jest/globals';

import {
  ADD_FIELD_PLACEHOLDER,
  addCardShape,
  addLineButton,
  addOptionsLabel,
  BARCODE_BUTTON,
  emptyListMessage,
  isUsualAmount,
  LIST_MENU_LABELS,
  listMenuActions,
  listMode,
  showsEmptyList,
  showsSuggestions,
} from '../listMode';
import { readListLine } from '../listPaste';

describe('listMode: montar a lista ou fazer a compra', () => {
  it('sem nada no carrinho e sem ida própria, montando', () => {
    expect(listMode({ archived: false, inCart: 0, ownTrip: false })).toBe('montar');
  });

  it('com item no carrinho (de qualquer pessoa da casa), modo compra', () => {
    expect(listMode({ archived: false, inCart: 1, ownTrip: false })).toBe('compra');
  });

  it('com a própria ida ao mercado nesta lista, modo compra também com o carrinho vazio', () => {
    expect(listMode({ archived: false, inCart: 0, ownTrip: true })).toBe('compra');
  });

  it('a arquivada é só para ver, com carrinho ou ida', () => {
    expect(listMode({ archived: true, inCart: 0, ownTrip: false })).toBe('ver');
    expect(listMode({ archived: true, inCart: 3, ownTrip: true })).toBe('ver');
  });
});

describe('addCardShape: o cartão de pôr item', () => {
  it('montando, inteiro (com ou sem "Mais opções", que nem aparece)', () => {
    expect(addCardShape('montar', false)).toBe('inteiro');
    expect(addCardShape('montar', true)).toBe('inteiro');
  });

  it('no modo compra, só o campo; "Mais opções" traz o cartão inteiro de volta', () => {
    expect(addCardShape('compra', false)).toBe('campo');
    expect(addCardShape('compra', true)).toBe('inteiro');
  });

  it('arquivada, nenhum', () => {
    expect(addCardShape('ver', false)).toBe('nenhum');
    expect(addCardShape('ver', true)).toBe('nenhum');
  });
});

describe('o campo de pôr item: a quantidade vem do texto', () => {
  it('o exemplo do campo diz que a quantidade vai no texto, e é lido como a linha que mostra', () => {
    expect(ADD_FIELD_PLACEHOLDER).toBe('Adicionar (ex.: 2 kg arroz)');
    const example = /ex\.: (.+)\)$/.exec(ADD_FIELD_PLACEHOLDER)![1];
    expect(readListLine(example)).toMatchObject({ name: 'Arroz', quantity: 2, unit: 'kg', counted: true });
  });

  it('a quantidade de sempre é 1 un', () => {
    expect(isUsualAmount(1, 'un')).toBe(true);
    expect(isUsualAmount(2, 'un')).toBe(false);
    expect(isUsualAmount(1, 'kg')).toBe(false);
  });

  it('o botão diz o que vai entrar: o nome lido e, fora a de sempre, a quantidade', () => {
    expect(addLineButton(readListLine('2 kg arroz')!)).toEqual({ title: 'Adicionar "Arroz" · 2 kg', label: 'Adicionar Arroz, 2 kg' });
    expect(addLineButton(readListLine('leite x2')!)).toEqual({ title: 'Adicionar "Leite" · 2 un', label: 'Adicionar Leite, 2 un' });
    expect(addLineButton(readListLine('½ kg presunto')!).title).toBe('Adicionar "Presunto" · 0,5 kg');
    expect(addLineButton(readListLine('café')!)).toEqual({ title: 'Adicionar "Café"', label: 'Adicionar Café' });
    // "1 leite" é a de sempre: o botão não repete.
    expect(addLineButton(readListLine('1 leite')!).title).toBe('Adicionar "Leite"');
    // O tamanho que é do nome fica no nome, e o botão mostra assim.
    expect(addLineButton(readListLine('Café Pilão 500g')!).title).toBe('Adicionar "Café Pilão 500g"');
  });

  it('o botão do código de barras: curto na tela, a ação inteira para o leitor de tela', () => {
    expect(BARCODE_BUTTON).toEqual({ title: 'Código de barras', label: 'Ler código de barras' });
  });
});

describe('showsSuggestions: "Acho que acabou" e "Comprados recentemente"', () => {
  it('só montando, e não enquanto digita', () => {
    expect(showsSuggestions('montar', false)).toBe(true);
    expect(showsSuggestions('montar', true)).toBe(false);
  });

  it('somem no modo compra e na arquivada', () => {
    expect(showsSuggestions('compra', false)).toBe(false);
    expect(showsSuggestions('ver', false)).toBe(false);
  });
});

describe('showsEmptyList e emptyListMessage: a lista sem itens', () => {
  it('com item, nunca', () => {
    expect(showsEmptyList({ mode: 'montar', items: 1, suggestions: 0 })).toBe(false);
    expect(showsEmptyList({ mode: 'compra', items: 2, suggestions: 0 })).toBe(false);
  });

  it('montando, só sem nada a sugerir: as faixas já dizem por onde começar', () => {
    expect(showsEmptyList({ mode: 'montar', items: 0, suggestions: 3 })).toBe(false);
    expect(showsEmptyList({ mode: 'montar', items: 0, suggestions: 0 })).toBe(true);
  });

  it('no modo compra e na arquivada as faixas não aparecem: a lista vazia diz isso', () => {
    expect(showsEmptyList({ mode: 'compra', items: 0, suggestions: 3 })).toBe(true);
    expect(showsEmptyList({ mode: 'ver', items: 0, suggestions: 3 })).toBe(true);
  });

  it('o texto de cada momento só fala do que está na tela', () => {
    expect(emptyListMessage('montar')).toBe('Digite um item ou escolha do catálogo de itens comuns da casa.');
    expect(emptyListMessage('compra')).toBe('Digite no campo acima o que faltou.');
    expect(emptyListMessage('ver')).toBe('Esta lista ficou sem itens.');
  });
});

describe('addOptionsLabel: o botão "Mais opções" para o leitor de tela', () => {
  it('diz o que ele abre; o código de barras só quando a casa tem como lê-lo', () => {
    expect(addOptionsLabel(true)).toBe('Mais opções: itens comuns, colar lista e código de barras');
    expect(addOptionsLabel(false)).toBe('Mais opções: itens comuns e colar lista');
  });
});

describe('listMenuActions: o menu do cabeçalho', () => {
  it('a lista aberta: renomear e arquivar', () => {
    expect(listMenuActions(false).map((action) => LIST_MENU_LABELS[action])).toEqual(['Renomear lista', 'Arquivar lista']);
  });

  it('a arquivada: renomear (como antes) e reabrir no lugar de arquivar', () => {
    expect(listMenuActions(true).map((action) => LIST_MENU_LABELS[action])).toEqual(['Renomear lista', 'Reabrir lista']);
  });
});

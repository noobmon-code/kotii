import { describe, expect, it } from '@jest/globals';

import {
  addCardShape,
  addOptionsLabel,
  DEFAULT_AMOUNT,
  emptyListMessage,
  LIST_MENU_LABELS,
  listMenuActions,
  listMode,
  showsEmptyList,
  showsSuggestions,
  startsExpanded,
} from '../listMode';

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

describe('startsExpanded: o modo compra começa recolhido só com a quantidade de sempre', () => {
  it('1 un, recolhe', () => {
    expect(startsExpanded(DEFAULT_AMOUNT.quantity, DEFAULT_AMOUNT.unit)).toBe(false);
    expect(startsExpanded(' 1 ', 'un')).toBe(false);
  });

  it('outra quantidade, outra unidade ou o campo apagado: fica inteiro, para o item não sair com o que não se vê', () => {
    expect(startsExpanded('3', 'un')).toBe(true);
    expect(startsExpanded('1', 'kg')).toBe(true);
    expect(startsExpanded('', 'un')).toBe(true);
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
    expect(addOptionsLabel(true)).toBe('Mais opções: quantidade, unidade, itens comuns, colar lista e código de barras');
    expect(addOptionsLabel(false)).toBe('Mais opções: quantidade, unidade, itens comuns, colar lista');
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

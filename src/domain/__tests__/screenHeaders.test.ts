import { describe, expect, it } from '@jest/globals';

import { CATEGORIES } from '../categories';
import {
  HEALTH_ART,
  HEALTH_TAB_LABELS,
  HOUSE_ART,
  HOUSE_TAB_LABELS,
  healthSubtitle,
  houseSubtitle,
  listsSummary,
} from '../screenHeaders';

describe('listsSummary', () => {
  it('resume as listas e o que falta comprar', () => {
    expect(listsSummary([{ pending: 8 }, { pending: 2 }, { pending: 0 }])).toBe('3 listas · 10 itens para comprar');
  });

  it('no singular', () => {
    expect(listsSummary([{ pending: 1 }])).toBe('1 lista · 1 item para comprar');
  });

  it('com tudo comprado', () => {
    expect(listsSummary([{ pending: 0 }, { pending: 0 }])).toBe('2 listas · tudo comprado');
  });

  it('sem nenhuma lista, convida a criar; sem a busca, não afirma nada', () => {
    expect(listsSummary([])).toBe('Nenhuma lista ainda');
    expect(listsSummary(undefined)).toBe('As listas da casa, em tempo real');
  });
});

describe('os textos do topo', () => {
  it('Compras diz das listas; as outras partes da Casa têm a frase delas', () => {
    expect(houseSubtitle('compras', [{ pending: 2 }])).toBe('1 lista · 2 itens para comprar');
    for (const tab of ['despensa', 'tarefas', 'aparelhos'] as const) expect(houseSubtitle(tab, undefined)).not.toBe('');
  });

  it('cada parte da Saúde tem a frase dela', () => {
    const phrases = (Object.keys(HEALTH_TAB_LABELS) as (keyof typeof HEALTH_TAB_LABELS)[]).map(healthSubtitle);
    expect(new Set(phrases).size).toBe(phrases.length);
  });

  it('a linha de cima usa o nome da aba, igual ao do seletor', () => {
    expect(HOUSE_TAB_LABELS.compras).toBe('Compras');
    expect(HEALTH_TAB_LABELS.resumo).toBe('Resumo');
  });
});

describe('os ícones do topo', () => {
  it('são categorias de produto que existem', () => {
    const keys = new Set(CATEGORIES.map((c) => c.key));
    for (const art of [...Object.values(HOUSE_ART), HEALTH_ART]) for (const key of art) expect(keys.has(key)).toBe(true);
  });
});

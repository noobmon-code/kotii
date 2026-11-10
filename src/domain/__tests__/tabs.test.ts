import { describe, expect, it } from '@jest/globals';

import { CASA_TABS, COMPRAS_TABS, movedFromCasa, movedFromFinance, tabFromParam } from '../tabs';

// As partes das abas Compras e Casa na URL (?aba=), e para onde vão os endereços antigos: a Casa de antes tinha as
// compras e a despensa, e Finanças tinha as notas. Favoritos e o app instalado na tela inicial guardam esses endereços.

describe('a parte pedida na URL', () => {
  it('Compras: Listas, Notas e Despensa; sem parte, ou com uma que não existe, as Listas', () => {
    expect(COMPRAS_TABS.map((tab) => tab.label)).toEqual(['Listas', 'Notas', 'Despensa']);
    expect(tabFromParam(COMPRAS_TABS, 'notas')).toBe('notas');
    expect(tabFromParam(COMPRAS_TABS, 'despensa')).toBe('despensa');
    expect(tabFromParam(COMPRAS_TABS, undefined)).toBe('listas');
    expect(tabFromParam(COMPRAS_TABS, '')).toBe('listas');
    expect(tabFromParam(COMPRAS_TABS, 'compras')).toBe('listas');
    // O mesmo parâmetro repetido no endereço: vale o primeiro.
    expect(tabFromParam(COMPRAS_TABS, ['notas', 'despensa'])).toBe('notas');
  });

  it('Casa: Tarefas, Agenda, Aparelhos e Documentos; sem parte, ou com uma que não existe, as Tarefas', () => {
    expect(CASA_TABS.map((tab) => tab.label)).toEqual(['Tarefas', 'Agenda', 'Aparelhos', 'Documentos']);
    for (const tab of CASA_TABS) expect(tabFromParam(CASA_TABS, tab.value)).toBe(tab.value);
    expect(tabFromParam(CASA_TABS, undefined)).toBe('tarefas');
    expect(tabFromParam(CASA_TABS, 'Agenda')).toBe('tarefas');
  });
});

describe('os endereços antigos', () => {
  it('/casa?aba=compras vai para Compras (as Listas), e /casa?aba=despensa para Compras → Despensa', () => {
    expect(movedFromCasa('compras')).toEqual({ pathname: '/compras', aba: null });
    expect(movedFromCasa('despensa')).toEqual({ pathname: '/compras', aba: 'despensa' });
    expect(movedFromCasa(['despensa'])).toEqual({ pathname: '/compras', aba: 'despensa' });
  });

  it('as partes de hoje da Casa, e as que não existem, ficam na Casa', () => {
    for (const aba of [undefined, '', 'tarefas', 'agenda', 'aparelhos', 'documentos', 'notas', 'listas', 'qualquer']) {
      expect([aba, movedFromCasa(aba)]).toEqual([aba, null]);
    }
  });

  it('/financas?aba=notas vai para Compras → Notas; o resto de Finanças fica lá', () => {
    expect(movedFromFinance('notas')).toEqual({ pathname: '/compras', aba: 'notas' });
    for (const aba of [undefined, 'resumo', 'contas', 'despensa']) expect([aba, movedFromFinance(aba)]).toEqual([aba, null]);
  });
});

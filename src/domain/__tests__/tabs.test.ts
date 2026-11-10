import { describe, expect, it } from '@jest/globals';

import { CASA_TABS, COMPRAS_TABS, healthParts, movedFromCasa, movedFromFinance, PLANOS, SAUDE_TABS, tabFromParam } from '../tabs';

// As partes das abas Compras, Casa e Saúde na URL (?aba=), e para onde vão os endereços antigos: a Casa de antes
// tinha as compras e a despensa, Finanças tinha as notas e a Saúde tinha o treino e a dieta cada um numa parte.
// Favoritos e o app instalado na tela inicial guardam esses endereços.

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

describe('a Saúde: a parte e o plano na URL', () => {
  it('Resumo, Remédios, Cuidados e Planos; sem parte, ou com uma que não existe, o Resumo', () => {
    expect(SAUDE_TABS.map((tab) => tab.label)).toEqual(['Resumo', 'Remédios', 'Cuidados', 'Planos']);
    for (const tab of SAUDE_TABS) expect(healthParts(tab.value, undefined)).toEqual({ tab: tab.value, plan: 'treino', moved: false });
    for (const aba of [undefined, '', 'Remedios', 'familia', 'qualquer']) {
      expect([aba, healthParts(aba, undefined).tab]).toEqual([aba, 'resumo']);
    }
    expect(healthParts(['cuidados', 'planos'], undefined).tab).toBe('cuidados');
  });

  it('Planos: o treino e a dieta (?plano=); sem plano, ou com um que não existe, o treino', () => {
    expect(PLANOS.map((plan) => plan.label)).toEqual(['Treino', 'Dieta']);
    expect(healthParts('planos', 'dieta')).toEqual({ tab: 'planos', plan: 'dieta', moved: false });
    expect(healthParts('planos', 'treino')).toEqual({ tab: 'planos', plan: 'treino', moved: false });
    expect(healthParts('planos', undefined).plan).toBe('treino');
    expect(healthParts('planos', 'workout').plan).toBe('treino');
    expect(healthParts('planos', ['dieta', 'treino']).plan).toBe('dieta');
    // As outras partes guardam o plano que estava (voltar a Planos reabre nele).
    expect(healthParts('cuidados', 'dieta')).toEqual({ tab: 'cuidados', plan: 'dieta', moved: false });
  });

  it('/saude?aba=treino e /saude?aba=dieta, de quando cada um era uma parte, abrem Planos com aquele plano', () => {
    expect(healthParts('treino', undefined)).toEqual({ tab: 'planos', plan: 'treino', moved: true });
    expect(healthParts('dieta', undefined)).toEqual({ tab: 'planos', plan: 'dieta', moved: true });
    expect(healthParts(['dieta'], undefined)).toEqual({ tab: 'planos', plan: 'dieta', moved: true });
    // O endereço antigo diz o plano: um ?plano= que venha junto não muda nada.
    expect(healthParts('dieta', 'treino')).toEqual({ tab: 'planos', plan: 'dieta', moved: true });
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

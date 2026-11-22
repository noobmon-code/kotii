import { describe, expect, it } from '@jest/globals';

import { FEATURES } from '../features';

// As chaves como o app sai nesta versão: só este teste confere o que chega às pessoas, e falha se um revert ou um
// merge desligar uma chave por engano (a de Finanças também é conferida em financeRoutes.test.ts). Os testes das telas
// passam com o começo ligado ou desligado, mas nem todos escolhem o valor: os que conferem o que a chave muda a ligam
// ou desligam por conta própria (jest.replaceProperty); outros mostram a Hoje ou Configurações sem escolher
// (todayTop, financeHidden, sharedPricesScreens) e rodam com o valor desta versão. Um teste novo que dependa do
// começo escolhe o valor.
describe('as chaves desta versão', () => {
  it('o começo novo sai ligado para todos (decisão do dono, 20/11/2026)', () => {
    expect(FEATURES.onboarding).toBe(true);
  });

  it('Finanças sai ligada', () => {
    expect(FEATURES.finance).toBe(true);
  });
});

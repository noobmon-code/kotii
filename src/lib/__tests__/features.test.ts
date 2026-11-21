import { describe, expect, it } from '@jest/globals';

import { FEATURES } from '../features';

// As chaves como o app sai nesta versão. Os testes das telas ligam ou desligam cada chave por conta própria
// (jest.replaceProperty), então passam com qualquer valor dela: só este confere o que chega às pessoas, e falha se
// um revert ou um merge desligar uma chave por engano. A de Finanças também é conferida em financeRoutes.test.ts.
describe('as chaves desta versão', () => {
  it('o começo novo sai ligado para todos (decisão do dono, 20/11/2026)', () => {
    expect(FEATURES.onboarding).toBe(true);
  });

  it('Finanças sai ligada', () => {
    expect(FEATURES.finance).toBe(true);
  });
});

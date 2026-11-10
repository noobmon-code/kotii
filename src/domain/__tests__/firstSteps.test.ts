import { describe, expect, it } from '@jest/globals';

import { firstSteps, firstStepsProgress, showFirstSteps, type FirstStepsFacts } from '../firstSteps';

const fresh: FirstStepsFacts = { members: 1, anyList: false, anyReceipt: false, peopleWithoutApp: 0 };

const done = (facts: FirstStepsFacts) => firstSteps(facts)?.map((step) => [step.key, step.done]);

describe('os primeiros passos', () => {
  it('são quatro, nesta ordem, e numa casa nova nenhum está feito', () => {
    expect(firstSteps(fresh)?.map((step) => step.title)).toEqual([
      'Convidar alguém da casa',
      'Criar a primeira lista',
      'Escanear a primeira nota',
      'Cadastrar pessoas e pets',
    ]);
    expect(done(fresh)).toEqual([
      ['convidar', false],
      ['lista', false],
      ['nota', false],
      ['pessoas', false],
    ]);
  });

  it('cada passo se marca pelo que a casa já tem', () => {
    // Mais de um morador: alguém entrou com o convite.
    expect(done({ ...fresh, members: 2 })?.[0]).toEqual(['convidar', true]);
    // Qualquer lista (aberta ou arquivada) e qualquer nota (rascunho ou confirmada): quem diz é quem chama.
    expect(done({ ...fresh, anyList: true })?.[1]).toEqual(['lista', true]);
    expect(done({ ...fresh, anyReceipt: true })?.[2]).toEqual(['nota', true]);
    // Uma ficha de quem não usa o app (pessoa ou pet).
    expect(done({ ...fresh, peopleWithoutApp: 1 })?.[3]).toEqual(['pessoas', true]);
  });

  it('enquanto falta saber algum dos quatro, nada (um passo dado não aparece como por fazer)', () => {
    expect(firstSteps({ ...fresh, members: undefined })).toBeNull();
    expect(firstSteps({ ...fresh, anyList: undefined })).toBeNull();
    expect(firstSteps({ ...fresh, anyReceipt: undefined })).toBeNull();
    expect(firstSteps({ ...fresh, peopleWithoutApp: undefined })).toBeNull();
  });
});

describe('o cartão', () => {
  const all = { members: 3, anyList: true, anyReceipt: true, peopleWithoutApp: 2 };

  it('aparece com algum passo por fazer, depois de lida a dispensa, e sem ela', () => {
    expect(showFirstSteps(firstSteps(fresh), false)).toBe(true);
    expect(showFirstSteps(firstSteps({ ...all, peopleWithoutApp: 0 }), false)).toBe(true);
  });

  it('some com os quatro feitos, com a dispensa, enquanto lê a dispensa e enquanto falta saber um passo', () => {
    expect(showFirstSteps(firstSteps(all), false)).toBe(false);
    expect(showFirstSteps(firstSteps(fresh), true)).toBe(false);
    expect(showFirstSteps(firstSteps(fresh), undefined)).toBe(false);
    expect(showFirstSteps(null, false)).toBe(false);
  });

  it('diz quantos já foram feitos', () => {
    expect(firstStepsProgress(firstSteps(fresh)!)).toBe('0 de 4 feitos');
    expect(firstStepsProgress(firstSteps({ ...fresh, members: 2 })!)).toBe('1 de 4 feito');
    expect(firstStepsProgress(firstSteps({ ...all, peopleWithoutApp: 0 })!)).toBe('3 de 4 feitos');
  });
});

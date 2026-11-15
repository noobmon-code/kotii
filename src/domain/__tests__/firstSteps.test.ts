import { describe, expect, it } from '@jest/globals';

import { firstSteps, firstStepsProgress, showFirstSteps, SKIPPABLE_FIRST_STEPS, type FirstStepsFacts } from '../firstSteps';

const fresh: FirstStepsFacts = { members: 1, anyList: false, anyReceipt: false, anyPantry: false, peopleWithoutApp: 0 };

const done = (facts: FirstStepsFacts, skipped?: ReadonlySet<string>) => firstSteps(facts, skipped)?.map((step) => [step.key, step.done]);

const SKIPPED = new Set(['despensa']);

describe('os primeiros passos', () => {
  it('são cinco, nesta ordem, e numa casa nova nenhum está feito', () => {
    expect(firstSteps(fresh)?.map((step) => step.title)).toEqual([
      'Convidar alguém da casa',
      'Criar a primeira lista',
      'Escanear a primeira nota',
      'Guardar o que já tem em casa',
      'Cadastrar pessoas e pets',
    ]);
    expect(done(fresh)).toEqual([
      ['convidar', false],
      ['lista', false],
      ['nota', false],
      ['despensa', false],
      ['pessoas', false],
    ]);
  });

  it('cada passo se marca pelo que a casa já tem', () => {
    // Mais de um morador: alguém entrou com o convite.
    expect(done({ ...fresh, members: 2 })?.[0]).toEqual(['convidar', true]);
    // Qualquer lista (aberta ou arquivada) e qualquer nota (rascunho ou confirmada): quem diz é quem chama.
    expect(done({ ...fresh, anyList: true })?.[1]).toEqual(['lista', true]);
    expect(done({ ...fresh, anyReceipt: true })?.[2]).toEqual(['nota', true]);
    // Qualquer coisa que já entrou na despensa, também a que acabou.
    expect(done({ ...fresh, anyPantry: true })?.[3]).toEqual(['despensa', true]);
    // Uma ficha de quem não usa o app (pessoa ou pet).
    expect(done({ ...fresh, peopleWithoutApp: 1 })?.[4]).toEqual(['pessoas', true]);
  });

  it('enquanto falta saber algum deles, nada (um passo dado não aparece como por fazer)', () => {
    expect(firstSteps({ ...fresh, members: undefined })).toBeNull();
    expect(firstSteps({ ...fresh, anyList: undefined })).toBeNull();
    expect(firstSteps({ ...fresh, anyReceipt: undefined })).toBeNull();
    expect(firstSteps({ ...fresh, anyPantry: undefined })).toBeNull();
    expect(firstSteps({ ...fresh, peopleWithoutApp: undefined })).toBeNull();
  });

  it('só o da despensa dá para pular: pulado, ele sai da lista, e os outros ficam como estão', () => {
    expect(SKIPPABLE_FIRST_STEPS).toEqual(['despensa']);
    expect(firstSteps(fresh)?.filter((step) => step.skippable).map((step) => step.key)).toEqual(['despensa']);
    expect(done(fresh, SKIPPED)).toEqual([
      ['convidar', false],
      ['lista', false],
      ['nota', false],
      ['pessoas', false],
    ]);
    // Pulado, nem precisa ser sabido: a despensa que ainda não carregou não segura o cartão.
    expect(done({ ...fresh, anyPantry: undefined }, SKIPPED)).toHaveLength(4);
    // Um passo que não dá para pular não sai, mesmo que venha na lista dos pulados.
    expect(done(fresh, new Set(['convidar', 'pessoas']))).toHaveLength(5);
  });
});

describe('o cartão', () => {
  const all = { members: 3, anyList: true, anyReceipt: true, anyPantry: true, peopleWithoutApp: 2 };

  it('aparece com algum passo por fazer, depois de lida a dispensa, e sem ela', () => {
    expect(showFirstSteps(firstSteps(fresh), false)).toBe(true);
    expect(showFirstSteps(firstSteps({ ...all, peopleWithoutApp: 0 }), false)).toBe(true);
    expect(showFirstSteps(firstSteps({ ...all, anyPantry: false }), false)).toBe(true);
  });

  it('some com todos feitos, com a dispensa, enquanto lê a dispensa e enquanto falta saber um passo', () => {
    expect(showFirstSteps(firstSteps(all), false)).toBe(false);
    expect(showFirstSteps(firstSteps(fresh), true)).toBe(false);
    expect(showFirstSteps(firstSteps(fresh), undefined)).toBe(false);
    expect(showFirstSteps(null, false)).toBe(false);
  });

  it('com os outros feitos e o da despensa pulado, não há mais o que mostrar', () => {
    expect(showFirstSteps(firstSteps({ ...all, anyPantry: false }, SKIPPED), false)).toBe(false);
    expect(firstSteps({ ...all, anyPantry: false }, SKIPPED)?.every((step) => step.done)).toBe(true);
  });

  it('diz quantos já foram feitos, sem contar o pulado', () => {
    expect(firstStepsProgress(firstSteps(fresh)!)).toBe('0 de 5 feitos');
    expect(firstStepsProgress(firstSteps({ ...fresh, members: 2 })!)).toBe('1 de 5 feito');
    expect(firstStepsProgress(firstSteps({ ...all, peopleWithoutApp: 0 })!)).toBe('4 de 5 feitos');
    expect(firstStepsProgress(firstSteps({ ...fresh, members: 2 }, SKIPPED)!)).toBe('1 de 4 feito');
  });
});

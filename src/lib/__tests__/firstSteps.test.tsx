import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

// A dispensa dos primeiros passos guardada no aparelho: por casa, volta com o app reaberto, e sem armazenamento
// dura só na memória (sem quebrar nada).

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

type FirstStepsModule = typeof import('@/lib/firstSteps');

/** O módulo como numa abertura nova do app: a memória vazia, o que está no aparelho continua. */
function freshModule(): FirstStepsModule {
  let mod: FirstStepsModule | undefined;
  jest.isolateModules(() => {
    jest.doMock('react', () => React);
    jest.doMock('@react-native-async-storage/async-storage', () => AsyncStorage);
    mod = jest.requireActual<FirstStepsModule>('@/lib/firstSteps');
  });
  return mod!;
}

const seen: { dismissed?: boolean | undefined; renders: (boolean | undefined)[] } = { renders: [] };
let renderer: ReactTestRenderer | undefined;

async function mount(mod: FirstStepsModule, householdId: string | undefined) {
  function Probe({ id }: { id: string | undefined }) {
    seen.dismissed = mod.useFirstStepsDismissed(id);
    seen.renders.push(seen.dismissed);
    return null;
  }
  await act(async () => {
    renderer = create(<Probe id={householdId} />);
  });
  return (id: string | undefined) => act(async () => renderer!.update(<Probe id={id} />));
}

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

beforeEach(async () => {
  await AsyncStorage.clear();
  seen.dismissed = undefined;
  seen.renders = [];
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  jest.restoreAllMocks();
});

describe('a dispensa dos primeiros passos', () => {
  it('começa sem saber (lendo o aparelho) e, sem nada guardado, não está dispensada', async () => {
    const mod = freshModule();
    await mount(mod, 'casa-1');
    await flush();
    expect(seen.renders[0]).toBeUndefined();
    expect(seen.dismissed).toBe(false);
  });

  it('dispensar some na hora, fica guardado e volta com o app reaberto, só para aquela casa', async () => {
    const before = freshModule();
    await mount(before, 'casa-1');
    await flush();
    await act(async () => before.dismissFirstSteps('casa-1'));
    expect(seen.dismissed).toBe(true);
    await flush();
    await act(async () => renderer?.unmount());

    const after = freshModule();
    const switchTo = await mount(after, 'casa-1');
    await flush();
    expect(seen.dismissed).toBe(true);
    // Outra casa da mesma pessoa tem os passos dela.
    await switchTo('casa-2');
    await flush();
    expect(seen.dismissed).toBe(false);
  });

  it('sem casa, não sabe', async () => {
    await mount(freshModule(), undefined);
    await flush();
    expect(seen.dismissed).toBeUndefined();
  });

  it('sem armazenamento, a leitura vale "não dispensado" e a dispensa dura enquanto o app está aberto', async () => {
    // Uma vez cada (a leitura e a gravação): as funções do armazenamento de mentira continuam as mesmas nos outros testes.
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('cota cheia'));
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('cota cheia'));
    const mod = freshModule();
    await mount(mod, 'casa-1');
    await flush();
    expect(seen.dismissed).toBe(false);
    await act(async () => mod.dismissFirstSteps('casa-1'));
    await flush();
    expect(seen.dismissed).toBe(true);
  });

  it('dispensada enquanto a leitura andava: vale o toque', async () => {
    await AsyncStorage.setItem('kotii:first-steps-dismissed:casa-1', '0');
    let release: () => void = () => undefined;
    const original = AsyncStorage.getItem;
    jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(
      (key: string) => new Promise((resolve) => (release = () => resolve(original(key) as unknown as string | null))),
    );
    const mod = freshModule();
    await mount(mod, 'casa-1');
    await act(async () => mod.dismissFirstSteps('casa-1'));
    expect(seen.dismissed).toBe(true);
    await act(async () => release());
    await flush();
    expect(seen.dismissed).toBe(true);
  });
});

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

// As listas que este aparelho abriu (o atalho da tela Hoje abre a última): voltam com o app reaberto, a aberta
// antes de a leitura terminar entra por cima do que estava guardado, e a saída da conta apaga tudo.

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

type OpenedListsModule = typeof import('@/lib/openedLists');

const KEY = 'kotii:opened-lists';

/** O módulo como numa abertura nova do app: a memória vazia, o que está no aparelho continua. */
function freshModule(): OpenedListsModule {
  let mod: OpenedListsModule | undefined;
  jest.isolateModules(() => {
    jest.doMock('react', () => React);
    jest.doMock('@react-native-async-storage/async-storage', () => AsyncStorage);
    mod = jest.requireActual<OpenedListsModule>('@/lib/openedLists');
  });
  return mod!;
}

const seen: { opened?: ReadonlyMap<string, number> | null; renders: number } = { renders: 0 };
let renderer: ReactTestRenderer | undefined;

async function mount(mod: OpenedListsModule) {
  function Probe() {
    seen.opened = mod.useOpenedLists();
    seen.renders += 1;
    return null;
  }
  await act(async () => {
    renderer = create(<Probe />);
  });
}

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
const stored = async () => JSON.parse((await AsyncStorage.getItem(KEY)) ?? '{}') as Record<string, number>;
const newestOf = (opened: ReadonlyMap<string, number> | null | undefined) =>
  [...(opened ?? new Map<string, number>()).entries()].sort(([, a], [, b]) => b - a)[0]?.[0];

beforeEach(async () => {
  await AsyncStorage.clear();
  seen.opened = undefined;
  seen.renders = 0;
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  jest.restoreAllMocks();
});

describe('as listas que este aparelho abriu', () => {
  it('null antes de ler o aparelho, depois o mapa; a lista aberta volta com o app reaberto', async () => {
    const before = freshModule();
    let first: ReadonlyMap<string, number> | null | undefined;
    function Early() {
      const value = before.useOpenedLists();
      if (first === undefined) first = value;
      return null;
    }
    await act(async () => {
      renderer = create(<Early />);
    });
    expect(first).toBeNull();
    await act(async () => before.rememberOpenedList('l1', 1000));
    await flush();
    await act(async () => renderer?.unmount());

    const after = freshModule();
    await mount(after);
    await flush();
    expect(seen.opened).toBeInstanceOf(Map);
    expect(seen.opened?.get('l1')).toBe(1000);
  });

  it('a lista aberta antes de a leitura terminar entra por cima do que estava guardado', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify({ l1: 1000, l2: 2000 }));
    const mod = freshModule();
    mod.rememberOpenedList('l3', 500);
    await mount(mod);
    await flush();
    expect(seen.opened?.get('l1')).toBe(1000);
    expect(seen.opened?.get('l2')).toBe(2000);
    expect(newestOf(seen.opened)).toBe('l3');
    const saved = await stored();
    expect(Object.keys(saved).sort()).toEqual(['l1', 'l2', 'l3']);
    expect(saved.l3).toBeGreaterThan(2000);
  });

  it('a tela montada vê na hora a lista aberta em outra', async () => {
    const mod = freshModule();
    await mount(mod);
    await flush();
    expect(seen.opened?.size).toBe(0);
    await act(async () => mod.rememberOpenedList('l9', 5000));
    expect(newestOf(seen.opened)).toBe('l9');
    // Abrir de novo a que já é a mais nova não grava nem desenha de novo.
    const renders = seen.renders;
    const setItem = jest.spyOn(AsyncStorage, 'setItem');
    const writes = setItem.mock.calls.length;
    await act(async () => mod.rememberOpenedList('l9', 6000));
    await flush();
    expect(seen.renders).toBe(renders);
    expect(setItem.mock.calls.length).toBe(writes);
  });

  it('a saída da conta esvazia a memória (lida, não null) e apaga do aparelho; a leitura de antes não traz de volta', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify({ l1: 1000 }));
    // A leitura começa com a montagem e só termina depois da saída.
    let finishRead: (raw: string | null) => void = () => undefined;
    jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(
      () => new Promise<string | null>((resolve) => (finishRead = resolve)),
    );
    const mod = freshModule();
    await mount(mod);
    expect(seen.opened).toBeNull();
    await act(async () => mod.forgetOpenedLists());
    await act(async () => finishRead(JSON.stringify({ l1: 1000 })));
    await flush();
    expect(seen.opened).toBeInstanceOf(Map);
    expect(seen.opened?.size).toBe(0);
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });

  it('sem conseguir ler o aparelho, a memória fica vazia (e não presa em null)', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValue(new Error('bloqueado'));
    const mod = freshModule();
    await mount(mod);
    await flush();
    expect(seen.opened).toBeInstanceOf(Map);
    expect(seen.opened?.size).toBe(0);
  });

  it('sem conseguir gravar, a lista aberta vale na memória', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValue(new Error('cheio'));
    const mod = freshModule();
    await mount(mod);
    await flush();
    await act(async () => mod.rememberOpenedList('l1', 1000));
    await flush();
    expect(newestOf(seen.opened)).toBe('l1');
  });
});

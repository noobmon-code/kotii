import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

// Os itens que este aparelho pôs em cada lista (o selo "Novo" não vale para eles): continuam depois de reabrir o
// app, cada lista com os seus, esquecidos sem ida ou bem antes dela, e apagados na saída da conta.

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

type AddedItemsModule = typeof import('@/lib/addedItems');

/** O módulo como numa abertura nova do app: a memória vazia, o que está no aparelho continua. */
function freshModule(): AddedItemsModule {
  let mod: AddedItemsModule | undefined;
  jest.isolateModules(() => {
    jest.doMock('react', () => React);
    jest.doMock('@react-native-async-storage/async-storage', () => AsyncStorage);
    mod = jest.requireActual<AddedItemsModule>('@/lib/addedItems');
  });
  return mod!;
}

const seen: { ids?: ReadonlySet<string> } = {};
let renderer: ReactTestRenderer | undefined;

async function mount(mod: AddedItemsModule, listId = 'l1') {
  function Probe() {
    seen.ids = mod.useAddedItems(listId);
    return null;
  }
  await act(async () => {
    renderer = create(<Probe />);
  });
}

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
const ids = () => [...(seen.ids ?? [])].sort();

beforeEach(async () => {
  await AsyncStorage.clear();
  seen.ids = undefined;
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  jest.restoreAllMocks();
});

describe('os itens que este aparelho pôs', () => {
  it('continuam depois de reabrir o app (a memória vazia, o aparelho guarda)', async () => {
    const before = freshModule();
    before.rememberAdded('l1', ['a', 'b']);
    before.rememberAdded('l2', ['c']);
    await flush();
    const after = freshModule();
    expect(after.addedHere('l1').size).toBe(0);
    await mount(after);
    await flush();
    expect(ids()).toEqual(['a', 'b']);
  });

  it('o que foi posto antes de a leitura voltar se junta ao que estava guardado', async () => {
    freshModule().rememberAdded('l1', ['velho']);
    await flush();
    const mod = freshModule();
    mod.rememberAdded('l1', ['novo']);
    await mount(mod);
    await flush();
    expect(ids()).toEqual(['novo', 'velho']);
    // E o aparelho fica com os dois.
    expect(JSON.parse((await AsyncStorage.getItem('kotii:added-items:l1'))!).map((e: { id: string }) => e.id).sort()).toEqual([
      'novo',
      'velho',
    ]);
  });

  it('sem ida, a lista esquece; com ida, só o que veio bem antes dela', async () => {
    const mod = freshModule();
    const trip = Date.parse('2026-10-24T14:00:00Z');
    mod.rememberAdded('l1', ['muito-antes'], trip - 60 * 60_000);
    mod.rememberAdded('l1', ['pouco-antes'], trip - 5 * 60_000);
    mod.rememberAdded('l1', ['depois'], trip + 5 * 60_000);
    await mount(mod);
    await act(async () => mod.pruneAddedItems('l1', '2026-10-24T14:00:00Z'));
    // O relógio do aparelho pode estar atrás do servidor: o de pouco antes fica.
    expect(ids()).toEqual(['depois', 'pouco-antes']);
    await act(async () => mod.pruneAddedItems('l1', null));
    await flush();
    expect(ids()).toEqual([]);
    expect(await AsyncStorage.getItem('kotii:added-items:l1')).toBeNull();
  });

  it('sair da conta apaga de todas as listas, da memória e do aparelho, e deixa o resto', async () => {
    const mod = freshModule();
    await AsyncStorage.setItem('kotii:theme', 'dark');
    await mount(mod);
    await act(async () => mod.rememberAdded('l1', ['a']));
    mod.rememberAdded('l2', ['b']);
    await flush();
    await act(async () => mod.forgetAddedItems());
    await flush();
    expect(ids()).toEqual([]);
    expect(await AsyncStorage.getItem('kotii:added-items:l1')).toBeNull();
    expect(await AsyncStorage.getItem('kotii:added-items:l2')).toBeNull();
    expect(await AsyncStorage.getItem('kotii:theme')).toBe('dark');
  });

  it('o guardado estragado não quebra nada', async () => {
    await AsyncStorage.setItem('kotii:added-items:l1', '{nada');
    await mount(freshModule());
    await flush();
    expect(ids()).toEqual([]);
  });

  it('sem armazenamento, vale na memória', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValue(new Error('cota cheia'));
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValue(new Error('cota cheia'));
    const mod = freshModule();
    await mount(mod);
    await act(async () => mod.rememberAdded('l1', ['a']));
    await flush();
    expect(ids()).toEqual(['a']);
  });
});

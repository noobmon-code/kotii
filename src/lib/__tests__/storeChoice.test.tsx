import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { StoreChoice } from '@/domain/listEstimate';

// "Onde estou" guardado no aparelho: volta ao abrir a lista de novo (também com o app reaberto), some ao tirar a
// escolha e na saída da conta, e sem armazenamento a escolha só dura na memória.

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

type StoreChoiceModule = typeof import('@/lib/storeChoice');

/** O módulo como numa abertura nova do app: a memória vazia, o que está no aparelho continua. */
function freshModule(): StoreChoiceModule {
  let mod: StoreChoiceModule | undefined;
  jest.isolateModules(() => {
    // O mesmo React da tela e o mesmo aparelho: só a memória do módulo é nova.
    jest.doMock('react', () => React);
    jest.doMock('@react-native-async-storage/async-storage', () => AsyncStorage);
    mod = jest.requireActual<StoreChoiceModule>('@/lib/storeChoice');
  });
  return mod!;
}

const seen: { choice?: StoreChoice | null } = {};
let renderer: ReactTestRenderer | undefined;

async function mount(mod: StoreChoiceModule, listId = 'l1') {
  function Probe() {
    seen.choice = mod.useStoreChoice(listId);
    return null;
  }
  await act(async () => {
    renderer = create(<Probe />);
  });
}

const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

beforeEach(async () => {
  await AsyncStorage.clear();
  seen.choice = undefined;
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  jest.restoreAllMocks();
});

describe('o mercado de "Onde estou" no aparelho', () => {
  it('a escolha volta com o app reaberto', async () => {
    const before = freshModule();
    before.chooseStore('l1', 's1', Date.now());
    await flush();
    const after = freshModule();
    await mount(after);
    await flush();
    expect(seen.choice?.storeId).toBe('s1');
  });

  it('a escolha de 6 horas atrás não volta', async () => {
    freshModule().chooseStore('l1', 's1', Date.now() - 6 * 60 * 60 * 1000);
    await flush();
    await mount(freshModule());
    await flush();
    expect(seen.choice).toBeNull();
  });

  it('cada lista tem a sua; tirar a escolha apaga do aparelho', async () => {
    const mod = freshModule();
    mod.chooseStore('l1', 's1');
    mod.chooseStore('l2', 's2');
    await flush();
    mod.chooseStore('l1', null);
    await flush();
    expect(await AsyncStorage.getItem('kotii:store-choice:l1')).toBeNull();
    expect(JSON.parse((await AsyncStorage.getItem('kotii:store-choice:l2'))!).storeId).toBe('s2');
  });

  it('a tela aberta vê na hora a escolha feita em outra ("Vou neste")', async () => {
    const mod = freshModule();
    await mount(mod);
    await flush();
    expect(seen.choice).toBeNull();
    await act(async () => mod.chooseStore('l1', 's3'));
    expect(seen.choice?.storeId).toBe('s3');
  });

  it('a escolha feita enquanto o aparelho ainda era lido não é desfeita pela leitura', async () => {
    freshModule().chooseStore('l1', 'antigo');
    await flush();
    const mod = freshModule();
    await mount(mod);
    // A leitura ainda não voltou: a pessoa escolhe outro.
    await act(async () => mod.chooseStore('l1', 'novo'));
    await flush();
    expect(seen.choice?.storeId).toBe('novo');
  });

  it('sair da conta apaga as escolhas de todas as listas, da memória e do aparelho', async () => {
    const mod = freshModule();
    await AsyncStorage.setItem('kotii:theme', 'dark');
    await mount(mod);
    await act(async () => mod.chooseStore('l1', 's1'));
    mod.chooseStore('l2', 's2');
    await flush();
    await act(async () => mod.forgetStoreChoices());
    await flush();
    expect(seen.choice).toBeNull();
    expect(await AsyncStorage.getItem('kotii:store-choice:l1')).toBeNull();
    expect(await AsyncStorage.getItem('kotii:store-choice:l2')).toBeNull();
    // O resto do que está no aparelho fica.
    expect(await AsyncStorage.getItem('kotii:theme')).toBe('dark');
  });

  it('sem armazenamento, a escolha vale na memória e nada quebra', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValue(new Error('cota cheia'));
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValue(new Error('cota cheia'));
    const mod = freshModule();
    await mount(mod);
    await flush();
    expect(seen.choice).toBeNull();
    await act(async () => mod.chooseStore('l1', 's1'));
    await flush();
    expect(seen.choice?.storeId).toBe('s1');
  });
});

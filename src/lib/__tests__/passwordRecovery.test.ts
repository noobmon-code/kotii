import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  finishRecovery,
  forgetRecoveryInMemory,
  readRecovery,
  recoveringUserId,
  recoveryGate,
  startRecovery,
} from '../passwordRecovery';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const MARK_KEY = 'kotii:password-recovery';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  finishRecovery();
  await AsyncStorage.clear();
});

describe('recuperação de senha', () => {
  it('o código do e-mail põe a conta na senha nova, e a marca fica no aparelho', async () => {
    startRecovery('ana');
    expect(recoveryGate({ userId: 'ana', readFor: 'ana' }, 'ana')).toBe('new-password');
    expect(recoveringUserId()).toBe('ana');
    await flush();
    expect(await AsyncStorage.getItem(MARK_KEY)).toBe('ana');
  });

  it('a página recarregada (ou outra aba, ou o app reaberto) lê a marca antes de abrir a casa', async () => {
    await AsyncStorage.setItem(MARK_KEY, 'ana');
    // App reaberto: o módulo começa do zero, e o aparelho ainda tem a marca.
    let fresh: typeof import('../passwordRecovery') | undefined;
    jest.isolateModules(() => {
      fresh = jest.requireActual<typeof import('../passwordRecovery')>('../passwordRecovery');
    });
    const reopened = fresh as typeof import('../passwordRecovery');
    expect(recoveryGate({ userId: reopened.recoveringUserId(), readFor: null }, 'ana')).toBe('reading');
    await reopened.readRecovery('ana');
    expect(reopened.recoveringUserId()).toBe('ana');
    // Outra conta no aparelho segue normal.
    await reopened.readRecovery('bia');
    expect(recoveryGate({ userId: reopened.recoveringUserId(), readFor: 'bia' }, 'bia')).toBe('free');
  });

  it('a senha salva (ou a desistência) tira a marca', async () => {
    startRecovery('ana');
    finishRecovery();
    await flush();
    expect(recoveringUserId()).toBeNull();
    expect(await AsyncStorage.getItem(MARK_KEY)).toBeNull();
  });

  it('a sessão que sai (aqui ou em outra aba) esquece a marca na memória, e a próxima entrada relê o aparelho', async () => {
    startRecovery('ana');
    await flush();
    // Outra aba desistiu ("Cancelar e sair") e depois entrou com a senha: o aparelho já não tem a marca.
    forgetRecoveryInMemory();
    await AsyncStorage.removeItem(MARK_KEY);
    expect(recoveryGate({ userId: recoveringUserId(), readFor: null }, 'ana')).toBe('reading');
    await readRecovery('ana');
    expect(recoveringUserId()).toBeNull();
  });

  it('a marca posta ou tirada no meio de uma leitura vale mais que a leitura', async () => {
    await AsyncStorage.setItem(MARK_KEY, 'ana');
    const reading = readRecovery('ana');
    finishRecovery();
    await reading;
    expect(recoveringUserId()).toBeNull();

    const again = readRecovery('ana');
    startRecovery('ana');
    await again;
    expect(recoveringUserId()).toBe('ana');
  });
});

describe('recoveryGate', () => {
  it('espera a leitura da marca da conta aberta; sem conta, segue', () => {
    expect(recoveryGate({ userId: null, readFor: null }, undefined)).toBe('free');
    expect(recoveryGate({ userId: null, readFor: 'bia' }, 'ana')).toBe('reading');
    expect(recoveryGate({ userId: 'ana', readFor: 'ana' }, 'ana')).toBe('new-password');
    expect(recoveryGate({ userId: 'ana', readFor: 'bia' }, 'bia')).toBe('free');
  });
});

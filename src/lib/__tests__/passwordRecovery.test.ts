import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  beginRecovery,
  finishRecovery,
  forgetRecoveryInMemory,
  readRecovery,
  recoveringUserId,
  recoveryAfterStorage,
  recoveryGate,
  recoveryGateNow,
  startRecovery,
} from '../passwordRecovery';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const MARK_KEY = 'kotii:password-recovery';
const MARK_BY_KEY = 'kotii:password-recovery-by';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(async () => {
  await finishRecovery();
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
    await finishRecovery();
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

  it('entrar com a senha depois de uma recuperação que ficou pela metade abre a casa, não a senha nova', async () => {
    startRecovery('ana');
    await flush();
    // A sessão de recuperação acabou por fora: a memória esquece, o aparelho guarda a marca.
    forgetRecoveryInMemory();
    // A tela de entrar tira a marca (e espera) antes de entrar com a senha; a conta que entra lê o aparelho.
    await finishRecovery();
    await readRecovery('ana');
    expect(recoveryGateNow('ana')).toBe('free');
  });

  it('troca de conta: a leitura mais nova vale, e a de antes que termina depois é descartada', async () => {
    let releaseAna: (value: string | null) => void = () => undefined;
    // Só as duas próximas leituras são simuladas; depois o mock volta sozinho ao normal (um mockRestore
    // aqui apagaria o getItem do mock para os testes seguintes).
    jest
      .spyOn(AsyncStorage, 'getItem')
      .mockImplementationOnce(() => new Promise((resolve) => (releaseAna = resolve)))
      .mockImplementationOnce(async () => null);
    const ana = readRecovery('ana');
    await readRecovery('bia');
    expect(recoveryGateNow('bia')).toBe('free');
    // A leitura de Ana (que tinha a marca) termina por último: não muda nada para Bia.
    releaseAna('ana');
    await ana;
    expect(recoveryGateNow('bia')).toBe('free');
  });

  it('a marca posta ou tirada no meio de uma leitura vale mais que a leitura', async () => {
    await AsyncStorage.setItem(MARK_KEY, 'ana');
    const reading = readRecovery('ana');
    void finishRecovery();
    await reading;
    expect(recoveringUserId()).toBeNull();

    const again = readRecovery('ana');
    startRecovery('ana');
    await again;
    expect(recoveringUserId()).toBe('ana');
  });
});

describe('link do e-mail: a marca vem antes da sessão', () => {
  it('quando beginRecovery volta, a marca já está na memória e gravada no aparelho', async () => {
    await beginRecovery('ana');
    expect(recoveryGateNow('ana')).toBe('new-password');
    expect(await AsyncStorage.getItem(MARK_KEY)).toBe('ana');
  });

  it('a sessão não entrou: desfazer tira a marca que foi posta', async () => {
    forgetRecoveryInMemory();
    const undo = await beginRecovery('ana');
    await undo();
    expect(recoveringUserId()).toBeNull();
    expect(await AsyncStorage.getItem(MARK_KEY)).toBeNull();
    // A memória volta a "ainda não li": a conta que aparecer lê o aparelho.
    expect(recoveryGateNow('ana')).toBe('reading');
    await readRecovery('ana');
    expect(recoveryGateNow('ana')).toBe('free');
  });

  it('desfazer não tira a marca que já estava lá para a mesma conta', async () => {
    startRecovery('ana');
    await flush();
    const undo = await beginRecovery('ana');
    await undo();
    expect(await AsyncStorage.getItem(MARK_KEY)).toBe('ana');
    expect(recoveryGateNow('ana')).toBe('new-password');
  });

  it('desfazer devolve a marca de outra conta que estava no aparelho', async () => {
    forgetRecoveryInMemory();
    await AsyncStorage.setItem(MARK_KEY, 'bia');
    const undo = await beginRecovery('ana');
    expect(await AsyncStorage.getItem(MARK_KEY)).toBe('ana');
    await undo();
    expect(await AsyncStorage.getItem(MARK_KEY)).toBe('bia');
    await readRecovery('bia');
    expect(recoveryGateNow('bia')).toBe('new-password');
  });
});

describe('link do e-mail: a marca que não deu para gravar e a marca que mudou de mãos', () => {
  it('sem conseguir gravar a marca, beginRecovery falha e a memória volta ao que era', async () => {
    forgetRecoveryInMemory();
    // Só a próxima gravação falha (mockRestore apagaria o AsyncStorage de mentira para os testes seguintes).
    jest.mocked(AsyncStorage.multiSet).mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(beginRecovery('ana')).rejects.toThrow('storage unavailable');
    expect(recoveringUserId()).toBeNull();
    expect(recoveryGateNow('ana')).toBe('reading');
    expect(await AsyncStorage.getItem(MARK_KEY)).toBeNull();
  });

  it('outra aba pôs a marca da mesma conta depois (o valor é igual): desfazer não a tira', async () => {
    forgetRecoveryInMemory();
    const undo = await beginRecovery('ana');
    // O que a outra aba grava ao entrar pelo código: a mesma marca, de outra tentativa.
    await AsyncStorage.multiSet([
      [MARK_KEY, 'ana'],
      [MARK_BY_KEY, 'outra-aba'],
    ]);
    await undo();
    expect(await AsyncStorage.getItem(MARK_KEY)).toBe('ana');
    expect(await AsyncStorage.getItem(MARK_BY_KEY)).toBe('outra-aba');
  });

  it('a marca foi trocada ou tirada nesse meio: desfazer não mexe no aparelho nem na memória', async () => {
    forgetRecoveryInMemory();
    const undo = await beginRecovery('ana');
    // Código de outra conta digitado nesta aba enquanto o link esperava.
    startRecovery('bia');
    await flush();
    await undo();
    expect(await AsyncStorage.getItem(MARK_KEY)).toBe('bia');
    expect(recoveringUserId()).toBe('bia');

    const again = await beginRecovery('ana');
    await finishRecovery();
    await again();
    expect(await AsyncStorage.getItem(MARK_KEY)).toBeNull();
    expect(recoveringUserId()).toBeNull();
  });

  it('desfazer devolve também de quem era a marca que estava lá', async () => {
    await AsyncStorage.multiSet([
      [MARK_KEY, 'bia'],
      [MARK_BY_KEY, 'tentativa-da-bia'],
    ]);
    const undo = await beginRecovery('ana');
    expect(await AsyncStorage.getItem(MARK_BY_KEY)).not.toBe('tentativa-da-bia');
    await undo();
    expect(await AsyncStorage.getItem(MARK_KEY)).toBe('bia');
    expect(await AsyncStorage.getItem(MARK_BY_KEY)).toBe('tentativa-da-bia');
  });
});

describe('marca posta ou tirada por outra aba', () => {
  it('a aba que já estava na mesma conta recebe a marca e vai para a senha nova', () => {
    const open = { userId: null, readFor: 'ana' };
    expect(recoveryGate(open, 'ana')).toBe('free');
    const marked = recoveryAfterStorage(open, MARK_KEY, 'ana');
    expect(marked).toEqual({ userId: 'ana', readFor: 'ana' });
    expect(recoveryGate(marked, 'ana')).toBe('new-password');
  });

  it('a marca tirada (senha salva ou desistência em outra aba) solta a aba; o clear() do armazenamento também', () => {
    const marked = { userId: 'ana', readFor: 'ana' };
    expect(recoveryGate(recoveryAfterStorage(marked, MARK_KEY, null), 'ana')).toBe('free');
    expect(recoveryGate(recoveryAfterStorage(marked, null, null), 'ana')).toBe('free');
  });

  it('a marca de outra conta não prende a conta desta aba; outra chave não muda nada', () => {
    const open = { userId: null, readFor: 'bia' };
    expect(recoveryGate(recoveryAfterStorage(open, MARK_KEY, 'ana'), 'bia')).toBe('free');
    expect(recoveryAfterStorage(open, 'kotii:query-cache', '{}')).toBe(open);
  });

  it('aba sem conta: a marca fica na memória, e a conta que chegar depois já cai na senha nova', () => {
    const marked = recoveryAfterStorage({ userId: null, readFor: null }, MARK_KEY, 'ana');
    expect(recoveryGate(marked, 'ana')).toBe('reading');
    expect(recoveryGate({ ...marked, readFor: 'ana' }, 'ana')).toBe('new-password');
  });

  it('no celular não há o que ouvir, mesmo que exista um addEventListener', () => {
    const page = globalThis as { addEventListener?: unknown };
    const listen = jest.fn();
    page.addEventListener = listen;
    jest.isolateModules(() => {
      jest.requireActual('../passwordRecovery');
    });
    delete page.addEventListener;
    expect(listen).not.toHaveBeenCalled();
  });

  it('no navegador, o evento "storage" do localStorage chega ao estado', async () => {
    const page = globalThis as { addEventListener?: unknown; localStorage?: unknown };
    const area = {};
    let onStorage: (event: { key: string | null; newValue: string | null; storageArea: unknown }) => void = () => undefined;
    page.localStorage = area;
    page.addEventListener = (type: string, listener: typeof onStorage) => {
      if (type === 'storage') onStorage = listener;
    };
    let web: typeof import('../passwordRecovery') | undefined;
    jest.isolateModules(() => {
      jest.doMock('react-native', () => ({ Platform: { OS: 'web' } }));
      web = jest.requireActual<typeof import('../passwordRecovery')>('../passwordRecovery');
    });
    jest.dontMock('react-native');
    delete page.addEventListener;
    const tab = web as typeof import('../passwordRecovery');

    await tab.readRecovery('ana');
    expect(tab.recoveryGateNow('ana')).toBe('free');
    // Outro armazenamento (sessionStorage) com a mesma chave não conta.
    onStorage({ key: MARK_KEY, newValue: 'ana', storageArea: {} });
    expect(tab.recoveryGateNow('ana')).toBe('free');
    onStorage({ key: MARK_KEY, newValue: 'ana', storageArea: area });
    expect(tab.recoveryGateNow('ana')).toBe('new-password');
    onStorage({ key: MARK_KEY, newValue: null, storageArea: area });
    expect(tab.recoveryGateNow('ana')).toBe('free');
    // Uma leitura do aparelho que começou antes (e ainda achou a marca) não desfaz o que a outra aba acabou de dizer.
    await AsyncStorage.setItem(MARK_KEY, 'ana');
    const reading = tab.readRecovery('ana');
    onStorage({ key: MARK_KEY, newValue: null, storageArea: area });
    await reading;
    expect(tab.recoveryGateNow('ana')).toBe('free');
    delete page.localStorage;
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

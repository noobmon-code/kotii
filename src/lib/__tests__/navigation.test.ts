import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { router } from 'expo-router';

import { goBackOr } from '../navigation';

jest.mock('expo-router', () => ({ router: { back: jest.fn(), canGoBack: jest.fn(), replace: jest.fn() } }));

const back = jest.mocked(router.back);
const canGoBack = jest.mocked(router.canGoBack);
const replace = jest.mocked(router.replace);

afterEach(() => {
  jest.clearAllMocks();
});

describe('fechar a tela depois de salvar ou excluir', () => {
  it('com uma tela antes, volta para ela', () => {
    canGoBack.mockReturnValue(true);
    goBackOr('/prestadores');
    expect(back).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });

  it('sem tela para voltar (página recarregada ou aberta pelo endereço), vai para a lista em vez de ficar parada', () => {
    canGoBack.mockReturnValue(false);
    goBackOr('/prestadores');
    goBackOr({ pathname: '/prestador/[id]', params: { id: 'p1' } });
    expect(back).not.toHaveBeenCalled();
    expect(replace.mock.calls).toEqual([['/prestadores'], [{ pathname: '/prestador/[id]', params: { id: 'p1' } }]]);
  });
});

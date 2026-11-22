import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { router } from 'expo-router';

import { closeWindow, goBackOr } from '../navigation';

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

describe('fechar uma tela em janela pelo que ela mesma desenha (o "Fechar" do Nuke, o salvar, o excluir)', () => {
  it('com uma tela antes, volta para ela', () => {
    canGoBack.mockReturnValue(true);
    closeWindow('nuke');
    closeWindow('tarefa/[id]');
    expect(back).toHaveBeenCalledTimes(2);
    expect(replace).not.toHaveBeenCalled();
  });

  it('sem tela para voltar (aberta direto pelo endereço, ou recarregada), vai para o mesmo lugar do "Fechar" da caixa', () => {
    canGoBack.mockReturnValue(false);
    // O Nuke, que não é de nenhuma área, para a Hoje: sem isto o "Fechar" dele, o único que ele tem, não faria nada.
    closeWindow('nuke');
    closeWindow('consultor/conversa');
    closeWindow('tarefa/[id]');
    closeWindow('servico/[id]', { id: 'novo', aparelho: 'a1' });
    expect(back).not.toHaveBeenCalled();
    expect(replace.mock.calls).toEqual([
      [{ pathname: '/' }],
      [{ pathname: '/consultor' }],
      [{ pathname: '/casa', params: { aba: 'dia', dia: 'tarefas' } }],
      [{ pathname: '/aparelho/[id]', params: { id: 'a1' } }],
    ]);
  });
});

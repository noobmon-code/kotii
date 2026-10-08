import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';

import { SESSION_ENDED } from '@/lib/accessErrors';

import { errorBodyDetails, functionErrorDetails, functionErrorMessage } from '../images';

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockSession = { ended: false, checks: 0 };

jest.mock('@/lib/session', () => ({
  // Como o guarda da sessão: a limpeza de quem chamou só roda quando a sessão acabou.
  endSessionIfGone: async (beforeEnd?: () => Promise<unknown>) => {
    mockSession.checks += 1;
    if (mockSession.ended) await beforeEnd?.();
    return mockSession.ended;
  },
}));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

const response = (status: number, body: unknown) =>
  new FunctionsHttpError(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

beforeEach(() => {
  mockSession.ended = false;
  mockSession.checks = 0;
});

describe('erros das funções', () => {
  it('mostra a mensagem que a função devolveu', async () => {
    await expect(functionErrorMessage(response(429, { error: 'Limite de leituras atingido.' }), 'padrão')).resolves.toBe(
      'Limite de leituras atingido.',
    );
    expect(mockSession.checks).toBe(0);
  });

  it('sem mensagem, ou falha de rede: a mensagem de quem chamou', async () => {
    await expect(functionErrorMessage(response(500, { nada: 1 }), 'padrão')).resolves.toBe('padrão');
    await expect(functionErrorMessage(new FunctionsFetchError(new Error('offline')), 'padrão')).resolves.toBe('padrão');
  });

  it('401 com a sessão encerrada no servidor: pede para entrar de novo', async () => {
    mockSession.ended = true;
    await expect(functionErrorMessage(response(401, { error: 'Não autenticado.' }), 'Tente de novo.')).resolves.toBe(SESSION_ENDED);
    expect(mockSession.checks).toBe(1);
  });

  it('401 com a sessão encerrada: a limpeza de quem chamou vai junto para rodar antes de sair', async () => {
    mockSession.ended = true;
    const cleanup = jest.fn(async () => undefined);
    await functionErrorMessage(response(401, { error: 'Não autenticado.' }), 'Tente de novo.', cleanup);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('401 mas a sessão renovou: era só o token, a pessoa tenta de novo', async () => {
    await expect(functionErrorMessage(response(401, { error: 'Não autenticado.' }), 'Tente de novo.')).resolves.toBe('Tente de novo.');
    expect(mockSession.checks).toBe(1);
  });

  it('403 não é sessão encerrada (ex.: sem casa)', async () => {
    await expect(
      functionErrorMessage(response(403, { error: 'Crie ou entre em uma família primeiro.' }), 'padrão'),
    ).resolves.toBe('Crie ou entre em uma família primeiro.');
    expect(mockSession.checks).toBe(0);
  });
});

describe('código de erro das funções', () => {
  it('lê mensagem e código do corpo; o que não for texto fica de fora', () => {
    expect(errorBodyDetails({ error: 'Leia pela foto.', code: 'captcha', uf: '25' })).toEqual({
      message: 'Leia pela foto.',
      code: 'captcha',
    });
    expect(errorBodyDetails({ error: 1, code: { x: 1 } })).toEqual({ message: null, code: null });
    expect(errorBodyDetails(null)).toEqual({ message: null, code: null });
    expect(errorBodyDetails('erro')).toEqual({ message: null, code: null });
  });

  it('devolve o código junto com a mensagem da função', async () => {
    await expect(
      functionErrorDetails(response(422, { error: 'A Sefaz pediu a verificação. Leia pela foto.', code: 'captcha', uf: '25' }), 'padrão'),
    ).resolves.toEqual({ message: 'A Sefaz pediu a verificação. Leia pela foto.', code: 'captcha' });
  });

  it('código sem mensagem: a mensagem de quem chamou, com o código', async () => {
    await expect(functionErrorDetails(response(422, { code: 'captcha' }), 'padrão')).resolves.toEqual({
      message: 'padrão',
      code: 'captcha',
    });
  });

  it('sessão encerrada ou falha de rede: sem código', async () => {
    mockSession.ended = true;
    await expect(functionErrorDetails(response(401, { error: 'Não autenticado.', code: 'captcha' }), 'padrão')).resolves.toEqual({
      message: SESSION_ENDED,
      code: null,
    });
    await expect(functionErrorDetails(new FunctionsFetchError(new Error('offline')), 'padrão')).resolves.toEqual({
      message: 'padrão',
      code: null,
    });
  });
});

import { describe, expect, it, jest } from '@jest/globals';

import {
  accessErrorMessage,
  createSessionGuard,
  isHouseholdAccessError,
  isSessionEndedError,
  leftHousehold,
  markRemovedFromHousehold,
  NO_HOUSEHOLD_ACCESS,
  REMOVED_FROM_HOUSEHOLD,
  SESSION_ENDED,
  type SessionCheck,
  wroteNoRows,
} from '../accessErrors';

// Como o PostgREST e o storage devolvem a escrita barrada pela RLS.
const rls = () => ({ code: '42501', message: 'new row violates row-level security policy for table "shopping_lists"', details: null, hint: null });
const storageRls = () => Object.assign(new Error('new row violates row-level security policy'), { statusCode: '403' });

describe('escrita barrada pela casa', () => {
  it('reconhece a RLS das tabelas e do storage e o "sem casa" das funções do banco', () => {
    expect(isHouseholdAccessError(rls())).toBe(true);
    expect(isHouseholdAccessError(storageRls())).toBe(true);
    expect(isHouseholdAccessError({ code: '42501', message: 'sem casa' })).toBe(true);
    // Refeito a partir da mensagem já traduzida (new Error(errorMessage(err))).
    expect(isHouseholdAccessError(new Error(NO_HOUSEHOLD_ACCESS))).toBe(true);
  });

  it('não confunde com outros 42501 nem com outros erros', () => {
    expect(isHouseholdAccessError({ code: '42501', message: 'only the household owner can do this' })).toBe(false);
    expect(isHouseholdAccessError({ code: '42501', message: 'not authenticated' })).toBe(false);
    expect(isHouseholdAccessError(new Error('user does not belong to this household'))).toBe(false);
    expect(isHouseholdAccessError(new Error('Failed to fetch'))).toBe(false);
    expect(isHouseholdAccessError(null)).toBe(false);
    expect(isHouseholdAccessError('row-level security')).toBe(false);
  });

  it('sem conferir a casa, a mensagem é neutra; conferida, diz que a pessoa saiu', () => {
    const unchecked = rls();
    expect(accessErrorMessage(unchecked)).toBe(NO_HOUSEHOLD_ACCESS);
    const confirmed = rls();
    markRemovedFromHousehold(confirmed);
    expect(accessErrorMessage(confirmed)).toBe(REMOVED_FROM_HOUSEHOLD);
    // Só o erro conferido muda.
    expect(accessErrorMessage(unchecked)).toBe(NO_HOUSEHOLD_ACCESS);
  });

  it('outros erros seguem com a mensagem deles', () => {
    expect(accessErrorMessage(new Error('Código não encontrado.'))).toBeNull();
    expect(accessErrorMessage(undefined)).toBeNull();
    markRemovedFromHousehold('texto');
    markRemovedFromHousehold(null);
  });
});

describe('a casa conferida de novo', () => {
  const state = (ids: string[]) => ({ household: { id: ids[0] }, households: ids.map((id) => ({ id })) });

  it('a casa da escrita sumiu da lista: a pessoa saiu', () => {
    expect(leftHousehold('h1', state(['h2']))).toBe(true);
    expect(leftHousehold('h1', null)).toBe(true);
  });

  it('a casa continua na lista: foi outra coisa', () => {
    expect(leftHousehold('h1', state(['h2', 'h1']))).toBe(false);
    expect(leftHousehold('h1', state(['h1']))).toBe(false);
  });

  it('guardada antes das várias casas (sem a lista), vale a casa aberta', () => {
    expect(leftHousehold('h1', { household: { id: 'h1' } })).toBe(false);
    expect(leftHousehold('h1', { household: { id: 'h2' } })).toBe(true);
  });

  it('sem saber qual casa estava aberta, não afirma', () => {
    expect(leftHousehold(null, state(['h2']))).toBe(false);
  });
});

describe('sessão que acabou', () => {
  it('reconhece o erro pela mensagem', () => {
    expect(isSessionEndedError(new Error(SESSION_ENDED))).toBe(true);
    expect(isSessionEndedError(new Error('Não autenticado.'))).toBe(false);
    expect(isSessionEndedError(null)).toBe(false);
  });

  function guard(result: SessionCheck | Error) {
    const check = jest.fn(async (): Promise<SessionCheck> => {
      if (result instanceof Error) throw result;
      return result;
    });
    const end = jest.fn(async () => undefined);
    return { check, end, run: createSessionGuard({ check, end }) };
  }

  it('o Supabase diz que acabou: sai neste aparelho', async () => {
    const { end, run } = guard('ended');
    await expect(run()).resolves.toBe(true);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('renovou, ou não deu para saber: continua na conta', async () => {
    for (const result of ['valid', 'unknown', new Error('falhou')] as const) {
      const { end, run } = guard(result);
      await expect(run()).resolves.toBe(false);
      expect(end).not.toHaveBeenCalled();
    }
  });

  it('vários 401 ao mesmo tempo conferem e saem uma vez só', async () => {
    const { check, end, run } = guard('ended');
    await expect(Promise.all([run(), run(), run()])).resolves.toEqual([true, true, true]);
    expect(check).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
    // Terminada a conferência, um 401 novo confere de novo.
    await run();
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('a saída falhando não impede o aviso', async () => {
    const check = async (): Promise<SessionCheck> => 'ended';
    const run = createSessionGuard({ check, end: async () => Promise.reject(new Error('sem rede')) });
    await expect(run()).resolves.toBe(true);
  });

  it('acabou: a limpeza de quem chamou roda antes de sair (depois não haveria token)', async () => {
    const order: string[] = [];
    const run = createSessionGuard({
      check: async () => 'ended',
      end: async () => {
        order.push('sai');
      },
    });
    await run(async () => {
      order.push('apaga fotos');
    });
    expect(order).toEqual(['apaga fotos', 'sai']);
  });

  it('vários 401 juntos: a limpeza de cada um roda, uma vez', async () => {
    const { end, run } = guard('ended');
    const cleanups = [jest.fn(async () => undefined), jest.fn(async () => undefined)];
    await Promise.all([run(cleanups[0]), run(cleanups[1]), run()]);
    expect(cleanups[0]).toHaveBeenCalledTimes(1);
    expect(cleanups[1]).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('renovou, ou não deu para saber: a limpeza não roda (quem chamou segue com as fotos)', async () => {
    for (const result of ['valid', 'unknown'] as const) {
      const { run } = guard(result);
      const cleanup = jest.fn(async () => undefined);
      await run(cleanup);
      expect(cleanup).not.toHaveBeenCalled();
      // Nem numa conferência seguinte que acabe em saída.
      await run();
      expect(cleanup).not.toHaveBeenCalled();
    }
  });

  it('a limpeza falhando não impede a saída', async () => {
    const { end, run } = guard('ended');
    await expect(run(async () => Promise.reject(new Error('storage fora')))).resolves.toBe(true);
    expect(end).toHaveBeenCalledTimes(1);
  });
});

describe('mudança que não alcançou nenhuma linha', () => {
  it('só uma lista vazia de linhas conta', () => {
    expect(wroteNoRows([])).toBe(true);
    expect(wroteNoRows([{ id: 'a' }])).toBe(false);
    // Sem `.select`, o PostgREST não diz quantas linhas mudaram: não dá para afirmar.
    expect(wroteNoRows(null)).toBe(false);
    expect(wroteNoRows(undefined)).toBe(false);
    expect(wroteNoRows(0)).toBe(false);
  });
});

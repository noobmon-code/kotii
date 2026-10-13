import { describe, expect, it, jest } from '@jest/globals';

import { NO_HOUSEHOLD_ACCESS } from '../accessErrors';
import { BUSY_TRY_AGAIN, isDeadlock } from '../databaseErrors';
import { errorMessage } from '../supabase';

// O errorMessage de verdade: é por ele que todo erro do banco vira o texto do aviso. Só o que guarda a sessão
// no aparelho fica de fora.
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined },
}));
jest.mock('../sessionStorage', () => ({
  sessionStorage: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined },
}));

// Como o PostgREST devolve o pedido que o Postgres desfez para destravar outro.
const deadlock = {
  code: '40P01',
  message: 'deadlock detected',
  details: 'Process 4242 waits for ShareLock on transaction 771; blocked by process 4243.',
  hint: 'See server log for query details.',
};

describe('errorMessage', () => {
  it('pedido desfeito porque outra pessoa da casa mexeu na mesma coisa (40P01): pede para tentar de novo', () => {
    expect(isDeadlock(deadlock)).toBe(true);
    expect(errorMessage(deadlock)).toBe('Outra pessoa da casa mexeu nisso agora. Tente de novo.');
    expect(errorMessage(deadlock)).toBe(BUSY_TRY_AGAIN);
  });

  it('só o código conta: a mesma palavra em outro erro não muda a mensagem', () => {
    const other = { code: 'P0001', message: 'deadlock detected' };
    expect(isDeadlock(other)).toBe(false);
    expect(errorMessage(other)).toBe('deadlock detected');
    expect(isDeadlock(null)).toBe(false);
    expect(isDeadlock('40P01')).toBe(false);
  });

  it('os outros erros seguem como eram: o de acesso à casa, a mensagem do erro e o texto padrão', () => {
    expect(errorMessage({ code: '42501', message: 'new row violates row-level security policy for table "shopping_lists"' })).toBe(NO_HOUSEHOLD_ACCESS);
    expect(errorMessage(new Error('Código não encontrado.'))).toBe('Código não encontrado.');
    expect(errorMessage({ code: '23503', message: 'insert or update on table "x" violates foreign key constraint "y"' })).toBe(
      'insert or update on table "x" violates foreign key constraint "y"',
    );
    expect(errorMessage(undefined)).toBe('Algo deu errado. Tente novamente.');
    expect(errorMessage('texto')).toBe('Algo deu errado. Tente novamente.');
  });
});

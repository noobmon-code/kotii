import { describe, expect, it, jest } from '@jest/globals';

import type { FinAccount, FinTransaction } from '@/lib/types';

import {
  fetchAllPages,
  financeFetchStart,
  financeScreenHref,
  financeWindowStart,
  parseSyncResult,
  toFinAccount,
  toFinTransaction,
} from '../financeBeta';

jest.mock('@/lib/supabase', () => ({
  supabase: {},
  unwrap: (r: { data: unknown; error: unknown }) => {
    if (r.error) throw r.error;
    return r.data;
  },
}));
jest.mock('@/lib/auth', () => ({ useAuth: jest.fn(), useHousehold: jest.fn() }));
jest.mock('@/data/finance', () => ({ useBudgets: jest.fn(), useSaveBudgets: jest.fn() }));
jest.mock('@/data/images', () => ({ functionErrorMessage: async (_error: unknown, fallback: string) => fallback }));
jest.mock('expo-router', () => ({ router: { back: jest.fn(), navigate: jest.fn() } }));

describe('janela do consultor', () => {
  it('começa no primeiro dia de dois meses atrás (o retrato compara com eles)', () => {
    expect(financeWindowStart('2026-10-07')).toBe('2026-08-01');
    expect(financeWindowStart('2026-01-31')).toBe('2025-11-01');
    expect(financeWindowStart('2026-02-01')).toBe('2025-12-01');
  });

  it('os lançamentos vêm desde um ciclo de fatura antes da janela (para juntar parcelas e pares da virada)', () => {
    expect(financeFetchStart('2026-10-07')).toBe('2026-06-22');
    expect(financeFetchStart('2026-01-31')).toBe('2025-09-22');
  });
});

describe('resposta da sincronização', () => {
  it('confere os campos e mantém os erros por banco', () => {
    expect(
      parseSyncResult({
        synced: 2,
        skipped: 1,
        errors: [{ connectionId: 'c1', label: 'Inter', message: 'Item com erro de login na Pluggy.' }],
      }),
    ).toEqual({ synced: 2, skipped: 1, errors: [{ connectionId: 'c1', label: 'Inter', message: 'Item com erro de login na Pluggy.' }] });
  });

  it('resposta estranha vira zero, sem quebrar a tela', () => {
    expect(parseSyncResult(null)).toEqual({ synced: 0, skipped: 0, errors: [] });
    expect(parseSyncResult({ synced: 'x', errors: [null, { label: ' ', message: '' }] })).toEqual({
      synced: 0,
      skipped: 0,
      errors: [{ connectionId: '', label: 'Banco', message: 'Não consegui atualizar.' }],
    });
  });
});

describe('números do banco', () => {
  it('numeric que chega como texto vira número; vazio fica null', () => {
    const account = toFinAccount({
      balance: '1234.56',
      credit_limit: null,
      available_credit: '0',
      minimum_payment: '',
    } as unknown as FinAccount);
    expect(account).toMatchObject({ balance: 1234.56, credit_limit: null, available_credit: 0, minimum_payment: null });

    const tx = toFinTransaction({
      amount: '99.90',
      original_amount: null,
      installment_number: 2,
      total_installments: '10',
    } as unknown as FinTransaction);
    expect(tx).toMatchObject({ amount: 99.9, original_amount: null, installment_number: 2, total_installments: 10 });
  });
});

describe('leitura paginada', () => {
  it('segue pedindo enquanto a página vem cheia (1000 linhas)', async () => {
    const all = Array.from({ length: 2300 }, (_, i) => i);
    const asked: [number, number][] = [];
    const rows = await fetchAllPages<number>(async (from, to) => {
      asked.push([from, to]);
      return { data: all.slice(from, to + 1), error: null };
    });
    expect(rows).toHaveLength(2300);
    expect(asked).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('página exata pede mais uma, que volta vazia', async () => {
    const asked: number[] = [];
    const rows = await fetchAllPages<number>(async (from) => {
      asked.push(from);
      return { data: from === 0 ? Array.from({ length: 1000 }, (_, i) => i) : [], error: null };
    });
    expect(rows).toHaveLength(1000);
    expect(asked).toEqual([0, 1000]);
  });

  it('erro do banco sobe', async () => {
    await expect(fetchAllPages(async () => ({ data: null, error: new Error('sem permissão') }))).rejects.toThrow('sem permissão');
  });
});

describe('telas sugeridas pelo consultor', () => {
  it('contas e notas abrem a aba certa de Finanças', () => {
    expect(financeScreenHref('consultor')).toBe('/consultor');
    expect(financeScreenHref('orcamento')).toBe('/orcamento');
    expect(financeScreenHref('financas')).toEqual({ pathname: '/financas', params: { aba: 'resumo' } });
    expect(financeScreenHref('contas')).toEqual({ pathname: '/financas', params: { aba: 'contas' } });
    expect(financeScreenHref('notas')).toEqual({ pathname: '/financas', params: { aba: 'notas' } });
  });
});

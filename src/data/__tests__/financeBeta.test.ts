import { describe, expect, it, jest } from '@jest/globals';

import type { FinAccount, FinTransaction } from '@/lib/types';

import { supabase } from '@/lib/supabase';

import {
  fetchAllPages,
  financeFetchStart,
  financeScreenHref,
  financeWindowStart,
  parseSyncResult,
  repairSimilarMark,
  REPAIR_TRIES,
  type RepairState,
  runRepairs,
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

describe('marca das parecidas nas escolhas de Saúde antigas', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const missing = [{ matchKey: 'p:tx-1', similarKey: 'm:clinica sorriso' }];

  it('uma falha é tentada de novo na próxima vez; feita, não repete', async () => {
    const state: RepairState = new Map();
    const results = [false, true];
    const saves: string[] = [];
    const saved = jest.fn();
    const save = async (matchKey: string) => {
      saves.push(matchKey);
      if (!results.shift()) throw new Error('sem rede');
    };
    runRepairs(missing, state, save, saved);
    // Enquanto a primeira está em andamento, não começa outra igual.
    runRepairs(missing, state, save, saved);
    await flush();
    expect(state.get('p:tx-1')).toBe(1);
    expect(saved).not.toHaveBeenCalled();
    runRepairs(missing, state, save, saved);
    await flush();
    expect(state.get('p:tx-1')).toBe('done');
    expect(saved).toHaveBeenCalledTimes(1);
    runRepairs(missing, state, save, saved);
    await flush();
    expect(saves).toEqual(['p:tx-1', 'p:tx-1']);
  });

  it('desiste depois de algumas falhas enquanto o app está aberto', async () => {
    const state: RepairState = new Map();
    const save = jest.fn(async () => {
      throw new Error('sem rede');
    });
    for (let i = 0; i < REPAIR_TRIES + 2; i++) {
      runRepairs(missing, state, save, () => undefined);
      await flush();
    }
    expect(save).toHaveBeenCalledTimes(REPAIR_TRIES);
  });

  it('grava só a chave das parecidas, e só se a escolha ainda for Saúde', async () => {
    const calls: unknown[][] = [];
    const query: Record<string, unknown> = {
      then: (resolve: (value: unknown) => void) => resolve({ data: null, error: null }),
    };
    for (const method of ['update', 'eq']) {
      query[method] = (...args: unknown[]) => {
        calls.push([method, ...args]);
        return query;
      };
    }
    (supabase as unknown as { from: (table: string) => unknown }).from = (table) => {
      calls.push(['from', table]);
      return query;
    };
    await repairSimilarMark('p:tx-1', 'm:clinica sorriso');
    expect(calls).toEqual([
      ['from', 'fin_category_rules'],
      ['update', { similar_key: 'm:clinica sorriso' }],
      ['eq', 'match_key', 'p:tx-1'],
      ['eq', 'category', 'saude'],
    ]);
  });
});

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

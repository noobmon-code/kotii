import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { saveHouseholdLocationFor } from '@/data/weather';
import { HOUSEHOLD_HEADER } from '@/lib/householdHeader';

// O lugar de uma casa recém-criada vai para ela, e não para a aberta neste aparelho: o id da casa no corpo (a chave
// da tabela) e no cabeçalho do pedido (o current_household_id() da regra de acesso).

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockCalls: { table: string; row: unknown; options: unknown; headers: [string, string][] }[] = [];
const mockResult = { data: null as unknown, error: null as unknown };
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      upsert: (row: unknown, options: unknown) => {
        const call = { table, row, options, headers: [] as [string, string][] };
        mockCalls.push(call);
        const builder = {
          setHeader: (name: string, value: string) => {
            call.headers.push([name, value]);
            return builder;
          },
          then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.resolve(mockResult).then(resolve, reject),
        };
        return builder;
      },
    }),
  },
  unwrap: (result: { data: unknown; error: unknown }) => {
    if (result.error) throw result.error;
    return result.data;
  },
}));

const PLACE = { label: 'Pinheiros, São Paulo', latitude: -23.56, longitude: -46.69, source: 'cep' as const };

beforeEach(() => {
  mockCalls.length = 0;
  mockResult.error = null;
});

describe('saveHouseholdLocationFor', () => {
  it('manda a casa no corpo e no cabeçalho', async () => {
    await saveHouseholdLocationFor('nova', PLACE);
    expect(mockCalls).toEqual([
      {
        table: 'household_location',
        row: { household_id: 'nova', ...PLACE },
        options: { onConflict: 'household_id' },
        headers: [[HOUSEHOLD_HEADER, 'nova']],
      },
    ]);
  });

  it('a recusa do banco chega a quem chamou', async () => {
    mockResult.error = new Error('new row violates row-level security policy');
    await expect(saveHouseholdLocationFor('nova', PLACE)).rejects.toThrow('row-level security');
  });
});

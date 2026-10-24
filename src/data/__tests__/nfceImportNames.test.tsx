import { describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create } from 'react-test-renderer';

import { learnAbbreviations } from '@/domain/learnedAbbreviations';

import { useImportNfce } from '../receipts';

// "mock" no nome: o jest.mock só enxerga variáveis assim. O banco de mentira guarda as linhas gravadas.
const mockDb = { items: [] as Record<string, unknown>[] };
const mockLearned = { value: learnAbbreviations([{ description: 'AZ POR EU PARUS VD', productName: 'Azeite' }]) };

jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('@/lib/session', () => ({ endSessionIfGone: async () => false }));
// As abreviações que a casa ensinou chegam por aqui (os testes da leitura delas: learnedAbbreviations.test).
jest.mock('../learnedAbbreviations', () => ({ loadLearnedAbbreviations: async () => mockLearned.value }));

jest.mock('@/lib/supabase', () => {
  const table = (name: string) => {
    let verb: 'select' | 'insert' | 'delete' = 'select';
    let values: unknown;
    const answer = () => {
      if (name === 'receipt_items' && verb === 'insert') mockDb.items.push(...(values as Record<string, unknown>[]));
      if (name === 'receipts' && verb === 'insert') return { data: { id: 'n1' }, error: null };
      if (name === 'stores') return { data: { id: 's1' }, error: null };
      return { data: null, error: null };
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      in: () => builder,
      limit: () => builder,
      insert: (rows: unknown) => {
        verb = 'insert';
        values = rows;
        return builder;
      },
      delete: () => {
        verb = 'delete';
        return builder;
      },
      maybeSingle: async () => answer(),
      single: async () => answer(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(answer()).then(resolve),
    };
    return builder;
  };
  return {
    supabase: {
      from: table,
      rpc: async () => ({ data: [], error: null }),
      functions: {
        invoke: async () => ({
          data: {
            store: { name: 'Mercado Bom', cnpj: '12345678000199', address: null },
            issuedAtLocal: null,
            total: 41.9,
            items: [
              { description: 'AZ GALLO 500ML', code: null, quantity: 1, unit: 'UN', unitPrice: 32, totalPrice: 32 },
              { description: 'TOALHA AZ', code: null, quantity: 1, unit: 'UN', unitPrice: 9.9, totalPrice: 9.9 },
            ],
          },
          error: null,
        }),
      },
    },
    unwrap: (result: { data: unknown; error: unknown }) => {
      if (result.error) throw result.error;
      return result.data;
    },
  };
});

describe('leitura do QR code: o nome sugerido com as abreviações da casa', () => {
  it('o item novo vem por extenso onde a casa ensinou; o resto, como a nota escreve', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
    let importNfce: ReturnType<typeof useImportNfce> | undefined;
    function Probe() {
      importNfce = useImportNfce();
      return null;
    }
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
    });
    let result: unknown;
    await act(async () => {
      result = await importNfce!.mutateAsync({
        url: 'https://nfce.fazenda.sp.gov.br/qr?p=1',
        accessKey: '35261012345678000199650010000123451000012347',
        uf: '35',
        cnpj: '12345678000199',
        month: '2026-10',
      });
    });
    expect(result).toEqual({ receipt_id: 'n1', duplicate: false });
    expect(mockDb.items.map((row) => [row.raw_description, row.suggested_name])).toEqual([
      ['AZ GALLO 500ML', 'Azeite gallo 500ml'],
      ['TOALHA AZ', 'Toalha az'],
    ]);
    await act(async () => renderer?.unmount());
    queryClient.clear();
  });
});

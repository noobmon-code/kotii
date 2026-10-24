import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create } from 'react-test-renderer';

import { NO_LEARNED, type LearnedAbbreviations } from '@/domain/learnedAbbreviations';

import { loadLearnedAbbreviations, useLearnedAbbreviations } from '../learnedAbbreviations';

// "mock" no nome: o jest.mock só enxerga variáveis assim. Os apelidos e os produtos da casa, como o banco devolve.
const mockDb = {
  aliases: [{ alias: 'AZ POR EU PARUS VD', product_id: 'p1' }] as { alias: string; product_id: string }[],
  products: [{ id: 'p1', name: 'Azeite' }],
  aliasReads: 0,
  fail: false,
};

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => ({
          limit: async () => {
            mockDb.aliasReads++;
            return mockDb.fail ? { data: null, error: new Error('caiu a rede') } : { data: mockDb.aliases, error: null };
          },
        }),
      }),
    }),
  },
  unwrap: (result: { data: unknown; error: unknown }) => {
    if (result.error) throw result.error;
    return result.data;
  },
}));
jest.mock('../market', () => {
  const { useQuery } = jest.requireActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  const fetchProducts = async () => mockDb.products;
  return { fetchProducts, useProducts: () => useQuery({ queryKey: ['products'], queryFn: fetchProducts }) };
});

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });

afterEach(() => {
  mockDb.aliasReads = 0;
  mockDb.fail = false;
  onlineManager.setOnline(true);
});

describe('loadLearnedAbbreviations (a leitura do QR code)', () => {
  it('com os apelidos e os produtos, o que a casa ensinou; de novo com as mesmas listas, a mesma conta', async () => {
    const client = newClient();
    const learned = await loadLearnedAbbreviations(client);
    expect(learned.words.get('az')).toBe('azeite');
    expect(await loadLearnedAbbreviations(client)).toBe(learned);
    expect(mockDb.aliasReads).toBe(1);
    client.clear();
  });

  it('sem internet, o que estiver guardado; sem nada guardado, nada aprendido (sem esperar a conexão)', async () => {
    onlineManager.setOnline(false);
    const empty = newClient();
    expect(await loadLearnedAbbreviations(empty)).toBe(NO_LEARNED);
    const kept = newClient();
    kept.setQueryData(['productAliases'], mockDb.aliases);
    kept.setQueryData(['products'], mockDb.products);
    expect((await loadLearnedAbbreviations(kept)).words.get('az')).toBe('azeite');
    expect(mockDb.aliasReads).toBe(0);
    empty.clear();
    kept.clear();
  });

  it('a leitura que falha: nada aprendido, sem erro', async () => {
    mockDb.fail = true;
    const client = newClient();
    expect(await loadLearnedAbbreviations(client)).toBe(NO_LEARNED);
    client.clear();
  });
});

describe('useLearnedAbbreviations (as telas)', () => {
  async function render(options?: { enabled?: boolean }) {
    const client = newClient();
    const seen: LearnedAbbreviations[] = [];
    function Probe() {
      seen.push(useLearnedAbbreviations(options));
      return null;
    }
    let renderer: ReturnType<typeof create> | undefined;
    await act(async () => {
      renderer = create(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      );
    });
    for (let turn = 0; turn < 10; turn++) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    await act(async () => renderer?.unmount());
    client.clear();
    return seen;
  }

  it('nada aprendido até os apelidos chegarem; depois, o que a casa ensinou', async () => {
    const seen = await render();
    expect(seen[0]).toBe(NO_LEARNED);
    expect(seen.at(-1)!.words.get('az')).toBe('azeite');
  });

  it('desligado (a nota já confirmada), nem lê os apelidos', async () => {
    const seen = await render({ enabled: false });
    expect(seen.every((learned) => learned === NO_LEARNED)).toBe(true);
    expect(mockDb.aliasReads).toBe(0);
  });

  it('a leitura que falha: nada aprendido, e a tela segue', async () => {
    mockDb.fail = true;
    const seen = await render();
    expect(seen.every((learned) => learned === NO_LEARNED)).toBe(true);
  });
});

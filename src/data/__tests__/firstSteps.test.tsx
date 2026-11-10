import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useAnyList, useAnyReceipt } from '../firstSteps';

// As duas perguntas dos "Primeiros passos" (a casa já teve uma lista? uma nota?): só vão ao banco quando ligadas, e
// o "sim" que a tela viu (uma lista aberta, um rascunho) fica na resposta guardada, para ela não voltar a "não" sem
// o servidor dizer. O banco é de mentira: quantas linhas cada tabela tem, e quantas vezes foi perguntado.

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockDb = { rows: { shopping_lists: 0, receipts: 0 } as Record<string, number>, asked: [] as string[] };

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        limit: async () => {
          mockDb.asked.push(table);
          return { data: Array.from({ length: Math.min(mockDb.rows[table] ?? 0, 1) }, (_, i) => ({ id: `${table}-${i}` })), error: null };
        },
      }),
    }),
  },
  unwrap: (result: { data: unknown; error: unknown }) => {
    if (result.error) throw result.error;
    return result.data;
  },
}));

let client: QueryClient;
let renderer: ReactTestRenderer | undefined;
const seen: { list?: boolean; receipt?: boolean } = {};

function Probe({ ask, saw }: { ask: boolean; saw: boolean }) {
  const list = useAnyList(ask, saw).data;
  const receipt = useAnyReceipt(ask, saw).data;
  useEffect(() => {
    seen.list = list;
    seen.receipt = receipt;
  });
  return null;
}

async function render(props: { ask: boolean; saw: boolean }) {
  await act(async () => {
    const element = (
      <QueryClientProvider client={client}>
        <Probe {...props} />
      </QueryClientProvider>
    );
    if (renderer) renderer.update(element);
    else renderer = create(element);
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
  mockDb.rows = { shopping_lists: 0, receipts: 0 };
  mockDb.asked = [];
  seen.list = undefined;
  seen.receipt = undefined;
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  client.clear();
});

describe('as perguntas dos primeiros passos', () => {
  it('desligadas, nada é perguntado; ligadas, uma linha de cada tabela', async () => {
    await render({ ask: false, saw: false });
    expect(mockDb.asked).toEqual([]);
    await render({ ask: true, saw: false });
    expect(mockDb.asked.sort()).toEqual(['receipts', 'shopping_lists']);
    expect(seen).toEqual({ list: false, receipt: false });
  });

  it('o "sim" que a tela viu fica guardado sem ir ao banco, e a resposta não volta ao "não" de antes', async () => {
    await render({ ask: true, saw: false });
    expect(seen).toEqual({ list: false, receipt: false });
    mockDb.asked = [];
    // A tela viu uma lista aberta e um rascunho (feitos em outro celular): as perguntas param, e o "sim" fica.
    mockDb.rows = { shopping_lists: 1, receipts: 1 };
    await render({ ask: false, saw: true });
    expect(mockDb.asked).toEqual([]);
    expect(client.getQueryData(['lists', 'any'])).toBe(true);
    expect(client.getQueryData(['receipts', 'any'])).toBe(true);
    // A lista foi arquivada e o rascunho confirmado: a pergunta volta, ainda dentro do tempo da resposta, e diz "sim".
    await render({ ask: true, saw: false });
    expect(seen).toEqual({ list: true, receipt: true });
  });
});

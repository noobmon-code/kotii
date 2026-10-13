import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager } from '@tanstack/react-query';

import { TRIP_LIMIT_REACHED, TRIP_NOT_READY } from '@/domain/marketTrips';

import { announceMarketTrip, fetchMarketTrips, isNotDeployed, marketTripErrorMessage, readMarketTripPush } from '../marketTrips';

// "mock" no nome: o jest.mock só enxerga variáveis assim. O que o banco
// responde em cada chamada, e o que foi pedido a ele.
const mockDb: {
  trips: { data: unknown; error: unknown };
  rpc: { data: unknown; error: unknown };
  filters: unknown[][];
  calls: [string, unknown][];
} = { trips: { data: [], error: null }, rpc: { data: null, error: null }, filters: [], calls: [] };

// A opção do aviso, como lib/reminders a entrega (só existe no navegador).
const mockPush: { supported: boolean; read: () => Promise<boolean> } = { supported: true, read: async () => true };

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      // A consulta encadeada do Supabase: cada filtro devolve a mesma consulta, e esperar por ela dá a resposta.
      const query: Record<string, unknown> = {};
      for (const step of ['select', 'is', 'gt', 'order', 'limit']) {
        query[step] = (...args: unknown[]) => {
          mockDb.filters.push([table, step, ...args]);
          return query;
        };
      }
      query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(mockDb.trips).then(resolve, reject);
      return query;
    },
    rpc: async (name: string, args: unknown) => {
      mockDb.calls.push([name, args]);
      return mockDb.rpc;
    },
  },
  unwrap: (result: { data: unknown; error: unknown }) => {
    if (result.error) throw result.error;
    return result.data;
  },
  errorMessage: (error: { message?: string }) => error?.message ?? 'Algo deu errado. Tente novamente.',
}));

jest.mock('@/lib/reminders', () => ({
  get marketTripPushSupported() {
    return mockPush.supported;
  },
  getMarketTripPush: () => mockPush.read(),
  setMarketTripPush: async () => true,
}));

// Como o PostgREST e o Postgres respondem quando o banco ainda não tem a migração das idas.
const MISSING_TABLE = { code: 'PGRST205', message: "Could not find the table 'public.market_trips' in the schema cache" };
const MISSING_TABLE_PG = { code: '42P01', message: 'relation "public.market_trips" does not exist' };
const MISSING_FUNCTION = { code: 'PGRST202', message: 'Could not find the function public.announce_market_trip(p_list_id) in the schema cache' };
const MISSING_FUNCTION_PG = { code: '42883', message: 'function public.announce_market_trip(uuid) does not exist' };
const MISSING_COLUMN = { code: '42703', message: 'column push_subscriptions.market_trips does not exist' };
const MISSING_COLUMN_REST = { code: 'PGRST204', message: "Could not find the 'market_trips' column of 'push_subscriptions' in the schema cache" };

beforeEach(() => {
  mockDb.trips = { data: [], error: null };
  mockDb.rpc = { data: null, error: null };
  mockDb.filters = [];
  mockDb.calls = [];
  mockPush.supported = true;
  mockPush.read = async () => true;
});

afterEach(() => {
  onlineManager.setOnline(true);
});

describe('banco de antes da migração das idas', () => {
  it('reconhece tabela, função e coluna que não existem, pelo código do PostgREST e do Postgres', () => {
    for (const error of [MISSING_TABLE, MISSING_TABLE_PG, MISSING_FUNCTION, MISSING_FUNCTION_PG, MISSING_COLUMN, MISSING_COLUMN_REST]) {
      expect(isNotDeployed(error)).toBe(true);
    }
    // Outros erros continuam sendo erros: a regra de acesso, o limite, a rede, nada.
    expect(isNotDeployed({ code: '42501', message: 'permission denied for table market_trips' })).toBe(false);
    expect(isNotDeployed({ code: 'NK005', message: 'too many market trips' })).toBe(false);
    expect(isNotDeployed(new TypeError('Failed to fetch'))).toBe(false);
    expect(isNotDeployed(null)).toBe(false);
    expect(isNotDeployed(undefined)).toBe(false);
  });

  it('as idas: sem a tabela, a resposta é "não há" (sem faixa e sem erro na tela)', async () => {
    mockDb.trips = { data: null, error: MISSING_TABLE };
    expect(await fetchMarketTrips()).toBeNull();
    mockDb.trips = { data: null, error: MISSING_TABLE_PG };
    expect(await fetchMarketTrips()).toBeNull();
  });

  it('avisar: sem a função, a mensagem diz que o aviso ainda está sendo ativado', async () => {
    for (const error of [MISSING_FUNCTION, MISSING_FUNCTION_PG]) {
      mockDb.rpc = { data: null, error };
      const failure = await announceMarketTrip('lista').catch((err: unknown) => err);
      expect(marketTripErrorMessage(failure)).toBe(TRIP_NOT_READY);
    }
    expect(TRIP_NOT_READY).toBe('O aviso de ida ao mercado ainda está sendo ativado no Kotii. Tente de novo mais tarde.');
  });

  it('a opção do aviso: sem a coluna, não existe (a tela a esconde)', async () => {
    for (const error of [MISSING_COLUMN, MISSING_COLUMN_REST]) {
      mockPush.read = async () => {
        throw error;
      };
      expect(await readMarketTripPush()).toBeNull();
    }
  });
});

describe('as idas da casa', () => {
  const now = new Date('2026-10-13T10:00:00Z');

  it('busca as que ainda podem valer: não encerradas e antes do fim, as mais novas primeiro', async () => {
    const rows = [{ id: 't1', list_id: 'l1', user_id: 'u1', display_name: 'Ana', created_at: '2026-10-13T09:50:00Z', ends_at: '2026-10-13T11:50:00Z', ended_at: null }];
    mockDb.trips = { data: rows, error: null };
    expect(await fetchMarketTrips(now)).toEqual(rows);
    expect(mockDb.filters).toEqual([
      ['market_trips', 'select', 'id, list_id, user_id, display_name, created_at, ends_at, ended_at'],
      ['market_trips', 'is', 'ended_at', null],
      ['market_trips', 'gt', 'ends_at', '2026-10-13T10:00:00.000Z'],
      ['market_trips', 'order', 'created_at', { ascending: false }],
      ['market_trips', 'limit', 50],
    ]);
  });

  it('nenhuma ida é lista vazia, não "banco antigo"', async () => {
    mockDb.trips = { data: [], error: null };
    expect(await fetchMarketTrips(now)).toEqual([]);
  });

  it('outros erros (sem resposta, acesso barrado) são erros: quem mostra a faixa só não a mostra', async () => {
    mockDb.trips = { data: null, error: { code: '42501', message: 'permission denied for table market_trips' } };
    await expect(fetchMarketTrips(now)).rejects.toMatchObject({ code: '42501' });
    mockDb.trips = { data: null, error: { message: 'TypeError: Failed to fetch' } };
    await expect(fetchMarketTrips(now)).rejects.toMatchObject({ message: 'TypeError: Failed to fetch' });
  });
});

describe('avisar a casa', () => {
  it('chama a função com a lista e devolve o que ela contou', async () => {
    const result = { trip_id: 't1', created_at: '2026-10-13T10:00:00Z', notified: 2, members: 3, repeated: false };
    mockDb.rpc = { data: result, error: null };
    expect(await announceMarketTrip('lista-1')).toEqual(result);
    // Só a lista: o nome e o texto do aviso são do servidor.
    expect(mockDb.calls).toEqual([['announce_market_trip', { p_list_id: 'lista-1' }]]);
  });

  it('sem internet, nem tenta: diz para avisar quando a conexão voltar', async () => {
    onlineManager.setOnline(false);
    await expect(announceMarketTrip('lista-1')).rejects.toThrow('Sem internet agora. Avise a casa quando a conexão voltar.');
    expect(mockDb.calls).toEqual([]);
  });

  it('as mensagens dos erros: o limite do dia, a lista que saiu e o resto como veio', () => {
    expect(marketTripErrorMessage({ code: 'NK005', message: 'too many market trips' })).toBe(TRIP_LIMIT_REACHED);
    expect(TRIP_LIMIT_REACHED).toBe('Você já avisou a casa várias vezes hoje. Tente de novo mais tarde.');
    expect(marketTripErrorMessage({ code: 'P0002', message: 'list not found' })).toBe(
      'Esta lista não está mais aberta. Volte para as listas e escolha outra.',
    );
    expect(marketTripErrorMessage(new Error('Sem internet agora. Avise a casa quando a conexão voltar.'))).toBe(
      'Sem internet agora. Avise a casa quando a conexão voltar.',
    );
  });
});

describe('a opção "Alguém indo ao mercado"', () => {
  it('no navegador com avisos: o que está na inscrição dele', async () => {
    expect(await readMarketTripPush()).toBe(true);
    mockPush.read = async () => false;
    expect(await readMarketTripPush()).toBe(false);
  });

  it('no celular (ou num navegador sem avisos) não existe, e nada é lido', async () => {
    mockPush.supported = false;
    mockPush.read = async () => {
      throw new Error('não era para ler');
    };
    expect(await readMarketTripPush()).toBeNull();
  });

  it('sem conseguir ler (sem internet), é erro: a tela espera em vez de mostrar a opção errada', async () => {
    mockPush.read = async () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(readMarketTripPush()).rejects.toThrow('Failed to fetch');
  });
});

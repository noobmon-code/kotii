import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager } from '@tanstack/react-query';

import { TRIP_LIMIT_REACHED, TRIP_NOT_READY, TRIP_OFFLINE } from '@/domain/marketTrips';

import { announceMarketTrip, endMarketTrip, fetchMarketTrips, isNotDeployed, marketTripErrorMessage, readMarketTripPush } from '../marketTrips';

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
      for (const step of ['select', 'is', 'gt', 'order', 'limit', 'range']) {
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

// O que a busca das idas pede: a ida e, junto, a lista dela.
const TRIPS_SELECT = 'id, list_id, user_id, display_name, created_at, ends_at, ended_at, list:shopping_lists!inner(name, kind, archived_at)';

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

  it('as idas: a busca que traz a lista junto também responde pela tabela que falta, antes de olhar a lista', async () => {
    // No banco antigo a lista existe e as idas não: o PostgREST recusa pela tabela pedida (market_trips).
    mockDb.trips = { data: null, error: MISSING_TABLE };
    expect(await fetchMarketTrips()).toBeNull();
    expect(mockDb.filters[0]).toEqual(['market_trips', 'select', TRIPS_SELECT]);
  });

  it('encerrar: sem a função, a mesma mensagem', async () => {
    for (const error of [MISSING_FUNCTION, MISSING_FUNCTION_PG]) {
      mockDb.rpc = { data: null, error };
      const failure = await endMarketTrip('ida').catch((err: unknown) => err);
      expect(marketTripErrorMessage(failure, 'end')).toBe(TRIP_NOT_READY);
    }
  });

  it('avisar: sem a função, a mensagem diz que o aviso ainda está sendo ativado', async () => {
    for (const error of [MISSING_FUNCTION, MISSING_FUNCTION_PG]) {
      mockDb.rpc = { data: null, error };
      const failure = await announceMarketTrip('lista').catch((err: unknown) => err);
      expect(marketTripErrorMessage(failure, 'announce')).toBe(TRIP_NOT_READY);
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

  it('busca as que ainda podem valer, cada uma com a lista dela: não encerradas, antes do fim e de lista aberta, as mais novas primeiro', async () => {
    const rows = [
      {
        id: 't1',
        list_id: 'l1',
        user_id: 'u1',
        display_name: 'Ana',
        created_at: '2026-10-13T09:50:00Z',
        ends_at: '2026-10-13T11:50:00Z',
        ended_at: null,
        list: { name: 'Feira', kind: 'mercado', archived_at: null },
      },
    ];
    mockDb.trips = { data: rows, error: null };
    expect(await fetchMarketTrips(now)).toEqual(rows);
    expect(mockDb.filters).toEqual([
      // A lista vem na mesma busca (pelo FK da ida): a faixa não depende das listas guardadas no aparelho.
      ['market_trips', 'select', TRIPS_SELECT],
      ['market_trips', 'is', 'ended_at', null],
      ['market_trips', 'gt', 'ends_at', '2026-10-13T10:00:00.000Z'],
      // A lista arquivada sai no servidor (com o !inner, a ida sai junto), e não só depois, em liveTrips.
      ['market_trips', 'is', 'list.archived_at', null],
      ['market_trips', 'order', 'created_at', { ascending: false }],
    ]);
  });

  it('sem limite de linhas: nenhuma ida que vale fica de fora da resposta', async () => {
    // Cada pessoa tem até 5 idas por dia na casa, mas a casa não tem limite de moradores.
    await fetchMarketTrips(now);
    expect(mockDb.filters.filter(([, step]) => step === 'limit' || step === 'range')).toEqual([]);
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

  it('sem internet, nem tenta: diz para tentar de novo quando a conexão voltar', async () => {
    onlineManager.setOnline(false);
    const failure = await announceMarketTrip('lista-1').catch((err: unknown) => err);
    expect(marketTripErrorMessage(failure, 'announce')).toBe('Sem internet agora. Tente avisar de novo quando a conexão voltar.');
    expect(mockDb.calls).toEqual([]);
  });

  it('as mensagens dos erros: o limite do dia, a lista que saiu e o resto como veio', () => {
    expect(marketTripErrorMessage({ code: 'NK005', message: 'too many market trips' }, 'announce')).toBe(TRIP_LIMIT_REACHED);
    expect(TRIP_LIMIT_REACHED).toBe('Você já avisou a casa várias vezes hoje. Tente de novo mais tarde.');
    expect(marketTripErrorMessage({ code: 'P0002', message: 'list not found' }, 'announce')).toBe(
      'Esta lista não está mais aberta. Volte para as listas e escolha outra.',
    );
    expect(marketTripErrorMessage({ code: '42501', message: 'sem casa' }, 'announce')).toBe('sem casa');
    expect(marketTripErrorMessage(new Error('Outro erro qualquer'), 'end')).toBe('Outro erro qualquer');
  });
});

describe('encerrar a ida', () => {
  it('chama a função com a ida e devolve se encerrou', async () => {
    mockDb.rpc = { data: true, error: null };
    expect(await endMarketTrip('ida-1')).toBe(true);
    expect(mockDb.calls).toEqual([['end_market_trip', { p_trip_id: 'ida-1' }]]);
  });

  it('sem internet, nem tenta: diz para encerrar quando a conexão voltar', async () => {
    onlineManager.setOnline(false);
    const failure = await endMarketTrip('ida-1').catch((err: unknown) => err);
    expect(marketTripErrorMessage(failure, 'end')).toBe('Sem internet agora. Encerre quando a conexão voltar.');
    expect(mockDb.calls).toEqual([]);
  });
});

describe('o pedido que não chegou ao servidor (sinal fraco, com o aparelho dizendo que há internet)', () => {
  // Como o postgrest-js devolve o erro do fetch: o nome e o texto dele na mensagem, sem código.
  const failures = [
    { code: '', message: 'TypeError: Network request failed', details: '', hint: '' },
    { code: '', message: 'TypeError: Failed to fetch', details: '', hint: '' },
    { code: '', message: 'TypeError: Load failed', details: '', hint: '' },
    { message: 'TypeError: NetworkError when attempting to fetch resource.' },
    new TypeError('Failed to fetch'),
    new TypeError('Network request failed'),
  ];

  it('vira a frase de sem internet de cada pedido, e não o texto do navegador', async () => {
    for (const error of failures) {
      expect(marketTripErrorMessage(error, 'end')).toBe(TRIP_OFFLINE.end);
      expect(marketTripErrorMessage(error, 'announce')).toBe(TRIP_OFFLINE.announce);
    }
    expect(TRIP_OFFLINE).toEqual({
      announce: 'Sem internet agora. Tente avisar de novo quando a conexão voltar.',
      end: 'Sem internet agora. Encerre quando a conexão voltar.',
    });
    // Pelo caminho inteiro: a função responde com o erro do fetch.
    mockDb.rpc = { data: null, error: failures[0] };
    expect(marketTripErrorMessage(await endMarketTrip('ida-1').catch((err: unknown) => err), 'end')).toBe(TRIP_OFFLINE.end);
    expect(marketTripErrorMessage(await announceMarketTrip('lista-1').catch((err: unknown) => err), 'announce')).toBe(TRIP_OFFLINE.announce);
  });

  it('um erro com código é do servidor: fica como veio, mesmo falando em fetch', () => {
    expect(marketTripErrorMessage({ code: 'P0001', message: 'Failed to fetch the list' }, 'end')).toBe('Failed to fetch the list');
    expect(marketTripErrorMessage({ code: '42501', message: 'TypeError: algo do servidor' }, 'announce')).toBe('TypeError: algo do servidor');
  });

  it('na opção dos avisos (sem dizer o pedido) nada muda: o erro fica como veio, e o banco antigo tem a mensagem dele', () => {
    expect(marketTripErrorMessage(failures[0])).toBe('TypeError: Network request failed');
    expect(marketTripErrorMessage(MISSING_FUNCTION)).toBe(TRIP_NOT_READY);
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

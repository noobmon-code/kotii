import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { ReactElement } from 'react';
import { act, create, type ReactTestRenderer, type ReactTestRendererJSON } from 'react-test-renderer';

import { ActionSheet } from '@/ui/ActionSheet';
import { notify } from '@/ui/dialogs';

import { MarketTripAction, MarketTripBanner } from '../MarketTrip';

// A faixa e o botão de verdade, com as idas lidas pelo caminho real
// (data/marketTrips); só o banco é trocado. "mock" no nome: o jest.mock só
// enxerga variáveis assim.
const mockDb: {
  /** O que a busca das idas responde; null: ainda não respondeu. */
  trips: { data: unknown; error: unknown } | null;
  rpc: { data: unknown; error: unknown };
  calls: [string, unknown][];
} = { trips: { data: [], error: null }, rpc: { data: null, error: null }, calls: [] };

const mockHouse: { user: string; members: number } = { user: 'ana', members: 2 };

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => {
      const query: Record<string, unknown> = {};
      for (const step of ['select', 'is', 'gt', 'order', 'limit']) query[step] = () => query;
      query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        (mockDb.trips ? Promise.resolve(mockDb.trips) : new Promise(() => undefined)).then(resolve, reject);
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
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: mockHouse.user } } }),
  useHousehold: () => ({ data: { members: Array.from({ length: mockHouse.members }, (_, i) => ({ user_id: `m${i}` })) } }),
}));
jest.mock('@/lib/reminders', () => ({ marketTripPushSupported: false, getMarketTripPush: async () => false, setMarketTripPush: async () => false }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  // A tela em foco: o efeito roda como ao abrir a tela.
  useFocusEffect: (effect: () => void) => jest.requireActual<typeof import('react')>('react').useEffect(effect, [effect]),
}));
jest.mock('@/ui/dialogs', () => ({ notify: jest.fn() }));
// As ilustrações usam o reanimated, que não roda aqui.
jest.mock('@/ui/art', () => ({ Mascot: () => null, Spot: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));

const MISSING_TABLE = { code: 'PGRST205', message: "Could not find the table 'public.market_trips' in the schema cache" };
const FETCH_FAILED = { code: '', message: 'TypeError: Network request failed', details: '', hint: '' };

/** Uma ida avisada há `minutes` minutos, com a lista dela, como a busca a devolve. */
const trip = (id: string, minutes: number, over: Record<string, unknown> = {}) => {
  const created = Date.now() - minutes * 60_000;
  return {
    id,
    list_id: 'lista',
    user_id: 'beto',
    display_name: 'Beto',
    created_at: new Date(created).toISOString(),
    ends_at: new Date(created + 2 * 3_600_000).toISOString(),
    ended_at: null,
    list: { name: 'Feira', kind: 'mercado', archived_at: null },
    ...over,
  };
};

/** O desenho de um ícone: um caractere só, da fonte de ícones. */
const isIcon = (text: string) => [...text].length === 1 && (text.codePointAt(0) ?? 0) >= 0xe000;

/** Todos os textos da tela, na ordem (sem os ícones). */
function textsOf(node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null): string[] {
  if (node === null) return [];
  if (typeof node === 'string') return isIcon(node) ? [] : [node];
  if (Array.isArray(node)) return node.flatMap(textsOf);
  return (node.children ?? []).flatMap(textsOf);
}

let client: QueryClient;
let tree: ReactTestRenderer;

async function render(element: ReactElement) {
  await act(async () => {
    tree = create(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
  });
  // A busca das idas termina (quando responde).
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return textsOf(tree.toJSON());
}

/** Toca num botão pelo título e espera o pedido terminar. */
async function press(title: string) {
  await act(async () => {
    tree.root.findAllByProps({ title })[0].props.onPress();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** "Estou indo ao mercado" → "Avisar agora"; devolve o que a pessoa leu depois. */
async function announce(result: unknown) {
  mockDb.rpc = { data: result, error: null };
  await render(<MarketTripAction list={{ id: 'lista', kind: 'mercado' }} />);
  await press('Estou indo ao mercado');
  await act(async () => {
    tree.root.findByType(ActionSheet).props.actions[0].onPress();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return jest.mocked(notify).mock.calls.at(-1);
}

beforeEach(() => {
  // As mutações como no app (lib/queryClient): sem internet, falham na hora em vez de esperar.
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity }, mutations: { networkMode: 'always', gcTime: Infinity } } });
  Object.assign(mockDb, { trips: { data: [], error: null }, rpc: { data: null, error: null }, calls: [] });
  Object.assign(mockHouse, { user: 'ana', members: 2 });
  jest.mocked(notify).mockClear();
  jest.mocked(router.push).mockClear();
});

afterEach(async () => {
  await act(async () => tree.unmount());
  client.clear();
  onlineManager.setOnline(true);
});

describe('a faixa na tela Hoje', () => {
  it('aparece sem depender das listas guardadas no aparelho, e "Abrir a lista" vai para a lista da ida', async () => {
    // Uma lista que este aparelho ainda não buscou: tudo o que a faixa usa vem com a ida.
    mockDb.trips = { data: [trip('t1', 4, { list_id: 'nova' })], error: null };
    expect(await render(<MarketTripBanner openable />)).toEqual(['Beto está indo ao mercado · há 4 min', 'Abrir a lista']);
    await press('Abrir a lista');
    expect(router.push).toHaveBeenCalledWith({ pathname: '/lista/[id]', params: { id: 'nova' } });
  });

  it('a ida de uma lista arquivada não aparece; a de uma lista aberta, sim, com as palavras do tipo dela', async () => {
    mockDb.trips = {
      data: [
        trip('t1', 4, { list_id: 'velha', list: { name: 'Velha', kind: 'mercado', archived_at: '2026-10-13T10:00:00Z' } }),
        trip('t2', 9, { list_id: 'remedios', list: { name: 'Remédios', kind: 'farmacia', archived_at: null } }),
      ],
      error: null,
    };
    expect(await render(<MarketTripBanner openable />)).toEqual(['Beto está indo às compras · há 9 min', 'Abrir a lista']);
    mockDb.trips = { data: [trip('t1', 4, { list: { name: 'Velha', kind: 'mercado', archived_at: '2026-10-13T10:00:00Z' } })], error: null };
    await act(async () => tree.unmount());
    client.clear();
    expect(await render(<MarketTripBanner openable />)).toEqual([]);
  });

  it('quem avisou vê a hora e encerra', async () => {
    mockHouse.user = 'beto';
    mockDb.trips = { data: [trip('t1', 4)], error: null };
    const texts = await render(<MarketTripBanner openable />);
    expect(texts[0]).toMatch(/^Você avisou a casa às \d\d:\d\d$/);
    expect(texts.slice(1)).toEqual(['Encerrar', 'Abrir a lista']);
    mockDb.rpc = { data: true, error: null };
    mockDb.trips = { data: [], error: null };
    await press('Encerrar');
    expect(mockDb.calls).toEqual([['end_market_trip', { p_trip_id: 't1' }]]);
    expect(textsOf(tree.toJSON())).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('a faixa na lista', () => {
  it('só as idas desta lista, sem "Abrir a lista"', async () => {
    mockDb.trips = { data: [trip('t1', 4, { list_id: 'outra' }), trip('t2', 12)], error: null };
    expect(await render(<MarketTripBanner listId="lista" />)).toEqual(['Beto está indo ao mercado · há 12 min']);
  });
});

describe('"Encerrar" sem conexão', () => {
  beforeEach(() => {
    mockHouse.user = 'beto';
    mockDb.trips = { data: [trip('t1', 4)], error: null };
  });

  it('sem internet: nem tenta, e diz para encerrar quando a conexão voltar', async () => {
    await render(<MarketTripBanner listId="lista" />);
    onlineManager.setOnline(false);
    await press('Encerrar');
    expect(mockDb.calls).toEqual([]);
    expect(notify).toHaveBeenCalledWith('Não deu para encerrar', 'Sem internet agora. Encerre quando a conexão voltar.');
    // A ida continua na tela: nada foi encerrado.
    expect(textsOf(tree.toJSON())).toContain('Encerrar');
  });

  it('o pedido não chegou (sinal fraco): a mesma frase, e não o texto do navegador', async () => {
    await render(<MarketTripBanner listId="lista" />);
    mockDb.rpc = { data: null, error: FETCH_FAILED };
    await press('Encerrar');
    expect(notify).toHaveBeenCalledWith('Não deu para encerrar', 'Sem internet agora. Encerre quando a conexão voltar.');
  });
});

describe('o botão "Estou indo ao mercado"', () => {
  const list = { id: 'lista', kind: 'mercado' as const };

  it('no banco de antes das idas (a busca respondeu que não há a tabela): nem botão nem faixa', async () => {
    mockDb.trips = { data: null, error: MISSING_TABLE };
    expect(
      await render(
        <>
          <MarketTripBanner listId="lista" />
          <MarketTripAction list={list} />
        </>,
      ),
    ).toEqual([]);
  });

  it('enquanto as idas ainda não responderam, continua lá', async () => {
    mockDb.trips = null;
    expect(await render(<MarketTripAction list={list} />)).toEqual(['Estou indo ao mercado']);
  });

  it('sem internet ou com outro erro na busca das idas, também: só some quando o banco diz que não tem o recurso', async () => {
    mockDb.trips = { data: null, error: FETCH_FAILED };
    expect(await render(<MarketTripAction list={list} />)).toEqual(['Estou indo ao mercado']);
    await act(async () => tree.unmount());
    client.clear();
    mockDb.trips = { data: null, error: { code: '42501', message: 'permission denied for table market_trips' } };
    expect(await render(<MarketTripAction list={list} />)).toEqual(['Estou indo ao mercado']);
  });

  it('sozinha na casa, não aparece', async () => {
    mockHouse.members = 1;
    expect(await render(<MarketTripAction list={list} />)).toEqual([]);
  });

  it('depois de "Avisar agora", diz o que aconteceu', async () => {
    const result = { trip_id: 't1', created_at: new Date().toISOString(), notified: 2, members: 2, repeated: false };
    expect(await announce(result)).toEqual(['Estou indo ao mercado', 'Aviso enviado para 2 pessoas.']);
    expect(mockDb.calls).toEqual([['announce_market_trip', { p_list_id: 'lista' }]]);
  });

  it('só parte da casa recebeu a notificação: diz de quantas', async () => {
    const result = { trip_id: 't1', created_at: new Date().toISOString(), notified: 1, members: 3, repeated: false };
    expect(await announce(result)).toEqual(['Estou indo ao mercado', 'Aviso enviado para 1 de 3 pessoas. As outras veem o aviso quando abrirem o app.']);
  });

  it('avisar sem conexão: a frase de tentar de novo', async () => {
    onlineManager.setOnline(false);
    expect(await announce(null)).toEqual(['Não deu para avisar a casa', 'Sem internet agora. Tente avisar de novo quando a conexão voltar.']);
    expect(mockDb.calls).toEqual([]);
  });
});

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import {
  fetchHouseholdLocation,
  forgetHouseStateTries,
  LOCATION_KEY,
  saveHouseholdLocationFor,
  useClearHouseholdLocation,
  useFillHouseState,
  useSaveHouseholdLocation,
  type HouseholdLocation,
} from '@/data/weather';
import { HOUSEHOLD_HEADER } from '@/lib/householdHeader';

// O estado do local da casa (household_location.state_code), de onde a lista lê os preços de outras casas: lido e
// gravado com o local, sem ele no banco de antes da coluna; e o local salvo antes ganha o estado uma vez, pela Hoje.

type Call = { table: string; op: string; args: unknown[]; filters: [string, ...unknown[]][]; headers: [string, string][] };
// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockDb: {
  calls: Call[];
  /** A resposta de cada pedido, pela operação; o padrão é sem erro. */
  answer: (call: Call) => { data: unknown; error: unknown };
} = { calls: [], answer: () => ({ data: null, error: null }) };

jest.mock('@/lib/supabase', () => {
  const builder = (call: Call): unknown => {
    const chain: Record<string, unknown> = {};
    for (const method of ['eq', 'is', 'not', 'select']) {
      chain[method] = (...args: unknown[]) => {
        call.filters.push([method, ...args]);
        return chain;
      };
    }
    chain.setHeader = (name: string, value: string) => {
      call.headers.push([name, value]);
      return chain;
    };
    chain.maybeSingle = () => chain;
    chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(mockDb.answer(call)).then(resolve, reject);
    return chain;
  };
  return {
    supabase: {
      from: (table: string) => {
        const start =
          (op: string) =>
          (...args: unknown[]) => {
            const call: Call = { table, op, args, filters: [], headers: [] };
            mockDb.calls.push(call);
            return builder(call);
          };
        return { select: start('select'), upsert: start('upsert'), update: start('update'), delete: start('delete') };
      },
    },
    unwrap: (result: { data: unknown; error: unknown }) => {
      if (result.error) throw result.error;
      return result.data;
    },
  };
});

const fetchMock = jest.fn(async (input: string | URL | Request) => {
  const url = String(input);
  if (url.includes('reverse')) {
    return { ok: true, status: 200, json: async () => ({ lat: '-23.56', lon: '-46.69', address: { 'ISO3166-2-lvl4': 'BR-SP' } }) } as Response;
  }
  return { ok: false, status: 500, json: async () => ({}) } as Response;
});
global.fetch = fetchMock as unknown as typeof fetch;

const PLACE: HouseholdLocation = { label: 'Pinheiros, São Paulo', latitude: -23.56, longitude: -46.69, source: 'cep', state_code: '35' };
const missingColumn = { code: '42703', message: 'column household_location.state_code does not exist' };
const missingInWrite = { code: 'PGRST204', message: "Could not find the 'state_code' column of 'household_location' in the schema cache" };

let renderer: ReactTestRenderer | undefined;
let client: QueryClient;

async function mount(element: React.ReactElement) {
  await act(async () => {
    renderer = create(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
  });
  await settle();
}

/**
 * O que o efeito pôs para andar (o mapa, que espera 1,1 s entre dois pedidos, a gravação, as invalidações): umas
 * voltas, e com `until`, até ele valer (no máximo `ms`).
 */
async function settle(until: () => boolean = () => true, ms = 2500) {
  const end = Date.now() + ms;
  for (let n = 0; n < 5 || (!until() && Date.now() < end); n++) await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
}

beforeEach(() => {
  mockDb.calls = [];
  mockDb.answer = () => ({ data: null, error: null });
  fetchMock.mockClear();
  forgetHouseStateTries();
  onlineManager.setOnline(true);
  // gcTime infinito também nas gravações: o relógio de limpeza delas seguraria o Jest aberto depois dos testes.
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  client.clear();
});

describe('o estado lido e gravado com o local', () => {
  it('lê com o estado; no banco de antes da coluna, lê de novo sem ele (e o estado fica ausente, não null)', async () => {
    mockDb.answer = (call) => ({ data: { ...PLACE, latitude: '-23.56', longitude: '-46.69' }, error: null, ...(call.args[0] === '' ? {} : {}) });
    await expect(fetchHouseholdLocation()).resolves.toEqual(PLACE);
    expect(mockDb.calls.map((call) => call.args[0])).toEqual(['label, latitude, longitude, source, state_code']);

    mockDb.calls = [];
    mockDb.answer = (call) =>
      String(call.args[0]).includes('state_code')
        ? { data: null, error: missingColumn }
        : { data: { label: PLACE.label, latitude: -23.56, longitude: -46.69, source: 'cep' }, error: null };
    const old = await fetchHouseholdLocation();
    expect(old).toEqual({ label: PLACE.label, latitude: -23.56, longitude: -46.69, source: 'cep' });
    expect(old && 'state_code' in old).toBe(false);
    expect(mockDb.calls).toHaveLength(2);
  });

  it('grava com o estado; no banco de antes da coluna, grava de novo sem ele (as duas gravações)', async () => {
    mockDb.answer = (call) => ((call.args[0] as Record<string, unknown>).state_code !== undefined ? { data: null, error: missingInWrite } : { data: null, error: null });
    await saveHouseholdLocationFor('nova', PLACE);
    expect(mockDb.calls.map((call) => call.args[0])).toEqual([
      { household_id: 'nova', ...PLACE },
      { household_id: 'nova', label: PLACE.label, latitude: PLACE.latitude, longitude: PLACE.longitude, source: 'cep' },
    ]);
    expect(mockDb.calls.every((call) => call.headers.some(([name, value]) => name === HOUSEHOLD_HEADER && value === 'nova'))).toBe(true);

    // Outro erro não é "sem a coluna": sobe, e não grava de novo.
    mockDb.calls = [];
    mockDb.answer = () => ({ data: null, error: new Error('row-level security') });
    await expect(saveHouseholdLocationFor('nova', PLACE)).rejects.toThrow('row-level security');
    expect(mockDb.calls).toHaveLength(1);
  });

  it('salvar e tirar o local buscam de novo os preços de outras casas: os estados da casa mudaram', async () => {
    let save: ReturnType<typeof useSaveHouseholdLocation> | undefined;
    let clear: ReturnType<typeof useClearHouseholdLocation> | undefined;
    function Probe() {
      save = useSaveHouseholdLocation();
      clear = useClearHouseholdLocation();
      return null;
    }
    await mount(<Probe />);
    client.setQueryData(['sharedPrices'], []);
    client.setQueryData(['sharedPrices', 'open', 'keys', ['x']], null);
    await act(async () => {
      await save!.mutateAsync(PLACE);
    });
    expect(client.getQueryState(['sharedPrices'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['sharedPrices', 'open', 'keys', ['x']])?.isInvalidated).toBe(true);
    expect(client.getQueryData(LOCATION_KEY)).toEqual(PLACE);

    client.setQueryData(['sharedPrices'], []);
    await act(async () => {
      await clear!.mutateAsync();
    });
    expect(client.getQueryState(['sharedPrices'])?.isInvalidated).toBe(true);
  });
});

describe('a Hoje preenche o estado do local salvo antes', () => {
  function Hoje({ householdId = 'casa' }: { householdId?: string }) {
    useFillHouseState(householdId);
    return null;
  }
  const located = (place: Partial<HouseholdLocation> | null) => {
    mockDb.answer = (call) => (call.op === 'select' ? { data: place, error: null } : { data: [{ household_id: 'casa' }], error: null });
  };
  const updates = () => mockDb.calls.filter((call) => call.op === 'update');

  it('o local com o estado vazio: o ponto vai ao mapa, e só o estado é gravado, e só se ainda estiver vazio', async () => {
    located({ ...PLACE, state_code: null });
    client.setQueryData(['sharedPrices'], []);
    await mount(<Hoje />);
    await settle(() => client.getQueryState(['sharedPrices'])?.isInvalidated === true);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([expect.stringContaining('reverse?lat=-23.560&lon=-46.690')]);
    expect(updates()).toEqual([
      {
        table: 'household_location',
        op: 'update',
        args: [{ state_code: '35' }],
        filters: [
          ['eq', 'household_id', 'casa'],
          ['is', 'state_code', null],
          ['select', 'household_id'],
        ],
        headers: [[HOUSEHOLD_HEADER, 'casa']],
      },
    ]);
    expect(client.getQueryState(['sharedPrices'])?.isInvalidated).toBe(true);
  });

  it('uma vez por casa enquanto o app está aberto: abrir a Hoje de novo não pergunta outra vez', async () => {
    located({ ...PLACE, state_code: null });
    await mount(<Hoje />);
    await settle(() => updates().length === 1);
    await act(async () => renderer?.unmount());
    await mount(<Hoje />);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(updates()).toHaveLength(1);
  });

  it('nada para o local com o estado, para o banco de antes da coluna (ausente), sem local ou sem internet', async () => {
    located(PLACE);
    await mount(<Hoje />);
    await act(async () => renderer?.unmount());
    located({ label: PLACE.label, latitude: -23.56, longitude: -46.69, source: 'cep' });
    await mount(<Hoje householdId="outra" />);
    await act(async () => renderer?.unmount());
    located(null);
    await mount(<Hoje householdId="terceira" />);
    await act(async () => renderer?.unmount());
    onlineManager.setOnline(false);
    located({ ...PLACE, state_code: null });
    await mount(<Hoje householdId="quarta" />);
    // O mapa espera até 1,1 s entre dois pedidos: o tempo de um que tivesse saído.
    await settle(() => false, 1200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updates()).toEqual([]);
  });

  it('qualquer falha fica em silêncio; nenhuma linha de volta (outro aparelho preencheu) não é erro', async () => {
    mockDb.answer = (call) => (call.op === 'select' ? { data: { ...PLACE, state_code: null }, error: null } : { data: [], error: null });
    await mount(<Hoje />);
    await settle(() => updates().length === 1);
    expect(updates()).toHaveLength(1);
    await act(async () => renderer?.unmount());
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('Network request failed');
    });
    await mount(<Hoje householdId="outra" />);
    await settle(() => fetchMock.mock.calls.length === 2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(updates()).toHaveLength(1);
  });
});

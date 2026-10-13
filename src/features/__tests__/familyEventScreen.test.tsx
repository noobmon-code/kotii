import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import FamilyEventScreen from '@/app/compromisso/[id]';
import { Button, Loading, TextField } from '@/ui/primitives';

// A tela de verdade, com as consultas de verdade de src/data/family.ts e um
// QueryClient com os padrões do app. Só a rede é trocada: um "banco" em
// memória atrás do cliente do Supabase.

type Row = Record<string, unknown>;
// `gate`: enquanto houver uma promessa aqui, os pedidos ao banco esperam por ela (a rede lenta).
const mockDb: { people: Row[]; events: Row[]; updates: Row[]; gate: Promise<void> | null } = { people: [], events: [], updates: [], gate: null };

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'natacao' }),
}));
jest.mock('@/ui/dialogs', () => ({ askYesNo: jest.fn(), confirmAction: jest.fn(), notify: jest.fn() }));
// Os desenhos animados e o fundo não entram no que se confere aqui.
jest.mock('@/ui/art', () => ({ Mascot: () => null, Spot: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@/data/health', () => {
  const { useQuery } = jest.requireActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  // Como o usePeople de verdade: uma consulta em ['people'].
  return { usePeople: () => useQuery({ queryKey: ['people'], queryFn: async () => mockDb.people.map((p) => ({ ...p })) }) };
});
jest.mock('@/lib/supabase', () => {
  const table = (name: string) => {
    const filters: [string, unknown][] = [];
    let update: Row | null = null;
    const run = () => {
      const rows = name === 'family_events' ? mockDb.events : [];
      const hit = rows.filter((row) => filters.every(([column, value]) => row[column] === value));
      if (update) {
        const patch = update;
        hit.forEach((row) => Object.assign(row, patch));
        mockDb.updates.push(patch);
        return { data: null, error: null };
      }
      return { data: hit.map((row) => ({ ...row })), error: null };
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      order: () => builder,
      range: () => builder,
      neq: () => builder,
      in: () => builder,
      delete: () => builder,
      upsert: () => builder,
      eq: (column: string, value: unknown) => {
        // A busca de todos separa por repetição; a de um compromisso filtra pelo id.
        if (column !== 'recurrence') filters.push([column, value]);
        return builder;
      },
      update: (values: Row) => {
        update = values;
        return builder;
      },
      maybeSingle: async () => {
        await mockDb.gate;
        const result = run();
        return { data: (result.data as Row[] | null)?.[0] ?? null, error: result.error };
      },
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve(mockDb.gate)
          .then(() => run())
          .then(resolve),
    };
    return builder;
  };
  return {
    errorMessage: (error: { message?: string }) => error?.message ?? 'Algo deu errado. Tente novamente.',
    unwrap: (result: { data: unknown; error: unknown }) => {
      if (result.error) throw result.error;
      return result.data;
    },
    supabase: { from: (name: string) => table(name) },
  };
});

const person = (id: string, name: string): Row => ({ id, name, kind: 'pessoa', birth_date: null, member_user_id: null });
const swim = (): Row => ({
  id: 'natacao',
  title: 'Natação da Ana',
  starts_on: '2026-10-13',
  start_time: '16:00:00',
  end_time: '17:00:00',
  person_id: 'ana',
  take_by: 'vo',
  pick_up_by: 'carla',
  location: 'Clube',
  bring: null,
  notes: null,
  recurrence: 'weekly',
  weekdays: [2, 4],
  until_on: null,
});

let client: QueryClient;
let renderer: ReactTestRenderer | undefined;

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
function open() {
  act(() => {
    renderer = create(
      <QueryClientProvider client={client}>
        <FamilyEventScreen />
      </QueryClientProvider>,
    );
  });
}
const close = () => act(() => renderer?.unmount());
const field = (label: string) => renderer!.root.findAllByType(TextField).find((input) => input.props.label === label);
const loading = () => renderer!.root.findAllByType(Loading).length > 0;
/** O compromisso guardado há dez minutos: a tela o tem, e busca de novo ao abrir. */
const age = () => client.setQueryData(['familyEvents', 'natacao'], client.getQueryData(['familyEvents', 'natacao']), { updatedAt: Date.now() - 10 * 60_000 });

beforeEach(() => {
  // Como no app (lib/queryClient), sem a segunda tentativa, que só faria o teste esperar.
  client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false, gcTime: Infinity }, mutations: { networkMode: 'always', gcTime: Infinity } } });
  mockDb.people = [person('ana', 'Ana'), person('beto', 'Beto'), person('carla', 'Carla'), person('vo', 'Vó Maria')];
  mockDb.events = [swim()];
  mockDb.updates = [];
  mockDb.gate = null;
});

afterEach(async () => {
  await close();
  renderer = undefined;
  onlineManager.setOnline(true);
  client.clear();
});

describe('tela do compromisso: o formulário espera a busca desta visita', () => {
  it('aberto antes e mudado em outro celular: não mostra o de antes, e salvar não o grava por cima', async () => {
    open();
    await settle();
    expect(field('Começa às')!.props.value).toBe('16:00');
    await close();

    // No outro celular: passou para as 17h, e é o Beto quem leva.
    Object.assign(mockDb.events[0], { start_time: '17:00:00', end_time: '18:00:00', take_by: 'beto' });
    age();

    open();
    // O guardado (16h, a vó leva) não aparece enquanto a busca desta visita não chega.
    expect(loading()).toBe(true);
    expect(field('Começa às')).toBeUndefined();
    await settle();
    expect(field('Começa às')!.props.value).toBe('17:00');

    // A pessoa só acerta o que levar, e salva: o horário e quem leva seguem os de agora.
    act(() => field('O que levar')!.props.onChangeText('touca'));
    const save = renderer!.root.findAllByType(Button).find((button) => String(button.props.title).startsWith('Salvar'))!;
    await act(async () => {
      save.props.onPress();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(mockDb.updates).toHaveLength(1);
    expect(mockDb.updates[0]).toMatchObject({ start_time: '17:00', end_time: '18:00', take_by: 'beto', pick_up_by: 'carla', bring: 'touca' });
  });

  it('guardado há pouco (menos de 30 segundos): abre na hora, sem "carregando"', async () => {
    open();
    await settle();
    await close();
    open();
    expect(loading()).toBe(false);
    expect(field('Começa às')!.props.value).toBe('16:00');
  });

  it('sem internet a busca fica parada, e o que está guardado abre', async () => {
    open();
    await settle();
    await close();
    age();
    onlineManager.setOnline(false);
    open();
    expect(loading()).toBe(false);
    expect(field('Começa às')!.props.value).toBe('16:00');
  });

  it('com o formulário aberto, outra busca não o tira da frente nem apaga o que foi digitado', async () => {
    // Aberto pela segunda vez com o guardado ainda novo: esta visita não buscou nada ao abrir. É o caso em que
    // a busca seguinte (a de uma ficha criada pelo "+ Pessoa", a de voltar ao app) seria a "primeira desta visita".
    open();
    await settle();
    await close();
    open();
    expect(field('O que levar')).toBeDefined();
    act(() => field('O que levar')!.props.onChangeText('touca e toalha'));

    let arrive!: () => void;
    mockDb.gate = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    act(() => {
      client.invalidateQueries({ queryKey: ['familyEvents'] });
    });
    await settle();
    // Com a busca ainda a caminho, o formulário continua na frente, com o que foi digitado.
    expect(client.isFetching({ queryKey: ['familyEvents', 'natacao'] })).toBe(1);
    expect(loading()).toBe(false);
    expect(field('O que levar')!.props.value).toBe('touca e toalha');
    arrive();
    await settle();
    expect(client.isFetching({ queryKey: ['familyEvents', 'natacao'] })).toBe(0);
    expect(field('O que levar')!.props.value).toBe('touca e toalha');
  });

  it('a busca falha com o formulário aberto: ele fica, com o que foi digitado', async () => {
    open();
    await settle();
    act(() => field('O que levar')!.props.onChangeText('touca e toalha'));
    // O banco para de responder (o compromisso some da "rede" do teste com um erro).
    const failing = jest.spyOn(mockDb.events, 'filter').mockImplementation(() => {
      throw new Error('TypeError: Network request failed');
    });
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['familyEvents'] });
    });
    await settle();
    failing.mockRestore();
    expect(field('O que levar')!.props.value).toBe('touca e toalha');
  });
});

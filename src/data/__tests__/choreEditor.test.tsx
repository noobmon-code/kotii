import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import ChoreScreen from '@/app/tarefa/[id]';
import { ROTATION_CHANGED_ELSEWHERE, ROTATION_CHECK_FAILED, ROTATION_PERSON_UNKNOWN } from '@/domain/choreRotation';
import { Button, Chip, ErrorNotice, Loading, TextField } from '@/ui/primitives';

import { useSavePerson } from '../health';

// A tela da tarefa de verdade, com os hooks de dados e o cache (QueryClient) de verdade; só o
// Supabase é de mentira. O que se confere aqui: o editor abre com o que está no servidor, e não
// salva por cima de uma ordem de rodízio que ele não mostrou (nem de alguém dela que ele não conhece).

type Row = Record<string, unknown>;

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockMembers = [
  { household_id: 'h', user_id: 'u-beto', display_name: 'Beto', role: 'owner' },
  { household_id: 'h', user_id: 'u-carla', display_name: 'Carla', role: 'member' },
];
const mockPeople: Row[] = [
  { id: 'p-beto', name: 'Beto', kind: 'pessoa', member_user_id: 'u-beto' },
  { id: 'p-carla', name: 'Carla', kind: 'pessoa', member_user_id: 'u-carla' },
  { id: 'p-lia', name: 'Lia', kind: 'pessoa', member_user_id: null },
];
// O servidor de mentira: a tarefa e a ordem como estão no banco, e o que foi gravado.
const mockServer: {
  chore: Row | null;
  order: string[];
  /** Tabelas cuja busca falha, como sem internet. */
  down: string[];
  /** O banco de antes da migração: a tabela do rodízio não existe. */
  old: boolean;
  /** As buscas só respondem depois disto. */
  gate: Promise<void> | null;
  log: string[];
} = { chore: null, order: [], down: [], old: false, gate: null, log: [] };
// O que este celular sabe dos moradores, e a tarefa aberta ('nova': tarefa nova).
const mockDevice = { members: mockMembers, id: 'c-1' };
const mockBack = jest.fn();
const mockNotify = jest.fn();
const mockRefetchHousehold = jest.fn();

jest.mock('expo-router', () => ({
  router: { back: () => mockBack(), push: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: mockDevice.id }),
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('@/ui/art', () => ({ Mascot: () => null, Spot: () => null, SkyArt: () => null, Logo: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@/ui/dialogs', () => ({
  notify: (title: string, message?: string) => mockNotify(title, message),
  confirmAction: (_title: string, _message: string, _label: string, onConfirm: () => void) => onConfirm(),
}));
jest.mock('@/lib/auth', () => ({
  useHousehold: () => ({ data: { members: mockDevice.members }, refetch: () => mockRefetchHousehold() }),
}));
jest.mock('@/lib/session', () => ({ endSessionIfGone: async () => false }));
jest.mock('@/lib/supabase', () => {
  // Uma consulta do supabase-js: guarda o que foi encadeado e responde quando alguém espera por ela.
  const query = (table: string) => {
    const calls: Record<string, unknown[]> = {};
    const answer = async (): Promise<{ data: unknown; error: unknown }> => {
      if (calls.insert) {
        mockServer.log.push(`insert ${table} ${JSON.stringify(calls.insert[0])}`);
        return { data: { id: 'c-nova' }, error: null };
      }
      if (calls.update) {
        const values = calls.update[0] as Row;
        if (table === 'chores') {
          mockServer.log.push(`update chores ${JSON.stringify(values)}`);
          mockServer.chore = { ...mockServer.chore, ...values };
        }
        return { data: table === 'people' ? { ...mockPeople.find((p) => p.id === calls.eq[1]), ...values } : null, error: null };
      }
      await mockServer.gate;
      // Como o supabase-js devolve a falha de rede.
      if (mockServer.down.includes(table)) return { data: null, error: { message: 'TypeError: Network request failed', code: '' } };
      if (table === 'chore_rotation') {
        // Como a API responde pela tabela que o banco não tem.
        const missing = { code: 'PGRST205', message: "Could not find the table 'public.chore_rotation' in the schema cache" };
        if (mockServer.old) return { data: null, error: missing };
        return { data: mockServer.order.map((person_id, i) => ({ chore_id: 'c-1', person_id, position: i + 1 })), error: null };
      }
      if (table === 'people') return { data: mockPeople, error: null };
      if (table === 'chores' && calls.single) {
        // `.single()` sem linha: a tarefa foi apagada.
        const gone = { code: 'PGRST116', details: 'The result contains 0 rows', message: 'Cannot coerce the result to a single JSON object' };
        return mockServer.chore ? { data: mockServer.chore, error: null } : { data: null, error: gone };
      }
      return { data: [], error: null };
    };
    const builder: unknown = new Proxy(
      {},
      {
        get: (_target, method: string) =>
          method === 'then'
            ? (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => answer().then(resolve, reject)
            : (...args: unknown[]) => {
                calls[method] = args;
                return builder;
              },
      },
    );
    return builder;
  };
  return {
    supabase: {
      from: (table: string) => query(table),
      rpc: async (name: string, args: { p_people?: string[] }) => {
        mockServer.log.push(`rpc ${name} ${JSON.stringify(args.p_people)}`);
        if (name === 'save_chore_rotation') mockServer.order = args.p_people ?? [];
        return { data: null, error: null };
      },
    },
    unwrap: (result: { data: unknown; error: unknown }) => {
      if (result.error) throw result.error;
      return result.data;
    },
    errorMessage: (error: { message?: string }) => error?.message ?? String(error),
  };
});

const ORDER = ['p-beto', 'p-carla', 'p-lia'];
const HOUR = 60 * 60_000;

const chore = (over: Row = {}): Row => ({
  id: 'c-1',
  title: 'Lavar a louça',
  notes: null,
  recurrence: 'daily',
  interval_count: 1,
  due_on: '2026-10-12',
  assigned_to: null,
  active: true,
  equipment_id: null,
  kid_id: null,
  points: 0,
  ...over,
});

let client: QueryClient;
let renderer: ReactTestRenderer | undefined;

/** O que este celular tinha em cache, e há quanto tempo. */
function cached(data: { chore: Row; order: string[]; people?: Row[] }, age: number) {
  const updatedAt = Date.now() - age;
  client.setQueryData(['chores', 'c-1'], data.chore, { updatedAt });
  client.setQueryData(['choreRotations'], data.order.length ? { 'c-1': data.order } : {}, { updatedAt });
  client.setQueryData(['people'], data.people ?? mockPeople, { updatedAt });
}

const tick = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 5)));

/** Espera as buscas e gravações em andamento terminarem e a tela acompanhar. */
async function settle() {
  await act(async () => {
    do await new Promise((resolve) => setTimeout(resolve, 5));
    while (client.isFetching() || client.isMutating());
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

async function open() {
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <ChoreScreen />
      </QueryClientProvider>,
    );
  });
  const root = renderer!.root;
  const title = () => root.findAllByType(TextField).find((field) => field.props.label === 'Tarefa');
  const button = (label: string) => root.findAllByType(Button).find((b) => b.props.title === label)!;
  return {
    loading: () => root.findAllByType(Loading).length > 0,
    failed: () => root.findAllByType(ErrorNotice).length > 0,
    /** O título no formulário; undefined sem formulário na tela. */
    title: () => title()?.props.value as string | undefined,
    typeTitle: (text: string) => act(async () => title()!.props.onChangeText(text)),
    chips: () => root.findAllByType(Chip).map((chip) => `${chip.props.selected ? '[x]' : '[ ]'} ${chip.props.label}`),
    press: async (label: string) => {
      await act(async () => button(label).props.onPress());
      await settle();
    },
    /** Só o toque, sem esperar o que ele começa. */
    tap: (label: string) => act(async () => void button(label).props.onPress()),
    busy: (label: string) => Boolean(button(label).props.loading),
  };
}

/** As buscas ficam esperando até `release()`. */
function holdFetches() {
  let release = () => undefined as void;
  mockServer.gate = new Promise<void>((resolve) => {
    release = () => {
      mockServer.gate = null;
      resolve();
    };
  });
  return () => release();
}

const RECURRENCE = ['[ ] Uma vez', '[x] Diária', '[ ] Semanal', '[ ] Mensal'];
const IN_ROTATION = [...RECURRENCE, '[ ] Qualquer um', '[x] Rodízio', '[x] 1 Beto', '[x] 2 Carla', '[x] 3 Lia'];
const OF_BETO = [...RECURRENCE, '[ ] Qualquer um', '[ ] Rodízio', '[x] Beto', '[ ] Carla', '[ ] Lia'];
const OF_CARLA = [...RECURRENCE, '[ ] Qualquer um', '[ ] Rodízio', '[ ] Beto', '[x] Carla', '[ ] Lia'];
const CHANGED = ['Esta tarefa mudou', ROTATION_CHANGED_ELSEWHERE];

beforeEach(() => {
  // Como no app, menos a segunda tentativa (aqui uma falha já é a falha) e o prazo do cache (sem relógio pendurado).
  client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: false, gcTime: Infinity },
      mutations: { networkMode: 'always', gcTime: Infinity },
    },
  });
  Object.assign(mockServer, { chore: chore({ assigned_to: 'u-carla', points: 10 }), order: ORDER, down: [], old: false, gate: null, log: [] });
  Object.assign(mockDevice, { members: mockMembers, id: 'c-1' });
  jest.clearAllMocks();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  client.clear();
  onlineManager.setOnline(true);
});

describe('editor de uma tarefa que já existe: abre com o que está no servidor', () => {
  it('cache velho sem rodízio, servidor com rodízio: espera a busca, abre em rodízio e salvar não o encerra', async () => {
    // O celular ficou aberto desde cedo; o rodízio foi criado em outro, e a vez já é de Carla.
    cached({ chore: chore({ assigned_to: 'u-beto' }), order: [] }, HOUR);
    const release = holdFetches();
    const screen = await open();
    await tick();
    expect(screen.loading()).toBe(true);
    expect(screen.title()).toBeUndefined();

    release();
    await settle();
    expect(screen.title()).toBe('Lavar a louça');
    expect(screen.chips()).toEqual(IN_ROTATION);

    await screen.press('Salvar');
    // A ordem vai inteira, e a tarefa nem manda o responsável: a vez fica com o banco. Os pontos são os do servidor.
    expect(mockServer.log).toEqual([
      'update chores {"title":"Lavar a louça","notes":null,"recurrence":"daily","interval_count":1,"due_on":"2026-10-12","points":10}',
      'rpc save_chore_rotation ["p-beto","p-carla","p-lia"]',
    ]);
    expect(mockServer.order).toEqual(ORDER);
    expect(mockServer.chore).toMatchObject({ assigned_to: 'u-carla', points: 10 });
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('cache recente também é buscado de novo: o rodízio pode ter sido criado há segundos', async () => {
    cached({ chore: chore({ assigned_to: 'u-beto' }), order: [] }, 1000);
    const screen = await open();
    await settle();
    expect(screen.chips()).toEqual(IN_ROTATION);
  });

  it('sem internet a busca fica parada e não segura a tela: abre com o cache', async () => {
    onlineManager.setOnline(false);
    cached({ chore: chore({ assigned_to: 'u-carla', points: 10 }), order: ORDER }, HOUR);
    const screen = await open();
    await tick();
    expect(screen.loading()).toBe(false);
    expect(screen.chips()).toEqual(IN_ROTATION);
  });

  it('a busca ao abrir falha: com cache, abre com ele; sem nada para mostrar, o erro com "Tentar de novo"', async () => {
    mockServer.down = ['chores', 'chore_rotation', 'people'];
    cached({ chore: chore({ assigned_to: 'u-beto' }), order: [] }, HOUR);
    const withCache = await open();
    await settle();
    expect(withCache.failed()).toBe(false);
    expect(withCache.chips()).toEqual(OF_BETO);
    // Não mostrou rodízio: salvar (a internet voltou) não encerra o que há no servidor, nem grava o responsável
    // e os pontos de antes por cima da vez.
    mockServer.down = [];
    await withCache.press('Salvar');
    expect(mockServer.log).toEqual([]);
    expect(mockNotify.mock.calls).toEqual([CHANGED]);
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockServer.order).toEqual(ORDER);
    expect(mockServer.chore).toMatchObject({ assigned_to: 'u-carla', points: 10 });

    await act(async () => renderer!.unmount());
    client.clear();
    mockServer.down = ['chores', 'chore_rotation', 'people'];
    const empty = await open();
    await settle();
    expect(empty.failed()).toBe(true);
    expect(empty.title()).toBeUndefined();
    mockServer.down = [];
    await empty.press('Tentar de novo');
    expect(empty.failed()).toBe(false);
    expect(empty.chips()).toEqual(IN_ROTATION);
  });
});

describe('editor aberto: o que chega depois não troca o formulário', () => {
  it('rodízio criado em outro celular com o formulário aberto: nada é remontado e salvar não o encerra', async () => {
    mockServer.chore = chore({ assigned_to: 'u-beto' });
    mockServer.order = [];
    // As fichas, em cache recente, não são buscadas ao abrir: a primeira busca delas é a de fundo, lá embaixo.
    cached({ chore: mockServer.chore, order: [] }, 1000);
    const screen = await open();
    await settle();
    expect(screen.chips()).toEqual(OF_BETO);
    await screen.typeTitle('Lavar a louça e as panelas');

    // Outro celular cria o rodízio; este busca de novo em segundo plano.
    mockServer.chore = chore({ assigned_to: 'u-carla', points: 10 });
    mockServer.order = ORDER;
    const release = holdFetches();
    await act(async () => void client.invalidateQueries());
    await tick();
    expect(screen.loading()).toBe(false);
    expect(screen.title()).toBe('Lavar a louça e as panelas');
    release();
    await settle();
    expect(screen.title()).toBe('Lavar a louça e as panelas');
    expect(screen.chips()).toEqual(OF_BETO);

    // O formulário não mostrou rodízio nenhum: não manda a ordem vazia que o encerraria, nem grava por cima
    // da vez e dos pontos com o que tinha aberto. Avisa, e nada vai para o servidor.
    await screen.press('Salvar');
    expect(mockServer.log).toEqual([]);
    expect(mockNotify).toHaveBeenCalledWith('Esta tarefa mudou', 'Ela ganhou um rodízio em outro aparelho. Feche e abra de novo para editar.');
    expect(mockServer.chore).toMatchObject({ assigned_to: 'u-carla', points: 10 });
    expect(mockServer.order).toEqual(ORDER);
  });

  it('busca em segundo plano que falha: o formulário fica, com o que foi digitado', async () => {
    const screen = await open();
    await settle();
    await screen.typeTitle('Lavar a louça e as panelas');

    mockServer.down = ['chores', 'chore_rotation', 'people'];
    await act(async () => void client.invalidateQueries());
    await settle();
    expect(client.getQueryState(['choreRotations'])?.status).toBe('error');
    expect(screen.failed()).toBe(false);
    expect(screen.title()).toBe('Lavar a louça e as panelas');
    expect(screen.chips()).toEqual(IN_ROTATION);
  });

  it('tarefa apagada em outro celular: aí sim o erro, não há mais o que editar', async () => {
    const screen = await open();
    await settle();
    expect(screen.title()).toBe('Lavar a louça');

    mockServer.chore = null;
    await act(async () => void client.invalidateQueries());
    await settle();
    expect(screen.failed()).toBe(true);
    expect(screen.title()).toBeUndefined();
  });
});

describe('formulário aberto sem rodízio: salvar confere a ordem no servidor antes de gravar', () => {
  const PLAIN_SAVE =
    'update chores {"title":"Lavar a louça","notes":null,"recurrence":"daily","interval_count":1,"due_on":"2026-10-12","assigned_to":"u-beto","kid_id":null,"points":0}';

  /** A tarefa é de Beto, sem rodízio, no servidor e neste celular. */
  async function openPlain() {
    mockServer.chore = chore({ assigned_to: 'u-beto' });
    mockServer.order = [];
    cached({ chore: mockServer.chore, order: [] }, 1000);
    const screen = await open();
    await settle();
    expect(screen.chips()).toEqual(OF_BETO);
    return screen;
  }

  it('rodízio criado em outro celular, e este não buscou mais nada: avisa e não grava', async () => {
    const screen = await openPlain();
    await screen.typeTitle('Lavar a louça e as panelas');
    // Com o editor aberto ninguém busca de novo: o cache deste celular segue sem rodízio.
    mockServer.chore = chore({ assigned_to: 'u-carla', points: 10 });
    mockServer.order = ORDER;

    await screen.press('Salvar');
    expect(mockServer.log).toEqual([]);
    expect(mockNotify.mock.calls).toEqual([CHANGED]);
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockServer.chore).toMatchObject({ assigned_to: 'u-carla', points: 10 });
    expect(screen.title()).toBe('Lavar a louça e as panelas');
  });

  it('só a busca da ordem falhou ao abrir (a tarefa veio nova): também não grava por cima do rodízio', async () => {
    mockServer.down = ['chore_rotation'];
    cached({ chore: chore({ assigned_to: 'u-beto' }), order: [] }, HOUR);
    const screen = await open();
    await settle();
    // A vez de Carla veio do servidor, mas sem a ordem a tela a mostra como responsável fixa (e sem os pontos).
    expect(screen.chips()).toEqual(OF_CARLA);

    mockServer.down = [];
    await screen.press('Salvar');
    expect(mockServer.log).toEqual([]);
    expect(mockNotify.mock.calls).toEqual([CHANGED]);
    expect(mockServer.chore).toMatchObject({ points: 10 });
  });

  it('a conferência falha: avisa, nada é gravado e o formulário fica; com a internet de volta, salva', async () => {
    const screen = await openPlain();
    // Sem internet: a consulta em cache ficaria parada esperando. A conferência vai direto e falha na hora.
    onlineManager.setOnline(false);
    mockServer.down = ['chore_rotation'];
    await screen.press('Salvar');
    expect(mockServer.log).toEqual([]);
    expect(mockNotify.mock.calls).toEqual([['Nada foi salvo', ROTATION_CHECK_FAILED]]);
    expect(mockBack).not.toHaveBeenCalled();
    expect(screen.busy('Salvar')).toBe(false);

    onlineManager.setOnline(true);
    mockServer.down = [];
    await screen.press('Salvar');
    // A tarefa segue sem rodízio no servidor: grava como sempre, e nada do rodízio é chamado.
    expect(mockServer.log).toEqual([PLAIN_SAVE]);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('dois toques em Salvar durante a conferência: grava uma vez só', async () => {
    const screen = await openPlain();
    const release = holdFetches();
    await screen.tap('Salvar');
    expect(screen.busy('Salvar')).toBe(true);
    await screen.tap('Salvar');
    release();
    await settle();
    expect(mockServer.log).toEqual([PLAIN_SAVE]);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('banco que ainda não tem o rodízio: a conferência não acha ordem nenhuma e a tarefa salva como sempre', async () => {
    mockServer.old = true;
    const screen = await openPlain();
    await screen.press('Salvar');
    expect(mockServer.log).toEqual([PLAIN_SAVE]);
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('formulário aberto com rodízio não confere nada antes: salva mesmo com a busca da ordem fora do ar', async () => {
    const screen = await open();
    await settle();
    expect(screen.chips()).toEqual(IN_ROTATION);
    mockServer.down = ['chore_rotation'];
    await screen.press('Salvar');
    expect(mockServer.log).toEqual([
      'update chores {"title":"Lavar a louça","notes":null,"recurrence":"daily","interval_count":1,"due_on":"2026-10-12","points":10}',
      'rpc save_chore_rotation ["p-beto","p-carla","p-lia"]',
    ]);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('tarefa nova também não: não há o que conferir', async () => {
    mockDevice.id = 'nova';
    mockServer.down = ['chore_rotation'];
    const screen = await open();
    await settle();
    await screen.typeTitle('Regar as plantas');
    await screen.press('Salvar');
    expect(mockServer.log).toHaveLength(1);
    expect(mockServer.log[0]).toContain('insert chores {"title":"Regar as plantas",');
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('rodízio com alguém que este celular não conhece: salvar não tira a pessoa da ordem', () => {
  const UNKNOWN = ['Esta tarefa mudou', ROTATION_PERSON_UNKNOWN];

  it('ficha criada em outro celular, e a busca das fichas falhou ao abrir: avisa, não grava e busca as fichas', async () => {
    // Lia foi cadastrada e posta no rodízio (25 pontos) em outro celular; as fichas deste são de antes dela.
    mockServer.chore = chore({ assigned_to: 'u-carla', points: 25 });
    mockServer.down = ['people'];
    cached({ chore: chore({ assigned_to: 'u-carla', points: 25 }), order: ORDER, people: mockPeople.slice(0, 2) }, HOUR);
    const screen = await open();
    await settle();
    expect(screen.chips()).toEqual([...RECURRENCE, '[ ] Qualquer um', '[x] Rodízio', '[x] 1 Beto', '[x] 2 Carla']);
    await screen.typeTitle('Lavar a louça e as panelas');

    mockServer.down = [];
    await screen.press('Salvar');
    // Sem o aviso, iriam a ordem sem Lia e, sem criança nela, 0 ponto.
    expect(mockServer.log).toEqual([]);
    expect(mockNotify.mock.calls).toEqual([UNKNOWN]);
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockServer.order).toEqual(ORDER);
    expect(mockServer.chore).toMatchObject({ points: 25 });
    expect(mockRefetchHousehold).toHaveBeenCalledTimes(1);
    // As fichas chegaram: Lia aparece, e os pontos na tela são os que estavam gravados, não os de uma tarefa nova.
    expect(screen.chips()).toEqual(IN_ROTATION);
    expect(screen.title()).toBe('Lavar a louça e as panelas');

    await screen.press('Salvar');
    expect(mockServer.log).toEqual([
      'update chores {"title":"Lavar a louça e as panelas","notes":null,"recurrence":"daily","interval_count":1,"due_on":"2026-10-12","points":25}',
      'rpc save_chore_rotation ["p-beto","p-carla","p-lia"]',
    ]);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('morador que entrou há pouco: a ficha chegou, mas a lista de moradores deste celular ainda não o tem', async () => {
    mockDevice.members = [mockMembers[0]];
    const screen = await open();
    await settle();
    expect(screen.chips()).toEqual([...RECURRENCE, '[ ] Qualquer um', '[x] Rodízio', '[x] 1 Beto', '[x] 3 Lia']);

    await screen.press('Salvar');
    // Sem o aviso, Carla (que está na vez) sairia da ordem.
    expect(mockServer.log).toEqual([]);
    expect(mockNotify.mock.calls).toEqual([UNKNOWN]);
    expect(mockRefetchHousehold).toHaveBeenCalledTimes(1);
    expect(mockServer.order).toEqual(ORDER);
  });
});

describe('salvar uma ficha', () => {
  it('busca de novo as tarefas e as ordens: a pessoa que vira pet sai dos rodízios no servidor', async () => {
    let savePerson: ReturnType<typeof useSavePerson>['mutateAsync'] | undefined;
    function Probe() {
      const save = useSavePerson();
      savePerson = save.mutateAsync;
      return null;
    }
    client.setQueryData(['chores'], [chore()]);
    client.setQueryData(['choreRotations'], { 'c-1': ORDER });
    await act(async () => {
      renderer = create(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await savePerson!({ id: 'p-lia', values: { name: 'Lia', kind: 'pet' } as Parameters<NonNullable<typeof savePerson>>[0]['values'] });
    });
    expect(client.getQueryState(['chores'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['choreRotations'])?.isInvalidated).toBe(true);
  });
});

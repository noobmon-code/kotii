import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import ChoreScreen from '@/app/tarefa/[id]';
import {
  ROTATION_CHANGED_ELSEWHERE,
  ROTATION_CHECK_FAILED,
  ROTATION_MAYBE_SAVED,
  ROTATION_NOT_READY,
  ROTATION_ORDER_NOT_LOADED,
  ROTATION_PERSON_UNKNOWN,
  ROTATION_UNAVAILABLE,
  skipNotDoneMessage,
} from '@/domain/choreRotation';
import { CHORE_GONE } from '@/domain/chores';
import { Button, Chip, ErrorNotice, Loading, Text, TextField } from '@/ui/primitives';

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
  /** O banco de antes da migração: nem a tabela do rodízio, nem a função que salva a tarefa. */
  old: boolean;
  /** Uma cópia de antes desta migração: tem o rodízio, mas não a função que salva a tarefa. */
  noSaveChore: boolean;
  /**
   * O banco tem o rodízio, mas o cache do esquema da API ficou para trás: ela não enxerga nem a função nem a tabela
   * do rodízio. A gravação direta que troca a vez de uma tarefa em rodízio, o banco recusa (NK009).
   */
  staleCache: boolean;
  /** As buscas só respondem depois disto. */
  gate: Promise<void> | null;
  /** O que outro celular faz logo depois de este ler a ordem (uma vez só): a corrida entre conferir e gravar. */
  afterCheck: (() => void) | null;
  /** Com que erro o salvar da tarefa falha, sem gravar nada (nulo: responde como o banco). */
  failSave: unknown;
  /** O próximo salvar chega ao servidor e grava, mas a resposta se perde no caminho (uma vez só). */
  dropAnswer: boolean;
  /** Com que erro o "Pular a vez" falha, sem mudar nada (nulo: responde como o banco). */
  failSkip: unknown;
  /** Os argumentos de cada "Pular a vez" que chegou ao servidor. */
  skips: Row[];
  log: string[];
} = {
  chore: null,
  order: [],
  down: [],
  old: false,
  noSaveChore: false,
  staleCache: false,
  gate: null,
  afterCheck: null,
  failSave: null,
  dropAnswer: false,
  failSkip: null,
  skips: [],
  log: [],
};
// O que este celular sabe dos moradores, e a tarefa aberta ('nova': tarefa nova).
const mockDevice = { members: mockMembers, id: 'c-1' };
const mockBack = jest.fn();
const mockNotify = jest.fn();
const mockConfirm = jest.fn();
const mockRefetchHousehold = jest.fn();

jest.mock('expo-router', () => ({
  router: { back: () => mockBack(), push: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: mockDevice.id }),
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('@/ui/art', () => ({ Logo: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@/ui/dialogs', () => ({
  notify: (title: string, message?: string) => mockNotify(title, message),
  // Como no app fora da web: o aviso sai no quadro seguinte (requestAnimationFrame, que nos testes é um setTimeout).
  notifyAfterPaint: (title: string, message?: string) => globalThis.requestAnimationFrame(() => mockNotify(title, message)),
  confirmAction: (title: string, message: string, _label: string, onConfirm: () => void) => {
    mockConfirm(title, message);
    onConfirm();
  },
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
          // A tarefa só vai direto na tabela no banco que ainda não tem a função que a salva inteira.
          mockServer.log.push(`update chores ${JSON.stringify(values)}`);
          // Na tarefa apagada, como em toda gravação que não acha a linha, nada muda e não há erro.
          const row = mockServer.chore;
          // O gatilho do banco com o rodízio: a troca da vez de uma tarefa em rodízio, direto na tabela, é recusada e
          // nada muda.
          const turnChanged = (column: string) => column in values && values[column] !== row?.[column];
          if (!mockServer.old && row && mockServer.order.length && (turnChanged('assigned_to') || turnChanged('kid_id'))) {
            // O texto é para o app já instalado, que o mostra como vem; este reconhece a recusa pelo código.
            const message = 'Esta tarefa está em rodízio. Atualize o app para trocar o responsável.';
            return { data: null, error: { code: 'NK009', message, details: null, hint: null } };
          }
          if (row) mockServer.chore = { ...row, ...values };
          // Com `.select()`, a gravação devolve as linhas que mudou: a tarefa, ou nenhuma.
          return { data: calls.select ? (row ? [{ id: row.id }] : []) : null, error: null };
        }
        return { data: table === 'people' ? { ...mockPeople.find((p) => p.id === calls.eq[1]), ...values } : null, error: null };
      }
      await mockServer.gate;
      // Como o supabase-js devolve a falha de rede.
      if (mockServer.down.includes(table)) return { data: null, error: { message: 'TypeError: Network request failed', code: '' } };
      if (table === 'chore_rotation') {
        // Como a API responde pela tabela que o banco não tem.
        const missing = { code: 'PGRST205', message: "Could not find the table 'public.chore_rotation' in the schema cache" };
        if (mockServer.old || mockServer.staleCache) return { data: null, error: missing };
        const rows = mockServer.order.map((person_id, i) => ({ chore_id: 'c-1', person_id, position: i + 1 }));
        mockServer.afterCheck?.();
        mockServer.afterCheck = null;
        return { data: rows, error: null };
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
  // Como save_chore no banco: tudo numa transação. Recusada qualquer parte, nada muda no servidor de mentira.
  const saveChore = (args: Row): { data: unknown; error: unknown } => {
    const refuse = (code: string, message: string) => ({ data: null, error: { code, message, details: null, hint: null } });
    const people = args.p_people as string[] | null;
    const turn = args.p_set_turn ? { assigned_to: args.p_assigned_to, kid_id: args.p_kid_id } : {};
    const fields = {
      title: args.p_title,
      notes: args.p_notes,
      recurrence: args.p_recurrence,
      interval_count: args.p_interval_count,
      due_on: args.p_due_on,
    };
    let row: Row;
    let order = mockServer.order;
    if (args.p_chore_id) {
      // A tarefa que não está mais nesta casa, e a que tem rodízio quando o formulário abriu sem (a não ser que a
      // ordem gravada seja a mesma que ele está salvando).
      if (!mockServer.chore) return refuse('P0002', 'chore not found');
      if (args.p_expect_none && order.length && JSON.stringify(order) !== JSON.stringify(people)) return refuse('NK006', 'chore has a rotation');
      // O gatilho: a tarefa que vira "Uma vez" perde o rodízio e fica com quem estava na vez.
      if (fields.recurrence === 'none' && mockServer.chore.recurrence !== 'none') order = [];
      row = { ...mockServer.chore, ...fields, points: args.p_points ?? mockServer.chore.points, ...turn };
    } else {
      row = { id: 'c-nova', ...fields, assigned_to: null, kid_id: null, ...turn, active: true, equipment_id: args.p_equipment_id, points: args.p_points ?? 0 };
    }
    if (people?.length) {
      if (row.recurrence === 'none') return refuse('22023', 'Só tarefa que se repete pode ter rodízio.');
      // Rodízio novo começa pelo primeiro; no que já existia, quem continua na ordem mantém a vez.
      const holder = row.kid_id ?? mockPeople.find((p) => p.member_user_id && p.member_user_id === row.assigned_to)?.id;
      if (!order.length || !people.includes(String(holder))) {
        const account = mockPeople.find((p) => p.id === people[0])?.member_user_id ?? null;
        row = { ...row, assigned_to: account, kid_id: account ? null : people[0] };
      }
    }
    mockServer.chore = row;
    mockServer.order = people ?? order;
    return { data: row.id, error: null };
  };
  // Como skip_chore_turn no banco: passa a vez só se ela ainda é de p_from e, com p_to, só se o seguinte na ordem de
  // agora é p_to (de quem está fora da ordem, ou de ninguém, a vez vai para o primeiro). Devolve de quem a vez passou
  // a ser, ou nulo quando nada mudou.
  const skipTurn = (args: Row): { data: unknown; error: unknown } => {
    mockServer.log.push('rpc skip_chore_turn');
    mockServer.skips.push(args);
    if (mockServer.failSkip) return { data: null, error: mockServer.failSkip };
    const row = mockServer.chore;
    if (!row) return { data: null, error: { code: 'P0002', message: 'chore not found', details: null, hint: null } };
    const order = mockServer.order;
    const holder = row.kid_id ?? mockPeople.find((p) => p.member_user_id && p.member_user_id === row.assigned_to)?.id ?? null;
    if (!row.active || holder !== args.p_from || order.length < 2) return { data: null, error: null };
    const next = order[(order.indexOf(String(holder)) + 1) % order.length];
    if (args.p_to != null && next !== args.p_to) return { data: null, error: null };
    const account = mockPeople.find((p) => p.id === next)?.member_user_id ?? null;
    mockServer.chore = { ...row, assigned_to: account, kid_id: account ? null : next };
    return { data: next, error: null };
  };
  return {
    supabase: {
      from: (table: string) => query(table),
      rpc: async (name: string, args: Row) => {
        if (name === 'skip_chore_turn') return skipTurn(args);
        if (name !== 'save_chore') {
          mockServer.log.push(`rpc ${name}`);
          return { data: null, error: null };
        }
        mockServer.log.push(`rpc save_chore ${JSON.stringify(args)}`);
        // Como a API responde pela função que o banco não tem.
        const missing = { code: 'PGRST202', message: 'Could not find the function public.save_chore(p_assigned_to, p_chore_id, p_due_on) in the schema cache' };
        if (mockServer.old || mockServer.noSaveChore || mockServer.staleCache) return { data: null, error: missing };
        if (mockServer.failSave) return { data: null, error: mockServer.failSave };
        const saved = saveChore(args);
        if (!saved.error && mockServer.dropAnswer) {
          mockServer.dropAnswer = false;
          // Como o supabase-js devolve a falha de rede.
          return { data: null, error: { message: 'TypeError: Network request failed', code: '' } };
        }
        return saved;
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

/**
 * O salvar da tarefa: uma chamada só a save_chore, com a tarefa inteira. Aqui, a de um formulário que mostrou um
 * rodízio e não mexeu em nada (nem ordem, nem responsável, nem pontos); cada teste diz o que o dele manda de diferente.
 */
const call = (over: Row = {}) =>
  `rpc save_chore ${JSON.stringify({
    p_chore_id: 'c-1',
    p_title: 'Lavar a louça',
    p_notes: null,
    p_recurrence: 'daily',
    p_interval_count: 1,
    p_due_on: '2026-10-12',
    p_points: null,
    p_equipment_id: null,
    p_set_turn: false,
    p_assigned_to: null,
    p_kid_id: null,
    p_people: null,
    p_expect_none: false,
    ...over,
  })}`;
/** Os argumentos de uma chamada registrada. */
const sent = (line: string) => JSON.parse(line.replace('rpc save_chore ', '')) as Row;
// Como o supabase-js devolve a falha de rede, e o alerta que ela vira.
const OFFLINE = { message: 'TypeError: Network request failed', code: '' };
const NETWORK_ERROR = ['Erro', 'TypeError: Network request failed'];

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
    /** Toca num chip (a repetição, o responsável ou uma pessoa do rodízio), pelo texto dele. */
    pick: (label: string) => act(async () => root.findAllByType(Chip).find((chip) => chip.props.label === label)!.props.onPress()),
    /** Os avisos de erro que tomaram o lugar do formulário. */
    notices: () => root.findAllByType(ErrorNotice).map((notice) => (notice.props.error as Error).message),
    press: async (label: string) => {
      await act(async () => button(label).props.onPress());
      await settle();
    },
    /** Só o toque, sem esperar o que ele começa. */
    tap: (label: string) => act(async () => void button(label).props.onPress()),
    busy: (label: string) => Boolean(button(label).props.loading),
    /** O botão aceita toque? (Ocupado ou desligado, o toque não chega.) */
    pressable: (label: string) => !button(label).findAll((node) => node.props.accessibilityRole === 'button')[0].props.disabled,
    /** Os botões na tela, pelo texto. */
    buttons: () => root.findAllByType(Button).map((b) => b.props.title as string),
    /** Os textos da tela, cada um inteiro. */
    texts: () => root.findAllByType(Text).map((text) => [text.props.children].flat().join('')),
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
  Object.assign(mockServer, {
    chore: chore({ assigned_to: 'u-carla', points: 10 }),
    order: ORDER,
    down: [],
    old: false,
    noSaveChore: false,
    staleCache: false,
    gate: null,
    afterCheck: null,
    failSave: null,
    dropAnswer: false,
    failSkip: null,
    skips: [],
    log: [],
  });
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
    // Uma chamada só, e o rodízio que o formulário mostrou não vai de volta (ninguém mexeu na ordem), nem o
    // responsável: o rodízio e a vez ficam com o banco. Os pontos são os do servidor.
    expect(mockServer.log).toEqual([call({ p_points: 10 })]);
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
  // A tarefa inteira numa chamada: os campos, o responsável escolhido, os pontos e o aviso de que o formulário abriu
  // sem rodízio, para o banco conferir.
  const single = (over: Row = {}) => call({ p_points: 0, p_set_turn: true, p_assigned_to: 'u-beto', p_expect_none: true, ...over });
  const SINGLE_SAVE = [single()];
  // No banco de antes da migração, que não tem essa função, a tarefa inteira vai direto na tabela.
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

  it('rodízio criado em outro celular entre a conferência e a gravação: o banco recusa, o aviso é o mesmo e o formulário fica', async () => {
    const screen = await openPlain();
    await screen.typeTitle('Lavar a louça e as panelas');
    // A conferência deste celular ainda não acha ordem nenhuma; a de Carla é criada logo depois dela.
    mockServer.afterCheck = () => {
      mockServer.chore = chore({ assigned_to: 'u-carla', points: 10 });
      mockServer.order = ORDER;
    };

    await screen.press('Salvar');
    // Só a chamada recusada chegou ao servidor, e nada dela foi gravado: nem o título novo.
    expect(mockServer.log).toEqual([single({ p_title: 'Lavar a louça e as panelas' })]);
    expect(mockNotify.mock.calls).toEqual([CHANGED]);
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockServer.chore).toMatchObject({ title: 'Lavar a louça', assigned_to: 'u-carla', points: 10 });
    expect(mockServer.order).toEqual(ORDER);
    expect(screen.title()).toBe('Lavar a louça e as panelas');
    expect(screen.busy('Salvar')).toBe(false);
    // A tarefa e as ordens foram buscadas de novo: as listas já mostram o rodízio.
    expect(client.getQueryData(['choreRotations'])).toEqual({ 'c-1': ORDER });
    expect(client.getQueryData(['chores', 'c-1'])).toMatchObject({ assigned_to: 'u-carla', points: 10 });

    // Outro toque em Salvar nem vai ao servidor: o formulário aberto já sabe que a tarefa ganhou um rodízio.
    await screen.press('Salvar');
    expect(mockServer.log).toEqual([single({ p_title: 'Lavar a louça e as panelas' })]);
    expect(mockNotify.mock.calls).toEqual([CHANGED, CHANGED]);

    // Fechado e aberto de novo, como o aviso pede, o editor abre com a ordem.
    await act(async () => renderer!.unmount());
    const reopened = await open();
    await settle();
    expect(reopened.chips()).toEqual(IN_ROTATION);
    expect(reopened.title()).toBe('Lavar a louça');
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
    // A tarefa segue sem rodízio no servidor: o banco aceita a chamada, e a tarefa fica salva com o responsável.
    expect(mockServer.log).toEqual(SINGLE_SAVE);
    expect(mockServer.chore).toMatchObject({ assigned_to: 'u-beto', kid_id: null, points: 0 });
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
    expect(mockServer.log).toEqual(SINGLE_SAVE);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('o que a pessoa corrige enquanto a conferência anda também é salvo, e não o que estava na tela no toque', async () => {
    const screen = await openPlain();
    const release = holdFetches();
    await screen.tap('Salvar');
    expect(screen.busy('Salvar')).toBe(true);
    await screen.typeTitle('Lavar a louça e o fogão');
    release();
    await settle();
    expect(mockServer.log).toEqual([single({ p_title: 'Lavar a louça e o fogão' })]);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('e o que ficou na tela é conferido de novo: com o título apagado durante a conferência, avisa e não grava', async () => {
    const screen = await openPlain();
    const release = holdFetches();
    await screen.tap('Salvar');
    await screen.typeTitle('');
    release();
    await settle();
    expect(mockServer.log).toEqual([]);
    expect(mockNotify.mock.calls).toEqual([['Confira os dados', 'Título, data (dd/mm/aaaa) e intervalo entre 1 e 365 são obrigatórios.']]);
    expect(mockBack).not.toHaveBeenCalled();
    expect(screen.busy('Salvar')).toBe(false);
  });

  it('banco que ainda não tem o rodízio: a conferência não acha ordem nenhuma e a tarefa salva como sempre', async () => {
    mockServer.old = true;
    const screen = await openPlain();
    await screen.press('Salvar');
    // A função que salva a tarefa não existe lá: a chamada não a acha, e a tarefa inteira vai direto na tabela.
    expect(mockServer.log).toEqual([SINGLE_SAVE[0], PLAIN_SAVE]);
    expect(mockServer.chore).toMatchObject({ assigned_to: 'u-beto', kid_id: null, points: 0 });
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('formulário aberto com rodízio não confere nada antes: salva mesmo com a busca da ordem fora do ar', async () => {
    const screen = await open();
    await settle();
    expect(screen.chips()).toEqual(IN_ROTATION);
    mockServer.down = ['chore_rotation'];
    await screen.press('Salvar');
    expect(mockServer.log).toEqual([call({ p_points: 10 })]);
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
    expect(mockServer.log[0]).toContain('rpc save_chore {"p_chore_id":null,"p_title":"Regar as plantas",');
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('formulário aberto sem rodízio que cria um: a ordem vai na mesma chamada, e quem confere que a tarefa segue sem rodízio é o banco', () => {
  const NEW_ORDER = ['p-lia', 'p-beto'];
  // A tarefa inteira numa chamada: os campos, a ordem, os pontos e o aviso de que o formulário abriu sem rodízio.
  // O responsável não vai: a vez do rodízio novo quem põe é o banco, no primeiro da ordem.
  const created = (over: Row = {}) => call({ p_points: 10, p_people: NEW_ORDER, p_expect_none: true, ...over });

  /** A tarefa é de Beto, sem rodízio, no servidor e neste celular; a pessoa monta o rodízio Lia, Beto. */
  async function openAndPickRotation(over: Row = {}) {
    mockServer.chore = chore({ assigned_to: 'u-beto', ...over });
    mockServer.order = [];
    cached({ chore: mockServer.chore, order: [] }, 1000);
    const screen = await open();
    await settle();
    if (over.recurrence === 'none') await screen.pick('Diária');
    // Entrando no rodízio, quem era o responsável é o primeiro: Beto sai e volta, para ficar depois de Lia.
    await screen.pick('Rodízio');
    await screen.pick('1 Beto');
    await screen.pick('Lia');
    await screen.pick('Beto');
    expect(screen.chips()).toEqual([...RECURRENCE, '[ ] Qualquer um', '[x] Rodízio', '[x] 2 Beto', '[ ] Carla', '[x] 1 Lia']);
    return screen;
  }

  it('uma chamada só, com a ordem e os pontos e sem o responsável: a vez fica com o primeiro da ordem', async () => {
    const screen = await openAndPickRotation();
    await screen.press('Salvar');
    expect(mockServer.log).toEqual([created()]);
    expect(mockServer.order).toEqual(NEW_ORDER);
    expect(mockServer.chore).toMatchObject({ assigned_to: null, kid_id: 'p-lia', points: 10 });
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('rodízio criado em outro celular entre a conferência e a gravação: o banco recusa a chamada inteira, o aviso é o mesmo e o formulário fica', async () => {
    const screen = await openAndPickRotation();
    await screen.typeTitle('Lavar a louça e as panelas');
    // A conferência deste celular ainda não acha ordem nenhuma; a de Carla (com Lia valendo 10) é criada logo depois dela.
    mockServer.afterCheck = () => {
      mockServer.chore = chore({ assigned_to: 'u-carla', points: 10 });
      mockServer.order = ORDER;
    };

    await screen.press('Salvar');
    // Só a chamada recusada chegou ao servidor: a ordem de lá segue inteira, com a vez e os pontos dela, e nem o
    // título novo foi salvo.
    expect(mockServer.log).toEqual([created({ p_title: 'Lavar a louça e as panelas' })]);
    expect(mockNotify.mock.calls).toEqual([CHANGED]);
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockServer.order).toEqual(ORDER);
    expect(mockServer.chore).toMatchObject({ title: 'Lavar a louça', assigned_to: 'u-carla', kid_id: null, points: 10 });
    expect(screen.title()).toBe('Lavar a louça e as panelas');
    expect(screen.busy('Salvar')).toBe(false);
    // A tarefa e as ordens foram buscadas de novo: as listas já mostram o rodízio de lá.
    expect(client.getQueryData(['choreRotations'])).toEqual({ 'c-1': ORDER });
    expect(client.getQueryData(['chores', 'c-1'])).toMatchObject({ assigned_to: 'u-carla', points: 10 });

    // Outro toque em Salvar nem vai ao servidor: o formulário aberto já sabe que a tarefa ganhou um rodízio.
    await screen.press('Salvar');
    expect(mockServer.log).toEqual([created({ p_title: 'Lavar a louça e as panelas' })]);
    expect(mockNotify.mock.calls).toEqual([CHANGED, CHANGED]);
  });

  it('a tarefa era "Uma vez": a repetição nova e a ordem vão na mesma chamada', async () => {
    const screen = await openAndPickRotation({ recurrence: 'none' });
    await screen.press('Salvar');
    expect(mockServer.log).toEqual([created()]);
    expect(mockServer.order).toEqual(NEW_ORDER);
    expect(mockServer.chore).toMatchObject({ recurrence: 'daily', kid_id: 'p-lia', points: 10 });
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('a tarefa virou "Uma vez" em outro celular com o formulário aberto em "Diária": um toque só salva a repetição que ele mostra, a ordem e o resto', async () => {
    const screen = await openAndPickRotation();
    await screen.typeTitle('Lavar a louça e as panelas');
    // O formulário abriu com a tarefa diária, e é isso que ele mostra; outro celular a muda logo depois da conferência deste.
    mockServer.afterCheck = () => {
      mockServer.chore = { ...mockServer.chore, recurrence: 'none' };
    };

    await screen.press('Salvar');
    // A repetição vai na mesma chamada que a ordem: o banco a grava antes de olhar se a tarefa pode ter rodízio.
    expect(mockServer.log).toEqual([created({ p_title: 'Lavar a louça e as panelas' })]);
    expect(mockServer.order).toEqual(NEW_ORDER);
    expect(mockServer.chore).toMatchObject({ title: 'Lavar a louça e as panelas', recurrence: 'daily', kid_id: 'p-lia', assigned_to: null, points: 10 });
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('o banco recusa a ordem (alguém dela saiu da casa): nada foi salvo, nem a repetição; o alerta é a frase do banco e o formulário fica', async () => {
    const screen = await openAndPickRotation({ recurrence: 'none' });
    await screen.typeTitle('Lavar a louça e as panelas');
    const left = 'Alguém do rodízio não está mais na casa. Confira a ordem e salve de novo.';
    mockServer.failSave = { code: 'P0002', message: left, details: null, hint: null };
    await screen.press('Salvar');
    expect(mockServer.log).toEqual([created({ p_title: 'Lavar a louça e as panelas' })]);
    expect(mockNotify.mock.calls).toEqual([['Erro', left]]);
    expect(mockBack).not.toHaveBeenCalled();
    // A tarefa segue "Uma vez", de Beto, com o título de antes: não existe mais "só a repetição foi salva".
    expect(mockServer.order).toEqual([]);
    expect(mockServer.chore).toMatchObject({ title: 'Lavar a louça', recurrence: 'none', assigned_to: 'u-beto', kid_id: null, points: 0 });
    expect(screen.title()).toBe('Lavar a louça e as panelas');
    expect(screen.chips()).toEqual([...RECURRENCE, '[ ] Qualquer um', '[x] Rodízio', '[x] 2 Beto', '[ ] Carla', '[x] 1 Lia']);
    expect(screen.busy('Salvar')).toBe(false);

    // Resolvido, o mesmo toque salva tudo de uma vez.
    mockServer.failSave = null;
    await screen.press('Salvar');
    expect(mockServer.log).toEqual([created({ p_title: 'Lavar a louça e as panelas' }), created({ p_title: 'Lavar a louça e as panelas' })]);
    expect(mockServer.order).toEqual(NEW_ORDER);
    expect(mockServer.chore).toMatchObject({ title: 'Lavar a louça e as panelas', recurrence: 'daily', kid_id: 'p-lia', assigned_to: null, points: 10 });
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('banco que ainda não tem o rodízio: a tarefa é salva como antes, inteira, e o aviso diz que o rodízio ficou de fora', async () => {
    mockServer.old = true;
    const screen = await openAndPickRotation();
    await screen.press('Salvar');
    // A chamada não acha a função; aí a tarefa vai direto na tabela, com o primeiro da ordem como responsável.
    expect(mockServer.log).toEqual([
      created(),
      'update chores {"title":"Lavar a louça","notes":null,"recurrence":"daily","interval_count":1,"due_on":"2026-10-12","assigned_to":null,"kid_id":"p-lia","points":10}',
    ]);
    expect(mockServer.chore).toMatchObject({ assigned_to: null, kid_id: 'p-lia', points: 10 });
    expect(mockNotify.mock.calls).toEqual([['A tarefa foi salva, sem o rodízio', ROTATION_UNAVAILABLE]]);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('a chamada falha pela rede: o alerta de erro, o formulário fica, e salvar de novo é seguro', () => {
  const NEW_ORDER = ['p-lia', 'p-beto'];
  const created = call({ p_title: 'Lavar a louça e as panelas', p_points: 10, p_people: NEW_ORDER, p_expect_none: true });

  /** A tarefa é de Beto, sem rodízio, no servidor e neste celular. */
  async function openPlain() {
    mockServer.chore = chore({ assigned_to: 'u-beto' });
    mockServer.order = [];
    cached({ chore: mockServer.chore, order: [] }, 1000);
    const screen = await open();
    await settle();
    await screen.typeTitle('Lavar a louça e as panelas');
    return screen;
  }

  /** O mesmo, e a pessoa monta o rodízio Lia, Beto. */
  async function openAndPickRotation() {
    const screen = await openPlain();
    await screen.pick('Rodízio');
    await screen.pick('1 Beto');
    await screen.pick('Lia');
    await screen.pick('Beto');
    return screen;
  }

  it('a chamada nem chegou ao servidor: nada foi salvo, e o segundo toque salva', async () => {
    const screen = await openAndPickRotation();
    mockServer.failSave = OFFLINE;
    await screen.press('Salvar');
    expect(mockServer.log).toEqual([created]);
    expect(mockNotify.mock.calls).toEqual([NETWORK_ERROR]);
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockServer.order).toEqual([]);
    expect(mockServer.chore).toMatchObject({ title: 'Lavar a louça', assigned_to: 'u-beto' });
    expect(screen.title()).toBe('Lavar a louça e as panelas');
    expect(screen.busy('Salvar')).toBe(false);

    mockServer.failSave = null;
    await screen.press('Salvar');
    expect(mockServer.log).toEqual([created, created]);
    expect(mockServer.order).toEqual(NEW_ORDER);
    expect(mockServer.chore).toMatchObject({ title: 'Lavar a louça e as panelas', kid_id: 'p-lia', points: 10 });
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('rodízio novo que chegou ao servidor, e a resposta se perdeu: salvar de novo não esbarra no próprio rodízio', async () => {
    const screen = await openAndPickRotation();
    mockServer.dropAnswer = true;
    await screen.press('Salvar');
    expect(mockNotify.mock.calls).toEqual([NETWORK_ERROR]);
    expect(mockBack).not.toHaveBeenCalled();
    // O servidor gravou tudo, e este celular, que buscou de novo depois da falha, já vê o rodízio que ele mesmo criou.
    expect(mockServer.order).toEqual(NEW_ORDER);
    expect(mockServer.chore).toMatchObject({ title: 'Lavar a louça e as panelas', kid_id: 'p-lia', points: 10 });
    expect(client.getQueryData(['choreRotations'])).toEqual({ 'c-1': NEW_ORDER });
    expect(screen.title()).toBe('Lavar a louça e as panelas');
    // Nesse meio-tempo a tarefa foi concluída em outro celular, e a vez passou para Beto.
    mockServer.chore = { ...mockServer.chore, assigned_to: 'u-beto', kid_id: null };

    await screen.press('Salvar');
    // Nem a conferência do formulário nem o banco tomam a ordem dele por um rodízio de outro aparelho: a mesma
    // chamada vai de novo, é aceita, e a vez fica onde está.
    expect(mockServer.log).toEqual([created, created]);
    expect(mockServer.order).toEqual(NEW_ORDER);
    expect(mockServer.chore).toMatchObject({ title: 'Lavar a louça e as panelas', assigned_to: 'u-beto', kid_id: null, points: 10 });
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('rodízio que chegou ao servidor sem a resposta, e a pessoa muda a ordem antes de tentar de novo: o aviso diz que a tentativa anterior pode ter salvo', async () => {
    const screen = await openAndPickRotation();
    mockServer.dropAnswer = true;
    await screen.press('Salvar');
    expect(mockNotify.mock.calls).toEqual([NETWORK_ERROR]);
    expect(mockServer.order).toEqual(NEW_ORDER);
    // A pessoa põe Carla no rodízio e tenta de novo: a ordem no servidor é a que este formulário mandou.
    await screen.pick('Carla');
    await screen.press('Salvar');
    expect(mockServer.log).toEqual([created]);
    expect(mockNotify.mock.calls).toEqual([NETWORK_ERROR, ['Confira o rodízio', ROTATION_MAYBE_SAVED]]);
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockServer.order).toEqual(NEW_ORDER);
  });

  it('depois da falha, o rodízio achado é outro (criado em outro celular): aí o aviso é o de sempre, e nada é gravado por cima', async () => {
    const screen = await openAndPickRotation();
    mockServer.failSave = OFFLINE;
    await screen.press('Salvar');
    mockServer.failSave = null;
    mockServer.chore = chore({ assigned_to: 'u-carla', points: 10 });
    mockServer.order = ORDER;

    await screen.press('Salvar');
    expect(mockServer.log).toEqual([created]);
    expect(mockNotify.mock.calls).toEqual([NETWORK_ERROR, CHANGED]);
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockServer.order).toEqual(ORDER);
    expect(mockServer.chore).toMatchObject({ title: 'Lavar a louça', assigned_to: 'u-carla', points: 10 });
  });

  it('responsável escolhido que chegou ao servidor, e a resposta se perdeu: o segundo toque grava o mesmo e fecha', async () => {
    const screen = await openPlain();
    await screen.pick('Carla');
    const single = call({ p_title: 'Lavar a louça e as panelas', p_points: 0, p_set_turn: true, p_assigned_to: 'u-carla', p_expect_none: true });
    mockServer.dropAnswer = true;
    await screen.press('Salvar');
    expect(mockNotify.mock.calls).toEqual([NETWORK_ERROR]);
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockServer.chore).toMatchObject({ title: 'Lavar a louça e as panelas', assigned_to: 'u-carla' });

    await screen.press('Salvar');
    expect(mockServer.log).toEqual([single, single]);
    expect(mockServer.chore).toMatchObject({ title: 'Lavar a louça e as panelas', assigned_to: 'u-carla', kid_id: null, points: 0 });
    expect(mockServer.order).toEqual([]);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('formulário que mostrou o rodízio e mudou a ordem, e a resposta se perdeu: o segundo toque grava a mesma ordem e fecha', async () => {
    const screen = await open();
    await settle();
    await screen.pick('2 Carla');
    const reordered = call({ p_points: 10, p_people: ['p-beto', 'p-lia'] });
    mockServer.dropAnswer = true;
    await screen.press('Salvar');
    expect(mockNotify.mock.calls).toEqual([NETWORK_ERROR]);
    expect(mockBack).not.toHaveBeenCalled();
    // Carla, que estava na vez, saiu da ordem: a vez foi para o primeiro.
    expect(mockServer.order).toEqual(['p-beto', 'p-lia']);
    expect(mockServer.chore).toMatchObject({ assigned_to: 'u-beto', kid_id: null });

    await screen.press('Salvar');
    expect(mockServer.log).toEqual([reordered, reordered]);
    expect(mockServer.order).toEqual(['p-beto', 'p-lia']);
    expect(mockServer.chore).toMatchObject({ assigned_to: 'u-beto', kid_id: null, points: 10 });
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  // A tentativa que tira Lia do rodízio Beto, Carla, Lia (sem criança na ordem, 0 ponto), e a que a põe de volta.
  const withoutLia = call({ p_points: 0, p_people: ['p-beto', 'p-carla'] });
  const restored = call({ p_points: 10, p_people: ORDER });

  it('formulário que mostrou o rodízio tirou Lia e a resposta se perdeu: com Lia de volta, a ordem vai de novo e Lia volta ao rodízio', async () => {
    const screen = await open();
    await settle();
    await screen.pick('3 Lia');
    mockServer.dropAnswer = true;
    await screen.press('Salvar');
    expect(mockServer.log).toEqual([withoutLia]);
    expect(mockNotify.mock.calls).toEqual([NETWORK_ERROR]);
    expect(mockBack).not.toHaveBeenCalled();
    // O servidor gravou a ordem sem Lia. A pessoa viu o erro, decide manter Lia e a põe de volta: a tela mostra a
    // ordem de quando abriu.
    expect(mockServer.order).toEqual(['p-beto', 'p-carla']);
    await screen.pick('Lia');
    expect(screen.chips()).toEqual(IN_ROTATION);

    await screen.press('Salvar');
    // Igual à que o formulário mostrou, mas o servidor pode estar com a da tentativa anterior: a ordem vai, com os pontos de Lia.
    expect(mockServer.log).toEqual([withoutLia, restored]);
    expect(mockServer.order).toEqual(ORDER);
    expect(mockServer.chore).toMatchObject({ assigned_to: 'u-carla', kid_id: null, points: 10 });
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('e se a tentativa com Lia de volta nem chega ao servidor: a seguinte manda a ordem de novo, em vez de deixar Lia de fora', async () => {
    const screen = await open();
    await settle();
    await screen.pick('3 Lia');
    mockServer.dropAnswer = true;
    await screen.press('Salvar');
    expect(mockServer.order).toEqual(['p-beto', 'p-carla']);
    await screen.pick('Lia');
    // Sem internet: a chamada com Lia de volta não chega, e o servidor segue sem ela.
    mockServer.failSave = OFFLINE;
    await screen.press('Salvar');
    expect(mockServer.order).toEqual(['p-beto', 'p-carla']);
    expect(mockNotify.mock.calls).toEqual([NETWORK_ERROR, NETWORK_ERROR]);

    mockServer.failSave = null;
    await screen.press('Salvar');
    expect(mockServer.log).toEqual([withoutLia, restored, restored]);
    expect(mockServer.order).toEqual(ORDER);
    expect(mockServer.chore).toMatchObject({ assigned_to: 'u-carla', kid_id: null, points: 10 });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('formulário que mostrou o rodízio virou "Uma vez" e a resposta se perdeu: de volta a "Diária", o rodízio vai de novo', async () => {
    const screen = await open();
    await settle();
    await screen.pick('Uma vez');
    const oneOff = call({ p_recurrence: 'none', p_people: [] });
    mockServer.dropAnswer = true;
    await screen.press('Salvar');
    expect(mockServer.log).toEqual([oneOff]);
    expect(mockNotify.mock.calls).toEqual([NETWORK_ERROR]);
    // O servidor encerrou o rodízio, e a tarefa ficou "Uma vez", com Carla. A pessoa volta atrás.
    expect(mockServer.order).toEqual([]);
    expect(mockServer.chore).toMatchObject({ recurrence: 'none', assigned_to: 'u-carla', kid_id: null });
    await screen.pick('Diária');
    expect(screen.chips()).toEqual(IN_ROTATION);

    await screen.press('Salvar');
    expect(mockServer.log).toEqual([oneOff, restored]);
    // O rodízio volta, como a tela mostra; recriado, ele começa pelo primeiro da ordem (a regra do banco).
    expect(mockServer.order).toEqual(ORDER);
    expect(mockServer.chore).toMatchObject({ recurrence: 'daily', assigned_to: 'u-beto', kid_id: null, points: 10 });
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('tarefa nova: a mesma chamada cria a tarefa e a ordem', () => {
  /** A tela da tarefa nova, com o título e o rodízio Beto, Lia. */
  async function openNewWithRotation() {
    mockDevice.id = 'nova';
    const screen = await open();
    await settle();
    await screen.typeTitle('Regar as plantas');
    await screen.pick('Rodízio');
    await screen.pick('Beto');
    await screen.pick('Lia');
    return screen;
  }

  it('com rodízio: uma chamada, sem id, com a ordem e os pontos e sem o responsável; a vez começa pelo primeiro', async () => {
    const screen = await openNewWithRotation();
    await screen.press('Salvar');
    expect(mockServer.log).toHaveLength(1);
    expect(sent(mockServer.log[0])).toMatchObject({
      p_chore_id: null,
      p_title: 'Regar as plantas',
      p_recurrence: 'weekly',
      p_points: 10,
      p_set_turn: false,
      p_assigned_to: null,
      p_kid_id: null,
      p_people: ['p-beto', 'p-lia'],
      // Ninguém mais pode ter criado um rodízio para a tarefa que ainda não existe.
      p_expect_none: false,
    });
    expect(mockServer.order).toEqual(['p-beto', 'p-lia']);
    expect(mockServer.chore).toMatchObject({ id: 'c-nova', title: 'Regar as plantas', assigned_to: 'u-beto', kid_id: null, points: 10 });
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('de uma criança, sem rodízio: o responsável escolhido e os pontos vão na chamada', async () => {
    mockDevice.id = 'nova';
    const screen = await open();
    await settle();
    await screen.typeTitle('Arrumar a cama');
    await screen.pick('Lia');
    await screen.press('Salvar');
    expect(mockServer.log).toHaveLength(1);
    expect(sent(mockServer.log[0])).toMatchObject({ p_chore_id: null, p_points: 10, p_set_turn: true, p_assigned_to: null, p_kid_id: 'p-lia', p_people: null });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('sem internet: o alerta de erro e o formulário fica; a chamada não chegou, e o segundo toque cria uma tarefa só', async () => {
    const screen = await openNewWithRotation();
    mockServer.failSave = OFFLINE;
    await screen.press('Salvar');
    expect(mockNotify.mock.calls).toEqual([NETWORK_ERROR]);
    expect(mockBack).not.toHaveBeenCalled();
    expect(screen.title()).toBe('Regar as plantas');
    expect(mockServer.chore).toMatchObject({ id: 'c-1' });

    mockServer.failSave = null;
    await screen.press('Salvar');
    expect(mockServer.log).toHaveLength(2);
    expect(mockServer.log[1]).toBe(mockServer.log[0]);
    expect(mockServer.chore).toMatchObject({ id: 'c-nova', title: 'Regar as plantas' });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('banco que ainda não tem o rodízio, com rodízio pedido: a tarefa é criada direto na tabela, e o aviso diz que o rodízio ficou de fora', async () => {
    mockServer.old = true;
    const screen = await openNewWithRotation();
    await screen.press('Salvar');
    expect(mockServer.log).toHaveLength(2);
    expect(mockServer.log[0]).toContain('rpc save_chore {"p_chore_id":null,"p_title":"Regar as plantas",');
    // O primeiro da ordem fica como responsável, e a manutenção nova levaria o aparelho.
    expect(mockServer.log[1]).toContain('insert chores {"title":"Regar as plantas",');
    expect(mockServer.log[1]).toContain('"assigned_to":"u-beto","kid_id":null,"points":10,"equipment_id":null}');
    expect(mockNotify.mock.calls).toEqual([['A tarefa foi salva, sem o rodízio', ROTATION_UNAVAILABLE]]);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('banco que ainda não tem o rodízio, sem rodízio pedido: a tarefa é criada como sempre, sem aviso nenhum', async () => {
    mockServer.old = true;
    mockDevice.id = 'nova';
    const screen = await open();
    await settle();
    await screen.typeTitle('Regar as plantas');
    await screen.press('Salvar');
    expect(mockServer.log).toHaveLength(2);
    expect(mockServer.log[1]).toContain('insert chores {"title":"Regar as plantas",');
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('tarefa apagada em outro aparelho com o formulário aberto: salvar diz isso em português, uma vez só, e não fecha', () => {
  /** A tarefa é de Beto, sem rodízio, no servidor e neste celular. */
  async function openPlain() {
    mockServer.chore = chore({ assigned_to: 'u-beto' });
    mockServer.order = [];
    cached({ chore: mockServer.chore, order: [] }, 1000);
    const screen = await open();
    await settle();
    return screen;
  }

  it('formulário sem rodízio: o banco responde que a tarefa não existe, e o aviso da tela toma o lugar do formulário', async () => {
    const screen = await openPlain();
    await screen.pick('Carla');
    mockServer.chore = null;

    await screen.press('Salvar');
    expect(mockServer.log).toEqual([call({ p_points: 0, p_set_turn: true, p_assigned_to: 'u-carla', p_expect_none: true })]);
    // A frase que a tela já tinha para a tarefa apagada, e só ela: nenhum alerta com o texto do banco ("chore not found").
    expect(screen.notices()).toEqual([CHORE_GONE]);
    expect(mockNotify).not.toHaveBeenCalled();
    expect(screen.title()).toBeUndefined();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('formulário sem rodízio que cria um: a resposta é a mesma, e o aviso não depende de a busca da tarefa dar certo', async () => {
    const screen = await openPlain();
    await screen.pick('Rodízio');
    await screen.pick('Lia');
    mockServer.chore = null;
    // A busca que vem depois do salvar falha: quem mostra o aviso é o próprio formulário.
    mockServer.down = ['chores'];

    await screen.press('Salvar');
    expect(mockServer.log).toEqual([call({ p_points: 10, p_people: ['p-beto', 'p-lia'], p_expect_none: true })]);
    expect(screen.notices()).toEqual([CHORE_GONE]);
    expect(mockNotify).not.toHaveBeenCalled();
    expect(screen.title()).toBeUndefined();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('formulário aberto com rodízio: a mesma resposta e o mesmo aviso, sem fechar como se tivesse salvado', async () => {
    const screen = await open();
    await settle();
    expect(screen.chips()).toEqual(IN_ROTATION);
    mockServer.chore = null;

    await screen.press('Salvar');
    expect(mockServer.log).toEqual([call({ p_points: 10 })]);
    expect(screen.notices()).toEqual([CHORE_GONE]);
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('banco que ainda não tem a função: a gravação direto na tabela não acha a linha, e o aviso é o mesmo', async () => {
    mockServer.old = true;
    const screen = await openPlain();
    await screen.pick('Carla');
    mockServer.chore = null;

    await screen.press('Salvar');
    // Para a API, gravar em nenhuma linha não é erro: sem pedir a linha de volta, a tela fecharia como se tivesse salvado.
    expect(mockServer.log).toHaveLength(2);
    expect(mockServer.log[1]).toContain('update chores {"title":"Lavar a louça",');
    expect(screen.notices()).toEqual([CHORE_GONE]);
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
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
    expect(mockServer.log).toEqual([call({ p_title: 'Lavar a louça e as panelas', p_points: 25 })]);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('tirar o "Rodízio" com alguém da ordem que este celular não carregou: avisa e fica no rodízio, sem passar a tarefa para outra pessoa', async () => {
    // A vez é de Lia (25 pontos), cadastrada em outro celular; as fichas deste são de antes dela, e a busca delas falhou ao abrir.
    mockServer.chore = chore({ kid_id: 'p-lia', points: 25 });
    mockServer.down = ['people'];
    cached({ chore: chore({ kid_id: 'p-lia', points: 25 }), order: ORDER, people: mockPeople.slice(0, 2) }, HOUR);
    const screen = await open();
    await settle();
    expect(screen.chips()).toEqual([...RECURRENCE, '[ ] Qualquer um', '[x] Rodízio', '[x] 1 Beto', '[x] 2 Carla']);
    await screen.pick('Rodízio');
    // Sem o aviso, a tela poria a tarefa com Beto (o primeiro que conhece), e salvar a tiraria de Lia, com 0 ponto.
    expect(mockNotify.mock.calls).toEqual([UNKNOWN]);
    expect(screen.chips()).toEqual([...RECURRENCE, '[ ] Qualquer um', '[x] Rodízio', '[x] 1 Beto', '[x] 2 Carla']);
    expect(mockRefetchHousehold).toHaveBeenCalledTimes(1);
    expect(mockServer.log).toEqual([]);
    expect(mockServer.chore).toMatchObject({ kid_id: 'p-lia', points: 25 });
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

describe('tarefa em rodízio que vira "Uma vez": fica com quem está na vez no banco, e o formulário não diz quem é', () => {
  const ONE_OFF = ['[x] Uma vez', '[ ] Diária', '[ ] Semanal', '[ ] Mensal', '[ ] Qualquer um'];

  it('quem está na vez é alguém que este celular não conhece: não grava (a tela mostrava outra pessoa); com as fichas, salva sem mandar o responsável', async () => {
    // A vez é de Lia (25 pontos), cadastrada em outro celular; as fichas deste são de antes dela, e a busca delas falhou ao abrir.
    mockServer.chore = chore({ kid_id: 'p-lia', points: 25 });
    mockServer.down = ['people'];
    cached({ chore: chore({ kid_id: 'p-lia', points: 25 }), order: ORDER, people: mockPeople.slice(0, 2) }, HOUR);
    const screen = await open();
    await settle();
    await screen.pick('Uma vez');
    // Sem conhecer Lia, a tela põe a tarefa com o primeiro da ordem que conhece: gravado, passaria a tarefa para Beto.
    expect(screen.chips()).toEqual([...ONE_OFF, '[x] Beto', '[ ] Carla']);

    mockServer.down = [];
    await screen.press('Salvar');
    expect(mockServer.log).toEqual([]);
    expect(mockNotify.mock.calls).toEqual([['Esta tarefa mudou', ROTATION_PERSON_UNKNOWN]]);
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockServer.order).toEqual(ORDER);
    expect(mockServer.chore).toMatchObject({ recurrence: 'daily', assigned_to: null, kid_id: 'p-lia', points: 25 });
    expect(mockRefetchHousehold).toHaveBeenCalledTimes(1);
    // As fichas chegaram: a tela passa a mostrar Lia.
    expect(screen.chips()).toEqual([...ONE_OFF, '[ ] Beto', '[ ] Carla', '[x] Lia']);

    await screen.press('Salvar');
    // O rodízio é encerrado (ordem vazia) e o responsável nem vai: quem diz de quem é a tarefa é o banco.
    expect(mockServer.log).toEqual([call({ p_recurrence: 'none', p_points: 25, p_people: [] })]);
    expect(mockServer.order).toEqual([]);
    expect(mockServer.chore).toMatchObject({ recurrence: 'none', assigned_to: null, kid_id: 'p-lia', points: 25 });
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('a vez passou em outro celular com o formulário aberto: a tarefa fica com quem está na vez lá, e os pontos dela não são zerados', async () => {
    const screen = await open();
    await settle();
    expect(screen.chips()).toEqual(IN_ROTATION);
    // O formulário abriu na vez de Carla; em outro celular a tarefa foi concluída, e a vez é de Lia, que ganha 10 pontos.
    mockServer.chore = { ...mockServer.chore, assigned_to: null, kid_id: 'p-lia' };
    await screen.pick('Uma vez');
    expect(screen.chips()).toEqual([...ONE_OFF, '[ ] Beto', '[x] Carla', '[ ] Lia']);

    await screen.press('Salvar');
    // Nem o responsável, nem os pontos: a tela não os mostra (para ela, a vez é de quem tem o app), e o 0 apagaria os de Lia.
    expect(mockServer.log).toEqual([call({ p_recurrence: 'none', p_people: [] })]);
    expect(mockServer.order).toEqual([]);
    expect(mockServer.chore).toMatchObject({ recurrence: 'none', assigned_to: null, kid_id: 'p-lia', points: 10 });
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('escolher uma pessoa de propósito é outra coisa: o rodízio é encerrado e a tarefa passa a ser dela', async () => {
    const screen = await open();
    await settle();
    await screen.pick('Qualquer um');
    await screen.pick('Lia');
    await screen.press('Salvar');
    expect(mockServer.log).toEqual([call({ p_points: 10, p_set_turn: true, p_kid_id: 'p-lia', p_people: [] })]);
    expect(mockServer.order).toEqual([]);
    expect(mockServer.chore).toMatchObject({ assigned_to: null, kid_id: 'p-lia', points: 10 });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('banco com a tabela do rodízio, mas sem a função que salva a tarefa inteira (a API ainda não a enxerga)', () => {
  it('nada é gravado: gravar direto na tabela deixaria a ordem como estava; o formulário fica aberto e pede para tentar de novo', async () => {
    mockServer.noSaveChore = true;
    const screen = await open();
    await settle();
    expect(screen.chips()).toEqual(IN_ROTATION);
    await screen.typeTitle('Lavar a louça e as panelas');
    // Sai do rodízio para uma pessoa só: a gravação direta mudaria o responsável e deixaria a ordem no banco.
    await screen.pick('Qualquer um');
    await screen.pick('Beto');

    await screen.press('Salvar');
    expect(mockServer.log).toEqual([call({ p_title: 'Lavar a louça e as panelas', p_points: 0, p_set_turn: true, p_assigned_to: 'u-beto', p_people: [] })]);
    // A tarefa e a ordem como estavam: a vez segue com Carla, no rodízio.
    expect(mockServer.order).toEqual(ORDER);
    expect(mockServer.chore).toMatchObject({ title: 'Lavar a louça', assigned_to: 'u-carla' });
    expect(mockNotify.mock.calls).toEqual([['Erro', ROTATION_NOT_READY]]);
    expect(mockBack).not.toHaveBeenCalled();
  });
});

describe('banco com o rodízio, e a API sem enxergar nem a função nem a tabela (o cache do esquema ficou para trás)', () => {
  it('a gravação direta que troca a vez é recusada pelo banco: nada é gravado, o aviso é o de tentar de novo, e o resto da tarefa ainda salva', async () => {
    mockServer.staleCache = true;
    const screen = await open();
    await settle();
    // Para a API não há rodízio: o formulário abre com a tarefa de Carla, e a conferência antes de salvar não acha ordem.
    expect(screen.chips()).toEqual(OF_CARLA);
    await screen.pick('Beto');

    await screen.press('Salvar');
    const update = (values: Row) =>
      `update chores ${JSON.stringify({ title: 'Lavar a louça', notes: null, recurrence: 'daily', interval_count: 1, due_on: '2026-10-12', ...values })}`;
    expect(mockServer.log).toEqual([
      call({ p_points: 0, p_set_turn: true, p_assigned_to: 'u-beto', p_expect_none: true }),
      update({ assigned_to: 'u-beto', kid_id: null, points: 0 }),
    ]);
    // A vez segue com Carla, no rodízio, e o aviso é o deste app (pelo código da recusa), não o texto do banco.
    expect(mockServer.order).toEqual(ORDER);
    expect(mockServer.chore).toMatchObject({ assigned_to: 'u-carla', kid_id: null, points: 10 });
    expect(mockNotify.mock.calls).toEqual([['Erro', ROTATION_NOT_READY]]);
    expect(mockBack).not.toHaveBeenCalled();

    // Sem trocar a vez, o banco aceita a gravação direta, como sempre.
    mockServer.log = [];
    await screen.pick('Carla');
    await screen.typeTitle('Lavar a louça e as panelas');
    await screen.press('Salvar');
    expect(mockServer.log).toEqual([
      call({ p_title: 'Lavar a louça e as panelas', p_points: 0, p_set_turn: true, p_assigned_to: 'u-carla', p_expect_none: true }),
      update({ title: 'Lavar a louça e as panelas', assigned_to: 'u-carla', kid_id: null, points: 0 }),
    ]);
    expect(mockServer.chore).toMatchObject({ title: 'Lavar a louça e as panelas', assigned_to: 'u-carla' });
    expect(mockServer.order).toEqual(ORDER);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('o formulário que mostrou o rodízio nunca grava direto: encerrar o rodízio com a mesma pessoa na vez não salva, e o aviso é o de tentar de novo', async () => {
    // O formulário abriu com o rodízio (a busca ao abrir enxergou a tabela); o salvar cai na API com o cache para trás.
    const screen = await open();
    await settle();
    expect(screen.chips()).toEqual(IN_ROTATION);
    mockServer.staleCache = true;
    // Sai do rodízio e fica com Carla, que está na vez: a gravação direta não trocaria a vez, o banco não recusaria, e
    // a ordem ficaria lá (a próxima conclusão seguiria revezando).
    await screen.pick('Rodízio');
    expect(screen.chips()).toEqual(OF_CARLA);

    await screen.press('Salvar');
    expect(mockServer.log).toEqual([call({ p_points: 0, p_set_turn: true, p_assigned_to: 'u-carla', p_people: [] })]);
    expect(mockNotify.mock.calls).toEqual([['Erro', ROTATION_NOT_READY]]);
    expect(mockBack).not.toHaveBeenCalled();
    expect(screen.title()).toBe('Lavar a louça');
    expect(screen.chips()).toEqual(OF_CARLA);
    expect(mockServer.order).toEqual(ORDER);
    expect(mockServer.chore).toMatchObject({ assigned_to: 'u-carla', kid_id: null, points: 10 });

    // Daqui a pouco a API enxerga a função: salvar de novo encerra o rodízio por ela, e a tela fecha.
    mockServer.staleCache = false;
    mockServer.log = [];
    await screen.press('Salvar');
    expect(mockServer.log).toEqual([call({ p_points: 0, p_set_turn: true, p_assigned_to: 'u-carla', p_people: [] })]);
    expect(mockServer.order).toEqual([]);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('a tarefa sem rodízio ainda salva direto na tabela', async () => {
    mockServer.order = [];
    mockServer.staleCache = true;
    const screen = await open();
    await settle();
    expect(screen.chips()).toEqual(OF_CARLA);
    await screen.pick('Beto');
    await screen.press('Salvar');
    expect(mockServer.log).toEqual([
      call({ p_points: 0, p_set_turn: true, p_assigned_to: 'u-beto', p_expect_none: true }),
      `update chores ${JSON.stringify({ title: 'Lavar a louça', notes: null, recurrence: 'daily', interval_count: 1, due_on: '2026-10-12', assigned_to: 'u-beto', kid_id: null, points: 0 })}`,
    ]);
    expect(mockServer.chore).toMatchObject({ assigned_to: 'u-beto', kid_id: null });
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('"Pular a vez": só com a ordem que este celular conhece inteira', () => {
  it('com todas as pessoas: pergunta de quem para quem e passa a vez', async () => {
    const screen = await open();
    await settle();
    expect(screen.texts()).toContain('Vez de Carla · depois Lia');
    expect(screen.buttons()).toContain('Pular a vez');
    await screen.press('Pular a vez');
    expect(mockConfirm.mock.calls).toEqual([['Pular a vez', 'Passar a vez de Carla para Lia?']]);
    expect(mockServer.log).toEqual(['rpc skip_chore_turn']);
  });

  it('alguém da ordem que este celular ainda não conhece: o botão não aparece, em vez de passar a vez para a pessoa errada', async () => {
    // Beto → Carla → Lia, na vez de Beto; a lista de moradores deste celular ainda não tem Carla. O banco passaria a
    // vez para Carla, e a pergunta diria "de Beto para Lia".
    mockServer.chore = chore({ assigned_to: 'u-beto', points: 10 });
    mockDevice.members = [mockMembers[0]];
    const screen = await open();
    await settle();
    expect(screen.chips()).toEqual([...RECURRENCE, '[ ] Qualquer um', '[x] Rodízio', '[x] 1 Beto', '[x] 3 Lia']);
    expect(screen.buttons()).not.toContain('Pular a vez');
    expect(mockConfirm).not.toHaveBeenCalled();
    // A linha da vez também não diz "depois Lia": diz que falta carregar alguém da ordem (sem uma linha em branco).
    expect(screen.texts()).toContain(ROTATION_ORDER_NOT_LOADED);
    expect(screen.texts().filter((text) => text.includes('depois') || text === '')).toEqual([]);
  });
});

describe('"Pular a vez": a vez vai para quem a pergunta nomeou, e a tela espera a vez de agora', () => {
  const NOTHING_DONE = skipNotDoneMessage(true);

  it('o botão fica ocupado até a tarefa e as ordens chegarem de novo: um segundo toque não pergunta pela vez de antes', async () => {
    const screen = await open();
    await settle();
    const release = holdFetches();
    await screen.tap('Pular a vez');
    await tick();
    expect(mockConfirm.mock.calls).toEqual([['Pular a vez', 'Passar a vez de Carla para Lia?']]);
    // A vez já passou no servidor, e a tela ainda não a leu de novo: o botão segue ocupado, e ocupado não aceita toque.
    expect(mockServer.chore).toMatchObject({ assigned_to: null, kid_id: 'p-lia' });
    expect(screen.texts()).toContain('Vez de Carla · depois Lia');
    expect(screen.busy('Pular a vez')).toBe(true);
    expect(screen.pressable('Pular a vez')).toBe(false);

    release();
    await settle();
    expect(screen.busy('Pular a vez')).toBe(false);
    expect(screen.texts()).toContain('Vez de Lia · depois Beto');
    // A chamada leva de quem era a vez e quem a pergunta disse que fica com ela.
    expect(mockServer.skips).toEqual([{ p_chore_id: 'c-1', p_from: 'p-carla', p_to: 'p-lia' }]);
    expect(mockNotify).not.toHaveBeenCalled();
    // O toque seguinte já pergunta pela vez de agora, e passa.
    await screen.press('Pular a vez');
    expect(mockConfirm.mock.calls[1]).toEqual(['Pular a vez', 'Passar a vez de Lia para Beto?']);
    expect(mockServer.chore).toMatchObject({ assigned_to: 'u-beto', kid_id: null });
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('a vez já tinha passado em outro celular: nada muda, e o aviso diz isso depois de a tela mostrar a vez de agora', async () => {
    const screen = await open();
    await settle();
    // Em outro celular alguém pulou a vez de Carla; esta tela ainda não buscou de novo.
    mockServer.chore = { ...mockServer.chore, assigned_to: null, kid_id: 'p-lia' };
    // O que a tela mostra na hora do aviso (na web ele é o alerta do navegador, que trava a página como ela está).
    let behind: string[] = [];
    mockNotify.mockImplementationOnce(() => {
      behind = screen.texts();
    });
    await screen.press('Pular a vez');
    expect(mockConfirm.mock.calls).toEqual([['Pular a vez', 'Passar a vez de Carla para Lia?']]);
    expect(mockServer.skips).toEqual([{ p_chore_id: 'c-1', p_from: 'p-carla', p_to: 'p-lia' }]);
    // Nada mudou no servidor: a vez segue de Lia, e não passou para Beto.
    expect(mockServer.chore).toMatchObject({ assigned_to: null, kid_id: 'p-lia' });
    expect(mockNotify.mock.calls).toEqual([[NOTHING_DONE.title, NOTHING_DONE.message]]);
    // O aviso diz que a tela agora mostra de quem é a vez: quando ele aparece, ela já mostra.
    expect(behind).toContain('Vez de Lia · depois Beto');
    expect(behind).not.toContain('Vez de Carla · depois Lia');
    expect(screen.texts()).toContain('Vez de Lia · depois Beto');
    expect(screen.busy('Pular a vez')).toBe(false);
  });

  it('a vez passou, mas a tarefa não pôde ser buscada de novo: a tela segue a resposta do servidor, e o toque seguinte pergunta pela vez de agora', async () => {
    const screen = await open();
    await settle();
    const readAt = client.getQueryState(['chores', 'c-1'])?.dataUpdatedAt;
    // A internet oscila: o "Pular a vez" chega ao servidor, e as buscas de depois (a tarefa e as ordens) falham.
    mockServer.down = ['chores', 'chore_rotation'];
    await screen.press('Pular a vez');
    expect(mockServer.skips).toEqual([{ p_chore_id: 'c-1', p_from: 'p-carla', p_to: 'p-lia' }]);
    expect(mockServer.chore).toMatchObject({ assigned_to: null, kid_id: 'p-lia' });
    // Sem a busca, vale a resposta: a vez passou para Lia, e a tela já diz isso. Nada a avisar.
    expect(screen.texts()).toContain('Vez de Lia · depois Beto');
    expect(mockNotify).not.toHaveBeenCalled();
    expect(screen.busy('Pular a vez')).toBe(false);

    // O toque seguinte pergunta pela vez de agora, e passa (a pergunta de antes não mudaria nada).
    await screen.press('Pular a vez');
    expect(mockConfirm.mock.calls).toEqual([
      ['Pular a vez', 'Passar a vez de Carla para Lia?'],
      ['Pular a vez', 'Passar a vez de Lia para Beto?'],
    ]);
    expect(mockServer.skips[1]).toEqual({ p_chore_id: 'c-1', p_from: 'p-lia', p_to: 'p-beto' });
    expect(mockServer.chore).toMatchObject({ assigned_to: 'u-beto', kid_id: null });
    expect(screen.texts()).toContain('Vez de Beto · depois Carla');
    expect(mockNotify).not.toHaveBeenCalled();
    // A tarefa em cache ganhou a vez da resposta, sem contar como lida do servidor (choreReadSince), e a busca segue
    // devendo: quando a internet voltar, ela é lida de novo.
    expect(client.getQueryData(['chores', 'c-1'])).toMatchObject({ assigned_to: 'u-beto', kid_id: null });
    expect(client.getQueryState(['chores', 'c-1'])).toMatchObject({ dataUpdatedAt: readAt, isInvalidated: true });
  });

  it('a ordem mudou em outro celular e a seguinte agora é outra pessoa: a vez não vai para quem a pergunta não nomeou', async () => {
    const screen = await open();
    await settle();
    // Em outro celular Lia saiu do rodízio; a vez segue com Carla, e a seguinte passa a ser Beto.
    mockServer.order = ['p-carla', 'p-beto'];
    await screen.press('Pular a vez');
    expect(mockConfirm.mock.calls).toEqual([['Pular a vez', 'Passar a vez de Carla para Lia?']]);
    expect(mockServer.skips).toEqual([{ p_chore_id: 'c-1', p_from: 'p-carla', p_to: 'p-lia' }]);
    expect(mockServer.chore).toMatchObject({ assigned_to: 'u-carla', kid_id: null });
    expect(mockNotify.mock.calls).toEqual([[NOTHING_DONE.title, NOTHING_DONE.message]]);
    // Com a ordem de agora, a pergunta é outra, e a vez passa para quem ela nomeia.
    await screen.press('Pular a vez');
    expect(mockConfirm.mock.calls[1]).toEqual(['Pular a vez', 'Passar a vez de Carla para Beto?']);
    expect(mockServer.skips[1]).toEqual({ p_chore_id: 'c-1', p_from: 'p-carla', p_to: 'p-beto' });
    expect(mockServer.chore).toMatchObject({ assigned_to: 'u-beto', kid_id: null });
    expect(mockNotify).toHaveBeenCalledTimes(1);
  });

  it('nada mudou e a tarefa não pôde ser buscada de novo: o aviso não diz que a tela já mostra a vez de agora', async () => {
    const screen = await open();
    await settle();
    mockServer.chore = { ...mockServer.chore, assigned_to: null, kid_id: 'p-lia' };
    mockServer.down = ['chores', 'chore_rotation'];
    await screen.press('Pular a vez');
    const notReread = skipNotDoneMessage(false);
    expect(mockNotify.mock.calls).toEqual([[notReread.title, notReread.message]]);
    // A tela ainda é a de antes, e o formulário fica.
    expect(screen.texts()).toContain('Vez de Carla · depois Lia');
    expect(screen.title()).toBe('Lavar a louça');
  });

  it('tarefa que não existe mais para quem pula (apagada, ou a pessoa saiu da casa): o aviso da tarefa apagada, sem alerta', async () => {
    const screen = await open();
    await settle();
    mockServer.failSkip = { code: 'P0002', message: 'chore not found', details: null, hint: null };
    await screen.press('Pular a vez');
    expect(mockNotify).not.toHaveBeenCalled();
    expect(screen.notices()).toEqual([CHORE_GONE]);
    expect(screen.title()).toBeUndefined();
  });

  it('apagada em outro aparelho, e a busca de depois também não a acha: o mesmo aviso, uma vez só', async () => {
    const screen = await open();
    await settle();
    mockServer.chore = null;
    await screen.press('Pular a vez');
    expect(mockServer.skips).toHaveLength(1);
    expect(mockNotify).not.toHaveBeenCalled();
    expect(screen.notices()).toEqual([CHORE_GONE]);
  });

  it('a vez passou, e a tarefa foi apagada em outro aparelho antes de ser lida de novo: o aviso da tarefa apagada, não o formulário com a vez da resposta', async () => {
    const screen = await open();
    await settle();
    const release = holdFetches();
    await screen.tap('Pular a vez');
    await tick();
    expect(mockConfirm.mock.calls).toEqual([['Pular a vez', 'Passar a vez de Carla para Lia?']]);
    // A vez passou para Lia no servidor; antes de a tela ler a tarefa de novo, outro celular a apaga.
    expect(mockServer.chore).toMatchObject({ assigned_to: null, kid_id: 'p-lia' });
    mockServer.chore = null;

    release();
    await settle();
    // A busca de depois não acha a tarefa. Gravada por cima desse erro, a vez da resposta deixaria na tela o formulário
    // da tarefa apagada ("Vez de Lia · depois Beto"), sem aviso nenhum.
    expect(screen.notices()).toEqual([CHORE_GONE]);
    expect(screen.title()).toBeUndefined();
    // E nenhum alerta de que a vez não foi passada: ela passou.
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockServer.skips).toEqual([{ p_chore_id: 'c-1', p_from: 'p-carla', p_to: 'p-lia' }]);
  });

  it('banco que ainda não enxerga a função: o aviso de que o rodízio não está disponível, e o formulário fica', async () => {
    const screen = await open();
    await settle();
    mockServer.failSkip = { code: 'PGRST202', message: 'Could not find the function public.skip_chore_turn(p_chore_id, p_from, p_to) in the schema cache' };
    await screen.press('Pular a vez');
    expect(mockNotify.mock.calls).toEqual([['Erro', ROTATION_UNAVAILABLE]]);
    expect(screen.title()).toBe('Lavar a louça');
  });
});

describe('quem está na vez é alguém que este celular ainda não carregou como está agora', () => {
  it('a linha da vez não diz um nome errado, "Pular a vez" some e sair do rodízio não passa a tarefa para outra pessoa', async () => {
    // Lia estava no rodízio sem o app e entrou na casa com a conta dela: a vez dela foi para a conta. As fichas e os
    // moradores deste celular ainda são de antes (Lia sem conta).
    mockServer.chore = chore({ assigned_to: 'u-lia', points: 10 });
    const screen = await open();
    await settle();
    expect(screen.chips()).toEqual(IN_ROTATION);
    // Contando a partir de "ninguém", a tela diria "Vez de Beto · depois Carla"; e o banco passaria de Lia para Beto.
    expect(screen.texts()).toContain(ROTATION_ORDER_NOT_LOADED);
    expect(screen.texts().filter((text) => text.startsWith('Vez de') || text.includes('depois'))).toEqual([]);
    expect(screen.buttons()).not.toContain('Pular a vez');

    // Saindo do rodízio, a tela poria a tarefa com Beto (o primeiro), e salvar a tiraria de Lia.
    await screen.pick('Rodízio');
    expect(mockNotify.mock.calls).toEqual([['Esta tarefa mudou', ROTATION_PERSON_UNKNOWN]]);
    expect(screen.chips()).toEqual(IN_ROTATION);
    expect(mockRefetchHousehold).toHaveBeenCalledTimes(1);

    // Salvar o rodízio como está é seguro: nem a ordem nem o responsável vão, e a vez segue com Lia.
    await screen.typeTitle('Lavar a louça e as panelas');
    await screen.press('Salvar');
    expect(mockServer.log).toEqual([call({ p_title: 'Lavar a louça e as panelas', p_points: 10 })]);
    expect(mockServer.order).toEqual(ORDER);
    expect(mockServer.chore).toMatchObject({ title: 'Lavar a louça e as panelas', assigned_to: 'u-lia', kid_id: null });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('formulário que mostrou o rodízio e não mexeu na ordem: não a manda, e o que outro celular fez com o rodízio fica', () => {
  it('só o título: o rodízio encerrado em outro celular segue encerrado, e a tarefa segue com Carla', async () => {
    const screen = await open();
    await settle();
    expect(screen.texts()).toContain('Vez de Carla · depois Lia');
    // Em outro celular decidem que Carla faz sempre: o rodízio acaba e a tarefa fica com ela. A busca de fundo chega
    // (as listas já não mostram o rodízio), e o formulário aberto fica como estava.
    mockServer.order = [];
    await act(async () => void client.invalidateQueries());
    await settle();
    expect(client.getQueryData(['choreRotations'])).toEqual({});
    expect(screen.chips()).toEqual(IN_ROTATION);

    await screen.typeTitle('Lavar a louça e as panelas');
    await screen.press('Salvar');
    // Nem a ordem que ele mostrou (que recriaria o rodízio, com a vez em Beto), nem o responsável.
    expect(mockServer.log).toEqual([call({ p_title: 'Lavar a louça e as panelas', p_points: 10 })]);
    expect(sent(mockServer.log[0])).toMatchObject({ p_people: null, p_set_turn: false });
    expect(mockServer.order).toEqual([]);
    expect(mockServer.chore).toMatchObject({ title: 'Lavar a louça e as panelas', assigned_to: 'u-carla', kid_id: null, points: 10 });
    expect(mockNotify).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('a ordem que outro celular mudou também fica, com a vez de lá', async () => {
    const screen = await open();
    await settle();
    // Em outro celular Lia sai do rodízio e Carla passa para o começo; a vez segue de Carla.
    mockServer.order = ['p-carla', 'p-beto'];
    await screen.typeTitle('Lavar a louça e as panelas');
    await screen.press('Salvar');
    expect(mockServer.log).toEqual([call({ p_title: 'Lavar a louça e as panelas', p_points: 10 })]);
    expect(mockServer.order).toEqual(['p-carla', 'p-beto']);
    expect(mockServer.chore).toMatchObject({ assigned_to: 'u-carla', kid_id: null });
  });

  it('a tela não mostra os pontos (ninguém da ordem ganha): eles não vão, e os que outro celular deu a uma criança ficam', async () => {
    // Um rodízio só de moradores (Beto e Carla), sem pontos.
    mockServer.chore = chore({ assigned_to: 'u-beto', points: 0 });
    mockServer.order = ['p-beto', 'p-carla'];
    const screen = await open();
    await settle();
    expect(screen.chips()).toEqual([...RECURRENCE, '[ ] Qualquer um', '[x] Rodízio', '[x] 1 Beto', '[x] 2 Carla', '[ ] Lia']);
    expect(screen.texts().filter((text) => text.startsWith('pontos'))).toEqual([]);
    // Em outro celular Lia entra no lugar de Carla, valendo 10 na vez dela.
    mockServer.order = ['p-beto', 'p-lia'];
    mockServer.chore = { ...mockServer.chore, points: 10 };

    await screen.typeTitle('Lavar a louça e as panelas');
    await screen.press('Salvar');
    expect(mockServer.log).toEqual([call({ p_title: 'Lavar a louça e as panelas' })]);
    expect(mockServer.order).toEqual(['p-beto', 'p-lia']);
    expect(mockServer.chore).toMatchObject({ title: 'Lavar a louça e as panelas', assigned_to: 'u-beto', points: 10 });
  });

  it('tirar e pôr de volta a última da ordem deixa a ordem como estava: ela não vai', async () => {
    const screen = await open();
    await settle();
    await screen.pick('3 Lia');
    await screen.pick('Lia');
    expect(screen.chips()).toEqual(IN_ROTATION);
    await screen.press('Salvar');
    expect(mockServer.log).toEqual([call({ p_points: 10 })]);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('as recusas do rodízio vêm em português', () => {
  it('alguém da ordem virou pet em outro celular: o alerta é a frase do banco, e nada é salvo', async () => {
    const pets = 'Só pessoas da casa (não pets) entram no rodízio. Confira a ordem e salve de novo.';
    const screen = await open();
    await settle();
    // Este celular ainda acha que Lia é pessoa; a pessoa tira Beto do rodízio, e a ordem vai.
    await screen.pick('1 Beto');
    mockServer.failSave = { code: '23514', message: pets, details: null, hint: null };
    await screen.press('Salvar');
    expect(mockServer.log).toEqual([call({ p_points: 10, p_people: ['p-carla', 'p-lia'] })]);
    expect(mockNotify.mock.calls).toEqual([['Erro', pets]]);
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockServer.order).toEqual(ORDER);
    expect(screen.title()).toBe('Lavar a louça');
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

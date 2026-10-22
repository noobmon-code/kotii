import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import FamilyEventScreen from '@/app/compromisso/[id]';
import { router } from 'expo-router';

import { confirmAction, notify } from '@/ui/dialogs';
import { Button, Chip, ListRow, Loading, TextField } from '@/ui/primitives';

// A tela de verdade, com as consultas de verdade de src/data/family.ts e um
// QueryClient com os padrões do app. Só a rede é trocada: um "banco" em
// memória atrás do cliente do Supabase.

type Row = Record<string, unknown>;
type Table = 'family_events' | 'family_event_days';
type Verb = 'insert' | 'update' | 'upsert' | 'delete';
// `gates`: enquanto houver uma promessa numa tabela, os pedidos a ela esperam (a rede lenta).
// `refuse`: o erro com que o banco recusa uma gravação (nada é gravado); sem ele, aceita.
const mockDb: {
  people: Row[];
  events: Row[];
  days: Row[];
  writes: { table: string; verb: Verb; values?: Row }[];
  gates: Partial<Record<Table, Promise<void>>>;
  refuse: ((table: string, verb: Verb) => Row | undefined) | null;
} = { people: [], events: [], days: [], writes: [], gates: {}, refuse: null };
const mockRoute: { params: Record<string, string> } = { params: { id: 'natacao' } };

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockRoute.params,
}));
jest.mock('@/ui/dialogs', () => ({ askYesNo: jest.fn(), confirmAction: jest.fn(), notify: jest.fn() }));
// Os desenhos animados e o fundo não entram no que se confere aqui.
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@/data/health', () => {
  const { useQuery } = jest.requireActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  // Como o usePeople de verdade: uma consulta em ['people'].
  return { usePeople: () => useQuery({ queryKey: ['people'], queryFn: async () => mockDb.people.map((p) => ({ ...p })) }) };
});
jest.mock('@/lib/supabase', () => {
  const table = (name: string) => {
    const filters: [string, unknown][] = [];
    let write: { verb: Verb; values?: Row } | null = null;
    const rowsOf = () => (name === 'family_events' ? mockDb.events : name === 'family_event_days' ? mockDb.days : []);
    const matches = (row: Row) => filters.every(([column, value]) => row[column] === value);
    const run = () => {
      if (!write) return { data: rowsOf().filter(matches).map((row) => ({ ...row })), error: null };
      const refused = mockDb.refuse?.(name, write.verb);
      if (refused) return { data: null, error: refused };
      mockDb.writes.push({ table: name, ...write });
      if (write.verb === 'insert' && name === 'family_events') mockDb.events.push({ id: 'novo-1', ...write.values });
      if (write.verb === 'update') {
        const hit = rowsOf().filter(matches);
        hit.forEach((row) => Object.assign(row, write!.values));
        return { data: hit.map((row) => ({ ...row })), error: null };
      }
      if (write.verb === 'delete') {
        const kept = rowsOf().filter((row) => !matches(row));
        if (name === 'family_event_days') mockDb.days = kept;
      }
      if (write.verb === 'upsert' && name === 'family_event_days') {
        const row = write.values!;
        mockDb.days = [...mockDb.days.filter((d) => !(d.event_id === row.event_id && d.occurs_on === row.occurs_on)), { ...row }];
      }
      return { data: null, error: null };
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      order: () => builder,
      range: () => builder,
      neq: () => builder,
      in: () => builder,
      gte: () => builder,
      eq: (column: string, value: unknown) => {
        // A busca de todos separa por repetição; a de um compromisso filtra pelo id.
        if (column !== 'recurrence') filters.push([column, value]);
        return builder;
      },
      insert: (values: Row) => {
        write = { verb: 'insert', values };
        return builder;
      },
      update: (values: Row) => {
        write = { verb: 'update', values };
        return builder;
      },
      upsert: (values: Row) => {
        write = { verb: 'upsert', values };
        return builder;
      },
      delete: () => {
        write = { verb: 'delete' };
        return builder;
      },
      maybeSingle: async () => {
        await mockDb.gates[name as Table];
        const result = run();
        return { data: (result.data as Row[] | null)?.[0] ?? null, error: result.error };
      },
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve(write ? undefined : mockDb.gates[name as Table])
          .then(() => run())
          .then(resolve, reject),
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
const dayRow = (patch: Row): Row => ({
  event_id: 'natacao',
  occurs_on: '2099-01-01',
  cancelled: false,
  override_take: false,
  take_by: null,
  override_pick_up: false,
  pick_up_by: null,
  ...patch,
});

let client: QueryClient;
let renderer: ReactTestRenderer | undefined;

/**
 * Espera `ms` e, depois, deixa passar mais algumas voltas do laço de eventos. Com a máquina ocupada, o que foi
 * agendado "para já" (o aviso de que uma busca chegou) pode só rodar depois do tempo pedido, e a tela ainda
 * estaria como antes.
 */
async function pause(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
  for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setTimeout(resolve, 0));
}
const settle = (ms = 30) =>
  act(async () => {
    await pause(ms);
  });
function open(params: Record<string, string> = { id: 'natacao' }) {
  mockRoute.params = params;
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
const buttons = (title: string) => renderer!.root.findAllByType(Button).filter((item) => String(item.props.title).startsWith(title));
const button = (title: string) => buttons(title)[0];
const chips = () => renderer!.root.findAllByType(Chip).map((chip) => `${chip.props.label}${chip.props.selected ? '*' : ''}`);
const chip = (label: string) => renderer!.root.findAllByType(Chip).find((item) => item.props.label === label)!;
/** Só as escolhas do cartão "Só neste dia", que vem antes do formulário (o primeiro chip dele é "Família toda"). */
function dayChips() {
  const all = renderer!.root.findAllByType(Chip);
  const formStart = all.findIndex((item) => item.props.label === 'Família toda');
  return all.slice(0, formStart < 0 ? all.length : formStart);
}
const loading = () => renderer!.root.findAllByType(Loading).length > 0;
const texts = (node: ReturnType<ReactTestRenderer['toJSON']> | string): string[] =>
  node == null ? [] : typeof node === 'string' ? [node] : Array.isArray(node) ? node.flatMap(texts) : (node.children ?? []).flatMap(texts);
const page = () => texts(renderer!.toJSON()).join(' | ');
/** O compromisso (e as mudanças de dia) guardado há dez minutos: a tela o tem, e busca de novo ao abrir. */
function age() {
  for (const key of [['familyEvents', 'natacao'], ['familyEventDays']]) {
    const data = client.getQueryData(key);
    if (data !== undefined) client.setQueryData(key, data, { updatedAt: Date.now() - 10 * 60_000 });
  }
}
/** Uma rede que não responde até `arrive()`. */
function hold(table: Table): () => void {
  let arrive!: () => void;
  mockDb.gates[table] = new Promise<void>((resolve) => {
    arrive = () => {
      delete mockDb.gates[table];
      resolve();
    };
  });
  return arrive;
}
/** Em outro celular: passou para as 17h, e é o Beto quem leva. */
const changeElsewhere = () => Object.assign(mockDb.events[0], { start_time: '17:00:00', end_time: '18:00:00', take_by: 'beto' });
/** Toca, e espera o que o toque pôs para andar. */
const press = (item: ReactTestInstance) =>
  act(async () => {
    item.props.onPress();
    await pause(30);
  });
/** A internet volta: as buscas paradas seguem. */
const online = () =>
  act(async () => {
    onlineManager.setOnline(true);
    await pause(30);
  });
/** A tela já foi aberta uma vez (há uma cópia guardada) e fechada. */
async function visitOnce(params?: Record<string, string>) {
  open(params);
  await settle();
  await close();
  age();
}
/** As leituras de uma tabela passam a dar erro (a rede caiu), até o `mockRestore()`. */
const failReads = (rows: Row[]) =>
  jest.spyOn(rows, 'filter').mockImplementation(() => {
    throw new Error('TypeError: Network request failed');
  });
const dayChip = (label: string) => dayChips().find((item) => item.props.label === label)!;
/**
 * Espera uma coisa aparecer na tela, em passos curtos, em vez de um tempo fixo: com a máquina ocupada, o cartão
 * do dia pode ser desenhado um pouco depois de os dados chegarem.
 */
async function until(ready: () => boolean, capMs = 3000) {
  for (let waited = 0; waited < capMs && !ready(); waited += 10) await settle(10);
}
const COPY_TITLE = 'Cópia guardada neste celular';
const COPY_TEXT = 'Ainda não deu para conferir se este compromisso mudou em outro celular.';
const UNCHECKED_QUESTION = [
  'Não deu para conferir',
  'Não deu para conferir se este compromisso mudou em outro celular. Salvar agora grava o que está nesta tela por cima do que estiver lá.',
  'Salvar assim mesmo',
];
const CHANGED_QUESTION = [
  'Este compromisso mudou',
  'Ele foi alterado depois que esta tela abriu (em outro celular, por exemplo). Salvar agora grava por cima dessas mudanças.',
  'Salvar assim mesmo',
];
const DAY_UNREAD = 'Não deu para buscar agora como este dia está.';
const DAYS_NOT_LOADED = 'Não deu para carregar o que muda em cada dia deste compromisso.';
/** A pergunta feita antes de salvar: título, texto e botão. */
const question = (n = 0) => jest.mocked(confirmAction).mock.calls[n].slice(0, 3);
/** A pessoa responde "Salvar assim mesmo" à pergunta. */
const accept = (n = 0) =>
  act(async () => {
    jest.mocked(confirmAction).mock.calls[n][3]();
    await pause(30);
  });
const eventUpdates = () => mockDb.writes.filter((w) => w.table === 'family_events' && w.verb === 'update');

beforeEach(() => {
  // Como no app (lib/queryClient), sem a segunda tentativa, que só faria o teste esperar.
  client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false, gcTime: Infinity }, mutations: { networkMode: 'always', gcTime: Infinity } } });
  mockDb.people = [person('ana', 'Ana'), person('beto', 'Beto'), person('carla', 'Carla'), person('vo', 'Vó Maria')];
  mockDb.events = [swim()];
  mockDb.days = [];
  mockDb.writes = [];
  mockDb.gates = {};
  mockDb.refuse = null;
  jest.mocked(confirmAction).mockReset();
  jest.mocked(notify).mockReset();
  jest.mocked(router.back).mockReset();
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

    changeElsewhere();
    age();

    open();
    // O guardado (16h, a vó leva) não aparece enquanto a busca desta visita não chega.
    expect(loading()).toBe(true);
    expect(field('Começa às')).toBeUndefined();
    await settle();
    expect(field('Começa às')!.props.value).toBe('17:00');
    expect(page()).not.toContain('Este compromisso mudou');

    // A pessoa só acerta o que levar, e salva: o horário e quem leva seguem os de agora, sem pergunta nenhuma.
    act(() => field('O que levar')!.props.onChangeText('touca'));
    await act(async () => {
      button('Salvar')!.props.onPress();
      await pause(30);
    });
    expect(confirmAction).not.toHaveBeenCalled();
    const updates = mockDb.writes.filter((w) => w.table === 'family_events' && w.verb === 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0].values).toMatchObject({ start_time: '17:00', end_time: '18:00', take_by: 'beto', pick_up_by: 'carla', bring: 'touca' });
  });

  it('mesmo guardado há pouco (menos de 30 segundos), a tela busca de novo ao abrir: quem edita parte do que está no banco', async () => {
    open();
    await settle();
    await close();
    // Dez segundos depois, em outro celular, o compromisso mudou. O guardado daqui ainda é "novo".
    changeElsewhere();
    open();
    expect(loading()).toBe(true);
    await settle();
    expect(field('Começa às')!.props.value).toBe('17:00');
  });

  it('com o formulário aberto, outra busca não o tira da frente nem apaga o que foi digitado', async () => {
    open();
    await settle();
    expect(field('O que levar')).toBeDefined();
    act(() => field('O que levar')!.props.onChangeText('touca e toalha'));

    const arrive = hold('family_events');
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
    // O compromisso que chegou é o mesmo: nenhum aviso.
    expect(page()).not.toContain('Este compromisso mudou');
  });

  it('a busca falha com o formulário aberto: ele fica, com o que foi digitado', async () => {
    open();
    await settle();
    act(() => field('O que levar')!.props.onChangeText('touca e toalha'));
    // O banco para de responder (a busca do compromisso dá erro).
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

  it('a busca diz que o compromisso não existe mais: aí o formulário sai', async () => {
    open();
    await settle();
    mockDb.events = [];
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['familyEvents'] });
    });
    await settle();
    expect(field('O que levar')).toBeUndefined();
    expect(page()).toContain('Compromisso não encontrado.');
  });
});

describe('tela do compromisso: a cópia guardada, quando a busca não chega', () => {
  it('sem internet a busca fica parada e o guardado abre; quando o de agora chega e é outro, a tela avisa e oferece atualizar', async () => {
    open();
    await settle();
    await close();
    changeElsewhere();
    age();
    onlineManager.setOnline(false);
    open();
    expect(loading()).toBe(false);
    expect(field('Começa às')!.props.value).toBe('16:00');
    expect(page()).not.toContain('Este compromisso mudou');
    act(() => field('O que levar')!.props.onChangeText('touca'));

    // A internet volta, e a busca traz o compromisso como está agora.
    await act(async () => {
      onlineManager.setOnline(true);
      await pause(30);
    });
    await settle();
    // Os campos não mudam sozinhos (a pessoa pode estar digitando), mas a tela diz.
    expect(field('Começa às')!.props.value).toBe('16:00');
    expect(field('O que levar')!.props.value).toBe('touca');
    expect(page()).toContain('Este compromisso mudou');

    // Salvar assim pergunta antes, e só grava se a pessoa confirmar.
    await act(async () => {
      button('Salvar')!.props.onPress();
      await pause(30);
    });
    expect(mockDb.writes).toEqual([]);
    expect(confirmAction).toHaveBeenCalledTimes(1);
    expect(jest.mocked(confirmAction).mock.calls[0].slice(0, 3)).toEqual([
      'Este compromisso mudou',
      'Ele foi alterado depois que esta tela abriu (em outro celular, por exemplo). Salvar agora grava por cima dessas mudanças.',
      'Salvar assim mesmo',
    ]);

    // "Atualizar" monta o formulário de novo, com o de agora.
    act(() => button('Atualizar')!.props.onPress());
    expect(field('Começa às')!.props.value).toBe('17:00');
    expect(field('O que levar')!.props.value).toBe('');
    expect(page()).not.toContain('Este compromisso mudou');
    expect(chips()).toContain('Beto*');
  });

  it('a internet não responde: a espera tem limite, a cópia abre, e o aviso vem quando o de agora chega', async () => {
    open();
    await settle();
    await close();
    changeElsewhere();
    age();
    const arrive = hold('family_events');
    open();
    expect(loading()).toBe(true);
    // Um segundo depois, ainda espera.
    await settle(1000);
    expect(loading()).toBe(true);
    // Passado o limite, abre com a cópia (16h), em vez de segurar a tela.
    await settle(3300);
    expect(loading()).toBe(false);
    expect(field('Começa às')!.props.value).toBe('16:00');
    expect(page()).not.toContain('Este compromisso mudou');

    arrive();
    await settle();
    expect(field('Começa às')!.props.value).toBe('16:00');
    expect(page()).toContain('Este compromisso mudou');
  }, 15_000);

  it('sem cópia nenhuma, espera o tempo que for (não há o que mostrar)', async () => {
    const arrive = hold('family_events');
    open();
    await settle(4400);
    expect(loading()).toBe(true);
    arrive();
    await settle();
    expect(field('Começa às')!.props.value).toBe('16:00');
  }, 15_000);
});

describe('tela do compromisso: a cópia guardada, enquanto não deu para conferir', () => {
  it('a rede leva 6 segundos em tudo: a cópia abre aos 4 com o aviso e sem botão; salvar pergunta, recusar não grava, aceitar grava', async () => {
    await visitOnce();
    changeElsewhere();
    const arrive = hold('family_events');
    open();
    await settle(4300);
    expect(field('Começa às')!.props.value).toBe('16:00');
    expect(page()).toContain(COPY_TITLE);
    expect(page()).toContain(COPY_TEXT);
    // A busca ainda está a caminho: não há o que tentar de novo.
    expect(button('Tentar de novo')).toBeUndefined();

    act(() => field('O que levar')!.props.onChangeText('touca'));
    await press(button('Salvar'));
    expect(confirmAction).toHaveBeenCalledTimes(1);
    expect(question()).toEqual(UNCHECKED_QUESTION);
    // A pessoa não confirma: nada é enviado.
    expect(client.isMutating()).toBe(0);

    // Toca de novo e, agora, confirma: o pedido sai, e chega com o resto aos 6 segundos.
    await press(button('Salvar'));
    expect(confirmAction).toHaveBeenCalledTimes(2);
    await accept(1);
    expect(client.isMutating()).toBe(1);
    expect(mockDb.writes).toEqual([]);
    await settle(1500);
    arrive();
    await settle();
    expect(eventUpdates()).toHaveLength(1);
    expect(eventUpdates()[0].values).toMatchObject({ start_time: '16:00', end_time: '17:00', take_by: 'vo', bring: 'touca' });
    expect(router.back).toHaveBeenCalledTimes(1);
  }, 15_000);

  it('a busca do compromisso não responde: passado o limite outra vez, o aviso ganha o "Tentar de novo", que pede de novo', async () => {
    await visitOnce();
    // Este pedido nunca vai ter resposta.
    hold('family_events');
    open();
    await settle(4300);
    expect(page()).toContain(COPY_TITLE);
    expect(button('Tentar de novo')).toBeUndefined();
    // Mais quatro segundos sem resposta: a busca conta como a que não veio, e agora há o que tentar.
    await settle(4200);
    expect(page()).toContain(COPY_TITLE);
    expect(button('Tentar de novo')).toBeDefined();

    // A rede volta a responder aos pedidos novos; o de antes segue sem resposta.
    mockDb.gates = {};
    await press(button('Tentar de novo'));
    await until(() => !page().includes(COPY_TITLE));
    expect(page()).not.toContain(COPY_TITLE);
    await press(button('Salvar'));
    expect(confirmAction).not.toHaveBeenCalled();
  }, 20_000);

  it('a busca falha logo ao abrir, com cópia guardada: em vez do erro, abre a cópia com o aviso, e salvar pergunta', async () => {
    await visitOnce();
    changeElsewhere();
    // A rede cai: a busca desta visita dá erro antes do limite da espera.
    const failing = failReads(mockDb.events);
    open();
    await settle();
    expect(field('Começa às')!.props.value).toBe('16:00');
    expect(page()).toContain(COPY_TITLE);
    expect(button('Tentar de novo')).toBeDefined();
    await press(button('Salvar'));
    expect(confirmAction).toHaveBeenCalledTimes(1);
    expect(question()).toEqual(UNCHECKED_QUESTION);
    expect(eventUpdates()).toEqual([]);

    // A rede volta: a busca traz o compromisso que mudou em outro celular, e quem fala é o aviso de que mudou.
    failing.mockRestore();
    await press(button('Tentar de novo'));
    await until(() => page().includes('Este compromisso mudou'));
    expect(page()).toContain('Este compromisso mudou');
    expect(page()).not.toContain(COPY_TITLE);
  });

  it('a busca falha logo ao abrir, sem cópia guardada: aí é o erro, com como tentar de novo', async () => {
    const failing = failReads(mockDb.events);
    open();
    await settle();
    expect(field('Começa às')).toBeUndefined();
    expect(page()).not.toContain(COPY_TITLE);
    expect(button('Tentar novamente') ?? button('Tentar de novo')).toBeDefined();
    failing.mockRestore();
  });

  it('a busca falha: o aviso ganha o "Tentar de novo", e a busca que dá certo tira o aviso', async () => {
    await visitOnce();
    onlineManager.setOnline(false);
    open();
    // Sem internet a busca fica parada: a cópia abre com o aviso, e dá para tentar de novo.
    expect(page()).toContain(COPY_TITLE);
    expect(button('Tentar de novo')).toBeDefined();

    // A internet volta e a busca segue, devagar: enquanto ela está a caminho, o aviso fica sem botão.
    const arrive = hold('family_events');
    await online();
    expect(client.isFetching({ queryKey: ['familyEvents', 'natacao'] })).toBe(1);
    expect(page()).toContain(COPY_TITLE);
    expect(button('Tentar de novo')).toBeUndefined();

    // Ela falha: o formulário fica, com o aviso e o botão.
    const failing = failReads(mockDb.events);
    arrive();
    await settle();
    expect(field('Começa às')!.props.value).toBe('16:00');
    expect(page()).toContain(COPY_TITLE);
    expect(button('Tentar de novo')).toBeDefined();

    failing.mockRestore();
    await press(button('Tentar de novo'));
    await settle();
    // O compromisso que chegou é o mesmo dos campos: o aviso sai calado.
    expect(page()).not.toContain(COPY_TITLE);
    expect(page()).not.toContain('Este compromisso mudou');
    // Conferido: salvar não pergunta.
    await press(button('Salvar'));
    expect(confirmAction).not.toHaveBeenCalled();
    expect(eventUpdates()).toHaveLength(1);
  });

  it('a busca chega com outro compromisso: "Este compromisso mudou" toma o lugar do aviso, e a resposta já dada vale (não pergunta de novo)', async () => {
    await visitOnce();
    changeElsewhere();
    onlineManager.setOnline(false);
    open();
    act(() => field('O que levar')!.props.onChangeText('touca'));
    const arrive = hold('family_events');
    await online();
    // A pessoa toca em Salvar com a busca ainda a caminho: a pergunta é a de quem não conferiu.
    await press(button('Salvar'));
    expect(confirmAction).toHaveBeenCalledTimes(1);
    expect(question()).toEqual(UNCHECKED_QUESTION);

    // Com a pergunta aberta, a busca chega, e o compromisso é outro: um aviso só, o de que mudou.
    arrive();
    await settle();
    expect(page()).toContain('Este compromisso mudou');
    expect(page()).not.toContain(COPY_TITLE);
    expect(mockDb.writes).toEqual([]);

    // A resposta vale para a pergunta que a pessoa leu: grava o que está na tela, sem outra pergunta.
    await accept();
    expect(confirmAction).toHaveBeenCalledTimes(1);
    expect(eventUpdates()).toHaveLength(1);
    expect(eventUpdates()[0].values).toMatchObject({ start_time: '16:00', take_by: 'vo', bring: 'touca' });
  });

  it('depois que a busca chegou com outro compromisso, a pergunta de salvar é a de que ele mudou', async () => {
    await visitOnce();
    changeElsewhere();
    onlineManager.setOnline(false);
    open();
    await online();
    await settle();
    expect(page()).toContain('Este compromisso mudou');
    await press(button('Salvar'));
    expect(confirmAction).toHaveBeenCalledTimes(1);
    expect(question()).toEqual(CHANGED_QUESTION);
  });

  it('a escolha de um dia não grava enquanto o compromisso não foi conferido; o "Tentar de novo" do dia busca também o compromisso', async () => {
    await visitOnce({ id: 'natacao', dia: '2099-01-01' });
    onlineManager.setOnline(false);
    open({ id: 'natacao', dia: '2099-01-01' });
    // Sem internet as duas buscas ficam paradas: a linha do dia diz.
    expect(page()).toContain(DAY_UNREAD);

    // A internet volta: as mudanças de cada dia chegam, o compromisso segue a caminho.
    const arrive = hold('family_events');
    await online();
    expect(client.isFetching({ queryKey: ['familyEventDays'] })).toBe(0);
    expect(client.isFetching({ queryKey: ['familyEvents', 'natacao'] })).toBe(1);
    expect(page()).toContain(COPY_TITLE);
    // Nada parado: a linha do dia some, e as escolhas esperam sem aceitar toque.
    expect(page()).not.toContain(DAY_UNREAD);
    await press(dayChip('Beto'));
    expect(mockDb.writes).toEqual([]);

    // A busca do compromisso falha: a linha do dia volta, e o toque segue sem gravar.
    const failing = failReads(mockDb.events);
    arrive();
    await settle();
    expect(page()).toContain(DAY_UNREAD);
    await press(dayChip('Beto'));
    expect(mockDb.writes).toEqual([]);

    // O "Tentar de novo" do cartão do dia (o segundo; o primeiro é o do aviso) busca o compromisso.
    failing.mockRestore();
    expect(buttons('Tentar de novo')).toHaveLength(2);
    await press(buttons('Tentar de novo')[1]);
    await settle();
    expect(page()).not.toContain(COPY_TITLE);
    expect(page()).not.toContain(DAY_UNREAD);
    await press(dayChip('Beto'));
    expect(mockDb.writes.map((w) => `${w.table}:${w.verb}`)).toEqual(['family_event_days:upsert']);
  });

  it('abertura normal (a busca responde antes do limite): o aviso não aparece e salvar não pergunta', async () => {
    // Primeira visita, sem cópia nenhuma.
    open();
    await settle();
    expect(field('Começa às')!.props.value).toBe('16:00');
    expect(page()).not.toContain(COPY_TITLE);
    await close();
    age();

    // Com cópia guardada, e a busca respondendo em um segundo.
    const arrive = hold('family_events');
    open();
    await settle(1000);
    expect(loading()).toBe(true);
    arrive();
    await settle();
    expect(field('Começa às')!.props.value).toBe('16:00');
    expect(page()).not.toContain(COPY_TITLE);
    act(() => field('O que levar')!.props.onChangeText('touca'));
    await press(button('Salvar'));
    expect(confirmAction).not.toHaveBeenCalled();
    expect(eventUpdates()).toHaveLength(1);
  });

  it('compromisso novo: não há o que conferir, o aviso não aparece e salvar não pergunta', async () => {
    open({ id: 'novo' });
    await settle();
    expect(page()).not.toContain(COPY_TITLE);
    act(() => field('Compromisso')!.props.onChangeText('Reunião da escola'));
    await press(button('Salvar'));
    expect(confirmAction).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(mockDb.writes.map((w) => `${w.table}:${w.verb}`)).toEqual(['family_events:insert']);
  });
});

describe('tela do compromisso: o aviso de que mudou não vem do próprio salvar', () => {
  it('o salvar falha pela metade (o compromisso gravou, a limpeza dos dias não): sem aviso, e salvar de novo não pergunta', async () => {
    open();
    await settle();
    act(() => field('Começa às')!.props.onChangeText('18:00'));
    act(() => field('Termina às')!.props.onChangeText('19:00'));
    // A leitura das mudanças de cada dia, que vem depois de gravar o compromisso, falha.
    const failing = failReads(mockDb.days);
    await press(button('Salvar'));
    await settle();
    expect(notify).toHaveBeenCalledWith('Erro', 'TypeError: Network request failed');
    expect(router.back).not.toHaveBeenCalled();
    // A busca de depois do salvar traz o compromisso como esta tela o mandou: ele não mudou "em outro celular".
    expect(client.getQueryData<Row>(['familyEvents', 'natacao'])).toMatchObject({ start_time: '18:00', end_time: '19:00' });
    expect(page()).not.toContain('Este compromisso mudou');
    expect(field('Começa às')!.props.value).toBe('18:00');

    // Salvar de novo termina o serviço, sem pergunta.
    failing.mockRestore();
    await press(button('Salvar'));
    expect(confirmAction).not.toHaveBeenCalled();
    expect(eventUpdates()).toHaveLength(2);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('salvou e a tela continuou aberta (uma aba sem para onde voltar): a mudança feita depois em outro celular avisa, e salvar pergunta', async () => {
    open();
    await settle();
    act(() => field('O que levar')!.props.onChangeText('touca'));
    await press(button('Salvar'));
    await settle();
    // O `router.back` daqui não leva a lugar nenhum: o formulário segue na tela, sem aviso.
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(field('O que levar')!.props.value).toBe('touca');
    expect(page()).not.toContain('Este compromisso mudou');

    changeElsewhere();
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['familyEvents'] });
    });
    await settle();
    expect(page()).toContain('Este compromisso mudou');
    await press(button('Salvar'));
    expect(confirmAction).toHaveBeenCalledTimes(1);
    expect(question()).toEqual(CHANGED_QUESTION);
    expect(eventUpdates()).toHaveLength(1);
  });

  it('salvou, a tela continuou aberta, e outro celular pôs o compromisso de volta como estava ao abrir: é mudança de lá, a tela avisa e salvar pergunta', async () => {
    open();
    await settle();
    act(() => field('O que levar')!.props.onChangeText('touca'));
    await press(button('Salvar'));
    await settle();
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(client.getQueryData<Row>(['familyEvents', 'natacao'])).toMatchObject({ bring: 'touca' });
    expect(page()).not.toContain('Este compromisso mudou');

    // No outro celular alguém desfaz: o compromisso volta a ser exatamente o que esta tela tinha ao abrir.
    Object.assign(mockDb.events[0], { bring: null });
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['familyEvents'] });
    });
    await settle();
    expect(page()).toContain('Este compromisso mudou');
    await press(button('Salvar'));
    expect(confirmAction).toHaveBeenCalledTimes(1);
    expect(question()).toEqual(CHANGED_QUESTION);
    // Só o primeiro salvar foi enviado: o segundo espera a resposta.
    expect(eventUpdates()).toHaveLength(1);
  });

  it('com o salvar a caminho, o compromisso que chega com o que esta tela mandou não acende o aviso', async () => {
    open();
    await settle();
    act(() => field('O que levar')!.props.onChangeText('touca'));
    // O compromisso grava logo; a limpeza dos dias (a leitura deles) fica a caminho.
    const arrive = hold('family_event_days');
    await press(button('Salvar'));
    expect(eventUpdates()).toHaveLength(1);
    expect(client.isMutating()).toBe(1);
    // Uma busca do compromisso chega no meio (a de voltar ao app): traz o "touca" que saiu daqui.
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['familyEvents', 'natacao'] });
    });
    expect(client.getQueryData<Row>(['familyEvents', 'natacao'])).toMatchObject({ bring: 'touca' });
    expect(client.isMutating()).toBe(1);
    expect(page()).not.toContain('Este compromisso mudou');

    arrive();
    await settle();
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('segundo salvar na mesma tela: enquanto ele está a caminho, o que o primeiro gravou não acende o aviso', async () => {
    open();
    await settle();
    act(() => field('O que levar')!.props.onChangeText('touca'));
    await press(button('Salvar'));
    await settle();
    act(() => field('O que levar')!.props.onChangeText('touca e toalha'));
    const arrive = hold('family_events');
    await press(button('Salvar'));
    expect(confirmAction).not.toHaveBeenCalled();
    // O compromisso guardado ainda é o do primeiro salvar ("touca"), que também saiu daqui.
    expect(client.isMutating()).toBe(1);
    expect(page()).not.toContain('Este compromisso mudou');

    arrive();
    await settle();
    expect(eventUpdates().map((w) => w.values!.bring)).toEqual(['touca', 'touca e toalha']);
    expect(page()).not.toContain('Este compromisso mudou');
  });
});

describe('tela do compromisso: sem internet e sem cópia guardada', () => {
  it('em vez de girar sem fim, a tela diz e oferece tentar de novo; quando a internet volta, o formulário abre sozinho', async () => {
    onlineManager.setOnline(false);
    open();
    await settle();
    expect(loading()).toBe(false);
    expect(page()).toContain('Sem internet: não deu para abrir este compromisso.');
    expect(field('Começa às')).toBeUndefined();
    // Tentar ainda sem internet deixa tudo como está (a busca segue parada).
    await press(button('Tentar de novo'));
    expect(page()).toContain('Sem internet: não deu para abrir este compromisso.');

    await online();
    await settle();
    expect(page()).not.toContain('Sem internet');
    expect(field('Começa às')!.props.value).toBe('16:00');
    // O formulário veio de uma busca desta visita: nada de aviso de cópia.
    expect(page()).not.toContain(COPY_TITLE);
  });
});

describe('tela do compromisso: o que muda só num dia', () => {
  it('o dia de quem ia levar e teve a ficha apagada, num compromisso sem quem leve sempre: aparece como "Ninguém", e salvar o compromisso não apaga a marca', async () => {
    // Não há quem leve sempre; em 01/01/2099 (quinta) alguém ia levar, e a ficha foi apagada: a mudança ficou marcada, sem pessoa.
    Object.assign(mockDb.events[0], { take_by: null });
    mockDb.days = [dayRow({ occurs_on: '2099-01-01', override_take: true })];
    open({ id: 'natacao', dia: '2099-01-01' });
    await settle();
    // "Quem leva": "Ninguém" marcado (e não "Como sempre: ninguém"); "Quem busca": como sempre.
    const marked = dayChips().map((item) => `${item.props.label}${item.props.selected ? '*' : ''}`);
    expect(marked.filter((label) => label.startsWith('Como sempre') || label.startsWith('Ninguém'))).toEqual(['Como sempre: ninguém', 'Ninguém*', 'Como sempre: Carla*', 'Ninguém']);

    // Salvar o compromisso (mudando só o que levar) deixa a mudança do dia onde está.
    act(() => field('O que levar')!.props.onChangeText('touca'));
    await act(async () => {
      button('Salvar')!.props.onPress();
      await pause(30);
    });
    expect(mockDb.writes.map((w) => `${w.table}:${w.verb}`)).toEqual(['family_events:update']);
    expect(mockDb.days).toHaveLength(1);
  });

  it('sem um dia escolhido, esse dia aparece em "Dias com mudança" como "Ninguém leva", e "Como sempre" o desfaz', async () => {
    Object.assign(mockDb.events[0], { take_by: null });
    mockDb.days = [dayRow({ occurs_on: '2099-01-01', override_take: true })];
    open();
    await settle();
    const rows = renderer!.root.findAllByType(ListRow).map((row) => row.props.subtitle);
    expect(rows).toEqual(['Ninguém leva']);

    act(() => renderer!.root.findAllByType(ListRow)[0].props.onPress());
    await act(async () => {
      chip('Como sempre: ninguém').props.onPress();
      await pause(30);
    });
    expect(mockDb.writes.map((w) => `${w.table}:${w.verb}`)).toEqual(['family_event_days:delete']);
    expect(mockDb.days).toEqual([]);
  });

  it('as escolhas do dia esperam a busca desta visita, mesmo com o guardado ainda novo: o toque não grava por cima do que mudou em outro celular', async () => {
    open({ id: 'natacao', dia: '2099-01-01' });
    await settle();
    await close();
    // Dez segundos depois, em outro celular: nesse dia é o Beto quem busca. O guardado daqui ainda é "novo".
    mockDb.days = [dayRow({ occurs_on: '2099-01-01', override_pick_up: true, pick_up_by: 'beto' })];
    const arrive = hold('family_event_days');
    open({ id: 'natacao', dia: '2099-01-01' });
    await settle();
    // O que está na tela ainda é de antes (como sempre nos dois): o toque não é aceito.
    await act(async () => {
      dayChips()
        .find((item) => item.props.label === 'Beto')!
        .props.onPress();
      await pause(30);
    });
    expect(mockDb.writes).toEqual([]);

    arrive();
    await settle();
    // Com a busca de volta, a mudança do outro celular aparece, e o toque grava as duas.
    const pickUp = dayChips().filter((item) => item.props.label === 'Beto');
    expect(pickUp.map((item) => item.props.selected)).toEqual([false, true]);
    await act(async () => {
      pickUp[0].props.onPress();
      await pause(30);
    });
    expect(mockDb.writes).toEqual([
      {
        table: 'family_event_days',
        verb: 'upsert',
        values: { event_id: 'natacao', occurs_on: '2099-01-01', cancelled: false, override_take: true, take_by: 'beto', override_pick_up: true, pick_up_by: 'beto' },
      },
    ]);
  });
  it('a busca das mudanças do dia falha: as escolhas não aceitam toque, a tela diz, e "Tentar de novo" resolve', async () => {
    // Já aberto antes: as mudanças de cada dia estão guardadas. Na visita seguinte, a busca delas falha.
    open({ id: 'natacao', dia: '2099-01-01' });
    await settle();
    await close();
    const failing = jest.spyOn(mockDb.days, 'filter').mockImplementation(() => {
      throw new Error('TypeError: Network request failed');
    });
    open({ id: 'natacao', dia: '2099-01-01' });
    await settle();
    expect(page()).toContain('Não deu para buscar agora como este dia está.');
    await act(async () => {
      dayChips()
        .find((item) => item.props.label === 'Beto')!
        .props.onPress();
      await pause(30);
    });
    expect(mockDb.writes).toEqual([]);

    failing.mockRestore();
    await act(async () => {
      button('Tentar de novo')!.props.onPress();
      await pause(30);
    });
    await settle();
    expect(page()).not.toContain('Não deu para buscar agora como este dia está.');
    await act(async () => {
      dayChips()
        .find((item) => item.props.label === 'Beto')!
        .props.onPress();
      await pause(30);
    });
    expect(mockDb.writes.map((w) => `${w.table}:${w.verb}`)).toEqual(['family_event_days:upsert']);
  });

  it('sem nada guardado, a busca das mudanças do dia falha: a frase vem com "Tentar de novo", e a busca que dá certo mostra o "Só neste dia"', async () => {
    const arrive = hold('family_event_days');
    open({ id: 'natacao', dia: '2099-01-01' });
    await settle();
    // Com a busca a caminho (e dentro do limite), o formulário está na tela e ainda não há o que dizer do dia.
    expect(field('Começa às')!.props.value).toBe('16:00');
    expect(page()).not.toContain(DAYS_NOT_LOADED);
    expect(button('Tentar de novo')).toBeUndefined();

    const failing = failReads(mockDb.days);
    arrive();
    await settle();
    expect(page()).toContain(DAYS_NOT_LOADED);
    expect(page()).not.toContain('Só neste dia');

    failing.mockRestore();
    await press(button('Tentar de novo'));
    await settle();
    expect(page()).not.toContain(DAYS_NOT_LOADED);
    expect(page()).toContain('Só neste dia');
    await press(dayChip('Beto'));
    expect(mockDb.writes.map((w) => `${w.table}:${w.verb}`)).toEqual(['family_event_days:upsert']);
  });

  it('a busca das mudanças do dia não responde: passado o limite a tela diz, as escolhas seguem sem aceitar toque, e "Tentar de novo" pede de novo', async () => {
    await visitOnce({ id: 'natacao', dia: '2099-01-01' });
    // Este pedido nunca vai ter resposta.
    hold('family_event_days');
    open({ id: 'natacao', dia: '2099-01-01' });
    await settle(1000);
    // O formulário já abriu (o compromisso chegou); do dia, por enquanto, só as escolhas apagadas.
    expect(field('Começa às')!.props.value).toBe('16:00');
    expect(page()).not.toContain(DAY_UNREAD);
    await settle(3300);
    expect(page()).toContain(DAY_UNREAD);
    await press(dayChip('Beto'));
    expect(mockDb.writes).toEqual([]);

    // A rede volta a responder aos pedidos novos; o de antes segue sem resposta.
    mockDb.gates = {};
    await press(button('Tentar de novo'));
    await settle();
    expect(page()).not.toContain(DAY_UNREAD);
    await press(dayChip('Beto'));
    expect(mockDb.writes.map((w) => `${w.table}:${w.verb}`)).toEqual(['family_event_days:upsert']);
  }, 15_000);

  it('sem nada guardado e sem resposta: passado o limite, a frase com "Tentar de novo", que pede de novo', async () => {
    hold('family_event_days');
    open({ id: 'natacao', dia: '2099-01-01' });
    await settle(1000);
    expect(field('Começa às')!.props.value).toBe('16:00');
    expect(page()).not.toContain(DAYS_NOT_LOADED);
    await settle(3300);
    expect(page()).toContain(DAYS_NOT_LOADED);
    expect(page()).not.toContain('Só neste dia');

    mockDb.gates = {};
    await press(button('Tentar de novo'));
    await settle();
    expect(page()).not.toContain(DAYS_NOT_LOADED);
    expect(page()).toContain('Só neste dia');
  }, 15_000);

  it('a ficha de quem foi escolhido para o dia foi apagada em outro celular: o toque avisa com a frase do dia, e a pessoa sai das escolhas', async () => {
    open({ id: 'natacao', dia: '2099-01-01' });
    await until(() => dayChips().length > 0);
    expect(dayChips().map((item) => item.props.label)).toContain('Beto');
    // Em outro celular a ficha do Beto foi apagada; esta tela ainda o oferece, e o banco recusa a chave.
    mockDb.people = mockDb.people.filter((p) => p.id !== 'beto');
    mockDb.refuse = (table, verb) =>
      table === 'family_event_days' && verb === 'upsert'
        ? {
            code: '23503',
            message: 'insert or update on table "family_event_days" violates foreign key constraint "family_event_days_take_by_household_id_fkey"',
            details: 'Key is not present in table "people".',
          }
        : undefined;
    await press(dayChip('Beto'));
    await until(() => jest.mocked(notify).mock.calls.length > 0);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('Erro', 'Essa pessoa não está mais nas fichas da casa. Escolha outra para este dia.');
    expect(mockDb.writes).toEqual([]);
    // As fichas foram buscadas de novo: o Beto não está mais entre as escolhas (nem do dia, nem do formulário).
    await until(() => !chips().some((label) => label.startsWith('Beto')));
    expect(chips().some((label) => label.startsWith('Beto'))).toBe(false);

    // Outra pessoa para o dia grava normalmente.
    mockDb.refuse = null;
    await press(dayChip('Carla'));
    expect(mockDb.writes).toEqual([
      {
        table: 'family_event_days',
        verb: 'upsert',
        values: { event_id: 'natacao', occurs_on: '2099-01-01', cancelled: false, override_take: true, take_by: 'carla', override_pick_up: false, pick_up_by: null },
      },
    ]);
  });

  it('o compromisso foi excluído em outro celular: o toque no dia segue dizendo isso', async () => {
    open({ id: 'natacao', dia: '2099-01-01' });
    await until(() => dayChips().length > 0);
    mockDb.refuse = () => ({
      code: '23503',
      message: 'insert or update on table "family_event_days" violates foreign key constraint "family_event_days_event_id_household_id_fkey"',
      details: 'Key is not present in table "family_events".',
    });
    await press(dayChip('Beto'));
    await until(() => jest.mocked(notify).mock.calls.length > 0);
    expect(notify).toHaveBeenCalledWith('Erro', 'Este compromisso não existe mais: foi excluído. Volte para a agenda.');
  });
});

describe('tela do compromisso: salvar', () => {
  it('o compromisso foi excluído em outro celular com o formulário aberto: salvar avisa, e a tela não fecha como se tivesse gravado', async () => {
    open();
    await settle();
    act(() => field('O que levar')!.props.onChangeText('touca'));
    // Excluído no outro celular; nenhuma busca daqui soube ainda.
    mockDb.events = [];
    await act(async () => {
      button('Salvar')!.props.onPress();
      await pause(30);
    });
    expect(notify).toHaveBeenCalledWith('Erro', 'Este compromisso não existe mais: foi excluído. Volte para a agenda.');
    expect(router.back).not.toHaveBeenCalled();
  });

  it('salvou: a tela fecha', async () => {
    open();
    await settle();
    act(() => field('O que levar')!.props.onChangeText('touca'));
    await act(async () => {
      button('Salvar')!.props.onPress();
      await pause(30);
    });
    expect(notify).not.toHaveBeenCalled();
    expect(router.back).toHaveBeenCalledTimes(1);
  });
});

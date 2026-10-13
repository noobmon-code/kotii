import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import FamilyEventScreen from '@/app/compromisso/[id]';
import { router } from 'expo-router';

import { confirmAction, notify } from '@/ui/dialogs';
import { Button, Chip, ListRow, Loading, TextField } from '@/ui/primitives';

// A tela de verdade, com as consultas de verdade de src/data/family.ts e um
// QueryClient com os padrões do app. Só a rede é trocada: um "banco" em
// memória atrás do cliente do Supabase.

type Row = Record<string, unknown>;
type Table = 'family_events' | 'family_event_days';
// `gates`: enquanto houver uma promessa numa tabela, os pedidos a ela esperam (a rede lenta).
const mockDb: {
  people: Row[];
  events: Row[];
  days: Row[];
  writes: { table: string; verb: 'update' | 'upsert' | 'delete'; values?: Row }[];
  gates: Partial<Record<Table, Promise<void>>>;
} = { people: [], events: [], days: [], writes: [], gates: {} };
const mockRoute: { params: Record<string, string> } = { params: { id: 'natacao' } };

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockRoute.params,
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
    let write: { verb: 'update' | 'upsert' | 'delete'; values?: Row } | null = null;
    const rowsOf = () => (name === 'family_events' ? mockDb.events : name === 'family_event_days' ? mockDb.days : []);
    const matches = (row: Row) => filters.every(([column, value]) => row[column] === value);
    const run = () => {
      if (!write) return { data: rowsOf().filter(matches).map((row) => ({ ...row })), error: null };
      mockDb.writes.push({ table: name, ...write });
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

const settle = (ms = 30) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
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
const button = (title: string) => renderer!.root.findAllByType(Button).find((item) => String(item.props.title).startsWith(title));
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

beforeEach(() => {
  // Como no app (lib/queryClient), sem a segunda tentativa, que só faria o teste esperar.
  client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false, gcTime: Infinity }, mutations: { networkMode: 'always', gcTime: Infinity } } });
  mockDb.people = [person('ana', 'Ana'), person('beto', 'Beto'), person('carla', 'Carla'), person('vo', 'Vó Maria')];
  mockDb.events = [swim()];
  mockDb.days = [];
  mockDb.writes = [];
  mockDb.gates = {};
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
      await new Promise((resolve) => setTimeout(resolve, 30));
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
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    await settle();
    // Os campos não mudam sozinhos (a pessoa pode estar digitando), mas a tela diz.
    expect(field('Começa às')!.props.value).toBe('16:00');
    expect(field('O que levar')!.props.value).toBe('touca');
    expect(page()).toContain('Este compromisso mudou');

    // Salvar assim pergunta antes, e só grava se a pessoa confirmar.
    await act(async () => {
      button('Salvar')!.props.onPress();
      await new Promise((resolve) => setTimeout(resolve, 30));
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
      await new Promise((resolve) => setTimeout(resolve, 30));
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
      await new Promise((resolve) => setTimeout(resolve, 30));
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
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(mockDb.writes).toEqual([]);

    arrive();
    await settle();
    // Com a busca de volta, a mudança do outro celular aparece, e o toque grava as duas.
    const pickUp = dayChips().filter((item) => item.props.label === 'Beto');
    expect(pickUp.map((item) => item.props.selected)).toEqual([false, true]);
    await act(async () => {
      pickUp[0].props.onPress();
      await new Promise((resolve) => setTimeout(resolve, 30));
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
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(mockDb.writes).toEqual([]);

    failing.mockRestore();
    await act(async () => {
      button('Tentar de novo')!.props.onPress();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    await settle();
    expect(page()).not.toContain('Não deu para buscar agora como este dia está.');
    await act(async () => {
      dayChips()
        .find((item) => item.props.label === 'Beto')!
        .props.onPress();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(mockDb.writes.map((w) => `${w.table}:${w.verb}`)).toEqual(['family_event_days:upsert']);
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
      await new Promise((resolve) => setTimeout(resolve, 30));
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
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(notify).not.toHaveBeenCalled();
    expect(router.back).toHaveBeenCalledTimes(1);
  });
});

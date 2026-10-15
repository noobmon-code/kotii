import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer, type ReactTestRendererJSON } from 'react-test-renderer';

import MedicationScreen from '@/app/remedio/[id]';
import { router } from 'expo-router';

import { MEDICATION_STOCK_CHANGED } from '@/data/home';
import { addDays, todayISO } from '@/domain/dates';
import { notify } from '@/ui/dialogs';
import { Button, Chip, ErrorNotice, TextField } from '@/ui/primitives';

// A tela do remédio de verdade, com as buscas e gravações de verdade de src/data/home.ts e o cliente do
// Supabase de verdade: só a rede é trocada por um "banco" em memória, que aplica as condições da URL como o
// PostgREST (sem linha que as cumpra, nada é gravado). "mock" no nome: o jest.mock só enxerga variáveis assim.
type Row = Record<string, unknown>;
const mockNet: {
  medications: Row[];
  requests: { method: string; path: string; params: Record<string, string>; body?: Row }[];
  /** Enquanto houver uma promessa aqui, as gravações esperam (a rede lenta). */
  gate: Promise<void> | null;
  /** As leituras falham (sem sinal na farmácia). */
  failReads: boolean;
} = { medications: [], requests: [], gate: null, failReads: false };

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'm1' }),
}));
jest.mock('@/ui/dialogs', () => ({ askYesNo: jest.fn(), confirmAction: jest.fn(), notify: jest.fn() }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/ui/art', () => ({ Mascot: () => null, Spot: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@/lib/medicationBox', () => ({ lastBoxUnits: async () => null, rememberBoxUnits: async () => undefined, forgetBoxUnits: async () => undefined }));
jest.mock('@/lib/reminders', () => ({
  askReminderPermission: async () => true,
  disableReminders: async () => undefined,
  enableReminders: async () => true,
  hasReminders: async () => false,
  PERMISSION_HINT: 'Permita as notificações.',
  REMINDER_PLACE: 'neste celular',
  remindByDefault: () => false,
  remindersSupported: false,
  remindersUnavailableReason: () => 'Sem notificações aqui.',
}));
jest.mock('@/features/useReminderSync', () => ({ useHouseReminderTarget: () => null }));
jest.mock('@/data/health', () => {
  const { useQuery } = jest.requireActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  const ana = { id: 'ana', name: 'Ana', kind: 'pessoa', member_user_id: null };
  return { usePeople: () => useQuery({ queryKey: ['people'], queryFn: async () => [ana] }) };
});
jest.mock('@/lib/supabase', () => {
  const { createClient } = jest.requireActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  // As condições da URL ("id=eq.m1", "stock_count=eq.10", "stock_counted_on=is.null"), como o PostgREST as aplica.
  const matches = (row: Row, params: Record<string, string>) =>
    Object.entries(params).every(([column, filter]) => {
      if (filter === 'is.null') return row[column] == null;
      if (filter.startsWith('eq.')) return String(row[column]) === filter.slice(3);
      return true;
    });
  const supabase = createClient('http://localhost:54321', 'anon', {
    auth: { persistSession: false, autoRefreshToken: false },
    // Sem as novas tentativas do próprio cliente (1 s, 2 s, 4 s): a leitura que falha falha logo.
    db: { retry: false },
    global: {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const method = init?.method ?? 'GET';
        const params = Object.fromEntries(url.searchParams.entries());
        const body = init?.body ? (JSON.parse(String(init.body)) as Row) : undefined;
        mockNet.requests.push({ method, path: url.pathname, params, body });
        if (method === 'GET' && mockNet.failReads) throw new TypeError('Network request failed');
        if (method !== 'GET') await mockNet.gate;
        if (url.pathname !== '/rest/v1/medications') return json([]);
        const hit = mockNet.medications.filter((m) => matches(m, params));
        if (method === 'PATCH') hit.forEach((m) => Object.assign(m, body));
        if (method !== 'GET' && !params.select) return new Response(null, { status: 204 });
        const rows = hit.map((m) => ({ ...m, medication_doses: [{ count: 0 }] }));
        if ((new Headers(init?.headers).get('Accept') ?? '').includes('vnd.pgrst.object')) {
          if (rows.length === 1) return json(rows[0]);
          return json({ code: 'PGRST116', details: `The result contains ${rows.length} rows`, hint: null, message: 'Cannot coerce the result to a single JSON object' }, 406);
        }
        return json(rows);
      },
    },
  });
  return {
    supabase,
    errorMessage: (error: { message?: string }) => error?.message ?? 'Algo deu errado. Tente novamente.',
    unwrap: (result: { data: unknown; error: unknown }) => {
      if (result.error) throw result.error;
      return result.data;
    },
  };
});

const today = todayISO();
/** Losartana da Ana, uma vez por dia; 10 contados hoje. */
const losartana = (patch: Row = {}): Row => ({
  id: 'm1',
  person_id: 'ana',
  person_name: 'Ana',
  name: 'Losartana',
  dosage: null,
  times: ['08:00'],
  start_on: '2026-01-01',
  end_on: null,
  notes: null,
  active: true,
  frequency: 'daily',
  weekdays: null,
  interval_days: null,
  total_doses: null,
  stock_count: 10,
  stock_counted_on: today,
  dose_units: 1,
  stock_warn_days: 7,
  prescription_until: null,
  ...patch,
});

let renderer: ReactTestRenderer | undefined;

function texts(node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null): string[] {
  if (node == null) return [];
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(texts);
  return (node.children ?? []).flatMap(texts);
}
const page = () => texts(renderer!.toJSON());
const field = (label: string) => renderer!.root.findAllByType(TextField).find((input) => input.props.label === label);
const button = (title: string) => renderer!.root.findAllByType(Button).find((item) => item.props.title === title);
const chip = (label: string) => renderer!.root.findAllByType(Chip).find((item) => item.props.label === label)!;
/** O botão aceita o toque (o Button desativa o Pressable enquanto carrega ou quando está desativado). */
const canPress = (title: string) => {
  const host = button(title)!.findAll((node) => node.props.accessibilityState !== undefined)[0];
  return !host.props.accessibilityState.disabled;
};
const writes = () => mockNet.requests.filter((r) => r.method === 'PATCH');
const reads = () => mockNet.requests.filter((r) => r.method === 'GET' && r.path === '/rest/v1/medications').length;

/** Espera em passos curtos, em vez de um tempo fixo: com a máquina ocupada, a tela pode demorar um pouco mais. */
async function until(ready: () => boolean, capMs = 3000) {
  for (let waited = 0; waited < capMs && !ready(); waited += 10) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

/** A rede lenta: as gravações esperam até `open()`. */
function slowWrites() {
  let open = () => undefined as void;
  mockNet.gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  return () => {
    mockNet.gate = null;
    open();
  };
}

async function openScreen() {
  // gcTime infinito: sem ele, o cache deixa um timer de 5 minutos e o Jest não termina.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  act(() => {
    renderer = create(
      <QueryClientProvider client={client}>
        <MedicationScreen />
      </QueryClientProvider>,
    );
  });
  await until(() => Boolean(button('Salvar')));
  expect(button('Salvar')).toBeDefined();
}

async function openBox(units: string) {
  await act(async () => button('Comprei mais')!.props.onPress());
  await until(() => Boolean(field('Quantas unidades vieram')));
  act(() => field('Quantas unidades vieram')!.props.onChangeText(units));
}

beforeEach(() => {
  mockNet.medications = [losartana()];
  mockNet.requests = [];
  mockNet.gate = null;
  mockNet.failReads = false;
  jest.mocked(notify).mockClear();
  jest.mocked(router.back).mockClear();
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

describe('"Salvar" e "Comprei mais" nunca ao mesmo tempo', () => {
  it('com a compra a caminho, "Salvar" não aceita o toque; gravada a compra, salvar não grava o estoque de novo', async () => {
    await openScreen();
    // Corrigiu "Quanto tem agora" e registrou a caixa em cima do número: a compra vai sozinha, na hora.
    act(() => field('Quanto tem agora')!.props.onChangeText('3'));
    await openBox('30');
    const release = slowWrites();
    act(() => button('Somar ao estoque')!.props.onPress());
    await until(() => writes().length === 1);
    expect(canPress('Salvar')).toBe(false);
    // A compra chega: "Salvar" volta, e o número novo já é o salvo.
    await act(async () => release());
    await until(() => canPress('Salvar'));
    expect(mockNet.medications[0]).toMatchObject({ stock_count: 33, stock_counted_on: today });
    expect(field('Quanto tem agora')!.props.value).toBe('33');
    act(() => button('Salvar')!.props.onPress());
    await until(() => writes().length === 2);
    expect(writes()[1].body).not.toHaveProperty('stock_count');
    expect(mockNet.medications[0]).toMatchObject({ stock_count: 33 });
  });

  it('com o remédio sendo salvo, "Comprei mais" e "Somar ao estoque" não aceitam o toque', async () => {
    await openScreen();
    const release = slowWrites();
    act(() => field('Remédio')!.props.onChangeText('Losartana 50 mg'));
    act(() => button('Salvar')!.props.onPress());
    await until(() => writes().length === 1);
    expect(canPress('Comprei mais')).toBe(false);
    await act(async () => release());
    await until(() => jest.mocked(router.back).mock.calls.length > 0);

    // Com a caixa já aberta: "Somar ao estoque" espera o salvar.
    act(() => renderer?.unmount());
    mockNet.requests = [];
    await openScreen();
    await openBox('30');
    const again = slowWrites();
    act(() => button('Salvar')!.props.onPress());
    await until(() => writes().length === 1);
    expect(canPress('Somar ao estoque')).toBe(false);
    await act(async () => again());
    await until(() => jest.mocked(router.back).mock.calls.length > 1);
    expect(writes()).toHaveLength(1);
  });
});

describe('o estoque refeito ou somado a partir da cópia só é gravado sobre ela', () => {
  it('a regra mudou e outro celular registrou uma caixa nesse meio-tempo: nada é salvo, e a tela diz para abrir de novo', async () => {
    // 10 contados há 4 dias, um por dia: sobram 6 hoje.
    mockNet.medications = [losartana({ stock_count: 10, stock_counted_on: addDays(today, -4) })];
    await openScreen();
    expect(field('Quanto tem agora')!.props.value).toBe('6');
    // Ana registra a caixa no celular dela: 36, contados hoje.
    Object.assign(mockNet.medications[0], { stock_count: 36, stock_counted_on: today });
    const before = reads();
    // Aqui, a dose passa a duas vezes por dia.
    act(() => chip('2x').props.onPress());
    act(() => button('Salvar')!.props.onPress());
    await until(() => jest.mocked(notify).mock.calls.length > 0);
    expect(jest.mocked(notify).mock.calls).toEqual([['Erro', MEDICATION_STOCK_CHANGED]]);
    expect(MEDICATION_STOCK_CHANGED).toContain('mudou em outro aparelho');
    // O pedido levava o estoque da cópia como condição, e o banco não achou a linha: nada mudou.
    expect(writes()).toHaveLength(1);
    expect(writes()[0].params).toMatchObject({ id: 'eq.m1', stock_count: 'eq.10', stock_counted_on: `eq.${addDays(today, -4)}` });
    expect(mockNet.medications[0]).toMatchObject({ times: ['08:00'], stock_count: 36, stock_counted_on: today });
    expect(router.back).not.toHaveBeenCalled();
    // E o remédio é buscado de novo: aberto outra vez, ele vem com a caixa de Ana.
    await until(() => reads() > before);
    expect(reads()).toBeGreaterThan(before);
  });

  it('"Comprei mais" sobre a conta do app, com outra caixa registrada nesse meio-tempo: nada é somado', async () => {
    await openScreen();
    Object.assign(mockNet.medications[0], { stock_count: 40 });
    await openBox('30');
    act(() => button('Somar ao estoque')!.props.onPress());
    await until(() => jest.mocked(notify).mock.calls.length > 0);
    expect(jest.mocked(notify).mock.calls).toEqual([['Não deu para registrar a compra', MEDICATION_STOCK_CHANGED]]);
    expect(writes()[0].params).toMatchObject({ stock_count: 'eq.10', stock_counted_on: `eq.${today}` });
    expect(mockNet.medications[0]).toMatchObject({ stock_count: 40 });
    // Sobre o número que a pessoa escreveu, a caixa soma sem condição: é a contagem dela.
    act(() => field('Quanto tem agora')!.props.onChangeText('5'));
    act(() => button('Somar ao estoque')!.props.onPress());
    await until(() => writes().length === 2);
    await until(() => mockNet.medications[0].stock_count === 35);
    expect(writes()[1].params).not.toHaveProperty('stock_count');
    expect(mockNet.medications[0]).toMatchObject({ stock_count: 35, stock_counted_on: today });
  });
});

describe('uma busca que falha não tira o formulário da tela', () => {
  it('a compra foi gravada e as buscas seguintes falham: o formulário fica com o que foi digitado, e um aviso oferece tentar de novo', async () => {
    await openScreen();
    act(() => field('Remédio')!.props.onChangeText('Losartana 50 mg'));
    await openBox('30');
    mockNet.failReads = true;
    act(() => button('Somar ao estoque')!.props.onPress());
    await until(() => page().includes('Não foi possível atualizar. Mostrando o que já estava carregado.'));
    expect(mockNet.medications[0]).toMatchObject({ stock_count: 40 });
    expect(renderer!.root.findAllByType(ErrorNotice)).toHaveLength(0);
    expect(field('Remédio')!.props.value).toBe('Losartana 50 mg');
    expect(field('Quanto tem agora')!.props.value).toBe('40');
    // A internet volta: "Tentar de novo" busca, e o aviso sai.
    mockNet.failReads = false;
    await act(async () => button('Tentar de novo')!.props.onPress());
    await until(() => !page().includes('Não foi possível atualizar. Mostrando o que já estava carregado.'));
    expect(field('Remédio')!.props.value).toBe('Losartana 50 mg');
  });

  it('sem nada carregado, o erro ocupa a tela, com "Tentar de novo"', async () => {
    mockNet.failReads = true;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
    act(() => {
      renderer = create(
        <QueryClientProvider client={client}>
          <MedicationScreen />
        </QueryClientProvider>,
      );
    });
    await until(() => renderer!.root.findAllByType(ErrorNotice).length > 0);
    expect(button('Salvar')).toBeUndefined();
    mockNet.failReads = false;
    await act(async () => button('Tentar de novo')!.props.onPress());
    await until(() => Boolean(button('Salvar')));
    expect(field('Remédio')!.props.value).toBe('Losartana');
  });
});

describe('a regra das doses mudou num aparelho com a data errada', () => {
  const realDate = (clock: string) =>
    jest.useFakeTimers({
      now: new Date(clock),
      doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'hrtime', 'performance'],
    });
  afterEach(() => {
    jest.useRealTimers();
  });

  it.each(['1970-01-02T12:00:00', '2101-01-01T12:00:00'])('em %s: nada do remédio é salvo, e o aviso pede para acertar a data', async (clock) => {
    realDate(clock);
    mockNet.medications = [losartana({ stock_count: 30, stock_counted_on: '2026-10-10' })];
    await openScreen();
    act(() => chip('2x').props.onPress());
    act(() => button('Salvar')!.props.onPress());
    await until(() => jest.mocked(notify).mock.calls.length > 0);
    expect(jest.mocked(notify).mock.calls).toEqual([['Confira a data do aparelho', expect.stringContaining('data deste aparelho')]]);
    expect(writes()).toEqual([]);
    expect(router.back).not.toHaveBeenCalled();
  });

  it('com a data errada, mudar só o nome (sem contagem a refazer) salva como sempre', async () => {
    realDate('1970-01-02T12:00:00');
    mockNet.medications = [losartana({ stock_count: 30, stock_counted_on: '2026-10-10' })];
    await openScreen();
    act(() => field('Remédio')!.props.onChangeText('Losartana 50 mg'));
    act(() => button('Salvar')!.props.onPress());
    await until(() => jest.mocked(router.back).mock.calls.length > 0);
    expect(writes()).toHaveLength(1);
    expect(writes()[0].body).toMatchObject({ name: 'Losartana 50 mg' });
    expect(writes()[0].body).not.toHaveProperty('stock_count');
    expect(notify).not.toHaveBeenCalled();
  });
});

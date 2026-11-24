import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Modal, Text as RNText } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import LongCycleScreen from '@/app/trocas';
import { housePlaceHouseLine } from '@/domain/housePlace';
import {
  LONG_CYCLE_FOOTNOTE,
  LONG_CYCLE_HISTORY_FAILED,
  LONG_CYCLE_INTRO,
  LONG_CYCLE_ITEMS,
  LONG_CYCLE_NOT_READY,
  LONG_CYCLE_OFFLINE,
  type LongCycleChange,
  type LongCycleSetting,
} from '@/domain/longCycle';
import type { PurchaseRecord } from '@/domain/recentPurchases';
import { StaleNotice } from '@/features/health/StaleNotice';
import { ActionSheet } from '@/ui/ActionSheet';
import { notify } from '@/ui/dialogs';
import { Badge, Button, Chip, ErrorNotice, ListRow, Loading } from '@/ui/primitives';

// A tela dos prazos de troca (Configurações → Casa → "Prazos de troca"): todos os itens da tabela do app, o que está
// na hora primeiro, com o prazo, a última vez, o selo e as opções de cada um. Aqui não há aviso depois de gravar: a
// linha fica, e o selo e a frase dela dizem o que mudou.

const NOW = new Date(2026, 10, 10, 12, 0);

type Answer = { data: unknown; fetchStatus: 'fetching' | 'paused' | 'idle'; isError?: boolean; error?: unknown };
// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockData = {
  settings: { data: [], fetchStatus: 'idle' } as Answer,
  history: { data: [], fetchStatus: 'idle' } as Answer,
  purchases: { data: [], fetchStatus: 'idle' } as Answer,
  lists: [] as { id: string; items: { name: string; category: string; product_id: string | null }[] }[],
  listsLoaded: true,
  justListed: new Set<string>(),
  houses: 1,
  refetched: [] as string[],
};
const mockSave = jest.fn(async ({ itemKey, change }: { itemKey: string; change: LongCycleChange }): Promise<LongCycleSetting> => {
  const rows = (mockData.settings.data as LongCycleSetting[] | null) ?? [];
  const before = rows.find((r) => r.item_key === itemKey) ?? { item_key: itemKey, every_months: null, off: false, replaced_on: null };
  const row = { ...before, ...change };
  mockData.settings = { ...mockData.settings, data: [...rows.filter((r) => r.item_key !== itemKey), row] };
  return row;
});
const mockAddItems = jest.fn(async (_: unknown) => ({ id: 'mercado' }));

const mockAnswer = (name: string, answer: Answer) => ({
  ...answer,
  isError: Boolean(answer.isError),
  isRefetching: false,
  refetch: jest.fn(async () => mockData.refetched.push(name)),
});
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useFocusEffect: () => undefined }));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/data/longCycle', () => ({
  useLongCycleSettings: () => mockAnswer('settings', mockData.settings),
  useLongCycleHistory: () => mockAnswer('history', mockData.history),
  useSetLongCycleSetting: () => ({ mutateAsync: mockSave, isPending: false }),
}));
jest.mock('@/data/market', () => ({
  useAddItemsToList: () => ({ mutateAsync: mockAddItems, isPending: false }),
  usePurchaseRecords: () => mockAnswer('purchases', mockData.purchases),
  useShoppingLists: () => ({
    data: mockData.listsLoaded ? mockData.lists : undefined,
    isSuccess: mockData.listsLoaded,
    isRefetching: false,
    refetch: jest.fn(async () => mockData.refetched.push('lists')),
  }),
}));
jest.mock('@/features/RecentPurchases', () => ({
  useJustListed: () => ({
    pending: mockData.justListed,
    add: (names: string[]) => {
      mockData.justListed = new Set([...mockData.justListed, ...names.map((n) => n.toLowerCase())]);
    },
    drop: jest.fn(),
  }),
}));
jest.mock('@/lib/auth', () => ({
  useHousehold: () => ({
    data: {
      household: { id: 'h1', name: 'Casa da Ana' },
      households: Array.from({ length: mockData.houses }, (_, i) => ({ id: `h${i + 1}`, name: i ? 'Casa da praia' : 'Casa da Ana' })),
    },
  }),
}));
jest.mock('@/lib/supabase', () => ({ errorMessage: (error: { message?: string }) => error?.message ?? String(error) }));
jest.mock('@/ui/dialogs', () => ({ notify: jest.fn() }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));

let renderer: ReactTestRenderer | undefined;

const rawText = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map(rawText).join(''));
const page = () => renderer!.root.findAllByType(RNText).map(rawText);
const element = () => (
  <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
    <LongCycleScreen />
  </SafeAreaProvider>
);
async function mount() {
  await act(async () => {
    renderer = create(element());
  });
}
const rerender = () => act(async () => renderer!.update(element()));
const rows = () => renderer!.root.findAllByType(ListRow);
const row = (title: string) => rows().find((r) => r.props.title === title)!;
const badgeOf = (title: string) => row(title).findAllByType(Badge)[0]?.props.label as string | undefined;
const sheet = () => renderer!.root.findAllByType(ActionSheet).find((a) => a.props.visible);
const labels = () => (sheet()!.props.actions as { label: string }[]).map((a) => a.label);
const sheetButton = (label: string) =>
  sheet()!.findAll((n) => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function' && rawText(n) === label)[0];
// No Jest o sistema é o iOS: a ação escolhida roda quando o menu acaba de descer (o onDismiss do Modal).
async function pressSheet(label: string) {
  const menu = sheet()!;
  await act(async () => sheetButton(label).props.onPress());
  await act(async () => menu.findByType(Modal).props.onDismiss());
  // O cache novo (no app, o setQueryData da gravação desenha de novo; aqui, a busca de mentira não avisa).
  await rerender();
}
const open = (title: string) => act(async () => row(title).props.onPress());
const chips = () => renderer!.root.findAllByType(Chip).filter((c) => c.props.toggle);
const saveButton = () => renderer!.root.findAllByType(Button).find((b) => b.props.title === 'Salvar')!;

const bought = (name: string, day: string, category: string): PurchaseRecord => ({
  name,
  category,
  productId: null,
  quantity: 1,
  unit: 'un',
  at: `${day}T10:00:00.000Z`,
  source: 'list',
});

beforeEach(() => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask'],
  });
  Object.assign(mockData, {
    settings: { data: [], fetchStatus: 'idle' },
    // A vassoura na hora (desde 1/9), a escova em dia (comprada há 20 dias).
    history: { data: [bought('Vassoura', '2025-09-01', 'limpeza')], fetchStatus: 'idle' },
    purchases: { data: [bought('Escova de dente', '2026-10-21', 'higiene')], fetchStatus: 'idle' },
    lists: [],
    listsLoaded: true,
    justListed: new Set<string>(),
    houses: 1,
    refetched: [],
  });
  mockSave.mockClear();
  mockAddItems.mockClear();
  jest.mocked(notify).mockClear();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  jest.useRealTimers();
});

describe('a tela dos prazos de troca', () => {
  it('todos os itens da tabela, o que está na hora primeiro, com o prazo, a última vez e o selo', async () => {
    mockData.lists = [{ id: 'l1', items: [{ name: 'Travesseiro Nasa', category: 'outros', product_id: null }] }];
    mockData.settings = { data: [{ item_key: 'chupeta', every_months: null, off: true, replaced_on: null }], fetchStatus: 'idle' };
    await mount();
    expect(rows().map((r) => r.props.title)).toEqual([
      'Vassoura',
      ...LONG_CYCLE_ITEMS.filter((i) => i.key !== 'vassoura').map((i) => i.name),
    ]);
    expect(row('Vassoura').props.subtitle).toBe('Todo ano · última compra há 1 ano e 2 meses');
    expect(badgeOf('Vassoura')).toBe('Hora de trocar');
    expect(row('Escova de dente').props.subtitle).toBe('A cada 3 meses · última compra há 20 dias');
    expect(badgeOf('Escova de dente')).toBeUndefined();
    expect(row('Refil de mop').props.subtitle).toBe('A cada 6 meses · nenhuma compra pelo app');
    expect(badgeOf('Chupeta')).toBe('Não sugerido');
    expect(badgeOf('Travesseiro')).toBe('Na lista');
    expect(page()).toContain(LONG_CYCLE_INTRO);
    expect(page()).toContain(LONG_CYCLE_FOOTNOTE);
    expect(page()).not.toContain(housePlaceHouseLine('Casa da Ana'));
  });

  it('com mais de uma casa, diz de qual casa são os prazos', async () => {
    mockData.houses = 2;
    await mount();
    expect(page()).toContain(housePlaceHouseLine('Casa da Ana'));
  });

  it('"Pôr na lista": só com as listas em mãos e o item fora delas; põe pelo caminho do Hoje, e a linha fica "Na lista"', async () => {
    await mount();
    await open('Vassoura');
    expect(labels()).toEqual(['Pôr na lista', 'Já troquei', 'Mudar o prazo', 'Não sugerir mais']);
    await pressSheet('Pôr na lista');
    expect(mockAddItems).toHaveBeenCalledWith({
      newListName: 'Mercado',
      reuseMarketList: true,
      items: [{ name: 'Vassoura', category: 'limpeza', productId: null, quantity: 1, unit: 'un', cycleKey: 'vassoura' }],
    });
    expect(badgeOf('Vassoura')).toBe('Na lista');
    await open('Vassoura');
    expect(labels()).not.toContain('Pôr na lista');

    // Sem as listas, a tela não sabe o que está nelas.
    await act(async () => renderer!.unmount());
    mockData.listsLoaded = false;
    mockData.justListed = new Set();
    await mount();
    await open('Refil de mop');
    expect(labels()).toEqual(['Já troquei', 'Mudar o prazo', 'Não sugerir mais']);
  });

  it('"Já troquei" grava hoje; "Desfazer o “Já troquei”" só aparece quando a última vez foi uma troca, e a apaga', async () => {
    await mount();
    await open('Refil de mop');
    await pressSheet('Já troquei');
    expect(mockSave).toHaveBeenCalledWith({ itemKey: 'refil_mop', change: { replaced_on: '2026-11-10' } });
    expect(row('Refil de mop').props.subtitle).toBe('A cada 6 meses · última troca hoje');
    await open('Refil de mop');
    expect(labels()).toEqual(['Pôr na lista', 'Já troquei', 'Desfazer o “Já troquei”', 'Mudar o prazo', 'Não sugerir mais']);
    await pressSheet('Desfazer o “Já troquei”');
    expect(mockSave).toHaveBeenLastCalledWith({ itemKey: 'refil_mop', change: { replaced_on: null } });
    expect(row('Refil de mop').props.subtitle).toBe('A cada 6 meses · nenhuma compra pelo app');
    await open('Escova de dente');
    expect(labels()).not.toContain('Desfazer o “Já troquei”');
  });

  it('"Não sugerir mais" e "Voltar a sugerir", sem aviso: o selo diz', async () => {
    await mount();
    await open('Vassoura');
    await pressSheet('Não sugerir mais');
    expect(mockSave).toHaveBeenCalledWith({ itemKey: 'vassoura', change: { off: true } });
    expect(badgeOf('Vassoura')).toBe('Não sugerido');
    expect(page().join(' ')).not.toContain('não vai mais aparecer');
    await open('Vassoura');
    expect(labels()).toContain('Voltar a sugerir');
    await pressSheet('Voltar a sugerir');
    expect(mockSave).toHaveBeenLastCalledWith({ itemKey: 'vassoura', change: { off: false } });
    expect(badgeOf('Vassoura')).toBe('Hora de trocar');
  });

  describe('"Mudar o prazo"', () => {
    async function openPeriod(title: string) {
      await open(title);
      await pressSheet('Mudar o prazo');
    }

    it('grava null no padrão do Kotii e o número no outro', async () => {
      await mount();
      await openPeriod('Escova de dente');
      expect(chips().find((c) => c.props.selected)!.props.label).toBe('3 meses');
      expect(page()).toContain('O padrão do Kotii é 3 meses.');
      await act(async () => chips().find((c) => c.props.label === '2 meses')!.props.onPress());
      await act(async () => saveButton().props.onPress());
      expect(mockSave).toHaveBeenCalledWith({ itemKey: 'escova_dente', change: { every_months: 2 } });
      await rerender();
      expect(chips()).toHaveLength(0);
      expect(row('Escova de dente').props.subtitle).toBe('A cada 2 meses (prazo da casa) · última compra há 20 dias');

      await openPeriod('Escova de dente');
      await act(async () => chips().find((c) => c.props.label === '3 meses')!.props.onPress());
      await act(async () => saveButton().props.onPress());
      expect(mockSave).toHaveBeenLastCalledWith({ itemKey: 'escova_dente', change: { every_months: null } });
    });

    it('um prazo guardado fora das escolhas ganha o selo dele, escolhido', async () => {
      mockData.settings = { data: [{ item_key: 'vassoura', every_months: 5, off: false, replaced_on: null }], fetchStatus: 'idle' };
      await mount();
      await openPeriod('Vassoura');
      expect(chips().map((c) => c.props.label)).toEqual(['1 mês', '2 meses', '3 meses', '4 meses', '5 meses', '6 meses', '9 meses', '1 ano', '1 ano e meio', '2 anos']);
      expect(chips().find((c) => c.props.selected)!.props.label).toBe('5 meses');
    });

    it('a gravação que falha avisa e deixa a folha aberta, com o selo escolhido; dois toques em Salvar gravam uma vez', async () => {
      await mount();
      await openPeriod('Vassoura');
      await act(async () => chips().find((c) => c.props.label === '6 meses')!.props.onPress());
      mockSave.mockImplementationOnce(async () => {
        throw new Error('Sem internet agora');
      });
      await act(async () => saveButton().props.onPress());
      expect(notify).toHaveBeenCalledWith('Erro', 'Sem internet agora');
      expect(chips().find((c) => c.props.selected)!.props.label).toBe('6 meses');

      let finish: () => void = () => undefined;
      mockSave.mockImplementationOnce(
        ({ itemKey, change }) =>
          new Promise((resolve) => (finish = () => resolve({ item_key: itemKey, every_months: null, off: false, replaced_on: null, ...change }))),
      );
      await act(async () => {
        saveButton().props.onPress();
        saveButton().props.onPress();
      });
      expect(mockSave).toHaveBeenCalledTimes(2);
      await act(async () => finish());
    });
  });

  it('antes da migração: o aviso, e as linhas só para ler', async () => {
    mockData.settings = { data: null, fetchStatus: 'idle' };
    mockData.history = { data: null, fetchStatus: 'idle' };
    await mount();
    expect(page()).toContain(LONG_CYCLE_NOT_READY);
    expect(rows()).toHaveLength(LONG_CYCLE_ITEMS.length);
    expect(rows().every((r) => r.props.onPress === undefined)).toBe(true);
    // A leitura longa que respondeu null não é falha.
    expect(page()).not.toContain(LONG_CYCLE_HISTORY_FAILED);
  });

  it('lendo, sem internet e com erro, sem nada guardado', async () => {
    mockData.settings = { data: undefined, fetchStatus: 'fetching' };
    await mount();
    expect(renderer!.root.findAllByType(Loading)).toHaveLength(1);
    await act(async () => renderer!.unmount());

    // As compras chegam antes de dizer "nenhuma compra pelo app".
    mockData.settings = { data: [], fetchStatus: 'idle' };
    mockData.history = { data: undefined, fetchStatus: 'fetching' };
    await mount();
    expect(renderer!.root.findAllByType(Loading)).toHaveLength(1);
    await act(async () => renderer!.unmount());

    mockData.history = { data: [], fetchStatus: 'idle' };
    mockData.settings = { data: undefined, fetchStatus: 'paused' };
    await mount();
    expect(page()).toContain(LONG_CYCLE_OFFLINE);
    await act(async () => renderer!.root.findAllByType(Button).find((b) => b.props.title === 'Tentar de novo')!.props.onPress());
    expect(mockData.refetched).toEqual(['settings']);
    await act(async () => renderer!.unmount());

    mockData.settings = { data: undefined, fetchStatus: 'idle', isError: true, error: new Error('Deu ruim') };
    await mount();
    expect(renderer!.root.findByType(ErrorNotice).props.error).toEqual(new Error('Deu ruim'));
  });

  it('a atualização que falha com os ajustes na tela: a lista fica, com o aviso e o "Tentar de novo"', async () => {
    mockData.settings = { data: [], fetchStatus: 'idle', isError: true, error: new Error('Deu ruim') };
    await mount();
    expect(rows()).toHaveLength(LONG_CYCLE_ITEMS.length);
    const stale = renderer!.root.findAllByType(StaleNotice);
    expect(stale).toHaveLength(1);
    await act(async () => stale[0].props.onRetry());
    expect(mockData.refetched).toEqual(['settings']);
  });

  it('a leitura longa que falhou: o aviso das compras antigas, com o "Tentar de novo"; parada sem internet, sem botão', async () => {
    mockData.history = { data: undefined, fetchStatus: 'idle', isError: true };
    await mount();
    const stale = renderer!.root.findAllByType(StaleNotice);
    expect(stale.map((n) => n.props.message)).toEqual([LONG_CYCLE_HISTORY_FAILED]);
    await act(async () => stale[0].props.onRetry());
    expect(mockData.refetched).toEqual(['history']);
    // As linhas vêm das compras dos 180 dias.
    expect(row('Escova de dente').props.subtitle).toBe('A cada 3 meses · última compra há 20 dias');
    await act(async () => renderer!.unmount());

    mockData.history = { data: undefined, fetchStatus: 'paused' };
    await mount();
    expect(renderer!.root.findByType(StaleNotice).props.onRetry).toBeUndefined();
  });

  it('o atualizar busca de novo os ajustes, as compras e as listas', async () => {
    await mount();
    const screen = renderer!.root.findAll((n) => typeof n.props.onRefresh === 'function')[0];
    await act(async () => screen.props.onRefresh());
    expect([...mockData.refetched].sort()).toEqual(['history', 'lists', 'purchases', 'settings']);
  });
});

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, create, type ReactTestRenderer, type ReactTestRendererJSON } from 'react-test-renderer';

import HouseScreen from '@/app/(tabs)/casa';

// A aba Casa de verdade, no segmento Despensa, com as buscas trocadas: o que se confere aqui é que
// "Gás, água e ração" não depende da busca da despensa (carregando ou com erro, a seção continua
// lá), fica antes do "Adicionar item", que é o botão da despensa, e diz onde ligar o aviso por
// notificação. "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockIdle = { data: [], isPending: false, isError: false, isRefetching: false, error: null, refetch: jest.fn() };
const mockMutation = { mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false };
const mockQueries: { pantry: unknown; supplies: unknown } = { pantry: mockIdle, supplies: mockIdle };
const mockPush = jest.fn();
/** Este aparelho recebe notificação? `reason`: por que não. */
const mockReminders: { supported: boolean; reason: string | null } = { supported: true, reason: null };

jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args), setParams: jest.fn() },
  useLocalSearchParams: () => ({ aba: 'despensa' }),
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/ui/art', () => ({ Mascot: () => null, Spot: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@/lib/supabase', () => ({ errorMessage: (error: unknown) => String(error) }));
jest.mock('@/lib/reminders', () => ({
  REMINDER_PLACE: 'neste celular',
  get remindersSupported() {
    return mockReminders.supported;
  },
  remindersUnavailableReason: () => mockReminders.reason,
}));
jest.mock('@/features/ShoppingListsPanel', () => ({ ShoppingListsPanel: () => null }));
jest.mock('@/features/ChoresPanel', () => ({ ChoresPanel: () => null }));
jest.mock('@/features/EquipmentPanel', () => ({ EquipmentPanel: () => null }));
jest.mock('@/data/home', () => ({
  usePantry: () => mockQueries.pantry,
  useChores: () => mockIdle,
  useConsumePantryItems: () => mockMutation,
  useTakeOneFromPantry: () => mockMutation,
}));
jest.mock('@/data/house', () => ({ useEquipmentList: () => mockIdle }));
jest.mock('@/data/market', () => ({ useShoppingLists: () => mockIdle, useProducts: () => mockIdle, useAddToMarketList: () => mockMutation }));
jest.mock('@/data/supplies', () => ({ useSupplies: () => mockQueries.supplies, useRecordRefill: () => mockMutation }));

const gas = { id: 's1', name: 'Gás de cozinha', kind: 'gas', typical_days: null, notes: null, created_at: '2026-10-01T10:00:00Z', refills: [] };
const rice = {
  id: 'p1',
  name: 'Arroz',
  category: 'mercearia',
  product_id: null,
  quantity: 1,
  unit: 'un',
  purchased_on: '2026-10-01',
  expires_on: null,
};

/** Os textos da tela, na ordem em que aparecem. */
function texts(node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null): string[] {
  if (node == null) return [];
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(texts);
  return (node.children ?? []).flatMap(texts);
}

function open(pantry: object): ReactTestRenderer {
  mockQueries.pantry = { ...mockIdle, ...pantry };
  let screen: ReactTestRenderer | undefined;
  act(() => {
    screen = create(<HouseScreen />);
  });
  return screen!;
}

function despensa(pantry: object): string[] {
  const screen = open(pantry);
  const shown = texts(screen.toJSON());
  act(() => screen.unmount());
  return shown;
}

const POINTER = 'Para receber a notificação, ligue “Gás, água e ração” nos avisos neste celular.';

beforeEach(() => {
  mockPush.mockClear();
  mockReminders.supported = true;
  mockReminders.reason = null;
  mockQueries.supplies = { ...mockIdle, data: { available: true, supplies: [gas] } };
});

describe('Casa › Despensa', () => {
  it('"Gás, água e ração" vem antes do "Adicionar item", que fica junto da lista da despensa', () => {
    const shown = despensa({ data: [rice] });
    expect(shown).toEqual(expect.arrayContaining(['Gás, água e ração', 'Gás de cozinha', 'Adicionar item', 'Arroz']));
    expect(shown.indexOf('Gás de cozinha')).toBeLessThan(shown.indexOf('Adicionar item'));
    expect(shown.indexOf('Adicionar item')).toBeLessThan(shown.indexOf('Arroz'));
  });

  it('com a despensa ainda carregando, a seção já está na tela', () => {
    const shown = despensa({ data: undefined, isPending: true });
    expect(shown).toEqual(expect.arrayContaining(['Gás, água e ração', 'Gás de cozinha']));
    expect(shown).not.toContain('Adicionar item');
  });

  it('com a busca da despensa em erro, a seção continua lá, acima do aviso de erro', () => {
    const shown = despensa({ data: undefined, isError: true, error: new Error('Falha ao buscar a despensa') });
    expect(shown).toEqual(expect.arrayContaining(['Gás, água e ração', 'Gás de cozinha', 'Falha ao buscar a despensa', 'Tentar de novo']));
    expect(shown.indexOf('Gás de cozinha')).toBeLessThan(shown.indexOf('Falha ao buscar a despensa'));
  });

  it('num banco ainda sem as tabelas, a seção não aparece e a despensa segue inteira', () => {
    mockQueries.supplies = { ...mockIdle, data: { available: false, supplies: [] } };
    const shown = despensa({ data: [rice] });
    expect(shown).not.toContain('Gás, água e ração');
    expect(shown).toEqual(expect.arrayContaining(['Adicionar item', 'Arroz']));
  });

  it('com alguma reposição, a seção diz onde ligar o aviso e leva até lá', () => {
    const screen = open({ data: [rice] });
    const shown = texts(screen.toJSON());
    expect(shown).toEqual(expect.arrayContaining([POINTER, 'Abrir os avisos']));
    expect(shown.indexOf('Gás de cozinha')).toBeLessThan(shown.indexOf(POINTER));
    expect(shown.indexOf('Abrir os avisos')).toBeLessThan(shown.indexOf('Adicionar item'));
    act(() => screen.root.findByProps({ title: 'Abrir os avisos' }).props.onPress());
    expect(mockPush).toHaveBeenCalledWith('/familia');
    act(() => screen.unmount());
  });

  it('onde não há notificação, diz o motivo e que o aviso aparece na tela Hoje, sem botão', () => {
    mockReminders.supported = false;
    mockReminders.reason = 'Este navegador não recebe notificações.';
    const shown = despensa({ data: [rice] });
    expect(shown).toContain('Este navegador não recebe notificações. O aviso aparece na tela Hoje.');
    expect(shown).not.toContain(POINTER);
    expect(shown).not.toContain('Abrir os avisos');
  });

  it('sem nenhuma reposição, só o convite: nada sobre avisos', () => {
    mockQueries.supplies = { ...mockIdle, data: { available: true, supplies: [] } };
    const shown = despensa({ data: [rice] });
    expect(shown).toContain('Avisar antes de acabar o gás, a água, a ração…');
    expect(shown).not.toContain(POINTER);
    expect(shown).not.toContain('Abrir os avisos');
  });
});

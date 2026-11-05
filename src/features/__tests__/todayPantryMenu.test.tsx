import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { router } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import TodayScreen from '@/app/(tabs)/index';
import { addDays, formatShortDate, todayISO } from '@/domain/dates';
import { PantryPanel } from '@/features/PantryPanel';
import type { PantryItem } from '@/lib/types';
import { ActionSheet, type SheetAction } from '@/ui/ActionSheet';
import { notify } from '@/ui/dialogs';
import { Button, ListRow } from '@/ui/primitives';

// A seção Despensa da tela Hoje: cada linha é uma compra que vence, e o toque abre o menu do produto dela, o mesmo
// da aba Casa → Despensa ("Acabou" põe na lista, "Consumido / descartado" dá baixa), e não mais o formulário.

const today = todayISO();
// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockPantry: { rows: PantryItem[] } = { rows: [] };
const mockProducts: { data: unknown; enabled: boolean[] } = { data: [], enabled: [] };
const mockLists = { data: [] as unknown[] };
const mockAdd = jest.fn<(item: Record<string, unknown>) => Promise<{ id: string; name: string; added: boolean }>>();
const mockConsumeAsync = jest.fn<(ids: string[]) => Promise<void>>();
const mockConsume = jest.fn();
const mockTakeOne = jest.fn();

const mockQuery = (data: unknown = []) => ({ data, isRefetching: false, isSuccess: true, isPending: false, isError: false, error: null, refetch: jest.fn() });
jest.mock('@/data/weather', () => ({
  useHouseholdLocation: () => ({ data: null }),
  useForecast: () => ({ data: undefined }),
  useRefreshWeather: () => () => undefined,
}));
jest.mock('@/data/home', () => ({
  toSchedules: () => [],
  useChoreRotations: () => mockQuery(),
  useChores: () => mockQuery(),
  useCompleteChore: () => ({ mutate: jest.fn(), isPending: false }),
  useDoses: () => mockQuery(),
  useMedications: () => mockQuery(),
  usePantry: () => mockQuery(mockPantry.rows),
  useToggleDose: () => ({ mutate: jest.fn(), isPending: false }),
  useConsumePantryItems: () => ({ mutate: mockConsume, mutateAsync: mockConsumeAsync, isPending: false }),
  useTakeOneFromPantry: () => ({ mutate: mockTakeOne, mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock('@/data/family', () => ({
  useFamilyCalendar: () => ({ calendar: { events: [], days: [], people: [] }, refetch: jest.fn() }),
}));
jest.mock('@/data/finance', () => ({
  useBills: () => mockQuery(),
  useBudgets: () => mockQuery(),
  useRecentBillPayments: () => mockQuery(),
  useSpending: () => mockQuery(undefined),
}));
jest.mock('@/data/house', () => ({ useDocuments: () => mockQuery(), useEquipmentList: () => mockQuery() }));
jest.mock('@/data/market', () => ({
  useAddItemsToList: () => ({ mutateAsync: jest.fn() }),
  useAddToPantryList: () => ({ mutate: jest.fn(), mutateAsync: mockAdd, isPending: false }),
  useProducts: (options?: { enabled?: boolean }) => {
    mockProducts.enabled.push(options?.enabled ?? true);
    return { data: mockProducts.data };
  },
  usePurchaseRecords: () => mockQuery(),
  useShoppingLists: () => mockQuery(mockLists.data),
}));
jest.mock('@/data/marketTrips', () => ({ useRefreshMarketTrips: () => () => undefined }));
jest.mock('@/data/menu', () => ({ useMenu: () => mockQuery() }));
jest.mock('@/data/pendingReceipts', () => ({ usePendingReceipts: () => ({ pending: [] }) }));
jest.mock('@/data/receipts', () => ({ useDraftReceipts: () => mockQuery() }));
jest.mock('@/data/supplies', () => ({ useSupplies: () => mockQuery({ supplies: [], available: true }) }));
jest.mock('@/lib/openedLists', () => ({ useOpenedLists: () => new Map() }));
jest.mock('@/features/ChoresPanel', () => ({ announceCompletion: jest.fn() }));
jest.mock('@/features/finance/BillsPanel', () => ({ BillRow: () => null }));
jest.mock('@/features/finance/PayBillModal', () => ({ PayBillModal: () => null }));
jest.mock('@/features/health/HealthTodaySections', () => ({
  hasHealthToday: () => false,
  healthTodayCount: () => 0,
  HealthTodaySections: () => null,
}));
jest.mock('@/features/health/MedicationSections', () => ({
  DoseSubtitle: () => null,
  MedicationRefills: () => null,
  useRefills: () => ({ rows: [], attention: [] }),
}));
jest.mock('@/features/health/useHealthOverview', () => ({
  useHealthOverview: () => ({ queries: [], loaded: true, people: [], upcoming: [], toConfirm: [], vaccinesDue: [], workoutsToday: [], drafts: [] }),
}));
jest.mock('@/features/InstallAppCard', () => ({ InstallAppCard: () => null }));
jest.mock('@/features/MarketTrip', () => ({ MarketTripBanner: () => null }));
jest.mock('@/features/PendingReceiptCard', () => ({ PendingReceiptRow: () => null }));
jest.mock('@/features/RecentPurchases', () => ({
  useJustListed: () => ({ pending: new Set<string>(), add: jest.fn(), drop: jest.fn() }),
}));
jest.mock('@/features/SuppliesSection', () => ({ SuppliesTodaySection: () => null }));
jest.mock('@/features/TermsNotice', () => ({ TermsNoticeCard: () => null }));
jest.mock('@/lib/auth', () => {
  const me = { household_id: 'h1', user_id: 'ana', display_name: 'Ana', role: 'owner' };
  return {
    useHousehold: () => ({
      data: { household: { id: 'h1', name: 'Casa da Ana' }, members: [me], me, households: [{ id: 'h1', name: 'Casa da Ana', role: 'owner' }] },
    }),
  };
});
jest.mock('@/lib/supabase', () => ({ errorMessage: (error: unknown) => String(error) }));
jest.mock('@/ui/dialogs', () => ({ notify: jest.fn() }));
jest.mock('@/ui/iconArt', () => ({ IconArt: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));

const purchase = (over: Partial<PantryItem> & { id: string }): PantryItem => ({
  product_id: 'leite',
  name: 'LEITE UHT ITALAC',
  category: 'laticinios',
  quantity: 1,
  unit: 'un',
  purchased_on: addDays(today, -40),
  expires_on: addDays(today, -2),
  expiry_source: 'categoria',
  consumed_at: null,
  ...over,
});
// O leite vencido (o da tela Hoje) e outro, novo, do mesmo produto, que a tela Hoje não mostra.
const EXPIRED = purchase({ id: 'p-old' });
const FRESH = purchase({ id: 'p-new', purchased_on: addDays(today, -1), expires_on: addDays(today, 60) });
const list = (name: string, kind: string, created_at: string) => ({ id: `l-${name}`, name, kind, created_at, archived_at: null, pending: 0, total: 0, items: [] });

let renderer: ReactTestRenderer | undefined;

async function mountToday() {
  await act(async () => {
    renderer = create(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
        <TodayScreen />
      </SafeAreaProvider>,
    );
  });
}

/** O menu aberto (o primeiro ActionSheet do menu da despensa). */
const sheet = () => renderer!.root.findAllByType(ActionSheet).find((s) => s.props.visible)!;
const labelsOf = (actions: SheetAction[]) => actions.map((a) => a.label);

async function openTodayRow(index = 0) {
  const rows = renderer!.root.findAllByType(ListRow).filter((r) => r.props.title === 'LEITE UHT ITALAC');
  await act(async () => rows[index].props.onPress());
  return sheet();
}

beforeEach(() => {
  mockPantry.rows = [EXPIRED, FRESH];
  mockProducts.data = [{ id: 'leite', name: 'Leite Italac' }];
  mockProducts.enabled = [];
  mockLists.data = [list('Mercado', 'mercado', '2026-10-01T10:00:00Z'), list('Feira', 'mercado', '2026-10-15T10:00:00Z')];
  mockAdd.mockReset();
  mockAdd.mockImplementation(async (item) => ({ id: String(item.listId ?? 'l-Feira'), name: 'Feira', added: true }));
  mockConsumeAsync.mockReset();
  mockConsumeAsync.mockResolvedValue(undefined);
  mockConsume.mockClear();
  mockTakeOne.mockClear();
  jest.mocked(router.push).mockClear();
  jest.mocked(notify).mockClear();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

describe('Despensa na tela Hoje: o menu do produto', () => {
  it('o toque na compra vencida abre o menu do produto, igual ao da Despensa, e não o formulário', async () => {
    await mountToday();
    const shown = await openTodayRow();
    expect(router.push).not.toHaveBeenCalled();
    expect(shown.props.title).toBe('Leite Italac');
    // A linha não mostra a data da compra, só a validade: o menu diz qual compra foi tocada por ela.
    expect(shown.props.message).toBe(
      `Compras: ${formatShortDate(EXPIRED.purchased_on)} (1 un, venceu há 2 dias) e ${formatShortDate(FRESH.purchased_on)} (1 un).`,
    );
    const todayLabels = labelsOf(shown.props.actions);
    expect(todayLabels).toContain('Acabou — pôr na última lista (“Feira”)');
    expect(todayLabels).toContain('Consumido / descartado (tudo)');
    await act(async () => renderer!.unmount());

    // A aba Casa → Despensa, com os mesmos dados: as mesmas ações, na mesma ordem; só as de editar dizem as datas,
    // da compra mais nova para a mais antiga (lá a linha é o produto, e não uma compra).
    await act(async () => {
      renderer = create(<PantryPanel />);
    });
    await act(async () => renderer!.root.findAllByType(ListRow).find((r) => r.props.title === 'Leite Italac')!.props.onPress());
    const pantryLabels = labelsOf(sheet().props.actions);
    const notEditing = (labels: string[]) => labels.filter((label) => !label.startsWith('Editar'));
    expect(notEditing(pantryLabels)).toEqual(notEditing(todayLabels));
    expect(pantryLabels.filter((label) => label.startsWith('Editar'))).toEqual([
      `Editar a compra de ${formatShortDate(FRESH.purchased_on)} (1 un)`,
      `Editar a compra de ${formatShortDate(EXPIRED.purchased_on)} (1 un)`,
    ]);
    expect(sheet().props.title).toBe('Leite Italac');
    expect(sheet().props.message).toBe(
      `Compras: ${formatShortDate(EXPIRED.purchased_on)} (1 un) e ${formatShortDate(FRESH.purchased_on)} (1 un).`,
    );
  });

  it('"Editar esta compra" vem primeiro e abre o formulário da compra tocada; "Ver preços" abre o produto', async () => {
    await mountToday();
    const actions: SheetAction[] = (await openTodayRow()).props.actions;
    expect(labelsOf(actions).filter((label) => label.startsWith('Editar'))).toEqual([
      'Editar esta compra (venceu há 2 dias)',
      `Editar a compra de ${formatShortDate(FRESH.purchased_on)} (1 un)`,
    ]);
    act(() => actions.find((a) => a.label === 'Editar esta compra (venceu há 2 dias)')!.onPress());
    expect(router.push).toHaveBeenCalledWith({ pathname: '/despensa/[id]', params: { id: 'p-old' } });
    act(() => actions.find((a) => a.label === 'Ver preços')!.onPress());
    expect(router.push).toHaveBeenCalledWith({ pathname: '/produto/[id]', params: { id: 'leite' } });
  });

  it('duas compras do mesmo produto vencendo: duas linhas, e cada uma abre o menu com a sua compra primeiro', async () => {
    const SOON = purchase({ id: 'p-soon', purchased_on: addDays(today, -20), expires_on: addDays(today, 1) });
    mockPantry.rows = [EXPIRED, SOON, FRESH];
    await mountToday();
    const rows = renderer!.root.findAllByType(ListRow).filter((r) => r.props.title === 'LEITE UHT ITALAC');
    expect(rows).toHaveLength(2);
    const edits: Record<string, string[]> = {};
    for (const row of rows) {
      await act(async () => row.props.onPress());
      const actions: SheetAction[] = sheet().props.actions;
      const editing = actions.filter((a) => a.label.startsWith('Editar'));
      jest.mocked(router.push).mockClear();
      act(() => editing[0].onPress());
      const id = (jest.mocked(router.push).mock.calls[0][0] as unknown as { params: { id: string } }).params.id;
      edits[id] = editing.map((a) => a.label);
      await act(async () => sheet().props.onClose());
    }
    expect(edits).toEqual({
      'p-old': [
        'Editar esta compra (venceu há 2 dias)',
        `Editar a compra de ${formatShortDate(FRESH.purchased_on)} (1 un)`,
        `Editar a compra de ${formatShortDate(SOON.purchased_on)} (1 un)`,
      ],
      'p-soon': [
        'Editar esta compra (vence amanhã)',
        `Editar a compra de ${formatShortDate(FRESH.purchased_on)} (1 un)`,
        `Editar a compra de ${formatShortDate(EXPIRED.purchased_on)} (1 un)`,
      ],
    });
  });

  it('"Acabou" põe o item, sem a marca, na lista que o menu mostrou e dá baixa no produto inteiro', async () => {
    await mountToday();
    const actions: SheetAction[] = (await openTodayRow()).props.actions;
    await act(async () => actions.find((a) => a.label === 'Acabou — pôr na última lista (“Feira”)')!.onPress());
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Leite', productId: 'leite', listId: undefined, shownListId: 'l-Feira' }),
    );
    expect(mockConsumeAsync).toHaveBeenCalledWith(['p-old', 'p-new']);
    expect(notify).toHaveBeenCalledWith('Adicionado à lista', 'Leite foi para "Feira".');
  });

  it('"Consumido / descartado": com uma compra só, sem o "(tudo)"', async () => {
    mockPantry.rows = [EXPIRED];
    await mountToday();
    const actions: SheetAction[] = (await openTodayRow()).props.actions;
    expect(labelsOf(actions)).not.toContain('Consumido / descartado (tudo)');
    act(() => actions.find((a) => a.label === 'Consumido / descartado')!.onPress());
    expect(mockConsume).toHaveBeenCalledWith(['p-old'], expect.anything());
  });

  it('"Consumido / descartado (tudo)" dá baixa em todas as compras do produto', async () => {
    await mountToday();
    const actions: SheetAction[] = (await openTodayRow()).props.actions;
    act(() => actions.find((a) => a.label === 'Consumido / descartado (tudo)')!.onPress());
    expect(mockConsume).toHaveBeenCalledWith(['p-old', 'p-new'], expect.anything());
  });

  it('com mais de 6 vencendo, as 6 linhas abrem o menu e "Ver todos" ainda leva à Despensa', async () => {
    mockPantry.rows = Array.from({ length: 7 }, (_, i) =>
      purchase({ id: `x${i}`, product_id: null, name: `Item ${i}`, category: 'mercearia', purchased_on: addDays(today, -10 - i) }),
    );
    await mountToday();
    const rows = renderer!.root.findAllByType(ListRow).filter((r) => String(r.props.title).startsWith('Item '));
    expect(rows).toHaveLength(6);
    await act(async () => rows[5].props.onPress());
    expect(sheet().props.title).toBe(rows[5].props.title);
    expect(router.push).not.toHaveBeenCalled();
    const more = renderer!.root.findAllByType(Button).find((b) => b.props.title === 'Ver todos (7)')!;
    act(() => more.props.onPress());
    expect(router.push).toHaveBeenCalledWith({ pathname: '/casa', params: { aba: 'despensa' } });
  });

  it('o catálogo só é lido com uma compra vencendo; sem ele, o nome é o da compra mais nova', async () => {
    mockPantry.rows = [];
    await mountToday();
    expect(mockProducts.enabled.length).toBeGreaterThan(0);
    expect(mockProducts.enabled.every((enabled) => enabled === false)).toBe(true);
    await act(async () => renderer!.unmount());

    mockPantry.rows = [EXPIRED, FRESH];
    mockProducts.enabled = [];
    mockProducts.data = undefined;
    await mountToday();
    expect(mockProducts.enabled).toContain(true);
    const shown = await openTodayRow();
    expect(shown.props.title).toBe('LEITE UHT ITALAC');
    await act(async () => (shown.props.actions as SheetAction[]).find((a) => a.label.startsWith('Acabou — pôr'))!.onPress());
    // O nome sem a marca sai do nome da compra, como na Despensa com o catálogo ainda chegando.
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ productId: 'leite' }));
  });
});

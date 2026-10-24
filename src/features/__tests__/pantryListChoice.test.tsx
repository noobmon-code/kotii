import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { PantryPanel } from '@/features/PantryPanel';
import type { PantryItem } from '@/lib/types';
import { ActionSheet, type SheetAction } from '@/ui/ActionSheet';
import { notify } from '@/ui/dialogs';
import { ListRow } from '@/ui/primitives';

// Despensa, "Acabou": o item vai para a última lista criada (em que ele cabe), ou para outra que a pessoa escolhe.

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockPantry: { rows: PantryItem[] } = { rows: [] };
const mockLists: { data: unknown[] | undefined } = { data: [] };
const mockAdd = jest.fn<(item: Record<string, unknown>) => Promise<{ id: string; name: string; added: boolean }>>();
const mockConsume = jest.fn<(ids: string[]) => Promise<void>>();

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/data/home', () => {
  const mutation = () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false });
  return {
    usePantry: () => ({ data: mockPantry.rows, isPending: false, isError: false, error: null, refetch: jest.fn() }),
    useConsumePantryItems: () => ({ mutate: jest.fn(), mutateAsync: mockConsume, isPending: false }),
    useTakeOneFromPantry: mutation,
  };
});
jest.mock('@/data/market', () => ({
  useAddToPantryList: () => ({ mutate: jest.fn(), mutateAsync: mockAdd, isPending: false }),
  useShoppingLists: () => ({ data: mockLists.data }),
  useProducts: () => ({ data: [] }),
}));
jest.mock('@/lib/supabase', () => ({ errorMessage: (error: unknown) => String(error) }));
jest.mock('@/ui/dialogs', () => ({ askYesNo: jest.fn(), confirmAction: jest.fn(), notify: jest.fn() }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));

let renderer: ReactTestRenderer | undefined;

const row = (name: string, category: string): PantryItem => ({
  id: `d-${name}`,
  product_id: null,
  name,
  category,
  quantity: 2,
  unit: 'un',
  purchased_on: '2026-10-01',
  expires_on: null,
  expiry_source: null,
  consumed_at: null,
});

const list = (name: string, kind: string, created_at: string) => ({ id: `l-${name}`, name, kind, created_at, archived_at: null, pending: 0, total: 0, items: [] });

beforeEach(() => {
  mockAdd.mockReset();
  mockConsume.mockReset();
  mockAdd.mockImplementation(async (item) => ({ id: String(item.listId ?? 'l-Feira'), name: 'Feira', added: true }));
  mockConsume.mockResolvedValue(undefined);
  jest.mocked(notify).mockClear();
  mockPantry.rows = [row('Arroz', 'mercearia'), row('Dipirona', 'medicamentos')];
  mockLists.data = [
    list('Mercado', 'mercado', '2026-10-01T10:00:00Z'),
    list('Feira', 'mercado', '2026-10-15T10:00:00Z'),
    list('Farmácia', 'farmacia', '2026-10-17T10:00:00Z'),
  ];
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

/** As ações do menu do item tocado (o primeiro menu). */
async function actionsOf(name: string): Promise<SheetAction[]> {
  await act(async () => {
    renderer = create(<PantryPanel />);
  });
  act(() => renderer!.root.findAllByType(ListRow).find((r) => r.props.title === name)!.props.onPress());
  return renderer!.root.findAllByType(ActionSheet)[0].props.actions;
}

describe('"Acabou" na despensa', () => {
  it('diz qual é a última lista em que o item cabe e oferece escolher outra', async () => {
    const labels = (await actionsOf('Arroz')).map((a) => a.label);
    expect(labels.slice(0, 2)).toEqual(['Acabou — pôr na última lista (“Feira”)', 'Acabou — escolher a lista']);
  });

  it('o toque principal manda a lista que o menu mostrou, sem fixá-la (fechada, vale a mais nova do servidor)', async () => {
    const actions = await actionsOf('Arroz');
    await act(async () => actions[0].onPress());
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ name: 'Arroz', listId: undefined, shownListId: 'l-Feira' }));
    expect(mockConsume).toHaveBeenCalledWith(['d-Arroz']);
    expect(notify).toHaveBeenCalledWith('Adicionado à lista', 'Arroz foi para "Feira".');
  });

  it('"escolher a lista" mostra as listas em que o item cabe, da mais nova para a mais antiga, e usa a tocada', async () => {
    const actions = await actionsOf('Arroz');
    act(() => actions.find((a) => a.label === 'Acabou — escolher a lista')!.onPress());
    const picker = renderer!.root.findAllByType(ActionSheet)[1];
    expect(picker.props.visible).toBe(true);
    expect(picker.props.title).toBe('Arroz: para qual lista?');
    const choices: SheetAction[] = picker.props.actions;
    expect(choices.map((a) => a.label)).toEqual(['Feira (a mais nova)', 'Mercado']);
    await act(async () => choices[1].onPress());
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ name: 'Arroz', listId: 'l-Mercado' }));
    expect(mockConsume).toHaveBeenCalledWith(['d-Arroz']);
  });

  it('com uma lista só em que o item cabe, não há o que escolher', async () => {
    const labels = (await actionsOf('Dipirona')).map((a) => a.label);
    expect(labels[0]).toBe('Acabou — pôr na última lista (“Farmácia”)');
    expect(labels).not.toContain('Acabou — escolher a lista');
  });

  it('sem lista aberta em que caiba: diz a lista que vai ser usada (ou criada)', async () => {
    mockLists.data = [];
    expect((await actionsOf('Arroz'))[0].label).toBe('Acabou — pôr na lista de mercado');
    await act(async () => renderer?.unmount());
    expect((await actionsOf('Dipirona'))[0].label).toBe('Acabou — pôr na lista da farmácia');
  });

  it('o item vai para a lista sem a marca, com o produto como dica de preço', async () => {
    mockPantry.rows = [{ ...row('Leite IL Desnatado', 'laticinios'), product_id: 'il' }];
    const actions = await actionsOf('Leite IL Desnatado');
    await act(async () => actions[0].onPress());
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ name: 'Leite desnatado', category: 'laticinios', productId: 'il' }));
    expect(notify).toHaveBeenCalledWith('Adicionado à lista', 'Leite desnatado foi para "Feira".');
    // Já pendente (com este nome ou com a marca): o aviso fala do item sem a marca.
    mockAdd.mockImplementation(async () => ({ id: 'l-Feira', name: 'Feira', added: false }));
    await act(async () => actions[0].onPress());
    expect(notify).toHaveBeenCalledWith('Já estava na lista', 'Leite desnatado já estava pendente em "Feira".');
  });

  it('a lista falhou: a baixa não acontece e o erro aparece', async () => {
    mockAdd.mockRejectedValue(new Error('Essa lista não está mais aberta. Escolha outra.'));
    const actions = await actionsOf('Arroz');
    await act(async () => actions[0].onPress());
    expect(mockConsume).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('Erro', 'Error: Essa lista não está mais aberta. Escolha outra.');
  });
});

describe('"Está acabando" na despensa', () => {
  it('põe na última lista sem dar baixa: o item continua na despensa', async () => {
    const actions = await actionsOf('Arroz');
    expect(actions.map((a) => a.label).slice(0, 4)).toEqual([
      'Acabou — pôr na última lista (“Feira”)',
      'Acabou — escolher a lista',
      'Está acabando — pôr na última lista (“Feira”)',
      'Está acabando — escolher a lista',
    ]);
    await act(async () => actions[2].onPress());
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ name: 'Arroz', quantity: 2, unit: 'un', listId: undefined, shownListId: 'l-Feira' }));
    expect(mockConsume).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('Adicionado à lista', 'Arroz foi para "Feira". Continua na despensa até acabar.');
  });

  it('"escolher a lista" usa a tocada, também sem dar baixa', async () => {
    const actions = await actionsOf('Arroz');
    act(() => actions.find((a) => a.label === 'Está acabando — escolher a lista')!.onPress());
    const picker = renderer!.root.findAllByType(ActionSheet)[1];
    expect(picker.props.title).toBe('Arroz: para qual lista?');
    expect(picker.props.message).toBe('O item continua na despensa até acabar.');
    await act(async () => (picker.props.actions as SheetAction[])[1].onPress());
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ name: 'Arroz', listId: 'l-Mercado' }));
    expect(mockConsume).not.toHaveBeenCalled();
  });

  it('item sem produto vai com o nome sem a marca; sem lista aberta, diz a lista que vai ser usada', async () => {
    mockLists.data = [];
    mockPantry.rows = [row('Leite IL Desnatado', 'laticinios')];
    const actions = await actionsOf('Leite IL Desnatado');
    const soon = actions.find((a) => a.label === 'Está acabando — pôr na lista de mercado')!;
    expect(actions.map((a) => a.label)).not.toContain('Está acabando — escolher a lista');
    mockAdd.mockImplementation(async () => ({ id: 'l-Mercado', name: 'Mercado', added: false }));
    await act(async () => soon.onPress());
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({ name: 'Leite desnatado', productId: null }));
    expect(mockConsume).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('Já estava na lista', 'Leite desnatado já estava pendente em "Mercado". Continua na despensa até acabar.');
  });

  it('a lista falhou: nada muda na despensa, e o erro aparece', async () => {
    mockAdd.mockRejectedValue(new Error('Essa lista não está mais aberta. Escolha outra.'));
    const actions = await actionsOf('Arroz');
    await act(async () => actions[2].onPress());
    expect(mockConsume).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('Erro', 'Error: Essa lista não está mais aberta. Escolha outra.');
  });
});

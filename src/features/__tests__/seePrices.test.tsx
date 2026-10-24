import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { router } from 'expo-router';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { ListItemEditor } from '@/features/ListItemEditor';
import { PantryPanel } from '@/features/PantryPanel';
import type { PantryItem, ShoppingListItem } from '@/lib/types';
import { ActionSheet, type SheetAction } from '@/ui/ActionSheet';
import { confirmAction } from '@/ui/dialogs';
import { Button, Chip, ListRow, Text } from '@/ui/primitives';

// "Ver preços": os dois caminhos novos até a tela do produto (e o histórico de preço dele), no item da
// despensa e nos detalhes do item da lista.

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockPantry: { rows: PantryItem[] } = { rows: [] };

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/data/home', () => {
  const mutation = () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false });
  return {
    usePantry: () => ({ data: mockPantry.rows, isPending: false, isError: false, error: null, refetch: jest.fn() }),
    useConsumePantryItems: mutation,
    useTakeOneFromPantry: mutation,
  };
});
jest.mock('@/data/market', () => ({
  useAddToPantryList: () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false }),
  useShoppingLists: () => ({ data: [] }),
  useProducts: () => ({ data: [{ id: 'arroz', name: 'Arroz', category: 'mercearia', shelf_life_days: null }] }),
}));
jest.mock('@/data/images', () => ({ pickImages: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ errorMessage: (error: unknown) => String(error) }));
jest.mock('@/ui/dialogs', () => ({ askYesNo: jest.fn(), confirmAction: jest.fn(), notify: jest.fn() }));
// Os desenhos animados (reanimated) e o fundo não entram no que se confere aqui.
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));

let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  jest.mocked(router.push).mockClear();
  jest.mocked(confirmAction).mockClear();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

describe('"Ver preços" no item da despensa', () => {
  const pantryRow = (name: string, product_id: string | null): PantryItem => ({
    id: `d-${name}`,
    product_id,
    name,
    category: 'mercearia',
    quantity: 1,
    unit: 'un',
    purchased_on: '2026-10-01',
    expires_on: null,
    expiry_source: null,
    consumed_at: null,
  });

  /** As ações do menu do item tocado. */
  async function actionsOf(name: string): Promise<SheetAction[]> {
    await act(async () => {
      renderer = create(<PantryPanel />);
    });
    act(() => renderer!.root.findAllByType(ListRow).find((row) => row.props.title === name)!.props.onPress());
    // O primeiro menu é o do item; o segundo, o de escolher a lista.
    return renderer!.root.findAllByType(ActionSheet)[0].props.actions;
  }

  it('item ligado a um produto: o menu ganha "Ver preços", que abre a tela do produto', async () => {
    mockPantry.rows = [pantryRow('Arroz', 'arroz'), pantryRow('Bolo da vó', null)];
    const actions = await actionsOf('Arroz');
    expect(actions.map((action) => action.label)).toEqual([
      'Acabou — pôr na lista de mercado',
      'Está acabando — pôr na lista de mercado',
      'Consumido / descartado',
      'Ver preços',
      'Editar validade e quantidade',
    ]);
    actions.find((action) => action.label === 'Ver preços')!.onPress();
    expect(router.push).toHaveBeenCalledWith({ pathname: '/produto/[id]', params: { id: 'arroz' } });
  });

  it('item sem produto não tem preço a ver', async () => {
    mockPantry.rows = [pantryRow('Arroz', 'arroz'), pantryRow('Bolo da vó', null)];
    expect((await actionsOf('Bolo da vó')).map((action) => action.label)).not.toContain('Ver preços');
  });
});

describe('"Ver preços" nos detalhes do item da lista', () => {
  const item: ShoppingListItem = {
    id: 'a',
    list_id: 'l1',
    product_id: 'arroz',
    name: 'Arroz',
    category: 'mercearia',
    quantity: 1,
    unit: 'un',
    notes: null,
    priority: 'normal',
    photo_path: null,
    checked_at: null,
    checked_by: null,
    toggle_token: 'selo',
    created_at: '2026-10-01T12:00:00Z',
  };
  const facts = () => ['Último preço: R$ 25,90/un (Assaí, 10 out).'];

  async function open(onSeePrices?: () => void, shownFacts: string[] = facts()) {
    await act(async () => {
      renderer = create(
        <ListItemEditor item={item} photoUri={null} photoPending={false} facts={() => shownFacts} onSeePrices={onSeePrices} onSave={jest.fn()} onRemove={jest.fn()} onClose={jest.fn()} />,
      );
    });
    return renderer!.root.findAllByType(Button).find((button) => button.props.title === 'Ver preços');
  }

  it('item com preço: o botão fica junto de "Preço e despensa" e chama quem abre o produto', async () => {
    const onSeePrices = jest.fn();
    const button = await open(onSeePrices);
    act(() => button!.props.onPress());
    expect(onSeePrices).toHaveBeenCalledTimes(1);
    expect(confirmAction).not.toHaveBeenCalled();
  });

  /** Os textos na tela dos detalhes. */
  const texts = () => renderer!.root.findAllByType(Text).map((text) => [text.props.children].flat().join(''));

  it('item com produto e sem preço: com botão, e a frase diz o que há na tela do produto', async () => {
    const onSeePrices = jest.fn();
    const button = await open(onSeePrices, []);
    expect(texts()).toContain('O histórico de preço e os preços vistos em outras casas ficam na tela do produto.');
    act(() => button!.props.onPress());
    expect(onSeePrices).toHaveBeenCalledTimes(1);
  });

  it('item sem produto: sem botão (e sem o cartão, quando não há nada a dizer)', async () => {
    expect(await open(undefined, [])).toBeUndefined();
    expect(texts()).not.toContain('Preço e despensa');
  });

  it('item sem produto, mas na despensa: as frases, sem o botão', async () => {
    expect(await open(undefined, ['Na despensa desde 1 out: Arroz.'])).toBeUndefined();
    expect(texts()).toContain('Na despensa desde 1 out: Arroz.');
  });

  it('com algo mudado e ainda não salvo, pergunta antes de sair', async () => {
    const onSeePrices = jest.fn();
    await open(onSeePrices);
    act(() => renderer!.root.findAllByType(Chip).find((chip) => chip.props.label === 'kg')!.props.onPress());
    act(() => renderer!.root.findAllByType(Button).find((button) => button.props.title === 'Ver preços')!.props.onPress());
    expect(onSeePrices).not.toHaveBeenCalled();
    expect(confirmAction).toHaveBeenCalledWith(
      'Ver preços',
      'As mudanças neste item ainda não foram salvas. Sair sem salvar?',
      'Sair sem salvar',
      expect.any(Function),
    );
    // Confirmando, sai.
    (jest.mocked(confirmAction).mock.calls[0][3] as () => void)();
    expect(onSeePrices).toHaveBeenCalledTimes(1);
  });
});

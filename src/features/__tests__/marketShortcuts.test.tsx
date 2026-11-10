import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AccessibilityInfo, Platform, View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { productCategoryNote } from '@/domain/productCategory';
import { MARKET_MONTH_CARD, ReceiptsPanel } from '@/features/market/ReceiptsPanel';
import { ShoppingListsPanel } from '@/features/ShoppingListsPanel';
import { PickerModal } from '@/ui/PickerModal';
import { FeatureCard } from '@/ui/FeatureCard';
import { Button, TextField, Tile } from '@/ui/primitives';

// Os caminhos até o dinheiro do mercado e o aviso da categoria: Compras > Notas leva ao Mercado do mês (a única
// entrada dele), Compras > Listas leva aos Preços, e o seletor de categoria diz, antes da escolha, que a categoria
// vale também para as compras dos meses passados.

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockRouter = { push: jest.fn() };
const mockLists = { data: [] as { id: string; name: string; kind: string; total: number; pending: number }[] };

jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockRouter.push(...args) } }));
jest.mock('@/data/market', () => ({
  useShoppingLists: () => ({ data: mockLists.data, isPending: false, isError: false, error: null, refetch: jest.fn() }),
  useCreateList: () => ({ mutate: jest.fn(), isPending: false }),
  // As arquivadas têm os testes delas (listsManage.test): aqui, nenhuma.
  useArchivedLists: () => ({ data: [] }),
  useReopenList: () => ({ mutate: jest.fn(), isPending: false }),
}));
// As notas: uma casa com nada ainda (o painel das notas tem os testes dele, receiptsPanel.test).
jest.mock('@/data/receipts', () => ({
  useDraftReceipts: () => ({ data: [], isPending: false, isError: false }),
  useReceiptHistory: () => ({ data: { pages: [{ rows: [], remaining: 0 }] }, isPending: false, isError: false, hasNextPage: false }),
}));
jest.mock('@/data/pendingReceipts', () => ({ usePendingReceipts: () => ({ pending: [], storeNames: {} }) }));
jest.mock('@/features/ReceiptScanner', () => ({ useReceiptScanner: () => ({ open: jest.fn(), busy: false, element: null }) }));
jest.mock('@/ui/dialogs', () => ({ notify: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ errorMessage: (error: { message?: string }) => error?.message ?? 'Algo deu errado.' }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));

let renderer: ReactTestRenderer | undefined;

const texts = (node: ReturnType<ReactTestRenderer['toJSON']> | string): string[] =>
  node == null ? [] : typeof node === 'string' ? [node] : Array.isArray(node) ? node.flatMap(texts) : (node.children ?? []).flatMap(texts);

beforeEach(() => {
  mockRouter.push.mockClear();
  mockLists.data = [{ id: 'l1', name: 'Compras do mês', kind: 'mercado', total: 3, pending: 2 }];
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

describe('Compras > Notas', () => {
  it('começa pelo cartão do Mercado do mês, que leva a ele; o botão "Preços" não fica aqui', async () => {
    await act(async () => {
      renderer = create(<ReceiptsPanel />);
    });
    const text = texts(renderer!.toJSON());
    expect(text.slice(0, 3)).toEqual([MARKET_MONTH_CARD.title, MARKET_MONTH_CARD.subtitle, 'Adicionar nota']);
    expect(MARKET_MONTH_CARD).toEqual({
      title: 'Para onde foi o dinheiro do mercado',
      subtitle: 'Mercado do mês: por item, por categoria e por mercado',
    });
    const card = renderer!.root.findByType(FeatureCard);
    // O leitor de tela diz o título e a frase de baixo, não só o título.
    expect(card.findAll((node) => node.props.accessibilityRole === 'button')[0].props.accessibilityLabel).toBe(
      'Para onde foi o dinheiro do mercado. Mercado do mês: por item, por categoria e por mercado',
    );
    await act(async () => card.props.onPress());
    expect(mockRouter.push).toHaveBeenCalledWith('/mercado');
    expect(renderer!.root.findAllByType(Button).map((b) => b.props.title)).toEqual(['Adicionar nota']);
    expect(text).not.toContain('Preços');
  });
});

describe('Compras > Listas', () => {
  const button = (title: string) => renderer!.root.findAllByType(Button).find((entry) => entry.props.title === title)!;

  it('tem os Preços (só aqui) e não o cartão do Mercado do mês, que foi para as notas', async () => {
    await act(async () => {
      renderer = create(<ShoppingListsPanel />);
    });
    const text = texts(renderer!.toJSON());
    expect(text).toContain('Compras do mês');
    expect(text).not.toContain(MARKET_MONTH_CARD.title);
    expect(renderer!.root.findAllByType(FeatureCard)).toHaveLength(0);
    await act(async () => button('Preços').props.onPress());
    expect(mockRouter.push).toHaveBeenCalledWith('/precos');
  });

  it('"Nova lista" é o botão primário no alto; Preços e Cardápio são outras telas, botões secundários, sem azulejo', async () => {
    await act(async () => {
      renderer = create(<ShoppingListsPanel />);
    });
    expect(renderer!.root.findAllByType(Tile)).toHaveLength(0);
    const buttons = renderer!.root.findAllByType(Button);
    expect(buttons.slice(0, 3).map((entry) => [entry.props.title, entry.props.variant ?? 'primary'])).toEqual([
      ['Nova lista', 'primary'],
      ['Preços', 'secondary'],
      ['Cardápio', 'secondary'],
    ]);
    // O nome curto cabe ao lado de "Preços" num celular de 360; o leitor de tela diz o nome da tela.
    expect(button('Cardápio').props.accessibilityLabel).toBe('Cardápio da semana');
    await act(async () => button('Cardápio').props.onPress());
    expect(mockRouter.push).toHaveBeenCalledWith('/cardapio');
    // O formulário da lista nova toma o lugar do botão enquanto está aberto, no alto.
    await act(async () => button('Nova lista').props.onPress());
    expect(renderer!.root.findAllByType(Button).find((entry) => entry.props.title === 'Nova lista')).toBeUndefined();
    expect(texts(renderer!.toJSON())[0]).toBe('Nova lista');
    expect(button('Criar')).toBeDefined();
    await act(async () => button('Cancelar').props.onPress());
    expect(button('Nova lista')).toBeDefined();
  });

  // O botão tocado sai da tela quando o formulário abre (e o "Cancelar" sai quando fecha): o foco não pode ficar
  // sem lugar. No Jest a View é de mentira (uma classe com os métodos nativos de mentira): a referência do botão é a
  // instância dela, comparada por identidade (o objeto tem laços com a árvore e não se compara por conteúdo).
  const nextFrame = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  const viewOf = (title: string) => button(title).findAllByType(View)[0].instance as { focus: jest.Mock };

  it('ao abrir, o campo do nome recebe o foco; "Cancelar" devolve o foco do leitor de tela ao botão "Nova lista"', async () => {
    const send = jest.mocked(AccessibilityInfo.sendAccessibilityEvent);
    send.mockClear();
    await act(async () => {
      renderer = create(<ShoppingListsPanel />);
    });
    await act(async () => button('Nova lista').props.onPress());
    expect(renderer!.root.findByType(TextField).props.autoFocus).toBe(true);
    await act(async () => button('Cancelar').props.onPress());
    await nextFrame();
    expect(send.mock.calls).toHaveLength(1);
    expect(send.mock.calls[0][0]).toBe(viewOf('Nova lista'));
    expect(send.mock.calls[0][1]).toBe('focus');
  });

  it('na web, "Cancelar" devolve o foco do teclado ao botão "Nova lista"', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    await act(async () => {
      renderer = create(<ShoppingListsPanel />);
    });
    await act(async () => button('Nova lista').props.onPress());
    const focus = viewOf('Criar').focus;
    focus.mockClear();
    await act(async () => button('Cancelar').props.onPress());
    await nextFrame();
    // O método de mentira é um só para todas as Views: quem o recebeu é o `this` da chamada.
    expect(focus.mock.contexts).toHaveLength(1);
    expect(focus.mock.contexts[0]).toBe(viewOf('Nova lista'));
  });
});

describe('o seletor de categoria', () => {
  it('mostra a frase logo abaixo do título, antes da busca e das opções', async () => {
    await act(async () => {
      renderer = create(
        <PickerModal
          visible
          title="Categoria"
          message={productCategoryNote(false)}
          options={[{ id: 'graos', title: 'Grãos, massas e cereais' }]}
          onSelect={() => {}}
          onClose={() => {}}
        />,
      );
    });
    const text = texts(renderer!.toJSON());
    expect(text.slice(0, 2)).toEqual(['Categoria', productCategoryNote(false)]);
    expect(text).toContain('Grãos, massas e cereais');
  });

  it('sem frase, nada a mais', async () => {
    await act(async () => {
      renderer = create(<PickerModal visible title="Categoria" options={[]} onSelect={() => {}} onClose={() => {}} />);
    });
    expect(texts(renderer!.toJSON()).slice(0, 2)).toEqual(['Categoria', 'Nada encontrado.']);
  });
});

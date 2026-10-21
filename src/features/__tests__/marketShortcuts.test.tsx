import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { PRODUCT_CATEGORY_NOTE } from '@/domain/productCategory';
import { ShoppingListsPanel } from '@/features/ShoppingListsPanel';
import { PickerModal } from '@/ui/PickerModal';
import { FeatureCard } from '@/ui/ScreenHeader';

// Os caminhos até o dinheiro do mercado e o aviso da categoria: Casa > Compras leva ao Mercado do mês, e o
// seletor de categoria diz, antes da escolha, que a categoria vale também para as compras dos meses passados.

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockRouter = { push: jest.fn() };
const mockLists = { data: [] as { id: string; name: string; kind: string; total: number; pending: number }[] };

jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockRouter.push(...args) } }));
jest.mock('@/data/market', () => ({
  useShoppingLists: () => ({ data: mockLists.data, isPending: false, isError: false, error: null, refetch: jest.fn() }),
  useCreateList: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('@/ui/dialogs', () => ({ notify: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ errorMessage: (error: { message?: string }) => error?.message ?? 'Algo deu errado.' }));
jest.mock('@/ui/art', () => ({ Mascot: () => null, Spot: () => null }));
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

describe('Casa > Compras', () => {
  it('tem o atalho para o Mercado do mês, depois das listas', async () => {
    await act(async () => {
      renderer = create(<ShoppingListsPanel />);
    });
    const text = texts(renderer!.toJSON()).join('\n');
    expect(text).toContain(['Para onde foi o dinheiro do mercado', 'Mercado do mês: por item, por categoria e por mercado'].join('\n'));
    expect(text.indexOf('Compras do mês')).toBeLessThan(text.indexOf('Para onde foi o dinheiro do mercado'));
    const card = renderer!.root.findByType(FeatureCard);
    expect(card.props.title).toBe('Para onde foi o dinheiro do mercado');
    await act(async () => card.props.onPress());
    expect(mockRouter.push).toHaveBeenCalledWith('/mercado');
  });

  it('sem lista nenhuma, o atalho continua lá', async () => {
    mockLists.data = [];
    await act(async () => {
      renderer = create(<ShoppingListsPanel />);
    });
    const text = texts(renderer!.toJSON()).join('\n');
    expect(text).toContain('Nenhuma lista ainda');
    expect(text).toContain('Para onde foi o dinheiro do mercado');
  });
});

describe('o seletor de categoria', () => {
  it('mostra a frase logo abaixo do título, antes da busca e das opções', async () => {
    await act(async () => {
      renderer = create(
        <PickerModal
          visible
          title="Categoria"
          message={PRODUCT_CATEGORY_NOTE}
          options={[{ id: 'graos', title: 'Grãos, massas e cereais' }]}
          onSelect={() => {}}
          onClose={() => {}}
        />,
      );
    });
    const text = texts(renderer!.toJSON());
    expect(text.slice(0, 2)).toEqual(['Categoria', PRODUCT_CATEGORY_NOTE]);
    expect(text).toContain('Grãos, massas e cereais');
  });

  it('sem frase, nada a mais', async () => {
    await act(async () => {
      renderer = create(<PickerModal visible title="Categoria" options={[]} onSelect={() => {}} onClose={() => {}} />);
    });
    expect(texts(renderer!.toJSON()).slice(0, 2)).toEqual(['Categoria', 'Nada encontrado.']);
  });
});

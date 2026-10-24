import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { View } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { type ItemHint, ShoppingGrid } from '@/features/ShoppingGrid';
import type { ShoppingListItem } from '@/lib/types';
import { Badge } from '@/ui/primitives';

// A grade de verdade: o selo "Novo" da ida ao mercado aparece (e o leitor de tela diz "novo") só no que falta
// comprar, e a lista arquivada (só para ver) não marca nem abre os detalhes.

jest.mock('@/data/listPhotos', () => ({ usePendingPhotoUri: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/ui/art', () => ({}));

const item: ShoppingListItem = {
  id: 'a',
  list_id: 'l1',
  product_id: null,
  name: 'Feijão',
  category: 'graos',
  quantity: 1,
  unit: 'un',
  notes: null,
  priority: 'normal',
  photo_path: null,
  checked_at: null,
  checked_by: null,
  toggle_token: 'selo',
  created_at: '2026-10-24T14:20:00Z',
};

let renderer: ReactTestRenderer | undefined;
const onToggle = jest.fn();
const onOpen = jest.fn();

async function mount({ hint, inCart = false, readOnly = false }: { hint?: ItemHint; inCart?: boolean; readOnly?: boolean }) {
  await act(async () => {
    renderer = create(
      <ShoppingGrid
        items={[inCart ? { ...item, checked_at: '2026-10-24T14:30:00Z' } : item]}
        inCart={inCart}
        readOnly={readOnly}
        photos={{ pending: new Map() }}
        hints={hint ? new Map([['a', hint]]) : undefined}
        onToggle={onToggle}
        onOpen={onOpen}
      />,
    );
  });
  // A grade só desenha depois de saber a largura.
  const grid = renderer!.root.findAllByType(View).find((view) => typeof view.props.onLayout === 'function')!;
  await act(async () => grid.props.onLayout({ nativeEvent: { layout: { width: 360, height: 0, x: 0, y: 0 } } }));
}

const badges = () => renderer!.root.findAllByType(Badge).map((badge) => badge.props.label as string);
const tile = (): ReactTestInstance =>
  renderer!.root.findAll((entry) => entry.props.accessibilityRole === 'checkbox' && typeof entry.props.onPress === 'function')[0];

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  onToggle.mockClear();
  onOpen.mockClear();
});

describe('o selo "Novo" na grade', () => {
  it('no que falta comprar: o selo e o "novo" do leitor de tela, num tom que nenhum outro selo do item usa', async () => {
    await mount({ hint: { isNew: true } });
    expect(badges()).toEqual(['Novo']);
    expect(renderer!.root.findAllByType(Badge)[0].props.tone).toBe('primary');
    expect(tile().props.accessibilityLabel).toBe('Feijão, 1 un, novo');
  });

  it('no carrinho, não', async () => {
    await mount({ hint: { isNew: true }, inCart: true });
    expect(badges()).toEqual([]);
    expect(tile().props.accessibilityLabel).not.toContain('novo');
  });

  it('sem a dica, nenhum selo', async () => {
    await mount({});
    expect(badges()).toEqual([]);
  });
});

describe('a grade só para ver (lista arquivada)', () => {
  it('o item não marca nem abre os detalhes', async () => {
    await mount({ readOnly: true });
    expect(tile().props.disabled).toBe(true);
    expect(tile().props.accessibilityHint).toBeUndefined();
  });

  it('a de sempre marca no toque', async () => {
    await mount({});
    expect(tile().props.disabled).toBe(false);
    act(() => tile().props.onPress());
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });
});

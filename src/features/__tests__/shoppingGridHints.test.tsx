import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Image } from 'expo-image';
import { Platform, StyleSheet, View } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { ListItemEditor } from '@/features/ListItemEditor';
import { type ItemHint, ShoppingGrid } from '@/features/ShoppingGrid';
import type { ShoppingListItem } from '@/lib/types';
import { Badge, Button, CategoryIcon, TextField } from '@/ui/primitives';

// A grade de verdade: o selo "Novo" da ida ao mercado aparece (e o leitor de tela diz "novo") só no que falta
// comprar, e a lista arquivada (só para ver) não marca nem abre os detalhes. No navegador, segurar sobre a
// imagem do item abre os detalhes, não o menu de imagem do Safari.

jest.mock('@/data/listPhotos', () => ({ usePendingPhotoUri: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/ui/art', () => ({}));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@/data/images', () => ({ pickImages: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ errorMessage: (error: unknown) => String(error) }));
jest.mock('@/ui/dialogs', () => ({ confirmAction: jest.fn(), notify: jest.fn() }));

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

async function mount({
  hint,
  inCart = false,
  readOnly = false,
  photo = false,
}: {
  hint?: ItemHint;
  inCart?: boolean;
  readOnly?: boolean;
  /** O item com a foto tirada pela casa (sem ela, o desenho do item). */
  photo?: boolean;
}) {
  const shown = { ...item, checked_at: inCart ? '2026-10-24T14:30:00Z' : null, photo_path: photo ? 'casa/a.jpg' : null };
  await act(async () => {
    renderer = create(
      <ShoppingGrid
        items={[shown]}
        inCart={inCart}
        readOnly={readOnly}
        photos={{ pending: new Map(), signed: photo ? { 'casa/a.jpg': 'https://fotos/a.jpg' } : undefined }}
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
  renderer!.root.findAll((entry) => entry.props.accessibilityRole === 'checkbox' && typeof entry.props.onLongPress === 'function')[0];

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  onToggle.mockClear();
  onOpen.mockClear();
  jest.restoreAllMocks();
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
  it('o toque não marca; segurar ainda abre os detalhes', async () => {
    await mount({ readOnly: true });
    expect(tile().props.onPress).toBeUndefined();
    expect(tile().props.accessibilityHint).toBe('Segure para ver os detalhes');
    act(() => tile().props.onLongPress());
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('a de sempre marca no toque', async () => {
    await mount({});
    act(() => tile().props.onPress());
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });
});

describe('segurar o item no navegador (Safari do iPhone)', () => {
  // Solto e pressionado: o segurar todo acontece com o cartão pressionado, e é aí que o Safari decide o menu.
  const tileStyle = (pressed = false) => StyleSheet.flatten(tile().props.style({ pressed }));
  const images = () => renderer!.root.findAllByType(Image);

  for (const photo of [true, false]) {
    for (const [title, options] of [
      ['falta comprar', {}],
      ['no carrinho', { inCart: true }],
      ['lista arquivada', { readOnly: true }],
    ] as const) {
      it(`${photo ? 'a foto' : 'o desenho'}, ${title}: sem o menu da imagem, e o toque fica com o item`, async () => {
        jest.replaceProperty(Platform, 'OS', 'web');
        await mount({ ...options, photo });
        expect(tileStyle()).toMatchObject({ WebkitTouchCallout: 'none', userSelect: 'none' });
        expect(tileStyle(true)).toMatchObject({ WebkitTouchCallout: 'none', userSelect: 'none' });
        const [image] = images();
        expect(images()).toHaveLength(1);
        expect(image.props.source).toEqual(photo ? { uri: 'https://fotos/a.jpg', cacheKey: 'casa/a.jpg' } : expect.anything());
        expect(StyleSheet.flatten(image.props.style)).toMatchObject({ pointerEvents: 'none' });
        expect(image.props.draggable).toBe(false);
        // O leitor de tela e o segurar de sempre.
        expect(tile().props.accessibilityRole).toBe('checkbox');
        expect(tile().props.accessibilityActions).toEqual([{ name: 'longpress', label: 'Detalhes do item' }]);
        act(() => tile().props.onLongPress());
        expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
      });
    }

    it(`${photo ? 'a foto' : 'o desenho'} no aparelho: nada do navegador`, async () => {
      expect(Platform.OS).toBe('ios');
      await mount({ photo });
      for (const style of [tileStyle(), tileStyle(true)]) {
        expect(style).not.toHaveProperty('WebkitTouchCallout');
        expect(style).not.toHaveProperty('userSelect');
      }
      const [image] = images();
      expect(StyleSheet.flatten(image.props.style)).not.toHaveProperty('pointerEvents');
      expect(image.props.draggable).toBeUndefined();
    });
  }

  for (const backdrop of [false, true]) {
    it(`o desenho fora da lista de compras (${backdrop ? 'na orbe' : 'sem a orbe'}), no navegador: continua como sempre`, async () => {
      jest.replaceProperty(Platform, 'OS', 'web');
      await act(async () => {
        renderer = create(<CategoryIcon category="mercearia" name="Arroz" backdrop={backdrop} />);
      });
      const [image] = images();
      expect(images()).toHaveLength(1);
      expect(StyleSheet.flatten(image.props.style)).not.toHaveProperty('pointerEvents');
      expect(image.props.draggable).toBeUndefined();
    });
  }
});

describe('os detalhes do item só para ver (lista arquivada)', () => {
  it('sem salvar nem remover: o item como está, sem campos nem foto nova', async () => {
    await act(async () => {
      renderer = create(
        <ListItemEditor
          item={{ ...item, notes: 'o carioca', priority: 'urgente' }}
          photoUri={null}
          photoPending={false}
          onClose={jest.fn()}
        />,
      );
    });
    const titles = renderer!.root.findAllByType(Button).map((button) => button.props.title);
    expect(titles).not.toContain('Salvar');
    expect(titles).not.toContain('Remover da lista');
    expect(titles).not.toContain('Tirar foto');
    expect(renderer!.root.findAllByType(TextField)).toHaveLength(0);
    const text = JSON.stringify(renderer!.toJSON());
    expect(text).toContain('o carioca');
    expect(text).toContain('Feijão');
  });

  it('com salvar e remover, o editor de sempre', async () => {
    await act(async () => {
      renderer = create(<ListItemEditor item={item} photoUri={null} photoPending={false} onSave={jest.fn()} onRemove={jest.fn()} onClose={jest.fn()} />);
    });
    const titles = renderer!.root.findAllByType(Button).map((button) => button.props.title);
    expect(titles).toEqual(expect.arrayContaining(['Salvar', 'Remover da lista', 'Tirar foto']));
  });
});

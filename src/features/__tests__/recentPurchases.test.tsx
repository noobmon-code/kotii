import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { ReactElement } from 'react';
import { StyleSheet } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import type { RecentItem } from '@/domain/recentPurchases';
import type { RestockItem } from '@/domain/restock';
import { RecentPurchases, RestockStrip } from '@/features/RecentPurchases';
import { CategoryIcon, Text } from '@/ui/primitives';

// As faixas de cima da lista ("Acho que acabou" e "Comprados recentemente"), de verdade: compactas, para a lista
// começar mais cedo. "Comprados recentemente" mostra só o nome (a quantidade de sempre, o leitor de tela diz);
// "Acho que acabou" mantém o "há N dias", que é o porquê da sugestão, e não uma quantidade.

jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/ui/art', () => ({}));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));

const milk: RecentItem = {
  name: 'Leite desnatado',
  category: 'laticinios',
  productId: 'il',
  quantity: 2,
  unit: 'l',
  times: 3,
  lastAt: '2026-11-10T12:00:00Z',
};
const coffee: RestockItem = {
  name: 'Café',
  category: 'cafe_cha',
  productId: null,
  quantity: 1,
  unit: 'un',
  lastAt: '2026-11-06T12:00:00Z',
  everyDays: 10,
  daysSince: 14,
  boughtAs: [{ name: 'Café Pilão 500g', productId: null }],
};

let renderer: ReactTestRenderer | undefined;

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

async function mount(element: ReactElement) {
  await act(async () => {
    renderer = create(element);
  });
  return renderer!.root;
}

/** O azulejo de cada item: o botão que põe na lista. */
const tiles = (root: ReactTestInstance) =>
  root.findAll((node) => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function', { deep: false });
const words = (node: ReactTestInstance) => node.findAllByType(Text).map((text) => text.props.children);
const tileStyle = (tile: ReactTestInstance) =>
  StyleSheet.flatten(typeof tile.props.style === 'function' ? tile.props.style({ pressed: false }) : tile.props.style);

describe('as faixas de cima da lista', () => {
  it('"Comprados recentemente": só o nome no azulejo; a quantidade, o leitor de tela diz, e o toque põe com ela', async () => {
    const onAdd = jest.fn();
    const root = await mount(<RecentPurchases items={[milk]} onAdd={onAdd} />);
    const [tile] = tiles(root);
    expect(words(tile)).toEqual(['Leite desnatado']);
    expect(tile.props.accessibilityLabel).toBe('Adicionar Leite desnatado, 2 l, comprado 3 vezes');
    await act(async () => tile.props.onPress());
    expect(onAdd).toHaveBeenCalledWith(milk);
  });

  it('"Acho que acabou" mantém o "há N dias" embaixo do nome: é o porquê, e não uma quantidade', async () => {
    const root = await mount(<RestockStrip items={[coffee]} onAdd={jest.fn()} />);
    const [tile] = tiles(root);
    expect(words(tile)).toEqual(['Café', 'há 14 dias']);
    expect(tile.props.accessibilityLabel).toBe('Adicionar Café, 1 un. Costuma comprar a cada 10 dias · última há 14 dias');
  });

  it('compactas: azulejo e desenho menores, o nome em até duas linhas, e o toque continua passando dos 44', async () => {
    const root = await mount(<RecentPurchases items={[milk]} onAdd={jest.fn()} />);
    const [tile] = tiles(root);
    const style = tileStyle(tile);
    expect(style.width).toBe(84);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    expect(style.paddingTop).toBe(8);
    expect(tile.findByType(CategoryIcon).props.size).toBe(36);
    expect(tile.findAllByType(Text)[0].props.numberOfLines).toBe(2);
  });

  it('sem item, a faixa não aparece', async () => {
    const root = await mount(<RecentPurchases items={[]} onAdd={jest.fn()} />);
    expect(tiles(root)).toHaveLength(0);
    expect(renderer!.toJSON()).toBeNull();
  });
});

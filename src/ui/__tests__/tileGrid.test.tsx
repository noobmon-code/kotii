import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { StyleSheet } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { TILE_LABEL_MIN } from '@/domain/tileRow';
import {
  Tile,
  TILE_DENSE_INSET,
  TILE_INSET,
  TILE_LABEL_LINE,
  TILE_LABEL_SIZE,
  TileGrid,
  tileLabelWidth,
  type TileProps,
} from '../primitives';

// A fileira dos atalhos do Resumo da Saúde: quatro numa linha onde a palavra mais larga de cada rótulo cabe, senão
// dois por linha; as medidas que a conta usa são as dos estilos do Tile.

jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockWindow = { width: 360, height: 800, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const TILES: Omit<TileProps, 'dense'>[] = [
  { icon: 'pill', tint: 'green', label: 'Remédio', onPress: () => undefined },
  { icon: 'stethoscope', tint: 'pink', label: 'Consulta', onPress: () => undefined },
  { icon: 'needle', tint: 'purple', label: 'Vacina', onPress: () => undefined },
  { icon: 'test-tube', tint: 'blue', label: 'Exame', onPress: () => undefined },
];

let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  Object.assign(mockWindow, { width: 360, fontScale: 1 });
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

function render(tiles = TILES) {
  act(() => {
    renderer = create(<TileGrid tiles={tiles} />);
  });
}

const grid = () => renderer!.root.find((node) => typeof node.type !== 'string' && typeof node.props.onLayout === 'function');
/** As linhas da grade (as caixas com atalhos dentro): em cada uma, os rótulos dos atalhos (null no espaço vazio). */
const rowNodes = () =>
  grid().findAll(
    (node) => typeof node.type === 'string' && node.children.some((child) => typeof child !== 'string' && child.type === Tile),
  );
const rows = () =>
  rowNodes().map((row) =>
    (row.children as ReactTestInstance[]).map((cell) => (cell.type === Tile ? (cell.props.label as string) : null)),
  );

describe('Tile dense', () => {
  it('as medidas da conta são as dos estilos do Tile', () => {
    act(() => {
      renderer = create(<Tile label="Remédio" icon="pill" onPress={() => undefined} dense />);
    });
    const pressable = renderer!.root.findAll((node) => node.props.accessibilityRole === 'button')[0];
    const style = StyleSheet.flatten(pressable.props.style({ pressed: false }));
    expect(2 * (Number(style.borderWidth) + Number(style.paddingHorizontal))).toBe(TILE_DENSE_INSET);
    const label = renderer!.root.findAll((node) => node.props.children === 'Remédio' && node.props.style)[0];
    expect(StyleSheet.flatten(label.props.style).fontSize).toBe(TILE_LABEL_SIZE);
  });
});

describe('Tile', () => {
  const pressableStyle = () =>
    StyleSheet.flatten(renderer!.root.findAll((node) => node.props.accessibilityRole === 'button')[0].props.style({ pressed: false }));
  const labelNode = (label: string) => renderer!.root.findAll((node) => node.props.children === label && node.props.style && node.props.numberOfLines)[0];

  it('as medidas da conta são as dos estilos do Tile (o de sempre)', () => {
    act(() => {
      renderer = create(<Tile label="Mercado" icon="cart" onPress={() => undefined} />);
    });
    expect(2 * (Number(pressableStyle().borderWidth) + Number(pressableStyle().paddingHorizontal))).toBe(TILE_INSET);
    const style = StyleSheet.flatten(labelNode('Mercado').props.style);
    expect(style.fontSize).toBe(TILE_LABEL_SIZE);
    expect(style.lineHeight).toBe(TILE_LABEL_LINE);
  });

  it('o rótulo da pessoa que cabe fica como sempre; o que não cabe diminui; o que nem assim cabe vai numa linha com "…"', () => {
    const width = tileLabelWidth(360 - 40, 3, 12);
    const render = (label: string) =>
      act(() => {
        renderer?.unmount();
        renderer = create(<Tile label={label} caption="12 a comprar" icon="cart" fitLabelWidth={width} onPress={() => undefined} />);
      });

    render('Mercado');
    expect(StyleSheet.flatten(labelNode('Mercado').props.style).fontSize).toBe(TILE_LABEL_SIZE);
    expect(labelNode('Mercado').props.numberOfLines).toBe(2);

    render('Supermercado');
    const smaller = StyleSheet.flatten(labelNode('Supermercado').props.style).fontSize as number;
    expect(smaller).toBeLessThan(TILE_LABEL_SIZE);
    expect(smaller).toBeGreaterThanOrEqual(TILE_LABEL_MIN);
    expect(labelNode('Supermercado').props.numberOfLines).toBe(2);
    // O leitor de tela diz o nome inteiro e a linha de baixo.
    expect(renderer!.root.findAll((node) => node.props.accessibilityRole === 'button')[0].props.accessibilityLabel).toBe(
      'Supermercado, 12 a comprar',
    );

    render('Hortifrutigranjeiros');
    const cut = labelNode('Hortifrutigranjeiros');
    expect(cut.props.numberOfLines).toBe(1);
    expect(cut.props.ellipsizeMode).toBe('tail');
    expect(StyleSheet.flatten(cut.props.style).fontSize).toBe(TILE_LABEL_MIN);
  });

  it('a largura medida vale mais que a estimada: numa tela mais larga, "Supermercado" volta ao tamanho de sempre', () => {
    act(() => {
      renderer = create(<Tile label="Supermercado" icon="cart" fitLabelWidth={tileLabelWidth(320, 3, 12)} onPress={() => undefined} />);
    });
    expect(StyleSheet.flatten(labelNode('Supermercado').props.style).fontSize).toBeLessThan(TILE_LABEL_SIZE);
    // A caixa do rótulo (o gradiente do Tile também mede a dele).
    const box = renderer!.root
      .findAll((node) => typeof node.type !== 'string' && typeof node.props.onLayout === 'function')
      .find((node) => node.findAll((child) => child.props.children === 'Supermercado').length > 0)!;
    act(() => box.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 140, height: 40 } } }));
    expect(StyleSheet.flatten(labelNode('Supermercado').props.style).fontSize).toBe(TILE_LABEL_SIZE);
    // Uma aba escondida no navegador mede 0: fica o que havia.
    act(() => box.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 0, height: 0 } } }));
    expect(StyleSheet.flatten(labelNode('Supermercado').props.style).fontSize).toBe(TILE_LABEL_SIZE);
  });
});

describe('TileGrid', () => {
  it('numa janela de 360, os quatro numa linha, na ordem', () => {
    render();
    expect(rows()).toEqual([['Remédio', 'Consulta', 'Vacina', 'Exame']]);
  });

  it('numa janela de 320, dois por linha', () => {
    mockWindow.width = 320;
    render();
    expect(rows()).toEqual([
      ['Remédio', 'Consulta'],
      ['Vacina', 'Exame'],
    ]);
  });

  it('com a letra do aparelho maior, dois por linha', () => {
    mockWindow.fontScale = 1.3;
    render();
    expect(rows()).toEqual([
      ['Remédio', 'Consulta'],
      ['Vacina', 'Exame'],
    ]);
  });

  it('a largura medida vale mais que a da janela, e uma medida de 0 (aba escondida) não muda nada', () => {
    render();
    act(() => grid().props.onLayout({ nativeEvent: { layout: { width: 0, height: 0, x: 0, y: 0 } } }));
    expect(rows()).toHaveLength(1);
    act(() => grid().props.onLayout({ nativeEvent: { layout: { width: 280, height: 120, x: 0, y: 0 } } }));
    expect(rows()).toHaveLength(2);
  });

  it('a última linha mais curta ganha um espaço vazio: todos têm a mesma largura', () => {
    // 200 de fileira: três não cabem numa linha, dois cabem.
    mockWindow.width = 240;
    render(TILES.slice(1));
    expect(rows()).toEqual([
      ['Consulta', 'Vacina'],
      ['Exame', null],
    ]);
    const spacer = rowNodes()[1].children[1] as ReactTestInstance;
    expect(StyleSheet.flatten(spacer.props.style).flex).toBe(1);
  });

  it('cada atalho é um botão com o rótulo como nome', () => {
    render();
    const buttons = renderer!.root.findAll((node) => typeof node.type === 'string' && node.props.accessibilityRole === 'button');
    expect(buttons.map((node) => node.props.accessibilityLabel)).toEqual(['Remédio', 'Consulta', 'Vacina', 'Exame']);
  });
});

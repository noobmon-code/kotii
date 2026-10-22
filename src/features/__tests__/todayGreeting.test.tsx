import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { skyTextWidth } from '@/features/SkyHeader';
import { TodayGreeting } from '@/features/TodayGreeting';

// O título da tela Hoje ("Boa noite," e o nome): o nome fica sempre numa linha só, do tamanho que couber ao lado do
// desenho do clima, e o leitor de tela ouve o nome inteiro uma vez, mesmo quando a tela mostra só o primeiro.

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockWindow = { width: 360, height: 800, scale: 3, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => mockWindow,
}));

let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  Object.assign(mockWindow, { width: 360, fontScale: 1 });
});

const NIGHT = new Date(2026, 9, 21, 21, 30);

function show(displayName: string) {
  act(() => {
    renderer = create(<TodayGreeting now={NIGHT} displayName={displayName} />);
  });
  const root = renderer!.root;
  const header = root.find((n) => typeof n.type === 'string' && n.props.accessibilityRole === 'header');
  const name = root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'today-greeting-name');
  return { header, name: name[0] as ReactTestInstance | undefined };
}

const fontSizeOf = (node: ReactTestInstance) =>
  ([node.props.style].flat(Infinity) as ({ fontSize?: number } | null | undefined)[]).reduce<number | undefined>(
    (size, s) => s?.fontSize ?? size,
    undefined,
  );

const textOf = (node: ReactTestInstance): string =>
  node.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');

describe('TodayGreeting', () => {
  it('mede a largura ao lado do desenho do clima em cada janela', () => {
    expect(skyTextWidth(360)).toBe(155);
    expect(skyTextWidth(393)).toBe(188);
    expect(skyTextWidth(412)).toBe(207);
    expect(skyTextWidth(720)).toBe(515);
    // Mais larga que a coluna: a coluna para em 720.
    expect(skyTextWidth(1440)).toBe(515);
  });

  it('no celular de 360: "Boa noite," e o primeiro nome numa linha, o nome inteiro para o leitor de tela', () => {
    const { header, name } = show('André Barbusci');
    expect(header.props.accessible).toBe(true);
    expect(header.props.accessibilityLabel).toBe('Boa noite, André Barbusci');
    expect(textOf(header)).toBe('Boa noite,André');
    expect(name!.props.numberOfLines).toBe(1);
    expect(textOf(name!)).toBe('André');
    expect(fontSizeOf(name!)).toBe(30);
  });

  it('na coluna do navegador (720): o nome inteiro, também numa linha só', () => {
    mockWindow.width = 1280;
    const { header, name } = show('André Barbusci');
    expect(header.props.accessibilityLabel).toBe('Boa noite, André Barbusci');
    expect(name!.props.numberOfLines).toBe(1);
    expect(textOf(name!)).toBe('André Barbusci');
  });

  it('com a letra do sistema maior, encolhe o primeiro nome', () => {
    mockWindow.fontScale = 1.3;
    const { name } = show('Bartolomeu Silva');
    expect(textOf(name!)).toBe('Bartolomeu');
    expect(fontSizeOf(name!)).toBeLessThan(26);
    expect(name!.props.numberOfLines).toBe(1);
  });

  it('no celular de 412: o nome inteiro, um pouco menor', () => {
    mockWindow.width = 412;
    const { name } = show('André Barbusci');
    expect(textOf(name!)).toBe('André Barbusci');
    expect(fontSizeOf(name!)).toBe(27);
  });

  it('depois de medir o título, usa a largura medida; a saudação também fica numa linha', () => {
    mockWindow.width = 412;
    const { header } = show('André Barbusci');
    act(() => header.props.onLayout({ nativeEvent: { layout: { width: 120, height: 70, x: 0, y: 0 } } }));
    const root = renderer!.root;
    const hello = root.find((n) => typeof n.type === 'string' && n.props.testID === 'today-greeting-hello');
    const name = root.find((n) => typeof n.type === 'string' && n.props.testID === 'today-greeting-name');
    expect(textOf(name)).toBe('André');
    expect(hello.props.numberOfLines).toBe(1);
    expect(fontSizeOf(hello)).toBeLessThan(30);
  });

  it('sem nome: só a saudação', () => {
    const { header, name } = show('  ');
    expect(header.props.accessibilityLabel).toBe('Boa noite');
    expect(name).toBeUndefined();
  });
});

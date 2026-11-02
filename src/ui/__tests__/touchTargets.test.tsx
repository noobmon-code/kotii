import { describe, expect, it, jest } from '@jest/globals';
import type { ReactElement } from 'react';
import { Platform, StyleSheet } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { Chip, LinkButton } from '../primitives';
import { space } from '../theme';

// A área de toque do texto de ação azul ("Pôr tudo na lista"): 44 de altura, sem invadir o cartão de baixo.

jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));

describe('LinkButton', () => {
  it('chega a 44 de altura de toque, e embaixo não passa do espaço até o cartão da seção', async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<LinkButton title="Pôr tudo na lista" onPress={() => {}} />);
    });
    const button = renderer!.root.findAll((node) => node.props.accessibilityRole === 'button')[0];
    const { top, bottom, left, right } = button.props.hitSlop;
    const text = renderer!.root.findAll((node) => node.props.children === 'Pôr tudo na lista' && node.props.style)[0];
    const { lineHeight } = StyleSheet.flatten(text.props.style);
    expect(top + lineHeight + bottom).toBeGreaterThanOrEqual(44);
    // A seção põe space.sm entre o título (onde fica o botão) e o cartão.
    expect(bottom).toBeLessThanOrEqual(space.sm);
    expect([left, right]).toEqual([8, 8]);
    await act(async () => renderer!.unmount());
  });
});

describe('Chip', () => {
  async function render(element: ReactElement) {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(element);
    });
    const pressable = renderer!.root.findAll((node) => node.props.accessibilityRole === 'button')[0];
    return { renderer: renderer!, pressable };
  }

  it('chega a 44 de altura de toque, e as áreas de duas linhas de selos (8 entre elas) não se cruzam', async () => {
    const { renderer, pressable } = await render(<Chip label="Elogio" onPress={() => {}} />);
    const { top, bottom } = pressable.props.hitSlop;
    const box = StyleSheet.flatten(pressable.props.style);
    // O texto desenhado (o de dentro, com a altura de linha do estilo do rótulo).
    const text = renderer.root.findAll((node) => typeof node.type === 'string' && node.props.children === 'Elogio')[0];
    const { lineHeight } = StyleSheet.flatten(text.props.style);
    expect(top + box.paddingVertical * 2 + box.borderWidth * 2 + lineHeight + bottom).toBeGreaterThanOrEqual(44);
    expect(top + bottom).toBeLessThanOrEqual(space.sm);
    await act(async () => renderer.unmount());
  });

  it('parado, não responde, fica esmaecido e o leitor de tela diz que está desativado', async () => {
    const onPress = jest.fn();
    const { renderer, pressable } = await render(<Chip label="Elogio" selected toggle disabled onPress={onPress} />);
    expect(pressable.props.disabled).toBe(true);
    expect(pressable.props.accessibilityState).toEqual({ selected: true, disabled: true });
    expect(StyleSheet.flatten(pressable.props.style).opacity).toBe(0.5);
    await act(async () => renderer.unmount());
  });

  describe('no navegador', () => {
    it('só o selo que liga e desliga é um botão pressionado (aria-pressed); o que tira um filtro, não', async () => {
      const web = jest.replaceProperty(Platform, 'OS', 'web');
      try {
        const pressed = async (element: ReactElement) => {
          const { renderer, pressable } = await render(element);
          const value = pressable.props['aria-pressed'];
          await act(async () => renderer.unmount());
          return value;
        };
        expect(await pressed(<Chip label="Elogio" toggle selected onPress={() => {}} />)).toBe(true);
        expect(await pressed(<Chip label="Elogio" toggle selected={false} onPress={() => {}} />)).toBe(false);
        expect(await pressed(<Chip label="Elogio" toggle onPress={() => {}} />)).toBe(false);
        // Como os de Mercado do mês (categoria, mercado) e o de Lançamentos: marcados, mas o toque tira o filtro.
        expect(await pressed(<Chip label="Moradia" icon="close" selected onPress={() => {}} />)).toBeUndefined();
        expect(
          await pressed(<Chip label="Atacadão" icon="close" selected accessibilityLabel="Atacadão: mostrar todos os mercados" onPress={() => {}} />),
        ).toBeUndefined();
        // E o que abre uma escolha ("Onde estou").
        expect(await pressed(<Chip label="Onde estou: Atacadão" icon="store-outline" selected onPress={() => {}} />)).toBeUndefined();
      } finally {
        web.restore();
      }
    });
  });
});

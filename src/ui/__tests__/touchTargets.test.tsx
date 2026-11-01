import { describe, expect, it, jest } from '@jest/globals';
import { StyleSheet } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { HeaderButton } from '../FeatureCard';
import { LinkButton } from '../primitives';
import { space } from '../theme';

// A área de toque do texto de ação azul ("Pôr tudo na lista"): 44 de altura, sem invadir o cartão de baixo. E a do
// botão redondo do topo (a engrenagem da Família): 44 pela própria caixa, porque o `hitSlop` não vale no navegador.

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

describe('HeaderButton', () => {
  it('a caixa do toque tem 44 por 44 em toda plataforma, sem depender do hitSlop', async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = create(<HeaderButton icon="cog-outline" label="Configurações" onPress={() => {}} />);
    });
    const button = renderer!.root.findAll((node) => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === 'Configurações')[0];
    const style = typeof button.props.style === 'function' ? button.props.style({ pressed: false }) : button.props.style;
    const { width, height } = StyleSheet.flatten(style);
    expect(width).toBeGreaterThanOrEqual(44);
    expect(height).toBeGreaterThanOrEqual(44);
    expect(button.props.hitSlop).toBeUndefined();
    await act(async () => renderer!.unmount());
  });
});

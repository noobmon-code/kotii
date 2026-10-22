import { describe, expect, it, jest } from '@jest/globals';
import { StyleSheet } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { LinkButton } from '../primitives';
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

import type { RefObject } from 'react';
import { AccessibilityInfo, Platform, type View } from 'react-native';

/**
 * Leva o foco (o do teclado na web, o do leitor de tela no celular) para um elemento que acabou de voltar à tela,
 * quando o que tinha o foco saiu dela (um formulário que fecha e devolve o lugar ao botão que o abriu). Sem isso, a
 * web devolve o foco ao começo da página e o VoiceOver/TalkBack perde o lugar.
 *
 * Espera o próximo quadro: o elemento só existe depois de o React desenhar a mudança que o trouxe de volta.
 */
export function moveFocus(target: RefObject<View | null>) {
  requestAnimationFrame(() => {
    const node = target.current;
    if (!node) return;
    if (Platform.OS === 'web') (node as unknown as { focus?: () => void }).focus?.();
    else AccessibilityInfo.sendAccessibilityEvent(node, 'focus');
  });
}

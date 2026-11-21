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

/**
 * O menu de ações (ActionSheet) cuja opção acabou de ser escolhida, no navegador: a caixa dele na página (`menu`) e
 * quem tinha o foco quando ele abriu (`opener`, o "Adicionar"). A opção que abre uma tela em janela
 * (features/desktop/RouteWindow) deixa isto para ela: quando a janela abre, o foco ainda está na opção, que sai da
 * página com o menu, e é para quem abriu o menu que o foco volta quando a janela fecha (windowFocus: windowOpener).
 */
export interface MenuOpener {
  menu: unknown;
  opener: unknown;
}

let lastMenuOpener: MenuOpener | null = null;

/** O menu diz quem o abriu, logo antes de rodar a opção escolhida (só no navegador). */
export function handMenuOpener(handed: MenuOpener | null): void {
  lastMenuOpener = handed;
}

/**
 * O último menu que rodou uma opção. Não se apaga ao ler: quem lê (a janela) só usa quando o foco ainda está dentro
 * desse menu, e um menu fechado já saiu da página.
 */
export function menuOpener(): MenuOpener | null {
  return lastMenuOpener;
}

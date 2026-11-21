// As telas que no celular sobem como janela por cima das outras (editar uma tarefa, um remédio, uma consulta, o
// Nuke…: `presentation: 'modal'` no Stack da raiz) e que no navegador eram uma página como as outras. No computador
// (domain/desktop), elas abrem numa caixa no meio da janela, com o app escurecido atrás, como as janelas de
// formulário (ui/SheetModal): a barra lateral e a tela de onde a pessoa veio continuam à vista. No celular, e na
// janela estreita do navegador, tudo como era.
//
// Como: no computador a tela entra no Stack como `transparentModal`, e o Stack do navegador deixa a tela de baixo
// desenhada atrás dela; o cabeçalho do Stack, que iria no alto da janela inteira, fica vazio, e o título vai na
// barra da caixa. A caixa é desenhada em volta da tela pelo `screenLayout` do Stack (`routeWindowLayout`), sempre com
// as mesmas caixas no navegador, só com outro estilo: a janela que cruza a largura do computador com uma dessas
// telas aberta não a monta de novo (e não perde o que foi digitado).

import { router, type Href } from 'expo-router';
import { useIsFocused } from 'expo-router/react-navigation';
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View, type ViewStyle } from 'react-native';

import { DESKTOP_WINDOW_WIDTH, windowFallback, windowHeight } from '@/domain/desktop';
import { useDesktop } from '@/ui/desktop';
import { IconButton, Row, Text } from '@/ui/primitives';
import { radius, shadows, space, useColors } from '@/ui/theme';

import { restoreFocus, trapWindowFocus, WINDOW_TEST_ID } from './windowFocus';

/** O que a tela diz de si no Stack (as opções dela) e que a caixa usa. */
interface WindowScreenOptions {
  title?: string;
  headerShown?: boolean;
  presentation?: string;
}

/** O que o `screenLayout` do Stack dá de cada tela, só com o que a caixa lê. */
interface WindowLayoutArgs {
  route: { name: string };
  navigation: { canGoBack: () => boolean; goBack: () => void };
  options: WindowScreenOptions;
  children: ReactElement;
}

/** O nome do botão de fechar a caixa. */
export const WINDOW_CLOSE_LABEL = 'Fechar';

/**
 * As opções de uma dessas telas no Stack da raiz. No celular, a janela que sobe de sempre (`modal`). No computador,
 * por cima da tela de antes, que continua desenhada atrás (o Stack do navegador só deixa à vista a tela de baixo de
 * uma `transparentModal`), sem o fundo da tela e com o cabeçalho do Stack vazio: o fundo escurecido e o título são da
 * caixa (RouteWindow). `headerShown: false` (o Nuke, a conversa do consultor, que desenham o próprio alto) continua
 * dizendo que a caixa não leva a barra do título; essas dizem o nome da janela em `name` (o que o leitor de tela fala
 * ao abrir a caixa), que no computador vira o título dela, e no celular não muda nada (sem cabeçalho, como sempre).
 */
export function windowOptions<T extends { title: string; headerShown?: boolean }>(desktop: boolean, options: T): T & WindowPresentation;
export function windowOptions<T extends { headerShown: false }>(desktop: boolean, options: T, name: string): T & WindowPresentation;
export function windowOptions(desktop: boolean, options: WindowScreenOptions, name?: string) {
  if (!desktop) return { ...options, presentation: 'modal' as const };
  return {
    ...options,
    title: options.title ?? name,
    presentation: 'transparentModal' as const,
    header: () => null,
    contentStyle: { backgroundColor: 'transparent' },
  };
}

/** O que `windowOptions` põe nas opções da tela (no celular, só a apresentação). */
type WindowPresentation = {
  presentation: 'modal' | 'transparentModal';
  title?: string;
  header?: () => null;
  contentStyle?: { backgroundColor: string };
};

/** É uma das telas em janela (pela apresentação que as opções dela pedem, a do celular ou a do computador). */
function isWindow(options: WindowScreenOptions): boolean {
  return options.presentation === 'modal' || options.presentation === 'transparentModal';
}

/**
 * O `screenLayout` do Stack da raiz: põe cada tela em janela dentro da caixa (RouteWindow). As outras telas, e todas
 * no celular e no tablet, ficam como eram, sem nada em volta.
 */
export function routeWindowLayout({ route, navigation, options, children }: WindowLayoutArgs): ReactElement {
  if (Platform.OS !== 'web' || !isWindow(options)) return children;
  return (
    <RouteWindow
      title={options.title}
      titleBar={options.headerShown !== false}
      onClose={() => {
        // Sem tela para onde voltar (a página aberta direto pelo endereço), a aba da área da tela.
        if (navigation.canGoBack()) navigation.goBack();
        else router.replace(windowFallback(route.name) as Href);
      }}>
      {children}
    </RouteWindow>
  );
}

/**
 * A caixa de uma tela em janela, no navegador. No computador: o fundo escurecido por cima da janela inteira (a barra
 * lateral também, como nas janelas de formulário), a caixa no meio com a barra do título e o "Fechar", e o Esc que
 * fecha. Na janela estreita, as mesmas caixas ocupando a tela, sem nada a mais: a página de sempre.
 */
export function RouteWindow({
  title,
  titleBar,
  onClose,
  children,
}: {
  title?: string;
  /** A tela tem cabeçalho no celular: na caixa, ele vira a barra do título. Sem ele (o Nuke), o alto é o da tela. */
  titleBar: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const c = useColors();
  const desktop = useDesktop();
  const focused = useIsFocused();
  const { height } = useWindowDimensions();
  const box = useRef<View>(null);
  // O fechar de agora, para a tecla não pegar um de antes.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  // Quem tinha o foco quando a janela abriu (lido no primeiro desenho, antes de um campo com foco automático tomá-lo):
  // ao fechar, ele volta para lá.
  const [opener] = useState(() => (typeof document === 'undefined' ? null : document.activeElement));
  const live = useRef({ desktop });
  useEffect(() => {
    live.current.desktop = desktop;
  });
  useEffect(() => {
    const state = live.current;
    return () => {
      // Só no computador: na janela estreita a tela é uma página, como sempre foi.
      if (state.desktop && typeof document !== 'undefined') restoreFocus(document, opener);
    };
  }, [opener]);

  // Como as janelas de formulário: o Esc fecha, e o foco do teclado fica dentro da caixa (não vai para a tela de trás
  // nem para a barra lateral, escurecidas; o Tab e o Shift+Tab dão a volta nela). Só a caixa da tela aberta (uma em
  // cima da outra, a de baixo não responde), e nunca com um menu ou um formulário aberto por cima dela (eles têm o
  // próprio Esc e o próprio foco). As regras, em windowFocus.
  useEffect(() => {
    if (!desktop || !focused || typeof document === 'undefined') return;
    const node = box.current as unknown as HTMLElement | null;
    if (!node) return;
    return trapWindowFocus(document, node, () => close.current());
  }, [desktop, focused]);

  return (
    <View style={desktop ? [dim, styles.dim] : styles.flex}>
      <View
        ref={box}
        testID={WINDOW_TEST_ID}
        role={desktop ? 'dialog' : undefined}
        aria-modal={desktop ? true : undefined}
        aria-label={desktop ? title : undefined}
        tabIndex={desktop ? -1 : undefined}
        style={
          desktop
            ? [
                styles.box,
                { height: windowHeight(height), backgroundColor: c.background, borderColor: c.glassBorder, boxShadow: shadows.float },
              ]
            : styles.flex
        }>
        {desktop && titleBar ? (
          <Row style={[styles.titleBar, { borderBottomColor: c.glassBorder }]}>
            <Text variant="heading" accessibilityRole="header" numberOfLines={1} style={styles.flex}>
              {title ?? ''}
            </Text>
            <IconButton icon="close" label={WINDOW_CLOSE_LABEL} onPress={onClose} />
          </Row>
        ) : null}
        <View style={styles.flex}>{children}</View>
      </View>
    </View>
  );
}

// Só do navegador: `fixed` (por cima da janela inteira, a barra lateral também, de onde quer que a caixa esteja na
// árvore) não está nos tipos do React Native, e o react-native-web o passa para o CSS. Acima do cabeçalho da tela de
// trás (zIndex 1) e abaixo dos menus e formulários do react-native-web (zIndex 9999), que abrem por cima da caixa.
const dim = { position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, zIndex: 100 } as unknown as ViewStyle;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  dim: { alignItems: 'center', justifyContent: 'center', padding: space.xl, backgroundColor: 'rgba(0,0,0,0.4)' },
  box: {
    width: '100%',
    maxWidth: DESKTOP_WINDOW_WIDTH,
    borderWidth: 1,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    overflow: 'hidden',
    outlineWidth: 0,
  },
  titleBar: {
    paddingLeft: space.xl,
    paddingRight: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});

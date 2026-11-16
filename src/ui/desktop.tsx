// O arranjo do computador (domain/desktop): saber se a janela é de computador e pôr o conteúdo em duas colunas.
// No celular (e na janela estreita do navegador) nada daqui muda a tela: uma coluna, na ordem de sempre.

import { createContext, useContext, type ReactNode } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';

import { DESKTOP_SIDE_MAX_SHARE, DESKTOP_SIDE_WIDTH, isDesktop, SIDEBAR_SPACE } from '@/domain/desktop';
import { space } from './theme';

/** A janela é de computador: o navegador, numa janela larga. Acompanha a janela quando ela muda de tamanho. */
export function useDesktop(): boolean {
  const { width } = useWindowDimensions();
  return isDesktop(Platform.OS === 'web', width);
}

/** A barra lateral está na tela (quem diz é o layout da raiz, que a desenha): fora de uma casa, e no celular, não. */
export const SidebarContext = createContext(false);

/**
 * A largura do lugar das telas: a da janela, menos a barra lateral quando ela está na tela. Para a tela que se
 * arruma pela largura que tem (as colunas do Painel do app): com a barra ao lado, a conta pela janela inteira
 * daria colunas demais.
 */
export function useAreaWidth(): number {
  const { width } = useWindowDimensions();
  return useContext(SidebarContext) ? width - SIDEBAR_SPACE : width;
}

/**
 * Duas colunas no computador: a principal (`children`), que fica com a sobra, e a do lado (`side`), de largura
 * fixa, à direita. No celular os dois ficam soltos na tela, um embaixo do outro, como eram antes das colunas: a do
 * lado depois da principal, ou antes dela com `sideFirst` (as ações do alto de uma parte: no computador elas ficam
 * à direita, mas continuam vindo antes na ordem do teclado e do leitor de tela, como no celular). `gap` é o espaço
 * entre as partes dentro de cada coluna (o mesmo que a tela ou o painel põe entre elas no celular).
 */
export function Columns({
  children,
  side,
  sideFirst,
  sideWidth = DESKTOP_SIDE_WIDTH,
  gap = space.xl,
}: {
  children: ReactNode;
  side: ReactNode;
  sideFirst?: boolean;
  sideWidth?: number;
  gap?: number;
}) {
  const desktop = useDesktop();
  if (!desktop) {
    return (
      <>
        {sideFirst ? side : null}
        {children}
        {sideFirst ? null : side}
      </>
    );
  }
  const main = (
    <View key="main" style={[styles.main, { gap }]}>
      {children}
    </View>
  );
  const aside = (
    <View key="side" style={[styles.side, { width: sideWidth, gap }]}>
      {side}
    </View>
  );
  // Com a do lado primeiro na ordem, a linha é desenhada ao contrário: ela continua à direita.
  return <View style={[styles.columns, sideFirst && styles.reverse]}>{sideFirst ? [aside, main] : [main, aside]}</View>;
}

/**
 * As ações do alto de uma parte que fica numa coluna larga (os botões de criar e de abrir outra tela): no
 * computador, lado a lado e do tamanho do rótulo, em vez de cada uma esticada pela coluna. No celular, uma embaixo
 * da outra, da largura da tela, como sempre.
 */
export function Actions({ children }: { children: ReactNode }) {
  const desktop = useDesktop();
  if (!desktop) return <>{children}</>;
  return <View style={styles.actions}>{children}</View>;
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xl },
  reverse: { flexDirection: 'row-reverse' },
  // minWidth 0: sem isto, um texto comprido na coluna principal a alargaria e empurraria a do lado para fora.
  main: { flex: 1, minWidth: 0 },
  // Na janela estreita do computador, a do lado encolhe para a principal não ficar mais apertada que num celular.
  side: { maxWidth: `${DESKTOP_SIDE_MAX_SHARE * 100}%` },
});

// O arranjo do computador (domain/desktop): saber se a janela é de computador e pôr o conteúdo em duas colunas.
// No celular (e na janela estreita do navegador) nada daqui muda a tela: uma coluna, na ordem de sempre.

import { createContext, useContext, type ReactNode } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View, type ViewStyle } from 'react-native';

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
 * O que o fundo escurecido das caixas no meio da janela (as janelas de formulário e de foto, as telas em janela, o
 * menu de ações) acrescenta quando a barra lateral está na tela: a margem da esquerda pula a barra, e a caixa fica no
 * meio do lugar ao lado dela (o mesmo meio da coluna das telas), sem cobrir a barra, que continua à vista, escurecida.
 * Fora do computador, ou sem a barra (fora de uma casa), nada: a caixa fica no meio da janela.
 */
export function useBoxArea(): ViewStyle | null {
  const desktop = useDesktop();
  const sidebar = useContext(SidebarContext);
  return desktop && sidebar ? { paddingLeft: SIDEBAR_SPACE + space.xl } : null;
}

/**
 * Duas colunas no computador: a principal (`children`), que fica com a sobra, e a do lado (`side`), de largura
 * fixa, à direita. No celular os dois ficam soltos na tela, um embaixo do outro, como eram antes das colunas: a do
 * lado depois da principal, ou antes dela com `sideFirst` (as ações do alto de uma parte: no computador elas ficam
 * à direita, mas continuam vindo antes na ordem do teclado e do leitor de tela, como no celular). `gap` é o espaço
 * entre as partes dentro de cada coluna (o mesmo que a tela ou o painel põe entre elas no celular).
 *
 * No navegador as caixas das colunas existem em qualquer largura, na mesma ordem e com as mesmas chaves: na janela
 * estreita elas não desenham caixa nenhuma (`display: contents`: o que está dentro fica solto na tela, como no
 * celular, com os mesmos pixels), e a janela que cruza a largura do computador só troca o estilo delas, sem montar de
 * novo o que está dentro (o peso digitado num item da nota). Só vale para o que fica nas mesmas colunas nas duas
 * larguras: a parte que desenha outra coisa em cada uma (Casa → Dia a dia e Finanças, os dois painéis lado a lado no
 * computador e o seletor com um deles no celular) monta de novo o que mostra ao cruzar, e o dia escolhido na agenda
 * volta para hoje. No celular e no tablet, sem caixa nenhuma, como sempre.
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
  if (Platform.OS !== 'web') {
    return (
      <>
        {sideFirst ? side : null}
        {children}
        {sideFirst ? null : side}
      </>
    );
  }
  const main = (
    <View key="main" style={desktop ? [styles.main, { gap }] : loose}>
      {children}
    </View>
  );
  const aside = (
    <View key="side" style={desktop ? [styles.side, { width: sideWidth, gap }] : loose}>
      {side}
    </View>
  );
  // Com a do lado primeiro na ordem, a linha é desenhada ao contrário: ela continua à direita.
  return (
    <View style={desktop ? [styles.columns, sideFirst && styles.reverse] : loose}>{sideFirst ? [aside, main] : [main, aside]}</View>
  );
}

/**
 * As ações do alto de uma parte que fica numa coluna larga (os botões de criar e de abrir outra tela): no
 * computador, lado a lado e do tamanho do rótulo, em vez de cada uma esticada pela coluna (com `end`, encostadas à
 * direita: as do rodapé da revisão da nota, embaixo da coluna do lado). No celular, uma embaixo da outra, da largura
 * da tela, como sempre (no navegador estreito, na mesma caixa, que lá não desenha nada, como as colunas).
 */
export function Actions({ children, end }: { children: ReactNode; end?: boolean }) {
  const desktop = useDesktop();
  if (Platform.OS !== 'web') return <>{children}</>;
  return <View style={desktop ? [styles.actions, end && styles.actionsEnd] : loose}>{children}</View>;
}

/**
 * Uma caixa que não desenha nada (só no navegador): o que está dentro fica solto no lugar dela, como se ela não
 * existisse. O que deixa as colunas no lugar, na janela estreita, para a janela que cruza a largura não as montar de
 * novo.
 */
const loose: ViewStyle = { display: 'contents' };

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md },
  actionsEnd: { justifyContent: 'flex-end' },
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xl },
  reverse: { flexDirection: 'row-reverse' },
  // minWidth 0: sem isto, um texto comprido na coluna principal a alargaria e empurraria a do lado para fora.
  main: { flex: 1, minWidth: 0 },
  // Na janela estreita do computador, a do lado encolhe para a principal não ficar mais apertada que num celular.
  side: { maxWidth: `${DESKTOP_SIDE_MAX_SHARE * 100}%` },
});

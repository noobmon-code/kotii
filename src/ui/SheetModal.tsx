// As janelas de formulário do app (editar um item, renomear, escolher numa lista, a calculadora). No celular, a
// tela inteira, subindo do rodapé, como sempre foram. No computador (ui/desktop), uma caixa no meio da janela, com o
// app escurecido atrás: a barra lateral e a tela de onde a pessoa veio continuam à vista.

import type { ReactNode } from 'react';
import { Modal, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DESKTOP_SHEET_WIDTH, sheetHeights } from '@/domain/desktop';
import { Backdrop } from './Backdrop';
import { useDesktop } from './desktop';
import { radius, shadows, space, useColors } from './theme';

export function SheetModal({
  visible = true,
  onClose,
  onShow,
  onDismiss,
  tall,
  children,
}: {
  visible?: boolean;
  /** O voltar do Android e, no navegador, a tecla Esc. A caixa do computador não fecha no clique fora dela: quem estava digitando perderia o que escreveu. */
  onClose: () => void;
  onShow?: () => void;
  onDismiss?: () => void;
  /**
   * No computador, a caixa tem altura fixa em vez de acompanhar o conteúdo: para as listas de escolher, que mudam
   * de tamanho a cada letra da busca.
   */
  tall?: boolean;
  children: ReactNode;
}) {
  const c = useColors();
  const desktop = useDesktop();
  const { height } = useWindowDimensions();
  const heights = sheetHeights(height);
  // As mesmas caixas nos dois arranjos, só com outro estilo: a janela que cruza a largura do computador com um
  // formulário aberto não o monta de novo (e não perde o que foi digitado).
  return (
    <Modal
      visible={visible}
      transparent={desktop}
      animationType={desktop ? 'fade' : 'slide'}
      onRequestClose={onClose}
      onShow={onShow}
      onDismiss={onDismiss}>
      <SafeAreaView style={desktop ? styles.dim : [styles.flex, { backgroundColor: c.background }]}>
        {desktop ? null : <Backdrop />}
        <View
          testID="sheet-frame"
          style={
            desktop
              ? [
                  styles.box,
                  { backgroundColor: c.background, borderColor: c.glassBorder, boxShadow: shadows.float },
                  tall ? { height: heights.tall } : { maxHeight: heights.max },
                ]
              : styles.flex
          }>
          {children}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  dim: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, backgroundColor: 'rgba(0,0,0,0.4)' },
  box: {
    width: '100%',
    maxWidth: DESKTOP_SHEET_WIDTH,
    borderWidth: 1,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
});

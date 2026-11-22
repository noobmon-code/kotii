import { useRef, useState, type ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DESKTOP_DIALOG_WIDTH } from '@/domain/desktop';
import { useBoxArea, useDesktop } from './desktop';
import { handMenuOpener } from './focus';
import { Icon, Text, type IconName } from './primitives';
import { MAX_WIDTH, radius, shadows, space, useColors } from './theme';

export interface SheetAction {
  label: string;
  icon?: IconName;
  destructive?: boolean;
  onPress: () => void;
}

/**
 * Menu de ações de baixo para cima, igual em iOS, Android e web. `children` é
 * o que a tela mostra junto (ex.: a prévia do texto que vai ser mandado):
 * fica entre o título e as ações e rola com elas. No computador (ui/desktop)
 * o mesmo menu é uma caixa no meio da janela, e não uma folha presa ao rodapé.
 */
export function ActionSheet({
  visible,
  title,
  message,
  actions,
  onClose,
  onClosed,
  children,
  cancelLabel = 'Cancelar',
}: {
  visible: boolean;
  title?: string;
  message?: string;
  actions: SheetAction[];
  onClose: () => void;
  /**
   * O menu já saiu e a ação escolhida já rodou: no iOS, quando ele acaba de descer (o onDismiss do Modal); nos outros,
   * logo depois do `onClose` (lá a ação roda na hora). É o momento de quem tira o menu da tela ao fechar (desmonta o
   * menu, ou a parte que o tem): desmontado antes disso, no iOS, o menu leva junto a ação que esperava ele descer.
   */
  onClosed?: () => void;
  children?: ReactNode;
  /** O botão que fecha sem escolher nada, quando "Cancelar" não diz o que acontece ("Deixar como está"). */
  cancelLabel?: string;
}) {
  const c = useColors();
  const { height } = useWindowDimensions();
  const desktop = useDesktop();
  // Com a barra lateral na tela, a caixa fica no meio do lugar ao lado dela, como as janelas (ui/desktop).
  const area = useBoxArea();
  // No iOS, abrir câmera/galeria enquanto o modal fecha falha em silêncio:
  // a ação escolhida roda só depois que o modal some (onDismiss).
  const pending = useRef<(() => void) | null>(null);
  // No navegador, quem tinha o foco quando o menu abriu (o "Adicionar"), lido no desenho que o abre, antes de o foco
  // entrar no menu. A opção escolhida o passa adiante (ui/focus): a tela em janela que ela abre devolve o foco a ele
  // ao fechar, porque a opção some com o menu.
  const [opened, setOpened] = useState<{ visible: boolean; opener: unknown }>({ visible: false, opener: null });
  if (Platform.OS === 'web' && visible !== opened.visible) {
    setOpened({ visible, opener: visible && typeof document !== 'undefined' ? document.activeElement : opened.opener });
  }
  const menu = useRef<View>(null);
  const ios = Platform.OS === 'ios';
  const close = () => {
    onClose();
    if (!ios) onClosed?.();
  };
  const run = (action: () => void) => {
    if (ios) pending.current = action;
    onClose();
    if (Platform.OS === 'web') handMenuOpener({ menu: menu.current, opener: opened.opener });
    if (!ios) {
      action();
      onClosed?.();
    }
  };
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={close}
      onDismiss={() => {
        const action = pending.current;
        pending.current = null;
        action?.();
        // O onDismiss é só do iOS (no navegador, o react-native-web também o chama: lá o `onClosed` já veio no fechar).
        if (ios) onClosed?.();
      }}>
      <Pressable
        ref={menu}
        style={[styles.backdrop, desktop && styles.backdropDesktop, area]}
        onPress={close}
        accessibilityLabel="Fechar">
        <SafeAreaView edges={['bottom']} style={[styles.anchor, desktop && styles.anchorDesktop]}>
          <Pressable
            style={[
              styles.sheet,
              desktop && styles.sheetDesktop,
              { backgroundColor: c.surface, borderColor: c.glassBorder, maxHeight: height * 0.85 },
            ]}>
            {title ? <Text variant="heading">{title}</Text> : null}
            {/* Só o título e o Cancelar ficam fixos. O resto rola junto: mensagem longa, muitas ações (uma por compra
                na despensa) e o que a tela pôs no menu. Numa tela baixa (o celular deitado), a prévia e o aviso
                fixos deixariam as ações sem espaço para tocar. */}
            <ScrollView style={styles.scroll} contentContainerStyle={styles.gap} bounces={false}>
              {children}
              {message ? <Text variant="muted">{message}</Text> : null}
              <View style={styles.actions}>
                {actions.map((action, index) => (
                  <Pressable
                    key={`${index}:${action.label}`}
                    accessibilityRole="button"
                    onPress={() => run(action.onPress)}
                    style={({ pressed }) => [
                      styles.action,
                      { borderTopColor: c.border },
                      pressed && { backgroundColor: c.surfaceAlt },
                    ]}>
                    {action.icon ? <Icon name={action.icon} color={action.destructive ? 'danger' : 'text'} /> : null}
                    <Text variant="body" color={action.destructive ? 'danger' : 'text'}>
                      {action.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              onPress={close}
              style={({ pressed }) => [styles.action, { borderTopColor: c.border }, pressed && { backgroundColor: c.surfaceAlt }]}>
              <Text variant="label" color="textMuted">
                {cancelLabel}
              </Text>
            </Pressable>
          </Pressable>
        </SafeAreaView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  backdropDesktop: { justifyContent: 'center', padding: space.xl },
  anchor: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  anchorDesktop: { maxWidth: DESKTOP_DIALOG_WIDTH },
  // A caixa do computador: os quatro cantos redondos, a borda em volta e a sombra de quem flutua.
  sheetDesktop: { borderWidth: 1, borderRadius: radius.lg, borderCurve: 'continuous', boxShadow: shadows.float },
  sheet: {
    borderTopWidth: 1,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    gap: space.sm,
  },
  scroll: { flexGrow: 0, flexShrink: 1 },
  gap: { gap: space.sm },
  actions: { marginTop: space.sm },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});

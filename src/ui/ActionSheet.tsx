import { useRef, type ReactNode } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon, Text, type IconName } from './primitives';
import { MAX_WIDTH, radius, space, useColors } from './theme';

export interface SheetAction {
  label: string;
  icon?: IconName;
  destructive?: boolean;
  onPress: () => void;
}

/**
 * Menu de ações de baixo para cima, igual em iOS, Android e web. `children` é
 * o que a tela mostra junto (ex.: a prévia do texto que vai ser mandado):
 * fica entre o título e as ações e rola com elas.
 */
export function ActionSheet({
  visible,
  title,
  message,
  actions,
  onClose,
  children,
}: {
  visible: boolean;
  title?: string;
  message?: string;
  actions: SheetAction[];
  onClose: () => void;
  children?: ReactNode;
}) {
  const c = useColors();
  const { height } = useWindowDimensions();
  // No iOS, abrir câmera/galeria enquanto o modal fecha falha em silêncio:
  // a ação escolhida roda só depois que o modal some (onDismiss).
  const pending = useRef<(() => void) | null>(null);
  const run = (action: () => void) => {
    if (Platform.OS === 'ios') pending.current = action;
    onClose();
    if (Platform.OS !== 'ios') action();
  };
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onDismiss={() => {
        const action = pending.current;
        pending.current = null;
        action?.();
      }}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Fechar">
        <SafeAreaView edges={['bottom']} style={styles.anchor}>
          <Pressable
            style={[styles.sheet, { backgroundColor: c.surface, borderColor: c.glassBorder, maxHeight: height * 0.85 }]}>
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
              onPress={onClose}
              style={({ pressed }) => [styles.action, { borderTopColor: c.border }, pressed && { backgroundColor: c.surfaceAlt }]}>
              <Text variant="label" color="textMuted">
                Cancelar
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
  anchor: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
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

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, StyleSheet, type ColorValue } from 'react-native';

import { LIST_MENU_LABEL, LIST_MENU_LABELS, listMenuActions, type ListMenuAction } from '@/domain/listMode';
import { ActionSheet } from '@/ui/ActionSheet';
import type { IconName } from '@/ui/primitives';
import { useColors } from '@/ui/theme';

const ICONS: Record<ListMenuAction, IconName> = {
  rename: 'pencil-outline',
  archive: 'archive-outline',
  reopen: 'archive-arrow-up-outline',
};

/**
 * O botão do menu da lista, no cabeçalho, ao lado da calculadora (headerRight). O toque tem 44, e o leitor de tela
 * diz "Opções da lista". Abre o `ListMenu`, que a tela desenha (o cabeçalho só tem o botão).
 */
export function ListMenuButton({ onPress, tintColor }: { onPress: () => void; tintColor?: ColorValue }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={LIST_MENU_LABEL}
      onPress={onPress}
      style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}>
      <MaterialCommunityIcons name="dots-vertical" size={24} color={tintColor ?? c.primary} />
    </Pressable>
  );
}

/**
 * O menu da lista: renomear e arquivar (na arquivada, reabrir). As perguntas e os avisos de cada ação são os de
 * sempre, de quem passa `onAction`. O mesmo menu de baixo para cima nos três sistemas (ActionSheet), que no iPhone
 * só roda a ação depois de fechar: renomear abre outra janela, e duas de uma vez falham.
 */
export function ListMenu({
  visible,
  title,
  archived,
  onAction,
  onClose,
}: {
  visible: boolean;
  /** O nome da lista. */
  title: string;
  archived: boolean;
  onAction: (action: ListMenuAction) => void;
  onClose: () => void;
}) {
  return (
    <ActionSheet
      visible={visible}
      title={title}
      actions={listMenuActions(archived).map((action) => ({
        label: LIST_MENU_LABELS[action],
        icon: ICONS[action],
        destructive: action === 'archive',
        onPress: () => onAction(action),
      }))}
      onClose={onClose}
    />
  );
}

const styles = StyleSheet.create({
  headerButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
});

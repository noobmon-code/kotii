import { onlineManager, useMutationState } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';

import { TOGGLE_ITEM_KEY } from '@/data/market';
import { Icon, Text } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

const subscribe = (listener: () => void) => onlineManager.subscribe(listener);

/** Na lista: avisa que está sem internet e quantas marcações esperam para sair. */
export function OfflineNotice() {
  const c = useColors();
  const online = useSyncExternalStore(subscribe, () => onlineManager.isOnline(), () => true);
  const waiting = useMutationState({ filters: { mutationKey: TOGGLE_ITEM_KEY, status: 'pending' } }).length;
  if (online && !waiting) return null;
  const marks = `${waiting} ${waiting === 1 ? 'marcação' : 'marcações'}`;
  const message = online
    ? `Enviando ${marks}…`
    : waiting
      ? `Sem internet. ${marks} ${waiting === 1 ? 'guardada vai' : 'guardadas vão'} quando a conexão voltar.`
      : 'Sem internet. Pode marcar os itens: as marcações vão quando a conexão voltar.';
  return (
    <View style={[styles.banner, { backgroundColor: c.warningSoft }]} accessibilityRole="alert">
      <Icon name={online ? 'cloud-upload-outline' : 'wifi-off'} size={18} color="warning" />
      <Text variant="small" color="warning" style={styles.flex}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  flex: { flex: 1 },
});

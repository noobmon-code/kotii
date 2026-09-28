import { onlineManager, useMutationState } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';

import { LIST_PHOTO_KEY } from '@/data/listPhotos';
import { EDIT_ITEM_KEY, TOGGLE_ITEM_KEY } from '@/data/market';
import { joinNames } from '@/domain/cartPantry';
import { Icon, Text } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

const subscribe = (listener: () => void) => onlineManager.subscribe(listener);

const count = (n: number, one: string, many: string) => (n ? [`${n} ${n === 1 ? one : many}`] : []);

/** Na lista: avisa que está sem internet e o que espera para sair (marcações, detalhes, fotos). */
export function OfflineNotice() {
  const c = useColors();
  const online = useSyncExternalStore(subscribe, () => onlineManager.isOnline(), () => true);
  const marks = useMutationState({ filters: { mutationKey: TOGGLE_ITEM_KEY, status: 'pending' } }).length;
  const edits = useMutationState({ filters: { mutationKey: EDIT_ITEM_KEY, status: 'pending' } }).length;
  const photos = useMutationState({ filters: { mutationKey: LIST_PHOTO_KEY, status: 'pending' } }).length;
  const waiting = joinNames([
    ...count(marks, 'marcação', 'marcações'),
    ...count(edits, 'item editado', 'itens editados'),
    ...count(photos, 'foto', 'fotos'),
  ]);
  if (online && !waiting) return null;
  const message = online
    ? `Enviando ${waiting}…`
    : waiting
      ? `Sem internet. Esperando a conexão: ${waiting}.`
      : 'Sem internet. Pode marcar os itens e mudar os detalhes: vai tudo quando a conexão voltar.';
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

import { onlineManager, useMutationState } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';

import { LIST_PHOTO_KEY } from '@/data/listPhotos';
import { ADD_ITEM_KEY, CLEAR_CHECKED_KEY, EDIT_ITEM_KEY, REMOVE_ITEM_KEY, TOGGLE_ITEM_KEY } from '@/data/market';
import { waitingSummary } from '@/domain/listQueue';
import { Icon, Text } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

const subscribe = (listener: () => void) => onlineManager.subscribe(listener);

/** Quantas ações com essa chave esperam para sair (ou estão saindo). */
const usePending = (mutationKey: readonly string[]) => useMutationState({ filters: { mutationKey: [...mutationKey], status: 'pending' } }).length;

/** Na lista: avisa que está sem internet e o que espera para sair (itens postos e tirados, marcações, detalhes, limpar, fotos). */
export function OfflineNotice() {
  const c = useColors();
  const online = useSyncExternalStore(subscribe, () => onlineManager.isOnline(), () => true);
  const waiting = waitingSummary({
    adds: usePending(ADD_ITEM_KEY),
    marks: usePending(TOGGLE_ITEM_KEY),
    edits: usePending(EDIT_ITEM_KEY),
    removes: usePending(REMOVE_ITEM_KEY),
    clears: usePending(CLEAR_CHECKED_KEY),
    photos: usePending(LIST_PHOTO_KEY),
  });
  if (online && !waiting) return null;
  const message = online
    ? `Enviando ${waiting}…`
    : waiting
      ? `Sem internet. Esperando a conexão: ${waiting}.`
      : 'Sem internet. Pode pôr e tirar itens, marcar, mudar os detalhes e limpar o carrinho: vai tudo quando a conexão voltar.';
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

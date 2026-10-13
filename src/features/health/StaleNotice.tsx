import { StyleSheet, View } from 'react-native';

import { Button, Icon, Text } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

/** O aviso de que a atualização falhou, acima do que já estava carregado e continua na tela. */
export function StaleNotice({ onRetry }: { onRetry: () => void }) {
  const c = useColors();
  return (
    <View style={[styles.stale, { backgroundColor: c.warningSoft }]} accessibilityRole="alert">
      <Icon name="alert-circle-outline" size={18} color="warning" />
      <Text variant="small" color="warning" style={styles.flex}>
        Não foi possível atualizar. Mostrando o que já estava carregado.
      </Text>
      <Button title="Tentar de novo" variant="secondary" compact onPress={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stale: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
});

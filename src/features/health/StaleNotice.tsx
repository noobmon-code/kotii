import { StyleSheet, View } from 'react-native';

import { Button, Icon, Text } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

const STALE = 'Não foi possível atualizar. Mostrando o que já estava carregado.';

/**
 * O aviso de que a atualização falhou, acima do que já estava carregado e continua na tela. `message` troca a
 * frase (sem internet, o que está na tela é o que ficou guardado no aparelho); sem `onRetry`, não há botão (a
 * busca parada segue sozinha quando a conexão volta).
 */
export function StaleNotice({ onRetry, message = STALE }: { onRetry?: () => void; message?: string }) {
  const c = useColors();
  return (
    <View style={[styles.stale, { backgroundColor: c.warningSoft }]} accessibilityRole="alert">
      <Icon name="alert-circle-outline" size={18} color="warning" />
      <Text variant="small" color="warning" style={styles.flex}>
        {message}
      </Text>
      {onRetry ? <Button title="Tentar de novo" variant="secondary" compact onPress={onRetry} /> : null}
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

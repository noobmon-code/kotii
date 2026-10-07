import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { NukeAvatar } from '@/ui/NukeArt';
import { Badge, Icon, Text, useGlassStyle } from '@/ui/primitives';
import { radius, space, useTint } from '@/ui/theme';

/** Entrada do consultor financeiro (beta) no resumo de Finanças; quem mostra confere a liberação. */
export function ConsultorCard() {
  const glass = useGlassStyle();
  const tint = useTint('purple');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Abrir o consultor financeiro (beta)"
      onPress={() => router.push('/consultor')}
      style={({ pressed }) => [styles.card, glass, { backgroundColor: tint.bg }, pressed && styles.pressed]}>
      <NukeAvatar size={52} mood="idle" shadow={false} />
      <View style={styles.text}>
        <View style={styles.titleRow}>
          <Text variant="label">Consultor financeiro</Text>
          <Badge label="beta" tone="info" />
        </View>
        <Text variant="muted">Seus bancos, faturas e parcelas num lugar só. Só você vê.</Text>
      </View>
      <Icon name="chevron-right" color="textMuted" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.lg,
    padding: space.lg,
  },
  text: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  pressed: { transform: [{ scale: 0.97 }] },
});

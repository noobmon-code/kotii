import { router } from 'expo-router';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { NukeLive } from '@/ui/NukeLive';
import { shadows, useColors } from '@/ui/theme';

/** Botão flutuante do Nuke, no canto inferior direito das abas. */
export function NukeButton({ style }: { style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Falar com o Nuke, o assistente da casa"
      onPress={() => router.push('/nuke')}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: c.glassStrong, borderColor: c.glassBorder, boxShadow: shadows.float },
        pressed && styles.pressed,
        style,
      ]}>
      <NukeLive size={44} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { transform: [{ scale: 0.94 }] },
});

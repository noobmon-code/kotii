import { router, useIsFocused } from 'expo-router';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { NukeLive } from '@/ui/NukeLive';
import { shadows, useColors } from '@/ui/theme';

/** Botão flutuante do Nuke, no canto inferior direito das abas. */
export function NukeButton({ style }: { style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  // Com outra tela por cima (inclusive a do Nuke), o botão fica parado.
  const focused = useIsFocused();
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
      <NukeLive size={44} paused={!focused} />
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

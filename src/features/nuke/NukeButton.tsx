import { router } from 'expo-router';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { Floating, NukeAvatar } from '@/ui/art';
import { useColors } from '@/ui/theme';

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
        { backgroundColor: c.surface, borderColor: c.brandSoft },
        pressed && styles.pressed,
        style,
      ]}>
      <Floating distance={2} duration={1800}>
        <NukeAvatar size={42} />
      </Floating>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2B2A3A',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  pressed: { transform: [{ scale: 0.94 }] },
});

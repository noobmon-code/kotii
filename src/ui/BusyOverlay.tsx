import { Modal, StyleSheet, View } from 'react-native';

import { Floating, Mascot } from './art';
import { Text } from './primitives';
import { space, useColors } from './theme';

/** Tela de espera por cima de tudo (ex.: leitura com IA). */
export function BusyOverlay({ visible, title, message }: { visible: boolean; title: string; message?: string }) {
  const c = useColors();
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={[styles.backdrop, { backgroundColor: c.background }]}>
        <Floating distance={10}>
          <Mascot size={104} color={c.brand} mood="think" />
        </Floating>
        <Text variant="heading" style={styles.center}>
          {title}
        </Text>
        {message ? (
          <Text variant="muted" style={styles.center}>
            {message}
          </Text>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.md },
  center: { textAlign: 'center' },
});

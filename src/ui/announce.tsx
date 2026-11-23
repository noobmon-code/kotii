import { useCallback, useState, type ReactElement } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native';

import { Text } from './primitives';

/**
 * Para dizer ao leitor de tela o resultado de um toque que muda a tela sem mudar o foco para ele (uma linha que sai
 * da lista, um envio que deu certo). No celular, `announceForAccessibility`. No navegador essa chamada não faz nada
 * (react-native-web), então quem fala é uma região `aria-live` escondida, que a tela desenha sempre (`region`): uma
 * região que já entra na página com o texto quase nunca é lida (o VoiceOver do Safari fica quieto), por isso ela
 * fica montada e só o texto de dentro muda. `clear` esvazia a região antes do próximo anúncio, para o mesmo texto
 * ser lido de novo.
 *
 * `region` é null no celular. Na tela, vai num lugar que não some com o que foi anunciado (uma seção que fecha
 * levaria a região junto, e o anúncio com ela).
 */
export function useAnnounce(testID?: string): { announce: (text: string) => void; clear: () => void; region: ReactElement | null } {
  const [spoken, setSpoken] = useState('');
  const announce = useCallback((text: string) => {
    if (Platform.OS === 'web') setSpoken(text);
    else AccessibilityInfo.announceForAccessibility(text);
  }, []);
  const clear = useCallback(() => setSpoken(''), []);
  const region =
    Platform.OS === 'web' ? (
      <View aria-live="polite" style={styles.offscreen} testID={testID}>
        {spoken ? <Text variant="small">{spoken}</Text> : null}
      </View>
    ) : null;
  return { announce, clear, region };
}

const styles = StyleSheet.create({
  // Só para o leitor de tela: fora do desenho, sem ocupar lugar.
  offscreen: { position: 'absolute', width: 1, height: 1, overflow: 'hidden' },
});

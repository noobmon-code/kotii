import { StyleSheet, View } from 'react-native';

import { useInstallApp } from '@/lib/install';
import { Mascot } from '@/ui/art';
import { Button, Card, Row, Text } from '@/ui/primitives';
import { space, useTint } from '@/ui/theme';

/** Na web, convida a pôr o Kotii na tela inicial do celular. */
export function InstallAppCard() {
  const { mode, install, dismiss } = useInstallApp();
  const tint = useTint('orange');
  if (mode === 'hidden') return null;
  return (
    <Card style={styles.card}>
      <Row style={styles.top}>
        <Mascot size={52} color={tint.art} />
        <View style={styles.flex}>
          <Text variant="label">Tenha o Kotii na tela inicial</Text>
          <Text variant="small">
            {mode === 'ios'
              ? 'No Safari, toque em Compartilhar (o quadrado com a seta) e depois em "Adicionar à Tela de Início".'
              : 'Abre em tela cheia, como um app, e a lista de compras abre mesmo com a internet fraca.'}
          </Text>
        </View>
      </Row>
      <Row style={styles.actions}>
        {mode === 'prompt' ? <Button title="Instalar" icon="download" compact onPress={install} /> : null}
        <Button title="Agora não" variant="ghost" compact onPress={dismiss} />
      </Row>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  top: { gap: space.md, alignItems: 'flex-start' },
  flex: { flex: 1, gap: space.xs },
  actions: { justifyContent: 'flex-end' },
});

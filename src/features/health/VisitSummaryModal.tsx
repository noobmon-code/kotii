import * as Clipboard from 'expo-clipboard';
import { Modal, Platform, ScrollView, Share, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Backdrop } from '@/ui/Backdrop';
import { notify } from '@/ui/dialogs';
import { Button, Card, IconButton, Row, Text } from '@/ui/primitives';
import { MAX_WIDTH, space, useColors } from '@/ui/theme';

/**
 * Resumo para a consulta em tela cheia, com copiar e compartilhar. O texto é
 * dado de saúde: chega pronto, fica só na memória e some quando a tela fecha;
 * nada é enviado pelo app. Renderize só quando aberto.
 */
export function VisitSummaryModal({ text, onClose }: { text: string; onClose: () => void }) {
  const c = useColors();
  // No navegador, compartilhar só existe onde o navegador oferece (celular e alguns computadores).
  const canShare = Platform.OS !== 'web' || (typeof navigator !== 'undefined' && 'share' in navigator);

  async function copy() {
    // No navegador a cópia pode ser recusada (devolve false ou dá erro).
    const copied = await Clipboard.setStringAsync(text).catch(() => false);
    if (copied) notify('Resumo copiado', 'Cole nas notas do celular ou numa mensagem.');
    else notify('Não deu para copiar', 'Selecione o texto na tela para copiar.');
  }

  function share() {
    // Fechar a folha de compartilhar sem escolher nada não é erro.
    Share.share({ message: text }).catch(() => undefined);
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.flex, { backgroundColor: c.background }]}>
        <Backdrop />
        <ScrollView contentContainerStyle={styles.content}>
          <Row>
            <Text variant="heading" style={styles.flex}>
              Resumo para a consulta
            </Text>
            <IconButton icon="close" label="Fechar" onPress={onClose} />
          </Row>
          <Text variant="muted">
            Confira antes de mostrar ou enviar. O Kotii não envia nem guarda este texto: ele some quando você fecha esta tela.
          </Text>
          <Row style={styles.wrap}>
            <Button title="Copiar" icon="content-copy" onPress={copy} style={styles.action} />
            {canShare ? (
              <Button title="Compartilhar" icon="share-variant-outline" variant="secondary" onPress={share} style={styles.action} />
            ) : null}
          </Row>
          <Card>
            <Text selectable>{text}</Text>
          </Card>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', padding: space.lg, gap: space.lg },
  wrap: { flexWrap: 'wrap' },
  action: { flexGrow: 1 },
});

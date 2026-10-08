import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { parseBoleto, type Boleto } from '@/domain/boleto';
import { todayISO } from '@/domain/dates';
import { Backdrop } from '@/ui/Backdrop';
import { notify } from '@/ui/dialogs';
import { Button, Card, IconButton, Row, Text, TextField } from '@/ui/primitives';
import { MAX_WIDTH, radius, space, useColors } from '@/ui/theme';

/** Lê o boleto pelo código de barras ou pela linha digitável colada. Renderize só quando aberto. */
export function BoletoScanner({ onRead, onClose }: { onRead: (boleto: Boleto) => void; onClose: () => void }) {
  const c = useColors();
  const [permission, requestPermission] = useCameraPermissions();
  const [pasted, setPasted] = useState('');
  // A câmera lê o mesmo código várias vezes por segundo: vale a primeira leitura boa.
  const done = useRef(false);

  function read(text: string, fromCamera: boolean) {
    if (done.current) return;
    const boleto = parseBoleto(text, todayISO());
    if (!boleto) {
      // Leitura torta da câmera: ela tenta de novo sozinha.
      if (!fromCamera) notify('Código não confere', 'Algum número não bate. Confira a linha digitável (47 ou 48 números).');
      return;
    }
    done.current = true;
    onRead(boleto);
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.flex, { backgroundColor: c.background }]}>
        <Backdrop />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Row>
            <Text variant="heading" style={styles.flex}>
              Ler boleto
            </Text>
            <IconButton icon="close" label="Fechar" onPress={onClose} />
          </Row>
          <Text variant="muted">Deite o celular e enquadre o código de barras inteiro. Valor e vencimento vêm do próprio código.</Text>

          {permission?.granted ? (
            <View style={[styles.camera, { backgroundColor: c.surfaceAlt }]}>
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['itf14'] }}
                onBarcodeScanned={({ data }) => read(data, true)}
              />
              <View style={[styles.frame, { borderColor: c.onPrimary }]} pointerEvents="none" />
            </View>
          ) : (
            <Card style={styles.gap}>
              <Text variant="body">Para ler o código de barras, o Kotii precisa usar a câmera.</Text>
              <Button title="Permitir a câmera" icon="camera-outline" onPress={() => requestPermission()} />
            </Card>
          )}

          <Card style={styles.gap}>
            <Text variant="label">Ou cole a linha digitável</Text>
            <Text variant="small">
              {Platform.OS === 'web'
                ? 'Se a câmera daqui não ler, copie a linha do PDF ou do e-mail do boleto e cole aqui.'
                : 'Do PDF, do e-mail ou do app da empresa. Pontos e espaços não importam.'}
            </Text>
            <TextField
              value={pasted}
              onChangeText={setPasted}
              placeholder="00190.00009 01234.567890…"
              keyboardType="number-pad"
              multiline
              accessibilityLabel="Linha digitável do boleto"
            />
            <Button title="Usar este código" icon="check" disabled={!pasted.trim()} onPress={() => read(pasted, false)} />
          </Card>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space.md },
  content: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center', padding: space.lg, gap: space.lg },
  camera: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.lg, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  frame: { width: '88%', height: '38%', borderWidth: 3, borderRadius: radius.md },
});

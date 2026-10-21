import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GTIN_INVALID, GTIN_INVALID_TITLE, GTIN_RESTRICTED, GTIN_RESTRICTED_TITLE, readGtin, readTypedGtin } from '@/domain/barcode';
import { prepareBarcodeReader } from '@/lib/barcodeReader';
import { Backdrop } from '@/ui/Backdrop';
import { notify } from '@/ui/dialogs';
import { Button, Card, IconButton, Row, Text, TextField } from '@/ui/primitives';
import { MAX_WIDTH, radius, space, useColors } from '@/ui/theme';

/**
 * Lê o código de barras de um produto pela câmera (EAN-13, EAN-8 e UPC-A) ou
 * digitado, e devolve os 14 dígitos da gtin_key (domain/barcode). Sem o UPC-E:
 * o código curto precisaria ser expandido para virar o do produto. Renderize
 * só quando aberto.
 */
export function ProductBarcodeScanner({
  title = 'Ler código de barras',
  onRead,
  onClose,
}: {
  title?: string;
  onRead: (gtin: string) => void;
  onClose: () => void;
}) {
  const c = useColors();
  const [permission, requestPermission] = useCameraPermissions();
  const [typed, setTyped] = useState('');
  // A câmera lê o mesmo código várias vezes por segundo: vale a primeira leitura boa.
  const done = useRef(false);
  // O código da balança lido pela câmera avisa uma vez só, e não a cada quadro.
  const lastRestricted = useRef<string | null>(null);

  useEffect(() => {
    void prepareBarcodeReader();
  }, []);

  function read(text: string, fromCamera: boolean) {
    if (done.current) return;
    const result = fromCamera ? readGtin(text.trim()) : readTypedGtin(text);
    if ('problem' in result) {
      // Leitura torta da câmera: ela tenta de novo sozinha.
      if (result.problem === 'invalid' && !fromCamera) notify(GTIN_INVALID_TITLE, GTIN_INVALID);
      if (result.problem === 'restricted' && (!fromCamera || lastRestricted.current !== text)) {
        lastRestricted.current = text;
        notify(GTIN_RESTRICTED_TITLE, GTIN_RESTRICTED);
      }
      return;
    }
    done.current = true;
    onRead(result.gtin);
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.flex, { backgroundColor: c.background }]}>
        <Backdrop />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Row>
            <Text variant="heading" style={styles.flex}>
              {title}
            </Text>
            <IconButton icon="close" label="Fechar" onPress={onClose} />
          </Row>
          <Text variant="muted">Enquadre as barras do produto, com os números embaixo delas. A leitura é sozinha.</Text>

          {permission?.granted ? (
            <View style={[styles.camera, { backgroundColor: c.surfaceAlt }]}>
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a'] }}
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
            <Text variant="label">Ou digite os números do código de barras</Text>
            <Text variant="small">
              {Platform.OS === 'web'
                ? 'Se a câmera daqui não ler, digite os números que ficam embaixo das barras.'
                : 'Os números que ficam embaixo das barras. Espaços não importam.'}
            </Text>
            <TextField
              value={typed}
              onChangeText={setTyped}
              placeholder="7891000100103"
              keyboardType="number-pad"
              accessibilityLabel="Números do código de barras"
              onSubmitEditing={() => (typed.trim() ? read(typed, false) : undefined)}
            />
            <Button title="Usar este código" icon="check" disabled={!typed.trim()} onPress={() => read(typed, false)} />
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
  // Horizontal, do jeito do código de barras de uma embalagem.
  frame: { width: '80%', height: '40%', borderWidth: 3, borderRadius: radius.md },
});

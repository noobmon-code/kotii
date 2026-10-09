import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { FunctionError } from '@/data/images';
import { MAX_RECEIPT_PHOTOS, useImportNfce } from '@/data/receipts';
import { nfceFailureRoute, parseNfceQr, qrReadStep } from '@/domain/nfce';
import { useReceiptScanner } from '@/features/ReceiptScanner';
import { prepareBarcodeReader } from '@/lib/barcodeReader';
import { errorMessage } from '@/lib/supabase';
import { BusyOverlay } from '@/ui/BusyOverlay';
import { notify } from '@/ui/dialogs';
import { Button, Card, Screen, Text, TextField } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

/**
 * Lê o QR code da nota (ou o link colado) e traz os itens da Sefaz, sem IA.
 * Se a Sefaz pedir o "não sou robô", o app não passa por ele: a tela troca a
 * câmera pela leitura da nota por foto, que guarda a chave do QR.
 */
export default function NfceQrScreen() {
  const c = useColors();
  const [permission, requestPermission] = useCameraPermissions();
  const importNfce = useImportNfce();
  const scanner = useReceiptScanner({ replace: true });
  const [pasted, setPasted] = useState('');
  // Nota que só dá para ler pela foto: a chave do QR e o aviso da Sefaz.
  const [photoOnly, setPhotoOnly] = useState<{ accessKey: string; message: string } | null>(null);
  // As que esbarraram no "não sou robô" nesta tela (chave -> aviso): não vão de novo à Sefaz.
  const captchaKeys = useRef(new Map<string, string>());
  // A câmera lê o mesmo QR várias vezes por segundo: um de cada vez.
  const busy = useRef(false);
  const lastRejected = useRef<string | null>(null);

  useEffect(() => {
    void prepareBarcodeReader();
  }, []);

  function submit(text: string, fromCamera: boolean) {
    if (busy.current) return;
    const qr = parseNfceQr(text);
    if (!qr) {
      if (!fromCamera || lastRejected.current !== text) {
        notify('QR code não reconhecido', 'Esse código não é de uma nota fiscal de consumidor (NFC-e). Procure o QR code no rodapé da nota.');
      }
      lastRejected.current = text;
      return;
    }
    const step = qrReadStep(qr.accessKey, captchaKeys.current);
    if (step.kind === 'photo') {
      setPhotoOnly({ accessKey: qr.accessKey, message: step.message });
      return;
    }
    busy.current = true;
    importNfce.mutate(qr, {
      onSuccess: ({ receipt_id, duplicate }) => {
        router.replace({ pathname: '/nota/[id]', params: { id: receipt_id } });
        if (duplicate) notify('Nota já importada', 'Esta nota já estava no app — abrimos a existente.');
      },
      onError: (err) => {
        busy.current = false;
        const message = errorMessage(err);
        if (nfceFailureRoute(err instanceof FunctionError ? err.code : null) === 'photo') {
          // A câmera sai (não lê o mesmo QR de novo) e a foto entra no lugar dela.
          captchaKeys.current.set(qr.accessKey, message);
          setPhotoOnly({ accessKey: qr.accessKey, message });
          return;
        }
        notify('Não deu para ler a nota', message);
      },
    });
  }

  return (
    <Screen edges={[]}>
      <Text variant="muted">
        Aponte a câmera para o QR code no rodapé da nota. Os itens e preços vêm direto da Sefaz, sem erro de leitura, e você
        revisa antes de salvar.
      </Text>

      {photoOnly ? (
        <Card style={styles.gap}>
          <Text variant="heading">Leia esta nota pela foto</Text>
          <Text variant="muted">{photoOnly.message}</Text>
          <Text variant="small">
            Fotografe a nota inteira, de cima para baixo. Ela fica ligada a este QR code: lendo o QR de novo, o app abre esta nota.
          </Text>
          <Button
            title="Tirar foto da nota"
            icon="camera-outline"
            loading={scanner.busy}
            onPress={() => scanner.readPhotos('camera', photoOnly.accessKey)}
          />
          <Button
            title={`Escolher da galeria (até ${MAX_RECEIPT_PHOTOS} fotos)`}
            icon="image-outline"
            variant="secondary"
            disabled={scanner.busy}
            onPress={() => scanner.readPhotos('library', photoOnly.accessKey)}
          />
          <Button title="Ler outro QR code" icon="qrcode-scan" variant="ghost" onPress={() => setPhotoOnly(null)} />
        </Card>
      ) : permission?.granted ? (
        <View style={[styles.camera, { backgroundColor: c.surfaceAlt }]}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => submit(data, true)}
          />
          <View style={[styles.frame, { borderColor: c.onPrimary }]} pointerEvents="none" />
        </View>
      ) : (
        <Card style={styles.gap}>
          <Text variant="body">Para ler o QR code, o app precisa usar a câmera.</Text>
          <Button title="Permitir a câmera" icon="camera-outline" onPress={() => requestPermission()} />
        </Card>
      )}

      <Card style={styles.gap}>
        <Text variant="label">Ou cole o link do QR code</Text>
        <Text variant="small">
          {Platform.OS === 'web'
            ? 'Se a câmera daqui não ler (no iPhone, por exemplo), leia o QR com a câmera do celular, copie o link que abrir e cole aqui.'
            : 'Útil se o QR estiver apagado: leia com outro app, copie o link e cole aqui.'}
        </Text>
        <TextField
          value={pasted}
          onChangeText={setPasted}
          placeholder="https://…fazenda…gov.br/…?p=…"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Link do QR code da nota"
        />
        <Button title="Buscar a nota" icon="magnify" disabled={!pasted.trim()} onPress={() => submit(pasted, false)} />
      </Card>

      {scanner.element}
      <BusyOverlay
        visible={importNfce.isPending}
        title="Buscando a nota na Sefaz…"
        message="Mercado, itens e preços como estão na nota. Leva alguns segundos."
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { gap: space.md },
  camera: { width: '100%', aspectRatio: 1, borderRadius: radius.lg, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  frame: { width: '62%', aspectRatio: 1, borderWidth: 3, borderRadius: radius.md },
});

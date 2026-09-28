import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { useImportNfce } from '@/data/receipts';
import { parseNfceQr } from '@/domain/nfce';
import { errorMessage } from '@/lib/supabase';
import { BusyOverlay } from '@/ui/BusyOverlay';
import { notify } from '@/ui/dialogs';
import { Button, Card, Screen, Text, TextField } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

/** Lê o QR code da nota (ou o link colado) e traz os itens da Sefaz, sem IA. */
export default function NfceQrScreen() {
  const c = useColors();
  const [permission, requestPermission] = useCameraPermissions();
  const importNfce = useImportNfce();
  const [pasted, setPasted] = useState('');
  // A câmera lê o mesmo QR várias vezes por segundo: um de cada vez.
  const busy = useRef(false);
  const lastRejected = useRef<string | null>(null);

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
    busy.current = true;
    importNfce.mutate(qr, {
      onSuccess: ({ receipt_id, duplicate }) => {
        router.replace({ pathname: '/nota/[id]', params: { id: receipt_id } });
        if (duplicate) notify('Nota já importada', 'Esta nota já estava no app — abrimos a existente.');
      },
      onError: (err) => {
        busy.current = false;
        notify('Não deu para ler a nota', errorMessage(err));
      },
    });
  }

  return (
    <Screen edges={[]}>
      <Text variant="muted">
        Aponte a câmera para o QR code no rodapé da nota. Os itens e preços vêm direto da Sefaz, sem erro de leitura, e você
        revisa antes de salvar.
      </Text>

      {permission?.granted ? (
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
          <Text variant="body">Para ler o QR code, o Nooky precisa usar a câmera.</Text>
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

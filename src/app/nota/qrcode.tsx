import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { FunctionError } from '@/data/images';
import { usePendingReceipts } from '@/data/pendingReceipts';
import { useImportNfce } from '@/data/receipts';
import { captchaStateNote, captchaStateStep } from '@/domain/captchaStates';
import { NFCE_CAPTCHA, NFCE_CAPTCHA_STATE, nfceFailureRoute, parseNfceQr, qrReadStep } from '@/domain/nfce';
import { PendingReceiptCard } from '@/features/PendingReceiptCard';
import { useReceiptScanner } from '@/features/ReceiptScanner';
import { useSefazRetry } from '@/features/sefazRetry';
import { prepareBarcodeReader } from '@/lib/barcodeReader';
import { readCaptchaStates, rememberCaptchaState } from '@/lib/captchaStates';
import { errorMessage } from '@/lib/supabase';
import { BusyOverlay } from '@/ui/BusyOverlay';
import { notify } from '@/ui/dialogs';
import { Button, Card, Screen, Text, TextField } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

/**
 * Lê o QR code da nota (ou o link colado) e traz os itens da Sefaz, sem IA.
 * Se a Sefaz pedir o "não sou robô", o app não passa por ele: a nota fica
 * pendente (guardada no aparelho, em Finanças > Notas) e abre a tela dela, com
 * o passo a passo dos prints da Sefaz, que vão com a chave do QR. O mesmo QR
 * lido de novo abre a pendente, sem ir à Sefaz. Por uma semana, as notas novas
 * do mesmo estado também vão direto para a pendente (domain/captchaStates).
 */
export default function NfceQrScreen() {
  const c = useColors();
  const [permission, requestPermission] = useCameraPermissions();
  const importNfce = useImportNfce();
  const scanner = useReceiptScanner({ replace: true });
  const pendingReceipts = usePendingReceipts();
  const [pasted, setPasted] = useState('');
  // Nota que só dá para ler pelos prints ou pela foto: a chave e o link do QR.
  const [photoOnly, setPhotoOnly] = useState<{ accessKey: string; url: string | null; direct: boolean } | null>(null);
  // As que esbarraram no "não sou robô" nesta tela (chave -> aviso): não vão de novo à Sefaz.
  const captchaKeys = useRef(new Map<string, string>());
  // A câmera lê o mesmo QR várias vezes por segundo: um de cada vez.
  const busy = useRef(false);
  // "Tentar a Sefaz de novo" no passo a passo daqui (quando a pendente não pôde ser guardada).
  const sefazRetry = useSefazRetry({
    onRead: (key) => {
      captchaKeys.current.delete(key);
      return pendingReceipts.discard(key);
    },
    onCaptcha: () => setPhotoOnly((shown) => shown && { ...shown, direct: false }),
  });
  const inlineRetryUrl = photoOnly?.direct && photoOnly.url && parseNfceQr(photoOnly.url) ? photoOnly.url : null;
  const lastRejected = useRef<string | null>(null);

  useEffect(() => {
    void prepareBarcodeReader();
  }, []);

  async function submit(text: string, fromCamera: boolean) {
    if (busy.current) return;
    const qr = parseNfceQr(text);
    if (!qr) {
      if (!fromCamera || lastRejected.current !== text) {
        notify('QR code não reconhecido', 'Esse código não é de uma nota fiscal de consumidor (NFC-e). Procure o QR code no rodapé da nota.');
      }
      lastRejected.current = text;
      return;
    }
    const pending = pendingReceipts.pending;
    const step = qrReadStep(qr.accessKey, captchaKeys.current, new Set(pending.map((p) => p.accessKey)));
    if (step.kind === 'photo') {
      const entry = pending.find((p) => p.accessKey === qr.accessKey);
      // A chave digitada não traz o link: vale o que a pendente guardou.
      showPending({ accessKey: qr.accessKey, url: qr.url ?? entry?.url ?? null }, Boolean(entry), false);
      return;
    }
    busy.current = true;
    // O estado da nota pediu o "não sou robô" há pouco: a nota nova nem vai à Sefaz (a que a casa já tem abre).
    const skipSefaz = captchaStateStep(await readCaptchaStates(), qr.accessKey, new Date()) === 'photo';
    importNfce.mutate({ ...qr, skipSefaz }, {
      onSuccess: ({ receipt_id, duplicate }) => {
        router.replace({ pathname: '/nota/[id]', params: { id: receipt_id } });
        if (duplicate) notify('Nota já importada', 'Esta nota já estava no app — abrimos a existente.');
      },
      onError: (err) => {
        const message = errorMessage(err);
        const code = err instanceof FunctionError ? err.code : null;
        if (nfceFailureRoute(code) === 'photo') {
          // A nota fica pendente no aparelho: abrir a Sefaz pode recarregar o app, e a chave não se perde. Até
          // ela estar guardada, a câmera não lê o mesmo QR de novo.
          captchaKeys.current.set(qr.accessKey, message);
          void pendingReceipts.save({ accessKey: qr.accessKey, url: qr.url }).then(async (saved) => {
            // Só o CAPTCHA de agora conta o prazo do estado: a nota que nem foi à Sefaz não o renova.
            if (code === NFCE_CAPTCHA) await rememberCaptchaState(qr.uf);
            busy.current = false;
            showPending({ accessKey: qr.accessKey, url: qr.url }, saved, code === NFCE_CAPTCHA_STATE);
          });
          return;
        }
        busy.current = false;
        notify('Não deu para ler a nota', message);
      },
    });
  }

  /**
   * A pendente guardada abre na tela dela (/nota/pendente?chave=…), que volta igual se o navegador recarregar o app
   * enquanto a pessoa está na Sefaz. Sem ela guardada (sem armazenamento), o passo a passo fica aqui, no lugar da
   * câmera, só enquanto a tela está aberta. `direct`: nem foi à Sefaz (o estado pediu o "não sou robô" há pouco),
   * e a pendente diz por quê.
   */
  function showPending(qr: { accessKey: string; url: string | null }, stored: boolean, direct: boolean) {
    if (stored) router.replace({ pathname: '/nota/pendente', params: direct ? { chave: qr.accessKey, direto: '1' } : { chave: qr.accessKey } });
    else setPhotoOnly({ ...qr, direct });
  }

  const close = () => (router.canGoBack() ? router.back() : router.replace('/financas'));

  return (
    <Screen edges={[]}>
      <Text variant="muted">
        Aponte a câmera para o QR code no rodapé da nota. Os itens e preços vêm direto da Sefaz, sem erro de leitura, e você
        revisa antes de salvar.
      </Text>

      {photoOnly ? (
        <PendingReceiptCard
          accessKey={photoOnly.accessKey}
          url={photoOnly.url}
          note={photoOnly.direct ? captchaStateNote(photoOnly.accessKey, Boolean(inlineRetryUrl)) : null}
          onRetrySefaz={inlineRetryUrl ? () => void sefazRetry.retry(inlineRetryUrl) : undefined}
          retrying={sefazRetry.busy}
          scanner={scanner}
          onDiscard={() => {
            // Descartada, a tela fecha: com a câmera de volta, o papel ainda na frente dela traria a nota de novo.
            // Lido depois, o QR vai à Sefaz como uma nota nova. Aqui ela não foi guardada; se foi, sai também.
            captchaKeys.current.delete(photoOnly.accessKey);
            void pendingReceipts.discard(photoOnly.accessKey).catch(() => undefined);
            close();
          }}>
          <Button title="Ler outro QR code" icon="qrcode-scan" variant="ghost" disabled={scanner.busy} onPress={() => setPhotoOnly(null)} />
        </PendingReceiptCard>
      ) : permission?.granted ? (
        <View style={[styles.camera, { backgroundColor: c.surfaceAlt }]}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => void submit(data, true)}
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
        <Button title="Buscar a nota" icon="magnify" disabled={!pasted.trim()} onPress={() => void submit(pasted, false)} />
      </Card>

      {scanner.element}
      <BusyOverlay
        visible={importNfce.isPending || sefazRetry.busy}
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

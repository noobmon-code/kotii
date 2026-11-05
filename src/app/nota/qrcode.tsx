import { useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { FunctionError } from '@/data/images';
import { usePendingReceipts } from '@/data/pendingReceipts';
import { useImportNfce } from '@/data/receipts';
import { captchaStateNote, captchaStateStep } from '@/domain/captchaStates';
import { NFCE_CAPTCHA, NFCE_CAPTCHA_STATE, nfceFailureRoute, parseNfceQr, qrReadStep } from '@/domain/nfce';
import { MAX_RECEIPT_PHOTOS } from '@/domain/receiptPhotos';
import { PendingReceiptCard } from '@/features/PendingReceiptCard';
import { useReceiptScanner } from '@/features/ReceiptScanner';
import { useSefazRetry } from '@/features/sefazRetry';
import { prepareBarcodeReader } from '@/lib/barcodeReader';
import { readCaptchaStates, rememberCaptchaState } from '@/lib/captchaStates';
import { errorMessage } from '@/lib/supabase';
import { AppCameraView } from '@/ui/AppCameraView';
import { BusyOverlay } from '@/ui/BusyOverlay';
import { notify } from '@/ui/dialogs';
import { Button, Card, Screen, Text, TextField } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

/**
 * Depois de um jeito sem o QR (foto, galeria, digitar), a câmera do QR só volta um segundo depois de o fluxo parar:
 * no iPhone, o menu "Foto tirada" some (e as partes saem) antes de a próxima foto começar, e a câmera montada nesse
 * meio-tempo leria o QR do papel ainda na frente dela.
 */
const OTHER_WAY_RESUME_MS = 1000;

/**
 * Lê o QR code da nota (ou o link colado) e traz os itens da Sefaz, sem IA.
 * Se a Sefaz pedir o "não sou robô", o app não passa por ele: a nota fica
 * pendente (guardada no aparelho, em Finanças > Notas) e abre a tela dela, com
 * o passo a passo dos prints da Sefaz, que vão com a chave do QR. O mesmo QR
 * lido de novo abre a pendente, sem ir à Sefaz. Por uma semana, as notas novas
 * do mesmo estado também vão direto para a pendente (domain/captchaStates).
 * Debaixo da câmera ficam os outros jeitos (tirar foto, da galeria, digitar),
 * para a nota sem QR ou com o QR que não lê; a revisão toma o lugar desta tela.
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
  // Um jeito sem o QR em andamento: a câmera fica desmontada, para não ler o QR do papel no meio da foto nem
  // disputar com a câmera do sistema; volta OTHER_WAY_RESUME_MS depois de o fluxo parar.
  const [cameraBack, setCameraBack] = useState(true);
  useEffect(() => {
    if (cameraBack || scanner.active) return;
    const timer = setTimeout(() => setCameraBack(true), OTHER_WAY_RESUME_MS);
    return () => clearTimeout(timer);
  }, [cameraBack, scanner.active]);
  const cameraOn = cameraBack && !scanner.active;
  // A câmera que lê: sem a pendente no lugar dela e fora de um jeito sem o QR. Ela sai na hora, também no navegador
  // com o vídeo ainda começando: o vídeo que chegar depois é desligado (ui/AppCameraView), como ao deixar a tela.
  const cameraWanted = !photoOnly && cameraOn;
  const otherWay = (run: () => void) => {
    setCameraBack(false);
    run();
  };
  const otherWaysDisabled = scanner.busy || importNfce.isPending || sefazRetry.busy;

  useEffect(() => {
    void prepareBarcodeReader();
  }, []);

  async function submit(text: string, fromCamera: boolean) {
    // Com a foto sendo lida ou a nota digitada sendo criada, nem o link colado nem um quadro atrasado da câmera vão à Sefaz.
    if (busy.current || scanner.busy) return;
    const qr = parseNfceQr(text);
    if (!qr) {
      if (!fromCamera || lastRejected.current !== text) {
        notify('QR code não reconhecido', 'Esse código não é de uma nota fiscal de consumidor (NFC-e). Procure o QR code no rodapé da nota.');
      }
      lastRejected.current = text;
      return;
    }
    // A nota vem pelo QR: a foto que a galeria ainda devolver tarde (o seletor já dado como fechado) não vira outra
    // nota da mesma compra.
    scanner.dropPick();
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
          onRetrySefaz={
            inlineRetryUrl
              ? () => {
                  scanner.dropPick();
                  void sefazRetry.retry(inlineRetryUrl);
                }
              : undefined
          }
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
          {cameraWanted ? (
            <>
              <AppCameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={({ data }) => void submit(data, true)}
              />
              <View style={[styles.frame, { borderColor: c.onPrimary }]} pointerEvents="none" />
            </>
          ) : null}
        </View>
      ) : (
        <Card style={styles.gap}>
          <Text variant="body">Para ler o QR code, o app precisa usar a câmera.</Text>
          <Button title="Permitir a câmera" icon="camera-outline" onPress={() => requestPermission()} />
        </Card>
      )}

      {photoOnly ? null : (
        // A pendente que não pôde ser guardada tem os botões dela, que mandam a foto com a chave do QR.
        <View style={styles.otherWays}>
          <Text variant="label">Sem QR code, ou ele não lê?</Text>
          <Text variant="small">
            {`Pela foto, a IA lê a nota (da galeria, até ${MAX_RECEIPT_PHOTOS} imagens da mesma nota). Ou digite os itens. Você revisa antes de salvar.`}
          </Text>
          <View style={styles.otherWayButtons}>
            <Button
              title="Tirar foto"
              icon="camera-outline"
              variant="secondary"
              compact
              style={styles.otherWay}
              accessibilityLabel="Tirar foto da nota"
              disabled={otherWaysDisabled}
              onPress={() => otherWay(() => scanner.readPhotos('camera'))}
            />
            <Button
              title="Da galeria"
              icon="image-outline"
              variant="secondary"
              compact
              style={styles.otherWay}
              accessibilityLabel={`Da galeria, até ${MAX_RECEIPT_PHOTOS} imagens`}
              disabled={otherWaysDisabled}
              onPress={() => otherWay(() => scanner.readPhotos('library'))}
            />
            <Button
              title="Digitar"
              icon="pencil-outline"
              variant="secondary"
              compact
              style={styles.otherWay}
              accessibilityLabel="Digitar a nota"
              disabled={otherWaysDisabled}
              onPress={() => otherWay(scanner.startManual)}
            />
          </View>
        </View>
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
  otherWays: { gap: space.sm },
  otherWayButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  // O compacto tem 40: o toque fica com 44.
  otherWay: { minHeight: 44 },
});

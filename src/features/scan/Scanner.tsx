import { CameraView, scanFromURLAsync, useCameraPermissions } from 'expo-camera';
import { router, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAddToMarketList } from '@/data/market';
import { pickReceiptImages, useCreateManualReceipt } from '@/data/receipts';
import { useSaveScanToPantry, useScanPhotos } from '@/data/scan';
import { GTIN_INVALID, GTIN_INVALID_TITLE, GTIN_RESTRICTED, GTIN_RESTRICTED_TITLE, readTypedGtin } from '@/domain/barcode';
import type { IconName } from '@/domain/categories';
import { todayISO } from '@/domain/dates';
import {
  addScanItems,
  changeScanQuantity,
  classifyFor,
  galleryLimit,
  listItemsFromScan,
  PARTS_MESSAGE,
  PARTS_MORE,
  partsRead,
  partsTitle,
  photoStep,
  readScanCode,
  removeScanItem,
  savedToListMessage,
  savedToPantryMessage,
  SCAN_ALLOW_CAMERA,
  SCAN_BARCODE_TYPES,
  SCAN_LEAVE_TITLE,
  SCAN_MORE,
  SCAN_NEEDS_CAMERA,
  SCAN_NOTHING_TITLE,
  SCAN_OPTION_LABELS,
  SCAN_QR_NOT_RECEIPT,
  SCAN_QR_NOT_RECEIPT_TITLE,
  SCAN_READING_MESSAGE,
  SCAN_READING_TITLE,
  SCAN_RECEIPT_LATER_TITLE,
  SCAN_SHUTTER,
  scanCodeStep,
  scanHint,
  scanItemFromProduct,
  scanItemsFromRead,
  scanLeaveQuestion,
  scanNothingMessage,
  scanOptions,
  scanReceiptLaterMessage,
  tooManyImagesMessage,
  type ScanItem,
  type ScanMode,
  type ScanOption,
  type ScanState,
} from '@/domain/scan';
import { useProductBarcode } from '@/features/ProductBarcode';
import { FoundList } from '@/features/scan/FoundList';
import { useHouseholdId } from '@/lib/auth';
import { prepareBarcodeReader } from '@/lib/barcodeReader';
import { goBackOr } from '@/lib/navigation';
import { errorMessage } from '@/lib/supabase';
import { ActionSheet } from '@/ui/ActionSheet';
import { BusyOverlay } from '@/ui/BusyOverlay';
import { confirmAction, notify } from '@/ui/dialogs';
import { Button, Card, IconButton, Row, Screen, Text, TextField } from '@/ui/primitives';
import { radius, space, useColors } from '@/ui/theme';

/** A câmera lê o mesmo código várias vezes por segundo: o mesmo, de novo, só depois deste tempo. */
const SAME_CODE_MS = 3000;

/** A hora em que a câmera viu um código (ela chama fora do desenho da tela, como um toque). */
const seenAt = () => Date.now();

const OPTION_ICONS: Record<ScanOption, IconName> = {
  galeria: 'image-outline',
  link: 'link-variant',
  codigo: 'barcode-scan',
  manual: 'pencil-outline',
};

/** O QR ou o código de barras que uma foto pegou, se pegou algum que sirva; a leitura que falha não é erro. */
async function codeInPhoto(uri: string): Promise<string | null> {
  try {
    const results = await scanFromURLAsync(uri, [...SCAN_BARCODE_TYPES]);
    return results.find((result) => readScanCode(result.data))?.data ?? null;
  } catch {
    return null;
  }
}

/**
 * O "Escanear" (domain/scan): uma câmera só. Ela lê sozinha o QR code da nota (que segue para a tela do QR, com a
 * Sefaz e as pendentes de sempre) e o código de barras de um produto (o caminho de sempre do código: o produto da
 * casa, ou "Qual produto é este?"). A foto vai para a IA dizer se é nota, produto ou prateleira; antes disso, o
 * código que a própria foto pegou vale mais, e não gasta leitura. Os produtos achados ficam na tela até a pessoa
 * dizer para onde vão (a despensa ou a lista de mercado), uma vez só para todos. Sem câmera (o computador, ou a
 * permissão negada), ficam as outras opções: a galeria, o link do QR, o código digitado e a nota à mão.
 */
export function Scanner({ mode }: { mode: ScanMode }) {
  const c = useColors();
  const navigation = useNavigation();
  const householdId = useHouseholdId();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const scan = useScanPhotos(householdId);
  const savePantry = useSaveScanToPantry();
  const addToList = useAddToMarketList();
  const manual = useCreateManualReceipt();
  const [tray, setTray] = useState<ScanItem[]>([]);
  // A nota comprida: as partes já fotografadas, esperando a próxima ou a leitura.
  const [parts, setParts] = useState<string[]>([]);
  const [optionsOpen, setOptionsOpen] = useState(false);
  // O campo aberto embaixo da câmera: o link do QR ou os números do código de barras.
  const [field, setField] = useState<'link' | 'codigo' | null>(null);
  const [typed, setTyped] = useState('');
  const [shooting, setShooting] = useState(false);
  const [listing, setListing] = useState(false);
  const lastCode = useRef<{ text: string; at: number } | null>(null);
  // Saindo de propósito (guardou os produtos, abriu a nota): o aviso de sair não pergunta.
  const leaving = useRef(false);

  const state: ScanState = { mode, found: tray.length };
  const barcode = useProductBarcode({
    onProduct: (product) => setTray((items) => addScanItems(items, [scanItemFromProduct(product)])),
  });
  const busy = scan.isPending || savePantry.isPending || listing || manual.isPending || shooting;
  const hasCamera = Boolean(permission?.granted);

  useEffect(() => {
    void prepareBarcodeReader();
  }, []);

  // Quem abriu o "Escanear" quer a câmera: a permissão que ainda não foi pedida é pedida ao abrir, uma vez, sem
  // esperar o toque em "Permitir a câmera" (que fica para quem já negou, ou para o navegador que não deixa pedir).
  const askedCamera = useRef(false);
  useEffect(() => {
    if (!permission || permission.granted || askedCamera.current) return;
    if (permission.status !== 'undetermined' || !permission.canAskAgain) return;
    askedCamera.current = true;
    void requestPermission();
  }, [permission, requestPermission]);

  // Com produtos achados e não guardados, sair pergunta antes (o gesto de voltar e o botão do aparelho também).
  usePreventRemove(tray.length > 0, ({ data }) => {
    if (leaving.current) navigation.dispatch(data.action);
    else confirmAction(SCAN_LEAVE_TITLE, scanLeaveQuestion(tray.length), 'Sair', () => navigation.dispatch(data.action));
  });

  function leave(go: () => void) {
    leaving.current = true;
    go();
  }

  /** Segue com um código lido; true se ele serviu para alguma coisa. */
  function handleCode(data: string): boolean {
    const code = readScanCode(data);
    const step = scanCodeStep(code, state);
    if (step === 'nota' && code?.kind === 'nota') {
      // A tela do QR assume daqui: a Sefaz, a nota que já existe, o "não sou robô" e as pendentes.
      leave(() => router.replace({ pathname: '/nota/qrcode', params: { qr: code.text } }));
      return true;
    }
    if (step === 'produto' && code?.kind === 'produto') {
      barcode.read(code.gtin);
      return true;
    }
    return false;
  }

  /** O código que a câmera viu ao vivo: um de cada vez, e nunca no meio de uma foto ou de uma nota em partes. */
  function onLiveCode(data: string) {
    if (busy || barcode.busy || parts.length) return;
    const now = seenAt();
    const last = lastCode.current;
    if (last && last.text === data && now - last.at < SAME_CODE_MS) return;
    lastCode.current = { text: data, at: now };
    handleCode(data);
  }

  function read(uris: string[]) {
    setParts([]);
    const asked = state;
    scan.mutate(
      { uris, classify: classifyFor(asked) },
      {
        onSuccess: (reply) => {
          if (reply.kind === 'nota') {
            leave(() => router.replace({ pathname: '/nota/[id]', params: { id: reply.receiptId } }));
            if (reply.duplicate) notify('Nota já importada', 'Esta nota já estava no app — abrimos a existente.');
          } else if (reply.kind === 'produtos') {
            setTray((items) => addScanItems(items, scanItemsFromRead(reply.products)));
          } else if (reply.kind === 'nota-nao-lida') {
            notify(SCAN_RECEIPT_LATER_TITLE, scanReceiptLaterMessage(asked));
          } else {
            notify(SCAN_NOTHING_TITLE, scanNothingMessage(asked));
          }
        },
        onError: (err) => notify('Não foi possível ler a foto', errorMessage(err)),
      },
    );
  }

  /** As fotos novas: primeiro o código que a própria foto pegou; senão, a próxima parte da nota ou a leitura. */
  async function afterPhotos(uris: string[], source: 'camera' | 'library') {
    if (!parts.length) {
      const found = await codeInPhoto(uris[0]);
      if (found && handleCode(found)) return;
    }
    if (source === 'library') return read(uris);
    const next = [...parts, ...uris];
    if (photoStep(state, next.length) === 'ler') read(next);
    else setParts(next);
  }

  async function shoot() {
    if (busy) return;
    setShooting(true);
    try {
      const picture = await camera.current?.takePictureAsync({ quality: 0.8 });
      if (picture?.uri) await afterPhotos([picture.uri], 'camera');
    } catch (err) {
      notify('Não deu para tirar a foto', errorMessage(err));
    } finally {
      setShooting(false);
    }
  }

  async function pickFromGallery() {
    const limit = galleryLimit(state);
    let uris: string[];
    try {
      uris = await pickReceiptImages('library', limit);
    } catch (err) {
      notify('Não foi possível abrir a imagem', errorMessage(err));
      return;
    }
    // No navegador a galeria não tem limite: com imagens demais, nada é lido.
    if (uris.length > limit) {
      notify('Imagens demais', tooManyImagesMessage(limit));
      return;
    }
    if (uris.length) await afterPhotos(uris, 'library');
  }

  function startManual() {
    manual.mutate(undefined, {
      onSuccess: ({ id }) => leave(() => router.replace({ pathname: '/nota/[id]', params: { id } })),
      onError: (err) => notify('Erro', errorMessage(err)),
    });
  }

  function choose(option: ScanOption) {
    if (option === 'galeria') void pickFromGallery();
    else if (option === 'manual') startManual();
    else {
      setTyped('');
      setField(option);
    }
  }

  function submitField() {
    const text = typed.trim();
    if (!text) return;
    if (field === 'link') {
      if (handleCode(text)) setField(null);
      else notify(SCAN_QR_NOT_RECEIPT_TITLE, SCAN_QR_NOT_RECEIPT);
      return;
    }
    const gtin = readTypedGtin(text);
    if ('problem' in gtin) {
      if (gtin.problem === 'restricted') notify(GTIN_RESTRICTED_TITLE, GTIN_RESTRICTED);
      else notify(GTIN_INVALID_TITLE, GTIN_INVALID);
      return;
    }
    barcode.read(gtin.gtin);
    setTyped('');
    setField(null);
  }

  function toPantry() {
    savePantry.mutate(
      { items: tray, today: todayISO() },
      {
        onSuccess: (count) => {
          leave(() => goBackOr({ pathname: '/compras', params: { aba: 'despensa' } }));
          notify('Guardado', savedToPantryMessage(count));
        },
        onError: (err) => notify('Não deu para guardar', errorMessage(err)),
      },
    );
  }

  async function toList() {
    if (listing) return;
    setListing(true);
    let added = 0;
    let skipped = 0;
    let listName = 'Mercado';
    try {
      // Um de cada vez: o que já está pendente na lista não entra de novo, e repetir depois de uma falha é seguro.
      for (const item of listItemsFromScan(tray)) {
        const listed = await addToList.mutateAsync(item);
        listName = listed.name;
        if (listed.added) added += 1;
        else skipped += 1;
      }
      leave(() => goBackOr('/'));
      notify('Na lista', savedToListMessage(added, skipped, listName));
    } catch (err) {
      notify('Não deu para pôr na lista', errorMessage(err));
    } finally {
      setListing(false);
    }
  }

  const options = scanOptions(state);
  const optionButton = (option: ScanOption) => (
    <Button
      key={option}
      title={SCAN_OPTION_LABELS[option]}
      icon={OPTION_ICONS[option]}
      variant="secondary"
      disabled={busy}
      onPress={() => choose(option)}
    />
  );

  return (
    <Screen edges={[]}>
      <Text variant="muted">{scanHint(state)}</Text>

      {/* Enquanto a permissão é lida, nem a câmera nem o pedido: nada pisca. */}
      {!permission ? null : hasCamera ? (
        <>
          <View style={[styles.camera, { backgroundColor: c.surfaceAlt }]}>
            <CameraView
              ref={camera}
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: [...SCAN_BARCODE_TYPES] }}
              onBarcodeScanned={({ data }) => onLiveCode(data)}
            />
          </View>
          <Row>
            <Button
              title={parts.length ? PARTS_MORE : SCAN_SHUTTER}
              icon="camera-outline"
              variant={parts.length ? 'secondary' : 'primary'}
              loading={shooting}
              disabled={busy}
              onPress={() => void shoot()}
              style={styles.flex}
            />
            <IconButton icon="dots-horizontal" label={SCAN_MORE} disabled={busy} onPress={() => setOptionsOpen(true)} />
          </Row>
        </>
      ) : (
        <Card style={styles.gap}>
          <Text variant="body">{SCAN_NEEDS_CAMERA}</Text>
          {/* O navegador sem câmera também responde "negado": o botão fica, e as outras opções vêm logo abaixo. */}
          <Button title={SCAN_ALLOW_CAMERA} icon="camera-outline" onPress={() => void requestPermission()} />
          {options.map(optionButton)}
        </Card>
      )}

      {parts.length ? (
        <Card style={styles.gap}>
          <Text variant="label">{partsTitle(parts.length)}</Text>
          <Text variant="small">{PARTS_MESSAGE}</Text>
          <Button title={partsRead(parts.length)} icon="check" disabled={busy} onPress={() => read(parts)} />
          <Button title="Descartar" variant="ghost" disabled={busy} onPress={() => setParts([])} />
        </Card>
      ) : null}

      {field ? (
        <Card style={styles.gap}>
          <Text variant="label">{SCAN_OPTION_LABELS[field]}</Text>
          <TextField
            value={typed}
            onChangeText={setTyped}
            placeholder={field === 'link' ? 'https://…fazenda…gov.br/…?p=…' : '7891000100103'}
            keyboardType={field === 'codigo' ? 'number-pad' : 'default'}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            accessibilityLabel={field === 'link' ? 'Link do QR code da nota' : 'Números do código de barras'}
            onSubmitEditing={submitField}
          />
          <Row>
            <Button title="Usar" disabled={busy || barcode.busy || !typed.trim()} onPress={submitField} style={styles.flex} />
            <Button title="Fechar" variant="ghost" onPress={() => setField(null)} />
          </Row>
        </Card>
      ) : null}

      {tray.length ? (
        <FoundList
          items={tray}
          mode={mode}
          busy={busy}
          savingPantry={savePantry.isPending}
          savingList={listing}
          onChange={(key, delta) => setTray((items) => changeScanQuantity(items, key, delta))}
          onRemove={(key) => setTray((items) => removeScanItem(items, key))}
          onPantry={toPantry}
          onList={() => void toList()}
        />
      ) : null}

      <ActionSheet
        visible={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        title={SCAN_MORE}
        actions={options.map((option) => ({ label: SCAN_OPTION_LABELS[option], icon: OPTION_ICONS[option], onPress: () => choose(option) }))}
      />
      {barcode.element}
      <BusyOverlay visible={scan.isPending} title={SCAN_READING_TITLE} message={SCAN_READING_MESSAGE} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space.md },
  // Em pé, como a nota e a prateleira que a pessoa fotografa.
  camera: { width: '100%', aspectRatio: 3 / 4, borderRadius: radius.lg, overflow: 'hidden' },
});

import { router } from 'expo-router';
import { useCallback, useState } from 'react';

import { MAX_RECEIPT_PHOTOS, pickReceiptImages, useCreateManualReceipt, useScanReceipt, type ScanSource } from '@/data/receipts';
import { useHouseholdId } from '@/lib/auth';
import { errorMessage } from '@/lib/supabase';
import { ActionSheet } from '@/ui/ActionSheet';
import { BusyOverlay } from '@/ui/BusyOverlay';
import { notify } from '@/ui/dialogs';

/**
 * Fluxo "nota -> revisão". `open()` mostra as opções (QR code, câmera,
 * galeria, manual); `element` precisa ser renderizado pela tela.
 */
export function useReceiptScanner() {
  const householdId = useHouseholdId();
  const scan = useScanReceipt(householdId);
  const manual = useCreateManualReceipt();
  const [sheetOpen, setSheetOpen] = useState(false);
  // Nota comprida pela câmera: partes já fotografadas, esperando a próxima ou a leitura.
  const [parts, setParts] = useState<string[]>([]);

  const read = useCallback(
    (uris: string[]) => {
      setParts([]);
      // Só agora (câmera já fechada) aparece a tela de espera.
      scan.mutate(uris, {
        onSuccess: ({ receipt_id, duplicate }) => {
          router.push({ pathname: '/nota/[id]', params: { id: receipt_id } });
          if (duplicate) notify('Nota já importada', 'Esta nota já estava no app — abrimos a existente.');
        },
        onError: (err) => notify('Não foi possível ler a nota', errorMessage(err)),
      });
    },
    [scan],
  );

  const start = useCallback(
    async (source: ScanSource, taken: string[] = []) => {
      let uris: string[];
      try {
        uris = await pickReceiptImages(source, source === 'library' ? MAX_RECEIPT_PHOTOS : 1);
      } catch (err) {
        notify('Não foi possível abrir a imagem', errorMessage(err));
        return;
      }
      if (source === 'library') {
        if (uris.length) read(uris);
        return;
      }
      const next = [...taken, ...uris];
      if (!next.length) return;
      // Pela câmera, uma parte de cada vez: a pessoa diz se a nota continua.
      if (next.length >= MAX_RECEIPT_PHOTOS) read(next);
      else setParts(next);
    },
    [read],
  );

  const startManual = useCallback(() => {
    manual.mutate(undefined, {
      onSuccess: ({ id }) => router.push({ pathname: '/nota/[id]', params: { id } }),
      onError: (err) => notify('Erro', errorMessage(err)),
    });
  }, [manual]);

  const element = (
    <>
      <ActionSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Adicionar nota fiscal"
        message="Pelo QR code, os itens vêm direto da Sefaz; pela foto, a IA lê a nota. Você revisa antes de salvar."
        actions={[
          { label: 'Ler o QR code da nota', icon: 'qrcode-scan', onPress: () => router.push('/nota/qrcode') },
          { label: 'Tirar foto da nota', icon: 'camera-outline', onPress: () => start('camera') },
          { label: `Escolher da galeria (até ${MAX_RECEIPT_PHOTOS} fotos)`, icon: 'image-outline', onPress: () => start('library') },
          { label: 'Digitar manualmente', icon: 'pencil-outline', onPress: startManual },
        ]}
      />
      <ActionSheet
        visible={parts.length > 0}
        onClose={() => setParts([])}
        title={parts.length === 1 ? 'Foto tirada' : `${parts.length} partes tiradas`}
        message="Nota comprida? Fotografe o resto de cima para baixo, deixando um pedaço repetido entre as fotos: a leitura junta tudo numa nota só."
        actions={[
          { label: parts.length === 1 ? 'Ler a nota' : `Ler a nota (${parts.length} fotos)`, icon: 'check', onPress: () => read(parts) },
          { label: 'Fotografar a próxima parte', icon: 'camera-plus-outline', onPress: () => start('camera', parts) },
        ]}
      />
      <BusyOverlay
        visible={scan.isPending}
        title="Lendo a nota…"
        message="Identificando mercado, itens e preços. Notas longas podem levar até um minuto."
      />
    </>
  );

  return { open: () => setSheetOpen(true), element, busy: scan.isPending || manual.isPending };
}

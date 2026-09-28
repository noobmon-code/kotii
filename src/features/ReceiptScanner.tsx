import { router } from 'expo-router';
import { useCallback, useState } from 'react';

import { pickReceiptImage, useCreateManualReceipt, useScanReceipt, type ScanSource } from '@/data/receipts';
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

  const start = useCallback(
    async (source: ScanSource) => {
      let uri: string | null;
      try {
        uri = await pickReceiptImage(source);
      } catch (err) {
        notify('Não foi possível abrir a imagem', errorMessage(err));
        return;
      }
      if (!uri) return;
      // Só agora (câmera já fechada) aparece a tela de espera.
      scan.mutate(uri, {
        onSuccess: ({ receipt_id, duplicate }) => {
          router.push({ pathname: '/nota/[id]', params: { id: receipt_id } });
          if (duplicate) notify('Nota já importada', 'Esta nota já estava no app — abrimos a existente.');
        },
        onError: (err) => notify('Não foi possível ler a nota', errorMessage(err)),
      });
    },
    [scan],
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
          { label: 'Escolher da galeria', icon: 'image-outline', onPress: () => start('library') },
          { label: 'Digitar manualmente', icon: 'pencil-outline', onPress: startManual },
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

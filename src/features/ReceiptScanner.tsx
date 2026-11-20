import { router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import { MAX_RECEIPT_PHOTOS, pickReceiptImages, useScanReceipt, type ScanSource } from '@/data/receipts';
import { useHouseholdId } from '@/lib/auth';
import { errorMessage } from '@/lib/supabase';
import { ActionSheet } from '@/ui/ActionSheet';
import { BusyOverlay } from '@/ui/BusyOverlay';
import { notify } from '@/ui/dialogs';

/**
 * A leitura pela foto de uma nota cuja chave já se conhece (do QR code): os prints da Sefaz da nota pendente
 * (nota/pendente e, quando a pendente não pôde ser guardada, nota/qrcode). `readPhotos(source, chave)` abre a
 * câmera (uma parte de cada vez) ou a galeria; `element` precisa ser renderizado pela tela. A revisão sempre toma o
 * lugar da tela atual (a pendente ou a do QR), para que quem abriu a nota (a lista do "Finalizar compra", Compras →
 * Notas) fique logo embaixo dela. Adicionar uma nota (Compras → Notas, o Mercado do mês, o "Finalizar compra" da
 * lista) é a câmera só da nota do "Escanear" (features/scan/receiptCamera), não daqui.
 */
export function useReceiptScanner() {
  const householdId = useHouseholdId();
  const scan = useScanReceipt(householdId);
  // Nota comprida pela câmera: partes já fotografadas, esperando a próxima ou a leitura.
  const [parts, setParts] = useState<string[]>([]);
  // Chave da nota que está sendo fotografada (a do QR code da pendente).
  const accessKey = useRef<string | null>(null);

  const read = useCallback(
    (uris: string[]) => {
      setParts([]);
      // Só agora (câmera já fechada) aparece a tela de espera.
      scan.mutate(
        { uris, accessKey: accessKey.current },
        {
          onSuccess: ({ receipt_id, duplicate }) => {
            router.replace({ pathname: '/nota/[id]', params: { id: receipt_id } });
            if (duplicate) notify('Nota já importada', 'Esta nota já estava no app — abrimos a existente.');
          },
          onError: (err) => notify('Não foi possível ler a nota', errorMessage(err)),
        },
      );
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
        // No navegador a galeria não tem limite: com imagens demais, nada é lido (cortar podia deixar o rodapé de fora).
        if (uris.length > MAX_RECEIPT_PHOTOS) {
          notify(
            'Imagens demais',
            `Escolha até ${MAX_RECEIPT_PHOTOS} imagens da mesma nota, sem deixar de fora o topo (com o mercado) e o rodapé (com a data).`,
          );
          return;
        }
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

  const readPhotos = useCallback(
    (source: ScanSource, key: string) => {
      accessKey.current = key;
      void start(source);
    },
    [start],
  );

  const element = (
    <>
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

  return { readPhotos, element, busy: scan.isPending };
}

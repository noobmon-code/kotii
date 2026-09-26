import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';

import { pickReceiptImage, useCreateManualReceipt, useScanReceipt, type ScanSource } from '@/data/receipts';
import { useHouseholdId } from '@/lib/auth';
import { errorMessage } from '@/lib/supabase';
import { ActionSheet } from '@/ui/ActionSheet';
import { notify } from '@/ui/dialogs';
import { Loading, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

/**
 * Fluxo "foto da nota -> revisão". `open()` mostra as opções (câmera,
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
        message="A IA lê mercado, itens e preços; você revisa antes de salvar."
        actions={[
          { label: 'Tirar foto da nota', icon: 'camera-outline', onPress: () => start('camera') },
          { label: 'Escolher da galeria', icon: 'image-outline', onPress: () => start('library') },
          { label: 'Digitar manualmente', icon: 'pencil-outline', onPress: startManual },
        ]}
      />
      <ScanningOverlay visible={scan.isPending} />
    </>
  );

  return { open: () => setSheetOpen(true), element, busy: scan.isPending || manual.isPending };
}

function ScanningOverlay({ visible }: { visible: boolean }) {
  const c = useColors();
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={[styles.backdrop, { backgroundColor: c.background }]}>
        <Loading />
        <Text variant="heading">Lendo a nota…</Text>
        <Text variant="muted" style={styles.center}>
          Identificando mercado, itens e preços. Notas longas podem levar até um minuto.
        </Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.md },
  center: { textAlign: 'center' },
});

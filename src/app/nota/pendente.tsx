import { router, useLocalSearchParams } from 'expo-router';

import { usePendingReceipts } from '@/data/pendingReceipts';
import { pendingReceiptCnpj, pendingReceiptSubtitle } from '@/domain/pendingReceipts';
import { PendingReceiptCard } from '@/features/PendingReceiptCard';
import { useReceiptScanner } from '@/features/ReceiptScanner';
import { notify } from '@/ui/dialogs';
import { Button, EmptyState, Loading, Screen, Text } from '@/ui/primitives';

/**
 * Uma nota pendente (Finanças > Notas, tela Hoje): a Sefaz pediu o "não sou robô" quando o QR foi lido. Daqui a
 * pessoa abre a nota na Sefaz, envia os prints (ligados à chave do QR: a leitura vira a nota, e a pendente some)
 * ou descarta.
 */
export default function PendingReceiptScreen() {
  const { chave } = useLocalSearchParams<{ chave?: string }>();
  const { pending, storeNames, ready, discard } = usePendingReceipts();
  const scanner = useReceiptScanner({ replace: true });
  const entry = pending.find((p) => p.accessKey === chave);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/financas'));

  return (
    <Screen edges={[]}>
      {entry ? (
        <>
          <Text variant="muted">
            {[storeNames[pendingReceiptCnpj(entry.accessKey)], pendingReceiptSubtitle(entry.accessKey)].filter(Boolean).join(' · ')}
          </Text>
          <PendingReceiptCard
            accessKey={entry.accessKey}
            url={entry.url}
            scanner={scanner}
            onDiscard={() => {
              discard(entry.accessKey).then(close, () => notify('Não deu para descartar', 'Tente de novo.'));
            }}
          />
        </>
      ) : ready ? (
        <EmptyState
          icon="receipt-text-outline"
          title="Esta nota não está mais pendente"
          message="Ela já foi lida ou descartada. As notas da casa ficam em Finanças → Notas."
          action={<Button title="Voltar" variant="secondary" onPress={close} />}
        />
      ) : (
        <Loading />
      )}
      {scanner.element}
    </Screen>
  );
}

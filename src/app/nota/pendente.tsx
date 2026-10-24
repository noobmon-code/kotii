import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { usePendingReceipts } from '@/data/pendingReceipts';
import { captchaStateNote } from '@/domain/captchaStates';
import { parseNfceQr } from '@/domain/nfce';
import { pendingReceiptCnpj, pendingReceiptSubtitle } from '@/domain/pendingReceipts';
import { PendingReceiptCard } from '@/features/PendingReceiptCard';
import { useReceiptScanner } from '@/features/ReceiptScanner';
import { useSefazRetry } from '@/features/sefazRetry';
import { notify } from '@/ui/dialogs';
import { Button, EmptyState, Loading, Screen, Text } from '@/ui/primitives';

/**
 * Uma nota pendente (Finanças > Notas, tela Hoje): a Sefaz pediu o "não sou robô" quando o QR foi lido. Daqui a
 * pessoa abre a nota na Sefaz, envia os prints (ligados à chave do QR: a leitura vira a nota, e a pendente some)
 * ou descarta.
 */
export default function PendingReceiptScreen() {
  // `direto`: a nota nem foi à Sefaz, porque o estado dela pediu o "não sou robô" há pouco (domain/captchaStates).
  const { chave, direto } = useLocalSearchParams<{ chave?: string; direto?: string }>();
  const { pending, storeNames, ready, discard } = usePendingReceipts();
  const scanner = useReceiptScanner({ replace: true });
  const entry = pending.find((p) => p.accessKey === chave);
  // A Sefaz, tentada de novo daqui, pediu a verificação para esta nota: ela deixa de ser "a que nem foi à Sefaz".
  const [askedNow, setAskedNow] = useState(false);
  const sefazRetry = useSefazRetry({ onRead: (key) => discard(key), onCaptcha: () => setAskedNow(true) });
  const direct = direto === '1' && !askedNow;
  // Sem o link do QR (a chave digitada), não há o que tentar.
  const retryUrl = direct && entry?.url && parseNfceQr(entry.url) ? entry.url : null;

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
            note={direct ? captchaStateNote(entry.accessKey, Boolean(retryUrl)) : null}
            onRetrySefaz={retryUrl ? () => void sefazRetry.retry(retryUrl) : undefined}
            retrying={sefazRetry.busy}
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

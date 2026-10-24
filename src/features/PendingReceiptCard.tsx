import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { pendingReceiptCnpj, pendingReceiptSubtitle, sefazLink, type PendingReceipt } from '@/domain/pendingReceipts';
import { MAX_RECEIPT_PHOTOS } from '@/domain/receiptPhotos';
import { openExternal } from '@/lib/openLink';
import { confirmAction, notify } from '@/ui/dialogs';
import { Badge, Button, Card, IconBadge, ListRow, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

import type { useReceiptScanner } from './ReceiptScanner';

/**
 * A nota pendente (a Sefaz pediu o "não sou robô"): abrir a nota na página oficial, o que pôr nos prints, enviar
 * os prints (ou a foto do papel) com a chave do QR, ou descartar. O app não passa pela verificação: a pessoa passa,
 * na página da Sefaz. Na tela do QR e na da nota pendente (Finanças > Notas, tela Hoje).
 */
export function PendingReceiptCard({
  accessKey,
  url,
  note,
  onRetrySefaz,
  retrying = false,
  scanner,
  onDiscard,
  children,
}: {
  accessKey: string;
  url: string | null;
  /** Por que a nota veio direto para cá, sem ir à Sefaz (domain/captchaStates). */
  note?: string | null;
  /** "Tentar a Sefaz de novo": só na pendente que nem foi à Sefaz e tem o link do QR. */
  onRetrySefaz?: () => void;
  retrying?: boolean;
  scanner: ReturnType<typeof useReceiptScanner>;
  onDiscard: () => void;
  /** Botões a mais no fim (na tela do QR, ler outro QR code). */
  children?: ReactNode;
}) {
  const link = sefazLink(url);

  async function openSefaz() {
    if (!link || (await openExternal(link))) return;
    notify('Não deu para abrir a Sefaz', 'Leia o QR code da nota com a câmera do celular e abra o link que aparecer.');
  }

  function discard() {
    confirmAction(
      'Descartar esta nota?',
      'Ela sai das notas pendentes. Para ler depois, é só ler o QR code da nota de novo.',
      'Descartar',
      onDiscard,
    );
  }

  return (
    <Card style={styles.gap}>
      <Text variant="heading">Leia esta nota pelos prints da Sefaz</Text>
      {/* Com esta nota o app nem foi à Sefaz: a frase do estado toma o lugar de "a Sefaz pede antes desta nota". */}
      {note ? (
        <Text variant="muted">{note}</Text>
      ) : (
        <Text variant="muted">
          A Sefaz pede uma confirmação de que você não é robô antes de mostrar esta nota, e o app não consegue fazer essa
          confirmação.
        </Text>
      )}
      {onRetrySefaz ? (
        <Button
          title="Tentar a Sefaz de novo"
          icon="refresh"
          variant="secondary"
          loading={retrying}
          disabled={scanner.busy}
          onPress={onRetrySefaz}
        />
      ) : null}
      {/* No iPhone, o Safari e o Kotii da tela de início guardam cada um as suas: no site, "neste app". */}
      <Text variant="small">
        {`A nota fica guardada ${Platform.OS === 'web' ? 'neste app' : 'neste aparelho'}, em Finanças → Notas e na tela Hoje, até você enviar os prints.`}
      </Text>

      <View style={styles.steps}>
        <Text variant="body">
          {link
            ? '1. Toque em "Abrir a nota na Sefaz" e depois em "Consultar". Se a página pedir a verificação, faça por lá.'
            : '1. Leia o QR code da nota com a câmera do celular, abra a página da Sefaz e toque em "Consultar".'}
        </Text>
        <Text variant="body">
          {`2. Tire prints da nota, até ${MAX_RECEIPT_PHOTOS} imagens: o topo (nome do mercado e CNPJ), a lista de itens e o rodapé (data e chave de acesso). O topo e o rodapé sempre vão. A parte do consumidor, com o CPF, não precisa.`}
        </Text>
        <Text variant="body">{'3. Volte aqui e toque em "Enviar os prints".'}</Text>
      </View>
      <Text variant="small">
        Sem o nome do mercado e a data nos prints, a nota vale só para a sua casa e não entra nos preços de outras casas.
        Sem a data, confira o dia da compra na revisão.
      </Text>

      {link ? <Button title="Abrir a nota na Sefaz" icon="open-in-new" variant="secondary" onPress={() => void openSefaz()} /> : null}
      <Button
        title={`Enviar os prints (até ${MAX_RECEIPT_PHOTOS})`}
        icon="image-multiple-outline"
        loading={scanner.busy}
        onPress={() => scanner.readPhotos('library', accessKey)}
      />
      <Button
        title="Tirar foto do papel"
        icon="camera-outline"
        variant="secondary"
        disabled={scanner.busy}
        onPress={() => scanner.readPhotos('camera', accessKey)}
      />
      {children}
      <Button title="Descartar" icon="trash-can-outline" variant="ghost" disabled={scanner.busy} onPress={discard} />
    </Card>
  );
}

/**
 * A pendente numa lista (Finanças > Notas, tela Hoje): o mercado, quando a casa já conhece o CNPJ da chave, e o
 * mês da compra. Abre a tela da nota pendente.
 */
export function PendingReceiptRow({ pending, storeNames }: { pending: PendingReceipt; storeNames: Readonly<Record<string, string>> }) {
  return (
    <ListRow
      left={<IconBadge icon="timer-sand" tone="warning" />}
      title={storeNames[pendingReceiptCnpj(pending.accessKey)] ?? 'Nota da Sefaz'}
      subtitle={`${pendingReceiptSubtitle(pending.accessKey)} · faltam os prints da Sefaz`}
      right={<Badge label="Pendente" tone="warning" />}
      onPress={() => router.push({ pathname: '/nota/pendente', params: { chave: pending.accessKey } })}
    />
  );
}

const styles = StyleSheet.create({
  gap: { gap: space.md },
  steps: { gap: space.sm },
});

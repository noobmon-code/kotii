import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useReceipts } from '@/data/receipts';
import { formatShortDate, toISODate } from '@/domain/dates';
import { formatBRL } from '@/domain/money';
import { useReceiptScanner } from '@/features/ReceiptScanner';
import { Badge, Button, EmptyState, ErrorNotice, IconBadge, ListCard, ListRow, Loading, Row, Section, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

export function ReceiptsPanel() {
  const receipts = useReceipts();
  const scanner = useReceiptScanner();

  const drafts = (receipts.data ?? []).filter((r) => r.status === 'draft');
  const confirmed = (receipts.data ?? []).filter((r) => r.status === 'confirmed');

  const renderReceipt = (r: NonNullable<typeof receipts.data>[number]) => {
    const count = r.receipt_items[0]?.count ?? 0;
    return (
      <ListRow
        key={r.id}
        left={<IconBadge icon="receipt-text-outline" tone={r.status === 'draft' ? 'info' : 'neutral'} />}
        title={r.store?.name ?? 'Mercado não informado'}
        subtitle={`${formatShortDate(toISODate(new Date(r.purchased_at)))} · ${count} ${count === 1 ? 'item' : 'itens'}`}
        right={
          r.status === 'draft' ? (
            <Badge label="Revisar" tone="info" />
          ) : r.total != null ? (
            <Text variant="label">{formatBRL(r.total)}</Text>
          ) : null
        }
        onPress={() => router.push({ pathname: '/nota/[id]', params: { id: r.id } })}
      />
    );
  };

  return (
    <View style={styles.gap}>
      <Row>
        <Button title="Adicionar nota" icon="camera-outline" onPress={scanner.open} loading={scanner.busy} style={styles.flex} />
        <Button title="Preços" icon="chart-line" variant="secondary" onPress={() => router.push('/precos')} style={styles.flex} />
      </Row>

      {receipts.isPending ? <Loading /> : null}
      {receipts.isError ? <ErrorNotice error={receipts.error} onRetry={() => receipts.refetch()} /> : null}

      {receipts.data && receipts.data.length === 0 ? (
        <EmptyState
          icon="receipt-text-outline"
          title="Nenhuma nota ainda"
          message="Fotografe o cupom depois das compras. Com notas de mercados diferentes, o app compara preços e diz onde sua lista sai mais barata."
        />
      ) : null}

      {drafts.length ? (
        <Section title="Para revisar">
          <ListCard>{drafts.map(renderReceipt)}</ListCard>
        </Section>
      ) : null}

      {confirmed.length ? (
        <Section title="Histórico">
          <ListCard>{confirmed.map(renderReceipt)}</ListCard>
        </Section>
      ) : null}

      {scanner.element}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space.lg },
});

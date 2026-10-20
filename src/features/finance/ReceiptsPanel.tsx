import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useDraftReceipts, useReceiptHistory, type ReceiptListRow } from '@/data/receipts';
import { formatShortDate, toISODate } from '@/domain/dates';
import { formatBRL } from '@/domain/money';
import { receiptsByMonth, receiptsMore } from '@/domain/receiptList';
import { useReceiptScanner } from '@/features/ReceiptScanner';
import { Badge, Button, EmptyState, ErrorNotice, IconBadge, ListCard, ListRow, Loading, Row, Section, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

/**
 * Finanças > Notas: os rascunhos para revisar (todos, também os antigos) e o histórico das confirmadas, da mais
 * recente para a mais antiga, separado por mês e em páginas: o que ainda não veio é contado, com o botão de
 * ver mais. Nenhuma nota some calada.
 */
export function ReceiptsPanel() {
  const drafts = useDraftReceipts();
  const history = useReceiptHistory();
  const scanner = useReceiptScanner();

  const confirmed = history.data?.pages.flatMap((page) => page.rows) ?? [];
  const months = receiptsByMonth(confirmed);
  const shown = months.reduce((sum, group) => sum + group.receipts.length, 0);
  const lastPage = history.data?.pages[history.data.pages.length - 1];
  const more = lastPage && history.hasNextPage ? receiptsMore(shown, lastPage.remaining) : null;
  const empty = drafts.data?.length === 0 && confirmed.length === 0 && history.data !== undefined;

  const renderReceipt = (r: ReceiptListRow) => {
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
      <View style={styles.actions}>
        <Button title="Adicionar nota" icon="camera-outline" onPress={scanner.open} loading={scanner.busy} />
        <Row>
          <Button title="Preços" icon="chart-line" variant="secondary" onPress={() => router.push('/precos')} style={styles.prices} />
          <Button title="Mercado do mês" icon="cart-outline" variant="secondary" onPress={() => router.push('/mercado')} style={styles.market} />
        </Row>
      </View>

      {drafts.isPending || history.isPending ? <Loading /> : null}

      {empty ? (
        <EmptyState
          icon="receipt-text-outline"
          title="Nenhuma nota ainda"
          message="Fotografe o cupom depois das compras. Com notas de mercados diferentes, o app compara preços e diz onde sua lista sai mais barata."
        />
      ) : null}

      {/* Os rascunhos e o histórico são duas buscas: uma que falha não esconde a outra. */}
      {drafts.isError && !drafts.data ? <ErrorNotice error={drafts.error} onRetry={() => drafts.refetch()} /> : null}
      {drafts.data?.length ? (
        <Section title="Para revisar">
          <ListCard>{drafts.data.map(renderReceipt)}</ListCard>
        </Section>
      ) : null}

      {history.isError && !history.data ? <ErrorNotice error={history.error} onRetry={() => history.refetch()} /> : null}
      {months.length ? (
        <Section title="Histórico">
          {months.map((group) => (
            <View key={group.month} style={styles.month}>
              <Text variant="label" accessibilityRole="header">
                {group.title}
              </Text>
              <ListCard>{group.receipts.map(renderReceipt)}</ListCard>
            </View>
          ))}
          {/* A página seguinte que falhou: as notas que já vieram ficam, com o erro e o "Tentar de novo". */}
          {history.isFetchNextPageError ? <ErrorNotice error={history.error} onRetry={() => history.fetchNextPage()} /> : null}
          {more ? (
            <View style={styles.more}>
              {more.note ? <Text variant="small">{more.note}</Text> : null}
              {history.isFetchNextPageError ? null : (
                <Button title={more.button} variant="secondary" compact loading={history.isFetchingNextPage} onPress={() => history.fetchNextPage()} />
              )}
            </View>
          ) : null}
        </Section>
      ) : null}

      {scanner.element}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: space.lg },
  actions: { gap: space.sm },
  // O nome mais comprido leva mais espaço, para os dois caberem numa linha num celular comum (de 360 de largura em diante).
  prices: { flex: 2 },
  market: { flex: 3 },
  month: { gap: space.sm },
  more: { gap: space.sm },
});

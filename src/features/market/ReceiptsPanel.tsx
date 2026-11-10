import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { usePendingReceipts } from '@/data/pendingReceipts';
import { useDraftReceipts, useReceiptHistory, type ReceiptListRow } from '@/data/receipts';
import { formatShortDate, toISODate } from '@/domain/dates';
import { formatBRL } from '@/domain/money';
import { receiptsByMonth, receiptsMore } from '@/domain/receiptList';
import { PendingReceiptRow } from '@/features/PendingReceiptCard';
import { useReceiptScanner } from '@/features/ReceiptScanner';
import { FeatureCard } from '@/ui/FeatureCard';
import { Badge, Button, EmptyState, ErrorNotice, IconBadge, ListCard, ListRow, Loading, Section, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

/** O cartão do Mercado do mês, no alto das notas. */
export const MARKET_MONTH_CARD = {
  title: 'Para onde foi o dinheiro do mercado',
  subtitle: 'Mercado do mês: por item, por categoria e por mercado',
} as const;

/**
 * A lista das notas (Compras → Notas): os rascunhos para revisar (todos, também os antigos) e o histórico das confirmadas, da mais
 * recente para a mais antiga, separado por mês e em páginas: o que ainda não veio é contado, com o botão de
 * ver mais. Nenhuma nota some calada. Antes delas, as pendentes deste aparelho: a Sefaz pediu o "não sou robô" e a
 * nota espera os prints.
 */
export function ReceiptsPanel() {
  const drafts = useDraftReceipts();
  const history = useReceiptHistory();
  const scanner = useReceiptScanner();
  const { pending, storeNames } = usePendingReceipts();

  const confirmed = history.data?.pages.flatMap((page) => page.rows) ?? [];
  const months = receiptsByMonth(confirmed);
  const shown = months.reduce((sum, group) => sum + group.receipts.length, 0);
  const lastPage = history.data?.pages[history.data.pages.length - 1];
  const more = lastPage && history.hasNextPage ? receiptsMore(shown, lastPage.remaining) : null;
  const empty = drafts.data?.length === 0 && confirmed.length === 0 && history.data !== undefined && !pending.length;

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
      {/* A entrada do Mercado do mês, que nasce destas notas: é a única (os Preços ficam em Compras → Listas). */}
      <FeatureCard
        gradient="salvia"
        title={MARKET_MONTH_CARD.title}
        subtitle={MARKET_MONTH_CARD.subtitle}
        onPress={() => router.push('/mercado')}
      />
      <Button title="Adicionar nota" icon="camera-outline" onPress={scanner.open} loading={scanner.busy} />

      {drafts.isPending || history.isPending ? <Loading /> : null}

      {empty ? (
        <EmptyState
          icon="receipt-text-outline"
          title="Nenhuma nota ainda"
          message="Fotografe o cupom depois das compras. Com notas de mercados diferentes, o app compara preços e diz onde sua lista sai mais barata."
        />
      ) : null}

      {pending.length ? (
        <Section title="Esperando os prints">
          <ListCard>
            {pending.map((p) => (
              <PendingReceiptRow key={p.accessKey} pending={p} storeNames={storeNames} />
            ))}
          </ListCard>
        </Section>
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
  month: { gap: space.sm },
  more: { gap: space.sm },
});

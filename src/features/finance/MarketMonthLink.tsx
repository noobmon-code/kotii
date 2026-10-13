import { router } from 'expo-router';
import { useMemo } from 'react';

import { useMarketReceipts } from '@/data/marketSpend';
import { todayISO } from '@/domain/dates';
import { marketMonth } from '@/domain/marketSpend';
import { Icon, IconBadge, ListCard, ListRow } from '@/ui/primitives';

/** No resumo de gastos: a entrada do "Mercado do mês", com o total do mês que o resumo está mostrando. */
export function MarketMonthLink({ month }: { month: string }) {
  const receipts = useMarketReceipts(month);
  const today = todayISO();
  const summary = useMemo(() => (receipts.data ? marketMonth(receipts.data, month, today) : null), [receipts.data, month, today]);
  // Sem os números (ainda carregando, ou a busca falhou), a linha leva à tela do mesmo jeito: é lá que o erro aparece.
  const subtitle = !summary ? 'Por categoria, por item e por mercado' : summary.trips.length ? summary.headline : summary.emptyTitle;
  return (
    <ListCard>
      <ListRow
        left={<IconBadge icon="cart-outline" tone="primary" />}
        title="Para onde foi o dinheiro do mercado"
        subtitle={subtitle}
        right={<Icon name="chevron-right" color="textMuted" />}
        onPress={() => router.push({ pathname: '/mercado', params: { mes: month } })}
      />
    </ListCard>
  );
}

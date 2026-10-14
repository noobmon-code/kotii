import { router } from 'expo-router';
import { useMemo } from 'react';

import { todayISO } from '@/domain/dates';
import { marketTotal, type MarketTotalReceipt } from '@/domain/marketSpend';
import { Icon, IconBadge, ListCard, ListRow } from '@/ui/primitives';

/**
 * No resumo de gastos: a entrada do "Mercado do mês", com o total do mês que
 * o resumo está mostrando. O total sai das notas que o resumo já leu
 * (`receipts`), pela mesma conta do cabeçalho da tela (marketTotal): a
 * entrada não faz busca nenhuma, e muito menos a da tela.
 */
export function MarketMonthLink({ month, receipts }: { month: string; receipts: MarketTotalReceipt[] | undefined }) {
  // Com o dia de hoje: no mês corrente a conta vai até hoje, como na tela.
  const today = todayISO();
  const total = useMemo(() => (receipts ? marketTotal(receipts, month, today) : null), [receipts, month, today]);
  // Sem as notas na mão, a linha leva à tela do mesmo jeito.
  const subtitle = !total ? 'Por categoria, por item e por mercado' : total.trips ? total.headline : total.emptyTitle;
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

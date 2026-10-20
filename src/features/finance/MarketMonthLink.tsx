import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { todayISO } from '@/domain/dates';
import { marketTotal, marketVsSummary, type MarketTotalReceipt } from '@/domain/marketSpend';
import { Icon, IconBadge, ListCard, ListRow, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

/**
 * No resumo de gastos: a entrada do "Mercado do mês", com o total do mês que
 * o resumo está mostrando. O total sai das notas que o resumo já leu
 * (`receipts`), pela mesma conta do cabeçalho da tela (marketTotal): a
 * entrada não faz busca nenhuma, e muito menos a da tela. Logo abaixo, a
 * frase que diz por que o número não é o da barra "Mercado" do resumo.
 */
export function MarketMonthLink({ month, receipts }: { month: string; receipts: MarketTotalReceipt[] | undefined }) {
  // Com o dia de hoje: no mês corrente a conta vai até hoje, como na tela.
  const today = todayISO();
  const total = useMemo(() => (receipts ? marketTotal(receipts, month, today) : null), [receipts, month, today]);
  // Sem as notas na mão, a linha leva à tela do mesmo jeito.
  const subtitle = !total ? 'Por categoria, por item e por mercado' : total.trips ? total.headline : total.emptyTitle;
  return (
    <View style={styles.gap}>
      <ListCard>
        <ListRow
          left={<IconBadge icon="cart-outline" tone="primary" />}
          title="Para onde foi o dinheiro do mercado"
          subtitle={subtitle}
          right={<Icon name="chevron-right" color="textMuted" />}
          onPress={() => router.push({ pathname: '/mercado', params: { mes: month } })}
        />
      </ListCard>
      <Text variant="small">{marketVsSummary(month, today, 'resumo')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: space.sm },
});

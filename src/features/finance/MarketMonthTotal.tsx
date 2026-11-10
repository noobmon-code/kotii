import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { todayISO } from '@/domain/dates';
import type { Entry } from '@/domain/finance';
import { MARKET_MONTH_WHERE, marketSpendsOf, marketTotal, marketVsSummary, type MarketTotalReceipt } from '@/domain/marketSpend';
import { IconBadge, ListCard, ListRow, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

/**
 * No resumo de gastos (só com a chave de Finanças ligada): o total do "Mercado do mês" no mês que o resumo está
 * mostrando. Não abre a tela: o Mercado do mês tem uma entrada só, o cartão de Compras → Notas (decisão do dono), e
 * a linha diz que é lá. O total sai das notas que o resumo já leu (`receipts`) e dos lançamentos dele (`entries`, de
 * onde vêm os gastos avulsos e as contas pagas lançados como Mercado), pela mesma conta do cabeçalho da tela
 * (marketTotal): a linha não faz busca nenhuma, e muito menos a da tela. Bate com a tela enquanto a leitura do resumo
 * vier inteira (ela é uma busca só, sem páginas; a da tela lê em páginas). Logo abaixo, a frase que diz por que o
 * número não é o da barra "Mercado" do resumo.
 */
export function MarketMonthTotal({
  month,
  receipts,
  entries,
}: {
  month: string;
  receipts: MarketTotalReceipt[] | undefined;
  entries: Entry[];
}) {
  // Com o dia de hoje: no mês corrente a conta vai até hoje, como na tela.
  const today = todayISO();
  const total = useMemo(() => (receipts ? marketTotal(receipts, month, today, marketSpendsOf(entries)) : null), [receipts, entries, month, today]);
  // Sem as notas na mão, a linha só diz onde ver.
  const subtitle = !total ? MARKET_MONTH_WHERE : total.trips ? total.headline : total.emptyTitle;
  return (
    <View style={styles.gap}>
      <ListCard>
        <ListRow left={<IconBadge icon="cart-outline" tone="primary" />} title="Mercado do mês" subtitle={subtitle} />
      </ListCard>
      <Text variant="small">{marketVsSummary(month, today, 'resumo')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: space.sm },
});

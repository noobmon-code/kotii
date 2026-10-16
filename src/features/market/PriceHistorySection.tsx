import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useProductPurchases } from '@/data/market';
import { todayISO } from '@/domain/dates';
import { chooseInHistory, priceHistoryView, type HistoryChoices } from '@/domain/priceHistory';
import { Badge, Button, Card, Chip, ErrorNotice, ListCard, ListRow, Loading, Row, Section, Segmented, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

import { PriceChart } from './PriceChart';

interface Props {
  productId: string;
  /** O nome entra na frase que descreve o gráfico para leitor de tela. */
  productName: string;
}

/**
 * "Histórico de preço" na tela do produto: o resumo em frases, o gráfico e
 * cada compra, que abre a nota. As regras (o que entra, as frases, os pontos
 * do gráfico) estão em domain/priceHistory; aqui só se escolhe e desenha. Tem
 * o seu carregando e o seu erro: não segura o resto da tela. Produto sem
 * compra nenhuma não tem a seção: a tela já diz isso em "Último preço por
 * mercado".
 */
export function PriceHistorySection(props: Props) {
  // Outro produto na mesma tela começa sem as escolhas do anterior.
  return <PriceHistory key={props.productId} {...props} />;
}

const TITLE = 'Histórico de preço';

/** Nada escolhido ainda: vale o padrão (a unidade com mais compras, "6 meses" ou "Tudo", todos os mercados). */
const NO_CHOICE: HistoryChoices = { unit: null, period: null, store: null, more: 0 };

function PriceHistory({ productId, productName }: Props) {
  const purchases = useProductPurchases(productId);
  const [choices, setChoices] = useState(NO_CHOICE);
  const context = { today: todayISO(), productName };

  // Com o histórico já na tela, uma atualização que falhou não o tira dela.
  const { data } = purchases;
  if (data === undefined) {
    return (
      <Section title={TITLE}>
        {purchases.fetchStatus === 'paused' ? (
          // Sem internet a busca fica parada, e segue sozinha quando a conexão volta: um aviso, em vez de girar sem fim.
          <ErrorNotice error={{ message: 'Sem internet: o histórico de preço aparece quando a conexão voltar.' }} />
        ) : purchases.isError ? (
          <ErrorNotice error={purchases.error} onRetry={() => purchases.refetch()} />
        ) : (
          <Loading />
        )}
      </Section>
    );
  }
  const view = priceHistoryView(data, choices, context);
  if (!view) return null;
  // Outra unidade, período ou mercado: a lista volta às primeiras compras, e o mercado que fica escolhido é o que o
  // domínio decidiu (o que saiu de vista é esquecido, e não volta sozinho no toque seguinte).
  const choose = (choice: Parameters<typeof chooseInHistory>[2]) => setChoices((current) => chooseInHistory(data, current, choice, context));

  return (
    <Section title={TITLE}>
      {view.units.length ? <Segmented options={view.units} value={view.unit} onChange={(unit) => choose({ unit })} /> : null}
      <Row style={styles.wrap}>
        {view.periods.map((period) => (
          <Chip key={period.value} label={period.label} selected={period.value === view.period} onPress={() => choose({ period: period.value })} />
        ))}
      </Row>
      {view.stores.length ? (
        <Row style={styles.wrap}>
          {view.stores.map((store) => (
            // O nome do mercado vem da nota e pode ser comprido. Na web o chip não encolhe sozinho: com a largura da
            // linha como limite, o nome quebra em duas linhas em vez de passar da tela.
            <View key={store.value} style={styles.chip}>
              <Chip label={store.label} selected={store.value === view.store} onPress={() => choose({ store: store.value })} />
            </View>
          ))}
        </Row>
      ) : null}
      <Card style={styles.gap}>
        <View style={styles.gapXs}>
          {view.summary.map((sentence, index) => (
            // A primeira frase é a última compra; sem compra com preço à vista, a única frase é um aviso.
            <Text key={sentence} variant={index === 0 && view.headline ? 'label' : 'muted'}>
              {sentence}
            </Text>
          ))}
        </View>
        {view.chart ? <PriceChart chart={view.chart} /> : null}
      </Card>
      {view.rows.length ? (
        <ListCard>
          {view.rows.map((row) => (
            <ListRow
              key={row.key}
              title={row.title}
              subtitle={row.detail}
              right={
                <View style={styles.price}>
                  <Text variant={row.priced ? 'label' : 'muted'}>{row.price}</Text>
                  {row.discounted ? (
                    // O Badge se alinha à esquerda de onde está: dentro de uma caixa do tamanho dele, fica à direita, sob o preço.
                    <View>
                      <Badge label="com desconto" tone="primary" />
                    </View>
                  ) : null}
                </View>
              }
              onPress={() => router.push({ pathname: '/nota/[id]', params: { id: row.receiptId } })}
            />
          ))}
        </ListCard>
      ) : null}
      {view.more ? (
        <Button
          title={view.more}
          accessibilityLabel={view.moreAccessibilityLabel ?? undefined}
          variant="ghost"
          compact
          onPress={() => setChoices((current) => ({ ...current, more: current.more + 1 }))}
        />
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  wrap: { flexWrap: 'wrap' },
  chip: { maxWidth: '100%' },
  gap: { gap: space.md },
  gapXs: { gap: space.xs },
  price: { alignItems: 'flex-end', gap: space.xs },
});

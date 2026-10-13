import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useProductPurchases } from '@/data/market';
import { todayISO } from '@/domain/dates';
import { priceHistoryView, type HistoryChoices } from '@/domain/priceHistory';
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
 * o seu carregando e o seu erro: não segura o resto da tela.
 */
export function PriceHistorySection(props: Props) {
  return (
    <Section title="Histórico de preço">
      {/* Outro produto na mesma tela começa sem as escolhas do anterior. */}
      <PriceHistory key={props.productId} {...props} />
    </Section>
  );
}

/** Nada escolhido ainda: vale o padrão (a unidade com mais compras, "6 meses" ou "Tudo", todos os mercados). */
const NO_CHOICE: HistoryChoices = { unit: null, period: null, store: null, more: 0 };

function PriceHistory({ productId, productName }: Props) {
  const purchases = useProductPurchases(productId);
  const [choices, setChoices] = useState(NO_CHOICE);
  // Outra unidade, período ou mercado: a lista volta às primeiras compras.
  const choose = (choice: Partial<HistoryChoices>) => setChoices((current) => ({ ...current, more: 0, ...choice }));

  // Com o histórico já na tela, uma atualização que falhou não o tira dela.
  if (purchases.data === undefined) {
    return purchases.isError ? <ErrorNotice error={purchases.error} onRetry={() => purchases.refetch()} /> : <Loading />;
  }
  const view = priceHistoryView(purchases.data, choices, { today: todayISO(), productName });
  if (!view) return <Text variant="muted">Nenhuma nota confirmada com este produto ainda.</Text>;

  return (
    <>
      {view.units.length ? <Segmented options={view.units} value={view.unit} onChange={(unit) => choose({ unit })} /> : null}
      <Row style={styles.wrap}>
        {view.periods.map((period) => (
          <Chip key={period.value} label={period.label} selected={period.value === view.period} onPress={() => choose({ period: period.value })} />
        ))}
      </Row>
      {view.stores.length ? (
        <Row style={styles.wrap}>
          {view.stores.map((store) => (
            <Chip key={store.value} label={store.label} selected={store.value === view.store} onPress={() => choose({ store: store.value })} />
          ))}
        </Row>
      ) : null}
      <Card style={styles.gap}>
        <View style={styles.gapXs}>
          {view.summary.map((sentence, index) => (
            // A primeira frase é a última compra; num período sem compras, a única frase é o aviso.
            <Text key={sentence} variant={index === 0 && view.rows.length ? 'label' : 'muted'}>
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
                  <Text variant="label">{row.price}</Text>
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
        <Button title={view.more} variant="ghost" compact onPress={() => setChoices((current) => ({ ...current, more: current.more + 1 }))} />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { flexWrap: 'wrap' },
  gap: { gap: space.md },
  gapXs: { gap: space.xs },
  price: { alignItems: 'flex-end', gap: space.xs },
});

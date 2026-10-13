import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useMarketReceipts } from '@/data/marketSpend';
import { getCategory } from '@/domain/categories';
import { todayISO } from '@/domain/dates';
import { monthLabel, shiftMonth } from '@/domain/finance';
import { marketMonth, monthFromParam, type MarketMonth, type MarketReceiptRef } from '@/domain/marketSpend';
import { BarRow } from '@/features/finance/BarRow';
import { useReceiptScanner } from '@/features/ReceiptScanner';
import {
  Button,
  Card,
  CategoryIcon,
  Chip,
  EmptyState,
  ErrorNotice,
  Icon,
  IconBadge,
  IconButton,
  ListCard,
  ListRow,
  Loading,
  Row,
  Screen,
  Section,
  Text,
} from '@/ui/primitives';
import { space } from '@/ui/theme';

/** Quantos itens aparecem antes de "Ver todos". */
const ITEMS_SHOWN = 10;

const capitalizeFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const openReceipt = (id: string) => router.push({ pathname: '/nota/[id]', params: { id } });

/** Mercado do mês: para onde foi o dinheiro do mercado. As contas e os textos vêm de domain/marketSpend. */
export default function MarketMonthScreen() {
  const { mes } = useLocalSearchParams<{ mes?: string }>();
  const today = todayISO();
  const current = today.slice(0, 7);
  // O mês vive na URL: o resumo de gastos abre a tela no mês que estava mostrando.
  const month = monthFromParam(mes, current);
  const receipts = useMarketReceipts(month);
  const scanner = useReceiptScanner();
  const [category, setCategory] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const summary = useMemo(() => (receipts.data ? marketMonth(receipts.data, month, today) : null), [receipts.data, month, today]);

  function goTo(target: string) {
    if (target > current) return;
    setCategory(null);
    setShowAll(false);
    router.setParams({ mes: target });
  }

  return (
    <Screen edges={[]} refreshing={receipts.isRefetching} onRefresh={() => receipts.refetch()}>
      <Row style={styles.monthNav}>
        <IconButton icon="chevron-left" label="Mês anterior" onPress={() => goTo(shiftMonth(month, -1))} />
        <Text variant="label" style={styles.monthTitle}>
          {capitalizeFirst(monthLabel(month))}
        </Text>
        {month < current ? (
          <IconButton icon="chevron-right" label="Próximo mês" onPress={() => goTo(shiftMonth(month, 1))} />
        ) : (
          <View style={styles.navPlaceholder} />
        )}
      </Row>

      {receipts.isPending ? (
        <Loading />
      ) : !summary ? (
        // Sem as notas não há o que mostrar: o erro, nunca um mês "sem gasto".
        <ErrorNotice error={receipts.error} onRetry={() => receipts.refetch()} />
      ) : (
        <MonthBody
          summary={summary}
          // A nova busca falhou e os números de antes continuam na tela.
          stale={receipts.isError}
          onRetry={() => receipts.refetch()}
          category={summary.categories.some((c) => c.key === category) ? category : null}
          onCategory={setCategory}
          showAll={showAll}
          onShowAll={setShowAll}
          onAddReceipt={scanner.open}
          adding={scanner.busy}
        />
      )}

      {scanner.element}
    </Screen>
  );
}

function MonthBody({
  summary,
  stale,
  onRetry,
  category,
  onCategory,
  showAll,
  onShowAll,
  onAddReceipt,
  adding,
}: {
  summary: MarketMonth;
  stale: boolean;
  onRetry: () => void;
  category: string | null;
  onCategory: (category: string | null) => void;
  showAll: boolean;
  onShowAll: (all: boolean) => void;
  onAddReceipt: () => void;
  adding: boolean;
}) {
  const items = category ? summary.items.filter((item) => item.category === category) : summary.items;
  const shown = showAll ? items : items.slice(0, ITEMS_SHOWN);
  const apart = summary.discount || summary.unread || summary.noValue || summary.pharmacy ? <Apart summary={summary} /> : null;
  // Os rascunhos do mês ainda não entraram no total: o aviso vem logo depois dele.
  const drafts = summary.drafts ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${summary.drafts} Abrir as notas`}
      onPress={() => router.push({ pathname: '/financas', params: { aba: 'notas' } })}>
      <Card style={styles.notice}>
        <IconBadge icon="receipt-text-outline" tone="info" />
        <Text variant="muted" style={styles.flex}>
          {summary.drafts}
        </Text>
        <Icon name="chevron-right" color="textMuted" />
      </Card>
    </Pressable>
  ) : null;

  return (
    <>
      {stale ? (
        <Card style={styles.gapSm}>
          <Row>
            <Icon name="alert-circle-outline" color="warning" />
            <Text variant="muted" style={styles.flex}>
              Não deu para atualizar agora. Estes números são da última vez que a tela carregou.
            </Text>
          </Row>
          <Button title="Tentar de novo" variant="secondary" compact onPress={onRetry} />
        </Card>
      ) : null}

      {summary.trips.length === 0 ? (
        <>
          <EmptyState
            icon="receipt-text-outline"
            title={summary.emptyTitle}
            message="As compras aparecem aqui quando uma nota fiscal é confirmada. Fotografe o cupom ou leia o QR code da nota."
            action={<Button title="Adicionar nota" icon="camera-outline" onPress={onAddReceipt} loading={adding} />}
          />
          {drafts}
          {apart}
        </>
      ) : (
        <>
          <Card style={styles.hero}>
            <Text variant="muted">{summary.title}</Text>
            <Text variant="title">{summary.headline}</Text>
            {summary.comparison ? <Text variant="small">{summary.comparison}</Text> : null}
            <Text variant="small">
              Diferente da barra “Mercado” do Resumo: aqui entram limpeza, higiene e pet, e só conta o que veio de nota fiscal.
            </Text>
          </Card>
          {drafts}

          <Section title="Por categoria">
            <Card style={styles.bars}>
              {summary.categories.map((c) => (
                <BarRow
                  key={c.key}
                  left={<CategoryIcon category={c.key} size={28} />}
                  label={c.label}
                  amount={c.amount}
                  share={c.share}
                  value={c.cents}
                  max={summary.categories[0].cents}
                  selected={category === c.key}
                  muted={category !== null && category !== c.key}
                  note={c.versusPrevious}
                  accessibilityLabel={c.accessibilityLabel}
                  onPress={() => onCategory(category === c.key ? null : c.key)}
                />
              ))}
            </Card>
            {apart}
          </Section>

          <Section
            title="Por item"
            action={category ? <Chip label={getCategory(category).label} icon="close" selected onPress={() => onCategory(null)} /> : null}>
            <ListCard>
              {shown.map((item) => (
                <ListRow
                  key={item.key}
                  left={<CategoryIcon category={item.category} name={item.name} size={36} />}
                  title={item.name}
                  subtitle={item.detail}
                  right={
                    <View style={styles.amount}>
                      <Text variant="label">{item.amount}</Text>
                      <Text variant="small">{item.share}</Text>
                    </View>
                  }
                  accessibilityLabel={item.accessibilityLabel}
                  // Item que a casa não acompanha não tem tela de produto.
                  onPress={item.productId ? () => router.push({ pathname: '/produto/[id]', params: { id: item.productId! } }) : undefined}
                />
              ))}
            </ListCard>
            {items.length > ITEMS_SHOWN ? (
              <Button
                title={showAll ? `Mostrar só os ${ITEMS_SHOWN} primeiros` : `Ver todos os ${items.length} itens`}
                variant="ghost"
                compact
                onPress={() => onShowAll(!showAll)}
              />
            ) : null}
          </Section>

          <Section title="Idas do mês">
            <ListCard>
              {summary.trips.map((trip) => (
                <ListRow
                  key={trip.receiptId}
                  left={<IconBadge icon="receipt-text-outline" />}
                  title={trip.storeName}
                  subtitle={trip.detail}
                  right={<Text variant="label">{trip.amount}</Text>}
                  accessibilityLabel={`${trip.accessibilityLabel}. Abrir a nota`}
                  onPress={() => openReceipt(trip.receiptId)}
                />
              ))}
            </ListCard>
          </Section>

          <Section title="Por mercado">
            <ListCard>
              {summary.stores.map((store) => (
                <ListRow
                  key={store.key}
                  left={<IconBadge icon="store-outline" />}
                  title={store.name}
                  subtitle={store.detail}
                  right={<Text variant="label">{store.amount}</Text>}
                  accessibilityLabel={store.accessibilityLabel}
                />
              ))}
            </ListCard>
          </Section>
        </>
      )}
    </>
  );
}

/** O que fica à parte, depois das categorias: as diferenças do total das notas, os itens sem valor e a farmácia. */
function Apart({ summary }: { summary: MarketMonth }) {
  const { discount, unread, noValue, pharmacy } = summary;
  return (
    <Card style={styles.apart}>
      {discount ? <AmountLine label={discount.label} value={discount.value} accessibilityLabel={discount.accessibilityLabel} /> : null}
      {unread ? (
        <View style={styles.gapSm}>
          <AmountLine label={unread.label} value={unread.value} accessibilityLabel={unread.accessibilityLabel} />
          <Text variant="small">A leitura pode ter perdido um item ou um valor. Abra a nota para conferir:</Text>
          {unread.receipts.map((ref) => (
            <ReceiptLink key={ref.receiptId} receipt={ref} />
          ))}
        </View>
      ) : null}
      {noValue ? (
        <View style={styles.gapSm}>
          <Text variant="body">{noValue.label}</Text>
          <Text variant="small">Contam zero até terem um valor. Abra a nota para preencher:</Text>
          {noValue.receipts.map((ref) => (
            <ReceiptLink key={ref.receiptId} receipt={ref} />
          ))}
        </View>
      ) : null}
      {pharmacy ? <Text variant="muted">{pharmacy}</Text> : null}
    </Card>
  );
}

function AmountLine({ label, value, accessibilityLabel }: { label: string; value: string; accessibilityLabel: string }) {
  return (
    <View accessible accessibilityLabel={accessibilityLabel} style={styles.amountLine}>
      <Text variant="body" style={styles.flex}>
        {label}
      </Text>
      <Text variant="label">{value}</Text>
    </View>
  );
}

function ReceiptLink({ receipt }: { receipt: MarketReceiptRef }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={receipt.accessibilityLabel}
      onPress={() => openReceipt(receipt.receiptId)}
      style={({ pressed }) => [styles.receiptLink, pressed && styles.pressed]}>
      <Icon name="receipt-text-outline" size={18} color="textMuted" />
      <Text variant="muted" style={styles.flex} numberOfLines={1}>
        {`${receipt.storeName} · ${receipt.date}`}
      </Text>
      <Text variant="label">{receipt.value}</Text>
      <Icon name="chevron-right" size={18} color="textMuted" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gapSm: { gap: space.sm },
  monthNav: { justifyContent: 'space-between' },
  monthTitle: { flex: 1, textAlign: 'center' },
  navPlaceholder: { width: 30 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  hero: { gap: space.xs },
  bars: { gap: space.lg },
  amount: { alignItems: 'flex-end' },
  apart: { gap: space.lg },
  amountLine: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  receiptLink: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs },
  pressed: { opacity: 0.6 },
});

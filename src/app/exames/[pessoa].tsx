import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useExams, usePeople } from '@/data/health';
import { useMedications } from '@/data/home';
import { formatBRDate, todayISO } from '@/domain/dates';
import {
  chartDescription,
  countLabel,
  examTrends,
  valueLabel,
  visitSummary,
  type TrendItem,
  type TrendPoint,
  type TrendSeries,
} from '@/domain/examTrends';
import { flagLabel } from '@/domain/health';
import { TrendChart } from '@/features/health/TrendChart';
import { VisitSummaryModal } from '@/features/health/VisitSummaryModal';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Icon,
  IconBadge,
  ListCard,
  ListRow,
  Loading,
  Row,
  Screen,
  Section,
  Text,
} from '@/ui/primitives';
import { space } from '@/ui/theme';

/** Evolução dos resultados de exame de uma pessoa e o resumo para levar à consulta. */
export default function ExamTrendsScreen() {
  const { pessoa } = useLocalSearchParams<{ pessoa: string }>();
  const people = usePeople();
  const exams = useExams();
  const medications = useMedications();
  const [open, setOpen] = useState<string | null>(null);
  // O resumo é dado de saúde: existe só aqui, na memória, enquanto a tela dele está aberta.
  const [summary, setSummary] = useState<string | null>(null);

  if (people.isPending || exams.isPending || medications.isPending) return <Loading />;
  const error = people.error ?? exams.error ?? medications.error;
  if (error) return <ErrorNotice error={error} onRetry={() => [people, exams, medications].forEach((q) => q.refetch())} />;
  const person = (people.data ?? []).find((p) => p.id === pessoa);
  if (!person) return <ErrorNotice error={new Error('Pessoa não encontrada.')} />;

  const trends = examTrends((exams.data ?? []).filter((e) => e.person_id === person.id));
  const empty = !trends.series.length && !trends.single.length && !trends.text.length;
  const toggle = (item: TrendItem) => setOpen((current) => (current === item.key ? null : item.key));
  const rows = (items: (TrendItem | TrendSeries)[]) => (
    <ListCard>
      {items.map((item) => (
        <TrendRow key={item.key} item={item} open={open === item.key} onToggle={() => toggle(item)} />
      ))}
    </ListCard>
  );

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: 'Evolução dos exames' }} />
      <Card style={styles.gap}>
        <Text variant="heading">{person.name}</Text>
        <Text variant="muted">
          O Kotii mostra os valores como estão nos laudos e não avalia resultados. As marcações (acima, abaixo, alterado) são as
          do laudo.
        </Text>
        <Button
          title="Resumo para a consulta"
          icon="text-box-outline"
          variant="secondary"
          onPress={() => setSummary(visitSummary(person, exams.data ?? [], medications.data ?? [], todayISO()))}
        />
      </Card>

      {empty ? (
        <EmptyState
          icon="chart-line"
          tint="blue"
          title="Ainda não há evolução para mostrar"
          message={`A evolução aparece quando ${person.name} tiver dois exames realizados, com data, e o mesmo item nos dois (por exemplo, glicose).`}
        />
      ) : (
        <Section title="Evolução">
          {trends.series.length ? (
            <>
              <Text variant="muted">Toque num item para ver todos os resultados dele.</Text>
              {rows(trends.series)}
            </>
          ) : (
            <Text variant="muted">
              Ainda não há o mesmo item, com número e na mesma unidade, em dois exames com data. Quando houver, a evolução
              aparece aqui.
            </Text>
          )}
        </Section>
      )}

      {trends.single.length ? <Section title="Só um resultado">{rows(trends.single)}</Section> : null}

      {trends.text.length ? <Section title="Resultados em texto">{rows(trends.text)}</Section> : null}

      {trends.undated.length ? (
        <Section title="Exames sem data">
          <Text variant="muted">Têm resultados, mas ficaram de fora por estarem sem data. Toque para informar a data.</Text>
          <ListCard>
            {trends.undated.map((e) => (
              <ListRow
                key={e.id}
                left={<IconBadge icon="test-tube" tone="info" />}
                title={e.title}
                right={<Icon name="chevron-right" color="textMuted" />}
                onPress={() => router.push({ pathname: '/exame/[id]', params: { id: e.id } })}
              />
            ))}
          </ListCard>
        </Section>
      ) : null}

      {summary !== null ? <VisitSummaryModal text={summary} onClose={() => setSummary(null)} /> : null}
    </Screen>
  );
}

/** Um item: último valor, o que mudou e o gráfico (quando é série); aberto, mostra cada resultado. */
function TrendRow({ item, open, onToggle }: { item: TrendItem | TrendSeries; open: boolean; onToggle: () => void }) {
  const series = 'chart' in item ? item : null;
  const flag = flagLabel(item.last.flag);
  return (
    <View>
      <ListRow
        title={item.name}
        subtitle={
          <View style={styles.lines}>
            <Text variant="label">
              {valueLabel(item.last)} · {formatBRDate(item.last.date)}
            </Text>
            {series ? <Text variant="muted">{series.change}</Text> : null}
            {item.last.reference ? <Text variant="small">ref. no laudo: {item.last.reference}</Text> : null}
            {flag ? <Badge label={flag} tone="warning" /> : null}
          </View>
        }
        right={
          series ? (
            <TrendChart points={series.chart} label={chartDescription(series)} />
          ) : (
            <Icon name={open ? 'chevron-up' : 'chevron-down'} color="textMuted" />
          )
        }
        onPress={onToggle}
      />
      {open ? (
        <View style={styles.points}>
          <Text variant="small">
            {countLabel(item.points.length)}
            {item.points.length > 1 ? ', do mais recente para o mais antigo' : ''}. Toque para abrir o exame.
          </Text>
          {[...item.points].reverse().map((point, index) => (
            <PointRow key={`${point.examId}-${index}`} point={point} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function PointRow({ point }: { point: TrendPoint }) {
  const flag = flagLabel(point.flag);
  return (
    <ListRow
      title={valueLabel(point)}
      subtitle={[formatBRDate(point.date), point.examTitle, point.reference ? `ref. ${point.reference}` : null]
        .filter(Boolean)
        .join(' · ')}
      right={
        <Row>
          {flag ? <Badge label={flag} tone="warning" /> : null}
          <Icon name="chevron-right" color="textMuted" />
        </Row>
      }
      onPress={() => router.push({ pathname: '/exame/[id]', params: { id: point.examId } })}
    />
  );
}

const styles = StyleSheet.create({
  gap: { gap: space.sm },
  lines: { gap: space.xs, alignItems: 'flex-start' },
  points: { paddingLeft: space.lg, paddingBottom: space.sm },
});

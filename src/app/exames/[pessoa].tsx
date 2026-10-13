import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { usePeople, usePersonExams } from '@/data/health';
import { useMedications } from '@/data/home';
import { formatBRDate, todayISO } from '@/domain/dates';
import {
  apartNote,
  chartDescription,
  countLabel,
  examTrends,
  valueLabel,
  visitSummary,
  type ExamTrends,
  type TrendItem,
  type TrendPoint,
  type TrendSeries,
} from '@/domain/examTrends';
import { EXAM_STATUS, flagLabel } from '@/domain/health';
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
import { radius, space, useColors } from '@/ui/theme';

/** Evolução dos resultados de exame de uma pessoa e o resumo para levar à consulta. */
export default function ExamTrendsScreen() {
  const { pessoa } = useLocalSearchParams<{ pessoa: string }>();
  const people = usePeople();
  // Todos os exames da pessoa, e não a lista da casa, que traz só os mais recentes de todo mundo.
  const exams = usePersonExams(pessoa);
  const medications = useMedications();
  // O resumo é dado de saúde: existe só aqui, na memória, enquanto a tela dele está aberta.
  const [summary, setSummary] = useState<string | null>(null);

  // Carregando e erro só enquanto não há dados: uma atualização em segundo
  // plano que falha não tira da tela a evolução nem o resumo que está aberto.
  if (!people.data || !exams.data || !medications.data) {
    const error = people.error ?? exams.error ?? medications.error;
    if (!error) return <Loading />;
    return <ErrorNotice error={error} onRetry={() => [people, exams, medications].forEach((q) => q.refetch())} />;
  }
  const person = people.data.find((p) => p.id === pessoa);
  if (!person) return <ErrorNotice error={new Error('Pessoa não encontrada.')} />;

  // Com tudo na tela e uma busca que falhou (a atualização em segundo plano): o que aparece é o que já estava
  // carregado, e a tela diz isso em vez de passar um resultado antigo por último.
  const failed = [people, exams, medications].filter((q) => q.isError);
  const allExams = exams.data;
  const allMedications = medications.data;
  const trends = examTrends(
    allExams.filter((e) => e.person_id === person.id),
    todayISO(),
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
          onPress={() => setSummary(visitSummary(person, allExams, allMedications, todayISO()))}
        />
      </Card>

      {failed.length ? <StaleNotice onRetry={() => failed.forEach((q) => void q.refetch())} /> : null}

      <TrendLists trends={trends} personName={person.name} />

      {summary !== null ? <VisitSummaryModal text={summary} onClose={() => setSummary(null)} /> : null}
    </Screen>
  );
}

/** O aviso de que a atualização falhou, acima das listas: elas (e o resumo aberto) continuam na tela. */
function StaleNotice({ onRetry }: { onRetry: () => void }) {
  const c = useColors();
  return (
    <View style={[styles.stale, { backgroundColor: c.warningSoft }]} accessibilityRole="alert">
      <Icon name="alert-circle-outline" size={18} color="warning" />
      <Text variant="small" color="warning" style={styles.flex}>
        Não foi possível atualizar. Mostrando o que já estava carregado.
      </Text>
      <Button title="Tentar de novo" variant="secondary" compact onPress={onRetry} />
    </View>
  );
}

/**
 * As listas da evolução. O item aberto é estado daqui, e não da tela: abrir e
 * fechar um item não refaz a conta dos exames, que chega pronta em `trends`.
 */
function TrendLists({ trends, personName }: { trends: ExamTrends; personName: string }) {
  const [open, setOpen] = useState<string | null>(null);
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
    <>
      {empty ? (
        <EmptyState
          icon="chart-line"
          tint="blue"
          title="Ainda não há evolução para mostrar"
          message={`A evolução aparece quando ${personName} tiver dois exames realizados, com data, e o mesmo item nos dois (por exemplo, glicose).`}
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
          <ExamRows exams={trends.undated} />
        </Section>
      ) : null}

      {trends.future.length ? (
        <Section title="Exames com data no futuro">
          <Text variant="muted">
            Estão como realizados, mas com data no futuro: confira a data. Os resultados ficaram de fora. Toque para abrir o
            exame.
          </Text>
          <ExamRows exams={trends.future} />
        </Section>
      ) : null}

      {trends.notDone.length ? (
        <Section title="Exames que não estão como realizados">
          <Text variant="muted">
            Têm resultados anotados, mas estão como pedido ou agendado, e por isso ficaram de fora. Se o exame já foi feito,
            toque nele e marque como realizado.
          </Text>
          <ExamRows exams={trends.notDone} />
        </Section>
      ) : null}
    </>
  );
}

/** Exames que ficaram fora da evolução; cada linha abre o exame para corrigir a data ou marcar como realizado. */
function ExamRows({ exams }: { exams: { id: string; title: string; date?: string; status?: ExamTrends['notDone'][number]['status'] }[] }) {
  return (
    <ListCard>
      {exams.map((e) => (
        <ListRow
          key={e.id}
          left={<IconBadge icon="test-tube" tone="info" />}
          title={e.title}
          subtitle={e.status ? EXAM_STATUS.find((s) => s.value === e.status)?.label : e.date ? formatBRDate(e.date) : undefined}
          right={<Icon name="chevron-right" color="textMuted" />}
          onPress={() => router.push({ pathname: '/exame/[id]', params: { id: e.id } })}
        />
      ))}
    </ListCard>
  );
}

/** Um item: último valor, o que mudou e o gráfico (quando é série); aberto, mostra cada resultado. */
function TrendRow({ item, open, onToggle }: { item: TrendItem | TrendSeries; open: boolean; onToggle: () => void }) {
  const series = 'chart' in item ? item : null;
  const flag = flagLabel(item.last.flag);
  const note = apartNote(item);
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
            {note ? <Text variant="muted">{note}</Text> : null}
            {item.last.reference ? <Text variant="small">ref. no laudo: {item.last.reference}</Text> : null}
            {flag ? <Badge label={flag} tone="warning" /> : null}
          </View>
        }
        right={
          // A seta fica embaixo do gráfico, e não ao lado: numa tela estreita não sobra largura para mais uma coluna.
          <View style={styles.side}>
            {series?.chart.length ? <TrendChart points={series.chart} label={chartDescription(series)} /> : null}
            <Icon name={open ? 'chevron-up' : 'chevron-down'} color="textMuted" size={series?.chart.length ? 18 : 22} />
          </View>
        }
        expanded={open}
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
  flex: { flex: 1 },
  stale: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  lines: { gap: space.xs, alignItems: 'flex-start' },
  side: { alignItems: 'center' },
  points: { paddingLeft: space.lg, paddingBottom: space.sm },
});

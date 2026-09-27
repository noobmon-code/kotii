import * as Clipboard from 'expo-clipboard';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useMedicalExpenses } from '@/data/finance';
import { formatShortDate, todayISO } from '@/domain/dates';
import { defaultTaxYear, formatTaxDoc, medicalExpenseReport, reportText, type MedicalEntry } from '@/domain/incomeTax';
import { formatBRL } from '@/domain/money';
import { notify } from '@/ui/dialogs';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  ListRow,
  Loading,
  Row,
  Screen,
  Segmented,
  Text,
} from '@/ui/primitives';
import { space } from '@/ui/theme';

/** Relatório das despesas médicas do ano, por quem atendeu, para a declaração do IR. */
export default function IncomeTaxScreen() {
  const today = todayISO();
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(defaultTaxYear(today));
  const entries = useMedicalExpenses(year);

  const years = [thisYear - 2, thisYear - 1, thisYear].map((y) => ({ value: String(y), label: String(y) }));
  const report = entries.data ? medicalExpenseReport(entries.data, year) : null;

  const open = (entry: MedicalEntry) =>
    router.push({ pathname: entry.source === 'conta' ? '/conta/[id]' : '/gasto/[id]', params: { id: entry.refId } });

  async function copy() {
    if (!report) return;
    await Clipboard.setStringAsync(reportText(report));
    notify('Resumo copiado', 'Cole nas notas do celular ou mande para quem faz a sua declaração.');
  }

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: 'Despesas médicas (IR)' }} />
      <Segmented options={years} value={String(year)} onChange={(v) => setYear(Number(v))} />

      {entries.isPending ? (
        <Loading />
      ) : entries.isError ? (
        <ErrorNotice error={entries.error} onRetry={() => entries.refetch()} />
      ) : !report?.groups.length ? (
        <EmptyState
          icon="file-document-outline"
          tint="green"
          title={`Nada marcado em ${year}`}
          message="Num gasto de saúde, ligue “Dedutível no Imposto de Renda” e informe quem atendeu e o CPF ou CNPJ. Contas como o plano de saúde também podem ser marcadas."
        />
      ) : (
        <>
          <Card style={styles.gap}>
            <Text variant="muted">Total dedutível em {year}</Text>
            <Text variant="title">{formatBRL(report.total)}</Text>
            <Text variant="small">
              {report.groups.length} {report.groups.length === 1 ? 'prestador' : 'prestadores'}. Na declaração, cada um vai em
              Pagamentos Efetuados, com o CPF ou CNPJ.
            </Text>
            {report.missingDoc ? (
              <Badge
                label={`Falta CPF/CNPJ em ${report.missingDoc} ${report.missingDoc === 1 ? 'prestador' : 'prestadores'}: toque num lançamento para completar`}
                tone="warning"
              />
            ) : null}
            <Button title="Copiar resumo" icon="content-copy" variant="secondary" compact onPress={copy} />
          </Card>

          {report.groups.map((group) => (
            <Card key={group.key} style={styles.gapSm}>
              <Row>
                <View style={styles.flex}>
                  <Text variant="heading">{group.name}</Text>
                  {group.doc ? <Text variant="small">{formatTaxDoc(group.doc)}</Text> : null}
                </View>
                <Text variant="label">{formatBRL(group.total)}</Text>
              </Row>
              {group.doc ? null : <Badge label="Sem CPF/CNPJ" tone="warning" />}
              {group.patients.length ? <Text variant="small">Paciente: {group.patients.join(', ')}</Text> : null}
              {group.entries.map((entry) => (
                <ListRow
                  key={entry.id}
                  title={entry.description}
                  subtitle={`${formatShortDate(entry.date, year)}${entry.patientName ? ` · ${entry.patientName}` : ''}`}
                  right={<Text variant="body">{formatBRL(entry.amount)}</Text>}
                  onPress={() => open(entry)}
                />
              ))}
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space.sm },
  gapSm: { gap: space.xs },
});

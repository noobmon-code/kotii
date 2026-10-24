import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { AppDashboardForbidden, useAppDashboard } from '@/data/appDashboard';
import { useAppFeedback, useRefetchAppFeedback } from '@/data/appFeedback';
import { APP_DASHBOARD_NOT_READY, dashboardView, type AppDashboard } from '@/domain/appDashboard';
import { feedbackTabLabel, newFeedbackLine } from '@/domain/appFeedback';
import { PANEL_MAX_WIDTH, PANEL_TABS, panelLayout, panelTabFromParam, type PanelLayout, type PanelTab } from '@/domain/panelLayout';
import { TERMS_ACCEPT_VERSION } from '@/domain/terms';
import { FactRow } from '@/features/admin/FactRow';
import { FeedbackInbox } from '@/features/admin/FeedbackInbox';
import { MeterRow } from '@/features/admin/MeterRow';
import { PanelCell, PanelGrid } from '@/features/admin/PanelGrid';
import { PanelLock } from '@/features/admin/PanelLock';
import { StatGrid } from '@/features/admin/StatGrid';
import { UsageBars } from '@/features/admin/UsageBars';
import { StaleNotice } from '@/features/health/StaleNotice';
import { errorMessage } from '@/lib/supabase';
import { Card, EmptyState, ErrorNotice, Icon, LinkButton, Loading, Row, Screen, Section, Segmented, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

/**
 * Painel do app (de Configurações, só para quem está em app_admins), em duas abas guardadas na URL (?aba=):
 * Números, os de uso (quantas contas e casas, quantas pessoas usaram o app, o Nuke e a IA, as funções que as casas
 * usam, a entrada e os aparelhos; só totais, nenhuma pessoa ou casa: data/appDashboard), e Recados, a caixa dos
 * recados que as pessoas mandam pelo Nuke (data/appFeedback). Feito para o computador: até PANEL_MAX_WIDTH de
 * largura, os números numa grade de colunas e os recados em duas partes lado a lado (domain/panelLayout); no
 * celular, uma coluna só. A tela só desenha: os números, as frases e as barras vêm prontos de dashboardView
 * (domain/appDashboard) e os recados, de domain/appFeedback. Fora da guarda da casa: abre também para quem ainda
 * não está em nenhuma.
 */
export default function AppDashboardScreen() {
  const { aba } = useLocalSearchParams<{ aba?: string }>();
  // A aba vive na URL: recarregar a página não a perde, e trocar de aba não empilha telas (setParams).
  const tab = panelTabFromParam(aba);
  const layout = panelLayout(useWindowDimensions().width);
  const dashboard = useAppDashboard();
  // Os recados novos: o número da aba e a linha da aba Números (a mesma lista com que a caixa abre).
  const fresh = useAppFeedback('novo');
  const refetchFeedback = useRefetchAppFeedback();
  const [pulling, setPulling] = useState(false);
  const inbox = tab === 'recados';
  const newCount = fresh.data?.counts.novo ?? 0;
  const showTab = (value: PanelTab) => router.setParams({ aba: value });
  const refresh = () => {
    if (inbox) {
      setPulling(true);
      void refetchFeedback().finally(() => setPulling(false));
      return;
    }
    void dashboard.refetch();
    void fresh.refetch();
  };
  const screen = (children: ReactNode) => (
    <Screen
      edges={[]}
      maxWidth={PANEL_MAX_WIDTH}
      // Na janela larga, os recados não rolam com a tela: a lista e o recado aberto rolam cada um do seu lado.
      scroll={!(inbox && layout.masterDetail)}
      refreshing={inbox ? pulling : dashboard.isRefetching}
      onRefresh={refresh}>
      {children}
    </Screen>
  );

  // A recusa vale também com números ou recados na tela: a pessoa deixou de estar em app_admins.
  if (dashboard.error instanceof AppDashboardForbidden || fresh.error instanceof AppDashboardForbidden) {
    return screen(<PanelLock />);
  }

  const tabs = PANEL_TABS.map((option) => ({
    value: option.value,
    label: option.value === 'recados' ? feedbackTabLabel(newCount) : option.label,
  }));
  const newLine = newFeedbackLine(newCount);
  return screen(
    <>
      <View style={layout.masterDetail ? styles.tabsWide : null}>
        <Segmented options={tabs} value={tab} onChange={showTab} />
      </View>
      {inbox ? (
        <FeedbackInbox masterDetail={layout.masterDetail} />
      ) : (
        <>
          {newLine ? (
            <Card style={styles.notice}>
              <Icon name="message-text-outline" color="primary" />
              <Text variant="body" style={styles.flex}>
                {newLine}
              </Text>
              <LinkButton title="Ver" onPress={() => showTab('recados')} />
            </Card>
          ) : null}
          <Numbers dashboard={dashboard} layout={layout} onRetry={refresh} />
        </>
      )}
    </>,
  );
}

/** A aba Números: os estados da busca dos números e, com eles, o painel. */
function Numbers({
  dashboard,
  layout,
  onRetry,
}: {
  dashboard: ReturnType<typeof useAppDashboard>;
  layout: PanelLayout;
  onRetry: () => void;
}) {
  if (dashboard.data === undefined) {
    // Sem internet e nada na memória, a busca fica parada (não vira erro) e volta sozinha com a conexão.
    if (dashboard.fetchStatus === 'paused') {
      return (
        <Card style={styles.notice}>
          <Icon name="wifi-off" color="warning" />
          <Text variant="muted" style={styles.flex}>
            Sem internet. Os números aparecem quando a conexão voltar.
          </Text>
        </Card>
      );
    }
    if (dashboard.isError) return <ErrorNotice error={new Error(errorMessage(dashboard.error))} onRetry={onRetry} />;
    return <Loading />;
  }
  if (dashboard.data === null) {
    return <EmptyState icon="database-clock-outline" title="Ainda não disponível" message={APP_DASHBOARD_NOT_READY} />;
  }
  // A nova busca falhou e os números de antes continuam na tela.
  return <Dashboard data={dashboard.data} stale={dashboard.isError} onRetry={onRetry} layout={layout} />;
}

/**
 * Os números. No celular, uma seção embaixo da outra; na janela larga, "Agora" com os quatro números numa linha e
 * as outras seções numa grade (PanelGrid), "O que as casas usam" em duas colunas (as barras das funções têm nomes
 * longos).
 */
function Dashboard({
  data,
  stale,
  onRetry,
  layout,
}: {
  data: AppDashboard;
  stale: boolean;
  onRetry: () => void;
  layout: PanelLayout;
}) {
  const view = useMemo(() => dashboardView(data, { termsVersion: TERMS_ACCEPT_VERSION }), [data]);
  // As funções sem uso em 30 dias ficam numa frase até "Ver todas".
  const [showIdle, setShowIdle] = useState(false);
  const { nuke, ai, features, devices } = view;
  const idleToggle =
    !features.empty && features.idle.length ? (
      <LinkButton title={showIdle ? features.showLess : features.showAll} onPress={() => setShowIdle(!showIdle)} />
    ) : undefined;

  return (
    <>
      {stale ? <StaleNotice onRetry={onRetry} /> : null}

      <Section title={view.stats.title}>
        <StatGrid items={view.stats.items} columns={layout.statColumns} />
      </Section>

      <PanelGrid columns={layout.columns}>
        <Section title={view.activity.title}>
          <Card style={styles.card}>
            <UsageBars chart={view.activity.chart} />
          </Card>
        </Section>

        <Section title={view.signups.title}>
          <Card style={styles.card}>
            <UsageBars chart={view.signups.chart} />
            <Text variant="muted">{view.signups.summary}</Text>
          </Card>
        </Section>

        <Section title={nuke.title}>
          <Card style={styles.card}>
            {nuke.facts.map((fact) => (
              <FactRow key={fact.key} fact={fact} />
            ))}
            <Text variant="label" accessibilityRole="header">
              {nuke.monthsTitle}
            </Text>
            <UsageBars chart={nuke.months} />
            {nuke.perDay ? (
              <>
                <Text variant="label" accessibilityRole="header">
                  {nuke.perDayTitle}
                </Text>
                <UsageBars chart={nuke.perDay} />
              </>
            ) : null}
          </Card>
        </Section>

        <Section title={ai.title}>
          <Card style={styles.card}>
            <Text variant="small">{ai.intro}</Text>
            {ai.rows.map((row) => (
              <MeterRow key={row.key} row={row} />
            ))}
            {ai.limitNote ? (
              <Row style={styles.top}>
                <Icon name="alert-circle-outline" size={18} color="warning" />
                <Text variant="small" color="warning" style={styles.flex}>
                  {ai.limitNote}
                </Text>
              </Row>
            ) : null}
          </Card>
        </Section>

        <PanelCell span={2}>
          <Section title={features.title} action={idleToggle}>
            <Card style={styles.card}>
              <Text variant="small">{features.intro}</Text>
              {features.empty ? (
                <Text variant="muted">{features.empty}</Text>
              ) : (
                <>
                  {features.active.map((row) => (
                    <MeterRow key={row.key} row={row} />
                  ))}
                  {showIdle
                    ? features.idle.map((row) => <MeterRow key={row.key} row={row} />)
                    : features.idleSummary ? <Text variant="small">{features.idleSummary}</Text> : null}
                </>
              )}
              <Text variant="small">{features.receipts}</Text>
            </Card>
          </Section>
        </PanelCell>

        <Section title={view.funnel.title}>
          <Card style={styles.card}>
            {view.funnel.facts.map((fact) => (
              <FactRow key={fact.key} fact={fact} />
            ))}
          </Card>
        </Section>

        <Section title={devices.title}>
          <Card style={styles.card}>
            {devices.empty ? <Text variant="muted">{devices.empty}</Text> : null}
            {devices.rows.map((row) => (
              <MeterRow key={row.key} row={row} />
            ))}
            {devices.clients ? <Text variant="body">{devices.clients}</Text> : null}
            <Text variant="small">{devices.note}</Text>
          </Card>
        </Section>

        <Section title={view.extras.title}>
          <Card style={styles.card}>
            {view.extras.facts.map((fact) => (
              <FactRow key={fact.key} fact={fact} />
            ))}
          </Card>
        </Section>
      </PanelGrid>

      <View style={styles.footer}>
        <Text variant="small">{view.footer.updated}</Text>
        {view.footer.notes.map((note) => (
          <Text key={note} variant="small">
            {note}
          </Text>
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: space.md },
  notice: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  top: { alignItems: 'flex-start' },
  footer: { gap: space.xs, paddingHorizontal: space.xs },
  // Na janela larga, as duas abas não se esticam pela tela toda.
  tabsWide: { width: '100%', maxWidth: 480 },
});

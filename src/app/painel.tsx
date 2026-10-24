import { useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppDashboardForbidden, useAppDashboard } from '@/data/appDashboard';
import { APP_DASHBOARD_FORBIDDEN, APP_DASHBOARD_NOT_READY, dashboardView, type AppDashboard } from '@/domain/appDashboard';
import { TERMS_ACCEPT_VERSION } from '@/domain/terms';
import { FactRow } from '@/features/admin/FactRow';
import { MeterRow } from '@/features/admin/MeterRow';
import { StatGrid } from '@/features/admin/StatGrid';
import { UsageBars } from '@/features/admin/UsageBars';
import { StaleNotice } from '@/features/health/StaleNotice';
import { goBackOr } from '@/lib/navigation';
import { errorMessage } from '@/lib/supabase';
import { Button, Card, EmptyState, ErrorNotice, Icon, LinkButton, Loading, Row, Screen, Section, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

/**
 * Painel do app (de Configurações, só para quem está em app_admins): quantas contas e casas, quantas pessoas
 * usaram o app, o Nuke e a IA, as funções que as casas usam, a entrada e os aparelhos. Só totais, nenhuma pessoa
 * ou casa (data/appDashboard). A tela só desenha: os números, as frases e as barras vêm prontos de
 * dashboardView (domain/appDashboard). Fora da guarda da casa: abre também para quem ainda não está em nenhuma.
 */
export default function AppDashboardScreen() {
  const dashboard = useAppDashboard();
  const refresh = () => {
    void dashboard.refetch();
  };
  const screen = (children: ReactNode) => (
    <Screen edges={[]} refreshing={dashboard.isRefetching} onRefresh={refresh}>
      {children}
    </Screen>
  );

  // A recusa vale também com números na tela: a pessoa deixou de estar em app_admins.
  if (dashboard.error instanceof AppDashboardForbidden) {
    return screen(
      <EmptyState
        icon="lock-outline"
        tint="purple"
        title={APP_DASHBOARD_FORBIDDEN}
        // Aberta pelo endereço, no navegador, não há para onde voltar: o começo do app abre a tela certa.
        action={<Button title="Voltar" variant="secondary" onPress={() => goBackOr('/')} />}
      />,
    );
  }
  if (dashboard.data === undefined) {
    // Sem internet e nada na memória, a busca fica parada (não vira erro) e volta sozinha com a conexão.
    if (dashboard.fetchStatus === 'paused') {
      return screen(
        <Card style={styles.notice}>
          <Icon name="wifi-off" color="warning" />
          <Text variant="muted" style={styles.flex}>
            Sem internet. Os números aparecem quando a conexão voltar.
          </Text>
        </Card>,
      );
    }
    if (dashboard.isError) {
      return screen(<ErrorNotice error={new Error(errorMessage(dashboard.error))} onRetry={refresh} />);
    }
    return screen(<Loading />);
  }
  if (dashboard.data === null) {
    return screen(<EmptyState icon="database-clock-outline" title="Ainda não disponível" message={APP_DASHBOARD_NOT_READY} />);
  }
  return screen(
    // A nova busca falhou e os números de antes continuam na tela.
    <Dashboard data={dashboard.data} stale={dashboard.isError} onRetry={refresh} />,
  );
}

function Dashboard({ data, stale, onRetry }: { data: AppDashboard; stale: boolean; onRetry: () => void }) {
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
        <StatGrid items={view.stats.items} />
      </Section>

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
});

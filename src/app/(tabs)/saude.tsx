import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useMedications } from '@/data/home';
import { todayISO } from '@/domain/dates';
import { CarePanel } from '@/features/health/CarePanel';
import { HealthTodaySections } from '@/features/health/HealthTodaySections';
import { MedicationsToday } from '@/features/health/MedicationSections';
import { PlansPanel } from '@/features/health/PlansPanel';
import { useHealthOverview } from '@/features/health/useHealthOverview';
import { Card, EmptyState, Screen, Segmented, Text, Tile } from '@/ui/primitives';
import { space } from '@/ui/theme';

type Tab = 'resumo' | 'cuidados' | 'treino' | 'dieta';
const TABS: Tab[] = ['resumo', 'cuidados', 'treino', 'dieta'];

export default function HealthScreen() {
  // Aba e pessoa vivem na URL: atalhos de outras telas abrem direto nelas.
  const { aba, pessoa } = useLocalSearchParams<{ aba?: string; pessoa?: string }>();
  const tab: Tab = aba && (TABS as string[]).includes(aba) ? (aba as Tab) : 'resumo';
  const personId = pessoa || null;
  const today = todayISO();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  async function refresh() {
    setRefreshing(true);
    await queryClient.refetchQueries({ type: 'active' }).catch(() => undefined);
    setRefreshing(false);
  }

  const setPerson = (id: string | null) => router.setParams({ pessoa: id ?? '' });

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Text variant="title">Saúde</Text>
      <Segmented
        value={tab}
        onChange={(value) => router.setParams({ aba: value })}
        options={[
          { value: 'resumo', label: 'Resumo' },
          { value: 'cuidados', label: 'Cuidados' },
          { value: 'treino', label: 'Treino' },
          { value: 'dieta', label: 'Dieta' },
        ]}
      />
      {tab === 'resumo' ? <SummaryPanel today={today} /> : null}
      {tab === 'cuidados' ? <CarePanel personId={personId} onPersonChange={setPerson} /> : null}
      {tab === 'treino' ? <PlansPanel kind="workout" personId={personId} onPersonChange={setPerson} /> : null}
      {tab === 'dieta' ? <PlansPanel kind="diet" personId={personId} onPersonChange={setPerson} /> : null}
    </Screen>
  );
}

function SummaryPanel({ today }: { today: string }) {
  const overview = useHealthOverview(today);
  const medications = useMedications();
  const newItem = (pathname: '/consulta/[id]' | '/vacina/[id]' | '/exame/[id]') =>
    router.push({ pathname, params: { id: 'nova' } });
  const empty =
    overview.loaded &&
    medications.isSuccess &&
    !medications.data.length &&
    !overview.workoutsToday.length &&
    !overview.upcoming.length &&
    !overview.toConfirm.length &&
    !overview.vaccinesDue.length &&
    !overview.drafts.length;

  return (
    <View style={styles.gap}>
      <View style={styles.tiles}>
        <Tile icon="stethoscope" label="Consulta" onPress={() => newItem('/consulta/[id]')} />
        <Tile icon="needle" label="Vacina" onPress={() => newItem('/vacina/[id]')} />
        <Tile icon="test-tube" label="Exame" onPress={() => newItem('/exame/[id]')} />
      </View>
      <MedicationsToday today={today} />
      <HealthTodaySections overview={overview} today={today} />
      {empty ? (
        <Card>
          <EmptyState
            icon="heart-pulse"
            title="Nada pendente"
            message="Consultas, vacinas, remédios e o treino do dia aparecem aqui. Cadastre a família e as fichas na aba Cuidados."
          />
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: space.xl },
  tiles: { flexDirection: 'row', gap: space.md },
});

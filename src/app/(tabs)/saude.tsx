import { useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useMedications } from '@/data/home';
import { todayISO } from '@/domain/dates';
import { healthParts, PLANOS, SAUDE_TABS, type Plano, type SaudeTab } from '@/domain/tabs';
import { CarePanel } from '@/features/health/CarePanel';
import { HealthAddButton } from '@/features/health/HealthAddButton';
import { HealthTodaySections } from '@/features/health/HealthTodaySections';
import { MedicationRefills, MedicationsToday, useRefills } from '@/features/health/MedicationSections';
import { MedicationsPanel } from '@/features/health/MedicationsPanel';
import { PlansPanel } from '@/features/health/PlansPanel';
import type { PlanKind } from '@/features/health/usePlanImport';
import { useHealthOverview } from '@/features/health/useHealthOverview';
import { Card, EmptyState, Screen, Segmented } from '@/ui/primitives';
import { space } from '@/ui/theme';

const PLAN_KIND: Record<Plano, PlanKind> = { treino: 'workout', dieta: 'diet' };

/**
 * Saúde: Resumo (o que pede atenção, e o "Adicionar" de remédio, consulta, vacina e exame), Remédios (o item de uso diário, numa parte própria),
 * Cuidados (consultas, vacinas, exames e a ficha de cada pessoa) e Planos (treino e dieta, com um seletor). A parte,
 * o plano e a pessoa vivem na URL (?aba=, ?plano=, ?pessoa=): atalhos de outras telas abrem direto neles, e a pessoa
 * escolhida numa parte continua escolhida nas outras que filtram por ela. Os endereços antigos do treino e da dieta
 * (?aba=treino e ?aba=dieta) abrem Planos com aquele plano (domain/tabs).
 */
export default function HealthScreen() {
  const { aba, plano, pessoa } = useLocalSearchParams<{ aba?: string; plano?: string; pessoa?: string }>();
  const { tab, plan, moved } = healthParts(aba, plano);
  const personId = pessoa || null;
  const today = todayISO();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  async function refresh() {
    setRefreshing(true);
    await queryClient.refetchQueries({ type: 'active' }).catch(() => undefined);
    setRefreshing(false);
  }

  // O endereço antigo vira o de agora (sem passar pelo histórico: setParams troca os parâmetros da própria aba).
  // A tela já mostra Planos com o plano certo antes disso; a troca é para o endereço, e o que ler o ?aba= depois,
  // dizerem a mesma coisa que a tela.
  useFocusEffect(
    useCallback(() => {
      if (moved) router.setParams({ aba: 'planos', plano: plan });
    }, [moved, plan]),
  );

  // Ir para Planos leva o plano que está valendo: sem ele, um ?aba=dieta antigo voltaria ao treino no toque em
  // "Planos". As outras partes deixam o ?plano= como está (setParams junta), e voltar a Planos reabre o mesmo plano.
  const setTab = (value: SaudeTab) => router.setParams(value === 'planos' ? { aba: value, plano: plan } : { aba: value });
  const setPlan = (value: Plano) => router.setParams({ aba: 'planos', plano: value });
  const setPerson = (id: string | null) => router.setParams({ pessoa: id ?? '' });

  return (
    <Screen fab heading="Saúde" refreshing={refreshing} onRefresh={refresh}>
      <Segmented value={tab} onChange={setTab} options={SAUDE_TABS} />
      {tab === 'resumo' ? <SummaryPanel today={today} /> : null}
      {tab === 'remedios' ? <MedicationsPanel personId={personId} onPersonChange={setPerson} /> : null}
      {tab === 'cuidados' ? <CarePanel personId={personId} onPersonChange={setPerson} /> : null}
      {tab === 'planos' ? (
        <View style={styles.plans}>
          {/* Fora do painel: o seletor fica na tela também enquanto o plano carrega, ou quando a busca falha. */}
          <Segmented value={plan} onChange={setPlan} options={PLANOS} />
          <PlansPanel kind={PLAN_KIND[plan]} personId={personId} onPersonChange={setPerson} />
        </View>
      ) : null}
    </Screen>
  );
}

function SummaryPanel({ today }: { today: string }) {
  const overview = useHealthOverview(today);
  const medications = useMedications();
  const refills = useRefills(today);
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
      {/* Quatro coisas de mesmo peso para criar: um botão primário no alto, "Adicionar", que pergunta qual (o
          padrão de criar de todas as partes; azulejos só na tela Hoje). O remédio vem primeiro, como a parte dele
          vem antes dos Cuidados. Sem remédio cadastrado, é por aqui que se chega ao primeiro. */}
      <HealthAddButton kinds={['remedio', 'consulta', 'vacina', 'exame']} />
      <MedicationsToday today={today} />
      {/* Aqui entram também os parados há mais de duas semanas (selo neutro), que a tela Hoje não lista: é o caminho até "Atualizar estoque". */}
      <MedicationRefills rows={refills.rows} />
      <HealthTodaySections overview={overview} today={today} />
      {empty ? (
        <Card>
          <EmptyState
            icon="heart-pulse"
            title="Nada pendente"
            message="Consultas, vacinas, remédios e o treino do dia aparecem aqui. As pessoas e os pets da casa se cadastram em Configurações."
          />
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: space.xl },
  // O mesmo espaço que o painel dos planos põe entre as partes dele.
  plans: { gap: space.lg },
});

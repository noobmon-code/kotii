import { router } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { toSchedule, useDoses, useMedications, useToggleDose } from '@/data/home';
import { formatShortDate, todayISO } from '@/domain/dates';
import { currentTimeHHMM, doseKey, dosesForDay } from '@/domain/medications';
import { errorMessage } from '@/lib/supabase';
import { syncReminders } from '@/lib/reminders';
import { notify } from '@/ui/dialogs';
import {
  Button,
  CheckCircle,
  EmptyState,
  ErrorNotice,
  IconBadge,
  ListCard,
  ListRow,
  Loading,
  Screen,
  Section,
  Text,
} from '@/ui/primitives';
import { space } from '@/ui/theme';

export default function HealthScreen() {
  const today = todayISO();
  const medications = useMedications();
  const doses = useDoses(today);
  const toggle = useToggleDose(today);

  useEffect(() => {
    if (medications.data) syncReminders(medications.data, today).catch(() => undefined);
  }, [medications.data, today]);

  const slots = dosesForDay((medications.data ?? []).map(toSchedule), today);
  const taken = new Set((doses.data ?? []).map((d) => doseKey(d.medication_id, d.scheduled_on, d.scheduled_time)));
  const nowTime = currentTimeHHMM();

  return (
    <Screen
      refreshing={medications.isRefetching || doses.isRefetching}
      onRefresh={() => {
        medications.refetch();
        doses.refetch();
      }}>
      <Text variant="title">Saúde</Text>

      {medications.isPending ? <Loading /> : null}
      {medications.isError ? <ErrorNotice error={medications.error} onRetry={() => medications.refetch()} /> : null}

      {medications.data ? (
        <>
          <Section title="Remédios de hoje">
            {slots.length === 0 ? (
              <Text variant="muted">Nenhuma dose prevista para hoje.</Text>
            ) : (
              <ListCard>
                {slots.map((slot) => {
                  const key = doseKey(slot.medicationId, slot.date, slot.time);
                  const isTaken = taken.has(key);
                  const late = !isTaken && slot.time < nowTime;
                  return (
                    <ListRow
                      key={key}
                      left={<IconBadge icon="pill" tone={isTaken ? 'primary' : late ? 'warning' : 'info'} />}
                      title={`${slot.time} · ${slot.name}`}
                      subtitle={[slot.personName, slot.dosage, late ? 'atrasada' : null].filter(Boolean).join(' · ')}
                      dimmed={isTaken}
                      right={
                        <CheckCircle
                          checked={isTaken}
                          label={`${slot.name} das ${slot.time}`}
                          onPress={() =>
                            toggle.mutate(
                              { medicationId: slot.medicationId, time: slot.time, taken: !isTaken },
                              { onError: (err) => notify('Erro', errorMessage(err)) },
                            )
                          }
                        />
                      }
                    />
                  );
                })}
              </ListCard>
            )}
          </Section>

          <Section
            title="Tratamentos"
            action={
              <Button
                title="Remédio"
                icon="plus"
                variant="ghost"
                compact
                onPress={() => router.push({ pathname: '/remedio/[id]', params: { id: 'novo' } })}
              />
            }>
            {medications.data.length === 0 ? (
              <EmptyState
                icon="pill"
                title="Nenhum remédio cadastrado"
                message="Cadastre os remédios de cada pessoa da casa com horários. Cada celular escolhe se quer receber o lembrete."
              />
            ) : (
              <ListCard>
                {medications.data.map((m) => (
                  <ListRow
                    key={m.id}
                    left={<IconBadge icon="pill" />}
                    title={m.name}
                    subtitle={[m.person_name, m.times.join(', '), m.end_on ? `até ${formatShortDate(m.end_on)}` : 'uso contínuo']
                      .filter(Boolean)
                      .join(' · ')}
                    onPress={() => router.push({ pathname: '/remedio/[id]', params: { id: m.id } })}
                  />
                ))}
              </ListCard>
            )}
          </Section>

          <View style={styles.soon}>
            <Text variant="small" style={styles.center}>
              Em breve aqui: treinos e dietas digitalizados por foto, exames e vacinas.
            </Text>
          </View>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  soon: { paddingVertical: space.lg },
});

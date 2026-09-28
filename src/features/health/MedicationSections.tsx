import { router } from 'expo-router';

import { toSchedule, useDoses, useMedications, useToggleDose } from '@/data/home';
import { currentTimeHHMM, describeCourse, describeFrequency, doseKey, dosesForDay } from '@/domain/medications';
import { errorMessage } from '@/lib/supabase';
import type { Medication } from '@/lib/types';
import { notify } from '@/ui/dialogs';
import { Button, CheckCircle, EmptyState, IconBadge, ListCard, ListRow, Section, Text } from '@/ui/primitives';

export function MedicationsToday({ today }: { today: string }) {
  const medications = useMedications();
  const doses = useDoses(today);
  const toggle = useToggleDose(today);

  if (!medications.data) return null;
  const taken = new Set((doses.data ?? []).map((d) => doseKey(d.medication_id, d.scheduled_on, d.scheduled_time)));
  const slots = dosesForDay(medications.data.map(toSchedule), today, taken);
  if (!slots.length) return null;
  const nowTime = currentTimeHHMM();

  return (
    <Section title="Remédios de hoje">
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
    </Section>
  );
}

/** Tratamentos em andamento (de uma pessoa, ou de todos). */
export function MedicationList({ medications, personId }: { medications: Medication[]; personId: string | null }) {
  return (
    <Section
      title="Remédios"
      action={
        <Button
          title="Remédio"
          icon="plus"
          variant="ghost"
          compact
          onPress={() => router.push({ pathname: '/remedio/[id]', params: { id: 'novo', pessoa: personId ?? '' } })}
        />
      }>
      {medications.length === 0 ? (
        personId ? (
          <Text variant="muted">Nenhum remédio em uso.</Text>
        ) : (
          <EmptyState
            icon="pill"
            title="Nenhum remédio cadastrado"
            message="Cadastre os remédios de cada pessoa com horários. Cada celular escolhe se quer receber o lembrete."
          />
        )
      ) : (
        <ListCard>
          {medications.map((m) => (
            <ListRow
              key={m.id}
              left={<IconBadge icon="pill" />}
              title={m.name}
              subtitle={[
                personId ? null : m.person_name,
                `${describeFrequency(toSchedule(m))}, ${m.times.join(', ')}`,
                describeCourse(toSchedule(m)),
              ]
                .filter(Boolean)
                .join(' · ')}
              onPress={() => router.push({ pathname: '/remedio/[id]', params: { id: m.id } })}
            />
          ))}
        </ListCard>
      )}
    </Section>
  );
}

import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useMedications } from '@/data/home';
import { useAppointments, useExams, usePeople, useVaccines } from '@/data/health';
import { formatBRDate, formatShortDate, todayISO } from '@/domain/dates';
import { ageLabel, describeWhen, EXAM_STATUS, isOverdueAppointment, upcomingAppointments } from '@/domain/health';
import type { Person } from '@/lib/types';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  IconBadge,
  ListCard,
  ListRow,
  Loading,
  Row,
  Section,
  Text,
} from '@/ui/primitives';
import { space } from '@/ui/theme';
import { MedicationList } from './MedicationSections';
import { openNewPerson, PersonChips } from './PersonChips';

const PAST_LIMIT = 5;

/** Consultas, vacinas, exames, remédios e ficha de cada pessoa da casa. */
export function CarePanel({ personId, onPersonChange }: { personId: string | null; onPersonChange: (id: string | null) => void }) {
  const today = todayISO();
  const people = usePeople();
  const appointments = useAppointments();
  const vaccines = useVaccines();
  const exams = useExams();
  const medications = useMedications();
  const [showAllPast, setShowAllPast] = useState(false);

  const queries = [people, appointments, vaccines, exams, medications];
  const failed = queries.find((q) => q.isError);
  if (failed) return <ErrorNotice error={failed.error} onRetry={() => queries.forEach((q) => q.refetch())} />;
  if (!people.data || !appointments.data || !vaccines.data || !exams.data || !medications.data) return <Loading />;

  const person = people.data.find((p) => p.id === personId) ?? null;
  const mine = <T extends { person_id: string | null }>(rows: T[]) => (person ? rows.filter((r) => r.person_id === person.id) : rows);
  const nameOf = (id: string) => (person ? null : people.data.find((p) => p.id === id)?.name ?? null);
  const add = (pathname: '/consulta/[id]' | '/vacina/[id]' | '/exame/[id]') =>
    router.push({ pathname, params: { id: 'nova', pessoa: person?.id ?? '' } });

  const personAppointments = mine(appointments.data);
  const upcoming = upcomingAppointments(personAppointments, today);
  const past = personAppointments.filter((a) => !upcoming.includes(a));
  const visiblePast = showAllPast ? past : past.slice(0, PAST_LIMIT);
  const personVaccines = mine(vaccines.data);
  const personExams = mine(exams.data);
  const personMedications = person
    ? medications.data.filter((m) => m.person_id === person.id)
    : medications.data;

  if (!people.data.length) {
    return (
      <EmptyState
        icon="account-heart-outline"
        title="Cadastre a família"
        message="Pessoas e pets da casa, cada um com sua ficha: tipo sanguíneo, alergias, plano de saúde."
        action={<Button title="Adicionar pessoa ou pet" icon="plus" onPress={openNewPerson} />}
      />
    );
  }

  return (
    <View style={styles.gap}>
      <PersonChips people={people.data} value={person?.id ?? null} onChange={onPersonChange} allLabel="Todos" onAdd={openNewPerson} />

      {person ? <PersonCard person={person} today={today} /> : null}

      <Section title="Consultas" action={<Button title="Consulta" icon="plus" variant="ghost" compact onPress={() => add('/consulta/[id]')} />}>
        {personAppointments.length === 0 ? (
          <Text variant="muted">Nenhuma consulta registrada.</Text>
        ) : (
          <ListCard>
            {[...upcoming, ...visiblePast].map((a) => {
              const overdue = isOverdueAppointment(a, today);
              return (
                <ListRow
                  key={a.id}
                  left={<IconBadge icon="stethoscope" tone={upcoming.includes(a) ? 'info' : overdue ? 'warning' : 'neutral'} />}
                  title={a.title}
                  subtitle={[describeWhen(a.starts_at, today), nameOf(a.person_id), a.professional].filter(Boolean).join(' · ')}
                  dimmed={a.status === 'cancelada'}
                  right={
                    overdue ? (
                      <Badge label="Foi realizada?" tone="warning" />
                    ) : a.status === 'cancelada' ? (
                      <Badge label="Cancelada" />
                    ) : null
                  }
                  onPress={() => router.push({ pathname: '/consulta/[id]', params: { id: a.id } })}
                />
              );
            })}
            {past.length > PAST_LIMIT && !showAllPast ? (
              <Button title={`Ver anteriores (${past.length - PAST_LIMIT})`} variant="ghost" onPress={() => setShowAllPast(true)} />
            ) : null}
          </ListCard>
        )}
      </Section>

      <Section title="Vacinas" action={<Button title="Vacina" icon="plus" variant="ghost" compact onPress={() => add('/vacina/[id]')} />}>
        {personVaccines.length === 0 ? (
          <Text variant="muted">Nenhuma vacina registrada.</Text>
        ) : (
          <ListCard>
            {personVaccines.map((v) => (
              <ListRow
                key={v.id}
                left={<IconBadge icon="needle" tone={v.applied_on ? 'primary' : 'info'} />}
                title={[v.name, v.dose].filter(Boolean).join(' · ')}
                subtitle={[
                  nameOf(v.person_id),
                  v.applied_on ? `aplicada ${formatBRDate(v.applied_on)}` : 'não aplicada',
                  v.next_dose_on ? `próxima ${formatShortDate(v.next_dose_on)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                onPress={() => router.push({ pathname: '/vacina/[id]', params: { id: v.id } })}
              />
            ))}
          </ListCard>
        )}
      </Section>

      <Section title="Exames" action={<Button title="Exame" icon="plus" variant="ghost" compact onPress={() => add('/exame/[id]')} />}>
        {personExams.length === 0 ? (
          <Text variant="muted">Nenhum exame. Fotografe o pedido ou o laudo e a IA transcreve os resultados.</Text>
        ) : (
          <ListCard>
            {personExams.map((e) => (
              <ListRow
                key={e.id}
                left={<IconBadge icon="test-tube" tone={e.status === 'realizado' ? 'primary' : 'info'} />}
                title={e.title}
                subtitle={[
                  nameOf(e.person_id),
                  e.exam_date ? formatBRDate(e.exam_date) : null,
                  e.results.length ? `${e.results.length} resultados` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={e.status !== 'realizado' ? <Badge label={EXAM_STATUS.find((s) => s.value === e.status)!.label} tone="info" /> : null}
                onPress={() => router.push({ pathname: '/exame/[id]', params: { id: e.id } })}
              />
            ))}
          </ListCard>
        )}
      </Section>

      <MedicationList medications={personMedications} personId={person?.id ?? null} />

      {!person ? (
        <Section title="Pessoas da casa" action={<Button title="Adicionar" icon="plus" variant="ghost" compact onPress={openNewPerson} />}>
          <ListCard>
            {people.data.map((p) => (
              <ListRow
                key={p.id}
                left={<IconBadge icon={p.kind === 'pet' ? 'paw' : 'account-outline'} tone="primary" />}
                title={p.name}
                subtitle={personSummary(p, today)}
                onPress={() => onPersonChange(p.id)}
              />
            ))}
          </ListCard>
        </Section>
      ) : null}
    </View>
  );
}

function personSummary(person: Person, today: string): string {
  return [
    person.kind === 'pet' ? person.species || 'Pet' : null,
    person.birth_date ? ageLabel(person.birth_date, today) : null,
    person.blood_type,
    person.member_user_id ? 'usa o app' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function PersonCard({ person, today }: { person: Person; today: string }) {
  const facts: [string, string | null][] = [
    ['Idade', person.birth_date ? ageLabel(person.birth_date, today) : null],
    [person.kind === 'pet' ? 'Espécie' : 'Tipo sanguíneo', person.kind === 'pet' ? person.species : person.blood_type],
    ['Alergias', person.allergies],
    ['Condições', person.conditions],
    [
      person.kind === 'pet' ? 'Plano/clínica' : 'Plano de saúde',
      [person.health_plan, person.health_plan_number].filter(Boolean).join(' · ') || null,
    ],
  ];
  const filled = facts.filter(([, value]) => value);
  return (
    <Card style={styles.gapSm}>
      <Row>
        <IconBadge icon={person.kind === 'pet' ? 'paw' : 'card-account-details-outline'} tone="primary" />
        <Text variant="heading" style={styles.flex}>
          {person.name}
        </Text>
        <Button
          title="Editar ficha"
          variant="ghost"
          compact
          onPress={() => router.push({ pathname: '/pessoa/[id]', params: { id: person.id } })}
        />
      </Row>
      {filled.length ? (
        filled.map(([label, value]) => (
          <Row key={label} style={styles.fact}>
            <Text variant="muted" style={styles.factLabel}>
              {label}
            </Text>
            <Text variant="body" style={styles.flex}>
              {value}
            </Text>
          </Row>
        ))
      ) : (
        <Text variant="muted">Ficha vazia. Toque em “Editar ficha” para anotar alergias, tipo sanguíneo e plano.</Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: space.xl },
  gapSm: { gap: space.sm },
  fact: { alignItems: 'flex-start' },
  factLabel: { width: 120 },
});

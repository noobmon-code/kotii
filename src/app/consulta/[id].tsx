import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppointments, useDeleteAppointment, usePeople, useSaveAppointment } from '@/data/health';
import { formatBRDate, parseBRDate, todayISO } from '@/domain/dates';
import { splitTimestamp, toTimestamp } from '@/domain/health';
import { parseTimes } from '@/domain/medications';
import { openNewPerson, PersonChips } from '@/features/health/PersonChips';
import { errorMessage } from '@/lib/supabase';
import type { Appointment, Person } from '@/lib/types';
import { confirmAction, notify } from '@/ui/dialogs';
import { Button, ErrorNotice, Loading, Row, Screen, Segmented, Text, TextField } from '@/ui/primitives';
import { space } from '@/ui/theme';

export default function AppointmentScreen() {
  const { id, pessoa } = useLocalSearchParams<{ id: string; pessoa?: string }>();
  const people = usePeople();
  const appointments = useAppointments();
  const failed = people.isError ? people : appointments.isError ? appointments : null;
  if (failed) return <ErrorNotice error={failed.error} onRetry={() => failed.refetch()} />;
  if (!people.data || !appointments.data) return <Loading />;
  const appointment = id === 'nova' ? undefined : appointments.data.find((a) => a.id === id);
  if (id !== 'nova' && !appointment) return <ErrorNotice error={new Error('Consulta não encontrada.')} />;
  return <AppointmentForm appointment={appointment} people={people.data} initialPersonId={pessoa || null} />;
}

function AppointmentForm({
  appointment,
  people,
  initialPersonId,
}: {
  appointment?: Appointment;
  people: Person[];
  initialPersonId: string | null;
}) {
  const save = useSaveAppointment();
  const remove = useDeleteAppointment();
  const when = appointment ? splitTimestamp(appointment.starts_at) : null;
  const [personId, setPersonId] = useState(appointment?.person_id ?? initialPersonId ?? (people.length === 1 ? people[0].id : null));
  const [title, setTitle] = useState(appointment?.title ?? '');
  const [professional, setProfessional] = useState(appointment?.professional ?? '');
  const [location, setLocation] = useState(appointment?.location ?? '');
  const [date, setDate] = useState(formatBRDate(when?.date ?? todayISO()));
  const [time, setTime] = useState(when?.time ?? '');
  const [notes, setNotes] = useState(appointment?.notes ?? '');
  const [status, setStatus] = useState<Appointment['status']>(appointment?.status ?? 'agendada');
  const onError = (err: unknown) => notify('Erro', errorMessage(err));

  function submit() {
    const dateISO = parseBRDate(date);
    const parsedTime = parseTimes(time)?.[0];
    if (!personId || !title.trim()) {
      notify('Confira os dados', 'Escolha para quem é e informe a especialidade ou motivo.');
      return;
    }
    if (!dateISO || !parsedTime || parseTimes(time)!.length > 1) {
      notify('Data ou hora inválida', 'Use dd/mm/aaaa e um horário como 14:30.');
      return;
    }
    save.mutate(
      {
        id: appointment?.id,
        values: {
          person_id: personId,
          title: title.trim(),
          professional: professional.trim() || null,
          location: location.trim() || null,
          starts_at: toTimestamp(dateISO, parsedTime),
          notes: notes.trim() || null,
          status,
        },
      },
      { onSuccess: () => router.back(), onError },
    );
  }

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: appointment ? 'Consulta' : 'Nova consulta' }} />
      <View style={styles.group}>
        <Text variant="label">Para quem</Text>
        <PersonChips people={people} value={personId} onChange={setPersonId} onAdd={openNewPerson} />
      </View>
      <TextField
        label="Especialidade ou motivo"
        value={title}
        onChangeText={setTitle}
        placeholder="Ex.: Pediatra, Dentista, Vacina do Rex"
        autoFocus={!appointment}
      />
      <Row gap={space.md}>
        <View style={styles.flex}>
          <TextField label="Data" value={date} onChangeText={setDate} placeholder="dd/mm/aaaa" keyboardType="numbers-and-punctuation" />
        </View>
        <View style={styles.flex}>
          <TextField label="Hora" value={time} onChangeText={setTime} placeholder="14:30" keyboardType="numbers-and-punctuation" />
        </View>
      </Row>
      <TextField label="Profissional" value={professional} onChangeText={setProfessional} placeholder="Ex.: Dra. Lia Souza" />
      <TextField label="Local" value={location} onChangeText={setLocation} placeholder="Clínica, endereço ou teleconsulta" />
      <TextField
        label="Observações"
        value={notes}
        onChangeText={setNotes}
        multiline
        placeholder="O que perguntar, o que levar, orientações recebidas"
      />
      {appointment ? (
        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            { value: 'agendada', label: 'Agendada' },
            { value: 'realizada', label: 'Realizada' },
            { value: 'cancelada', label: 'Cancelada' },
          ]}
        />
      ) : null}
      <Button title="Salvar" onPress={submit} loading={save.isPending} />
      {appointment ? (
        <Button
          title="Apagar consulta"
          variant="danger"
          icon="trash-can-outline"
          onPress={() =>
            confirmAction('Apagar consulta', `Apagar ${appointment.title}?`, 'Apagar', () =>
              remove.mutate(appointment.id, { onSuccess: () => router.back(), onError }),
            )
          }
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  group: { gap: space.sm },
});

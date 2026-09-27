import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Switch, View } from 'react-native';

import { usePeople } from '@/data/health';
import { useArchiveMedication, useMedication, useSaveMedication } from '@/data/home';
import { formatBRDate, parseBRDate, todayISO } from '@/domain/dates';
import { parseTimes } from '@/domain/medications';
import { disableReminders, enableReminders, hasReminders, remindersSupported } from '@/lib/reminders';
import { errorMessage } from '@/lib/supabase';
import { openNewPerson, PersonChips } from '@/features/health/PersonChips';
import type { Medication, Person } from '@/lib/types';
import { confirmAction, notify } from '@/ui/dialogs';
import { Button, Card, DateField, ErrorNotice, Loading, Row, Screen, Text, TextField } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

export default function MedicationScreen() {
  const { id, pessoa } = useLocalSearchParams<{ id: string; pessoa?: string }>();
  const isNew = id === 'novo';
  const medication = useMedication(isNew ? undefined : id);
  const people = usePeople();

  if ((!isNew && medication.isPending) || people.isPending) return <Loading />;
  if (!isNew && medication.isError) return <ErrorNotice error={medication.error} />;
  if (people.isError) return <ErrorNotice error={people.error} onRetry={() => people.refetch()} />;
  return <MedicationForm medication={isNew ? undefined : medication.data} people={people.data} initialPersonId={pessoa || null} />;
}

function MedicationForm({
  medication,
  people,
  initialPersonId,
}: {
  medication?: Medication;
  people: Person[];
  initialPersonId: string | null;
}) {
  const c = useColors();
  const save = useSaveMedication();
  const archive = useArchiveMedication();
  // Remédios antigos só tinham o nome: acha a pessoa pelo nome.
  const [personId, setPersonId] = useState<string | null>(
    medication
      ? (medication.person_id ??
          people.find((p) => p.name.toLowerCase() === medication.person_name.trim().toLowerCase())?.id ??
          null)
      : (initialPersonId ?? (people.length === 1 ? people[0].id : null)),
  );
  const [name, setName] = useState(medication?.name ?? '');
  const [dosage, setDosage] = useState(medication?.dosage ?? '');
  const [times, setTimes] = useState(medication?.times.join(', ') ?? '08:00');
  const [start, setStart] = useState(formatBRDate(medication?.start_on ?? todayISO()));
  const [end, setEnd] = useState(medication?.end_on ? formatBRDate(medication.end_on) : '');
  const [notes, setNotes] = useState(medication?.notes ?? '');
  const [remind, setRemind] = useState(!medication && remindersSupported);

  useEffect(() => {
    if (medication) hasReminders(medication.id).then(setRemind).catch(() => undefined);
  }, [medication]);

  const onError = (err: unknown) => notify('Erro', errorMessage(err));

  function submit() {
    const parsedTimes = parseTimes(times);
    const startISO = parseBRDate(start);
    const endISO = end.trim() ? parseBRDate(end) : null;
    const person = people.find((p) => p.id === personId);
    if (!person || !name.trim()) {
      notify('Confira os dados', 'Escolha para quem é e informe o nome do remédio.');
      return;
    }
    if (!parsedTimes) {
      notify('Horários inválidos', 'Use horários como 08:00, 20:00.');
      return;
    }
    if (!startISO || (end.trim() && !endISO) || (endISO && endISO < startISO)) {
      notify('Datas inválidas', 'Use dd/mm/aaaa; o fim não pode ser antes do início.');
      return;
    }
    save.mutate(
      {
        id: medication?.id,
        values: {
          person_id: person.id,
          person_name: person.name,
          name: name.trim(),
          dosage: dosage.trim() || null,
          times: parsedTimes,
          start_on: startISO,
          end_on: endISO,
          notes: notes.trim() || null,
        },
      },
      {
        onSuccess: async (saved) => {
          try {
            if (remind) {
              const ok = await enableReminders(saved);
              if (!ok) notify('Lembretes desativados', 'Permita notificações nas configurações do aparelho.');
            } else {
              await disableReminders(saved.id);
            }
          } catch (err) {
            onError(err);
          }
          router.back();
        },
        onError,
      },
    );
  }

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: medication ? 'Editar remédio' : 'Novo remédio' }} />
      <View style={styles.group}>
        <Text variant="label">Para quem</Text>
        <PersonChips people={people} value={personId} onChange={setPersonId} onAdd={openNewPerson} />
      </View>
      <TextField label="Remédio" value={name} onChangeText={setName} placeholder="Ex.: Amoxicilina 500mg" />
      <TextField label="Dose" value={dosage} onChangeText={setDosage} placeholder="Ex.: 1 comprimido" />
      <TextField
        label="Horários"
        value={times}
        onChangeText={setTimes}
        placeholder="08:00, 20:00"
        keyboardType="numbers-and-punctuation"
        hint="Separe por vírgula."
      />
      <Row gap={space.md}>
        <View style={styles.flex}>
          <DateField label="Início" value={start} onChangeText={setStart} />
        </View>
        <View style={styles.flex}>
          <DateField label="Fim" value={end} onChangeText={setEnd} placeholder="Uso contínuo" />
        </View>
      </Row>
      <TextField label="Observações" value={notes} onChangeText={setNotes} multiline placeholder="Ex.: tomar após as refeições" />

      {remindersSupported ? (
        <Card>
          <Row>
            <View style={styles.flex}>
              <Text variant="label">Lembrar neste celular</Text>
              <Text variant="small">Cada pessoa da casa escolhe no próprio aparelho.</Text>
            </View>
            <Switch value={remind} onValueChange={setRemind} trackColor={{ true: c.primary }} />
          </Row>
        </Card>
      ) : Platform.OS === 'android' ? (
        <Text variant="small">
          Lembretes por notificação funcionam no app instalado; no Expo Go do Android eles ficam desligados.
        </Text>
      ) : null}

      <Button title="Salvar" onPress={submit} loading={save.isPending} />
      {medication ? (
        <Button
          title="Encerrar tratamento"
          variant="danger"
          icon="archive-outline"
          onPress={() =>
            confirmAction('Encerrar tratamento', `Parar de acompanhar ${medication.name}?`, 'Encerrar', () =>
              archive.mutate(medication.id, {
                onSuccess: async () => {
                  await disableReminders(medication.id).catch(() => undefined);
                  router.back();
                },
                onError,
              }),
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

import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { useArchiveMedication, useMedication, useSaveMedication } from '@/data/home';
import { formatBRDate, parseBRDate, todayISO } from '@/domain/dates';
import { parseTimes } from '@/domain/medications';
import { useHousehold } from '@/lib/auth';
import { disableReminders, enableReminders, hasReminders, remindersSupported } from '@/lib/reminders';
import { errorMessage } from '@/lib/supabase';
import type { Medication } from '@/lib/types';
import { confirmAction, notify } from '@/ui/dialogs';
import { Button, Card, Chip, ErrorNotice, Loading, Row, Screen, Text, TextField } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

export default function MedicationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'novo';
  const medication = useMedication(isNew ? undefined : id);

  if (!isNew && medication.isPending) return <Loading />;
  if (!isNew && medication.isError) return <ErrorNotice error={medication.error} />;
  return <MedicationForm medication={isNew ? undefined : medication.data} />;
}

function MedicationForm({ medication }: { medication?: Medication }) {
  const c = useColors();
  const members = useHousehold().data?.members ?? [];
  const save = useSaveMedication();
  const archive = useArchiveMedication();
  const [person, setPerson] = useState(medication?.person_name ?? '');
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
    if (!person.trim() || !name.trim()) {
      notify('Confira os dados', 'Informe para quem é e o nome do remédio.');
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
          person_name: person.trim(),
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
        <TextField label="Para quem" value={person} onChangeText={setPerson} placeholder="Nome" autoCapitalize="words" />
        {members.length ? (
          <Row style={styles.wrap}>
            {members.map((m) => (
              <Chip key={m.user_id} label={m.display_name} selected={person === m.display_name} onPress={() => setPerson(m.display_name)} />
            ))}
          </Row>
        ) : null}
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
          <TextField label="Início" value={start} onChangeText={setStart} keyboardType="numbers-and-punctuation" />
        </View>
        <View style={styles.flex}>
          <TextField label="Fim" value={end} onChangeText={setEnd} placeholder="Uso contínuo" keyboardType="numbers-and-punctuation" />
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
  wrap: { flexWrap: 'wrap' },
});

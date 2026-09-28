import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useDeleteVaccine, usePeople, useSaveVaccine, useVaccines } from '@/data/health';
import { formatBRDate, parseBRDate, todayISO } from '@/domain/dates';
import { openNewPerson, PersonChips } from '@/features/health/PersonChips';
import { errorMessage } from '@/lib/supabase';
import type { Person, Vaccine } from '@/lib/types';
import { confirmAction, notify } from '@/ui/dialogs';
import { Button, DateField, ErrorNotice, Loading, Row, Screen, Text, TextField } from '@/ui/primitives';
import { space } from '@/ui/theme';

export default function VaccineScreen() {
  const { id, pessoa, copiar } = useLocalSearchParams<{ id: string; pessoa?: string; copiar?: string }>();
  const people = usePeople();
  const vaccines = useVaccines();
  const failed = people.isError ? people : vaccines.isError ? vaccines : null;
  if (failed) return <ErrorNotice error={failed.error} onRetry={() => failed.refetch()} />;
  if (!people.data || !vaccines.data) return <Loading />;
  const vaccine = id === 'nova' ? undefined : vaccines.data.find((v) => v.id === id);
  if (id !== 'nova' && !vaccine) return <ErrorNotice error={new Error('Vacina não encontrada.')} />;
  // "Registrar próxima dose": nova aplicação da mesma vacina, para a mesma pessoa.
  const template = copiar ? vaccines.data.find((v) => v.id === copiar) : undefined;
  return (
    <VaccineForm
      key={id + (copiar ?? '')}
      vaccine={vaccine}
      template={template}
      people={people.data}
      initialPersonId={pessoa || null}
    />
  );
}

function VaccineForm({
  vaccine,
  template,
  people,
  initialPersonId,
}: {
  vaccine?: Vaccine;
  template?: Vaccine;
  people: Person[];
  initialPersonId: string | null;
}) {
  const save = useSaveVaccine();
  const remove = useDeleteVaccine();
  const source = vaccine ?? template;
  const [personId, setPersonId] = useState(
    source?.person_id ?? initialPersonId ?? (people.length === 1 ? people[0].id : null),
  );
  const [name, setName] = useState(source?.name ?? '');
  const [dose, setDose] = useState(vaccine?.dose ?? '');
  const [applied, setApplied] = useState(
    vaccine ? (vaccine.applied_on ? formatBRDate(vaccine.applied_on) : '') : formatBRDate(todayISO()),
  );
  const [nextDose, setNextDose] = useState(vaccine?.next_dose_on ? formatBRDate(vaccine.next_dose_on) : '');
  const [location, setLocation] = useState(vaccine?.location ?? template?.location ?? '');
  const [lot, setLot] = useState(vaccine?.lot ?? '');
  const [notes, setNotes] = useState(vaccine?.notes ?? '');
  const onError = (err: unknown) => notify('Erro', errorMessage(err));

  function submit() {
    const appliedISO = applied.trim() ? parseBRDate(applied) : null;
    const nextISO = nextDose.trim() ? parseBRDate(nextDose) : null;
    if (!personId || !name.trim()) {
      notify('Confira os dados', 'Escolha para quem é e informe a vacina.');
      return;
    }
    if ((applied.trim() && !appliedISO) || (nextDose.trim() && !nextISO)) {
      notify('Data inválida', 'Use dd/mm/aaaa.');
      return;
    }
    if (!appliedISO && !nextISO) {
      notify('Informe uma data', 'Preencha quando foi aplicada ou quando é a próxima dose.');
      return;
    }
    save.mutate(
      {
        id: vaccine?.id,
        values: {
          person_id: personId,
          name: name.trim(),
          dose: dose.trim() || null,
          applied_on: appliedISO,
          next_dose_on: nextISO,
          location: location.trim() || null,
          lot: lot.trim() || null,
          notes: notes.trim() || null,
        },
      },
      { onSuccess: () => router.back(), onError },
    );
  }

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: vaccine ? 'Vacina' : 'Nova vacina' }} />
      <View style={styles.group}>
        <Text variant="label">Para quem</Text>
        <PersonChips people={people} value={personId} onChange={setPersonId} onAdd={openNewPerson} />
      </View>
      <TextField label="Vacina" value={name} onChangeText={setName} placeholder="Ex.: Gripe, Hepatite B, V10" autoFocus={!source} />
      <TextField label="Dose" value={dose} onChangeText={setDose} placeholder="Ex.: 1ª dose, reforço, anual" />
      <Row gap={space.md}>
        <View style={styles.flex}>
          <DateField
            label="Aplicada em"
            value={applied}
            onChangeText={setApplied}
            placeholder="Ainda não"
          />
        </View>
        <View style={styles.flex}>
          <DateField
            label="Próxima dose"
            value={nextDose}
            onChangeText={setNextDose}
          />
        </View>
      </Row>
      <Row gap={space.md}>
        <View style={styles.flex}>
          <TextField label="Local" value={location} onChangeText={setLocation} placeholder="Posto, clínica" />
        </View>
        <View style={styles.flex}>
          <TextField label="Lote" value={lot} onChangeText={setLot} />
        </View>
      </Row>
      <TextField label="Observações" value={notes} onChangeText={setNotes} multiline />
      <Button title="Salvar" onPress={submit} loading={save.isPending} />
      {vaccine?.next_dose_on && vaccine.applied_on ? (
        <Button
          title="Registrar próxima dose"
          variant="secondary"
          icon="needle"
          onPress={() => router.replace({ pathname: '/vacina/[id]', params: { id: 'nova', copiar: vaccine.id } })}
        />
      ) : null}
      {vaccine ? (
        <Button
          title="Apagar registro"
          variant="danger"
          icon="trash-can-outline"
          onPress={() =>
            confirmAction('Apagar registro', `Apagar ${vaccine.name}?`, 'Apagar', () =>
              remove.mutate(vaccine.id, { onSuccess: () => router.back(), onError }),
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

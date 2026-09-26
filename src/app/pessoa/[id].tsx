import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useDeletePerson, usePeople, useSavePerson } from '@/data/health';
import { formatBRDate, parseBRDate, todayISO } from '@/domain/dates';
import { BLOOD_TYPES } from '@/domain/health';
import { errorMessage } from '@/lib/supabase';
import type { Person } from '@/lib/types';
import { confirmAction, notify } from '@/ui/dialogs';
import { Button, Chip, ErrorNotice, Loading, Row, Screen, Segmented, Text, TextField } from '@/ui/primitives';
import { space } from '@/ui/theme';

export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const people = usePeople();
  if (people.isPending) return <Loading />;
  if (people.isError) return <ErrorNotice error={people.error} onRetry={() => people.refetch()} />;
  const person = id === 'nova' ? undefined : people.data.find((p) => p.id === id);
  if (id !== 'nova' && !person) return <ErrorNotice error={new Error('Pessoa não encontrada.')} />;
  return <PersonForm person={person} />;
}

function PersonForm({ person }: { person?: Person }) {
  const save = useSavePerson();
  const remove = useDeletePerson();
  const [kind, setKind] = useState<Person['kind']>(person?.kind ?? 'pessoa');
  const [name, setName] = useState(person?.name ?? '');
  const [birth, setBirth] = useState(person?.birth_date ? formatBRDate(person.birth_date) : '');
  const [bloodType, setBloodType] = useState<string | null>(person?.blood_type ?? null);
  const [species, setSpecies] = useState(person?.species ?? '');
  const [allergies, setAllergies] = useState(person?.allergies ?? '');
  const [conditions, setConditions] = useState(person?.conditions ?? '');
  const [plan, setPlan] = useState(person?.health_plan ?? '');
  const [planNumber, setPlanNumber] = useState(person?.health_plan_number ?? '');
  const [notes, setNotes] = useState(person?.notes ?? '');
  const isPet = kind === 'pet';
  const orNull = (value: string) => value.trim() || null;

  function submit() {
    const birthISO = birth.trim() ? parseBRDate(birth) : null;
    if (!name.trim()) {
      notify('Confira os dados', 'Informe o nome.');
      return;
    }
    if (birth.trim() && (!birthISO || birthISO > todayISO())) {
      notify('Data inválida', 'Use dd/mm/aaaa.');
      return;
    }
    save.mutate(
      {
        id: person?.id,
        values: {
          name: name.trim(),
          kind,
          birth_date: birthISO,
          blood_type: isPet ? null : bloodType,
          species: isPet ? orNull(species) : null,
          allergies: orNull(allergies),
          conditions: orNull(conditions),
          health_plan: orNull(plan),
          health_plan_number: orNull(planNumber),
          notes: orNull(notes),
        },
      },
      {
        onSuccess: () => router.back(),
        onError: (err) =>
          notify('Erro', /duplicate|unique/i.test(errorMessage(err)) ? 'Já existe alguém com esse nome na casa.' : errorMessage(err)),
      },
    );
  }

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: person ? person.name : 'Nova pessoa ou pet' }} />
      {person?.member_user_id ? null : (
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'pessoa', label: 'Pessoa' },
            { value: 'pet', label: 'Pet' },
          ]}
        />
      )}
      <TextField
        label="Nome"
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        autoFocus={!person}
        hint={
          person?.member_user_id
            ? 'Usa o app com a própria conta.'
            : isPet
              ? undefined
              : 'Filhos e dependentes sem conta. Se a pessoa entrar na família com este mesmo nome, ela assume esta ficha.'
        }
      />
      <TextField
        label="Nascimento"
        value={birth}
        onChangeText={setBirth}
        placeholder="dd/mm/aaaa"
        keyboardType="numbers-and-punctuation"
      />
      {isPet ? (
        <TextField label="Espécie e raça" value={species} onChangeText={setSpecies} placeholder="Ex.: cachorro, vira-lata" />
      ) : (
        <View style={styles.group}>
          <Text variant="label">Tipo sanguíneo</Text>
          <Row style={styles.wrap}>
            {BLOOD_TYPES.map((t) => (
              <Chip key={t} label={t} selected={bloodType === t} onPress={() => setBloodType(bloodType === t ? null : t)} />
            ))}
          </Row>
        </View>
      )}
      <TextField label="Alergias" value={allergies} onChangeText={setAllergies} multiline placeholder="Remédios, alimentos, picadas…" />
      <TextField
        label={isPet ? 'Condições e cuidados' : 'Condições de saúde'}
        value={conditions}
        onChangeText={setConditions}
        multiline
        placeholder={isPet ? 'Ex.: castrado, ração especial' : 'Ex.: asma, hipertensão'}
      />
      <Row gap={space.md}>
        <View style={styles.flex}>
          <TextField label={isPet ? 'Plano ou clínica' : 'Plano de saúde'} value={plan} onChangeText={setPlan} />
        </View>
        <View style={styles.flex}>
          <TextField label="Carteirinha" value={planNumber} onChangeText={setPlanNumber} />
        </View>
      </Row>
      <TextField label="Observações" value={notes} onChangeText={setNotes} multiline />

      <Button title="Salvar" onPress={submit} loading={save.isPending} />
      {person && !person.member_user_id ? (
        <Button
          title="Remover"
          variant="danger"
          icon="trash-can-outline"
          onPress={() =>
            confirmAction(
              'Remover',
              `Remover ${person.name}? Consultas, vacinas, exames, treinos e dietas registrados para ${person.kind === 'pet' ? 'esse pet' : 'essa pessoa'} também serão apagados.`,
              'Remover',
              () =>
                remove.mutate(person.id, {
                  onSuccess: () => router.back(),
                  onError: (err) => notify('Erro', errorMessage(err)),
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

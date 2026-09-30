import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Switch, View } from 'react-native';

import { usePeople } from '@/data/health';
import { useArchiveMedication, useMedication, useSaveMedication } from '@/data/home';
import { diffDays, formatBRDate, parseBRDate, todayISO } from '@/domain/dates';
import {
  endAfterDays,
  FREQUENCIES,
  parseTimes,
  spacedTimes,
  WEEKDAYS,
  type MedicationFrequency,
} from '@/domain/medications';
import { disableReminders, enableReminders, hasReminders, remindersSupported } from '@/lib/reminders';
import { errorMessage } from '@/lib/supabase';
import { openNewPerson, PersonChips } from '@/features/health/PersonChips';
import { useHouseReminderTarget } from '@/features/useReminderSync';
import type { Medication, Person } from '@/lib/types';
import { confirmAction, notify } from '@/ui/dialogs';
import { Button, Card, Chip, DateField, ErrorNotice, Loading, Row, Screen, Text, TextField } from '@/ui/primitives';
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
  // A casa do remédio (e o nome dela no aviso, com mais de uma casa).
  const target = useHouseReminderTarget();
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
  const [frequency, setFrequency] = useState<MedicationFrequency>(medication?.frequency ?? 'daily');
  const [weekdays, setWeekdays] = useState<number[]>(medication?.weekdays ?? []);
  const [intervalDays, setIntervalDays] = useState(String(medication?.interval_days ?? 2));
  const [duration, setDuration] = useState<Duration>(
    medication?.total_doses ? 'doses' : medication?.end_on ? 'days' : 'continuous',
  );
  const [days, setDays] = useState(
    medication?.end_on ? String(diffDays(medication.start_on, medication.end_on) + 1) : '7',
  );
  const [totalDoses, setTotalDoses] = useState(String(medication?.total_doses ?? 10));
  const [notes, setNotes] = useState(medication?.notes ?? '');
  const [remind, setRemind] = useState(!medication && remindersSupported);

  useEffect(() => {
    if (medication) hasReminders(medication.id).then(setRemind).catch(() => undefined);
  }, [medication]);

  const onError = (err: unknown) => notify('Erro', errorMessage(err));

  const parsedTimes = parseTimes(times);
  const startISO = parseBRDate(start);
  const daysCount = wholeNumber(days, 1, 3650);

  /** Refaz os horários de 24/N em 24/N horas a partir do primeiro. */
  function pickTimesPerDay(n: number) {
    setTimes(spacedTimes(n, parsedTimes?.[0] ?? '08:00').join(', '));
  }

  function pickFrequency(next: MedicationFrequency) {
    setFrequency(next);
    // Semanal começa no dia da semana do início.
    if (next === 'weekdays' && !weekdays.length) setWeekdays([new Date(`${startISO ?? todayISO()}T12:00:00Z`).getUTCDay()]);
  }

  function toggleWeekday(day: number) {
    setWeekdays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b)));
  }

  function submit() {
    const person = people.find((p) => p.id === personId);
    if (!person || !name.trim()) {
      notify('Confira os dados', 'Escolha para quem é e informe o nome do remédio.');
      return;
    }
    if (!parsedTimes) {
      notify('Horários inválidos', 'Use horários como 08:00, 20:00.');
      return;
    }
    if (!startISO) {
      notify('Data inválida', 'Informe o início como dd/mm/aaaa.');
      return;
    }
    const interval = wholeNumber(intervalDays, 2, 365);
    if (frequency === 'weekdays' && !weekdays.length) {
      notify('Escolha os dias', 'Toque nos dias da semana em que o remédio é tomado.');
      return;
    }
    if (frequency === 'interval' && interval === null) {
      notify('Intervalo inválido', 'Informe de quantos em quantos dias, de 2 a 365.');
      return;
    }
    const doses = wholeNumber(totalDoses, 1, 1000);
    if (duration === 'days' && daysCount === null) {
      notify('Duração inválida', 'Informe por quantos dias, a partir do início.');
      return;
    }
    if (duration === 'doses' && doses === null) {
      notify('Número de doses inválido', 'Informe quantas doses no total, de 1 a 1000.');
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
          end_on: duration === 'days' && daysCount !== null ? endAfterDays(startISO, daysCount) : null,
          notes: notes.trim() || null,
          frequency,
          weekdays: frequency === 'weekdays' ? weekdays : null,
          interval_days: frequency === 'interval' ? interval : null,
          total_doses: duration === 'doses' ? doses : null,
        },
      },
      {
        onSuccess: async (saved) => {
          try {
            if (remind && target) {
              const ok = await enableReminders(saved, target);
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
      <View style={styles.group}>
        <Text variant="label">Quantas vezes por dia</Text>
        <Row style={styles.wrap}>
          {TIMES_PER_DAY.map((n) => (
            <Chip key={n} label={`${n}x`} selected={parsedTimes?.length === n} onPress={() => pickTimesPerDay(n)} />
          ))}
        </Row>
      </View>
      <TextField
        label="Horários"
        value={times}
        onChangeText={setTimes}
        placeholder="08:00, 20:00"
        keyboardType="numbers-and-punctuation"
        hint="Os botões acima espaçam os horários a partir do primeiro (3x: de 8 em 8 horas). Dá para ajustar; separe por vírgula."
      />

      <View style={styles.group}>
        <Text variant="label">Regularidade</Text>
        <Row style={styles.wrap}>
          {FREQUENCIES.map((f) => (
            <Chip key={f.key} label={f.label} selected={frequency === f.key} onPress={() => pickFrequency(f.key)} />
          ))}
        </Row>
        {frequency === 'weekdays' ? (
          <Row style={styles.wrap}>
            {WEEKDAYS.map((w) => (
              <Chip key={w.day} label={w.short} selected={weekdays.includes(w.day)} onPress={() => toggleWeekday(w.day)} />
            ))}
          </Row>
        ) : null}
        {frequency === 'interval' ? (
          <TextField
            label="A cada quantos dias"
            value={intervalDays}
            onChangeText={setIntervalDays}
            keyboardType="number-pad"
            hint="Contando do início: 2 é dia sim, dia não."
          />
        ) : null}
        {frequency === 'monthly' ? (
          <Text variant="small">
            {startISO
              ? `Todo dia ${Number(startISO.slice(8, 10))} do mês, o dia do início. Em mês sem esse dia, no último dia.`
              : 'Todo mês no dia do início.'}
          </Text>
        ) : null}
      </View>

      <DateField label="Início" value={start} onChangeText={setStart} />

      <View style={styles.group}>
        <Text variant="label">Duração</Text>
        <Row style={styles.wrap}>
          {DURATIONS.map((d) => (
            <Chip key={d.key} label={d.label} selected={duration === d.key} onPress={() => setDuration(d.key)} />
          ))}
        </Row>
        {duration === 'days' ? (
          <TextField
            label="Por quantos dias"
            value={days}
            onChangeText={setDays}
            keyboardType="number-pad"
            hint={startISO && daysCount ? `Termina em ${formatBRDate(endAfterDays(startISO, daysCount))}.` : undefined}
          />
        ) : null}
        {duration === 'doses' ? (
          <TextField
            label="Quantas doses no total"
            value={totalDoses}
            onChangeText={setTotalDoses}
            keyboardType="number-pad"
            // Num remédio que já existe, as doses marcadas antes também contam.
            hint={`Acaba quando a última for tomada.${medication ? ` Tomadas até agora: ${medication.taken_count}.` : ''}`}
          />
        ) : null}
      </View>
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

type Duration = 'continuous' | 'days' | 'doses';

const DURATIONS: { key: Duration; label: string }[] = [
  { key: 'continuous', label: 'Uso contínuo' },
  { key: 'days', label: 'Por dias' },
  { key: 'doses', label: 'Nº de doses' },
];

const TIMES_PER_DAY = [1, 2, 3, 4, 6];

/** Número inteiro digitado dentro do intervalo; null se não for. */
function wholeNumber(text: string, min: number, max: number): number | null {
  const value = Number(text.trim());
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  group: { gap: space.sm },
  wrap: { flexWrap: 'wrap' },
});

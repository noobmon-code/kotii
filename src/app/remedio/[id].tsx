import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, type ScrollView, StyleSheet, Switch, View } from 'react-native';

import { usePeople } from '@/data/health';
import {
  MEDICATION_STOCK_UNAVAILABLE,
  toSchedule,
  toStockValues,
  useArchiveMedication,
  useMedication,
  useSaveMedication,
} from '@/data/home';
import { diffDays, formatBRDate, parseBRDate, todayISO } from '@/domain/dates';
import {
  endAfterDays,
  FREQUENCIES,
  parseTimes,
  spacedTimes,
  WEEKDAYS,
  type MedicationFrequency,
} from '@/domain/medications';
import { formatUnits, keepStockOnRuleChange, readStockForm, stockFormOf, type StockForm } from '@/domain/medicationStock';
import { forgetBoxUnits } from '@/lib/medicationBox';
import {
  askReminderPermission,
  disableReminders,
  enableReminders,
  hasReminders,
  PERMISSION_HINT,
  REMINDER_PLACE,
  remindByDefault,
  remindersSupported,
  remindersUnavailableReason,
} from '@/lib/reminders';
import { errorMessage } from '@/lib/supabase';
import { MedicationStockSection } from '@/features/health/MedicationStockSection';
import { openNewPerson, PersonChips } from '@/features/health/PersonChips';
import { useHouseReminderTarget } from '@/features/useReminderSync';
import type { Medication, Person } from '@/lib/types';
import { confirmAction, notify } from '@/ui/dialogs';
import { Button, Card, Chip, DateField, ErrorNotice, Loading, Row, Screen, Text, TextField } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

export default function MedicationScreen() {
  // `estoque`: quem chega por "Atualizar estoque" (telas Hoje e Saúde) abre já em "Estoque e receita".
  const { id, pessoa, estoque } = useLocalSearchParams<{ id: string; pessoa?: string; estoque?: string }>();
  const isNew = id === 'novo';
  const medication = useMedication(isNew ? undefined : id);
  const people = usePeople();

  if ((!isNew && medication.isPending) || people.isPending) return <Loading />;
  if (!isNew && medication.isError) return <ErrorNotice error={medication.error} />;
  if (people.isError) return <ErrorNotice error={people.error} onRetry={() => people.refetch()} />;
  return (
    <MedicationForm
      medication={isNew ? undefined : medication.data}
      people={people.data}
      initialPersonId={pessoa || null}
      openAtStock={Boolean(estoque)}
    />
  );
}

function MedicationForm({
  medication,
  people,
  initialPersonId,
  openAtStock,
}: {
  medication?: Medication;
  people: Person[];
  initialPersonId: string | null;
  openAtStock: boolean;
}) {
  const c = useColors();
  // Abrir em "Estoque e receita": rola até lá uma vez, quando a seção ganha lugar na tela.
  const scroll = useRef<ScrollView>(null);
  const scrolledToStock = useRef(false);
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
  const [remind, setRemind] = useState(() => !medication && remindByDefault());
  const today = todayISO();
  // "Estoque e receita" como a tela abriu: só o que a pessoa mudar daqui em diante é gravado (readStockForm).
  const [savedStock, setSavedStock] = useState<StockForm>(() => stockFormOf(medication && toSchedule(medication), today));
  const [stock, setStock] = useState(savedStock);

  // Uma vez por remédio: "Comprei mais" (ou uma busca nova) troca o objeto do
  // remédio, e ler de novo desfaria o que a pessoa acabou de mudar na chave.
  const medicationId = medication?.id;
  useEffect(() => {
    if (medicationId) hasReminders(medicationId).then(setRemind).catch(() => undefined);
  }, [medicationId]);

  const onError = (err: unknown) => notify('Erro', errorMessage(err));

  function toggleRemind(value: boolean) {
    setRemind(value);
    // No navegador, a permissão sai do toque; no celular, ao salvar.
    if (!value || Platform.OS !== 'web') return;
    askReminderPermission()
      .catch((err: unknown) => err)
      .then((ok) => {
        if (ok === true) return;
        setRemind(false);
        notify('Lembretes desativados', ok === false ? PERMISSION_HINT : errorMessage(ok));
      });
  }

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
    const stockRead = readStockForm(stock, savedStock, today);
    if (!stockRead.ok) {
      notify(stockRead.title, stockRead.message);
      return;
    }
    const values = {
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
    };
    // Mudou a regra das doses de um remédio com estoque acompanhado: o que já foi gasto não muda com ela.
    const stockChanges = keepStockOnRuleChange(
      stockRead.changes,
      medication && toSchedule(medication),
      { times: values.times, startOn: values.start_on, endOn: values.end_on, frequency, weekdays: values.weekdays, intervalDays: values.interval_days },
      today,
    );
    save.mutate(
      { id: medication?.id, values, stock: toStockValues(stockChanges) },
      {
        onSuccess: async ({ medication: saved, stockUnavailable }) => {
          try {
            if (remind && target) {
              const ok = await enableReminders(saved, target);
              if (!ok) notify('Lembretes desativados', PERMISSION_HINT);
            } else {
              await disableReminders(saved.id);
            }
          } catch (err) {
            onError(err);
          }
          // O banco ainda não tem o estoque: o remédio foi salvo, e a pessoa fica sabendo do que ficou de fora.
          if (stockUnavailable) notify('Remédio salvo, mas sem o estoque', MEDICATION_STOCK_UNAVAILABLE);
          router.back();
        },
        onError,
      },
    );
  }

  return (
    <Screen edges={[]} scrollRef={scroll}>
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

      <View
        onLayout={(event) => {
          if (!openAtStock || scrolledToStock.current) return;
          scrolledToStock.current = true;
          scroll.current?.scrollTo({ y: event.nativeEvent.layout.y, animated: false });
        }}>
        <MedicationStockSection
          medication={medication}
          form={stock}
          initial={savedStock}
          today={today}
          onChange={(patch) => setStock((current) => ({ ...current, ...patch }))}
          onRestocked={(count) => {
            // A compra já foi gravada: o número novo vira o salvo, e salvar a tela depois não o grava de novo.
            const counted = { stock: formatUnits(count.stockCount) };
            setSavedStock((current) => ({ ...current, ...counted }));
            setStock((current) => ({ ...current, ...counted }));
          }}
        />
      </View>

      {remindersSupported ? (
        <Card>
          <Row>
            <View style={styles.flex}>
              <Text variant="label">Lembrar {REMINDER_PLACE}</Text>
              <Text variant="small">Cada pessoa da casa escolhe no próprio aparelho.</Text>
            </View>
            <Switch value={remind} onValueChange={toggleRemind} trackColor={{ true: c.primary }} />
          </Row>
        </Card>
      ) : (
        <Text variant="small">{remindersUnavailableReason()}</Text>
      )}

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
                  await forgetBoxUnits(medication.id);
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

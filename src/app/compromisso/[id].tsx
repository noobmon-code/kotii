import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  familyEventErrorMessage,
  useDeleteFamilyEvent,
  useFamilyEvent,
  useFamilyEventDays,
  useSaveFamilyEvent,
  useSaveFamilyEventDay,
} from '@/data/family';
import { usePeople } from '@/data/health';
import { formatBRDate, isValidISODate, parseBRDate, todayISO } from '@/domain/dates';
import {
  dayChangeOf,
  describeDayChange,
  driversOf,
  EVENT_LIMITS,
  EVENT_RECURRENCES,
  isEventDate,
  NO_DAY_CHANGE,
  normalizeDayChange,
  recurrenceHint,
  sameEventFields,
  validateEventForm,
  weekdayDate,
  type EventDayValues,
  type EventRecurrence,
} from '@/domain/familyEvents';
import { weekdayOf } from '@/domain/health';
import { WEEKDAYS } from '@/domain/medications';
import { openNewPerson, PersonChips } from '@/features/health/PersonChips';
import type { FamilyEvent, Person } from '@/lib/types';
import { confirmAction, notify } from '@/ui/dialogs';
import {
  Button,
  Card,
  Chip,
  DateField,
  ErrorNotice,
  Icon,
  IconBadge,
  ListCard,
  ListRow,
  Loading,
  Row,
  Screen,
  Section,
  Text,
  TextField,
} from '@/ui/primitives';
import { space } from '@/ui/theme';

const onError = (err: unknown) => notify('Erro', familyEventErrorMessage(err));

/** Quantos dos outros dias com mudança aparecem antes do "Ver todos". */
const OTHER_DAYS_SHOWN = 6;

/** Com uma cópia guardada, quanto a tela espera a busca desta visita antes de abrir com a cópia. */
const FRESH_WAIT_MS = 4000;

const CHANGED_TITLE = 'Este compromisso mudou';
const CHANGED_MESSAGE = 'Ele foi alterado depois que esta tela abriu (em outro celular, por exemplo).';

/** "Quinta-feira, 15 de outubro". */
function longDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const label = new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export default function FamilyEventScreen() {
  // `dia`: no compromisso novo, a data que já vem preenchida; num que já
  // existe, o dia em que a pessoa tocou (para mudar só aquele dia).
  const { id, dia } = useLocalSearchParams<{ id: string; dia?: string }>();
  const isNew = id === 'novo';
  const people = usePeople();
  const event = useFamilyEvent(isNew ? undefined : id);
  const day = dia && isValidISODate(dia) ? dia : null;

  // O formulário copia o compromisso para os campos uma vez só. Por isso espera a busca desta visita: o que
  // está guardado pode ser de antes de uma mudança (daqui ou de outro celular), e salvar gravaria o de antes
  // por cima. A espera tem limite quando há uma cópia guardada (a internet que não responde não segura a
  // tela), e sem internet a busca fica parada: nos dois casos abre a cópia, e o próprio formulário avisa se
  // o compromisso que chegar depois for outro (ver EventForm). Depois que o formulário apareceu, ele fica:
  // outra busca (a da ficha criada pelo "+ Pessoa", a de voltar ao app) não o tira da frente, nem um erro
  // dela, e o que foi digitado não some. Só sai quando a busca diz que o compromisso não existe mais.
  const [shownId, setShownId] = useState<string | null>(null);
  const shown = shownId === id;
  const [hurriedId, setHurriedId] = useState<string | null>(null);
  const awaitingFresh = !isNew && !shown && hurriedId !== id && event.isFetching && !event.isFetchedAfterMount;
  const hasCopy = Boolean(event.data);
  useEffect(() => {
    if (!awaitingFresh || !hasCopy) return;
    const timer = setTimeout(() => setHurriedId(id), FRESH_WAIT_MS);
    return () => clearTimeout(timer);
  }, [awaitingFresh, hasCopy, id]);
  // Quantas vezes a pessoa pediu "Atualizar": cada uma monta o formulário de novo, com o compromisso de agora.
  const [reloads, setReloads] = useState(0);

  const failed = !shown && (people.isError || (!isNew && event.isError));
  const waiting = !people.data || (!isNew && (event.isPending || awaitingFresh));
  const found = isNew || Boolean(event.data);
  // Guardado na própria renderização em que o formulário aparece (estado derivado, sem efeito).
  if (!shown && !failed && !waiting && found) setShownId(id);

  if (!shown && people.isError) return <ErrorNotice error={people.error} onRetry={() => people.refetch()} />;
  if (!shown && !isNew && event.isError) {
    return <ErrorNotice error={new Error(familyEventErrorMessage(event.error))} onRetry={() => event.refetch()} />;
  }
  if (!people.data || waiting) return <Loading />;
  if (!found) return <ErrorNotice error={new Error('Compromisso não encontrado.')} />;
  return (
    <EventForm
      // Outro compromisso (ou o "Atualizar") é outro formulário: os campos nunca passam de um para o outro.
      key={`${id}:${reloads}`}
      event={isNew ? undefined : (event.data ?? undefined)}
      people={people.data}
      day={day}
      onReload={() => setReloads((count) => count + 1)}
    />
  );
}

function EventForm({ event, people, day, onReload }: { event?: FamilyEvent; people: Person[]; day: string | null; onReload: () => void }) {
  const save = useSaveFamilyEvent();
  const remove = useDeleteFamilyEvent();
  const drivers = driversOf(people);
  // O compromisso como estava quando os campos foram preenchidos. Se o que chega do banco depois é outro (mudou
  // em outro celular, ou a cópia que abriu era antiga), salvar gravaria o de antes por cima: a tela avisa e
  // oferece atualizar, e o salvar pergunta antes.
  const [opened] = useState(event);
  const changedElsewhere = Boolean(event && opened && !sameEventFields(event, opened)) && !save.isPending && !save.isSuccess;
  const [title, setTitle] = useState(event?.title ?? '');
  const [date, setDate] = useState(formatBRDate(event?.starts_on ?? day ?? todayISO()));
  const [startTime, setStartTime] = useState(event?.start_time ?? '');
  const [endTime, setEndTime] = useState(event?.end_time ?? '');
  const [personId, setPersonId] = useState<string | null>(event?.person_id ?? null);
  const [takeBy, setTakeBy] = useState<string | null>(event?.take_by ?? null);
  const [pickUpBy, setPickUpBy] = useState<string | null>(event?.pick_up_by ?? null);
  const [location, setLocation] = useState(event?.location ?? '');
  const [bring, setBring] = useState(event?.bring ?? '');
  const [notes, setNotes] = useState(event?.notes ?? '');
  const [recurrence, setRecurrence] = useState<EventRecurrence>(event?.recurrence ?? 'none');
  const [weekdays, setWeekdays] = useState<number[]>(event?.weekdays ?? []);
  // O dia da semana veio sozinho da data (ao escolher "Toda semana") e ninguém
  // mexeu nele: acompanha a data. Os de um compromisso já gravado e os
  // escolhidos à mão nunca andam.
  const [autoWeekday, setAutoWeekday] = useState(false);
  const [until, setUntil] = useState(event?.until_on ? formatBRDate(event.until_on) : '');

  const dateISO = parseBRDate(date);
  const repeats = recurrence !== 'none';
  const hint = recurrenceHint(recurrence, dateISO, weekdays);
  // O compromisso gravado já se repete: salvar e excluir valem para todas as vezes.
  const series = Boolean(event && event.recurrence !== 'none');

  function changeDate(next: string) {
    setDate(next);
    const nextISO = parseBRDate(next);
    if (autoWeekday && nextISO) setWeekdays([weekdayOf(nextISO)]);
  }

  function pickRecurrence(next: EventRecurrence) {
    setRecurrence(next);
    // Toda semana começa no dia da semana da data.
    if (next === 'weekly' && !weekdays.length) {
      setWeekdays([weekdayOf(dateISO ?? todayISO())]);
      setAutoWeekday(true);
    }
  }

  function toggleWeekday(weekday: number) {
    setAutoWeekday(false);
    setWeekdays((prev) => (prev.includes(weekday) ? prev.filter((d) => d !== weekday) : [...prev, weekday].sort((a, b) => a - b)));
  }

  function submit() {
    const result = validateEventForm({
      title,
      date,
      startTime,
      endTime,
      personId,
      takeBy,
      pickUpBy,
      location,
      bring,
      notes,
      recurrence,
      weekdays,
      until,
    });
    if (!result.ok) {
      notify(result.title, result.message);
      return;
    }
    const values = result.values;
    const send = () => save.mutate({ id: event?.id, values }, { onSuccess: () => router.back(), onError });
    if (changedElsewhere) confirmAction(CHANGED_TITLE, `${CHANGED_MESSAGE} Salvar agora grava por cima dessas mudanças.`, 'Salvar assim mesmo', send);
    else send();
  }

  return (
    <Screen edges={[]}>
      <Stack.Screen options={{ title: event ? 'Compromisso' : 'Novo compromisso' }} />
      {changedElsewhere ? (
        <Card style={styles.group}>
          <Text variant="heading">{CHANGED_TITLE}</Text>
          <Text variant="muted">{CHANGED_MESSAGE} Atualize para ver como ele está agora; o que você digitou aqui se perde.</Text>
          <Button title="Atualizar" variant="secondary" icon="refresh" onPress={onReload} />
        </Card>
      ) : null}
      {event && series ? <DayChanges event={event} people={people} initialDay={day} /> : null}
      {series ? (
        <View style={styles.group}>
          <Text variant="heading">Todas as vezes</Text>
          <Text variant="muted">O que você mudar daqui para baixo vale para todas as vezes deste compromisso.</Text>
        </View>
      ) : null}

      <TextField
        label="Compromisso"
        value={title}
        onChangeText={setTitle}
        placeholder="Ex.: Natação da Ana, Reunião da escola"
        maxLength={EVENT_LIMITS.title}
        autoFocus={!event}
      />
      <DateField label={repeats ? 'A partir de' : 'Data'} value={date} onChangeText={changeDate} />
      <Row gap={space.md}>
        <View style={styles.flex}>
          <TextField label="Começa às" value={startTime} onChangeText={setStartTime} placeholder="16:00" keyboardType="numbers-and-punctuation" />
        </View>
        <View style={styles.flex}>
          <TextField label="Termina às" value={endTime} onChangeText={setEndTime} placeholder="17:00" keyboardType="numbers-and-punctuation" />
        </View>
      </Row>
      <Text variant="small">Sem horário, o compromisso vale para o dia todo.</Text>

      <View style={styles.group}>
        <Text variant="label">De quem é</Text>
        <PersonChips people={people} value={personId} onChange={setPersonId} allLabel="Família toda" onAdd={openNewPerson} />
      </View>
      <View style={styles.group}>
        <Text variant="label">Quem leva</Text>
        <PersonChips people={drivers} value={takeBy} onChange={setTakeBy} allLabel="Ninguém" onAdd={openNewPerson} addLabel="Pessoa" />
      </View>
      <View style={styles.group}>
        <Text variant="label">Quem busca</Text>
        <PersonChips people={drivers} value={pickUpBy} onChange={setPickUpBy} allLabel="Ninguém" onAdd={openNewPerson} addLabel="Pessoa" />
      </View>

      <TextField label="Local" value={location} onChangeText={setLocation} placeholder="Ex.: Clube, escola, casa da vó" maxLength={EVENT_LIMITS.location} />
      <TextField label="O que levar" value={bring} onChangeText={setBring} placeholder="Ex.: touca e toalha" maxLength={EVENT_LIMITS.bring} />

      <View style={styles.group}>
        <Text variant="label">Repetir</Text>
        <Row style={styles.wrap}>
          {EVENT_RECURRENCES.map((o) => (
            <Chip key={o.value} label={o.label} selected={recurrence === o.value} onPress={() => pickRecurrence(o.value)} />
          ))}
        </Row>
        {recurrence === 'weekly' ? (
          <Row style={styles.wrap}>
            {WEEKDAYS.map((w) => (
              <Chip key={w.day} label={w.short} selected={weekdays.includes(w.day)} onPress={() => toggleWeekday(w.day)} />
            ))}
          </Row>
        ) : null}
        {hint ? <Text variant="small">{hint}</Text> : null}
      </View>
      {repeats ? <DateField label="Repete até" value={until} onChangeText={setUntil} placeholder="Sem data para acabar" /> : null}

      <TextField label="Observações" value={notes} onChangeText={setNotes} multiline maxLength={EVENT_LIMITS.notes} />
      <Button title={series ? 'Salvar para todas as vezes' : 'Salvar'} onPress={submit} loading={save.isPending} />
      {event ? (
        <Button
          title="Excluir compromisso"
          variant="danger"
          icon="trash-can-outline"
          onPress={() =>
            confirmAction('Excluir compromisso', series ? `Excluir "${event.title}" em todas as vezes?` : `Excluir "${event.title}"?`, 'Excluir', () =>
              remove.mutate(event.id, { onSuccess: () => router.back(), onError }),
            )
          }
        />
      ) : null}
    </Screen>
  );
}

/**
 * Compromisso que se repete: o que muda só num dia (quem leva, quem busca ou
 * "não vai ter") e os outros dias que já têm mudança. Cada toque já grava;
 * o resto do formulário é de todas as vezes.
 */
function DayChanges({ event, people, initialDay }: { event: FamilyEvent; people: Person[]; initialDay: string | null }) {
  const days = useFamilyEventDays();
  const save = useSaveFamilyEventDay();
  const today = todayISO();
  // Só um dia que é mesmo do compromisso (a regra pode ter mudado desde o toque).
  const [day, setDay] = useState(initialDay && isEventDate(event, initialDay) ? initialDay : null);
  const [showAll, setShowAll] = useState(false);

  if (!days.data) {
    return days.isError ? (
      <Card>
        <Text variant="small">Não deu para carregar o que muda em cada dia deste compromisso. Tente de novo mais tarde.</Text>
      </Card>
    ) : null;
  }

  const rows = days.data.filter((d) => d.event_id === event.id);
  // Mudança guardada que ficou igual ao de sempre (o compromisso mudou depois)
  // não é mudança: o dia aparece "como sempre" e não entra na lista.
  const stored = day ? dayChangeOf(event.id, rows, day) : null;
  const values: EventDayValues = (stored && normalizeDayChange(event, stored)) ?? NO_DAY_CHANGE;
  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.name ?? null;
  const drivers = driversOf(people);
  const others = rows
    .filter((d) => d.occurs_on !== day && d.occurs_on >= today && isEventDate(event, d.occurs_on))
    .flatMap((d) => {
      const change = normalizeDayChange(event, d);
      return change ? [{ date: d.occurs_on, change }] : [];
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  // A lista fica acima do formulário: só os primeiros, e o resto num toque
  // (é por ela que se chega a um dia marcado como "não vai ter").
  const shown = showAll ? others : others.slice(0, OTHER_DAYS_SHOWN);
  // Cada toque grava a linha inteira do dia, montada com o que está na tela. Enquanto a busca desta visita não
  // chega, o que está na tela pode ser de antes de uma mudança feita em outro celular, e o toque a apagaria:
  // as escolhas esperam, apagadas, como enquanto grava. Sem internet a busca fica parada, e elas ficam livres.
  const saving = save.isPending || (days.isFetching && !days.isFetchedAfterMount);

  function change(patch: Partial<EventDayValues>) {
    if (!day || saving) return;
    save.mutate({ eventId: event.id, date: day, change: normalizeDayChange(event, { ...values, ...patch }) }, { onError });
  }

  return (
    <>
      {day ? (
        <Card style={styles.group}>
          <Text variant="heading">Só neste dia</Text>
          <Text variant="muted">{longDate(day)}. O que você mudar aqui vale só para este dia.</Text>
          {values.cancelled ? (
            <>
              <Row>
                <Icon name="calendar-remove-outline" color="textMuted" />
                <Text variant="body" style={styles.flex}>
                  Não vai ter neste dia.
                </Text>
              </Row>
              <Button title="Desfazer: vai ter neste dia" variant="secondary" icon="undo" loading={saving} onPress={() => change({ cancelled: false })} />
            </>
          ) : (
            <>
              {/* Enquanto grava, as escolhas ficam apagadas e não aceitam toque: um segundo toque que parecesse aceito se perderia. */}
              <View style={[styles.group, saving && styles.busy]} accessibilityState={{ busy: saving }}>
                <DayDriver
                  label="Quem leva"
                  usual={event.take_by}
                  changed={values.override_take}
                  value={values.take_by}
                  drivers={drivers}
                  nameOf={nameOf}
                  onChange={(changed, id) => change({ override_take: changed, take_by: id })}
                />
                <DayDriver
                  label="Quem busca"
                  usual={event.pick_up_by}
                  changed={values.override_pick_up}
                  value={values.pick_up_by}
                  drivers={drivers}
                  nameOf={nameOf}
                  onChange={(changed, id) => change({ override_pick_up: changed, pick_up_by: id })}
                />
              </View>
              <Button
                title="Não vai ter neste dia"
                variant="secondary"
                icon="calendar-remove-outline"
                loading={saving}
                onPress={() => change({ cancelled: true })}
              />
            </>
          )}
        </Card>
      ) : null}
      {others.length ? (
        <Section title={day ? 'Outros dias com mudança' : 'Dias com mudança'}>
          <ListCard>
            {shown.map((other) => (
              <ListRow
                key={other.date}
                left={<IconBadge icon={other.change.cancelled ? 'calendar-remove-outline' : 'car-outline'} tone={other.change.cancelled ? 'warning' : 'info'} />}
                title={weekdayDate(other.date)}
                subtitle={describeDayChange(other.change, nameOf)}
                onPress={() => setDay(other.date)}
              />
            ))}
            {others.length > shown.length ? <Button title={`Ver todos (${others.length})`} variant="ghost" onPress={() => setShowAll(true)} /> : null}
          </ListCard>
        </Section>
      ) : null}
    </>
  );
}

/** Quem leva (ou busca) num dia: o de sempre, ninguém, ou outra pessoa só naquele dia. */
function DayDriver({
  label,
  usual,
  changed,
  value,
  drivers,
  nameOf,
  onChange,
}: {
  label: string;
  /** Quem leva (ou busca) sempre. */
  usual: string | null;
  changed: boolean;
  value: string | null;
  drivers: Person[];
  nameOf: (id: string | null) => string | null;
  onChange: (changed: boolean, id: string | null) => void;
}) {
  return (
    <View style={styles.group}>
      <Text variant="label">{label}</Text>
      <Row style={styles.wrap}>
        <Chip label={`Como sempre: ${nameOf(usual) ?? 'ninguém'}`} selected={!changed} onPress={() => onChange(false, null)} />
        {/* Sem ninguém de sempre, "Ninguém" só aparece no dia que já está assim: o de quem ia levar só naquele dia e teve a ficha apagada. */}
        {usual || (changed && value === null) ? <Chip label="Ninguém" selected={changed && value === null} onPress={() => onChange(true, null)} /> : null}
        {drivers
          .filter((p) => p.id !== usual)
          .map((p) => (
            <Chip key={p.id} label={p.name} selected={changed && value === p.id} onPress={() => onChange(true, p.id)} />
          ))}
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  group: { gap: space.sm },
  busy: { opacity: 0.5, pointerEvents: 'none' },
  wrap: { flexWrap: 'wrap' },
});

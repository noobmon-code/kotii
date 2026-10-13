// Compromissos da família: o que não mora em outra parte do app ("Natação da
// Ana, terça e quinta às 16h, o Beto leva, a Carla busca, levar touca e
// toalha") e os aniversários, que saem das fichas. Um compromisso que se
// repete é uma linha só (a regra); o que muda num dia (quem leva, quem busca,
// "não vai ter") fica à parte, por compromisso e data.

import { addDays, addMonths, diffDays, formatBRDate, parseBRDate } from './dates';
import { weekdayOf, WEEKDAYS_SHORT } from './health';

export type EventRecurrence = 'none' | 'weekly' | 'monthly' | 'yearly';

export const EVENT_RECURRENCES: { value: EventRecurrence; label: string }[] = [
  { value: 'none', label: 'Não repete' },
  { value: 'weekly', label: 'Toda semana' },
  { value: 'monthly', label: 'Todo mês' },
  { value: 'yearly', label: 'Todo ano' },
];

/** Tamanho dos textos, como no banco. */
export const EVENT_LIMITS = { title: 120, location: 200, bring: 300, notes: 2000 } as const;

/** A regra de repetição: de quando, como e até quando. */
export interface EventSeries {
  starts_on: string;
  recurrence: EventRecurrence;
  /** Só em 'weekly': os dias da semana (0 = domingo). */
  weekdays: number[] | null;
  /** Último dia da repetição (inclusive); sem ele, não acaba. */
  until_on: string | null;
}

export interface FamilyEventLike extends EventSeries {
  id: string;
  title: string;
  /** HH:MM; sem ela, é o dia todo. */
  start_time: string | null;
  end_time: string | null;
  /** De quem é (pessoa ou pet); null: da família toda. */
  person_id: string | null;
  take_by: string | null;
  pick_up_by: string | null;
  location: string | null;
  bring: string | null;
}

/** O que o formulário grava. */
export type FamilyEventValues = Omit<FamilyEventLike, 'id'> & { notes: string | null };

/**
 * O que muda num dia de um compromisso. `override_take` separa "neste dia
 * ninguém leva" (true, com `take_by` nulo) de "como sempre" (false).
 */
export interface EventDayValues {
  cancelled: boolean;
  override_take: boolean;
  take_by: string | null;
  override_pick_up: boolean;
  pick_up_by: string | null;
}

export interface EventDayLike extends EventDayValues {
  event_id: string;
  occurs_on: string;
}

export const NO_DAY_CHANGE: EventDayValues = {
  cancelled: false,
  override_take: false,
  take_by: null,
  override_pick_up: false,
  pick_up_by: null,
};

export interface PersonLike {
  id: string;
  name: string;
  kind: 'pessoa' | 'pet';
  birth_date: string | null;
}

/** Tudo de que a agenda da família precisa: compromissos, mudanças de dias e fichas. */
export interface FamilyCalendar {
  events: FamilyEventLike[];
  days: EventDayLike[];
  people: PersonLike[];
}

export const EMPTY_CALENDAR: FamilyCalendar = { events: [], days: [], people: [] };

/** Quem pode levar e buscar: gente (pet não dirige). */
export function driversOf<P extends Pick<PersonLike, 'kind'>>(people: P[]): P[] {
  return people.filter((p) => p.kind === 'pessoa');
}

// ---------------------------------------------------------------------------
// Datas

/** Teto de datas por compromisso num intervalo (um intervalo absurdo não trava a tela). */
const MAX_DATES = 400;

const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7));

/**
 * As datas do compromisso entre `from` e `to` (inclusive), só pela regra. Não
 * conta desde o começo: um compromisso criado há anos parte de perto de `from`.
 * Mensal e anual mantêm o dia (31 vira o último dia nos meses curtos, 29/02
 * vira 28/02 nos anos sem ele), como as contas.
 */
export function eventDatesIn(event: EventSeries, from: string, to: string): string[] {
  const first = event.starts_on;
  if (event.recurrence === 'none') return first >= from && first <= to ? [first] : [];
  const start = from > first ? from : first;
  const last = event.until_on && event.until_on < to ? event.until_on : to;
  if (start > last) return [];
  const dates: string[] = [];
  if (event.recurrence === 'weekly') {
    // Sem dias (não deveria: o banco exige), vale o dia da semana do começo.
    const weekdays = new Set(event.weekdays?.length ? event.weekdays : [weekdayOf(first)]);
    for (let date = start; date <= last && dates.length < MAX_DATES; date = addDays(date, 1)) {
      if (weekdays.has(weekdayOf(date))) dates.push(date);
    }
    return dates;
  }
  const step = event.recurrence === 'yearly' ? 12 : 1;
  for (let i = Math.max(0, Math.floor((monthIndex(start) - monthIndex(first)) / step)); dates.length < MAX_DATES; i++) {
    // Sempre a partir do primeiro dia: 31/01 dá 28/02 e depois 31/03, sem "escorregar".
    const date = addMonths(first, i * step);
    if (date > last) break;
    if (date >= start) dates.push(date);
  }
  return dates;
}

/** O compromisso cai neste dia (pela regra)? */
export function isEventDate(event: EventSeries, date: string): boolean {
  return eventDatesIn(event, date, date).length > 0;
}

/** Uma vez do compromisso, já com o que vale naquele dia. */
export interface EventOccurrence<E extends FamilyEventLike = FamilyEventLike> {
  event: E;
  date: string;
  take_by: string | null;
  pick_up_by: string | null;
}

/**
 * As vezes do compromisso entre `from` e `to`, com as mudanças de cada dia:
 * dia marcado como "não vai ter" sai, e quem leva ou busca naquele dia entra
 * no lugar do de sempre. Mudança de um dia que não é mais do compromisso (a
 * regra mudou) não conta, nem a que sobrou num compromisso que deixou de se
 * repetir: a tela não teria onde desfazê-la.
 */
export function occurrencesOf<E extends FamilyEventLike>(event: E, days: EventDayLike[], from: string, to: string): EventOccurrence<E>[] {
  const rows = event.recurrence === 'none' ? [] : days.filter((d) => d.event_id === event.id);
  const changes = new Map(rows.map((d) => [d.occurs_on, d]));
  return eventDatesIn(event, from, to).flatMap((date) => {
    const change = changes.get(date);
    if (change?.cancelled) return [];
    return [
      {
        event,
        date,
        take_by: change?.override_take ? change.take_by : event.take_by,
        pick_up_by: change?.override_pick_up ? change.pick_up_by : event.pick_up_by,
      },
    ];
  });
}

/** A mudança guardada para o dia (null: como sempre). */
export function dayChangeOf(eventId: string, days: EventDayLike[], date: string): EventDayLike | null {
  return days.find((d) => d.event_id === eventId && d.occurs_on === date) ?? null;
}

/**
 * O que guardar para o dia: escolher para o dia o mesmo de sempre não é
 * mudança (e seguiria travado se o compromisso mudasse depois). null: nada
 * mudou, a linha do dia não fica.
 */
export function normalizeDayChange(event: Pick<FamilyEventLike, 'take_by' | 'pick_up_by'>, values: EventDayValues): EventDayValues | null {
  const take = values.override_take && values.take_by !== event.take_by;
  const pickUp = values.override_pick_up && values.pick_up_by !== event.pick_up_by;
  if (!values.cancelled && !take && !pickUp) return null;
  return {
    cancelled: values.cancelled,
    override_take: take,
    take_by: take ? values.take_by : null,
    override_pick_up: pickUp,
    pick_up_by: pickUp ? values.pick_up_by : null,
  };
}

/**
 * Dias com mudança que não são mais do compromisso (a regra mudou): podem ser
 * apagados. Se ele não se repete mais, todos: "só neste dia" é de quem se repete.
 */
export function staleDayDates(event: EventSeries, days: Pick<EventDayLike, 'occurs_on'>[]): string[] {
  const dates = days.map((d) => d.occurs_on);
  return event.recurrence === 'none' ? dates : dates.filter((date) => !isEventDate(event, date));
}

/** O que fazer com as mudanças de cada dia depois de salvar o compromisso. */
export interface DayChangesCleanup {
  /** Dias cuja mudança sai. */
  remove: string[];
  /** Dias cuja mudança fica, só com o que ainda difere do de sempre. */
  rewrite: (EventDayValues & { occurs_on: string })[];
}

/**
 * Depois de salvar o compromisso: saem as mudanças de dias que não são mais
 * dele (staleDayDates) e as que ficaram iguais ao de sempre (o compromisso
 * passou a ter a mesma pessoa). Guardada, a que ficou igual voltaria do nada
 * quando o compromisso mudasse de novo, sem ninguém ter pedido. A que ainda
 * difere em parte fica só com essa parte.
 */
export function dayChangesAfterSave(
  event: EventSeries & Pick<FamilyEventLike, 'take_by' | 'pick_up_by'>,
  days: (EventDayValues & Pick<EventDayLike, 'occurs_on'>)[],
): DayChangesCleanup {
  const stale = new Set(staleDayDates(event, days));
  const remove = [...stale];
  const rewrite: DayChangesCleanup['rewrite'] = [];
  for (const day of days) {
    if (stale.has(day.occurs_on)) continue;
    const kept = normalizeDayChange(event, day);
    if (!kept) remove.push(day.occurs_on);
    else if (kept.override_take !== day.override_take || kept.override_pick_up !== day.override_pick_up) {
      rewrite.push({ occurs_on: day.occurs_on, ...kept });
    }
  }
  return { remove, rewrite };
}

/** Aniversário de uma ficha num ano: quantos anos faz. */
export interface Birthday {
  person_id: string;
  name: string;
  date: string;
  age: number;
}

/**
 * Aniversários das fichas (pessoas e pets) com data de nascimento, entre
 * `from` e `to`. 29/02 é comemorado em 28/02 nos anos sem ele. O ano do
 * nascimento não conta: é o nascimento, não um aniversário.
 */
export function birthdaysIn(people: PersonLike[], from: string, to: string): Birthday[] {
  const out: Birthday[] = [];
  for (const person of people) {
    if (!person.birth_date) continue;
    const born = Number(person.birth_date.slice(0, 4));
    for (let year = Math.max(born + 1, Number(from.slice(0, 4))); year <= Number(to.slice(0, 4)); year++) {
      const date = addMonths(person.birth_date, (year - born) * 12);
      if (date >= from && date <= to) out.push({ person_id: person.id, name: person.name, date, age: year - born });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'pt-BR'));
}

// ---------------------------------------------------------------------------
// Textos

/** Texto livre comprido, cortado com reticências para caber onde vai (aviso, retrato do Nuke). */
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** "16:00–17:00", "16:00" ou null (o dia todo). */
export function formatTimeRange(start: string | null, end: string | null): string | null {
  if (!start) return null;
  return end ? `${start}–${end}` : start;
}

/** "Beto leva, Carla busca", "Beto leva e busca", "Carla busca" ou null. */
export function rideText(take: string | null, pickUp: string | null): string | null {
  if (take && pickUp) return take === pickUp ? `${take} leva e busca` : `${take} leva, ${pickUp} busca`;
  if (take) return `${take} leva`;
  return pickUp ? `${pickUp} busca` : null;
}

/** "Levar: touca e toalha". */
export function bringText(bring: string | null): string | null {
  return bring?.trim() ? `Levar: ${bring.trim()}` : null;
}

/** "faz 8 anos". */
export function ageText(age: number): string {
  return `faz ${age} ${age === 1 ? 'ano' : 'anos'}`;
}

/** "de", e não "da" ou "do": o app não sabe se é a Ana ou o Beto (nem o Rex). */
export function birthdayTitle(name: string): string {
  return `Aniversário de ${name}`;
}

/** Quem leva e quem busca valem para todos os dias da semana do compromisso: a saída é um para cada dia. */
const EACH_DAY_HINT = 'Cada dia uma pessoa leva? Crie um compromisso para cada dia.';

/**
 * "Todo dia 31; nos meses mais curtos, no último dia" (null: não repete). Na
 * semana, que já mostra os dias, só a dica de quando há mais de um escolhido.
 */
export function recurrenceHint(recurrence: EventRecurrence, date: string | null, weekdays: number[] = []): string | null {
  if (recurrence === 'weekly') return weekdays.length > 1 ? EACH_DAY_HINT : null;
  if (!date || recurrence === 'none') return null;
  const day = Number(date.slice(8, 10));
  if (recurrence === 'monthly') return day > 28 ? `Todo dia ${day}; nos meses mais curtos, no último dia.` : `Todo dia ${day}.`;
  const dayMonth = formatBRDate(date).slice(0, 5);
  return dayMonth === '29/02' ? 'Todo ano em 29/02; nos anos sem esse dia, em 28/02.' : `Todo ano em ${dayMonth}.`;
}

/** Uma linha da agenda da família: uma vez de um compromisso, ou um aniversário. */
export interface CalendarEntry {
  kind: 'compromisso' | 'aniversario';
  /** O compromisso, ou a ficha de quem faz aniversário: para abrir a tela. */
  id: string;
  date: string;
  /** HH:MM; null: o dia todo. */
  time: string | null;
  endTime: string | null;
  title: string;
  /** De quem é o compromisso. */
  who: string | null;
  /** "Beto leva, Carla busca". */
  ride: string | null;
  location: string | null;
  bring: string | null;
  /** Aniversário: quantos anos faz. */
  age: number | null;
  /** Vez de um compromisso de toda semana em que quem leva e quem busca são os de sempre: o aviso é só no dia. */
  routine: boolean;
}

/** Dia inteiro antes das horas marcadas; dentro disso, pelo título (como o resto da agenda). */
function byDayAndTime(a: CalendarEntry, b: CalendarEntry): number {
  return a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '') || a.title.localeCompare(b.title, 'pt-BR');
}

/** Compromissos (com as mudanças de cada dia) e aniversários entre `from` e `to`, em ordem. */
export function calendarEntries({ events, days, people }: FamilyCalendar, from: string, to: string): CalendarEntry[] {
  const nameOf = (id: string | null) => (id ? (people.find((p) => p.id === id)?.name ?? null) : null);
  const byEvent = new Map<string, EventDayLike[]>();
  for (const day of days) byEvent.set(day.event_id, [...(byEvent.get(day.event_id) ?? []), day]);
  const entries: CalendarEntry[] = [];
  for (const event of events) {
    for (const o of occurrencesOf(event, byEvent.get(event.id) ?? [], from, to)) {
      entries.push({
        kind: 'compromisso',
        id: event.id,
        date: o.date,
        time: event.start_time,
        endTime: event.start_time ? event.end_time : null,
        title: event.title,
        who: nameOf(event.person_id),
        ride: rideText(nameOf(o.take_by), nameOf(o.pick_up_by)),
        location: event.location?.trim() || null,
        bring: event.bring?.trim() || null,
        age: null,
        routine: event.recurrence === 'weekly' && o.take_by === event.take_by && o.pick_up_by === event.pick_up_by,
      });
    }
  }
  for (const b of birthdaysIn(people, from, to)) {
    entries.push({
      kind: 'aniversario',
      id: b.person_id,
      date: b.date,
      time: null,
      endTime: null,
      title: birthdayTitle(b.name),
      who: null,
      ride: null,
      location: null,
      bring: null,
      age: b.age,
      routine: false,
    });
  }
  return entries.sort(byDayAndTime);
}

/** "Ana · Beto leva, Carla busca · Levar: touca e toalha", ou "faz 8 anos". */
export function entryDetail(entry: CalendarEntry): string | null {
  if (entry.kind === 'aniversario') return entry.age ? ageText(entry.age) : null;
  return [entry.who, entry.ride, bringText(entry.bring)].filter(Boolean).join(' · ') || null;
}

/**
 * "Ana, Carla leva", ou "faz 8 anos": o detalhe curto, para o resumo de amanhã
 * (entre parênteses, depois do título). O local e o que levar não entram aqui:
 * o resumo é para ler de uma olhada. Quando o compromisso é de quem leva (ou
 * de quem só busca), o nome vai uma vez: "Beto leva e busca", e não "Beto,
 * Beto leva e busca".
 */
export function entryShortDetail(entry: CalendarEntry): string | null {
  if (entry.kind === 'aniversario') return entry.age ? ageText(entry.age) : null;
  const { who, ride } = entry;
  // Só o nome inteiro, seguido do verbo: "Ana Paula leva" não é da Ana.
  const repeated =
    !!who && !!ride && (ride === `${who} busca` || ride === `${who} leva` || ride === `${who} leva e busca` || ride.startsWith(`${who} leva, `));
  return [repeated ? null : who, ride].filter(Boolean).join(', ') || null;
}

/** O que mudou num dia, para a lista de dias com mudança: "Não vai ter", "Vó Maria leva", "Ninguém busca". */
export function describeDayChange(change: EventDayValues, nameOf: (id: string | null) => string | null): string {
  if (change.cancelled) return 'Não vai ter';
  const take = change.override_take ? `${nameOf(change.take_by) ?? 'Ninguém'} leva` : null;
  const pickUp = change.override_pick_up ? `${nameOf(change.pick_up_by) ?? (take ? 'ninguém' : 'Ninguém')} busca` : null;
  return [take, pickUp].filter(Boolean).join(', ');
}

/** "Qui, 15/10": dia da semana e data curta. */
export function weekdayDate(date: string): string {
  return `${WEEKDAYS_SHORT[weekdayOf(date)]}, ${formatBRDate(date).slice(0, 5)}`;
}

// ---------------------------------------------------------------------------
// Tela Hoje

export interface TodayEntry {
  key: string;
  kind: CalendarEntry['kind'];
  id: string;
  date: string;
  title: string;
  /** "Hoje · 16:00–17:00 · Ana · Beto leva, Carla busca". */
  subtitle: string;
}

/** Compromissos e aniversários de hoje e de amanhã, para a tela Hoje. */
export function todayEntries(calendar: FamilyCalendar, today: string): TodayEntry[] {
  return calendarEntries(calendar, today, addDays(today, 1)).map((entry) => ({
    key: `${entry.kind}:${entry.id}:${entry.date}`,
    kind: entry.kind,
    id: entry.id,
    date: entry.date,
    title: entry.title,
    subtitle: [entry.date === today ? 'Hoje' : 'Amanhã', formatTimeRange(entry.time, entry.endTime), entryDetail(entry)]
      .filter(Boolean)
      .join(' · '),
  }));
}

// ---------------------------------------------------------------------------
// Nuke

/** Local e "o que levar" no retrato do Nuke: o texto se repete a cada vez do compromisso, e o servidor corta o retrato inteiro num tamanho fixo. */
const NUKE_LOCATION_MAX = 60;
const NUKE_BRING_MAX = 120;

/**
 * Linhas para o retrato da casa do Nuke: os próximos dias (hoje + `days`),
 * com "hoje", "amanhã" ou o dia da semana já escritos, para ele não fazer
 * conta de data. Ex.: "amanhã 16:00–17:00 Natação da Ana (Ana, Beto leva,
 * Carla busca, local: Clube, levar: touca)".
 */
export function calendarLines(calendar: FamilyCalendar, today: string, days = 7): string[] {
  return calendarEntries(calendar, today, addDays(today, days)).map((entry) => {
    const ahead = diffDays(today, entry.date);
    const day = ahead === 0 ? 'hoje' : ahead === 1 ? 'amanhã' : weekdayDate(entry.date).toLowerCase().replace(',', '');
    const details =
      entry.kind === 'aniversario'
        ? [entry.age ? ageText(entry.age) : null]
        : [
            entry.who,
            entry.ride,
            entry.location ? `local: ${clip(entry.location, NUKE_LOCATION_MAX)}` : null,
            entry.bring ? `levar: ${clip(entry.bring, NUKE_BRING_MAX)}` : null,
          ];
    const extra = details.filter(Boolean).join(', ');
    return [day, formatTimeRange(entry.time, entry.endTime), entry.title].filter(Boolean).join(' ') + (extra ? ` (${extra})` : '');
  });
}

// ---------------------------------------------------------------------------
// Avisos

export interface EventReminderTexts {
  /** Na véspera ("Amanhã: Natação da Ana às 16:00"); null no aniversário, que só avisa no dia. */
  eve: string | null;
  /** No dia ("Hoje às 16:00: Natação da Ana", "Hoje é aniversário de Ana"). */
  today: string;
  /** De quem é, quem leva e busca, onde e o que levar. */
  body: string;
}

/** Os textos do aviso, cortados para não passar do que a agenda do navegador aceita (push_schedule). */
export function eventReminderTexts(entry: CalendarEntry): EventReminderTexts {
  if (entry.kind === 'aniversario') {
    const age = entry.age ? ageText(entry.age) : '';
    return {
      eve: null,
      today: clip(`Hoje é ${entry.title.charAt(0).toLowerCase()}${entry.title.slice(1)}`, 180),
      body: age ? `${age.charAt(0).toUpperCase()}${age.slice(1)}.` : '',
    };
  }
  return {
    eve: clip(`Amanhã: ${entry.title}${entry.time ? ` às ${entry.time}` : ''}`, 180),
    today: clip(entry.time ? `Hoje às ${entry.time}: ${entry.title}` : `Hoje: ${entry.title}`, 180),
    body: clip([entry.who, entry.ride, entry.location, bringText(entry.bring)].filter(Boolean).join(' · '), 300),
  };
}

// ---------------------------------------------------------------------------
// Formulário

/** "16", "16h", "16:30", "16h30" ou "9.05" -> "16:00"…; null se não for um horário. */
export function parseTime(input: string): string | null {
  const match = input.trim().toLowerCase().replace(/\s+/g, '').match(/^(\d{1,2})(?:[:h.](\d{2}))?h?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? '0');
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** O formulário como a pessoa digitou. */
export interface EventForm {
  title: string;
  /** dd/mm/aaaa. */
  date: string;
  startTime: string;
  endTime: string;
  personId: string | null;
  takeBy: string | null;
  pickUpBy: string | null;
  location: string;
  bring: string;
  notes: string;
  recurrence: EventRecurrence;
  weekdays: number[];
  /** dd/mm/aaaa ou vazio (não acaba). */
  until: string;
}

export type EventFormResult = { ok: true; values: FamilyEventValues } | { ok: false; title: string; message: string };

const invalid = (title: string, message: string): EventFormResult => ({ ok: false, title, message });

/** Confere o formulário e devolve o que gravar, ou o aviso para a pessoa. */
export function validateEventForm(form: EventForm): EventFormResult {
  const title = form.title.trim();
  if (!title) return invalid('Confira os dados', 'Dê um nome ao compromisso.');
  if (title.length > EVENT_LIMITS.title) return invalid('Nome comprido demais', `O nome pode ter até ${EVENT_LIMITS.title} letras.`);
  const date = parseBRDate(form.date);
  if (!date) return invalid('Data inválida', 'Informe a data como dd/mm/aaaa.');

  const startTime = form.startTime.trim() ? parseTime(form.startTime) : null;
  const endTime = form.endTime.trim() ? parseTime(form.endTime) : null;
  if ((form.startTime.trim() && !startTime) || (form.endTime.trim() && !endTime)) {
    return invalid('Horário inválido', 'Use um horário como 16:00. Sem horário, o compromisso vale para o dia todo.');
  }
  if (endTime && !startTime) return invalid('Horário inválido', 'Para dizer a que horas termina, informe também a que horas começa.');
  if (startTime && endTime && endTime <= startTime) return invalid('Horário inválido', 'O fim precisa ser depois do começo.');

  const weekdays = [...new Set(form.weekdays)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b);
  if (form.recurrence === 'weekly' && !weekdays.length) return invalid('Confira os dados', 'Escolha pelo menos um dia da semana.');
  const repeats = form.recurrence !== 'none';
  const until = repeats && form.until.trim() ? parseBRDate(form.until) : null;
  if (repeats && form.until.trim() && !until) return invalid('Data inválida', 'Informe até quando repete como dd/mm/aaaa, ou deixe em branco.');
  if (until && until < date) return invalid('Data inválida', 'O "até" não pode ser antes da data do compromisso.');
  // Toda semana com fim: sem nenhum dos dias até lá, o compromisso nunca
  // apareceria (nem para ser apagado). A data digitada fica como está.
  if (form.recurrence === 'weekly' && until && !eventDatesIn({ starts_on: date, recurrence: 'weekly', weekdays, until_on: until }, date, until).length) {
    return invalid('Confira os dados', 'Nenhum dos dias escolhidos cai até essa data.');
  }

  const location = form.location.trim();
  const bring = form.bring.trim();
  const notes = form.notes.trim();
  if (location.length > EVENT_LIMITS.location) return invalid('Texto comprido demais', `O local pode ter até ${EVENT_LIMITS.location} letras.`);
  if (bring.length > EVENT_LIMITS.bring) return invalid('Texto comprido demais', `"O que levar" pode ter até ${EVENT_LIMITS.bring} letras.`);
  if (notes.length > EVENT_LIMITS.notes) return invalid('Texto comprido demais', `As observações podem ter até ${EVENT_LIMITS.notes} letras.`);

  return {
    ok: true,
    values: {
      title,
      starts_on: date,
      start_time: startTime,
      end_time: endTime,
      person_id: form.personId,
      take_by: form.takeBy,
      pick_up_by: form.pickUpBy,
      location: location || null,
      bring: bring || null,
      notes: notes || null,
      recurrence: form.recurrence,
      weekdays: form.recurrence === 'weekly' ? weekdays : null,
      until_on: until,
    },
  };
}

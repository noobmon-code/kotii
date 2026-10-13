// Avisos da casa por notificação: contas, documentos, tarefas (inclusive
// manutenções de aparelhos), consultas, compromissos da família e aniversários,
// vacinas e a dica do clima da manhã. Cada celular escolhe o que
// quer receber; o plano sai daqui e o app agenda (src/lib/reminders.ts),
// refazendo ao abrir, então a janela vai andando. À noite, o resumo de amanhã
// junta numa notificação só o que a casa tem no dia seguinte (eveSummary).

import type { Recurrence } from './chores';
import { addDays, diffDays, formatBRDate } from './dates';
import { describeDocumentStatus } from './documents';
import { bringText, calendarEntries, entryShortDetail, eventReminderTexts, type CalendarEntry, type FamilyCalendar } from './familyEvents';
import { weekdayOf } from './health';
import { formatBRL } from './money';
import type { WeatherMorning } from './weather';

export type HouseReminderKind = 'bills' | 'documents' | 'chores' | 'appointments' | 'events' | 'vaccines' | 'weather' | 'eve';

export const HOUSE_REMINDER_KINDS: { key: HouseReminderKind; label: string; hint: string }[] = [
  { key: 'bills', label: 'Contas a pagar', hint: 'Na véspera, no dia do vencimento e, se ficar em aberto, uma vez depois, às 9h' },
  { key: 'documents', label: 'Documentos', hint: 'Quando começa o prazo de renovar, uma semana antes e no dia em que vence, às 9h' },
  { key: 'chores', label: 'Tarefas e manutenções', hint: 'No dia marcado, às 9h' },
  { key: 'appointments', label: 'Consultas', hint: 'Na véspera, às 19h, e 2 horas antes' },
  {
    key: 'events',
    label: 'Compromissos e aniversários',
    hint: 'Na véspera, às 19h, e no dia, 1 hora antes do horário (sem horário, às 8h). Os de toda semana avisam só no dia',
  },
  { key: 'vaccines', label: 'Vacinas', hint: 'Uma semana antes da próxima dose e no dia, às 9h' },
  {
    key: 'weather',
    label: 'Dicas do clima',
    hint: 'Às 7h, quando o tempo pede algo: dia de lavar roupa, chuva, calor, frio, temporal. O bairro da casa se define no cartão do clima da tela Hoje',
  },
  {
    key: 'eve',
    label: 'Resumo de amanhã',
    hint: 'Toda noite, às 20h, o que a casa tem no dia seguinte: consultas, compromissos, aniversários, contas, tarefas, vacinas e documentos. Só quando há algo fora da rotina (o compromisso de toda semana e a tarefa de todo dia não entram). Com ele ligado, a consulta e o compromisso de amanhã vêm nele, no lugar do aviso das 19h',
  },
];

export interface HouseReminder {
  /** Tipo, item e dia: o mesmo aviso não é agendado duas vezes. */
  key: string;
  kind: HouseReminderKind;
  date: string;
  time: string;
  title: string;
  body: string;
  /** Aviso de atraso (conta ou vacina): qual atraso (overdueKey), para não avisar de novo depois que tocar. */
  overdue?: string;
}

export const HOUSE_REMINDER_TIME = '09:00';
/** Véspera da consulta: à noite, para organizar o dia seguinte. */
export const APPOINTMENT_EVE_TIME = '19:00';
const APPOINTMENT_LEAD_MINUTES = 120;
const EARLIEST_LEAD_MINUTES = 7 * 60;
/** Compromisso da família: na véspera à noite e uma hora antes; sem horário (e aniversário), de manhã. */
export const EVENT_EVE_TIME = APPOINTMENT_EVE_TIME;
const EVENT_LEAD_MINUTES = 60;
export const EVENT_ALL_DAY_TIME = '08:00';
/** Aviso do dia que toca antes disto é de madrugada: a rotina mantém o da véspera, e o resumo de amanhã diz o local e o que levar. */
const EVENT_EARLY_TIME = '07:00';
const VACCINE_LEAD_DAYS = 7;
/** Vacina atrasada há mais que isso provavelmente foi tomada sem registrar: sem aviso. */
const VACCINE_OVERDUE_DAYS = 60;
export const HOUSE_REMINDER_HORIZON_DAYS = 30;
/** O iPhone guarda até 64 notificações agendadas por app. */
export const SCHEDULED_NOTIFICATIONS_LIMIT = 64;
/** Teto dos avisos da casa; o resto fica para os remédios. */
export const HOUSE_REMINDER_LIMIT = 24;
/** Além de quando abre o prazo, um lembrete de renovar uma semana antes. */
export const RENEW_NUDGE_DAYS = 7;
/** Resumo de amanhã: à noite, o que a casa tem no dia seguinte, numa notificação só. */
export const EVE_SUMMARY_TIME = '20:00';
/** Quantas noites ficam agendadas, a partir de hoje (a janela anda a cada sincronização). */
export const EVE_SUMMARY_DAYS = 7;
/** Para ler na tela de bloqueio: até 4 itens escritos (com mais, 3 e "e mais N") e 180 caracteres. */
const EVE_SUMMARY_ITEMS = 4;
const EVE_SUMMARY_LENGTH = 180;
/**
 * Tarefa "diária" a cada tantos dias ainda é rotina: no resumo, tocaria toda
 * noite (ou noite sim, noite não) sem dizer nada de novo. Fica fora dele.
 */
const EVE_ROUTINE_DAYS = 3;
/** Do local da consulta (ou do compromisso) cedo cabe pelo menos isto (a vírgula e o começo do nome), ou ele não entra. */
const EVE_PLACE_MIN = 8;
/** Do que levar no compromisso cedo cabe pelo menos isto (o "Levar:" e o começo da lista), ou ele não entra. */
const EVE_BRING_MIN = 15;
/** Do título cortado ficam pelo menos estas letras (fora a hora e o "…"); sem isso, o parêntese do compromisso não fica à parte (ver fitItems). */
const EVE_TITLE_MIN = 12;
/** Depois de qualquer hora do dia, na fila do teto (ver o fim de planHouseReminders). */
const END_OF_DAY = '24:00';

/** A conta sem valor no resumo: só o nome não diria que é uma conta ("Conta: Condomínio"), a não ser que ele já diga ("Conta de luz"). */
const billName = (name: string) => (/^contas?\b/i.test(name.trim()) ? name : `Conta: ${name}`);

export interface HouseReminderInput {
  kinds: Record<HouseReminderKind, boolean>;
  bills: { id: string; name: string; amount: number | null; next_due_on: string; active: boolean; autopay: boolean }[];
  documents: { id: string; title: string; expires_on: string | null; remind_days: number }[];
  /** A repetição só importa para o resumo de amanhã: tarefa de todo dia fica fora dele. */
  chores: {
    id: string;
    title: string;
    due_on: string;
    active: boolean;
    equipment_id: string | null;
    recurrence?: Recurrence;
    interval_count?: number;
  }[];
  /** Consultas agendadas, com data e hora locais já separadas. */
  appointments?: { id: string; title: string; person: string; date: string; time: string; location: string | null; status: string }[];
  vaccines?: { id: string; name: string; dose: string | null; person: string; next_dose_on: string | null }[];
  /** Compromissos da família com as mudanças de cada dia, e as fichas (nomes e aniversários). */
  family?: FamilyCalendar;
  /** A dica mais importante de cada manhã (ver weatherMornings). */
  weather?: WeatherMorning[];
  /** Aparelhos, pela garantia que acaba (só o resumo de amanhã usa). */
  equipment?: { id: string; name: string; warranty_until: string | null }[];
  today: string;
  /** HH:MM de agora: aviso de hoje só se o horário ainda não passou. */
  nowTime: string;
  /** Quantos avisos cabem (o que os remédios deixam do teto do iPhone); padrão HOUSE_REMINDER_LIMIT. */
  limit?: number;
  /** Atrasos (de conta ou vacina) já avisados neste aparelho (overdueKey): não avisam de novo. */
  overdueWarned?: string[];
}

/**
 * A ordem dos itens no resumo de amanhã: primeiro o que tem hora, consultas e
 * compromissos juntos (ver eveItems); depois, fonte por fonte. Uma fonte nova
 * de itens entra aqui, em EveSummaryInput e em eveItems.
 */
const EVE_ORDER = ['appointments', 'events', 'birthdays', 'bills', 'vaccines', 'chores', 'documents', 'equipment'] as const;

export interface EveItem {
  source: (typeof EVE_ORDER)[number];
  /** O item de origem (a consulta, a conta…); no compromisso, ele e o dia (occurrenceId). */
  id: string;
  text: string;
  /** A hora (da consulta, do compromisso), para a ordem; sem ela, vazio, e a ordem é pelo texto. */
  sort: string;
  /**
   * No compromisso, o parêntese que `text` já traz no fim (de quem é, quem leva
   * e busca): quando falta espaço, é o título que encolhe, e ele fica inteiro.
   */
  detail?: string;
  /** O local da consulta ou do compromisso cedo: vai depois do texto, e é o primeiro a encolher quando falta espaço. */
  place?: string;
  /** O que levar no compromisso cedo ("Levar: …"): depois do local, com o que sobrar. */
  bring?: string;
}

export interface EveSummary {
  title: string;
  body: string;
  /** Tudo o que o dia tem, na ordem do resumo. */
  items: EveItem[];
  /** Quantos itens o texto traz escritos; os outros ficam no "e mais N". */
  written: number;
}

type EveSummaryInput = Pick<HouseReminderInput, 'bills' | 'documents' | 'chores' | 'appointments' | 'vaccines' | 'family' | 'equipment'>;

const WEEKDAY_NAMES = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

/** "09:00" vira "9h"; "14:30", "14h30". */
function shortTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  return `${h}h${m ? String(m).padStart(2, '0') : ''}`;
}

/**
 * A hora do aviso de 2 horas antes da consulta. null quando cairia de
 * madrugada: consulta cedo fica só com a véspera.
 */
function appointmentLeadTime(time: string): string | null {
  const [h, m] = time.split(':').map(Number);
  const lead = h * 60 + m - APPOINTMENT_LEAD_MINUTES;
  if (lead < EARLIEST_LEAD_MINUTES) return null;
  return `${String(Math.floor(lead / 60)).padStart(2, '0')}:${String(lead % 60).padStart(2, '0')}`;
}

/**
 * As vacinas do dia, um item por pessoa: várias da mesma pessoa vão juntas
 * ("Vacinas de Bia: Hepatite A e Tríplice"), para o nome não se repetir.
 * "De Bia", porque "da Bia" ou "do Beto" seria adivinhar.
 */
function eveVaccines(vaccines: NonNullable<EveSummaryInput['vaccines']>, day: string): Pick<EveItem, 'id' | 'text'>[] {
  const byPerson = new Map<string, { id: string; name: string }[]>();
  for (const v of vaccines) {
    if (v.next_dose_on !== day) continue;
    byPerson.set(v.person, [...(byPerson.get(v.person) ?? []), { id: v.id, name: v.dose ? `${v.name} (${v.dose})` : v.name }]);
  }
  return [...byPerson].map(([person, doses]) => {
    // Pelo nome, como os itens: a ordem em que os dados chegam não muda o texto.
    const names = doses.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.id.localeCompare(b.id)).map((d) => d.name);
    const listed = names.length > 1 ? `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}` : names[0];
    return { id: doses.map((d) => d.id).join('+'), text: `${names.length > 1 ? 'Vacinas' : 'Vacina'}${person ? ` de ${person}` : ''}: ${listed}` };
  });
}

/** O compromisso e o dia: a vez de um dia não se confunde com a de outro, nos avisos e no resumo que a leva. */
const occurrenceId = (entry: Pick<CalendarEntry, 'id' | 'date'>) => `${entry.id}@${entry.date}`;

/**
 * Os compromissos e os aniversários do dia: "16h Festa do João (Ana, Carla
 * leva)", "Aniversário de Ana (faz 8 anos)". A rotina (a vez de toda semana
 * com quem leva e quem busca de sempre) fica de fora, como a tarefa de todo
 * dia: faria o resumo tocar toda noite sem dizer nada de novo. Dia marcado
 * como "não vai ter" não vem, e quem leva ou busca é o daquele dia.
 */
function eveFamily(family: FamilyCalendar, day: string): EveItem[] {
  return calendarEntries(family, day, day)
    .filter((entry) => !entry.routine)
    .map((entry) => {
      const birthday = entry.kind === 'aniversario';
      const detail = entryShortDetail(entry);
      // O compromisso sem aviso no dia (antes da 1h), ou com ele de madrugada,
      // contava com a véspera das 19h para dizer onde é e o que levar. O
      // resumo fica no lugar dela: os dois vão aqui, como o local da consulta cedo.
      const at = eventDayTime(entry.time);
      const early = !birthday && (at === null || at < EVENT_EARLY_TIME);
      const bring = early ? bringText(entry.bring) : null;
      return {
        source: birthday ? ('birthdays' as const) : ('events' as const),
        id: birthday ? entry.id : occurrenceId(entry),
        text: `${entry.time ? `${shortTime(entry.time)} ` : ''}${entry.title}${detail ? ` (${detail})` : ''}`,
        sort: entry.time ?? '',
        // Só o parêntese do compromisso fica à parte: no aniversário, a idade encolhe antes do nome.
        ...(detail && !birthday ? { detail } : {}),
        ...(early && entry.location ? { place: entry.location } : {}),
        ...(bring ? { bring } : {}),
      };
    });
}

/**
 * O que a casa tem em `day`, na ordem do resumo. Só datas que os dados já
 * têm: as repetições que a Agenda mostra como previsão não entram (as dos
 * compromissos da família, sim: as datas deles saem da regra).
 */
function eveItems(input: EveSummaryInput, day: string): EveItem[] {
  const item = (source: EveItem['source'], id: string, text: string, sort = ''): EveItem => ({ source, id, text, sort });
  const items = [
    ...(input.appointments ?? [])
      .filter((a) => a.status === 'agendada' && a.date === day)
      .map((a) => ({
        ...item('appointments', a.id, `${shortTime(a.time)} ${a.title}${a.person ? ` (${a.person})` : ''}`, a.time),
        // A consulta cedo não tem o aviso de 2 horas antes, que diria onde é: o local vai aqui.
        ...(a.location && !appointmentLeadTime(a.time) ? { place: a.location } : {}),
      })),
    ...(input.family ? eveFamily(input.family, day) : []),
    // Débito automático não precisa de ninguém, como nos avisos de conta. Sem
    // o valor, só o nome não diria que é uma conta.
    ...input.bills
      .filter((b) => b.active && !b.autopay && b.next_due_on === day)
      .map((b) => item('bills', b.id, b.amount != null ? `${b.name} (${formatBRL(b.amount)})` : billName(b.name))),
    ...eveVaccines(input.vaccines ?? [], day).map((v) => item('vaccines', v.id, v.text)),
    // Tarefa de todo dia (ou quase: ver EVE_ROUTINE_DAYS) faria o resumo tocar toda noite sem dizer nada de novo.
    ...input.chores
      .filter((c) => c.active && c.due_on === day && !(c.recurrence === 'daily' && (c.interval_count ?? 1) <= EVE_ROUTINE_DAYS))
      .map((c) => item('chores', c.id, c.equipment_id ? `Manutenção: ${c.title}` : c.title)),
    ...input.documents.filter((d) => d.expires_on === day).map((d) => item('documents', d.id, `Vence: ${d.title}`)),
    ...(input.equipment ?? []).filter((e) => e.warranty_until === day).map((e) => item('equipment', e.id, `Fim da garantia: ${e.name}`)),
  ];
  const order = (i: EveItem) => EVE_ORDER.indexOf(i.source);
  // O que tem hora vem primeiro, consultas e compromissos juntos, pela hora (na
  // mesma hora, a consulta antes); depois os compromissos sem horário, os
  // aniversários e o resto, fonte por fonte.
  const turn = (i: EveItem) => (i.source === 'appointments' || i.sort ? 0 : order(i));
  return items.sort(
    (a, b) =>
      turn(a) - turn(b) ||
      a.sort.localeCompare(b.sort) ||
      order(a) - order(b) ||
      a.text.localeCompare(b.text, 'pt-BR') ||
      a.id.localeCompare(b.id),
  );
}

/**
 * Corta com "…" os textos mais compridos até a soma caber em `room`. Os
 * curtos ficam inteiros: um título longo não toma o lugar dos outros itens.
 */
function fitTexts(texts: string[], room: number): string[] {
  const total = (max: number) => texts.reduce((sum, text) => sum + Math.min(text.length, max), 0);
  let max = Math.max(...texts.map((text) => text.length));
  while (max > 1 && total(max) > room) max -= 1;
  return texts.map((text) => shorten(text, max));
}

/**
 * Os textos dos itens escritos, cabendo em `room`. O parêntese do compromisso
 * (de quem é, quem leva e busca) fica à parte, inteiro: quem divide o espaço,
 * e encolhe, são os títulos (o item sem parêntese é só título). Quando de um
 * título cortado sobrariam menos de EVE_TITLE_MIN letras, o parêntese desse
 * item volta para o texto e o corte dele é o de sempre, no fim.
 */
function fitItems(items: EveItem[], room: number): string[] {
  // As letras do título que ficaram no item cortado: sem a hora da frente e sem o "…".
  const kept = (item: EveItem, cut: string) => cut.length - 1 - (item.sort ? shortTime(item.sort).length + 1 : 0);
  let apart = items.map((item) => !!item.detail);
  for (;;) {
    const tails = items.map((item, i) => (apart[i] ? ` (${item.detail})` : ''));
    const heads = items.map((item, i) => item.text.slice(0, item.text.length - tails[i].length));
    const fitted = fitTexts(heads, room - tails.join('').length);
    const texts = fitted.map((head, i) => head + tails[i]);
    const short = items.map((item, i) => fitted[i] !== heads[i] && kept(item, fitted[i]) < EVE_TITLE_MIN);
    // Os parênteses sozinhos já não cabem (títulos de uma letra não têm o que cortar).
    const over = texts.join('').length > room;
    if (!apart.some(Boolean) || (!over && !short.some(Boolean))) return texts;
    // Volta ao corte de sempre o compromisso cujo título ficou curto demais. Se
    // quem ficou sem espaço foi só um item sem parêntese à parte, voltam todos:
    // nenhum item some para o parêntese de outro ficar inteiro.
    const back = !over && short.some((s, i) => s && apart[i]) ? short : apart;
    apart = apart.map((a, i) => a && !back[i]);
  }
}

/**
 * O texto em até `max` caracteres, com "…" no fim se foi cortado. O corte não
 * parte um emoji ao meio, nem deixa antes do "…" uma vírgula solta ou um
 * parêntese recém-aberto (" (", " (A", " (An").
 */
function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const loose = (cut: string) => cut.replace(/[\s,]+$/, '');
  // O parêntese que mal abriu sai, com o espaço ou a vírgula que ficarem soltos antes dele.
  return `${loose(loose(text.slice(0, max - 1).replace(/[\uD800-\uDBFF]$/, '')).replace(/\([^()]{0,2}$/, ''))}…`;
}

/**
 * O resumo do dia `day`, para tocar na noite anterior: título, texto e os
 * itens. null quando o dia não tem nada (aquela noite fica sem aviso).
 */
export function eveSummary(input: EveSummaryInput, day: string): EveSummary | null {
  const items = eveItems(input, day);
  if (!items.length) return null;
  const written = items.length > EVE_SUMMARY_ITEMS ? EVE_SUMMARY_ITEMS - 1 : items.length;
  const more = items.length > written ? ` e mais ${items.length - written}` : '';
  const separator = ' · ';
  const shown = items.slice(0, written);
  const room = EVE_SUMMARY_LENGTH - more.length - separator.length * (written - 1);
  const texts = fitItems(shown, room);
  // O local da consulta cedo, e o local e o que levar do compromisso cedo,
  // ficam com o espaço que os itens deixam: inteiros, cortados ou, se sobra
  // pouco, fora. Nenhum item encolhe por causa deles.
  let left = room - texts.reduce((sum, text) => sum + text.length, 0);
  const fit = (piece: string, min: number) => {
    const fitted = piece.length <= left || left >= min ? shorten(piece, left) : '';
    left -= fitted.length;
    return fitted;
  };
  const parts = shown.map((item, i) => {
    const place = item.place ? `, ${item.place}` : '';
    const fitted = fit(place, EVE_PLACE_MIN);
    const text = texts[i] + fitted;
    // O que levar só vem depois do local inteiro; o ponto não se repete depois de um texto que já termina com pontuação.
    if (!item.bring || fitted !== place) return text;
    return text + fit(`${/[.!?…]$/.test(text) ? '' : '.'} ${item.bring}`, EVE_BRING_MIN);
  });
  return { title: `Amanhã, ${WEEKDAY_NAMES[weekdayOf(day)]}`, body: parts.join(separator) + more, items, written };
}

/** Identifica um atraso: pagar a conta (ou registrar a dose) muda a data, e o atraso novo avisa de novo. */
export const overdueKey = (id: string, since: string) => `${id}:${since}`;

/** A hora do aviso no dia do compromisso: uma hora antes (sem horário, às 8h); antes da 1h da manhã não há (fica só a véspera). */
function eventDayTime(time: string | null): string | null {
  if (!time) return EVENT_ALL_DAY_TIME;
  const [h, m] = time.split(':').map(Number);
  const lead = h * 60 + m - EVENT_LEAD_MINUTES;
  return lead >= 0 ? `${String(Math.floor(lead / 60)).padStart(2, '0')}:${String(lead % 60).padStart(2, '0')}` : null;
}

export function planHouseReminders(input: HouseReminderInput): HouseReminder[] {
  const { kinds, today, nowTime } = input;
  const last = addDays(today, HOUSE_REMINDER_HORIZON_DAYS);
  const time = HOUSE_REMINDER_TIME;
  const upcoming = (date: string, at = time) => date <= last && (date > today || (date === today && at > nowTime));
  // Atrasado: no próximo horário (hoje, se ainda dá; senão amanhã).
  const nextSlot = time > nowTime ? today : addDays(today, 1);
  const warned = new Set(input.overdueWarned ?? []);
  const out: HouseReminder[] = [];
  const keyOf = (kind: HouseReminderKind, id: string, date: string, at = time) => `${kind}:${id}:${date}${at === time ? '' : `:${at}`}`;
  const add = (
    kind: HouseReminderKind,
    id: string,
    date: string,
    title: string,
    body: string,
    { at = time, overdue }: { at?: string; overdue?: string } = {},
  ) => {
    if (!upcoming(date, at)) return null;
    const key = keyOf(kind, id, date, at);
    out.push({ key, kind, date, time: at, title, body, ...(overdue ? { overdue } : {}) });
    return key;
  };
  // Atraso: só quando este aparelho o vê (sem aviso marcado de antemão, que
  // tocaria mesmo se alguém já tivesse resolvido), e uma vez.
  const addOverdue = (kind: HouseReminderKind, id: string, since: string, title: string, body: string) => {
    const overdue = overdueKey(id, since);
    if (!warned.has(overdue)) add(kind, id, nextSlot, title, body, { overdue });
  };

  // Resumo de amanhã: uma noite para cada um dos próximos dias que têm algo
  // (hoje, só se ainda não deu a hora). A consulta escrita num resumo fica sem
  // o "Consulta amanhã" dela, e o compromisso, sem o "Amanhã: …" dele: uma
  // notificação à noite, e não duas. O que não está em nenhum (véspera além
  // dessas noites, ou só no "e mais N") mantém o aviso próprio.
  // `carried`: a consulta ou o compromisso (com a fonte na frente, para um não
  // se passar pelo outro) e o resumo (a chave dele) que o leva escrito.
  const carried = new Map<string, string>();
  const carriedKey = (source: 'appointments' | 'events', id: string) => `${source}:${id}`;
  if (kinds.eve) {
    for (let i = 0; i < EVE_SUMMARY_DAYS; i++) {
      const evening = addDays(today, i);
      const summary = eveSummary(input, addDays(evening, 1));
      const key = summary && add('eve', 'amanha', evening, summary.title, summary.body, { at: EVE_SUMMARY_TIME });
      if (!key) continue;
      for (const item of summary.items.slice(0, summary.written)) {
        if (item.source === 'appointments' || item.source === 'events') carried.set(carriedKey(item.source, item.id), key);
      }
    }
  }
  // Resumos que estão no lugar de um aviso de véspera das 19h (ver o teto, no fim): de um "Consulta amanhã"…
  const standIn = new Set<string>();
  // …e de um "Amanhã: …" de compromisso, com a chave da primeira véspera que substituem (a vez deles na parte dos compromissos).
  const forEvents = new Map<string, string>();

  if (kinds.bills) {
    for (const bill of input.bills) {
      // Débito automático não precisa de ninguém: sem aviso.
      if (!bill.active || bill.autopay) continue;
      const value = bill.amount != null ? ` — ${formatBRL(bill.amount)}` : '';
      if (bill.next_due_on < today) {
        addOverdue('bills', bill.id, bill.next_due_on, 'Conta atrasada', `${bill.name}${value}: venceu em ${formatBRDate(bill.next_due_on)}.`);
        continue;
      }
      add('bills', bill.id, addDays(bill.next_due_on, -1), 'Conta vence amanhã', `${bill.name}${value}`);
      add('bills', bill.id, bill.next_due_on, 'Conta vence hoje', `${bill.name}${value}`);
    }
  }

  if (kinds.documents) {
    for (const doc of input.documents) {
      const expiresOn = doc.expires_on;
      if (!expiresOn || expiresOn < today) continue;
      // Quando abre o prazo e uma semana antes: quem ligou o aviso (ou cadastrou
      // o documento) já dentro do prazo ainda recebe um lembrete antes do dia.
      const leads = [...new Set([doc.remind_days, RENEW_NUDGE_DAYS])].filter((d) => d > 0 && d <= doc.remind_days);
      for (const days of leads) {
        const when = describeDocumentStatus({ kind: 'renovar', days }, expiresOn).toLowerCase();
        add('documents', doc.id, addDays(expiresOn, -days), 'Hora de renovar', `${doc.title} ${when} (${formatBRDate(expiresOn)}).`);
      }
      add('documents', doc.id, expiresOn, 'Documento vence hoje', doc.title);
    }
  }

  if (kinds.chores) {
    for (const chore of input.chores) {
      if (!chore.active) continue;
      add('chores', chore.id, chore.due_on, chore.equipment_id ? 'Manutenção de hoje' : 'Tarefa de hoje', chore.title);
    }
  }

  if (kinds.appointments) {
    for (const a of input.appointments ?? []) {
      if (a.status !== 'agendada') continue;
      const where = a.location ? ` (${a.location})` : '';
      const body = `${a.title} — ${a.person}, às ${a.time}${where}.`;
      const summary = carried.get(carriedKey('appointments', a.id));
      if (summary) standIn.add(summary);
      else add('appointments', a.id, addDays(a.date, -1), 'Consulta amanhã', body, { at: APPOINTMENT_EVE_TIME });
      // Duas horas antes, mas não de madrugada: consulta cedo fica só com a véspera.
      const at = appointmentLeadTime(a.time);
      if (at) add('appointments', a.id, a.date, 'Consulta daqui a 2 horas', body, { at });
    }
  }

  if (kinds.events && input.family) {
    // Até o dia seguinte ao fim da janela: a véspera dele ainda cabe. Dia
    // marcado como "não vai ter" não vem, e quem leva ou busca é o daquele dia.
    for (const entry of calendarEntries(input.family, today, addDays(last, 1))) {
      const texts = eventReminderTexts(entry);
      // Compromisso e dia: a véspera de uma vez não se confunde com o aviso da vez anterior.
      const id = occurrenceId(entry);
      const at = eventDayTime(entry.time);
      // A rotina (toda semana, com quem leva e quem busca de sempre) avisa só
      // no dia: véspera toda noite vira barulho. Sem aviso no dia, ou com ele de
      // madrugada (antes das 7h, quando ninguém vê), a véspera fica.
      const dayOnly = entry.routine && at !== null && at >= EVENT_EARLY_TIME;
      // Escrito no resumo daquela noite, a véspera é ele (o aniversário não tem véspera, e a rotina não vai no
      // resumo). Do compromisso cedo, ele diz também o local e o que levar, que a véspera diria (ver eveFamily).
      const summary = entry.kind === 'compromisso' ? carried.get(carriedKey('events', id)) : undefined;
      const eve = addDays(entry.date, -1);
      if (summary) {
        const key = keyOf('events', id, eve, EVENT_EVE_TIME);
        const first = forEvents.get(summary);
        if (!first || key.localeCompare(first) < 0) forEvents.set(summary, key);
      } else if (texts.eve && !dayOnly) add('events', id, eve, texts.eve, texts.body, { at: EVENT_EVE_TIME });
      if (at) add('events', id, entry.date, texts.today, texts.body, { at });
    }
  }

  if (kinds.vaccines) {
    for (const v of input.vaccines ?? []) {
      if (!v.next_dose_on) continue;
      const name = v.dose ? `${v.name} (${v.dose})` : v.name;
      if (v.next_dose_on < today) {
        if (diffDays(v.next_dose_on, today) <= VACCINE_OVERDUE_DAYS) {
          addOverdue('vaccines', v.id, v.next_dose_on, 'Vacina atrasada', `${v.person}: ${name} era para ${formatBRDate(v.next_dose_on)}.`);
        }
        continue;
      }
      add('vaccines', v.id, addDays(v.next_dose_on, -VACCINE_LEAD_DAYS), 'Vacina na semana que vem', `${v.person}: ${name} em ${formatBRDate(v.next_dose_on)}.`);
      add('vaccines', v.id, v.next_dose_on, 'Dia de vacina', `${v.person}: ${name}.`);
    }
  }

  if (kinds.weather) {
    for (const morning of input.weather ?? []) {
      add('weather', 'dia', morning.date, morning.title, morning.body, { at: morning.time });
    }
  }

  const limit = Math.max(0, input.limit ?? HOUSE_REMINDER_LIMIT);
  const soonest = (a: HouseReminder, b: HouseReminder) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.key.localeCompare(b.key);
  // A vez de cada um na fila do teto (várias casas, muitos remédios): os avisos
  // próprios, pela hora em que tocam. O resumo de uma noite entra logo depois
  // de todos os avisos próprios até o dia de que ele fala (o seguinte) e antes
  // dos de depois: não toma a vaga de um aviso daquele dia nem dos anteriores,
  // e os das noites mais distantes saem primeiro. O custo: com ele ligado, um
  // aviso próprio de dois ou mais dias adiante pode esperar a janela andar (o
  // plano é refeito a cada vez que o app abre). O resumo que está no lugar de
  // um aviso de véspera (de consulta ou de compromisso) vale como o aviso que
  // substitui, na vez dele: às 19h daquela noite (o da consulta, antes de
  // qualquer outro das 19h; o que é só de compromissos, onde estaria a véspera).
  const placed = (r: HouseReminder) => {
    if (r.kind !== 'eve') return r;
    if (standIn.has(r.key)) return { ...r, time: APPOINTMENT_EVE_TIME, key: '' };
    const eve = forEvents.get(r.key);
    if (eve) return { ...r, time: EVENT_EVE_TIME, key: eve };
    return { ...r, date: addDays(r.date, 1), time: END_OF_DAY };
  };
  const plain = (r: HouseReminder) => r.kind === 'eve' && !standIn.has(r.key) && !forEvents.has(r.key);
  // Os compromissos têm a sua parte do teto: uma rotina dá aviso quase todo
  // dia e, sozinha, tomaria as vagas das contas e dos documentos. Ficam com
  // metade, ou com as vagas que os outros tipos não usam, se forem mais. O
  // resumo comum de uma noite não entra nessa conta (a vez dele é a da fila):
  // senão o de uma noite distante tiraria a vaga de um compromisso de antes.
  // O resumo que está só no lugar de vésperas de compromissos conta nela, na
  // vez da véspera que substitui: a parte é a mesma de quem não usa o resumo.
  // O que passa dela: o aviso de compromisso sai, como sempre; o resumo fica,
  // mas como um resumo comum (desligado, a véspera que ele leva também não
  // caberia: ali não há aviso para ele substituir).
  const inTurn = (a: HouseReminder, b: HouseReminder) => soonest(placed(a), placed(b));
  const ofEvents = (r: HouseReminder) => r.kind === 'events' || (forEvents.has(r.key) && !standIn.has(r.key));
  const own = out.filter((r) => !ofEvents(r) && !plain(r)).length;
  const beyond = new Set(out.filter(ofEvents).sort(inTurn).slice(Math.max(Math.ceil(limit / 2), limit - own)));
  for (const r of beyond) forEvents.delete(r.key);
  const turn = out.filter((r) => r.kind === 'eve' || !beyond.has(r)).sort(inTurn);
  // Ligar o resumo não tira a véspera de ninguém por causa de um resumo comum:
  // os resumos que estão no lugar de uma véspera e caberiam sem resumo comum
  // nenhum (é quando o "Consulta amanhã", ou o "Amanhã: …" do compromisso,
  // caberia com o resumo desligado) têm de ficar. Enquanto um deles estiver
  // de fora, sai o resumo comum da noite mais distante e o corte é refeito.
  const owed = turn
    .filter((r) => !plain(r))
    .slice(0, limit)
    .filter((r) => r.kind === 'eve');
  let queue = turn;
  for (;;) {
    const kept = queue.slice(0, limit);
    const farthest = kept.filter(plain).at(-1);
    if (!farthest || owed.every((r) => kept.includes(r))) return kept.sort(soonest);
    queue = queue.filter((r) => r !== farthest);
  }
}

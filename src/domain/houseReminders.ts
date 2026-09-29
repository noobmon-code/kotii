// Avisos da casa por notificação: contas, documentos, tarefas (inclusive
// manutenções de aparelhos), consultas, vacinas e a dica do clima da manhã. Cada celular escolhe o que
// quer receber; o plano sai daqui e o app agenda (src/lib/reminders.ts),
// refazendo ao abrir, então a janela vai andando.

import { addDays, diffDays, formatBRDate } from './dates';
import { describeDocumentStatus } from './documents';
import { formatBRL } from './money';
import { WEATHER_REMINDER_TIME, type WeatherMorning } from './weather';

export type HouseReminderKind = 'bills' | 'documents' | 'chores' | 'appointments' | 'vaccines' | 'weather';

export const HOUSE_REMINDER_KINDS: { key: HouseReminderKind; label: string; hint: string }[] = [
  { key: 'bills', label: 'Contas a pagar', hint: 'Na véspera, no dia do vencimento e, se ficar em aberto, uma vez depois, às 9h' },
  { key: 'documents', label: 'Documentos', hint: 'Quando começa o prazo de renovar, uma semana antes e no dia em que vence, às 9h' },
  { key: 'chores', label: 'Tarefas e manutenções', hint: 'No dia marcado, às 9h' },
  { key: 'appointments', label: 'Consultas', hint: 'Na véspera, às 19h, e 2 horas antes' },
  { key: 'vaccines', label: 'Vacinas', hint: 'Uma semana antes da próxima dose e no dia, às 9h' },
  {
    key: 'weather',
    label: 'Dicas do clima',
    hint: 'Às 7h, quando o tempo pede algo: dia de lavar roupa, chuva, calor, frio, temporal. O bairro da casa se define no cartão do clima da tela Hoje',
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

export interface HouseReminderInput {
  kinds: Record<HouseReminderKind, boolean>;
  bills: { id: string; name: string; amount: number | null; next_due_on: string; active: boolean; autopay: boolean }[];
  documents: { id: string; title: string; expires_on: string | null; remind_days: number }[];
  chores: { id: string; title: string; due_on: string; active: boolean; equipment_id: string | null }[];
  /** Consultas agendadas, com data e hora locais já separadas. */
  appointments?: { id: string; title: string; person: string; date: string; time: string; location: string | null; status: string }[];
  vaccines?: { id: string; name: string; dose: string | null; person: string; next_dose_on: string | null }[];
  /** A dica mais importante de cada manhã (ver weatherMornings). */
  weather?: WeatherMorning[];
  today: string;
  /** HH:MM de agora: aviso de hoje só se o horário ainda não passou. */
  nowTime: string;
  /** Quantos avisos cabem (o que os remédios deixam do teto do iPhone); padrão HOUSE_REMINDER_LIMIT. */
  limit?: number;
  /** Atrasos (de conta ou vacina) já avisados neste aparelho (overdueKey): não avisam de novo. */
  overdueWarned?: string[];
}

/** Identifica um atraso: pagar a conta (ou registrar a dose) muda a data, e o atraso novo avisa de novo. */
export const overdueKey = (id: string, since: string) => `${id}:${since}`;

export function planHouseReminders(input: HouseReminderInput): HouseReminder[] {
  const { kinds, today, nowTime } = input;
  const last = addDays(today, HOUSE_REMINDER_HORIZON_DAYS);
  const time = HOUSE_REMINDER_TIME;
  const upcoming = (date: string, at = time) => date <= last && (date > today || (date === today && at > nowTime));
  // Atrasado: no próximo horário (hoje, se ainda dá; senão amanhã).
  const nextSlot = time > nowTime ? today : addDays(today, 1);
  const warned = new Set(input.overdueWarned ?? []);
  const out: HouseReminder[] = [];
  const add = (
    kind: HouseReminderKind,
    id: string,
    date: string,
    title: string,
    body: string,
    { at = time, overdue }: { at?: string; overdue?: string } = {},
  ) => {
    if (!upcoming(date, at)) return;
    const key = `${kind}:${id}:${date}${at === time ? '' : `:${at}`}`;
    out.push({ key, kind, date, time: at, title, body, ...(overdue ? { overdue } : {}) });
  };
  // Atraso: só quando este aparelho o vê (sem aviso marcado de antemão, que
  // tocaria mesmo se alguém já tivesse resolvido), e uma vez.
  const addOverdue = (kind: HouseReminderKind, id: string, since: string, title: string, body: string) => {
    const overdue = overdueKey(id, since);
    if (!warned.has(overdue)) add(kind, id, nextSlot, title, body, { overdue });
  };

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
      add('appointments', a.id, addDays(a.date, -1), 'Consulta amanhã', body, { at: APPOINTMENT_EVE_TIME });
      // Duas horas antes, mas não de madrugada: consulta cedo fica só com a véspera.
      const [h, m] = a.time.split(':').map(Number);
      const lead = h * 60 + m - APPOINTMENT_LEAD_MINUTES;
      if (lead >= EARLIEST_LEAD_MINUTES) {
        const at = `${String(Math.floor(lead / 60)).padStart(2, '0')}:${String(lead % 60).padStart(2, '0')}`;
        add('appointments', a.id, a.date, 'Consulta daqui a 2 horas', body, { at });
      }
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
      add('weather', 'dia', morning.date, morning.title, morning.body, { at: WEATHER_REMINDER_TIME });
    }
  }

  return out
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.key.localeCompare(b.key))
    .slice(0, Math.max(0, input.limit ?? HOUSE_REMINDER_LIMIT));
}

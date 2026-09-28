// Avisos da casa por notificação: contas, documentos e tarefas (inclusive
// manutenções de aparelhos). Cada celular escolhe o que quer receber; o
// plano sai daqui e o app agenda (src/lib/reminders.ts), refazendo ao
// abrir, então a janela vai andando.

import { addDays, formatBRDate } from './dates';
import { describeDocumentStatus } from './documents';
import { formatBRL } from './money';

export type HouseReminderKind = 'bills' | 'documents' | 'chores';

export const HOUSE_REMINDER_KINDS: { key: HouseReminderKind; label: string; hint: string }[] = [
  { key: 'bills', label: 'Contas a pagar', hint: 'Na véspera, no dia do vencimento e, se ficar em aberto, no dia seguinte' },
  { key: 'documents', label: 'Documentos', hint: 'Quando começa o prazo de renovar, uma semana antes e no dia em que vence' },
  { key: 'chores', label: 'Tarefas e manutenções', hint: 'No dia marcado' },
];

export interface HouseReminder {
  /** Tipo, item e dia: o mesmo aviso não é agendado duas vezes. */
  key: string;
  kind: HouseReminderKind;
  date: string;
  time: string;
  title: string;
  body: string;
}

export const HOUSE_REMINDER_TIME = '09:00';
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
  today: string;
  /** HH:MM de agora: aviso de hoje só se o horário ainda não passou. */
  nowTime: string;
  /** Quantos avisos cabem (o que os remédios deixam do teto do iPhone); padrão HOUSE_REMINDER_LIMIT. */
  limit?: number;
}

export function planHouseReminders(input: HouseReminderInput): HouseReminder[] {
  const { kinds, today, nowTime } = input;
  const last = addDays(today, HOUSE_REMINDER_HORIZON_DAYS);
  const time = HOUSE_REMINDER_TIME;
  const upcoming = (date: string) => date <= last && (date > today || (date === today && time > nowTime));
  const out: HouseReminder[] = [];
  const add = (kind: HouseReminderKind, id: string, date: string, title: string, body: string) => {
    if (upcoming(date)) out.push({ key: `${kind}:${id}:${date}`, kind, date, time, title, body });
  };

  if (kinds.bills) {
    for (const bill of input.bills) {
      // Débito automático não precisa de ninguém: sem aviso.
      if (!bill.active || bill.autopay) continue;
      const value = bill.amount != null ? ` — ${formatBRL(bill.amount)}` : '';
      add('bills', bill.id, addDays(bill.next_due_on, -1), 'Conta vence amanhã', `${bill.name}${value}`);
      add('bills', bill.id, bill.next_due_on, 'Conta vence hoje', `${bill.name}${value}`);
      // Em aberto: um aviso só, na manhã seguinte ao vencimento. A data é fixa,
      // então refazer os avisos não o repete; paga, a conta muda de data e ele sai.
      add('bills', bill.id, addDays(bill.next_due_on, 1), 'Conta atrasada', `${bill.name}${value}: venceu ontem.`);
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

  return out
    .sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key))
    .slice(0, Math.max(0, input.limit ?? HOUSE_REMINDER_LIMIT));
}

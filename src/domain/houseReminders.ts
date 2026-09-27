// Avisos da casa por notificação: contas, documentos e tarefas (inclusive
// manutenções de aparelhos). Cada celular escolhe o que quer receber; o
// plano sai daqui e o app agenda (src/lib/houseReminders.ts), refazendo ao
// abrir, então a janela vai andando.

import { addDays, diffDays, formatBRDate } from './dates';
import { formatBRL } from './money';

export type HouseReminderKind = 'bills' | 'documents' | 'chores';

export const HOUSE_REMINDER_KINDS: { key: HouseReminderKind; label: string; hint: string }[] = [
  { key: 'bills', label: 'Contas a pagar', hint: 'Na véspera e no dia do vencimento' },
  { key: 'documents', label: 'Documentos', hint: 'Quando começa o prazo de renovar e no dia em que vence' },
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
/** O iPhone guarda até 64 notificações agendadas por app; os remédios usam o resto. */
export const HOUSE_REMINDER_LIMIT = 24;

export interface HouseReminderInput {
  kinds: Record<HouseReminderKind, boolean>;
  bills: { id: string; name: string; amount: number | null; next_due_on: string; active: boolean; autopay: boolean }[];
  documents: { id: string; title: string; expires_on: string | null; remind_days: number }[];
  chores: { id: string; title: string; due_on: string; active: boolean; equipment_id: string | null }[];
  today: string;
  /** HH:MM de agora: aviso de hoje só se o horário ainda não passou. */
  nowTime: string;
}

export function planHouseReminders(input: HouseReminderInput): HouseReminder[] {
  const { kinds, today, nowTime } = input;
  const last = addDays(today, HOUSE_REMINDER_HORIZON_DAYS);
  const time = HOUSE_REMINDER_TIME;
  const upcoming = (date: string) => date <= last && (date > today || (date === today && time > nowTime));
  // Atrasado: um aviso no próximo horário (hoje, se ainda dá; senão amanhã).
  const nextSlot = time > nowTime ? today : addDays(today, 1);
  const out: HouseReminder[] = [];
  const add = (kind: HouseReminderKind, id: string, date: string, title: string, body: string) => {
    if (upcoming(date)) out.push({ key: `${kind}:${id}:${date}`, kind, date, time, title, body });
  };

  if (kinds.bills) {
    for (const bill of input.bills) {
      // Débito automático não precisa de ninguém: sem aviso.
      if (!bill.active || bill.autopay) continue;
      const value = bill.amount != null ? ` — ${formatBRL(bill.amount)}` : '';
      if (bill.next_due_on < today) {
        add('bills', bill.id, nextSlot, 'Conta atrasada', `${bill.name}${value}: venceu em ${formatBRDate(bill.next_due_on)}.`);
        continue;
      }
      add('bills', bill.id, addDays(bill.next_due_on, -1), 'Conta vence amanhã', `${bill.name}${value}`);
      add('bills', bill.id, bill.next_due_on, 'Conta vence hoje', `${bill.name}${value}`);
    }
  }

  if (kinds.documents) {
    for (const doc of input.documents) {
      if (!doc.expires_on || doc.expires_on < today) continue;
      const windowStart = addDays(doc.expires_on, -doc.remind_days);
      add(
        'documents',
        doc.id,
        windowStart,
        'Hora de renovar',
        `${doc.title} vence em ${diffDays(windowStart, doc.expires_on)} dias (${formatBRDate(doc.expires_on)}).`,
      );
      add('documents', doc.id, doc.expires_on, 'Documento vence hoje', doc.title);
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
    .slice(0, HOUSE_REMINDER_LIMIT);
}

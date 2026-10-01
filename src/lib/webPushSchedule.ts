// Como um lembrete agendado vira uma linha da agenda do navegador
// (public.push_schedule): os mesmos gatilhos do expo-notifications que
// src/lib/reminders.ts usa (todo dia, toda semana ou numa data).

export const TRIGGER_TYPES = { DAILY: 'daily', WEEKLY: 'weekly', DATE: 'date' } as const;

export interface ScheduleRequest {
  content: { title?: string | null; body?: string | null; data?: Record<string, unknown> | null };
  trigger:
    | { type: typeof TRIGGER_TYPES.DAILY; hour: number; minute: number }
    | { type: typeof TRIGGER_TYPES.WEEKLY; weekday: number; hour: number; minute: number }
    | { type: typeof TRIGGER_TYPES.DATE; date: Date | number };
}

export interface ScheduleRow {
  id: string;
  subscription_id: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  repeat: 'once' | 'daily' | 'weekly';
  fire_at?: string;
  hour?: number;
  minute?: number;
  /** Como no expo-notifications: 1 = domingo. */
  weekday?: number;
}

export function scheduleRow(id: string, subscriptionId: string, { content, trigger }: ScheduleRequest): ScheduleRow {
  const base = {
    id,
    subscription_id: subscriptionId,
    title: content.title || 'Nooky',
    body: content.body ?? '',
    data: content.data ?? {},
  };
  switch (trigger.type) {
    case TRIGGER_TYPES.DAILY:
      return { ...base, repeat: 'daily', hour: trigger.hour, minute: trigger.minute };
    case TRIGGER_TYPES.WEEKLY:
      return { ...base, repeat: 'weekly', weekday: trigger.weekday, hour: trigger.hour, minute: trigger.minute };
    case TRIGGER_TYPES.DATE:
      return { ...base, repeat: 'once', fire_at: new Date(trigger.date).toISOString() };
  }
}

/** A chave pública VAPID (base64url) no formato que o PushManager pede. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Mesma chave? (a inscrição antiga foi feita com outra chave: precisa refazer). */
export function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.length) return false;
  const view = new Uint8Array(a);
  return view.every((byte, i) => byte === b[i]);
}

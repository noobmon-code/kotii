// Lembretes como notificações locais. Ficam no aparelho: cada pessoa da
// família escolhe de quais remédios quer ser lembrada (só tocam dentro do
// período do tratamento, ver planReminders) e quais avisos da casa quer
// receber: contas, documentos, tarefas, consultas e vacinas (ver planHouseReminders).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';

import { todayISO } from '@/domain/dates';
import {
  HOUSE_REMINDER_LIMIT,
  overdueKey,
  planHouseReminders,
  SCHEDULED_NOTIFICATIONS_LIMIT,
  type HouseReminderInput,
  type HouseReminderKind,
} from '@/domain/houseReminders';
import { currentTimeHHMM, planReminders } from '@/domain/medications';
import type { Medication } from './types';

type NotificationsModule = typeof import('expo-notifications');

const CHANNEL_ID = 'remedios';
const MEDS_CHANNEL = { id: CHANNEL_ID, name: 'Remédios' };
const HOUSE_CHANNEL = { id: 'casa', name: 'Casa' };
const storageKey = (medicationId: string) => `reminders:${medicationId}`;

// No Android, o Expo Go lança erro só de carregar expo-notifications (desde o
// SDK 53). Lá os lembretes ficam desligados; no app instalado funcionam.
export const remindersSupported =
  Platform.OS === 'ios' || (Platform.OS === 'android' && !isRunningInExpoGo());

// Carregado só quando usado, para o import não derrubar o app onde não há suporte.
let notificationsModule: NotificationsModule | null = null;
function notifications(): NotificationsModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  notificationsModule ??= require('expo-notifications') as NotificationsModule;
  return notificationsModule;
}

export function configureNotifications() {
  if (!remindersSupported) return;
  notifications().setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

async function ensurePermission(channel = MEDS_CHANNEL): Promise<boolean> {
  const Notifications = notifications();
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(channel.id, {
      name: channel.name,
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

export async function hasReminders(medicationId: string): Promise<boolean> {
  return (await AsyncStorage.getItem(storageKey(medicationId))) !== null;
}

// Uma operação por vez: duas sincronizações ao mesmo tempo leriam o mesmo
// estado e agendariam os lembretes em dobro.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

interface StoredReminders {
  ids: string[];
  /** Plano e texto agendados; se mudarem, os lembretes são refeitos. */
  signature: string;
}

async function readStored(medicationId: string): Promise<StoredReminders | null> {
  const raw = await AsyncStorage.getItem(storageKey(medicationId));
  if (raw === null) return null;
  const parsed: unknown = JSON.parse(raw);
  // Formato antigo: só a lista de ids.
  return Array.isArray(parsed) ? { ids: parsed as string[], signature: '' } : (parsed as StoredReminders);
}

async function cancelAll(ids: string[]): Promise<void> {
  if (!remindersSupported) return;
  await Promise.all(ids.map((id) => notifications().cancelScheduledNotificationAsync(id).catch(() => undefined)));
}

async function disable(medicationId: string): Promise<void> {
  const stored = await readStored(medicationId);
  if (!stored) return;
  await cancelAll(stored.ids);
  await AsyncStorage.removeItem(storageKey(medicationId));
}

export function disableReminders(medicationId: string): Promise<void> {
  return serialized(() => disable(medicationId));
}

/**
 * Desliga os lembretes agendados neste aparelho, de remédios e da casa (ao
 * sair da casa). A escolha dos avisos da casa fica: vale para a próxima.
 */
export async function disableAllReminders(): Promise<void> {
  if (!remindersSupported) return;
  await serialized(async () => {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('reminders:'));
    for (const key of keys) await disable(key.slice('reminders:'.length));
    const house = await readHouseScheduled();
    if (house) await cancelAll(house.ids);
    await AsyncStorage.removeItem(HOUSE_SCHEDULED_KEY);
  });
}

function contentOf(medication: Medication) {
  return {
    title: `${medication.name} — ${medication.person_name}`,
    body: medication.dosage ? `Hora de tomar: ${medication.dosage}` : 'Hora de tomar o remédio',
    data: { medicationId: medication.id },
  };
}

/** Agenda conforme o plano (diário ou dose a dose) e guarda o que foi agendado. */
async function schedule(medication: Medication, today: string): Promise<void> {
  const Notifications = notifications();
  const plan = planReminders(toPlanInput(medication), today, currentTimeHHMM());
  const content = contentOf(medication);
  const signature = JSON.stringify({ plan, content });
  const previous = await readStored(medication.id);
  if (previous?.signature === signature) return;
  if (previous) await cancelAll(previous.ids);

  const ids: string[] = [];
  if (plan.kind === 'daily') {
    for (const time of plan.times) {
      const [hour, minute] = time.split(':').map(Number);
      ids.push(
        await Notifications.scheduleNotificationAsync({
          content,
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute, channelId: CHANNEL_ID },
        }),
      );
    }
  } else if (plan.kind === 'weekly') {
    for (const weekday of plan.weekdays) {
      for (const time of plan.times) {
        const [hour, minute] = time.split(':').map(Number);
        ids.push(
          await Notifications.scheduleNotificationAsync({
            content,
            // No expo-notifications, 1 = domingo.
            trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: weekday + 1, hour, minute, channelId: CHANNEL_ID },
          }),
        );
      }
    }
  } else if (plan.kind === 'dates') {
    for (const slot of plan.slots) {
      const [y, m, d] = slot.date.split('-').map(Number);
      const [hour, minute] = slot.time.split(':').map(Number);
      ids.push(
        await Notifications.scheduleNotificationAsync({
          content,
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: new Date(y, m - 1, d, hour, minute),
            channelId: CHANNEL_ID,
          },
        }),
      );
    }
  }
  await AsyncStorage.setItem(storageKey(medication.id), JSON.stringify({ ids, signature } satisfies StoredReminders));
}

function toPlanInput(medication: Medication) {
  return {
    times: medication.times,
    startOn: medication.start_on,
    endOn: medication.end_on,
    active: medication.active,
    frequency: medication.frequency,
    weekdays: medication.weekdays,
    intervalDays: medication.interval_days,
    totalDoses: medication.total_doses,
    takenCount: medication.taken_count,
  };
}

/**
 * Liga os lembretes deste remédio neste aparelho, só dentro do período do
 * tratamento. Retorna false sem permissão.
 */
export async function enableReminders(medication: Medication, today = todayISO()): Promise<boolean> {
  if (!remindersSupported || !(await ensurePermission())) return false;
  await serialized(() => schedule(medication, today));
  return true;
}

/**
 * Mantém os lembretes deste aparelho em dia: remove os de remédios
 * encerrados ou removidos e refaz os que mudaram (datas, horários, perto do
 * início ou do fim do tratamento). Chamado ao abrir o app.
 */
export async function syncReminders(medications: Medication[], today: string): Promise<void> {
  if (!remindersSupported) return;
  await serialized(async () => {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('reminders:'));
    const byId = new Map(medications.map((m) => [m.id, m]));
    for (const key of keys) {
      const id = key.slice('reminders:'.length);
      const medication = byId.get(id);
      if (!medication || !medication.active || (medication.end_on && medication.end_on < today)) {
        await disable(id);
      } else {
        await schedule(medication, today);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Avisos da casa

const HOUSE_KINDS_KEY = 'house-reminders:kinds';
const HOUSE_SCHEDULED_KEY = 'house-reminders:scheduled';
const NO_HOUSE_KINDS: Record<HouseReminderKind, boolean> = {
  bills: false,
  documents: false,
  chores: false,
  appointments: false,
  vaccines: false,
};

/** Consultas ou vacinas undefined: ainda não carregaram (os avisos delas já agendados ficam como estão). */
export type HouseReminderData = Pick<HouseReminderInput, 'bills' | 'documents' | 'chores' | 'appointments' | 'vaccines'>;

/** Avisos da casa agendados: o tipo de cada id, para desligar um tipo sem refazer os outros. */
interface StoredHouseReminders extends StoredReminders {
  kinds?: HouseReminderKind[];
  /** Avisos de atraso agendados (chave, quando tocam e o tipo; sem tipo, de versões antigas, são de conta). */
  overdue?: { key: string; at: string; kind?: HouseReminderKind }[];
  /** Atrasos (de conta ou vacina) que já tocaram neste aparelho: não avisam de novo. */
  warned?: string[];
}

async function readHouseScheduled(): Promise<StoredHouseReminders | null> {
  const raw = await AsyncStorage.getItem(HOUSE_SCHEDULED_KEY).catch(() => null);
  return raw ? (JSON.parse(raw) as StoredHouseReminders) : null;
}

/** Quais avisos da casa este aparelho recebe. */
export async function getHouseReminderKinds(): Promise<Record<HouseReminderKind, boolean>> {
  const raw = await AsyncStorage.getItem(HOUSE_KINDS_KEY).catch(() => null);
  try {
    return { ...NO_HOUSE_KINDS, ...(raw ? (JSON.parse(raw) as Partial<Record<HouseReminderKind, boolean>>) : {}) };
  } catch {
    return NO_HOUSE_KINDS;
  }
}

/**
 * Liga ou desliga um tipo de aviso neste aparelho. Retorna false sem
 * permissão. Desligar já cancela os avisos agendados desse tipo, mesmo sem
 * os dados da casa carregados (os outros tipos ficam como estão).
 */
export async function setHouseReminderKind(kind: HouseReminderKind, enabled: boolean): Promise<boolean> {
  if (!remindersSupported) return false;
  if (enabled && !(await ensurePermission(HOUSE_CHANNEL))) return false;
  // Na fila, para dois toques seguidos não gravarem um por cima do outro.
  await serialized(async () => {
    const kinds = { ...(await getHouseReminderKinds()), [kind]: enabled };
    await AsyncStorage.setItem(HOUSE_KINDS_KEY, JSON.stringify(kinds));
    if (enabled) return;
    const scheduled = await readHouseScheduled();
    if (!scheduled?.kinds) {
      // Formato antigo, sem o tipo de cada aviso: cancela tudo; a próxima sincronização refaz.
      if (scheduled) await cancelAll(scheduled.ids);
      await AsyncStorage.removeItem(HOUSE_SCHEDULED_KEY);
      return;
    }
    const drop = scheduled.ids.filter((_, i) => scheduled.kinds?.[i] === kind);
    await cancelAll(drop);
    const keep = scheduled.ids.map((id, i) => ({ id, kind: scheduled.kinds![i] })).filter((r) => r.kind !== kind);
    // Desligando o tipo: aviso de atraso dele que já tocou fica marcado, para não
    // tocar de novo se o tipo for religado; o que ainda não tocou sai, para
    // poder avisar quando religar.
    const now = `${todayISO()}T${currentTimeHHMM()}`;
    const ofKind = (o: { kind?: HouseReminderKind }) => (o.kind ?? 'bills') === kind;
    const rang = (scheduled.overdue ?? []).filter((o) => ofKind(o) && o.at <= now).map((o) => o.key);
    await AsyncStorage.setItem(
      HOUSE_SCHEDULED_KEY,
      // Assinatura vazia: a próxima sincronização refaz com os dados.
      JSON.stringify({
        ...scheduled,
        ids: keep.map((r) => r.id),
        kinds: keep.map((r) => r.kind),
        overdue: (scheduled.overdue ?? []).filter((o) => !ofKind(o)),
        warned: [...new Set([...(scheduled.warned ?? []), ...rang])],
        signature: '',
      } satisfies StoredHouseReminders),
    );
  });
  return true;
}

/** Algum aviso da casa ligado neste aparelho? */
export async function anyHouseReminderKind(): Promise<boolean> {
  return Object.values(await getHouseReminderKinds()).some(Boolean);
}

/** Refaz os avisos da casa deste aparelho com os dados de agora (ao abrir e ao mudar a escolha). */
export async function syncHouseReminders(
  data: HouseReminderData,
  today = todayISO(),
  nowTime = currentTimeHHMM(),
): Promise<void> {
  if (!remindersSupported) return;
  await serialized(async () => {
    const Notifications = notifications();
    const kinds = await getHouseReminderKinds();
    const previous = await readHouseScheduled();
    // Consultas ou vacinas que não carregaram: os avisos delas já agendados
    // ficam como estão, e os outros tipos seguem normais.
    const unknown = new Set<HouseReminderKind>([
      ...(data.appointments === undefined ? (['appointments'] as const) : []),
      ...(data.vaccines === undefined ? (['vaccines'] as const) : []),
    ]);
    // Aviso de atraso cuja hora já passou tocou: aquela conta (ou vacina) não
    // avisa de novo. Guarda só as que continuam atrasadas (paga, o vencimento
    // muda); sem os dados das vacinas, as marcas que não são de conta ficam.
    const now = `${today}T${nowTime}`;
    const stillOverdue = new Set([
      ...data.bills.filter((b) => b.next_due_on < today).map((b) => overdueKey(b.id, b.next_due_on)),
      ...(data.vaccines ?? []).flatMap((v) => (v.next_dose_on && v.next_dose_on < today ? [overdueKey(v.id, v.next_dose_on)] : [])),
    ]);
    const billIds = new Set(data.bills.map((b) => b.id));
    const warned = [...new Set([...(previous?.warned ?? []), ...(previous?.overdue ?? []).filter((o) => o.at <= now).map((o) => o.key)])].filter(
      (key) => stillOverdue.has(key) || (unknown.has('vaccines') && !billIds.has(key.split(':')[0])),
    );
    // O iPhone guarda até 64 avisos agendados: a casa fica com o que os remédios deixam.
    const ours = new Set(previous?.ids ?? []);
    const scheduled = await Promise.resolve()
      .then(() => Notifications.getAllScheduledNotificationsAsync())
      .catch(() => null);
    const live = scheduled ? new Set(scheduled.map((n) => n.identifier)) : null;
    const others = (scheduled ?? []).filter((n) => !ours.has(n.identifier)).length;
    // Avisos de consultas/vacinas que ficam (sem os dados delas): só os que
    // ainda estão agendados; os que já tocaram não ocupam vaga.
    const held = (previous?.kinds ?? []).flatMap((kind, i) =>
      unknown.has(kind) && (!live || live.has(previous!.ids[i])) ? [{ id: previous!.ids[i], kind }] : [],
    );
    const heldIds = new Set(held.map((r) => r.id));
    const limit = Math.min(HOUSE_REMINDER_LIMIT, SCHEDULED_NOTIFICATIONS_LIMIT - others) - held.length;
    const planKinds = {
      ...kinds,
      appointments: kinds.appointments && !unknown.has('appointments'),
      vaccines: kinds.vaccines && !unknown.has('vaccines'),
    };
    const plan = planHouseReminders({ ...data, kinds: planKinds, today, nowTime, limit, overdueWarned: warned });
    const overdue = [
      ...(previous?.overdue ?? []).filter((o) => o.kind && unknown.has(o.kind)),
      ...plan.flatMap((r) => (r.overdue ? [{ key: r.overdue, at: `${r.date}T${r.time}`, kind: r.kind }] : [])),
    ];
    const signature = JSON.stringify(plan) + (unknown.size ? `|sem:${[...unknown].join(',')}` : '');
    if (previous?.signature === signature) {
      // Nada a refazer, mas avisos de saúde que já tocaram saem da lista guardada.
      const keep = previous.ids.flatMap((id, i) => {
        const kind = previous.kinds?.[i];
        return kind && unknown.has(kind) && !heldIds.has(id) ? [] : [{ id, kind }];
      });
      if (keep.length !== previous.ids.length || JSON.stringify(previous.warned ?? []) !== JSON.stringify(warned)) {
        await AsyncStorage.setItem(
          HOUSE_SCHEDULED_KEY,
          JSON.stringify({
            ...previous,
            ids: keep.map((r) => r.id),
            kinds: previous.kinds ? keep.map((r) => r.kind!) : undefined,
            warned,
          } satisfies StoredHouseReminders),
        );
      }
      return;
    }
    if (previous) await cancelAll(previous.ids.filter((id) => !heldIds.has(id)));

    const ids: string[] = [];
    for (const reminder of plan) {
      const [y, m, d] = reminder.date.split('-').map(Number);
      const [hour, minute] = reminder.time.split(':').map(Number);
      ids.push(
        await Notifications.scheduleNotificationAsync({
          content: { title: reminder.title, body: reminder.body, data: { reminder: reminder.key } },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: new Date(y, m - 1, d, hour, minute),
            channelId: HOUSE_CHANNEL.id,
          },
        }),
      );
    }
    await AsyncStorage.setItem(
      HOUSE_SCHEDULED_KEY,
      JSON.stringify({
        ids: [...held.map((r) => r.id), ...ids],
        kinds: [...held.map((r) => r.kind), ...plan.map((r) => r.kind)],
        overdue,
        warned,
        signature,
      } satisfies StoredHouseReminders),
    );
  });
}

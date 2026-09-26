// Lembretes de remédio como notificações locais. Ficam no aparelho: cada
// pessoa da família escolhe de quais remédios quer ser lembrada. Só tocam
// dentro do período do tratamento (ver planReminders).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';

import { todayISO } from '@/domain/dates';
import { currentTimeHHMM, planReminders } from '@/domain/medications';
import type { Medication } from './types';

type NotificationsModule = typeof import('expo-notifications');

const CHANNEL_ID = 'remedios';
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

async function ensurePermission(): Promise<boolean> {
  const Notifications = notifications();
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Remédios',
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
  return { times: medication.times, startOn: medication.start_on, endOn: medication.end_on, active: medication.active };
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

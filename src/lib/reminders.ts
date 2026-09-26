// Lembretes de remédio como notificações locais diárias. Ficam no aparelho:
// cada pessoa da família escolhe de quais remédios quer ser lembrada.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { Medication } from './types';

const CHANNEL_ID = 'remedios';
const storageKey = (medicationId: string) => `reminders:${medicationId}`;

export const remindersSupported = Platform.OS !== 'web';

export function configureNotifications() {
  if (!remindersSupported) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

async function ensurePermission(): Promise<boolean> {
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

export async function disableReminders(medicationId: string): Promise<void> {
  const raw = await AsyncStorage.getItem(storageKey(medicationId));
  if (!raw) return;
  const ids: string[] = JSON.parse(raw);
  await Promise.all(ids.map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
  await AsyncStorage.removeItem(storageKey(medicationId));
}

/** Agenda um lembrete diário por horário. Retorna false sem permissão. */
export async function enableReminders(medication: Medication): Promise<boolean> {
  if (!remindersSupported || !(await ensurePermission())) return false;
  await disableReminders(medication.id);
  const ids: string[] = [];
  for (const time of medication.times) {
    const [hour, minute] = time.split(':').map(Number);
    ids.push(
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `${medication.name} — ${medication.person_name}`,
          body: medication.dosage ? `Hora de tomar: ${medication.dosage}` : 'Hora de tomar o remédio',
          data: { medicationId: medication.id },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute, channelId: CHANNEL_ID },
      }),
    );
  }
  await AsyncStorage.setItem(storageKey(medication.id), JSON.stringify(ids));
  return true;
}

/** Cancela lembretes deste aparelho de remédios encerrados ou removidos. */
export async function syncReminders(medications: Medication[], today: string): Promise<void> {
  if (!remindersSupported) return;
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('reminders:'));
  const byId = new Map(medications.map((m) => [m.id, m]));
  for (const key of keys) {
    const id = key.slice('reminders:'.length);
    const medication = byId.get(id);
    if (!medication || !medication.active || (medication.end_on && medication.end_on < today)) {
      await disableReminders(id);
    }
  }
}

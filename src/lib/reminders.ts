// Lembretes como notificações locais. Ficam no aparelho: cada pessoa da
// família escolhe de quais remédios quer ser lembrada (só tocam dentro do
// período do tratamento, ver planReminders) e quais avisos da casa quer
// receber: contas, documentos, tarefas, consultas, vacinas e a dica do clima
// da manhã (ver planHouseReminders). Quem tem várias casas recebe os de
// todas: cada lembrete guardado diz de que casa é, e cada sincronização mexe
// só nos da casa que ela recebeu.
// No navegador, a mesma agenda fica no servidor e chega por Web Push (ver
// src/lib/webPush.ts): cada navegador inscrito é um "aparelho".

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
import type { ScheduleRequest as WebScheduleRequest } from './webPushSchedule';

type NotificationsModule = typeof import('expo-notifications');

const CHANNEL_ID = 'remedios';
const MEDS_CHANNEL = { id: CHANNEL_ID, name: 'Remédios' };
const HOUSE_CHANNEL = { id: 'casa', name: 'Casa' };
const storageKey = (medicationId: string) => `reminders:${medicationId}`;

type WebPushModule = typeof import('./webPush');

// Só no web, e só quando usado.
let webPushModule: WebPushModule | null = null;
function webPush(): WebPushModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  webPushModule ??= require('./webPush') as WebPushModule;
  return webPushModule;
}

// No Android, o Expo Go lança erro só de carregar expo-notifications (desde o
// SDK 53). Lá os lembretes ficam desligados; no app instalado funcionam. No
// navegador, só onde há Web Push.
export const remindersSupported =
  Platform.OS === 'ios' ||
  (Platform.OS === 'android' && !isRunningInExpoGo()) ||
  (Platform.OS === 'web' && webPush().webPushSupported);

/** Onde os avisos tocam, para os textos das telas. */
export const REMINDER_PLACE = Platform.OS === 'web' ? 'neste navegador' : 'neste celular';

/** O que fazer quando a permissão foi negada. */
export const PERMISSION_HINT =
  Platform.OS === 'web'
    ? 'Permita as notificações do Kotii nas configurações do navegador.'
    : 'Permita as notificações do Kotii nos ajustes do celular.';

/**
 * Lembrete ligado de saída num remédio novo? No navegador, só com a permissão
 * já dada: lá o pedido precisa vir de um toque, e não do salvar.
 */
export function remindByDefault(): boolean {
  return remindersSupported && (Platform.OS !== 'web' || Notification.permission === 'granted');
}

/** Por que os avisos não funcionam aqui (null: funcionam). */
export function remindersUnavailableReason(): string | null {
  if (remindersSupported) return null;
  if (Platform.OS !== 'web') return 'Os avisos por notificação funcionam no app instalado; no Expo Go do Android eles ficam desligados.';
  if (webPush().needsHomeScreen()) {
    return 'No iPhone, os avisos chegam com o Kotii na tela de início: no Safari, toque em Compartilhar → Adicionar à Tela de Início e abra o app por lá.';
  }
  return 'Este navegador não recebe notificações. Use o Chrome, o Edge, o Firefox ou o Safari atualizados, ou o app instalado no celular.';
}

// Carregado só quando usado, para o import não derrubar o app onde não há suporte.
let notificationsModule: NotificationsModule | null = null;
function notifications(): NotificationsModule {
  if (Platform.OS === 'web') return webPush().webScheduler as unknown as NotificationsModule;
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

/** Pede a permissão já no toque (no navegador, o pedido precisa vir de um toque). */
export async function askReminderPermission(): Promise<boolean> {
  return remindersSupported && ensurePermission();
}

export async function hasReminders(medicationId: string): Promise<boolean> {
  return (await AsyncStorage.getItem(storageKey(medicationId))) !== null;
}

// Uma operação por vez: duas sincronizações ao mesmo tempo leriam o mesmo
// estado e agendariam os lembretes em dobro. No navegador, também entre abas.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const locked = () =>
    Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.locks
      ? (navigator.locks.request('kotii-lembretes', task) as Promise<T>)
      : task();
  const run = queue.then(locked, locked);
  queue = run.catch(() => undefined);
  return run;
}

interface StoredReminders {
  ids: string[];
  /** Plano e texto agendados; se mudarem, os lembretes são refeitos. */
  signature: string;
  /** Casa do remédio (sem ela: de antes das várias casas, da casa que estava aberta). */
  householdId?: string;
}

async function readStored(medicationId: string): Promise<StoredReminders | null> {
  const raw = await AsyncStorage.getItem(storageKey(medicationId));
  if (raw === null) return null;
  const parsed: unknown = JSON.parse(raw);
  // Formato antigo: só a lista de ids.
  return Array.isArray(parsed) ? { ids: parsed as string[], signature: '' } : (parsed as StoredReminders);
}

type ScheduleRequest = Parameters<NotificationsModule['scheduleNotificationAsync']>[0];

/**
 * Agenda vários de uma vez. No navegador, numa gravação só no servidor
 * (tudo ou nada); no celular, se um falhar, os já agendados nesta vez saem:
 * nunca fica um plano pela metade sem estar guardado.
 */
async function scheduleAll(requests: ScheduleRequest[]): Promise<string[]> {
  // Os gatilhos daqui são sempre diário, semanal ou data, os que o agendador do web entende.
  if (Platform.OS === 'web') return webPush().webScheduler.scheduleManyAsync(requests as unknown as WebScheduleRequest[]);
  const Notifications = notifications();
  const ids: string[] = [];
  try {
    for (const request of requests) ids.push(await Notifications.scheduleNotificationAsync(request));
  } catch (err) {
    await cancelAll(ids);
    throw err;
  }
  return ids;
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

async function medicationKeys(): Promise<string[]> {
  return (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('reminders:'));
}

async function houseScheduledKeys(): Promise<string[]> {
  return (await AsyncStorage.getAllKeys()).filter((k) => k === HOUSE_SCHEDULED_KEY || k.startsWith(`${HOUSE_SCHEDULED_KEY}:`));
}

async function dropHouseScheduled(key: string): Promise<void> {
  const stored = await readHouseScheduled(key);
  if (stored) await cancelAll(stored.ids);
  await AsyncStorage.removeItem(key);
}

/**
 * Desliga os lembretes agendados neste aparelho, de remédios e de todas as
 * casas (ao sair da conta). A escolha dos avisos da casa fica: vale para a
 * próxima.
 */
export async function disableAllReminders(): Promise<void> {
  if (!remindersSupported) return;
  await serialized(async () => {
    for (const key of await medicationKeys()) await disable(key.slice('reminders:'.length));
    for (const key of await houseScheduledKeys()) await dropHouseScheduled(key);
    // No navegador, a inscrição sai também: o servidor para de mandar avisos para cá.
    if (Platform.OS === 'web') await webPush().unregisterWebPush();
  });
}

/**
 * No navegador: tira da agenda do servidor o que nenhum lembrete guardado
 * aqui conhece (sobra de uma sincronização que caiu sem internet) e renova a
 * inscrição. Se a inscrição mudou (chave nova, ou a antiga venceu e o
 * servidor a apagou com a agenda), o que está guardado aqui não está mais lá:
 * as assinaturas saem e a próxima sincronização refaz tudo. Chamado ao abrir
 * o app e ao voltar para ele.
 */
export async function reconcileReminders(): Promise<void> {
  if (!remindersSupported || Platform.OS !== 'web') return;
  await serialized(async () => {
    const medications = await medicationKeys();
    const houses = await houseScheduledKeys();
    const keep: string[] = [];
    for (const key of medications) keep.push(...((await readStored(key.slice('reminders:'.length)))?.ids ?? []));
    for (const key of houses) keep.push(...((await readHouseScheduled(key))?.ids ?? []));
    const { changed } = await webPush().pruneWebSchedule(keep);
    if (!changed) return;
    // Os ids ficam: o que ainda existir no servidor sai quando o lembrete for refeito.
    for (const key of medications) {
      const stored = await readStored(key.slice('reminders:'.length));
      if (stored) await AsyncStorage.setItem(key, JSON.stringify({ ...stored, signature: '' } satisfies StoredReminders));
    }
    for (const key of houses) {
      const stored = await readHouseScheduled(key);
      if (stored) await AsyncStorage.setItem(key, JSON.stringify({ ...stored, signature: '' } satisfies StoredHouseReminders));
    }
  });
}

/**
 * Desliga os lembretes de uma casa (a pessoa saiu dela): os remédios e os
 * avisos dela. Os de antes das várias casas (sem casa) eram da casa aberta, a
 * que ficou para trás.
 */
export async function disableHouseholdReminders(householdId: string): Promise<void> {
  if (!remindersSupported) return;
  await serialized(async () => {
    for (const key of await medicationKeys()) {
      const id = key.slice('reminders:'.length);
      const stored = await readStored(id);
      if (stored && (stored.householdId ?? householdId) === householdId) await disable(id);
    }
    await dropHouseScheduled(houseScheduledKey(householdId));
    await dropHouseScheduled(HOUSE_SCHEDULED_KEY);
  });
}

/** Tira os lembretes de casas de que a pessoa não é mais (saiu por outro aparelho). */
export async function pruneHouseholdReminders(householdIds: string[]): Promise<void> {
  if (!remindersSupported) return;
  const mine = new Set(householdIds);
  await serialized(async () => {
    for (const key of await medicationKeys()) {
      const id = key.slice('reminders:'.length);
      const stored = await readStored(id);
      if (stored?.householdId && !mine.has(stored.householdId)) await disable(id);
    }
    for (const key of await houseScheduledKeys()) {
      const id = key.slice(HOUSE_SCHEDULED_KEY.length + 1);
      if (id && !mine.has(id)) await dropHouseScheduled(key);
    }
  });
}

/** Casas com lembrete de remédio ligado neste aparelho (undefined: de antes das várias casas). */
export async function householdsWithMedicationReminders(): Promise<Set<string | undefined>> {
  const out = new Set<string | undefined>();
  for (const key of await medicationKeys()) out.add((await readStored(key.slice('reminders:'.length)))?.householdId);
  return out;
}

/** De qual casa é o remédio; com mais de uma casa, o nome dela vai no aviso. */
export interface MedicationTarget {
  householdId: string;
  label?: string;
}

// A casa vai no aviso: no navegador, a agenda fica no servidor, e quem é
// tirado da casa (remove_member) tem os avisos dela apagados lá na hora.
function contentOf(medication: Medication, { householdId, label }: MedicationTarget) {
  return {
    title: `${medication.name} — ${medication.person_name}${label ? ` · ${label}` : ''}`,
    body: medication.dosage ? `Hora de tomar: ${medication.dosage}` : 'Hora de tomar o remédio',
    data: { medicationId: medication.id, householdId },
  };
}

/** Agenda conforme o plano (diário ou dose a dose) e guarda o que foi agendado. */
async function schedule(medication: Medication, today: string, { householdId, label }: MedicationTarget): Promise<void> {
  const Notifications = notifications();
  const plan = planReminders(toPlanInput(medication), today, currentTimeHHMM());
  const content = contentOf(medication, { householdId, label });
  const signature = JSON.stringify({ plan, content });
  const previous = await readStored(medication.id);
  if (previous?.signature === signature && previous.householdId === householdId) return;
  if (previous) await cancelAll(previous.ids);

  const requests: ScheduleRequest[] = [];
  if (plan.kind === 'daily') {
    for (const time of plan.times) {
      const [hour, minute] = time.split(':').map(Number);
      requests.push({
        content,
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute, channelId: CHANNEL_ID },
      });
    }
  } else if (plan.kind === 'weekly') {
    for (const weekday of plan.weekdays) {
      for (const time of plan.times) {
        const [hour, minute] = time.split(':').map(Number);
        requests.push({
          content,
          // No expo-notifications, 1 = domingo.
          trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: weekday + 1, hour, minute, channelId: CHANNEL_ID },
        });
      }
    }
  } else if (plan.kind === 'dates') {
    for (const slot of plan.slots) {
      const [y, m, d] = slot.date.split('-').map(Number);
      const [hour, minute] = slot.time.split(':').map(Number);
      requests.push({
        content,
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(y, m - 1, d, hour, minute),
          channelId: CHANNEL_ID,
        },
      });
    }
  }
  const ids = await scheduleAll(requests);
  await AsyncStorage.setItem(storageKey(medication.id), JSON.stringify({ ids, signature, householdId } satisfies StoredReminders));
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
 * Liga os lembretes deste remédio (da casa `target`) neste aparelho, só
 * dentro do período do tratamento. Retorna false sem permissão.
 */
export async function enableReminders(medication: Medication, target: MedicationTarget, today = todayISO()): Promise<boolean> {
  if (!remindersSupported || !(await ensurePermission())) return false;
  await serialized(() => schedule(medication, today, target));
  return true;
}

/**
 * Mantém em dia os lembretes dos remédios de uma casa: remove os de remédios
 * encerrados ou removidos e refaz os que mudaram (datas, horários, perto do
 * início ou do fim do tratamento). Chamado ao abrir o app, para cada casa.
 * `adoptLegacy`: a casa aberta assume os lembretes de antes das várias casas.
 */
export async function syncReminders(
  medications: Medication[],
  today: string,
  { householdId, label, adoptLegacy = false }: MedicationTarget & { adoptLegacy?: boolean },
): Promise<void> {
  if (!remindersSupported) return;
  await serialized(async () => {
    const byId = new Map(medications.map((m) => [m.id, m]));
    for (const key of await medicationKeys()) {
      const id = key.slice('reminders:'.length);
      const stored = await readStored(id);
      if (!(stored?.householdId ? stored.householdId === householdId : adoptLegacy)) continue;
      const medication = byId.get(id);
      if (!medication || !medication.active || (medication.end_on && medication.end_on < today)) {
        await disable(id);
      } else {
        await schedule(medication, today, { householdId, label });
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
  weather: false,
};

/**
 * Consultas, vacinas ou clima undefined: ainda não carregaram (os avisos
 * deles já agendados ficam como estão). `weatherPlace`: de onde é a previsão
 * (as coordenadas do local da casa; null sem local; undefined se o local não
 * carregou).
 */
export type HouseReminderData = Pick<HouseReminderInput, 'bills' | 'documents' | 'chores' | 'appointments' | 'vaccines' | 'weather'> & {
  weatherPlace?: string | null;
};

/** Avisos da casa agendados: o tipo de cada id, para desligar um tipo sem refazer os outros. */
interface StoredHouseReminders extends StoredReminders {
  kinds?: HouseReminderKind[];
  /** Avisos de atraso agendados (chave, quando tocam e o tipo; sem tipo, de versões antigas, são de conta). */
  overdue?: { key: string; at: string; kind?: HouseReminderKind }[];
  /** Atrasos (de conta ou vacina) que já tocaram neste aparelho: não avisam de novo. */
  warned?: string[];
  /** De onde é a previsão dos avisos do clima agendados. */
  weatherPlace?: string | null;
}

/** Avisos agendados de uma casa (a chave sem casa é de antes das várias casas). */
const houseScheduledKey = (householdId: string) => `${HOUSE_SCHEDULED_KEY}:${householdId}`;

async function readHouseScheduled(key: string): Promise<StoredHouseReminders | null> {
  const raw = await AsyncStorage.getItem(key).catch(() => null);
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
    // Em todas as casas.
    for (const key of await houseScheduledKeys()) await dropKind(key, kind);
  });
  return true;
}

/** Cancela os avisos agendados de um tipo numa casa (ver setHouseReminderKind). */
async function dropKind(key: string, kind: HouseReminderKind): Promise<void> {
  const scheduled = await readHouseScheduled(key);
  if (!scheduled?.kinds) {
    // Formato antigo, sem o tipo de cada aviso: cancela tudo; a próxima sincronização refaz.
    if (scheduled) await cancelAll(scheduled.ids);
    await AsyncStorage.removeItem(key);
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
    key,
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
}

/** Algum aviso da casa ligado neste aparelho? */
export async function anyHouseReminderKind(): Promise<boolean> {
  return Object.values(await getHouseReminderKinds()).some(Boolean);
}

export interface HouseReminderTarget {
  householdId: string;
  /** Nome da casa no aviso, para quem tem mais de uma. */
  label?: string;
  /** A casa aberta assume os avisos agendados antes das várias casas. */
  adoptLegacy?: boolean;
  /** Teto de avisos desta casa (com várias, o teto é dividido). */
  limit?: number;
  today?: string;
  nowTime?: string;
}

/** Refaz os avisos de uma casa neste aparelho com os dados de agora (ao abrir e ao mudar a escolha). */
export async function syncHouseReminders(data: HouseReminderData, target: HouseReminderTarget): Promise<void> {
  if (!remindersSupported) return;
  const { householdId, label, adoptLegacy = false, today = todayISO(), nowTime = currentTimeHHMM() } = target;
  await serialized(async () => {
    const Notifications = notifications();
    const kinds = await getHouseReminderKinds();
    const key = houseScheduledKey(householdId);
    const own = await readHouseScheduled(key);
    const legacy = !own && adoptLegacy ? await readHouseScheduled(HOUSE_SCHEDULED_KEY) : null;
    const previous = own ?? legacy;
    // A casa mudou de local e a previsão do novo ainda não veio (sem
    // internet): os avisos do clima do lugar antigo saem, em vez de ficar.
    const moved =
      data.weather === undefined &&
      data.weatherPlace !== undefined &&
      previous?.weatherPlace !== undefined &&
      data.weatherPlace !== previous.weatherPlace;
    const weather = moved ? [] : data.weather;
    const weatherPlace = weather !== undefined ? data.weatherPlace : previous?.weatherPlace;
    // Consultas, vacinas ou previsão que não carregaram: os avisos delas já
    // agendados ficam como estão, e os outros tipos seguem normais.
    const unknown = new Set<HouseReminderKind>([
      ...(data.appointments === undefined ? (['appointments'] as const) : []),
      ...(data.vaccines === undefined ? (['vaccines'] as const) : []),
      ...(weather === undefined ? (['weather'] as const) : []),
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
    const limit = Math.min(target.limit ?? HOUSE_REMINDER_LIMIT, SCHEDULED_NOTIFICATIONS_LIMIT - others) - held.length;
    const planKinds = {
      ...kinds,
      appointments: kinds.appointments && !unknown.has('appointments'),
      vaccines: kinds.vaccines && !unknown.has('vaccines'),
      weather: kinds.weather && !unknown.has('weather'),
    };
    // Com mais de uma casa, o aviso diz de qual é.
    const plan = planHouseReminders({ ...data, weather, kinds: planKinds, today, nowTime, limit, overdueWarned: warned }).map((r) =>
      label ? { ...r, title: `${r.title} · ${label}` } : r,
    );
    const overdue = [
      ...(previous?.overdue ?? []).filter((o) => o.kind && unknown.has(o.kind)),
      ...plan.flatMap((r) => (r.overdue ? [{ key: r.overdue, at: `${r.date}T${r.time}`, kind: r.kind }] : [])),
    ];
    // A casa entra na assinatura: os avisos de antes de levarem a casa (ver
    // data.householdId) são refeitos uma vez, para o servidor saber de qual são.
    const signature = `${JSON.stringify(plan)}|casa:${householdId}` + (unknown.size ? `|sem:${[...unknown].join(',')}` : '');
    if (previous?.signature === signature) {
      // Nada a refazer, mas avisos de saúde ou do clima que já tocaram saem da lista guardada.
      const keep = previous.ids.flatMap((id, i) => {
        const kind = previous.kinds?.[i];
        return kind && unknown.has(kind) && !heldIds.has(id) ? [] : [{ id, kind }];
      });
      if (
        keep.length !== previous.ids.length ||
        JSON.stringify(previous.warned ?? []) !== JSON.stringify(warned) ||
        previous.weatherPlace !== weatherPlace ||
        legacy
      ) {
        await AsyncStorage.setItem(
          key,
          JSON.stringify({
            ...previous,
            ids: keep.map((r) => r.id),
            kinds: previous.kinds ? keep.map((r) => r.kind!) : undefined,
            warned,
            weatherPlace,
          } satisfies StoredHouseReminders),
        );
        if (legacy) await AsyncStorage.removeItem(HOUSE_SCHEDULED_KEY);
      }
      return;
    }
    if (previous) await cancelAll(previous.ids.filter((id) => !heldIds.has(id)));

    const ids = await scheduleAll(
      plan.map((reminder) => {
        const [y, m, d] = reminder.date.split('-').map(Number);
        const [hour, minute] = reminder.time.split(':').map(Number);
        return {
          content: { title: reminder.title, body: reminder.body, data: { reminder: reminder.key, householdId } },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: new Date(y, m - 1, d, hour, minute),
            channelId: HOUSE_CHANNEL.id,
          },
        };
      }),
    );
    await AsyncStorage.setItem(
      key,
      JSON.stringify({
        ids: [...held.map((r) => r.id), ...ids],
        kinds: [...held.map((r) => r.kind), ...plan.map((r) => r.kind)],
        overdue,
        warned,
        signature,
        weatherPlace,
      } satisfies StoredHouseReminders),
    );
    if (legacy) await AsyncStorage.removeItem(HOUSE_SCHEDULED_KEY);
  });
}

// Avisos no navegador (Web Push). No celular, os lembretes são notificações
// locais (expo-notifications); no web, a mesma agenda vai para o servidor
// (public.push_schedule) e a função send-push manda cada aviso na hora,
// mesmo com o app fechado. Este módulo faz, no web, o papel do
// expo-notifications para src/lib/reminders.ts: pedir permissão, agendar,
// cancelar e listar. O service worker (public/sw.js) mostra o aviso.

import { supabase, unwrap } from './supabase';
import { base64UrlToBytes, sameKey, scheduleRow, TRIGGER_TYPES, type ScheduleRequest } from './webPushSchedule';

/** Este navegador recebe avisos? (No iPhone, só com o app na tela de início, iOS 16.4 ou mais novo.) */
export const webPushSupported =
  typeof window !== 'undefined' &&
  typeof navigator !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window &&
  window.location?.protocol === 'https:';

/** iPhone ou iPad no navegador, sem o app na tela de início: lá o push só funciona instalado. */
export function needsHomeScreen(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installed = (navigator as { standalone?: boolean }).standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
  return ios && !installed;
}

/** O service worker é registrado pelo public/index.html; sem ele em 15 s, desiste. */
function serviceWorker(): Promise<ServiceWorkerRegistration> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('O serviço de avisos do navegador não iniciou. Recarregue a página.')), 15_000)),
  ]);
}

let serverKey: Promise<Uint8Array<ArrayBuffer>> | null = null;
function applicationServerKey(): Promise<Uint8Array<ArrayBuffer>> {
  serverKey ??= (async () => {
    const key = unwrap(await supabase.rpc('push_public_key')) as string | null;
    if (!key) throw new Error('Os avisos no navegador ainda não foram configurados no servidor.');
    return base64UrlToBytes(key);
  })().catch((err) => {
    serverKey = null;
    throw err;
  });
  return serverKey;
}

/** A inscrição deste navegador no serviço de push (refeita se a chave do servidor mudou). */
async function browserSubscription(): Promise<PushSubscription> {
  const registration = await serviceWorker();
  const key = await applicationServerKey();
  const existing = await registration.pushManager.getSubscription();
  if (existing && sameKey(existing.options.applicationServerKey, key)) return existing;
  if (existing) await existing.unsubscribe().catch(() => undefined);
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

let subscriptionId: Promise<string> | null = null;

/**
 * A última inscrição deste navegador no servidor. Se o navegador trocar de
 * inscrição (chave nova, inscrição vencida), o servidor passa a agenda dela
 * para a nova: os lembretes guardados aqui continuam valendo.
 */
const LAST_SUBSCRIPTION_KEY = 'nooky:push-subscription';
const lastSubscription = {
  get: (): string | null => {
    try {
      return window.localStorage.getItem(LAST_SUBSCRIPTION_KEY);
    } catch {
      return null;
    }
  },
  set: (id: string | null) => {
    try {
      if (id) window.localStorage.setItem(LAST_SUBSCRIPTION_KEY, id);
      else window.localStorage.removeItem(LAST_SUBSCRIPTION_KEY);
    } catch {
      // Sem armazenamento: a próxima sincronização refaz o que faltar.
    }
  },
};

/** Inscreve este navegador no servidor (uma vez por sessão do app) e devolve o id da inscrição. */
function ensureSubscription(): Promise<string> {
  subscriptionId ??= (async () => {
    const { endpoint, keys } = (await browserSubscription()).toJSON();
    if (!endpoint || !keys?.p256dh || !keys.auth) throw new Error('O navegador não completou a inscrição para avisos.');
    const id = unwrap(
      await supabase.rpc('register_push_subscription', {
        p_endpoint: endpoint,
        p_p256dh: keys.p256dh,
        p_auth: keys.auth,
        p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        p_previous: lastSubscription.get(),
      }),
    ) as string;
    lastSubscription.set(id);
    return id;
  })().catch((err) => {
    subscriptionId = null;
    throw err;
  });
  return subscriptionId;
}

const granted = () => Notification.permission === 'granted';

/** O agendador do web, no formato que src/lib/reminders.ts usa do expo-notifications. */
export const webScheduler = {
  SchedulableTriggerInputTypes: TRIGGER_TYPES,
  AndroidImportance: { HIGH: 4 },
  setNotificationHandler: () => undefined,
  setNotificationChannelAsync: async () => null,
  getPermissionsAsync: async () => ({ granted: granted() }),
  requestPermissionsAsync: async () => {
    // O pedido sai primeiro, ainda dentro do toque da pessoa (o Safari exige).
    if ((await Notification.requestPermission()) !== 'granted') return { granted: false };
    await ensureSubscription();
    return { granted: true };
  },
  scheduleNotificationAsync: async (request: ScheduleRequest): Promise<string> => {
    const id = crypto.randomUUID();
    unwrap(await supabase.from('push_schedule').insert(scheduleRow(id, await ensureSubscription(), request)));
    return id;
  },
  cancelScheduledNotificationAsync: async (id: string): Promise<void> => {
    unwrap(await supabase.from('push_schedule').delete().eq('id', id));
  },
  getAllScheduledNotificationsAsync: async (): Promise<{ identifier: string }[]> => {
    const rows = unwrap(await supabase.from('push_schedule').select('id').eq('subscription_id', await ensureSubscription())) as { id: string }[];
    return rows.map((row) => ({ identifier: row.id }));
  },
};

/**
 * Tira da agenda do servidor o que o app não conhece mais (`keep`: os ids
 * guardados neste navegador), sobra de uma sincronização que caiu no meio.
 * Também renova a inscrição (chaves e fuso). Sem permissão, nada a fazer.
 */
export async function pruneWebSchedule(keep: string[]): Promise<void> {
  if (!webPushSupported || !granted()) return;
  unwrap(await supabase.rpc('prune_push_schedule', { p_subscription_id: await ensureSubscription(), p_keep: keep }));
}

/** Este navegador deixa de receber avisos (ao sair da conta). */
export async function unregisterWebPush(): Promise<void> {
  if (!webPushSupported) return;
  subscriptionId = null;
  lastSubscription.set(null);
  const registration = await serviceWorker().catch(() => null);
  const subscription = await registration?.pushManager.getSubscription().catch(() => null);
  if (!subscription) return;
  await supabase.rpc('unregister_push_subscription', { p_endpoint: subscription.endpoint });
  await subscription.unsubscribe().catch(() => undefined);
}

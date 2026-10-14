// Avisos no navegador (Web Push). No celular, os lembretes são notificações
// locais (expo-notifications); no web, a mesma agenda vai para o servidor
// (public.push_schedule) e a função send-push manda cada aviso na hora,
// mesmo com o app fechado. Este módulo faz, no web, o papel do
// expo-notifications para src/lib/reminders.ts: pedir permissão, agendar,
// cancelar e listar. O service worker (public/sw.js) mostra o aviso.

import { supabase, unwrap } from './supabase';
import { base64UrlToBytes, isServerPush, sameKey, scheduleRow, TRIGGER_TYPES, type ScheduleRequest } from './webPushSchedule';

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
  if (existing) {
    // A inscrição antiga (e a agenda dela) sai do servidor: o app refaz a agenda na nova.
    await supabase.rpc('unregister_push_subscription', { p_endpoint: existing.endpoint }).then(
      () => undefined,
      () => undefined,
    );
    await existing.unsubscribe().catch(() => undefined);
  }
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

/** A inscrição registrada nesta sessão do app, e com qual fuso (mudou de fuso: registra de novo). */
let registered: { timezone: string; id: Promise<string> } | null = null;

const currentTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** A inscrição no servidor mudou desde a última vez: a agenda guardada no app não vale mais. */
let subscriptionChanged = false;

/**
 * A última inscrição deste navegador no servidor. Se mudou (chave nova,
 * inscrição vencida e apagada pelo servidor), a agenda que o app guarda aqui
 * não está na nova: src/lib/reminders.ts refaz tudo (subscriptionChanged).
 */
const LAST_SUBSCRIPTION_KEY = 'kotii:push-subscription';
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

/**
 * "Alguém indo ao mercado" desligado neste navegador. A opção vale no
 * servidor, na inscrição (push_subscriptions.market_trips); a escolha fica
 * também aqui porque a inscrição troca (chave nova, inscrição vencida, sair
 * e entrar na conta) e a nova nasce com a opção ligada.
 */
const MARKET_TRIPS_OFF_KEY = 'kotii:push-market-trips-off';
const marketTripsOff = {
  get: (): boolean => {
    try {
      return window.localStorage.getItem(MARKET_TRIPS_OFF_KEY) === '1';
    } catch {
      return false;
    }
  },
  set: (off: boolean) => {
    try {
      if (off) window.localStorage.setItem(MARKET_TRIPS_OFF_KEY, '1');
      else window.localStorage.removeItem(MARKET_TRIPS_OFF_KEY);
    } catch {
      // Sem armazenamento: vale o que está no servidor.
    }
  },
};

/** O banco ainda não tem a opção de "alguém indo ao mercado": a função não existe (PGRST202 no PostgREST, 42883 no Postgres). */
const marketTripsOptionMissing = (error: unknown) =>
  ['PGRST202', '42883'].includes(String((error as { code?: unknown } | null)?.code));

/**
 * Inscreve este navegador no servidor e devolve o id da inscrição: uma vez
 * por sessão do app, e de novo se o fuso mudou (o app ficou aberto numa
 * viagem), para os avisos diários tocarem na hora de lá. `fresh` confere no
 * servidor mesmo assim: a inscrição pode ter sido apagada com o app aberto
 * (o serviço de push a recusou).
 */
function ensureSubscription({ fresh = false }: { fresh?: boolean } = {}): Promise<string> {
  const timezone = currentTimezone();
  if (!fresh && registered?.timezone === timezone) return registered.id;
  const id: Promise<string> = (async () => {
    const { endpoint, keys } = (await browserSubscription()).toJSON();
    if (!endpoint || !keys?.p256dh || !keys.auth) throw new Error('O navegador não completou a inscrição para avisos.');
    const subscription = unwrap(
      await supabase.rpc('register_push_subscription', {
        p_endpoint: endpoint,
        p_p256dh: keys.p256dh,
        p_auth: keys.auth,
        p_timezone: timezone,
      }),
    ) as string;
    const previous = lastSubscription.get();
    // Inscrição nova para este navegador: quem tinha desligado "Alguém indo ao
    // mercado" continua sem receber. A troca só fica registrada aqui depois de
    // o servidor guardar isso: se ele não guardar, a inscrição falha (os avisos
    // são refeitos na próxima vez) e a tentativa se repete, em vez de a nova
    // ficar ligada sem ninguém saber. Num banco de antes da opção não há o que
    // desligar. O cliente do Supabase devolve o erro no resultado, não lança.
    if (previous !== subscription && marketTripsOff.get()) {
      const { error } = await supabase.rpc('set_push_market_trips', { p_endpoint: endpoint, p_enabled: false });
      if (error && !marketTripsOptionMissing(error)) throw error;
    }
    if (previous && previous !== subscription) subscriptionChanged = true;
    lastSubscription.set(subscription);
    return subscription;
  })().catch((err) => {
    if (registered?.id === id) registered = null;
    throw err;
  });
  registered = { timezone, id };
  return id;
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
    const [id] = await webScheduler.scheduleManyAsync([request]);
    return id;
  },
  /** O plano inteiro numa gravação só: entra tudo ou nada (sem aviso solto no servidor). */
  scheduleManyAsync: async (requests: ScheduleRequest[]): Promise<string[]> => {
    if (!requests.length) return [];
    const subscription = await ensureSubscription();
    const rows = requests.map((request) => scheduleRow(crypto.randomUUID(), subscription, request));
    unwrap(await supabase.from('push_schedule').insert(rows));
    return rows.map((row) => row.id);
  },
  cancelScheduledNotificationAsync: async (id: string): Promise<void> => {
    unwrap(await supabase.from('push_schedule').delete().eq('id', id));
  },
  /** Os lembretes que o app agendou: o que o servidor pôs na agenda por conta própria não entra. */
  getAllScheduledNotificationsAsync: async (): Promise<{ identifier: string }[]> => {
    const rows = unwrap(await supabase.from('push_schedule').select('id, data').eq('subscription_id', await ensureSubscription())) as {
      id: string;
      data: unknown;
    }[];
    return rows.filter((row) => !isServerPush(row.data)).map((row) => ({ identifier: row.id }));
  },
};

/**
 * Tira da agenda do servidor o que o app não conhece mais (`keep`: os ids
 * guardados neste navegador), sobra de uma sincronização que caiu no meio.
 * Também confere a inscrição no servidor (chaves e fuso) e diz se ela mudou:
 * aí a agenda guardada no app não está no servidor e precisa ser refeita.
 * Sem permissão, nada a fazer.
 */
export async function pruneWebSchedule(keep: string[]): Promise<{ changed: boolean }> {
  if (!webPushSupported || !granted()) return { changed: false };
  const subscription = await ensureSubscription({ fresh: true });
  // Inscrição nova: nada do que o app guarda está nela; quem chamou refaz a agenda.
  const changed = subscriptionChanged;
  subscriptionChanged = false;
  if (!changed) unwrap(await supabase.rpc('prune_push_schedule', { p_subscription_id: subscription, p_keep: keep }));
  return { changed };
}

/** A inscrição que o navegador já tem, sem criar uma (null: nenhuma, ou o service worker não iniciou). */
async function currentBrowserSubscription(): Promise<PushSubscription | null> {
  const registration = await serviceWorker().catch(() => null);
  return (await registration?.pushManager.getSubscription().catch(() => null)) ?? null;
}

/**
 * Este navegador recebe o aviso de "alguém indo ao mercado"? Só com a
 * permissão dada, a inscrição no servidor e a opção ligada nela. A leitura
 * vai ao servidor mesmo sem inscrição: num banco de antes da opção ela
 * falha (a coluna não existe) e quem chamou esconde a opção.
 */
export async function getMarketTripsPush(): Promise<boolean> {
  const rows = unwrap(await supabase.from('push_subscriptions').select('endpoint, market_trips')) as {
    endpoint: string;
    market_trips: boolean;
  }[];
  if (!webPushSupported || !granted()) return false;
  const endpoint = (await currentBrowserSubscription())?.endpoint;
  const mine = rows.find((row) => row.endpoint === endpoint);
  // Desligada no servidor sem a marca daqui (a migração a desligou para quem não tinha aviso nenhum, ou os dados
  // do navegador foram limpos): a marca volta, para a inscrição que trocar esta não nascer ligada.
  if (mine && !mine.market_trips) marketTripsOff.set(true);
  return Boolean(mine?.market_trips);
}

/**
 * Liga ou desliga o aviso de "alguém indo ao mercado" neste navegador.
 * Ligar inscreve o navegador, como qualquer outro aviso; devolve false sem a
 * permissão. Quem pede a permissão é src/lib/reminders.ts, ainda no toque e
 * antes da fila: aqui, depois da espera, o navegador recusaria o pedido.
 * Desligar deixa a inscrição: os outros avisos continuam.
 */
export async function setMarketTripsPush(enabled: boolean): Promise<boolean> {
  if (enabled) {
    if (!granted()) return false;
    // Confere no servidor: a inscrição pode ter sido apagada com o app aberto.
    await ensureSubscription({ fresh: true });
  }
  const endpoint = (await currentBrowserSubscription())?.endpoint;
  if (endpoint) unwrap(await supabase.rpc('set_push_market_trips', { p_endpoint: endpoint, p_enabled: enabled }));
  else if (enabled) throw new Error('O navegador não completou a inscrição para avisos.');
  // Só depois de o servidor aceitar. Ligar que falha no meio (a inscrição, ou a opção) deixa guardada a
  // escolha de não receber: a inscrição que trocar esta continua nascendo desligada. E sem a opção no
  // banco, nada fica guardado aqui.
  marketTripsOff.set(!enabled);
  return true;
}

/** Este navegador deixa de receber avisos (ao sair da conta). */
export async function unregisterWebPush(): Promise<void> {
  if (!webPushSupported) return;
  registered = null;
  lastSubscription.set(null);
  const registration = await serviceWorker().catch(() => null);
  const subscription = await registration?.pushManager.getSubscription().catch(() => null);
  if (!subscription) return;
  await supabase.rpc('unregister_push_subscription', { p_endpoint: subscription.endpoint });
  await subscription.unsubscribe().catch(() => undefined);
}

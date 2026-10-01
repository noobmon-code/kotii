import { afterEach, describe, expect, it, jest } from '@jest/globals';

type WebPush = typeof import('../webPush');

// Navegador e Supabase em memória: o PushManager, a permissão, o fuso e as
// chamadas ao banco.
async function inBrowser(scenario: (webPush: WebPush, browser: { rpc: [string, Record<string, unknown>][]; inserts: unknown[][]; setTimezone: (tz: string) => void }) => Promise<void>) {
  const rpc: [string, Record<string, unknown>][] = [];
  const inserts: unknown[][] = [];
  let timezone = 'America/Sao_Paulo';
  const storage = new Map<string, string>();
  let current: unknown = null;
  const g = globalThis as Record<string, unknown>;
  const saved = { window: g.window, navigator: g.navigator, Notification: g.Notification };
  g.window = {
    location: { protocol: 'https:' },
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    },
    PushManager: class {},
    Notification: class {},
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      serviceWorker: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: async () => current,
            subscribe: async ({ applicationServerKey }: { applicationServerKey: Uint8Array }) => {
              current = {
                endpoint: 'https://fcm.googleapis.com/fcm/send/navegador',
                options: { applicationServerKey: applicationServerKey.buffer },
                toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/navegador', keys: { p256dh: 'chave', auth: 'segredo' } }),
                unsubscribe: async () => true,
              };
              return current;
            },
          },
        }),
      },
    },
  });
  g.Notification = { permission: 'granted', requestPermission: async () => 'granted' };
  const spy = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(
    () => ({ resolvedOptions: () => ({ timeZone: timezone }) }) as unknown as Intl.DateTimeFormat,
  );
  try {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../supabase', () => ({
        supabase: {
          rpc: async (name: string, args: Record<string, unknown>) => {
            rpc.push([name, args]);
            if (name === 'push_public_key') return { data: 'BAEC', error: null };
            if (name === 'register_push_subscription') return { data: 'sub-1', error: null };
            return { data: null, error: null };
          },
          from: () => ({
            insert: async (rows: unknown[]) => {
              inserts.push(rows);
              return { data: null, error: null };
            },
          }),
        },
        unwrap: (result: { data: unknown; error: unknown }) => {
          if (result.error) throw result.error;
          return result.data;
        },
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      await scenario(require('../webPush'), { rpc, inserts, setTimezone: (tz) => (timezone = tz) });
    });
  } finally {
    spy.mockRestore();
    g.window = saved.window;
    g.Notification = saved.Notification;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: saved.navigator });
  }
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('avisos no navegador', () => {
  const daily = (hour: number) => ({ content: { title: 'Remédio' }, trigger: { type: 'daily' as const, hour, minute: 0 } });

  it('grava o plano inteiro numa vez só, na inscrição deste navegador', async () => {
    await inBrowser(async (webPush, browser) => {
      expect(webPush.webPushSupported).toBe(true);
      const ids = await webPush.webScheduler.scheduleManyAsync([daily(8), daily(20)]);
      expect(ids).toHaveLength(2);
      expect(browser.inserts).toHaveLength(1);
      expect(browser.inserts[0]).toEqual([
        expect.objectContaining({ id: ids[0], subscription_id: 'sub-1', repeat: 'daily', hour: 8 }),
        expect.objectContaining({ id: ids[1], subscription_id: 'sub-1', repeat: 'daily', hour: 20 }),
      ]);
    });
  });

  it('mudou de fuso com o app aberto: inscreve de novo com o fuso novo (e a inscrição anterior)', async () => {
    await inBrowser(async (webPush, browser) => {
      await webPush.webScheduler.scheduleManyAsync([daily(8)]);
      await webPush.webScheduler.scheduleManyAsync([daily(9)]);
      const registrations = () => browser.rpc.filter(([name]) => name === 'register_push_subscription').map(([, args]) => args);
      expect(registrations()).toEqual([expect.objectContaining({ p_timezone: 'America/Sao_Paulo', p_previous: null })]);
      browser.setTimezone('Europe/Lisbon');
      await webPush.pruneWebSchedule([]);
      expect(registrations()).toHaveLength(2);
      expect(registrations()[1]).toEqual(expect.objectContaining({ p_timezone: 'Europe/Lisbon', p_previous: 'sub-1' }));
    });
  });
});

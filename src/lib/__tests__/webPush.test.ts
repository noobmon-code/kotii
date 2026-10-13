import { afterEach, describe, expect, it, jest } from '@jest/globals';

type WebPush = typeof import('../webPush');

// Navegador e Supabase em memória: o PushManager, a permissão, o fuso e as
// chamadas ao banco.
async function inBrowser(
  scenario: (
    webPush: WebPush,
    browser: {
      rpc: [string, Record<string, unknown>][];
      inserts: unknown[][];
      setTimezone: (tz: string) => void;
      setServerSubscription: (id: string) => void;
      /** O que o banco devolve numa leitura de cada tabela (ou o erro dela). */
      tables: Record<string, unknown[] | { error: unknown }>;
      storage: Map<string, string>;
      setPermission: (permission: string, afterAsking?: string) => void;
      /** O erro que uma chamada ao banco devolve no resultado (como o cliente do Supabase: sem lançar); null: dá certo. */
      failRpc: (decide: ((name: string, args: Record<string, unknown>) => unknown) | null) => void;
    },
  ) => Promise<void>,
  { lastSubscription, tripsOff }: { lastSubscription?: string; tripsOff?: boolean } = {},
) {
  const rpc: [string, Record<string, unknown>][] = [];
  const inserts: unknown[][] = [];
  let timezone = 'America/Sao_Paulo';
  let serverSubscription = 'sub-1';
  let rpcError: ((name: string, args: Record<string, unknown>) => unknown) | null = null;
  const storage = new Map<string, string>(lastSubscription ? [['kotii:push-subscription', lastSubscription]] : []);
  if (tripsOff) storage.set('kotii:push-market-trips-off', '1');
  const tables: Record<string, unknown[] | { error: unknown }> = {};
  const notification = { permission: 'granted', afterAsking: 'granted' };
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
  g.Notification = {
    get permission() {
      return notification.permission;
    },
    requestPermission: async () => (notification.permission = notification.afterAsking),
  };
  const spy = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(
    () => ({ resolvedOptions: () => ({ timeZone: timezone }) }) as unknown as Intl.DateTimeFormat,
  );
  try {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../supabase', () => ({
        supabase: {
          rpc: async (name: string, args: Record<string, unknown>) => {
            rpc.push([name, args]);
            const failed = rpcError?.(name, args);
            if (failed) return { data: null, error: failed };
            if (name === 'push_public_key') return { data: 'BAEC', error: null };
            if (name === 'register_push_subscription') return { data: serverSubscription, error: null };
            return { data: null, error: null };
          },
          from: (table: string) => ({
            insert: async (rows: unknown[]) => {
              inserts.push(rows);
              return { data: null, error: null };
            },
            // A leitura com ou sem filtro (.eq), como o cliente do Supabase: dá para esperar nos dois.
            select: () => {
              const rows = tables[table] ?? [];
              const result = Promise.resolve(Array.isArray(rows) ? { data: rows, error: null } : { data: null, error: rows.error });
              return Object.assign(result, { eq: () => result });
            },
          }),
        },
        unwrap: (result: { data: unknown; error: unknown }) => {
          if (result.error) throw result.error;
          return result.data;
        },
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      await scenario(require('../webPush'), {
        rpc,
        inserts,
        setTimezone: (tz) => (timezone = tz),
        setServerSubscription: (id) => (serverSubscription = id),
        tables,
        storage,
        setPermission: (permission, afterAsking = permission) => Object.assign(notification, { permission, afterAsking }),
        failRpc: (decide) => (rpcError = decide),
      });
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

  it('mudou de fuso com o app aberto: inscreve de novo com o fuso novo', async () => {
    await inBrowser(async (webPush, browser) => {
      await webPush.webScheduler.scheduleManyAsync([daily(8)]);
      await webPush.webScheduler.scheduleManyAsync([daily(9)]);
      const registrations = () => browser.rpc.filter(([name]) => name === 'register_push_subscription').map(([, args]) => args);
      expect(registrations()).toEqual([expect.objectContaining({ p_timezone: 'America/Sao_Paulo' })]);
      browser.setTimezone('Europe/Lisbon');
      await webPush.pruneWebSchedule([]);
      expect(registrations()).toHaveLength(2);
      expect(registrations()[1]).toEqual(expect.objectContaining({ p_timezone: 'Europe/Lisbon' }));
    });
  });

  it('o servidor apagou a inscrição com o app aberto: ao voltar, inscreve de novo e pede a agenda refeita', async () => {
    await inBrowser(async (webPush, browser) => {
      await webPush.webScheduler.scheduleManyAsync([daily(8)]);
      expect(await webPush.pruneWebSchedule(['a'])).toEqual({ changed: false });
      browser.setServerSubscription('sub-2');
      expect(await webPush.pruneWebSchedule(['a'])).toEqual({ changed: true });
      await webPush.webScheduler.scheduleManyAsync([daily(8)]);
      expect(browser.inserts[1]).toEqual([expect.objectContaining({ subscription_id: 'sub-2' })]);
    });
  });

  it('o aviso que o servidor pôs na agenda não conta como lembrete do app', async () => {
    await inBrowser(async (webPush, browser) => {
      browser.tables.push_schedule = [
        { id: 'a', data: { medicationId: 'm1', householdId: 'h1' } },
        { id: 'ida', data: { reminder: 'ida:t1', server: true, householdId: 'h1' } },
        { id: 'b', data: {} },
      ];
      expect(await webPush.webScheduler.getAllScheduledNotificationsAsync()).toEqual([{ identifier: 'a' }, { identifier: 'b' }]);
    });
  });

  describe('"alguém indo ao mercado" neste navegador', () => {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/navegador';
    const flagCalls = (rpc: [string, Record<string, unknown>][]) => rpc.filter(([name]) => name === 'set_push_market_trips').map(([, args]) => args);

    it('ligado só com a permissão, a inscrição deste navegador no servidor e a opção ligada nela', async () => {
      await inBrowser(async (webPush, browser) => {
        // Sem inscrição neste navegador.
        browser.tables.push_subscriptions = [{ endpoint, market_trips: true }];
        expect(await webPush.getMarketTripsPush()).toBe(false);
        // Inscrito (qualquer aviso ligado inscreve).
        await webPush.webScheduler.scheduleManyAsync([daily(8)]);
        expect(await webPush.getMarketTripsPush()).toBe(true);
        browser.tables.push_subscriptions = [{ endpoint, market_trips: false }];
        expect(await webPush.getMarketTripsPush()).toBe(false);
        // A opção ligada em outro navegador da mesma conta não vale para este.
        browser.tables.push_subscriptions = [{ endpoint: 'https://fcm.googleapis.com/fcm/send/outro', market_trips: true }];
        expect(await webPush.getMarketTripsPush()).toBe(false);
        // Permissão tirada nas configurações do navegador.
        browser.tables.push_subscriptions = [{ endpoint, market_trips: true }];
        browser.setPermission('denied');
        expect(await webPush.getMarketTripsPush()).toBe(false);
      });
    });

    it('banco de antes da opção: a leitura falha mesmo sem inscrição (quem chama esconde a opção)', async () => {
      await inBrowser(async (webPush, browser) => {
        browser.setPermission('default');
        browser.tables.push_subscriptions = { error: { code: '42703', message: 'column push_subscriptions.market_trips does not exist' } };
        await expect(webPush.getMarketTripsPush()).rejects.toMatchObject({ code: '42703' });
      });
    });

    it('ligar pede a permissão, inscreve o navegador e liga a opção nele', async () => {
      await inBrowser(async (webPush, browser) => {
        browser.setPermission('default', 'granted');
        expect(await webPush.setMarketTripsPush(true)).toBe(true);
        expect(browser.rpc.map(([name]) => name)).toEqual(['push_public_key', 'register_push_subscription', 'set_push_market_trips']);
        expect(flagCalls(browser.rpc)).toEqual([{ p_endpoint: endpoint, p_enabled: true }]);
      });
    });

    it('sem a permissão, nada é inscrito nem ligado', async () => {
      await inBrowser(async (webPush, browser) => {
        browser.setPermission('default', 'denied');
        expect(await webPush.setMarketTripsPush(true)).toBe(false);
        expect(browser.rpc).toEqual([]);
      });
    });

    it('desligar muda só a opção: a inscrição (e os outros avisos) ficam', async () => {
      await inBrowser(async (webPush, browser) => {
        await webPush.webScheduler.scheduleManyAsync([daily(8)]);
        expect(await webPush.setMarketTripsPush(false)).toBe(true);
        expect(flagCalls(browser.rpc)).toEqual([{ p_endpoint: endpoint, p_enabled: false }]);
        expect(browser.rpc.some(([name]) => name === 'unregister_push_subscription')).toBe(false);
        expect(browser.storage.get('kotii:push-market-trips-off')).toBe('1');
        // Ligar de novo esquece a escolha guardada.
        await webPush.setMarketTripsPush(true);
        expect(browser.storage.has('kotii:push-market-trips-off')).toBe(false);
      });
    });

    it('desligada no servidor sem a escolha guardada aqui (foi a migração, ou os dados do navegador foram limpos): a leitura guarda a escolha', async () => {
      await inBrowser(async (webPush, browser) => {
        await webPush.webScheduler.scheduleManyAsync([daily(8)]);
        browser.tables.push_subscriptions = [{ endpoint, market_trips: false }];
        expect(browser.storage.has('kotii:push-market-trips-off')).toBe(false);
        expect(await webPush.getMarketTripsPush()).toBe(false);
        expect(browser.storage.get('kotii:push-market-trips-off')).toBe('1');
      });
      // Ligada neste navegador (desligada só em outro): nada é guardado.
      await inBrowser(async (webPush, browser) => {
        await webPush.webScheduler.scheduleManyAsync([daily(8)]);
        browser.tables.push_subscriptions = [
          { endpoint, market_trips: true },
          { endpoint: 'https://fcm.googleapis.com/fcm/send/outro', market_trips: false },
        ];
        expect(await webPush.getMarketTripsPush()).toBe(true);
        expect(browser.storage.has('kotii:push-market-trips-off')).toBe(false);
      });
    });

    it('desligar de novo a inscrição trocada falha: a troca não fica registrada, e a próxima vez tenta outra vez', async () => {
      await inBrowser(
        async (webPush, browser) => {
          const refused = { code: '57014', message: 'canceling statement due to statement timeout' };
          browser.failRpc((name) => (name === 'set_push_market_trips' ? refused : null));
          // O servidor não guardou o "desligado" da inscrição nova: nada é agendado nela e a antiga segue como a conhecida.
          await expect(webPush.webScheduler.scheduleManyAsync([daily(8)])).rejects.toBe(refused);
          expect(browser.inserts).toEqual([]);
          expect(browser.storage.get('kotii:push-subscription')).toBe('sub-0');
          expect(browser.storage.get('kotii:push-market-trips-off')).toBe('1');
          // Da próxima vez dá certo: desliga, registra a troca e agenda.
          browser.failRpc(null);
          await webPush.webScheduler.scheduleManyAsync([daily(8)]);
          expect(flagCalls(browser.rpc)).toEqual([
            { p_endpoint: endpoint, p_enabled: false },
            { p_endpoint: endpoint, p_enabled: false },
          ]);
          expect(browser.storage.get('kotii:push-subscription')).toBe('sub-1');
          expect(browser.inserts).toHaveLength(1);
        },
        { tripsOff: true, lastSubscription: 'sub-0' },
      );
    });

    it('banco de antes da opção: a inscrição trocada segue em frente (não há o que desligar)', async () => {
      for (const code of ['PGRST202', '42883']) {
        await inBrowser(
          async (webPush, browser) => {
            browser.failRpc((name) => (name === 'set_push_market_trips' ? { code, message: 'function does not exist' } : null));
            await webPush.webScheduler.scheduleManyAsync([daily(8)]);
            expect(browser.storage.get('kotii:push-subscription')).toBe('sub-1');
            expect(browser.inserts).toHaveLength(1);
          },
          { tripsOff: true, lastSubscription: 'sub-0' },
        );
      }
    });

    it('ligar que falha no meio não esquece a escolha de não receber', async () => {
      const refused = { code: '57014', message: 'canceling statement due to statement timeout' };
      // A opção não foi aceita pelo servidor.
      await inBrowser(
        async (webPush, browser) => {
          await webPush.webScheduler.scheduleManyAsync([daily(8)]);
          browser.failRpc((name, args) => (name === 'set_push_market_trips' && args.p_enabled === true ? refused : null));
          await expect(webPush.setMarketTripsPush(true)).rejects.toBe(refused);
          expect(browser.storage.get('kotii:push-market-trips-off')).toBe('1');
          // Com o servidor de volta, ligar dá certo e a escolha guardada sai.
          browser.failRpc(null);
          expect(await webPush.setMarketTripsPush(true)).toBe(true);
          expect(browser.storage.has('kotii:push-market-trips-off')).toBe(false);
        },
        { tripsOff: true },
      );
      // A inscrição falhou antes de chegar na opção.
      await inBrowser(
        async (webPush, browser) => {
          browser.failRpc((name) => (name === 'register_push_subscription' ? refused : null));
          await expect(webPush.setMarketTripsPush(true)).rejects.toBe(refused);
          expect(browser.storage.get('kotii:push-market-trips-off')).toBe('1');
        },
        { tripsOff: true },
      );
      // Sem a permissão do navegador, também não.
      await inBrowser(
        async (webPush, browser) => {
          browser.setPermission('default', 'denied');
          expect(await webPush.setMarketTripsPush(true)).toBe(false);
          expect(browser.storage.get('kotii:push-market-trips-off')).toBe('1');
        },
        { tripsOff: true },
      );
    });

    it('desligado, e a inscrição trocou (ou a pessoa saiu e entrou): a nova nasce ligada e o navegador a desliga de novo', async () => {
      await inBrowser(
        async (webPush, browser) => {
          await webPush.webScheduler.scheduleManyAsync([daily(8)]);
          expect(flagCalls(browser.rpc)).toEqual([{ p_endpoint: endpoint, p_enabled: false }]);
          // A mesma inscrição conferida de novo: nada a repetir.
          await webPush.pruneWebSchedule([]);
          expect(flagCalls(browser.rpc)).toHaveLength(1);
        },
        { tripsOff: true },
      );
      // Quem nunca desligou não manda nada.
      await inBrowser(async (webPush, browser) => {
        await webPush.webScheduler.scheduleManyAsync([daily(8)]);
        expect(flagCalls(browser.rpc)).toEqual([]);
      });
    });
  });

  it('a inscrição no servidor mudou (a antiga venceu): avisa uma vez, sem limpar a agenda nova', async () => {
    await inBrowser(
      async (webPush, browser) => {
        expect(await webPush.pruneWebSchedule(['a'])).toEqual({ changed: true });
        expect(browser.rpc.some(([name]) => name === 'prune_push_schedule')).toBe(false);
        expect(await webPush.pruneWebSchedule(['a'])).toEqual({ changed: false });
        expect(browser.rpc.filter(([name]) => name === 'prune_push_schedule')).toHaveLength(1);
      },
      { lastSubscription: 'sub-0' },
    );
  });
});

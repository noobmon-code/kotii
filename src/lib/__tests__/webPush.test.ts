import { afterEach, describe, expect, it, jest } from '@jest/globals';

type WebPush = typeof import('../webPush');
type Reminders = typeof import('../reminders');

// Navegador e Supabase em memória: o PushManager, a permissão, o fuso e as
// chamadas ao banco.
async function inBrowser(
  scenario: (
    webPush: WebPush,
    browser: {
      /** As chamadas ao banco, na ordem em que o servidor as atendeu. */
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
      /**
       * O que o servidor faz com uma chamada, antes de responder: o que ele grava fica gravado mesmo quando a
       * resposta se perde no caminho (failRpc). Devolve a resposta (data ou error), ou undefined para a de sempre.
       */
      serve: (handler: ((name: string, args: Record<string, unknown>) => { data?: unknown; error?: unknown } | undefined) | null) => void;
      /** Segura uma chamada ao banco até a promessa devolvida terminar (null: responde já). */
      holdRpc: (decide: ((name: string, args: Record<string, unknown>) => Promise<void> | null) | null) => void;
      /** Segura a resposta de uma leitura de tabela: o servidor já leu na hora do pedido, a resposta chega depois. */
      holdSelect: (decide: ((table: string) => Promise<void> | null) | null) => void;
      /** Quantas vezes o navegador pediu a permissão. */
      asked: () => number;
      /** src/lib/reminders.ts neste navegador, por cima deste mesmo módulo do Web Push. */
      reminders: () => Reminders;
    },
  ) => Promise<void>,
  { lastSubscription, tripsOff }: { lastSubscription?: string; tripsOff?: boolean } = {},
) {
  const rpc: [string, Record<string, unknown>][] = [];
  const inserts: unknown[][] = [];
  let timezone = 'America/Sao_Paulo';
  let serverSubscription = 'sub-1';
  let rpcError: ((name: string, args: Record<string, unknown>) => unknown) | null = null;
  let rpcServe: ((name: string, args: Record<string, unknown>) => { data?: unknown; error?: unknown } | undefined) | null = null;
  let rpcHold: ((name: string, args: Record<string, unknown>) => Promise<void> | null) | null = null;
  let selectHold: ((table: string) => Promise<void> | null) | null = null;
  let asked = 0;
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
    requestPermission: async () => {
      asked += 1;
      return (notification.permission = notification.afterAsking);
    },
  };
  const spy = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(
    () => ({ resolvedOptions: () => ({ timeZone: timezone }) }) as unknown as Intl.DateTimeFormat,
  );
  try {
    await jest.isolateModulesAsync(async () => {
      // Para src/lib/reminders.ts, quando o teste o usa: no navegador, sem nada guardado.
      jest.doMock('react-native', () => ({ Platform: { OS: 'web' } }));
      jest.doMock('expo', () => ({ isRunningInExpoGo: () => false }));
      jest.doMock('@react-native-async-storage/async-storage', () => ({
        getItem: async () => null,
        setItem: async () => undefined,
        removeItem: async () => undefined,
        getAllKeys: async () => [],
      }));
      jest.doMock('../supabase', () => ({
        supabase: {
          rpc: async (name: string, args: Record<string, unknown>) => {
            const held = rpcHold?.(name, args);
            if (held) await held;
            rpc.push([name, args]);
            const served = rpcServe?.(name, args);
            const failed = rpcError?.(name, args);
            if (failed) return { data: null, error: failed };
            if (served) return { data: served.data ?? null, error: served.error ?? null };
            if (name === 'push_public_key') return { data: 'BAEC', error: null };
            if (name === 'register_push_subscription') return { data: serverSubscription, error: null };
            return { data: null, error: null };
          },
          from: (table: string) => ({
            insert: async (rows: unknown[]) => {
              inserts.push(rows);
              return { data: null, error: null };
            },
            // A leitura com ou sem filtro (.eq), como o cliente do Supabase: dá para esperar nos dois. O servidor lê
            // as linhas na hora do pedido (uma cópia: o que mudar depois não entra nesta resposta).
            select: () => {
              const rows = tables[table] ?? [];
              const answer = Array.isArray(rows) ? { data: rows.map((row) => ({ ...(row as object) })), error: null } : { data: null, error: rows.error };
              const held = selectHold?.(table);
              const result = held ? held.then(() => answer) : Promise.resolve(answer);
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
        serve: (handler) => (rpcServe = handler),
        holdRpc: (decide) => (rpcHold = decide),
        holdSelect: (decide) => (selectHold = decide),
        asked: () => asked,
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        reminders: () => require('../reminders') as Reminders,
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

type Browser = Parameters<Parameters<typeof inBrowser>[0]>[1];

// Como o postgrest-js devolve o pedido que não voltou: o erro do fetch, sem código.
const FETCH_FAILED = { code: '', message: 'TypeError: Failed to fetch' };

/**
 * As inscrições no servidor, com estado, como as funções do banco: register devolve a linha deste endereço
 * sem mexer na opção dela, ou cria uma, ligada, menos quando o navegador pede desligada (o quinto
 * argumento); set_push_market_trips muda a opção da linha. `fiveArgs: false` é o banco (ou o cache do
 * PostgREST) ainda sem a inscrição com a escolha. O pedido que se perde depois de o servidor gravar é o
 * failRpc; o que nem chega ao servidor, `unreachable`.
 */
function subscriptionServer(browser: Browser, { fiveArgs = true }: { fiveArgs?: boolean } = {}) {
  const rows: { id: string; endpoint: string; market_trips: boolean }[] = [];
  let nextId = 'sub-1';
  let unreachable: ((name: string) => boolean) | null = null;
  browser.tables.push_subscriptions = rows;
  browser.serve((name, args) => {
    if (unreachable?.(name)) return { error: FETCH_FAILED };
    const row = rows.find((r) => r.endpoint === args.p_endpoint);
    if (name === 'register_push_subscription') {
      if ('p_market_trips' in args && !fiveArgs) {
        return {
          error: {
            code: 'PGRST202',
            message: 'Could not find the function public.register_push_subscription(p_auth, p_endpoint, p_market_trips, p_p256dh, p_timezone) in the schema cache',
          },
        };
      }
      if (row) return { data: row.id };
      rows.push({ id: nextId, endpoint: String(args.p_endpoint), market_trips: args.p_market_trips !== false });
      return { data: nextId };
    }
    if (name === 'set_push_market_trips') {
      if (row) row.market_trips = args.p_enabled !== false;
      return { data: Boolean(row) };
    }
    return undefined;
  });
  return {
    rows,
    /** A inscrição sai do servidor (a send-push a apaga quando o serviço de push a recusa); a próxima ganha `id`. */
    drop: (id: string) => {
      rows.splice(0, rows.length);
      nextId = id;
    },
    /** O cache do PostgREST passou a conhecer a inscrição com a escolha. */
    withFiveArgs: () => {
      fiveArgs = true;
    },
    /** Os pedidos que não chegam ao servidor (sinal fraco, aba fechada): nada muda nele. */
    unreachable: (decide: ((name: string) => boolean) | null) => {
      unreachable = decide;
    },
  };
}

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
    const registrations = (rpc: [string, Record<string, unknown>][]) =>
      rpc.filter(([name]) => name === 'register_push_subscription').map(([, args]) => args);

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

    // A permissão é pedida em lib/reminders, no toque e antes da fila (ver os testes dos dois toques, abaixo).
    it('ligar pede a permissão, inscreve o navegador e liga a opção nele', async () => {
      await inBrowser(async (_webPush, browser) => {
        browser.setPermission('default', 'granted');
        expect(await browser.reminders().setMarketTripPush(true)).toBe(true);
        expect(browser.asked()).toBe(1);
        // A inscrição sai com a permissão dada, e é conferida de novo (pode ter sido apagada com o app aberto).
        expect(browser.rpc.map(([name]) => name)).toEqual([
          'push_public_key',
          'register_push_subscription',
          'register_push_subscription',
          'set_push_market_trips',
        ]);
        // A inscrição leva a escolha deste navegador (sem nada guardado aqui: ligada).
        expect(registrations(browser.rpc)).toEqual([
          { p_endpoint: endpoint, p_p256dh: 'chave', p_auth: 'segredo', p_timezone: 'America/Sao_Paulo', p_market_trips: true },
          { p_endpoint: endpoint, p_p256dh: 'chave', p_auth: 'segredo', p_timezone: 'America/Sao_Paulo', p_market_trips: true },
        ]);
        expect(flagCalls(browser.rpc)).toEqual([{ p_endpoint: endpoint, p_enabled: true }]);
      });
    });

    it('sem a permissão, nada é inscrito nem ligado', async () => {
      await inBrowser(async (webPush, browser) => {
        browser.setPermission('default', 'denied');
        expect(await browser.reminders().setMarketTripPush(true)).toBe(false);
        expect(browser.asked()).toBe(1);
        expect(browser.rpc).toEqual([]);
        // Chamado direto, sem a permissão, nem pede (fora do toque o navegador recusaria) nem inscreve.
        expect(await webPush.setMarketTripsPush(true)).toBe(false);
        expect(browser.asked()).toBe(1);
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
            // Nem a inscrição com a escolha, nem a opção: as duas funções ainda não existem.
            browser.failRpc((name, args) =>
              (name === 'register_push_subscription' && 'p_market_trips' in args) || name === 'set_push_market_trips'
                ? { code, message: `function public.${name} does not exist` }
                : null,
            );
            await webPush.webScheduler.scheduleManyAsync([daily(8)]);
            expect(registrations(browser.rpc).at(-1)).toEqual({ p_endpoint: endpoint, p_p256dh: 'chave', p_auth: 'segredo', p_timezone: 'America/Sao_Paulo' });
            expect(browser.storage.get('kotii:push-subscription')).toBe('sub-1');
            expect(browser.inserts).toHaveLength(1);
          },
          { tripsOff: true, lastSubscription: 'sub-0' },
        );
      }
    });

    it('um 42883 de outra função, de dentro da que desliga, não é o banco de antes: a troca falha e tenta de novo', async () => {
      await inBrowser(
        async (webPush, browser) => {
          const inner = { code: '42883', message: 'function public.is_push_endpoint(text) does not exist' };
          browser.failRpc((name) => (name === 'set_push_market_trips' ? inner : null));
          await expect(webPush.webScheduler.scheduleManyAsync([daily(8)])).rejects.toBe(inner);
          expect(browser.inserts).toEqual([]);
          expect(browser.storage.get('kotii:push-subscription')).toBe('sub-0');
        },
        { tripsOff: true, lastSubscription: 'sub-0' },
      );
    });

    it('banco sem a inscrição com a escolha (ou o cache do PostgREST ainda sem ela): a de quatro argumentos e, depois, o pedido que desliga', async () => {
      const missing = [
        {
          code: 'PGRST202',
          message: 'Could not find the function public.register_push_subscription(p_auth, p_endpoint, p_market_trips, p_p256dh, p_timezone) in the schema cache',
        },
        { code: '42883', message: 'function public.register_push_subscription(text, text, text, text, boolean) does not exist' },
      ];
      for (const error of missing) {
        await inBrowser(
          async (webPush, browser) => {
            browser.failRpc((name, args) => (name === 'register_push_subscription' && 'p_market_trips' in args ? error : null));
            await webPush.webScheduler.scheduleManyAsync([daily(8)]);
            expect(registrations(browser.rpc)).toEqual([
              { p_endpoint: endpoint, p_p256dh: 'chave', p_auth: 'segredo', p_timezone: 'America/Sao_Paulo', p_market_trips: false },
              { p_endpoint: endpoint, p_p256dh: 'chave', p_auth: 'segredo', p_timezone: 'America/Sao_Paulo' },
            ]);
            // A de quatro argumentos cria a inscrição ligada: o pedido seguinte a desliga, como antes.
            expect(flagCalls(browser.rpc)).toEqual([{ p_endpoint: endpoint, p_enabled: false }]);
            expect(browser.storage.get('kotii:push-subscription')).toBe('sub-1');
            expect(browser.inserts).toHaveLength(1);
          },
          { tripsOff: true, lastSubscription: 'sub-0' },
        );
      }
      // Outro erro, até um 42883 que fala de outra função (de dentro desta), não é o banco antigo: a inscrição
      // falha e tenta de novo depois, sem cair na de quatro argumentos.
      await inBrowser(
        async (webPush, browser) => {
          const inner = { code: '42883', message: 'function public.is_push_endpoint(text) does not exist' };
          browser.failRpc((name) => (name === 'register_push_subscription' ? inner : null));
          await expect(webPush.webScheduler.scheduleManyAsync([daily(8)])).rejects.toBe(inner);
          expect(registrations(browser.rpc)).toHaveLength(1);
          expect(browser.storage.get('kotii:push-subscription')).toBe('sub-0');
        },
        { tripsOff: true, lastSubscription: 'sub-0' },
      );
    });

    it('desligado aqui, e a inscrição trocou: a nova já nasce desligada no servidor, mesmo que o pedido seguinte se perca', async () => {
      await inBrowser(
        async (webPush, browser) => {
          const server = subscriptionServer(browser);
          // O pedido que desliga nem chega ao servidor.
          server.unreachable((name) => name === 'set_push_market_trips');
          await expect(webPush.webScheduler.scheduleManyAsync([daily(8)])).rejects.toBe(FETCH_FAILED);
          // A escolha foi no mesmo pedido da inscrição: nenhum aviso de ida chega a este navegador no meio tempo.
          expect(registrations(browser.rpc)).toEqual([expect.objectContaining({ p_endpoint: endpoint, p_market_trips: false })]);
          expect(server.rows).toEqual([{ id: 'sub-1', endpoint, market_trips: false }]);
          expect(await webPush.getMarketTripsPush()).toBe(false);
          expect(browser.storage.get('kotii:push-market-trips-off')).toBe('1');
          // O pedido seguinte continua conferindo (a linha podia ser de antes), e a troca só fica registrada depois dele.
          expect(browser.storage.get('kotii:push-subscription')).toBe('sub-0');
          server.unreachable(null);
          await webPush.webScheduler.scheduleManyAsync([daily(8)]);
          expect(browser.storage.get('kotii:push-subscription')).toBe('sub-1');
          expect(server.rows).toEqual([{ id: 'sub-1', endpoint, market_trips: false }]);
          expect(browser.inserts).toHaveLength(1);
        },
        { tripsOff: true, lastSubscription: 'sub-0' },
      );
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

    it('desligado, e a inscrição trocou (ou a pessoa saiu e entrou): a nova é pedida desligada, e o navegador confere com o pedido que desliga', async () => {
      await inBrowser(
        async (webPush, browser) => {
          await webPush.webScheduler.scheduleManyAsync([daily(8)]);
          expect(registrations(browser.rpc)).toEqual([expect.objectContaining({ p_market_trips: false })]);
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

    it('ligar que chegou ao servidor com a resposta perdida: a leitura seguinte esquece o "desligado", e a inscrição que trocar esta nasce ligada', async () => {
      await inBrowser(
        async (webPush, browser) => {
          const server = subscriptionServer(browser);
          // Este navegador desligou, e a inscrição dele já está assentada (é a que ele conhece).
          await webPush.webScheduler.scheduleManyAsync([daily(8)]);
          expect(server.rows).toEqual([{ id: 'sub-1', endpoint, market_trips: false }]);
          // Ligar: o servidor grava, mas a resposta se perde no caminho.
          browser.failRpc((name, args) => (name === 'set_push_market_trips' && args.p_enabled === true ? FETCH_FAILED : null));
          await expect(webPush.setMarketTripsPush(true)).rejects.toBe(FETCH_FAILED);
          expect(server.rows[0].market_trips).toBe(true);
          expect(browser.storage.get('kotii:push-market-trips-off')).toBe('1');
          browser.failRpc(null);
          // A leitura de depois (a da tela, quando a mudança termina): ligada, na inscrição que este navegador conhece.
          expect(await webPush.getMarketTripsPush()).toBe(true);
          expect(browser.storage.has('kotii:push-market-trips-off')).toBe(false);
          // Semanas depois a inscrição é trocada: a nova nasce ligada, como a pessoa deixou, sem pedido que a desligue.
          server.drop('sub-2');
          expect(await webPush.pruneWebSchedule([])).toEqual({ changed: true });
          expect(server.rows).toEqual([{ id: 'sub-2', endpoint, market_trips: true }]);
          expect(flagCalls(browser.rpc)).toEqual([{ p_endpoint: endpoint, p_enabled: true }]);
          expect(await webPush.getMarketTripsPush()).toBe(true);
        },
        { tripsOff: true, lastSubscription: 'sub-1' },
      );
    });

    it('a inscrição nova ainda sem assentar (ligada no servidor e desligada aqui): a leitura não esquece o "desligado", e a próxima vez desliga a linha', async () => {
      await inBrowser(
        async (webPush, browser) => {
          // O cache do PostgREST ainda sem a inscrição com a escolha: a de quatro argumentos cria a linha ligada, e o
          // pedido que a desligaria não chega ao servidor.
          const server = subscriptionServer(browser, { fiveArgs: false });
          server.unreachable((name) => name === 'set_push_market_trips');
          await expect(webPush.webScheduler.scheduleManyAsync([daily(8)])).rejects.toBe(FETCH_FAILED);
          expect(server.rows).toEqual([{ id: 'sub-1', endpoint, market_trips: true }]);
          expect(browser.storage.get('kotii:push-subscription')).toBe('sub-0');
          // A tela lê: ligada no servidor, mas numa inscrição que este navegador ainda não assentou. A marca fica.
          expect(await webPush.getMarketTripsPush()).toBe(true);
          expect(browser.storage.get('kotii:push-market-trips-off')).toBe('1');
          // Na próxima vez, com o cache em dia: a inscrição com a escolha não muda a linha que já existe, e o
          // pedido seguinte a desliga.
          server.withFiveArgs();
          server.unreachable(null);
          await webPush.webScheduler.scheduleManyAsync([daily(8)]);
          expect(registrations(browser.rpc).at(-1)).toEqual(expect.objectContaining({ p_market_trips: false }));
          expect(server.rows).toEqual([{ id: 'sub-1', endpoint, market_trips: false }]);
          expect(browser.storage.get('kotii:push-subscription')).toBe('sub-1');
          expect(await webPush.getMarketTripsPush()).toBe(false);
          expect(browser.storage.get('kotii:push-market-trips-off')).toBe('1');
        },
        { tripsOff: true, lastSubscription: 'sub-0' },
      );
    });

    it('uma leitura que começou antes de uma mudança não mexe na escolha guardada depois dela', async () => {
      await inBrowser(
        async (webPush, browser) => {
          const server = subscriptionServer(browser);
          await webPush.webScheduler.scheduleManyAsync([daily(8)]);
          let release = () => undefined as void;
          const holdRead = () =>
            browser.holdSelect((table) => (table === 'push_subscriptions' ? new Promise<void>((resolve) => (release = resolve)) : null));
          // A leitura sai com a linha desligada e demora a voltar; enquanto isso, a pessoa liga.
          holdRead();
          const before = webPush.getMarketTripsPush();
          browser.holdSelect(null);
          expect(await webPush.setMarketTripsPush(true)).toBe(true);
          expect(browser.storage.has('kotii:push-market-trips-off')).toBe(false);
          release();
          // A resposta velha (desligada) chega depois: a escolha de não receber não volta.
          expect(await before).toBe(false);
          expect(browser.storage.has('kotii:push-market-trips-off')).toBe(false);
          expect(server.rows[0].market_trips).toBe(true);
          // E ao contrário: a leitura sai com a linha ligada, a pessoa desliga, e a resposta velha não apaga a escolha.
          holdRead();
          const again = webPush.getMarketTripsPush();
          browser.holdSelect(null);
          expect(await webPush.setMarketTripsPush(false)).toBe(true);
          expect(browser.storage.get('kotii:push-market-trips-off')).toBe('1');
          release();
          expect(await again).toBe(true);
          expect(browser.storage.get('kotii:push-market-trips-off')).toBe('1');
          expect(server.rows[0].market_trips).toBe(false);
        },
        { tripsOff: true, lastSubscription: 'sub-1' },
      );
    });

    // Um toque por cima do outro, pelo caminho que a tela usa (lib/reminders): uma mudança por vez, na ordem dos toques.
    it('ligar (com a inscrição demorando) e desligar logo em seguida: vale o último toque, no servidor e aqui', async () => {
      await inBrowser(
        async (_webPush, browser) => {
          const reminders = browser.reminders();
          let release = () => undefined as void;
          browser.holdRpc((name) => (name === 'register_push_subscription' ? new Promise<void>((resolve) => (release = resolve)) : null));
          const on = reminders.setMarketTripPush(true);
          // Dois toques são dois eventos: o segundo chega com o primeiro já no servidor, esperando a inscrição.
          await new Promise((resolve) => setTimeout(resolve, 0));
          expect(browser.rpc.map(([name]) => name)).toEqual(['push_public_key']);
          const off = reminders.setMarketTripPush(false);
          await new Promise((resolve) => setTimeout(resolve, 0));
          // O desligar espera o ligar terminar, em vez de passar na frente dele.
          expect(flagCalls(browser.rpc)).toEqual([]);
          release();
          expect(await on).toBe(true);
          expect(await off).toBe(true);
          expect(flagCalls(browser.rpc)).toEqual([
            // A inscrição nova é pedida desligada e conferida pelo pedido que desliga (a escolha guardada aqui); depois, os dois toques.
            { p_endpoint: endpoint, p_enabled: false },
            { p_endpoint: endpoint, p_enabled: true },
            { p_endpoint: endpoint, p_enabled: false },
          ]);
          expect(browser.storage.get('kotii:push-market-trips-off')).toBe('1');
          // Com a permissão já dada, ninguém pediu de novo.
          expect(browser.asked()).toBe(0);
        },
        { tripsOff: true },
      );
    });

    it('ligar com outro pedido na fila: a permissão é pedida já, no toque, e não depois da espera; desligar nunca pede', async () => {
      await inBrowser(async (webPush, browser) => {
        // Inscrito por outro aviso, e ainda sem a permissão do navegador para este.
        await webPush.webScheduler.scheduleManyAsync([daily(8)]);
        browser.setPermission('default', 'granted');
        let release = () => undefined as void;
        browser.holdRpc((name, args) =>
          name === 'set_push_market_trips' && args.p_enabled === false ? new Promise<void>((resolve) => (release = resolve)) : null,
        );
        const off = browser.reminders().setMarketTripPush(false);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(browser.asked()).toBe(0);
        const on = browser.reminders().setMarketTripPush(true);
        await new Promise((resolve) => setTimeout(resolve, 0));
        // O desligar ainda está no servidor: o pedido de permissão do ligar já saiu, e o ligar espera a vez.
        expect(browser.asked()).toBe(1);
        expect(flagCalls(browser.rpc)).toEqual([]);
        release();
        expect(await off).toBe(true);
        expect(await on).toBe(true);
        expect(flagCalls(browser.rpc)).toEqual([
          { p_endpoint: endpoint, p_enabled: false },
          { p_endpoint: endpoint, p_enabled: true },
        ]);
        expect(browser.storage.has('kotii:push-market-trips-off')).toBe(false);
        expect(browser.asked()).toBe(1);
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

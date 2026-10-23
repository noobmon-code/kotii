import { describe, expect, it } from '@jest/globals';

import {
  APP_DASHBOARD_ACTIVITY_NOTE,
  APP_DASHBOARD_INVALID,
  APP_DASHBOARD_PRIVACY,
  APP_FEATURES,
  DASHBOARD_DAYS,
  dashboardView,
  nukeMessagesByDay,
  parseAppDashboard,
  wholePercent,
  type AppDashboardDay,
  type DashboardView,
} from '../appDashboard';
import { addDays, formatShortDate, toISODate } from '../dates';

const TODAY = '2026-10-23';
const TERMS = '2026-10-22';
const NOW = new Date('2026-10-23T15:00:00Z');

type Raw = Record<string, unknown>;

/** A resposta de app_dashboard do contrato, com os números de um banco pequeno. */
function rawDashboard(): Raw {
  return {
    generated_at: '2026-10-23T14:05:00Z',
    today: TODAY,
    accounts: { total: 5, new_7d: 1, new_30d: 3, confirmed: 5, in_household: 4 },
    active: { d1: 2, d7: 3, d30: 5 },
    retention: { eligible: 4, returned: 3 },
    households: { total: 4, shared: 1, members: 5, people_without_app: 2, pets: 1, new_30d: 2 },
    signups: Array.from({ length: 30 }, (_, index) => ({
      day: addDays(TODAY, index - 29),
      count: index === 29 ? 1 : index === 10 ? 2 : 0,
    })),
    daily: [
      { day: '2026-10-20', accounts: 4, active_users: 1, households: 3, ai: {}, backfilled: true },
      { day: '2026-10-21', accounts: 4, active_users: 2, households: 3, ai: {}, backfilled: true },
      { day: '2026-10-22', accounts: 5, active_users: 3, households: 4, ai: { chat: 4, photo: 8 }, backfilled: false },
      { day: '2026-10-23', accounts: 5, active_users: 2, households: 4, ai: { chat: 7, photo: 8 }, backfilled: false },
    ],
    ai: {
      month: '2026-10',
      limits: { chat: 300, photo: 100, menu: 20, nfce: 200, finance: 100 },
      months: [
        { month: '2026-09', kind: 'chat', uses: 10, households: 2 },
        { month: '2026-10', kind: 'chat', uses: 7, households: 1 },
        { month: '2026-10', kind: 'photo', uses: 8, households: 2 },
      ],
      near_limit: [
        { kind: 'chat', households: 0 },
        { kind: 'photo', households: 1 },
        { kind: 'menu', households: 0 },
        { kind: 'nfce', households: 0 },
        { kind: 'finance', households: 0 },
      ],
      at_limit: [
        { kind: 'chat', households: 0 },
        { kind: 'photo', households: 0 },
        { kind: 'menu', households: 2 },
        { kind: 'nfce', households: 0 },
        { kind: 'finance', households: 0 },
      ],
    },
    features: APP_FEATURES.map((feature) => {
      if (feature.key === 'lista') return { key: 'lista', households: 3, households_30d: 2, events_30d: 7 };
      if (feature.key === 'notas') return { key: 'notas', households: 2, households_30d: 2, events_30d: 1 };
      if (feature.key === 'remedios') return { key: 'remedios', households: 1, households_30d: 0, events_30d: 0 };
      return { key: feature.key, households: 0, households_30d: 0, events_30d: 0 };
    }),
    receipt_sources: [
      { source: 'qrcode', receipts_30d: 0 },
      { source: 'ai', receipts_30d: 5 },
      { source: 'manual', receipts_30d: 0 },
    ],
    platforms: [
      { platform: 'ios', users: 2 },
      { platform: 'computador', users: 2 },
      { platform: 'android', users: 1 },
    ],
    clients: [{ client: 'navegador', users: 3 }],
    push: { subscriptions: 6, users: 3 },
    terms: [
      { version: '2026-10-22', users: 3 },
      { version: '2026-10-18', users: 1 },
    ],
    beta: [{ feature: 'finance', users: 1 }],
    shared_prices: { rows: 15 },
  };
}

/** Um banco recém-criado: tudo zero, listas vazias. */
function emptyDashboard(): Raw {
  return {
    generated_at: '2026-10-23T14:05:00Z',
    today: TODAY,
    accounts: { total: 0, new_7d: 0, new_30d: 0, confirmed: 0, in_household: 0 },
    active: { d1: 0, d7: 0, d30: 0 },
    retention: { eligible: 0, returned: 0 },
    households: { total: 0, shared: 0, members: 0, people_without_app: 0, pets: 0, new_30d: 0 },
    signups: Array.from({ length: 30 }, (_, index) => ({ day: addDays(TODAY, index - 29), count: 0 })),
    daily: [],
    ai: {
      month: '2026-10',
      limits: { chat: 300, photo: 100, menu: 20, nfce: 200, finance: 100 },
      months: [],
      near_limit: [],
      at_limit: [],
    },
    features: APP_FEATURES.map((feature) => ({ key: feature.key, households: 0, households_30d: 0, events_30d: 0 })),
    receipt_sources: [
      { source: 'qrcode', receipts_30d: 0 },
      { source: 'ai', receipts_30d: 0 },
      { source: 'manual', receipts_30d: 0 },
    ],
    platforms: [],
    clients: [],
    push: { subscriptions: 0, users: 0 },
    terms: [],
    beta: [],
    shared_prices: { rows: 0 },
  };
}

const view = (raw: Raw = rawDashboard(), now: Date = NOW) => dashboardView(parseAppDashboard(raw), { termsVersion: TERMS, now });

/** Uma cópia com um caminho trocado ("ai.limits.chat"); `undefined` apaga a chave. */
function withValue(raw: Raw, path: string, value: unknown): Raw {
  const copy = JSON.parse(JSON.stringify(raw)) as Raw;
  const keys = path.split('.');
  let target = copy as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
  const last = keys[keys.length - 1];
  if (value === undefined) delete target[last];
  else target[last] = value;
  return copy;
}

/** Todos os textos de uma visão, para as conferências que valem para qualquer frase. */
function allTexts(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(allTexts);
  if (value && typeof value === 'object') return Object.values(value).flatMap(allTexts);
  return [];
}

describe('parseAppDashboard', () => {
  it('lê a resposta do contrato em camelCase', () => {
    const d = parseAppDashboard(rawDashboard());
    expect(d.generatedAt).toBe('2026-10-23T14:05:00Z');
    expect(d.today).toBe(TODAY);
    expect(d.accounts).toEqual({ total: 5, new7d: 1, new30d: 3, confirmed: 5, inHousehold: 4 });
    expect(d.active).toEqual({ d1: 2, d7: 3, d30: 5 });
    expect(d.retention).toEqual({ eligible: 4, returned: 3 });
    expect(d.households).toEqual({ total: 4, shared: 1, members: 5, peopleWithoutApp: 2, pets: 1, new30d: 2 });
    expect(d.signups).toHaveLength(30);
    expect(d.daily[2]).toEqual({ day: '2026-10-22', accounts: 5, activeUsers: 3, households: 4, ai: { chat: 4, photo: 8 }, backfilled: false });
    expect(d.ai.month).toBe('2026-10');
    expect(d.ai.limits).toEqual({ chat: 300, photo: 100, menu: 20, nfce: 200, finance: 100 });
    expect(d.ai.months[0]).toEqual({ month: '2026-09', kind: 'chat', uses: 10, households: 2 });
    expect(d.ai.nearLimit.find((row) => row.kind === 'photo')).toEqual({ kind: 'photo', households: 1 });
    expect(d.ai.atLimit.find((row) => row.kind === 'menu')).toEqual({ kind: 'menu', households: 2 });
    expect(d.features).toHaveLength(APP_FEATURES.length);
    expect(d.features[0]).toEqual({ key: 'lista', households: 3, households30d: 2, events30d: 7 });
    expect(d.receiptSources).toEqual([
      { source: 'qrcode', receipts30d: 0 },
      { source: 'ai', receipts30d: 5 },
      { source: 'manual', receipts30d: 0 },
    ]);
    expect(d.platforms[0]).toEqual({ platform: 'ios', users: 2 });
    expect(d.clients).toEqual([{ client: 'navegador', users: 3 }]);
    expect(d.push).toEqual({ subscriptions: 6, users: 3 });
    expect(d.terms[0]).toEqual({ version: '2026-10-22', users: 3 });
    expect(d.beta).toEqual([{ feature: 'finance', users: 1 }]);
    expect(d.sharedPrices).toEqual({ rows: 15 });
  });

  it('lê o banco recém-criado (tudo zero, listas vazias)', () => {
    const d = parseAppDashboard(emptyDashboard());
    expect(d.daily).toEqual([]);
    expect(d.platforms).toEqual([]);
    expect(d.ai.months).toEqual([]);
  });

  it('o uso da IA guardado como {} é desconhecido; um objeto só com tipos novos sabe que o Nuke deu zero', () => {
    const raw = withValue(rawDashboard(), 'daily', [
      { day: '2026-10-22', accounts: 5, active_users: 3, households: 4, ai: {}, backfilled: false },
      { day: '2026-10-23', accounts: 5, active_users: 2, households: 4, ai: { video: 3 }, backfilled: false },
    ]);
    const d = parseAppDashboard(raw);
    expect(d.daily.map((row) => row.ai)).toEqual([null, {}]);
  });

  it('deixa de fora, sempre do mesmo jeito, o que esta versão do app não conhece', () => {
    let raw = rawDashboard();
    raw = withValue(raw, 'features', [...(raw.features as Raw[]), { key: 'jardim', households: 1, households_30d: 1, events_30d: 3 }]);
    raw = withValue(raw, 'platforms', [{ platform: 'tv', users: 1 }, { platform: 'ios', users: 2 }]);
    raw = withValue(raw, 'clients', [{ client: 'robo', users: 1 }, { client: 'app', users: 1 }]);
    raw = withValue(raw, 'receipt_sources', [{ source: 'email', receipts_30d: 1 }, { source: 'ai', receipts_30d: 2 }]);
    raw = withValue(raw, 'ai.months', [{ month: '2026-10', kind: 'video', uses: 1, households: 1 }]);
    raw = withValue(raw, 'ai.near_limit', [{ kind: 'video', households: 1 }]);
    raw = withValue(raw, 'ai.limits', { chat: 300, video: 5 });
    const d = parseAppDashboard(raw);
    expect(d.features.map((row) => row.key)).not.toContain('jardim');
    expect(d.platforms).toEqual([{ platform: 'ios', users: 2 }]);
    expect(d.clients).toEqual([{ client: 'app', users: 1 }]);
    expect(d.receiptSources).toEqual([{ source: 'ai', receipts30d: 2 }]);
    expect(d.ai.months).toEqual([]);
    expect(d.ai.nearLimit).toEqual([]);
    expect(d.ai.limits).toEqual({ chat: 300 });
  });

  it('as linhas desconhecidas também precisam de números válidos', () => {
    const raw = rawDashboard();
    expect(() =>
      parseAppDashboard(withValue(raw, 'features', [{ key: 'jardim', households: -1, households_30d: 0, events_30d: 0 }])),
    ).toThrow(APP_DASHBOARD_INVALID);
    expect(() => parseAppDashboard(withValue(raw, 'ai.limits', { chat: 300, video: 'muito' }))).toThrow(APP_DASHBOARD_INVALID);
  });

  it('-0 vira 0 (nunca "-0" na tela)', () => {
    const d = parseAppDashboard(withValue(rawDashboard(), 'accounts.new_7d', -0));
    expect(Object.is(d.accounts.new7d, 0)).toBe(true);
  });

  const broken: [string, (raw: Raw) => unknown][] = [
    ['não é objeto', () => null],
    ['é uma lista', () => []],
    ['sem o objeto de contas', (raw) => withValue(raw, 'accounts', undefined)],
    ['sem a lista de cadastros', (raw) => withValue(raw, 'signups', undefined)],
    ['lista que não é lista', (raw) => withValue(raw, 'daily', {})],
    ['sem a lista de funções', (raw) => withValue(raw, 'features', null)],
    ['sem a lista de aparelhos', (raw) => withValue(raw, 'platforms', undefined)],
    ['sem near_limit', (raw) => withValue(raw, 'ai.near_limit', undefined)],
    ['sem os limites', (raw) => withValue(raw, 'ai.limits', undefined)],
    ['contagem negativa', (raw) => withValue(raw, 'accounts.total', -1)],
    ['contagem quebrada', (raw) => withValue(raw, 'active.d7', 2.5)],
    ['contagem em texto', (raw) => withValue(raw, 'households.total', '4')],
    ['contagem que falta', (raw) => withValue(raw, 'push.users', undefined)],
    ['contagem infinita', (raw) => ({ ...raw, shared_prices: { rows: Infinity } })],
    ['contagem NaN', (raw) => ({ ...raw, shared_prices: { rows: NaN } })],
    ['contagem enorme', (raw) => withValue(raw, 'accounts.total', 2 ** 60)],
    ['dia que não existe', (raw) => withValue(raw, 'today', '2026-02-30')],
    ['dia em outro formato', (raw) => withValue(raw, 'today', '23/10/2026')],
    ['mês inválido', (raw) => withValue(raw, 'ai.month', '2026-13')],
    ['hora inválida', (raw) => withValue(raw, 'generated_at', 'ontem')],
    ['sem a hora', (raw) => withValue(raw, 'generated_at', undefined)],
    ['backfilled que não é booleano', (raw) => withValue(raw, 'daily.0.backfilled', 'true')],
    ['uso da IA do dia que não é objeto', (raw) => withValue(raw, 'daily.0.ai', [])],
    ['linha que não é objeto', (raw) => withValue(raw, 'signups', [1, 2])],
    ['dia repetido', (raw) => withValue(raw, 'daily', [(raw.daily as Raw[])[2], (raw.daily as Raw[])[2]])],
    ['cadastro repetido', (raw) => withValue(raw, 'signups', [(raw.signups as Raw[])[0], (raw.signups as Raw[])[0]])],
    [
      'mês e tipo repetidos',
      (raw) =>
        withValue(raw, 'ai.months', [
          { month: '2026-10', kind: 'chat', uses: 1, households: 1 },
          { month: '2026-10', kind: 'chat', uses: 2, households: 1 },
        ]),
    ],
    ['função repetida', (raw) => withValue(raw, 'features', [(raw.features as Raw[])[0], (raw.features as Raw[])[0]])],
    ['versão dos termos vazia', (raw) => withValue(raw, 'terms', [{ version: ' ', users: 1 }])],
    ['chave da função que não é texto', (raw) => withValue(raw, 'features', [{ key: 3, households: 0, households_30d: 0, events_30d: 0 }])],
  ];
  it.each(broken)('recusa a resposta quebrada: %s', (_, make) => {
    expect(() => parseAppDashboard(make(rawDashboard()))).toThrow(APP_DASHBOARD_INVALID);
  });
});

describe('nukeMessagesByDay', () => {
  const row = (day: string, ai: AppDashboardDay['ai'], backfilled = false): AppDashboardDay => ({
    day,
    accounts: 1,
    activeUsers: 1,
    households: 1,
    ai,
    backfilled,
  });

  it('é o acumulado do dia menos o do dia anterior', () => {
    const days = nukeMessagesByDay([row('2026-10-21', { chat: 2 }), row('2026-10-22', { chat: 5 }), row('2026-10-23', { chat: 9 })]);
    expect([...days]).toEqual([
      ['2026-10-22', 3],
      ['2026-10-23', 4],
    ]);
  });

  it('no dia 1º, é o acumulado do próprio dia (o mês começou do zero)', () => {
    const days = nukeMessagesByDay([row('2026-09-30', { chat: 40 }), row('2026-10-01', { chat: 3 }), row('2026-10-02', { chat: 5 })]);
    expect(days.get('2026-10-01')).toBe(3);
    expect(days.get('2026-10-02')).toBe(2);
    // O 30/09 não tem o dia anterior.
    expect(days.has('2026-09-30')).toBe(false);
  });

  it('sem o tipo chat, mas com o uso da IA conhecido, o Nuke deu zero', () => {
    const days = nukeMessagesByDay([row('2026-10-21', { photo: 3 }), row('2026-10-22', { chat: 2, photo: 3 })]);
    expect(days.get('2026-10-22')).toBe(2);
  });

  it('não sabe o dia quando o anterior falta, foi reconstruído ou não sabe o uso', () => {
    const days = nukeMessagesByDay([
      row('2026-10-10', { chat: 1 }),
      // 11 falta
      row('2026-10-12', { chat: 4 }),
      row('2026-10-13', { chat: 6 }, true),
      row('2026-10-14', { chat: 7 }),
      row('2026-10-15', null),
      row('2026-10-16', { chat: 9 }),
      row('2026-10-17', { chat: 9 }),
    ]);
    expect([...days]).toEqual([['2026-10-17', 0]]);
  });

  it('o dia reconstruído e o dia sem uso conhecido nunca têm valor, nem no dia 1º', () => {
    const days = nukeMessagesByDay([row('2026-10-01', { chat: 5 }, true), row('2026-11-01', null)]);
    expect(days.size).toBe(0);
  });

  it('uma queda (uso devolvido) conta zero', () => {
    const days = nukeMessagesByDay([row('2026-10-21', { chat: 5 }), row('2026-10-22', { chat: 3 })]);
    expect(days.get('2026-10-22')).toBe(0);
  });
});

describe('wholePercent', () => {
  it('arredonda sem dizer "todos" ou "nenhum" quando não é', () => {
    expect(wholePercent(3, 4)).toBe('75%');
    expect(wholePercent(1, 3)).toBe('33%');
    expect(wholePercent(199, 200)).toBe('99%');
    expect(wholePercent(1, 1000)).toBe('1%');
    expect(wholePercent(0, 5)).toBe('0%');
    expect(wholePercent(5, 5)).toBe('100%');
    expect(wholePercent(0, 0)).toBe('0%');
  });
});

describe('dashboardView', () => {
  it('monta o topo: contas, ativas, casas e Nuke no mês', () => {
    const v = view();
    expect(v.title).toBe('Painel do app');
    expect(v.stats.title).toBe('Agora');
    expect(v.stats.items.map(({ key, label, value, unit, detail }) => ({ key, label, value, unit, detail }))).toEqual([
      { key: 'contas', label: 'Contas', value: '5', unit: null, detail: '+1 em 7 dias' },
      { key: 'ativas', label: 'Ativas em 7 dias', value: '3', unit: null, detail: '2 em 24 h · 5 em 30 dias' },
      { key: 'casas', label: 'Casas', value: '4', unit: null, detail: '1 com 2 ou mais pessoas' },
      { key: 'nuke', label: 'Nuke no mês', value: '7', unit: 'mensagens', detail: '1 casa · mês passado 10' },
    ]);
    expect(v.stats.items[1].accessibilityLabel).toBe('Pessoas ativas em 7 dias: 3. Em 24 horas: 2. Em 30 dias: 5.');
    expect(v.stats.items[3].accessibilityLabel).toBe('Nuke no mês: 7 mensagens, de 1 casa. Mês passado: 10.');
  });

  it('escreve os números à brasileira e acerta o singular', () => {
    let raw = withValue(rawDashboard(), 'accounts.total', 1234);
    raw = withValue(raw, 'accounts.new_7d', 1500);
    raw = withValue(raw, 'ai.months', [{ month: '2026-10', kind: 'chat', uses: 1, households: 1 }]);
    raw = withValue(raw, 'households.shared', 0);
    const v = view(raw);
    expect(v.stats.items[0].value).toBe('1.234');
    expect(v.stats.items[0].detail).toBe('+1.500 em 7 dias');
    expect(v.stats.items[2].detail).toBe('Nenhuma com 2 ou mais pessoas');
    expect(v.stats.items[3].unit).toBe('mensagem');
    expect(v.stats.items[3].detail).toBe('1 casa · mês passado 0');
    expect(v.nuke.facts[0].value).toBe('1 mensagem');
  });

  describe('uso por dia', () => {
    it('tem os 30 dias até hoje: sem linha é sem registro, o reconstruído é estimativa e hoje está pela metade', () => {
      const chart = view().activity.chart;
      expect(chart.bars).toHaveLength(DASHBOARD_DAYS);
      expect(chart.bars[0].key).toBe('2026-09-24');
      expect(chart.bars[29].key).toBe(TODAY);
      expect(chart.bars.slice(-5).map(({ key, value, partial, estimate }) => ({ key, value, partial, estimate }))).toEqual([
        { key: '2026-10-19', value: null, partial: false, estimate: false },
        { key: '2026-10-20', value: 1, partial: false, estimate: true },
        { key: '2026-10-21', value: 2, partial: false, estimate: true },
        { key: '2026-10-22', value: 3, partial: false, estimate: false },
        { key: '2026-10-23', value: 2, partial: true, estimate: false },
      ]);
      expect(chart.bars.every((bar) => bar.label === null && bar.short === null)).toBe(true);
      expect(chart.max).toBe(3);
      expect(chart.startLabel).toBe('24/09');
      expect(chart.endLabel).toBe('hoje, até agora');
      expect(chart.note).toBe('Antes de 22/10, conta só quem ainda estava conectado.');
      expect(chart.empty).toBeNull();
      expect(chart.accessibilityLabel).toBe(
        'Pessoas ativas por dia, de 24/09 a hoje. Hoje, até agora: 2 pessoas. Maior dia: 3 pessoas, em 22/10. ' +
          '26 dias sem registro. Antes de 22/10, conta só quem ainda estava conectado.',
      );
    });

    it('linhas de fora dos 30 dias não entram', () => {
      const raw = withValue(rawDashboard(), 'daily', [
        { day: '2026-09-23', accounts: 1, active_users: 9, households: 1, ai: {}, backfilled: true },
        { day: TODAY, accounts: 1, active_users: 1, households: 1, ai: {}, backfilled: false },
      ]);
      const chart = view(raw).activity.chart;
      expect(chart.max).toBe(1);
      // O dia reconstruído ficou fora da janela: não há nota.
      expect(chart.note).toBeNull();
      expect(chart.accessibilityLabel).toContain('Maior dia: 1 pessoa, hoje.');
    });

    it('sem nenhum registro, uma frase no lugar do gráfico', () => {
      const chart = view(emptyDashboard()).activity.chart;
      expect(chart.empty).toBe('O primeiro registro por dia aparece depois que a contagem diária rodar.');
      expect(chart.bars.every((bar) => bar.value === null)).toBe(true);
      expect(chart.max).toBe(0);
      expect(chart.accessibilityLabel).toBe('Pessoas ativas por dia, de 24/09 a hoje. Hoje: sem registro. 30 dias sem registro.');
    });

    it('só dias reconstruídos: a nota fala do tom mais claro', () => {
      const raw = withValue(rawDashboard(), 'daily', [{ day: '2026-10-22', accounts: 1, active_users: 1, households: 1, ai: {}, backfilled: true }]);
      expect(view(raw).activity.chart.note).toBe('Os dias em tom mais claro contam só quem ainda estava conectado.');
    });
  });

  describe('novas contas', () => {
    it('tem os 30 dias, com zero no dia sem conta nova, e soma o período', () => {
      const v = view();
      expect(v.signups.title).toBe('Novas contas');
      expect(v.signups.chart.bars).toHaveLength(30);
      expect(v.signups.chart.bars[10]).toMatchObject({ key: '2026-10-04', value: 2 });
      expect(v.signups.chart.bars[29]).toMatchObject({ key: TODAY, value: 1, partial: true });
      expect(v.signups.chart.max).toBe(2);
      expect(v.signups.summary).toBe('3 contas novas nos últimos 30 dias.');
    });

    it('um dia que a rpc não mandou conta zero, e o singular sai certo', () => {
      const raw = withValue(rawDashboard(), 'signups', [{ day: TODAY, count: 1 }]);
      const v = view(raw);
      expect(v.signups.chart.bars[0].value).toBe(0);
      expect(v.signups.summary).toBe('1 conta nova nos últimos 30 dias.');
      expect(v.signups.chart.accessibilityLabel).toContain('Hoje, até agora: 1 conta.');
    });

    it('sem nenhuma conta nova', () => {
      const v = view(emptyDashboard());
      expect(v.signups.summary).toBe('Nenhuma conta nova nos últimos 30 dias.');
      expect(v.signups.chart.accessibilityLabel).toContain('Nenhuma conta nova no período.');
    });
  });

  describe('Nuke', () => {
    it('mostra o mês, o mês passado e os 6 meses', () => {
      const nuke = view().nuke;
      expect(nuke.facts.map(({ label, value, detail }) => [label, value, detail])).toEqual([
        ['Outubro, até agora', '7 mensagens', 'De 1 casa'],
        ['Setembro', '10 mensagens', 'De 2 casas'],
      ]);
      expect(nuke.months.bars.map(({ key, value, label, short, partial }) => [key, value, label, short, partial])).toEqual([
        ['2026-05', 0, 'mai', '0', false],
        ['2026-06', 0, 'jun', '0', false],
        ['2026-07', 0, 'jul', '0', false],
        ['2026-08', 0, 'ago', '0', false],
        ['2026-09', 10, 'set', '10', false],
        ['2026-10', 7, 'out', '7', true],
      ]);
      expect(nuke.months.max).toBe(10);
      expect(nuke.months.empty).toBeNull();
      expect(nuke.months.accessibilityLabel).toBe(
        'Mensagens com o Nuke por mês. Maio: 0 mensagens; junho: 0 mensagens; julho: 0 mensagens; agosto: 0 mensagens; ' +
          'setembro: 10 mensagens; outubro até agora: 7 mensagens.',
      );
    });

    it('na virada do ano, o leitor de tela diz o ano', () => {
      let raw = withValue(rawDashboard(), 'ai.month', '2027-02');
      raw = withValue(raw, 'ai.months', [{ month: '2026-12', kind: 'chat', uses: 1, households: 1 }]);
      const nuke = view(raw).nuke;
      expect(nuke.months.bars.map((bar) => bar.key)).toEqual(['2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02']);
      expect(nuke.months.accessibilityLabel).toContain('dezembro de 2026: 1 mensagem;');
      expect(nuke.months.accessibilityLabel).toContain('fevereiro de 2027 até agora: 0 mensagens.');
    });

    it('o gráfico por dia só aparece com 2 dias ou mais que dá para saber', () => {
      // Só 23/10 tem o dia anterior contado de verdade (o 22, com { chat: 4 }).
      expect(view().nuke.perDay).toBeNull();

      const raw = withValue(rawDashboard(), 'daily', [
        { day: '2026-10-20', accounts: 4, active_users: 1, households: 3, ai: {}, backfilled: true },
        { day: '2026-10-21', accounts: 4, active_users: 2, households: 3, ai: { chat: 1 }, backfilled: false },
        { day: '2026-10-22', accounts: 5, active_users: 3, households: 4, ai: { chat: 4 }, backfilled: false },
        { day: '2026-10-23', accounts: 5, active_users: 2, households: 4, ai: { chat: 7 }, backfilled: false },
      ]);
      const perDay = view(raw).nuke.perDay;
      expect(perDay).not.toBeNull();
      expect(perDay!.bars.slice(-3).map(({ value, partial }) => [value, partial])).toEqual([
        [null, false],
        [3, false],
        [3, true],
      ]);
      expect(perDay!.max).toBe(3);
      expect(perDay!.note).toBe('Um dia sem valor não tem a contagem dele ou a do dia anterior.');
      expect(perDay!.accessibilityLabel).toBe(
        'Mensagens com o Nuke por dia, de 24/09 a hoje. Hoje, até agora: 3 mensagens. Maior dia: 3 mensagens, hoje. ' +
          '28 dias sem como saber. Um dia sem valor não tem a contagem dele ou a do dia anterior.',
      );
    });

    it('sem uso nenhum: zero mensagens e uma frase no lugar das barras', () => {
      const nuke = view(emptyDashboard()).nuke;
      expect(nuke.facts.map(({ value, detail }) => [value, detail])).toEqual([
        ['0 mensagens', 'Nenhuma casa usou'],
        ['0 mensagens', 'Nenhuma casa usou'],
      ]);
      expect(nuke.months.empty).toBe('Nenhuma mensagem com o Nuke nos últimos 6 meses.');
      expect(nuke.perDay).toBeNull();
    });
  });

  describe('IA', () => {
    it('uma linha por uso neste mês, com as casas e o limite', () => {
      const ai = view().ai;
      expect(ai.intro).toBe('Em outubro, somando todas as casas. O limite é de cada casa e volta a zero no dia 1º.');
      expect(ai.rows.map(({ key, label, value, detail, ratio }) => [key, label, value, detail, ratio])).toEqual([
        ['chat', 'Mensagens com o Nuke', '7', '1 de 4 casas · limite de 300 por casa', 0.25],
        ['photo', 'Leituras de foto (notas e saúde)', '8', '2 de 4 casas · limite de 100 por casa', 0.5],
        ['menu', 'Cardápios montados pelo Nuke', '0', '0 de 4 casas · limite de 20 por casa', 0],
        ['nfce', 'Notas lidas pelo QR code', '0', '0 de 4 casas · limite de 200 por casa', 0],
        ['finance', 'Mensagens com o consultor financeiro', '0', '0 de 4 casas · limite de 100 por casa', 0],
      ]);
      expect(ai.rows[0].accessibilityLabel).toBe('Mensagens com o Nuke: 7 neste mês. 1 de 4 casas. Limite de 300 por casa.');
      expect(ai.limitNote).toBe('No limite: 2 casas em cardápios do Nuke. Perto do limite: 1 casa em leituras de foto.');
    });

    it('sem casa perto do limite, sem aviso; sem o limite na resposta, a linha não fala dele', () => {
      let raw = withValue(rawDashboard(), 'ai.near_limit', []);
      raw = withValue(raw, 'ai.at_limit', [{ kind: 'chat', households: 0 }]);
      raw = withValue(raw, 'ai.limits', { photo: 100 });
      const ai = view(raw).ai;
      expect(ai.limitNote).toBeNull();
      expect(ai.rows[0].detail).toBe('1 de 4 casas');
    });

    it('junta os usos no mesmo aviso', () => {
      const raw = withValue(rawDashboard(), 'ai.near_limit', [
        { kind: 'chat', households: 1 },
        { kind: 'photo', households: 3 },
      ]);
      expect(view(raw).ai.limitNote).toBe(
        'No limite: 2 casas em cardápios do Nuke. Perto do limite: 1 casa em mensagens com o Nuke e 3 casas em leituras de foto.',
      );
    });
  });

  describe('o que as casas usam', () => {
    it('ordena por casas em 30 dias, depois casas que já usaram, depois o nome', () => {
      const features = view().features;
      expect(features.title).toBe('O que as casas usam');
      expect(features.active.map(({ key, value, detail, ratio }) => [key, value, detail, ratio])).toEqual([
        ['lista', '2 de 4 casas', '7 registros em 30 dias · 3 casas já usaram', 0.5],
        ['notas', '2 de 4 casas', '1 registro em 30 dias', 0.5],
      ]);
      expect(features.active[0].label).toBe('Lista de compras');
      expect(features.active[0].accessibilityLabel).toBe(
        'Lista de compras: 2 de 4 casas em 30 dias. 7 registros em 30 dias. 3 casas já usaram.',
      );
      // Remédios já foi usado e vem antes das que nunca foram; as outras, em ordem alfabética.
      expect(features.idle.map((row) => row.label)).toEqual([
        'Remédios',
        'Aparelhos',
        'Cardápio',
        'Compromissos',
        'Consultas',
        'Contas a pagar',
        'Despensa',
        'Dieta',
        'Documentos',
        'Exames',
        'Gás, água e ração',
        'Gastos',
        'Orçamento',
        'Prestadores',
        'Tarefas',
        'Treinos',
        'Vacinas',
      ]);
      expect(features.idle[0]).toMatchObject({ value: '0 de 4 casas', detail: '1 casa já usou, nenhuma em 30 dias', ratio: 0 });
      expect(features.idle[1].detail).toBe('Nenhuma casa usou ainda');
      expect(features.idleSummary).toBe(
        'Sem uso nos últimos 30 dias: Remédios, Aparelhos, Cardápio, Compromissos, Consultas, Contas a pagar, Despensa, ' +
          'Dieta, Documentos, Exames, Gás, água e ração, Gastos, Orçamento, Prestadores, Tarefas, Treinos e Vacinas.',
      );
      expect(features.showAll).toBe('Ver todas');
      expect(features.empty).toBeNull();
    });

    it('uma função que a rpc não mandou conta como sem uso', () => {
      const raw = withValue(rawDashboard(), 'features', [{ key: 'lista', households: 1, households_30d: 1, events_30d: 1 }]);
      const features = view(raw).features;
      expect(features.active.map((row) => row.key)).toEqual(['lista']);
      expect(features.idle).toHaveLength(APP_FEATURES.length - 1);
      expect(features.active[0].detail).toBe('1 registro em 30 dias');
    });

    it('todas usadas: sem resumo das paradas', () => {
      const raw = withValue(
        rawDashboard(),
        'features',
        APP_FEATURES.map((feature) => ({ key: feature.key, households: 1, households_30d: 1, events_30d: 2 })),
      );
      const features = view(raw).features;
      expect(features.idle).toEqual([]);
      expect(features.idleSummary).toBeNull();
    });

    it('as notas confirmadas em 30 dias, por origem', () => {
      const sources = (qrcode: number, ai: number, manual: number) =>
        view(
          withValue(rawDashboard(), 'receipt_sources', [
            { source: 'qrcode', receipts_30d: qrcode },
            { source: 'ai', receipts_30d: ai },
            { source: 'manual', receipts_30d: manual },
          ]),
        ).features.receipts;
      expect(sources(0, 5, 0)).toBe('5 notas confirmadas nos últimos 30 dias, todas por foto.');
      expect(sources(1, 0, 0)).toBe('1 nota confirmada nos últimos 30 dias, pelo QR code.');
      expect(sources(3, 5, 1)).toBe('9 notas confirmadas nos últimos 30 dias: 3 pelo QR code, 5 por foto e 1 à mão.');
      expect(sources(2, 0, 1)).toBe('3 notas confirmadas nos últimos 30 dias: 2 pelo QR code e 1 à mão.');
      expect(sources(0, 0, 0)).toBe('Nenhuma nota confirmada nos últimos 30 dias.');
    });

    it('sem casas, uma frase no lugar das linhas', () => {
      const features = view(emptyDashboard()).features;
      expect(features.empty).toBe('Ainda não há casas.');
      expect(features.active).toEqual([]);
      expect(features.idle[0]).toMatchObject({ value: 'Nenhuma casa', ratio: 0 });
    });
  });

  describe('entrada', () => {
    it('contas sem casa, quem voltou depois do primeiro dia e os termos atuais', () => {
      const funnel = view().funnel;
      expect(funnel.title).toBe('Entrada');
      expect(funnel.facts.map(({ key, label, value, detail }) => [key, label, value, detail])).toEqual([
        ['sem-casa', 'Contas sem casa', '1 de 5 contas (20%)', 'Criaram a conta e ainda não entraram em nenhuma casa.'],
        ['voltaram', 'Voltaram depois do primeiro dia', '3 de 4 contas (75%)', 'Entre as contas criadas há mais de 7 dias.'],
        ['termos', 'Aceitaram os termos atuais', '3 de 5 contas (60%)', 'Versão de 22/10/2026.'],
      ]);
      expect(funnel.facts[0].accessibilityLabel).toBe(
        'Contas sem casa: 1 de 5 contas (20%). Criaram a conta e ainda não entraram em nenhuma casa.',
      );
    });

    it('os termos contam só a versão pedida', () => {
      const v = dashboardView(parseAppDashboard(rawDashboard()), { termsVersion: '2026-10-18', now: NOW });
      expect(v.funnel.facts[2].value).toBe('1 de 5 contas (20%)');
      expect(v.funnel.facts[2].detail).toBe('Versão de 18/10/2026.');
      const unknown = dashboardView(parseAppDashboard(rawDashboard()), { termsVersion: '2027-01-01', now: NOW });
      expect(unknown.funnel.facts[2].value).toBe('0 de 5 contas (0%)');
    });

    it('banco novo: sem contas', () => {
      const funnel = view(emptyDashboard()).funnel;
      expect(funnel.facts.map(({ value, detail }) => [value, detail])).toEqual([
        ['Nenhuma conta', 'Criaram a conta e ainda não entraram em nenhuma casa.'],
        ['Nenhuma conta ainda', 'Aparece quando houver conta criada há mais de 7 dias.'],
        ['Nenhuma conta', 'Versão de 22/10/2026.'],
      ]);
    });

    it('uma conta só: singular', () => {
      let raw = withValue(rawDashboard(), 'accounts', { total: 1, new_7d: 1, new_30d: 1, confirmed: 1, in_household: 1 });
      raw = withValue(raw, 'retention', { eligible: 1, returned: 0 });
      const facts = view(raw).funnel.facts;
      expect(facts[0].value).toBe('0 de 1 conta (0%)');
      expect(facts[1].value).toBe('0 de 1 conta (0%)');
    });
  });

  describe('aparelhos', () => {
    it('uma linha por plataforma, mais gente primeiro, e a frase de navegador e app', () => {
      const raw = withValue(rawDashboard(), 'clients', [
        { client: 'app', users: 1 },
        { client: 'navegador', users: 3 },
      ]);
      const devices = view(raw).devices;
      expect(devices.rows.map(({ key, label, value, ratio }) => [key, label, value, ratio])).toEqual([
        ['computador', 'Computador', '2 pessoas', 0.4],
        ['ios', 'iPhone/iPad', '2 pessoas', 0.4],
        ['android', 'Android', '1 pessoa', 0.2],
      ]);
      expect(devices.clients).toBe('3 pessoas pelo navegador e 1 pessoa pelo app instalado.');
      expect(devices.note).toBe('Conta quem usou o app nos últimos 30 dias sem sair da conta. Quem usa mais de um aparelho conta em cada um.');
      expect(devices.empty).toBeNull();
    });

    it('a barra nunca passa do cheio, mesmo com mais pessoas num aparelho do que ativas em 30 dias', () => {
      const raw = withValue(rawDashboard(), 'platforms', [{ platform: 'outro', users: 8 }]);
      const devices = view(raw).devices;
      expect(devices.rows).toEqual([expect.objectContaining({ label: 'Outro', value: '8 pessoas', ratio: 1 })]);
    });

    it('sem sessão em 30 dias', () => {
      const devices = view(emptyDashboard()).devices;
      expect(devices.rows).toEqual([]);
      expect(devices.clients).toBeNull();
      expect(devices.empty).toBe('Nenhum aparelho conectado nos últimos 30 dias.');
    });
  });

  it('outros: avisos do navegador, consultor e preços compartilhados', () => {
    expect(view().extras.facts.map(({ label, value, detail }) => [label, value, detail])).toEqual([
      ['Avisos do navegador', '3 pessoas', '6 navegadores inscritos'],
      ['Consultor financeiro (beta)', '1 pessoa', 'Com o acesso liberado.'],
      ['Preços compartilhados', '15 registros', 'Somando todas as casas.'],
    ]);
    expect(view(emptyDashboard()).extras.facts.map((row) => row.value)).toEqual(['0 pessoas', '0 pessoas', '0 registros']);
  });

  describe('rodapé', () => {
    it('diz a hora da atualização no relógio do aparelho, e as notas', () => {
      // A hora e o dia são os do fuso do aparelho, qualquer que seja o da máquina que roda o teste.
      const generated = new Date('2026-10-23T14:05:00Z');
      const pad = (value: number) => String(value).padStart(2, '0');
      const time = `${pad(generated.getHours())}:${pad(generated.getMinutes())}`;
      const after = (hours: number) => new Date(generated.getTime() + hours * 3_600_000);
      expect(view(rawDashboard(), generated).footer).toEqual({
        updated: `Atualizado hoje às ${time}.`,
        notes: [APP_DASHBOARD_PRIVACY, APP_DASHBOARD_ACTIVITY_NOTE],
      });
      expect(view(rawDashboard(), after(24)).footer.updated).toBe(`Atualizado ontem às ${time}.`);
      const day = toISODate(generated);
      expect(view(rawDashboard(), after(24 * 7)).footer.updated).toBe(`Atualizado em ${formatShortDate(day, 2026)} às ${time}.`);
      expect(view(rawDashboard(), after(24 * 80)).footer.updated).toBe(`Atualizado em ${formatShortDate(day, 2027)} às ${time}.`);
      expect(view(rawDashboard(), after(24 * 80)).footer.updated).toMatch(/^Atualizado em 2[34] out 2026 às \d\d:05\.$/);
    });
  });

  it('nenhum texto diz "usuário", grita ou mostra um número quebrado', () => {
    const texts = (v: DashboardView) => allTexts(v);
    for (const v of [view(), view(emptyDashboard())]) {
      for (const text of texts(v)) {
        expect(text).not.toMatch(/usu[aá]ri/i);
        expect(text).not.toContain('!');
        expect(text).not.toMatch(/NaN|undefined|null|Infinity|-0\b/);
        expect(text).not.toMatch(/\b1 (pessoas|casas|contas|mensagens|registros|dias)\b/);
      }
    }
  });
});

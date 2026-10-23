import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from 'expo-router';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import AppDashboardScreen from '@/app/painel';
import {
  APP_DASHBOARD_ACTIVITY_NOTE,
  APP_DASHBOARD_FORBIDDEN,
  APP_DASHBOARD_INVALID,
  APP_DASHBOARD_NOT_READY,
  APP_DASHBOARD_PRIVACY,
  APP_FEATURES,
  dashboardView,
  parseAppDashboard,
} from '@/domain/appDashboard';
import { addDays } from '@/domain/dates';
import { TERMS_ACCEPT_VERSION } from '@/domain/terms';

// A tela do painel com a rpc de mentira e a busca de verdade (data/appDashboard, QueryClient real): os números
// de uma resposta, a recusa para quem não mantém o app, o banco sem a migração, o erro, a nova busca que falha
// com os números na tela e a tela sem internet. Os textos são os de domain/appDashboard, de verdade.

/** A rpc app_dashboard, como o PostgREST responderia. */
const mockDb = {
  rpc: jest.fn(async (_name: string): Promise<{ data: unknown; error: unknown }> => ({ data: null, error: null })),
};
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: (name: string) => mockDb.rpc(name) },
  // Como o de verdade: a mensagem do erro do PostgREST, que não é um Error.
  errorMessage: (error: unknown) => (error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)),
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'ana', email: 'ana@exemplo.com' } } }) }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false) } }));
// O fundo, as imagens e os ícones (letras de uma fonte) não entram no que se confere aqui.
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));

const TODAY = '2026-10-23';

/** A resposta de app_dashboard de um banco pequeno: 5 contas, 4 casas, o Nuke usado em uma. */
function rawDashboard(): Record<string, unknown> {
  return {
    generated_at: '2026-10-23T14:05:00Z',
    today: TODAY,
    accounts: { total: 5, new_7d: 1, new_30d: 3, confirmed: 5, in_household: 4 },
    active: { d1: 2, d7: 3, d30: 5 },
    retention: { eligible: 4, returned: 3 },
    households: { total: 4, shared: 1, members: 5, people_without_app: 2, pets: 1, new_30d: 2 },
    signups: Array.from({ length: 30 }, (_, index) => ({ day: addDays(TODAY, index - 29), count: index === 29 ? 1 : 0 })),
    daily: [
      { day: '2026-10-21', accounts: 4, active_users: 2, households: 3, ai: {}, backfilled: true },
      { day: '2026-10-22', accounts: 5, active_users: 3, households: 4, ai: { chat: 4 }, backfilled: false },
      { day: '2026-10-23', accounts: 5, active_users: 2, households: 4, ai: { chat: 7 }, backfilled: false },
    ],
    ai: {
      month: '2026-10',
      limits: { chat: 300, photo: 100, menu: 20, nfce: 200, finance: 100 },
      months: [
        { month: '2026-09', kind: 'chat', uses: 10, households: 2 },
        { month: '2026-10', kind: 'chat', uses: 7, households: 1 },
        { month: '2026-10', kind: 'photo', uses: 8, households: 2 },
      ],
      near_limit: [{ kind: 'photo', households: 1 }],
      at_limit: [{ kind: 'photo', households: 0 }],
    },
    features: APP_FEATURES.map((feature) =>
      feature.key === 'lista'
        ? { key: 'lista', households: 3, households_30d: 2, events_30d: 7 }
        : { key: feature.key, households: 0, households_30d: 0, events_30d: 0 },
    ),
    receipt_sources: [
      { source: 'qrcode', receipts_30d: 0 },
      { source: 'ai', receipts_30d: 5 },
      { source: 'manual', receipts_30d: 0 },
    ],
    platforms: [
      { platform: 'ios', users: 2 },
      { platform: 'computador', users: 2 },
    ],
    clients: [{ client: 'navegador', users: 3 }],
    push: { subscriptions: 6, users: 3 },
    terms: [{ version: TERMS_ACCEPT_VERSION, users: 3 }],
    beta: [{ feature: 'finance', users: 1 }],
    shared_prices: { rows: 15 },
  };
}

const answer = (data: unknown) => ({ data, error: null });
const refusal = { data: null, error: { code: '42501', message: APP_DASHBOARD_FORBIDDEN } };

let renderer: ReactTestRenderer | undefined;
let queryClient: QueryClient;

const textOf = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map(textOf).join(''));
const page = () => textOf(renderer!.root);

async function settle() {
  for (let i = 0; i < 5; i += 1) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function mount() {
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={queryClient}>
        <AppDashboardScreen />
      </QueryClientProvider>,
    );
  });
  await settle();
  return page();
}

const button = (title: string) =>
  renderer!.root.findAll((node) => node.props.title === title && typeof node.props.onPress === 'function')[0];
const press = async (title: string) => {
  await act(async () => button(title).props.onPress());
  await settle();
};
/** Puxar a tela para baixo. */
const pull = async () => {
  const screen = renderer!.root.findAll((node) => typeof node.props.onRefresh === 'function')[0];
  await act(async () => screen.props.onRefresh());
  await settle();
};
/** Os gráficos: cada um é uma imagem só para o leitor de tela. */
const charts = () =>
  renderer!.root
    .findAll((node) => node.props.accessibilityRole === 'image' && typeof node.type === 'string')
    .map((node) => node.props.accessibilityLabel as string);

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.rpc.mockResolvedValue(answer(rawDashboard()));
  // Sem esperar entre a busca e a segunda tentativa (a tela tenta de novo uma vez, menos a recusa).
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } } });
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  queryClient.clear();
  onlineManager.setOnline(true);
});

describe('Painel do app', () => {
  it('mostra os números da resposta: o topo, os gráficos, as funções, a entrada, os aparelhos e as notas do fim', async () => {
    const text = await mount();
    expect(mockDb.rpc).toHaveBeenCalledWith('app_dashboard');
    // O topo, 2×2.
    expect(text).toContain('Contas5+1 em 7 dias');
    expect(text).toContain('Ativas em 7 dias32 em 24 h · 5 em 30 dias');
    expect(text).toContain('Casas41 com 2 ou mais pessoas');
    expect(text).toContain('Nuke no mês7mensagens1 casa · mês passado 10');
    // As funções usadas em 30 dias, com a barra; as paradas numa frase.
    expect(text).toContain('Lista de compras2 de 4 casas7 registros em 30 dias · 3 casas já usaram');
    expect(text).toContain('Sem uso nos últimos 30 dias:');
    expect(text).toContain('5 notas confirmadas nos últimos 30 dias, todas por foto.');
    expect(text).toContain('Perto do limite: 1 casa em leituras de foto.');
    expect(text).toContain('Contas sem casa1 de 5 contas (20%)');
    expect(text).toContain('iPhone/iPad2 pessoas');
    expect(text).toContain('3 pessoas pelo navegador.');
    expect(text).toContain('Avisos do navegador3 pessoas6 navegadores inscritos');
    expect(text).toContain(APP_DASHBOARD_PRIVACY);
    expect(text).toContain(APP_DASHBOARD_ACTIVITY_NOTE);

    // Tudo o que a tela escreve sai da visão do domínio: os gráficos são uma imagem cada, com a frase dela.
    const view = dashboardView(parseAppDashboard(rawDashboard()), { termsVersion: TERMS_ACCEPT_VERSION });
    expect(view.nuke.perDay).toBeNull();
    expect(charts()).toEqual([
      view.activity.chart.accessibilityLabel,
      view.signups.chart.accessibilityLabel,
      view.nuke.months.accessibilityLabel,
    ]);
    // O dia reconstruído tem a nota embaixo do gráfico.
    expect(text).toContain('Antes de 22/10, conta só quem ainda estava conectado.');
    for (const stat of view.stats.items) {
      expect(renderer!.root.findAll((node) => node.props.accessibilityLabel === stat.accessibilityLabel).length).toBeGreaterThan(0);
    }
  });

  it('"Ver todas" abre as funções sem uso em 30 dias, e "Ver menos" fecha', async () => {
    await mount();
    const view = dashboardView(parseAppDashboard(rawDashboard()), { termsVersion: TERMS_ACCEPT_VERSION });
    const idle = view.features.idle[0];
    const hasIdleRow = () => renderer!.root.findAll((node) => node.props.accessibilityLabel === idle.accessibilityLabel).length > 0;
    expect(hasIdleRow()).toBe(false);
    await press('Ver todas');
    expect(hasIdleRow()).toBe(true);
    expect(page()).not.toContain('Sem uso nos últimos 30 dias:');
    await press('Ver menos');
    expect(hasIdleRow()).toBe(false);
  });

  it('para quem não mantém o app: o cadeado e "Voltar", sem tentar de novo', async () => {
    mockDb.rpc.mockResolvedValue(refusal);
    const text = await mount();
    expect(text).toContain(APP_DASHBOARD_FORBIDDEN);
    expect(text).not.toContain('Contas');
    expect(mockDb.rpc).toHaveBeenCalledTimes(1);
    // Aberta direto pelo endereço: não há para onde voltar, e o começo do app abre a tela certa.
    await press('Voltar');
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('a recusa que chega com os números na tela tira os números', async () => {
    await mount();
    mockDb.rpc.mockResolvedValue(refusal);
    await pull();
    expect(page()).toContain(APP_DASHBOARD_FORBIDDEN);
    expect(page()).not.toContain('Contas5');
  });

  it('antes da migração (a função não existe): o aviso, nunca um erro', async () => {
    mockDb.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.app_dashboard' } });
    const text = await mount();
    expect(text).toContain(APP_DASHBOARD_NOT_READY);
    expect(text).not.toContain('Tentar de novo');
  });

  it('o erro sem nada na tela, com "Tentar de novo" (depois de uma segunda tentativa sozinha)', async () => {
    mockDb.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'O servidor não respondeu.' } });
    const text = await mount();
    expect(text).toContain('O servidor não respondeu.Tentar de novo');
    expect(mockDb.rpc).toHaveBeenCalledTimes(2);
    mockDb.rpc.mockResolvedValue(answer(rawDashboard()));
    await press('Tentar de novo');
    expect(page()).toContain('Contas5+1 em 7 dias');
  });

  it('uma resposta num formato que o app não lê é um erro com a frase dele', async () => {
    mockDb.rpc.mockResolvedValue(answer({ ...rawDashboard(), accounts: { total: -1 } }));
    expect(await mount()).toContain(`${APP_DASHBOARD_INVALID}Tentar de novo`);
  });

  it('a nova busca que falha deixa os números na tela, com o aviso e "Tentar de novo"', async () => {
    await mount();
    mockDb.rpc.mockResolvedValue({ data: null, error: new Error('Sem internet agora.') });
    await pull();
    const text = page();
    expect(text).toContain('Não foi possível atualizar. Mostrando o que já estava carregado.Tentar de novo');
    expect(text).toContain('Contas5+1 em 7 dias');
    mockDb.rpc.mockResolvedValue(answer(rawDashboard()));
    await press('Tentar de novo');
    expect(page()).not.toContain('Não foi possível atualizar.');
  });

  it('sem internet e nada na memória: o aviso, e os números chegam sozinhos com a conexão', async () => {
    onlineManager.setOnline(false);
    const text = await mount();
    expect(text).toContain('Sem internet. Os números aparecem quando a conexão voltar.');
    expect(mockDb.rpc).not.toHaveBeenCalled();
    await act(async () => onlineManager.setOnline(true));
    await settle();
    expect(page()).toContain('Contas5+1 em 7 dias');
  });
});

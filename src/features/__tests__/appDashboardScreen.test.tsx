import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from 'expo-router';
import { StyleSheet } from 'react-native';
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
import { PANEL_MAX_WIDTH, panelCellPercent } from '@/domain/panelLayout';
import { TERMS_ACCEPT_VERSION } from '@/domain/terms';
import { Section } from '@/ui/primitives';
import { space } from '@/ui/theme';

// A tela do painel com a rpc de mentira e a busca de verdade (data/appDashboard, QueryClient real): os números
// de uma resposta, a recusa para quem não mantém o app, o banco sem a migração, o erro, a nova busca que falha
// com os números na tela e a tela sem internet. Também as duas abas (Números e Recados, na URL) e a grade da
// janela larga. Os textos são os de domain/appDashboard, de verdade. A caixa de recados tem os testes dela
// (feedbackInbox.test).

/** As rpc app_dashboard e app_feedback_list, como o PostgREST responderia. */
const mockDb = {
  dashboard: jest.fn(async (_name: string): Promise<{ data: unknown; error: unknown }> => ({ data: null, error: null })),
  feedback: jest.fn(async (_name: string, _args?: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> => ({
    data: null,
    error: null,
  })),
};
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => (name === 'app_dashboard' ? mockDb.dashboard(name) : mockDb.feedback(name, args)),
  },
  // Como o de verdade: a mensagem do erro do PostgREST, que não é um Error.
  errorMessage: (error: unknown) => (error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)),
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'ana', email: 'ana@exemplo.com' } } }) }));
// A aba vive na URL: setParams junta os parâmetros novos aos que a tela tinha e a redesenha com eles.
const mockParams = { value: {} as Record<string, string>, listeners: new Set<() => void>() };
jest.mock('expo-router', () => {
  const { useSyncExternalStore } = jest.requireActual<typeof import('react')>('react');
  const subscribe = (listener: () => void) => {
    mockParams.listeners.add(listener);
    return () => mockParams.listeners.delete(listener);
  };
  return {
    router: {
      push: jest.fn(),
      back: jest.fn(),
      replace: jest.fn(),
      canGoBack: jest.fn(() => false),
      setParams: jest.fn((params: Record<string, string>) => {
        mockParams.value = { ...mockParams.value, ...params };
        mockParams.listeners.forEach((listener) => listener());
      }),
    },
    useLocalSearchParams: () => useSyncExternalStore(subscribe, () => mockParams.value),
  };
});
// "mock" no nome: o jest.mock só enxerga variáveis assim. 360 é um celular; 1280, um computador.
const mockWindow = { width: 360, height: 800, scale: 2, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow }));
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

/** A resposta de app_feedback_list com `novos` recados novos (e nenhum outro). */
function feedbackList(novos: number) {
  const items = Array.from({ length: novos }, (_, index) => ({
    id: `recado-${index + 1}`,
    created_at: `2026-10-2${3 - Math.min(index, 3)}T12:00:00Z`,
    updated_at: `2026-10-2${3 - Math.min(index, 3)}T12:00:00Z`,
    kind: 'sugestao',
    message: `Sugestão número ${index + 1}`,
    platform: 'web',
    app_version: '1.4.0',
    status: 'novo',
    note: null,
    email: 'bia@exemplo.com',
  }));
  return { counts: { novo: novos, lido: 0, resolvido: 0, arquivado: 0 }, total: novos, items };
}
const dashboardCalls = () => mockDb.dashboard.mock.calls.length;
/** Os estilos, achatados, de cada View da tela. */
const viewStyles = () =>
  renderer!.root
    .findAll((node) => String(node.type) === 'View' && node.props.style !== undefined)
    .map((node) => (StyleSheet.flatten(node.props.style) ?? {}) as Record<string, unknown>);
/** A largura de cada célula da grade das seções (PanelGrid: o espaço entre as colunas no padding da célula). */
const gridCells = () =>
  viewStyles()
    .filter((style) => style.paddingHorizontal === space.xl / 2 && typeof style.width === 'string')
    .map((style) => style.width);

/** Os títulos das seções, na ordem da tela. */
const sectionTitles = () => renderer!.root.findAllByType(Section).map((node) => node.props.title as string);

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
  mockDb.dashboard.mockResolvedValue(answer(rawDashboard()));
  mockDb.feedback.mockResolvedValue(answer(feedbackList(0)));
  mockParams.value = {};
  mockWindow.width = 360;
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
    expect(mockDb.dashboard).toHaveBeenCalledWith('app_dashboard');
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
    expect(text).toContain('Antes de 22/10, é um piso: conta só quem deixou naquele dia um registro que ainda está guardado.');
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
    mockDb.dashboard.mockResolvedValue(refusal);
    const text = await mount();
    expect(text).toContain(APP_DASHBOARD_FORBIDDEN);
    expect(text).not.toContain('Contas');
    expect(text).not.toContain('Recados');
    expect(dashboardCalls()).toBe(1);
    // Aberta direto pelo endereço: não há para onde voltar, e o começo do app abre a tela certa.
    await press('Voltar');
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('a recusa que chega com os números na tela tira os números', async () => {
    await mount();
    mockDb.dashboard.mockResolvedValue(refusal);
    await pull();
    expect(page()).toContain(APP_DASHBOARD_FORBIDDEN);
    expect(page()).not.toContain('Contas5');
  });

  it('antes da migração (a função não existe): o aviso, nunca um erro', async () => {
    mockDb.dashboard.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.app_dashboard' } });
    const text = await mount();
    expect(text).toContain(APP_DASHBOARD_NOT_READY);
    expect(text).not.toContain('Tentar de novo');
  });

  it('o erro sem nada na tela, com "Tentar de novo" (depois de uma segunda tentativa sozinha)', async () => {
    mockDb.dashboard.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'O servidor não respondeu.' } });
    const text = await mount();
    expect(text).toContain('O servidor não respondeu.Tentar de novo');
    expect(dashboardCalls()).toBe(2);
    mockDb.dashboard.mockResolvedValue(answer(rawDashboard()));
    await press('Tentar de novo');
    expect(page()).toContain('Contas5+1 em 7 dias');
  });

  it('uma resposta num formato que o app não lê é um erro com a frase dele', async () => {
    mockDb.dashboard.mockResolvedValue(answer({ ...rawDashboard(), accounts: { total: -1 } }));
    expect(await mount()).toContain(`${APP_DASHBOARD_INVALID}Tentar de novo`);
  });

  it('a nova busca que falha deixa os números na tela, com o aviso e "Tentar de novo"', async () => {
    await mount();
    mockDb.dashboard.mockResolvedValue({ data: null, error: new Error('Sem internet agora.') });
    await pull();
    const text = page();
    expect(text).toContain('Não foi possível atualizar. Mostrando o que já estava carregado.Tentar de novo');
    expect(text).toContain('Contas5+1 em 7 dias');
    mockDb.dashboard.mockResolvedValue(answer(rawDashboard()));
    await press('Tentar de novo');
    expect(page()).not.toContain('Não foi possível atualizar.');
  });

  it('sem internet e nada na memória: o aviso, e os números chegam sozinhos com a conexão', async () => {
    onlineManager.setOnline(false);
    const text = await mount();
    expect(text).toContain('Sem internet. Os números aparecem quando a conexão voltar.');
    expect(mockDb.dashboard).not.toHaveBeenCalled();
    expect(mockDb.feedback).not.toHaveBeenCalled();
    await act(async () => onlineManager.setOnline(true));
    await settle();
    expect(page()).toContain('Contas5+1 em 7 dias');
  });
});

describe('Painel do app: as abas', () => {
  /** As abas da barra de cima (Segmented): o rótulo e se está aberta. */
  const tabs = () =>
    renderer!.root
      .findAll((node) => node.props.accessibilityRole === 'tab' && typeof node.props.onPress === 'function')
      .map((node) => ({ label: textOf(node), selected: Boolean(node.props.accessibilityState?.selected), press: node.props.onPress as () => void }));

  it('sem recado novo: "Números" aberta e "Recados" sem número, e nenhuma linha de recados', async () => {
    const text = await mount();
    expect(tabs().map(({ label, selected }) => ({ label, selected }))).toEqual([
      { label: 'Números', selected: true },
      { label: 'Recados', selected: false },
    ]);
    expect(text).not.toContain('recado novo');
    expect(text).not.toContain('recados novos');
    // A lista dos novos foi pedida uma vez, para o número da aba.
    expect(mockDb.feedback).toHaveBeenCalledWith('app_feedback_list', { p_status: 'novo', p_limit: 200 });
  });

  it('com recados novos: o número na aba e a linha com "Ver", que abre a aba Recados na URL', async () => {
    mockDb.feedback.mockResolvedValue(answer(feedbackList(3)));
    const text = await mount();
    expect(tabs().map((tab) => tab.label)).toEqual(['Números', 'Recados (3)']);
    expect(text).toContain('3 recados novosVer');
    // Os números continuam embaixo da linha.
    expect(text).toContain('Contas5+1 em 7 dias');
    await press('Ver');
    expect(router.setParams).toHaveBeenLastCalledWith({ aba: 'recados' });
    expect(tabs().map(({ label, selected }) => ({ label, selected }))).toEqual([
      { label: 'Números', selected: false },
      { label: 'Recados (3)', selected: true },
    ]);
    // A caixa abre nos novos, e os números saem da tela.
    expect(page()).toContain('Sugestão número 1');
    expect(page()).toContain('Novos (3)');
    expect(page()).not.toContain('Contas5+1 em 7 dias');
    // E a outra aba volta aos números, pela URL também.
    await act(async () => tabs()[0].press());
    await settle();
    expect(router.setParams).toHaveBeenLastCalledWith({ aba: 'numeros' });
    expect(page()).toContain('Contas5+1 em 7 dias');
  });

  it('aberta pelo endereço com ?aba=recados, e uma aba que não existe vira os números', async () => {
    mockParams.value = { aba: 'recados' };
    mockDb.feedback.mockResolvedValue(answer(feedbackList(1)));
    expect(await mount()).toContain('Sugestão número 1');
    await act(async () => renderer!.unmount());
    mockParams.value = { aba: 'graficos' };
    expect(await mount()).toContain('Contas5+1 em 7 dias');
  });

  it('a recusa que chega pelos recados também tranca o painel', async () => {
    mockDb.feedback.mockResolvedValue(refusal);
    const text = await mount();
    expect(text).toContain(APP_DASHBOARD_FORBIDDEN);
    expect(text).not.toContain('Contas5');
  });

  it('puxar a tela na aba Recados busca os recados de novo, não os números', async () => {
    mockParams.value = { aba: 'recados' };
    await mount();
    const before = { dashboard: dashboardCalls(), feedback: mockDb.feedback.mock.calls.length };
    await pull();
    expect(dashboardCalls()).toBe(before.dashboard);
    expect(mockDb.feedback.mock.calls.length).toBeGreaterThan(before.feedback);
  });
});

describe('Painel do app no computador', () => {
  it('no celular, uma coluna só: os quatro números em 2×2 e nenhuma grade', async () => {
    await mount();
    const styles = viewStyles();
    expect(styles.some((style) => style.maxWidth === PANEL_MAX_WIDTH)).toBe(true);
    expect(styles.filter((style) => style.flexBasis === '45%')).toHaveLength(4);
    expect(styles.some((style) => style.flexBasis === '22%')).toBe(false);
    expect(gridCells()).toEqual([]);
  });

  it('numa janela larga: os quatro números numa linha e as seções em três colunas, "O que as casas usam" em duas', async () => {
    mockWindow.width = 1280;
    const text = await mount();
    expect(text).toContain('Contas5+1 em 7 dias');
    expect(viewStyles().filter((style) => style.flexBasis === '22%')).toHaveLength(4);
    // Uso por dia, Novas contas, Entrada | Nuke e IA empilhados, O que as casas usam (duas) | Aparelhos, Outros.
    const third = panelCellPercent(3);
    expect(gridCells()).toEqual([third, third, third, third, panelCellPercent(3, 2), third, third]);
    expect(sectionTitles()).toEqual(['Agora', 'Uso por dia', 'Novas contas', 'Entrada', 'Nuke', 'IA', 'O que as casas usam', 'Aparelhos', 'Outros']);
  });

  it('numa janela média, duas colunas', async () => {
    mockWindow.width = 900;
    await mount();
    const half = panelCellPercent(2);
    expect(gridCells()).toEqual([half, half, half, half, '100%', half, half, half]);
    // A ordem de sempre: só as três colunas empilham o Nuke e a IA.
    expect(sectionTitles()).toEqual(['Agora', 'Uso por dia', 'Novas contas', 'Nuke', 'IA', 'O que as casas usam', 'Entrada', 'Aparelhos', 'Outros']);
    expect(viewStyles().filter((style) => style.flexBasis === '22%')).toHaveLength(4);
  });
});

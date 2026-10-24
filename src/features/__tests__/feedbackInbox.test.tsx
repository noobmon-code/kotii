import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Platform } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import AppDashboardScreen from '@/app/painel';
import { APP_DASHBOARD_FORBIDDEN } from '@/domain/appDashboard';
import {
  FEEDBACK_DETAIL_EMPTY,
  FEEDBACK_GONE,
  FEEDBACK_INBOX_NOT_READY,
  FEEDBACK_NO_EMAIL,
  FEEDBACK_NOTE_SAVE,
  FEEDBACK_REPLY,
  FEEDBACK_SEARCH_PLACEHOLDER,
  feedbackTitle,
  parseFeedbackItem,
  replyMailto,
} from '@/domain/appFeedback';
import { openExternal } from '@/lib/openLink';
import { notify } from '@/ui/dialogs';

// A aba Recados do Painel do app com o banco de mentira (as três rpc dos recados respondem como a migração
// 20261024150000_app_feedback.sql) e a busca de verdade (data/appFeedback, QueryClient real): os filtros e a
// busca, abrir um recado novo o marca como lido (uma vez por abertura), os botões de situação, a nota, a resposta
// por e-mail, o banco sem a migração, a recusa e o erro. No celular (360) e no computador (1280), com as teclas do
// navegador. Os textos são os de domain/appFeedback, de verdade.

/** Um recado como app_feedback_list devolve. */
interface RawFeedback {
  id: string;
  created_at: string;
  updated_at: string;
  kind: string;
  message: string;
  platform: string | null;
  app_version: string | null;
  status: string;
  note: string | null;
  email: string | null;
}

type Answer = { data: unknown; error: unknown };

const mockDb = {
  rows: [] as RawFeedback[],
  calls: [] as { name: string; args?: Record<string, unknown> }[],
  /** No lugar da resposta de app_feedback_list (uma recusa, um erro). */
  listAnswer: null as Answer | null,
  /** No lugar da resposta de set_app_feedback. */
  setAnswer: null as Answer | null,
  /** Segura a resposta de set_app_feedback até ser solta. */
  hold: null as Promise<void> | null,
};

function mockList(args?: Record<string, unknown>): Answer {
  const status = (args?.p_status as string | null | undefined) ?? null;
  const limit = (args?.p_limit as number | undefined) ?? 200;
  const all = [...mockDb.rows].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : -1));
  const matching = status ? all.filter((row) => row.status === status) : all;
  const counts = { novo: 0, lido: 0, resolvido: 0, arquivado: 0 } as Record<string, number>;
  for (const row of all) counts[row.status] += 1;
  return { data: { counts, total: matching.length, items: matching.slice(0, limit).map((row) => ({ ...row })) }, error: null };
}

function mockChange(args?: Record<string, unknown>): Answer {
  const row = mockDb.rows.find((entry) => entry.id === args?.p_id);
  if (!row) return { data: null, error: { code: 'P0002', message: 'Este recado não existe mais.' } };
  if (typeof args?.p_status === 'string') row.status = args.p_status;
  if (typeof args?.p_note === 'string') row.note = args.p_note.trim() || null;
  row.updated_at = '2026-10-24T18:00:00Z';
  return { data: { ...row }, error: null };
}

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: async (name: string, args?: Record<string, unknown>) => {
      mockDb.calls.push({ name, args });
      // O painel dos números ainda sem a migração: esta aba não depende dele.
      if (name === 'app_dashboard') {
        return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.app_dashboard' } };
      }
      if (name === 'app_feedback_list') return mockDb.listAnswer ?? mockList(args);
      if (name === 'set_app_feedback') {
        if (mockDb.hold) await mockDb.hold;
        return mockDb.setAnswer ?? mockChange(args);
      }
      return { data: null, error: { code: 'XX000', message: `rpc inesperada: ${name}` } };
    },
  },
  errorMessage: (error: unknown) => (error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error)),
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'dono', email: 'dono@exemplo.com' } } }) }));
jest.mock('@/lib/openLink', () => ({ openExternal: jest.fn(async () => true) }));
jest.mock('@/ui/dialogs', () => ({ notify: jest.fn() }));
const mockParams = { value: { aba: 'recados' } as Record<string, string>, listeners: new Set<() => void>() };
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
const mockWindow = { width: 360, height: 800, scale: 2, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));

const LENTO = 'O app fica lento quando abro a lista de compras.\nAcontece no navegador e no celular.';
const ESCURO = 'Seria ótimo ter o modo escuro automático.';
const ELOGIO = 'Adorei o Nuke, a lista ficou muito mais fácil.';
const CONTA = 'Como faço para apagar a minha conta?';

function rows(): RawFeedback[] {
  const base = { platform: 'web', app_version: '1.4.0', note: null };
  return [
    { ...base, id: 'r1', created_at: '2026-10-24T13:00:00Z', updated_at: '2026-10-24T13:00:00Z', kind: 'problema', message: LENTO, status: 'novo', email: 'ana@exemplo.com' },
    { ...base, id: 'r2', created_at: '2026-10-24T12:00:00Z', updated_at: '2026-10-24T12:00:00Z', kind: 'sugestao', message: ESCURO, platform: 'ios', status: 'novo', email: 'bia@exemplo.com' },
    { ...base, id: 'r3', created_at: '2026-10-23T10:00:00Z', updated_at: '2026-10-23T11:00:00Z', kind: 'elogio', message: ELOGIO, platform: 'android', app_version: null, status: 'lido', note: 'Respondido por e-mail', email: null },
    { ...base, id: 'r4', created_at: '2026-10-22T10:00:00Z', updated_at: '2026-10-22T10:00:00Z', kind: 'outro', message: CONTA, platform: null, status: 'resolvido', email: 'caio@exemplo.com' },
  ];
}

let renderer: ReactTestRenderer | undefined;
let queryClient: QueryClient;

const textOf = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map(textOf).join(''));
const page = () => textOf(renderer!.root);

async function settle() {
  for (let i = 0; i < 6; i += 1) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
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

/** As linhas da lista, na ordem da tela (o título de cada uma). */
const rowNodes = () => renderer!.root.findAll((node) => node.props.row !== undefined && typeof node.props.onPress === 'function');
const rowTitles = () => rowNodes().map((node) => node.props.row.title as string);
const rowFor = (message: string) => rowNodes().find((node) => node.props.row.title === feedbackTitle(message))!;
const openRow = async (message: string) => {
  await act(async () => rowFor(message).props.onPress());
  await settle();
};
/** Um filtro (Chip) pelo rótulo. */
const chip = (label: string) =>
  renderer!.root.findAll((node) => node.props.label === label && typeof node.props.onPress === 'function' && 'selected' in node.props)[0];
const pressChip = async (label: string) => {
  await act(async () => chip(label).props.onPress());
  await settle();
};
const button = (title: string) =>
  renderer!.root.findAll((node) => node.props.title === title && typeof node.props.onPress === 'function')[0];
const press = async (title: string) => {
  await act(async () => button(title).props.onPress());
  await settle();
};
const search = async (text: string) => {
  const field = renderer!.root.findAll((node) => node.props.placeholder === FEEDBACK_SEARCH_PLACEHOLDER && typeof node.props.onChangeText === 'function')[0];
  await act(async () => field.props.onChangeText(text));
  await settle();
};
const noteField = () =>
  renderer!.root.findAll((node) => node.props.accessibilityLabel === 'Nota (só você vê)' && typeof node.props.onChangeText === 'function')[0];
/** A Screen do painel (o que ela recebe decide se a tela rola). */
const screenNode = () => renderer!.root.findAll((node) => typeof node.props.onRefresh === 'function' && 'scroll' in node.props)[0];
const writes = () => mockDb.calls.filter((call) => call.name === 'set_app_feedback').map((call) => call.args);
const lists = () => mockDb.calls.filter((call) => call.name === 'app_feedback_list').map((call) => call.args?.p_status);

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.rows = rows();
  mockDb.calls = [];
  mockDb.listAnswer = null;
  mockDb.setAnswer = null;
  mockDb.hold = null;
  mockParams.value = { aba: 'recados' };
  mockWindow.width = 360;
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } } });
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  queryClient.clear();
  onlineManager.setOnline(true);
});

describe('Recados no celular', () => {
  it('abre nos novos, com as contagens nos filtros; "Todos" pede a lista sem filtro', async () => {
    const text = await mount();
    expect(text).toContain('Novos (2)');
    expect(text).toContain('Lidos (1)');
    expect(text).toContain('Resolvidos (1)');
    expect(text).toContain('Arquivados (0)');
    expect(text).toContain('Todos (4)');
    expect(chip('Novos (2)').props.selected).toBe(true);
    // No celular, a lista rola com a tela.
    expect(screenNode().props.scroll).toBe(true);
    expect(rowTitles()).toEqual([feedbackTitle(LENTO), feedbackTitle(ESCURO)]);
    expect(text).toContain('2 recados');
    // A primeira linha do recado, só.
    expect(text).not.toContain('Acontece no navegador');

    await pressChip('Todos (4)');
    expect(lists()).toContain(null);
    expect(rowTitles()).toEqual([LENTO, ESCURO, ELOGIO, CONTA].map(feedbackTitle));
    await pressChip('Arquivados (0)');
    expect(page()).toContain('Nenhum recado arquivado.');
  });

  it('sem nenhum recado novo, abre em todos', async () => {
    mockDb.rows = rows().filter((row) => row.status !== 'novo');
    await mount();
    expect(chip('Todos (2)').props.selected).toBe(true);
    expect(rowTitles()).toEqual([ELOGIO, CONTA].map(feedbackTitle));
  });

  it('o tipo e a busca filtram o que veio, sem acento e sem maiúscula; nada achado tem a sua frase', async () => {
    await mount();
    await pressChip('Todos (4)');
    await pressChip('Problema');
    expect(rowTitles()).toEqual([feedbackTitle(LENTO)]);
    expect(page()).toContain('1 de 4 recados');
    await pressChip('Todos os tipos');
    await search('OTIMO escuro');
    expect(rowTitles()).toEqual([feedbackTitle(ESCURO)]);
    // A busca também olha o e-mail e a nota.
    await search('caio@');
    expect(rowTitles()).toEqual([feedbackTitle(CONTA)]);
    await search('respondido');
    expect(rowTitles()).toEqual([feedbackTitle(ELOGIO)]);
    await search('impressora');
    expect(rowTitles()).toEqual([]);
    expect(page()).toContain('Nenhum recado com “impressora”.');
    // Nada disso pediu outra lista ao servidor.
    expect(lists().filter((status) => status === null)).toHaveLength(1);
  });

  it('o toque abre o recado na linha e marca como lido uma vez; a linha fica na lista dos novos até trocar de filtro', async () => {
    await mount();
    await openRow(LENTO);
    expect(writes()).toEqual([{ p_id: 'r1', p_status: 'lido', p_note: null }]);
    const text = page();
    // O recado inteiro, o e-mail, o aparelho e os botões.
    expect(text).toContain('Acontece no navegador e no celular.');
    expect(text).toContain('ana@exemplo.com');
    expect(text).toContain('Navegador · versão 1.4.0');
    expect(rowFor(LENTO).props.expanded).toBe(true);
    // Já lido: a contagem andou, e a linha continua lá, agora como lida.
    expect(text).toContain('Novos (1)');
    expect(text).toContain('Lidos (2)');
    expect(rowTitles()).toEqual([feedbackTitle(LENTO), feedbackTitle(ESCURO)]);
    expect(rowFor(LENTO).props.row.statusLabel).toBe('Lido');
    expect(button('Marcar como novo')).toBeDefined();

    // Fechar e abrir de novo um recado já lido não grava nada.
    await openRow(LENTO);
    expect(rowFor(LENTO).props.expanded).toBe(false);
    await openRow(LENTO);
    expect(writes()).toHaveLength(1);

    // "Marcar como novo" com ele aberto não é desfeito pela abertura.
    await press('Marcar como novo');
    expect(writes()[1]).toEqual({ p_id: 'r1', p_status: 'novo', p_note: null });
    expect(writes()).toHaveLength(2);
    expect(page()).toContain('Novos (2)');

    // Trocar de filtro esquece as linhas que saíram dele.
    await pressChip('Lidos (1)');
    expect(rowTitles()).toEqual([feedbackTitle(ELOGIO)]);
  });

  it('os botões de situação gravam e ficam parados enquanto a mudança está no ar', async () => {
    await mount();
    await pressChip('Todos (4)');
    await openRow(ELOGIO);
    expect(writes()).toEqual([]);
    let release = () => undefined as void;
    mockDb.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    await act(async () => button('Marcar como resolvido').props.onPress());
    // Girando o tocado, e os outros parados.
    expect(button('Arquivar').props.disabled).toBe(true);
    expect(button(FEEDBACK_NOTE_SAVE).props.disabled).toBe(true);
    expect(button('Marcar como resolvido').props.loading).toBe(true);
    await act(async () => release());
    await settle();
    expect(writes()).toEqual([{ p_id: 'r3', p_status: 'resolvido', p_note: null }]);
    expect(page()).toContain('Resolvidos (2)');
    // Resolvido: arquivar ou voltar para lidos.
    expect(button('Voltar para lidos')).toBeDefined();
    expect(button('Arquivar').props.disabled).toBe(false);
    await press('Arquivar');
    expect(writes()[1]).toEqual({ p_id: 'r3', p_status: 'arquivado', p_note: null });
    expect(page()).toContain('Arquivados (1)');
  });

  it('a nota: o botão só com uma mudança; salvar grava a nota, e apagar o texto apaga a nota', async () => {
    await mount();
    await pressChip('Todos (4)');
    await openRow(ELOGIO);
    expect(noteField().props.value).toBe('Respondido por e-mail');
    expect(button(FEEDBACK_NOTE_SAVE).props.disabled).toBe(true);
    await act(async () => noteField().props.onChangeText('Respondido por e-mail  '));
    // Espaço nas pontas não é mudança.
    expect(button(FEEDBACK_NOTE_SAVE).props.disabled).toBe(true);
    await act(async () => noteField().props.onChangeText('  Mandei o link da loja  '));
    expect(button(FEEDBACK_NOTE_SAVE).props.disabled).toBe(false);
    await press(FEEDBACK_NOTE_SAVE);
    expect(writes()).toEqual([{ p_id: 'r3', p_status: null, p_note: 'Mandei o link da loja' }]);
    expect(button(FEEDBACK_NOTE_SAVE).props.disabled).toBe(true);
    await act(async () => noteField().props.onChangeText(''));
    await press(FEEDBACK_NOTE_SAVE);
    expect(writes()[1]).toEqual({ p_id: 'r3', p_status: null, p_note: '' });
    expect(mockDb.rows.find((row) => row.id === 'r3')!.note).toBeNull();
    // Longa demais: a frase, e o botão parado.
    await act(async () => noteField().props.onChangeText('x'.repeat(2001)));
    expect(page()).toContain('A nota pode ter até 2000 caracteres.');
    expect(button(FEEDBACK_NOTE_SAVE).props.disabled).toBe(true);
  });

  it('"Responder por e-mail" abre o e-mail pronto; sem e-mail, a frase no lugar do botão', async () => {
    await mount();
    await openRow(ESCURO);
    await press(FEEDBACK_REPLY);
    const item = parseFeedbackItem({ ...mockDb.rows.find((row) => row.id === 'r2')! });
    expect(openExternal).toHaveBeenCalledWith(replyMailto(item));
    expect(jest.mocked(openExternal).mock.calls[0][0]).toMatch(/^mailto:bia@exemplo\.com\?subject=/);

    await pressChip('Todos (4)');
    await openRow(ELOGIO);
    expect(page()).toContain(FEEDBACK_NO_EMAIL);
    expect(button(FEEDBACK_REPLY)).toBeUndefined();
  });

  it('o recado que sumiu no meio: o aviso, e ele sai da lista', async () => {
    await mount();
    await pressChip('Todos (4)');
    await openRow(CONTA);
    mockDb.rows = mockDb.rows.filter((row) => row.id !== 'r4');
    await press('Arquivar');
    expect(notify).toHaveBeenCalledWith('Não deu para salvar o recado', FEEDBACK_GONE);
    expect(rowTitles()).toEqual([LENTO, ESCURO, ELOGIO].map(feedbackTitle));
  });

  it('antes da migração: o aviso, nunca um erro', async () => {
    mockDb.listAnswer = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.app_feedback_list' } };
    const text = await mount();
    expect(text).toContain(FEEDBACK_INBOX_NOT_READY);
    expect(text).not.toContain('Tentar de novo');
  });

  it('para quem não mantém o app: o cadeado do painel', async () => {
    mockDb.listAnswer = { data: null, error: { code: '42501', message: 'Este painel é só para quem mantém o app.' } };
    const text = await mount();
    expect(text).toContain(APP_DASHBOARD_FORBIDDEN);
    expect(text).not.toContain('Novos');
    expect(button('Voltar')).toBeDefined();
  });

  it('o erro com "Tentar de novo"; a nova busca que falha deixa a lista na tela com o aviso', async () => {
    mockDb.listAnswer = { data: null, error: { code: 'XX000', message: 'O servidor não respondeu.' } };
    expect(await mount()).toContain('O servidor não respondeu.Tentar de novo');
    mockDb.listAnswer = null;
    await press('Tentar de novo');
    expect(rowTitles()).toEqual([LENTO, ESCURO].map(feedbackTitle));

    mockDb.listAnswer = { data: null, error: new Error('Sem internet agora.') };
    const screen = renderer!.root.findAll((node) => typeof node.props.onRefresh === 'function')[0];
    await act(async () => screen.props.onRefresh());
    await settle();
    expect(page()).toContain('Não foi possível atualizar. Mostrando o que já estava carregado.');
    expect(rowTitles()).toEqual([LENTO, ESCURO].map(feedbackTitle));
  });

  it('sem internet e nada na memória: o aviso, e os recados chegam sozinhos com a conexão', async () => {
    onlineManager.setOnline(false);
    expect(await mount()).toContain('Sem internet. Os recados aparecem quando a conexão voltar.');
    await act(async () => onlineManager.setOnline(true));
    await settle();
    expect(rowTitles()).toEqual([LENTO, ESCURO].map(feedbackTitle));
  });
});

describe('Recados no computador', () => {
  beforeEach(() => {
    mockWindow.width = 1280;
  });

  it('a lista e o recado lado a lado, cada um com a sua rolagem; a tela não rola', async () => {
    const text = await mount();
    expect(text).toContain(FEEDBACK_DETAIL_EMPTY);
    // A tela sem rolagem: rolam a lista e o recado aberto, cada um do seu lado.
    expect(screenNode().props.scroll).toBe(false);
    await openRow(ESCURO);
    expect(writes()).toEqual([{ p_id: 'r2', p_status: 'lido', p_note: null }]);
    expect(page()).not.toContain(FEEDBACK_DETAIL_EMPTY);
    expect(page()).toContain('iPhone/iPad · versão 1.4.0');
    expect(rowFor(ESCURO).props.selected).toBe(true);
    expect(rowFor(LENTO).props.selected).toBe(false);
    // O botão de atualizar busca de novo.
    const before = lists().length;
    await act(async () => renderer!.root.findAll((node) => node.props.label === 'Buscar os recados de novo' && typeof node.props.onPress === 'function')[0].props.onPress());
    await settle();
    expect(lists().length).toBeGreaterThan(before);
  });

  describe('no navegador', () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const os = Platform.OS;
    beforeEach(() => {
      listeners.clear();
      (global as { document?: unknown }).document = {
        addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
        removeEventListener: (type: string, listener: (event: unknown) => void) => {
          if (listeners.get(type) === listener) listeners.delete(type);
        },
      };
      Platform.OS = 'web';
    });
    afterEach(() => {
      Platform.OS = os;
      delete (global as { document?: unknown }).document;
    });
    const key = async (name: string, target: unknown = null) => {
      const event = { key: name, target, defaultPrevented: false, altKey: false, ctrlKey: false, metaKey: false, preventDefault: jest.fn() };
      await act(async () => listeners.get('keydown')!(event));
      await settle();
      return event;
    };
    const selectedTitle = () => rowNodes().find((node) => node.props.selected)?.props.row.title;

    it('↓/↑ e j/k passam de um recado para o outro, fora dos campos de texto', async () => {
      await mount();
      await pressChip('Todos (4)');
      expect(page()).toContain('Dica: ↑ e ↓ (ou j e k) passam de um recado para o outro.');
      const down = await key('ArrowDown');
      expect(down.preventDefault).toHaveBeenCalled();
      expect(selectedTitle()).toBe(feedbackTitle(LENTO));
      await key('j');
      expect(selectedTitle()).toBe(feedbackTitle(ESCURO));
      await key('k');
      expect(selectedTitle()).toBe(feedbackTitle(LENTO));
      await key('ArrowUp');
      expect(selectedTitle()).toBe(feedbackTitle(LENTO));
      // Escrevendo a nota ou a busca, as teclas são do campo.
      await key('j', { tagName: 'TEXTAREA' });
      expect(selectedTitle()).toBe(feedbackTitle(LENTO));
      // Cada recado novo aberto pelas teclas foi marcado como lido, uma vez.
      expect(writes()).toEqual([
        { p_id: 'r1', p_status: 'lido', p_note: null },
        { p_id: 'r2', p_status: 'lido', p_note: null },
      ]);
      await act(async () => renderer!.unmount());
      renderer = undefined;
      expect(listeners.has('keydown')).toBe(false);
    });
  });
});

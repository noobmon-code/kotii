import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import type { ReactElement } from 'react';
import { AccessibilityInfo, Platform, Share } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import SettingsScreen from '@/app/(tabs)/configuracoes';
import RemindersScreen from '@/app/avisos';
import ProfileScreen from '@/app/perfil';
import FeedbackScreen from '@/app/recado';
import { APP_DASHBOARD_TITLE } from '@/domain/appDashboard';
import { HOUSE_PLACE_ROW_HINT, HOUSE_PLACE_ROW_UNKNOWN, HOUSE_PLACE_TITLE } from '@/domain/housePlace';
import {
  FEEDBACK_DISCLOSURE,
  FEEDBACK_FORM_INTRO,
  FEEDBACK_FORM_KIND_LABEL,
  FEEDBACK_FORM_PLACEHOLDER,
  FEEDBACK_FORM_TITLE,
  FEEDBACK_LIMIT,
  FEEDBACK_MAX_LENGTH,
  FEEDBACK_NOT_READY,
  FEEDBACK_SENT,
} from '@/domain/appFeedback';
import { THEME_HINT } from '@/domain/appearance';
import { PROFILE_MESSAGES, PROFILE_NAME_HINT, PROFILE_NOT_READY, PROFILE_PRIVACY } from '@/domain/profile';
import { SHARING_ABOUT, SHARING_SUMMARY, SHARING_TITLE } from '@/domain/sharedPrices';
import { MODERATION_TITLE } from '@/domain/storeModeration';
import { TERMS_TITLE, termsVersionLabel } from '@/domain/terms';
import { OFFLINE_TRY_AGAIN } from '@/lib/networkErrors';
import { THEME_CHOICE_KEY } from '@/lib/themeChoice';
import { confirmAction, notify } from '@/ui/dialogs';
import { Chip, Screen } from '@/ui/primitives';
import { PALETTES } from '@/ui/theme';
import { ThemeChoiceProvider } from '@/ui/ThemeChoiceProvider';

// A aba Configurações (que juntou a antiga aba Família e a tela de Configurações) e as telas que ela abre por uma
// linha, com o banco de mentira. A aba: as categorias na ordem (Casa, Avisos, Você, Sobre o Kotii, Conta e, só para
// quem tem acesso, Manutenção do app), os moradores (tocar abre a ficha), o convite (o código só ao tocar), as
// pessoas e pets sem celular (a lista das fichas, com o cadastro), o uso da IA e os preços compartilhados (linhas que
// abrem ao tocar), o tema (que muda as cores e fica no aparelho), sair (com a explicação de sair da casa junto do
// botão dela) e apagar a conta, e o painel e a moderação. O perfil (/perfil: lido da tabela, salvo numa chamada só, com os erros
// do banco em palavras, e só o nome com um aviso quando a migração ainda não chegou) e o recado escrito pela pessoa
// (/recado: send_app_feedback, sem IA no meio) são telas próprias.

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
const mockSystem = { scheme: 'light' as 'light' | 'dark' };
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ __esModule: true, default: () => mockSystem.scheme }));

/**
 * A tabela profiles e a save_my_profile, como o PostgREST responderia; is_app_admin, o uso da IA e a pergunta dos
 * preços compartilhados respondem à parte.
 */
const mockDb = {
  read: { data: null as unknown, error: null as unknown },
  rpc: jest.fn(async (_name: string, _args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> => ({ data: null, error: null })),
  reads: [] as { table: string; filter: [string, unknown] }[],
  /** A resposta de is_app_admin: quase todo mundo não mantém o app. */
  admin: { data: false as unknown, error: null as unknown },
  /** O uso da IA neste mês (ai_usage_summary). */
  aiUsage: { data: [] as unknown, error: null as unknown },
  /** O banco tem o compartilhamento de preços? (shared_prices_available) */
  sharing: { data: false as unknown, error: null as unknown },
};
const RPC_APART: Record<string, keyof typeof mockDb> = { is_app_admin: 'admin', ai_usage_summary: 'aiUsage', shared_prices_available: 'sharing' };
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: (column: string, value: unknown) => ({
          maybeSingle: async () => {
            mockDb.reads.push({ table, filter: [column, value] });
            return mockDb.read;
          },
        }),
      }),
    }),
    rpc: (name: string, args: Record<string, unknown>) =>
      name in RPC_APART ? Promise.resolve(mockDb[RPC_APART[name]]) : mockDb.rpc(name, args),
  },
  unwrap: (result: { data: unknown; error: unknown }) => {
    if (result.error) throw result.error;
    return result.data;
  },
  // Como o de verdade para o pedido que não chegou ao servidor ("Sem internet agora…"); o resto, a mensagem.
  errorMessage: (error: unknown) => {
    const network = jest.requireActual<typeof import('@/lib/networkErrors')>('@/lib/networkErrors');
    if (network.isNetworkFailure(error)) return network.OFFLINE_TRY_AGAIN;
    return error instanceof Error ? error.message : String(error);
  },
}));
type Member = { household_id: string; user_id: string; display_name: string; role: 'owner' | 'member' };
const mockMe: Member = { household_id: 'h1', user_id: 'ana', display_name: 'Ana', role: 'owner' };
const mockBeto: Member = { household_id: 'h1', user_id: 'beto', display_name: 'Beto', role: 'member' };
// Quem está na casa (com mais de uma pessoa, sair não apaga a casa), quem é a pessoa deste aparelho, e as casas
// dela: com mais de uma, a linha do clima diz de qual casa é.
const mockHousehold = { members: [mockMe, mockBeto], me: mockMe, houses: [] as { id: string; name: string; role: string }[] };
const mockRefetchHousehold = jest.fn(async (): Promise<unknown> => undefined);
jest.mock('@/lib/auth', () => ({
  signOut: jest.fn(),
  useAuth: () => ({ session: { user: { id: 'ana', email: 'ana@exemplo.com' } } }),
  useHousehold: () => ({
    data: {
      household: { id: 'h1', name: 'Casa da Ana', invite_code: 'ABC234' },
      members: mockHousehold.members,
      me: mockHousehold.me,
      households: mockHousehold.houses,
    },
    refetch: mockRefetchHousehold,
  }),
}));
const mockLeave = { mutate: jest.fn(), isPending: false };
const mockRegenerate = { mutate: jest.fn(), isPending: false };
jest.mock('@/data/household', () => ({
  LastMemberError: class extends Error {},
  useSignOutQuestion: () => () => 'Deseja sair desta conta neste aparelho?',
  useLeaveHousehold: () => mockLeave,
  useRegenerateInviteCode: () => mockRegenerate,
  useRemoveMember: () => ({ mutate: jest.fn(), isPending: false }),
}));
// As fichas da casa: a de quem usa o app (member_user_id) e as de quem não usa (crianças e pets).
const mockPeople = { data: [] as { id: string; name: string; kind: 'pessoa' | 'pet'; member_user_id: string | null; species?: string | null }[] | undefined };
jest.mock('@/data/health', () => ({ usePeople: () => ({ data: mockPeople.data }) }));
jest.mock('@/data/home', () => ({ useKidPoints: () => ({ data: { 'p-lia': 3 } }) }));
jest.mock('@/lib/reminders', () => ({ REMINDER_PLACE: 'neste celular' }));
// Os interruptores dos avisos têm os testes deles (HouseRemindersSection.test): aqui, só onde eles ficam.
jest.mock('@/features/HouseRemindersSection', () => ({ HouseRemindersSection: () => 'Os interruptores dos avisos' }));
// Quem modera (a is_moderator): à parte do banco de mentira, que conta as chamadas do perfil.
const mockModerator = { value: false };
jest.mock('@/data/storeModeration', () => ({ useIsModerator: () => ({ data: mockModerator.value }) }));
// Onde fica a casa aberta (a linha "Clima da casa"): undefined enquanto carrega, null sem bairro.
const mockLocation = { data: null as { label: string } | null | undefined };
jest.mock('@/data/weather', () => ({ useHouseholdLocation: () => ({ data: mockLocation.data }) }));
jest.mock('@/ui/dialogs', () => ({ confirmAction: jest.fn(), notify: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), navigate: jest.fn() }, useFocusEffect: () => undefined }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));

let renderer: ReactTestRenderer | undefined;
let queryClient: QueryClient;

const rawText = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map(rawText).join(''));
const ICON_GLYPHS = new RegExp(
  `[${String.fromCodePoint(0xe000)}-${String.fromCodePoint(0xf8ff)}]|[${String.fromCodePoint(0xf0000)}-${String.fromCodePoint(0x10ffff)}]`,
  'gu',
);
const textOf = (node: ReactTestInstance | string) => rawText(node).replace(ICON_GLYPHS, '');
const page = () => textOf(renderer!.root);

async function settle() {
  for (let i = 0; i < 5; i += 1) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

/** A tela que `mount` abre: a aba, ou (nos blocos delas) o perfil ou o recado. */
let shown: () => ReactElement = () => <SettingsScreen />;

async function mount() {
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={queryClient}>
        <ThemeChoiceProvider>{shown()}</ThemeChoiceProvider>
      </QueryClientProvider>,
    );
  });
  await settle();
  return page();
}

/** O campo com esse rótulo. */
const field = (label: string) =>
  renderer!.root.findAll((node) => node.props.label === label && typeof node.props.onChangeText === 'function')[0];
const type = async (label: string, text: string) => {
  await act(async () => field(label).props.onChangeText(text));
};
const button = (title: string) =>
  renderer!.root.findAll((node) => node.props.title === title && typeof node.props.onPress === 'function')[0];
const press = async (title: string) => {
  await act(async () => button(title).props.onPress());
  await settle();
};
/** O que tem esse texto e um toque (as opções do tema, a linha dos termos). */
const pressable = (label: string) =>
  renderer!.root.findAll((node) => typeof node.props.onPress === 'function' && textOf(node) === label)[0];

beforeEach(() => {
  jest.clearAllMocks();
  shown = () => <SettingsScreen />;
  mockModerator.value = false;
  mockLocation.data = null;
  mockHousehold.members = [mockMe, mockBeto];
  mockHousehold.me = mockMe;
  mockHousehold.houses = [];
  mockPeople.data = [];
  mockLeave.isPending = false;
  mockRegenerate.isPending = false;
  mockSystem.scheme = 'light';
  mockDb.read = { data: { birth_date: '1985-03-05', phone: '83999999999' }, error: null };
  mockDb.reads = [];
  mockDb.admin = { data: false, error: null };
  mockDb.aiUsage = { data: [], error: null };
  mockDb.sharing = { data: false, error: null };
  mockDb.rpc.mockImplementation(async (_name, args) => ({
    data: { name: String(args.p_name), birth_date: args.p_birth_date ?? null, phone: args.p_phone ?? null },
    error: null,
  }));
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  queryClient.setQueryData(['household', 'ana'], {
    household: { id: 'h1', name: 'Casa da Ana' },
    members: [mockMe, { household_id: 'h1', user_id: 'beto', display_name: 'Beto', role: 'member' }],
    me: mockMe,
    households: [{ id: 'h1', name: 'Casa da Ana', role: 'owner' }],
  });
});

/** A tela no navegador, até o fim do teste. */
let webOS: { restore: () => void } | undefined;
const onWeb = () => {
  webOS = jest.replaceProperty(Platform, 'OS', 'web');
};

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  webOS?.restore();
  webOS = undefined;
  queryClient.clear();
  await AsyncStorage.clear();
});

describe('Configurações: a aba', () => {
  it('as categorias, do mais usado ao mais raro e com as saídas no fim, sem o cartão do topo, a engrenagem nem a linha do fim', async () => {
    const text = await mount();
    const order = [
      'Casa',
      'Moradores (2)',
      'Convidar',
      'Pessoas e pets sem celular',
      HOUSE_PLACE_TITLE,
      'Suas casas',
      'AvisosAvisos neste celular',
      'Você',
      'Perfil',
      `Tema${'Automático'}`,
      'Sobre o Kotii',
      'Uso da IA neste mês',
      TERMS_TITLE,
      FEEDBACK_FORM_TITLE,
      'ContaSair da conta',
      'Sair desta casa',
      'Apagar minha conta',
    ];
    const at = order.map((part) => text.indexOf(part));
    expect(at.every((index) => index >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // O nome da aba é o título da página só para o leitor de tela; o primeiro a aparecer é a categoria Casa.
    expect(text.startsWith('ConfiguraçõesCasaMoradores (2)')).toBe(true);
    const headers = renderer!.root.findAll((node) => typeof node.type === 'string' && node.props.accessibilityRole === 'header');
    expect(headers[0].props.children).toBe('Configurações');
    expect(renderer!.root.findByType(Screen).props.heading).toBe('Configurações');
    // A engrenagem do topo e a linha "Configurações" do fim abriam esta mesma tela: saíram.
    expect(renderer!.root.findAll((node) => node.props.accessibilityLabel === 'Configurações' && 'onPress' in node.props)).toHaveLength(0);
    expect(text.split('Configurações')).toHaveLength(2);
    // Os formulários e os interruptores ficam nas telas próprias, e o uso da IA abre só ao tocar: a aba é curta.
    expect(renderer!.root.findAll((node) => node.props.label === 'Nome' || node.props.label === 'Recado')).toHaveLength(0);
    expect(renderer!.root.findAll((node) => node.props.accessibilityRole === 'switch')).toHaveLength(0);
    expect(text).not.toContain('Limite da casa para não passar do custo combinado.');
    // Os documentos foram para Casa → Documentos.
    expect(text).not.toContain('Documentos');
  });

  it('tocar num morador abre a ficha dele (a da saúde); sem a ficha, a linha só mostra', async () => {
    mockPeople.data = [
      { id: 'p-ana', name: 'Ana', kind: 'pessoa', member_user_id: 'ana' },
      { id: 'p-lia', name: 'Lia', kind: 'pessoa', member_user_id: null },
    ];
    await mount();
    const row = (title: string) => renderer!.root.findAll((node) => node.props.title === title && 'onPress' in node.props)[0];
    expect(typeof row('Ana (você)').props.onPress).toBe('function');
    await act(async () => row('Ana (você)').props.onPress());
    expect(router.push).toHaveBeenCalledWith({ pathname: '/pessoa/[id]', params: { id: 'p-ana' } });
    // Beto ainda não tem ficha nesta casa (ou as fichas não chegaram): nada a abrir.
    expect(row('Beto').props.onPress).toBeUndefined();
  });

  it('"Convidar" mostra o código só ao tocar, com compartilhar e, para quem é responsável, trocar o código', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    expect(await mount()).not.toContain('ABC234');
    const invite = () => renderer!.root.findAll((node) => node.props.title === 'Convidar' && typeof node.props.onPress === 'function')[0];
    expect(invite().props.expanded).toBe(false);
    await act(async () => invite().props.onPress());
    expect(invite().props.expanded).toBe(true);
    expect(page()).toContain('ConvidarCódigo de convite desta casaABC234Quem entrar com este código vê e edita tudo da casa');
    await press('Compartilhar convite');
    expect(share).toHaveBeenCalledWith({ message: 'Entre na nossa casa "Casa da Ana" no Kotii com o código ABC234.' });
    await press('Trocar código');
    expect(jest.mocked(confirmAction).mock.lastCall?.[0]).toBe('Trocar o código de convite');
    // Tocar de novo esconde.
    await act(async () => invite().props.onPress());
    expect(page()).not.toContain('ABC234');
    await act(async () => renderer?.unmount());

    // Quem não é responsável vê e compartilha o código, mas não troca.
    mockHousehold.me = mockBeto;
    await mount();
    await act(async () => invite().props.onPress());
    expect(page()).toContain('ABC234');
    expect(page()).toContain('Compartilhar convite');
    expect(page()).not.toContain('Trocar código');
    share.mockRestore();
  });

  it('pessoas e pets sem celular: as fichas e o cadastro (Saúde → Cuidados não cadastra mais)', async () => {
    mockPeople.data = [
      { id: 'p-ana', name: 'Ana', kind: 'pessoa', member_user_id: 'ana' },
      { id: 'p-lia', name: 'Lia', kind: 'pessoa', member_user_id: null },
      { id: 'p-rex', name: 'Rex', kind: 'pet', member_user_id: null, species: 'Cachorro' },
    ];
    const text = await mount();
    expect(text).toContain('Lia3 pontos nas tarefasRexCachorroAdicionar pessoaAdicionar pet');
    await act(async () => pressable('Lia3 pontos nas tarefas').props.onPress());
    expect(router.push).toHaveBeenCalledWith({ pathname: '/pessoa/[id]', params: { id: 'p-lia' } });
    await press('Adicionar pessoa');
    expect(router.push).toHaveBeenCalledWith({ pathname: '/pessoa/[id]', params: { id: 'nova', kind: 'pessoa' } });
    await press('Adicionar pet');
    expect(router.push).toHaveBeenCalledWith({ pathname: '/pessoa/[id]', params: { id: 'nova', kind: 'pet' } });
  });

  it('os avisos e o recado são linhas que abrem telas próprias', async () => {
    await mount();
    expect(page()).not.toContain('Os interruptores dos avisos');
    await act(async () => pressable('Avisos neste celularTarefas, remédios, consultas e mais, por notificação').props.onPress());
    expect(router.push).toHaveBeenCalledWith('/avisos');
    await act(async () => pressable(`${FEEDBACK_FORM_TITLE}Um problema, uma sugestão ou um elogio sobre o app`).props.onPress());
    expect(router.push).toHaveBeenCalledWith('/recado');
  });

  it('Sobre o Kotii: o uso da IA e os preços compartilhados (quando o banco tem), fechados, e depois os termos', async () => {
    mockDb.aiUsage = { data: [{ kind: 'chat', used: 12, lim: 100 }], error: null };
    mockDb.sharing = { data: true, error: null };
    const text = await mount();
    expect(text).toContain(
      `Sobre o KotiiUso da IA neste mêsQuanto a casa já usou do limite do mês${SHARING_TITLE}${SHARING_SUMMARY}${TERMS_TITLE}${termsVersionLabel()}`,
    );
    const row = (title: string) => renderer!.root.findAll((node) => node.props.title === title && typeof node.props.onPress === 'function')[0];
    // Cada uma abre ali mesmo, ao tocar, como o "Convidar", e fecha no segundo toque.
    expect(row('Uso da IA neste mês').props.expanded).toBe(false);
    await act(async () => row('Uso da IA neste mês').props.onPress());
    expect(row('Uso da IA neste mês').props.expanded).toBe(true);
    expect(page()).toContain(
      'Uso da IA neste mêsQuanto a casa já usou do limite do mêsMensagens com o Nuke12 de 100Limite da casa para não passar do custo combinado.',
    );
    await act(async () => row(SHARING_TITLE).props.onPress());
    expect(page()).toContain(`${SHARING_TITLE}${SHARING_SUMMARY}${SHARING_ABOUT}${TERMS_TITLE}`);
    await act(async () => row('Uso da IA neste mês').props.onPress());
    await act(async () => row(SHARING_TITLE).props.onPress());
    expect(page()).not.toContain('Mensagens com o Nuke');
    expect(page()).not.toContain(SHARING_ABOUT);
  });

  it('Sobre o Kotii: fechada, a linha do uso da IA já diz o limite que acabou ou está perto do fim', async () => {
    mockDb.aiUsage = {
      data: [
        { kind: 'chat', used: 12, lim: 100 },
        { kind: 'photo', used: 100, lim: 100 },
      ],
      error: null,
    };
    expect(await mount()).toContain('Uso da IA neste mêsAcabou o limite de leituras de foto (notas e saúde)');
  });
});

describe('Avisos (/avisos, da linha em Configurações → Avisos)', () => {
  it('a tela é a dos interruptores de cada aviso, sem nada da aba em volta', async () => {
    shown = () => <RemindersScreen />;
    expect(await mount()).toBe('Os interruptores dos avisos');
    // Logo abaixo do cabeçalho da pilha: sem a margem de cima do aparelho.
    expect(renderer!.root.findByType(Screen).props.edges).toEqual([]);
  });
});

describe('Perfil (/perfil, da linha "Perfil" em Configurações → Você)', () => {
  beforeEach(() => {
    shown = () => <ProfileScreen />;
  });

  it('lê a própria linha do perfil e mostra o nome da casa, a data, o telefone com a máscara e o e-mail só para ler', async () => {
    const text = await mount();
    expect(mockDb.reads).toEqual([{ table: 'profiles', filter: ['user_id', 'ana'] }]);
    expect(field('Nome').props.value).toBe('Ana');
    expect(field('Data de nascimento').props.value).toBe('05/03/1985');
    expect(field('Telefone').props.value).toBe('(83) 99999-9999');
    expect(text).toContain(PROFILE_PRIVACY);
    // A dica do nome diz que a ficha de saúde muda junto.
    expect(text).toContain(PROFILE_NAME_HINT);
    expect(PROFILE_NAME_HINT).toContain('ficha de saúde');
    expect(text).toContain('E-mail da contaana@exemplo.com');
    // O e-mail não é um campo.
    expect(renderer!.root.findAll((node) => node.props.value === 'ana@exemplo.com')).toHaveLength(0);
    // Nada mudou: não há o que salvar.
    expect(button('Salvar').props.disabled).toBe(true);
  });

  it('salva com uma chamada só (dois toques, um pedido), com o nome limpo, a data ISO e só os dígitos', async () => {
    await mount();
    await type('Nome', '  Ana Maria ');
    await type('Telefone', '(83) 3333-44445');
    await type('Telefone', '8333334444');
    expect(field('Telefone').props.value).toBe('(83) 3333-4444');
    await type('Data de nascimento', '');
    let finish: () => void = () => undefined;
    mockDb.rpc.mockImplementationOnce(
      (_name, args) =>
        new Promise((resolve) => {
          finish = () => resolve({ data: { name: args.p_name, birth_date: null, phone: args.p_phone }, error: null });
        }),
    );
    await act(async () => {
      button('Salvar').props.onPress();
      button('Salvar').props.onPress();
    });
    await act(async () => finish());
    await settle();
    expect(mockDb.rpc).toHaveBeenCalledTimes(1);
    expect(mockDb.rpc).toHaveBeenCalledWith('save_my_profile', { p_name: 'Ana Maria', p_birth_date: null, p_phone: '8333334444' });
    expect(page()).toContain('Perfil salvo.');
    expect(field('Nome').props.value).toBe('Ana Maria');
    expect(notify).not.toHaveBeenCalled();
  });

  it('depois de salvar, o nome novo já está na casa e nos moradores (antes de buscar de novo), e o perfil no cache dele', async () => {
    // As fichas e os remédios: o banco também troca o nome da ficha dela (com sufixo, se preciso).
    queryClient.setQueryData(['people'], [{ id: 'p1', name: 'Ana', member_user_id: 'ana' }]);
    queryClient.setQueryData(['medications'], [{ id: 'm1', person_id: 'p1', person_name: 'Ana' }]);
    await mount();
    await type('Nome', 'Ana Maria');
    await press('Salvar');
    const state = queryClient.getQueryData<{ me: { display_name: string }; members: { user_id: string; display_name: string }[] }>([
      'household',
      'ana',
    ]);
    expect(state?.me.display_name).toBe('Ana Maria');
    expect(state?.members.map((m) => m.display_name)).toEqual(['Ana Maria', 'Beto']);
    expect(queryClient.getQueryState(['household', 'ana'])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(['people'])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(['medications'])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryData(['profile', 'ana'])).toEqual({
      available: true,
      profile: { birth_date: '1985-03-05', phone: '83999999999' },
    });
  });

  it('o que a tela recusa não vai ao banco: o aviso diz o que corrigir', async () => {
    await mount();
    await type('Telefone', '(83) 9999');
    await press('Salvar');
    expect(notify).toHaveBeenCalledWith('Confira o telefone', PROFILE_MESSAGES.phone);
    await type('Telefone', '');
    await type('Data de nascimento', '01/01/2999');
    await press('Salvar');
    expect(notify).toHaveBeenLastCalledWith('Confira a data', PROFILE_MESSAGES.birthFuture);
    await type('Data de nascimento', '');
    await type('Nome', '  ');
    await press('Salvar');
    expect(notify).toHaveBeenLastCalledWith('Confira o nome', PROFILE_MESSAGES.nameEmpty);
    expect(mockDb.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['NK014, o telefone', { code: 'NK014', message: 'invalid phone' }, PROFILE_MESSAGES.phone],
    ['NK013, a data', { code: 'NK013', message: 'invalid birth date' }, 'Confira a data de nascimento: ela precisa ser de 1900 em diante e não pode ser depois de hoje.'],
    ['a função que ainda não existe', { code: 'PGRST202', message: 'Could not find the function public.save_my_profile' }, PROFILE_NOT_READY],
  ])('a recusa do banco (%s) vira a frase da tela, e o campo fica como estava', async (_name, error, message) => {
    mockDb.rpc.mockResolvedValueOnce({ data: null, error });
    await mount();
    await type('Telefone', '83988887777');
    await press('Salvar');
    expect(notify).toHaveBeenCalledWith('Não deu para salvar o perfil', message);
    expect(page()).not.toContain('Perfil salvo.');
    expect(field('Telefone').props.value).toBe('(83) 98888-7777');
    expect(button('Salvar').props.disabled).toBe(false);
  });

  it('sem a tabela (o app antes da migração): só o nome, com o aviso; o e-mail continua, e a aba (o tema e a conta) funciona', async () => {
    mockDb.read = { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.profiles' in the schema cache" } };
    const text = await mount();
    expect(text).toContain(`NomeAna${PROFILE_NOT_READY}`);
    expect(text).toContain('E-mail da contaana@exemplo.com');
    expect(renderer!.root.findAll((node) => node.props.label === 'Telefone')).toHaveLength(0);
    expect(renderer!.root.findAll((node) => node.props.title === 'Salvar')).toHaveLength(0);
    await act(async () => renderer?.unmount());
    shown = () => <SettingsScreen />;
    const tab = await mount();
    await act(async () => pressable('Escuro').props.onPress());
    expect(await AsyncStorage.getItem(THEME_CHOICE_KEY)).toBe('dark');
    expect(tab).toContain('Sair da conta');
  });

  it('a leitura que falha mostra o erro no lugar do formulário, com "Tentar de novo", e o e-mail fica', async () => {
    mockDb.read = { data: null, error: new Error('Sem internet agora.') };
    const text = await mount();
    expect(text).toContain('Sem internet agora.Tentar de novo');
    expect(text).toContain('E-mail da contaana@exemplo.com');
  });

  it('a aba não lê o perfil: o nome e o e-mail da linha vêm da casa e da conta', async () => {
    shown = () => <SettingsScreen />;
    const text = await mount();
    expect(mockDb.reads).toEqual([]);
    expect(text).toContain('PerfilAna · ana@exemplo.com');
    expect(renderer!.root.findAll((node) => node.props.label === 'Telefone')).toHaveLength(0);
    await act(async () => pressable('PerfilAna · ana@exemplo.com').props.onPress());
    expect(router.push).toHaveBeenCalledWith('/perfil');
  });
});

describe('Configurações: aparência', () => {
  /** A cor do texto do título "Tema": o que a tela pinta com as cores do tema. */
  const themeLabelColor = () => {
    const label = renderer!.root.findAll((node) => typeof node.props.style !== 'undefined' && node.children.join('') === 'Tema')[0];
    return [label.props.style].flat(3).reduce((color: string | undefined, s) => (s && typeof s === 'object' && 'color' in s ? String(s.color) : color), undefined);
  };

  it('nos dois temas a tela abre inteira; "Escuro" troca as cores na hora e fica guardado', async () => {
    const light = await mount();
    expect(light).toContain(`TemaAutomáticoClaroEscuro${THEME_HINT}`);
    expect(themeLabelColor()).toBe(PALETTES.light.text);
    await act(async () => pressable('Escuro').props.onPress());
    expect(themeLabelColor()).toBe(PALETTES.dark.text);
    expect(await AsyncStorage.getItem(THEME_CHOICE_KEY)).toBe('dark');
    // A opção marcada é a escolhida.
    expect(pressable('Escuro').props.accessibilityState).toEqual({ selected: true });
    expect(pressable('Automático').props.accessibilityState).toEqual({ selected: false });
    // Com o celular escuro e o automático, a tela é a mesma, escura.
    await act(async () => renderer?.unmount());
    await AsyncStorage.clear();
    mockSystem.scheme = 'dark';
    expect(await mount()).toBe(light);
    expect(themeLabelColor()).toBe(PALETTES.dark.text);
    await act(async () => pressable('Claro').props.onPress());
    expect(themeLabelColor()).toBe(PALETTES.light.text);
  });
});

describe('Configurações: conta', () => {
  it('os termos com a data da versão (em Sobre o Kotii), sair (com a pergunta de sempre), sair desta casa e apagar a conta', async () => {
    const text = await mount();
    expect(text).toContain(`${TERMS_TITLE}${termsVersionLabel()}`);
    // A explicação de sair da casa vem antes do botão dela e diz de qual saída fala (vem logo depois de "Sair da
    // conta", que não apaga nada); com outra pessoa na casa, sair não apaga a casa.
    expect(text).toContain(
      'ContaSair da contaSaindo desta casa, você pode criar outra ou entrar em uma com um código.Sair desta casaApagar minha conta',
    );
    await act(async () => pressable(`${TERMS_TITLE}${termsVersionLabel()}`).props.onPress());
    expect(router.push).toHaveBeenCalledWith('/termos');
    await press('Sair da conta');
    expect(confirmAction).toHaveBeenCalledWith('Sair da conta', 'Deseja sair desta conta neste aparelho?', 'Sair', expect.any(Function));
    await press('Apagar minha conta');
    expect(router.push).toHaveBeenCalledWith('/apagar-conta');
  });

  it('sair desta casa confere de novo quem está nela: com outra pessoa, a pergunta de sair; sozinha, a de apagar a casa', async () => {
    const fresh = (members: Member[]) => ({
      data: { household: { id: 'h1', name: 'Casa da Ana' }, members, me: mockMe, households: [] },
    });
    mockRefetchHousehold.mockResolvedValueOnce(fresh([mockMe, mockBeto]));
    await mount();
    await press('Sair desta casa');
    expect(mockRefetchHousehold).toHaveBeenCalledTimes(1);
    expect(confirmAction).toHaveBeenLastCalledWith(
      'Sair da casa',
      'Você deixa de ver os dados de "Casa da Ana". O que você registrou continua com a casa. Beto fica responsável pela casa. Para voltar, só com o código de convite.',
      'Sair da casa',
      expect.any(Function),
    );
    // Beto saiu enquanto a tela estava aberta: agora sair apaga a casa, e a pergunta diz isso.
    mockRefetchHousehold.mockResolvedValueOnce(fresh([mockMe]));
    await press('Sair desta casa');
    expect(jest.mocked(confirmAction).mock.lastCall?.[0]).toBe('Apagar a casa');
    expect(mockLeave.mutate).not.toHaveBeenCalled();
  });

  it('sozinha na casa, a explicação diz que sair desta casa apaga a casa, junto do botão dela e não do de sair da conta', async () => {
    mockHousehold.members = [mockMe];
    expect(await mount()).toContain('ContaSair da contaVocê é a única pessoa aqui: sair desta casa apaga a casa.Sair desta casa');
    // A explicação e o botão que ela explica num grupo só; "Sair da conta" fica fora dele.
    const buttons = (node: ReactTestInstance) =>
      new Set(node.findAll((child) => typeof child.props.title === 'string' && typeof child.props.onPress === 'function').map((child) => child.props.title));
    let group: ReactTestInstance = renderer!.root.findAll(
      (node) => typeof node.type === 'string' && node.props.children === 'Você é a única pessoa aqui: sair desta casa apaga a casa.',
    )[0];
    while (!buttons(group).has('Sair desta casa')) group = group.parent!;
    expect(buttons(group)).toEqual(new Set(['Sair desta casa']));
  });

  it('com outra casa, a explicação diz onde o app abre depois de sair desta casa', async () => {
    mockHousehold.houses = [
      { id: 'h1', name: 'Casa da Ana', role: 'owner' },
      { id: 'h2', name: 'Casa da praia', role: 'member' },
    ];
    expect(await mount()).toContain('Sair da contaDepois de sair desta casa, o app abre em "Casa da praia".Sair desta casa');
  });
});

describe('Configurações: manutenção do app', () => {
  it('quem não mantém o app nem modera não vê a categoria', async () => {
    const text = await mount();
    expect(text).not.toContain(APP_DASHBOARD_TITLE);
    expect(text).not.toContain('Manutenção do app');
    expect(text.endsWith('Apagar minha conta')).toBe(true);
  });

  it('sem a função no banco (antes da migração), a linha não aparece e a tela abre inteira', async () => {
    mockDb.admin = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.is_app_admin' } };
    const text = await mount();
    expect(text).not.toContain(APP_DASHBOARD_TITLE);
    expect(text).toContain(`${TERMS_TITLE}${termsVersionLabel()}`);
    expect(text.endsWith('Sair desta casaApagar minha conta')).toBe(true);
  });

  it('para quem mantém o app, a linha do painel fica no fim, depois da conta, e abre o painel', async () => {
    mockDb.admin = { data: true, error: null };
    const text = await mount();
    expect(text.endsWith(`Apagar minha contaManutenção do app${APP_DASHBOARD_TITLE}Contas, pessoas ativas, Nuke e funções`)).toBe(true);
    await act(async () => pressable(`${APP_DASHBOARD_TITLE}Contas, pessoas ativas, Nuke e funções`).props.onPress());
    expect(router.push).toHaveBeenCalledWith('/painel');
    // A pergunta não passa pela rpc do perfil.
    expect(mockDb.rpc).not.toHaveBeenCalled();
  });

  it('só quem modera vê "Nomes dos mercados", que abre a tela da moderação', async () => {
    mockModerator.value = true;
    const text = await mount();
    expect(text.endsWith(`Manutenção do app${MODERATION_TITLE}O nome padrão de cada mercado`)).toBe(true);
    await act(async () => pressable(`${MODERATION_TITLE}O nome padrão de cada mercado`).props.onPress());
    expect(router.push).toHaveBeenCalledWith('/moderacao');
  });

  it('com os dois acessos, o painel e depois a moderação, na mesma categoria', async () => {
    mockModerator.value = true;
    mockDb.admin = { data: true, error: null };
    expect(await mount()).toContain(
      `Manutenção do app${APP_DASHBOARD_TITLE}Contas, pessoas ativas, Nuke e funções${MODERATION_TITLE}O nome padrão de cada mercado`,
    );
  });
});

describe('Configurações: clima da casa', () => {
  it('antes de saber (lendo, ou a leitura falhou sem nada guardado), a linha não convida a definir o bairro', async () => {
    mockLocation.data = undefined;
    const text = await mount();
    expect(text).toContain(`${HOUSE_PLACE_TITLE}${HOUSE_PLACE_ROW_UNKNOWN}Suas casas`);
    expect(text).not.toContain(HOUSE_PLACE_ROW_HINT);
  });

  it('sem bairro, a linha convida; abre a tela do clima', async () => {
    mockLocation.data = null;
    const text = await mount();
    expect(text).toContain(`${HOUSE_PLACE_TITLE}${HOUSE_PLACE_ROW_HINT}Suas casas`);
    await act(async () => pressable(`${HOUSE_PLACE_TITLE}${HOUSE_PLACE_ROW_HINT}`).props.onPress());
    expect(router.push).toHaveBeenCalledWith('/clima');
  });

  it('com o bairro, a linha diz onde fica a casa, na categoria Casa', async () => {
    mockLocation.data = { label: 'Pinheiros, São Paulo' };
    const text = await mount();
    expect(text).toContain(`${HOUSE_PLACE_TITLE}Pinheiros, São PauloSuas casas`);
    expect(text.indexOf(HOUSE_PLACE_TITLE)).toBeLessThan(text.indexOf('Você'));
  });

  it('com mais de uma casa, a linha diz de qual casa é o lugar (a aberta)', async () => {
    mockHousehold.houses = [
      { id: 'h1', name: 'Casa da Ana', role: 'owner' },
      { id: 'h2', name: 'Casa da praia', role: 'member' },
    ];
    mockLocation.data = { label: 'Pinheiros, São Paulo' };
    expect(await mount()).toContain(`${HOUSE_PLACE_TITLE}Casa da Ana · Pinheiros, São PauloSuas casas (2)`);
    await act(async () => renderer?.unmount());
    mockLocation.data = null;
    expect(await mount()).toContain(`${HOUSE_PLACE_TITLE}Casa da Ana · ${HOUSE_PLACE_ROW_HINT}Suas casas (2)`);
  });
});

describe('Mandar recado (/recado, da linha em Configurações → Sobre o Kotii)', () => {
  const chip = (label: string) => renderer!.root.findAllByType(Chip).find((node) => node.props.label === label)!;
  const selectedKinds = () =>
    renderer!.root
      .findAllByType(Chip)
      .filter((node) => node.props.selected)
      .map((node) => node.props.label);
  const sends = () => mockDb.rpc.mock.calls.filter(([name]) => name === 'send_app_feedback');

  beforeEach(() => {
    shown = () => <FeedbackScreen />;
    mockDb.rpc.mockImplementation(async (name) =>
      name === 'send_app_feedback' ? { data: 'recado-1', error: null } : { data: null, error: null },
    );
  });

  it('a tela tem para que serve, os tipos sem nenhum marcado, o campo e quem lê', async () => {
    const text = await mount();
    expect(text.startsWith(`${FEEDBACK_FORM_INTRO}${FEEDBACK_FORM_KIND_LABEL}ProblemaSugestãoElogioOutro`)).toBe(true);
    expect(text).toContain(`${FEEDBACK_DISCLOSURE}Enviar`);
    expect(selectedKinds()).toEqual([]);
    // Em branco não vai.
    expect(button('Enviar').props.disabled).toBe(true);
    // O leitor de tela lê o nome do campo (o rótulo desenhado não fica ligado a ele).
    expect(field('Recado').props.accessibilityLabel).toBe('Recado');
    expect(field('Recado').props.placeholder).toBe(FEEDBACK_FORM_PLACEHOLDER);
    await type('Recado', '   ');
    expect(button('Enviar').props.disabled).toBe(true);
    expect(page()).not.toContain(FEEDBACK_SENT);
  });

  it('sem tipo, vai como "outro", aparado, numa chamada só (dois toques, um pedido); depois, o campo limpo e o "enviado"', async () => {
    await mount();
    await type('Recado', '  A lista não abre no navegador.  ');
    let finish: () => void = () => undefined;
    // Só o recado fica esperando: outro pedido que passe por aqui antes dele (uma leitura de novo) responde na hora.
    mockDb.rpc.mockImplementation((name) =>
      name === 'send_app_feedback'
        ? new Promise((resolve) => {
            finish = () => resolve({ data: 'recado-1', error: null });
          })
        : Promise.resolve({ data: null, error: null }),
    );
    await act(async () => {
      button('Enviar').props.onPress();
      button('Enviar').props.onPress();
    });
    // O React Query avisa a tela num setTimeout(0): sem esperar por ele, o "girando" depende da sorte.
    await settle();
    // Enquanto vai, o botão gira, o texto não muda e o tipo também não.
    expect(button('Enviar').props.loading).toBe(true);
    expect(field('Recado').props.editable).toBe(false);
    expect(chip('Elogio').props.disabled).toBe(true);
    expect(chip('Elogio').findAll((node) => node.props.accessibilityState !== undefined)[0].props.accessibilityState).toEqual({
      selected: false,
      disabled: true,
    });
    expect(selectedKinds()).toEqual([]);
    await act(async () => finish());
    await settle();
    expect(chip('Elogio').props.disabled).toBe(false);
    expect(sends()).toEqual([
      [
        'send_app_feedback',
        // O aparelho e a versão do app vão junto, como no cartão do Nuke.
        {
          p_kind: 'outro',
          p_message: 'A lista não abre no navegador.',
          p_platform: 'ios',
          p_app_version: Constants.expoConfig?.version ?? null,
        },
      ],
    ]);
    expect(field('Recado').props.value).toBe('');
    expect(field('Recado').props.editable).toBe(true);
    expect(page()).toContain(FEEDBACK_SENT);
    // O campo esvaziou: o leitor de tela ouve que foi. No aparelho pelo anúncio, sem região aria-live (que no
    // Android leria de novo).
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(FEEDBACK_SENT);
    expect(renderer!.root.findAll((node) => node.props['aria-live'] !== undefined)).toHaveLength(0);
    expect(notify).not.toHaveBeenCalled();
    // O "enviado" fica até a pessoa escrever de novo.
    await type('Recado', 'Mais uma coisa');
    expect(page()).not.toContain(FEEDBACK_SENT);
  });

  it('no navegador, o "enviado" entra numa região aria-live que já estava na página, vazia', async () => {
    onWeb();
    await mount();
    const region = () =>
      renderer!.root.findAll(
        (node) => typeof node.type === 'string' && node.props.testID === 'feedback-sent-region' && node.props['aria-live'] === 'polite',
      );
    expect(region()).toHaveLength(1);
    expect(textOf(region()[0])).toBe('');
    await type('Recado', 'A lista não abre no navegador.');
    await press('Enviar');
    expect(region()).toHaveLength(1);
    expect(textOf(region()[0])).toBe(FEEDBACK_SENT);
    await type('Recado', 'Mais uma coisa');
    expect(region()).toHaveLength(1);
    expect(textOf(region()[0])).toBe('');
  });

  it('no navegador, o tipo marcado é um botão pressionado (o leitor de tela diz qual vai)', async () => {
    onWeb();
    await mount();
    const pressed = () =>
      Object.fromEntries(
        renderer!.root
          .findAllByType(Chip)
          .map((node) => [node.props.label, node.findAll((inner) => inner.props['aria-pressed'] !== undefined)[0]?.props['aria-pressed']]),
      );
    expect(pressed()).toEqual({
      Problema: false,
      Sugestão: false,
      Elogio: false,
      Outro: false,
    });
    await act(async () => chip('Elogio').props.onPress());
    expect(pressed()).toEqual({
      Problema: false,
      Sugestão: false,
      Elogio: true,
      Outro: false,
    });
  });

  it('no aparelho, o tipo marcado vai pelo accessibilityState, sem aria-pressed', async () => {
    await mount();
    await act(async () => chip('Elogio').props.onPress());
    expect(renderer!.root.findAll((node) => node.props['aria-pressed'] !== undefined)).toHaveLength(0);
    const state = chip('Elogio').findAll((node) => node.props.accessibilityState !== undefined)[0].props.accessibilityState;
    expect(state).toEqual({ selected: true });
  });

  it('com um tipo escolhido, vai com ele; tocar de novo desmarca; depois de enviar, o tipo também se limpa', async () => {
    await mount();
    await act(async () => chip('Elogio').props.onPress());
    await act(async () => chip('Elogio').props.onPress());
    expect(selectedKinds()).toEqual([]);
    await act(async () => chip('Sugestão').props.onPress());
    expect(selectedKinds()).toEqual(['Sugestão']);
    await type('Recado', 'Um modo escuro mais escuro.');
    await press('Enviar');
    expect(sends()).toEqual([
      [
        'send_app_feedback',
        expect.objectContaining({
          p_kind: 'sugestao',
          p_message: 'Um modo escuro mais escuro.',
        }),
      ],
    ]);
    expect(selectedKinds()).toEqual([]);
  });

  it.each([
    ['o limite de 24 horas (NK015)', { code: 'NK015', message: 'limit' }, FEEDBACK_LIMIT],
    [
      'a função que ainda não existe',
      {
        code: 'PGRST202',
        message: 'Could not find the function public.send_app_feedback',
      },
      FEEDBACK_NOT_READY,
    ],
  ])('a recusa (%s) vira o aviso, e o recado fica no campo para tentar de novo', async (_name, error, message) => {
    mockDb.rpc.mockImplementation(async (name) => (name === 'send_app_feedback' ? { data: null, error } : { data: null, error: null }));
    await mount();
    await act(async () => chip('Problema').props.onPress());
    await type('Recado', 'O app fecha sozinho.');
    await press('Enviar');
    expect(notify).toHaveBeenCalledWith('Não deu certo', message);
    expect(field('Recado').props.value).toBe('O app fecha sozinho.');
    expect(selectedKinds()).toEqual(['Problema']);
    expect(page()).not.toContain(FEEDBACK_SENT);
    expect(button('Enviar').props.disabled).toBe(false);
  });

  describe('sem internet', () => {
    afterEach(() => onlineManager.setOnline(true));

    it('não fica parado esperando a conexão: tenta na hora, avisa "Sem internet agora…" e o recado fica no campo', async () => {
      onlineManager.setOnline(false);
      mockDb.rpc.mockImplementation(async (name) => {
        if (name === 'send_app_feedback') throw new TypeError('Network request failed');
        return { data: null, error: null };
      });
      await mount();
      await type('Recado', 'O app fecha sozinho.');
      await press('Enviar');
      // Foi tentado (não ficou parado na fila guardada à espera da internet).
      expect(sends()).toHaveLength(1);
      expect(notify).toHaveBeenCalledWith('Não deu certo', OFFLINE_TRY_AGAIN);
      expect(field('Recado').props.value).toBe('O app fecha sozinho.');
      expect(page()).not.toContain(FEEDBACK_SENT);
      expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
      expect(button('Enviar').props.loading).toBe(false);
      expect(button('Enviar').props.disabled).toBe(false);
    });
  });

  it('o erro avisa mesmo depois de a pessoa sair de Configurações com o recado ainda indo', async () => {
    let fail: () => void = () => undefined;
    mockDb.rpc.mockImplementation((name) =>
      name === 'send_app_feedback'
        ? new Promise((resolve) => {
            fail = () =>
              resolve({
                data: null,
                error: { code: 'NK015', message: 'limit' },
              });
          })
        : Promise.resolve({ data: null, error: null }),
    );
    await mount();
    await type('Recado', 'O app fecha sozinho.');
    await act(async () => button('Enviar').props.onPress());
    await act(async () => renderer?.unmount());
    renderer = undefined;
    await act(async () => fail());
    await settle();
    expect(notify).toHaveBeenCalledWith('Não deu certo', FEEDBACK_LIMIT);
  });

  it('perto do limite, o contador; passado, quanto tirar, e "Enviar" parado', async () => {
    await mount();
    await type('Recado', 'a'.repeat(1799));
    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
    expect(page()).not.toContain('caracteres');
    await type('Recado', 'a'.repeat(1850));
    expect(field('Recado').props.hint).toBe('1.850 de 2.000 caracteres');
    expect(field('Recado').props.accessibilityHint).toBe('1.850 de 2.000 caracteres');
    expect(button('Enviar').props.disabled).toBe(false);
    await type('Recado', 'a'.repeat(FEEDBACK_MAX_LENGTH + 3));
    expect(field('Recado').props.hint).toBe('O recado passou do limite de 2.000 caracteres. Tire 3 caracteres para poder enviar.');
    expect(field('Recado').props.hintColor).toBe('danger');
    // O motivo de "Enviar" parado chega ao leitor de tela.
    expect(field('Recado').props.accessibilityHint).toBe(field('Recado').props.hint);
    expect(button('Enviar').props.disabled).toBe(true);
    await act(async () => button('Enviar').props.onPress());
    await settle();
    expect(sends()).toEqual([]);
    // No aparelho, nada do navegador.
    expect(renderer!.root.findAll((node) => node.props['aria-describedby'] !== undefined)).toHaveLength(0);
    expect(renderer!.root.findAll((node) => node.props['aria-live'] !== undefined)).toHaveLength(0);
  });

  it('no aparelho, o leitor de tela ouve o limite quando o estado muda (perto, passou, voltou), não a cada tecla', async () => {
    const near = 'O recado está perto do limite de 2.000 caracteres.';
    const over = 'O recado passou do limite de 2.000 caracteres. Encurte para poder enviar.';
    const announced = () => jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.map(([text]) => text);
    await mount();
    await type('Recado', 'a'.repeat(1799));
    expect(announced()).toEqual([]);
    await type('Recado', 'a'.repeat(1800));
    await type('Recado', 'a'.repeat(1801));
    await type('Recado', 'a'.repeat(1950));
    expect(announced()).toEqual([near]);
    await type('Recado', 'a'.repeat(FEEDBACK_MAX_LENGTH + 1));
    await type('Recado', 'a'.repeat(FEEDBACK_MAX_LENGTH + 2));
    await type('Recado', 'a'.repeat(FEEDBACK_MAX_LENGTH + 40));
    expect(announced()).toEqual([near, over]);
    // Voltou para dentro: "Enviar" anda de novo, e o leitor de tela ouve.
    await type('Recado', 'a'.repeat(FEEDBACK_MAX_LENGTH));
    await type('Recado', 'a'.repeat(FEEDBACK_MAX_LENGTH - 1));
    expect(announced()).toEqual([near, over, near]);
    // Longe do limite, nada; perto de novo, de novo uma vez.
    await type('Recado', 'curto');
    await type('Recado', 'a'.repeat(1900));
    expect(announced()).toEqual([near, over, near, near]);
  });

  it('no navegador, o contador e o motivo de "Enviar" parado ficam ligados ao campo, e só a mudança de estado é falada', async () => {
    onWeb();
    await mount();
    const describedBy = () => renderer!.root.findAll((node) => node.props['aria-describedby'] !== undefined);
    const liveRegions = () => renderer!.root.findAll((node) => typeof node.type === 'string' && node.props['aria-live'] === 'polite');
    const limitRegion = () => liveRegions().filter((node) => node.props.testID === 'feedback-limit-region');
    // Sem dica, o campo não aponta para nada, mas a região do limite já está na página, vazia.
    expect(describedBy()).toHaveLength(0);
    expect(limitRegion()).toHaveLength(1);
    expect(textOf(limitRegion()[0])).toBe('');
    await type('Recado', 'a'.repeat(FEEDBACK_MAX_LENGTH + 3));
    const reason = 'O recado passou do limite de 2.000 caracteres. Tire 3 caracteres para poder enviar.';
    const ids = new Set(describedBy().map((node) => node.props['aria-describedby']));
    expect(ids.size).toBe(1);
    const [id] = ids;
    const hint = renderer!.root.findAll((node) => node.props.id === id && typeof node.type !== 'string');
    expect(hint.length).toBeGreaterThan(0);
    expect(textOf(hint[0])).toBe(reason);
    // A dica, que muda a cada tecla, não está dentro de nenhuma região aria-live.
    for (const region of liveRegions()) expect(region.findAll((node) => node.props.id === id)).toHaveLength(0);
    // A região do limite diz o estado, com um texto que não muda enquanto o estado não muda.
    const over = 'O recado passou do limite de 2.000 caracteres. Encurte para poder enviar.';
    expect(textOf(limitRegion()[0])).toBe(over);
    await type('Recado', 'a'.repeat(FEEDBACK_MAX_LENGTH + 30));
    expect(textOf(limitRegion()[0])).toBe(over);
    await type('Recado', 'a'.repeat(1850));
    expect(textOf(limitRegion()[0])).toBe('O recado está perto do limite de 2.000 caracteres.');
    await type('Recado', 'a'.repeat(1851));
    expect(textOf(limitRegion()[0])).toBe('O recado está perto do limite de 2.000 caracteres.');
    await type('Recado', 'curto');
    expect(textOf(limitRegion()[0])).toBe('');
    expect(limitRegion()).toHaveLength(1);
    // No navegador quem fala é a região: o anúncio do aparelho não é chamado (lá não faz nada).
    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
  });
});

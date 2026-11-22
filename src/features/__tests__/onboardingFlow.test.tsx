import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState, type ReactElement } from 'react';
import { Modal, Platform, Share } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import InviteLinkScreen from '@/app/convite/[codigo]';
import WelcomeScreen from '@/app/bem-vindo';
import SignInScreen from '@/app/entrar';
import OnboardingPreviewScreen from '@/app/primeira-vez';
import {
  CHOICE_INVITE,
  CHOICE_NEW,
  CHOICE_TITLE,
  CODE_TITLE,
  CONFIRM_EMAIL_DONE,
  CONFIRM_EMAIL_NOT_YET,
  CONFIRM_EMAIL_RESENT,
  CONFIRM_EMAIL_TITLE,
  confirmEmailText,
  FIRST_LIST_DONE,
  FIRST_LIST_SKIP,
  FIRST_LIST_TEXT,
  HOUSE_PLACE_ROW,
  HOUSE_TITLE,
  INSTALL_IOS_OK,
  INSTALL_IOS_SIGN_IN,
  INSTALL_TITLE,
  INVITE_COPIED,
  INVITE_COPIED_TITLE,
  INVITE_COPY,
  INVITE_OTHER,
  INVITE_SKIP,
  INVITE_TITLE,
  INVITE_WHATSAPP,
  INVITED_TITLE,
  JOINED_OK,
  JOINED_TITLE,
  joinedText,
  NAME_TITLE,
  PASSWORD_HINT,
  PREVIEW_NOTICE,
  PREVIEW_ONLY_ADMINS,
  SIGN_IN_TITLE,
  SIGN_UP_TITLE,
  SWITCH_TO_SIGN_UP,
  WELCOME_CREATE,
  WELCOME_SIGN_IN,
  WELCOME_TITLE,
  welcomeLines,
} from '@/domain/onboarding';
import { FirstListFlow } from '@/features/onboarding/FirstListFlow';
import { OnboardingContinuation } from '@/features/onboarding/OnboardingContinuation';
import { FEATURES } from '@/lib/features';
import { clearLinkNotice, setLinkNotice } from '@/lib/linkNotice';
import { OFFLINE_TRY_AGAIN } from '@/lib/networkErrors';
import { openExternal } from '@/lib/openLink';
import { clearOnboardingNext, clearPendingInvite, markHadAccount, savePendingInvite, setOnboardingNext } from '@/lib/onboarding';
import { startRecovery } from '@/lib/passwordRecovery';
import { LINK_EXPIRED } from '@/lib/recoveryLink';
import { notify } from '@/ui/dialogs';

// O começo novo (domain/onboarding, features/onboarding), com o banco e o Supabase de mentira: as boas-vindas e a conta
// (app/entrar com a chave ligada), o nome, a pergunta e a casa (app/bem-vindo), a prévia de quem mantém o app
// (app/primeira-vez: as telas de conta não mandam nada; a casa é de verdade), o passo seguinte na tela Hoje (a
// primeira lista ou "Você entrou na casa!"), a faixa da primeira lista com o convite e a tela de início, e o link do
// convite (app/convite). Com a chave desligada, as telas são as de antes (createHousePlace.test.tsx, termsScreens).

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockParams: Record<string, string | undefined> = {};
const mockRedirect: { href: unknown } = { href: null };
const mockFocus = { focused: true };
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), dismissTo: jest.fn(), back: jest.fn(), setParams: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => mockParams,
  useIsFocused: () => mockFocus.focused,
  Redirect: ({ href }: { href: unknown }) => {
    mockRedirect.href = href;
    return null;
  },
}));

/** O banco: create_household devolve a casa nova; join_household, a casa do código. */
const mockRpc = jest.fn(async (name: string, _args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> => ({
  data: { id: name === 'create_household' ? 'nova' : 'dela', name: name === 'create_household' ? 'Casa da Ana' : 'Casa da Bia' },
  error: null,
}));
/** O que o Supabase responde ao criar a conta, ao entrar e ao mandar o e-mail de novo. */
const mockAuth = {
  signUp: jest.fn(async (): Promise<{ data: { user: { id: string }; session: { user: { id: string } } | null }; error: null }> => ({
    data: { user: { id: 'u2' }, session: null },
    error: null,
  })),
  signInWithPassword: jest.fn(async () => ({ data: { user: { id: 'u1' }, session: { user: { id: 'u1' } } }, error: null })),
  resend: jest.fn(async (_args: unknown) => ({ data: {}, error: null })),
  resetPasswordForEmail: jest.fn(async (_email: string) => ({ data: {}, error: null })),
  verifyOtp: jest.fn(async (_args: unknown) => ({ data: { user: { id: 'u1' }, session: { user: { id: 'u1' } } }, error: null })),
};
jest.mock('@/lib/supabase', () => ({
  supabase: {
    get auth() {
      return mockAuth;
    },
    rpc: (name: string, args: Record<string, unknown>) => mockRpc(name, args),
  },
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));
jest.mock('@/lib/activeHousehold', () => ({ setActiveHousehold: async () => undefined }));
jest.mock('@/data/terms', () => ({ acceptTermsAtSignIn: jest.fn(async () => undefined) }));
// O aviso do link do e-mail (lib/linkNotice) é o de verdade: só memória, e a tela de entrar o tira ao desmontar.
jest.mock('@/lib/passwordRecovery', () => ({ finishRecovery: jest.fn(), startRecovery: jest.fn() }));
jest.mock('@/lib/session', () => ({ useSessionEnded: () => false }));
// O que data/household traz e não entra aqui (fila da lista, fotos, Nuke, lembretes).
jest.mock('@/data/images', () => ({ functionErrorMessage: async () => 'erro' }));
jest.mock('@/data/listPhotos', () => ({ photoQueueBusy: () => false, waitingCounts: () => ({}) }));
const mockOpenMarketList = jest.fn(async () => ({ id: 'mercado' }));
jest.mock('@/data/market', () => ({
  listQueueBusy: () => false,
  useOpenMarketList: () => ({ mutateAsync: () => mockOpenMarketList() }),
}));
jest.mock('@/data/weather', () => ({
  LOCATION_KEY: ['householdLocation'],
  findPlaceByCep: jest.fn(),
  findPlaceByDevice: jest.fn(),
  saveHouseholdLocationFor: jest.fn(async () => undefined),
}));
jest.mock('@/features/nuke/conversation', () => ({ clearConversation: jest.fn(), conversationOwner: jest.fn() }));
jest.mock('@/lib/pendingReceipts', () => ({ forgetPendingReceiptsOf: jest.fn() }));
jest.mock('@/lib/queryClient', () => ({ saveNow: jest.fn() }));
jest.mock('@/lib/reminders', () => ({ disableHouseholdReminders: jest.fn() }));
/** A conta e a casa aberta (a prévia, a Hoje e o link do convite leem a casa; o começo de verdade não tem casa). */
const mockAccount = {
  session: { user: { id: 'ana' } } as { user: { id: string } } | null,
  household: {
    household: { id: 'h1', name: 'Casa da Ana', invite_code: 'KM2P9Q', created_by: 'ana' },
  } as { household: { id: string; name: string; invite_code: string; created_by: string } } | null,
  pending: false,
};
jest.mock('@/lib/auth', () => ({
  signOut: jest.fn(),
  useAuth: () => ({ session: mockAccount.session }),
  useHousehold: () => ({ data: mockAccount.household, isPending: mockAccount.pending }),
}));
const mockAdmin = { data: true as boolean | undefined, isPending: false };
jest.mock('@/data/appDashboard', () => ({ useIsAppAdmin: () => mockAdmin }));
const mockInstall = { mode: 'hidden' as 'hidden' | 'prompt' | 'ios', install: jest.fn(async () => undefined) };
jest.mock('@/lib/install', () => ({ useInstallApp: () => ({ ...mockInstall, dismiss: jest.fn() }) }));
jest.mock('@/lib/openLink', () => ({ openExternal: jest.fn(async () => true) }));
jest.mock('expo-clipboard', () => ({ getStringAsync: jest.fn(async () => ''), setStringAsync: jest.fn(async () => true) }));
jest.mock('@/ui/dialogs', () => ({ confirmAction: jest.fn(), notify: jest.fn() }));
// Os desenhos e o fundo não entram no que se confere aqui.
jest.mock('@/ui/art', () => ({ Logo: () => null }));
jest.mock('@/ui/NukeLive', () => ({ NukeLive: () => null }));
jest.mock('@/ui/NukeArt', () => ({ NukeAvatar: () => null }));
jest.mock('@/ui/iconArt', () => ({ IconArt: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));

let renderer: ReactTestRenderer | undefined;
let queryClient: QueryClient;

const rawText = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map(rawText).join(''));
/** As letras de uso privado do Unicode: é onde a fonte de ícones guarda os desenhos. */
const ICON_GLYPHS = new RegExp(
  `[${String.fromCodePoint(0xe000)}-${String.fromCodePoint(0xf8ff)}]|[${String.fromCodePoint(0xf0000)}-${String.fromCodePoint(0x10ffff)}]`,
  'gu',
);
const page = () => rawText(renderer!.root).replace(ICON_GLYPHS, '');

async function settle() {
  for (let i = 0; i < 5; i += 1) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function mount(screen: ReactElement) {
  await act(async () => {
    renderer = create(<QueryClientProvider client={queryClient}>{screen}</QueryClientProvider>);
  });
  await settle();
}

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
/** Um cartão grande (FeatureCard): o leitor de tela lê o título e a frase juntos. */
const choose = async (card: { title: string; subtitle: string }) => {
  const node = renderer!.root.findAll(
    (n) => n.props.accessibilityLabel === `${card.title}. ${card.subtitle}` && typeof n.props.onPress === 'function',
  )[0];
  await act(async () => node.props.onPress());
  await settle();
};
/** O que tem esse texto e um toque (as ações do menu de baixo). */
const pressText = async (label: string) => {
  const node = renderer!.root.findAll((n) => typeof n.props.onPress === 'function' && rawText(n).replace(ICON_GLYPHS, '') === label)[0];
  await act(async () => node.props.onPress());
  await settle();
};
const sheet = (title: string) => renderer!.root.findAll((n) => n.props.title === title && typeof n.props.onClose === 'function')[0];
/**
 * O relógio e o setInterval de mentira, para a espera do "Reenviar o e-mail" (useResendWait); o setTimeout segue de
 * verdade, porque o settle espera por ele.
 */
function fakeClock() {
  jest.useFakeTimers({
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setTimeout',
      'clearTimeout',
    ],
  });
}
const passSeconds = async (seconds: number) => {
  await act(async () => jest.advanceTimersByTime(seconds * 1000));
};
const calls = (name: string) => mockRpc.mock.calls.filter(([called]) => called === name);

beforeEach(() => {
  jest.clearAllMocks();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  for (const key of Object.keys(mockParams)) delete mockParams[key];
  mockRedirect.href = null;
  mockFocus.focused = true;
  mockAccount.session = { user: { id: 'ana' } };
  mockAccount.household = { household: { id: 'h1', name: 'Casa da Ana', invite_code: 'KM2P9Q', created_by: 'ana' } };
  mockAccount.pending = false;
  mockAdmin.data = true;
  mockAdmin.isPending = false;
  mockInstall.mode = 'hidden';
  clearPendingInvite();
  clearLinkNotice();
  for (const id of ['nova', 'dela', 'h1']) clearOnboardingNext(id);
  jest.replaceProperty(FEATURES, 'onboarding', true);
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  jest.useRealTimers();
});

describe('o começo depois da conta (bem-vindo, com a chave ligada)', () => {
  beforeEach(() => {
    mockAccount.household = null;
  });

  it('o nome primeiro, sozinho; sem ele, a tela diz o que falta', async () => {
    await mount(<WelcomeScreen />);
    expect(page()).toContain(NAME_TITLE);
    await press('Continuar');
    expect(notify).toHaveBeenCalledWith(NAME_TITLE, expect.any(String));
    expect(page()).not.toContain(CHOICE_TITLE);
  });

  it('criar a casa: o nome, a pergunta, o nome da casa (o lugar fechado numa linha) e a casa nasce com a lista como passo seguinte', async () => {
    await mount(<WelcomeScreen />);
    await type('Seu nome', ' Ana ');
    await press('Continuar');
    expect(page()).toContain(CHOICE_TITLE);
    await choose(CHOICE_NEW);
    expect(page()).toContain(HOUSE_TITLE);
    // O lugar é opcional: fica numa linha até a pessoa abrir.
    expect(page()).toContain(HOUSE_PLACE_ROW.title);
    expect(field('CEP')).toBeUndefined();
    await type('Nome da casa', 'Casa da Ana');
    await press('Criar casa');
    expect(calls('create_household')).toEqual([['create_household', { p_name: 'Casa da Ana', p_display_name: 'Ana' }]]);
    expect(await AsyncStorage.getItem('kotii:onboarding-next:nova')).toBe('lista');
    // O de verdade não troca de tela: a casa chega e o layout abre a Hoje.
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.dismissTo).not.toHaveBeenCalled();
  });

  it('entrar com o código: direto, sem esperar ninguém, e o passo seguinte diz que a pessoa entrou', async () => {
    await mount(<WelcomeScreen />);
    await type('Seu nome', 'Bia');
    await press('Continuar');
    await choose(CHOICE_INVITE);
    expect(page()).toContain(CODE_TITLE);
    await type('Código de convite', 'km2-p9q');
    await press('Entrar na casa');
    expect(calls('join_household')).toEqual([['join_household', { p_invite_code: 'KM2P9Q', p_display_name: 'Bia' }]]);
    expect(await AsyncStorage.getItem('kotii:onboarding-next:dela')).toBe('entrou');
  });

  it('sem internet, nada chega ao banco, e o aviso não fala em trocar de casa (é a primeira da pessoa)', async () => {
    // Como no app (lib/queryClient): sem internet, a ação falha na hora e avisa, em vez de esperar a conexão.
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false, networkMode: 'always' } } });
    onlineManager.setOnline(false);
    try {
      await mount(<WelcomeScreen />);
      await type('Seu nome', 'Ana');
      await press('Continuar');
      await choose(CHOICE_NEW);
      await type('Nome da casa', 'Casa da Ana');
      await press('Criar casa');
      expect(calls('create_household')).toHaveLength(0);
      expect(notify).toHaveBeenLastCalledWith('Não foi possível criar a casa', OFFLINE_TRY_AGAIN);
      expect(await AsyncStorage.getItem('kotii:onboarding-next:nova')).toBeNull();
      await press('Voltar');
      await choose(CHOICE_INVITE);
      await type('Código de convite', 'KM2P9Q');
      await press('Entrar na casa');
      expect(calls('join_household')).toHaveLength(0);
      expect(notify).toHaveBeenLastCalledWith('Não deu para entrar na casa', OFFLINE_TRY_AGAIN);
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('um código com letras que o convite não usa não chega ao banco', async () => {
    await mount(<WelcomeScreen />);
    await type('Seu nome', 'Bia');
    await press('Continuar');
    await choose(CHOICE_INVITE);
    await type('Código de convite', 'OI0123');
    await press('Entrar na casa');
    expect(calls('join_household')).toHaveLength(0);
    expect(notify).toHaveBeenCalledWith('Confira o código', expect.any(String));
  });

  it('quem veio pelo link do convite pula a pergunta: o código já vem preenchido, e sai do aparelho depois de entrar', async () => {
    savePendingInvite('KM2P9Q');
    await mount(<WelcomeScreen />);
    await type('Seu nome', 'Bia');
    await press('Continuar');
    expect(page()).toContain(CODE_TITLE);
    expect(page()).not.toContain(CHOICE_TITLE);
    expect(field('Código de convite').props.value).toBe('KM2P9Q');
    await press('Entrar na casa');
    expect(calls('join_household')[0][1]).toEqual({ p_invite_code: 'KM2P9Q', p_display_name: 'Bia' });
    expect(await AsyncStorage.getItem('kotii:pending-invite')).toBeNull();
  });

  it('quem veio pelo link do convite e escolheu começar a própria casa: o código sai do aparelho', async () => {
    savePendingInvite('KM2P9Q');
    await mount(<WelcomeScreen />);
    await type('Seu nome', 'Ana');
    await press('Continuar');
    expect(page()).toContain(CODE_TITLE);
    await press('Voltar');
    await choose(CHOICE_NEW);
    await type('Nome da casa', 'Casa da Ana');
    await press('Criar casa');
    expect(calls('create_household')).toHaveLength(1);
    expect(calls('join_household')).toHaveLength(0);
    expect(await AsyncStorage.getItem('kotii:onboarding-next:nova')).toBe('lista');
    // Guardado, a Hoje da casa nova o levaria para "Suas casas" (OnboardingContinuation).
    expect(await AsyncStorage.getItem('kotii:pending-invite')).toBeNull();
  });

  it('com a chave desligada, criar a casa em vez de entrar com o código do link também tira o código do aparelho', async () => {
    jest.replaceProperty(FEATURES, 'onboarding', false);
    savePendingInvite('KM2P9Q');
    await mount(<WelcomeScreen />);
    const segmented = renderer!.root.findAll((node) => Array.isArray(node.props.options) && typeof node.props.onChange === 'function')[0];
    await act(async () => segmented.props.onChange('criar'));
    await type('Seu nome', 'Ana');
    await type('Nome da casa', 'Casa da Ana');
    await press('Criar casa');
    expect(calls('create_household')).toHaveLength(1);
    expect(await AsyncStorage.getItem('kotii:pending-invite')).toBeNull();
  });

  it('com a chave desligada, a tela de antes, já em "Tenho um código" quando há um link de convite', async () => {
    jest.replaceProperty(FEATURES, 'onboarding', false);
    savePendingInvite('KM2P9Q');
    await mount(<WelcomeScreen />);
    expect(page()).not.toContain(NAME_TITLE);
    const segmented = renderer!.root.findAll((node) => Array.isArray(node.props.options) && typeof node.props.onChange === 'function')[0];
    expect(segmented.props.value).toBe('entrar');
    expect(field('Código de convite').props.value).toBe('KM2P9Q');
  });
});

describe('o passo seguinte, na tela Hoje', () => {
  it('quem criou a casa vai para a lista de mercado com o catálogo aberto, uma vez', async () => {
    setOnboardingNext('h1', 'lista');
    await mount(<OnboardingContinuation />);
    expect(mockOpenMarketList).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/lista/[id]', params: { id: 'mercado', primeira: '1' } });
    expect(await AsyncStorage.getItem('kotii:onboarding-next:h1')).toBeNull();
  });

  it('com a Hoje fora de vista (outra tela por cima), espera', async () => {
    mockFocus.focused = false;
    setOnboardingNext('h1', 'lista');
    await mount(<OnboardingContinuation />);
    expect(mockOpenMarketList).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('kotii:onboarding-next:h1')).toBe('lista');
  });

  it('quem entrou com o código vê o nome da casa (agora é moradora) até tocar em "Começar"', async () => {
    setOnboardingNext('h1', 'entrou');
    await mount(<OnboardingContinuation />);
    expect(page()).toContain(JOINED_TITLE);
    expect(page()).toContain(joinedText('Casa da Ana'));
    await pressText(JOINED_OK);
    expect(page()).not.toContain(JOINED_TITLE);
    expect(await AsyncStorage.getItem('kotii:onboarding-next:h1')).toBeNull();
  });

  it('sem passo guardado, nada', async () => {
    await mount(<OnboardingContinuation />);
    expect(page()).toBe('');
    expect(mockOpenMarketList).not.toHaveBeenCalled();
  });
});

describe('a faixa da primeira lista', () => {
  let platform: { restore: () => void } | undefined;
  let share: jest.SpiedFunction<typeof Share.share> | undefined;
  const onPlatform = (os: typeof Platform.OS) => {
    platform = jest.replaceProperty(Platform, 'OS', os);
  };

  beforeEach(() => {
    share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  });

  afterEach(() => {
    platform?.restore();
    platform = undefined;
    share?.mockRestore();
    share = undefined;
  });

  /**
   * Como a lista (app/lista/[id]): `onFinish` tira o `primeira` do endereço, e a faixa sai da tela com o que tiver
   * dentro, o menu aberto também.
   */
  function FirstList({ onFinish }: { onFinish: () => void }) {
    const [first, setFirst] = useState(true);
    if (!first) return null;
    return (
      <FirstListFlow
        onCatalog={jest.fn()}
        onFinish={() => {
          onFinish();
          setFirst(false);
        }}
      />
    );
  }

  /** Um toque no menu que está à vista, pelo caminho de verdade (ui/ActionSheet: no iOS, a escolha espera ele descer). */
  const pressInSheet = async (label: string) => {
    const shown = renderer!.root.findAllByType(Modal).find((modal) => modal.props.visible)!;
    const node = shown.findAll((n) => typeof n.props.onPress === 'function' && rawText(n).replace(ICON_GLYPHS, '') === label)[0];
    await act(async () => node.props.onPress());
    await settle();
  };
  /**
   * No iOS, o menu acaba de descer: o onDismiss do Modal, que só chega com o menu ainda montado (desmontado antes, o
   * iOS não o entrega, e o findByType falha aqui).
   */
  const dismissed = async () => {
    const modal = renderer!.root.findByType(Modal);
    expect(modal.props.visible).toBe(false);
    await act(async () => modal.props.onDismiss());
    await settle();
  };
  const sent = () => ({
    whatsapp: jest.mocked(openExternal).mock.calls.length,
    share: share!.mock.calls.length,
    copied: jest.mocked(Clipboard.setStringAsync).mock.calls.length,
  });

  it('"Pronto" chama a casa (o código à vista) e, sem a tela de início para oferecer, "Agora não" do menu termina', async () => {
    onPlatform('ios');
    const onFinish = jest.fn();
    await mount(<FirstList onFinish={onFinish} />);
    expect(page()).toContain(FIRST_LIST_TEXT);
    expect(sheet(INVITE_TITLE).props.visible).toBe(false);
    await press(FIRST_LIST_DONE);
    expect(sheet(INVITE_TITLE).props.visible).toBe(true);
    expect(page()).toContain('KM2P9Q');
    expect(page()).toContain(INVITE_WHATSAPP);
    await pressInSheet(INVITE_SKIP);
    // A faixa sai já; o fim espera o menu descer (no iOS).
    expect(page()).not.toContain(FIRST_LIST_TEXT);
    expect(onFinish).not.toHaveBeenCalled();
    await dismissed();
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(sent()).toEqual({ whatsapp: 0, share: 0, copied: 0 });
  });

  it.each([
    [INVITE_WHATSAPP, { whatsapp: 1, share: 0, copied: 0 }],
    [INVITE_OTHER, { whatsapp: 0, share: 1, copied: 0 }],
    [INVITE_COPY, { whatsapp: 0, share: 0, copied: 1 }],
  ])('no iPhone (o app), "%s" roda quando o menu acaba de descer, e só então a faixa termina', async (label, expected) => {
    onPlatform('ios');
    const onFinish = jest.fn();
    await mount(<FirstList onFinish={onFinish} />);
    await press(FIRST_LIST_DONE);
    await pressInSheet(label);
    expect(page()).not.toContain(FIRST_LIST_TEXT);
    expect(sent()).toEqual({ whatsapp: 0, share: 0, copied: 0 });
    expect(onFinish).not.toHaveBeenCalled();
    await dismissed();
    expect(sent()).toEqual(expected);
    expect(onFinish).toHaveBeenCalledTimes(1);
    if (label === INVITE_WHATSAPP) expect(openExternal).toHaveBeenCalledWith(expect.stringContaining('KM2P9Q'));
    if (label === INVITE_OTHER) expect(share).toHaveBeenCalledWith({ message: expect.stringContaining('KM2P9Q') });
    if (label === INVITE_COPY) {
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith(expect.stringContaining('KM2P9Q'));
      expect(notify).toHaveBeenCalledWith(INVITE_COPIED_TITLE, INVITE_COPIED);
    }
    expect(renderer!.root.findAllByType(Modal)).toHaveLength(0);
  });

  it('no Android, a escolha roda na hora, e a faixa termina junto', async () => {
    onPlatform('android');
    const onFinish = jest.fn();
    await mount(<FirstList onFinish={onFinish} />);
    await press(FIRST_LIST_DONE);
    await pressInSheet(INVITE_COPY);
    expect(sent()).toEqual({ whatsapp: 0, share: 0, copied: 1 });
    expect(notify).toHaveBeenCalledWith(INVITE_COPIED_TITLE, INVITE_COPIED);
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(page()).not.toContain(FIRST_LIST_TEXT);
  });

  it('no iPhone pelo navegador, depois do convite vem a tela de início, com o aviso de entrar de novo pelo ícone', async () => {
    onPlatform('web');
    mockInstall.mode = 'ios';
    const onFinish = jest.fn();
    await mount(<FirstList onFinish={onFinish} />);
    await press(FIRST_LIST_DONE);
    await pressInSheet(INVITE_SKIP);
    expect(onFinish).not.toHaveBeenCalled();
    expect(sheet(INSTALL_TITLE).props.visible).toBe(true);
    expect(page()).toContain(INSTALL_IOS_SIGN_IN);
    await pressInSheet(INSTALL_IOS_OK);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('"Agora não" termina sem convite', async () => {
    const onFinish = jest.fn();
    await mount(<FirstListFlow onCatalog={jest.fn()} onFinish={onFinish} />);
    await press(FIRST_LIST_SKIP);
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(sheet(INVITE_TITLE).props.visible).toBe(false);
  });
});

describe('o link do convite', () => {
  it('sem conta: guarda o código e vai para entrar', async () => {
    mockAccount.session = null;
    mockParams.codigo = 'km2p9q';
    await mount(<InviteLinkScreen />);
    expect(mockRedirect.href).toBe('/entrar');
    expect(JSON.parse((await AsyncStorage.getItem('kotii:pending-invite'))!)).toMatchObject({ code: 'KM2P9Q' });
  });

  it('com conta e sem casa, para as boas-vindas; já numa casa, para "Suas casas" com o código', async () => {
    mockParams.codigo = 'KM2P9Q';
    mockAccount.household = null;
    await mount(<InviteLinkScreen />);
    expect(mockRedirect.href).toBe('/bem-vindo');
    expect(JSON.parse((await AsyncStorage.getItem('kotii:pending-invite'))!)).toMatchObject({ code: 'KM2P9Q' });
    await act(async () => renderer?.unmount());
    mockAccount.household = { household: { id: 'h1', name: 'Casa da Ana', invite_code: 'ABC234', created_by: 'ana' } };
    await mount(<InviteLinkScreen />);
    expect(mockRedirect.href).toEqual({ pathname: '/casas', params: { codigo: 'KM2P9Q' } });
    // O código vai no endereço, e não fica guardado (nem o de antes): guardado, a Hoje levaria para lá de novo.
    expect(await AsyncStorage.getItem('kotii:pending-invite')).toBeNull();
  });

  it('sem conta, por quem já tem casa: depois de entrar, a Hoje leva o código para "Suas casas", uma vez', async () => {
    mockAccount.session = null;
    mockParams.codigo = 'TR7K2M';
    await mount(<InviteLinkScreen />);
    expect(mockRedirect.href).toBe('/entrar');
    await act(async () => renderer?.unmount());
    // Entrou com a conta dela, que já tem casa: o layout abre a Hoje dessa casa.
    mockAccount.session = { user: { id: 'ana' } };
    await mount(<OnboardingContinuation />);
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/casas', params: { codigo: 'TR7K2M' } });
    expect(await AsyncStorage.getItem('kotii:pending-invite')).toBeNull();
    expect(page()).toBe('');
    // Voltar de "Suas casas" sem entrar não leva de novo.
    await act(async () => renderer?.unmount());
    await mount(<OnboardingContinuation />);
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it('com a Hoje fora de vista, o código espera; o convite da própria casa aberta só sai do aparelho', async () => {
    mockFocus.focused = false;
    savePendingInvite('TR7K2M');
    await mount(<OnboardingContinuation />);
    expect(router.push).not.toHaveBeenCalled();
    expect(JSON.parse((await AsyncStorage.getItem('kotii:pending-invite'))!)).toMatchObject({ code: 'TR7K2M' });
    await act(async () => renderer?.unmount());
    mockFocus.focused = true;
    savePendingInvite('KM2P9Q');
    await mount(<OnboardingContinuation />);
    expect(router.push).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('kotii:pending-invite')).toBeNull();
  });

  it('o passo da casa que acabou de nascer vem antes do código guardado', async () => {
    savePendingInvite('TR7K2M');
    setOnboardingNext('h1', 'entrou');
    await mount(<OnboardingContinuation />);
    expect(page()).toContain(JOINED_TITLE);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('um link estragado não guarda nada', async () => {
    mockAccount.session = null;
    mockParams.codigo = 'nada';
    await mount(<InviteLinkScreen />);
    expect(mockRedirect.href).toBe('/entrar');
    expect(await AsyncStorage.getItem('kotii:pending-invite')).toBeNull();
  });
});

describe('a prévia do começo (para quem mantém o app)', () => {
  it('só para app_admins', async () => {
    mockAdmin.data = false;
    await mount(<OnboardingPreviewScreen />);
    expect(page()).toContain(PREVIEW_ONLY_ADMINS);
    expect(page()).not.toContain(WELCOME_TITLE);
  });

  it('das boas-vindas à casa: as telas de conta não mandam nada; a casa nasce e a Hoje segue', async () => {
    await mount(<OnboardingPreviewScreen />);
    expect(page()).toContain(PREVIEW_NOTICE);
    expect(page()).toContain(WELCOME_TITLE);
    for (const line of welcomeLines(FEATURES.finance)) expect(page()).toContain(line.text);
    await press(WELCOME_CREATE);
    expect(page()).toContain(PASSWORD_HINT);
    await type('E-mail', 'nova@exemplo.com');
    await type('Senha', 'segredo1');
    await press(SIGN_UP_TITLE);
    expect(page()).toContain(confirmEmailText('nova@exemplo.com'));
    // Como a conta de verdade: a espera para reenviar já começa com a conta criada.
    expect(button('Reenviar o e-mail em 60 s').props.disabled).toBe(true);
    await press(CONFIRM_EMAIL_DONE);
    expect(page()).toContain(SIGN_IN_TITLE);
    await press(SIGN_IN_TITLE);
    expect(mockAuth.signUp).not.toHaveBeenCalled();
    expect(mockAuth.resend).not.toHaveBeenCalled();
    expect(mockAuth.signInWithPassword).not.toHaveBeenCalled();
    await type('Seu nome', 'Ana');
    await press('Continuar');
    await choose(CHOICE_NEW);
    await type('Nome da casa', 'Casa de teste');
    await press('Criar casa');
    expect(calls('create_household')).toEqual([['create_household', { p_name: 'Casa de teste', p_display_name: 'Ana' }]]);
    expect(await AsyncStorage.getItem('kotii:onboarding-next:nova')).toBe('lista');
    // Volta para as abas que já estão embaixo, sem empilhar outras.
    expect(router.dismissTo).toHaveBeenCalledWith('/');
  });

  it('como quem chegou por um convite: o convite no lugar do título, e o código da casa aberta (nunca um inventado)', async () => {
    await mount(<OnboardingPreviewScreen />);
    await press('Ver como quem chegou por um convite');
    expect(page()).toContain(INVITED_TITLE);
    await press(WELCOME_CREATE);
    await type('E-mail', 'nova@exemplo.com');
    await type('Senha', 'segredo1');
    await press(SIGN_UP_TITLE);
    await press(CONFIRM_EMAIL_DONE);
    await press(SIGN_IN_TITLE);
    await type('Seu nome', 'Bia');
    await press('Continuar');
    expect(field('Código de convite').props.value).toBe('KM2P9Q');
  });
});

describe('as boas-vindas e a conta (entrar, com a chave ligada)', () => {
  beforeEach(() => {
    mockAccount.session = null;
    mockAccount.household = null;
  });

  it('o aparelho que nunca teve conta vê as boas-vindas; criar a conta pede a confirmação numa tela', async () => {
    fakeClock();
    await mount(<SignInScreen />);
    expect(page()).toContain(WELCOME_TITLE);
    await press(WELCOME_CREATE);
    // Um modo por vez, com a regra da senha à vista.
    expect(page()).toContain(PASSWORD_HINT);
    expect(renderer!.root.findAll((node) => Array.isArray(node.props.options) && typeof node.props.onChange === 'function')).toHaveLength(0);
    await type('E-mail', ' Nova@Exemplo.com ');
    await type('Senha', 'segredo1');
    await press(SIGN_UP_TITLE);
    expect(mockAuth.signUp).toHaveBeenCalledWith({ email: 'nova@exemplo.com', password: 'segredo1' });
    expect(page()).toContain(CONFIRM_EMAIL_TITLE);
    expect(page()).toContain(confirmEmailText('nova@exemplo.com'));
    // O e-mail acabou de sair: o Supabase recusa outro antes de 60 s, então a espera começa com a conta criada (um
    // "Reenviar" logo de cara não mandaria nada e diria "Mandamos de novo").
    expect(button('Reenviar o e-mail')).toBeUndefined();
    expect(button('Reenviar o e-mail em 60 s').props.disabled).toBe(true);
    await passSeconds(59);
    expect(button('Reenviar o e-mail em 1 s').props.disabled).toBe(true);
    await passSeconds(1);
    expect(button('Reenviar o e-mail').props.disabled).toBe(false);
    await press('Reenviar o e-mail');
    expect(mockAuth.resend).toHaveBeenCalledWith({ type: 'signup', email: 'nova@exemplo.com' });
    expect(notify).toHaveBeenCalledWith(CONFIRM_EMAIL_TITLE, CONFIRM_EMAIL_RESENT);
    // E de novo a espera, depois do reenvio.
    expect(button('Reenviar o e-mail em 60 s').props.disabled).toBe(true);
    await press(CONFIRM_EMAIL_DONE);
    expect(page()).toContain(SIGN_IN_TITLE);
    expect(field('E-mail').props.value).toBe('nova@exemplo.com');
  });

  it('"Reenviar o e-mail" recusado por ser cedo demais não diz "Mandamos de novo": nada saiu, e a espera é a do servidor', async () => {
    fakeClock();
    // O servidor espera mais do que a conta da tela (ou outra aba pediu antes): a recusa de sempre do Supabase.
    mockAuth.resend.mockResolvedValueOnce({
      data: {},
      error: Object.assign(new Error('For security purposes, you can only request this after 47 seconds.'), {
        status: 429,
        code: 'over_email_send_rate_limit',
      }),
    } as never);
    await mount(<SignInScreen />);
    await press(WELCOME_CREATE);
    await type('E-mail', 'nova@exemplo.com');
    await type('Senha', 'segredo1');
    await press(SIGN_UP_TITLE);
    await passSeconds(60);
    await press('Reenviar o e-mail');
    expect(mockAuth.resend).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(CONFIRM_EMAIL_TITLE, CONFIRM_EMAIL_NOT_YET);
    expect(notify).not.toHaveBeenCalledWith(CONFIRM_EMAIL_TITLE, CONFIRM_EMAIL_RESENT);
    expect(button('Reenviar o e-mail em 47 s').props.disabled).toBe(true);
    // A tela continua na confirmação, com o mesmo e-mail.
    expect(page()).toContain(confirmEmailText('nova@exemplo.com'));
  });

  it('quem chegou pelo link do convite vê o convite nas boas-vindas', async () => {
    savePendingInvite('KM2P9Q');
    await mount(<SignInScreen />);
    expect(page()).toContain(INVITED_TITLE);
  });

  // O link do e-mail que venceu, aberto num aparelho que nunca teve conta (a pessoa criou a conta no computador e abriu
  // a confirmação ou a recuperação no celular): a tela abre na recuperação, sem as boas-vindas, e voltar dali é entrar.
  it('o link do e-mail que não deu certo abre em "Recuperar a senha", e "Voltar para entrar" leva a Entrar, não às boas-vindas', async () => {
    setLinkNotice(LINK_EXPIRED);
    await mount(<SignInScreen />);
    expect(page()).toContain(LINK_EXPIRED);
    expect(page()).toContain('Recuperar a senha');
    expect(page()).not.toContain(WELCOME_TITLE);
    expect(button(SIGN_IN_TITLE)).toBeUndefined();
    await press('Voltar para entrar');
    // O aviso continua ("é só entrar"), e embaixo dele está o formulário de entrar: nada de "Criar conta" / "Já tenho conta".
    expect(page()).toContain(LINK_EXPIRED);
    expect(page()).not.toContain(WELCOME_TITLE);
    expect(page()).not.toContain('Recuperar a senha');
    expect(button(WELCOME_SIGN_IN)).toBeUndefined();
    expect(button(SIGN_IN_TITLE)).toBeDefined();
    expect(button(SWITCH_TO_SIGN_UP)).toBeDefined();
    // Pelo "Esqueci minha senha" do formulário, a volta é a mesma.
    await press('Esqueci minha senha');
    expect(page()).toContain('Recuperar a senha');
    await press('Voltar para entrar');
    expect(page()).not.toContain(WELCOME_TITLE);
    expect(button(SIGN_IN_TITLE)).toBeDefined();
  });

  it('"Já tenho conta" e depois "Esqueci minha senha": voltar da recuperação também é entrar', async () => {
    await mount(<SignInScreen />);
    await press(WELCOME_SIGN_IN);
    await press('Esqueci minha senha');
    expect(page()).toContain('Recuperar a senha');
    await press('Voltar para entrar');
    expect(page()).not.toContain(WELCOME_TITLE);
    expect(button(SIGN_IN_TITLE)).toBeDefined();
  });

  it('a recuperação da senha no começo novo: o e-mail limpo, o passo do código (o aviso do link sai) e o código', async () => {
    setLinkNotice(LINK_EXPIRED);
    await mount(<SignInScreen />);
    await type('E-mail', ' Ana@Exemplo.com ');
    await press('Enviar e-mail');
    expect(mockAuth.resetPasswordForEmail).toHaveBeenCalledWith('ana@exemplo.com');
    expect(page()).not.toContain(LINK_EXPIRED);
    expect(page()).toContain('Se ana@exemplo.com tiver conta no Kotii');
    expect(button('Reenviar o e-mail em 60 s')).toBeDefined();
    // Voltar para entrar guarda o e-mail; "Já tenho um código" leva de novo ao código.
    await press('Voltar para entrar');
    expect(button(SIGN_IN_TITLE)).toBeDefined();
    expect(field('E-mail').props.value).toBe('ana@exemplo.com');
    await press('Esqueci minha senha');
    await press('Já tenho um código');
    await type('Código do e-mail', '12 34 56');
    await press('Continuar');
    expect(mockAuth.verifyOtp).toHaveBeenCalledWith({ email: 'ana@exemplo.com', token: '123456', type: 'recovery' });
    expect(startRecovery).toHaveBeenCalledWith('u1');
  });

  it('com a chave desligada, "Voltar para entrar" depois do link volta à tela de antes (Entrar e Criar conta no seletor)', async () => {
    jest.replaceProperty(FEATURES, 'onboarding', false);
    setLinkNotice(LINK_EXPIRED);
    await mount(<SignInScreen />);
    expect(page()).toContain('Recuperar a senha');
    await press('Voltar para entrar');
    expect(page()).toContain(LINK_EXPIRED);
    const selector = renderer!.root.findAll((node) => Array.isArray(node.props.options) && typeof node.props.onChange === 'function');
    expect(selector[0]?.props.value).toBe('entrar');
    expect(button('Entrar')).toBeDefined();
    expect(button('Esqueci minha senha')).toBeDefined();
  });

  // Por último: a marca de que o aparelho já teve conta fica na memória até o fim do arquivo.
  it('o aparelho que já teve conta abre direto em "Entrar"', async () => {
    markHadAccount();
    await mount(<SignInScreen />);
    expect(page()).not.toContain(WELCOME_TITLE);
    expect(button(SIGN_IN_TITLE)).toBeDefined();
    expect(button('Esqueci minha senha')).toBeDefined();
  });
});

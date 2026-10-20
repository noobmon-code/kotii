import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { router } from 'expo-router';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import SignInScreen from '@/app/entrar';
import TermsScreen from '@/app/termos';
import { TERMS_CONSENT, TERMS_SECTIONS, TERMS_TITLE, termsVersionLabel } from '@/domain/terms';

// A tela dos termos e o link da tela de entrar. O link da aba Família e o do cartão dos preços compartilhados
// estão em sharedPricesScreens.test.tsx, junto com o resto da aba.

/** Se há para onde voltar, e quem escuta as mudanças da pilha (a tela dos termos). */
let mockCanGoBack = true;
const mockStateListeners = new Set<() => void>();
jest.mock('expo-router', () => {
  const navigation = {
    addListener: (_event: string, listener: () => void) => {
      mockStateListeners.add(listener);
      return () => mockStateListeners.delete(listener);
    },
  };
  return {
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => mockCanGoBack },
    useNavigation: () => navigation,
  };
});
/** O aviso dos termos (data/terms, conferido em data/__tests__/terms.test.tsx): null é sem conta ou com o aceite. */
const mockTerms = {
  notice: null as 'primeira' | 'mudou' | null,
  accept: jest.fn(async () => undefined),
  atSignIn: jest.fn(async (_userId: string, _created: boolean) => undefined),
};
jest.mock('@/data/terms', () => ({
  useTermsNotice: () => ({ notice: mockTerms.notice, accept: mockTerms.accept }),
  acceptTermsAtSignIn: (userId: string, created: boolean) => mockTerms.atSignIn(userId, created),
}));
/** O que o Supabase responde ao entrar e ao criar a conta. */
const mockAuth = {
  signInWithPassword: jest.fn(async () => ({ data: { user: { id: 'u1' }, session: { user: { id: 'u1' } } }, error: null })),
  signUp: jest.fn(async (): Promise<{ data: { user: { id: string }; session: { user: { id: string } } | null }; error: null }> => ({
    data: { user: { id: 'u2' }, session: { user: { id: 'u2' } } },
    error: null,
  })),
};
// Pelo getter: o jest.mock sobe para o topo do arquivo, antes de mockAuth existir.
jest.mock('@/lib/supabase', () => ({
  supabase: {
    get auth() {
      return mockAuth;
    },
  },
  errorMessage: (error: unknown) => String(error),
}));
jest.mock('@/lib/linkNotice', () => ({ clearLinkNotice: jest.fn(), linkNotice: () => null, useLinkNotice: () => null }));
jest.mock('@/lib/passwordRecovery', () => ({ finishRecovery: jest.fn(), startRecovery: jest.fn() }));
jest.mock('@/lib/session', () => ({ useSessionEnded: () => false }));
jest.mock('@/ui/dialogs', () => ({ confirmAction: jest.fn(), notify: jest.fn() }));
// Os desenhos e o fundo não entram no que se confere aqui.
jest.mock('@/ui/art', () => ({ FamilyArt: () => null, Logo: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));

let renderer: ReactTestRenderer | undefined;

const rawText = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map(rawText).join(''));
/** As letras de uso privado do Unicode: é onde a fonte de ícones guarda os desenhos. */
const ICON_GLYPHS = new RegExp(
  `[${String.fromCodePoint(0xe000)}-${String.fromCodePoint(0xf8ff)}]|[${String.fromCodePoint(0xf0000)}-${String.fromCodePoint(0x10ffff)}]`,
  'gu',
);
/** O que a tela escreve, sem os ícones. */
const textOf = (node: ReactTestInstance | string) => rawText(node).replace(ICON_GLYPHS, '');

async function mount(screen: React.ReactElement) {
  await act(async () => {
    renderer = create(screen);
  });
  return textOf(renderer!.root);
}

/** O que tem esse texto e um toque. */
const pressable = (label: string) =>
  renderer!.root.findAll((node) => typeof node.props.onPress === 'function' && textOf(node) === label);

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack = true;
  mockTerms.notice = null;
});

/** O botão com esse título (não a opção do seletor Entrar / Criar conta, que tem o mesmo texto). */
const button = (title: string) =>
  renderer!.root.findAll((node) => node.props.title === title && typeof node.props.onPress === 'function')[0];

/** Digita no campo com esse rótulo. */
const type = async (label: string, text: string) => {
  const input = renderer!.root.findAll((node) => node.props.label === label && typeof node.props.onChangeText === 'function')[0];
  await act(async () => input.props.onChangeText(text));
};

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

describe('tela dos termos', () => {
  it('mostra o título, a versão e cada seção com o texto dela, na ordem', async () => {
    const page = await mount(<TermsScreen />);
    const body = TERMS_SECTIONS.map((section) => section.title + section.paragraphs.join('')).join('');
    expect(page).toBe(`${TERMS_TITLE}${termsVersionLabel()}${body}${termsVersionLabel()}`);
  });

  it('aberta direto (sem para onde voltar), mostra "Voltar", que leva ao começo do app', async () => {
    mockCanGoBack = false;
    const page = await mount(<TermsScreen />);
    expect(page.startsWith(`Voltar${TERMS_TITLE}`)).toBe(true);
    const [back] = pressable('Voltar');
    await act(async () => back.props.onPress());
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('a pilha muda com ela aberta (uma guarda do _layout desligou as telas de antes): o "Voltar" aparece', async () => {
    expect(await mount(<TermsScreen />)).not.toContain('Voltar');
    mockCanGoBack = false;
    await act(async () => mockStateListeners.forEach((listener) => listener()));
    expect(textOf(renderer!.root).startsWith(`Voltar${TERMS_TITLE}`)).toBe(true);
  });

  it('com o aceite pendente, termina com "Entendi", que grava o aceite e volta para onde estava', async () => {
    mockTerms.notice = 'mudou';
    const page = await mount(<TermsScreen />);
    expect(page.endsWith(`${termsVersionLabel()}Entendi`)).toBe(true);
    const [ok] = pressable('Entendi');
    await act(async () => ok.props.onPress());
    expect(mockTerms.accept).toHaveBeenCalledTimes(1);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('aberta direto, o "Entendi" grava sem tentar voltar (o "Voltar" do topo leva ao começo)', async () => {
    mockTerms.notice = 'primeira';
    mockCanGoBack = false;
    await mount(<TermsScreen />);
    const [ok] = pressable('Entendi');
    await act(async () => ok.props.onPress());
    expect(mockTerms.accept).toHaveBeenCalledTimes(1);
    expect(router.back).not.toHaveBeenCalled();
  });
});

describe('tela de entrar', () => {
  it('avisa que continuar é concordar com os termos, e o botão abre a tela deles', async () => {
    const page = await mount(<SignInScreen />);
    expect(page).toContain(`${TERMS_CONSENT}${TERMS_TITLE}`);
    const [link] = pressable(TERMS_TITLE);
    await act(async () => link.props.onPress());
    expect(router.push).toHaveBeenCalledWith('/termos');
  });

  it('o aviso também vale para quem cria a conta', async () => {
    await mount(<SignInScreen />);
    const [create] = pressable('Criar conta');
    await act(async () => create.props.onPress());
    expect(textOf(renderer!.root)).toContain(`${TERMS_CONSENT}${TERMS_TITLE}`);
  });

  it('o aviso diz que continuar é confirmar ter 18 anos ou mais', async () => {
    expect(await mount(<SignInScreen />)).toContain('Ao continuar, você confirma que tem 18 anos ou mais e concorda com os');
  });

  it('entrar com a senha passa a conta para o aceite da entrada (que só grava para quem não tem nenhum)', async () => {
    await mount(<SignInScreen />);
    await type('E-mail', 'ana@exemplo.com');
    await type('Senha', 'segredo1');
    await act(async () => button('Entrar').props.onPress());
    expect(mockAuth.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(mockTerms.atSignIn).toHaveBeenCalledWith('u1', false);
  });

  it('criar a conta grava o aceite da versão atual; com o e-mail a confirmar, fica para a primeira entrada', async () => {
    await mount(<SignInScreen />);
    await act(async () => pressable('Criar conta')[0].props.onPress());
    await type('E-mail', 'bia@exemplo.com');
    await type('Senha', 'segredo1');
    await act(async () => button('Criar conta').props.onPress());
    expect(mockAuth.signUp).toHaveBeenCalledTimes(1);
    expect(mockTerms.atSignIn).toHaveBeenCalledWith('u2', true);

    mockTerms.atSignIn.mockClear();
    mockAuth.signUp.mockResolvedValueOnce({ data: { user: { id: 'u3' }, session: null }, error: null });
    await act(async () => button('Criar conta').props.onPress());
    expect(mockAuth.signUp).toHaveBeenCalledTimes(2);
    expect(mockTerms.atSignIn).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { router } from 'expo-router';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import SignInScreen from '@/app/entrar';
import TermsScreen from '@/app/termos';
import { TERMS_CONSENT, TERMS_SECTIONS, TERMS_TITLE, termsVersionLabel } from '@/domain/terms';

// A tela dos termos e o link da tela de entrar. O link da aba Família e o do cartão dos preços compartilhados
// estão em sharedPricesScreens.test.tsx, junto com o resto da aba.

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/supabase', () => ({ supabase: { auth: {} }, errorMessage: (error: unknown) => String(error) }));
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
});

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
});

describe('tela de entrar', () => {
  it('avisa que continuar é concordar com os termos, e o link abre a tela deles', async () => {
    const page = await mount(<SignInScreen />);
    expect(page).toContain(`${TERMS_CONSENT} ${TERMS_TITLE}.`);
    const [link] = pressable(TERMS_TITLE);
    expect(link.props.accessibilityRole).toBe('link');
    await act(async () => link.props.onPress());
    expect(router.push).toHaveBeenCalledWith('/termos');
  });

  it('o aviso também vale para quem cria a conta', async () => {
    await mount(<SignInScreen />);
    const [create] = pressable('Criar conta');
    await act(async () => create.props.onPress());
    expect(textOf(renderer!.root)).toContain(`${TERMS_CONSENT} ${TERMS_TITLE}.`);
  });
});

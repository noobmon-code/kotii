import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthApiError, FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import DeleteAccountScreen from '@/app/apagar-conta';
import { accountDeletionUnavailable } from '@/domain/account';
import { TERMS_CONTACT } from '@/domain/terms';
import { forgetRecoveryOf } from '@/lib/passwordRecovery';
import { signOut } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { confirmAction, notify } from '@/ui/dialogs';

// A tela de apagar a conta, com a prévia do banco e a função de mentira: o que ela avisa antes, a senha
// errada que não apaga nada, o app que chegou antes da função (o aviso com o e-mail, sem erro cru) e,
// apagada a conta, o que sai deste aparelho: também quando a resposta se perdeu e o Auth é quem prova que
// a conta não existe mais, e quando a saída falha depois de apagar.

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), functions: { invoke: jest.fn() }, auth: { getUser: jest.fn() } },
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));
jest.mock('@/lib/session', () => ({ signOut: jest.fn(async () => undefined), endSessionIfGone: async () => false }));
// O cache do app (data/terms o usa no aceite) fica fora: a tela tem o dela.
jest.mock('@/lib/queryClient', () => ({ queryClient: {} }));
jest.mock('@/lib/passwordRecovery',() => ({ forgetRecoveryOf: jest.fn(async () => undefined) }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'ana', email: 'ana@exemplo.com' } } }) }));
// Confirmar é dizer sim na hora.
jest.mock('@/ui/dialogs', () => ({ confirmAction: jest.fn((_t: string, _m: string, _l: string, yes: () => void) => yes()), notify: jest.fn() }));
// As imagens da tela de fotos (data/images) e o fundo não entram no que se confere aqui.
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@/ui/art', () => ({ Mascot: () => null, Spot: () => null }));

const rpc = supabase.rpc as unknown as jest.Mock<(name: string) => Promise<{ data: unknown; error: unknown }>>;
const invoke = supabase.functions.invoke as unknown as jest.Mock<
  (name: string, options: { body: unknown }) => Promise<{ data: unknown; error: unknown }>
>;

const getUser = supabase.auth.getUser as unknown as jest.Mock<() => Promise<{ data: { user: unknown }; error: unknown }>>;
const ACCOUNT_GONE = {
  data: { user: null },
  error: new AuthApiError('User from sub claim in JWT does not exist', 403, 'user_not_found'),
};

const HOUSES = [
  { id: 'casa-cidade', name: 'Cidade', role: 'owner', last: false, finance: false },
  { id: 'casa-praia', name: 'Praia', role: 'owner', last: true, finance: false },
];

const reply = (status: number, body: unknown) =>
  new FunctionsHttpError(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

let renderer: ReactTestRenderer | undefined;
let queryClient: QueryClient;

const rawText = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map(rawText).join(''));
const ICON_GLYPHS = new RegExp(
  `[${String.fromCodePoint(0xe000)}-${String.fromCodePoint(0xf8ff)}]|[${String.fromCodePoint(0xf0000)}-${String.fromCodePoint(0x10ffff)}]`,
  'gu',
);
const page = () => rawText(renderer!.root).replace(ICON_GLYPHS, '');

/** Deixa as buscas e a mutação terminarem. */
async function settle() {
  for (let i = 0; i < 5; i += 1) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function mount() {
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={queryClient}>
        <DeleteAccountScreen />
      </QueryClientProvider>,
    );
  });
  await settle();
  return page();
}

async function typePassword(text: string) {
  const field = renderer!.root.find((node) => node.props.secureTextEntry === true && typeof node.props.onChangeText === 'function');
  await act(async () => field.props.onChangeText(text));
}

async function pressDelete() {
  const [button] = renderer!.root.findAll(
    (node) => typeof node.props.onPress === 'function' && rawText(node).replace(ICON_GLYPHS, '') === 'Apagar minha conta',
  );
  await act(async () => button.props.onPress());
  await settle();
}

beforeEach(() => {
  jest.clearAllMocks();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  rpc.mockResolvedValue({ data: HOUSES, error: null });
  invoke.mockResolvedValue({ data: { status: 'deleted', deletedHouseholds: 1 }, error: null });
  getUser.mockResolvedValue({ data: { user: { id: 'ana' } }, error: null });
});

/** O que o aparelho guarda da Ana e do Beto, que também entra neste aparelho. */
async function storeBothAccounts() {
  await AsyncStorage.multiSet([
    ['nuke:conversation:ana:casa-cidade', '[]'],
    ['nuke:conversation:ana', '[]'],
    ['nuke:conversation:beto:casa-cidade', '[]'],
    ['kotii:active-household', JSON.stringify({ ana: 'casa-cidade', beto: 'casa-cidade' })],
    ['kotii:terms-accepted:ana', '["2026-10-20"]'],
    ['kotii:terms-accepted:beto', '["2026-10-20"]'],
  ]);
}

/** Só o da Ana saiu. */
async function expectOnlyAnaForgotten() {
  expect(await AsyncStorage.getItem('nuke:conversation:ana:casa-cidade')).toBeNull();
  expect(await AsyncStorage.getItem('nuke:conversation:ana')).toBeNull();
  expect(await AsyncStorage.getItem('kotii:terms-accepted:ana')).toBeNull();
  // Os de outra conta do aparelho ficam.
  expect(await AsyncStorage.getItem('nuke:conversation:beto:casa-cidade')).toBe('[]');
  expect(await AsyncStorage.getItem('kotii:terms-accepted:beto')).toBe('["2026-10-20"]');
  expect(JSON.parse((await AsyncStorage.getItem('kotii:active-household'))!)).toEqual({ beto: 'casa-cidade' });
}

/** Nada da Ana saiu do aparelho. */
async function expectNothingForgotten() {
  expect(await AsyncStorage.getItem('nuke:conversation:ana:casa-cidade')).toBe('[]');
  expect(await AsyncStorage.getItem('kotii:terms-accepted:ana')).toBe('["2026-10-20"]');
  expect(JSON.parse((await AsyncStorage.getItem('kotii:active-household'))!)).toEqual({ ana: 'casa-cidade', beto: 'casa-cidade' });
}

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  queryClient.clear();
  await AsyncStorage.clear();
});

describe('apagar a conta', () => {
  it('antes: o que fica com a casa dividida, a casa que some por ser a última e que não tem volta', async () => {
    const text = await mount();
    expect(rpc).toHaveBeenCalledWith('account_deletion_preview');
    expect(text).toContain('Não tem volta');
    expect(text).toContain('Em "Cidade", o que você registrou continua com a casa');
    expect(text).toContain('nos acertos da divisão de gastos você aparece como "Ex-morador"');
    expect(text).toContain('Você é a última pessoa em "Praia": a casa é apagada junto');
    expect(text).toContain('A senha de ana@exemplo.com.');
  });

  it('sem a senha, nem pergunta', async () => {
    await mount();
    await pressDelete();
    expect(notify).toHaveBeenCalledWith('Digite a sua senha', expect.any(String));
    expect(confirmAction).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('senha errada: nada é apagado e a pessoa continua na conta', async () => {
    invoke.mockResolvedValue({ data: null, error: reply(403, { code: 'wrong_password', error: 'Senha errada. Nada foi apagado.' }) });
    await mount();
    await typePassword('errada');
    await pressDelete();
    expect(invoke).toHaveBeenCalledWith('delete-account', { body: { password: 'errada', deleteHouseholds: ['casa-praia'] } });
    expect(notify).toHaveBeenCalledWith('Senha errada', 'Confira a senha e tente de novo. Nada foi apagado.');
    expect(signOut).not.toHaveBeenCalled();
    // Uma resposta com motivo: não há o que perguntar ao Auth.
    expect(getUser).not.toHaveBeenCalled();
    expect(page()).toContain('Confirme com a sua senha');
  });

  it('a função ainda não foi publicada: o aviso com o e-mail de contato, sem erro cru', async () => {
    invoke.mockResolvedValue({ data: null, error: reply(404, { code: 'NOT_FOUND', message: 'Requested function was not found' }) });
    await mount();
    await typePassword('segredo');
    await pressDelete();
    expect(notify).toHaveBeenCalledWith('Ainda não disponível', accountDeletionUnavailable(TERMS_CONTACT));
    const text = page();
    expect(text).toBe(accountDeletionUnavailable(TERMS_CONTACT));
    expect(text).not.toContain('Requested function');
    expect(signOut).not.toHaveBeenCalled();
  });

  it('o banco ainda sem a parte de apagar: a tela já abre com o aviso e o e-mail', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.account_deletion_preview in the schema cache' },
    });
    expect(await mount()).toBe(accountDeletionUnavailable(TERMS_CONTACT));
    expect(accountDeletionUnavailable(TERMS_CONTACT)).toContain(TERMS_CONTACT);
  });

  it('uma casa ficou só com a pessoa depois do aviso: relê as casas e avisa, sem sair da conta', async () => {
    invoke.mockResolvedValue({ data: null, error: reply(409, { code: 'last_member', error: 'Uma das suas casas ficou só com você.' }) });
    await mount();
    await typePassword('segredo');
    rpc.mockResolvedValue({ data: HOUSES.map((h) => ({ ...h, last: true })), error: null });
    await pressDelete();
    expect(notify).toHaveBeenCalledWith('Suas casas mudaram', 'Uma das suas casas ficou só com você.');
    expect(page()).toContain('Você é a última pessoa em "Cidade" e "Praia"');
    expect(signOut).not.toHaveBeenCalled();
  });

  it('a função publicada responde 404 pelo relay: o mesmo aviso com o e-mail', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: new FunctionsRelayError(new Response('{"message":"not found"}', { status: 404, headers: { 'x-relay-error': 'true' } })),
    });
    await mount();
    await typePassword('segredo');
    await pressDelete();
    expect(notify).toHaveBeenCalledWith('Ainda não disponível', accountDeletionUnavailable(TERMS_CONTACT));
    expect(page()).toBe(accountDeletionUnavailable(TERMS_CONTACT));
    expect(signOut).not.toHaveBeenCalled();
  });

  it('apagada: sai da conta e leva a marca da recuperação, as conversas, a casa guardada e os aceites deste aparelho', async () => {
    await storeBothAccounts();
    await mount();
    await typePassword('segredo');
    await pressDelete();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(forgetRecoveryOf).toHaveBeenCalledWith('ana');
    expect(notify).toHaveBeenCalledWith('Conta apagada', expect.any(String));
    // A resposta disse que apagou: nem pergunta ao Auth.
    expect(getUser).not.toHaveBeenCalled();
    await expectOnlyAnaForgotten();
  });

  it('a saída falha depois de apagar: ainda diz que a conta foi apagada e limpa o resto, menos a marca da recuperação', async () => {
    (signOut as jest.Mock<() => Promise<void>>).mockRejectedValueOnce(new Error('storage indisponível'));
    await storeBothAccounts();
    await mount();
    await typePassword('segredo');
    await pressDelete();
    expect(notify).toHaveBeenCalledWith('Conta apagada', expect.any(String));
    expect(notify).not.toHaveBeenCalledWith('Não deu para apagar a conta', expect.anything());
    // Com a sessão talvez ainda aqui, a marca fica (ela nunca sai antes da sessão).
    expect(forgetRecoveryOf).not.toHaveBeenCalled();
    await expectOnlyAnaForgotten();
  });

  it('a resposta da exclusão se perdeu e a nova tentativa dá 401: o Auth diz que a conta não existe, e é como apagada', async () => {
    invoke.mockResolvedValue({ data: null, error: reply(401, { error: 'Entre na sua conta para apagá-la.' }) });
    getUser.mockResolvedValue(ACCOUNT_GONE);
    await storeBothAccounts();
    await mount();
    await typePassword('segredo');
    await pressDelete();
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('Conta apagada', expect.any(String));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(forgetRecoveryOf).toHaveBeenCalledWith('ana');
    await expectOnlyAnaForgotten();
  });

  it('sem resposta da função (rede caiu depois de apagar): o Auth diz que a conta não existe, e é como apagada', async () => {
    invoke.mockResolvedValue({ data: null, error: new FunctionsFetchError(new TypeError('Network request failed')) });
    getUser.mockResolvedValue(ACCOUNT_GONE);
    await storeBothAccounts();
    await mount();
    await typePassword('segredo');
    await pressDelete();
    expect(notify).toHaveBeenCalledWith('Conta apagada', expect.any(String));
    await expectOnlyAnaForgotten();
  });

  it('401 com a conta ainda existindo (a sessão acabou por outro motivo): nada sai do aparelho além do de sempre', async () => {
    invoke.mockResolvedValue({ data: null, error: reply(401, { error: 'Entre na sua conta para apagá-la.' }) });
    getUser.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError('Session from session_id claim in JWT does not exist', 403, 'session_not_found'),
    });
    await storeBothAccounts();
    await mount();
    await typePassword('segredo');
    await pressDelete();
    expect(notify).not.toHaveBeenCalledWith('Conta apagada', expect.anything());
    expect(notify).toHaveBeenCalledWith('Não deu para apagar a conta', 'Não deu para apagar a conta agora. Tente de novo.');
    expect(forgetRecoveryOf).not.toHaveBeenCalled();
    await expectNothingForgotten();
  });

  it('sem internet e sem resposta do Auth: o erro de sempre, nada sai do aparelho', async () => {
    invoke.mockResolvedValue({ data: null, error: new FunctionsFetchError(new TypeError('Network request failed')) });
    getUser.mockRejectedValue(new TypeError('Network request failed'));
    await storeBothAccounts();
    await mount();
    await typePassword('segredo');
    await pressDelete();
    expect(notify).toHaveBeenCalledWith('Não deu para apagar a conta', 'Não deu para apagar a conta agora. Tente de novo.');
    expect(signOut).not.toHaveBeenCalled();
    await expectNothingForgotten();
  });

  it('outro erro da função: a mensagem dela', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: reply(500, { code: 'auth_failed', error: 'Você já saiu das suas casas, mas a conta não terminou de ser apagada. Tente de novo.' }),
    });
    await mount();
    await typePassword('segredo');
    await pressDelete();
    expect(notify).toHaveBeenCalledWith(
      'Não deu para apagar a conta',
      'Você já saiu das suas casas, mas a conta não terminou de ser apagada. Tente de novo.',
    );
    expect(signOut).not.toHaveBeenCalled();
  });
});

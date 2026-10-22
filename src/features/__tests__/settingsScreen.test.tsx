import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from 'expo-router';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import SettingsScreen from '@/app/configuracoes';
import { THEME_HINT } from '@/domain/appearance';
import { PROFILE_MESSAGES, PROFILE_NOT_READY, PROFILE_PRIVACY } from '@/domain/profile';
import { TERMS_TITLE, termsVersionLabel } from '@/domain/terms';
import { THEME_CHOICE_KEY } from '@/lib/themeChoice';
import { confirmAction, notify } from '@/ui/dialogs';
import { PALETTES } from '@/ui/theme';
import { ThemeChoiceProvider } from '@/ui/ThemeChoiceProvider';

// A tela de Configurações com o banco de mentira: o perfil (lido da tabela, salvo numa chamada só, com os erros
// do banco em palavras, e só o nome com um aviso quando a migração ainda não chegou), o tema (que muda as
// cores e fica no aparelho) e a conta (termos, sair, apagar), que vieram da aba Família.

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
const mockSystem = { scheme: 'light' as 'light' | 'dark' };
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ __esModule: true, default: () => mockSystem.scheme }));

/** A tabela profiles e a save_my_profile, como o PostgREST responderia. */
const mockDb = {
  read: { data: null as unknown, error: null as unknown },
  rpc: jest.fn(async (_name: string, _args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }> => ({ data: null, error: null })),
  reads: [] as { table: string; filter: [string, unknown] }[],
};
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
    rpc: (name: string, args: Record<string, unknown>) => mockDb.rpc(name, args),
  },
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));
const mockMe = { household_id: 'h1', user_id: 'ana', display_name: 'Ana', role: 'owner' as const };
jest.mock('@/lib/auth', () => ({
  signOut: jest.fn(),
  useAuth: () => ({ session: { user: { id: 'ana', email: 'ana@exemplo.com' } } }),
  useHousehold: () => ({ data: { household: { id: 'h1', name: 'Casa da Ana' }, members: [mockMe], me: mockMe, households: [] } }),
}));
jest.mock('@/data/household', () => ({ useSignOutQuestion: () => () => 'Deseja sair desta conta neste aparelho?' }));
jest.mock('@/ui/dialogs', () => ({ confirmAction: jest.fn(), notify: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
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

async function mount() {
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={queryClient}>
        <ThemeChoiceProvider>
          <SettingsScreen />
        </ThemeChoiceProvider>
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
  mockSystem.scheme = 'light';
  mockDb.read = { data: { birth_date: '1985-03-05', phone: '83999999999' }, error: null };
  mockDb.reads = [];
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

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  queryClient.clear();
  await AsyncStorage.clear();
});

describe('Configurações: perfil', () => {
  it('lê a própria linha do perfil e mostra o nome da casa, a data, o telefone com a máscara e o e-mail só para ler', async () => {
    const text = await mount();
    expect(mockDb.reads).toEqual([{ table: 'profiles', filter: ['user_id', 'ana'] }]);
    expect(field('Nome').props.value).toBe('Ana');
    expect(field('Data de nascimento').props.value).toBe('05/03/1985');
    expect(field('Telefone').props.value).toBe('(83) 99999-9999');
    expect(text).toContain(PROFILE_PRIVACY);
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

  it('sem a tabela (o app antes da migração): só o nome, com o aviso; o tema e a conta funcionam', async () => {
    mockDb.read = { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.profiles' in the schema cache" } };
    const text = await mount();
    expect(text).toContain(`NomeAna${PROFILE_NOT_READY}`);
    expect(renderer!.root.findAll((node) => node.props.label === 'Telefone')).toHaveLength(0);
    expect(renderer!.root.findAll((node) => node.props.title === 'Salvar')).toHaveLength(0);
    await act(async () => pressable('Escuro').props.onPress());
    expect(await AsyncStorage.getItem(THEME_CHOICE_KEY)).toBe('dark');
    expect(text).toContain('Sair da conta');
  });

  it('a leitura que falha mostra o erro só no perfil, com "Tentar de novo"', async () => {
    mockDb.read = { data: null, error: new Error('Sem internet agora.') };
    const text = await mount();
    expect(text).toContain('Sem internet agora.Tentar de novo');
    expect(text).toContain(`Tema${'Automático'}`);
    expect(text).toContain('Apagar minha conta');
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
  it('os termos com a data da versão, sair (com a pergunta de sempre) e apagar a conta', async () => {
    const text = await mount();
    expect(text).toContain(`${TERMS_TITLE}${termsVersionLabel()}Sair da contaApagar minha conta`);
    await act(async () => pressable(`${TERMS_TITLE}${termsVersionLabel()}`).props.onPress());
    expect(router.push).toHaveBeenCalledWith('/termos');
    await press('Sair da conta');
    expect(confirmAction).toHaveBeenCalledWith('Sair da conta', 'Deseja sair desta conta neste aparelho?', 'Sair', expect.any(Function));
    await press('Apagar minha conta');
    expect(router.push).toHaveBeenCalledWith('/apagar-conta');
  });
});

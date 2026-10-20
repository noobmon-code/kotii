import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClientProvider } from '@tanstack/react-query';
import { router } from 'expo-router';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { TERMS_ACCEPT_VERSION, TERMS_NOTICE_TEXT } from '@/domain/terms';
import { TermsNoticeCard } from '@/features/TermsNotice';
import { queryClient } from '@/lib/queryClient';

import { acceptTerms, acceptTermsAtSignIn, fetchAcceptedTerms } from '../terms';

// O aceite dos termos: o que vem do banco e do aparelho, o "Entendi" e a entrada pela tela de entrar. O banco
// é de mentira: as linhas de terms_acceptances desta pessoa e os erros combinados; cada aceite gravado entra
// nas linhas, como a accept_terms faz.

const ME = 'u1';
const OLD = '2026-10-19';

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockDb = {
  rows: [] as string[],
  tableError: null as unknown,
  rpcError: null as unknown,
  /** Os aceites que chegaram à accept_terms. */
  accepted: [] as string[],
  /** Respostas que demoram: a próxima leitura (com as linhas da hora em que foi feita) ou gravação espera. */
  selectGates: [] as Promise<void>[],
  rpcGates: [] as Promise<void>[],
};

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
// Os desenhos animados (reanimated) e o fundo não entram no que se confere aqui.
jest.mock('@/ui/art', () => ({ Mascot: () => null, Spot: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'u1' } }, loading: false }) }));
jest.mock('@/lib/queryClient', () => {
  const { QueryClient } = jest.requireActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) };
});
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: async (_column: string, userId: string) => {
          const response = mockDb.tableError
            ? { data: null, error: mockDb.tableError }
            : { data: table === 'terms_acceptances' && userId === 'u1' ? mockDb.rows.map((version) => ({ version })) : [], error: null };
          const gate = mockDb.selectGates.shift();
          if (gate) await gate;
          return response;
        },
      }),
    }),
    rpc: async (name: string, args: { p_version: string }) => {
      const gate = mockDb.rpcGates.shift();
      if (gate) await gate;
      if (mockDb.rpcError) return { data: null, error: mockDb.rpcError };
      if (name === 'accept_terms') {
        mockDb.accepted.push(args.p_version);
        if (!mockDb.rows.includes(args.p_version)) mockDb.rows.push(args.p_version);
      }
      return { data: null, error: null };
    },
  },
  unwrap: (result: { data: unknown; error: unknown }) => {
    if (result.error) throw result.error;
    return result.data;
  },
}));

// Como o PostgREST responde quando a migração ainda não chegou ao banco.
const NO_TABLE = { code: 'PGRST205', message: "Could not find the table 'public.terms_acceptances' in the schema cache" };
const NO_FUNCTION = { code: 'PGRST202', message: 'Could not find the function public.accept_terms(p_version) in the schema cache' };
const OFFLINE = { message: 'TypeError: Network request failed' };

/** O app chegou antes da migração: nem a tabela nem a função. */
function withoutMigration() {
  mockDb.tableError = NO_TABLE;
  mockDb.rpcError = NO_FUNCTION;
}

const deviceVersions = async () => JSON.parse((await AsyncStorage.getItem(`kotii:terms-accepted:${ME}`)) ?? '[]') as string[];

let renderer: ReactTestRenderer | undefined;

const textOf = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map(textOf).join(''));
/** O que tem esse texto e um toque. */
const pressable = (label: string) =>
  renderer!.root.findAll((node) => typeof node.props.onPress === 'function' && textOf(node) === label);

/** A leitura (aparelho e banco) termina e a tela se refaz. */
async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mountCard() {
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={queryClient}>
        <TermsNoticeCard />
      </QueryClientProvider>,
    );
  });
  await settle();
  return renderer!.toJSON() ? textOf(renderer!.root) : '';
}

const shown = () => (renderer!.toJSON() ? textOf(renderer!.root) : '');

beforeEach(async () => {
  mockDb.rows = [];
  mockDb.tableError = null;
  mockDb.rpcError = null;
  mockDb.accepted = [];
  mockDb.selectGates = [];
  mockDb.rpcGates = [];
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  queryClient.clear();
});

describe('as versões aceitas', () => {
  it('vêm do banco', async () => {
    mockDb.rows = [OLD];
    await expect(fetchAcceptedTerms(ME)).resolves.toEqual([OLD]);
    expect(mockDb.accepted).toEqual([]);
  });

  it('sem a tabela no banco (o app chegou antes da migração), vêm do aparelho', async () => {
    withoutMigration();
    await expect(fetchAcceptedTerms(ME)).resolves.toEqual([]);
    await acceptTerms(ME);
    await expect(fetchAcceptedTerms(ME)).resolves.toEqual([TERMS_ACCEPT_VERSION]);
  });

  it('o "Entendi" que ficou só no aparelho vai para o banco quando a migração chega', async () => {
    withoutMigration();
    await acceptTerms(ME);
    expect(mockDb.accepted).toEqual([]);
    mockDb.tableError = null;
    mockDb.rpcError = null;
    await expect(fetchAcceptedTerms(ME)).resolves.toEqual([TERMS_ACCEPT_VERSION]);
    expect(mockDb.accepted).toEqual([TERMS_ACCEPT_VERSION]);
    expect(mockDb.rows).toEqual([TERMS_ACCEPT_VERSION]);
    // Já no banco: não grava de novo.
    await fetchAcceptedTerms(ME);
    expect(mockDb.accepted).toEqual([TERMS_ACCEPT_VERSION]);
  });

  it('outro erro na leitura sobe (e o aviso não aparece)', async () => {
    mockDb.tableError = OFFLINE;
    await expect(fetchAcceptedTerms(ME)).rejects.toBe(OFFLINE);
  });

  it('o "Entendi" sem internet fica no aparelho, sem erro', async () => {
    mockDb.rpcError = OFFLINE;
    await expect(acceptTerms(ME)).resolves.toBeUndefined();
    expect(await deviceVersions()).toEqual([TERMS_ACCEPT_VERSION]);
  });
});

describe('a entrada pela tela de entrar', () => {
  it('a conta criada agora grava o aceite da versão atual', async () => {
    await acceptTermsAtSignIn(ME, true);
    expect(mockDb.accepted).toEqual([TERMS_ACCEPT_VERSION]);
  });

  it('a primeira entrada de uma conta sem aceite nenhum (o e-mail confirmado depois) também', async () => {
    await acceptTermsAtSignIn(ME, false);
    expect(mockDb.accepted).toEqual([TERMS_ACCEPT_VERSION]);
  });

  it('quem aceitou uma versão anterior não grava ao entrar: vê o aviso de que os termos mudaram', async () => {
    mockDb.rows = [OLD];
    await acceptTermsAtSignIn(ME, false);
    expect(mockDb.accepted).toEqual([]);
    expect(await mountCard()).toContain(TERMS_NOTICE_TEXT.mudou.title);
  });

  it('nunca atrapalha a entrada: sem internet, nada sobe', async () => {
    mockDb.tableError = OFFLINE;
    mockDb.rpcError = OFFLINE;
    await expect(acceptTermsAtSignIn(ME, false)).resolves.toBeUndefined();
    await expect(acceptTermsAtSignIn(ME, true)).resolves.toBeUndefined();
  });

  it.each([
    ['a primeira entrada de uma conta sem aceite', false],
    ['a conta criada agora', true],
  ])('%s: a tela Hoje que leu antes da gravação não mostra o aviso para tirá-lo logo depois', async (_label, created) => {
    // A tela Hoje abre durante a entrada: a leitura dela foi feita sem aceite nenhum e ainda não voltou.
    let releaseRead!: () => void;
    mockDb.selectGates.push(new Promise<void>((resolve) => (releaseRead = resolve)));
    expect(await mountCard()).toBe('');
    // A gravação demora; a leitura da tela Hoje volta antes dela, sem o aceite.
    let releaseRecord!: () => void;
    mockDb.rpcGates.push(new Promise<void>((resolve) => (releaseRecord = resolve)));
    const signIn = acceptTermsAtSignIn(ME, created);
    await settle();
    releaseRead();
    await settle();
    expect(shown()).toBe('');
    releaseRecord();
    await act(async () => signIn);
    await settle();
    expect(shown()).toBe('');
    expect(mockDb.accepted).toEqual([TERMS_ACCEPT_VERSION]);
  });

  it('sem a migração, o aceite da conta criada fica no aparelho e o aviso não aparece', async () => {
    withoutMigration();
    await acceptTermsAtSignIn(ME, true);
    expect(await mountCard()).toBe('');
  });
});

describe('o aviso da tela Hoje', () => {
  it('sem aceite nenhum: "Leia os termos", com "Ler os termos" e "Entendi"', async () => {
    const page = await mountCard();
    expect(page).toContain(TERMS_NOTICE_TEXT.primeira.title);
    expect(page).toContain(TERMS_NOTICE_TEXT.primeira.message);
    const [read] = pressable('Ler os termos');
    await act(async () => read.props.onPress());
    expect(router.push).toHaveBeenCalledWith('/termos');
    // Ler não é aceitar: o aviso continua.
    expect(shown()).toContain(TERMS_NOTICE_TEXT.primeira.title);
  });

  it('com o aceite de uma versão anterior: "Os termos mudaram"', async () => {
    mockDb.rows = [OLD];
    expect(await mountCard()).toContain(TERMS_NOTICE_TEXT.mudou.title);
  });

  it('"Entendi" tira o aviso na hora e grava o aceite; ele não volta para esta versão', async () => {
    await mountCard();
    const [ok] = pressable('Entendi');
    await act(async () => ok.props.onPress());
    await settle();
    expect(shown()).toBe('');
    expect(mockDb.accepted).toEqual([TERMS_ACCEPT_VERSION]);
    // Aberto de novo, lido do banco.
    await act(async () => renderer?.unmount());
    queryClient.clear();
    expect(await mountCard()).toBe('');
  });

  it('com o aceite desta versão, nada', async () => {
    mockDb.rows = [OLD, TERMS_ACCEPT_VERSION];
    expect(await mountCard()).toBe('');
  });

  it('sem a migração: o aviso aparece, some no "Entendi" e fica guardado no aparelho', async () => {
    withoutMigration();
    expect(await mountCard()).toContain(TERMS_NOTICE_TEXT.primeira.title);
    const [ok] = pressable('Entendi');
    await act(async () => ok.props.onPress());
    await settle();
    expect(shown()).toBe('');
    expect(await deviceVersions()).toEqual([TERMS_ACCEPT_VERSION]);
    await act(async () => renderer?.unmount());
    queryClient.clear();
    expect(await mountCard()).toBe('');
  });

  it('erro na leitura (sem internet): sem aviso, nunca uma trava', async () => {
    mockDb.tableError = OFFLINE;
    expect(await mountCard()).toBe('');
  });
});

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Linking } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import StoreNamesModerationScreen from '@/app/moderacao';
import { MODERATION_EMPTY, MODERATION_ONLY, type StoreNameReview } from '@/domain/storeModeration';
import { notify } from '@/ui/dialogs';

// A tela da moderação dos nomes dos mercados com o banco de mentira: quem não modera não vê nada (e a lista nem é
// pedida), as abas, o que cada CNPJ mostra, e as decisões (o nome padrão, ficar com o da nota, consultar de novo).

type Rpc = (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
const mockDb = {
  moderator: true as boolean | 'missing',
  rows: [] as StoreNameReview[],
  calls: [] as { name: string; args?: Record<string, unknown> }[],
  /** A resposta de uma decisão (review_store_name, lookup_store_name_again). */
  decision: { data: null, error: null } as { data: unknown; error: unknown },
};
jest.mock('@/lib/supabase', () => {
  const rpc: Rpc = async (name, args) => {
    mockDb.calls.push({ name, args });
    if (name === 'is_moderator') {
      return mockDb.moderator === 'missing'
        ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.is_moderator without parameters in the schema cache' } }
        : { data: mockDb.moderator, error: null };
    }
    if (name === 'store_names_for_review') return { data: mockDb.rows, error: null };
    return mockDb.decision;
  };
  return {
    supabase: { rpc },
    errorMessage: (error: unknown) => String((error as { message?: string })?.message ?? error),
  };
});
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'dono' } } }) }));
jest.mock('@/ui/dialogs', () => ({ notify: jest.fn() }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));

const CBD = 'COMPANHIA BRASILEIRA DE DISTRIBUICAO';
const row = (cnpj: string, patch: Partial<StoreNameReview> = {}): StoreNameReview => ({
  cnpj,
  name: null,
  source: null,
  reviewed_at: null,
  receita_status: 'sem_fantasia',
  receita_name: null,
  receita_trade_name: null,
  receita_activity: null,
  note_name: null,
  address: null,
  households: 1,
  nicknames: [],
  ...patch,
});

let client: QueryClient;
let renderer: ReactTestRenderer | undefined;

const rawText = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map(rawText).join(''));
const page = () => rawText(renderer!.root);
const buttons = (title: string) => renderer!.root.findAll((node) => node.props.title === title && typeof node.props.onPress === 'function');
const field = () => renderer!.root.findAll((node) => node.props.label === 'Nome padrão' && typeof node.props.onChangeText === 'function')[0];
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
};
async function mount() {
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <StoreNamesModerationScreen />
      </QueryClientProvider>,
    );
  });
  await settle();
}
async function press(title: string, index = 0) {
  const target = buttons(title)[index];
  expect(target).toBeDefined();
  await act(async () => target.props.onPress());
  await settle();
}
/** A aba com esse começo de rótulo ("Com nome (1)"). */
async function openTab(label: string) {
  const tab = renderer!.root.findAll((node) => typeof node.props.onPress === 'function' && rawText(node).startsWith(label))[0];
  await act(async () => tab.props.onPress());
  await settle();
}
const decisions = () => mockDb.calls.filter((call) => call.name !== 'is_moderator' && call.name !== 'store_names_for_review');

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  mockDb.moderator = true;
  mockDb.calls = [];
  mockDb.decision = { data: null, error: null };
  mockDb.rows = [
    row('47508411000156', {
      note_name: CBD,
      address: 'Av. Epitácio Pessoa, 4200',
      households: 2,
      nicknames: [{ name: 'Pão de Açúcar', households: 1 }],
      receita_name: CBD,
    }),
    row('06057223000171', { name: 'ASSAI ATACADISTA', source: 'receita', receita_status: 'ok', receita_trade_name: 'ASSAI ATACADISTA' }),
    row('09143892000154', { receita_status: 'pendente', note_name: 'SUPERMERCADOS MANAIRA LTDA' }),
  ];
  jest.mocked(notify).mockReset();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  client.clear();
  jest.restoreAllMocks();
});

describe('a moderação dos nomes dos mercados', () => {
  it('quem não modera (ou o banco sem a função) não vê nada, e a lista nem é pedida', async () => {
    for (const moderator of [false, 'missing'] as const) {
      mockDb.moderator = moderator;
      mockDb.calls = [];
      client.clear();
      await mount();
      expect(page()).toContain(MODERATION_ONLY);
      expect(mockDb.calls.map((call) => call.name)).toEqual(['is_moderator']);
      await act(async () => renderer?.unmount());
    }
  });

  it('as abas com quantos há; o CNPJ a revisar com a nota, o endereço, a Receita e os apelidos, e o campo com o apelido', async () => {
    await mount();
    const text = page();
    expect(text).toContain('Para revisar (1)');
    expect(text).toContain('Na Receita (1)');
    expect(text).toContain('Com nome (1)');
    expect(text).toContain(CBD);
    expect(text).toContain('CNPJ 47.508.411/0001-56 · em 2 casas');
    expect(text).toContain('Av. Epitácio Pessoa, 4200');
    expect(text).toContain('Sem nome fantasia na Receita.');
    expect(text).toContain('Apelidos nas casas: Pão de Açúcar');
    // A razão social é o próprio nome da nota: não se repete.
    expect(text).not.toContain('Razão social');
    expect(field().props.value).toBe('Pão de Açúcar');
    expect(text).not.toContain('ASSAI');
  });

  it('salva o nome limpo; a lista e o que mostra o nome do mercado (também os preços de outras casas) são buscados de novo', async () => {
    for (const key of [['stores'], ['receipts', 'history'], ['sharedPrices']]) client.setQueryData(key, []);
    await mount();
    await act(async () => field().props.onChangeText('  Pão de   Açúcar '));
    await press('Salvar o nome padrão');
    expect(decisions()).toEqual([{ name: 'review_store_name', args: { p_cnpj: '47508411000156', p_name: 'Pão de Açúcar' } }]);
    expect(mockDb.calls.filter((call) => call.name === 'store_names_for_review')).toHaveLength(2);
    for (const key of [['stores'], ['receipts', 'history'], ['sharedPrices']]) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  });

  it('nome vazio ou longo avisa e não vai ao banco; "Ficar com o nome da nota" manda nenhum nome', async () => {
    await mount();
    await act(async () => field().props.onChangeText('   '));
    await press('Salvar o nome padrão');
    expect(page()).toContain('Escreva o nome do mercado.');
    await act(async () => field().props.onChangeText('x'.repeat(61)));
    await press('Salvar o nome padrão');
    expect(page()).toContain('Use até 60 letras.');
    expect(decisions()).toEqual([]);
    await press('Ficar com o nome da nota');
    expect(decisions()).toEqual([{ name: 'review_store_name', args: { p_cnpj: '47508411000156', p_name: null } }]);
  });

  it('a recusa do banco aparece em palavras', async () => {
    mockDb.decision = { data: null, error: { code: '42501', message: 'Só a moderação muda o nome dos mercados.' } };
    await mount();
    await press('Salvar o nome padrão');
    expect(notify).toHaveBeenCalledWith('Não deu para salvar o nome', 'Só a moderação muda o nome dos mercados.');
  });

  it('consultar a Receita de novo, e os links para achar a loja', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await mount();
    await press('Consultar a Receita de novo');
    expect(decisions()).toEqual([{ name: 'lookup_store_name_again', args: { p_cnpj: '47508411000156' } }]);
    await press('Ver no mapa');
    expect(open).toHaveBeenCalledWith(
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${CBD}, Av. Epitácio Pessoa, 4200`)}`,
    );
    await press('Buscar o CNPJ');
    expect(open).toHaveBeenLastCalledWith(`https://www.google.com/search?q=${encodeURIComponent('CNPJ 47.508.411/0001-56')}`);
  });

  it('na aba "Com nome", o nome e de onde veio; o campo só abre em "Mudar o nome padrão"', async () => {
    await mount();
    await openTab('Com nome');
    expect(page()).toContain('Nome padrão: ASSAI ATACADISTA (da Receita)');
    expect(field()).toBeUndefined();
    // Com o nome fantasia, consultar de novo não serve.
    expect(buttons('Consultar a Receita de novo')).toEqual([]);
    await press('Mudar o nome padrão');
    expect(field().props.value).toBe('ASSAI ATACADISTA');
    await act(async () => field().props.onChangeText('Assaí'));
    await press('Salvar o nome padrão');
    expect(decisions()).toEqual([{ name: 'review_store_name', args: { p_cnpj: '06057223000171', p_name: 'Assaí' } }]);
  });

  it('a aba vazia diz que não há nada', async () => {
    mockDb.rows = [];
    await mount();
    expect(page()).toContain(MODERATION_EMPTY.revisar);
  });
});

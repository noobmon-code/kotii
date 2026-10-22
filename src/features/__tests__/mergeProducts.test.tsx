import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { MERGE_REFRESHES } from '@/data/productMerge';
import { MERGE_NO_ANSWER, MERGE_RENAMED, type DistinctPair } from '@/domain/productMerge';
import type { LatestPrice, Product } from '@/lib/types';
import { confirmAction, notify } from '@/ui/dialogs';
import { CategoryIcon } from '@/ui/primitives';

import { MergeProductsModal } from '../MergeProductsModal';
import { MergeSuggestionsCard } from '../MergeSuggestionsCard';

// A confirmação de juntar e o cartão "Parecem o mesmo produto" de verdade, com as buscas trocadas por respostas
// prontas: o que se confere aqui é o que a pessoa lê e o que cada toque manda fazer. A leitura da confirmação
// (fetchMergeFacts) é um banco de mentira, e a busca dela é a de verdade, dentro de um QueryClient.

interface Query {
  data: unknown;
  isPending: boolean;
  error: unknown;
  refetch: jest.Mock;
}

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockQueries: Record<string, Query> = {};
/** O que o banco tem agora: é o que a leitura da confirmação devolve, na hora em que responde. */
const mockBank: {
  products: Product[];
  counts: Record<string, number>;
  prices: LatestPrice[];
  stores: { id: string; name: string }[];
  /** Os produtos com item aberto na despensa. */
  pantry: string[];
  /** Os produtos com item numa lista aberta. */
  list: string[];
  /** A leitura falha com este erro. */
  error: Error | null;
  /** A leitura fica esperando `release`. */
  hold: boolean;
  release: () => void;
  /** Os pares que a confirmação pediu, na ordem. */
  asked: [string, string][];
} = { products: [], counts: {}, prices: [], stores: [], pantry: [], list: [], error: null, hold: false, release: () => undefined, asked: [] };
/** O que o banco responde ao juntar: o que passou, ou um erro. Com `hold`, a resposta fica esperando `finish`. */
const mockMerge: { calls: unknown[]; moved: object; error: object | null; hold: boolean; finish: () => void } = {
  calls: [],
  moved: {},
  error: null,
  hold: false,
  finish: () => undefined,
};
const mockMarked: unknown[] = [];

// A confirmação não lê as listas da casa (itens das listas, últimos preços, mercados, despensa): este dublê só
// tem os produtos, e ela quebraria aqui se voltasse a chamar as outras buscas.
jest.mock('@/data/market', () => ({ useProducts: () => mockQueries.products }));
jest.mock('@/data/productMerge', () => ({
  ...jest.requireActual<typeof import('@/data/productMerge')>('@/data/productMerge'),
  fetchMergeFacts: async (firstId: string, secondId: string) => {
    mockBank.asked.push([firstId, secondId]);
    if (mockBank.hold) {
      await new Promise<void>((resolve) => {
        mockBank.release = resolve;
      });
    }
    if (mockBank.error) throw mockBank.error;
    const { productFacts } = jest.requireActual<typeof import('@/domain/productMerge')>('@/domain/productMerge');
    const ids = [firstId, secondId];
    const source = {
      purchases: mockBank.counts,
      prices: mockBank.prices,
      stores: mockBank.stores,
      pantry: mockBank.pantry.map((product_id) => ({ product_id })),
      listItems: mockBank.list.map((product_id) => ({ product_id })),
    };
    return {
      products: Object.fromEntries(mockBank.products.filter((product) => ids.includes(product.id)).map((product) => [product.id, product])),
      facts: Object.fromEntries(ids.map((id) => [id, productFacts(id, source)])),
    };
  },
  useDistinctPairs: () => mockQueries.distinct,
  // Como a busca de verdade: sem produtos, não busca nada.
  usePurchaseCounts: (ids: string[]) => (ids.length ? mockQueries.counts : { data: undefined, isPending: true, error: null, refetch: jest.fn() }),
  useMarkDistinct: () => ({ isPending: false, variables: undefined, mutate: (pair: unknown) => mockMarked.push(pair) }),
  useMergeProducts: () => ({
    isPending: false,
    mutate: (input: unknown, handlers: { onSuccess: (moved: object) => void; onError: (error: object) => void; onSettled: () => void }) => {
      mockMerge.calls.push(input);
      mockMerge.finish = () => {
        if (mockMerge.error) handlers.onError(mockMerge.error);
        else handlers.onSuccess(mockMerge.moved);
        handlers.onSettled();
      };
      if (!mockMerge.hold) mockMerge.finish();
    },
  }),
}));
jest.mock('@/lib/supabase', () => ({ errorMessage: (error: { message?: string }) => error?.message ?? 'Algo deu errado. Tente novamente.' }));
jest.mock('@/ui/dialogs', () => ({ confirmAction: jest.fn(), notify: jest.fn() }));
// Os desenhos animados (reanimated), o fundo, as imagens e os ícones (um caractere da fonte de ícones, que
// entraria no meio dos textos) não entram no que se confere aqui.
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));

const loaded = (data: unknown): Query => ({ data, isPending: false, error: null, refetch: jest.fn() });
const onTheWay = (): Query => ({ ...loaded(undefined), isPending: true });
const failed = (): Query => ({ ...loaded(undefined), error: new Error('Sem internet.') });

const product = (id: string, name: string, category = 'graos'): Product => ({ id, name, category, shelf_life_days: null });
const price = (product_id: string, store_id: string, unit_price: number, day: string, unit: LatestPrice['unit'] = 'un'): LatestPrice => ({
  product_id,
  store_id,
  unit,
  unit_price,
  purchased_at: `${new Date().getFullYear()}-${day}T12:00:00`,
});

const ARROZ = product('p-arroz', 'Arroz 5kg');
const ARROZ_TJ = product('p-arroz-tj', 'Arroz Tio João 5 kg');
const ARROZ_1KG = product('p-arroz-1kg', 'Arroz Tio João 1kg');
const LIMAO = product('p-limao', 'Limão', 'hortifruti');
const LIMOES = product('p-limoes', 'Limões', 'hortifruti');
const BANANA = product('p-banana', 'Banana', 'hortifruti');
const BANANAS = product('p-bananas', 'Bananas', 'hortifruti');
const ACUCAR = product('p-acucar', 'Açúcar', 'doces');
const ACUCAR2 = product('p-acucar2', 'acucar', 'doces');
const FEIJAO = product('p-feijao', 'Feijão carioca');
const ALL = [ARROZ, ARROZ_TJ, ARROZ_1KG, LIMAO, LIMOES, BANANA, BANANAS, ACUCAR, ACUCAR2, FEIJAO];

let renderer: ReactTestRenderer | undefined;
let client: QueryClient;
let onClose: jest.Mock<() => void>;
let onMerged: jest.Mock<(keptId: string) => void>;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
/** Deixa a busca da confirmação andar: a resposta chega e a tela se refaz alguns passos depois. */
async function settle() {
  for (let step = 0; step < 3; step += 1) {
    await act(async () => {
      await flush();
    });
  }
}

async function render(element: React.ReactElement) {
  await act(async () => {
    renderer = create(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
    await flush();
  });
  await settle();
}

/** A leitura que esperava responde, com o que o banco tem agora. */
async function answer() {
  mockBank.hold = false;
  await act(async () => mockBank.release());
  await settle();
}

const textOf = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map(textOf).join(''));
/** Tudo o que a tela mostra, na ordem: cada texto como está na tela. */
const screen = () =>
  renderer!.toJSON() ? renderer!.root.findAll((node) => (node.type as unknown) === 'Text' && typeof node.children[0] === 'string').map(textOf) : [];
const pressables = (role: string) => renderer!.root.findAll((node) => node.props.accessibilityRole === role && typeof node.props.onPress === 'function');
const button = (label: string, at = 0) => pressables('button').filter((node) => textOf(node) === label)[at];

async function press(node: ReactTestInstance) {
  await act(async () => {
    node.props.onPress();
    await flush();
  });
  await settle();
}

/** O que a busca da confirmação tem guardado na memória do app. */
const kept = () => client.getQueryCache().findAll({ queryKey: ['mergeFacts'] });

/** O diálogo de confirmação que a tela abriu por último: [título, mensagem, botão, o que roda ao confirmar]. */
const lastConfirm = () => jest.mocked(confirmAction).mock.calls.at(-1)!;

beforeEach(() => {
  jest.clearAllMocks();
  onClose = jest.fn<() => void>();
  onMerged = jest.fn<(keptId: string) => void>();
  mockMerge.calls = [];
  mockMerge.moved = { purchases: 2, pantry: 1, list: 1 };
  mockMerge.error = null;
  mockMerge.hold = false;
  mockMarked.length = 0;
  // Sem a segunda tentativa, que só faria o teste esperar.
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const counts = {
    [ARROZ.id]: 2,
    [ARROZ_TJ.id]: 12,
    [ARROZ_1KG.id]: 0,
    [LIMAO.id]: 1,
    [LIMOES.id]: 1,
    [BANANA.id]: 6,
    [BANANAS.id]: 1,
    [ACUCAR.id]: 0,
    [ACUCAR2.id]: 1,
    [FEIJAO.id]: 3,
  };
  Object.assign(mockQueries, { products: loaded(ALL), distinct: loaded([] as DistinctPair[]), counts: loaded(counts) });
  Object.assign(mockBank, {
    products: ALL,
    counts,
    prices: [price(ARROZ_TJ.id, 's-assai', 25.9, '10-10'), price(ARROZ_TJ.id, 's-bom', 27.5, '09-20'), price(ARROZ.id, 's-bom', 24.9, '10-05')],
    stores: [
      { id: 's-assai', name: 'Assaí' },
      { id: 's-bom', name: 'Mercado Bom' },
    ],
    pantry: [ARROZ.id],
    list: [ARROZ.id],
    error: null,
    hold: false,
    release: () => undefined,
    asked: [],
  });
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  client.clear();
  onlineManager.setOnline(true);
});

describe('confirmação de juntar', () => {
  const open = (opened = ARROZ, other = ARROZ_TJ) => render(<MergeProductsModal opened={opened} other={other} onClose={onClose} onMerged={onMerged} />);
  const SUMMARY = 'As 2 compras, o que está na despensa e na lista de "Arroz 5kg" passam para "Arroz Tio João 5 kg". Não dá para desfazer.';

  it('mostra os dois com o que o app sabe de cada um, e fica por padrão o de mais compras', async () => {
    await open();
    const [first, second] = pressables('radio');
    expect(textOf(first)).toBe('Arroz 5kg2 compras · último preço R$ 24,90 em 5 out (Mercado Bom) · na despensa · na listaDeixa de existir');
    expect(textOf(second)).toBe('Arroz Tio João 5 kg12 compras · último preço R$ 25,90 em 10 out (Assaí)Este nome fica');
    // Marcado, para o leitor de tela: no celular pelo estado, na web pelo aria-checked (que lá é o que chega).
    expect(first.props.accessibilityState).toEqual({ checked: false, disabled: false });
    expect(second.props.accessibilityState).toEqual({ checked: true, disabled: false });
    expect([first.props['aria-checked'], second.props['aria-checked']]).toEqual([false, true]);
    // O rótulo troca o conteúdo do cartão na leitura: leva junto o que acontece com cada nome.
    expect([first.props.accessibilityLabel, second.props.accessibilityLabel]).toEqual([
      'Arroz 5kg. 2 compras · último preço R$ 24,90 em 5 out (Mercado Bom) · na despensa · na lista. Deixa de existir.',
      'Arroz Tio João 5 kg. 12 compras · último preço R$ 25,90 em 10 out (Assaí). Este nome fica.',
    ]);
    expect(screen()).toContain(SUMMARY);
    // Os mesmos tamanhos nos dois nomes, os dois comprados por unidade e na mesma categoria: nenhum aviso.
    expect(screen().join(' ')).not.toContain('Juntar mistura os preços');
    expect(screen().join(' ')).not.toContain('categorias diferentes');
  });

  it('o botão vermelho pede a confirmação dizendo o que acontece e que não dá para desfazer; só então junta', async () => {
    await open();
    await press(button('Juntar produtos'));
    expect(lastConfirm().slice(0, 3)).toEqual(['Juntar produtos', SUMMARY, 'Juntar']);
    expect(mockMerge.calls).toEqual([]);
    await act(async () => lastConfirm()[3]());
    expect(mockMerge.calls).toEqual([{ keepId: ARROZ_TJ.id, mergeId: ARROZ.id, keepName: ARROZ_TJ.name, mergeName: ARROZ.name }]);
    expect(jest.mocked(notify).mock.calls).toEqual([
      ['Agora é um produto só', '"Arroz 5kg" passou a ser "Arroz Tio João 5 kg". Foram junto 2 compras, 1 item da despensa e 1 item da lista.'],
    ]);
    expect(onMerged.mock.calls).toEqual([[ARROZ_TJ.id]]);
  });

  it('a pessoa escolhe o outro nome: a frase e o que vai para o banco mudam juntos', async () => {
    await open();
    await press(pressables('radio')[0]);
    expect(pressables('radio').map((node) => node.props.accessibilityState.checked)).toEqual([true, false]);
    expect(pressables('radio').map((node) => node.props['aria-checked'])).toEqual([true, false]);
    expect(pressables('radio')[0].props.accessibilityLabel).toMatch(/^Arroz 5kg\. .* Este nome fica\.$/);
    const summary = 'As 12 compras de "Arroz Tio João 5 kg" passam para "Arroz 5kg". Não dá para desfazer.';
    expect(screen()).toContain(summary);
    await press(button('Juntar produtos'));
    expect(lastConfirm()[1]).toBe(summary);
    await act(async () => lastConfirm()[3]());
    expect(mockMerge.calls).toEqual([{ keepId: ARROZ.id, mergeId: ARROZ_TJ.id, keepName: ARROZ.name, mergeName: ARROZ_TJ.name }]);
    expect(onMerged.mock.calls).toEqual([[ARROZ.id]]);
  });

  it('no empate de compras fica o produto de onde a pessoa partiu', async () => {
    await open(LIMOES, LIMAO);
    expect(pressables('radio').map((node) => [textOf(node), node.props.accessibilityState.checked])).toEqual([
      ['Limões1 compraEste nome fica', true],
      ['Limão1 compraDeixa de existir', false],
    ]);
    expect(screen()).toContain('A compra de "Limão" passa para "Limões". Não dá para desfazer.');
  });

  it('nomes com tamanhos diferentes: o aviso vem antes do botão, e ainda dá para juntar', async () => {
    await open(ARROZ_TJ, ARROZ_1KG);
    const shown = screen();
    const warning = 'Parecem tamanhos diferentes (5 kg e 1 kg). Juntar mistura os preços dos dois no histórico.';
    expect(shown).toContain(warning);
    // O título da tela também é "Juntar produtos": o botão é o último.
    expect(shown.indexOf(warning)).toBeLessThan(shown.lastIndexOf('Juntar produtos'));
    expect(shown).toContain('"Arroz Tio João 1kg" deixa de existir e fica só "Arroz Tio João 5 kg". Não dá para desfazer.');
    await press(button('Juntar produtos'));
    await act(async () => lastConfirm()[3]());
    expect(mockMerge.calls).toEqual([{ keepId: ARROZ_TJ.id, mergeId: ARROZ_1KG.id, keepName: ARROZ_TJ.name, mergeName: ARROZ_1KG.name }]);
  });

  it('um comprado por peso e o outro por unidade: aviso', async () => {
    mockBank.prices = [price(BANANA.id, 's-bom', 5.9, '10-01', 'kg'), price(BANANAS.id, 's-assai', 0.8, '10-02')];
    await open(BANANA, BANANAS);
    // "Bananas" tem uma compra só: a frase fala do preço, não de "as compras".
    expect(screen()).toContain('O preço de "Banana" é por peso, e o de "Bananas", por unidade. Juntar mistura os preços dos dois no histórico.');
  });

  it('categorias diferentes: o aviso diz qual fica (a do nome que fica) e que as compras dos meses passados mudam junto', async () => {
    mockBank.products = mockBank.products.map((item) => (item.id === ARROZ.id ? { ...item, category: 'outros' } : item));
    await open();
    expect(screen()).toContain(
      'Os dois estão em categorias diferentes: "Arroz Tio João 5 kg" em Grãos, massas e cereais, "Arroz 5kg" em Outros. ' +
        'Fica Grãos, massas e cereais: as compras de "Arroz 5kg", também as dos meses passados, passam para essa categoria no Mercado do mês e em Finanças.',
    );
    // Escolher o outro nome troca a categoria que fica, e o aviso diz isso.
    await press(pressables('radio')[0]);
    expect(screen()).toContain(
      'Os dois estão em categorias diferentes: "Arroz 5kg" em Outros, "Arroz Tio João 5 kg" em Grãos, massas e cereais. ' +
        'Fica Outros: as compras de "Arroz Tio João 5 kg", também as dos meses passados, passam para essa categoria no Mercado do mês e em Finanças.',
    );
    // Ainda dá para juntar.
    await press(button('Juntar produtos'));
    await act(async () => lastConfirm()[3]());
    expect(mockMerge.calls).toEqual([{ keepId: ARROZ.id, mergeId: ARROZ_TJ.id, keepName: ARROZ.name, mergeName: ARROZ_TJ.name }]);
  });

  it('a mesma quantidade em outra unidade não avisa; tamanho lido com dúvida pede para conferir', async () => {
    const [kg, g] = [product('p-kg', 'Arroz 1kg'), product('p-g', 'Arroz 1000 g')];
    const [doubtful, sure] = [product('p-a', 'Agua 1 5l', 'bebidas'), product('p-b', 'Água 5L', 'bebidas')];
    mockBank.products = [kg, g, doubtful, sure];
    await open(kg, g);
    expect(pressables('radio')).toHaveLength(2);
    expect(screen().join(' ')).not.toContain('Juntar mistura os preços');
    await act(async () => renderer?.unmount());
    await open(doubtful, sure);
    expect(screen()).toContain('Confira se são do mesmo tamanho. Juntar mistura os preços dos dois no histórico.');
  });

  it('banco ainda sem a função: avisa que ainda não está disponível e a tela continua aberta', async () => {
    mockMerge.error = { code: 'PGRST202', message: 'Could not find the function public.merge_products(p_keep, p_merge) in the schema cache' };
    await open();
    await press(button('Juntar produtos'));
    await act(async () => lastConfirm()[3]());
    expect(jest.mocked(notify).mock.calls).toEqual([
      ['Ainda não está disponível', 'Juntar produtos ainda está sendo ativado no Kotii. Tente de novo mais tarde.'],
    ]);
    expect(onMerged).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen()).toContain(SUMMARY);
  });

  // Antes a confirmação ficava aberta num par que não existe mais, com o botão vermelho pronto para falhar de novo.
  it('produto que outra pessoa já juntou: avisa e fecha a confirmação', async () => {
    mockMerge.error = { code: 'P0002', message: 'product not found' };
    await open();
    await press(button('Juntar produtos'));
    await act(async () => lastConfirm()[3]());
    expect(jest.mocked(notify).mock.calls).toEqual([['Erro', 'Um destes produtos não existe mais: alguém da casa já juntou ou apagou.']]);
    expect(onMerged).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('produto que sumiu, com a resposta demorando: fecha mesmo assim (a tela ainda estava travada pelo pedido)', async () => {
    mockMerge.error = { code: 'P0002', message: 'product not found' };
    mockMerge.hold = true;
    await open();
    await press(button('Juntar produtos'));
    await act(async () => lastConfirm()[3]());
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => mockMerge.finish());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Dois toques no botão vermelho abrem dois diálogos (no iPhone os dois ficam na tela): confirmar os dois
  // mandava dois pedidos, e o segundo respondia "produto não existe mais" depois de o primeiro ter juntado.
  it('confirmar duas vezes manda um pedido só', async () => {
    mockMerge.hold = true;
    await open();
    await press(button('Juntar produtos'));
    await press(button('Juntar produtos'));
    const [first, second] = jest.mocked(confirmAction).mock.calls.map((call) => call[3]);
    await act(async () => first());
    await act(async () => second());
    expect(mockMerge.calls).toEqual([{ keepId: ARROZ_TJ.id, mergeId: ARROZ.id, keepName: ARROZ_TJ.name, mergeName: ARROZ.name }]);
    await act(async () => mockMerge.finish());
    expect(onMerged.mock.calls).toEqual([[ARROZ_TJ.id]]);
    expect(notify).toHaveBeenCalledTimes(1);
    // Depois de juntar, o segundo diálogo ainda pode estar na tela: confirmar nele não manda mais nada.
    await act(async () => second());
    expect(mockMerge.calls).toHaveLength(1);
  });

  it('depois de um erro dá para mandar de novo', async () => {
    mockMerge.error = { message: 'TypeError: Network request failed' };
    await open();
    await press(button('Juntar produtos'));
    await act(async () => lastConfirm()[3]());
    mockMerge.error = null;
    await press(button('Juntar produtos'));
    await act(async () => lastConfirm()[3]());
    expect(mockMerge.calls).toHaveLength(2);
    expect(onMerged.mock.calls).toEqual([[ARROZ_TJ.id]]);
  });

  it('pedido sem resposta: avisa que pode ter juntado, e a confirmação volta a poder ser fechada', async () => {
    mockMerge.error = new Error(MERGE_NO_ANSWER);
    mockMerge.hold = true;
    await open();
    await press(button('Juntar produtos'));
    await act(async () => lastConfirm()[3]());
    await press(button('Cancelar'));
    expect(onClose).not.toHaveBeenCalled();
    // O pedido foi cortado (quem corta é a busca; aqui ela é um dublê).
    await act(async () => mockMerge.finish());
    expect(jest.mocked(notify).mock.calls).toEqual([
      ['Sem resposta', 'A resposta não chegou, e pode ser que os produtos já tenham sido juntados. Confira os produtos antes de tentar de novo.'],
    ]);
    expect(onMerged).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    // A confirmação leu os dois de novo: o banco pode ter juntado. Aqui não juntou, e ela continua como estava.
    await settle();
    expect(mockBank.asked).toHaveLength(2);
    expect(button('Juntar produtos')).toBeDefined();
    await press(button('Cancelar'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('pedido sem resposta, e o banco já tinha juntado: a confirmação lê de novo, avisa que o produto não existe mais e sai', async () => {
    mockMerge.error = new Error(MERGE_NO_ANSWER);
    await open();
    await press(button('Juntar produtos'));
    // O banco juntou, e foi a resposta que se perdeu.
    mockBank.products = ALL.filter((item) => item.id !== ARROZ.id);
    await act(async () => lastConfirm()[3]());
    await settle();
    expect(mockBank.asked).toHaveLength(2);
    expect(jest.mocked(notify).mock.calls).toEqual([
      ['Sem resposta', MERGE_NO_ANSWER],
      ['Erro', 'Um destes produtos não existe mais: alguém da casa já juntou ou apagou.'],
    ]);
    expect(onMerged).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('enquanto a leitura não chega, não há o que confirmar; se falhou, dá para tentar de novo', async () => {
    mockBank.hold = true;
    await open();
    expect(button('Juntar produtos')).toBeUndefined();
    expect(pressables('radio')).toHaveLength(0);
    expect(screen()).toEqual(['Juntar produtos']);
    await answer();
    expect(screen()).toContain(SUMMARY);
    expect(button('Juntar produtos')).toBeDefined();
    await act(async () => renderer?.unmount());

    mockBank.error = new Error('Sem internet.');
    await open();
    expect(screen()).toContain('Sem internet.');
    expect(button('Juntar produtos')).toBeUndefined();
    expect(pressables('radio')).toHaveLength(0);
    // "Tentar de novo" lê de novo; enquanto a resposta não chega, o erro sai da tela e ainda não há o que confirmar.
    mockBank.asked = [];
    mockBank.error = null;
    mockBank.hold = true;
    await press(button('Tentar de novo'));
    expect(mockBank.asked).toEqual([[ARROZ.id, ARROZ_TJ.id]]);
    expect(screen()).toEqual(['Juntar produtos']);
    await answer();
    expect(screen()).toContain(SUMMARY);
    expect(button('Juntar produtos')).toBeDefined();
  });

  it('ao abrir, uma leitura só, e só dos dois produtos; fechada a confirmação, nada fica guardado e a próxima lê de novo', async () => {
    await open();
    expect(mockBank.asked).toEqual([[ARROZ.id, ARROZ_TJ.id]]);
    expect(kept()).toHaveLength(1);
    await act(async () => renderer?.unmount());
    await settle();
    expect(kept()).toHaveLength(0);

    // Outro aparelho tirou o produto da despensa e da lista: a confirmação seguinte já diz isso.
    mockBank.pantry = [];
    mockBank.list = [];
    await open();
    expect(mockBank.asked).toHaveLength(2);
    expect(screen()).toContain('As 2 compras de "Arroz 5kg" passam para "Arroz Tio João 5 kg". Não dá para desfazer.');
  });

  // O que os dois nomes dizem e o que vai para o banco saem da leitura: a tela de onde a pessoa veio pode ter
  // carregado os produtos antes de outro aparelho renomear um deles (um "Arroz" criado com o nome errado).
  it('os nomes, as categorias e o que vai para o banco são os da leitura, e não os que a tela de antes guardava', async () => {
    const now = product(ARROZ.id, 'Feijão carioca 1kg', 'graos');
    mockBank.products = [now, ARROZ_TJ];
    await open({ ...ARROZ, category: 'outros' }, { ...ARROZ_TJ, name: 'Arroz Tio Joao', category: 'outros' });
    const shown = screen();
    expect(shown.join(' ')).not.toContain('Arroz 5kg');
    expect(shown.join(' ')).not.toContain('Arroz Tio Joao');
    expect(pressables('radio').map((node) => node.props.accessibilityLabel)).toEqual([
      'Feijão carioca 1kg. 2 compras · último preço R$ 24,90 em 5 out (Mercado Bom) · na despensa · na lista. Deixa de existir.',
      'Arroz Tio João 5 kg. 12 compras · último preço R$ 25,90 em 10 out (Assaí). Este nome fica.',
    ]);
    // O desenho de cada um é o da categoria e do nome de agora.
    expect(renderer!.root.findAllByType(CategoryIcon).map((icon) => [icon.props.category, icon.props.name])).toEqual([
      ['graos', 'Feijão carioca 1kg'],
      ['graos', 'Arroz Tio João 5 kg'],
    ]);
    // Os avisos também: com os nomes de agora, os tamanhos não batem.
    expect(shown).toContain('Parecem tamanhos diferentes (1 kg e 5 kg). Juntar mistura os preços dos dois no histórico.');
    const summary = 'As 2 compras, o que está na despensa e na lista de "Feijão carioca 1kg" passam para "Arroz Tio João 5 kg". Não dá para desfazer.';
    expect(shown).toContain(summary);
    await press(button('Juntar produtos'));
    expect(lastConfirm()[1]).toBe(summary);
    await act(async () => lastConfirm()[3]());
    expect(mockMerge.calls).toEqual([{ keepId: ARROZ_TJ.id, mergeId: ARROZ.id, keepName: 'Arroz Tio João 5 kg', mergeName: 'Feijão carioca 1kg' }]);
    expect(jest.mocked(notify).mock.calls[0][1]).toContain('"Feijão carioca 1kg" passou a ser "Arroz Tio João 5 kg".');
  });

  it('a despensa e a lista de cada um vêm das respostas da leitura', async () => {
    // Só o produto que fica está na despensa; só o que some está numa lista.
    mockBank.pantry = [ARROZ_TJ.id];
    mockBank.list = [ARROZ.id];
    await open();
    expect(pressables('radio').map((node) => node.props.accessibilityLabel)).toEqual([
      'Arroz 5kg. 2 compras · último preço R$ 24,90 em 5 out (Mercado Bom) · na lista. Deixa de existir.',
      'Arroz Tio João 5 kg. 12 compras · último preço R$ 25,90 em 10 out (Assaí) · na despensa. Este nome fica.',
    ]);
    expect(screen()).toContain('As 2 compras e o que está na lista de "Arroz 5kg" passam para "Arroz Tio João 5 kg". Não dá para desfazer.');
  });

  // Quando a leitura não traz um dos dois, ele foi juntado ou apagado em outro aparelho: não há o que confirmar.
  it('a leitura não trouxe um dos dois: avisa que não existe mais, fecha e busca de novo o que as telas mostram', async () => {
    const invalidated: unknown[] = [];
    const invalidate = client.invalidateQueries.bind(client);
    client.invalidateQueries = ((filters?: { queryKey?: readonly unknown[] }) => {
      invalidated.push(filters?.queryKey?.[0]);
      return invalidate(filters);
    }) as typeof client.invalidateQueries;
    mockBank.products = ALL.filter((item) => item.id !== ARROZ_TJ.id);
    await open();
    expect(jest.mocked(notify).mock.calls).toEqual([['Erro', 'Um destes produtos não existe mais: alguém da casa já juntou ou apagou.']]);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onMerged).not.toHaveBeenCalled();
    expect(button('Juntar produtos')).toBeUndefined();
    expect(pressables('radio')).toHaveLength(0);
    expect(mockMerge.calls).toEqual([]);
    expect([...invalidated].sort()).toEqual([...MERGE_REFRESHES].sort());
  });

  // A leitura é de alguns segundos antes do toque. O banco confere os nomes que foram junto e recusa se um mudou.
  describe('um dos dois mudou de nome em outro aparelho, com a confirmação já na tela', () => {
    const renamed = { code: 'NK008', message: 'product renamed' };
    const now = product(ARROZ.id, 'Feijão carioca 1kg');

    it('avisa, lê de novo e continua aberta com o nome de agora; nada foi juntado', async () => {
      await open();
      await press(button('Juntar produtos'));
      // O outro aparelho renomeia; o banco recusa o pedido, que levava o nome de antes.
      mockBank.products = [now, ...ALL.filter((item) => item.id !== ARROZ.id)];
      mockMerge.error = renamed;
      mockBank.hold = true;
      await act(async () => lastConfirm()[3]());
      await settle();
      expect(mockMerge.calls).toEqual([{ keepId: ARROZ_TJ.id, mergeId: ARROZ.id, keepName: 'Arroz Tio João 5 kg', mergeName: 'Arroz 5kg' }]);
      expect(jest.mocked(notify).mock.calls).toEqual([['Confira os nomes', MERGE_RENAMED]]);
      expect(onMerged).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      // A leitura nova ainda não chegou: o nome de antes não fica na tela com o botão pronto.
      expect(mockBank.asked).toHaveLength(2);
      expect(button('Juntar produtos')).toBeUndefined();
      expect(pressables('radio')).toHaveLength(0);
      expect(screen().join(' ')).not.toContain('Arroz 5kg');

      await answer();
      const summary = 'As 2 compras, o que está na despensa e na lista de "Feijão carioca 1kg" passam para "Arroz Tio João 5 kg". Não dá para desfazer.';
      expect(screen()).toContain(summary);
      expect(screen().join(' ')).not.toContain('Arroz 5kg');
      expect(onClose).not.toHaveBeenCalled();

      // Conferidos os nomes, juntar de novo manda os de agora.
      mockMerge.error = null;
      await press(button('Juntar produtos'));
      expect(lastConfirm()[1]).toBe(summary);
      await act(async () => lastConfirm()[3]());
      expect(mockMerge.calls[1]).toEqual({ keepId: ARROZ_TJ.id, mergeId: ARROZ.id, keepName: 'Arroz Tio João 5 kg', mergeName: 'Feijão carioca 1kg' });
      expect(onMerged.mock.calls).toEqual([[ARROZ_TJ.id]]);
    });

    it('a leitura nova fica esperando a internet voltar: os nomes de antes não ficam na tela com o botão pronto', async () => {
      await open();
      await press(button('Juntar produtos'));
      mockBank.products = [now, ...ALL.filter((item) => item.id !== ARROZ.id)];
      mockMerge.error = renamed;
      // O sinal cai junto com a recusa: a leitura nova nem sai.
      onlineManager.setOnline(false);
      await act(async () => lastConfirm()[3]());
      await settle();
      expect(jest.mocked(notify).mock.calls).toEqual([['Confira os nomes', MERGE_RENAMED]]);
      expect(mockBank.asked).toHaveLength(1);
      expect(button('Juntar produtos')).toBeUndefined();
      expect(pressables('radio')).toHaveLength(0);
      expect(screen().join(' ')).not.toContain('Arroz 5kg');
      // A internet volta: a leitura sai, e a confirmação mostra o nome de agora.
      await act(async () => {
        onlineManager.setOnline(true);
        await flush();
      });
      await settle();
      expect(mockBank.asked).toHaveLength(2);
      expect(pressables('radio')[0].props.accessibilityLabel).toMatch(/^Feijão carioca 1kg\. /);
    });

    it('a leitura nova falhou: mostra o erro com "Tentar de novo", e não a confirmação com os nomes de antes', async () => {
      await open();
      await press(button('Juntar produtos'));
      mockMerge.error = renamed;
      mockBank.error = new Error('Sem internet.');
      await act(async () => lastConfirm()[3]());
      await settle();
      expect(screen()).toContain('Sem internet.');
      expect(button('Juntar produtos')).toBeUndefined();
      expect(pressables('radio')).toHaveLength(0);
      expect(screen().join(' ')).not.toContain('Arroz 5kg');
      expect(onClose).not.toHaveBeenCalled();

      mockBank.products = [now, ...ALL.filter((item) => item.id !== ARROZ.id)];
      mockBank.error = null;
      await press(button('Tentar de novo'));
      expect(mockBank.asked).toHaveLength(3);
      expect(pressables('radio')[0].props.accessibilityLabel).toMatch(/^Feijão carioca 1kg\. /);
    });

    it('a leitura nova já não traz o produto: avisa que não existe mais e fecha', async () => {
      await open();
      await press(button('Juntar produtos'));
      mockMerge.error = renamed;
      mockBank.products = ALL.filter((item) => item.id !== ARROZ.id);
      await act(async () => lastConfirm()[3]());
      await settle();
      expect(jest.mocked(notify).mock.calls).toEqual([
        ['Confira os nomes', MERGE_RENAMED],
        ['Erro', 'Um destes produtos não existe mais: alguém da casa já juntou ou apagou.'],
      ]);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  // O que a busca tiver guardado de antes (aqui posto à mão) não é o que a confirmação mostra.
  describe('com uma leitura mais antiga guardada', () => {
    /** O que se sabia antes: o produto que some não estava na despensa nem na lista. */
    const older = () =>
      client.setQueryData(['mergeFacts', ARROZ.id, ARROZ_TJ.id], {
        products: { [ARROZ.id]: ARROZ, [ARROZ_TJ.id]: ARROZ_TJ },
        facts: {
          [ARROZ.id]: { purchases: 2, lastPrice: null, inPantry: false, onList: false, units: [] },
          [ARROZ_TJ.id]: { purchases: 12, lastPrice: null, inPantry: false, onList: false, units: [] },
        },
      });

    it('só vale a leitura que chegou com a confirmação aberta: juntar não tem volta, e a despensa pode ter mudado em outro aparelho', async () => {
      older();
      mockBank.hold = true;
      await open();
      expect(mockBank.asked).toEqual([[ARROZ.id, ARROZ_TJ.id]]);
      expect(button('Juntar produtos')).toBeUndefined();
      expect(pressables('radio')).toHaveLength(0);
      expect(screen().join(' ')).not.toContain('passam para');

      // A leitura chegou: outro aparelho tinha posto o produto na despensa e na lista, e a frase diz isso.
      await answer();
      expect(screen()).toContain(SUMMARY);
      expect(button('Juntar produtos')).toBeDefined();
    });

    it('a leitura falhou: mostra o erro, e não a confirmação com o que estava guardado', async () => {
      older();
      mockBank.error = new Error('Sem internet.');
      await open();
      expect(screen()).toContain('Sem internet.');
      expect(button('Juntar produtos')).toBeUndefined();
      expect(pressables('radio')).toHaveLength(0);
      expect(screen().join(' ')).not.toContain('passam para');
      mockBank.error = null;
      await press(button('Tentar de novo'));
      expect(mockBank.asked).toHaveLength(2);
      expect(screen()).toContain(SUMMARY);
    });
  });

  it('enquanto o banco junta, a tela não fecha; com a resposta, o aviso e o produto que ficou', async () => {
    mockMerge.hold = true;
    await open();
    await press(button('Juntar produtos'));
    await act(async () => lastConfirm()[3]());
    await press(renderer!.root.findAll((node) => node.props.accessibilityLabel === 'Fechar' && typeof node.props.onPress === 'function')[0]);
    expect(onClose).not.toHaveBeenCalled();
    expect(onMerged).not.toHaveBeenCalled();
    await act(async () => mockMerge.finish());
    expect(onMerged.mock.calls).toEqual([[ARROZ_TJ.id]]);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('depois de um erro dá para fechar', async () => {
    mockMerge.error = { message: 'TypeError: Network request failed' };
    await open();
    await press(button('Juntar produtos'));
    await act(async () => lastConfirm()[3]());
    expect(jest.mocked(notify).mock.calls).toEqual([['Erro', 'TypeError: Network request failed']]);
    await press(button('Cancelar'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Cancelar e o X fecham sem juntar', async () => {
    await open();
    await press(button('Cancelar'));
    await press(renderer!.root.findAll((node) => node.props.accessibilityLabel === 'Fechar' && typeof node.props.onPress === 'function')[0]);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(mockMerge.calls).toEqual([]);
    expect(confirmAction).not.toHaveBeenCalled();
    // A sugestão já veio com o par: não há outro produto para escolher.
    expect(button('Escolher outro produto')).toBeUndefined();
  });
});

describe('escolher com qual produto juntar', () => {
  const open = (opened = ARROZ) => render(<MergeProductsModal opened={opened} onClose={onClose} onMerged={onMerged} />);
  /** Os nomes dos produtos oferecidos, na ordem em que aparecem. */
  const offered = () => {
    const names = new Set(ALL.map((item) => item.name));
    return screen().filter((text) => names.has(text));
  };

  it('os de nome parecido vêm primeiro, depois os outros produtos da casa; o próprio não aparece', async () => {
    await open();
    expect(screen().slice(0, 3)).toEqual(['Juntar com qual produto?', 'Escolha o produto que é a mesma coisa que "Arroz 5kg".', 'Nomes parecidos']);
    // Depois dos parecidos, os outros na ordem em que a busca dos produtos os traz.
    expect(offered()).toEqual(['Arroz Tio João 5 kg', 'Arroz Tio João 1kg', 'Limão', 'Limões', 'Banana', 'Bananas', 'Açúcar', 'acucar', 'Feijão carioca']);
    expect(offered()).not.toContain('Arroz 5kg');
  });

  it('escolhido o produto, mostra a confirmação dos dois; dá para voltar e escolher outro', async () => {
    await open();
    const row = renderer!.root.findAll((node) => typeof node.props.onPress === 'function' && textOf(node) === 'Arroz Tio João 5 kgGrãos, massas e cereais')[0];
    await press(row);
    expect(pressables('radio').map((node) => node.props.accessibilityLabel)).toEqual([
      'Arroz 5kg. 2 compras · último preço R$ 24,90 em 5 out (Mercado Bom) · na despensa · na lista. Deixa de existir.',
      'Arroz Tio João 5 kg. 12 compras · último preço R$ 25,90 em 10 out (Assaí). Este nome fica.',
    ]);
    await press(button('Escolher outro produto'));
    expect(screen()[0]).toBe('Juntar com qual produto?');
    expect(mockMerge.calls).toEqual([]);
  });

  // Quem escolheu na lista volta a ela: o produto que sumiu já não está lá, e dá para escolher outro. (Se o
  // que sumiu foi o da tela, é a tela do produto que deixa de existir, com esta confirmação dentro.)
  it('o produto escolhido já foi juntado por outra pessoa: avisa e volta para a lista', async () => {
    mockMerge.error = { code: 'P0002', message: 'product not found' };
    await open();
    await press(renderer!.root.findAll((node) => typeof node.props.onPress === 'function' && textOf(node) === 'Arroz Tio João 5 kgGrãos, massas e cereais')[0]);
    await press(button('Juntar produtos'));
    await act(async () => lastConfirm()[3]());
    expect(jest.mocked(notify).mock.calls).toEqual([['Erro', 'Um destes produtos não existe mais: alguém da casa já juntou ou apagou.']]);
    expect(screen()[0]).toBe('Juntar com qual produto?');
    expect(onClose).not.toHaveBeenCalled();
    // E a lista fecha normalmente.
    await press(renderer!.root.findAll((node) => node.props.accessibilityLabel === 'Fechar' && typeof node.props.onPress === 'function')[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('o produto escolhido já não existe quando a leitura chega: avisa e volta para a lista, sem nada para confirmar', async () => {
    mockBank.products = ALL.filter((item) => item.id !== ARROZ_TJ.id);
    await open();
    await press(renderer!.root.findAll((node) => typeof node.props.onPress === 'function' && textOf(node) === 'Arroz Tio João 5 kgGrãos, massas e cereais')[0]);
    expect(mockBank.asked).toEqual([[ARROZ.id, ARROZ_TJ.id]]);
    expect(jest.mocked(notify).mock.calls).toEqual([['Erro', 'Um destes produtos não existe mais: alguém da casa já juntou ou apagou.']]);
    expect(screen()[0]).toBe('Juntar com qual produto?');
    expect(onClose).not.toHaveBeenCalled();
    expect(mockMerge.calls).toEqual([]);
    // Escolher outro produto abre a confirmação dele, com a leitura dele.
    await press(renderer!.root.findAll((node) => typeof node.props.onPress === 'function' && textOf(node) === 'Arroz Tio João 1kgGrãos, massas e cereais')[0]);
    expect(mockBank.asked).toEqual([
      [ARROZ.id, ARROZ_TJ.id],
      [ARROZ.id, ARROZ_1KG.id],
    ]);
    expect(pressables('radio').map((node) => node.props.accessibilityLabel)).toEqual([
      'Arroz 5kg. 2 compras · último preço R$ 24,90 em 5 out (Mercado Bom) · na despensa · na lista. Este nome fica.',
      'Arroz Tio João 1kg. nenhuma compra. Deixa de existir.',
    ]);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('casa com um produto só: diz que não há outro', async () => {
    mockQueries.products = loaded([ARROZ]);
    await open();
    expect(screen()).toContain('A casa ainda não tem outro produto.');
  });
});

describe('cartão "Parecem o mesmo produto"', () => {
  const open = (productId?: string) => render(<MergeSuggestionsCard productId={productId} onMerged={onMerged} />);

  it('até 3 pares, os de mais compras primeiro, cada um com "Juntar" e "São diferentes"', async () => {
    await open();
    expect(screen()).toEqual([
      'Parecem o mesmo produto',
      'Juntando, as compras e os preços dos dois ficam num produto só. Você decide.',
      // O mesmo tamanho nos dois nomes, com a marca num só.
      'Arroz Tio João 5 kg',
      '12 compras',
      'Arroz 5kg',
      '2 compras',
      'Juntar',
      'São diferentes',
      'Banana',
      '6 compras',
      'Bananas',
      '1 compra',
      'Juntar',
      'São diferentes',
      // Empate de compras e de grafia: fica na frente o nome mais comprido.
      'Limões',
      '1 compra',
      'Limão',
      '1 compra',
      'Juntar',
      'São diferentes',
    ]);
  });

  it('cada botão diz de qual par é, para quem ouve a tela', async () => {
    await open();
    expect(pressables('button').map((node) => node.props.accessibilityLabel)).toEqual([
      'Juntar Arroz Tio João 5 kg com Arroz 5kg',
      'Arroz Tio João 5 kg e Arroz 5kg são diferentes',
      'Juntar Banana com Bananas',
      'Banana e Bananas são diferentes',
      'Juntar Limões com Limão',
      'Limões e Limão são diferentes',
    ]);
  });

  it('"São diferentes" guarda o par para a casa', async () => {
    await open();
    await press(button('São diferentes', 2));
    expect(mockMarked).toEqual([{ a: LIMOES.id, b: LIMAO.id }]);
    expect(mockMerge.calls).toEqual([]);
  });

  it('o par que a casa já recusou não aparece, e o seguinte entra no lugar', async () => {
    // A casa tem quatro pares; o do açúcar, com menos compras, espera a vez.
    await open();
    expect(screen()).not.toContain('acucar');
    await act(async () => renderer?.unmount());
    mockQueries.distinct = loaded([{ product_a: BANANA.id, product_b: BANANAS.id }]);
    await open();
    const shown = screen();
    expect(shown).not.toContain('Bananas');
    expect(shown.filter((text) => text === 'Juntar')).toHaveLength(3);
    expect(shown.slice(-6)).toEqual(['acucar', '1 compra', 'Açúcar', 'nenhuma compra', 'Juntar', 'São diferentes']);
  });

  it('"Juntar" abre a confirmação do par e, juntado, avisa a tela com o produto que ficou', async () => {
    await open();
    await press(button('Juntar', 1));
    expect(pressables('radio').map((node) => node.props.accessibilityLabel)).toEqual(['Banana. 6 compras. Este nome fica.', 'Bananas. 1 compra. Deixa de existir.']);
    await press(button('Juntar produtos'));
    expect(lastConfirm()[1]).toBe('A compra de "Bananas" passa para "Banana". Não dá para desfazer.');
    await act(async () => lastConfirm()[3]());
    expect(mockMerge.calls).toEqual([{ keepId: BANANA.id, mergeId: BANANAS.id, keepName: BANANA.name, mergeName: BANANAS.name }]);
    expect(onMerged.mock.calls).toEqual([[BANANA.id]]);
    // A confirmação fechou.
    expect(pressables('radio')).toHaveLength(0);
  });

  it('o par que outra pessoa já juntou: avisa e a confirmação fecha, de volta ao cartão', async () => {
    mockMerge.error = { code: 'P0002', message: 'product not found' };
    await open();
    await press(button('Juntar', 1));
    await press(button('Juntar produtos'));
    await act(async () => lastConfirm()[3]());
    expect(jest.mocked(notify).mock.calls).toEqual([['Erro', 'Um destes produtos não existe mais: alguém da casa já juntou ou apagou.']]);
    expect(pressables('radio')).toHaveLength(0);
    expect(screen()[0]).toBe('Parecem o mesmo produto');
    expect(onMerged).not.toHaveBeenCalled();
  });

  // Em Preços ninguém abriu produto nenhum: no empate, o cartão e a confirmação ficam com o nome mais bem escrito.
  it('no empate de compras, o cartão e a confirmação ficam com o nome mais bem escrito', async () => {
    const [cut, full] = [product('p-deterg', 'Deterg Ype 500ml', 'limpeza'), product('p-detergente', 'Detergente Ypê 500ml', 'limpeza')];
    mockQueries.products = loaded([cut, full]);
    mockQueries.counts = loaded({ [cut.id]: 1, [full.id]: 1 });
    Object.assign(mockBank, { products: [cut, full], counts: { [cut.id]: 1, [full.id]: 1 } });
    await open();
    expect(screen().slice(2, 6)).toEqual(['Detergente Ypê 500ml', '1 compra', 'Deterg Ype 500ml', '1 compra']);
    await press(button('Juntar', 0));
    expect(pressables('radio').map((node) => [node.props.accessibilityLabel, node.props['aria-checked']])).toEqual([
      ['Detergente Ypê 500ml. 1 compra. Este nome fica.', true],
      ['Deterg Ype 500ml. 1 compra. Deixa de existir.', false],
    ]);
  });

  it('na tela do produto, só a sugestão dele', async () => {
    await open(LIMOES.id);
    expect(screen().slice(2)).toEqual(['Limões', '1 compra', 'Limão', '1 compra', 'Juntar', 'São diferentes']);
    await act(async () => renderer?.unmount());
    await open(FEIJAO.id);
    expect(screen()).toEqual([]);
  });

  it('não aparece sem sugestão, antes de tudo carregar nem quando o banco ainda não guarda o "São diferentes"', async () => {
    const shows = async (change: () => void) => {
      change();
      await open();
      const shown = screen();
      await act(async () => renderer?.unmount());
      return shown.length > 0;
    };
    expect(await shows(() => undefined)).toBe(true);
    // A tabela dos pares ainda não existe: a busca responde null.
    expect(await shows(() => (mockQueries.distinct = loaded(null)))).toBe(false);
    expect(await shows(() => (mockQueries.distinct = onTheWay()))).toBe(false);
    expect(await shows(() => (mockQueries.distinct = failed()))).toBe(false);
    mockQueries.distinct = loaded([]);
    expect(await shows(() => (mockQueries.counts = onTheWay()))).toBe(false);
    expect(await shows(() => (mockQueries.counts = failed()))).toBe(false);
    mockQueries.counts = loaded({});
    // Uma contagem que não traz os produtos dos pares (a de outra lista, guardada de antes) não serve.
    expect(await shows(() => undefined)).toBe(false);
    expect(await shows(() => (mockQueries.products = loaded([ARROZ, FEIJAO])))).toBe(false);
    expect(await shows(() => (mockQueries.products = onTheWay()))).toBe(false);
  });
});

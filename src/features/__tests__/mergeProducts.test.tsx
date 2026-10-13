import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import type { DistinctPair } from '@/domain/productMerge';
import type { LatestPrice, Product } from '@/lib/types';
import { confirmAction, notify } from '@/ui/dialogs';

import { MergeProductsModal } from '../MergeProductsModal';
import { MergeSuggestionsCard } from '../MergeSuggestionsCard';

// A confirmação de juntar e o cartão "Parecem o mesmo produto" de verdade, com as buscas trocadas por respostas
// prontas: o que se confere aqui é o que a pessoa lê e o que cada toque manda fazer.

interface Query {
  data: unknown;
  isPending: boolean;
  error: unknown;
  refetch: jest.Mock;
}

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockQueries: Record<string, Query> = {};
/** O que o banco responde ao juntar: o que passou, ou um erro. Com `hold`, a resposta fica esperando `finish`. */
const mockMerge: { calls: unknown[]; moved: object; error: object | null; hold: boolean; finish: () => void } = {
  calls: [],
  moved: {},
  error: null,
  hold: false,
  finish: () => undefined,
};
const mockMarked: unknown[] = [];

jest.mock('@/data/home', () => ({ usePantry: () => mockQueries.pantry }));
jest.mock('@/data/market', () => ({
  useLatestPrices: () => mockQueries.prices,
  useOpenListItems: () => mockQueries.listItems,
  useProducts: () => mockQueries.products,
  useStores: () => mockQueries.stores,
}));
jest.mock('@/data/productMerge', () => ({
  ...jest.requireActual<typeof import('@/data/productMerge')>('@/data/productMerge'),
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
jest.mock('@/ui/art', () => ({ Mascot: () => null, Spot: () => null }));
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
let onClose: jest.Mock<() => void>;
let onMerged: jest.Mock<(keptId: string) => void>;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function render(element: React.ReactElement) {
  await act(async () => {
    renderer = create(element);
    await flush();
  });
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
}

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
  Object.assign(mockQueries, {
    products: loaded(ALL),
    distinct: loaded([] as DistinctPair[]),
    counts: loaded({
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
    }),
    prices: loaded([price(ARROZ_TJ.id, 's-assai', 25.9, '10-10'), price(ARROZ_TJ.id, 's-bom', 27.5, '09-20'), price(ARROZ.id, 's-bom', 24.9, '10-05')]),
    stores: loaded([
      { id: 's-assai', name: 'Assaí' },
      { id: 's-bom', name: 'Mercado Bom' },
    ]),
    pantry: loaded([{ product_id: ARROZ.id }]),
    listItems: loaded([{ product_id: ARROZ.id }, { product_id: null }]),
  });
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

describe('confirmação de juntar', () => {
  const open = (opened = ARROZ, other = ARROZ_TJ) => render(<MergeProductsModal opened={opened} other={other} onClose={onClose} onMerged={onMerged} />);
  const SUMMARY = 'As 2 compras, o que está na despensa e na lista de "Arroz 5kg" passam para "Arroz Tio João 5 kg". Não dá para desfazer.';

  it('mostra os dois com o que o app sabe de cada um, e fica por padrão o de mais compras', async () => {
    await open();
    const [first, second] = pressables('radio');
    expect(textOf(first)).toBe('Arroz 5kg2 compras · último preço R$ 24,90 em 5 out (Mercado Bom) · na despensa · na listaDeixa de existir');
    expect(textOf(second)).toBe('Arroz Tio João 5 kg12 compras · último preço R$ 25,90 em 10 out (Assaí)Este nome fica');
    expect(first.props.accessibilityState).toEqual({ selected: false, disabled: false });
    expect(second.props.accessibilityState).toEqual({ selected: true, disabled: false });
    expect(screen()).toContain(SUMMARY);
    // Os mesmos tamanhos nos dois nomes, e os dois comprados por unidade: nenhum aviso.
    expect(screen().join(' ')).not.toContain('Juntar mistura os preços');
  });

  it('o botão vermelho pede a confirmação dizendo o que acontece e que não dá para desfazer; só então junta', async () => {
    await open();
    await press(button('Juntar produtos'));
    expect(lastConfirm().slice(0, 3)).toEqual(['Juntar produtos', SUMMARY, 'Juntar']);
    expect(mockMerge.calls).toEqual([]);
    await act(async () => lastConfirm()[3]());
    expect(mockMerge.calls).toEqual([{ keepId: ARROZ_TJ.id, mergeId: ARROZ.id }]);
    expect(jest.mocked(notify).mock.calls).toEqual([
      ['Agora é um produto só', '"Arroz 5kg" passou a ser "Arroz Tio João 5 kg". Foram junto 2 compras, 1 item da despensa e 1 item da lista.'],
    ]);
    expect(onMerged.mock.calls).toEqual([[ARROZ_TJ.id]]);
  });

  it('a pessoa escolhe o outro nome: a frase e o que vai para o banco mudam juntos', async () => {
    await open();
    await press(pressables('radio')[0]);
    expect(pressables('radio').map((node) => node.props.accessibilityState.selected)).toEqual([true, false]);
    const summary = 'As 12 compras de "Arroz Tio João 5 kg" passam para "Arroz 5kg". Não dá para desfazer.';
    expect(screen()).toContain(summary);
    await press(button('Juntar produtos'));
    expect(lastConfirm()[1]).toBe(summary);
    await act(async () => lastConfirm()[3]());
    expect(mockMerge.calls).toEqual([{ keepId: ARROZ.id, mergeId: ARROZ_TJ.id }]);
    expect(onMerged.mock.calls).toEqual([[ARROZ.id]]);
  });

  it('no empate de compras fica o produto de onde a pessoa partiu', async () => {
    await open(LIMOES, LIMAO);
    expect(pressables('radio').map((node) => [textOf(node), node.props.accessibilityState.selected])).toEqual([
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
    expect(mockMerge.calls).toEqual([{ keepId: ARROZ_TJ.id, mergeId: ARROZ_1KG.id }]);
  });

  it('um comprado por peso e o outro por unidade: aviso', async () => {
    mockQueries.prices = loaded([price(BANANA.id, 's-bom', 5.9, '10-01', 'kg'), price(BANANAS.id, 's-assai', 0.8, '10-02')]);
    await open(BANANA, BANANAS);
    expect(screen()).toContain('As compras de "Banana" são por peso, e as de "Bananas", por unidade. Juntar mistura os preços dos dois no histórico.');
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

  it('produto que outra pessoa já juntou: avisa sem fechar', async () => {
    mockMerge.error = { code: 'P0002', message: 'product not found' };
    await open();
    await press(button('Juntar produtos'));
    await act(async () => lastConfirm()[3]());
    expect(jest.mocked(notify).mock.calls).toEqual([['Erro', 'Um destes produtos não existe mais: alguém da casa já juntou ou apagou.']]);
    expect(onMerged).not.toHaveBeenCalled();
  });

  it('enquanto o que o app sabe não carrega, não há o que confirmar; se falhou, dá para tentar de novo', async () => {
    mockQueries.counts = onTheWay();
    await open();
    expect(button('Juntar produtos')).toBeUndefined();
    expect(pressables('radio')).toEqual([]);
    await act(async () => renderer?.unmount());

    mockQueries.counts = failed();
    await open();
    expect(screen()).toContain('Sem internet.');
    expect(button('Juntar produtos')).toBeUndefined();
    await press(button('Tentar de novo'));
    expect(mockQueries.counts.refetch).toHaveBeenCalledTimes(1);
    expect(mockQueries.prices.refetch).not.toHaveBeenCalled();
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
      'Ficar com o nome Arroz 5kg. 2 compras · último preço R$ 24,90 em 5 out (Mercado Bom) · na despensa · na lista',
      'Ficar com o nome Arroz Tio João 5 kg. 12 compras · último preço R$ 25,90 em 10 out (Assaí)',
    ]);
    await press(button('Escolher outro produto'));
    expect(screen()[0]).toBe('Juntar com qual produto?');
    expect(mockMerge.calls).toEqual([]);
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
      'Banana',
      '6 compras',
      'Bananas',
      '1 compra',
      'Juntar',
      'São diferentes',
      'Limão',
      '1 compra',
      'Limões',
      '1 compra',
      'Juntar',
      'São diferentes',
      'acucar',
      '1 compra',
      'Açúcar',
      'nenhuma compra',
      'Juntar',
      'São diferentes',
    ]);
  });

  it('"São diferentes" guarda o par para a casa', async () => {
    await open();
    await press(button('São diferentes', 1));
    expect(mockMarked).toEqual([{ a: LIMAO.id, b: LIMOES.id }]);
    expect(mockMerge.calls).toEqual([]);
  });

  it('o par que a casa já recusou não aparece, e o seguinte entra no lugar', async () => {
    mockQueries.distinct = loaded([{ product_a: BANANA.id, product_b: BANANAS.id }]);
    mockQueries.products = loaded([...ALL, product('p-ovo', 'Ovo', 'ovos'), product('p-ovos', 'Ovos', 'ovos')]);
    mockQueries.counts = loaded({ ...(mockQueries.counts.data as object), 'p-ovo': 0, 'p-ovos': 0 });
    await open();
    const shown = screen();
    expect(shown).not.toContain('Bananas');
    expect(shown.filter((text) => text === 'Juntar')).toHaveLength(3);
    expect(shown).toContain('Ovos');
  });

  it('"Juntar" abre a confirmação do par e, juntado, avisa a tela com o produto que ficou', async () => {
    await open();
    await press(button('Juntar', 0));
    expect(pressables('radio').map((node) => node.props.accessibilityLabel)).toEqual(['Ficar com o nome Banana. 6 compras', 'Ficar com o nome Bananas. 1 compra']);
    await press(button('Juntar produtos'));
    expect(lastConfirm()[1]).toBe('A compra de "Bananas" passa para "Banana". Não dá para desfazer.');
    await act(async () => lastConfirm()[3]());
    expect(mockMerge.calls).toEqual([{ keepId: BANANA.id, mergeId: BANANAS.id }]);
    expect(onMerged.mock.calls).toEqual([[BANANA.id]]);
    // A confirmação fechou.
    expect(pressables('radio')).toEqual([]);
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

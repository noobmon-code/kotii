import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import MarketMonthScreen from '@/app/mercado';
import type { MarketLine, MarketReceipt } from '@/domain/marketSpend';
import { MarketMonthLink } from '@/features/finance/MarketMonthLink';
import { Button, Chip, IconButton, ListRow, Screen } from '@/ui/primitives';

// A tela de verdade, com a busca das notas trocada por respostas prontas: o que se confere aqui é o que ela
// faz com cada resposta (carregada, vazia, falhou, falhou com dados na tela) e com os toques. As contas e os
// textos são de domain/marketSpend, de verdade.

interface Query {
  data: MarketReceipt[] | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  isRefetching: boolean;
  refetch: jest.Mock;
}

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockState: { query: Query; params: { mes?: string }; asked: string[] } = { query: undefined as never, params: {}, asked: [] };
const mockRouter = { push: jest.fn(), setParams: jest.fn() };
const mockScanner = { open: jest.fn(), busy: false, element: null };

// As funções só são lidas na hora do toque: o jest.mock roda antes de as variáveis acima existirem.
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockRouter.push(...args), setParams: (...args: unknown[]) => mockRouter.setParams(...args) },
  useLocalSearchParams: () => mockState.params,
}));
jest.mock('@/data/marketSpend', () => ({
  useMarketReceipts: (month: string) => {
    mockState.asked.push(month);
    return mockState.query;
  },
}));
jest.mock('@/features/ReceiptScanner', () => ({ useReceiptScanner: () => mockScanner }));
// Os desenhos animados (reanimated), o fundo, as imagens e os ícones (que são letras de uma fonte) não entram
// no que se confere aqui.
jest.mock('@/ui/art', () => ({ Mascot: () => null, Spot: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));

const loaded = (data: MarketReceipt[]): Query => ({ data, isPending: false, isError: false, error: null, isRefetching: false, refetch: jest.fn() });
/** Nunca carregou e a busca falhou. */
const failed = (): Query => ({ ...loaded([]), data: undefined, isError: true, error: new Error('Sem conexão com a internet.') });
/** Já tinha carregado e a nova busca falhou: os dados de antes continuam. */
const staleAfterFailure = (data: MarketReceipt[]): Query => ({ ...loaded(data), isError: true, error: new Error('Sem conexão com a internet.') });
const onTheWay = (): Query => ({ ...loaded([]), data: undefined, isPending: true });

const at = (month: number, day: number) => new Date(2026, month - 1, day, 12).toISOString();

const line = (name: string, category: string, totalPrice: number, quantity = 1, unit = 'un'): MarketLine => ({
  productId: `p-${name}`,
  productName: name,
  productCategory: category,
  rawDescription: name.toUpperCase(),
  suggestedName: null,
  suggestedCategory: null,
  quantity,
  unit,
  totalPrice,
});
const loose = (description: string, totalPrice: number): MarketLine => ({ ...line(description, 'outros', totalPrice), productId: null, productName: null, productCategory: null });

const receipt = (id: string, purchasedAt: string, lines: MarketLine[], partial: Partial<MarketReceipt> = {}): MarketReceipt => ({
  id,
  purchasedAt,
  status: 'confirmed',
  total: null,
  storeId: 'a1',
  storeName: 'Assaí',
  lines,
  ...partial,
});

/** Outubro com duas idas (uma com desconto no total, outra com valor sem item), farmácia, item sem valor e um rascunho; setembro com uma ida. */
const HOUSE: MarketReceipt[] = [
  receipt('s1', at(9, 5), [line('Arroz', 'graos', 30), line('Picanha', 'carnes', 100, 1.5, 'kg')]),
  receipt(
    'o1',
    at(10, 3),
    [
      line('Picanha', 'carnes', 80, 1.2, 'kg'),
      line('Arroz', 'graos', 35),
      line('Feijão', 'graos', 9),
      line('Leite', 'laticinios', 24, 4),
      line('Café', 'cafe_cha', 18),
      line('Detergente', 'limpeza', 3.5),
      line('Sabonete', 'higiene', 4),
      line('Ração', 'pet', 20),
      line('Banana', 'hortifruti', 6, 1.5, 'kg'),
      line('Pão', 'padaria', 8),
      line('Queijo', 'laticinios', 22, 400, 'g'),
      line('Dipirona', 'medicamentos', 12),
      loose('SACOLA', 0.5),
    ],
    { total: 232 },
  ),
  receipt('o2', at(10, 10), [line('Arroz', 'graos', 30), line('Brinde', 'outros', 0)], { total: 50, storeId: 'd1', storeName: 'Dia' }),
  receipt('rascunho', at(10, 11), [], { status: 'draft' }),
];

let renderer: ReactTestRenderer | undefined;

type Rendered = ReturnType<ReactTestRenderer['toJSON']> | string;
const texts = (node: Rendered): string[] =>
  node == null ? [] : typeof node === 'string' ? [node] : Array.isArray(node) ? node.flatMap(texts) : (node.children ?? []).flatMap(texts);

/** Tudo o que a tela escreve, uma frase por linha. */
const page = () => texts(renderer!.toJSON()).join('\n');

async function mount(element = <MarketMonthScreen />) {
  await act(async () => {
    renderer = create(element);
  });
  return page();
}

/** Toca no que o leitor de tela anuncia com este texto. */
async function press(accessibilityLabel: string) {
  const [target] = renderer!.root.findAll((node) => node.props.accessibilityLabel === accessibilityLabel && typeof node.props.onPress === 'function');
  expect(target).toBeDefined();
  await act(async () => target.props.onPress());
}

async function pressButton(title: string) {
  const target = renderer!.root.findAllByType(Button).find((button) => button.props.title === title);
  expect(target).toBeDefined();
  await act(async () => target!.props.onPress());
}

/** Os nomes dos itens da lista "Por item", na ordem. */
const itemNames = () =>
  renderer!.root
    .findAllByType(ListRow)
    .filter((row) => String(row.props.accessibilityLabel).includes('do mês'))
    .map((row) => row.props.title);

beforeAll(() => {
  // Hoje é 13 de outubro de 2026: só o relógio é de mentira, os temporizadores seguem de verdade.
  jest.useFakeTimers({
    now: new Date(2026, 9, 13, 12),
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
});

afterAll(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  mockState.query = loaded(HOUSE);
  mockState.params = {};
  mockState.asked = [];
  mockRouter.push.mockClear();
  mockRouter.setParams.mockClear();
  mockScanner.open.mockClear();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

describe('mês carregado', () => {
  it('mostra o total, a comparação, as categorias, os itens, as idas e os mercados do mês corrente', async () => {
    const text = await mount();
    expect(mockState.asked.at(-1)).toBe('2026-10');
    expect(text).toContain('Outubro de 2026');
    expect(text).toContain('Mercado de outubro até hoje');
    // 230 em itens, menos 10 de desconto, mais 30 em itens e 20 sem item lido.
    expect(text).toContain('R$ 270,00 em 2 idas');
    expect(text).toContain('R$ 140,00 a mais que até o dia 13 de setembro');
    expect(text).toContain('Diferente da barra “Mercado” do Resumo: aqui entram limpeza, higiene e pet, e só conta o que veio de nota fiscal.');
    // Categorias, da maior para a menor, com a diferença para setembro.
    expect(text).toContain(['Carnes', 'R$ 80,00', '31%', 'R$ 20,00 a menos que até o dia 13 de setembro'].join('\n'));
    expect(text).toContain(['Grãos, massas e cereais', 'R$ 74,00', '28%', 'R$ 44,00 a mais que até o dia 13 de setembro'].join('\n'));
    expect(text).toContain(['Limpeza', 'R$ 3,50', '1%', 'Não teve até o dia 13 de setembro'].join('\n'));
    expect(text).toContain(['Outros', 'R$ 0,50', '<1%'].join('\n'));
    expect(text).not.toContain('Medicamentos');
    // O que fica à parte.
    expect(text).toContain(['Descontos no total das notas', '−R$ 10,00'].join('\n'));
    expect(text).toContain(['Nas notas, sem item lido', 'R$ 20,00'].join('\n'));
    expect(text).toContain(['Dia · 10 out', 'R$ 20,00'].join('\n'));
    expect(text).toContain('1 item sem valor');
    expect(text).toContain(['Dia · 10 out', '1 item'].join('\n'));
    expect(text).toContain('Farmácia, fora desta conta: R$ 12,00');
    expect(text).toContain('1 nota de outubro ainda espera a revisão. Ela entra nesta conta quando for confirmada.');
    // Itens: o nome, quanto foi comprado, em quantas idas e o valor de setembro.
    expect(text).toContain(['Picanha', '1,2 kg · em 1 ida · setembro: R$ 100,00', 'R$ 80,00', '31%'].join('\n'));
    expect(text).toContain(['Arroz', '2 un · em 2 idas · setembro: R$ 30,00', 'R$ 65,00', '25%'].join('\n'));
    // Idas, da mais recente para a mais antiga, e mercados.
    expect(text).toContain(['Idas do mês', 'Dia', '10 out · 2 itens', 'R$ 50,00', 'Assaí', '3 out · 12 itens · farmácia fora: R$ 12,00', 'R$ 220,00'].join('\n'));
    expect(text).toContain(['Por mercado', 'Assaí', '1 ida', 'R$ 220,00', 'Dia', '1 ida', 'R$ 50,00'].join('\n'));
  });

  it('mostra os 10 itens que mais levaram dinheiro, e "Ver todos" abre a lista inteira', async () => {
    const text = await mount();
    expect(itemNames()).toEqual(['Picanha', 'Arroz', 'Leite', 'Queijo', 'Ração', 'Café', 'Feijão', 'Pão', 'Banana', 'Sabonete']);
    expect(text).toContain('Ver todos os 13 itens');
    await pressButton('Ver todos os 13 itens');
    expect(itemNames()).toEqual(['Picanha', 'Arroz', 'Leite', 'Queijo', 'Ração', 'Café', 'Feijão', 'Pão', 'Banana', 'Sabonete', 'Detergente', 'SACOLA', 'Brinde']);
    expect(page()).toContain(['Brinde', '1 un · em 1 ida', 'sem valor', '0%'].join('\n'));
    await pressButton('Mostrar só os 10 primeiros');
    expect(itemNames()).toHaveLength(10);
  });

  it('tocar numa categoria filtra os itens; tocar de novo, ou no selo, tira o filtro', async () => {
    await mount();
    await press('Grãos, massas e cereais: R$ 74,00, 28% do mês, R$ 44,00 a mais que até o dia 13 de setembro');
    expect(itemNames()).toEqual(['Arroz', 'Feijão']);
    // O selo com o nome da categoria aparece ao lado de "Por item".
    const chip = renderer!.root.findByType(Chip);
    expect(chip.props.label).toBe('Grãos, massas e cereais');
    // As partes continuam sendo do mês inteiro.
    expect(page()).toContain(['Arroz', '2 un · em 2 idas · setembro: R$ 30,00', 'R$ 65,00', '25%'].join('\n'));
    await act(async () => chip.props.onPress());
    expect(itemNames()).toHaveLength(10);
    expect(renderer!.root.findAllByType(Chip)).toHaveLength(0);

    await press('Laticínios: R$ 46,00, 18% do mês, não teve até o dia 13 de setembro');
    expect(itemNames()).toEqual(['Leite', 'Queijo']);
    await press('Laticínios: R$ 46,00, 18% do mês, não teve até o dia 13 de setembro');
    expect(itemNames()).toHaveLength(10);
  });

  it('o item com produto abre o produto; o que a casa não acompanha não abre nada', async () => {
    await mount();
    await press('Picanha: R$ 80,00, 31% do mês, 1,2 kg, em 1 ida, setembro: R$ 100,00');
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/produto/[id]', params: { id: 'p-Picanha' } });
    await pressButton('Ver todos os 13 itens');
    const sacola = renderer!.root.findAllByType(ListRow).find((row) => row.props.title === 'SACOLA');
    expect(sacola?.props.accessibilityLabel).toBe('SACOLA: R$ 0,50, menos de 1% do mês, 1 un, em 1 ida');
    expect(sacola?.props.onPress).toBeUndefined();
  });

  it('a ida, a nota com valor sem item e o aviso de rascunho levam para as notas', async () => {
    await mount();
    await press('Assaí: R$ 220,00, 3 out, 12 itens, farmácia fora: R$ 12,00. Abrir a nota');
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/nota/[id]', params: { id: 'o1' } });
    await press('Dia, 10 out: R$ 20,00. Abrir a nota');
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/nota/[id]', params: { id: 'o2' } });
    await press('Dia, 10 out: 1 item. Abrir a nota');
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/nota/[id]', params: { id: 'o2' } });
    await press('1 nota de outubro ainda espera a revisão. Ela entra nesta conta quando for confirmada. Abrir as notas');
    expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/financas', params: { aba: 'notas' } });
  });

  it('puxar para atualizar busca as notas de novo', async () => {
    await mount();
    act(() => renderer!.root.findByType(Screen).props.onRefresh());
    expect(mockState.query.refetch).toHaveBeenCalledTimes(1);
  });
});

describe('o mês', () => {
  const navLabels = () => renderer!.root.findAllByType(IconButton).map((button) => button.props.label);

  it('abre no mês corrente, sem passar dele; a seta volta um mês', async () => {
    await mount();
    expect(navLabels()).toEqual(['Mês anterior']);
    await press('Mês anterior');
    expect(mockRouter.setParams).toHaveBeenCalledWith({ mes: '2026-09' });
  });

  it('aberta pelo resumo num mês passado, mostra aquele mês inteiro e deixa avançar', async () => {
    mockState.params = { mes: '2026-09' };
    const text = await mount();
    expect(mockState.asked.at(-1)).toBe('2026-09');
    expect(text).toContain('Setembro de 2026');
    expect(text).toContain('Mercado de setembro');
    expect(text).not.toContain('até hoje');
    expect(text).toContain('R$ 130,00 em 1 ida');
    expect(text).toContain('Não teve nota de mercado em agosto');
    expect(navLabels()).toEqual(['Mês anterior', 'Próximo mês']);
    await press('Próximo mês');
    expect(mockRouter.setParams).toHaveBeenCalledWith({ mes: '2026-10' });
  });

  it('mês que ainda não chegou (ou endereço estranho) cai no mês corrente', async () => {
    mockState.params = { mes: '2027-01' };
    await mount();
    expect(mockState.asked.at(-1)).toBe('2026-10');
    await act(async () => renderer?.unmount());
    mockState.params = { mes: 'qualquer coisa' };
    expect(await mount()).toContain('Outubro de 2026');
  });
});

describe('sem notas, carregando e com erro', () => {
  it('mês sem nota confirmada diz isso e leva a adicionar uma nota', async () => {
    mockState.query = loaded([]);
    const text = await mount();
    expect(text).toContain('Nenhuma nota de mercado em outubro');
    expect(text).toContain('As compras aparecem aqui quando uma nota fiscal é confirmada. Fotografe o cupom ou leia o QR code da nota.');
    expect(text).not.toContain('em 0 idas');
    expect(text).not.toContain('Por categoria');
    await pressButton('Adicionar nota');
    expect(mockScanner.open).toHaveBeenCalledTimes(1);
  });

  it('mês só com rascunho e farmácia: continua sem ida, e diz o que está esperando e o que ficou de fora', async () => {
    mockState.query = loaded([
      receipt('f1', at(10, 2), [line('Dipirona', 'medicamentos', 12)], { storeId: 'dr', storeName: 'Drogasil' }),
      receipt('r1', at(10, 3), [], { status: 'draft' }),
      receipt('r2', at(10, 4), [], { status: 'draft' }),
    ]);
    const text = await mount();
    expect(text).toContain('Nenhuma nota de mercado em outubro');
    expect(text).toContain('2 notas de outubro ainda esperam a revisão. Elas entram nesta conta quando forem confirmadas.');
    expect(text).toContain('Farmácia, fora desta conta: R$ 12,00');
  });

  it('enquanto carrega, nem números nem "nenhuma nota"', async () => {
    mockState.query = onTheWay();
    const text = await mount();
    expect(text).toBe('Outubro de 2026');
  });

  it('a busca falhou: mostra o erro com "Tentar de novo", nunca um mês sem gasto', async () => {
    mockState.query = failed();
    const text = await mount();
    expect(text).toContain('Sem conexão com a internet.');
    expect(text).not.toContain('Nenhuma nota de mercado');
    expect(text).not.toContain('R$');
    await pressButton('Tentar de novo');
    expect(mockState.query.refetch).toHaveBeenCalledTimes(1);
  });

  it('a nova busca falhou com os dados na tela: os números ficam, com o aviso de que não deu para atualizar', async () => {
    mockState.query = staleAfterFailure(HOUSE);
    const text = await mount();
    expect(text).toContain('Não deu para atualizar agora. Estes números são da última vez que a tela carregou.');
    expect(text).toContain('R$ 270,00 em 2 idas');
    expect(itemNames()).toHaveLength(10);
    await pressButton('Tentar de novo');
    expect(mockState.query.refetch).toHaveBeenCalledTimes(1);
    // Carregado sem erro, o aviso não aparece.
    await act(async () => renderer?.unmount());
    mockState.query = loaded(HOUSE);
    expect(await mount()).not.toContain('Não deu para atualizar agora');
  });
});

describe('a entrada no resumo de gastos', () => {
  const row = () => renderer!.root.findByType(ListRow);

  it('mostra o total do mês que o resumo está vendo e abre a tela nele', async () => {
    const text = await mount(<MarketMonthLink month="2026-09" />);
    expect(mockState.asked.at(-1)).toBe('2026-09');
    expect(text).toBe(['Para onde foi o dinheiro do mercado', 'R$ 130,00 em 1 ida'].join('\n'));
    await act(async () => row().props.onPress());
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/mercado', params: { mes: '2026-09' } });
  });

  it('sem nota no mês, diz isso; carregando ou com erro, continua levando à tela', async () => {
    mockState.query = loaded([]);
    expect(await mount(<MarketMonthLink month="2026-10" />)).toContain('Nenhuma nota de mercado em outubro');
    for (const state of [onTheWay, failed]) {
      await act(async () => renderer?.unmount());
      mockState.query = state();
      expect(await mount(<MarketMonthLink month="2026-10" />)).toBe(['Para onde foi o dinheiro do mercado', 'Por categoria, por item e por mercado'].join('\n'));
      expect(row().props.onPress).toBeDefined();
    }
  });
});

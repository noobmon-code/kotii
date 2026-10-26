import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from 'expo-router';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import ReceiptScreen from '@/app/nota/[id]';
import { fetchPantryNear } from '@/data/home';
import { formatBRL } from '@/domain/money';
import { askYesNo, confirmAction, notify } from '@/ui/dialogs';
import { PickerModal } from '@/ui/PickerModal';
import { Button, Card, CheckCircle, Chip, IconButton, TextField } from '@/ui/primitives';

// A tela da nota de verdade, com as consultas e gravações de verdade de
// src/data/receipts.ts e um "banco" em memória atrás do cliente do Supabase.
// O resto (produtos, mercados, lista, histórico de preço) vem pronto: o que se
// confere aqui é o item sem valor, a diferença para o total e o total da nota.

type Row = Record<string, unknown>;
/** Um pedido ao banco, como saiu do app (a função chamada vai em `table`). */
type MockRequest = { table: string; verb: 'select' | 'update' | 'insert' | 'delete' | 'rpc'; values?: Row };
// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockDb: {
  receipts: Row[];
  items: Row[];
  /** Os mercados da casa: a nota lida traz o dela pelo store_id, como o "store:stores(id, name)" do pedido. */
  stores: Row[];
  writes: { table: string; verb: 'update' | 'insert' | 'delete'; values?: Row; filters: Row }[];
  rpcs: { fn: string; args: Row }[];
  /** Quantas vezes cada tabela foi lida. */
  reads: Record<string, number>;
  /** Pedidos que o teste segura no meio do caminho (ver `hold`): saem na hora, e a resposta só vem quando ele solta. */
  holds: { match: (request: MockRequest) => boolean; gate: Promise<void>; open: () => void }[];
  /** Pedidos que falham (a rede caiu). */
  fails: ((request: MockRequest) => boolean)[];
} = { receipts: [], items: [], stores: [], writes: [], rpcs: [], reads: {}, holds: [], fails: [] };
const mockMarket: { products: Row[]; pantryNear: Row[]; listItems: Row[]; stores: Row[] } = { products: [], pantryNear: [], listItems: [], stores: [] };

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'r1' }),
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/ui/dialogs', () => ({ askYesNo: jest.fn(), confirmAction: jest.fn(), notify: jest.fn() }));
// Os desenhos animados e o fundo não entram no que se confere aqui.
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@/ui/PickerModal', () => ({ PickerModal: () => null }));
jest.mock('@/features/finance/PayerChips', () => ({ PayerChips: () => null }));
// O renomear tem os testes dele (renameStore.test): aqui, só para qual mercado ele abre.
jest.mock('@/features/RenameStoreModal', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { RenameStoreModal: ({ store }: { store: { name: string } }) => createElement(Text, null, `Renomeando ${store.name}`) };
});
jest.mock('@/data/images', () => ({ signedImageUrl: jest.fn() }));
jest.mock('@/data/home', () => ({ fetchPantryNear: jest.fn(async () => mockMarket.pantryNear) }));
jest.mock('@/data/market', () => {
  const { LinkIndex: Links } = jest.requireActual<typeof import('@/domain/listLinks')>('@/domain/listLinks');
  const loaded = (data: unknown) => ({ data, isPending: false, isError: false, isFetching: false, error: null, refetch: jest.fn() });
  const links = loaded(new Links([]));
  return {
    useListLinks: () => links,
    useOpenListItems: () => loaded(mockMarket.listItems),
    usePriceObservations: () => loaded([]),
    useProducts: () => loaded(mockMarket.products),
    usePurchaseRecords: () => loaded([]),
    useStores: () => loaded(mockMarket.stores),
  };
});
// As abreviações aprendidas têm os testes delas (learnedAbbreviations.test): aqui, as que o teste der, e se a tela
// pediu os apelidos (só na revisão).
const mockLearning: { learned: unknown; enabled: (boolean | undefined)[] } = { learned: undefined, enabled: [] };
jest.mock('@/data/learnedAbbreviations', () => {
  const { NO_LEARNED } = jest.requireActual<typeof import('@/domain/learnedAbbreviations')>('@/domain/learnedAbbreviations');
  return {
    useLearnedAbbreviations: (options?: { enabled?: boolean }) => {
      mockLearning.enabled.push(options?.enabled);
      return options?.enabled === false ? NO_LEARNED : (mockLearning.learned ?? NO_LEARNED);
    },
    loadLearnedAbbreviations: async () => NO_LEARNED,
  };
});
jest.mock('@/lib/supabase', () => {
  /** O pedido já saiu; a resposta espera quem o teste estiver segurando, ou falha se ele mandou. */
  const answer = async <T,>(request: MockRequest, run: () => T) => {
    await Promise.all(mockDb.holds.filter((held) => held.match(request)).map((held) => held.gate));
    return mockDb.fails.some((fails) => fails(request)) ? { data: null, error: { message: 'caiu a rede' } } : run();
  };
  const table = (name: string) => {
    const filters: [string, unknown][] = [];
    let write: { verb: 'update' | 'insert' | 'delete'; values?: Row } | null = null;
    // Como no servidor: a gravação só devolve as linhas que achou quando o pedido traz .select().
    let returning = false;
    const rows = () => (name === 'receipts' ? mockDb.receipts : name === 'stores' ? mockDb.stores : mockDb.items);
    const matches = (row: Row) => filters.every(([column, value]) => row[column] === value);
    // A nota sai com o mercado de agora, pelo store_id.
    const out = (row: Row): Row => {
      if (name !== 'receipts') return { ...row };
      const store = mockDb.stores.find((entry) => entry.id === row.store_id);
      return { ...row, store: store ? { id: store.id, name: store.name } : null };
    };
    const run = () => {
      const found = rows().filter(matches);
      if (!write) return { data: found.map(out), error: null };
      if (write.verb === 'update') found.forEach((row) => Object.assign(row, write!.values));
      if (write.verb === 'insert') {
        if (name === 'stores') {
          const store = { id: `mercado${mockDb.stores.length}`, ...write.values };
          mockDb.stores.push(store);
          return { data: returning ? [{ ...store }] : null, error: null };
        }
        const added = { id: `novo${mockDb.items.length}`, suggested_name: null, suggested_category: null, product_id: null, ...write.values };
        mockDb.items.push(added);
        return { data: returning ? [{ ...added }] : null, error: null };
      }
      if (write.verb === 'delete') mockDb.items = mockDb.items.filter((row) => !matches(row));
      return { data: returning && write.verb === 'update' ? found.map(out) : null, error: null };
    };
    const send = () => {
      if (write) mockDb.writes.push({ table: name, ...write, filters: Object.fromEntries(filters) });
      else mockDb.reads[name] = (mockDb.reads[name] ?? 0) + 1;
      return answer({ table: name, verb: write?.verb ?? 'select', values: write?.values }, run);
    };
    const builder: Record<string, unknown> = {
      select: () => {
        if (write) returning = true;
        return builder;
      },
      order: () => builder,
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return builder;
      },
      update: (values: Row) => {
        write = { verb: 'update', values };
        return builder;
      },
      insert: (values: Row) => {
        write = { verb: 'insert', values };
        return builder;
      },
      delete: () => {
        write = { verb: 'delete' };
        return builder;
      },
      single: async () => {
        const result = await send();
        const row = (result.data as Row[] | null)?.[0] ?? null;
        // Como no servidor: .single() sem linha nenhuma é erro (PGRST116, a nota que sumiu).
        return { data: row, error: result.error ?? (row ? null : { code: 'PGRST116', message: 'nada encontrado' }) };
      },
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(send).then(resolve, reject),
    };
    return builder;
  };
  return {
    errorMessage: (error: { message?: string }) => error?.message ?? 'Algo deu errado. Tente novamente.',
    unwrap: (result: { data: unknown; error: unknown }) => {
      if (result.error) throw result.error;
      return result.data;
    },
    supabase: {
      from: (name: string) => table(name),
      rpc: async (fn: string, args: Row) => {
        mockDb.rpcs.push({ fn, args });
        return answer({ table: fn, verb: 'rpc', values: args }, () => ({ data: null, error: null }));
      },
    },
  };
});

/** A compra é deste ano: a tela escreve a data sem o ano ("10 jun"). */
const YEAR = new Date().getFullYear();
const receipt = (patch: Row = {}): Row => ({
  id: 'r1',
  store_id: 's1',
  purchased_at: `${YEAR}-06-10T15:00:00.000Z`,
  total: 62.9,
  access_key: null,
  image_path: null,
  extra_image_paths: [],
  source: 'ai',
  status: 'draft',
  created_at: `${YEAR}-06-10T15:05:00.000Z`,
  paid_by: null,
  store: { id: 's1', name: 'Assaí' },
  ...patch,
});
/** Item de limpeza (não vai para a despensa), 1 un, com o preço unitário igual ao total. */
const item = (id: string, raw_description: string, total_price: number, patch: Row = {}): Row => ({
  id,
  receipt_id: 'r1',
  position: mockDb.items.length,
  raw_description,
  suggested_name: raw_description,
  suggested_category: 'limpeza',
  product_id: null,
  quantity: 1,
  unit: 'un',
  unit_price: total_price,
  total_price,
  ...patch,
});
/** A nota, com os itens na ordem dada. */
function seed(note: Row, ...items: Row[]) {
  mockDb.receipts = [note];
  mockDb.items = items.map((row, position) => ({ ...row, position }));
}

let client: QueryClient;
let renderer: ReactTestRenderer | undefined;

const settle = (ms = 30) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
async function open() {
  act(() => {
    renderer = create(
      <QueryClientProvider client={client}>
        <ReceiptScreen />
      </QueryClientProvider>,
    );
  });
  await settle();
}
/** O toque, e o tempo de a gravação ir e a nota voltar do banco. */
async function press(target: ReactTestInstance | undefined) {
  if (!target) throw new Error('botão não encontrado');
  await act(async () => {
    target.props.onPress();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

/** O que um pedaço da tela escreve, um texto por linha (o texto montado em partes, "2 un" + " × " + "R$ 4,30", é um só). */
const said = (node: ReactTestInstance | string): string[] => {
  // Os ícones são letras de uma fonte de desenhos (área de uso privado): não são texto da tela.
  if (typeof node === 'string') return /^[\u{E000}-\u{F8FF}\u{F0000}-\u{10FFFF}]+$/u.test(node) ? [] : [node];
  const parts = node.children;
  return parts.length > 1 && parts.every((part) => typeof part === 'string') ? [parts.join('')] : parts.flatMap(said);
};
/** Tudo o que a tela escreve, na ordem em que aparece. */
const lines = () => said(renderer!.root);
const page = () => lines().join(' | ');
const chip = (label: string, within: ReactTestInstance = renderer!.root) => within.findAllByType(Chip).find((entry) => entry.props.label === label);
const chipLabels = (within: ReactTestInstance = renderer!.root) => within.findAllByType(Chip).map((entry) => entry.props.label as string);
const button = (title: string) => renderer!.root.findAllByType(Button).find((entry) => String(entry.props.title).startsWith(title));
const field = (label: string) => renderer!.root.findAllByType(TextField).find((entry) => entry.props.label === label);
/** O cartão do item com esta descrição. */
const card = (description: string) => renderer!.root.findAllByType(Card).find((entry) => said(entry).includes(description))!;
/** A linha do total da nota, quando dá para tocar nela. */
const totalRow = () => renderer!.root.findAll((node) => typeof node.props.onPress === 'function' && said(node)[0] === 'Total da nota')[0];
const writes = (tableName: string) => mockDb.writes.filter((write) => write.table === tableName);
const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
/** Dois toques seguidos, sem a tela redesenhar entre um e outro. */
async function pressBoth(first: ReactTestInstance | undefined, second: ReactTestInstance | undefined) {
  if (!first || !second) throw new Error('botão não encontrado');
  await act(async () => {
    first.props.onPress();
    second.props.onPress();
    await wait();
  });
}

/**
 * Segura no meio do caminho os pedidos que `match` escolher: eles saem (e
 * ficam anotados) na hora, e a resposta só vem quando o teste chama o que
 * esta função devolve. É assim que se vê a tela com um pedido em andamento.
 */
function hold(match: (request: MockRequest) => boolean) {
  let open!: () => void;
  const held = { match, gate: new Promise<void>((resolve) => (open = resolve)), open };
  mockDb.holds.push(held);
  return async () => {
    mockDb.holds = mockDb.holds.filter((entry) => entry !== held);
    open();
    await settle();
  };
}
const receiptRead = ({ table, verb }: MockRequest) => table === 'receipts' && verb === 'select';
const itemWrite = ({ table, verb }: MockRequest) => table === 'receipt_items' && verb !== 'select';
const totalWrite = ({ table, values }: MockRequest) => table === 'receipts' && values != null && 'total' in values;
const dateWrite = ({ table, values }: MockRequest) => table === 'receipts' && values != null && 'purchased_at' in values;
const storeWrite = ({ table, values }: MockRequest) => table === 'receipts' && values != null && 'store_id' in values;

/** As respostas às perguntas de sim ou não, pelo título; sem resposta marcada, a pessoa cancela. */
let answers: Record<string, boolean> = {};
/** As vezes em que uma pergunta de sim ou não foi feita, pelo título (a dos itens sem valor e a da despensa usam o mesmo diálogo). */
const asked = (title: string) => jest.mocked(askYesNo).mock.calls.filter(([heading]) => heading === title);
const UNPRICED_ONE = ['1 item está sem valor', 'Ele entra como R$ 0,00 nos gastos. Confirmar assim mesmo?', 'Confirmar', 'Cancelar'];
const UNPRICED_TWO = ['2 itens estão sem valor', 'Eles entram como R$ 0,00 nos gastos. Confirmar assim mesmo?', 'Confirmar', 'Cancelar'];
/** Nenhuma pergunta antes de confirmar: nem a dos itens sem valor, nem a da despensa, nem a do mercado. */
function expectNoQuestion() {
  expect(askYesNo).not.toHaveBeenCalled();
  expect(confirmAction).not.toHaveBeenCalled();
}

/** A frase da nota confirmada (a mesma para toda nota): o que se corrige fica na casa. */
const CORRECTION_NOTE =
  'O que você corrigir aqui vale só para a casa (gastos, Mercado do mês e histórico de preço) e não vai para os preços compartilhados entre casas.';

/** Quem lê preço de nota confirmada: comparativo, histórico de um produto, gastos do mês e compras recentes. */
const PRICE_QUERIES = [['latestPrices'], ['priceHistory', 'p1'], ['spending', '2026-06', '2026-06'], ['purchaseRecords']];
const invalidated = () => PRICE_QUERIES.filter((key) => client.getQueryState(key)?.isInvalidated).map((key) => key[0]);

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { networkMode: 'always', gcTime: Infinity } } });
  for (const key of PRICE_QUERIES) client.setQueryData(key, []);
  mockDb.stores = [{ id: 's1', name: 'Assaí' }];
  mockDb.writes = [];
  mockDb.rpcs = [];
  mockDb.reads = {};
  mockDb.holds = [];
  mockDb.fails = [];
  mockMarket.products = [];
  mockMarket.pantryNear = [];
  mockMarket.listItems = [];
  mockMarket.stores = [{ id: 's1', name: 'Assaí', cnpj: null, address: null }];
  mockLearning.learned = undefined;
  mockLearning.enabled = [];
  answers = {};
  jest.mocked(confirmAction).mockReset();
  jest.mocked(askYesNo).mockReset();
  jest.mocked(askYesNo).mockImplementation(async (title) => answers[title] ?? false);
  jest.mocked(notify).mockReset();
  jest.mocked(router.back).mockReset();
  jest.mocked(fetchPantryNear).mockClear();
});

afterEach(async () => {
  // Nada fica preso de um teste para o outro.
  mockDb.holds.forEach((held) => held.open());
  mockDb.holds = [];
  await settle();
  await act(async () => renderer?.unmount());
  renderer = undefined;
  client.clear();
});

describe('nota em revisão: um item sem valor e o total da nota', () => {
  beforeEach(() => seed(receipt(), item('a', 'DETERGENTE YPE', 50), item('x', 'QJO MUSS KG', 0, { quantity: 0.345, unit: 'kg' })));

  it('o item pergunta, sugere o que falta para o total e avisa do desconto', async () => {
    await open();
    expect(said(card('QJO MUSS KG'))).toEqual([
      'QJO MUSS KG',
      '0,345 kg',
      'sem valor',
      'Novo: QJO MUSS KG',
      'Limpeza',
      'Faltam R$ 12,90 para o total da nota. Pode ser o valor deste item.',
      'Usar R$ 12,90',
      'Preencher valor',
      'Deixar sem valor',
      'Se a nota teve desconto, o valor impresso do item é maior.',
      'Não vai para a despensa',
    ]);
    expect(page()).toContain('Soma dos itens | R$ 50,00 | Total da nota | R$ 62,90');
    expect(page()).toContain('Faltam R$ 12,90: a soma dos itens é menor que o total da nota. | 1 item sem valor.');
    // O item que tem valor continua como era.
    expect(said(card('DETERGENTE YPE'))).toEqual(['DETERGENTE YPE', '1 un × R$ 50,00', 'R$ 50,00', 'Novo: DETERGENTE YPE', 'Limpeza', 'Não vai para a despensa']);
    // Nada foi gravado sozinho.
    expect(mockDb.writes).toEqual([]);
  });

  it('"Usar R$ 12,90" grava o total e o preço unitário que sai da quantidade, e a pergunta vai embora', async () => {
    await open();
    await press(chip('Usar R$ 12,90'));
    // Só o valor vai no pedido (a descrição não), e só para o item que ainda está sem valor: o mesmo caminho da nota confirmada.
    expect(writes('receipt_items')).toEqual([
      {
        table: 'receipt_items',
        verb: 'update',
        values: { unit_price: 37.3913, total_price: 12.9 },
        filters: { id: 'x', receipt_id: 'r1', total_price: 0 },
      },
    ]);
    expect(said(card('QJO MUSS KG'))).toEqual(['QJO MUSS KG', '0,345 kg × R$ 37,39', 'R$ 12,90', 'Novo: QJO MUSS KG', 'Limpeza', 'Não vai para a despensa']);
    expect(page()).not.toContain('Faltam');
    expect(page()).not.toContain('sem valor');
    expect(notify).not.toHaveBeenCalled();
    // A nota pode ter sido confirmada em outro aparelho: o que lê preço de nota confirmada é refeito também.
    expect(invalidated()).toEqual(['latestPrices', 'priceHistory', 'spending', 'purchaseRecords']);
    // E a nota é relida uma vez só depois de gravar.
    expect(mockDb.reads.receipts).toBe(2);
  });

  it('"Usar" não regrava o que mudou em outro aparelho: a descrição corrigida lá continua', async () => {
    await open();
    Object.assign(mockDb.items[1], { raw_description: 'QUEIJO MUSSARELA FATIADO' });
    await press(chip('Usar R$ 12,90'));
    expect(mockDb.items[1]).toMatchObject({ raw_description: 'QUEIJO MUSSARELA FATIADO', total_price: 12.9 });
    expect(said(card('QUEIJO MUSSARELA FATIADO'))).toContain('R$ 12,90');
  });

  it('item que já ganhou valor em outro aparelho: "Usar" não grava por cima, avisa e a nota é relida', async () => {
    await open();
    Object.assign(mockDb.items[1], { unit_price: 28.99, total_price: 10 });
    await press(chip('Usar R$ 12,90'));
    expect(mockDb.items[1]).toMatchObject({ unit_price: 28.99, total_price: 10 });
    expect(jest.mocked(notify).mock.calls).toEqual([['Valor não salvo', 'Este item já tem valor ou não existe mais.']]);
    expect(said(card('QJO MUSS KG'))).toEqual(['QJO MUSS KG', '0,345 kg × R$ 28,99', 'R$ 10,00', 'Novo: QJO MUSS KG', 'Limpeza', 'Não vai para a despensa']);
  });

  it('item apagado em outro aparelho: "Usar" avisa do mesmo jeito, e o item sai da tela', async () => {
    await open();
    mockDb.items = mockDb.items.filter((row) => row.id !== 'x');
    await press(chip('Usar R$ 12,90'));
    expect(notify).toHaveBeenCalledWith('Valor não salvo', 'Este item já tem valor ou não existe mais.');
    expect(page()).not.toContain('QJO MUSS KG');
    expect(page()).toContain('Itens (1)');
  });

  it('"Usar" que falha avisa do erro, e a pergunta continua no item', async () => {
    mockDb.fails = [itemWrite];
    await open();
    await press(chip('Usar R$ 12,90'));
    expect(jest.mocked(notify).mock.calls).toEqual([['Erro', 'caiu a rede']]);
    expect(chip('Usar R$ 12,90')).toBeDefined();
    expect(button('Confirmar nota')!.props.loading).toBe(false);
  });

  it('do toque em "Usar" até a nota voltar do banco, "Confirmar nota" fica ocupado e não pergunta pelo item que acabou de ganhar valor', async () => {
    await open();
    const releaseWrite = hold(itemWrite);
    const releaseRead = hold(receiptRead);
    await press(chip('Usar R$ 12,90'));
    // A gravação ainda está a caminho.
    expect(mockDb.items[1].total_price).toBe(0);
    expect(button('Confirmar nota')!.props.loading).toBe(true);
    await press(button('Confirmar nota'));
    expectNoQuestion();

    // A gravação terminou; a nota relida ainda não chegou, e a tela continua com o item sem valor.
    await releaseWrite();
    expect(mockDb.items[1].total_price).toBe(12.9);
    expect(said(card('QJO MUSS KG'))).toContain('sem valor');
    expect(button('Confirmar nota')!.props.loading).toBe(true);
    await press(button('Confirmar nota'));
    expectNoQuestion();
    expect(mockDb.rpcs).toEqual([]);
    // Outro toque em "Usar" nesse meio não manda nada (acharia o item já com valor, e avisaria à toa).
    await press(chip('Usar R$ 12,90'));
    expect(writes('receipt_items')).toHaveLength(1);
    expect(notify).not.toHaveBeenCalled();

    // A nota voltou: o item tem valor, e confirmar não tem o que perguntar.
    await releaseRead();
    expect(said(card('QJO MUSS KG'))).toContain('R$ 12,90');
    expect(button('Confirmar nota')!.props.loading).toBe(false);
    await press(button('Confirmar nota'));
    expectNoQuestion();
    expect(mockDb.rpcs).toHaveLength(1);
  });

  it('outra gravação que termina no meio da releitura não solta "Confirmar nota" antes de a nota voltar', async () => {
    await open();
    const releaseRead = hold(receiptRead);
    await press(chip('Usar R$ 12,90'));
    // A data é salva com a nota relida ainda a caminho: essa releitura é trocada por outra, mais nova.
    act(() => field('Data da compra')!.props.onChangeText(`11/06/${YEAR}`));
    await act(async () => {
      field('Data da compra')!.props.onBlur();
      await wait();
    });
    expect(mockDb.reads.receipts).toBe(3);
    expect(said(card('QJO MUSS KG'))).toContain('sem valor');
    expect(button('Confirmar nota')!.props.loading).toBe(true);
    await press(button('Confirmar nota'));
    expectNoQuestion();
    await releaseRead();
    expect(said(card('QJO MUSS KG'))).toContain('R$ 12,90');
    expect(button('Confirmar nota')!.props.loading).toBe(false);
  });

  it('a nota não volta do banco (a rede caiu depois da gravação): a espera tem limite, e "Confirmar nota" deixa de girar', async () => {
    await open();
    // Esta releitura nunca vai ter resposta.
    hold(receiptRead);
    await press(chip('Usar R$ 12,90'));
    expect(button('Confirmar nota')!.props.loading).toBe(true);
    await settle(4200);
    expect(button('Confirmar nota')!.props.loading).toBe(false);
  }, 15_000);

  it('com o total digitado a caminho, "Usar R$ …" tocado nesse meio para a confirmação: ela não pergunta pelo item que acabou de ganhar valor', async () => {
    await open();
    await press(totalRow());
    act(() => field('Total da nota')!.props.onChangeText('62,90'));
    const releaseTotal = hold(totalWrite);
    await press(button('Confirmar nota'));
    await press(chip('Usar R$ 12,90'));
    await releaseTotal();
    await settle();
    expectNoQuestion();
    expect(mockDb.rpcs).toEqual([]);
    expect(said(card('QJO MUSS KG'))).toContain('R$ 12,90');
  });

  it('com o total digitado a caminho, "Deixar sem valor" tocado nesse meio vale: a confirmação segue sem perguntar', async () => {
    await open();
    await press(totalRow());
    act(() => field('Total da nota')!.props.onChangeText('62,90'));
    const releaseTotal = hold(totalWrite);
    await press(button('Confirmar nota'));
    await press(chip('Deixar sem valor'));
    await releaseTotal();
    await settle();
    expect(asked('1 item está sem valor')).toEqual([]);
    expect(mockDb.rpcs).toHaveLength(1);
  });

  it('o valor é gravado e a nota não volta do banco (a busca falha): a pessoa fica sabendo que salvou, e o item não pergunta de novo', async () => {
    await open();
    // A gravação chega; a busca da nota, logo depois, falha.
    mockDb.fails = [receiptRead];
    await press(chip('Usar R$ 12,90'));
    await settle();
    expect(mockDb.items[1]).toMatchObject({ total_price: 12.9 });
    expect(jest.mocked(notify).mock.calls).toEqual([['Valor salvo', 'Não deu para atualizar a nota na tela: o item pode aparecer sem valor até ela ser buscada de novo.']]);
    // Com a busca da nota falhando, a nota continua na tela, com o aviso de cima: nada de "Usar" outra vez.
    expect(page()).toContain('Não foi possível atualizar. Mostrando o que já estava carregado.');
    expect(chip('Usar R$ 12,90')).toBeUndefined();
    // A rede volta e a nota é buscada de novo: o item aparece com o valor que foi gravado, sem pergunta.
    mockDb.fails = [];
    await act(async () => {
      await client.refetchQueries({ queryKey: ['receipt', 'r1'] });
    });
    await settle();
    expect(said(card('QJO MUSS KG'))).toContain('R$ 12,90');
    expect(chip('Usar R$ 12,90')).toBeUndefined();
    expect(button('Confirmar nota')!.props.loading).toBe(false);
    await press(button('Confirmar nota'));
    expect(asked('1 item está sem valor')).toEqual([]);
    expect(mockDb.rpcs).toHaveLength(1);
  });

  it('"Usar" e "Confirmar nota" no mesmo instante: a confirmação não anda nem pergunta', async () => {
    await open();
    await pressBoth(chip('Usar R$ 12,90'), button('Confirmar nota'));
    expectNoQuestion();
    expect(mockDb.rpcs).toEqual([]);
    expect(writes('receipt_items')).toHaveLength(1);
  });

  it('valor salvo pelo formulário: o mesmo intervalo, até a nota voltar do banco', async () => {
    await open();
    await press(chip('Preencher valor'));
    act(() => field('Total do item')!.props.onChangeText('13,08'));
    const releaseRead = hold(receiptRead);
    await press(button('Salvar item'));
    // O formulário fechou com a gravação; a tela de trás ainda mostra o item sem valor.
    expect(field('Total do item')).toBeUndefined();
    expect(said(card('QJO MUSS KG'))).toContain('sem valor');
    expect(button('Confirmar nota')!.props.loading).toBe(true);
    await press(button('Confirmar nota'));
    expectNoQuestion();
    expect(mockDb.rpcs).toEqual([]);
    await releaseRead();
    expect(button('Confirmar nota')!.props.loading).toBe(false);
    await press(button('Confirmar nota'));
    expectNoQuestion();
    expect(mockDb.rpcs).toHaveLength(1);
  });

  it('lápis no item sem valor: salvar só com o nome corrigido é recusado, e o aviso diz que 0 deixa sem valor', async () => {
    await open();
    const pencil = (description: string) => renderer!.root.findAllByType(IconButton).find((entry) => entry.props.label === `Editar ${description}`);
    await press(pencil('QJO MUSS KG'));
    act(() => field('Descrição')!.props.onChangeText('QUEIJO MUSSARELA'));
    await press(button('Salvar item'));
    expect(jest.mocked(notify).mock.calls).toEqual([['Confira o item', 'Informe o preço unitário ou o total (0 para deixar sem valor).']]);
    expect(mockDb.writes).toEqual([]);
    expect(field('Descrição')).toBeDefined();
    // O item que abriu com valor continua com o aviso de sempre.
    await press(renderer!.root.findAllByType(IconButton).find((entry) => entry.props.label === 'Fechar'));
    await press(pencil('DETERGENTE YPE'));
    act(() => field('Preço unitário')!.props.onChangeText(''));
    act(() => field('Total do item')!.props.onChangeText(''));
    await press(button('Salvar item'));
    expect(jest.mocked(notify).mock.calls[1]).toEqual(['Confira o item', 'Informe o preço unitário ou o total.']);
    expect(mockDb.writes).toEqual([]);
  });

  it('"Preencher valor" abre o formulário do item com os dois preços em branco: só o preço unitário já calcula o total', async () => {
    await open();
    await press(chip('Preencher valor'));
    expect(field('Descrição')!.props.value).toBe('QJO MUSS KG');
    expect(field('Quantidade')!.props.value).toBe('0,345');
    expect(field('Preço unitário')!.props.value).toBe('');
    expect(field('Total do item')!.props.value).toBe('');
    act(() => field('Preço unitário')!.props.onChangeText('37,90'));
    await press(button('Salvar item'));
    expect(writes('receipt_items')[0].values).toEqual({ raw_description: 'QJO MUSS KG', quantity: 0.345, unit: 'kg', unit_price: 37.9, total_price: 13.08 });
    expect(said(card('QJO MUSS KG'))).toContain('R$ 13,08');
    expect(page()).not.toContain('sem valor');
  });

  it('zero digitado de propósito no formulário é a resposta da pessoa: o item fica sem valor e não pergunta de novo', async () => {
    await open();
    await press(chip('Preencher valor'));
    act(() => field('Total do item')!.props.onChangeText('0'));
    await press(button('Salvar item'));
    expect(writes('receipt_items')[0].values).toMatchObject({ unit_price: 0, total_price: 0 });
    expect(said(card('QJO MUSS KG'))).toEqual(['QJO MUSS KG', '0,345 kg', 'sem valor', 'Novo: QJO MUSS KG', 'Limpeza', 'Não vai para a despensa']);
    await press(button('Confirmar nota'));
    expectNoQuestion();
    expect(mockDb.rpcs).toHaveLength(1);
  });

  it('zero digitado de propósito num item novo vale igual: o item entra sem valor, sem perguntar, e confirmar não pergunta por ele', async () => {
    seed(receipt({ total: 50 }), item('a', 'DETERGENTE YPE', 50));
    await open();
    await press(button('Item'));
    act(() => field('Descrição')!.props.onChangeText('BRINDE SACOLA'));
    act(() => field('Total do item')!.props.onChangeText('0'));
    await press(button('Salvar item'));
    expect(writes('receipt_items')[0]).toMatchObject({ verb: 'insert', values: { raw_description: 'BRINDE SACOLA', unit_price: 0, total_price: 0 } });
    // A nota voltou com o item novo: ele está sem valor, e é a resposta da pessoa.
    const added = said(card('BRINDE SACOLA'));
    expect(added).toContain('sem valor');
    expect(chipLabels(card('BRINDE SACOLA'))).not.toContain('Deixar sem valor');
    expect(chipLabels(card('BRINDE SACOLA'))).not.toContain('Preencher valor');
    await press(button('Confirmar nota'));
    expect(asked('1 item está sem valor')).toEqual([]);
    expect(mockDb.rpcs).toHaveLength(1);
  });

  it('item novo sem zero nenhum (o total em branco é recusado pelo formulário): nada é gravado', async () => {
    seed(receipt({ total: 50 }), item('a', 'DETERGENTE YPE', 50));
    await open();
    await press(button('Item'));
    act(() => field('Descrição')!.props.onChangeText('BRINDE SACOLA'));
    await press(button('Salvar item'));
    expect(mockDb.writes).toEqual([]);
    expect(field('Descrição')).toBeDefined();
  });

  it('"Deixar sem valor": a pergunta sai, o "sem valor" fica, e confirmar não pergunta por esse item', async () => {
    await open();
    await press(chip('Deixar sem valor'));
    expect(said(card('QJO MUSS KG'))).toEqual(['QJO MUSS KG', '0,345 kg', 'sem valor', 'Novo: QJO MUSS KG', 'Limpeza', 'Não vai para a despensa']);
    // Nada foi gravado: a decisão é desta revisão.
    expect(mockDb.writes).toEqual([]);
    await press(button('Confirmar nota'));
    expectNoQuestion();
    expect(mockDb.rpcs).toEqual([{ fn: 'confirm_receipt', args: { p_receipt_id: 'r1', p_items: [expect.objectContaining({ id: 'a' }), expect.objectContaining({ id: 'x' })] } }]);
  });

  it('abrir a nota de novo pergunta de novo', async () => {
    await open();
    await press(chip('Deixar sem valor'));
    await act(async () => renderer?.unmount());
    await open();
    expect(chipLabels(card('QJO MUSS KG'))).toEqual(expect.arrayContaining(['Usar R$ 12,90', 'Preencher valor', 'Deixar sem valor']));
  });

  it('dois toques em "Confirmar nota": uma pergunta só, e uma confirmação só', async () => {
    // A pergunta fica aberta até o teste responder.
    let answer!: (yes: boolean) => void;
    jest.mocked(askYesNo).mockImplementation(() => new Promise<boolean>((resolve) => (answer = resolve)));
    await open();
    await pressBoth(button('Confirmar nota'), button('Confirmar nota'));
    expect(jest.mocked(askYesNo).mock.calls).toEqual([UNPRICED_ONE]);
    // Com a pergunta aberta, outro toque (já com a tela redesenhada) também não abre a segunda.
    await press(button('Confirmar nota'));
    expect(askYesNo).toHaveBeenCalledTimes(1);
    expect(mockDb.rpcs).toEqual([]);

    await act(async () => {
      answer(true);
      await wait();
    });
    expect(askYesNo).toHaveBeenCalledTimes(1);
    expect(mockDb.rpcs).toHaveLength(1);
    expect(jest.mocked(notify).mock.calls).toEqual([['Nota salva', undefined]]);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('a pergunta cancelada (ou dispensada) solta a trava: o próximo toque pergunta de novo', async () => {
    await open();
    await press(button('Confirmar nota'));
    await press(button('Confirmar nota'));
    expect(jest.mocked(askYesNo).mock.calls).toEqual([UNPRICED_ONE, UNPRICED_ONE]);
    expect(mockDb.rpcs).toEqual([]);
    // Cancelar não é decidir: o item continua perguntando.
    expect(chip('Deixar sem valor')).toBeDefined();
  });
});

describe('a nota em tela atrás do que foi gravado', () => {
  const cheese = () => item('x', 'QJO MUSS KG', 0, { quantity: 0.345, unit: 'kg' });
  const pencil = (description: string) => renderer!.root.findAllByType(IconButton).find((entry) => entry.props.label === `Editar ${description}`);
  /** Os itens que foram na confirmação. */
  const confirmed = () => (mockDb.rpcs[0].args.p_items as Row[]).map((entry) => entry.id);
  const CAUGHT_UP = ['Nota atualizada', 'Confira os itens e toque em "Confirmar nota" de novo.'];

  it('item novo salvo e a nota que demora a voltar: "Confirmar nota" não vai com os itens de antes; busca a nota e pede o toque de novo', async () => {
    seed(receipt({ total: 60 }), item('a', 'DETERGENTE YPE', 50));
    await open();
    await press(button('Item'));
    act(() => field('Descrição')!.props.onChangeText('SABAO EM PO'));
    act(() => field('Total do item')!.props.onChangeText('10'));
    const releaseRead = hold(receiptRead);
    await press(button('Salvar item'));
    // O item está no banco; a nota relida não chega, e a espera tem limite.
    expect(mockDb.items).toHaveLength(2);
    expect(button('Confirmar nota')!.props.loading).toBe(true);
    await settle(4200);
    expect(button('Confirmar nota')!.props).toMatchObject({ loading: false, title: 'Confirmar nota (1 item)' });

    // Confirmar com os itens de antes deixaria o item novo sem produto, fora da despensa e da lista: a tela
    // busca a nota, e ela ainda não vem.
    await press(button('Confirmar nota'));
    expect(button('Confirmar nota')!.props.loading).toBe(true);
    await settle(4200);
    expect(mockDb.rpcs).toEqual([]);
    expect(jest.mocked(notify).mock.calls).toEqual([
      ['A nota ainda não atualizou', 'Os itens na tela podem estar diferentes do que foi salvo. Confira a internet e toque em "Confirmar nota" de novo.'],
    ]);
    expect(button('Confirmar nota')!.props.loading).toBe(false);

    // No toque seguinte a nota chega: a pessoa confere e toca de novo.
    await press(button('Confirmar nota'));
    await releaseRead();
    expect(mockDb.rpcs).toEqual([]);
    expect(jest.mocked(notify).mock.calls[1]).toEqual(CAUGHT_UP);
    expect(button('Confirmar nota')!.props).toMatchObject({ loading: false, title: 'Confirmar nota (2 itens)' });
    expect(page()).toContain('SABAO EM PO');

    await press(button('Confirmar nota'));
    expect(confirmed()).toEqual(['a', 'novo1']);
    expect(jest.mocked(notify).mock.calls).toHaveLength(3);
  }, 20_000);

  it('item novo salvo e a busca da nota que falha: o aviso é o do item, e depois de buscar de novo a confirmação leva os dois', async () => {
    seed(receipt({ total: 60 }), item('a', 'DETERGENTE YPE', 50));
    await open();
    await press(button('Item'));
    act(() => field('Descrição')!.props.onChangeText('SABAO EM PO'));
    act(() => field('Total do item')!.props.onChangeText('10'));
    mockDb.fails = [receiptRead];
    await press(button('Salvar item'));
    await settle();
    expect(jest.mocked(notify).mock.calls).toEqual([['Item salvo', 'Não deu para atualizar a nota na tela: o item aparece quando ela for buscada de novo.']]);
    // A nota continua na tela, com o aviso de cima. "Confirmar nota" não vai com os itens de antes: busca a nota e avisa.
    expect(page()).toContain('Não foi possível atualizar. Mostrando o que já estava carregado.');
    await press(button('Confirmar nota'));
    expect(jest.mocked(notify).mock.calls.at(-1)).toEqual([
      'Não deu para buscar a nota',
      'Os itens na tela podem estar diferentes do que foi salvo. Toque em "Tentar de novo" e confira antes de confirmar.',
    ]);
    expect(mockDb.rpcs).toEqual([]);
    mockDb.fails = [];
    await act(async () => {
      await client.refetchQueries({ queryKey: ['receipt', 'r1'] });
    });
    await settle();
    await press(button('Confirmar nota'));
    expect(confirmed()).toEqual(['a', 'novo1']);
  });

  it('item que já ganhou valor em outro aparelho e a nota que não volta: o aviso é só o de que não salvou', async () => {
    seed(receipt(), item('a', 'DETERGENTE YPE', 50), cheese());
    await open();
    Object.assign(mockDb.items[1], { unit_price: 28.99, total_price: 10 });
    mockDb.fails = [receiptRead];
    await press(chip('Usar R$ 12,90'));
    await settle();
    expect(mockDb.items[1]).toMatchObject({ unit_price: 28.99, total_price: 10 });
    // Nada desta tela foi gravado: nenhum "Valor salvo" por cima do aviso.
    expect(jest.mocked(notify).mock.calls).toEqual([['Valor não salvo', 'Este item já tem valor ou não existe mais.']]);
    // A rede volta: a tela mostra o valor que o outro aparelho deu, e o item volta a valer como está no banco.
    mockDb.fails = [];
    await act(async () => {
      await client.refetchQueries({ queryKey: ['receipt', 'r1'] });
    });
    await settle();
    expect(said(card('QJO MUSS KG'))).toContain('R$ 10,00');
    await press(button('Confirmar nota'));
    expectNoQuestion();
    expect(confirmed()).toEqual(['a', 'x']);
  });

  it('item que já ganhou valor em outro aparelho e a nota que demora: o item continua perguntando, e "Confirmar nota" busca a nota antes', async () => {
    seed(receipt(), item('a', 'DETERGENTE YPE', 50), cheese());
    await open();
    Object.assign(mockDb.items[1], { unit_price: 28.99, total_price: 10 });
    const releaseRead = hold(receiptRead);
    await press(chip('Usar R$ 12,90'));
    await settle(4200);
    expect(jest.mocked(notify).mock.calls).toEqual([['Valor não salvo', 'Este item já tem valor ou não existe mais.']]);
    // Nada foi gravado por esta tela: o item não é dado como resolvido.
    expect(chip('Usar R$ 12,90')).toBeDefined();
    await press(button('Confirmar nota'));
    await releaseRead();
    expectNoQuestion();
    expect(mockDb.rpcs).toEqual([]);
    expect(jest.mocked(notify).mock.calls[1]).toEqual(CAUGHT_UP);
    expect(said(card('QJO MUSS KG'))).toContain('R$ 10,00');
  }, 15_000);

  it('gravação que fica sem resposta: não dá para saber se gravou, e "Confirmar nota" busca a nota antes de seguir', async () => {
    seed(receipt(), item('a', 'DETERGENTE YPE', 50), cheese());
    await open();
    mockDb.fails = [itemWrite];
    await press(chip('Usar R$ 12,90'));
    expect(jest.mocked(notify).mock.calls).toEqual([['Erro', 'caiu a rede']]);
    // A gravação tinha chegado ao banco: foi a resposta que se perdeu.
    mockDb.fails = [];
    Object.assign(mockDb.items[1], { unit_price: 37.3913, total_price: 12.9 });
    await press(button('Confirmar nota'));
    // Sem perguntar pelo item que a tela ainda mostra sem valor, e sem confirmar com ele assim.
    expectNoQuestion();
    expect(mockDb.rpcs).toEqual([]);
    expect(jest.mocked(notify).mock.calls[1]).toEqual(CAUGHT_UP);
    expect(said(card('QJO MUSS KG'))).toContain('R$ 12,90');
    await press(button('Confirmar nota'));
    expectNoQuestion();
    expect(confirmed()).toEqual(['a', 'x']);
  });

  it('item removido: até a nota voltar sem ele, "Confirmar nota" espera, e não vai com o item apagado nem pergunta por ele', async () => {
    seed(receipt({ total: 50 }), item('a', 'DETERGENTE YPE', 50), cheese());
    await open();
    await press(pencil('QJO MUSS KG'));
    const releaseRead = hold(receiptRead);
    await press(button('Remover item'));
    expect(mockDb.items).toHaveLength(1);
    expect(button('Confirmar nota')!.props.loading).toBe(true);
    await press(button('Confirmar nota'));
    expectNoQuestion();
    expect(mockDb.rpcs).toEqual([]);
    await releaseRead();
    expect(button('Confirmar nota')!.props).toMatchObject({ loading: false, title: 'Confirmar nota (1 item)' });
    await press(button('Confirmar nota'));
    expectNoQuestion();
    expect(confirmed()).toEqual(['a']);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('sem nota nenhuma na tela, a busca que falha é a tela do erro, com "Tentar de novo" que busca de novo', async () => {
    seed(receipt(), item('i1', 'DETERGENTE YPE', 50));
    mockDb.fails = [receiptRead];
    await open();
    expect(page()).toContain('caiu a rede');
    expect(page()).not.toContain('DETERGENTE YPE');
    mockDb.fails = [];
    await press(button('Tentar de novo'));
    await settle();
    expect(page()).toContain('DETERGENTE YPE');
  });

  it('remover que falha avisa do erro, como antes', async () => {
    seed(receipt({ total: 50 }), item('a', 'DETERGENTE YPE', 50), cheese());
    await open();
    await press(pencil('QJO MUSS KG'));
    mockDb.fails = [itemWrite];
    await press(button('Remover item'));
    expect(jest.mocked(notify).mock.calls).toEqual([['Erro', 'caiu a rede']]);
    expect(mockDb.items).toHaveLength(2);
    expect(button('Confirmar nota')!.props.loading).toBe(false);
  });
});

describe('nota em revisão: dois itens sem valor', () => {
  beforeEach(() =>
    seed(receipt({ store_id: null, store: null }), item('a', 'ARROZ TIO JOAO 5KG', 50, { suggested_name: 'Arroz', suggested_category: 'graos' }), item('x', 'QJO MUSS KG', 0), item('y', 'SACOLA', 0)),
  );

  it('cada um só pergunta: sem saber quanto é de cada um, não há sugestão', async () => {
    await open();
    for (const description of ['QJO MUSS KG', 'SACOLA']) {
      const texts = said(card(description));
      expect(texts).toContain('Sem valor: a leitura não pegou o preço deste item.');
      expect(texts).toContain('sem valor');
      expect(chipLabels(card(description))).toEqual([`Novo: ${description}`, 'Limpeza', 'Preencher valor', 'Deixar sem valor', 'Não vai para a despensa']);
    }
    expect(page()).not.toContain('Usar R$');
    expect(page()).not.toContain('Se a nota teve desconto');
    expect(page()).toContain('Faltam R$ 12,90: a soma dos itens é menor que o total da nota. | 2 itens sem valor.');
  });

  it('confirmar pergunta uma vez pelos itens sem valor, antes da despensa e do mercado; cancelar não confirma nada', async () => {
    mockMarket.pantryNear = [{ product_id: null, name: 'Arroz', purchased_on: `${YEAR}-06-09` }];
    const PANTRY = ['Já está na despensa', 'Arroz já está na despensa, da compra de 9 jun. Colocar de novo?', 'Colocar de novo', 'Não colocar'];
    await open();
    await press(button('Confirmar nota'));
    expect(jest.mocked(askYesNo).mock.calls).toEqual([UNPRICED_TWO]);
    // A pessoa cancelou (ou dispensou a pergunta): nada anda, nem a conferência da despensa, nem a confirmação.
    expect(fetchPantryNear).not.toHaveBeenCalled();
    expect(confirmAction).not.toHaveBeenCalled();
    expect(mockDb.rpcs).toEqual([]);

    // Tocou de novo: a pergunta volta. "Confirmar": seguem as perguntas de sempre, na ordem de sempre.
    answers['2 itens estão sem valor'] = true;
    await press(button('Confirmar nota'));
    expect(jest.mocked(askYesNo).mock.calls).toEqual([UNPRICED_TWO, UNPRICED_TWO, PANTRY]);
    expect(jest.mocked(confirmAction).mock.calls.map(([title, message, label, , destructive]) => [title, message, label, destructive])).toEqual([
      ['Nota sem mercado', 'Sem o mercado, os preços desta nota não entram no comparativo. Salvar mesmo assim?', 'Salvar', false],
    ]);
    expect(mockDb.rpcs).toEqual([]);
    // A pessoa cancela a do mercado e toca em confirmar outra vez: a dos itens sem valor já foi respondida.
    await press(button('Confirmar nota'));
    expect(asked('2 itens estão sem valor')).toHaveLength(2);
    expect(asked('Já está na despensa')).toHaveLength(2);
    expect(jest.mocked(confirmAction).mock.calls.map(([title]) => title)).toEqual(['Nota sem mercado', 'Nota sem mercado']);
    // E as perguntas dos itens saíram junto.
    expect(page()).not.toContain('Sem valor: a leitura não pegou');

    await act(async () => {
      jest.mocked(confirmAction).mock.calls[1][3]();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    // O que vai para confirm_receipt é o de sempre: os três itens, e o arroz sem repetir na despensa.
    expect(mockDb.rpcs).toEqual([
      {
        fn: 'confirm_receipt',
        args: {
          p_receipt_id: 'r1',
          p_items: [
            { id: 'a', new_product: { name: 'Arroz', category: 'graos' } },
            { id: 'x', new_product: { name: 'QJO MUSS KG', category: 'limpeza' } },
            { id: 'y', new_product: { name: 'SACOLA', category: 'limpeza' } },
          ],
        },
      },
    ]);
    expect(notify).toHaveBeenCalledWith('Nota salva', undefined);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('um deixado de propósito, o outro não: a pergunta é só pelo que falta decidir', async () => {
    await open();
    await press(chip('Deixar sem valor', card('SACOLA')));
    await press(button('Confirmar nota'));
    expect(jest.mocked(askYesNo).mock.calls).toEqual([UNPRICED_ONE]);
  });
});

describe('o aviso do cabeçalho diz o que é a diferença', () => {
  const header = () => said(renderer!.root.findAllByType(Card)[0]);

  it('a soma menor que o total, sem item sem valor', async () => {
    seed(receipt(), item('a', 'DETERGENTE YPE', 50));
    await open();
    expect(header()).toEqual(['Mercado', 'Assaí', 'Data da compra', 'Soma dos itens', 'R$ 50,00', 'Total da nota', 'R$ 62,90', 'Faltam R$ 12,90: a soma dos itens é menor que o total da nota.']);
    expect(page()).not.toContain('A soma não bate');
  });

  it('a soma maior que o total: pode ser desconto', async () => {
    seed(receipt({ total: 45 }), item('a', 'DETERGENTE YPE', 50));
    await open();
    expect(header()).toEqual(['Mercado', 'Assaí', 'Data da compra', 'Soma dos itens', 'R$ 50,00', 'Total da nota', 'R$ 45,00', 'A soma dos itens passa do total em R$ 5,00. Pode ser desconto.']);
  });

  it.each([
    ['5 centavos a menos', 50.05],
    ['5 centavos a mais', 49.95],
    ['a soma no total', 50],
  ])('dentro da tolerância (%s), nada', async (_why, total) => {
    seed(receipt({ total }), item('a', 'DETERGENTE YPE', 50));
    await open();
    expect(header()).toEqual(['Mercado', 'Assaí', 'Data da compra', 'Soma dos itens', 'R$ 50,00', 'Total da nota', formatBRL(total)]);
    expect(page()).not.toContain('Faltam');
    expect(page()).not.toContain('passa do total');
  });

  it('6 centavos já é aviso, e ele não trava a confirmação', async () => {
    seed(receipt({ total: 50.06 }), item('a', 'DETERGENTE YPE', 50));
    await open();
    expect(header()).toContain('Faltam R$ 0,06: a soma dos itens é menor que o total da nota.');
    await press(button('Confirmar nota'));
    expectNoQuestion();
    expect(mockDb.rpcs).toHaveLength(1);
  });

  it('total zerado que a leitura gravou é "sem total": convida a informar, sem aviso de desconto nem sugestão', async () => {
    seed(receipt({ total: 0 }), item('a', 'DETERGENTE YPE', 50), item('x', 'SACOLA', 0));
    await open();
    expect(header()).toEqual(['Mercado', 'Assaí', 'Data da compra', 'Soma dos itens', 'R$ 50,00', 'Total da nota', 'informar']);
    expect(page()).not.toContain('passa do total');
    expect(said(card('SACOLA'))).toContain('Sem valor: a leitura não pegou o preço deste item.');
    expect(page()).not.toContain('Usar R$');
    // O campo abre em branco, como o da nota sem total.
    await press(totalRow());
    expect(field('Total da nota')!.props.value).toBe('');
  });

  it('nota confirmada com total zerado: a linha convida a informar o total, sem aviso', async () => {
    seed(receipt({ status: 'confirmed', total: 0 }), item('a', 'DETERGENTE YPE', 50));
    await open();
    expect(header()).toEqual(['Mercado', 'Assaí', 'Data da compra', 'Soma dos itens', 'R$ 50,00', 'Total da nota', 'informar', CORRECTION_NOTE]);
  });
});

describe('o total da nota dá para corrigir na revisão', () => {
  it('tocar na linha abre o campo com o total; salvar grava e fecha', async () => {
    seed(receipt(), item('a', 'DETERGENTE YPE', 50));
    await open();
    expect(field('Total da nota')).toBeUndefined();
    await press(totalRow());
    expect(field('Total da nota')!.props.value).toBe('62,90');
    expect(page()).toContain('O valor pago, já com os descontos. Em branco, a nota fica sem total.');
    act(() => field('Total da nota')!.props.onChangeText('50'));
    await press(button('Salvar total'));
    // Só o total, e só enquanto a nota é rascunho.
    expect(writes('receipts')).toEqual([{ table: 'receipts', verb: 'update', values: { total: 50 }, filters: { id: 'r1', status: 'draft' } }]);
    expect(field('Total da nota')).toBeUndefined();
    expect(page()).toContain('Total da nota | R$ 50,00');
    expect(page()).not.toContain('Faltam');
  });

  it('a linha do total é um botão com nome, dica e folga de toque (ela é baixa)', async () => {
    seed(receipt({ total: 46.38 }), item('a', 'DETERGENTE YPE', 50));
    await open();
    expect(totalRow().props).toMatchObject({
      accessibilityRole: 'button',
      accessibilityLabel: 'Total da nota: R$ 46,38',
      accessibilityHint: 'Toque para corrigir',
      hitSlop: { top: 12, bottom: 12 },
    });
    // A folga não mexe no desenho: a linha continua sem altura nem espaço próprios.
    expect(totalRow().props.style).toEqual([{ flexDirection: 'row', alignItems: 'center' }, { justifyContent: 'space-between' }]);
  });

  it('nota sem total: o botão se chama "Total da nota: informar"', async () => {
    seed(receipt({ source: 'manual', total: null }), item('a', 'DETERGENTE YPE', 50));
    await open();
    expect(totalRow().props.accessibilityLabel).toBe('Total da nota: informar');
    expect(totalRow().props.accessibilityHint).toBeUndefined();
  });

  it('zero digitado é o mesmo que em branco: a nota fica sem total', async () => {
    seed(receipt(), item('a', 'DETERGENTE YPE', 50));
    await open();
    await press(totalRow());
    act(() => field('Total da nota')!.props.onChangeText('0'));
    await press(button('Salvar total'));
    expect(writes('receipts').map((write) => write.values)).toEqual([{ total: null }]);
    expect(page()).toContain('Total da nota | informar');
    expect(page()).not.toContain('passa do total');
  });

  it('total digitado e não salvo: "Confirmar nota" grava o total primeiro, e só depois confirma', async () => {
    seed(receipt({ source: 'manual', total: null }), item('a', 'DETERGENTE YPE', 50));
    await open();
    await press(totalRow());
    act(() => field('Total da nota')!.props.onChangeText('46,38'));
    const releaseTotal = hold(totalWrite);
    await press(button('Confirmar nota'));
    // O total saiu para o banco, e a confirmação espera por ele.
    expect(writes('receipts')).toEqual([{ table: 'receipts', verb: 'update', values: { total: 46.38 }, filters: { id: 'r1', status: 'draft' } }]);
    expect(mockDb.rpcs).toEqual([]);
    expect(button('Confirmar nota')!.props.loading).toBe(true);
    // Outro toque nesse meio não manda nada de novo.
    await press(button('Confirmar nota'));
    expect(writes('receipts')).toHaveLength(1);
    expect(mockDb.rpcs).toEqual([]);

    await releaseTotal();
    expect(mockDb.receipts[0].total).toBe(46.38);
    // O mesmo toque seguiu para a confirmação, e o campo fechou.
    expect(mockDb.rpcs).toHaveLength(1);
    expect(jest.mocked(notify).mock.calls).toEqual([['Nota salva', undefined]]);
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(field('Total da nota')).toBeUndefined();
    expect(page()).toContain('Total da nota | R$ 46,38');
  });

  it('total digitado que não dá para ler: "Confirmar nota" avisa, e nada mais acontece', async () => {
    seed(receipt({ source: 'manual', total: null }), item('a', 'DETERGENTE YPE', 50), item('x', 'SACOLA', 0));
    await open();
    await press(totalRow());
    act(() => field('Total da nota')!.props.onChangeText('46,3,8'));
    await press(button('Confirmar nota'));
    expect(jest.mocked(notify).mock.calls).toEqual([['Confira o total', 'Confira o total da nota, ou deixe em branco.']]);
    expect(mockDb.writes).toEqual([]);
    expect(mockDb.rpcs).toEqual([]);
    // Nem a pergunta do item sem valor: a pessoa conserta o total primeiro, no campo que continua aberto.
    expectNoQuestion();
    expect(field('Total da nota')!.props.value).toBe('46,3,8');
    expect(button('Confirmar nota')!.props.loading).toBe(false);
  });

  it('total digitado e cancelado: "Confirmar nota" confirma sem gravar total nenhum', async () => {
    seed(receipt({ source: 'manual', total: null }), item('a', 'DETERGENTE YPE', 50));
    await open();
    await press(totalRow());
    act(() => field('Total da nota')!.props.onChangeText('46,38'));
    await press(button('Cancelar'));
    await press(button('Confirmar nota'));
    expect(writes('receipts')).toEqual([]);
    expect(mockDb.receipts[0].total).toBeNull();
    expect(mockDb.rpcs).toHaveLength(1);
  });

  it('total digitado que não chega ao banco: "Confirmar nota" avisa do erro e não confirma sem ele', async () => {
    seed(receipt({ source: 'manual', total: null }), item('a', 'DETERGENTE YPE', 50));
    mockDb.fails = [totalWrite];
    await open();
    await press(totalRow());
    act(() => field('Total da nota')!.props.onChangeText('46,38'));
    await press(button('Confirmar nota'));
    expect(jest.mocked(notify).mock.calls).toEqual([['Erro', 'caiu a rede']]);
    expect(mockDb.rpcs).toEqual([]);
    expect(field('Total da nota')!.props.value).toBe('46,38');
    // A trava do toque foi solta: dá para tentar de novo.
    mockDb.fails = [];
    await press(button('Confirmar nota'));
    expect(mockDb.receipts[0].total).toBe(46.38);
    expect(mockDb.rpcs).toHaveLength(1);
  });

  it('o total tem a gravação dele: com a da data a caminho, "Salvar total" grava na hora', async () => {
    seed(receipt(), item('a', 'DETERGENTE YPE', 50));
    await open();
    await press(totalRow());
    act(() => field('Total da nota')!.props.onChangeText('50'));
    const releaseDate = hold(dateWrite);
    act(() => field('Data da compra')!.props.onChangeText(`11/06/${YEAR}`));
    await act(async () => {
      field('Data da compra')!.props.onBlur();
      await wait();
    });
    expect(writes('receipts').map((write) => Object.keys(write.values!))).toEqual([['purchased_at']]);
    // O "salvando" da data não é o do total: o botão continua livre.
    expect(button('Salvar total')!.props.loading).toBe(false);
    await press(button('Salvar total'));
    expect(writes('receipts')[1]).toEqual({ table: 'receipts', verb: 'update', values: { total: 50 }, filters: { id: 'r1', status: 'draft' } });
    expect(mockDb.receipts[0].total).toBe(50);
    expect(field('Total da nota')).toBeUndefined();
    await releaseDate();
    expect(String(mockDb.receipts[0].purchased_at)).toContain(`${YEAR}-06-11`);
    expect(notify).not.toHaveBeenCalled();
  });

  it('e com a do total a caminho, a data grava na hora; o total fecha o campo quando chega', async () => {
    seed(receipt(), item('a', 'DETERGENTE YPE', 50));
    await open();
    await press(totalRow());
    act(() => field('Total da nota')!.props.onChangeText('50'));
    const releaseTotal = hold(totalWrite);
    await press(button('Salvar total'));
    expect(button('Salvar total')!.props.loading).toBe(true);
    expect(mockDb.receipts[0].total).toBe(62.9);
    act(() => field('Data da compra')!.props.onChangeText(`11/06/${YEAR}`));
    await act(async () => {
      field('Data da compra')!.props.onBlur();
      await wait();
    });
    // A data não esperou pelo total.
    expect(String(mockDb.receipts[0].purchased_at)).toContain(`${YEAR}-06-11`);
    expect(field('Total da nota')).toBeDefined();
    await releaseTotal();
    expect(mockDb.receipts[0].total).toBe(50);
    expect(field('Total da nota')).toBeUndefined();
    expect(writes('receipts')).toHaveLength(2);
  });

  it('nota confirmada em outro aparelho com o total digitado: "Confirmar nota" não segue como se fosse rascunho', async () => {
    seed(receipt(), item('a', 'DETERGENTE YPE', 50));
    await open();
    await press(totalRow());
    act(() => field('Total da nota')!.props.onChangeText('50'));
    mockDb.receipts[0].status = 'confirmed';
    await press(button('Confirmar nota'));
    await settle();
    // O total não achou a nota em rascunho: nada de confirmar de novo, nem de erro do banco na cara da pessoa.
    expect(writes('receipts')).toHaveLength(1);
    expect(mockDb.rpcs).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
    expectNoQuestion();
    // A tela passou a ser a da nota confirmada.
    expect(button('Confirmar nota')).toBeUndefined();
    expect(page()).toContain(CORRECTION_NOTE);
  });

  it('nota confirmada em outro aparelho: o total não é gravado, e a tela passa a ser a da nota confirmada', async () => {
    seed(receipt(), item('a', 'DETERGENTE YPE', 50));
    await open();
    await press(totalRow());
    act(() => field('Total da nota')!.props.onChangeText('10'));
    mockDb.receipts[0].status = 'confirmed';
    await press(button('Salvar total'));
    expect(writes('receipts')).toEqual([{ table: 'receipts', verb: 'update', values: { total: 10 }, filters: { id: 'r1', status: 'draft' } }]);
    expect(mockDb.receipts[0].total).toBe(62.9);
    expect(said(renderer!.root.findAllByType(Card)[0])).toEqual([
      'Mercado',
      'Assaí',
      'Data da compra',
      'Soma dos itens',
      'R$ 50,00',
      'Total da nota',
      'R$ 62,90',
      'Faltam R$ 12,90: a soma dos itens é menor que o total da nota.',
      CORRECTION_NOTE,
    ]);
    expect(field('Total da nota')).toBeUndefined();
    expect(button('Confirmar nota')).toBeUndefined();
  });

  it('o que não dá para ler avisa e não grava; "Cancelar" fecha sem mudar nada', async () => {
    seed(receipt(), item('a', 'DETERGENTE YPE', 50));
    await open();
    await press(totalRow());
    act(() => field('Total da nota')!.props.onChangeText('62,9,0'));
    await press(button('Salvar total'));
    expect(notify).toHaveBeenCalledWith('Confira o total', 'Confira o total da nota, ou deixe em branco.');
    expect(field('Total da nota')).toBeDefined();
    await press(button('Cancelar'));
    expect(field('Total da nota')).toBeUndefined();
    expect(mockDb.writes).toEqual([]);
    expect(page()).toContain('Total da nota | R$ 62,90');
  });

  it('em branco, a nota fica sem total: a linha convida a informar e o aviso some', async () => {
    seed(receipt(), item('a', 'DETERGENTE YPE', 50));
    await open();
    await press(totalRow());
    act(() => field('Total da nota')!.props.onChangeText(''));
    await press(button('Salvar total'));
    expect(writes('receipts')[0].values).toEqual({ total: null });
    expect(page()).toContain('Total da nota | informar');
    expect(page()).not.toContain('Faltam');
  });

  it('nota digitada à mão: a mesma linha, com "informar"; com o total, o item sem valor ganha a sugestão', async () => {
    seed(receipt({ source: 'manual', total: null, store_id: null, store: null }), item('a', 'DETERGENTE YPE', 50), item('x', 'SACOLA', 0));
    await open();
    expect(page()).toContain('Soma dos itens | R$ 50,00 | Total da nota | informar');
    // Não houve leitura: a pergunta não fala dela, e sem total não há o que sugerir.
    expect(said(card('SACOLA'))).toContain('Sem valor: este item está sem preço.');
    expect(page()).not.toContain('Usar R$');
    await press(totalRow());
    expect(field('Total da nota')!.props.value).toBe('');
    act(() => field('Total da nota')!.props.onChangeText('51,50'));
    await press(button('Salvar total'));
    expect(writes('receipts')[0].values).toEqual({ total: 51.5 });
    expect(said(card('SACOLA'))).toContain('Falta R$ 1,50 para o total da nota. Pode ser o valor deste item.');
    expect(chip('Usar R$ 1,50')).toBeDefined();
  });
});

describe('nota já confirmada: dos itens, só o valor que faltou pode ser preenchido', () => {
  const confirmedNote = (patch: Row = {}) => receipt({ status: 'confirmed', source: 'qrcode', ...patch });

  beforeEach(() => {
    mockMarket.products = [{ id: 'p1', name: 'Queijo muçarela', category: 'laticinios', shelf_life_days: null }];
    seed(confirmedNote(), item('a', 'DETERGENTE YPE', 50), item('x', 'QJO MUSS KG', 0, { product_id: 'p1', quantity: 0.345, unit: 'kg', unit_price: 37.9 }));
  });

  it('só o item sem valor tem "Preencher"; os outros itens continuam só para ler', async () => {
    await open();
    expect(said(card('DETERGENTE YPE'))).toEqual(['DETERGENTE YPE', '1 un × R$ 50,00', 'R$ 50,00']);
    expect(said(card('Queijo muçarela'))).toEqual([
      'Queijo muçarela',
      '0,345 kg × R$ 37,90',
      'sem valor',
      'Faltam R$ 12,90 para o total da nota. Pode ser o valor deste item.',
      'Usar R$ 12,90',
      'Preencher',
      'Se a nota teve desconto, o valor impresso do item é maior.',
    ]);
    expect(chipLabels()).toEqual(['Usar R$ 12,90', 'Preencher']);
    // Sem lápis nos itens, sem "Item" novo e sem botão de confirmar; o total (como a data e o mercado) dá para corrigir.
    expect(renderer!.root.findAllByType(IconButton)).toHaveLength(0);
    expect(button('Item')).toBeUndefined();
    expect(totalRow()).toBeDefined();
    expect(button('Confirmar nota')).toBeUndefined();
    expect(page()).toContain('Total da nota | R$ 62,90 | Faltam R$ 12,90: a soma dos itens é menor que o total da nota. | 1 item sem valor.');
  });

  it('"Preencher" abre o formulário só do valor, e salvar refaz preços, histórico, gastos e compras recentes', async () => {
    await open();
    await press(chip('Preencher'));
    expect(page()).toContain('Preencher valor | QJO MUSS KG');
    expect(field('Descrição')).toBeUndefined();
    expect(button('Remover item')).toBeUndefined();
    // A quantidade e a unidade só se leem: já foram para a despensa quando a nota foi confirmada.
    expect(field('Quantidade')).toBeUndefined();
    expect(chipLabels()).not.toContain('kg');
    expect(page()).toContain('0,345 kg');
    // Os dois preços em branco, também o unitário que a leitura trouxe sem o total.
    expect(field('Preço unitário')!.props.value).toBe('');
    expect(field('Total do item')!.props.value).toBe('');
    expect(invalidated()).toEqual([]);

    act(() => field('Total do item')!.props.onChangeText('13,08'));
    await press(button('Salvar valor'));
    // Só o valor vai no pedido (a descrição não), e só para o item que ainda está sem valor.
    expect(mockDb.writes).toEqual([
      {
        table: 'receipt_items',
        verb: 'update',
        values: { unit_price: 37.913, total_price: 13.08 },
        filters: { id: 'x', receipt_id: 'r1', total_price: 0 },
      },
    ]);
    expect(invalidated()).toEqual(['latestPrices', 'priceHistory', 'spending', 'purchaseRecords']);
    expect(notify).not.toHaveBeenCalled();
    // Com valor, o item volta a ser só para ler.
    expect(said(card('Queijo muçarela'))).toEqual(['Queijo muçarela', '0,345 kg × R$ 37,91', 'R$ 13,08']);
    expect(chipLabels()).toEqual([]);
    expect(field('Total do item')).toBeUndefined();
  });

  it('"Usar R$ 12,90" grava a sugestão pelo mesmo caminho', async () => {
    await open();
    await press(chip('Usar R$ 12,90'));
    expect(mockDb.writes).toEqual([
      {
        table: 'receipt_items',
        verb: 'update',
        values: { unit_price: 37.3913, total_price: 12.9 },
        filters: { id: 'x', receipt_id: 'r1', total_price: 0 },
      },
    ]);
    expect(invalidated()).toEqual(['latestPrices', 'priceHistory', 'spending', 'purchaseRecords']);
    expect(notify).not.toHaveBeenCalled();
    expect(page()).not.toContain('sem valor');
    expect(page()).not.toContain('Faltam');
  });

  it('valor gravado e a nota que demora a voltar: o item não oferece "Usar" nem "Preencher" de novo (diria que não salvou), e mostra o valor quando ela chega', async () => {
    await open();
    const releaseRead = hold(receiptRead);
    await press(chip('Usar R$ 12,90'));
    await settle(4200);
    expect(mockDb.items[1]).toMatchObject({ total_price: 12.9 });
    // A nota em tela ainda é a de antes: o item aparece sem valor, mas sem os botões.
    expect(said(card('Queijo muçarela'))).toEqual(['Queijo muçarela', '0,345 kg × R$ 37,90', 'sem valor']);
    expect(chipLabels()).toEqual([]);
    expect(writes('receipt_items')).toHaveLength(1);
    expect(notify).not.toHaveBeenCalled();
    await releaseRead();
    expect(said(card('Queijo muçarela'))).toContain('R$ 12,90');
    expect(page()).not.toContain('sem valor');
  }, 15_000);

  it('dois itens sem valor, um gravado com a nota a caminho: só ele deixa de oferecer "Preencher"', async () => {
    seed(confirmedNote(), item('a', 'DETERGENTE YPE', 50), item('x', 'QJO MUSS KG', 0, { quantity: 0.345, unit: 'kg' }), item('y', 'SABAO EM PO', 0));
    await open();
    expect(chipLabels()).toEqual(['Preencher', 'Preencher']);
    await press(chip('Preencher', card('QJO MUSS KG')));
    act(() => field('Total do item')!.props.onChangeText('12,90'));
    const releaseRead = hold(receiptRead);
    await press(button('Salvar valor'));
    await settle(4200);
    expect(chipLabels(card('QJO MUSS KG'))).toEqual([]);
    expect(chipLabels(card('SABAO EM PO'))).toEqual(['Preencher']);
    await releaseRead();
    expect(said(card('QJO MUSS KG'))).toContain('R$ 12,90');
    expect(chipLabels(card('SABAO EM PO'))).toEqual(['Preencher']);
  }, 15_000);

  it('item que já ganhou valor em outro aparelho: "Salvar valor" não grava por cima e avisa, em vez de sumir com o que foi digitado', async () => {
    await open();
    await press(chip('Preencher'));
    act(() => field('Total do item')!.props.onChangeText('13,08'));
    Object.assign(mockDb.items[1], { unit_price: 28.99, total_price: 10 });
    await press(button('Salvar valor'));
    expect(mockDb.writes).toHaveLength(1);
    expect(mockDb.writes[0].filters).toEqual({ id: 'x', receipt_id: 'r1', total_price: 0 });
    expect(mockDb.items[1]).toMatchObject({ unit_price: 28.99, total_price: 10 });
    expect(jest.mocked(notify).mock.calls).toEqual([['Valor não salvo', 'Este item já tem valor ou não existe mais.']]);
    // A nota relida mostra o valor que ficou, e o formulário (que só existe para o item sem valor) fecha.
    expect(said(card('Queijo muçarela'))).toEqual(['Queijo muçarela', '0,345 kg × R$ 28,99', 'R$ 10,00']);
    expect(field('Total do item')).toBeUndefined();
  });

  it('dois toques em "Salvar valor" no mesmo instante: uma gravação só, e nenhum aviso de que não salvou', async () => {
    await open();
    await press(chip('Preencher'));
    act(() => field('Total do item')!.props.onChangeText('13,08'));
    await pressBoth(button('Salvar valor'), button('Salvar valor'));
    await settle();
    expect(mockDb.writes).toHaveLength(1);
    expect(notify).not.toHaveBeenCalled();
    expect(said(card('Queijo muçarela'))).toEqual(['Queijo muçarela', '0,345 kg × R$ 37,91', 'R$ 13,08']);
  });

  it('"Salvar valor" que falha avisa do erro e deixa o formulário aberto, com o que foi digitado', async () => {
    mockDb.fails = [itemWrite];
    await open();
    await press(chip('Preencher'));
    act(() => field('Total do item')!.props.onChangeText('13,08'));
    await press(button('Salvar valor'));
    expect(jest.mocked(notify).mock.calls).toEqual([['Erro', 'caiu a rede']]);
    expect(field('Total do item')!.props.value).toBe('13,08');
    expect(invalidated()).toEqual([]);
  });

  it('dois itens sem valor: cada um com "sem valor" e "Preencher", sem frase nem sugestão', async () => {
    seed(confirmedNote(), item('a', 'DETERGENTE YPE', 50), item('x', 'QJO MUSS KG', 0), item('y', 'SACOLA', 0));
    await open();
    expect(said(card('SACOLA'))).toEqual(['SACOLA', '1 un', 'sem valor', 'Preencher']);
    expect(said(card('QJO MUSS KG'))).toEqual(['QJO MUSS KG', '1 un', 'sem valor', 'Preencher']);
    expect(chipLabels()).toEqual(['Preencher', 'Preencher']);
  });
});

describe('nota já confirmada: data, mercado e total dá para corrigir', () => {
  const confirmedNote = (patch: Row = {}) =>
    receipt({ status: 'confirmed', source: 'qrcode', access_key: '35260612345678000190650010000012341000012345', ...patch });
  /** Além dos de preço: as notas, o Mercado do mês, os preços de outras casas e os mercados. */
  const OTHER_QUERIES = [['receipts'], ['spending', 'market', '2026-06'], ['sharedPrices'], ['stores']];
  const refreshed = () => [...PRICE_QUERIES, ...OTHER_QUERIES].filter((key) => client.getQueryState(key)?.isInvalidated).map((key) => key.join(':'));
  const ALL_REFRESHED = ['latestPrices', 'priceHistory:p1', 'spending:2026-06:2026-06', 'purchaseRecords', 'receipts', 'spending:market:2026-06', 'sharedPrices'];
  const storePicker = () => renderer!.root.findAllByType(PickerModal).find((entry) => entry.props.title === 'Mercado')!;
  const header = () => said(renderer!.root.findAllByType(Card)[0]);
  /** Digita a data no campo e sai dele, como a pessoa faz. */
  async function typeDate(text: string) {
    act(() => field('Data da compra')!.props.onChangeText(text));
    await act(async () => {
      field('Data da compra')!.props.onBlur();
      await wait();
    });
  }
  const noonOf = (iso: string) => new Date(`${iso}T12:00:00`).toISOString();

  beforeEach(() => {
    for (const key of OTHER_QUERIES) client.setQueryData(key, []);
    mockDb.stores = [
      { id: 's1', name: 'Assaí' },
      { id: 's2', name: 'Atacadão' },
    ];
    seed(confirmedNote(), item('a', 'DETERGENTE YPE', 50), item('b', 'ARROZ 5KG', 12.9));
  });

  it('o cabeçalho tem o mercado para tocar, o campo da data, o total para tocar e a frase do que a correção muda', async () => {
    await open();
    expect(header()).toEqual(['Mercado', 'Assaí', 'Data da compra', 'Soma dos itens', 'R$ 62,90', 'Total da nota', 'R$ 62,90', CORRECTION_NOTE]);
    expect(field('Data da compra')!.props.value).toBe(`10/06/${YEAR}`);
    expect(storePicker().props.visible).toBe(false);
    expect(totalRow().props.accessibilityHint).toBe('Toque para corrigir');
    expect(mockDb.writes).toEqual([]);
  });

  it('o mercado renomeado mostra o nome da nota embaixo; o lápis abre o renomear, e a busca do seletor acha pelos dois nomes', async () => {
    mockMarket.stores = [{ id: 's1', name: 'Assaí', cnpj: '06057223000171', address: null, printed_name: 'SENDAS DISTRIBUIDORA S/A' }];
    await open();
    expect(header().slice(0, 4)).toEqual(['Mercado', 'Assaí', 'Na nota: SENDAS DISTRIBUIDORA S/A', 'Data da compra']);
    expect(storePicker().props.options).toEqual([{ id: 's1', title: 'Assaí', subtitle: undefined, keywords: 'SENDAS DISTRIBUIDORA S/A' }]);
    expect(page()).not.toContain('Renomeando');
    await press(renderer!.root.findAllByType(IconButton).find((entry) => entry.props.label === 'Renomear o mercado'));
    expect(page()).toContain('Renomeando Assaí');
    expect(mockDb.writes).toEqual([]);
  });

  it('com o nome da nota (a casa não o trocou), o lápis está lá e nada embaixo; sem a coluna (o banco de antes), sem o lápis', async () => {
    mockMarket.stores = [{ id: 's1', name: 'Assaí', cnpj: null, address: null, printed_name: null }];
    await open();
    expect(header().slice(0, 3)).toEqual(['Mercado', 'Assaí', 'Data da compra']);
    const pencil = () => renderer!.root.findAllByType(IconButton).find((entry) => entry.props.label === 'Renomear o mercado');
    expect(pencil()).toBeDefined();
    await act(async () => renderer?.unmount());
    mockMarket.stores = [{ id: 's1', name: 'Assaí', cnpj: null, address: null }];
    await open();
    expect(pencil()).toBeUndefined();
  });

  it('nota digitada à mão: a mesma frase, que não diz que a nota deu preço para outras casas', async () => {
    seed(confirmedNote({ source: 'manual', access_key: null }), item('a', 'DETERGENTE YPE', 50));
    await open();
    expect(page()).toContain(`${CORRECTION_NOTE} | Itens (1)`);
    expect(page()).not.toContain('outras casas');
  });

  it('a data: grava só na nota confirmada, e Finanças, Mercado do mês, histórico de preço e Notas se atualizam', async () => {
    await open();
    await typeDate(`11/06/${YEAR}`);
    expect(mockDb.writes).toEqual([
      { table: 'receipts', verb: 'update', values: { purchased_at: noonOf(`${YEAR}-06-11`) }, filters: { id: 'r1', status: 'confirmed' } },
    ]);
    expect(field('Data da compra')!.props.value).toBe(`11/06/${YEAR}`);
    expect(refreshed()).toEqual(ALL_REFRESHED);
    expect(notify).not.toHaveBeenCalled();
    // Nada de confirmar de novo (é na confirmação que a nota compartilha preço), nem de mexer nos itens.
    expect(mockDb.rpcs).toEqual([]);
    expect(writes('receipt_items')).toEqual([]);
  });

  it('a data gravada vai para a nota guardada antes de a busca nova chegar: o campo não volta para a data de antes', async () => {
    await open();
    const releaseWrite = hold(dateWrite);
    await typeDate(`11/06/${YEAR}`);
    // A gravação está a caminho: o campo continua com o que foi digitado.
    expect(field('Data da compra')!.props.value).toBe(`11/06/${YEAR}`);
    const releaseRead = hold(receiptRead);
    await releaseWrite();
    // Gravou; a nota relida ainda não voltou, e o campo já mostra a data nova, vinda da linha gravada.
    expect(client.getQueryState(['receipt', 'r1'])?.fetchStatus).toBe('fetching');
    expect(field('Data da compra')!.props.value).toBe(`11/06/${YEAR}`);
    await releaseRead();
    expect(field('Data da compra')!.props.value).toBe(`11/06/${YEAR}`);
  });

  it('enviar e depois sair do campo (no celular, enviar tira o foco): a data grava uma vez só; outra data digitada no meio grava', async () => {
    await open();
    const releaseWrite = hold(dateWrite);
    act(() => field('Data da compra')!.props.onChangeText(`11/06/${YEAR}`));
    await act(async () => {
      field('Data da compra')!.props.onSubmitEditing();
      await wait();
    });
    await act(async () => {
      field('Data da compra')!.props.onBlur();
      await wait();
    });
    expect(mockDb.writes).toEqual([
      { table: 'receipts', verb: 'update', values: { purchased_at: noonOf(`${YEAR}-06-11`) }, filters: { id: 'r1', status: 'confirmed' } },
    ]);
    // Com a gravação a caminho, a pessoa muda de ideia: a data nova grava.
    await typeDate(`12/06/${YEAR}`);
    expect(mockDb.writes.map((write) => write.values)).toEqual([
      { purchased_at: noonOf(`${YEAR}-06-11`) },
      { purchased_at: noonOf(`${YEAR}-06-12`) },
    ]);
    await releaseWrite();
    expect(field('Data da compra')!.props.value).toBe(`12/06/${YEAR}`);
    expect(notify).not.toHaveBeenCalled();
    // Gravada, a data volta a valer como qualquer outra: digitar de novo a de antes grava.
    await typeDate(`11/06/${YEAR}`);
    expect(mockDb.writes).toHaveLength(3);
  });

  it('a mesma data não grava nada; a que não é data avisa e não grava', async () => {
    await open();
    await typeDate(`10/06/${YEAR}`);
    expect(mockDb.writes).toEqual([]);
    await typeDate('31/02/2026');
    expect(jest.mocked(notify).mock.calls).toEqual([['Data inválida', 'Use o formato dd/mm/aaaa.']]);
    expect(mockDb.writes).toEqual([]);
    expect(field('Data da compra')!.props.value).toBe('31/02/2026');
  });

  it('a data que não chega ao banco avisa do erro, e o campo volta para a data da nota', async () => {
    mockDb.fails = [dateWrite];
    await open();
    await typeDate(`11/06/${YEAR}`);
    expect(jest.mocked(notify).mock.calls).toEqual([['Erro', 'caiu a rede']]);
    expect(field('Data da compra')!.props.value).toBe(`10/06/${YEAR}`);
    expect(refreshed()).toEqual([]);
  });

  it('o mercado: escolher outro da casa grava e atualiza as telas, e o nome novo aparece', async () => {
    await open();
    await press(renderer!.root.findAll((node) => typeof node.props.onPress === 'function' && said(node)[0] === 'Mercado')[0]);
    expect(storePicker().props.visible).toBe(true);
    await act(async () => {
      storePicker().props.onSelect('s2');
      await wait();
    });
    expect(storePicker().props.visible).toBe(false);
    expect(mockDb.writes).toEqual([{ table: 'receipts', verb: 'update', values: { store_id: 's2' }, filters: { id: 'r1', status: 'confirmed' } }]);
    expect(header().slice(0, 2)).toEqual(['Mercado', 'Atacadão']);
    // Um mercado que a casa já tinha: a lista dos mercados não muda.
    expect(refreshed()).toEqual(ALL_REFRESHED);
  });

  it('o mercado: criar um pelo nome digitado, como no rascunho', async () => {
    await open();
    const create = storePicker().props.extraActions('Feira do bairro');
    await act(async () => {
      create.props.onPress();
      await wait();
    });
    expect(mockDb.writes).toEqual([
      { table: 'stores', verb: 'insert', values: { name: 'Feira do bairro' }, filters: {} },
      { table: 'receipts', verb: 'update', values: { store_id: 'mercado2' }, filters: { id: 'r1', status: 'confirmed' } },
    ]);
    expect(header().slice(0, 2)).toEqual(['Mercado', 'Feira do bairro']);
    expect(refreshed()).toEqual([...ALL_REFRESHED, 'stores']);
  });

  it('o mercado criado fica na lista dos mercados mesmo quando a nota não grava: tentar de novo acha ele', async () => {
    mockDb.fails = [storeWrite];
    await open();
    await act(async () => {
      storePicker().props.extraActions('Feira do bairro').props.onPress();
      await wait();
    });
    expect(jest.mocked(notify).mock.calls).toEqual([['Erro', 'caiu a rede']]);
    expect(mockDb.stores.map((store) => store.name)).toEqual(['Assaí', 'Atacadão', 'Feira do bairro']);
    expect(header().slice(0, 2)).toEqual(['Mercado', 'Assaí']);
    // Só os mercados se atualizam: a nota não mudou.
    expect(refreshed()).toEqual(['stores']);
  });

  it('na revisão também: o mercado criado entra na lista mesmo quando a nota não grava', async () => {
    seed(receipt(), item('a', 'DETERGENTE YPE', 50));
    mockDb.fails = [storeWrite];
    await open();
    await act(async () => {
      storePicker().props.extraActions('Feira do bairro').props.onPress();
      await wait();
    });
    expect(jest.mocked(notify).mock.calls).toEqual([['Erro', 'caiu a rede']]);
    expect(mockDb.writes.map((write) => [write.table, write.values])).toEqual([
      ['stores', { name: 'Feira do bairro' }],
      ['receipts', { store_id: 'mercado2' }],
    ]);
    expect(client.getQueryState(['stores'])?.isInvalidated).toBe(true);
  });

  it('a data e o mercado ao mesmo tempo: cada correção tem os seus avisos, e a falha da data não some atrás da do mercado', async () => {
    mockDb.fails = [dateWrite];
    await open();
    const releaseDate = hold(dateWrite);
    await typeDate(`11/06/${YEAR}`);
    await act(async () => {
      storePicker().props.onSelect('s2');
      await wait();
    });
    expect(header().slice(0, 2)).toEqual(['Mercado', 'Atacadão']);
    await releaseDate();
    expect(jest.mocked(notify).mock.calls).toEqual([['Erro', 'caiu a rede']]);
    expect(field('Data da compra')!.props.value).toBe(`10/06/${YEAR}`);
    expect(mockDb.receipts[0].store_id).toBe('s2');
  });

  it('o mesmo mercado não grava nada', async () => {
    await open();
    await act(async () => {
      storePicker().props.onSelect('s1');
      await wait();
    });
    expect(mockDb.writes).toEqual([]);
  });

  it('o total: tocar abre o campo, salvar grava só na nota confirmada, fecha o campo e refaz a conta da diferença', async () => {
    await open();
    await press(totalRow());
    expect(field('Total da nota')!.props.value).toBe('62,90');
    act(() => field('Total da nota')!.props.onChangeText('72,90'));
    await press(button('Salvar total'));
    expect(mockDb.writes).toEqual([{ table: 'receipts', verb: 'update', values: { total: 72.9 }, filters: { id: 'r1', status: 'confirmed' } }]);
    expect(field('Total da nota')).toBeUndefined();
    expect(page()).toContain('Total da nota | R$ 72,90 | Faltam R$ 10,00: a soma dos itens é menor que o total da nota.');
    expect(refreshed()).toEqual(ALL_REFRESHED);
    expect(notify).not.toHaveBeenCalled();
  });

  it('o total igual ao da nota só fecha o campo; o que não dá para ler avisa e o campo fica aberto', async () => {
    await open();
    await press(totalRow());
    act(() => field('Total da nota')!.props.onChangeText('62,9'));
    await press(button('Salvar total'));
    expect(field('Total da nota')).toBeUndefined();
    await press(totalRow());
    act(() => field('Total da nota')!.props.onChangeText('62,9,0'));
    await press(button('Salvar total'));
    expect(jest.mocked(notify).mock.calls).toEqual([['Confira o total', 'Confira o total da nota, ou deixe em branco.']]);
    expect(field('Total da nota')!.props.value).toBe('62,9,0');
    expect(mockDb.writes).toEqual([]);
  });

  it('em branco, a nota fica sem total, como na revisão', async () => {
    await open();
    await press(totalRow());
    act(() => field('Total da nota')!.props.onChangeText(''));
    await press(button('Salvar total'));
    expect(mockDb.writes.map((write) => write.values)).toEqual([{ total: null }]);
    expect(page()).toContain('Total da nota | informar');
  });

  it('o total que não chega ao banco avisa do erro e deixa o campo com o que foi digitado', async () => {
    mockDb.fails = [totalWrite];
    await open();
    await press(totalRow());
    act(() => field('Total da nota')!.props.onChangeText('72,90'));
    await press(button('Salvar total'));
    expect(jest.mocked(notify).mock.calls).toEqual([['Erro', 'caiu a rede']]);
    expect(field('Total da nota')!.props.value).toBe('72,90');
    expect(button('Salvar total')!.props.loading).toBe(false);
  });

  it('nota excluída em outro aparelho: a correção avisa que não salvou', async () => {
    await open();
    await press(totalRow());
    act(() => field('Total da nota')!.props.onChangeText('72,90'));
    mockDb.receipts = [];
    await press(button('Salvar total'));
    expect(jest.mocked(notify).mock.calls).toEqual([['Correção não salva', 'Esta nota não existe mais.']]);
    // A nota relida não vem: a tela passa a ser a do erro, com como tentar de novo.
    expect(page()).not.toContain('Salvar total');
    expect(page()).not.toContain('DETERGENTE YPE');
  });

  it('a revisão continua como antes: a data vai sem o filtro da nota confirmada, e não há a frase', async () => {
    seed(receipt(), item('a', 'DETERGENTE YPE', 50));
    await open();
    expect(page()).not.toContain(CORRECTION_NOTE);
    await typeDate(`11/06/${YEAR}`);
    expect(mockDb.writes).toEqual([{ table: 'receipts', verb: 'update', values: { purchased_at: noonOf(`${YEAR}-06-11`) }, filters: { id: 'r1' } }]);
    await act(async () => {
      storePicker().props.onSelect('s2');
      await wait();
    });
    expect(mockDb.writes[1]).toEqual({ table: 'receipts', verb: 'update', values: { store_id: 's2' }, filters: { id: 'r1' } });
    expect(button('Confirmar nota')).toBeDefined();
  });
});

// O que a tela escrevia antes de existir a pergunta do item sem valor: tirado da versão anterior, com estes mesmos dados.
const DRAFT_AS_BEFORE = [
  'Mercado',
  'Assaí',
  'Data da compra',
  'Soma dos itens',
  'R$ 62,90',
  'Total da nota',
  'R$ 62,90',
  'Confira cada item. Produtos ligam a mesma coisa entre mercados diferentes — é isso que permite comparar preços.',
  'Itens (2)',
  'Item',
  'DETERGENTE YPE',
  '1 un × R$ 50,00',
  'R$ 50,00',
  'Novo: DETERGENTE YPE',
  'Limpeza',
  'Não vai para a despensa',
  'ARROZ TIO JOAO 5KG',
  '2 un × R$ 6,45',
  'R$ 12,90',
  'Novo: Arroz',
  'Grãos, massas e cereais',
  'Vai para a despensa',
  'Validade estimada pela categoria — ajuste se quiser.',
  'Descartar nota',
  'Confirmar nota (2 itens)',
];
// Na confirmada, com a data, o mercado e o total que ela ganhou para corrigir: o campo da data e a frase do que a
// correção muda.
const CONFIRMED_AS_BEFORE = [
  'Mercado',
  'Assaí',
  'Data da compra',
  'Soma dos itens',
  'R$ 62,90',
  'Total da nota',
  'R$ 62,90',
  CORRECTION_NOTE,
  'Itens (2)',
  'DETERGENTE YPE',
  '1 un × R$ 50,00',
  'R$ 50,00',
  'ARROZ TIO JOAO 5KG',
  '2 un × R$ 6,45',
  'R$ 12,90',
  'Excluir nota',
];

describe('nota sem nada a perguntar: a tela é a de sempre', () => {
  const items = () => [item('a', 'DETERGENTE YPE', 50), item('b', 'ARROZ TIO JOAO 5KG', 12.9, { suggested_name: 'Arroz', suggested_category: 'graos', quantity: 2, unit_price: 6.45 })];

  it('em revisão', async () => {
    seed(receipt(), ...items());
    await open();
    expect(lines()).toEqual(DRAFT_AS_BEFORE);
    await press(button('Confirmar nota'));
    expectNoQuestion();
    expect(mockDb.rpcs).toHaveLength(1);
  });

  it('confirmada', async () => {
    seed(receipt({ status: 'confirmed' }), ...items());
    await open();
    expect(lines()).toEqual(CONFIRMED_AS_BEFORE);
    expect(chipLabels()).toEqual([]);
  });

  it('confirmada e sem total: a linha convida a informar, como na revisão', async () => {
    seed(receipt({ status: 'confirmed', total: null }), ...items());
    await open();
    expect(page()).toContain('Total da nota | informar');
    expect(totalRow().props.accessibilityLabel).toBe('Total da nota: informar');
  });
});


describe('a lista de compras na revisão: o mesmo item, de qualquer marca', () => {
  // A lista diz o item sem a marca (ou com a marca da última compra) e a nota traz outra.
  const listItem = (id: string, name: string, category: string, inCart: boolean): Row => ({
    id,
    list_id: 'lista1',
    list_name: 'Mercado',
    name,
    category,
    product_id: null,
    checked_at: inCart ? `${YEAR}-06-10T14:00:00.000Z` : null,
  });
  beforeEach(() => {
    seed(
      receipt(),
      item('a', 'CAFE BOA TARDE 500G', 18.9, { suggested_name: 'Café Boa Tarde 500g', suggested_category: 'cafe_cha' }),
      item('b', 'OVOS GRANJA SOL CAIPIRA', 22, { suggested_name: 'Ovos Granja Sol Caipira', suggested_category: 'ovos' }),
      item('c', 'LEITE UHT SERRANA CX', 22, { suggested_name: 'Leite UHT Serrana', suggested_category: 'laticinios' }),
    );
    mockMarket.listItems = [
      listItem('l1', 'Café em pó', 'cafe_cha', true),
      listItem('l2', 'Ovo Caipira Fazendinha', 'ovos', false),
      listItem('l3', 'Leite desnatado', 'laticinios', true),
      listItem('l4', 'Saco de lixo', 'limpeza', false),
    ];
  });
  const checkCircle = (name: string) => renderer!.root.findAllByType(CheckCircle).find((entry) => entry.props.label === `Tirar ${name} da lista`);
  const yes = (name: string) =>
    renderer!.root.findAllByType(Button).find((entry) => entry.props.title === 'Sim' && String(entry.props.accessibilityLabel).endsWith(`tirar ${name} da lista`));

  it('o item do carrinho vem marcado; o que não estava, e o que a nota não diz se é o tipo pedido, vêm como sugestão', async () => {
    await open();
    const text = page();
    // No carrinho e uma linha só da nota é café: marcado sozinho.
    expect(checkCircle('Café em pó')!.props.checked).toBe(true);
    expect(text).toContain('Café em pó | Comprado: Café Boa Tarde 500g | Estava no carrinho e é o mesmo item');
    expect(yes('Café em pó')).toBeUndefined();
    // Fora do carrinho, o mesmo item de outra marca: a sugestão, com a pergunta de um toque.
    expect(checkCircle('Ovo Caipira Fazendinha')!.props.checked).toBe(false);
    expect(text).toContain('Ovo Caipira Fazendinha | Na nota: Ovos Granja Sol Caipira | O mesmo item, de outra marca ou com outro nome | Comprou este?');
    expect(yes('Ovo Caipira Fazendinha')!.props.accessibilityLabel).toBe('Sim, comprei Ovos Granja Sol Caipira: tirar Ovo Caipira Fazendinha da lista');
    // No carrinho, mas a nota não diz se o leite é desnatado: só sugestão.
    expect(checkCircle('Leite desnatado')!.props.checked).toBe(false);
    expect(text).toContain('Leite desnatado | Na nota: Leite UHT Serrana | Pode ser este: confira | Comprou este?');
    // O que não veio fica de fora, atrás de "Ligar item".
    expect(checkCircle('Saco de lixo')).toBeUndefined();
    expect(button('Ligar item')).toBeDefined();
    expect(text).toContain('Nas sugestões, toque em "Sim" no que você comprou.');
  });

  it('"Sim" marca a sugestão, e confirmar tira da lista o que está marcado', async () => {
    await open();
    await press(yes('Ovo Caipira Fazendinha'));
    expect(checkCircle('Ovo Caipira Fazendinha')!.props.checked).toBe(true);
    // Marcado pela pessoa: a dica não diz que estava no carrinho (não estava).
    expect(page()).toContain('Ovo Caipira Fazendinha | Comprado: Ovos Granja Sol Caipira | O mesmo item, de outra marca ou com outro nome');
    expect(yes('Ovo Caipira Fazendinha')).toBeUndefined();

    await press(button('Confirmar nota'));
    expect(mockDb.rpcs.map(({ fn }) => fn)).toEqual(['confirm_receipt']);
    const sent = mockDb.rpcs[0].args.p_items as Row[];
    // O café (do carrinho) e o ovo (do "Sim") saem da lista e ensinam a ligação; o leite desmarcado fica.
    expect(sent.map((entry) => [entry.id, entry.list_items ?? null])).toEqual([
      ['a', [{ id: 'l1', name: 'Café em pó', name_key: 'cafe em po' }]],
      ['b', [{ id: 'l2', name: 'Ovo Caipira Fazendinha', name_key: 'ovo caipira fazendinha' }]],
      ['c', null],
    ]);
    expect(String(jest.mocked(notify).mock.calls[0][1])).toContain('2 itens saíram da lista.');
  });

  it('com duas linhas que podem ser o item, nem o do carrinho vem marcado sozinho', async () => {
    seed(
      receipt(),
      item('a', 'CAFE BOA TARDE 500G', 18.9, { suggested_name: 'Café Boa Tarde 500g', suggested_category: 'cafe_cha' }),
      item('d', 'CAFE SERRA AZUL 250G', 44, { suggested_name: 'Café Serra Azul 250g', suggested_category: 'cafe_cha' }),
    );
    await open();
    expect(checkCircle('Café em pó')!.props.checked).toBe(false);
    expect(yes('Café em pó')).toBeDefined();
  });

  it('com o que as notas da casa ensinaram, "AZ GALLO" vem como sugestão para o azeite; a nota confirmada nem pede os apelidos', async () => {
    const { learnAbbreviations } = jest.requireActual<typeof import('@/domain/learnedAbbreviations')>('@/domain/learnedAbbreviations');
    seed(receipt(), item('a', 'AZ GALLO 500ML', 32, { suggested_name: 'Az gallo 500ml', suggested_category: 'outros' }));
    mockMarket.listItems = [listItem('l1', 'Azeite', 'oleos', false)];
    await open();
    expect(checkCircle('Azeite')).toBeUndefined();
    await act(async () => renderer?.unmount());

    mockLearning.learned = learnAbbreviations([{ description: 'AZ POR EU PARUS VD', productName: 'Azeite' }]);
    await open();
    expect(checkCircle('Azeite')!.props.checked).toBe(false);
    expect(page()).toContain('Azeite | Na nota: Az gallo 500ml');
    expect(yes('Azeite')).toBeDefined();
    expect(mockLearning.enabled.at(-1)).toBe(true);
    await act(async () => renderer?.unmount());

    seed(receipt({ status: 'confirmed' }), item('a', 'AZ GALLO 500ML', 32, { suggested_name: 'Az gallo 500ml', suggested_category: 'outros' }));
    mockLearning.enabled = [];
    await open();
    expect(mockLearning.enabled.at(-1)).toBe(false);
  });
});

describe('item pesado no balcão que veio como "1 un"', () => {
  const weightField = () => renderer!.root.findAllByType(TextField).find((entry) => entry.props.placeholder === 'Peso em kg (ex.: 0,186)');

  it('pergunta o peso; com ele, a linha vira por kg com o valor da nota sobre o peso', async () => {
    seed(
      receipt({ total: 30.98 }),
      item('i1', 'QUEIJO parmesão', 22.99, { suggested_category: 'laticinios' }),
      item('i2', 'LEITE IL DESNATADO', 7.99, { suggested_category: 'laticinios' }),
    );
    await open();
    expect(page()).toContain('Veio pesado no balcão? Diga quanto pesou (está na etiqueta) e o app compara pelo preço do kg.');
    // O leite vem em embalagem: só o queijo pergunta.
    expect(chipLabels(card('LEITE IL DESNATADO'))).not.toContain('Informar o peso');
    await press(chip('Informar o peso', card('QUEIJO parmesão')));
    act(() => weightField()!.props.onChangeText('0,186'));
    await press(chip('Salvar peso'));
    expect(writes('receipt_items')).toEqual([
      {
        table: 'receipt_items',
        verb: 'update',
        values: { quantity: 0.186, unit: 'kg', unit_price: 123.6022 },
        // Só a linha que a tela leu: sem a descrição nem o total no pedido, e a gravação só acha a linha se ela ainda é a mesma.
        filters: { id: 'i1', receipt_id: 'r1', unit: 'un', quantity: 1, total_price: 22.99 },
      },
    ]);
    // A nota voltou com a linha por kg: a pergunta sai.
    expect(page()).not.toContain('Veio pesado no balcão?');
  });

  it('enquanto a pessoa digita, o campo mostra o que "Salvar peso" vai gravar; o que não dá para ler diz isso, e nada grava antes do toque', async () => {
    seed(receipt({ total: 14.6 }), item('i1', 'QUEIJO parmesão', 14.6, { suggested_category: 'laticinios' }));
    await open();
    await press(chip('Informar o peso'));
    // "05" é 5 kg: sem vírgula, o número abaixo de 20 é quilo. A conta aparece antes de gravar.
    act(() => weightField()!.props.onChangeText('05'));
    expect(page()).toContain('5 kg × R$ 2,92');
    act(() => weightField()!.props.onChangeText('0,186'));
    expect(page()).toContain('0,186 kg × R$ 78,49');
    act(() => weightField()!.props.onChangeText('0'));
    expect(page()).toContain('Não deu para ler o peso');
    expect(writes('receipt_items')).toEqual([]);
  });

  it('a busca que falha depois de gravar o peso: a nota fica na tela com o aviso, e "Tentar de novo" traz a linha por kg', async () => {
    seed(receipt({ total: 22.99 }), item('i1', 'QUEIJO parmesão', 22.99, { suggested_category: 'laticinios' }));
    await open();
    await press(chip('Informar o peso'));
    act(() => weightField()!.props.onChangeText('0,186'));
    mockDb.fails = [receiptRead];
    await press(chip('Salvar peso'));
    await settle();
    expect(jest.mocked(notify).mock.calls).toEqual([['Peso salvo', 'Não deu para atualizar a nota na tela: o item aparece por unidade até ela ser buscada de novo.']]);
    // A nota não some da tela: o item fica como estava, sem perguntar de novo, com o aviso de cima.
    expect(page()).toContain('QUEIJO parmesão');
    expect(page()).toContain('Não foi possível atualizar. Mostrando o que já estava carregado.');
    expect(page()).not.toContain('Veio pesado no balcão?');
    mockDb.fails = [];
    await press(button('Tentar de novo'));
    await settle();
    expect(said(card('QUEIJO parmesão'))).toContain('0,186 kg × R$ 123,60');
    expect(page()).not.toContain('Não foi possível atualizar');
  });

  it('outro aparelho corrige o valor com a nota aberta aqui: o peso não grava o valor de antes, avisa e busca a nota de novo', async () => {
    seed(receipt({ total: 30.98 }), item('i1', 'QUEIJO parmesão', 22.99, { suggested_category: 'laticinios' }), item('i2', 'LEITE IL DESNATADO', 7.99, { suggested_category: 'laticinios' }));
    await open();
    // O queijo ganhou outro valor em outro aparelho; esta tela ainda mostra o de antes.
    Object.assign(mockDb.items[0], { total_price: 25.5, unit_price: 25.5 });
    await press(chip('Informar o peso', card('QUEIJO parmesão')));
    act(() => weightField()!.props.onChangeText('0,186'));
    await press(chip('Salvar peso'));
    // Nada foi regravado por cima do valor de agora, e a pessoa fica sabendo.
    expect(mockDb.items[0]).toMatchObject({ total_price: 25.5, unit_price: 25.5, unit: 'un', quantity: 1 });
    expect(jest.mocked(notify).mock.calls).toEqual([
      ['Peso não salvo', 'Este item mudou em outro aparelho. A nota foi buscada de novo: confira e informe o peso outra vez.'],
    ]);
    // A nota foi buscada de novo: o queijo mostra o valor de agora e volta a perguntar o peso.
    expect(said(card('QUEIJO parmesão'))).toContain('R$ 25,50');
    expect(chip('Informar o peso', card('QUEIJO parmesão'))).toBeDefined();
  });

  it('com a nota relida antes do peso, o peso grava o valor de agora e o preço por kg sobre ele', async () => {
    seed(receipt({ total: 30.98 }), item('i1', 'QUEIJO parmesão', 22.99, { suggested_category: 'laticinios' }), item('i2', 'LEITE IL DESNATADO', 7.99, { suggested_category: 'laticinios' }));
    await open();
    Object.assign(mockDb.items[0], { total_price: 25.5, unit_price: 25.5 });
    await act(async () => {
      await client.refetchQueries({ queryKey: ['receipt', 'r1'] });
    });
    await settle();
    await press(chip('Informar o peso', card('QUEIJO parmesão')));
    act(() => weightField()!.props.onChangeText('0,186'));
    await press(chip('Salvar peso'));
    expect(writes('receipt_items')).toEqual([
      {
        table: 'receipt_items',
        verb: 'update',
        values: { quantity: 0.186, unit: 'kg', unit_price: 137.0968 },
        filters: { id: 'i1', receipt_id: 'r1', unit: 'un', quantity: 1, total_price: 25.5 },
      },
    ]);
    expect(mockDb.items[0]).toMatchObject({ total_price: 25.5, quantity: 0.186, unit: 'kg', unit_price: 137.0968 });
    expect(jest.mocked(notify).mock.calls).toEqual([]);
  });

  it('"É embalagem" deixa a linha como está, só nesta revisão; peso ilegível avisa e não grava', async () => {
    seed(receipt({ total: 22.99 }), item('i1', 'PRESUNTO COZIDO', 22.99, { suggested_category: 'frios' }));
    await open();
    await press(chip('Informar o peso'));
    act(() => weightField()!.props.onChangeText('abc'));
    await press(chip('Salvar peso'));
    expect(notify).toHaveBeenCalledWith('Peso inválido', 'Digite o peso da etiqueta em kg, como 0,186 (ou 186 g).');
    expect(writes('receipt_items')).toEqual([]);
    await press(chip('Cancelar'));
    await press(chip('É embalagem'));
    expect(page()).not.toContain('Veio pesado no balcão?');
    expect(writes('receipt_items')).toEqual([]);
  });

  it('a nota confirmada não pergunta: a quantidade dela já foi para a despensa', async () => {
    seed(receipt({ status: 'confirmed', total: 22.99 }), item('i1', 'QUEIJO parmesão', 22.99, { suggested_category: 'laticinios' }));
    await open();
    expect(page()).not.toContain('Veio pesado no balcão?');
  });
});

describe('quantos ovos vêm na embalagem', () => {
  const eggs = (patch: Row = {}) => item('i1', 'OVOS RANCHO CAIPIRA', 13.99, { suggested_category: 'ovos', pack_count: null, ...patch });

  it('pergunta na revisão; com a resposta, a linha diz quanto sai cada ovo e deixa mudar', async () => {
    seed(receipt({ total: 13.99 }), eggs());
    await open();
    expect(page()).toContain('Quantos ovos vêm na embalagem? Com isso, o preço mostra quanto sai cada ovo.');
    await press(chip('10'));
    expect(writes('receipt_items')).toEqual([{ table: 'receipt_items', verb: 'update', values: { pack_count: 10 }, filters: { id: 'i1', receipt_id: 'r1' } }]);
    expect(page()).not.toContain('Quantos ovos vêm na embalagem?');
    expect(page()).toContain('10 ovos na embalagem: R$ 1,40 o ovo');
    await press(chip('Mudar'));
    await press(chip('Outro'));
    act(() => renderer!.root.findAllByType(TextField).find((entry) => entry.props.placeholder === 'Quantos vêm')!.props.onChangeText('20'));
    await press(chip('Salvar'));
    expect(writes('receipt_items').at(-1)?.values).toEqual({ pack_count: 20 });
    expect(page()).toContain('20 ovos na embalagem: R$ 0,70 o ovo');
  });

  it('na nota confirmada também (não mexe no valor nem na despensa); "Não sei" deixa sem', async () => {
    seed(receipt({ status: 'confirmed', total: 13.99 }), eggs());
    await open();
    expect(page()).toContain('Quantos ovos vêm na embalagem?');
    await press(chip('Não sei'));
    expect(page()).not.toContain('Quantos ovos vêm na embalagem?');
    expect(writes('receipt_items')).toEqual([]);
  });

  it('a nota que já diz a conta não pergunta, e a conta dela não se muda aqui; o banco sem a coluna também não pergunta', async () => {
    seed(receipt({ total: 13.99 }), eggs({ raw_description: 'OVOS BRANCOS C/12' }));
    await open();
    expect(page()).not.toContain('Quantos ovos vêm na embalagem?');
    expect(page()).toContain('12 ovos na embalagem: R$ 1,17 o ovo');
    expect(chip('Mudar')).toBeUndefined();
    act(() => renderer!.unmount());
    renderer = undefined;
    // A leitura de antes da migração não traz pack_count.
    const { pack_count: _missing, ...old } = eggs();
    seed(receipt({ total: 13.99 }), old);
    await open();
    expect(page()).not.toContain('Quantos ovos vêm na embalagem?');
  });

  it('a busca que falha depois da quantidade: a nota fica na tela com o aviso, e "Tentar de novo" mostra a resposta', async () => {
    seed(receipt({ total: 13.99 }), eggs());
    await open();
    mockDb.fails = [receiptRead];
    await press(chip('10'));
    await settle();
    expect(jest.mocked(notify).mock.calls).toEqual([['Quantidade salva', 'Não deu para atualizar a nota na tela: a quantidade aparece quando ela for buscada de novo.']]);
    expect(page()).toContain('OVOS RANCHO CAIPIRA');
    expect(page()).toContain('Não foi possível atualizar. Mostrando o que já estava carregado.');
    mockDb.fails = [];
    await press(button('Tentar de novo'));
    await settle();
    expect(page()).toContain('10 ovos na embalagem: R$ 1,40 o ovo');
  });

  it('os chips de quantidade e o "Mudar" dizem de que item são, para o leitor de tela', async () => {
    seed(receipt({ total: 13.99 }), eggs());
    await open();
    expect(chip('10')!.props.accessibilityLabel).toBe('10 ovos');
    await press(chip('10'));
    expect(chip('Mudar')!.props.accessibilityLabel).toBe('Mudar a quantidade de OVOS RANCHO CAIPIRA');
  });

  it('ovo sem valor (a leitura não pegou o preço): a linha diz quantos vêm, sem "R$ 0,00 o ovo", na revisão e na nota confirmada', async () => {
    seed(receipt({ total: 12.9 }), eggs({ raw_description: 'OVOS BRANCOS C/12', total_price: 0, unit_price: 0 }));
    await open();
    expect(page()).toContain('12 ovos na embalagem');
    expect(page()).not.toContain('R$ 0,00 o ovo');
    act(() => renderer!.unmount());
    renderer = undefined;
    seed(receipt({ status: 'confirmed', total: 0 }), eggs({ total_price: 0, unit_price: 0, pack_count: 10 }));
    await open();
    expect(page()).toContain('10 ovos na embalagem');
    expect(page()).not.toContain('R$ 0,00 o ovo');
    // A resposta guardada continua podendo ser mudada, como no ovo com valor.
    expect(chip('Mudar')).toBeDefined();
  });
});

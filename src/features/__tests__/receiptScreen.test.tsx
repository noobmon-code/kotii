import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from 'expo-router';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import ReceiptScreen from '@/app/nota/[id]';
import { fetchPantryNear } from '@/data/home';
import { formatBRL } from '@/domain/money';
import { askYesNo, confirmAction, notify } from '@/ui/dialogs';
import { Button, Card, Chip, IconButton, TextField } from '@/ui/primitives';

// A tela da nota de verdade, com as consultas e gravações de verdade de
// src/data/receipts.ts e um "banco" em memória atrás do cliente do Supabase.
// O resto (produtos, mercados, lista, histórico de preço) vem pronto: o que se
// confere aqui é o item sem valor, a diferença para o total e o total da nota.

type Row = Record<string, unknown>;
// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockDb: {
  receipts: Row[];
  items: Row[];
  writes: { table: string; verb: 'update' | 'insert' | 'delete'; values?: Row; filters: Row }[];
  rpcs: { fn: string; args: Row }[];
} = { receipts: [], items: [], writes: [], rpcs: [] };
const mockMarket: { products: Row[]; pantryNear: Row[] } = { products: [], pantryNear: [] };

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'r1' }),
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/ui/dialogs', () => ({ askYesNo: jest.fn(), confirmAction: jest.fn(), notify: jest.fn() }));
// Os desenhos animados e o fundo não entram no que se confere aqui.
jest.mock('@/ui/art', () => ({ Mascot: () => null, Spot: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@/ui/PickerModal', () => ({ PickerModal: () => null }));
jest.mock('@/features/finance/PayerChips', () => ({ PayerChips: () => null }));
jest.mock('@/data/images', () => ({ signedImageUrl: jest.fn() }));
jest.mock('@/data/home', () => ({ fetchPantryNear: jest.fn(async () => mockMarket.pantryNear) }));
jest.mock('@/data/market', () => {
  const { LinkIndex: Links } = jest.requireActual<typeof import('@/domain/listLinks')>('@/domain/listLinks');
  const loaded = (data: unknown) => ({ data, isPending: false, isError: false, isFetching: false, error: null, refetch: jest.fn() });
  const links = loaded(new Links([]));
  return {
    useListLinks: () => links,
    useOpenListItems: () => loaded([]),
    usePriceObservations: () => loaded([]),
    useProducts: () => loaded(mockMarket.products),
    usePurchaseRecords: () => loaded([]),
    useStores: () => loaded([{ id: 's1', name: 'Assaí', cnpj: null, address: null }]),
  };
});
jest.mock('@/lib/supabase', () => {
  const table = (name: string) => {
    const filters: [string, unknown][] = [];
    let write: { verb: 'update' | 'insert' | 'delete'; values?: Row } | null = null;
    const rows = () => (name === 'receipts' ? mockDb.receipts : mockDb.items);
    const matches = (row: Row) => filters.every(([column, value]) => row[column] === value);
    const run = () => {
      if (!write) return { data: rows().filter(matches).map((row) => ({ ...row })), error: null };
      mockDb.writes.push({ table: name, ...write, filters: Object.fromEntries(filters) });
      if (write.verb === 'update') rows().filter(matches).forEach((row) => Object.assign(row, write!.values));
      if (write.verb === 'insert') mockDb.items.push({ id: `novo${mockDb.items.length}`, suggested_name: null, suggested_category: null, product_id: null, ...write.values });
      if (write.verb === 'delete') mockDb.items = mockDb.items.filter((row) => !matches(row));
      return { data: null, error: null };
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
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
        const result = run();
        return { data: (result.data as Row[] | null)?.[0] ?? null, error: result.error };
      },
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(run).then(resolve, reject),
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
        return { data: null, error: null };
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
const question = (title: string) => jest.mocked(confirmAction).mock.calls.find(([asked]) => asked === title);

/** Quem lê preço de nota confirmada: comparativo, histórico de um produto, gastos do mês e compras recentes. */
const PRICE_QUERIES = [['latestPrices'], ['priceHistory', 'p1'], ['spending', '2026-06', '2026-06'], ['purchaseRecords']];
const invalidated = () => PRICE_QUERIES.filter((key) => client.getQueryState(key)?.isInvalidated).map((key) => key[0]);

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { networkMode: 'always', gcTime: Infinity } } });
  for (const key of PRICE_QUERIES) client.setQueryData(key, []);
  mockDb.writes = [];
  mockDb.rpcs = [];
  mockMarket.products = [];
  mockMarket.pantryNear = [];
  jest.mocked(confirmAction).mockReset();
  jest.mocked(askYesNo).mockReset();
  jest.mocked(notify).mockReset();
  jest.mocked(router.back).mockReset();
  jest.mocked(fetchPantryNear).mockClear();
});

afterEach(async () => {
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
    expect(writes('receipt_items')).toEqual([
      {
        table: 'receipt_items',
        verb: 'update',
        values: { raw_description: 'QJO MUSS KG', quantity: 0.345, unit: 'kg', unit_price: 37.3913, total_price: 12.9 },
        filters: { id: 'x' },
      },
    ]);
    expect(said(card('QJO MUSS KG'))).toEqual(['QJO MUSS KG', '0,345 kg × R$ 37,39', 'R$ 12,90', 'Novo: QJO MUSS KG', 'Limpeza', 'Não vai para a despensa']);
    expect(page()).not.toContain('Faltam');
    expect(page()).not.toContain('sem valor');
    // Em revisão, a nota ainda não conta nos preços: nada deles é refeito.
    expect(invalidated()).toEqual(['spending']);
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
    expect(confirmAction).not.toHaveBeenCalled();
    expect(mockDb.rpcs).toHaveLength(1);
  });

  it('"Deixar sem valor": a pergunta sai, o "sem valor" fica, e confirmar não pergunta por esse item', async () => {
    await open();
    await press(chip('Deixar sem valor'));
    expect(said(card('QJO MUSS KG'))).toEqual(['QJO MUSS KG', '0,345 kg', 'sem valor', 'Novo: QJO MUSS KG', 'Limpeza', 'Não vai para a despensa']);
    // Nada foi gravado: a decisão é desta revisão.
    expect(mockDb.writes).toEqual([]);
    await press(button('Confirmar nota'));
    expect(confirmAction).not.toHaveBeenCalled();
    expect(mockDb.rpcs).toEqual([{ fn: 'confirm_receipt', args: { p_receipt_id: 'r1', p_items: [expect.objectContaining({ id: 'a' }), expect.objectContaining({ id: 'x' })] } }]);
  });

  it('abrir a nota de novo pergunta de novo', async () => {
    await open();
    await press(chip('Deixar sem valor'));
    await act(async () => renderer?.unmount());
    await open();
    expect(chipLabels(card('QJO MUSS KG'))).toEqual(expect.arrayContaining(['Usar R$ 12,90', 'Preencher valor', 'Deixar sem valor']));
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
    jest.mocked(askYesNo).mockResolvedValue(false);
    await open();
    await press(button('Confirmar nota'));
    expect(jest.mocked(confirmAction).mock.calls.map(([title, message, label, , destructive]) => [title, message, label, destructive])).toEqual([
      ['2 itens estão sem valor', 'Eles entram como R$ 0,00 nos gastos e não contam no histórico de preço. Confirmar assim mesmo?', 'Confirmar', false],
    ]);
    // Enquanto a pessoa não responde (ou se cancela), nada anda: nem a conferência da despensa, nem a confirmação.
    expect(fetchPantryNear).not.toHaveBeenCalled();
    expect(askYesNo).not.toHaveBeenCalled();
    expect(mockDb.rpcs).toEqual([]);
    // Cancelou e tocou de novo: a pergunta volta.
    await press(button('Confirmar nota'));
    expect(question('2 itens estão sem valor')).toBeDefined();
    expect(confirmAction).toHaveBeenCalledTimes(2);

    // "Confirmar": seguem as perguntas de sempre, na ordem de sempre.
    await act(async () => {
      jest.mocked(confirmAction).mock.calls[1][3]();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(askYesNo).toHaveBeenCalledWith('Já está na despensa', 'Arroz já está na despensa, da compra de 9 jun. Colocar de novo?', 'Colocar de novo', 'Não colocar');
    expect(jest.mocked(confirmAction).mock.calls[2].slice(0, 3)).toEqual([
      'Nota sem mercado',
      'Sem o mercado, os preços desta nota não entram no comparativo. Salvar mesmo assim?',
      'Salvar',
    ]);
    expect(mockDb.rpcs).toEqual([]);
    // A pessoa cancela a do mercado e toca em confirmar outra vez: a dos itens sem valor já foi respondida.
    await press(button('Confirmar nota'));
    expect(jest.mocked(confirmAction).mock.calls.map(([title]) => title)).toEqual(['2 itens estão sem valor', '2 itens estão sem valor', 'Nota sem mercado', 'Nota sem mercado']);
    // E as perguntas dos itens saíram junto.
    expect(page()).not.toContain('Sem valor: a leitura não pegou');

    await act(async () => {
      jest.mocked(confirmAction).mock.calls[3][3]();
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
    expect(jest.mocked(confirmAction).mock.calls[0].slice(0, 3)).toEqual([
      '1 item está sem valor',
      'Ele entra como R$ 0,00 nos gastos e não conta no histórico de preço. Confirmar assim mesmo?',
      'Confirmar',
    ]);
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
    expect(confirmAction).not.toHaveBeenCalled();
    expect(mockDb.rpcs).toHaveLength(1);
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
    expect(writes('receipts')).toEqual([{ table: 'receipts', verb: 'update', values: { total: 50 }, filters: { id: 'r1' } }]);
    expect(field('Total da nota')).toBeUndefined();
    expect(page()).toContain('Total da nota | R$ 50,00');
    expect(page()).not.toContain('Faltam');
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

describe('nota já confirmada: só o valor que faltou pode ser preenchido', () => {
  const confirmedNote = (patch: Row = {}) => receipt({ status: 'confirmed', source: 'qrcode', ...patch });

  beforeEach(() => {
    mockMarket.products = [{ id: 'p1', name: 'Queijo muçarela', category: 'laticinios', shelf_life_days: null }];
    seed(confirmedNote(), item('a', 'DETERGENTE YPE', 50), item('x', 'QJO MUSS KG', 0, { product_id: 'p1', quantity: 0.345, unit: 'kg', unit_price: 37.9 }));
  });

  it('só o item sem valor tem "Preencher"; o resto da nota continua só para ler', async () => {
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
    // Sem lápis nos itens, sem "Item" novo, sem total para tocar e sem botão de confirmar.
    expect(renderer!.root.findAllByType(IconButton)).toHaveLength(0);
    expect(button('Item')).toBeUndefined();
    expect(totalRow()).toBeUndefined();
    expect(button('Confirmar nota')).toBeUndefined();
    expect(page()).toContain('Total da nota | R$ 62,90 | Faltam R$ 12,90: a soma dos itens é menor que o total da nota. | 1 item sem valor.');
  });

  it('"Preencher" abre o formulário só do valor, e salvar refaz preços, histórico, gastos e compras recentes', async () => {
    await open();
    await press(chip('Preencher'));
    expect(page()).toContain('Preencher valor | QJO MUSS KG');
    expect(field('Descrição')).toBeUndefined();
    expect(button('Remover item')).toBeUndefined();
    expect(field('Quantidade')!.props.value).toBe('0,345');
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
        values: { quantity: 0.345, unit: 'kg', unit_price: 37.913, total_price: 13.08 },
        filters: { id: 'x', receipt_id: 'r1', total_price: 0 },
      },
    ]);
    expect(invalidated()).toEqual(['latestPrices', 'priceHistory', 'spending', 'purchaseRecords']);
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
        values: { quantity: 0.345, unit: 'kg', unit_price: 37.3913, total_price: 12.9 },
        filters: { id: 'x', receipt_id: 'r1', total_price: 0 },
      },
    ]);
    expect(invalidated()).toEqual(['latestPrices', 'priceHistory', 'spending', 'purchaseRecords']);
    expect(page()).not.toContain('sem valor');
    expect(page()).not.toContain('Faltam');
  });

  it('dois itens sem valor: cada um com "sem valor" e "Preencher", sem frase nem sugestão', async () => {
    seed(confirmedNote(), item('a', 'DETERGENTE YPE', 50), item('x', 'QJO MUSS KG', 0), item('y', 'SACOLA', 0));
    await open();
    expect(said(card('SACOLA'))).toEqual(['SACOLA', '1 un', 'sem valor', 'Preencher']);
    expect(said(card('QJO MUSS KG'))).toEqual(['QJO MUSS KG', '1 un', 'sem valor', 'Preencher']);
    expect(chipLabels()).toEqual(['Preencher', 'Preencher']);
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
const CONFIRMED_AS_BEFORE = [
  'Mercado',
  'Assaí',
  'Compra em 10 jun',
  'Soma dos itens',
  'R$ 62,90',
  'Total da nota',
  'R$ 62,90',
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
    expect(confirmAction).not.toHaveBeenCalled();
    expect(mockDb.rpcs).toHaveLength(1);
  });

  it('confirmada', async () => {
    seed(receipt({ status: 'confirmed' }), ...items());
    await open();
    expect(lines()).toEqual(CONFIRMED_AS_BEFORE);
    expect(chipLabels()).toEqual([]);
  });

  it('confirmada e sem total: a linha do total não aparece', async () => {
    seed(receipt({ status: 'confirmed', total: null }), ...items());
    await open();
    expect(page()).not.toContain('Total da nota');
    expect(page()).not.toContain('informar');
  });
});


import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Profiler } from 'react';
import { AccessibilityInfo, Dimensions, Platform, StyleSheet, View } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import ReceiptScreen from '@/app/nota/[id]';
import { fetchPantryNear } from '@/data/home';
import { signedImageUrl } from '@/data/images';
import { PayerChips } from '@/features/finance/PayerChips';
import { FEATURES } from '@/lib/features';
import { stopWaitingForReceipt, takeConfirmedReceipt, waitForReceipt } from '@/lib/finishPurchase';
import { formatBRL } from '@/domain/money';
import {
  DELETE_CHECK_FAILED_TITLE,
  DELETE_CONFIRM,
  DELETE_PURCHASED,
  DELETE_PURCHASED_TITLE,
  DELETE_TITLE,
  deleteQuestion,
} from '@/domain/productDelete';
import { orderedPair, PRODUCT_MERGED_AWAY } from '@/domain/productMerge';
import { CATEGORY_SHELF_LIFE_DAYS, CORRECTION_STALE } from '@/domain/receiptCorrection';
import { ITEM_SAVED_NOT_SHOWN, OTHER_ITEM_SAVING, RECEIPT_BEING_UPDATED } from '@/domain/receiptGap';
import { askYesNo, confirmAction, notify } from '@/ui/dialogs';
import { PickerModal } from '@/ui/PickerModal';
import { DESKTOP_PANEL_SIDE_WIDTH } from '@/domain/desktop';
import { Actions } from '@/ui/desktop';
import { Button, Card, CheckCircle, Chip, IconButton, ListRow, Screen, TextField } from '@/ui/primitives';
import { SheetModal } from '@/ui/SheetModal';

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
  /** Pedidos que o banco faz, mas cuja resposta se perde no caminho (a rede caiu na volta). */
  loses: ((request: MockRequest) => boolean)[];
  /** O erro que o `confirm_receipt` devolve numa nota que existe (o teste escolhe), como o servidor responde. */
  confirmError: Row | null;
  /**
   * As correções da nota confirmada (data/receipts): se o banco as tem (`missing`: a função não existe, PGRST202), e o
   * erro que a troca de produto e o item que faltou devolvem (o teste escolhe). A pergunta se o banco as tem é uma
   * leitura e fica em `probes`, fora de `rpcs` (o que a tela manda o banco fazer).
   */
  corrections: boolean | 'missing';
  changeError: Row | null;
  addError: Row | null;
  probes: number;
  /**
   * Excluir produto (data/productDelete): o que delete_product_available() responde (`missing`: sem a função; `fails`:
   * a pergunta falha), quantas vezes foi perguntada (fora de `rpcs`, como a das correções), e o erro que delete_product
   * devolve (o teste escolhe; sem ele, o banco confere o produto, o nome e as linhas de nota, e exclui).
   */
  deleteAvailable: boolean | 'missing' | 'fails';
  deleteProbes: number;
  deleteError: Row | null;
  /**
   * Os pares "São diferentes" da casa (product_distinct_pairs: delete_product apaga os do produto, cascade) e as
   * gravações deles (upsert: os que passam para o gêmeo de nome do excluído).
   */
  pairs: Row[];
  upserts: { table: string; rows: unknown; options: unknown }[];
  /** Quantos pedidos saíram e quantos já voltaram (um seguro por `hold` fica no meio): é por eles que `quiet` vê a tela andar. */
  sent: number;
  answered: number;
} = {
  receipts: [],
  items: [],
  stores: [],
  writes: [],
  rpcs: [],
  reads: {},
  holds: [],
  fails: [],
  loses: [],
  confirmError: null,
  corrections: false,
  changeError: null,
  addError: null,
  probes: 0,
  deleteAvailable: false,
  deleteProbes: 0,
  deleteError: null,
  pairs: [],
  upserts: [],
  sent: 0,
  answered: 0,
};
const mockMarket: {
  products: Row[];
  pantryNear: Row[];
  listItems: Row[];
  stores: Row[];
  /** O "Tentar de novo" dos produtos (`useProducts().refetch`): a tela pede os produtos de novo por ele. */
  productsRefetch: jest.Mock;
  /**
   * Os produtos criados por "Trocar produto" enquanto a busca dos produtos ainda não voltou: ficam aqui (fora do
   * catálogo da tela) até o teste os entregar. null: entram no catálogo na hora.
   */
  late: Row[] | null;
} = { products: [], pantryNear: [], listItems: [], stores: [], productsRefetch: jest.fn(), late: null };
/** O histórico de preço que a tela recebe (`usePriceObservations`): as compras de antes, zeradas a cada teste. */
const mockPriceHistory: { points: Row[] } = { points: [] };

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'r1' }),
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/ui/dialogs', () => ({ askYesNo: jest.fn(), confirmAction: jest.fn(), notify: jest.fn() }));
// Os desenhos animados e o fundo não entram no que se confere aqui.
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@/ui/PickerModal', () => ({ PickerModal: () => null }));
// "Quem pagou" é de Finanças: aqui, só se a tela o mostra.
jest.mock('@/features/finance/PayerChips', () => ({ PayerChips: () => null }));
// O renomear tem os testes dele (renameStore.test): aqui, só para qual mercado ele abre.
jest.mock('@/features/RenameStoreModal', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { RenameStoreModal: ({ store }: { store: { name: string } }) => createElement(Text, null, `Renomeando ${store.name}`) };
});
jest.mock('@/data/images', () => ({ signedImageUrl: jest.fn() }));
jest.mock('@/data/home', () => ({ fetchPantryNear: jest.fn(async () => mockMarket.pantryNear) }));
// O congelador (data/freezer): se o banco o tem é o teste que diz (a pergunta tem os testes dela, pantryFreezer.test);
// congelar é o de verdade, pelo rpc do banco de mentira.
const mockFreezer: { available: boolean | undefined } = { available: false };
jest.mock('@/data/freezer', () => {
  const actual = jest.requireActual<typeof import('@/data/freezer')>('@/data/freezer');
  const { DEFAULT_FREEZE_DAYS } = jest.requireActual<typeof import('@/domain/freezer')>('@/domain/freezer');
  return {
    ...actual,
    useFreezer: () => ({ available: mockFreezer.available, days: mockFreezer.available === true ? DEFAULT_FREEZE_DAYS : null }),
  };
});
jest.mock('@/data/market', () => {
  const { LinkIndex: Links } = jest.requireActual<typeof import('@/domain/listLinks')>('@/domain/listLinks');
  const loaded = (data: unknown) => ({ data, isPending: false, isError: false, isFetching: false, error: null, refetch: jest.fn() });
  const links = loaded(new Links([]));
  return {
    useListLinks: () => links,
    useOpenListItems: () => loaded(mockMarket.listItems),
    usePriceObservations: () => loaded(mockPriceHistory.points),
    useProducts: () => ({ ...loaded(mockMarket.products), refetch: mockMarket.productsRefetch }),
    // O catálogo que o caminho de excluir busca quando não está na memória (o useProducts daqui não a enche).
    fetchProducts: async () => mockMarket.products.map((product) => ({ ...product })),
    usePurchaseRecords: () => loaded([]),
    useStores: () => loaded(mockMarket.stores),
  };
});
// As abreviações aprendidas têm os testes delas (learnedAbbreviations.test): aqui, as que o teste der, e se a tela
// pediu os apelidos (só na revisão).
const mockLearning: { learned: unknown; enabled: (boolean | undefined)[]; loads: number } = { learned: undefined, enabled: [], loads: 0 };
jest.mock('@/data/learnedAbbreviations', () => {
  const { NO_LEARNED } = jest.requireActual<typeof import('@/domain/learnedAbbreviations')>('@/domain/learnedAbbreviations');
  return {
    useLearnedAbbreviations: (options?: { enabled?: boolean }) => {
      mockLearning.enabled.push(options?.enabled);
      return options?.enabled === false ? NO_LEARNED : (mockLearning.learned ?? NO_LEARNED);
    },
    // O item que faltou numa nota confirmada confere a despensa com as abreviações carregadas na hora (o hook fica
    // desligado fora da revisão): as que o teste der.
    loadLearnedAbbreviations: async () => {
      mockLearning.loads += 1;
      return mockLearning.learned ?? NO_LEARNED;
    },
  };
});
jest.mock('@/lib/supabase', () => {
  /** O pedido já saiu; a resposta espera quem o teste estiver segurando, ou falha se ele mandou. */
  const answer = async <T,>(request: MockRequest, run: () => T) => {
    mockDb.sent += 1;
    await Promise.all(mockDb.holds.filter((held) => held.match(request)).map((held) => held.gate));
    const result = mockDb.fails.some((fails) => fails(request)) ? { data: null, error: { message: 'caiu a rede' } } : run();
    mockDb.answered += 1;
    return mockDb.loses.some((loses) => loses(request)) ? { data: null, error: { message: 'caiu a rede' } } : result;
  };
  const table = (name: string) => {
    const filters: [string, unknown][] = [];
    let write: { verb: 'update' | 'insert' | 'delete'; values?: Row } | null = null;
    // Como no servidor: a gravação só devolve as linhas que achou quando o pedido traz .select().
    let returning = false;
    // A leitura de excluir produto (fetchDeleteFacts) lê também os produtos, e a despensa, as listas e os códigos, que
    // aqui não têm nada deste produto.
    const rows = (): Row[] => {
      if (name === 'receipts') return mockDb.receipts;
      if (name === 'stores') return mockDb.stores;
      if (name === 'products') return mockMarket.products;
      if (name === 'product_distinct_pairs') return mockDb.pairs;
      if (name === 'pantry_items' || name === 'shopping_list_items' || name === 'product_barcodes') return [];
      return mockDb.items;
    };
    // O filtro pela nota da linha (`receipt:receipts!inner(status)` com `.eq('receipt.status', …)`): o status dela.
    const valueOf = (row: Row, column: string) =>
      column === 'receipt.status' ? mockDb.receipts.find((entry) => entry.id === row.receipt_id)?.status : row[column];
    const matches = (row: Row) => filters.every(([column, value]) => valueOf(row, column) === value);
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
      // A leitura de excluir pede uma linha só, com prazo: aqui, todas as que acharem (só importa se há alguma).
      limit: () => builder,
      abortSignal: () => builder,
      // Os pares vêm por páginas (fetchDistinctPairs): aqui, todos de uma vez.
      range: () => builder,
      // A gravação dos pares que passam (storeCarriedPairs): os que ainda não estão lá entram.
      upsert: (values: Row[], options: unknown) => {
        mockDb.upserts.push({ table: name, rows: values, options });
        const request = answer({ table: name, verb: 'insert', values: { rows: values } }, () => {
          const known = (row: Row) => mockDb.pairs.some((pair) => pair.product_a === row.product_a && pair.product_b === row.product_b);
          mockDb.pairs.push(...values.filter((row) => !known(row)));
          return { data: null, error: null };
        });
        return Object.assign(request, { abortSignal: () => request });
      },
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return builder;
      },
      // Só o `is(coluna, null)` que o app usa: a coluna vazia.
      is: (column: string, value: unknown) => {
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
  /** O que cada função do banco responde (a pergunta das correções e a de excluir ficam fora de `rpcs`). */
  async function rpcAnswer(fn: string, args: Row) {
    if (fn === 'delete_product_available') {
      mockDb.deleteProbes += 1;
      return answer({ table: fn, verb: 'rpc', values: args }, () =>
        mockDb.deleteAvailable === 'missing'
          ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.delete_product_available' } }
          : mockDb.deleteAvailable === 'fails'
            ? { data: null, error: { message: 'caiu a rede' } }
            : { data: mockDb.deleteAvailable, error: null },
      );
    }
    if (fn === 'delete_product') {
      mockDb.rpcs.push({ fn, args });
      return answer({ table: fn, verb: 'rpc', values: args }, () => {
        if (mockDb.deleteError) return { data: null, error: mockDb.deleteError };
        // Como no servidor, só o essencial: o produto travado, o nome lido, e nenhuma linha de nota apontando para ele.
        const found = mockMarket.products.find((product) => product.id === args.p_id);
        if (!found) return { data: null, error: { code: 'P0002', message: 'product not found', details: null, hint: null } };
        if (args.p_name != null && args.p_name !== found.name) return { data: null, error: { code: 'NK008', message: 'product renamed', details: null, hint: null } };
        if (mockDb.items.some((row) => row.product_id === args.p_id)) return { data: null, error: { code: 'NK016', message: 'product has purchases', details: null, hint: null } };
        mockMarket.products = mockMarket.products.filter((product) => product.id !== args.p_id);
        mockDb.pairs = mockDb.pairs.filter((pair) => pair.product_a !== args.p_id && pair.product_b !== args.p_id);
        return { data: { deleted: args.p_id, pantry: 0, list: 0, barcodes: 0 }, error: null };
      });
    }
    if (fn === 'receipt_corrections_available') {
      mockDb.probes += 1;
      const missing = mockDb.corrections === 'missing';
      return answer({ table: fn, verb: 'rpc', values: args }, () =>
        missing
          ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.receipt_corrections_available' } }
          : { data: mockDb.corrections === true, error: null },
      );
    }
    mockDb.rpcs.push({ fn, args });
    if (fn === 'change_receipt_item_product') {
      return answer({ table: fn, verb: 'rpc', values: args }, () => {
        if (mockDb.changeError) return { data: null, error: mockDb.changeError };
        // Como no servidor, só o essencial: a linha passa para o produto escolhido (o novo entra no catálogo).
        const line = mockDb.items.find((row) => row.id === args.p_item_id)!;
        let productId = args.p_product_id as string | null;
        if (!productId) {
          const created = args.p_new_product as { name: string; category: string };
          productId = `criado-${mockMarket.products.length}`;
          const product = { id: productId, name: created.name, category: created.category, shelf_life_days: null };
          if (mockMarket.late) mockMarket.late.push(product);
          else mockMarket.products = [...mockMarket.products, product];
        }
        const changed = line.product_id !== productId;
        line.product_id = productId;
        return { data: { product_id: productId, changed, pantry: 0 }, error: null };
      });
    }
    if (fn === 'add_confirmed_receipt_item') {
      return answer({ table: fn, verb: 'rpc', values: args }, () => {
        if (mockDb.addError) return { data: null, error: mockDb.addError };
        const request = args.p_item as Row;
        const existing = mockDb.items.find((row) => row.id === request.id);
        if (existing) {
          const same = (['raw_description', 'quantity', 'unit', 'unit_price', 'total_price'] as const).every((key) => existing[key] === request[key]);
          return { data: { item_id: request.id, added: false, same, product_id: existing.product_id }, error: null };
        }
        const productId = (request.product_id as string | undefined) ?? `criado-${mockMarket.products.length}`;
        if (!request.product_id) {
          const created = request.new_product as { name: string; category: string };
          mockMarket.products = [...mockMarket.products, { id: productId, name: created.name, category: created.category, shelf_life_days: null }];
        }
        mockDb.items.push({
          id: request.id,
          receipt_id: args.p_receipt_id,
          position: mockDb.items.length,
          raw_description: request.raw_description,
          suggested_name: null,
          suggested_category: null,
          product_id: productId,
          quantity: request.quantity,
          unit: request.unit,
          unit_price: request.unit_price,
          total_price: request.total_price,
          // Só a inclusão marca a linha; a troca do produto dela não ensina apelido (e a frase do seletor não promete).
          added_after_confirmation: true,
        });
        return { data: { item_id: request.id, added: true, same: true, product_id: productId }, error: null };
      });
    }
    // Como no servidor: confirmar uma nota que já não existe responde P0002 ("receipt not found").
    const gone = fn === 'confirm_receipt' && !mockDb.receipts.some((row) => row.id === args.p_receipt_id);
    const error = gone ? { code: 'P0002', message: 'receipt not found', details: null, hint: null } : fn === 'confirm_receipt' ? mockDb.confirmError : null;
    // Congelar devolve as compras que mudaram (aqui, todas as pedidas).
    const data =
      fn === 'freeze_pantry_items'
        ? (args.p_ids as string[]).map((id) => ({ item_id: id, item_expires_on: null, item_expiry_source: 'congelado', item_frozen_on: args.p_frozen_on }))
        : null;
    return answer({ table: fn, verb: 'rpc', values: args }, () => ({ data, error }));
  }
  return {
    errorMessage: (error: { message?: string }) => error?.message ?? 'Algo deu errado. Tente novamente.',
    unwrap: (result: { data: unknown; error: unknown }) => {
      if (result.error) throw result.error;
      return result.data;
    },
    supabase: {
      from: (name: string) => table(name),
      // O pedido de excluir vai com prazo (.abortSignal): a promessa de sempre, com ele.
      rpc: (fn: string, args: Row) => {
        const request = rpcAnswer(fn, args);
        return Object.assign(request, { abortSignal: () => request });
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
/** As vezes em que a tela desenhou. */
let renders = 0;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** O que ainda pode estar andando: pedidos ao banco, desenhos da tela, buscas e gravações do React Query. */
const motion = () => [mockDb.sent, mockDb.answered, renders, client.isFetching(), client.isMutating()].join('/');
/**
 * Até a tela assentar. A resposta do banco chega à tela por uma fila de passos (o React Query avisa num
 * setTimeout(0), a tela só redesenha no fim do `act`, e o desenho novo pode pedir outra coisa ao banco), e um tempo
 * fixo não basta: com a máquina ocupada (a suíte inteira em paralelo, uma coleta de lixo) a fila passa do prazo, e o
 * teste conferia a tela no meio do caminho. Cada volta aqui é um `act` com um setTimeout(0), que entra na fila depois
 * do passo já marcado; a tela assentou quando três voltas seguidas não mudam nada. Um pedido seguro por `hold` fica
 * parado e não segura a espera.
 */
async function quiet() {
  for (let turn = 0, still = 0; turn < 500; turn += 1) {
    const before = motion();
    await act(() => sleep(0));
    still = motion() === before ? still + 1 : 0;
    if (still === 3) return;
  }
  throw new Error('A tela não assentou.');
}
/** O que `action` faz na tela, o tempo pedido (o dos prazos da tela, quando o teste espera um) e o de tudo o que ela puxa assentar. */
async function run(action: () => void, ms = 30) {
  await act(async () => {
    action();
    await sleep(ms);
  });
  await quiet();
}
const settle = (ms = 30) => run(() => {}, ms);
async function open() {
  act(() => {
    renderer = create(
      <Profiler id="nota" onRender={() => (renders += 1)}>
        <QueryClientProvider client={client}>
          <ReceiptScreen />
        </QueryClientProvider>
      </Profiler>,
    );
  });
  await settle();
}
/** O toque, e o tempo de a gravação ir e a nota voltar do banco. */
async function press(target: ReactTestInstance | undefined) {
  if (!target) throw new Error('botão não encontrado');
  await run(() => target.props.onPress());
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
/** Dois toques seguidos, sem a tela redesenhar entre um e outro. */
async function pressBoth(first: ReactTestInstance | undefined, second: ReactTestInstance | undefined) {
  if (!first || !second) throw new Error('botão não encontrado');
  await run(() => {
    first.props.onPress();
    second.props.onPress();
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
  'O que você corrigir aqui vale só para a casa (gastos, Mercado do mês, histórico de preço e despensa) e não vai para os preços compartilhados entre casas.';

/** Quem lê preço de nota confirmada: comparativo, histórico de um produto, gastos do mês e compras recentes. */
const PRICE_QUERIES = [['latestPrices'], ['priceHistory', 'p1'], ['spending', '2026-06', '2026-06'], ['purchaseRecords']];
const invalidated = () => PRICE_QUERIES.filter((key) => client.getQueryState(key)?.isInvalidated).map((key) => key[0]);

beforeEach(() => {
  // Os testes partem da chave de Finanças desligada; os que a querem ligada ligam no próprio teste.
  jest.replaceProperty(FEATURES, 'finance', false);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { networkMode: 'always', gcTime: Infinity } } });
  for (const key of PRICE_QUERIES) client.setQueryData(key, []);
  mockDb.stores = [{ id: 's1', name: 'Assaí' }];
  mockDb.writes = [];
  mockDb.rpcs = [];
  mockDb.reads = {};
  mockDb.holds = [];
  mockDb.fails = [];
  mockDb.loses = [];
  mockDb.confirmError = null;
  mockDb.corrections = false;
  mockDb.changeError = null;
  mockDb.addError = null;
  mockDb.probes = 0;
  mockDb.deleteAvailable = false;
  mockDb.deleteProbes = 0;
  mockDb.deleteError = null;
  mockDb.pairs = [];
  mockDb.upserts = [];
  mockMarket.products = [];
  mockPriceHistory.points = [];
  mockMarket.pantryNear = [];
  mockMarket.listItems = [];
  mockMarket.stores = [{ id: 's1', name: 'Assaí', cnpj: null, address: null }];
  mockMarket.productsRefetch = jest.fn();
  mockMarket.late = null;
  mockLearning.learned = undefined;
  mockLearning.enabled = [];
  mockLearning.loads = 0;
  mockFreezer.available = false;
  answers = {};
  jest.mocked(confirmAction).mockReset();
  jest.mocked(askYesNo).mockReset();
  jest.mocked(askYesNo).mockImplementation(async (title) => answers[title] ?? false);
  jest.mocked(notify).mockReset();
  jest.mocked(router.back).mockReset();
  jest.mocked(router.push).mockReset();
  jest.mocked(router.replace).mockReset();
  jest.mocked(router.canGoBack).mockReset();
  jest.mocked(router.canGoBack).mockReturnValue(true);
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
  // A chave de Finanças ligada num teste não passa para o seguinte, mesmo quando ele falha no meio.
  jest.restoreAllMocks();
});

describe('"Quem pagou" e a chave de Finanças (lib/features)', () => {
  beforeEach(() => seed(receipt(), item('a', 'DETERGENTE YPE', 50)));

  it('desligada: a revisão não pergunta quem pagou', async () => {
    await open();
    expect(renderer!.root.findAllByType(PayerChips)).toHaveLength(0);
  });

  it('ligada: a pergunta fica, com quem a nota tem anotado', async () => {
    jest.replaceProperty(FEATURES, 'finance', true);
    await open();
    expect(renderer!.root.findAllByType(PayerChips).map((chips) => chips.props.value)).toEqual([null]);
  });
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
    await run(() => field('Data da compra')!.props.onBlur());
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

  it('o valor é gravado e a nota some em outro aparelho antes de a busca voltar: sem o aviso de "Tentar de novo", a tela é a da nota que sumiu', async () => {
    await open();
    // A gravação chega; quando a busca da nota chega, ela já não existe no banco.
    mockDb.receipts = [];
    await press(chip('Usar R$ 12,90'));
    await settle();
    expect(mockDb.items[1]).toMatchObject({ total_price: 12.9 });
    expect(jest.mocked(notify).mock.calls).toEqual([]);
    expect(page()).toContain('Esta nota não existe mais.');
    expect(page()).not.toContain('Tentar de novo');
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

    await run(() => answer(true));
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

  it('a busca de fundo que falhou e outro aparelho acrescentou um item: "Confirmar nota" busca a nota antes e não vai com os itens de antes', async () => {
    seed(receipt({ total: 60 }), item('a', 'DETERGENTE YPE', 50), item('b', 'SABAO EM PO', 10));
    await open();
    mockDb.fails = [receiptRead];
    await act(async () => {
      await client.refetchQueries({ queryKey: ['receipt', 'r1'] });
    });
    await settle();
    expect(page()).toContain('Não foi possível atualizar. Mostrando o que já estava carregado.');
    // O outro aparelho grava o item novo. A rede volta, e a releitura ainda não chegou quando a pessoa toca.
    mockDb.items.push(item('c', 'PAO FRANCES', 5));
    mockDb.fails = [];
    const releaseRead = hold(receiptRead);
    await press(button('Confirmar nota'));
    await releaseRead();
    // Sem confirm_receipt com os dois itens da tela: a nota chega e avisa, e o toque seguinte confirma com os três.
    expect(mockDb.rpcs).toEqual([]);
    expect(jest.mocked(notify).mock.calls).toEqual([['Nota atualizada', 'Confira os itens e toque em "Confirmar nota" de novo.']]);
    expect(button('Confirmar nota')!.props).toMatchObject({ loading: false, title: 'Confirmar nota (3 itens)' });
    await press(button('Confirmar nota'));
    expect(confirmed()).toEqual(['a', 'b', 'c']);
  });

  it('a busca de fundo que falhou, com "Tentar de novo" antes do toque: "Confirmar nota" leva os três itens de uma vez', async () => {
    seed(receipt({ total: 60 }), item('a', 'DETERGENTE YPE', 50), item('b', 'SABAO EM PO', 10));
    await open();
    mockDb.fails = [receiptRead];
    await act(async () => {
      await client.refetchQueries({ queryKey: ['receipt', 'r1'] });
    });
    await settle();
    mockDb.items.push(item('c', 'PAO FRANCES', 5));
    mockDb.fails = [];
    await press(button('Tentar de novo'));
    await settle();
    await press(button('Confirmar nota'));
    // Só o aviso de salva: nem o de nota atualizada nem o de busca que falhou.
    expect(jest.mocked(notify).mock.calls.map(([title]) => title)).toEqual(['Nota salva']);
    expect(confirmed()).toEqual(['a', 'b', 'c']);
  });

  it('a busca de fundo que falhou e a rede ainda fora no toque de "Confirmar nota": a releitura falha, avisa, e nada é confirmado', async () => {
    seed(receipt({ total: 60 }), item('a', 'DETERGENTE YPE', 50), item('b', 'SABAO EM PO', 10));
    await open();
    mockDb.fails = [receiptRead];
    await act(async () => {
      await client.refetchQueries({ queryKey: ['receipt', 'r1'] });
    });
    await settle();
    mockDb.items.push(item('c', 'PAO FRANCES', 5));
    await press(button('Confirmar nota'));
    expect(mockDb.rpcs).toEqual([]);
    expect(jest.mocked(notify).mock.calls).toEqual([
      ['Não deu para buscar a nota', 'Os itens na tela podem estar diferentes do que foi salvo. Toque em "Tentar de novo" e confira antes de confirmar.'],
    ]);
  });

  it('a busca de fundo que falhou e outro aparelho acrescentou um item: "Usar R$" não grava a conta de antes, avisa, e depois de "Tentar de novo" grava a de agora', async () => {
    seed(receipt({ total: 60 }), item('a', 'DETERGENTE YPE', 50), item('b', 'SABAO EM PO', 0));
    await open();
    mockDb.fails = [receiptRead];
    await act(async () => {
      await client.refetchQueries({ queryKey: ['receipt', 'r1'] });
    });
    await settle();
    expect(page()).toContain('Não foi possível atualizar. Mostrando o que já estava carregado.');
    // O outro aparelho acrescenta um item de R$ 5,00. A tela ainda mostra a conta de antes (faltam R$ 10,00).
    mockDb.items.push(item('c', 'PAO FRANCES', 5));
    await press(chip('Usar R$ 10,00'));
    expect(writes('receipt_items')).toEqual([]);
    expect(jest.mocked(notify).mock.calls).toEqual([
      ['Não deu para buscar a nota', 'Os itens na tela podem estar diferentes do que foi salvo. Toque em "Tentar de novo" e confira antes de confirmar.'],
    ]);
    // Com a nota de agora, a conta é 60 - 50 - 5: R$ 5,00, e é esse o valor que "Usar" grava no item sem valor.
    mockDb.fails = [];
    await press(button('Tentar de novo'));
    await settle();
    await press(chip('Usar R$ 5,00'));
    expect(writes('receipt_items')).toEqual([
      { table: 'receipt_items', verb: 'update', values: { unit_price: 5, total_price: 5 }, filters: { id: 'b', receipt_id: 'r1', total_price: 0 } },
    ]);
  });

  it('a busca de fundo que falhou e a nota já confirmada em outro aparelho: "Descartar nota" não abre a pergunta nem apaga, e depois de "Tentar de novo" a pergunta é a da nota confirmada', async () => {
    seed(receipt({ total: 50 }), item('a', 'DETERGENTE YPE', 50));
    await open();
    mockDb.fails = [receiptRead];
    await act(async () => {
      await client.refetchQueries({ queryKey: ['receipt', 'r1'] });
    });
    await settle();
    mockDb.receipts[0].status = 'confirmed';
    await press(button('Descartar nota'));
    expect(confirmAction).not.toHaveBeenCalled();
    expect(mockDb.writes).toEqual([]);
    expect(jest.mocked(notify).mock.calls).toEqual([
      ['Não deu para buscar a nota', 'Os itens na tela podem estar diferentes do que foi salvo. Toque em "Tentar de novo" e confira antes de confirmar.'],
    ]);
    // Com a nota de agora, a pergunta é a de nota confirmada: os preços saem do comparativo, e a despensa fica.
    mockDb.fails = [];
    await press(button('Tentar de novo'));
    await settle();
    await press(button('Excluir nota'));
    expect(jest.mocked(confirmAction).mock.calls[0].slice(0, 3)).toEqual([
      'Excluir nota',
      'Os preços desta nota saem do comparativo. Itens já na despensa continuam.',
      'Excluir',
    ]);
    expect(mockDb.writes).toEqual([]);
  });

  it('"Remover item" com a busca que falha: o formulário fica aberto, avisa, e o item não sai', async () => {
    seed(receipt({ total: 50 }), item('a', 'DETERGENTE YPE', 50), cheese());
    await open();
    await press(pencil('QJO MUSS KG'));
    mockDb.fails = [receiptRead];
    await act(async () => {
      await client.refetchQueries({ queryKey: ['receipt', 'r1'] });
    });
    await settle();
    await press(button('Remover item'));
    expect(button('Remover item')).toBeDefined();
    expect(mockDb.items).toHaveLength(2);
    expect(writes('receipt_items')).toEqual([]);
    expect(jest.mocked(notify).mock.calls).toEqual([
      ['Não deu para buscar a nota', 'Os itens na tela podem estar diferentes do que foi salvo. Toque em "Tentar de novo" e confira antes de confirmar.'],
    ]);
  });

  it('total digitado com a busca de fundo que falhou e a nota confirmada em outro aparelho: o campo fica aberto com o que foi digitado, avisa, e nada é gravado', async () => {
    seed(receipt(), item('a', 'DETERGENTE YPE', 50));
    await open();
    await press(totalRow());
    act(() => field('Total da nota')!.props.onChangeText('50'));
    mockDb.fails = [receiptRead];
    await act(async () => {
      await client.refetchQueries({ queryKey: ['receipt', 'r1'] });
    });
    await settle();
    mockDb.receipts[0].status = 'confirmed';
    await press(button('Salvar total'));
    // Antes, o total não achava o rascunho, e o campo fechava sem aviso com o total de antes na tela.
    expect(field('Total da nota')!.props.value).toBe('50');
    expect(mockDb.writes).toEqual([]);
    expect(jest.mocked(notify).mock.calls).toEqual([
      ['Não deu para buscar a nota', 'Os itens na tela podem estar diferentes do que foi salvo. Toque em "Tentar de novo" e confira antes de confirmar.'],
    ]);
  });

  it('data e mercado digitados com a busca de fundo que falhou: nada é gravado, o campo da data fica com o que foi digitado, e os dois avisam', async () => {
    seed(receipt(), item('a', 'DETERGENTE YPE', 50));
    await open();
    mockDb.fails = [receiptRead];
    await act(async () => {
      await client.refetchQueries({ queryKey: ['receipt', 'r1'] });
    });
    await settle();
    act(() => field('Data da compra')!.props.onChangeText(`11/06/${YEAR}`));
    await run(() => field('Data da compra')!.props.onBlur());
    await run(() => renderer!.root.findAllByType(PickerModal).find((entry) => entry.props.title === 'Mercado')!.props.onSelect('s2'));
    expect(field('Data da compra')!.props.value).toBe(`11/06/${YEAR}`);
    expect(mockDb.writes).toEqual([]);
    expect(jest.mocked(notify).mock.calls).toEqual([
      ['Não deu para buscar a nota', 'Os itens na tela podem estar diferentes do que foi salvo. Toque em "Tentar de novo" e confira antes de confirmar.'],
      ['Não deu para buscar a nota', 'Os itens na tela podem estar diferentes do que foi salvo. Toque em "Tentar de novo" e confira antes de confirmar.'],
    ]);
  });

  it('data digitada com a busca que falhou, enviada e com o campo saído logo depois: o aviso sai uma vez só, e nada é gravado (rascunho)', async () => {
    seed(receipt(), item('a', 'DETERGENTE YPE', 50));
    await open();
    mockDb.fails = [receiptRead];
    await act(async () => {
      await client.refetchQueries({ queryKey: ['receipt', 'r1'] });
    });
    await settle();
    act(() => field('Data da compra')!.props.onChangeText(`11/06/${YEAR}`));
    await run(() => field('Data da compra')!.props.onSubmitEditing());
    await run(() => field('Data da compra')!.props.onBlur());
    expect(jest.mocked(notify).mock.calls).toEqual([
      ['Não deu para buscar a nota', 'Os itens na tela podem estar diferentes do que foi salvo. Toque em "Tentar de novo" e confira antes de confirmar.'],
    ]);
    expect(field('Data da compra')!.props.value).toBe(`11/06/${YEAR}`);
    expect(mockDb.writes).toEqual([]);
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

    await run(() => jest.mocked(confirmAction).mock.calls[1][3]());
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
    await run(() => field('Data da compra')!.props.onBlur());
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
    await run(() => field('Data da compra')!.props.onBlur());
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

describe('nota já confirmada: dos itens, o valor que faltou, o produto e o item que faltou', () => {
  const confirmedNote = (patch: Row = {}) => receipt({ status: 'confirmed', source: 'qrcode', ...patch });

  beforeEach(() => {
    mockMarket.products = [{ id: 'p1', name: 'Queijo muçarela', category: 'laticinios', shelf_life_days: null }];
    seed(confirmedNote(), item('a', 'DETERGENTE YPE', 50), item('x', 'QJO MUSS KG', 0, { product_id: 'p1', quantity: 0.345, unit: 'kg', unit_price: 37.9 }));
  });

  it('só o item sem valor tem "Preencher"; os outros itens só trocam de produto', async () => {
    mockDb.corrections = true;
    await open();
    expect(said(card('DETERGENTE YPE'))).toEqual(['DETERGENTE YPE', '1 un × R$ 50,00', 'R$ 50,00', 'Escolher produto']);
    expect(said(card('Queijo muçarela'))).toEqual([
      'Queijo muçarela',
      '0,345 kg × R$ 37,90',
      'sem valor',
      'Trocar produto',
      'Faltam R$ 12,90 para o total da nota. Pode ser o valor deste item.',
      'Usar R$ 12,90',
      'Preencher',
      'Se a nota teve desconto, o valor impresso do item é maior.',
    ]);
    expect(chipLabels()).toEqual(['Escolher produto', 'Trocar produto', 'Usar R$ 12,90', 'Preencher']);
    // Sem lápis nos itens e sem botão de confirmar; o total (como a data e o mercado) dá para corrigir, e o "Item" é o do
    // item que a leitura perdeu.
    expect(renderer!.root.findAllByType(IconButton)).toHaveLength(0);
    expect(button('Item')!.props.accessibilityLabel).toBe('Incluir um item que faltou na nota');
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

/** O seletor de produto aberto (o de mercado e o de categoria ficam de fora). */
const productPicker = () =>
  renderer!.root.findAllByType(PickerModal).find((entry) => entry.props.visible && entry.props.title !== 'Mercado' && entry.props.title !== 'Categoria');
/** Os botões que o seletor oferece para o texto digitado (extraActions), sem desenhar. */
const elementButtons = (node: unknown): { title: string; onPress: () => void }[] => {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(elementButtons);
  const element = node as { type: unknown; props?: { children?: unknown; title?: string; onPress?: () => void } };
  if (element.type === Button) return [{ title: element.props!.title!, onPress: element.props!.onPress! }];
  return elementButtons(element.props?.children);
};
const pickerActions = (query: string) => elementButtons(productPicker()!.props.extraActions(query));
/** O botão de criar o produto novo, entre os do seletor. */
const createAction = (query: string) => pickerActions(query).find((entry) => /^(Novo produto|Criar)/.test(entry.title))!;
const correctionCalls = (fn: string) => mockDb.rpcs.filter((call) => call.fn === fn);
const lastNotice = () => jest.mocked(notify).mock.calls.at(-1);

describe('nota já confirmada: "Trocar produto" num item', () => {
  const confirmedNote = (patch: Row = {}) => receipt({ status: 'confirmed', source: 'qrcode', total: 37.9, ...patch });
  const FEIJAO = { id: 'p1', name: 'Feijão', category: 'graos', shelf_life_days: null };
  const ARROZ = { id: 'p2', name: 'Arroz', category: 'graos', shelf_life_days: null };
  const change = (patch: Row) => ({
    p_receipt_id: 'r1',
    p_item_id: 'a',
    p_expected_product_id: 'p1',
    p_product_id: null,
    p_new_product: null,
    p_shelf_life_days: CATEGORY_SHELF_LIFE_DAYS,
    p_freeze_kind: null,
    ...patch,
  });

  beforeEach(() => {
    mockDb.corrections = true;
    mockMarket.products = [FEIJAO, ARROZ];
    seed(
      confirmedNote(),
      item('a', 'ARROZ TJ 5KG', 25, { product_id: 'p1', suggested_category: 'graos' }),
      item('d', 'DET YPE 500ML', 12.9),
    );
  });
  afterEach(() => onlineManager.setOnline(true));

  it('o chip de cada item: "Trocar produto" com produto, "Escolher produto" sem, com o nome no leitor de tela', async () => {
    await open();
    expect(chip('Trocar produto', card('Feijão'))!.props).toMatchObject({
      icon: 'swap-horizontal',
      accessibilityLabel: 'Trocar o produto de Feijão',
      disabled: false,
    });
    expect(chip('Escolher produto', card('DET YPE 500ML'))!.props.accessibilityLabel).toBe('Escolher o produto de DET YPE 500ML');
    expect(mockDb.probes).toBe(1);
    // O toque na linha continua abrindo o produto; a linha sem produto não abre nada.
    act(() => card('Feijão').findByType(ListRow).props.onPress());
    expect(jest.mocked(router.push).mock.calls).toEqual([[{ pathname: '/produto/[id]', params: { id: 'p1' } }]]);
    expect(card('DET YPE 500ML').findByType(ListRow).props.onPress).toBeUndefined();
  });

  it('sem as funções no banco (antes da migração): nem o chip nem "Item", a tela é a de antes', async () => {
    mockDb.corrections = 'missing';
    await open();
    expect(chipLabels()).toEqual([]);
    expect(button('Item')).toBeUndefined();
    expect(page()).toContain(CORRECTION_NOTE);
  });

  it('na revisão, nada muda: o "Item" e o seletor de sempre, e ninguém pergunta ao banco pelas correções', async () => {
    seed(receipt(), item('a', 'ARROZ TJ 5KG', 25, { product_id: 'p1', suggested_category: 'graos' }));
    await open();
    expect(mockDb.probes).toBe(0);
    expect(chipLabels()).not.toContain('Trocar produto');
    expect(button('Item')!.props.accessibilityLabel).toBeUndefined();
    await press(chip('Feijão'));
    expect(productPicker()!.props).toMatchObject({ title: 'Qual produto é este?', message: undefined, initialQuery: 'Feijão' });
    expect(pickerActions('Arroz cateto do sítio').map((entry) => entry.title)).toEqual([
      'Novo produto "Arroz cateto do sítio"',
      'Não acompanhar preço deste item',
    ]);
  });

  it('o seletor: o título, a frase do que muda, o nome de agora, e sem "Não acompanhar preço"', async () => {
    await open();
    await press(chip('Trocar produto'));
    expect(productPicker()!.props).toMatchObject({
      title: 'Qual produto é este?',
      message:
        'A compra passa para o produto escolhido no histórico de preço e nos gastos, e na despensa, se foi para lá. A casa aprende junto: as próximas notas com esta descrição costumam vir com ele.',
      initialQuery: 'Feijão',
    });
    expect(pickerActions('Arroz cateto do sítio').map((entry) => entry.title)).toEqual(['Novo produto "Arroz cateto do sítio" (Grãos, massas e cereais)']);
    // Sem produto, começa pelo nome que a leitura sugeriu.
    await run(() => productPicker()!.props.onClose());
    await press(chip('Escolher produto'));
    expect(productPicker()!.props.initialQuery).toBe('DET YPE 500ML');
  });

  it('o mesmo produto não grava nada', async () => {
    await open();
    await press(chip('Trocar produto'));
    await run(() => productPicker()!.props.onSelect('p1'));
    expect(productPicker()).toBeUndefined();
    expect(mockDb.rpcs).toEqual([]);
    expect(notify).not.toHaveBeenCalled();
  });

  it('outro produto: vai o produto que a tela mostrava e as validades do app; o chip fica desligado até a nota voltar', async () => {
    await open();
    await press(chip('Trocar produto'));
    const release = hold(({ table }) => table === 'change_receipt_item_product');
    await run(() => productPicker()!.props.onSelect('p2'));
    expect(correctionCalls('change_receipt_item_product').map((call) => call.args)).toEqual([change({ p_product_id: 'p2' })]);
    expect(chip('Trocar produto', card('Feijão'))!.props.disabled).toBe(true);
    // O valor do item não deixa de perguntar: a troca não é de valor.
    await release();
    expect(said(card('Arroz'))).toEqual(['Arroz', '1 un × R$ 25,00', 'R$ 25,00', 'Trocar produto']);
    expect(chip('Trocar produto', card('Arroz'))!.props.disabled).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it('o produto novo leva a categoria que o botão mostra (a do nome), nunca a do produto de antes: digitado, nome da lista e "Usar"', async () => {
    mockMarket.listItems = [{ id: 'l1', list_id: 'lista1', list_name: 'Mercado', name: 'Leite integral', category: 'outros', product_id: null, checked_at: null }];
    await open();
    // 1. O nome digitado.
    await press(chip('Trocar produto'));
    const create = createAction('Leite');
    expect(create.title).toBe('Novo produto "Leite" (Laticínios)');
    await run(() => create.onPress());
    expect(correctionCalls('change_receipt_item_product').at(-1)!.args).toEqual(
      change({ p_new_product: { name: 'Leite', category: 'laticinios' }, p_freeze_kind: null }),
    );
    // 2. O nome da lista de compras, sem produto: o subtítulo diz a categoria que vai.
    mockDb.items[0].product_id = 'p1';
    await act(async () => {
      await client.refetchQueries({ queryKey: ['receipt', 'r1'] });
    });
    await settle();
    await press(chip('Trocar produto'));
    const suggestion = productPicker()!
      .props.suggestions('Leite')
      .find((entry: { title: string; subtitle: string }) => entry.title === 'Leite integral' && entry.subtitle.startsWith('Está na lista'));
    expect(suggestion.subtitle).toBe('Está na lista de compras · Laticínios');
    await run(() => productPicker()!.props.onSelectSuggestion(suggestion.id));
    expect(correctionCalls('change_receipt_item_product').at(-1)!.args).toEqual(
      change({ p_new_product: { name: 'Leite integral', category: 'laticinios' } }),
    );
    // 3. "Usar" o nome que já existe com outra grafia (um da lista, em "Outros": vale a categoria do nome).
    mockMarket.listItems = [{ id: 'l2', list_id: 'lista1', list_name: 'Mercado', name: 'Banana nanica', category: 'outros', product_id: null, checked_at: null }];
    mockDb.items[0].product_id = 'p1';
    await act(async () => {
      await client.refetchQueries({ queryKey: ['receipt', 'r1'] });
    });
    await settle();
    await press(chip('Trocar produto'));
    const [use, createAnyway] = pickerActions('Bananas nanicas');
    expect(use.title).toBe('Usar "Banana nanica" (já existe)');
    expect(createAnyway.title).toBe('Criar "Bananas nanicas" mesmo assim (Frutas e verduras)');
    await run(() => use.onPress());
    expect(correctionCalls('change_receipt_item_product').at(-1)!.args).toEqual(
      change({ p_new_product: { name: 'Banana nanica', category: 'hortifruti' } }),
    );
  });

  it('a carne que vira outra carne: vai o tipo do congelador do produto escolhido', async () => {
    mockMarket.products = [
      { id: 'pf', name: 'Frango', category: 'carnes', shelf_life_days: null },
      { id: 'pm', name: 'Carne moída', category: 'carnes', shelf_life_days: null },
    ];
    seed(confirmedNote(), item('a', 'COXA KG', 20, { product_id: 'pf', unit: 'kg', suggested_category: 'carnes' }));
    await open();
    await press(chip('Trocar produto'));
    await run(() => productPicker()!.props.onSelect('pm'));
    expect(correctionCalls('change_receipt_item_product')[0].args).toMatchObject({ p_expected_product_id: 'pf', p_product_id: 'pm', p_freeze_kind: 'carne_moida' });
  });

  it('NK018 (o produto da linha já tinha mudado): o aviso não culpa ninguém, e a nota é buscada de novo', async () => {
    await open();
    mockDb.changeError = { code: 'NK018', message: 'receipt item changed', details: null, hint: null };
    const readsBefore = mockDb.reads.receipts;
    await press(chip('Trocar produto'));
    await run(() => productPicker()!.props.onSelect('p2'));
    expect(lastNotice()).toEqual([
      'Produto não trocado',
      'O produto deste item já tinha mudado, e nada foi trocado. Confira o produto na nota e troque de novo, se precisar.',
    ]);
    expect(mockDb.reads.receipts).toBeGreaterThan(readsBefore);
    expect(notify).toHaveBeenCalledTimes(1);
    // A recusa teve resposta: o toque seguinte abre o seletor, sem buscar a nota antes.
    await press(chip('Trocar produto'));
    expect(productPicker()).toBeDefined();
  });

  it('o produto escolhido sumiu no banco (juntado ou excluído): o aviso de sempre, e o toque seguinte abre o seletor sem buscar a nota antes', async () => {
    await open();
    mockDb.changeError = { code: 'P0002', message: 'product not found', details: null, hint: null };
    await press(chip('Trocar produto'));
    await run(() => productPicker()!.props.onSelect('p2'));
    expect(lastNotice()).toEqual(['Produto não trocado', PRODUCT_MERGED_AWAY]);
    expect(notify).toHaveBeenCalledTimes(1);
    // A recusa teve resposta, e o hook só a devolve com a nota já relida: a nota em tela é a de agora, e não a que
    // ficou para trás de uma gravação sem resposta.
    mockDb.changeError = null;
    const readsBefore = mockDb.reads.receipts;
    await press(chip('Trocar produto'));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(mockDb.reads.receipts).toBe(readsBefore);
    expect(productPicker()).toBeDefined();
  });

  it('o produto saiu do catálogo entre o desenho e o toque: o aviso, os produtos buscados de novo, e nada vai ao banco', async () => {
    await open();
    await press(chip('Trocar produto'));
    expect(mockMarket.productsRefetch).not.toHaveBeenCalled();
    await run(() => productPicker()!.props.onSelect('sumiu'));
    expect(lastNotice()).toEqual(['Produto não trocado', PRODUCT_MERGED_AWAY]);
    expect(mockMarket.productsRefetch).toHaveBeenCalledTimes(1);
    expect(mockDb.rpcs).toEqual([]);
  });

  it('o banco ainda sem a função (o cache de esquema de antes): avisa que falta atualizar, e nada muda', async () => {
    await open();
    mockDb.changeError = { code: 'PGRST202', message: 'Could not find the function public.change_receipt_item_product', details: null, hint: null };
    await press(chip('Trocar produto'));
    await run(() => productPicker()!.props.onSelect('p2'));
    expect(lastNotice()).toEqual(['Produto não trocado', 'Ainda não dá para corrigir os itens de uma nota confirmada: falta atualizar o banco do app.']);
    expect(mockDb.items[0].product_id).toBe('p1');
  });

  it('sem internet: o toque diz para trocar quando a conexão voltar, e o seletor não abre', async () => {
    await open();
    onlineManager.setOnline(false);
    await press(chip('Trocar produto'));
    expect(lastNotice()).toEqual(['Sem internet agora', 'Troque o produto quando a conexão voltar.']);
    expect(productPicker()).toBeUndefined();
  });

  it('com outro item gravando, o toque avisa e não abre o seletor', async () => {
    await open();
    await press(chip('Trocar produto'));
    const release = hold(({ table }) => table === 'change_receipt_item_product');
    await run(() => productPicker()!.props.onSelect('p2'));
    await press(chip('Escolher produto'));
    expect(lastNotice()).toEqual(['Aguarde', 'Outro item ainda está sendo salvo. Toque de novo quando a nota voltar.']);
    expect(productPicker()).toBeUndefined();
    await release();
  });

  it('a nota relida falha: "Produto trocado", e a pergunta do valor do item continua', async () => {
    seed(confirmedNote(), item('a', 'ARROZ TJ 5KG', 0, { product_id: 'p1', suggested_category: 'graos', unit_price: 0 }));
    await open();
    expect(chip('Preencher')).toBeDefined();
    await press(chip('Trocar produto'));
    mockDb.fails = [receiptRead];
    await run(() => productPicker()!.props.onSelect('p2'));
    expect(lastNotice()).toEqual([
      'Produto trocado',
      'Não deu para atualizar a nota na tela: o item pode aparecer com o produto de antes até ela ser buscada de novo.',
    ]);
    expect(chip('Preencher')).toBeDefined();
  });

  it('a nota relida demora: sem aviso; o toque seguinte no mesmo item busca a nota antes e não manda nada', async () => {
    await open();
    await press(chip('Trocar produto'));
    const releaseRead = hold(receiptRead);
    await run(() => productPicker()!.props.onSelect('p2'));
    await settle(4200);
    expect(notify).not.toHaveBeenCalled();
    // A tela ainda mostra o feijão: o toque não manda o produto de antes da troca que já foi.
    await run(() => chip('Trocar produto', card('Feijão'))!.props.onPress());
    expect(productPicker()).toBeUndefined();
    await releaseRead();
    expect(lastNotice()).toEqual(['Nota atualizada', 'Confira o item e toque de novo, se ainda precisar trocar o produto.']);
    expect(correctionCalls('change_receipt_item_product')).toHaveLength(1);
    expect(said(card('Arroz'))[0]).toBe('Arroz');
  }, 15_000);

  it('a busca de fundo que falhou: o toque busca a nota antes', async () => {
    await open();
    mockDb.fails = [receiptRead];
    await act(async () => {
      await client.refetchQueries({ queryKey: ['receipt', 'r1'] });
    });
    await settle();
    await press(chip('Trocar produto'));
    expect(lastNotice()).toEqual([
      'Não deu para buscar a nota',
      'Os itens na tela podem estar diferentes do que está salvo. Toque em "Tentar de novo" e corrija o item depois.',
    ]);
    expect(productPicker()).toBeUndefined();
    mockDb.fails = [];
    await press(chip('Trocar produto'));
    expect(lastNotice()![0]).toBe('Nota atualizada');
    await press(chip('Trocar produto'));
    expect(productPicker()).toBeDefined();
  });
});

describe('nota já confirmada: "Excluir o produto de antes", depois de "Trocar produto"', () => {
  const confirmedNote = (patch: Row = {}) => receipt({ status: 'confirmed', source: 'qrcode', total: 37.9, ...patch });
  const FEIJAO = { id: 'p1', name: 'Feijão', category: 'graos', shelf_life_days: null };
  const ARROZ = { id: 'p2', name: 'Arroz', category: 'graos', shelf_life_days: null };
  const OFFER = '"Feijão", o produto de antes, ficou sem nenhuma compra.';
  const DELETED = '"Feijão" foi excluído dos produtos da casa.';
  const offerButton = (title: string) => renderer!.root.findAllByType(Button).find((entry) => entry.props.title === title);
  const leftOfferShown = () => offerButton('Excluir o produto de antes') !== undefined;
  const announced = () => jest.mocked(AccessibilityInfo.announceForAccessibility).mock.calls.map(([text]) => text);
  const focused = () => jest.mocked(AccessibilityInfo.sendAccessibilityEvent).mock.calls;
  /** O foco foi uma vez, e para esta View (por identidade: comparar o objeto em si leva a árvore toda para a mensagem). */
  const focusedOn = (view: unknown) => focused().length === 1 && focused()[0][0] === view && focused()[0][1] === 'focus';
  const nextFrame = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  // A View de mentira do "Trocar produto" do item (é para ela que o foco do leitor de tela vai), comparada por
  // identidade: o objeto tem laços com a árvore e não se compara por conteúdo.
  const chipView = (description: string) => chip('Trocar produto', card(description))!.findAllByType(View)[0].instance;
  /** A linha do feijão passa para o arroz. */
  async function changeToRice() {
    await open();
    await press(chip('Trocar produto'));
    await run(() => productPicker()!.props.onSelect('p2'));
  }
  /** Uma linha de outra nota com o feijão (`status` da nota). */
  const otherNoteLine = (status: 'confirmed' | 'draft') => {
    mockDb.receipts.push(receipt({ id: `r-${status}`, status }));
    mockDb.items.push(item(`x-${status}`, 'FEIJAO CARIOCA 1KG', 8, { receipt_id: `r-${status}`, product_id: 'p1' }));
  };

  beforeEach(() => {
    mockDb.corrections = true;
    mockDb.deleteAvailable = true;
    mockMarket.products = [FEIJAO, ARROZ];
    seed(
      confirmedNote(),
      item('a', 'ARROZ TJ 5KG', 25, { product_id: 'p1', suggested_category: 'graos' }),
      item('d', 'DET YPE 500ML', 12.9),
    );
    // Os dois já são de mentira no Jest do React Native, e guardam as chamadas de um teste para o outro.
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined).mockClear();
    jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => undefined).mockClear();
  });
  afterEach(() => onlineManager.setOnline(true));

  it('a troca deixou o produto de antes sem nenhuma linha de nota: a oferta aparece na linha trocada, e o leitor de tela a ouve', async () => {
    await changeToRice();
    // Decidido por uma leitura feita agora, no banco (a mesma do toque de excluir), com o banco que sabe excluir.
    expect(mockDb.deleteProbes).toBe(1);
    expect(mockDb.reads.products).toBe(1);
    expect(said(card('Arroz'))).toEqual(['Arroz', '1 un × R$ 25,00', 'R$ 25,00', 'Trocar produto', OFFER, 'Excluir o produto de antes', 'Manter']);
    expect(offerButton('Excluir o produto de antes')!.props).toMatchObject({
      variant: 'danger',
      accessibilityLabel: 'Excluir o produto de antes, Feijão',
    });
    expect(offerButton('Manter')!.props.accessibilityLabel).toBe('Manter o produto Feijão');
    expect(said(card('DET YPE 500ML'))).not.toContain(OFFER);
    expect(announced()).toEqual([`${OFFER} Dá para excluir o produto de antes ou manter.`]);
    // A oferta não leva o foco, e não pergunta nada sozinha.
    expect(focused().length).toBe(0);
    expect(confirmAction).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it.each([
    ['outra linha desta nota', () => mockDb.items.push(item('b', 'FEIJAO CARIOCA 1KG', 8, { product_id: 'p1', position: 2 }))],
    ['uma linha de outra nota confirmada', () => otherNoteLine('confirmed')],
    ['uma linha de uma nota em revisão', () => otherNoteLine('draft')],
  ])('o produto de antes ainda tem %s: a leitura diz, e nada é oferecido', async (_where, addLine) => {
    addLine();
    await changeToRice();
    expect(mockDb.reads.products).toBe(1);
    expect(page()).not.toContain(OFFER);
    expect(offerButton('Excluir o produto de antes')).toBeUndefined();
    expect(announced()).toEqual([]);
  });

  it.each<[false | 'missing' | 'fails']>([[false], ['missing'], ['fails']])(
    'o banco que ainda não sabe excluir (delete_product_available: %s): nada é oferecido, e o produto nem é lido',
    async (probe) => {
      mockDb.deleteAvailable = probe;
      await changeToRice();
      expect(mockDb.deleteProbes).toBe(1);
      expect(mockDb.reads.products).toBeUndefined();
      expect(page()).not.toContain(OFFER);
      expect(notify).not.toHaveBeenCalled();
    },
  );

  it('a leitura do produto de antes falha: nada é oferecido, sem aviso (o caminho por Preços continua)', async () => {
    mockDb.fails = [({ table }) => table === 'products'];
    await changeToRice();
    expect(mockDb.reads.products).toBe(1);
    expect(page()).not.toContain(OFFER);
    expect(notify).not.toHaveBeenCalled();
  });

  it('sem internet quando a troca respondeu: nada é oferecido, sem perguntar nem ler', async () => {
    await open();
    await press(chip('Trocar produto'));
    const release = hold(({ table }) => table === 'change_receipt_item_product');
    await run(() => productPicker()!.props.onSelect('p2'));
    onlineManager.setOnline(false);
    await release();
    // A nota relida espera a internet: a tela desiste dela no prazo, e só então confere o produto de antes.
    await settle(4200);
    expect(mockDb.deleteProbes).toBe(0);
    expect(mockDb.reads.products).toBeUndefined();
    expect(page()).not.toContain(OFFER);
  }, 15_000);

  it('a linha sem produto ("Escolher produto") e a troca que respondeu sem mudar a linha: não há produto de antes, e nada é perguntado', async () => {
    await open();
    await press(chip('Escolher produto'));
    await run(() => productPicker()!.props.onSelect('p2'));
    expect(correctionCalls('change_receipt_item_product')).toHaveLength(1);
    // A linha do feijão já está no arroz no banco (a resposta de um toque anterior se perdeu): `changed` falso.
    mockDb.items[0].product_id = 'p2';
    await press(chip('Trocar produto', card('Feijão')));
    await run(() => productPicker()!.props.onSelect('p2'));
    expect(correctionCalls('change_receipt_item_product')).toHaveLength(2);
    expect(mockDb.deleteProbes).toBe(0);
    expect(page()).not.toContain(OFFER);
  });

  it('na revisão não há "Trocar produto": escolher outro produto não pergunta nada ao banco', async () => {
    seed(receipt(), item('a', 'ARROZ TJ 5KG', 25, { product_id: 'p1', suggested_category: 'graos' }));
    await open();
    await press(chip('Feijão'));
    await run(() => productPicker()!.props.onSelect('p2'));
    expect(mockDb.deleteProbes).toBe(0);
    expect(page()).not.toContain('Excluir o produto de antes');
  });

  it('"Excluir o produto de antes": a leitura de novo, a pergunta de sempre, delete_product com o nome lido; a tela fica, diz que excluiu, e o foco volta ao "Trocar produto"', async () => {
    await changeToRice();
    await press(offerButton('Excluir o produto de antes'));
    // O mesmo caminho da tela do produto: lê de novo e pergunta com o nome lido, sem mandar nada antes do sim.
    expect(mockDb.reads.products).toBe(2);
    expect(jest.mocked(confirmAction).mock.calls).toHaveLength(1);
    const [title, message, confirmLabel, onConfirm] = jest.mocked(confirmAction).mock.calls[0];
    expect([title, message, confirmLabel]).toEqual([
      DELETE_TITLE,
      deleteQuestion('Feijão', { inPantry: false, onList: false, barcodes: { count: 0, first: null } }),
      DELETE_CONFIRM,
    ]);
    expect(correctionCalls('delete_product')).toEqual([]);
    await run(() => onConfirm());
    expect(correctionCalls('delete_product').map((call) => call.args)).toEqual([{ p_id: 'p1', p_name: 'Feijão' }]);
    expect(mockMarket.products).toEqual([ARROZ]);
    // A tela da nota fica: é a nota que a pessoa estava corrigindo. O aviso fica no lugar da oferta.
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(said(card('Arroz'))).toEqual(['Arroz', '1 un × R$ 25,00', 'R$ 25,00', 'Trocar produto', DELETED]);
    expect(offerButton('Manter')).toBeUndefined();
    expect(announced().at(-1)).toBe(DELETED);
    expect(notify).not.toHaveBeenCalled();
    await nextFrame();
    expect(focusedOn(chipView('Arroz'))).toBe(true);
  });

  it('"Manter": a oferta sai, nada é excluído, e o foco volta ao "Trocar produto" da linha', async () => {
    await changeToRice();
    await press(offerButton('Manter'));
    await nextFrame();
    expect(page()).not.toContain(OFFER);
    expect(offerButton('Excluir o produto de antes')).toBeUndefined();
    expect(confirmAction).not.toHaveBeenCalled();
    expect(correctionCalls('delete_product')).toEqual([]);
    expect(mockMarket.products).toEqual([FEIJAO, ARROZ]);
    expect(focusedOn(chipView('Arroz'))).toBe(true);
  });

  it('o produto de antes ganhou uma compra antes do toque: a recusa de sempre, nada é perguntado nem excluído, e a oferta sai', async () => {
    await changeToRice();
    otherNoteLine('confirmed');
    await press(offerButton('Excluir o produto de antes'));
    expect(lastNotice()).toEqual([DELETE_PURCHASED_TITLE, DELETE_PURCHASED]);
    expect(confirmAction).not.toHaveBeenCalled();
    expect(correctionCalls('delete_product')).toEqual([]);
    expect(page()).not.toContain(OFFER);
    await nextFrame();
    expect(focusedOn(chipView('Arroz'))).toBe(true);
  });

  it('a tela saiu: a conferência que volta depois não oferece nem anuncia nada', async () => {
    await open();
    await press(chip('Trocar produto'));
    const release = hold(({ table }) => table === 'products');
    await run(() => productPicker()!.props.onSelect('p2'));
    await act(async () => renderer!.unmount());
    renderer = undefined;
    await release();
    expect(announced()).toEqual([]);
  });

  it('a tela saiu durante a leitura do toque: nada é perguntado nem avisado', async () => {
    await changeToRice();
    const release = hold(({ table }) => table === 'products');
    await press(offerButton('Excluir o produto de antes'));
    await act(async () => renderer!.unmount());
    renderer = undefined;
    await release();
    expect(confirmAction).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('a nota não tinha os pares "São diferentes" na memória: o toque os busca, e o par que passa para o gêmeo de nome é gravado', async () => {
    // A casa recusou "Limao / Limão siciliano"; pela regra do nome, isso também esconde "Limão / Limão siciliano".
    // A nota confirmada não mostra os pares (nem Preços nem a tela de um produto foram abertos nesta abertura do app):
    // sem buscá-los, delete_product os apagaria (cascade) e a sugestão escondida pelo nome voltaria para sempre.
    mockMarket.products = [
      { id: 'p1', name: 'Limao', category: 'hortifruti', shelf_life_days: null },
      ARROZ,
      { id: 'p3', name: 'Limão', category: 'hortifruti', shelf_life_days: null },
      { id: 'p4', name: 'Limão siciliano', category: 'hortifruti', shelf_life_days: null },
    ];
    mockDb.pairs = [{ ...orderedPair('p1', 'p4') }];
    await changeToRice();
    expect(client.getQueryData(['productDistinctPairs'])).toBeUndefined();
    await press(offerButton('Excluir o produto de antes'));
    expect(mockDb.reads.product_distinct_pairs).toBe(1);
    await run(() => jest.mocked(confirmAction).mock.calls[0][3]());
    expect(correctionCalls('delete_product').map((call) => call.args)).toEqual([{ p_id: 'p1', p_name: 'Limao' }]);
    expect(mockDb.upserts).toEqual([{ table: 'product_distinct_pairs', rows: [orderedPair('p3', 'p4')], options: { ignoreDuplicates: true } }]);
    expect(mockDb.pairs).toEqual([orderedPair('p3', 'p4')]);
    expect(said(card('Arroz'))).toContain('"Limao" foi excluído dos produtos da casa.');
  });

  it('a busca dos pares falha no toque: "Não deu para conferir", nada é perguntado nem excluído, e a oferta fica', async () => {
    await changeToRice();
    mockDb.fails = [({ table }) => table === 'product_distinct_pairs'];
    await press(offerButton('Excluir o produto de antes'));
    expect(lastNotice()).toEqual([DELETE_CHECK_FAILED_TITLE, 'caiu a rede']);
    expect(confirmAction).not.toHaveBeenCalled();
    expect(correctionCalls('delete_product')).toEqual([]);
    expect(said(card('Arroz'))).toContain(OFFER);
    // De novo, com a rede de volta: os pares chegam, e a pergunta de sempre sai.
    mockDb.fails = [];
    await press(offerButton('Excluir o produto de antes'));
    expect(jest.mocked(confirmAction).mock.calls).toHaveLength(1);
  });

  it('a troca de outra linha respondeu enquanto o pedido de excluir ia, e o banco recusou o de antes: a oferta nova fica, e o foco não pula', async () => {
    const DETERGENTE = { id: 'p5', name: 'Detergente', category: 'limpeza', shelf_life_days: null };
    const SABAO = { id: 'p6', name: 'Sabão', category: 'limpeza', shelf_life_days: null };
    const DETERGENT_OFFER = '"Detergente", o produto de antes, ficou sem nenhuma compra.';
    mockMarket.products = [FEIJAO, ARROZ, DETERGENTE, SABAO];
    mockDb.items[1].product_id = 'p5';
    await changeToRice();
    await press(offerButton('Excluir o produto de antes'));
    const release = hold(({ table }) => table === 'delete_product');
    // Outro aparelho confirmou uma nota com o feijão enquanto isso.
    mockDb.deleteError = { code: 'NK016', message: 'product has purchases', details: null, hint: null };
    await run(() => jest.mocked(confirmAction).mock.calls[0][3]());
    await press(chip('Trocar produto', card('Detergente')));
    await run(() => productPicker()!.props.onSelect('p6'));
    await release();
    await nextFrame();
    expect(lastNotice()).toEqual([DELETE_PURCHASED_TITLE, DELETE_PURCHASED]);
    expect(said(card('Sabão'))).toContain(DETERGENT_OFFER);
    expect(focused().length).toBe(0);
  });

  it('a troca de outra linha respondeu enquanto o pedido de excluir ia: a oferta nova fica, o foco não pula, e o excluído é avisado', async () => {
    const DETERGENTE = { id: 'p5', name: 'Detergente', category: 'limpeza', shelf_life_days: null };
    const SABAO = { id: 'p6', name: 'Sabão', category: 'limpeza', shelf_life_days: null };
    const DETERGENT_OFFER = '"Detergente", o produto de antes, ficou sem nenhuma compra.';
    mockMarket.products = [FEIJAO, ARROZ, DETERGENTE, SABAO];
    mockDb.items[1].product_id = 'p5';
    await changeToRice();
    await press(offerButton('Excluir o produto de antes'));
    // O sinal fraco: o pedido de excluir o feijão fica no caminho.
    const release = hold(({ table }) => table === 'delete_product');
    await run(() => jest.mocked(confirmAction).mock.calls[0][3]());
    expect(correctionCalls('delete_product')).toHaveLength(1);
    // Enquanto isso, a pessoa troca o detergente pelo sabão: a oferta do detergente toma o lugar, e é ouvida.
    await press(chip('Trocar produto', card('Detergente')));
    await run(() => productPicker()!.props.onSelect('p6'));
    expect(said(card('Sabão'))).toContain(DETERGENT_OFFER);
    expect(page()).not.toContain(OFFER);
    await release();
    await nextFrame();
    expect(mockMarket.products).toEqual([ARROZ, DETERGENTE, SABAO]);
    // A oferta do detergente continua (não foi respondida), e o aviso do feijão não toma o lugar dela.
    expect(said(card('Sabão'))).toContain(DETERGENT_OFFER);
    expect(page()).not.toContain(DELETED);
    expect(lastNotice()).toEqual(['Produto excluído', DELETED]);
    expect(focused().length).toBe(0);
    expect(announced()).toEqual([`${OFFER} Dá para excluir o produto de antes ou manter.`, `${DETERGENT_OFFER} Dá para excluir o produto de antes ou manter.`]);
  });

  it.each<[string, 'fails' | 'slow']>([
    ['a nota relida falha', 'fails'],
    ['a nota relida passa do prazo', 'slow'],
  ])('%s: a linha ainda mostra o produto de antes, a oferta fica escondida e calada, e só é ouvida quando aparece', async (_case, how) => {
    await open();
    await press(chip('Trocar produto'));
    let release: (() => Promise<void>) | undefined;
    if (how === 'fails') mockDb.fails = [receiptRead];
    else release = hold(receiptRead);
    await run(() => productPicker()!.props.onSelect('p2'), how === 'slow' ? 4200 : 30);
    // A troca respondeu e a leitura diz que o feijão dá para excluir, mas a nota em tela ainda está com ele.
    expect(mockDb.reads.products).toBe(1);
    expect(leftOfferShown()).toBe(false);
    expect(said(card('Feijão'))).not.toContain(OFFER);
    expect(announced()).toEqual([]);
    // A nota volta ("Tentar de novo", ou a busca lenta que chega): a linha no arroz, e só agora a oferta aparece e é ouvida.
    if (how === 'fails') {
      mockDb.fails = [];
      await act(async () => {
        await client.refetchQueries({ queryKey: ['receipt', 'r1'] });
      });
      await settle();
    } else {
      await release!();
    }
    expect(said(card('Arroz'))).toContain(OFFER);
    expect(announced()).toEqual([`${OFFER} Dá para excluir o produto de antes ou manter.`]);
    // Desenhada de novo (outra busca da nota), não se repete.
    await act(async () => {
      await client.refetchQueries({ queryKey: ['receipt', 'r1'] });
    });
    await settle();
    expect(announced()).toHaveLength(1);
  }, 15_000);
});

describe('nota já confirmada: "Item", o item que a leitura perdeu', () => {
  const confirmedNote = (patch: Row = {}) => receipt({ status: 'confirmed', source: 'qrcode', total: 66.7, ...patch });
  const FEIJAO = { id: 'p1', name: 'Feijão carioca', category: 'graos', shelf_life_days: null };
  const DETERGENTE = { id: 'p3', name: 'Detergente', category: 'limpeza', shelf_life_days: null };
  const editorOpen = () => page().includes('Item que faltou');
  const SUMMARY = 'Incluir este item?';
  /** "Item", o produto e os campos: o formulário pronto para "Incluir item". */
  async function fill(productId = 'p1', total = '15,80', quantity = '2') {
    await press(button('Item'));
    await run(() => productPicker()!.props.onSelect(productId));
    act(() => field('Quantidade')!.props.onChangeText(quantity));
    act(() => field('Total do item')!.props.onChangeText(total));
  }

  beforeEach(() => {
    // No iOS o formulário espera o seletor sumir (ver o teste dele); nos outros, abre na hora.
    jest.replaceProperty(Platform, 'OS', 'android');
    mockDb.corrections = true;
    mockMarket.products = [FEIJAO, DETERGENTE];
    seed(confirmedNote(), item('a', 'DETERGENTE YPE', 50));
  });
  afterEach(() => onlineManager.setOnline(true));

  it('o seletor do produto vem primeiro, com a frase da leitura; na nota digitada à mão, a frase dela', async () => {
    await open();
    await press(button('Item'));
    expect(productPicker()!.props).toMatchObject({
      title: 'Qual produto faltou?',
      message: 'Escolha o produto do item que a leitura não pegou. Depois vêm a quantidade e o valor.',
      initialQuery: '',
    });
    expect(createAction('Sabão de coco').title).toBe('Novo produto "Sabão de coco" (Limpeza)');
    await act(async () => renderer!.unmount());
    renderer = undefined;
    seed(confirmedNote({ source: 'manual' }), item('a', 'DETERGENTE YPE', 50));
    await open();
    await press(button('Item'));
    expect(productPicker()!.props.message).toBe('Escolha o produto do item que ficou fora da nota. Depois vêm a quantidade e o valor.');
  });

  it('o formulário: a linha do produto, o que acontece, a descrição com o nome dele, e a despensa no padrão da categoria', async () => {
    await open();
    await press(button('Item'));
    await run(() => productPicker()!.props.onSelect('p1'));
    expect(page()).toContain(
      'Item que faltou | Produto: Feijão carioca (Grãos, massas e cereais) | O item entra nesta nota, e com ela nos gastos e no histórico de preço do produto. Ele não vai para os preços compartilhados entre casas.',
    );
    expect(field('Descrição')!.props).toMatchObject({ value: 'Feijão carioca', autoFocus: false });
    expect(field('Quantidade')!.props.value).toBe('1');
    expect(field('Preço unitário')!.props.value).toBe('');
    expect(chip('Vai para a despensa')!.props.selected).toBe(true);
    expect(button('Incluir item')).toBeDefined();
    expect(button('Remover item')).toBeUndefined();
    // Sem campo de validade: a data se corrige depois, na despensa.
    expect(renderer!.root.findAllByProps({ placeholder: 'Validade' })).toHaveLength(0);
    await run(() => renderer!.root.findAllByType(IconButton).find((entry) => entry.props.label === 'Fechar')!.props.onPress());
    await press(button('Item'));
    await run(() => productPicker()!.props.onSelect('p3'));
    expect(chip('Não vai para a despensa')!.props.selected).toBe(false);
    expect(page()).toContain('Produto: Detergente (Limpeza)');
  });

  it('o pedido: o id feito no aparelho, os campos, o produto e a despensa com a validade estimada; depois, a linha na nota', async () => {
    answers = { [SUMMARY]: true };
    await open();
    await fill();
    await press(button('Incluir item'));
    expect(asked(SUMMARY)).toEqual([
      [
        SUMMARY,
        'Feijão carioca: 2 un, R$ 15,80, e vai para a despensa. Depois de incluído, a quantidade e o valor não mudam mais, e o item só sai da nota excluindo a nota inteira.',
        'Incluir',
        'Voltar',
      ],
    ]);
    const [call] = correctionCalls('add_confirmed_receipt_item');
    expect(call.args).toEqual({
      p_receipt_id: 'r1',
      p_item: {
        id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
        raw_description: 'Feijão carioca',
        quantity: 2,
        unit: 'un',
        unit_price: 7.9,
        total_price: 15.8,
        product_id: 'p1',
        pantry: {
          name: 'Feijão carioca',
          category: 'graos',
          purchased_on: `${YEAR}-06-10`,
          expires_on: `${YEAR}-12-07`,
          expiry_source: 'categoria',
        },
      },
    });
    expect(editorOpen()).toBe(false);
    expect(said(card('Feijão carioca'))).toEqual(['Feijão carioca', '2 un × R$ 7,90', 'R$ 15,80', 'Trocar produto']);
    expect(notify).not.toHaveBeenCalled();
  });

  it('"Trocar produto" na linha incluída: o seletor diz o que muda, sem prometer que a casa aprende (a linha não ensina apelido)', async () => {
    answers = { [SUMMARY]: true };
    seed(confirmedNote(), item('a', 'DETERGENTE YPE', 50, { product_id: 'p3', added_after_confirmation: false }));
    await open();
    await fill();
    await press(button('Incluir item'));
    await press(chip('Trocar produto', card('Feijão carioca')));
    expect(productPicker()!.props).toMatchObject({
      title: 'Qual produto é este?',
      message: 'A compra passa para o produto escolhido no histórico de preço e nos gastos, e na despensa, se foi para lá.',
      initialQuery: 'Feijão carioca',
    });
    await run(() => productPicker()!.props.onClose());
    // A linha que veio na nota continua com a frase inteira: o apelido da descrição dela vai junto.
    await press(chip('Trocar produto', card('Detergente')));
    expect(productPicker()!.props.message).toBe(
      'A compra passa para o produto escolhido no histórico de preço e nos gastos, e na despensa, se foi para lá. A casa aprende junto: as próximas notas com esta descrição costumam vir com ele.',
    );
  });

  it('o produto novo pelo nome digitado leva a categoria do nome, e sem a despensa a chave não vai', async () => {
    answers = { [SUMMARY]: true };
    await open();
    await press(button('Item'));
    const create = createAction('Esponja');
    expect(create.title).toBe('Novo produto "Esponja" (Limpeza)');
    await run(() => create.onPress());
    act(() => field('Total do item')!.props.onChangeText('4,50'));
    await press(button('Incluir item'));
    expect(correctionCalls('add_confirmed_receipt_item')[0].args.p_item).toEqual({
      id: expect.any(String),
      raw_description: 'Esponja',
      quantity: 1,
      unit: 'un',
      unit_price: 4.5,
      total_price: 4.5,
      new_product: { name: 'Esponja', category: 'limpeza' },
    });
    expect(asked(SUMMARY)[0][1]).toBe(
      'Esponja: 1 un, R$ 4,50. Depois de incluído, a quantidade e o valor não mudam mais, e o item só sai da nota excluindo a nota inteira.',
    );
  });

  it('zero não entra: o item que faltou é pelo que foi pago, e o formulário fica', async () => {
    await open();
    await fill('p1', '0');
    await press(button('Incluir item'));
    expect(lastNotice()).toEqual([
      'Informe o valor',
      'O item que faltou entra com o que foi pago por ele. Para guardar na despensa algo que veio de graça, use "Adicionar à despensa", em Compras > Despensa.',
    ]);
    expect(mockDb.rpcs).toEqual([]);
    expect(editorOpen()).toBe(true);
  });

  it('"Voltar" na pergunta deixa o formulário como estava, sem gravar', async () => {
    await open();
    await fill();
    await press(button('Incluir item'));
    expect(asked(SUMMARY)).toHaveLength(1);
    expect(mockDb.rpcs).toEqual([]);
    expect(editorOpen()).toBe(true);
    expect(field('Total do item')!.props.value).toBe('15,80');
  });

  it('"Já está na despensa" com "Não colocar": vai sem a despensa, pela abreviação aprendida carregada na hora', async () => {
    mockMarket.products = [{ id: 'p9', name: 'Az gallo 500ml', category: 'oleos', shelf_life_days: null }];
    mockMarket.pantryNear = [{ product_id: null, name: 'Azeite', purchased_on: `${YEAR}-06-09` }];
    const { learnAbbreviations } = jest.requireActual<typeof import('@/domain/learnedAbbreviations')>('@/domain/learnedAbbreviations');
    mockLearning.learned = learnAbbreviations([{ description: 'AZ POR EU PARUS VD', productName: 'Azeite' }]);
    answers = { [SUMMARY]: true };
    await open();
    await fill('p9', '39,90', '1');
    await press(button('Incluir item'));
    expect(mockLearning.loads).toBe(1);
    expect(asked('Já está na despensa')).toHaveLength(1);
    // Sem a despensa (o JSON do pedido não leva a chave sem valor).
    expect((correctionCalls('add_confirmed_receipt_item')[0].args.p_item as Row).pantry).toBeUndefined();
    expect(asked(SUMMARY)[0][1]).toMatch(/^Az gallo 500ml: 1 un, R\$ 39,90\. Depois/);
  });

  it('a conferência da despensa que falha: "Erro", e o formulário fica', async () => {
    jest.mocked(fetchPantryNear).mockRejectedValueOnce({ message: 'caiu a rede' });
    await open();
    await fill();
    await press(button('Incluir item'));
    expect(lastNotice()).toEqual(['Erro', 'caiu a rede']);
    expect(mockDb.rpcs).toEqual([]);
    expect(editorOpen()).toBe(true);
  });

  it('dois toques com a pergunta aberta: uma pergunta, um pedido', async () => {
    let answer!: (yes: boolean) => void;
    jest.mocked(askYesNo).mockImplementation((title) => (title === SUMMARY ? new Promise<boolean>((resolve) => (answer = resolve)) : Promise.resolve(false)));
    await open();
    await fill();
    await press(button('Incluir item'));
    expect(button('Incluir item')!.props.loading).toBe(true);
    await press(button('Incluir item'));
    expect(asked(SUMMARY)).toHaveLength(1);
    await run(() => answer(true));
    expect(correctionCalls('add_confirmed_receipt_item')).toHaveLength(1);
  });

  it('o que falta para o total da nota, embaixo do total; com um item sem valor, o aviso de sempre', async () => {
    await open();
    await press(button('Item'));
    await run(() => productPicker()!.props.onSelect('p1'));
    expect(field('Total do item')!.props.hint).toBe('Faltam R$ 16,70 para o total da nota.');
    await act(async () => renderer!.unmount());
    renderer = undefined;
    seed(confirmedNote(), item('a', 'DETERGENTE YPE', 50), item('z', 'SACOLA', 0));
    await open();
    await press(button('Item'));
    await run(() => productPicker()!.props.onSelect('p1'));
    expect(field('Total do item')!.props.hint).toBe('Com desconto no item, use o valor pago.');
  });

  it('a falha de rede deixa o formulário, e "Incluir item" manda de novo com o mesmo id', async () => {
    answers = { [SUMMARY]: true };
    await open();
    await fill();
    mockDb.fails = [({ table }) => table === 'add_confirmed_receipt_item'];
    await press(button('Incluir item'));
    expect(lastNotice()).toEqual(['Erro', 'caiu a rede']);
    expect(editorOpen()).toBe(true);
    mockDb.fails = [];
    await press(button('Incluir item'));
    const calls = correctionCalls('add_confirmed_receipt_item');
    expect(calls).toHaveLength(2);
    expect((calls[1].args.p_item as Row).id).toBe((calls[0].args.p_item as Row).id);
    expect(editorOpen()).toBe(false);
    expect(mockDb.items.filter((row) => row.raw_description === 'Feijão carioca')).toHaveLength(1);
  });

  it('a resposta que se perdeu e o envio mudado: "Item já incluído", nada gravado de novo, e o formulário fecha', async () => {
    answers = { [SUMMARY]: true };
    await open();
    await fill();
    mockDb.loses = [({ table }) => table === 'add_confirmed_receipt_item'];
    await press(button('Incluir item'));
    expect(lastNotice()).toEqual(['Erro', 'caiu a rede']);
    mockDb.loses = [];
    act(() => field('Total do item')!.props.onChangeText('16,80'));
    await press(button('Incluir item'));
    expect(lastNotice()).toEqual([
      'Item já incluído',
      'O item já tinha entrado na nota com o que foi salvo da primeira vez, e esta mudança não foi gravada. Confira o item na nota.',
    ]);
    expect(editorOpen()).toBe(false);
    expect(mockDb.items.find((row) => row.raw_description === 'Feijão carioca')!.total_price).toBe(15.8);
  });

  it('a resposta que se perdeu e o formulário fechado: "Item" busca a nota antes de abrir o seletor', async () => {
    answers = { [SUMMARY]: true };
    await open();
    await fill();
    mockDb.loses = [({ table }) => table === 'add_confirmed_receipt_item'];
    await press(button('Incluir item'));
    mockDb.loses = [];
    await run(() => renderer!.root.findAllByType(IconButton).find((entry) => entry.props.label === 'Fechar')!.props.onPress());
    await press(button('Item'));
    expect(productPicker()).toBeUndefined();
    expect(lastNotice()).toEqual(['Nota atualizada', 'Confira os itens e toque em "Item" de novo, se ainda faltar um.']);
    expect(said(card('Feijão carioca'))[0]).toBe('Feijão carioca');
  });

  it('a busca de fundo que falhou: "Item" busca a nota antes', async () => {
    await open();
    mockDb.fails = [receiptRead];
    await act(async () => {
      await client.refetchQueries({ queryKey: ['receipt', 'r1'] });
    });
    await settle();
    await press(button('Item'));
    expect(lastNotice()![0]).toBe('Não deu para buscar a nota');
    expect(productPicker()).toBeUndefined();
  });

  it('com outro item gravando, "Item" avisa e não abre o seletor', async () => {
    await open();
    await press(chip('Escolher produto'));
    const release = hold(({ table }) => table === 'change_receipt_item_product');
    await run(() => productPicker()!.props.onSelect('p3'));
    await press(button('Item'));
    expect(lastNotice()).toEqual([OTHER_ITEM_SAVING.title, OTHER_ITEM_SAVING.message]);
    expect(productPicker()).toBeUndefined();
    await release();
    // Com a nota de volta, o toque abre o seletor.
    await press(button('Item'));
    expect(productPicker()).toBeDefined();
  });

  it('com o item que faltou ainda a caminho, "Item" diz que a nota está sendo atualizada e não abre o seletor', async () => {
    answers = { [SUMMARY]: true };
    await open();
    await fill();
    const release = hold(({ table }) => table === 'add_confirmed_receipt_item');
    await press(button('Incluir item'));
    await press(button('Item'));
    expect(lastNotice()).toEqual([RECEIPT_BEING_UPDATED.title, RECEIPT_BEING_UPDATED.message]);
    expect(productPicker()).toBeUndefined();
    await release();
    expect(correctionCalls('add_confirmed_receipt_item')).toHaveLength(1);
  });

  it('a busca de fundo que falhou com o formulário aberto: "Incluir item" não manda nada, e o formulário fica', async () => {
    answers = { [SUMMARY]: true };
    await open();
    await fill();
    mockDb.fails = [receiptRead];
    await act(async () => {
      await client.refetchQueries({ queryKey: ['receipt', 'r1'] });
    });
    await settle();
    await press(button('Incluir item'));
    expect(lastNotice()).toEqual([CORRECTION_STALE.title, CORRECTION_STALE.message]);
    expect(asked(SUMMARY)).toEqual([]);
    expect(mockDb.rpcs).toEqual([]);
    expect(editorOpen()).toBe(true);
    expect(field('Total do item')!.props.value).toBe('15,80');
  });

  it('o envio de novo do mesmo formulário, depois da falha de rede, passa mesmo com a busca de fundo que falhou: o mesmo id', async () => {
    answers = { [SUMMARY]: true };
    await open();
    await fill();
    mockDb.fails = [({ table }) => table === 'add_confirmed_receipt_item'];
    await press(button('Incluir item'));
    expect(lastNotice()).toEqual(['Erro', 'caiu a rede']);
    mockDb.fails = [receiptRead];
    await act(async () => {
      await client.refetchQueries({ queryKey: ['receipt', 'r1'] });
    });
    await settle();
    await press(button('Incluir item'));
    const calls = correctionCalls('add_confirmed_receipt_item');
    expect(calls).toHaveLength(2);
    expect((calls[1].args.p_item as Row).id).toBe((calls[0].args.p_item as Row).id);
    expect(editorOpen()).toBe(false);
    // Gravado, com a nota que não voltou: a pessoa fica sabendo.
    expect(lastNotice()).toEqual([ITEM_SAVED_NOT_SHOWN.title, ITEM_SAVED_NOT_SHOWN.message]);
  });

  it('a resposta que se perdeu e o envio igual: o formulário fecha sem "Item já incluído" e sem outra linha; com a nota que não volta, "Item salvo"', async () => {
    answers = { [SUMMARY]: true };
    await open();
    await fill();
    mockDb.loses = [({ table }) => table === 'add_confirmed_receipt_item'];
    await press(button('Incluir item'));
    expect(lastNotice()).toEqual(['Erro', 'caiu a rede']);
    mockDb.loses = [];
    mockDb.fails = [receiptRead];
    await press(button('Incluir item'));
    expect(correctionCalls('add_confirmed_receipt_item')).toHaveLength(2);
    expect(editorOpen()).toBe(false);
    expect(mockDb.items.filter((row) => row.raw_description === 'Feijão carioca')).toHaveLength(1);
    expect(jest.mocked(notify).mock.calls).toEqual([
      ['Erro', 'caiu a rede'],
      [ITEM_SAVED_NOT_SHOWN.title, ITEM_SAVED_NOT_SHOWN.message],
    ]);
  });

  it('o produto saiu do catálogo entre o desenho e o toque: o aviso, os produtos buscados de novo, e o formulário não abre', async () => {
    await open();
    await press(button('Item'));
    await run(() => productPicker()!.props.onSelect('sumiu'));
    expect(lastNotice()).toEqual(['Item não incluído', PRODUCT_MERGED_AWAY]);
    expect(mockMarket.productsRefetch).toHaveBeenCalledTimes(1);
    expect(editorOpen()).toBe(false);
    expect(mockDb.rpcs).toEqual([]);
  });

  it('sem internet: o toque diz para incluir quando a conexão voltar', async () => {
    await open();
    onlineManager.setOnline(false);
    await press(button('Item'));
    expect(lastNotice()).toEqual(['Sem internet agora', 'Inclua o item quando a conexão voltar.']);
    expect(productPicker()).toBeUndefined();
  });

  it('a recusa (a nota voltou para a revisão em outro aparelho) deixa o formulário com o que foi digitado', async () => {
    answers = { [SUMMARY]: true };
    mockDb.addError = { code: 'NK019', message: 'receipt not confirmed', details: null, hint: null };
    await open();
    await fill();
    await press(button('Incluir item'));
    expect(lastNotice()).toEqual(['Item não incluído', 'Esta nota ainda está em revisão. Confira os itens e confirme a nota.']);
    expect(editorOpen()).toBe(true);
    expect(field('Total do item')!.props.value).toBe('15,80');
  });

  it('no iOS, o formulário abre só depois que o seletor sumiu; fechar o seletor sem escolher não abre nada', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    await open();
    await press(button('Item'));
    await run(() => productPicker()!.props.onClose());
    await run(() => renderer!.root.findAllByType(PickerModal)[1].props.onDismiss());
    expect(editorOpen()).toBe(false);
    await press(button('Item'));
    await run(() => productPicker()!.props.onSelect('p1'));
    expect(productPicker()).toBeUndefined();
    expect(editorOpen()).toBe(false);
    await run(() => renderer!.root.findAllByType(PickerModal)[1].props.onDismiss());
    expect(editorOpen()).toBe(true);
  });

  it('a carne que faltou pergunta "Congelou?" com o congelador no banco, e "Congelei" leva o congelador no pedido', async () => {
    mockFreezer.available = true;
    mockMarket.products = [{ id: 'pc', name: 'Picanha', category: 'carnes', shelf_life_days: null }];
    answers = { [SUMMARY]: true };
    await open();
    await press(button('Item'));
    await run(() => productPicker()!.props.onSelect('pc'));
    act(() => field('Total do item')!.props.onChangeText('60'));
    await press(chip('Congelei'));
    await press(button('Incluir item'));
    expect(correctionCalls('add_confirmed_receipt_item')[0].args.p_item).toMatchObject({
      product_id: 'pc',
      pantry: {
        name: 'Picanha',
        category: 'carnes',
        purchased_on: `${YEAR}-06-10`,
        expiry_source: 'congelado',
        frozen_on: `${YEAR}-06-10`,
        freeze_kind: 'carne',
        fresh_expires_on: `${YEAR}-06-13`,
        fresh_expiry_source: 'categoria',
      },
    });
    expect(asked(SUMMARY)[0][1]).toContain('Picanha: 1 un, R$ 60,00, e vai para o congelador.');
  });

  it('a carne "Congelei" que já está na despensa, com "Não colocar": vai sem a despensa, e a compra do carrinho vai para o congelador depois de incluir', async () => {
    mockFreezer.available = true;
    mockMarket.products = [{ id: 'pc', name: 'Picanha', category: 'carnes', shelf_life_days: null }];
    mockMarket.pantryNear = [{ id: 'cart-picanha', product_id: null, name: 'Picanha', purchased_on: `${YEAR}-06-09` }];
    answers = { [SUMMARY]: true };
    await open();
    await press(button('Item'));
    await run(() => productPicker()!.props.onSelect('pc'));
    act(() => field('Total do item')!.props.onChangeText('60'));
    await press(chip('Congelei'));
    await press(button('Incluir item'));
    expect(asked('Já está na despensa')).toHaveLength(1);
    expect((correctionCalls('add_confirmed_receipt_item')[0].args.p_item as Row).pantry).toBeUndefined();
    expect(mockDb.rpcs.map((call) => call.fn)).toEqual(['add_confirmed_receipt_item', 'freeze_pantry_items']);
    expect(correctionCalls('freeze_pantry_items')[0].args).toEqual({ p_ids: ['cart-picanha'], p_kind: 'carne', p_frozen_on: `${YEAR}-06-10` });
    expect(notify).not.toHaveBeenCalled();
  });

  it('e o item que não entra (a recusa) não congela nada', async () => {
    mockFreezer.available = true;
    mockDb.addError = { code: 'NK019', message: 'receipt not confirmed', details: null, hint: null };
    mockMarket.products = [{ id: 'pc', name: 'Picanha', category: 'carnes', shelf_life_days: null }];
    mockMarket.pantryNear = [{ id: 'cart-picanha', product_id: null, name: 'Picanha', purchased_on: `${YEAR}-06-09` }];
    answers = { [SUMMARY]: true };
    await open();
    await press(button('Item'));
    await run(() => productPicker()!.props.onSelect('pc'));
    act(() => field('Total do item')!.props.onChangeText('60'));
    await press(chip('Congelei'));
    await press(button('Incluir item'));
    expect(mockDb.rpcs.map((call) => call.fn)).toEqual(['add_confirmed_receipt_item']);
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
    await run(() => field('Data da compra')!.props.onBlur());
  }
  const noonOf = (iso: string) => new Date(`${iso}T12:00:00`).toISOString();
  /** A busca da nota falha com ela na tela: a nota fica, com o aviso de cima. */
  async function rereadFails() {
    mockDb.fails = [receiptRead];
    await act(async () => {
      await client.refetchQueries({ queryKey: ['receipt', 'r1'] });
    });
    await settle();
    expect(page()).toContain('Não foi possível atualizar. Mostrando o que já estava carregado.');
  }

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
    await run(() => field('Data da compra')!.props.onSubmitEditing());
    await run(() => field('Data da compra')!.props.onBlur());
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

  it('a data igual à mostrada com a busca que falhou: o aviso sai, e nada é gravado', async () => {
    await open();
    await rereadFails();
    await typeDate(`10/06/${YEAR}`);
    expect(jest.mocked(notify).mock.calls).toEqual([
      ['Não deu para buscar a nota', 'Os itens na tela podem estar diferentes do que foi salvo. Toque em "Tentar de novo" e confira antes de confirmar.'],
    ]);
    expect(field('Data da compra')!.props.value).toBe(`10/06/${YEAR}`);
    expect(mockDb.writes).toEqual([]);
  });

  it('enviar e depois sair do campo com a busca que falhou: o aviso sai uma vez só, e o campo fica com a data digitada', async () => {
    await open();
    await rereadFails();
    act(() => field('Data da compra')!.props.onChangeText(`11/06/${YEAR}`));
    // No celular, enviar tira o foco: a saída do campo chega logo depois do envio, com a mesma data.
    await run(() => field('Data da compra')!.props.onSubmitEditing());
    await run(() => field('Data da compra')!.props.onBlur());
    expect(jest.mocked(notify).mock.calls).toEqual([
      ['Não deu para buscar a nota', 'Os itens na tela podem estar diferentes do que foi salvo. Toque em "Tentar de novo" e confira antes de confirmar.'],
    ]);
    expect(field('Data da compra')!.props.value).toBe(`11/06/${YEAR}`);
    expect(mockDb.writes).toEqual([]);
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
    await run(() => storePicker().props.onSelect('s2'));
    expect(storePicker().props.visible).toBe(false);
    expect(mockDb.writes).toEqual([{ table: 'receipts', verb: 'update', values: { store_id: 's2' }, filters: { id: 'r1', status: 'confirmed' } }]);
    expect(header().slice(0, 2)).toEqual(['Mercado', 'Atacadão']);
    // Um mercado que a casa já tinha: a lista dos mercados não muda.
    expect(refreshed()).toEqual(ALL_REFRESHED);
  });

  it('o mercado: criar um pelo nome digitado, como no rascunho', async () => {
    await open();
    const create = storePicker().props.extraActions('Feira do bairro');
    await run(() => create.props.onPress());
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
    await run(() => storePicker().props.extraActions('Feira do bairro').props.onPress());
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
    await run(() => storePicker().props.extraActions('Feira do bairro').props.onPress());
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
    await run(() => storePicker().props.onSelect('s2'));
    expect(header().slice(0, 2)).toEqual(['Mercado', 'Atacadão']);
    await releaseDate();
    expect(jest.mocked(notify).mock.calls).toEqual([['Erro', 'caiu a rede']]);
    expect(field('Data da compra')!.props.value).toBe(`10/06/${YEAR}`);
    expect(mockDb.receipts[0].store_id).toBe('s2');
  });

  it('o mesmo mercado não grava nada', async () => {
    await open();
    await run(() => storePicker().props.onSelect('s1'));
    expect(mockDb.writes).toEqual([]);
  });

  it('o mesmo mercado com a busca que falhou: o aviso sai, e nada é gravado', async () => {
    await open();
    await rereadFails();
    await run(() => storePicker().props.onSelect('s1'));
    expect(jest.mocked(notify).mock.calls).toEqual([
      ['Não deu para buscar a nota', 'Os itens na tela podem estar diferentes do que foi salvo. Toque em "Tentar de novo" e confira antes de confirmar.'],
    ]);
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

  it('o total igual ao da nota, com a busca que falhou e outro total no banco: o campo fica com o que foi digitado, o aviso sai, e nada é gravado', async () => {
    seed(confirmedNote({ total: 50 }), item('a', 'DETERGENTE YPE', 50));
    await open();
    await rereadFails();
    // Outro aparelho mudou o total no banco; a tela ainda mostra 50, e a pessoa digita 50.
    mockDb.receipts[0].total = 40;
    await press(totalRow());
    act(() => field('Total da nota')!.props.onChangeText('50'));
    await press(button('Salvar total'));
    expect(jest.mocked(notify).mock.calls).toEqual([
      ['Não deu para buscar a nota', 'Os itens na tela podem estar diferentes do que foi salvo. Toque em "Tentar de novo" e confira antes de confirmar.'],
    ]);
    expect(field('Total da nota')!.props.value).toBe('50');
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

  it('nota excluída em outro aparelho: a correção avisa que não salvou, e a tela é a da nota que sumiu', async () => {
    await open();
    await press(totalRow());
    act(() => field('Total da nota')!.props.onChangeText('72,90'));
    mockDb.receipts = [];
    await press(button('Salvar total'));
    expect(jest.mocked(notify).mock.calls).toEqual([['Correção não salva', 'Esta nota não existe mais.']]);
    // A nota relida não vem: a tela é a da nota que sumiu, sem "Tentar de novo" (buscar de novo não a traz de volta).
    expect(page()).toContain('Esta nota não existe mais.');
    expect(page()).not.toContain('DETERGENTE YPE');
    expect(page()).not.toContain('Tentar de novo');
  });

  it('a revisão continua como antes: a data vai sem o filtro da nota confirmada, e não há a frase', async () => {
    seed(receipt(), item('a', 'DETERGENTE YPE', 50));
    await open();
    expect(page()).not.toContain(CORRECTION_NOTE);
    await typeDate(`11/06/${YEAR}`);
    expect(mockDb.writes).toEqual([{ table: 'receipts', verb: 'update', values: { purchased_at: noonOf(`${YEAR}-06-11`) }, filters: { id: 'r1' } }]);
    await run(() => storePicker().props.onSelect('s2'));
    expect(mockDb.writes[1]).toEqual({ table: 'receipts', verb: 'update', values: { store_id: 's2' }, filters: { id: 'r1' } });
    expect(button('Confirmar nota')).toBeDefined();
  });
});

describe('a nota que sumiu em outro aparelho: a tela é a da nota que sumiu, sem "Tentar de novo"', () => {
  beforeEach(() => seed(receipt(), item('a', 'DETERGENTE YPE', 50), item('b', 'ARROZ 5KG', 12.9)));

  it('"Confirmar nota" antes de a busca de fundo ver que ela sumiu: o aviso diz que a nota não existe mais, e a tela vira a da nota que sumiu', async () => {
    await open();
    mockDb.receipts = [];
    await press(button('Confirmar nota'));
    expect(jest.mocked(notify).mock.calls).toEqual([['Nota não confirmada', 'Esta nota não existe mais.']]);
    expect(mockDb.rpcs.map((rpc) => rpc.fn)).toEqual(['confirm_receipt']);
    expect(page()).toContain('Esta nota não existe mais.');
    expect(page()).not.toContain('DETERGENTE YPE');
    expect(page()).not.toContain('Tentar de novo');
    expect(button('Confirmar nota')).toBeUndefined();
  });

  it('"Confirmar nota" com uma linha que a nota já não tem (P0002 de item, a nota existe): o aviso é o do banco, e a nota não diz que sumiu', async () => {
    await open();
    mockDb.confirmError = { code: 'P0002', message: 'item a does not belong to receipt', details: null, hint: null };
    await press(button('Confirmar nota'));
    expect(jest.mocked(notify).mock.calls).toEqual([['Erro', 'item a does not belong to receipt']]);
    expect(page()).not.toContain('Esta nota não existe mais.');
    expect(page()).toContain('DETERGENTE YPE');
  });

  it('a nota que já não existe ao abrir: a tela é a da nota que sumiu, sem "Tentar de novo"', async () => {
    mockDb.receipts = [];
    await open();
    expect(page()).toContain('Esta nota não existe mais.');
    expect(page()).not.toContain('Tentar de novo');
  });

  it('a busca de fundo que falhou e a nota apagada em outro aparelho: "Confirmar nota" não manda "Tentar de novo", e a tela é a da nota que sumiu', async () => {
    await open();
    mockDb.fails = [receiptRead];
    await act(async () => {
      await client.refetchQueries({ queryKey: ['receipt', 'r1'] });
    });
    await settle();
    expect(page()).toContain('Não foi possível atualizar. Mostrando o que já estava carregado.');
    // A nota foi apagada em outro aparelho, e agora a busca chega sem ela.
    mockDb.receipts = [];
    mockDb.fails = [];
    await press(button('Confirmar nota'));
    expect(jest.mocked(notify).mock.calls).toEqual([]);
    expect(mockDb.rpcs).toEqual([]);
    expect(page()).toContain('Esta nota não existe mais.');
    expect(page()).not.toContain('Tentar de novo');
    expect(button('Confirmar nota')).toBeUndefined();
  });

  it('sem nota na tela e a busca que falha por outro motivo: a tela do erro de sempre, com "Tentar de novo"', async () => {
    mockDb.fails = [receiptRead];
    await open();
    expect(page()).toContain('caiu a rede');
    expect(page()).toContain('Tentar de novo');
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

  describe('aberta pelo "Finalizar compra" da lista', () => {
    beforeEach(() => stopWaitingForReceipt('lista1'));

    it('confirmar entrega à lista o que a nota fez e volta para ela; o aviso fica para a lista dizer', async () => {
      mockMarket.listItems = [listItem('l1', 'Café em pó', 'cafe_cha', true), listItem('l3', 'Leite desnatado', 'laticinios', true)];
      await open();
      // A lista abriu o leitor (o QR code, a foto ou a pendente da Sefaz, que trocam de tela até chegar aqui).
      waitForReceipt('lista1');
      await press(button('Confirmar nota'));
      expect(mockDb.rpcs.map(({ fn }) => fn)).toEqual(['confirm_receipt']);
      expect(notify).not.toHaveBeenCalled();
      expect(router.back).toHaveBeenCalledTimes(1);
      // As três compras foram para a despensa. O café do carrinho saiu da lista; o leite (a nota não diz se é
      // desnatado) fica no carrinho, para a pessoa ver.
      const handed = takeConfirmedReceipt('lista1');
      expect(handed).toMatchObject({ onlineAtTap: true, pantryCount: 3, removedListItems: ['l1'] });
      expect(handed!.confirmedAt).toBeGreaterThanOrEqual(handed!.tappedAt);
    });

    it('sem lista esperando, o "Nota salva" de sempre, daqui', async () => {
      mockMarket.listItems = [listItem('l1', 'Café em pó', 'cafe_cha', true)];
      await open();
      await press(button('Confirmar nota'));
      expect(notify).toHaveBeenCalledWith('Nota salva', '3 itens foram para a despensa. 1 item saiu da lista.');
      expect(router.back).toHaveBeenCalledTimes(1);
      expect(takeConfirmedReceipt('lista1')).toBeNull();
    });

    it('sem tela para voltar (no navegador, a página recarregada), vai para as notas da casa', async () => {
      jest.mocked(router.canGoBack).mockReturnValue(false);
      await open();
      await press(button('Confirmar nota'));
      expect(router.back).not.toHaveBeenCalled();
      expect(router.replace).toHaveBeenCalledWith({ pathname: '/compras', params: { aba: 'notas' } });
    });
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

  it('enquanto o peso grava, a pergunta sai até a nota voltar; um toque repetido no mesmo item não avisa, e a linha por kg aparece depois', async () => {
    seed(receipt({ total: 22.99 }), item('i1', 'QUEIJO parmesão', 22.99, { suggested_category: 'laticinios' }));
    await open();
    await press(chip('Informar o peso'));
    act(() => weightField()!.props.onChangeText('0,186'));
    const release = hold(itemWrite);
    // Dois toques em "Salvar peso" no mesmo instante: a gravação é uma só, e nenhum aviso (é o mesmo valor).
    await pressBoth(chip('Salvar peso'), chip('Salvar peso'));
    expect(page()).not.toContain('Veio pesado no balcão?');
    expect(chip('Informar o peso')).toBeUndefined();
    expect(weightField()).toBeUndefined();
    expect(writes('receipt_items')).toHaveLength(1);
    await release();
    await settle();
    expect(writes('receipt_items')).toHaveLength(1);
    expect(jest.mocked(notify).mock.calls).toEqual([]);
    expect(page()).toContain('0,186 kg × R$ 123,60');
    expect(page()).not.toContain('Veio pesado no balcão?');
  });

  it('enquanto o peso de um item grava, o peso de outro não entra: a tela avisa, e o campo fica com o que foi digitado', async () => {
    seed(receipt({ total: 30.98 }), item('i1', 'QUEIJO parmesão', 22.99, { suggested_category: 'laticinios' }), item('i2', 'PRESUNTO COZIDO', 7.99, { suggested_category: 'frios' }));
    await open();
    await press(chip('Informar o peso', card('QUEIJO parmesão')));
    act(() => weightField()!.props.onChangeText('0,186'));
    const release = hold(itemWrite);
    await press(chip('Salvar peso', card('QUEIJO parmesão')));
    await press(chip('Informar o peso', card('PRESUNTO COZIDO')));
    act(() => weightField()!.props.onChangeText('0,2'));
    await press(chip('Salvar peso', card('PRESUNTO COZIDO')));
    expect(jest.mocked(notify).mock.calls).toEqual([['Aguarde', 'Outro item ainda está sendo salvo. Toque de novo quando a nota voltar.']]);
    expect(weightField()!.props.value).toBe('0,2');
    expect(writes('receipt_items')).toHaveLength(1);
    await release();
    await settle();
    // A nota voltou: o peso do presunto grava com o toque de novo.
    await press(chip('Salvar peso', card('PRESUNTO COZIDO')));
    expect(writes('receipt_items')).toHaveLength(2);
    expect(writes('receipt_items')[1]).toMatchObject({ filters: { id: 'i2' }, values: { quantity: 0.2, unit: 'kg' } });
  });

  it('com a nota ainda voltando (a busca de "Confirmar nota" segurada, nenhum item gravando), o peso de outro item é recusado com o aviso da nota, e o campo fica com o que foi digitado', async () => {
    seed(receipt({ total: 30.98 }), item('i1', 'QUEIJO parmesão', 22.99, { suggested_category: 'laticinios' }), item('i2', 'PRESUNTO COZIDO', 7.99, { suggested_category: 'frios' }));
    await open();
    await press(chip('Informar o peso', card('QUEIJO parmesão')));
    act(() => weightField()!.props.onChangeText('0,186'));
    // O queijo grava, e a nota que volta não chega: a tela fica atrás do que foi gravado.
    mockDb.fails = [receiptRead];
    await press(chip('Salvar peso', card('QUEIJO parmesão')));
    mockDb.fails = [];
    // "Confirmar nota" busca a nota de novo, e essa busca fica segurada: nenhum item está gravando agora.
    const release = hold(receiptRead);
    await press(button('Confirmar nota'));
    await press(chip('Informar o peso', card('PRESUNTO COZIDO')));
    act(() => weightField()!.props.onChangeText('0,2'));
    await press(chip('Salvar peso', card('PRESUNTO COZIDO')));
    // O aviso é o da nota, que ainda está voltando: "Outro item ainda está sendo salvo" seria falso aqui.
    expect(jest.mocked(notify).mock.calls.at(-1)).toEqual(['Aguarde', 'A nota ainda está sendo atualizada. Toque de novo quando ela voltar.']);
    expect(weightField()!.props.value).toBe('0,2');
    expect(writes('receipt_items')).toHaveLength(1);
    await release();
    await settle();
    expect(jest.mocked(notify).mock.calls.at(-1)).toEqual(['Nota atualizada', 'Confira os itens e toque em "Confirmar nota" de novo.']);
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
      ['Peso não salvo', 'Este item já mudou antes deste toque. Confira a nota e, se ainda precisar, informe o peso outra vez.'],
    ]);
    // A nota foi buscada de novo: o queijo mostra o valor de agora e volta a perguntar o peso.
    expect(said(card('QUEIJO parmesão'))).toContain('R$ 25,50');
    expect(chip('Informar o peso', card('QUEIJO parmesão'))).toBeDefined();
  });

  it('a gravação do peso que chega ao banco e perde a resposta: a tela não sabe e pergunta de novo, e a segunda tentativa não grava por cima, avisa que o item já mudou', async () => {
    seed(receipt({ total: 22.99 }), item('i1', 'QUEIJO parmesão', 22.99, { suggested_category: 'laticinios' }));
    await open();
    await press(chip('Informar o peso'));
    act(() => weightField()!.props.onChangeText('0,186'));
    // A gravação chega ao banco; a resposta é que se perde (a rede cai antes de ela voltar).
    mockDb.fails = [itemWrite];
    const release = hold(itemWrite);
    await press(chip('Salvar peso'));
    Object.assign(mockDb.items[0], { quantity: 0.186, unit: 'kg', unit_price: 123.6022 });
    await release();
    expect(jest.mocked(notify).mock.calls).toEqual([['Erro', 'caiu a rede']]);
    expect(page()).toContain('Veio pesado no balcão?');
    // A pessoa informa o peso de novo: o pedido não acha a linha por unidade, nada é gravado por cima.
    mockDb.fails = [];
    await press(chip('Informar o peso'));
    act(() => weightField()!.props.onChangeText('0,186'));
    await press(chip('Salvar peso'));
    expect(writes('receipt_items')).toHaveLength(2);
    expect(mockDb.items[0]).toMatchObject({ quantity: 0.186, unit: 'kg', unit_price: 123.6022 });
    expect(jest.mocked(notify).mock.calls[1]).toEqual([
      'Peso não salvo',
      'Este item já mudou antes deste toque. Confira a nota e, se ainda precisar, informe o peso outra vez.',
    ]);
    // A nota volta com a linha por kg, e a pergunta sai.
    expect(page()).toContain('0,186 kg × R$ 123,60');
    expect(page()).not.toContain('Veio pesado no balcão?');
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

describe('o alerta de preço usa a contagem que a tela mostra', () => {
  // Dez dias antes da nota, em outro mercado (dentro da janela de 60 dias que só olha outro mercado).
  const TEN_DAYS_AGO = `${YEAR}-05-31T15:00:00.000Z`;
  beforeEach(() => {
    mockMarket.stores = [
      { id: 's1', name: 'Assaí', cnpj: null, address: null },
      { id: 's2', name: 'Atacadão', cnpj: null, address: null },
    ];
  });

  it('o produto "Ovos (30 un)" diz que vêm 30: o aviso de mais barato, que comparava a cartela com o preço sem tamanho, não sai', async () => {
    mockMarket.products = [{ id: 'ovos30', name: 'Ovos (30 un)', category: 'ovos', shelf_life_days: null }];
    seed(receipt({ total: 36.9 }), item('o', 'OVOS RANCHO CAIPIRA', 36.9, { product_id: 'ovos30', suggested_category: 'ovos', pack_count: null }));
    mockPriceHistory.points = [
      { product_id: 'ovos30', store_id: 's2', unit: 'un', unit_price: 13.99, purchased_at: TEN_DAYS_AGO, receipt_id: 'r0', description: 'OVOS' },
    ];
    await open();
    expect(page()).toContain('30 ovos na embalagem: R$ 1,23 o ovo');
    expect(page()).not.toContain('Um item saiu mais caro');
    expect(page()).not.toContain('dava para economizar');
  });

  it('com a contagem na linha (10) e a do histórico (30 no ponto), o aviso de mais barato sai com a economia que a conta dá', async () => {
    mockMarket.products = [{ id: 'ovos', name: 'Ovos', category: 'ovos', shelf_life_days: null }];
    seed(receipt({ total: 13.99 }), item('o', 'OVOS', 13.99, { product_id: 'ovos', suggested_category: 'ovos', pack_count: 10 }));
    mockPriceHistory.points = [
      { product_id: 'ovos', store_id: 's2', unit: 'un', unit_price: 36.9, purchased_at: TEN_DAYS_AGO, receipt_id: 'r0', description: 'OVOS', packCount: 30 },
    ];
    await open();
    expect(page()).toContain('10 ovos na embalagem: R$ 1,40 o ovo');
    expect(page()).toContain('Um item saiu mais caro');
    expect(page()).toContain('R$ 1,23 cada no Atacadão em 31 mai');
    expect(page()).toContain('dava para economizar cerca de R$ 1,70');
  });
});

describe('quantos ovos vêm na embalagem', () => {
  const eggs = (patch: Row = {}) => item('i1', 'OVOS RANCHO CAIPIRA', 13.99, { suggested_category: 'ovos', pack_count: null, ...patch });
  /** A resposta que não achou a linha: sem culpar outro aparelho, porque pode ter sido a troca desta tela. */
  const PACK_CHANGED = ['Quantidade não salva', 'Este item já mudou antes deste toque. Confira a nota e, se ainda precisar, responda de novo.'];

  it('pergunta na revisão; com a resposta, a linha diz quanto sai cada ovo e deixa mudar', async () => {
    seed(receipt({ total: 13.99 }), eggs());
    await open();
    expect(page()).toContain('Quantos ovos vêm na embalagem? Com isso, o preço mostra quanto sai cada ovo.');
    await press(chip('10'));
    expect(writes('receipt_items')).toEqual([{ table: 'receipt_items', verb: 'update', values: { pack_count: 10 }, filters: { id: 'i1', receipt_id: 'r1', product_id: null } }]);
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

  it('a busca que falha e a linha do ovo já saiu em outro aparelho: o chip não grava nada (a linha não se acha), avisa, e a pergunta fica', async () => {
    seed(receipt({ total: 13.99 }), eggs());
    await open();
    mockDb.fails = [receiptRead];
    await act(async () => {
      await client.refetchQueries({ queryKey: ['receipt', 'r1'] });
    });
    await settle();
    // O outro aparelho apaga a linha: a tela ainda a mostra, com os chips.
    mockDb.items = [];
    await press(chip('10'));
    expect(writes('receipt_items')).toEqual([]);
    expect(jest.mocked(notify).mock.calls).toEqual([
      ['Não deu para buscar a nota', 'Os itens na tela podem estar diferentes do que foi salvo. Toque em "Tentar de novo" e confira antes de confirmar.'],
    ]);
    expect(chip('10')).toBeDefined();
  });

  it('a linha do ovo que outro aparelho apagou (a busca de fundo ainda não viu): a resposta não grava, e avisa que a linha mudou', async () => {
    seed(receipt({ total: 13.99 }), eggs());
    await open();
    mockDb.items = [];
    await press(chip('10'));
    expect(writes('receipt_items')).toEqual([{ table: 'receipt_items', verb: 'update', values: { pack_count: 10 }, filters: { id: 'i1', receipt_id: 'r1', product_id: null } }]);
    expect(jest.mocked(notify).mock.calls).toEqual([
      PACK_CHANGED,
    ]);
  });

  it('a linha que saiu, com a busca de volta que falha: o aviso é só o de que a linha mudou, e a nota fica na tela com o aviso de cima', async () => {
    seed(receipt({ total: 13.99 }), eggs());
    await open();
    mockDb.items = [];
    mockDb.fails = [receiptRead];
    await press(chip('10'));
    await settle();
    expect(jest.mocked(notify).mock.calls).toEqual([
      PACK_CHANGED,
    ]);
    expect(page()).toContain('Não foi possível atualizar. Mostrando o que já estava carregado.');
  });

  it('a linha do ovo que outro aparelho passou para outro produto ("Trocar produto"): a resposta não leva a contagem para ele, e avisa que a linha mudou', async () => {
    mockMarket.products = [
      { id: 'po', name: 'Ovos', category: 'ovos', shelf_life_days: null },
      { id: 'pm', name: 'Ovomaltine', category: 'bebidas', shelf_life_days: null },
    ];
    seed(receipt({ status: 'confirmed', total: 13.99 }), eggs({ raw_description: 'OVOS BRANCOS', product_id: 'po' }));
    await open();
    expect(page()).toContain('Quantos ovos vêm na embalagem?');
    // No outro aparelho, a linha passou para a Ovomaltine, e o banco tirou dela a contagem dos ovos.
    Object.assign(mockDb.items[0], { product_id: 'pm', pack_count: null });
    await press(chip('12'));
    expect(writes('receipt_items')).toEqual([
      { table: 'receipt_items', verb: 'update', values: { pack_count: 12 }, filters: { id: 'i1', receipt_id: 'r1', product_id: 'po' } },
    ]);
    expect(mockDb.items[0].pack_count).toBeNull();
    expect(jest.mocked(notify).mock.calls).toEqual([
      PACK_CHANGED,
    ]);
    // A nota relida mostra a linha na Ovomaltine, que não pergunta.
    expect(said(card('Ovomaltine'))[0]).toBe('Ovomaltine');
    expect(page()).not.toContain('Quantos ovos vêm na embalagem?');
  });

  it('a linha do ovo trocada aqui, com a nota relida que demora: a pergunta volta no produto de antes, e a resposta não grava nem culpa outro aparelho', async () => {
    mockDb.corrections = true;
    mockMarket.products = [
      { id: 'po', name: 'Ovos', category: 'ovos', shelf_life_days: null },
      { id: 'pl', name: 'Leite', category: 'laticinios', shelf_life_days: null },
    ];
    seed(receipt({ status: 'confirmed', source: 'qrcode', total: 13.99 }), eggs({ raw_description: 'OVOS BRANCOS', product_id: 'po' }));
    await open();
    await press(chip('Trocar produto'));
    const releaseRead = hold(receiptRead);
    await run(() => productPicker()!.props.onSelect('pl'));
    await settle(4200);
    // A troca gravou; a tela, sem a nota de volta, ainda mostra os ovos e a pergunta deles.
    expect(mockDb.items[0].product_id).toBe('pl');
    expect(said(card('Ovos'))[0]).toBe('Ovos');
    expect(chip('12')).toBeDefined();
    await press(chip('12'));
    expect(writes('receipt_items')).toEqual([
      { table: 'receipt_items', verb: 'update', values: { pack_count: 12 }, filters: { id: 'i1', receipt_id: 'r1', product_id: 'po' } },
    ]);
    expect(mockDb.items[0].pack_count).toBeNull();
    expect(jest.mocked(notify).mock.calls).toEqual([PACK_CHANGED]);
    await releaseRead();
    expect(said(card('Leite'))[0]).toBe('Leite');
    expect(page()).not.toContain('Quantos ovos vêm na embalagem?');
  }, 15_000);

  it('a linha do ovo trocada aqui com a resposta perdida: a resposta seguinte não grava, e o aviso não fala de outro aparelho', async () => {
    mockDb.corrections = true;
    mockMarket.products = [
      { id: 'po', name: 'Ovos', category: 'ovos', shelf_life_days: null },
      { id: 'pl', name: 'Leite', category: 'laticinios', shelf_life_days: null },
    ];
    seed(receipt({ status: 'confirmed', source: 'qrcode', total: 13.99 }), eggs({ raw_description: 'OVOS BRANCOS', product_id: 'po' }));
    await open();
    await press(chip('Trocar produto'));
    mockDb.loses = [({ table }) => table === 'change_receipt_item_product'];
    await run(() => productPicker()!.props.onSelect('pl'));
    expect(mockDb.items[0].product_id).toBe('pl');
    expect(jest.mocked(notify).mock.calls).toEqual([['Erro', 'caiu a rede']]);
    mockDb.loses = [];
    jest.mocked(notify).mockClear();
    expect(said(card('Ovos'))[0]).toBe('Ovos');
    await press(chip('12'));
    expect(mockDb.items[0].pack_count).toBeNull();
    expect(jest.mocked(notify).mock.calls).toEqual([PACK_CHANGED]);
    expect(said(card('Leite'))[0]).toBe('Leite');
  });

  it('a linha do ovo trocada aqui para um produto novo que a busca dos produtos ainda não trouxe: a pergunta não volta no meio', async () => {
    mockDb.corrections = true;
    mockMarket.products = [{ id: 'po', name: 'Ovos', category: 'ovos', shelf_life_days: null }];
    seed(receipt({ status: 'confirmed', source: 'qrcode', total: 13.99 }), eggs({ raw_description: 'OVOS BRANCOS', product_id: 'po' }));
    await open();
    expect(page()).toContain('Quantos ovos vêm na embalagem?');
    mockMarket.late = [];
    await press(chip('Trocar produto'));
    const create = createAction('Leite');
    expect(create.title).toBe('Novo produto "Leite" (Laticínios)');
    await run(() => create.onPress());
    // A nota voltou com a linha no produto novo, e o catálogo ainda não o tem: a descrição diria "ovo", e a linha não é.
    expect(mockDb.items[0].product_id).toBe('criado-1');
    expect(said(card('OVOS BRANCOS'))[0]).toBe('OVOS BRANCOS');
    expect(page()).not.toContain('Quantos ovos vêm na embalagem?');
    expect(chip('12')).toBeUndefined();
    // Os produtos chegam: o leite não é ovo, e a pergunta continua fora.
    mockMarket.products = [...mockMarket.products, ...mockMarket.late];
    mockMarket.late = null;
    await act(async () => {
      await client.refetchQueries({ queryKey: ['receipt', 'r1'] });
    });
    await settle();
    expect(said(card('Leite'))[0]).toBe('Leite');
    expect(page()).not.toContain('Quantos ovos vêm na embalagem?');
    expect(writes('receipt_items')).toEqual([]);
  });

  it('a linha que ganhou um produto novo de ovos: a pergunta volta quando os produtos chegam', async () => {
    mockDb.corrections = true;
    mockMarket.products = [{ id: 'po', name: 'Ovos', category: 'ovos', shelf_life_days: null }];
    seed(receipt({ status: 'confirmed', source: 'qrcode', total: 13.99 }), eggs({ raw_description: 'OVOS BRANCOS', product_id: 'po' }));
    await open();
    mockMarket.late = [];
    await press(chip('Trocar produto'));
    await run(() => createAction('Ovos caipira').onPress());
    expect(page()).not.toContain('Quantos ovos vêm na embalagem?');
    mockMarket.products = [...mockMarket.products, ...mockMarket.late];
    mockMarket.late = null;
    await act(async () => {
      await client.refetchQueries({ queryKey: ['receipt', 'r1'] });
    });
    await settle();
    expect(said(card('Ovos caipira'))[0]).toBe('Ovos caipira');
    expect(page()).toContain('Quantos ovos vêm na embalagem?');
  });

  it('enquanto a quantidade do ovo grava, os chips somem até a nota voltar; outro toque no mesmo ovo não grava de novo', async () => {
    seed(receipt({ total: 13.99 }), eggs());
    await open();
    const release = hold(itemWrite);
    await pressBoth(chip('10'), chip('12'));
    expect(chip('10')).toBeUndefined();
    expect(chip('12')).toBeUndefined();
    expect(writes('receipt_items')).toEqual([{ table: 'receipt_items', verb: 'update', values: { pack_count: 10 }, filters: { id: 'i1', receipt_id: 'r1', product_id: null } }]);
    expect(jest.mocked(notify).mock.calls).toEqual([]);
    await release();
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

describe('no computador (ui/desktop): a revisão em duas colunas', () => {
  const WINDOW = Dimensions.get('window');
  /** O navegador, numa janela de computador (ou estreita). */
  async function browser(width: number) {
    jest.replaceProperty(Platform, 'OS', 'web');
    await act(async () => Dimensions.set({ window: { ...WINDOW, width, height: 900 } }));
  }
  afterEach(async () => {
    await act(async () => Dimensions.set({ window: WINDOW }));
  });
  const flat = (node: ReactTestInstance) => (StyleSheet.flatten(node.props.style) ?? {}) as Record<string, unknown>;
  const boxes = () => renderer!.root.findAll((node) => (node.type as unknown) === 'View');
  /** A coluna do lado e a principal (no computador); fora dele, nenhuma das duas desenha caixa. */
  const side = () => boxes().find((node) => flat(node).width === DESKTOP_PANEL_SIDE_WIDTH);
  const main = () => boxes().find((node) => flat(node).flex === 1 && flat(node).minWidth === 0);
  const footer = () => renderer!.root.findByType(Screen).props.footer;
  /** Os botões que estão no rodapé, na ordem. */
  const footerButtons = () => {
    const bar = footer();
    if (!bar) return [];
    return bar.type === Button ? [bar.props.title] : renderer!.root.findByType(Actions).findAllByType(Button).map((entry) => entry.props.title);
  };
  /** Tudo o que a tela escreve, no celular (para comparar com a ordem do computador). */
  async function phoneLines() {
    await open();
    const all = lines();
    await act(async () => renderer!.unmount());
    renderer = undefined;
    return all;
  }

  beforeEach(() => seed(receipt(), item('a', 'DETERGENTE YPE', 50), item('b', 'ARROZ 5KG', 12.9)));

  it('no celular, como sempre: "Confirmar nota" no rodapé, e "Descartar nota" depois dos itens', async () => {
    await open();
    expect(side()).toBeUndefined();
    expect(footer().props.title).toBe('Confirmar nota (2 itens)');
    expect(renderer!.root.findByType(Screen).props.wide).toBe(true);
    const all = lines();
    expect(all.indexOf('Mercado')).toBeLessThan(all.indexOf('Itens (2)'));
    expect(all.indexOf('Itens (2)')).toBeLessThan(all.indexOf('ARROZ 5KG'));
    expect(all.indexOf('ARROZ 5KG')).toBeLessThan(all.indexOf('Descartar nota'));
    expect(all.indexOf('Descartar nota')).toBeLessThan(all.indexOf('Confirmar nota (2 itens)'));
  });

  it('na janela estreita do navegador, também: as colunas não desenham caixa nenhuma', async () => {
    await browser(800);
    await open();
    expect(side()).toBeUndefined();
    expect(main()).toBeUndefined();
    expect(footer().props.title).toBe('Confirmar nota (2 itens)');
  });

  it('no computador, os itens na principal; o cabeçalho, o total e a lista na do lado; as ações no rodapé, sempre à vista', async () => {
    await browser(1440);
    await open();
    const aside = said(side()!);
    expect(aside).toEqual(expect.arrayContaining(['Mercado', 'Assaí', 'Soma dos itens', 'Total da nota']));
    expect(aside).not.toContain('DETERGENTE YPE');
    // As ações não ficam numa coluna que rola: ficam no rodapé fixo, encostadas à direita, a de confirmar por último.
    expect(aside).not.toContain('Confirmar nota (2 itens)');
    expect(aside).not.toContain('Descartar nota');
    expect(footerButtons()).toEqual(['Descartar nota', 'Confirmar nota (2 itens)']);
    expect(renderer!.root.findByType(Actions).props.end).toBe(true);
    // As duas colunas rolam com a tela: nenhuma fica parada nem rola por dentro.
    for (const box of boxes()) expect(flat(box).position).not.toBe('sticky');
    for (const box of boxes()) expect(flat(box).overflowY).toBeUndefined();
    const items = said(main()!);
    expect(items).toEqual(expect.arrayContaining(['Itens (2)', 'DETERGENTE YPE', 'ARROZ 5KG']));
    expect(items).not.toContain('Descartar nota');
    // Um botão de cada.
    expect(renderer!.root.findAllByType(Button).filter((entry) => String(entry.props.title).startsWith('Confirmar nota'))).toHaveLength(1);
    expect(renderer!.root.findAllByType(Button).filter((entry) => entry.props.title === 'Descartar nota')).toHaveLength(1);
  });

  it('no computador, a ordem do teclado e do leitor de tela é exatamente a do celular: os itens antes de descartar e de confirmar', async () => {
    const phone = await phoneLines();
    await browser(1440);
    await open();
    expect(side()).toBeDefined();
    expect(lines()).toEqual(phone);
    const all = lines();
    expect(all.indexOf('ARROZ 5KG')).toBeLessThan(all.indexOf('Descartar nota'));
    expect(all.indexOf('Descartar nota')).toBeLessThan(all.indexOf('Confirmar nota (2 itens)'));
  });

  it('no computador, "Confirmar nota" no rodapé confirma como o do celular', async () => {
    await browser(1440);
    await open();
    await press(button('Confirmar nota'));
    expect(mockDb.rpcs.map((rpc) => rpc.fn)).toEqual(['confirm_receipt']);
    expect((mockDb.rpcs[0].args.p_items as Row[]).map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('a nota confirmada, no computador: sem "Confirmar nota", e "Excluir nota" no rodapé, depois dos itens', async () => {
    seed(receipt({ status: 'confirmed', source: 'qrcode' }), item('a', 'DETERGENTE YPE', 50));
    const phone = await phoneLines();
    await browser(1440);
    await open();
    expect(button('Confirmar nota')).toBeUndefined();
    expect(footerButtons()).toEqual(['Excluir nota']);
    expect(lines()).toEqual(phone);
  });

  it('a nota confirmada, no computador: "Trocar produto" fica no cartão do item, na coluna principal, e "Item" no título dos itens', async () => {
    mockDb.corrections = true;
    mockMarket.products = [{ id: 'p1', name: 'Detergente', category: 'limpeza', shelf_life_days: null }];
    seed(receipt({ status: 'confirmed', source: 'qrcode' }), item('a', 'DETERGENTE YPE', 50, { product_id: 'p1' }));
    await browser(1440);
    await open();
    expect(said(main()!)).toEqual(expect.arrayContaining(['Itens (1)', 'Item', 'Detergente', 'Trocar produto']));
    expect(said(side()!)).not.toContain('Trocar produto');
    expect(chip('Trocar produto', card('Detergente'))).toBeDefined();
  });

  it('a janela que cruza a largura do computador não perde o que foi digitado num item (o peso do balcão)', async () => {
    seed(receipt({ total: 22.99 }), item('i1', 'QUEIJO parmesão', 22.99, { suggested_category: 'laticinios' }));
    const weightField = () => renderer!.root.findAllByType(TextField).find((entry) => entry.props.placeholder === 'Peso em kg (ex.: 0,186)');
    await browser(1440);
    await open();
    await press(chip('Informar o peso'));
    act(() => weightField()!.props.onChangeText('0,186'));
    // Para a janela estreita (o iPad que vira de pé) e de volta: o campo continua aberto, com o peso digitado.
    await browser(900);
    expect(side()).toBeUndefined();
    expect(weightField()?.props.value).toBe('0,186');
    await browser(1440);
    expect(side()).toBeDefined();
    expect(weightField()?.props.value).toBe('0,186');
  });

  it('as fotos da nota abrem na caixa das fotos (SheetModal `photo`): no computador, uma caixa grande no meio da janela', async () => {
    seed(receipt({ image_path: 'h1/nota.jpg' }), item('a', 'DETERGENTE YPE', 50));
    jest.mocked(signedImageUrl).mockResolvedValueOnce('https://fotos/h1/nota.jpg');
    await browser(1440);
    await open();
    await press(button('Ver foto da nota'));
    const viewer = renderer!.root.findAllByType(SheetModal).find((entry) => entry.props.visible);
    expect(viewer?.props.photo).toBe(true);
    expect(said(viewer!)).toContain('Foto da nota');
  });
});

describe('"Congelou?": a linha de carne ou peixe que vai para a despensa', () => {
  const carne = (patch: Row = {}) =>
    item('c', 'PICANHA BOV KG', 60, { suggested_name: 'Picanha', suggested_category: 'carnes', quantity: 1, unit: 'kg', unit_price: 60, ...patch });
  const pantryOf = (id: string) => (mockDb.rpcs.find((call) => call.fn === 'confirm_receipt')?.args.p_items as Row[]).find((entry) => entry.id === id)?.pantry as Row | undefined;
  const day = `${YEAR}-06-10`;

  it('pergunta na carne e na linguiça do açougue, não no pão nem na salsicha dos frios', async () => {
    mockFreezer.available = true;
    seed(
      receipt({ total: 100 }),
      carne(),
      item('l', 'LINGUICA TOSCANA', 20, { suggested_name: 'Linguiça toscana', suggested_category: 'carnes' }),
      item('p', 'PAO FRANCES KG', 10, { suggested_name: 'Pão francês', suggested_category: 'padaria' }),
      item('s', 'SALSICHA HOT DOG', 10, { suggested_name: 'Salsicha', suggested_category: 'frios' }),
    );
    await open();
    expect(said(card('PICANHA BOV KG'))).toContain('Congelou?');
    expect(chip('Congelei', card('PICANHA BOV KG'))?.props.accessibilityLabel).toBe('Congelei: PICANHA BOV KG');
    expect(said(card('LINGUICA TOSCANA'))).toContain('Congelou?');
    expect(said(card('PAO FRANCES KG'))).not.toContain('Congelou?');
    expect(said(card('SALSICHA HOT DOG'))).not.toContain('Congelou?');
  });

  it('sem a resposta do banco (pendente, falhou ou sem o congelador) não pergunta, e a linha "CONG" vai como antes', async () => {
    for (const available of [undefined, false]) {
      mockFreezer.available = available;
      mockDb.rpcs = [];
      seed(receipt({ total: 30 }), item('t', 'FILE TILAPIA CONG', 30, { suggested_name: 'Filé de tilápia', suggested_category: 'peixes' }));
      await open();
      expect(page()).not.toContain('Congelou?');
      await press(button('Confirmar nota'));
      expect(pantryOf('t')).toEqual({ name: 'Filé de tilápia', category: 'peixes', purchased_on: day, expires_on: `${YEAR}-06-12`, expiry_source: 'categoria' });
      act(() => renderer?.unmount());
    }
  });

  it('"CONG" começa marcado; marcar muda a validade e o que vai para confirm_receipt', async () => {
    mockFreezer.available = true;
    seed(receipt({ total: 90 }), carne(), item('t', 'FILE TILAPIA CONG', 30, { suggested_name: 'Filé de tilápia', suggested_category: 'peixes' }));
    await open();
    expect(chip('Congelei', card('FILE TILAPIA CONG'))?.props.selected).toBe(true);
    expect(said(card('FILE TILAPIA CONG'))).toContain('Validade estimada no congelador (peixe e frutos do mar: 60 dias) — ajuste se quiser.');
    expect(chip('Congelei', card('PICANHA BOV KG'))?.props.selected).toBe(false);
    expect(said(card('PICANHA BOV KG'))).toContain('Validade estimada pela categoria — ajuste se quiser.');
    await press(chip('Congelei', card('PICANHA BOV KG')));
    expect(said(card('PICANHA BOV KG'))).toContain('Validade estimada no congelador (carne bovina e suína: 90 dias) — ajuste se quiser.');
    await press(button('Confirmar nota'));
    expect(pantryOf('c')).toEqual({
      name: 'Picanha',
      category: 'carnes',
      purchased_on: day,
      expires_on: `${YEAR}-09-08`,
      expiry_source: 'congelado',
      frozen_on: day,
      freeze_kind: 'carne',
      fresh_expires_on: `${YEAR}-06-13`,
      fresh_expiry_source: 'categoria',
    });
    expect(pantryOf('t')).toEqual(expect.objectContaining({ frozen_on: day, freeze_kind: 'peixe', expiry_source: 'congelado' }));
  });

  it('a validade digitada antes de "Congelei" vai como a de antes do congelador (manual)', async () => {
    mockFreezer.available = true;
    seed(receipt({ total: 60 }), carne());
    await open();
    const expiry = () => card('PICANHA BOV KG').findAll((node) => node.props.accessibilityLabel === 'Validade de PICANHA BOV KG' && typeof node.props.onChangeText === 'function')[0];
    await run(() => expiry().props.onChangeText('20/06/' + YEAR));
    // Sem sair do campo: o toque em "Congelei" grava a data digitada antes.
    await press(chip('Congelei', card('PICANHA BOV KG')));
    await press(button('Confirmar nota'));
    expect(pantryOf('c')).toEqual(
      expect.objectContaining({ expiry_source: 'congelado', fresh_expires_on: `${YEAR}-06-20`, fresh_expiry_source: 'manual', frozen_on: day }),
    );
  });

  it('"Já está na despensa" respondido "Não colocar": a compra do carrinho vai para o congelador depois de confirmar', async () => {
    mockFreezer.available = true;
    mockMarket.pantryNear = [{ id: 'cart-picanha', product_id: null, name: 'Picanha', purchased_on: `${YEAR}-06-09` }];
    seed(receipt({ total: 60 }), carne());
    await open();
    await press(chip('Congelei', card('PICANHA BOV KG')));
    await press(button('Confirmar nota'));
    expect(asked('Já está na despensa')).toHaveLength(1);
    expect(pantryOf('c')).toBeUndefined();
    expect(mockDb.rpcs.find((call) => call.fn === 'freeze_pantry_items')?.args).toEqual({ p_ids: ['cart-picanha'], p_kind: 'carne', p_frozen_on: day });
    expect(notify).not.toHaveBeenCalledWith('Não deu certo', expect.anything());
  });

  it('e quando congelar a compra do carrinho falha, a pessoa fica sabendo', async () => {
    mockFreezer.available = true;
    mockMarket.pantryNear = [{ id: 'cart-picanha', product_id: null, name: 'Picanha', purchased_on: `${YEAR}-06-09` }];
    mockDb.fails = [({ table }) => table === 'freeze_pantry_items'];
    seed(receipt({ total: 60 }), carne());
    await open();
    await press(chip('Congelei', card('PICANHA BOV KG')));
    await press(button('Confirmar nota'));
    expect(notify).toHaveBeenCalledWith(
      'Não deu certo',
      'A nota foi salva, mas não deu para marcar Picanha como congelado. Em Compras > Despensa, toque no item e escolha quando ele foi para o congelador.',
    );
  });

  it('a pessoa sai da revisão antes de a confirmação responder: a compra do carrinho vai para o congelador do mesmo jeito', async () => {
    mockFreezer.available = true;
    mockMarket.pantryNear = [{ id: 'cart-picanha', product_id: null, name: 'Picanha', purchased_on: `${YEAR}-06-09` }];
    seed(receipt({ total: 60 }), carne());
    await open();
    await press(chip('Congelei', card('PICANHA BOV KG')));
    const answer = hold(({ table }) => table === 'confirm_receipt');
    await press(button('Confirmar nota'));
    expect(mockDb.rpcs.map((call) => call.fn)).toEqual(['confirm_receipt']);
    // Voltar com a nota ainda confirmando: a revisão sai da tela (o onSuccess de cada chamada não roda mais).
    act(() => renderer?.unmount());
    renderer = undefined;
    await answer();
    expect(mockDb.rpcs.find((call) => call.fn === 'freeze_pantry_items')?.args).toEqual({ p_ids: ['cart-picanha'], p_kind: 'carne', p_frozen_on: day });
  });

  it('e a falha de congelar depois de a revisão sair ainda é dita', async () => {
    mockFreezer.available = true;
    mockMarket.pantryNear = [{ id: 'cart-picanha', product_id: null, name: 'Picanha', purchased_on: `${YEAR}-06-09` }];
    mockDb.fails = [({ table }) => table === 'freeze_pantry_items'];
    seed(receipt({ total: 60 }), carne());
    await open();
    await press(chip('Congelei', card('PICANHA BOV KG')));
    const answer = hold(({ table }) => table === 'confirm_receipt');
    await press(button('Confirmar nota'));
    act(() => renderer?.unmount());
    renderer = undefined;
    await answer();
    expect(notify).toHaveBeenCalledWith(
      'Não deu certo',
      'A nota foi salva, mas não deu para marcar Picanha como congelado. Em Compras > Despensa, toque no item e escolha quando ele foi para o congelador.',
    );
  });

  it('a confirmação que falha não congela nada', async () => {
    mockFreezer.available = true;
    mockMarket.pantryNear = [{ id: 'cart-picanha', product_id: null, name: 'Picanha', purchased_on: `${YEAR}-06-09` }];
    mockDb.fails = [({ table }) => table === 'confirm_receipt'];
    seed(receipt({ total: 60 }), carne());
    await open();
    await press(chip('Congelei', card('PICANHA BOV KG')));
    await press(button('Confirmar nota'));
    expect(mockDb.rpcs.some((call) => call.fn === 'freeze_pantry_items')).toBe(false);
  });

  it('a validade aprendida do produto diz que o produto aprendeu', async () => {
    mockMarket.products = [{ id: 'p-arroz', name: 'Arroz', category: 'graos', shelf_life_days: 200 }];
    seed(receipt({ total: 12.9 }), item('b', 'ARROZ TIO JOAO 5KG', 12.9, { product_id: 'p-arroz', suggested_name: 'Arroz', suggested_category: 'graos' }));
    await open();
    expect(said(card('ARROZ TIO JOAO 5KG'))).toContain('Validade que o produto aprendeu — ajuste se quiser.');
  });
});

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { PRODUCT_MERGED_AWAY, PRODUCT_NAME_TAKEN } from '@/domain/productMerge';

import { learnShelfLife } from '../home';
import { ProductNameTakenError, useAddItemsToList, useAddListItem, useAddToMarketList, useRenameProduct, type NewListItem } from '../market';
import { isProductMergedAway } from '../productMerge';
import { useConfirmReceipt } from '../receipts';

// Juntar produtos apaga um produto. Outro aparelho da casa, com a tela aberta desde antes, ainda manda o id dele:
// o banco recusa (23503 na chave estrangeira para `products`). Aqui, cada gravação que manda um id de produto:
// a pessoa lê uma frase só, e o que a tela tinha guardado é buscado de novo.

interface Call {
  /** A tabela, ou "rpc nome". */
  target: string;
  /** Os métodos chamados no pedido, na ordem (insert, select, single...). */
  steps: string[];
}
type Reply = { data: unknown; error: object | null };

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockDb = {
  calls: [] as Call[],
  /** O que o banco responde a cada pedido. */
  reply: (_call: Call): Reply => ({ data: null, error: null }),
  /** O que cada passo de cada pedido recebeu: [tabela, passo, argumentos]. */
  sent: [] as [string, string, unknown[]][],
};

jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('@/lib/session', () => ({ endSessionIfGone: async () => false }));
jest.mock('@/lib/supabase', () => {
  // Um pedido como o do Supabase: cada método devolve o próprio pedido, e esperar por ele traz a resposta.
  const request = (target: string) => {
    const call: Call = { target, steps: [] };
    const builder: object = new Proxy(
      {},
      {
        get: (_target, step) => {
          if (typeof step !== 'string') return undefined;
          if (step !== 'then') {
            return (...args: unknown[]) => {
              call.steps.push(step);
              mockDb.sent.push([target, step, args]);
              return builder;
            };
          }
          return (resolve: (reply: Reply) => unknown, reject: (error: unknown) => unknown) => {
            mockDb.calls.push(call);
            return Promise.resolve(mockDb.reply(call)).then(resolve, reject);
          };
        },
      },
    );
    return builder;
  };
  return {
    supabase: { from: (table: string) => request(table), rpc: (name: string) => request(`rpc ${name}`) },
    unwrap: (result: Reply) => {
      if (result.error) throw result.error;
      return result.data;
    },
    errorMessage: (error: { message?: string }) => error?.message ?? 'Algo deu errado. Tente novamente.',
  };
});

/** Como o PostgREST devolve a chave estrangeira de um produto que não existe mais. */
const productGone = (table: string) => ({
  code: '23503',
  message: `insert or update on table "${table}" violates foreign key constraint "${table}_product_id_household_id_fkey"`,
  details: 'Key (product_id, household_id)=(0a1f6c1e-0000-4000-8000-000000000001, 4a1b0000-0000-4000-8000-000000000000) is not present in table "products".',
  hint: null,
});
/** Outro 23503, que não fala de produto: a lista foi apagada em outro aparelho. */
const listGone = {
  code: '23503',
  message: 'insert or update on table "shopping_list_items" violates foreign key constraint "shopping_list_items_list_id_fkey"',
  details: 'Key (list_id)=(7c2d0000-0000-4000-8000-000000000000) is not present in table "shopping_lists".',
  hint: null,
};

const ARROZ: NewListItem = { name: 'Arroz 5kg', category: 'graos', productId: 'p-gone', quantity: 1, unit: 'un' };

let renderer: ReactTestRenderer | undefined;

/** Roda um hook de verdade dentro de um QueryClient; devolve o que ele deu por último e as chaves invalidadas. */
async function withHook<T>(useIt: () => T) {
  // Sem temporizador de limpeza do cache: o Jest não fica esperando por ele no fim.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: 0 } } });
  const invalidated: unknown[] = [];
  const invalidate = client.invalidateQueries.bind(client);
  client.invalidateQueries = ((filters?: { queryKey?: readonly unknown[] }) => {
    invalidated.push(filters?.queryKey?.[0]);
    return invalidate(filters);
  }) as typeof client.invalidateQueries;
  const seen: { current: T | undefined } = { current: undefined };
  function Probe() {
    seen.current = useIt();
    return null;
  }
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  return { client, invalidated, value: () => seen.current as T };
}

const flush = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));

/** O erro com que a gravação falhou. */
async function failure(run: () => Promise<unknown>): Promise<unknown> {
  let caught: unknown;
  await act(async () => {
    await run().catch((error: unknown) => {
      caught = error;
    });
  });
  return caught;
}

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  mockDb.calls = [];
  mockDb.sent = [];
  mockDb.reply = () => ({ data: null, error: null });
});

describe('isProductMergedAway', () => {
  it('é o 23503 da chave estrangeira de um produto, em qualquer tabela que guarde um', () => {
    expect(isProductMergedAway(productGone('receipt_items'))).toBe(true);
    expect(isProductMergedAway(productGone('shopping_list_items'))).toBe(true);
    expect(isProductMergedAway(productGone('pantry_items'))).toBe(true);
    // Sem os detalhes, o nome da chave basta.
    expect(isProductMergedAway({ ...productGone('receipt_items'), details: null })).toBe(true);
  });

  it('não é outro 23503, nem outro erro', () => {
    expect(isProductMergedAway(listGone)).toBe(false);
    // A chave de uma tabela com "product" no nome, mas para a casa: não é um produto que sumiu.
    expect(
      isProductMergedAway({
        code: '23503',
        message: 'insert or update on table "product_aliases" violates foreign key constraint "product_aliases_household_id_fkey"',
        details: 'Key (household_id)=(4a1b0000-0000-4000-8000-000000000000) is not present in table "households".',
      }),
    ).toBe(false);
    expect(
      isProductMergedAway({ code: '23503', message: 'insert or update on table "products" violates foreign key constraint "products_household_id_fkey"' }),
    ).toBe(false);
    // Apagar um produto que ainda tem linhas: a chave é a mesma, o erro é outro.
    expect(
      isProductMergedAway({
        code: '23503',
        message: 'update or delete on table "products" violates foreign key constraint "pantry_items_product_id_household_id_fkey" on table "pantry_items"',
        details: 'Key (id, household_id)=(a, b) is still referenced from table "pantry_items".',
      }),
    ).toBe(false);
    expect(isProductMergedAway({ code: '23505', message: 'duplicate key value violates unique constraint "products_household_name"' })).toBe(false);
    expect(isProductMergedAway({ code: 'P0002', message: 'product not found' })).toBe(false);
    expect(isProductMergedAway({ message: 'TypeError: Network request failed' })).toBe(false);
    expect(isProductMergedAway(new Error(PRODUCT_MERGED_AWAY))).toBe(false);
    expect(isProductMergedAway(null)).toBe(false);
  });
});

describe('confirmar a nota com um produto que foi juntado', () => {
  it('a frase no lugar do texto do banco, e produtos e nota buscados de novo', async () => {
    mockDb.reply = () => ({ data: null, error: productGone('receipt_items') });
    const hook = await withHook(() => useConfirmReceipt('r1'));
    const error = await failure(() => hook.value().mutateAsync([{ id: 'i1', product_id: 'p-gone' }]));
    expect((error as Error).message).toBe(PRODUCT_MERGED_AWAY);
    expect(mockDb.calls).toEqual([{ target: 'rpc confirm_receipt', steps: [] }]);
    expect([...hook.invalidated].sort()).toEqual(['products', 'receipt']);
  });

  // Com os produtos de agora e a nota de antes, o item cujo produto sumiu pareceria um produto novo, e confirmar
  // criaria de novo o produto que foi juntado. Por isso a gravação só termina (e o botão só volta) com os dois.
  it('só termina depois que os produtos e a nota chegaram', async () => {
    const waiting: Record<string, () => void> = {};
    const held = (key: string) => () =>
      new Promise<string>((resolve) => {
        waiting[key] = () => resolve(key);
      });
    const hook = await withHook(() => ({
      products: useQuery({ queryKey: ['products'], queryFn: held('products') }),
      receipt: useQuery({ queryKey: ['receipt', 'r1'], queryFn: held('receipt') }),
      confirm: useConfirmReceipt('r1'),
    }));
    // A primeira busca de cada um.
    await act(async () => {
      waiting.products();
      waiting.receipt();
    });
    await flush();
    expect(hook.value().receipt.data).toBe('receipt');

    mockDb.reply = () => ({ data: null, error: productGone('receipt_items') });
    let settled: unknown;
    await act(async () => {
      hook
        .value()
        .confirm.mutateAsync([{ id: 'i1', product_id: 'p-gone' }])
        .catch((error: unknown) => {
          settled = error;
        });
    });
    await flush();
    expect(hook.value().confirm.isPending).toBe(true);
    await act(async () => waiting.products());
    await flush();
    // Só os produtos chegaram: ainda não.
    expect(hook.value().confirm.isPending).toBe(true);
    expect(settled).toBeUndefined();
    await act(async () => waiting.receipt());
    await flush();
    expect(hook.value().confirm.isPending).toBe(false);
    expect((settled as Error).message).toBe(PRODUCT_MERGED_AWAY);
  });

  it('outro 23503 segue com a mensagem dele, sem buscar nada', async () => {
    const other = {
      code: '23503',
      message: 'insert or update on table "receipt_items" violates foreign key constraint "receipt_items_receipt_id_fkey"',
      details: 'Key (receipt_id)=(r1) is not present in table "receipts".',
    };
    mockDb.reply = () => ({ data: null, error: other });
    const hook = await withHook(() => useConfirmReceipt('r1'));
    expect(await failure(() => hook.value().mutateAsync([]))).toEqual(other);
    expect(hook.invalidated).toEqual([]);
  });

  it('deu certo: tudo o que a nota muda é buscado de novo, como antes', async () => {
    const hook = await withHook(() => useConfirmReceipt('r1'));
    await act(async () => {
      await hook.value().mutateAsync([]);
    });
    expect(hook.invalidated).toContain('latestPrices');
    expect(hook.invalidated.length).toBeGreaterThan(5);
  });
});

describe('pôr na lista um produto que foi juntado', () => {
  const SOURCES = ['pantry', 'products', 'purchaseRecords'];
  /** A gravação dos itens falha com `error`; as outras idas ao banco dão certo. */
  const failItems = (error: object) => (call: Call) => {
    if (call.target === 'rpc open_market_list') return { data: { id: 'l1', name: 'Mercado' }, error: null };
    if (call.target === 'shopping_lists') return { data: { id: 'l9' }, error: null };
    if (call.target === 'shopping_list_items' && call.steps[0] === 'insert') return { data: null, error };
    return { data: [], error: null };
  };

  it('um item na lista aberta (useAddListItem)', async () => {
    mockDb.reply = failItems(productGone('shopping_list_items'));
    const hook = await withHook(() => useAddListItem('l1'));
    const error = await failure(() => hook.value().mutateAsync(ARROZ));
    expect((error as Error).message).toBe(PRODUCT_MERGED_AWAY);
    expect([...hook.invalidated].sort()).toEqual(SOURCES);

    mockDb.reply = failItems(listGone);
    hook.invalidated.length = 0;
    expect(await failure(() => hook.value().mutateAsync(ARROZ))).toEqual(listGone);
    expect(hook.invalidated).toEqual([]);
  });

  it('vários itens, numa lista que já existe ou numa nova (useAddItemsToList)', async () => {
    mockDb.reply = failItems(productGone('shopping_list_items'));
    const hook = await withHook(() => useAddItemsToList());
    const existing = await failure(() => hook.value().mutateAsync({ listId: 'l1', newListName: 'Mercado', items: [ARROZ] }));
    expect((existing as Error).message).toBe(PRODUCT_MERGED_AWAY);
    expect([...hook.invalidated].sort()).toEqual(SOURCES);

    hook.invalidated.length = 0;
    mockDb.calls = [];
    const created = await failure(() => hook.value().mutateAsync({ newListName: 'Mercado', items: [ARROZ] }));
    expect((created as Error).message).toBe(PRODUCT_MERGED_AWAY);
    expect(mockDb.calls.map((call) => call.target)).toEqual(['shopping_lists', 'shopping_list_items']);
    expect([...hook.invalidated].sort()).toEqual(SOURCES);

    hook.invalidated.length = 0;
    const reused = await failure(() => hook.value().mutateAsync({ newListName: 'Mercado', reuseMarketList: true, items: [ARROZ] }));
    expect((reused as Error).message).toBe(PRODUCT_MERGED_AWAY);
    expect([...hook.invalidated].sort()).toEqual(SOURCES);

    mockDb.reply = failItems(listGone);
    hook.invalidated.length = 0;
    expect(await failure(() => hook.value().mutateAsync({ listId: 'l1', newListName: 'Mercado', items: [ARROZ] }))).toEqual(listGone);
    expect(hook.invalidated).toEqual([]);
  });

  it('o que acabou na despensa, para a lista de mercado (useAddToMarketList)', async () => {
    mockDb.reply = failItems(productGone('shopping_list_items'));
    const hook = await withHook(() => useAddToMarketList());
    const error = await failure(() => hook.value().mutateAsync(ARROZ));
    expect((error as Error).message).toBe(PRODUCT_MERGED_AWAY);
    expect(mockDb.calls.map((call) => call.target)).toEqual(['rpc open_market_list', 'shopping_list_items', 'shopping_list_items']);
    // E as listas, como em toda falha de pôr na lista: o próximo menu parte das listas de agora.
    expect([...hook.invalidated].sort()).toEqual(['lists', ...SOURCES]);

    mockDb.reply = failItems(listGone);
    hook.invalidated.length = 0;
    expect(await failure(() => hook.value().mutateAsync(ARROZ))).toEqual(listGone);
    expect(hook.invalidated).toEqual(['lists']);
  });

  it('deu certo: as listas são buscadas de novo, como antes', async () => {
    mockDb.reply = (call) => (call.target === 'rpc open_market_list' ? { data: { id: 'l1', name: 'Mercado' }, error: null } : { data: [], error: null });
    const hook = await withHook(() => useAddToMarketList());
    await act(async () => {
      expect(await hook.value().mutateAsync(ARROZ)).toEqual({ id: 'l1', name: 'Mercado', added: true });
    });
    expect(hook.invalidated).toEqual(['lists', 'listItems']);
  });

  it('a frase é uma só, para a nota e para a lista', () => {
    expect(PRODUCT_MERGED_AWAY).toBe('Um produto daqui foi juntado com outro. Confira e tente de novo.');
  });
});

describe('gravar num produto que foi juntado: o banco não reclama de uma gravação que não acha linha nenhuma', () => {
  /** O que foi mandado em cada passo `step` dos pedidos à tabela `target`. */
  const sent = (target: string, step: string) => mockDb.sent.filter(([t, s]) => t === target && s === step).map(([, , args]) => args);

  it('mudar o nome ou a categoria: falha com a frase, e os produtos são buscados de novo', async () => {
    mockDb.reply = () => ({ data: [], error: null });
    const hook = await withHook(() => useRenameProduct());
    const error = await failure(() => hook.value().mutateAsync({ id: 'p-gone', name: 'Arroz', category: 'graos' }));
    expect((error as Error).message).toBe(PRODUCT_MERGED_AWAY);
    expect(mockDb.calls).toEqual([{ target: 'products', steps: ['update', 'eq', 'select'] }]);
    expect(hook.invalidated).toEqual(['products']);
  });

  it('mudar o nome de um produto que existe: grava e busca os produtos de novo, como antes', async () => {
    mockDb.reply = () => ({ data: [{ id: 'p1' }], error: null });
    const hook = await withHook(() => useRenameProduct());
    expect(await failure(() => hook.value().mutateAsync({ id: 'p1', name: 'Arroz', category: 'graos' }))).toBeUndefined();
    expect(sent('products', 'update')).toEqual([[{ name: 'Arroz', category: 'graos' }]]);
    expect(hook.invalidated).toEqual(['products', 'spending']);
  });

  /** Como o PostgREST devolve o nome repetido (products_household_name_key, por lower(name)). */
  const nameTaken = { code: '23505', message: 'duplicate key value violates unique constraint "products_household_name_key"', details: 'Key (household_id, lower(name))=(h, arroz) already exists.', hint: null };

  it('renomear para o nome de outro produto: em vez do texto do banco, o erro diz qual é o outro', async () => {
    const other = { id: 'p-arroz', name: 'Arroz', category: 'graos' };
    mockDb.reply = (call) => (call.steps[0] === 'update' ? { data: null, error: nameTaken } : { data: [other], error: null });
    const hook = await withHook(() => useRenameProduct());
    const error = await failure(() => hook.value().mutateAsync({ id: 'p1', name: 'ARROZ_100%', category: 'graos' }));
    expect(error).toBeInstanceOf(ProductNameTakenError);
    expect((error as ProductNameTakenError).message).toBe(PRODUCT_NAME_TAKEN);
    expect((error as ProductNameTakenError).other).toEqual(other);
    expect(mockDb.calls).toEqual([
      { target: 'products', steps: ['update', 'eq', 'select'] },
      { target: 'products', steps: ['select', 'ilike', 'neq', 'limit'] },
    ]);
    // O nome como o banco compara (sem maiúsculas), com o % e o _ escapados; e nunca o próprio produto.
    expect(sent('products', 'ilike')).toEqual([['name', 'ARROZ\\_100\\%']]);
    expect(sent('products', 'neq')).toEqual([['id', 'p1']]);
    expect(hook.invalidated).toEqual([]);
  });

  it('sem conseguir achar o outro produto, o mesmo aviso, sem ele', async () => {
    mockDb.reply = (call) => (call.steps[0] === 'update' ? { data: null, error: nameTaken } : { data: null, error: { message: 'sem rede' } });
    const hook = await withHook(() => useRenameProduct());
    const error = await failure(() => hook.value().mutateAsync({ id: 'p1', name: 'Arroz', category: 'graos' }));
    expect(error).toBeInstanceOf(ProductNameTakenError);
    expect((error as ProductNameTakenError).other).toBeNull();
  });

  it('outro erro do banco segue como veio', async () => {
    const other = { code: '42501', message: 'permission denied for table products' };
    mockDb.reply = () => ({ data: null, error: other });
    const hook = await withHook(() => useRenameProduct());
    expect(await failure(() => hook.value().mutateAsync({ id: 'p1', name: 'Arroz', category: 'graos' }))).toBe(other);
  });

  it('a validade corrigida à mão: com o produto juntado, ensina o produto em que o item da despensa está agora', async () => {
    let productWrites = 0;
    mockDb.reply = (call) => {
      if (call.target === 'pantry_items') return { data: { product_id: 'p-kept' }, error: null };
      productWrites += 1;
      // A primeira gravação é no produto que sumiu: nenhuma linha.
      return { data: productWrites === 1 ? [] : [{ id: 'p-kept' }], error: null };
    };
    await learnShelfLife('p-gone', 30, 'pantry-1');
    expect(mockDb.calls).toEqual([
      { target: 'products', steps: ['update', 'eq', 'select'] },
      { target: 'pantry_items', steps: ['select', 'eq', 'maybeSingle'] },
      { target: 'products', steps: ['update', 'eq', 'select'] },
    ]);
    expect(sent('products', 'update')).toEqual([[{ shelf_life_days: 30 }], [{ shelf_life_days: 30 }]]);
    expect(sent('products', 'eq')).toEqual([
      ['id', 'p-gone'],
      ['id', 'p-kept'],
    ]);
    expect(sent('pantry_items', 'eq')).toEqual([['id', 'pantry-1']]);
  });

  it('a validade corrigida à mão: o produto que ficou também foi juntado no meio do caminho, e a gravação segue o item de novo', async () => {
    // A foi juntado com B; entre ler o item (B) e gravar, B foi juntado com C.
    const itemNow = ['p-b', 'p-c'];
    mockDb.reply = (call) => {
      if (call.target === 'pantry_items') return { data: { product_id: itemNow.shift() }, error: null };
      const id = mockDb.sent.filter(([t, s]) => t === 'products' && s === 'eq').at(-1)![2][1];
      return { data: id === 'p-c' ? [{ id }] : [], error: null };
    };
    await learnShelfLife('p-a', 30, 'pantry-1');
    expect(mockDb.calls.map((call) => call.target)).toEqual(['products', 'pantry_items', 'products', 'pantry_items', 'products']);
    expect(sent('products', 'eq')).toEqual([
      ['id', 'p-a'],
      ['id', 'p-b'],
      ['id', 'p-c'],
    ]);
  });

  it('a validade corrigida à mão: não fica tentando para sempre', async () => {
    // Cada leitura aponta para um produto novo, e nenhuma gravação acha linha: para no terceiro produto.
    let n = 0;
    mockDb.reply = (call) => (call.target === 'pantry_items' ? { data: { product_id: `p-${++n}` }, error: null } : { data: [], error: null });
    await learnShelfLife('p-0', 30, 'pantry-1');
    expect(sent('products', 'eq')).toEqual([
      ['id', 'p-0'],
      ['id', 'p-1'],
      ['id', 'p-2'],
    ]);
  });

  it('a validade corrigida à mão: com o produto no lugar, uma gravação só', async () => {
    mockDb.reply = () => ({ data: [{ id: 'p1' }], error: null });
    await learnShelfLife('p1', 30, 'pantry-1');
    expect(mockDb.calls).toEqual([{ target: 'products', steps: ['update', 'eq', 'select'] }]);
  });

  it('a validade corrigida à mão: sem ter para onde ir, não inventa nem falha (o item da despensa já está salvo)', async () => {
    // Item novo (ainda sem id): não há item para dizer qual é o produto agora.
    mockDb.reply = () => ({ data: [], error: null });
    await learnShelfLife('p-gone', 30);
    expect(mockDb.calls.map((call) => call.target)).toEqual(['products']);
    // O item da despensa ficou sem produto, ou segue apontando para o mesmo: nada a ensinar.
    for (const current of [null, { product_id: null }, { product_id: 'p-gone' }]) {
      mockDb.calls = [];
      mockDb.reply = (call) => (call.target === 'pantry_items' ? { data: current, error: null } : { data: [], error: null });
      await learnShelfLife('p-gone', 30, 'pantry-1');
      expect(mockDb.calls.map((call) => call.target)).toEqual(['products', 'pantry_items']);
    }
  });
});

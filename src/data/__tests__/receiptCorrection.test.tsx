import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { PRODUCT_MERGED_AWAY } from '@/domain/productMerge';
import { CATEGORY_SHELF_LIFE_DAYS, correctionNotice, type AddedItemRequest } from '@/domain/receiptCorrection';

import {
  correctionRefusal,
  newReceiptItemId,
  RECEIPT_CORRECTION_REFRESHES,
  ReceiptCorrectionRefused,
  useAddConfirmedReceiptItem,
  useChangeReceiptItemProduct,
  useConfirmReceipt,
  useReceiptCorrectionsAvailable,
} from '../receipts';

// As duas correções da nota confirmada e a pergunta se o banco as tem (data/receipts), sobre um rpc de mentira: o
// que vai no pedido, o que a recusa vira e o que é buscado de novo.

type Reply = { data: unknown; error: object | null };
// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockDb = {
  rpcs: [] as { fn: string; args: unknown }[],
  /** As respostas dos próximos pedidos, na ordem; acabando, vale `reply`. */
  replies: [] as Reply[],
  reply: { data: null, error: null } as Reply,
};

jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('@/lib/session', () => ({ endSessionIfGone: async () => false }));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: async (fn: string, args: unknown) => {
      mockDb.rpcs.push({ fn, args });
      return mockDb.replies.shift() ?? mockDb.reply;
    },
  },
  unwrap: (result: { data: unknown; error: unknown }) => {
    if (result.error) throw result.error;
    return result.data;
  },
}));

let renderer: ReactTestRenderer | undefined;
/** O que aconteceu, na ordem: as buscas de novo e o fim da gravação. */
let events: string[] = [];

async function withHook<T>(useIt: () => T) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: 0 } } });
  const invalidated: unknown[] = [];
  const invalidate = client.invalidateQueries.bind(client);
  client.invalidateQueries = ((filters?: { queryKey?: readonly unknown[] }) => {
    invalidated.push(filters?.queryKey?.length === 1 ? filters.queryKey[0] : filters?.queryKey);
    return invalidate(filters);
  }) as typeof client.invalidateQueries;
  const seen: { current: T | undefined } = { current: undefined };
  // Os produtos e a nota na tela: buscas que demoram um pouco, para ver se a recusa espera por elas.
  const slow = (name: string) => async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    events.push(name);
    return [];
  };
  function Probe() {
    useQuery({ queryKey: ['products'], queryFn: slow('produtos') });
    useQuery({ queryKey: ['receipt', 'r1'], queryFn: slow('nota') });
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
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
  events = [];
  invalidated.length = 0;
  return { client, invalidated, value: () => seen.current as T };
}

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  mockDb.rpcs = [];
  mockDb.replies = [];
  mockDb.reply = { data: null, error: null };
  events = [];
});

const ITEM = { id: 'i1', product_id: 'p1' };
const REQUEST: AddedItemRequest = {
  id: 'n1',
  raw_description: 'Feijão carioca',
  quantity: 2,
  unit: 'un',
  unit_price: 7.9,
  total_price: 15.8,
  product_id: 'p2',
  pantry: { name: 'Feijão carioca', category: 'graos', purchased_on: '2026-06-10', expires_on: '2026-12-07', expiry_source: 'categoria' },
};
const NK018 = { code: 'NK018', message: 'receipt item changed', details: null, hint: null };
const NK019 = { code: 'NK019', message: 'receipt not confirmed', details: null, hint: null };
const NO_FUNCTION = { code: 'PGRST202', message: 'Could not find the function public.change_receipt_item_product in the schema cache' };
const DEADLOCK = { code: '40P01', message: 'deadlock detected' };
const gone = (message: string) => ({ code: 'P0002', message, details: null, hint: null });
const MERGED_FK = {
  code: '23503',
  message: 'insert or update on table "receipt_items" violates foreign key constraint "receipt_items_product_id_household_id_fkey"',
  details: 'Key (product_id, household_id)=(p2, h1) is not present in table "products".',
};

describe('o que vai ao banco', () => {
  it('a troca: todas as chaves, as nulas também, com o produto que a tela mostrava, as validades e o tipo do congelador', async () => {
    mockDb.reply = { data: { product_id: 'p2', changed: true, pantry: 1 }, error: null };
    const hook = await withHook(() => useChangeReceiptItemProduct('r1'));
    let result: unknown;
    await act(async () => {
      result = await hook.value().mutateAsync({ item: ITEM, target: { productId: 'p2' }, freezeKind: null });
    });
    expect(mockDb.rpcs).toEqual([
      {
        fn: 'change_receipt_item_product',
        args: {
          p_receipt_id: 'r1',
          p_item_id: 'i1',
          p_expected_product_id: 'p1',
          p_product_id: 'p2',
          p_new_product: null,
          p_shelf_life_days: CATEGORY_SHELF_LIFE_DAYS,
          p_freeze_kind: null,
        },
      },
    ]);
    expect(result).toEqual({ productId: 'p2', changed: true, pantry: 1 });
  });

  it('a troca para um produto novo, numa linha sem produto, e o tipo do congelador', async () => {
    mockDb.reply = { data: { product_id: 'novo', changed: true, pantry: 0 }, error: null };
    const hook = await withHook(() => useChangeReceiptItemProduct('r1'));
    await act(async () => {
      await hook.value().mutateAsync({
        item: { id: 'i2', product_id: null },
        target: { newProduct: { name: 'Carne moída', category: 'carnes' } },
        freezeKind: 'carne_moida',
      });
    });
    expect(mockDb.rpcs[0].args).toEqual({
      p_receipt_id: 'r1',
      p_item_id: 'i2',
      p_expected_product_id: null,
      p_product_id: null,
      p_new_product: { name: 'Carne moída', category: 'carnes' },
      p_shelf_life_days: CATEGORY_SHELF_LIFE_DAYS,
      p_freeze_kind: 'carne_moida',
    });
  });

  it('o item que faltou: o pedido como veio, e a resposta do envio repetido diz se era o mesmo', async () => {
    mockDb.replies = [
      { data: { item_id: 'n1', added: true, same: true, product_id: 'p2', pantry_item_id: 'd1' }, error: null },
      { data: { item_id: 'n1', added: false, same: true, product_id: 'p2' }, error: null },
      { data: { item_id: 'n1', added: false, same: false, product_id: 'p2' }, error: null },
    ];
    const hook = await withHook(() => useAddConfirmedReceiptItem('r1'));
    const results: unknown[] = [];
    await act(async () => {
      for (let i = 0; i < 3; i += 1) results.push(await hook.value().mutateAsync(REQUEST));
    });
    expect(mockDb.rpcs).toEqual(Array.from({ length: 3 }, () => ({ fn: 'add_confirmed_receipt_item', args: { p_receipt_id: 'r1', p_item: REQUEST } })));
    expect(results).toEqual([
      { itemId: 'n1', added: true, same: true },
      { itemId: 'n1', added: false, same: true },
      { itemId: 'n1', added: false, same: false },
    ]);
  });

  it('o id do item que faltou é um uuid feito no aparelho, um novo a cada formulário', () => {
    const a = newReceiptItemId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newReceiptItemId()).not.toBe(a);
  });
});

describe('o que é buscado de novo', () => {
  it('a gravação que deu certo: o mesmo da confirmação, menos as listas e os mercados, com a nota estreitada a esta', async () => {
    const confirm = await withHook(() => useConfirmReceipt('r1'));
    await act(async () => {
      await confirm.value().mutateAsync([]);
    });
    await act(async () => renderer?.unmount());
    const expected = (confirm.invalidated as string[]).filter((key) => !['lists', 'listItems', 'listLinks', 'stores', 'receipt'].includes(key));

    mockDb.reply = { data: { product_id: 'p2', changed: true, pantry: 0 }, error: null };
    const change = await withHook(() => useChangeReceiptItemProduct('r1'));
    await act(async () => {
      await change.value().mutateAsync({ item: ITEM, target: { productId: 'p2' }, freezeKind: null });
    });
    expect(change.invalidated.filter((key) => typeof key === 'string').sort()).toEqual([...expected].sort());
    expect(change.invalidated).toContainEqual(['receipt', 'r1']);
    expect(change.invalidated).not.toContain('receipt');
    expect([...RECEIPT_CORRECTION_REFRESHES].sort()).toEqual([...expected].sort());
    await act(async () => renderer?.unmount());

    mockDb.reply = { data: { item_id: 'n1', added: true, same: true }, error: null };
    const add = await withHook(() => useAddConfirmedReceiptItem('r1'));
    await act(async () => {
      await add.value().mutateAsync(REQUEST);
    });
    expect([...add.invalidated].sort((a, b) => String(a).localeCompare(String(b)))).toEqual(
      [...change.invalidated].sort((a, b) => String(a).localeCompare(String(b))),
    );
  });

  it('o banco ainda sem a função: "falta atualizar o banco", e nada é buscado de novo', async () => {
    mockDb.reply = { data: null, error: NO_FUNCTION };
    const hook = await withHook(() => useChangeReceiptItemProduct('r1'));
    let failure: unknown;
    await act(async () => {
      failure = await hook
        .value()
        .mutateAsync({ item: ITEM, target: { productId: 'p2' }, freezeKind: null })
        .catch((error: unknown) => error);
    });
    expect(failure).toBeInstanceOf(ReceiptCorrectionRefused);
    expect(failure).toMatchObject({ kind: 'notReady', action: 'change', message: correctionNotice('notReady', 'change').message });
    expect(hook.invalidated).toEqual([]);
  });

  it('NK018, NK019 e a nota ou a linha que sumiram: a recusa dela, e a nota buscada de novo', async () => {
    const cases: [object, string][] = [
      [NK018, 'itemChanged'],
      [NK019, 'notConfirmed'],
      [gone('receipt not found'), 'receiptGone'],
      [gone('item not found'), 'itemGone'],
    ];
    for (const [error, kind] of cases) {
      mockDb.reply = { data: null, error };
      const hook = await withHook(() => useChangeReceiptItemProduct('r1'));
      let failure: unknown;
      await act(async () => {
        failure = await hook
          .value()
          .mutateAsync({ item: ITEM, target: { productId: 'p2' }, freezeKind: null })
          .catch((reason: unknown) => reason);
      });
      expect(failure).toMatchObject({ kind, action: 'change' });
      expect(hook.invalidated).toEqual([['receipt', 'r1'], 'receipts']);
      await act(async () => renderer?.unmount());
    }
  });

  it('o produto que sumiu (P0002 ou a chave de products): a recusa só depois de os produtos e a nota voltarem', async () => {
    for (const error of [gone('product not found'), MERGED_FK]) {
      mockDb.reply = { data: null, error };
      const hook = await withHook(() => useAddConfirmedReceiptItem('r1'));
      await act(async () => {
        await hook
          .value()
          .mutateAsync(REQUEST)
          .catch((failure: unknown) => {
            events.push(`recusa ${(failure as ReceiptCorrectionRefused).kind}`);
          });
      });
      expect(events.slice(0, 2).sort()).toEqual(['nota', 'produtos']);
      expect(events[2]).toBe('recusa productGone');
      expect(correctionNotice('productGone', 'add')).toEqual({ title: 'Item não incluído', message: PRODUCT_MERGED_AWAY });
      await act(async () => renderer?.unmount());
      events = [];
    }
  });

  it('o 40P01 é tentado de novo uma vez; a falta de resposta passa como veio', async () => {
    mockDb.replies = [{ data: null, error: DEADLOCK }, { data: { product_id: 'p2', changed: true, pantry: 0 }, error: null }];
    const hook = await withHook(() => useChangeReceiptItemProduct('r1'));
    await act(async () => {
      await hook.value().mutateAsync({ item: ITEM, target: { productId: 'p2' }, freezeKind: null });
    });
    expect(mockDb.rpcs).toHaveLength(2);
    await act(async () => renderer?.unmount());

    mockDb.rpcs = [];
    mockDb.replies = [{ data: null, error: DEADLOCK }, { data: null, error: DEADLOCK }];
    const twice = await withHook(() => useAddConfirmedReceiptItem('r1'));
    let failure: unknown;
    await act(async () => {
      failure = await twice
        .value()
        .mutateAsync(REQUEST)
        .catch((error: unknown) => error);
    });
    expect(mockDb.rpcs).toHaveLength(2);
    expect(failure).toEqual(DEADLOCK);
    await act(async () => renderer?.unmount());

    mockDb.rpcs = [];
    const network = { message: 'TypeError: Network request failed' };
    mockDb.reply = { data: null, error: network };
    const lost = await withHook(() => useAddConfirmedReceiptItem('r1'));
    await act(async () => {
      failure = await lost
        .value()
        .mutateAsync(REQUEST)
        .catch((error: unknown) => error);
    });
    expect(failure).toBe(network);
    expect(mockDb.rpcs).toHaveLength(1);
    expect(lost.invalidated).toEqual([]);
  });
});

describe('a recusa pelo erro do banco', () => {
  it('cada código e cada mensagem; o resto não é recusa', () => {
    expect(correctionRefusal(NO_FUNCTION, 'change_receipt_item_product')).toBe('notReady');
    expect(correctionRefusal({ code: '42883', message: 'function public.add_confirmed_receipt_item(uuid, jsonb) does not exist' }, 'add_confirmed_receipt_item')).toBe(
      'notReady',
    );
    expect(correctionRefusal(NK018, 'x')).toBe('itemChanged');
    expect(correctionRefusal(NK019, 'x')).toBe('notConfirmed');
    expect(correctionRefusal(gone('receipt not found'), 'x')).toBe('receiptGone');
    expect(correctionRefusal(gone('item not found'), 'x')).toBe('itemGone');
    expect(correctionRefusal(gone('product not found'), 'x')).toBe('productGone');
    expect(correctionRefusal(MERGED_FK, 'x')).toBe('productGone');
    expect(correctionRefusal(gone('outra coisa'), 'x')).toBeNull();
    expect(correctionRefusal(DEADLOCK, 'x')).toBeNull();
    expect(correctionRefusal({ message: 'caiu a rede' }, 'x')).toBeNull();
    expect(correctionRefusal(null, 'x')).toBeNull();
  });
});

describe('o banco tem as correções?', () => {
  it('true quando responde true; false sem a função; nada perguntado quando desligado', async () => {
    mockDb.reply = { data: true, error: null };
    const yes = await withHook(() => useReceiptCorrectionsAvailable(true));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(yes.value()).toBe(true);
    expect(mockDb.rpcs).toEqual([{ fn: 'receipt_corrections_available', args: undefined }]);
    await act(async () => renderer?.unmount());

    mockDb.rpcs = [];
    mockDb.reply = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.receipt_corrections_available' } };
    const no = await withHook(() => useReceiptCorrectionsAvailable(true));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(no.value()).toBe(false);
    expect(no.client.getQueryState(['receiptCorrectionsAvailable'])?.status).toBe('success');
    await act(async () => renderer?.unmount());

    mockDb.rpcs = [];
    const off = await withHook(() => useReceiptCorrectionsAvailable(false));
    expect(off.value()).toBe(false);
    expect(mockDb.rpcs).toEqual([]);
  });
});

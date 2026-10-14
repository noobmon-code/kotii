import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { goneProducts } from '@/domain/receiptReview';

import { fetchProducts, PRODUCT_MAX } from '../market';

// Os produtos da casa são lidos inteiros, página por página. Num pedido só, o servidor corta em max_rows sem dizer
// nada, e quem confere se um produto ainda existe (a nota em revisão) daria por juntado o que só ficou fora da
// página. Aqui o "servidor" corta como o de verdade, e o que se confere é que nenhum produto fica de fora.

type Row = { id: string; name: string; category: string; shelf_life_days: number | null };
interface Asked {
  table: string;
  /** O id depois do qual a página começa (`.gt('id', ...)`); null na primeira. */
  after: string | null;
  limit: number | null;
  order: string | null;
  /** Se o pedido veio com a contagem. */
  counted: boolean;
}

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockServer: {
  products: Row[];
  /** O teto de linhas por resposta (max_rows do PostgREST). */
  maxRows: number;
  asked: Asked[];
  /** O erro que o servidor responde, se algum. */
  fail: object | null;
  /** A partir de qual pedido (1 é o primeiro) a sessão está vencida: sem erro e sem linha nenhuma. */
  expiredFrom: number | null;
  /** Se o servidor conta as linhas (`count: 'exact'`). */
  counts: boolean;
  /** Roda depois de cada resposta, com o número do pedido: é onde outro aparelho mexe no catálogo. */
  afterAnswer: (request: number) => void;
} = { products: [], maxRows: 1000, asked: [], fail: null, expiredFrom: null, counts: true, afterAnswer: () => {} };

jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: {} }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('@/lib/session', () => ({ endSessionIfGone: async () => false }));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const asked: Asked = { table, after: null, limit: null, order: null, counted: false };
      const query = {
        select: (_columns: string, options?: { count?: string }) => {
          asked.counted = options?.count === 'exact';
          return query;
        },
        gt: (column: string, value: string) => {
          if (column === 'id') asked.after = value;
          return query;
        },
        order: (column: string) => {
          asked.order = column;
          return query;
        },
        limit: (rows: number) => {
          asked.limit = rows;
          return query;
        },
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve()
            .then(() => {
              mockServer.asked.push(asked);
              const request = mockServer.asked.length;
              if (mockServer.fail) return { data: null, count: null, error: mockServer.fail };
              const expired = mockServer.expiredFrom != null && request >= mockServer.expiredFrom;
              const left = expired
                ? []
                : mockServer.products.filter((row) => asked.after == null || row.id > asked.after).sort((a, b) => (a.id < b.id ? -1 : 1));
              const page = left.slice(0, Math.min(asked.limit ?? Infinity, mockServer.maxRows)).map((row) => ({ ...row }));
              mockServer.afterAnswer(request);
              return { data: page, count: asked.counted && mockServer.counts ? left.length : null, error: null };
            })
            .then(resolve, reject),
      };
      return query;
    },
  },
  unwrap: (result: { data: unknown; error: unknown }) => {
    if (result.error) throw result.error;
    return result.data;
  },
  errorMessage: (error: { message?: string }) => error?.message ?? 'Algo deu errado. Tente novamente.',
}));

const id = (n: number) => `p${String(n).padStart(6, '0')}`;
const product = (n: number, name = `Produto ${n}`): Row => ({ id: id(n), name, category: 'outros', shelf_life_days: null });
const catalog = (count: number) => Array.from({ length: count }, (_, index) => product(index + 1));
const afters = () => mockServer.asked.map((asked) => asked.after);

beforeEach(() => {
  mockServer.products = [];
  mockServer.maxRows = 1000;
  mockServer.asked = [];
  mockServer.fail = null;
  mockServer.expiredFrom = null;
  mockServer.counts = true;
  mockServer.afterAnswer = () => {};
});

describe('os produtos da casa, todos', () => {
  it('casa pequena: um pedido só, por id e com a contagem, e a lista sai na ordem do nome', async () => {
    mockServer.products = [product(1, 'Leite'), product(2, 'açúcar'), product(3, 'Arroz'), product(4, 'Abacaxi')];
    expect((await fetchProducts()).map((row) => row.name)).toEqual(['Abacaxi', 'açúcar', 'Arroz', 'Leite']);
    expect(mockServer.asked).toEqual([{ table: 'products', after: null, limit: 1000, order: 'id', counted: true }]);
  });

  it('casa sem produto nenhum: lista vazia, num pedido', async () => {
    expect(await fetchProducts()).toEqual([]);
    expect(mockServer.asked).toHaveLength(1);
  });

  it('mais de mil produtos: página por página, cada uma depois do último id lido, e nenhum fica de fora', async () => {
    mockServer.products = catalog(2500);
    const products = await fetchProducts();
    expect(afters()).toEqual([null, id(1000), id(2000)]);
    expect(products).toHaveLength(2500);
    expect(new Set(products.map((row) => row.id)).size).toBe(2500);
  });

  it('exatamente mil: a contagem diz que acabou, sem pedido a mais', async () => {
    mockServer.products = catalog(1000);
    expect(await fetchProducts()).toHaveLength(1000);
    expect(mockServer.asked).toHaveLength(1);
  });

  it('servidor que corta antes da página pedida: página curta não é o fim, o fim é a contagem', async () => {
    mockServer.products = catalog(1000);
    mockServer.maxRows = 400;
    expect(await fetchProducts()).toHaveLength(1000);
    expect(afters()).toEqual([null, id(400), id(800)]);
  });

  it('servidor que não conta: lê até a página vir vazia', async () => {
    mockServer.products = catalog(1500);
    mockServer.counts = false;
    expect(await fetchProducts()).toHaveLength(1500);
    expect(afters()).toEqual([null, id(1000), id(1500)]);
  });

  it('o item da nota ligado a um produto além dos primeiros mil não é dado como juntado', async () => {
    mockServer.products = catalog(1500);
    const item = { id: 'i1', raw_description: 'ARROZ T1 5KG', suggested_name: 'Arroz', suggested_category: 'graos', product_id: id(1500) };
    const all = new Map((await fetchProducts()).map((row) => [row.id, row]));
    expect(goneProducts([item], {}, all)).toEqual({ chosen: [], own: [] });
    // O que um pedido só devolvia: os primeiros mil. Com eles, o produto do item "sumiu", e confirmar a nota criaria
    // outro pelo nome dela.
    const firstPage = new Map(mockServer.products.slice(0, 1000).map((row) => [row.id, row]));
    expect(goneProducts([item], {}, firstPage)).toEqual({ chosen: [], own: [`i1:${id(1500)}`] });
  });

  it('produto juntado em outro aparelho no meio da leitura: a página seguinte se encaixa, sem repetir nem pular', async () => {
    mockServer.products = catalog(2000);
    // Depois da primeira página, um produto já lido e um ainda por ler somem (foram juntados com outros).
    mockServer.afterAnswer = (request) => {
      if (request === 1) mockServer.products = mockServer.products.filter((row) => row.id !== id(10) && row.id !== id(1500));
    };
    const products = await fetchProducts();
    expect(afters()).toEqual([null, id(1000)]);
    // O que já tinha sido lido fica (a próxima busca o tira); o que sumiu antes de ser lido não vem.
    expect(products).toHaveLength(1999);
    expect(products.some((row) => row.id === id(1500))).toBe(false);
    expect(new Set(products.map((row) => row.id)).size).toBe(1999);
  });

  it('página vazia depois de a contagem prometer mais (a sessão venceu no meio): falha, em vez de dar a parte lida como o catálogo', async () => {
    mockServer.products = catalog(1500);
    mockServer.expiredFrom = 2;
    await expect(fetchProducts()).rejects.toThrow('Não foi possível carregar todos os produtos da casa. Tente de novo.');
    expect(mockServer.asked).toHaveLength(2);
  });

  it('mais produtos do que o app lê de uma vez: falha logo, em vez de cortar', async () => {
    mockServer.products = catalog(PRODUCT_MAX + 1);
    await expect(fetchProducts()).rejects.toThrow('Não foi possível carregar os produtos da casa: são mais do que o app consegue ler de uma vez.');
    expect(mockServer.asked).toHaveLength(1);
  });

  it('exatamente o teto: lê tudo', async () => {
    mockServer.products = catalog(PRODUCT_MAX);
    expect(await fetchProducts()).toHaveLength(PRODUCT_MAX);
    expect(mockServer.asked).toHaveLength(PRODUCT_MAX / 1000);
  });

  it('erro do servidor: a busca falha com ele', async () => {
    mockServer.fail = { message: 'caiu a rede' };
    await expect(fetchProducts()).rejects.toBe(mockServer.fail);
  });
});

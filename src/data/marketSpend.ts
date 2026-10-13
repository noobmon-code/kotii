// Mercado do mês: as notas de um mês e do mês anterior, com o mercado e todos
// os itens. As contas ficam em domain/marketSpend.

import { useQuery } from '@tanstack/react-query';

import { shiftMonth } from '@/domain/finance';
import type { MarketLine, MarketReceipt } from '@/domain/marketSpend';
import { supabase, unwrap } from '@/lib/supabase';

/** Linhas por pedido. O servidor corta em 1000 (max_rows padrão do Supabase), ou em menos, se o projeto baixar o teto. */
const PAGE = 1000;
/** Notas de dois meses: 2 mil é bem além de qualquer casa. Passando disso a busca falha, em vez de mostrar um mês pela metade. */
const MAX_RECEIPTS = 2000;
/** Itens dessas notas, com o mesmo cuidado. */
const MAX_LINES = 20_000;
/** Notas por pedido de itens: os ids vão no endereço do pedido, que tem tamanho limitado. */
const IDS_PER_REQUEST = 100;

const TOO_MANY = 'Não foi possível carregar todas as notas deste mês: são mais do que o app consegue ler de uma vez.';
const INCOMPLETE = 'As notas deste mês não chegaram inteiras. Tente de novo.';

type PageResult = { data: unknown; error: unknown; count: number | null };

/**
 * Uma consulta inteira, página por página. O servidor diz quantas linhas ela
 * tem (`count`) e a leitura só termina com todas na mão: página curta não é
 * prova de fim, porque o teto do servidor pode ser menor que a página pedida.
 * Mais linhas do que cabem (`room`): falha, nunca uma lista cortada.
 */
async function readAll<T>(page: (from: number, to: number) => PromiseLike<PageResult>, room: number): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const result = await page(rows.length, rows.length + PAGE - 1);
    const got = (unwrap(result) ?? []) as T[];
    rows.push(...got);
    if (Math.max(rows.length, result.count ?? 0) > room) throw new Error(TOO_MANY);
    // Sem a contagem (o servidor sempre manda), só uma página vazia diz que acabou.
    if (result.count == null ? got.length === 0 : rows.length >= result.count) return rows;
    // O servidor diz que há mais e não manda: melhor falhar do que seguir com o que veio.
    if (got.length === 0) throw new Error(INCOMPLETE);
  }
}

type ReceiptRow = {
  id: string;
  purchased_at: string;
  total: number | null;
  status: 'draft' | 'confirmed';
  store_id: string | null;
  store: { name: string } | null;
};

type LineRow = {
  receipt_id: string;
  raw_description: string;
  suggested_name: string | null;
  suggested_category: string | null;
  product_id: string | null;
  quantity: number;
  unit: string;
  total_price: number | null;
  product: { name: string; category: string } | null;
};

const RECEIPT_COLUMNS = 'id, purchased_at, total, status, store_id, store:stores(name)';
const LINE_COLUMNS =
  'receipt_id, raw_description, suggested_name, suggested_category, product_id, quantity, unit, total_price, product:products(name, category)';

/**
 * As notas compradas de `fromMonth` a `toMonth` ("AAAA-MM", inclusive), com
 * os itens das confirmadas. Os limites são os do resumo de gastos: a data da
 * compra no fuso do aparelho. Os rascunhos vêm sem itens (a tela só diz
 * quantos esperam a revisão).
 *
 * Os itens são lidos à parte, pelas notas, e não embutidos em cada nota: o
 * teto de linhas do servidor (max-rows do PostgREST) vale também para as
 * linhas embutidas, e uma nota comprida viria cortada, calada.
 */
export async function fetchMarketReceipts(fromMonth: string, toMonth: string): Promise<MarketReceipt[]> {
  const [sy, sm] = fromMonth.split('-').map(Number);
  const [ey, em] = toMonth.split('-').map(Number);
  const startAt = new Date(sy, sm - 1, 1).toISOString();
  const endAt = new Date(ey, em, 1).toISOString();

  // A ordem (data e, no empate, o id) é o que faz as páginas se encaixarem.
  const receipts = await readAll<ReceiptRow>(
    (from, to) =>
      supabase
        .from('receipts')
        .select(RECEIPT_COLUMNS, { count: 'exact' })
        .gte('purchased_at', startAt)
        .lt('purchased_at', endAt)
        .order('purchased_at')
        .order('id')
        .range(from, to),
    MAX_RECEIPTS,
  );

  const confirmed = receipts.filter((r) => r.status === 'confirmed').map((r) => r.id);
  const lines = new Map<string, MarketLine[]>();
  let read = 0;
  for (let start = 0; start < confirmed.length; start += IDS_PER_REQUEST) {
    const ids = confirmed.slice(start, start + IDS_PER_REQUEST);
    const rows = await readAll<LineRow>(
      (from, to) =>
        supabase
          .from('receipt_items')
          .select(LINE_COLUMNS, { count: 'exact' })
          .in('receipt_id', ids)
          .order('receipt_id')
          .order('position')
          .order('id')
          .range(from, to),
      MAX_LINES - read,
    );
    read += rows.length;
    for (const row of rows) {
      const line: MarketLine = {
        productId: row.product_id,
        productName: row.product?.name ?? null,
        productCategory: row.product?.category ?? null,
        rawDescription: row.raw_description,
        suggestedName: row.suggested_name,
        suggestedCategory: row.suggested_category,
        quantity: Number(row.quantity),
        unit: row.unit,
        totalPrice: row.total_price == null ? null : Number(row.total_price),
      };
      const ofReceipt = lines.get(row.receipt_id);
      if (ofReceipt) ofReceipt.push(line);
      else lines.set(row.receipt_id, [line]);
    }
  }

  return receipts.map((r) => ({
    id: r.id,
    purchasedAt: r.purchased_at,
    status: r.status,
    total: r.total == null ? null : Number(r.total),
    storeId: r.store_id,
    storeName: r.store?.name ?? null,
    lines: lines.get(r.id) ?? [],
  }));
}

/**
 * As notas de `month` e do mês anterior (a comparação precisa dele). A chave
 * começa com 'spending': confirmar, mudar ou excluir uma nota, e mudar o nome
 * ou a categoria de um produto, já recarregam. Como o resumo de gastos, não
 * fica guardada no aparelho.
 */
export function useMarketReceipts(month: string) {
  return useQuery({
    queryKey: ['spending', 'market', month],
    queryFn: () => fetchMarketReceipts(shiftMonth(month, -1), month),
  });
}

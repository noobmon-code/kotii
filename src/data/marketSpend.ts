// Mercado do mês: as notas do mês e dos meses antes dele (o anterior para a
// comparação, e os da tendência), com o mercado e todos os itens. As contas
// ficam em domain/marketSpend.

import { useQuery } from '@tanstack/react-query';

import { shiftMonth } from '@/domain/finance';
import { MARKET_TREND_MONTHS, type MarketLine, type MarketReceipt } from '@/domain/marketSpend';
import { supabase } from '@/lib/supabase';

import { readAll } from './readAll';

/** Linhas por pedido. O servidor corta em 1000 (max_rows padrão do Supabase), ou em menos, se o projeto baixar o teto. */
const PAGE = 1000;
/** Notas de seis meses: mil por mês é bem além de qualquer casa. Passando disso a busca falha, em vez de mostrar um mês pela metade. */
const MAX_RECEIPTS = 6000;
/** Itens dessas notas, com o mesmo cuidado. */
const MAX_LINES = 60_000;
/** Notas por pedido de itens: os ids vão no endereço do pedido, que tem tamanho limitado. */
const IDS_PER_REQUEST = 100;

const TOO_MANY = 'Não foi possível carregar todas as notas destes meses: são mais do que o app consegue ler de uma vez.';
const INCOMPLETE = 'As notas destes meses não chegaram inteiras. Tente de novo.';
const MESSAGES = { tooMany: TOO_MANY, incomplete: INCOMPLETE };

type ReceiptRow = {
  id: string;
  purchased_at: string;
  total: number | null;
  status: 'draft' | 'confirmed';
  store_id: string | null;
  store: { name: string; address: string | null; cnpj: string | null } | null;
};

type LineRow = {
  id: string;
  receipt_id: string;
  position: number;
  raw_description: string;
  suggested_name: string | null;
  suggested_category: string | null;
  product_id: string | null;
  quantity: number;
  unit: string;
  total_price: number | null;
  product: { name: string; category: string } | null;
};

const RECEIPT_COLUMNS = 'id, purchased_at, total, status, store_id, store:stores(name, address, cnpj)';
const LINE_COLUMNS =
  'id, receipt_id, position, raw_description, suggested_name, suggested_category, product_id, quantity, unit, total_price, product:products(name, category)';

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * As notas compradas de `fromMonth` a `toMonth` ("AAAA-MM", inclusive), com
 * os itens das confirmadas. Os limites são os do resumo de gastos: a data da
 * compra no fuso do aparelho. Os rascunhos vêm sem itens (a tela só os lista
 * para revisar).
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

  const receipts = await readAll<ReceiptRow>((after) => {
    const query = supabase.from('receipts').select(RECEIPT_COLUMNS, { count: 'exact' }).gte('purchased_at', startAt).lt('purchased_at', endAt);
    return (after ? query.gt('id', after) : query).order('id').limit(PAGE);
  }, MAX_RECEIPTS, MESSAGES);
  // As páginas vêm pelo id; a ordem que se entrega é a da compra (e, no empate, o id).
  receipts.sort((a, b) => Date.parse(a.purchased_at) - Date.parse(b.purchased_at) || byId(a, b));

  const confirmed = receipts.filter((r) => r.status === 'confirmed').map((r) => r.id);
  const lines = new Map<string, LineRow[]>();
  let read = 0;
  for (let start = 0; start < confirmed.length; start += IDS_PER_REQUEST) {
    const ids = confirmed.slice(start, start + IDS_PER_REQUEST);
    const rows = await readAll<LineRow>((after) => {
      const query = supabase.from('receipt_items').select(LINE_COLUMNS, { count: 'exact' }).in('receipt_id', ids);
      return (after ? query.gt('id', after) : query).order('id').limit(PAGE);
    }, MAX_LINES - read, MESSAGES);
    read += rows.length;
    for (const row of rows) {
      const ofReceipt = lines.get(row.receipt_id);
      if (ofReceipt) ofReceipt.push(row);
      else lines.set(row.receipt_id, [row]);
    }
  }

  // Os itens de cada nota na ordem da nota: o nome do item sem produto é o da primeira linha em que ele aparece.
  const linesOf = (receiptId: string): MarketLine[] =>
    (lines.get(receiptId) ?? [])
      .sort((a, b) => a.position - b.position || byId(a, b))
      .map((row) => ({
        productId: row.product_id,
        productName: row.product?.name ?? null,
        productCategory: row.product?.category ?? null,
        rawDescription: row.raw_description,
        suggestedName: row.suggested_name,
        suggestedCategory: row.suggested_category,
        quantity: Number(row.quantity),
        unit: row.unit,
        totalPrice: row.total_price == null ? null : Number(row.total_price),
      }));

  return receipts.map((r) => ({
    id: r.id,
    purchasedAt: r.purchased_at,
    status: r.status,
    total: r.total == null ? null : Number(r.total),
    storeId: r.store_id,
    storeName: r.store?.name ?? null,
    // O endereço (ou o CNPJ) separa dois mercados de mesmo nome na tela.
    storeAddress: r.store?.address ?? null,
    storeCnpj: r.store?.cnpj ?? null,
    lines: linesOf(r.id),
  }));
}

/**
 * As notas de `month` e dos cinco meses antes dele: o anterior para a
 * comparação, e todos para o cartão de tendência. Uma leitura só: o total do
 * cabeçalho e a barra do mês na tendência saem das mesmas notas. A chave
 * começa com 'spending': confirmar, mudar ou excluir uma nota, e mudar o nome
 * ou a categoria de um produto, já recarregam. Como o resumo de gastos, não
 * fica guardada no aparelho. É a busca da tela "Mercado do mês", e só dela: a
 * entrada no resumo faz a conta com as notas que o resumo já leu
 * (useSpendingReceipts).
 */
export function useMarketReceipts(month: string) {
  return useQuery({
    queryKey: ['spending', 'market', month],
    queryFn: () => fetchMarketReceipts(shiftMonth(month, -(MARKET_TREND_MONTHS - 1)), month),
  });
}

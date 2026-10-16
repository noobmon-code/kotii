// Preços vistos em outras casas ("Visto em outras casas"). O banco entrega,
// para cada produto da casa, o preço mais recente de cada mercado (pelo CNPJ)
// e unidade, tirado de uma nota lida por alguma casa, sem dizer qual
// (shared_latest_prices): os dos mercados da própria casa e, dos outros, os
// mais baratos do estado onde ela compra. Aqui fica o que vale mostrar, em que
// ordem, e as frases. Nada disso entra em conta nenhuma: a estimativa da lista
// e o "Onde comprar" continuam só com os preços da própria casa.

import { formatShortDate } from './dates';
import { formatBRL } from './money';
import { summarizePrices } from './prices';
import { pricePerBase } from './units';

/**
 * As categorias cujos preços entram na base comum: comida, bebida, limpeza,
 * papel, bebê e pet. É a mesma lista do gatilho no banco (`v_shared` na
 * migração shared_prices; um teste falha se as duas divergirem). Ficam de fora
 * a saúde, a higiene pessoal (mistura xampu com item íntimo) e "outros", que é
 * onde cai, na nota do QR code, o remédio que o app não reconheceu.
 */
export const SHARED_CATEGORIES: readonly string[] = [
  'hortifruti',
  'carnes',
  'peixes',
  'laticinios',
  'ovos',
  'padaria',
  'graos',
  'congelados',
  'frios',
  'doces',
  'snacks',
  'temperos',
  'oleos',
  'bebidas',
  'alcoolicas',
  'cafe_cha',
  'limpeza',
  'papel',
  'bebe',
  'pet',
];

/** Uma linha de shared_latest_prices. */
export interface SharedPrice {
  product_id: string;
  store_cnpj: string;
  /** O nome do mercado como impresso na nota de alguma casa. */
  store_name: string;
  /** O estado do mercado: código do IBGE (os dois primeiros dígitos da chave de acesso); null quando a nota não tinha chave. */
  store_uf: string | null;
  unit: string;
  unit_price: number;
  /** O dia da compra em São Paulo (AAAA-MM-DD). */
  seen_on: string;
  /** O mercado é um dos mercados da própria casa (pelo CNPJ). */
  mine: boolean;
}

/** Um preço da própria casa (latest_prices). */
export interface OwnPrice {
  product_id: string;
  store_id: string;
  unit: string;
  unit_price: number;
  purchased_at: string;
}

/** Um mercado da casa: o CNPJ, e o nome pelo qual a casa o conhece. */
export interface StoreCnpj {
  id: string;
  cnpj: string | null;
  name: string;
}

/** Um preço de outra casa pronto para mostrar: por kg, por litro ou por unidade. */
export interface SharedPriceRow {
  storeCnpj: string;
  /** No mercado da própria casa, o nome que a casa deu a ele; nos outros, o da nota. */
  storeName: string;
  /** A sigla do estado ("SP"), só dos outros mercados e só quando se sabe. */
  state: string | null;
  /** O mercado é um dos mercados da própria casa. */
  mine: boolean;
  unit: string;
  unitPrice: number;
  seenOn: string;
}

/** Quantas linhas cada lista da tela do produto mostra antes do "Ver mais", e quantas a mais a cada toque. */
export const SHARED_ROWS_SHOWN = 5;
export const SHARED_ROWS_STEP = 20;

export const SHARED_PRICES_TITLE = 'Visto em outras casas';
export const SHARED_PRICES_MINE = 'Nos seus mercados';
export const SHARED_PRICES_OTHERS = 'Em outros mercados';
/** Sempre junto dos preços de outras casas. */
export const SHARED_PRICES_NOTICE =
  'Preços de notas de outras casas que usam o Kotii, sem dizer de quem. Não são em tempo real: cada preço vale para o dia em que foi visto.';
export const SHARED_PRICES_MORE = 'Ver mais';
/** O que o leitor de tela diz em cada "Ver mais": as duas listas ficam na mesma tela, cada uma com o seu. */
export const SHARED_PRICES_MORE_LABEL = {
  mine: 'Ver mais preços nos seus mercados',
  others: 'Ver mais preços em outros mercados',
};

/** O que a casa lê, na aba Família, sobre o que ela mesma compartilha. */
export const SHARING_TITLE = 'Preços compartilhados';
export const SHARING_ABOUT =
  'Os preços das notas lidas pelo app (mercado, item, preço e dia) entram numa base comum, sem dizer de qual casa são, para que outras casas vejam quanto cada coisa custa nos mercados. Ficam de fora as notas digitadas à mão, remédios e compras em farmácia, itens de higiene pessoal e o que o app não reconheceu. Cada preço aparece para as outras casas a partir do dia seguinte.';

/** Código do IBGE de cada estado (os dois primeiros dígitos da chave de acesso da nota) -> sigla. */
const STATE_BY_CODE: Record<string, string> = {
  '11': 'RO',
  '12': 'AC',
  '13': 'AM',
  '14': 'RR',
  '15': 'PA',
  '16': 'AP',
  '17': 'TO',
  '21': 'MA',
  '22': 'PI',
  '23': 'CE',
  '24': 'RN',
  '25': 'PB',
  '26': 'PE',
  '27': 'AL',
  '28': 'SE',
  '29': 'BA',
  '31': 'MG',
  '32': 'ES',
  '33': 'RJ',
  '35': 'SP',
  '41': 'PR',
  '42': 'SC',
  '43': 'RS',
  '50': 'MS',
  '51': 'MT',
  '52': 'GO',
  '53': 'DF',
};

/** "SP" para o código 35; null para código que não é de estado nenhum, ou sem código. */
export function stateAbbreviation(code: string | null | undefined): string | null {
  return (code && STATE_BY_CODE[code]) || null;
}

/** São Paulo está 3 h atrás do UTC o ano todo (sem horário de verão desde 2019). */
const SAO_PAULO_OFFSET_MS = 3 * 60 * 60 * 1000;

/**
 * O dia em São Paulo de um instante: o mesmo dia que o banco grava em
 * `seen_on` para a nota da própria casa, onde quer que o celular esteja.
 * Vazio se o texto não for uma data.
 */
export function saoPauloDay(iso: string): string {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? '' : new Date(at - SAO_PAULO_OFFSET_MS).toISOString().slice(0, 10);
}

const SEPARATOR = '\u0000';

/**
 * Os preços de outras casas que dizem algo novo. Some o que a casa já sabe:
 * quando ela tem preço próprio do mesmo produto num mercado com o mesmo CNPJ,
 * no mesmo dia ou depois, a linha é a compra dela mesma ou notícia mais velha
 * que a dela. Mercado se reconhece só pelo CNPJ: o da casa que não tem CNPJ
 * (criado à mão) nunca esconde nada. O banco já aplica esta regra na própria
 * leitura; aqui ela fica como segunda camada, para o que a casa comprou
 * depois que a resposta chegou.
 */
export function visibleSharedPrices(
  shared: readonly SharedPrice[],
  own: readonly OwnPrice[],
  stores: readonly Pick<StoreCnpj, 'id' | 'cnpj'>[],
): SharedPrice[] {
  const cnpjOf = new Map(stores.map((store) => [store.id, store.cnpj]));
  /** O dia da compra mais recente da casa, por produto e CNPJ. */
  const ownDay = new Map<string, string>();
  for (const price of own) {
    // Zero não é preço (a compra "sem valor"): a casa não sabe quanto pagou ali, e a notícia de fora continua valendo.
    if (!(price.unit_price > 0)) continue;
    const cnpj = cnpjOf.get(price.store_id);
    const day = saoPauloDay(price.purchased_at);
    if (!cnpj || !day) continue;
    const key = price.product_id + SEPARATOR + cnpj;
    if ((ownDay.get(key) ?? '') < day) ownDay.set(key, day);
  }
  return shared.filter(
    (price) => price.unit_price > 0 && (ownDay.get(price.product_id + SEPARATOR + price.store_cnpj) ?? '') < price.seen_on,
  );
}

const UNIT_ORDER = ['un', 'kg', 'l'];
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Os preços de outras casas de UM produto, prontos para a tela. Unidades não
 * se misturam: por g vira por kg e por ml vira por litro (pricePerBase), e
 * cada mercado fica com uma linha por unidade, a mais recente. Na frente vêm
 * as da unidade principal do produto (a mesma escolha do resumo de preços:
 * a que tem mais mercados entre os preços da casa; sem preço da casa, entre
 * estes), do mais barato para o mais caro; no empate, o visto por último.
 * O mercado que é da própria casa aparece com o nome que ela conhece (o de
 * `stores`); os outros, com o nome da nota e a sigla do estado.
 */
export function sharedPriceRows(
  shared: readonly SharedPrice[],
  own: readonly Pick<OwnPrice, 'store_id' | 'unit' | 'unit_price'>[],
  stores: readonly Pick<StoreCnpj, 'cnpj' | 'name'>[] = [],
): SharedPriceRow[] {
  const ownName = new Map(stores.map((store) => [store.cnpj, store.name]));
  const latest = new Map<string, SharedPriceRow>();
  for (const price of shared) {
    const base = pricePerBase(price.unit_price, price.unit);
    const mine = price.mine === true;
    // De volta às 4 casas do banco: 0,0049 x 1000 dá 4,8999999999999995.
    const row: SharedPriceRow = {
      storeCnpj: price.store_cnpj,
      storeName: (mine && ownName.get(price.store_cnpj)) || price.store_name,
      state: mine ? null : stateAbbreviation(price.store_uf),
      mine,
      unit: base.unit,
      unitPrice: round4(base.unitPrice),
      seenOn: price.seen_on,
    };
    const key = row.storeCnpj + SEPARATOR + row.unit;
    const seen = latest.get(key);
    if (!seen || row.seenOn > seen.seenOn || (row.seenOn === seen.seenOn && row.unitPrice < seen.unitPrice)) latest.set(key, row);
  }
  const rows = [...latest.values()];
  const inBase = own.map((price) => ({ store_id: price.store_id, ...toBase(price) }));
  const main = (summarizePrices(inBase) ?? summarizePrices(rows.map((row) => ({ store_id: row.storeCnpj, unit: row.unit, unit_price: row.unitPrice }))))?.unit;
  const rank = (unit: string) => (unit === main ? -1 : UNIT_ORDER.includes(unit) ? UNIT_ORDER.indexOf(unit) : UNIT_ORDER.length);
  return rows.sort(
    (a, b) =>
      rank(a.unit) - rank(b.unit) ||
      a.unit.localeCompare(b.unit) ||
      a.unitPrice - b.unitPrice ||
      b.seenOn.localeCompare(a.seenOn) ||
      a.storeName.localeCompare(b.storeName, 'pt-BR') ||
      a.storeCnpj.localeCompare(b.storeCnpj),
  );
}

function toBase(price: { unit: string; unit_price: number }): { unit: string; unit_price: number } {
  const base = pricePerBase(price.unit_price, price.unit);
  return { unit: base.unit, unit_price: round4(base.unitPrice) };
}

/**
 * Por produto, as linhas de outras casas que valem mostrar, na ordem de
 * mostrar: o que a casa já sabe fica de fora (visibleSharedPrices). Produto
 * sem linha nenhuma não entra.
 */
export function sharedRowsByProduct(
  shared: readonly SharedPrice[],
  own: readonly OwnPrice[],
  stores: readonly StoreCnpj[],
): Map<string, SharedPriceRow[]> {
  const group = <T extends { product_id: string }>(prices: readonly T[]) => {
    const byProduct = new Map<string, T[]>();
    for (const price of prices) byProduct.set(price.product_id, [...(byProduct.get(price.product_id) ?? []), price]);
    return byProduct;
  };
  const ownByProduct = group(own);
  const rows = new Map<string, SharedPriceRow[]>();
  for (const [productId, prices] of group(visibleSharedPrices(shared, own, stores))) {
    rows.set(productId, sharedPriceRows(prices, ownByProduct.get(productId) ?? [], stores));
  }
  return rows;
}

/**
 * O preço de outra casa que é menor que o menor da própria casa, na mesma
 * unidade de comparação (a de `unit`: kg para g e kg, litro para ml e l);
 * null quando não há. "Menor" é o que a tela escreve: se os dois saem com os
 * mesmos centavos, não é mais barato. Havendo um mais barato num mercado da
 * própria casa, é ele (é onde a casa já compra); senão, o mais barato dos
 * outros. `own` são os preços da casa para o produto; `rows`, os de outras.
 */
export function cheaperSharedPrice(
  own: readonly { unit: string; unit_price: number }[],
  rows: readonly SharedPriceRow[],
  unit: string,
): SharedPriceRow | null {
  const base = pricePerBase(1, unit).unit;
  const mine = own.map(toBase).filter((price) => price.unit === base);
  if (!mine.length) return null;
  const lowest = Math.min(...mine.map((price) => price.unit_price));
  const printed = formatBRL(lowest);
  const cheaper = rows.filter((row) => row.unit === base && row.unitPrice < lowest && formatBRL(row.unitPrice) !== printed);
  const inMyStores = cheaper.filter((row) => row.mine);
  const candidates = inMyStores.length ? inMyStores : cheaper;
  if (!candidates.length) return null;
  // Empate de preço: o visto por último.
  return candidates.reduce((a, b) => (b.unitPrice < a.unitPrice || (b.unitPrice === a.unitPrice && b.seenOn > a.seenOn) ? b : a));
}

/** "R$ 22,90/un": o preço sempre com a unidade, também por unidade. */
export function sharedPriceLabel(row: Pick<SharedPriceRow, 'unit' | 'unitPrice'>): string {
  return `${formatBRL(row.unitPrice)}/${row.unit}`;
}

/** O mercado como a linha o mostra: "SENDAS DISTRIBUIDORA S/A (RJ)"; sem estado conhecido (ou no mercado da casa), só o nome. */
export function sharedStoreLabel(row: Pick<SharedPriceRow, 'storeName' | 'state'>): string {
  return row.state ? `${row.storeName} (${row.state})` : row.storeName;
}

/** "visto em 10 out", com o ano quando não é o de agora. */
export function seenLabel(row: Pick<SharedPriceRow, 'seenOn'>, referenceYear?: number): string {
  return `visto em ${formatShortDate(row.seenOn, referenceYear)}`;
}

/**
 * A linha de um preço de outra casa: "R$ 22,90/un · Atacadão Mooca · visto em
 * 10 out". O nome do mercado vai como veio, sem artigo na frente.
 */
export function describeSharedPrice(row: SharedPriceRow, referenceYear?: number): string {
  return `${sharedPriceLabel(row)} · ${sharedStoreLabel(row)} · ${seenLabel(row, referenceYear)}`;
}

/** A linha em Preços, embaixo do produto: "Visto por R$ 21,90/un · Atacadão Mooca · 10 out, em outra casa". */
export function cheaperSharedHint(row: SharedPriceRow, referenceYear?: number): string {
  return `Visto por ${sharedPriceLabel(row)} · ${sharedStoreLabel(row)} · ${formatShortDate(row.seenOn, referenceYear)}, em outra casa`;
}

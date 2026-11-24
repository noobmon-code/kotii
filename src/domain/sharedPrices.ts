// Preços vistos em outras casas ("Visto em outras casas"). O banco entrega,
// para cada produto da casa, o preço mais recente de cada mercado (pelo CNPJ)
// e unidade, tirado de uma nota lida por alguma casa, sem dizer qual
// (shared_latest_prices): os dos mercados da própria casa e, dos outros, os
// mais baratos do estado onde ela compra. Aqui fica o que vale mostrar, em que
// ordem, e as frases. Na estimativa da lista e no "Onde comprar" eles só
// cobrem onde a casa não tem preço próprio (sharedQuotes aqui, e a regra em
// listEstimate): o preço da casa sempre vence, e eles não entram no nível de
// preço dos mercados.
// Embalagens: a linha por unidade traz o tamanho que o servidor leu na nota do
// QR code (pack_*, só quando a leitura não tinha dúvida). Na tela do produto e
// em Preços, o preço de fora se compara com o da casa na unidade em que a casa
// vê os seus (compareSharedPrices): por kg, litro ou item do pacote quando a
// casa compara por tamanho; por unidade (unitPricePool), o de fora que diz o
// tamanho só com os preços da casa do mesmo tamanho e, só quando a casa não tem
// esse tamanho, com os dela que não dizem tamanho (um preço da casa sem tamanho
// fica fora da comparação quando ela tem um do mesmo tamanho), o de fora sem
// tamanho com todos os da casa, e dois tamanhos conhecidos e diferentes nunca;
// e nunca a mais de 2,5 vezes de distância (SHARED_PRICE_BAND), que quase
// sempre é outra embalagem (o fardo ou a lata avulsa sob a mesma descrição). A
// lista e o "Onde comprar" usam a mesma regra para o preço por unidade
// (fitsHouseholdPack).
// A semana: desde a lista aberta (20261122150000_shared_prices_open.sql),
// nenhuma leitura devolve o dia da compra, só a segunda-feira da semana dela
// (seen_on), e dentro de uma semana nada é escolhido pelo dia. O app mostra
// "visto na semana de 9 nov" e, para um banco de antes (que ainda devolve
// dias), passa o dia para a segunda-feira (sharedWeekStart).

import { addDays, formatShortDate, isValidISODate } from './dates';
import { formatBRL } from './money';
import { eachPriceLabel, packSizeText } from './packCount';
import { packageLabel, samePackageSize, sharedPackageSize, type PackageSize } from './packageSize';
import { summarizePrices } from './prices';
import { answeredPack, PACK_ITEM, roundPrice, toPurchases } from './priceHistory';
import { savedLine, storePriceGroups, storePricesFromPurchases } from './storePrices';
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
  /** A segunda-feira da semana da compra (AAAA-MM-DD, semana de São Paulo); o banco nunca devolve o dia. */
  seen_on: string;
  /** O mercado é um dos mercados da própria casa (pelo CNPJ). */
  mine: boolean;
  /**
   * O tamanho da embalagem que o servidor leu na nota do QR code (só em "un"): kg, l ou un, quanto vem na embalagem
   * toda (pack_amount, nessa unidade) e, em kg e l, quantas embalagens iguais (pack_of, "12 x 350 ml"). Ausentes no
   * banco de antes da coluna, ou null: não se sabe.
   */
  pack_unit?: string | null;
  pack_amount?: number | null;
  pack_of?: number | null;
}

/** Um preço da própria casa (latest_prices). */
export interface OwnPrice {
  product_id: string;
  store_id: string;
  unit: string;
  unit_price: number;
  purchased_at: string;
  /** Quantos vinham (a resposta da revisão) e a descrição da nota: o tamanho da embalagem. Ausentes no banco de antes. */
  pack_count?: number | null;
  raw_description?: string | null;
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
  /** A segunda-feira da semana em que foi visto (AAAA-MM-DD): nunca o dia. */
  seenWeek: string;
  /**
   * O tamanho da embalagem do preço por unidade, quando se sabe: o que o servidor leu na nota (sharedPack) ou, na
   * base aberta, o que o app escolheu para o item (domain/openPrices). null quando não se sabe.
   */
  pack: PackageSize | null;
}

/** Quantas linhas cada lista da tela do produto mostra antes do "Ver mais", e quantas a mais a cada toque. */
export const SHARED_ROWS_SHOWN = 5;
export const SHARED_ROWS_STEP = 20;

export const SHARED_PRICES_TITLE = 'Visto em outras casas';
export const SHARED_PRICES_MINE = 'Nos seus mercados';
export const SHARED_PRICES_OTHERS = 'Em outros mercados';
/** Sempre junto dos preços de outras casas. */
export const SHARED_PRICES_NOTICE =
  'Preços de notas de outras casas que usam o Kotii, sem dizer de quem. Não são em tempo real: cada preço vale para a semana em que foi visto.';
export const SHARED_PRICES_MORE = 'Ver mais';
/** O que o leitor de tela diz em cada "Ver mais": as duas listas ficam na mesma tela, cada uma com o seu. */
export const SHARED_PRICES_MORE_LABEL = {
  mine: 'Ver mais preços de outras casas nos seus mercados',
  others: 'Ver mais preços de outras casas em outros mercados',
};

/** O que a casa lê, em Configurações, sobre o que ela mesma compartilha: a linha (fechada) e o texto (aberta). */
export const SHARING_TITLE = 'Preços compartilhados';
export const SHARING_SUMMARY = 'Os preços das notas vão para uma base aberta a todas as casas, sem dizer de qual casa';
export const SHARING_ABOUT =
  'Os preços das notas lidas pelo app (mercado, item, código de barras, tamanho da embalagem, preço e dia da compra) entram numa base aberta a todas as casas do Kotii, sem dizer de qual casa são: qualquer casa vê quanto cada coisa custa nos mercados do estado onde compra (o das notas lidas ou o do local da casa, em Clima da casa), também o que ela nunca comprou. Ninguém vê o dia da compra: cada preço aparece com a semana, a partir da segunda-feira depois da semana em que a nota foi confirmada. Ficam de fora as notas digitadas à mão, remédios e compras em farmácia, suplementos, primeiros socorros, itens de higiene pessoal e o que o app não reconheceu; o que você corrige na revisão também fica na casa.';

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

const CODE_BY_STATE = new Map(Object.entries(STATE_BY_CODE).map(([code, abbreviation]) => [abbreviation, code]));

/**
 * O código do IBGE de um estado, para guardar com o local da casa (household_location.state_code): a sigla do
 * ViaCEP e da BrasilAPI ("SP") ou o código ISO do OpenStreetMap ("BR-SP"), em qualquer caixa. null para o resto,
 * também o código de outro país ("US-AL" não é Alagoas).
 */
export function stateCode(value: string | null | undefined): string | null {
  const text = (value ?? '').trim().toUpperCase();
  const abbreviation = /^[A-Z]{2}$/.test(text) ? text : /^BR-[A-Z]{2}$/.test(text) ? text.slice(3) : null;
  return (abbreviation && CODE_BY_STATE.get(abbreviation)) || null;
}

/**
 * A segunda-feira da semana de uma data (AAAA-MM-DD), pela conta nas datas (a semana de segunda a domingo, como
 * shared_week no banco). Um texto que não é data volta como veio.
 */
export function sharedWeekStart(iso: string): string {
  if (!isValidISODate(iso)) return iso;
  const weekday = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return addDays(iso, -((weekday + 6) % 7));
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
    const row = sharedRowOf(price, ownName.get(price.store_cnpj));
    const key = row.storeCnpj + SEPARATOR + row.unit;
    const seen = latest.get(key);
    if (!seen || newerSharedRow(row, seen)) latest.set(key, row);
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
      b.seenWeek.localeCompare(a.seenWeek) ||
      a.storeName.localeCompare(b.storeName, 'pt-BR') ||
      a.storeCnpj.localeCompare(b.storeCnpj),
  );
}

/**
 * Uma linha de outra casa pronta para a tela e para a lista: por g vira por kg e por ml por litro (pricePerBase, de
 * volta às 4 casas do banco: 0,0049 x 1000 dá 4,8999999999999995), o mercado da casa com o nome que ela conhece
 * (`ownName`), os outros com o nome da nota e a sigla do estado, a semana e o tamanho que o servidor leu (sharedPack).
 * A mesma para o caminho do produto (sharedPriceRows) e para a base aberta (domain/openPrices).
 */
export function sharedRowOf(price: SharedPrice | Omit<SharedPrice, 'product_id'>, ownName?: string | null): SharedPriceRow {
  const base = pricePerBase(price.unit_price, price.unit);
  const mine = price.mine === true;
  return {
    storeCnpj: price.store_cnpj,
    storeName: (mine && ownName) || price.store_name,
    state: mine ? null : stateAbbreviation(price.store_uf),
    mine,
    unit: base.unit,
    unitPrice: round4(base.unitPrice),
    seenWeek: sharedWeekStart(price.seen_on),
    pack: base.unit === 'un' ? sharedPack(price) : null,
  };
}

/**
 * Entre duas linhas do mesmo mercado e unidade, a que fica: a da semana mais nova; na mesma semana, a mais barata
 * (o dia nunca escolhe, como no banco).
 */
export function newerSharedRow(a: Pick<SharedPriceRow, 'seenWeek' | 'unitPrice'>, b: Pick<SharedPriceRow, 'seenWeek' | 'unitPrice'>): boolean {
  return a.seenWeek > b.seenWeek || (a.seenWeek === b.seenWeek && a.unitPrice < b.unitPrice);
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

// ---------------------------------------------------------------------------
// O tamanho da embalagem: o preço de fora comparado com o da casa

/**
 * A distância máxima entre o preço de fora e o da casa para os dois se compararem (inclusive): a mesma de
 * PRICE_JUMP_LIMIT (domain/marketChange). Além dela, a diferença quase sempre é outra embalagem (o fardo de 12 ou a
 * lata avulsa sob a mesma descrição, um tamanho mal lido), e nunca se diz "mais barato".
 */
export const SHARED_PRICE_BAND = 2.5;
/** A linha por unidade sem tamanho, ao lado de preços que dizem um. */
export const SIZE_UNKNOWN = 'tamanho não informado';

/** O tamanho como a linha de outra casa o mostra. */
export interface ShownSize {
  /** O tamanho que o servidor leu na nota (sharedPack); null quando não se sabe. */
  pack: PackageSize | null;
  /** Na linha convertida para o preço por kg, litro ou item, o preço da embalagem; senão, null. */
  packagePrice: number | null;
  /** A linha por unidade não diz o tamanho, e outro preço na tela diz: "tamanho não informado". */
  sizeUnknown: boolean;
}

/** Um preço de outra casa comparado com os da casa, pronto para a tela do produto e para Preços. */
export interface ShownSharedPrice extends SharedPriceRow, ShownSize {
  /** un, kg, l ou PACK_ITEM; `unitPrice` em reais com centavos (roundPrice, como StorePrice). */
  unit: string;
  /** O preço da casa com que este se compara (o menor dos que combinam); null quando não se compara. */
  comparedTo: number | null;
}

export interface ComparedSharedPrices {
  /** A unidade principal da casa (a da primeira lista do "Último preço por mercado"); null sem preço da casa. */
  unit: string | null;
  rows: ShownSharedPrice[];
}

/** O tamanho que a linha de outra casa traz: só em "un", e só na forma do check do banco. null quando não se sabe. */
export function sharedPack(row: Pick<SharedPrice, 'unit' | 'pack_unit' | 'pack_amount' | 'pack_of'>): PackageSize | null {
  const unit = row.pack_unit;
  const amount = row.pack_amount == null ? NaN : Number(row.pack_amount);
  if (row.unit !== 'un' || (unit !== 'kg' && unit !== 'l' && unit !== 'un') || !(amount > 0)) return null;
  if (unit === 'un') {
    if (!(Number.isInteger(amount) && amount >= 2) || row.pack_of != null) return null;
    return { unit, amount, label: packageLabel({ unit, amount }) };
  }
  const of = row.pack_of == null ? undefined : Number(row.pack_of);
  if (of !== undefined && !(Number.isInteger(of) && of >= 2)) return null;
  const size: Omit<PackageSize, 'label'> = { unit, amount, ...(of !== undefined ? { of } : {}) };
  return { ...size, label: packageLabel(size) };
}

/** O tamanho de um preço da casa como se compara com a base comum: a leitura estrita da descrição, ou quantos vinham (a resposta da revisão). */
export const ownSharedPack = (row: Pick<OwnPrice, 'raw_description' | 'pack_count'>): PackageSize | null =>
  (row.raw_description ? sharedPackageSize(row.raw_description) : null) ?? answeredPack(row.pack_count);

/** Os dois preços a no máximo 2,5 vezes um do outro (inclusive). */
export const withinBand = (a: number, b: number) => a > 0 && b > 0 && a <= b * SHARED_PRICE_BAND && b <= a * SHARED_PRICE_BAND;

/**
 * Os preços por unidade da casa com que um preço por unidade de fora se compara: os de mesmo tamanho, quando ele diz
 * um e a casa tem; senão os que não dizem tamanho, ou todos quando ele não diz. Dois tamanhos conhecidos e
 * diferentes nunca se comparam (a caixa de 6 e a garrafa de 170 g, os dois "un").
 */
export function unitPricePool(ownUn: readonly { price: number; pack: PackageSize | null }[], pack: PackageSize | null): number[] {
  const same = pack ? ownUn.filter((own) => own.pack && samePackageSize(own.pack, pack)) : [];
  const pool = same.length ? same : ownUn.filter((own) => !own.pack || !pack);
  return pool.map((own) => own.price);
}

/** A unidade em que um tamanho se mede: kg, l, ou item do pacote para a contagem. */
const measureUnit = (pack: PackageSize) => (pack.unit === 'un' ? PACK_ITEM : pack.unit);
const SHOWN_ORDER = ['un', PACK_ITEM, 'kg', 'l'];

/** Os preços da casa que ficam por unidade na comparação dela (toPurchases), cada um com o tamanho estrito. */
function ownUnitPrices(own: readonly OwnPrice[]): { price: number; pack: PackageSize | null }[] {
  const purchases = new Map(toPurchases(own.map(savedLine)).map((purchase) => [purchase.receiptId, purchase]));
  const prices: { price: number; pack: PackageSize | null }[] = [];
  own.forEach((row, index) => {
    const purchase = purchases.get(`saved${index}`);
    if (purchase?.baseUnit === 'un' && purchase.price > 0) prices.push({ price: purchase.price, pack: ownSharedPack(row) });
  });
  return prices;
}

/**
 * Os preços de outras casas de UM produto (já sem o que a casa sabe: visibleSharedPrices), comparados com os da casa
 * (`own`, os últimos preços dela do produto). A âncora é a unidade principal da casa (`mainUnit`, a da primeira lista
 * do "Último preço por mercado" da tela do produto; sem ela, a dos preços guardados): a linha de fora com tamanho
 * cuja grandeza é essa vira preço por kg, litro ou item; as outras ficam por kg, litro ou unidade, como vieram. Só se
 * compara (`comparedTo`) a linha na unidade da casa, contra os preços da casa que combinam (por unidade:
 * unitPricePool) e dentro da faixa (withinBand). Uma linha por mercado, unidade e tamanho, a vista por último (no
 * mesmo dia, a mais barata). Na frente, as que se comparam; depois a unidade da casa, un, item, kg e l; depois a
 * mais barata e a vista por último.
 */
export function compareSharedPrices(
  shared: readonly SharedPrice[],
  own: readonly OwnPrice[],
  stores: readonly Pick<StoreCnpj, 'cnpj' | 'name'>[] = [],
  mainUnit?: string | null,
): ComparedSharedPrices {
  const ownName = new Map(stores.map((store) => [store.cnpj, store.name]));
  const ownPrices = storePricesFromPurchases(own.map(savedLine));
  const unit = mainUnit ?? storePriceGroups(ownPrices)[0]?.unit ?? null;
  const inUnit = ownPrices.filter((price) => price.unit === unit).map((price) => price.unitPrice);
  const ownUn = unit === 'un' ? ownUnitPrices(own) : [];
  const anySize = ownPrices.some((price) => price.packLabel != null) || shared.some((row) => sharedPack(row) != null);
  const latest = new Map<string, ShownSharedPrice>();
  for (const price of shared) {
    if (!(price.unit_price > 0)) continue;
    const base = pricePerBase(price.unit_price, price.unit);
    const pack = base.unit === 'un' ? sharedPack(price) : null;
    const converted = pack != null && measureUnit(pack) === unit;
    const shownUnit = pack != null && converted ? measureUnit(pack) : base.unit;
    const unitPrice = roundPrice(pack != null && converted ? price.unit_price / pack.amount : base.unitPrice);
    if (!(unitPrice > 0)) continue;
    const pool = shownUnit !== unit ? [] : unit === 'un' ? unitPricePool(ownUn, pack) : inUnit;
    const near = pool.filter((ownPrice) => withinBand(unitPrice, ownPrice));
    const mine = price.mine === true;
    const row: ShownSharedPrice = {
      storeCnpj: price.store_cnpj,
      storeName: (mine && ownName.get(price.store_cnpj)) || price.store_name,
      state: mine ? null : stateAbbreviation(price.store_uf),
      mine,
      unit: shownUnit,
      unitPrice,
      seenWeek: sharedWeekStart(price.seen_on),
      pack,
      packagePrice: converted ? roundPrice(price.unit_price) : null,
      comparedTo: near.length ? Math.min(...near) : null,
      sizeUnknown: shownUnit === 'un' && pack == null && anySize,
    };
    const key = [row.storeCnpj, row.unit, pack?.label ?? ''].join(SEPARATOR);
    const seen = latest.get(key);
    if (!seen || newerSharedRow(row, seen)) latest.set(key, row);
  }
  const rank = (shown: string) => (shown === unit ? -1 : SHOWN_ORDER.includes(shown) ? SHOWN_ORDER.indexOf(shown) : SHOWN_ORDER.length);
  const rows = [...latest.values()].sort(
    (a, b) =>
      Number(b.comparedTo != null) - Number(a.comparedTo != null) ||
      rank(a.unit) - rank(b.unit) ||
      a.unit.localeCompare(b.unit) ||
      a.unitPrice - b.unitPrice ||
      b.seenWeek.localeCompare(a.seenWeek) ||
      a.storeName.localeCompare(b.storeName, 'pt-BR') ||
      a.storeCnpj.localeCompare(b.storeCnpj) ||
      (a.pack?.label ?? '').localeCompare(b.pack?.label ?? ''),
  );
  return { unit, rows };
}

function byProduct<T extends { product_id: string }>(prices: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const price of prices) {
    const list = grouped.get(price.product_id);
    if (list) list.push(price);
    else grouped.set(price.product_id, [price]);
  }
  return grouped;
}

/** Preços: por produto, os preços de outras casas que valem mostrar (visibleSharedPrices), comparados. Produto sem linha nenhuma não entra. */
export function comparedSharedByProduct(
  shared: readonly SharedPrice[],
  own: readonly OwnPrice[],
  stores: readonly StoreCnpj[],
): Map<string, ComparedSharedPrices> {
  const ownByProduct = byProduct(own);
  const compared = new Map<string, ComparedSharedPrices>();
  for (const [productId, prices] of byProduct(visibleSharedPrices(shared, own, stores))) {
    compared.set(productId, compareSharedPrices(prices, ownByProduct.get(productId) ?? [], stores));
  }
  return compared;
}

/** A seção da tela do produto: o mesmo de comparedSharedByProduct para um produto, ancorado em `mainUnit` quando a tela o dá. */
export function comparedSharedForProduct(
  shared: readonly SharedPrice[],
  own: readonly OwnPrice[],
  stores: readonly StoreCnpj[],
  productId: string,
  mainUnit?: string | null,
): ComparedSharedPrices | null {
  const mine = own.filter((price) => price.product_id === productId);
  const visible = visibleSharedPrices(
    shared.filter((price) => price.product_id === productId),
    mine,
    stores,
  );
  return visible.length ? compareSharedPrices(visible, mine, stores, mainUnit) : null;
}

/**
 * O preço de outra casa que é menor que o da casa com que se compara (comparedTo): sempre na unidade da casa, nunca
 * entre dois tamanhos conhecidos diferentes nem a mais de 2,5 vezes. "Menor" é o que a tela escreve: se os dois saem
 * com os mesmos centavos, não é mais barato. Havendo um mais barato num mercado da própria casa, é ele (é onde a
 * casa já compra); senão, o mais barato dos outros; no empate, o visto por último. null quando não há.
 */
export function cheaperSharedPrice(compared: ComparedSharedPrices): ShownSharedPrice | null {
  const cheaper = compared.rows.filter(
    (row) => row.comparedTo != null && row.unitPrice < row.comparedTo && formatBRL(row.unitPrice) !== formatBRL(row.comparedTo),
  );
  const inMyStores = cheaper.filter((row) => row.mine);
  const candidates = inMyStores.length ? inMyStores : cheaper;
  if (!candidates.length) return null;
  return candidates.reduce((a, b) => (b.unitPrice < a.unitPrice || (b.unitPrice === a.unitPrice && b.seenWeek > a.seenWeek) ? b : a));
}

/**
 * Se a linha de outra casa entra na conta da lista e no "Onde comprar". Por kg ou litro, sempre (como hoje). Por
 * unidade, só quando a casa não tem preço por unidade do produto (como hoje) ou tem um que combina com ela
 * (unitPricePool: o mesmo tamanho; sem ele na casa, um dela sem tamanho; sem tamanho de fora, qualquer um) e a no
 * máximo 2,5 vezes (withinBand). Assim o "1 un" da lista não leva o preço da lata avulsa quando a casa compra a
 * caixa, nem o do fardo quando ela compra a lata.
 */
export function fitsHouseholdPack(own: readonly OwnPrice[]): (row: SharedPrice) => boolean {
  const ownByProduct = byProduct(own);
  const units = new Map<string, { price: number; pack: PackageSize | null }[]>();
  return (row) => {
    if (pricePerBase(1, row.unit).unit !== 'un') return true;
    let ownUn = units.get(row.product_id);
    if (!ownUn) {
      ownUn = (ownByProduct.get(row.product_id) ?? [])
        .filter((price) => price.unit === 'un' && price.unit_price > 0)
        .map((price) => ({ price: price.unit_price, pack: ownSharedPack(price) }));
      units.set(row.product_id, ownUn);
    }
    if (!ownUn.length) return true;
    return unitPricePool(ownUn, sharedPack(row)).some((price) => withinBand(row.unit_price, price));
  };
}

/**
 * "R$ 22,90/un", "R$ 4,58/kg": o preço sempre com a unidade, também por unidade. Por item do pacote, "R$ 0,83 cada"
 * ("R$ 0,83 o ovo" com a categoria dos ovos).
 */
export function sharedPriceLabel(row: Pick<SharedPriceRow, 'unit' | 'unitPrice'>, category?: string | null): string {
  return row.unit === PACK_ITEM ? eachPriceLabel(row.unitPrice, category) : `${formatBRL(row.unitPrice)}/${row.unit}`;
}

/** O mercado como a linha o mostra: "SENDAS DISTRIBUIDORA S/A (RJ)"; sem estado conhecido (ou no mercado da casa), só o nome. */
export function sharedStoreLabel(row: Pick<SharedPriceRow, 'storeName' | 'state'>): string {
  return row.state ? `${row.storeName} (${row.state})` : row.storeName;
}

/** "visto na semana de 9 nov", com o ano quando não é o de agora: a segunda-feira da semana, nunca o dia. */
export function seenLabel(row: Pick<SharedPriceRow, 'seenWeek'>, referenceYear?: number): string {
  return `visto na semana de ${formatShortDate(row.seenWeek, referenceYear)}`;
}

/**
 * O tamanho na linha de outra casa: "5 kg por R$ 22,90" (convertida para o preço por kg da casa), "12 x 350 ml" (o
 * preço da embalagem, tamanho conhecido), "tamanho não informado" (sem tamanho, ao lado de preços que dizem um); null
 * quando nada na tela diz tamanho (como antes). Nos ovos, com a categoria, "30 ovos".
 */
export function sharedPackDetail(row: SharedPriceRow & Partial<ShownSize>, category?: string | null): string | null {
  if (row.sizeUnknown) return SIZE_UNKNOWN;
  if (!row.pack) return null;
  const words = packSizeText(row.pack.label, category);
  return row.packagePrice != null ? `${words} por ${formatBRL(row.packagePrice)}` : words;
}

/** O subtítulo da linha na tela do produto: "5 kg por R$ 22,90 · visto na semana de 9 nov", ou só "visto na semana de 9 nov". */
export function sharedRowDetail(row: SharedPriceRow & Partial<ShownSize>, referenceYear?: number, category?: string | null): string {
  const detail = sharedPackDetail(row, category);
  return detail ? `${detail} · ${seenLabel(row, referenceYear)}` : seenLabel(row, referenceYear);
}

/**
 * A linha de um preço de outra casa: "R$ 22,90/un · Atacadão Mooca · visto na semana de 9 nov", com o tamanho quando
 * se sabe ("R$ 4,58/kg · 5 kg por R$ 22,90 · SUPER OUTRO (SP) · visto na semana de 9 nov"). O nome do mercado vai como
 * veio, sem artigo na frente.
 */
export function describeSharedPrice(row: SharedPriceRow & Partial<ShownSize>, referenceYear?: number, category?: string | null): string {
  return [sharedPriceLabel(row, category), sharedPackDetail(row, category), sharedStoreLabel(row), seenLabel(row, referenceYear)]
    .filter(Boolean)
    .join(' · ');
}

/**
 * A linha em Preços, embaixo do produto: "Visto por R$ 21,90/un · Atacadão Mooca · semana de 9 nov, em outra casa",
 * com o tamanho entre parênteses quando se sabe ("Visto por R$ 4,58/kg (5 kg por R$ 22,90) · …").
 */
export function cheaperSharedHint(row: SharedPriceRow & Partial<ShownSize>, referenceYear?: number, category?: string | null): string {
  const detail = sharedPackDetail(row, category);
  return `Visto por ${sharedPriceLabel(row, category)}${detail ? ` (${detail})` : ''} · ${sharedStoreLabel(row)} · semana de ${formatShortDate(row.seenWeek, referenceYear)}, em outra casa`;
}

/**
 * O preço da base aberta (domain/openPrices) para um item que a casa nunca comprou: como a conta chegou a ele. Os
 * detalhes do item e as linhas do "Onde comprar" dizem isso.
 */
export interface OpenPrice {
  /** O tamanho que o app escolheu para a lista que não disse ("5 kg"); só nas linhas por unidade. */
  size: string | null;
  /** Como: o único tamanho visto, o mais visto, ou um dos mais vistos (empate). */
  sizeBy: 'only' | 'most' | 'tie' | null;
  /** O preço do pacote virou preço por kg ou litro, para o item pedido em peso ou volume: aquele pacote ("5 kg"). */
  fromPackage: string | null;
  /** Nesse caso, quantos pacotes inteiros cumprem o que a lista pede; null quando a conta usa uma fração do pacote. */
  packages: number | null;
}

/**
 * Um preço de outra casa pronto para a conta da lista: o de sharedPriceRows
 * (por kg, por litro ou por unidade, sem o que a casa já sabe), com o produto
 * e o mercado da casa que tem esse CNPJ. `storeId` null: o mercado não é da
 * casa (vai para "Em outros mercados", no "Onde comprar"). `productId` null:
 * é da base aberta (o item que a casa nunca comprou), e `open` diz como.
 */
export interface SharedQuote extends SharedPriceRow {
  productId: string | null;
  storeId: string | null;
  open?: OpenPrice;
}

/**
 * Os preços de outras casas como entram na lista. Mercado da casa só pelo
 * CNPJ: dois mercados da casa com o mesmo CNPJ recebem o preço os dois. A
 * linha que o banco diz ser de um mercado da casa, mas cujo CNPJ não está nos
 * mercados que a casa tem agora (a lista de mercados é de antes), fica de
 * fora: não é para aparecer como mercado de fora. A linha por unidade que não
 * combina com as embalagens da casa (fitsHouseholdPack) também fica de fora.
 */
export function sharedQuotes(shared: readonly SharedPrice[], own: readonly OwnPrice[], stores: readonly StoreCnpj[]): SharedQuote[] {
  const idsByCnpj = new Map<string, string[]>();
  for (const store of stores) if (store.cnpj) idsByCnpj.set(store.cnpj, [...(idsByCnpj.get(store.cnpj) ?? []), store.id]);
  const quotes: SharedQuote[] = [];
  for (const [productId, rows] of sharedRowsByProduct(shared.filter(fitsHouseholdPack(own)), own, stores)) {
    for (const row of rows) {
      const ids = idsByCnpj.get(row.storeCnpj) ?? [];
      if (ids.length) quotes.push(...ids.map((storeId) => ({ ...row, productId, storeId })));
      else if (!row.mine) quotes.push({ ...row, productId, storeId: null });
    }
  }
  return quotes;
}

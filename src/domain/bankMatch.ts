// Consultor financeiro (beta): conferência só de leitura entre as compras do
// banco e o que a casa já registrou no Kotii (notas, contas pagas, gastos).
// Nada é gravado: a tela mostra "já no Kotii" e "só no banco" com sugestões.
// A compra parcelada conta mês a mês no banco, mas a nota dela é da compra
// inteira: a nota casa com a compra (o valor e a data dela) e vale para cada
// parcela; quem lança cada parcela como gasto casa parcela por parcela.

import { normalizeBankText } from './bankCategories';
import {
  type BankInstallment,
  type BankPurchase,
  ESTIMATE_SLACK_DAYS,
  financeWindowStart,
  windowPurchases,
} from './bankMonth';
import { addDays, diffDays } from './dates';
import { monthRange } from './finance';

export interface KotiiRecord {
  kind: 'nota' | 'conta' | 'gasto';
  id: string;
  amount: number;
  date: string;
  /** Loja da nota, nome da conta ou descrição do gasto. */
  label: string;
  /** CNPJ da loja (nota). */
  cnpj: string | null;
}

export interface BankMatch {
  purchase: BankPurchase;
  record: KotiiRecord;
  confidence: 'alta' | 'media';
  reason: string;
  /**
   * Com o que o registro casou: o próprio lançamento ('compra'), a compra
   * parcelada inteira ('parcelada': a nota da compra vale para cada parcela
   * dela) ou só esta parcela ('parcela': o gasto lançado mês a mês).
   */
  via: 'compra' | 'parcelada' | 'parcela';
}

/** Registro que pode ser o de uma saída sem par, e com o que ele casaria (ver BankMatch.via). */
export interface MatchSuggestion {
  record: KotiiRecord;
  via: BankMatch['via'];
}

/**
 * Uma linha por lançamento de saída (cada parcela, no mês dela). O registro
 * que casou com uma compra parcelada aparece em todas as parcelas dela.
 */
export interface Reconciliation {
  matched: BankMatch[];
  bankOnly: { purchase: BankPurchase; suggestions: MatchSuggestion[] }[];
  kotiiOnly: KotiiRecord[];
}

/** Até tantos dias entre o banco e o registro do Kotii. */
export const MATCH_DAYS = 3;
/** Nota com o mesmo CNPJ e o banco até 15% acima: gorjeta ou taxa de serviço (na parcelada, juros). */
export const TIP_RATIO = 1.15;
const MAX_SUGGESTIONS = 3;

const digits = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '');

// Palavras que aparecem em qualquer loja e não dizem qual é.
const GENERIC = new Set([
  'supermercado', 'supermercados', 'mercado', 'mercadinho', 'loja', 'lojas', 'comercio', 'comercial', 'ltda',
  'eireli', 'brasil', 'distribuidora', 'alimentos', 'atacado', 'varejo', 'servicos', 'pagamento', 'compra',
  'debito', 'credito', 'cartao', 'restaurante', 'farmacia', 'drogaria', 'posto', 'padaria', 'conta', 'fatura',
  'boleto', 'transferencia', 'enviado', 'enviada', 'recebido', 'recebida', 'filial', 'matriz', 'online',
]);

function significantWords(text: string): string[] {
  return normalizeBankText(text)
    .split(' ')
    .filter((w) => w.length >= 4 && !GENERIC.has(w) && !/^\d+$/.test(w));
}

/**
 * Nome parecido: uma palavra que diz qual é a loja aparece nos dois ("Pão de
 * Açúcar" e "PAODEACUCAR 123", "Supermercado Guanabara" e "GUANABARA BARRA").
 */
export function namesOverlap(a: (string | null)[], b: (string | null)[]): boolean {
  const textA = a.filter(Boolean).join(' ');
  const textB = b.filter(Boolean).join(' ');
  const wordsA = significantWords(textA);
  const wordsB = significantWords(textB);
  if (wordsA.some((w) => wordsB.includes(w))) return true;
  const squashA = normalizeBankText(textA).replace(/ /g, '');
  const squashB = normalizeBankText(textB).replace(/ /g, '');
  return wordsA.some((w) => w.length >= 5 && squashB.includes(w)) || wordsB.some((w) => w.length >= 5 && squashA.includes(w));
}

/** Folga na data da compra parcelada: a do banco (ou da 1ª parcela) é exata; a estimada pode errar uns dias. */
const purchaseDays = (installment: BankInstallment) => (installment.purchaseExact ? MATCH_DAYS : ESTIMATE_SLACK_DAYS);

/** O que se compara com os registros: um lançamento, uma compra parcelada inteira ou uma parcela. */
interface Unit {
  via: BankMatch['via'];
  /** Lançamentos (índices nas saídas) que o registro casado com esta unidade cobre. */
  rows: number[];
  purchase: BankPurchase;
  date: string;
  amount: number;
  days: number;
  /** Folga no valor: na compra parcelada sem a 1ª parcela, os centavos que ela costuma levar a mais. */
  cents: number;
  /** Na parcela, a unidade da compra inteira; na compra inteira, as das parcelas. */
  parent?: number;
  children: number[];
}

interface Candidate {
  u: number;
  r: number;
  score: number;
  confidence: 'alta' | 'media';
  reason: string;
}

function candidate(unit: Unit, record: KotiiRecord): Omit<Candidate, 'u' | 'r'> | null {
  // A nota é da compra inteira: uma parcela sozinha nunca é a nota (ela casa com a compra parcelada).
  if (unit.via === 'parcela' && record.kind === 'nota') return null;
  const days = Math.abs(diffDays(unit.date, record.date));
  if (days > unit.days) return null;
  const { purchase } = unit;
  const series = unit.via === 'parcelada';
  const reason = (single: string, whole: string) => (series ? `Compra parcelada: ${whole}` : single);
  const cnpj = digits(record.cnpj);
  const bankCnpj = digits(purchase.merchantCnpj);
  const sameCnpj = cnpj.length > 0 && cnpj === bankCnpj;
  // Rede de lojas: a nota traz o CNPJ da filial, e o banco muitas vezes o da matriz (mesma raiz, 8 dígitos).
  const sameCompany = sameCnpj || (cnpj.length === 14 && bankCnpj.length === 14 && cnpj.slice(0, 8) === bankCnpj.slice(0, 8));
  if (Math.abs(unit.amount - record.amount) <= unit.cents + 1e-9) {
    if (sameCnpj) {
      return { score: 300 - days, confidence: 'alta', reason: reason('Mesmo CNPJ, valor e data', 'mesmo CNPJ, valor e data da compra') };
    }
    if (sameCompany) {
      return {
        score: 250 - days,
        confidence: 'alta',
        reason: reason('Mesma empresa (CNPJ), valor e data', 'mesma empresa (CNPJ), valor e data da compra'),
      };
    }
    if (namesOverlap([purchase.merchantName, purchase.description], [record.label])) {
      return { score: 200 - days, confidence: 'alta', reason: reason('Mesmo valor e nome parecido', 'mesmo valor e nome parecido') };
    }
    return { score: 100 - days, confidence: 'media', reason: reason('Mesmo valor em data próxima', 'mesmo valor, perto da data da compra') };
  }
  // Gorjeta só com o CNPJ da mesma loja: na rede (mesma raiz), a nota de outra filial um pouco mais barata
  // costuma ser outra compra (de alguém da casa, num cartão que não está conectado).
  if (record.kind === 'nota' && sameCnpj && unit.amount > record.amount && unit.amount <= record.amount * TIP_RATIO + 1e-9) {
    const why = series ? 'parcelada com juros?' : 'com gorjeta?';
    return { score: 50 - days, confidence: 'media', reason: `Mesma loja e valor um pouco maior: ${why}` };
  }
  return null;
}

/**
 * As unidades das saídas: cada lançamento à vista; cada compra parcelada
 * inteira, com o valor e a data da compra (menos tarifa em parcelas, como a
 * anuidade, que não tem nota); e cada parcela, com o valor e a data dela.
 * As à vista e as compras inteiras vêm primeiro, na ordem das saídas.
 */
function unitsOf(spending: BankPurchase[]): Unit[] {
  const units: Unit[] = [];
  const seriesUnit = new Map<string, number>();
  spending.forEach((purchase, i) => {
    const installment = purchase.installment;
    if (!installment) {
      units.push({ via: 'compra', rows: [i], purchase, date: purchase.date, amount: purchase.amount, days: MATCH_DAYS, cents: 0.01, children: [] });
      return;
    }
    if (purchase.autoCategory === 'taxas') return;
    const known = seriesUnit.get(installment.seriesKey);
    if (known !== undefined) {
      units[known].rows.push(i);
      return;
    }
    seriesUnit.set(installment.seriesKey, units.length);
    units.push({
      via: 'parcelada',
      rows: [i],
      purchase,
      date: installment.purchaseDate,
      amount: installment.purchaseAmount,
      days: purchaseDays(installment),
      cents: installment.seen.includes(1) ? 0.01 : 0.01 * installment.total,
      children: [],
    });
  });
  spending.forEach((purchase, i) => {
    if (!purchase.installment) return;
    const parent = seriesUnit.get(purchase.installment.seriesKey);
    if (parent !== undefined) units[parent].children.push(units.length);
    units.push({ via: 'parcela', rows: [i], purchase, date: purchase.date, amount: purchase.amount, days: MATCH_DAYS, cents: 0.01, parent, children: [] });
  });
  return units;
}

/**
 * Casa as saídas com os registros do Kotii, do par mais forte para o mais
 * fraco, cada registro uma vez. A nota que casou com a compra parcelada vale
 * para todas as parcelas dela, e aí nenhuma parcela casa sozinha; a parcela
 * que casou sozinha (o gasto do mês) tira a compra inteira da disputa. Se
 * uma unidade empata entre dois registros, ninguém decide por ela: fica em
 * "só no banco" com os dois como sugestão (a compra parcelada empatada leva
 * junto as parcelas). Registro de antes de `singlesFrom` só serve à compra
 * parcelada (a nota de uma compra de antes da janela).
 */
export function matchBankToKotii(
  purchases: BankPurchase[],
  records: KotiiRecord[],
  options: { singlesFrom?: string } = {},
): Reconciliation {
  const spending = purchases.filter((p) => p.kind === 'spending');
  const units = unitsOf(spending);
  const candidates: Candidate[] = [];
  units.forEach((unit, u) =>
    records.forEach((record, r) => {
      if (unit.via !== 'parcelada' && options.singlesFrom && record.date < options.singlesFrom) return;
      const c = candidate(unit, record);
      if (c) candidates.push({ ...c, u, r });
    }),
  );
  candidates.sort((a, b) => b.score - a.score || a.u - b.u || a.r - b.r);

  const won = new Map<number, Candidate>();
  const usedRecords = new Set<number>();
  const off = new Set<number>();
  const undecided = new Set<number>();
  for (const c of candidates) {
    if (won.has(c.u) || off.has(c.u) || undecided.has(c.u) || usedRecords.has(c.r)) continue;
    const unit = units[c.u];
    const tied = candidates.filter((o) => o.u === c.u && o.score === c.score && !usedRecords.has(o.r));
    if (tied.length > 1) {
      undecided.add(c.u);
      for (const child of unit.children) undecided.add(child);
      if (unit.parent !== undefined) off.add(unit.parent);
      continue;
    }
    won.set(c.u, c);
    usedRecords.add(c.r);
    for (const child of unit.children) off.add(child);
    if (unit.parent !== undefined) off.add(unit.parent);
  }

  const unitsOfRow = new Map<number, number[]>();
  units.forEach((unit, u) => unit.rows.forEach((i) => unitsOfRow.set(i, [...(unitsOfRow.get(i) ?? []), u])));
  const matched: BankMatch[] = [];
  const bankOnly: Reconciliation['bankOnly'] = [];
  spending.forEach((purchase, i) => {
    const mine = unitsOfRow.get(i) ?? [];
    const u = mine.find((x) => won.has(x));
    if (u !== undefined) {
      const match = won.get(u) as Candidate;
      matched.push({ purchase, record: records[match.r], confidence: match.confidence, reason: match.reason, via: units[u].via });
      return;
    }
    // Os registros livres que casariam com o lançamento ou com a compra parcelada dele, do mais forte ao mais fraco.
    const suggestions: MatchSuggestion[] = [];
    const suggested = new Set<number>();
    for (const c of candidates) {
      if (suggestions.length >= MAX_SUGGESTIONS) break;
      if (!mine.includes(c.u) || usedRecords.has(c.r) || suggested.has(c.r)) continue;
      suggested.add(c.r);
      suggestions.push({ record: records[c.r], via: units[c.u].via });
    }
    bankOnly.push({ purchase, suggestions });
  });
  return { matched, bankOnly, kotiiOnly: records.filter((_, r) => !usedRecords.has(r)) };
}

/**
 * A conferência da janela do consultor (a tela e o retrato do Nuke fazem a
 * mesma conta): os lançamentos com data na janela contra os registros do
 * Kotii desde kotiiRecordsStart. O registro de antes da janela só serve à
 * compra parcelada (a nota de uma compra de maio com parcelas em agosto).
 */
export function reconcileWindow(purchases: BankPurchase[], records: KotiiRecord[], today: string): Reconciliation {
  return matchBankToKotii(windowPurchases(purchases, today), records, { singlesFrom: financeWindowStart(today) });
}

/**
 * Desde quando buscar os registros do Kotii: o começo da janela ou, antes
 * dele, o começo do mês da compra parcelada mais antiga que ainda tem
 * parcela na janela (a nota é do dia da compra). Tarifa em parcelas não tem
 * nota e não puxa a busca para trás.
 */
export function kotiiRecordsStart(purchases: BankPurchase[], today: string): string {
  let start = financeWindowStart(today);
  for (const p of windowPurchases(purchases, today)) {
    if (p.kind !== 'spending' || !p.installment || p.autoCategory === 'taxas') continue;
    const from = monthRange(addDays(p.installment.purchaseDate, -purchaseDays(p.installment)).slice(0, 7)).start;
    if (from < start) start = from;
  }
  return start;
}

/**
 * A conferência de um período, tirada da conferência da janela inteira:
 * casar mês a mês deixaria um registro perto da virada servir a um
 * lançamento em cada mês (e contar duas vezes em "já no Kotii"). A exceção
 * é de propósito: a nota da compra parcelada vale para a parcela de cada mês.
 */
export function reconciliationInRange(result: Reconciliation, range: { start: string; end: string }): Reconciliation {
  const inRange = (date: string) => date >= range.start && date < range.end;
  return {
    matched: result.matched.filter((m) => inRange(m.purchase.date)),
    bankOnly: result.bankOnly.filter((b) => inRange(b.purchase.date)),
    kotiiOnly: result.kotiiOnly.filter((r) => inRange(r.date)),
  };
}

/**
 * Quanto das saídas do banco já está no Kotii e quanto está só no banco: o
 * que foi cobrado no período (da compra parcelada, a parcela) e em quantos
 * lançamentos (cada parcela conta um).
 */
export function reconciliationTotals(result: Reconciliation): {
  inKotii: number;
  inKotiiCount: number;
  bankOnly: number;
  bankOnlyCount: number;
} {
  const sum = (values: number[]) => Math.round(values.reduce((s, v) => s + v, 0) * 100) / 100;
  return {
    inKotii: sum(result.matched.map((m) => m.purchase.amount)),
    inKotiiCount: result.matched.length,
    bankOnly: sum(result.bankOnly.map((b) => b.purchase.amount)),
    bankOnlyCount: result.bankOnly.length,
  };
}

/** Notas confirmadas, contas pagas e gastos avulsos como registros para a conferência. */
export function kotiiRecordsFrom(input: {
  receipts?: { id: string; date: string; total: number | null; store: string | null; cnpj: string | null }[];
  payments?: { id: string; paid_on: string; amount: number; bill_name: string }[];
  expenses?: { id: string; spent_on: string; amount: number; description: string }[];
}): KotiiRecord[] {
  return [
    ...(input.receipts ?? [])
      .filter((r) => r.total != null && r.total > 0)
      .map((r): KotiiRecord => ({ kind: 'nota', id: r.id, amount: Number(r.total), date: r.date, label: r.store ?? 'Nota fiscal', cnpj: r.cnpj })),
    ...(input.payments ?? []).map(
      (p): KotiiRecord => ({ kind: 'conta', id: p.id, amount: Number(p.amount), date: p.paid_on, label: p.bill_name, cnpj: null }),
    ),
    ...(input.expenses ?? []).map(
      (e): KotiiRecord => ({ kind: 'gasto', id: e.id, amount: Number(e.amount), date: e.spent_on, label: e.description, cnpj: null }),
    ),
  ];
}

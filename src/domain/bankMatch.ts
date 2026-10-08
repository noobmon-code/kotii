// Consultor financeiro (beta): conferência só de leitura entre as compras do
// banco e o que a casa já registrou no Kotii (notas, contas pagas, gastos).
// Nada é gravado: a tela mostra "já no Kotii" e "só no banco" com sugestões.

import { normalizeBankText } from './bankCategories';
import type { BankPurchase } from './bankMonth';
import { diffDays } from './dates';

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
}

export interface Reconciliation {
  matched: BankMatch[];
  bankOnly: { purchase: BankPurchase; suggestions: KotiiRecord[] }[];
  kotiiOnly: KotiiRecord[];
}

/** Até tantos dias entre o banco e o registro do Kotii. */
export const MATCH_DAYS = 3;
/** Nota com o mesmo CNPJ e o banco até 15% acima: gorjeta ou taxa de serviço. */
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

interface Candidate {
  p: number;
  r: number;
  score: number;
  confidence: 'alta' | 'media';
  reason: string;
}

function candidate(purchase: BankPurchase, record: KotiiRecord): Omit<Candidate, 'p' | 'r'> | null {
  const days = Math.abs(diffDays(purchase.date, record.date));
  if (days > MATCH_DAYS) return null;
  const cnpj = digits(record.cnpj);
  const bankCnpj = digits(purchase.merchantCnpj);
  const sameCnpj = cnpj.length > 0 && cnpj === bankCnpj;
  // Rede de lojas: a nota traz o CNPJ da filial, e o banco muitas vezes o da matriz (mesma raiz, 8 dígitos).
  const sameCompany = sameCnpj || (cnpj.length === 14 && bankCnpj.length === 14 && cnpj.slice(0, 8) === bankCnpj.slice(0, 8));
  if (Math.abs(purchase.amount - record.amount) <= 0.01 + 1e-9) {
    if (sameCnpj) return { score: 300 - days, confidence: 'alta', reason: 'Mesmo CNPJ, valor e data' };
    if (sameCompany) return { score: 250 - days, confidence: 'alta', reason: 'Mesma empresa (CNPJ), valor e data' };
    if (namesOverlap([purchase.merchantName, purchase.description], [record.label])) {
      return { score: 200 - days, confidence: 'alta', reason: 'Mesmo valor e nome parecido' };
    }
    return { score: 100 - days, confidence: 'media', reason: 'Mesmo valor em data próxima' };
  }
  // Gorjeta só com o CNPJ da mesma loja: na rede (mesma raiz), a nota de outra filial um pouco mais barata
  // costuma ser outra compra (de alguém da casa, num cartão que não está conectado).
  if (record.kind === 'nota' && sameCnpj && purchase.amount > record.amount && purchase.amount <= record.amount * TIP_RATIO + 1e-9) {
    return { score: 50 - days, confidence: 'media', reason: 'Mesma loja e valor um pouco maior: com gorjeta?' };
  }
  return null;
}

/**
 * Casa cada compra (só saídas) com no máximo um registro do Kotii, do par
 * mais forte para o mais fraco. Se uma compra empata entre dois registros,
 * ninguém decide por ela: fica em "só no banco" com os dois como sugestão.
 */
export function matchBankToKotii(purchases: BankPurchase[], records: KotiiRecord[]): Reconciliation {
  const spending = purchases.filter((p) => p.kind === 'spending');
  const candidates: Candidate[] = [];
  spending.forEach((purchase, p) =>
    records.forEach((record, r) => {
      const c = candidate(purchase, record);
      if (c) candidates.push({ ...c, p, r });
    }),
  );
  candidates.sort((a, b) => b.score - a.score || a.p - b.p || a.r - b.r);

  const matchOf = new Map<number, Candidate>();
  const usedRecords = new Set<number>();
  const undecided = new Set<number>();
  for (const c of candidates) {
    if (matchOf.has(c.p) || usedRecords.has(c.r) || undecided.has(c.p)) continue;
    const tied = candidates.filter((o) => o.p === c.p && o.score === c.score && !usedRecords.has(o.r));
    if (tied.length > 1) {
      undecided.add(c.p);
      continue;
    }
    matchOf.set(c.p, c);
    usedRecords.add(c.r);
  }

  const matched: BankMatch[] = [];
  const bankOnly: Reconciliation['bankOnly'] = [];
  spending.forEach((purchase, p) => {
    const match = matchOf.get(p);
    if (match) {
      matched.push({ purchase, record: records[match.r], confidence: match.confidence, reason: match.reason });
      return;
    }
    const suggestions = candidates
      .filter((c) => c.p === p && !usedRecords.has(c.r))
      .slice(0, MAX_SUGGESTIONS)
      .map((c) => records[c.r]);
    bankOnly.push({ purchase, suggestions });
  });
  return { matched, bankOnly, kotiiOnly: records.filter((_, r) => !usedRecords.has(r)) };
}

/**
 * A conferência de um período, tirada da conferência da janela inteira:
 * casar mês a mês deixaria um registro perto da virada servir a uma compra
 * em cada mês (e contar duas vezes em "já no Kotii").
 */
export function reconciliationInRange(result: Reconciliation, range: { start: string; end: string }): Reconciliation {
  const inRange = (date: string) => date >= range.start && date < range.end;
  return {
    matched: result.matched.filter((m) => inRange(m.purchase.date)),
    bankOnly: result.bankOnly.filter((b) => inRange(b.purchase.date)),
    kotiiOnly: result.kotiiOnly.filter((r) => inRange(r.date)),
  };
}

/** Quanto das saídas do banco já está no Kotii e quanto está só no banco. */
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

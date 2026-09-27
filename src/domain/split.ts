// Divisão de gastos entre moradores: no mês, quanto cada um pagou, qual a
// parte de cada um (igual ou por peso) e quem passa quanto para quem para
// ficar tudo certo, com o menor número de transferências.

export interface SplitMember {
  userId: string;
  name: string;
}

export interface SplitRow extends SplitMember {
  paid: number;
  share: number;
  /** Positivo: os outros devem a ele; negativo: ele deve. */
  balance: number;
}

export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

export interface SplitResult {
  /** O que entra na divisão (gastos com quem pagou da casa). */
  total: number;
  /** Gastos sem quem pagou (ou de quem saiu da casa): ficam de fora. */
  unassigned: number;
  rows: SplitRow[];
  transfers: Transfer[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function splitMonth({
  entries,
  members,
  weights = {},
  settlements = [],
}: {
  entries: { amount: number; paidBy: string | null }[];
  members: SplitMember[];
  /** Peso de cada morador; sem peso, vale 1. */
  weights?: Record<string, number>;
  /** Acertos já feitos no mês: `from` passou `amount` para `to`. */
  settlements?: Transfer[];
}): SplitResult {
  const ids = new Set(members.map((m) => m.userId));
  const paid = new Map(members.map((m) => [m.userId, 0]));
  let total = 0;
  let unassigned = 0;
  for (const entry of entries) {
    if (entry.paidBy && ids.has(entry.paidBy)) {
      paid.set(entry.paidBy, paid.get(entry.paidBy)! + entry.amount);
      total += entry.amount;
    } else {
      unassigned += entry.amount;
    }
  }
  // Acerto conta como se quem passou o dinheiro tivesse pago aquela parte.
  for (const s of settlements) {
    if (!ids.has(s.from) || !ids.has(s.to)) continue;
    paid.set(s.from, paid.get(s.from)! + s.amount);
    paid.set(s.to, paid.get(s.to)! - s.amount);
  }

  const weightOf = (id: string) => (weights[id] && weights[id] > 0 ? weights[id] : 1);
  const totalWeight = members.reduce((sum, m) => sum + weightOf(m.userId), 0);
  const rows: SplitRow[] = members.map((m) => {
    const share = totalWeight ? round2((total * weightOf(m.userId)) / totalWeight) : 0;
    return { ...m, paid: round2(paid.get(m.userId)!), share, balance: 0 };
  });
  // Sobra do arredondamento fica com a maior parte: as partes somam o total.
  if (rows.length) {
    const residue = round2(total - rows.reduce((sum, r) => sum + r.share, 0));
    const largest = rows.reduce((a, b) => (b.share > a.share ? b : a));
    largest.share = round2(largest.share + residue);
  }
  for (const row of rows) row.balance = round2(row.paid - row.share);

  // Quem deve mais paga primeiro para quem tem mais a receber.
  const debtors = rows.filter((r) => r.balance < -0.004).map((r) => ({ id: r.userId, left: -r.balance }));
  const creditors = rows.filter((r) => r.balance > 0.004).map((r) => ({ id: r.userId, left: r.balance }));
  debtors.sort((a, b) => b.left - a.left);
  creditors.sort((a, b) => b.left - a.left);
  const transfers: Transfer[] = [];
  let d = 0;
  let c = 0;
  while (d < debtors.length && c < creditors.length) {
    const amount = round2(Math.min(debtors[d].left, creditors[c].left));
    if (amount >= 0.01) transfers.push({ from: debtors[d].id, to: creditors[c].id, amount });
    debtors[d].left = round2(debtors[d].left - amount);
    creditors[c].left = round2(creditors[c].left - amount);
    if (debtors[d].left < 0.01) d += 1;
    if (creditors[c].left < 0.01) c += 1;
  }

  return { total: round2(total), unassigned: round2(unassigned), rows, transfers };
}

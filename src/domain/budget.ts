// Orçamento do mês por categoria de gasto: quanto já foi do limite. O gasto
// é o do resumo (summarize), então vale para qualquer mês olhado.

import { getFinanceCategory, type FinanceCategory, type Summary } from './finance';
import { formatBRL } from './money';

/** A partir daqui a categoria aparece como "perto do limite". */
export const BUDGET_WARN_RATIO = 0.8;

export interface BudgetLine {
  category: FinanceCategory;
  limit: number;
  spent: number;
  /** spent / limit (1 = no limite). */
  ratio: number;
  status: 'ok' | 'perto' | 'estourou';
}

/** Categorias com limite, da mais apertada para a mais folgada. */
export function budgetProgress(
  budgets: { category: string; monthly_limit: number }[],
  byCategory: Summary['byCategory'],
): BudgetLine[] {
  return budgets
    .map((b) => {
      const category = getFinanceCategory(b.category).key;
      const limit = Number(b.monthly_limit);
      const spent = byCategory.find((c) => c.category === category)?.amount ?? 0;
      const ratio = limit > 0 ? spent / limit : 0;
      const status: BudgetLine['status'] = ratio > 1 ? 'estourou' : ratio >= BUDGET_WARN_RATIO ? 'perto' : 'ok';
      return { category, limit, spent, ratio, status };
    })
    .sort((a, b) => b.ratio - a.ratio);
}

/** "R$ 950,00 de R$ 1.200,00 · faltam R$ 250,00" ou "passou R$ 30,00 do limite". */
export function describeBudget(line: BudgetLine): string {
  const base = `${formatBRL(line.spent)} de ${formatBRL(line.limit)}`;
  const diff = Math.round((line.limit - line.spent) * 100) / 100;
  if (diff < 0) return `${base} · passou ${formatBRL(-diff)} do limite`;
  if (diff === 0) return `${base} · chegou no limite`;
  return `${base} · faltam ${formatBRL(diff)}`;
}

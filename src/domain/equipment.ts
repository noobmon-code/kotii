// Aparelhos e bens da casa: categorias, garantia e manutenção sugerida.

import type { IconName } from './categories';
import type { Recurrence } from './chores';
import { addDays, addMonths, diffDays } from './dates';
import { normalizeSearch } from './search';

export type EquipmentCategory =
  | 'eletrodomestico'
  | 'climatizacao'
  | 'eletronico'
  | 'veiculo'
  | 'hidraulica'
  | 'eletrica'
  | 'seguranca'
  | 'moveis'
  | 'outros';

export const EQUIPMENT_CATEGORIES: { key: EquipmentCategory; label: string; icon: IconName }[] = [
  { key: 'eletrodomestico', label: 'Eletrodoméstico', icon: 'fridge-outline' },
  { key: 'climatizacao', label: 'Ar e ventilação', icon: 'air-conditioner' },
  { key: 'eletronico', label: 'Eletrônico', icon: 'television' },
  { key: 'veiculo', label: 'Veículo', icon: 'car-outline' },
  { key: 'hidraulica', label: 'Água e hidráulica', icon: 'water-outline' },
  { key: 'eletrica', label: 'Elétrica', icon: 'flash-outline' },
  { key: 'seguranca', label: 'Segurança', icon: 'fire-extinguisher' },
  { key: 'moveis', label: 'Móveis', icon: 'sofa-outline' },
  { key: 'outros', label: 'Outros', icon: 'tools' },
];

export function getEquipmentCategory(key: string) {
  return EQUIPMENT_CATEGORIES.find((c) => c.key === key) ?? EQUIPMENT_CATEGORIES[EQUIPMENT_CATEGORIES.length - 1];
}

/** Prazos de garantia comuns, em meses, para preencher a data com um toque. */
export const WARRANTY_PRESETS = [3, 6, 12, 24, 36];

export type WarrantyStatus =
  | { kind: 'vigente'; days: number }
  | { kind: 'acabando'; days: number }
  | { kind: 'vencida'; days: number }
  | { kind: 'sem_garantia' };

/** "Acabando" = últimos 30 dias: hora de testar tudo antes que acabe. */
export function warrantyStatus(warrantyUntil: string | null, today: string): WarrantyStatus {
  if (!warrantyUntil) return { kind: 'sem_garantia' };
  const days = diffDays(today, warrantyUntil);
  if (days < 0) return { kind: 'vencida', days: -days };
  if (days <= 30) return { kind: 'acabando', days };
  return { kind: 'vigente', days };
}

export function describeWarranty(status: WarrantyStatus): string {
  switch (status.kind) {
    case 'vigente':
      return status.days >= 60 ? `Garantia por mais ${Math.floor(status.days / 30)} meses` : `Garantia por mais ${status.days} dias`;
    case 'acabando':
      return status.days === 0 ? 'Garantia acaba hoje' : status.days === 1 ? 'Garantia acaba amanhã' : `Garantia acaba em ${status.days} dias`;
    case 'vencida':
      return 'Fora da garantia';
    case 'sem_garantia':
      return 'Sem garantia cadastrada';
  }
}

export interface MaintenanceSuggestion {
  title: string;
  recurrence: Exclude<Recurrence, 'none'>;
  interval: number;
}

const m = (title: string, interval: number): MaintenanceSuggestion => ({ title, recurrence: 'monthly', interval });
const w = (title: string, interval: number): MaintenanceSuggestion => ({ title, recurrence: 'weekly', interval });

// Palavra-chave no nome do aparelho -> manutenções usuais. A primeira que
// casar vence; depois, o padrão da categoria.
const BY_KEYWORD: [string[], MaintenanceSuggestion[]][] = [
  [['ar condicionado', 'ar-condicionado', 'split', 'climatizador'], [m('Limpar filtros', 1), m('Higienização completa', 6)]],
  [['purificador', 'filtro de agua', 'bebedouro'], [m('Trocar refil do filtro', 6)]],
  [['caixa d agua', 'caixa dagua', 'caixa de agua', 'reservatorio'], [m('Limpar caixa d’água', 6)]],
  [['geladeira', 'refrigerador', 'freezer'], [m('Limpar interior e borrachas', 3)]],
  [['maquina de lavar', 'lava roupa', 'lava-roupa', 'lavadora', 'lava e seca'], [m('Limpar filtro e fazer ciclo de limpeza', 1)]],
  [['lava louca', 'lava-louca', 'lava loucas', 'lava-loucas'], [m('Limpar filtro', 1)]],
  [['coifa', 'depurador'], [m('Limpar filtro da coifa', 1)]],
  [['aspirador'], [w('Esvaziar e limpar filtro', 2)]],
  [['extintor'], [m('Recarregar extintor', 12)]],
  [['aquecedor', 'boiler'], [m('Revisão do aquecedor', 12)]],
  [['piscina'], [w('Tratar a água da piscina', 1)]],
  [['moto'], [m('Revisão', 6), m('Trocar óleo', 3), w('Calibrar pneus', 2)]],
  [['carro', 'automovel', 'veiculo'], [m('Revisão', 12), m('Trocar óleo', 6), w('Calibrar pneus', 2)]],
];

const BY_CATEGORY: Partial<Record<EquipmentCategory, MaintenanceSuggestion[]>> = {
  climatizacao: [m('Limpar filtros', 1), m('Higienização completa', 6)],
  veiculo: [m('Revisão', 12), m('Trocar óleo', 6), w('Calibrar pneus', 2)],
  hidraulica: [m('Verificar vazamentos', 6)],
  seguranca: [m('Testar e revisar', 12)],
};

/** Manutenções usuais para o aparelho, sem as que já estão cadastradas. */
export function suggestMaintenance(name: string, category: string, existingTitles: string[]): MaintenanceSuggestion[] {
  const text = ` ${normalizeSearch(name).replace(/[^a-z0-9-]+/g, ' ')} `;
  // Palavra inteira, ou começo de palavra para termos longos (plural: "extintores").
  const hit = (k: string) => text.includes(` ${k} `) || (k.length >= 5 && text.includes(` ${k}`));
  const match = BY_KEYWORD.find(([keywords]) => keywords.some(hit));
  const suggestions = match?.[1] ?? BY_CATEGORY[category as EquipmentCategory] ?? [];
  const existing = new Set(existingTitles.map(normalizeSearch));
  return suggestions.filter((s) => !existing.has(normalizeSearch(s.title)));
}

/** Primeira data de uma manutenção nova: um intervalo a partir de hoje. */
export function firstMaintenanceDate(suggestion: MaintenanceSuggestion, today: string): string {
  return suggestion.recurrence === 'monthly'
    ? addMonths(today, suggestion.interval)
    : addDays(today, (suggestion.recurrence === 'weekly' ? 7 : 1) * suggestion.interval);
}

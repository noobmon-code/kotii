import { describe, expect, it } from '@jest/globals';

import { addMonths } from '../dates';
import { describeDocumentStatus, documentsNeedingAttention, documentStatus, getDocumentKind } from '../documents';
import {
  describeWarranty,
  firstMaintenanceDate,
  getEquipmentCategory,
  suggestMaintenance,
  warrantyStatus,
} from '../equipment';

describe('addMonths', () => {
  it('clamps to the last day of shorter months and crosses years', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-09-26', 12)).toBe('2027-09-26');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
  });
});

describe('equipment', () => {
  it('classifies the warranty', () => {
    expect(warrantyStatus(null, '2026-09-26')).toEqual({ kind: 'sem_garantia' });
    expect(warrantyStatus('2026-09-20', '2026-09-26')).toEqual({ kind: 'vencida', days: 6 });
    expect(warrantyStatus('2026-10-10', '2026-09-26')).toEqual({ kind: 'acabando', days: 14 });
    expect(describeWarranty(warrantyStatus('2027-09-26', '2026-09-26'))).toBe('Garantia por mais 12 meses');
    expect(describeWarranty({ kind: 'acabando', days: 1 })).toBe('Garantia acaba amanhã');
  });

  it('suggests maintenance by name, then by category, skipping what exists', () => {
    expect(suggestMaintenance('Ar-condicionado do quarto', 'outros', []).map((s) => s.title)).toEqual([
      'Limpar filtros',
      'Higienização completa',
    ]);
    expect(suggestMaintenance("Caixa d'água", 'outros', [])[0]).toEqual({
      title: 'Limpar caixa d’água',
      recurrence: 'monthly',
      interval: 6,
    });
    expect(suggestMaintenance('Extintores da garagem', 'outros', []).map((s) => s.title)).toEqual(['Recarregar extintor']);
    expect(suggestMaintenance('Moto', 'outros', []).map((s) => s.title)).toContain('Trocar óleo');
    expect(suggestMaintenance('Motor do portão', 'eletrica', [])).toEqual([]);
    expect(suggestMaintenance('Corolla', 'veiculo', ['revisao']).map((s) => s.title)).toEqual(['Trocar óleo', 'Calibrar pneus']);
    expect(getEquipmentCategory('nave').key).toBe('outros');
    expect(firstMaintenanceDate({ title: 'x', recurrence: 'monthly', interval: 6 }, '2026-08-31')).toBe('2027-02-28');
    expect(firstMaintenanceDate({ title: 'x', recurrence: 'weekly', interval: 2 }, '2026-09-26')).toBe('2026-10-10');
  });
});

describe('documents', () => {
  it('warns inside the chosen window', () => {
    expect(documentStatus(null, 30, '2026-09-26')).toEqual({ kind: 'sem_validade' });
    expect(documentStatus('2026-10-10', 30, '2026-09-26')).toEqual({ kind: 'renovar', days: 14 });
    expect(documentStatus('2026-10-10', 7, '2026-09-26')).toEqual({ kind: 'valido', days: 14 });
    expect(documentStatus('2026-09-20', 30, '2026-09-26')).toEqual({ kind: 'vencido', days: 6 });
    expect(describeDocumentStatus({ kind: 'valido', days: 90 }, '2026-12-25')).toBe('Válido até 25/12/2026');
    expect(getDocumentKind('passaporte').remindDays).toBe(180);
  });

  it('lists what needs attention, most urgent first', () => {
    const docs = [
      { id: 'a', expires_on: '2027-06-01', remind_days: 30 },
      { id: 'b', expires_on: '2026-10-20', remind_days: 60 },
      { id: 'c', expires_on: '2026-09-01', remind_days: 30 },
      { id: 'd', expires_on: null, remind_days: 30 },
    ];
    expect(documentsNeedingAttention(docs, '2026-09-26').map((d) => d.document.id)).toEqual(['c', 'b']);
  });
});

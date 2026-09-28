import { describe, expect, it } from '@jest/globals';

import {
  defaultTaxYear,
  formatTaxDoc,
  isValidCNPJ,
  isValidCPF,
  medicalExpenseReport,
  parseTaxDoc,
  reportText,
  type MedicalEntry,
} from '../incomeTax';

const entry = (partial: Partial<MedicalEntry>): MedicalEntry => ({
  id: 'e',
  refId: 'e',
  source: 'gasto',
  date: '2026-03-10',
  amount: 100,
  description: 'Consulta',
  providerName: null,
  providerDoc: null,
  patientName: null,
  ...partial,
});

describe('CPF e CNPJ', () => {
  it('confere os dígitos verificadores', () => {
    expect(isValidCPF('529.982.247-25')).toBe(true);
    expect(isValidCPF('529.982.247-24')).toBe(false);
    expect(isValidCPF('111.111.111-11')).toBe(false);
    expect(isValidCNPJ('11.222.333/0001-81')).toBe(true);
    expect(isValidCNPJ('11.222.333/0001-80')).toBe(false);
  });

  it('lê o que foi digitado e formata', () => {
    expect(parseTaxDoc(' 529.982.247-25 ')).toBe('52998224725');
    expect(parseTaxDoc('')).toBeNull();
    expect(parseTaxDoc('123')).toBeUndefined();
    expect(formatTaxDoc('52998224725')).toBe('529.982.247-25');
    expect(formatTaxDoc('11222333000181')).toBe('11.222.333/0001-81');
  });
});

describe('medicalExpenseReport', () => {
  const entries = [
    entry({ id: 'a', amount: 350, providerName: 'Dra. Paula', providerDoc: '52998224725', patientName: 'Lia', date: '2026-08-12' }),
    entry({ id: 'b', amount: 350, providerName: 'Paula (pediatra)', providerDoc: '52998224725', patientName: 'Théo', date: '2026-02-03' }),
    entry({ id: 'c', source: 'conta', amount: 980.5, description: 'Plano de saúde', providerName: 'Unimed', providerDoc: '11222333000181' }),
    entry({ id: 'd', amount: 120, description: 'Exame de sangue', providerName: 'Lab Vida' }),
    entry({ id: 'e', amount: 999, date: '2025-12-30' }),
  ];

  it('junta por CPF/CNPJ (ou nome, com o mais recente), soma o ano e conta os sem documento', () => {
    const report = medicalExpenseReport(entries, 2026);
    expect(report.total).toBe(1800.5);
    expect(report.missingDoc).toBe(1);
    expect(report.groups.map((g) => [g.name, g.total, g.patients])).toEqual([
      ['Unimed', 980.5, []],
      ['Dra. Paula', 700, ['Théo', 'Lia']],
      ['Lab Vida', 120, []],
    ]);
    expect(report.groups[1].entries.map((e) => e.id)).toEqual(['b', 'a']);
  });

  it('monta o texto para copiar', () => {
    const text = reportText(medicalExpenseReport(entries, 2026));
    expect(text).toContain('Despesas médicas 2026 — total R$ 1.800,50');
    expect(text).toContain('Dra. Paula — 529.982.247-25 — R$ 700,00');
    expect(text).toContain('  Paciente: Théo, Lia');
    expect(text).toContain('Lab Vida — SEM CPF/CNPJ — R$ 120,00');
  });

  it('escolhe o ano da declaração', () => {
    expect(defaultTaxYear('2026-04-10')).toBe(2025);
    expect(defaultTaxYear('2026-09-27')).toBe(2026);
  });
});

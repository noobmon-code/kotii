// Despesas médicas para o Imposto de Renda: junta o que a casa marcou como
// dedutível (gastos de saúde e contas como o plano) no ano, por quem atendeu
// — é assim que a declaração pede, com o CPF ou CNPJ de cada um.

import { formatBRDate } from './dates';
import { formatBRL } from './money';

const onlyDigits = (text: string) => text.replace(/\D/g, '');

function checkDigit(digits: string, weights: number[]): number {
  const sum = weights.reduce((total, weight, i) => total + Number(digits[i]) * weight, 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function isValidCPF(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const first = checkDigit(d, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(d, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === Number(d[9]) && second === Number(d[10]);
}

export function isValidCNPJ(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const first = checkDigit(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(d, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === Number(d[12]) && second === Number(d[13]);
}

/**
 * CPF ou CNPJ digitado → só dígitos; '' vira null. `undefined` quando não é
 * um documento válido (quem chama avisa a pessoa).
 */
export function parseTaxDoc(value: string): string | null | undefined {
  const d = onlyDigits(value);
  if (!d) return null;
  return isValidCPF(d) || isValidCNPJ(d) ? d : undefined;
}

/** "529.982.247-25" ou "11.222.333/0001-81". */
export function formatTaxDoc(doc: string): string {
  const d = onlyDigits(doc);
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  return doc;
}

export interface MedicalEntry {
  id: string;
  /** O gasto ou a conta, para abrir. */
  refId: string;
  source: 'gasto' | 'conta';
  /** AAAA-MM-DD */
  date: string;
  amount: number;
  description: string;
  providerName: string | null;
  providerDoc: string | null;
  patientName: string | null;
}

export interface ProviderGroup {
  key: string;
  name: string;
  doc: string | null;
  total: number;
  patients: string[];
  entries: MedicalEntry[];
}

export interface MedicalReport {
  year: number;
  total: number;
  groups: ProviderGroup[];
  /** Grupos sem CPF/CNPJ: a declaração não aceita sem. */
  missingDoc: number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export function medicalExpenseReport(entries: MedicalEntry[], year: number): MedicalReport {
  const groups = new Map<string, ProviderGroup>();
  const inYear = entries.filter((e) => e.date.startsWith(`${year}-`)).sort((a, b) => a.date.localeCompare(b.date));
  for (const entry of inYear) {
    const name = entry.providerName?.trim() || entry.description.trim();
    // Mesmo CPF/CNPJ é o mesmo prestador, com qualquer nome (vale o mais recente);
    // sem documento, junta pelo nome.
    const key = entry.providerDoc ?? `nome:${name.toLocaleLowerCase('pt-BR')}`;
    const group = groups.get(key) ?? { key, name, doc: entry.providerDoc, total: 0, patients: [], entries: [] };
    group.name = name;
    group.total = round2(group.total + entry.amount);
    if (entry.patientName && !group.patients.includes(entry.patientName)) group.patients.push(entry.patientName);
    group.entries.push(entry);
    groups.set(key, group);
  }
  const list = [...groups.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'pt-BR'));
  return {
    year,
    total: round2(list.reduce((sum, g) => sum + g.total, 0)),
    groups: list,
    missingDoc: list.filter((g) => !g.doc).length,
  };
}

/** Até maio (prazo da declaração), o ano passado; depois, o ano em curso. */
export function defaultTaxYear(today: string): number {
  const [year, month] = today.split('-').map(Number);
  return month <= 5 ? year - 1 : year;
}

/** Texto para copiar e ter à mão ao preencher a declaração. */
export function reportText(report: MedicalReport): string {
  const lines = [`Despesas médicas ${report.year} — total ${formatBRL(report.total)}`, ''];
  for (const g of report.groups) {
    lines.push(`${g.name} — ${g.doc ? formatTaxDoc(g.doc) : 'SEM CPF/CNPJ'} — ${formatBRL(g.total)}`);
    if (g.patients.length) lines.push(`  Paciente: ${g.patients.join(', ')}`);
    for (const e of g.entries) lines.push(`  ${formatBRDate(e.date)} · ${e.description} · ${formatBRL(e.amount)}`);
  }
  return lines.join('\n');
}

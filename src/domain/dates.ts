// Datas "de calendário" (YYYY-MM-DD) no fuso do aparelho. A aritmética é feita
// em UTC para não sofrer com horário de verão.

const DAY_MS = 86_400_000;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function toISODate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayISO(now: Date = new Date()): string {
  return toISODate(now);
}

function toUTC(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(iso: string, days: number): string {
  return fromUTC(toUTC(iso) + days * DAY_MS);
}

/** Soma meses; dia que não existe no mês final vira o último dia (31/01 + 1 = 28/02). */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(Math.min(d, lastDay))}`;
}

/** Dias de `from` até `to` (positivo se `to` é depois). */
export function diffDays(from: string, to: string): number {
  return Math.round((toUTC(to) - toUTC(from)) / DAY_MS);
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** "26 set" ou "26 set 2027" quando fora do ano de referência. */
export function formatShortDate(iso: string, referenceYear = new Date().getFullYear()): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const base = `${d} ${MONTHS[m - 1]}`;
  return y === referenceYear ? base : `${base} ${y}`;
}

export function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return fromUTC(toUTC(value)) === value;
}

/** "2026-12-20" -> "20/12/2026" */
export function formatBRDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** "20/12/2026" ou "20/12/26" -> "2026-12-20"; null se inválida. */
export function parseBRDate(value: string): string | null {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return null;
  const [, d, m, y] = match;
  const year = y.length === 2 ? `20${y}` : y;
  const iso = `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  return isValidISODate(iso) ? iso : null;
}

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

/**
 * Máscara de data enquanto digita: "20122026" vira "20/12/2026", com a barra
 * aparecendo sozinha depois do dia e do mês. Dia de 4 a 9 e mês de 2 a 9 já
 * ganham o zero ("5" vira "05/"), porque não há outra leitura; uma barra
 * digitada também fecha o campo ("1/" vira "01/"). Colar "1/3/2026" ou
 * "2026-03-01" vale, inclusive por cima de uma data que já estava lá.
 * `previous` é o valor anterior: apagando, a barra automática não volta.
 */
export function maskBRDate(next: string, previous = ''): string {
  const pasted = next.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (pasted) return `${pasted[3]}/${pasted[2]}/${pasted[1]}`;
  // Digitar e apagar mexem só no fim; o resto (colar, trocar a seleção,
  // editar no meio) conta como texto novo, com cada parte valendo como está.
  const deleting = next.length < previous.length && previous.startsWith(next);
  const typing = next.length === previous.length + 1 && next.startsWith(previous);
  const pasting = !deleting && !typing;
  const parts = next.split('/');
  let digits = '';
  parts.forEach((part, index) => {
    const d = part.replace(/\D/g, '');
    // Só a barra recém-digitada (ou colada) completa o dia ou o mês com zero.
    const closing = pasting ? index < parts.length - 1 : index === parts.length - 2 && next.endsWith('/');
    digits += closing && d.length === 1 && (digits.length === 0 || digits.length === 2) ? `0${d}` : d;
  });
  if (!deleting) {
    if (digits.length === 1 && Number(digits) > 3) digits = `0${digits}`;
    else if (digits.length === 3 && Number(digits[2]) > 1) digits = `${digits.slice(0, 2)}0${digits[2]}`;
  }
  digits = digits.slice(0, 8);
  const text = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('/');
  return !deleting && (digits.length === 2 || digits.length === 4) ? `${text}/` : text;
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

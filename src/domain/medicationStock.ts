// Estoque e receita dos remédios de uso contínuo: quanto ainda tem, quando a
// caixa acaba e quando a receita vence.
//
// O que sobra é uma ESTIMATIVA pelo horário das doses, não pelas marcações
// (quem toma remédio todo dia não marca toda dose): a pessoa conta as
// unidades num dia e, dali em diante, cada dose prevista (a mesma regra de
// takesOn: regularidade, horários, início e fim) gasta "cada dose usa". O dia
// da contagem não desconta nada (a conta foi feita depois das doses dele), e
// o que sobra "hoje" é o que fica depois das doses de hoje. Por isso os textos
// dizem "pelas contas do app".

import { addDays, diffDays, formatBRDate, parseBRDate } from './dates';
import { dosesLeft, takesOn, type MedicationSchedule } from './medications';
import { parseDecimal } from './money';

export interface StockedMedication extends MedicationSchedule {
  /** Unidades contadas (comprimidos, cápsulas, doses); null ou ausente: o app não acompanha o estoque. */
  stockCount?: number | null;
  /** O dia em que foram contadas. */
  stockCountedOn?: string | null;
  /** Unidades que cada dose usa (padrão 1). */
  doseUnits?: number | null;
  /** Com quantos dias de antecedência avisar que está acabando (padrão 7). */
  warnDays?: number | null;
  /** Até quando a receita vale; não depende do estoque. */
  prescriptionUntil?: string | null;
}

export const DEFAULT_DOSE_UNITS = 1;
export const DEFAULT_WARN_DAYS = 7;
export const MIN_WARN_DAYS = 1;
export const MAX_WARN_DAYS = 60;
/** A receita aparece no app a partir de tantos dias antes de vencer. */
export const PRESCRIPTION_WARN_DAYS = 15;
/** E avisa por notificação uma semana antes (e no dia). */
export const PRESCRIPTION_REMINDER_DAYS = 7;
/** Até onde a conta anda, dia a dia; estoque para mais que isso é "mais de 3 anos". */
export const ESTIMATE_HORIZON_DAYS = 3 * 365;
const MAX_STOCK = 99_999;
const MAX_DOSE_UNITS = 1000;

const doseUnitsOf = (m: StockedMedication) => (m.doseUnits && m.doseUnits > 0 ? m.doseUnits : DEFAULT_DOSE_UNITS);
const warnDaysOf = (m: StockedMedication) =>
  Math.min(MAX_WARN_DAYS, Math.max(MIN_WARN_DAYS, Math.round(m.warnDays ?? DEFAULT_WARN_DAYS)));
// Meio comprimido somado muitas vezes: sem arredondar, 0,1 + 0,2 não fecha.
const round = (units: number) => Math.round(units * 10_000) / 10_000;

/** Tratamento que já acabou (encerrado, passou do fim ou todas as doses tomadas): não tem estoque nem receita a avisar. */
export function treatmentOver(m: MedicationSchedule, today: string): boolean {
  return !m.active || Boolean(m.endOn && m.endOn < today) || dosesLeft(m) === 0;
}

export interface StockEstimate {
  /** O que sobra depois das doses de hoje (nunca negativo; pode ser menos que uma dose). */
  unitsLeft: number;
  /**
   * O dia da última dose inteira que o estoque cobre (o da contagem, se não
   * cobre nenhuma). null: o estoque não acaba, porque o tratamento termina
   * antes (`ends: 'treatment'`) ou porque dá para mais do que a conta alcança
   * (`ends: 'far'`).
   */
  runsOutOn: string | null;
  /** Dias de hoje até lá (negativo: já passou). */
  daysLeft: number | null;
  ends: 'stock' | 'treatment' | 'far';
}

/** A conta do estoque; null se o app não acompanha o estoque deste remédio (ou o tratamento foi encerrado). */
export function estimateStock(m: StockedMedication, today: string): StockEstimate | null {
  if (m.stockCount == null || !m.stockCountedOn || !m.active) return null;
  const perDose = doseUnitsOf(m);
  const counted = m.stockCountedOn;
  let left = Math.max(0, m.stockCount);
  // O que sobra depois das doses de hoje: acompanha a conta até ela passar de hoje.
  let unitsLeft = left;
  let lastFull: string | null = null;
  // Num tratamento por número de doses, de amanhã em diante só as que faltam
  // (até hoje vale o horário: as marcações não entram na conta).
  let courseLeft = dosesLeft(m) ?? Infinity;
  const done = (ends: StockEstimate['ends']): StockEstimate => {
    const runsOutOn = ends === 'stock' ? (lastFull ?? counted) : null;
    return { unitsLeft, runsOutOn, daysLeft: runsOutOn ? diffDays(today, runsOutOn) : null, ends };
  };
  const horizon = addDays(today > counted ? today : counted, ESTIMATE_HORIZON_DAYS);
  for (let date = addDays(counted, 1); date <= horizon; date = addDays(date, 1)) {
    if (m.endOn && date > m.endOn) return done('treatment');
    if (takesOn(m, date)) {
      for (let dose = 0; dose < m.times.length; dose += 1) {
        if (date > today) {
          if (courseLeft <= 0) return done('treatment');
          courseLeft -= 1;
        }
        if (left < perDose) return done('stock');
        left = round(left - perDose);
        lastFull = date;
        if (date <= today) unitsLeft = left;
      }
    }
  }
  return done('far');
}

export type StockStatus =
  | { kind: 'none' }
  /** Tem bastante: nada nas listas, só a frase na tela do remédio. */
  | { kind: 'plenty'; estimate: StockEstimate }
  /** Acaba dentro dos dias de aviso. */
  | { kind: 'low'; estimate: StockEstimate; daysLeft: number; runsOutOn: string }
  /** Pelas contas, já acabou (o app não sabe: pode ter sido comprado sem registrar). */
  | { kind: 'out'; estimate: StockEstimate; ranOutOn: string };

export function stockStatus(m: StockedMedication, today: string): StockStatus {
  if (treatmentOver(m, today)) return { kind: 'none' };
  const estimate = estimateStock(m, today);
  if (!estimate) return { kind: 'none' };
  const { runsOutOn, daysLeft } = estimate;
  if (runsOutOn === null || daysLeft === null) return { kind: 'plenty', estimate };
  if (daysLeft < 0) return { kind: 'out', estimate, ranOutOn: runsOutOn };
  return daysLeft <= warnDaysOf(m) ? { kind: 'low', estimate, daysLeft, runsOutOn } : { kind: 'plenty', estimate };
}

export type PrescriptionStatus =
  | { kind: 'none' }
  | { kind: 'soon'; days: number; until: string }
  | { kind: 'today'; until: string }
  | { kind: 'expired'; until: string };

export function prescriptionStatus(m: StockedMedication, today: string): PrescriptionStatus {
  const until = m.prescriptionUntil;
  if (!until || treatmentOver(m, today)) return { kind: 'none' };
  const days = diffDays(today, until);
  if (days < 0) return { kind: 'expired', until };
  if (days === 0) return { kind: 'today', until };
  return days <= PRESCRIPTION_WARN_DAYS ? { kind: 'soon', days, until } : { kind: 'none' };
}

/** "em 3 dias", "amanhã", "hoje". */
const inDays = (days: number) => (days === 0 ? 'hoje' : days === 1 ? 'amanhã' : `em ${days} dias`);

/** "12/11", ou com o ano quando não é o de hoje. */
function dayMonth(iso: string, today: string): string {
  const full = formatBRDate(iso);
  return iso.slice(0, 4) === today.slice(0, 4) ? full.slice(0, 5) : full;
}

/** Remédio e de quem é, como o app escreve nas outras listas: "Losartana (Ana)". */
export const medicationWho = (m: Pick<MedicationSchedule, 'name' | 'personName'>) => `${m.name} (${m.personName})`;

/** A frase do estoque na tela do remédio; null se o app não o acompanha. */
export function describeStock(status: StockStatus, today: string): string | null {
  switch (status.kind) {
    case 'none':
      return null;
    case 'out':
      return `Deve ter acabado em ${dayMonth(status.ranOutOn, today)}, pelas contas do app.`;
    case 'low':
      return status.daysLeft > 1
        ? `Acaba em ${status.daysLeft} dias (${dayMonth(status.runsOutOn, today)}), pelas contas do app.`
        : `Acaba ${inDays(status.daysLeft)}, pelas contas do app.`;
    case 'plenty': {
      const { runsOutOn, daysLeft, ends } = status.estimate;
      if (runsOutOn && daysLeft !== null) return `Dá para mais ${daysLeft} dias (até ${dayMonth(runsOutOn, today)}), pelas contas do app.`;
      return ends === 'treatment' ? 'Dá para o tratamento todo, pelas contas do app.' : 'Dá para mais de 3 anos, pelas contas do app.';
    }
  }
}

/** A frase da receita na tela do remédio; null enquanto falta mais que PRESCRIPTION_WARN_DAYS. */
export function describePrescription(status: PrescriptionStatus, today: string): string | null {
  switch (status.kind) {
    case 'none':
      return null;
    case 'expired':
      return `A receita venceu em ${dayMonth(status.until, today)}.`;
    case 'today':
      return 'A receita vence hoje.';
    case 'soon':
      return status.days > 1 ? `A receita vence em ${status.days} dias (${dayMonth(status.until, today)}).` : 'A receita vence amanhã.';
  }
}

/** O que pede atenção num remédio: a caixa acabando (ou acabada) e a receita vencendo (ou vencida). */
export interface RefillAlert {
  about: 'stock' | 'prescription';
  /** O texto do selo: "Acaba em 3 dias", "Deve ter acabado", "Receita vence hoje". */
  label: string;
  tone: 'warning' | 'danger';
  /** Dias até acontecer (negativo: já passou), para ordenar. */
  days: number;
}

/** Os avisos de um remédio, o mais urgente primeiro (o que já passou; depois o estoque antes da receita). */
export function refillAlerts(m: StockedMedication, today: string): RefillAlert[] {
  const alerts: RefillAlert[] = [];
  const stock = stockStatus(m, today);
  if (stock.kind === 'out') alerts.push({ about: 'stock', label: 'Deve ter acabado', tone: 'danger', days: diffDays(today, stock.ranOutOn) });
  if (stock.kind === 'low') alerts.push({ about: 'stock', label: `Acaba ${inDays(stock.daysLeft)}`, tone: 'warning', days: stock.daysLeft });
  const prescription = prescriptionStatus(m, today);
  if (prescription.kind === 'expired') {
    alerts.push({ about: 'prescription', label: 'Receita vencida', tone: 'danger', days: diffDays(today, prescription.until) });
  }
  if (prescription.kind === 'today') alerts.push({ about: 'prescription', label: 'Receita vence hoje', tone: 'warning', days: 0 });
  if (prescription.kind === 'soon') {
    alerts.push({ about: 'prescription', label: `Receita vence ${inDays(prescription.days)}`, tone: 'warning', days: prescription.days });
  }
  // A ordem de entrada (estoque, receita) desempata.
  return alerts.sort((a, b) => Number(b.tone === 'danger') - Number(a.tone === 'danger'));
}

/** O selo do remédio nas listas: o aviso mais urgente; null se não há nenhum. */
export function refillBadge(m: StockedMedication, today: string): RefillAlert | null {
  return refillAlerts(m, today)[0] ?? null;
}

/** O nome que vai para a lista da farmácia: o remédio e a dose ("Losartana 50mg (1 comprimido)"). */
export function pharmacyItemName(m: Pick<MedicationSchedule, 'name' | 'dosage'>): string {
  const dosage = m.dosage?.trim();
  return dosage ? `${m.name.trim()} (${dosage})` : m.name.trim();
}

/** Uma linha da tela Hoje: um remédio com a caixa acabando ou a receita vencendo. */
export interface RefillRow {
  id: string;
  /** "Losartana (Ana)". */
  title: string;
  /** Os selos do remédio, o mais urgente primeiro: "Acaba em 3 dias", "Receita vence em 10 dias". */
  alerts: RefillAlert[];
  /** O item que "Pôr na lista da farmácia" cria. */
  itemName: string;
}

/** O que a tela Hoje lista: um remédio por linha, só os que pedem atenção, o mais urgente primeiro. */
export function refillRows(medications: StockedMedication[], today: string): RefillRow[] {
  const soonest = (row: RefillRow) => Math.min(...row.alerts.map((a) => a.days));
  return medications
    .map((m): RefillRow => ({ id: m.id, title: medicationWho(m), alerts: refillAlerts(m, today), itemName: pharmacyItemName(m) }))
    .filter((row) => row.alerts.length > 0)
    .sort(
      (a, b) =>
        Number(b.alerts[0].tone === 'danger') - Number(a.alerts[0].tone === 'danger') ||
        soonest(a) - soonest(b) ||
        a.title.localeCompare(b.title),
    );
}

/** As linhas do Nuke: "Losartana (Ana) — acaba em 3 dias, receita vence em 10 dias". */
export function refillLines(medications: StockedMedication[], today: string): string[] {
  return refillRows(medications, today).map((row) => `${row.title} — ${row.alerts.map((a) => a.label.toLowerCase()).join(', ')}`);
}

/** Um aviso por notificação (o plano dos avisos da casa põe o horário e a janela). */
export interface RefillReminder {
  /** Remédio e assunto: a caixa e a receita do mesmo remédio podem avisar no mesmo dia. */
  id: string;
  date: string;
  title: string;
  body: string;
}

/**
 * Os avisos de cada remédio: quando faltam os dias escolhidos para a caixa
 * acabar e no dia em que acaba; uma semana antes de a receita vencer e no dia.
 * Remédio sem estoque acompanhado só avisa a receita; o que já acabou (pelas
 * contas) não avisa de novo.
 */
export function refillReminders(medications: StockedMedication[], today: string): RefillReminder[] {
  const out: RefillReminder[] = [];
  for (const m of medications) {
    if (treatmentOver(m, today)) continue;
    const who = medicationWho(m);
    const stock = stockStatus(m, today);
    const runsOutOn = stock.kind === 'low' ? stock.runsOutOn : stock.kind === 'plenty' ? stock.estimate.runsOutOn : null;
    if (runsOutOn) {
      const warn = warnDaysOf(m);
      out.push(
        { id: m.id, date: addDays(runsOutOn, -warn), title: 'Remédio acabando', body: `${who} acaba ${inDays(warn)}.` },
        { id: m.id, date: runsOutOn, title: 'Remédio acaba hoje', body: `${who} acaba hoje, pelas contas do app.` },
      );
    }
    const until = m.prescriptionUntil;
    if (until && until >= today) {
      const id = `${m.id}@receita`;
      out.push(
        {
          id,
          date: addDays(until, -PRESCRIPTION_REMINDER_DAYS),
          title: 'Receita vencendo',
          body: `A receita de ${who} vence ${inDays(PRESCRIPTION_REMINDER_DAYS)} (${formatBRDate(until)}).`,
        },
        { id, date: until, title: 'Receita vence hoje', body: `A receita de ${who} vence hoje.` },
      );
    }
  }
  return out;
}

/** O que muda no banco quando o estoque é contado de novo. */
export interface StockCount {
  stockCount: number;
  stockCountedOn: string;
}

/**
 * "Comprei mais": o que a conta diz que sobra hoje, mais a caixa nova,
 * contado de novo hoje. Sem estoque acompanhado, começa pela caixa.
 */
export function restock(m: StockedMedication, today: string, boxUnits: number): StockCount {
  const left = estimateStock(m, today)?.unitsLeft ?? 0;
  return { stockCount: round(left + Math.max(0, boxUnits)), stockCountedOn: today };
}

type Rule = Pick<MedicationSchedule, 'times' | 'startOn' | 'endOn' | 'frequency' | 'weekdays' | 'intervalDays'>;

/** A regra das doses, para comparar: horários, regularidade, início e fim. */
const ruleKey = (m: Rule) =>
  JSON.stringify([
    [...m.times].sort(),
    m.frequency ?? 'daily',
    m.weekdays ? [...m.weekdays].sort((a, b) => a - b) : null,
    m.intervalDays ?? null,
    m.startOn,
    m.endOn ?? null,
  ]);

/**
 * A regra das doses (ou quanto cada dose usa) mudou num remédio com o estoque
 * acompanhado: o que foi gasto até hoje foi pela regra de antes. A contagem
 * passa a ser o que sobrava hoje por ela, contado hoje, e a regra nova vale
 * de amanhã em diante. Sem isso a mudança valeria para trás, e o estoque
 * pularia sem ninguém ter contado nada. `changes` é o que a seção do estoque
 * já muda (readStockForm): se a pessoa contou de novo, vale o que ela contou.
 */
export function keepStockOnRuleChange(changes: StockChanges, before: StockedMedication | undefined, after: Rule, today: string): StockChanges {
  if (!before || changes.stockCount !== undefined) return changes;
  if (changes.doseUnits === undefined && ruleKey(before) === ruleKey(after)) return changes;
  const estimate = estimateStock(before, today);
  return estimate ? { ...changes, stockCount: estimate.unitsLeft, stockCountedOn: today } : changes;
}

/** "30", "12,5". */
export function formatUnits(units: number): string {
  return round(units).toLocaleString('pt-BR', { maximumFractionDigits: 2, useGrouping: false });
}

/** Unidades digitadas ("30", "12,5"); null se não for um número de 0 a 99.999. */
export function parseUnits(text: string): number | null {
  const value = parseDecimal(text);
  return value !== null && value <= MAX_STOCK ? value : null;
}

/** Os campos da seção "Estoque e receita", como texto. */
export interface StockForm {
  /** "Quanto tem agora"; vazio: o app não acompanha. */
  stock: string;
  /** "Cada dose usa". */
  doseUnits: string;
  /** "Avisar quando faltar" (dias). */
  warnDays: string;
  /** "Receita vale até", dd/mm/aaaa ou vazio. */
  prescription: string;
}

/**
 * Os campos como a tela os abre. "Quanto tem agora" vem com o que a conta diz
 * que sobra hoje, e não com o número contado lá atrás: salvar sem mexer nele
 * não recomeça a conta (ver readStockForm).
 */
export function stockFormOf(m: StockedMedication | undefined, today: string): StockForm {
  const estimate = m ? estimateStock(m, today) : null;
  return {
    stock: estimate ? formatUnits(estimate.unitsLeft) : m?.stockCount != null ? formatUnits(m.stockCount) : '',
    doseUnits: formatUnits(m ? doseUnitsOf(m) : DEFAULT_DOSE_UNITS),
    warnDays: String(m ? warnDaysOf(m) : DEFAULT_WARN_DAYS),
    prescription: m?.prescriptionUntil ? formatBRDate(m.prescriptionUntil) : '',
  };
}

/** O que a seção muda no remédio: só os campos em que a pessoa mexeu. */
export interface StockChanges {
  /** Com stockCountedOn: número novo, contado hoje; os dois null: parou de acompanhar. */
  stockCount?: number | null;
  stockCountedOn?: string | null;
  doseUnits?: number;
  warnDays?: number;
  prescriptionUntil?: string | null;
}

export type StockFormResult = { ok: true; changes: StockChanges } | { ok: false; title: string; message: string };

/**
 * Lê a seção ao salvar. Só entra o que mudou em relação a `initial` (os campos
 * como a tela abriu): "Quanto tem agora" intocado mantém a contagem e o dia
 * dela; mudado, vale como contado hoje; apagado, o app para de acompanhar.
 */
export function readStockForm(form: StockForm, initial: StockForm, today: string): StockFormResult {
  const changed = (field: keyof StockForm) => form[field].trim() !== initial[field].trim();
  const changes: StockChanges = {};
  if (changed('stock')) {
    const text = form.stock.trim();
    const count = text ? parseUnits(text) : null;
    if (text && count === null) {
      return { ok: false, title: 'Estoque inválido', message: 'Em "Quanto tem agora", informe um número, como 30 ou 12,5, ou deixe vazio.' };
    }
    changes.stockCount = count;
    changes.stockCountedOn = count === null ? null : today;
  }
  if (changed('doseUnits')) {
    const units = parseDecimal(form.doseUnits);
    if (units === null || units <= 0 || units > MAX_DOSE_UNITS) {
      return { ok: false, title: 'Dose inválida', message: 'Em "Cada dose usa", informe quantas unidades, como 1, 2 ou 0,5.' };
    }
    changes.doseUnits = units;
  }
  if (changed('warnDays')) {
    const days = Number(form.warnDays.trim());
    if (!Number.isInteger(days) || days < MIN_WARN_DAYS || days > MAX_WARN_DAYS) {
      return { ok: false, title: 'Aviso inválido', message: `Em "Avisar quando faltar", informe os dias, de ${MIN_WARN_DAYS} a ${MAX_WARN_DAYS}.` };
    }
    changes.warnDays = days;
  }
  if (changed('prescription')) {
    const text = form.prescription.trim();
    const until = text ? parseBRDate(text) : null;
    if (text && !until) {
      return { ok: false, title: 'Data inválida', message: 'Informe até quando a receita vale como dd/mm/aaaa, ou deixe vazio.' };
    }
    changes.prescriptionUntil = until;
  }
  return { ok: true, changes };
}

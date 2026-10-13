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
import { normalizeSearch } from './search';

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
/**
 * Caixa acabada (pelas contas) ou receita vencida há mais dias que isto, sem
 * ninguém atualizar: o app deixa de pedir atenção e mostra só um selo neutro.
 * Aviso vermelho que nunca sai ensina a casa a não olhar para ele.
 */
export const STALE_DAYS = 14;
/** Até onde a conta anda, dia a dia; estoque para mais que isso é "mais de 3 anos". */
export const ESTIMATE_HORIZON_DAYS = 3 * 365;
/**
 * As datas que o banco aceita no dia da contagem e em "Receita vale até" (os
 * checks da migração do estoque dizem o mesmo intervalo; um teste compara).
 */
export const MIN_STOCK_DATE = '2000-01-01';
export const MAX_STOCK_DATE = '2100-12-31';
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

/**
 * Num tratamento por número de doses, quantas o horário ainda prevê depois de
 * `day`: o total menos as previstas do início até esse dia (nunca menos que
 * zero). null: o tratamento não é por número de doses.
 */
function courseDosesAfter(m: MedicationSchedule, day: string): number | null {
  const total = m.totalDoses;
  if (!total) return null;
  let planned = 0;
  for (let date = m.startOn; date <= day && planned < total; date = addDays(date, 1)) {
    if (takesOn(m, date)) planned += m.times.length;
  }
  return Math.max(0, total - planned);
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
  // Dia da contagem que não é uma data, ou longe demais à frente de hoje (só
  // chega assim por fora do app): a conta, que anda dia a dia a partir dele,
  // não terminaria. Poucos dias à frente valem: é o relógio de outro aparelho.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(counted) || !(diffDays(today, counted) <= ESTIMATE_HORIZON_DAYS)) return null;
  let left = Math.max(0, m.stockCount);
  // O que sobra depois das doses de hoje: acompanha a conta até ela passar de hoje.
  let unitsLeft = left;
  let lastFull: string | null = null;
  // Num tratamento por número de doses, o horário só tem esse número de doses
  // do início ao fim: as que ele ainda prevê depois do dia da contagem são o
  // teto da conta inteira (um tratamento que já passou do fim pelo horário,
  // com doses sem marcar, não segue gastando o estoque). De amanhã em diante
  // vale também o que falta pelas marcações, menos as doses de hoje ainda sem
  // marcar (`takenToday`), que já saíram pelo horário: assim marcar uma dose de
  // hoje não muda o estado. Sem as marcações de hoje (não carregaram), só o
  // teto do horário impede contá-las de novo, e ele não basta quando as
  // marcações estão adiantadas (as vezes por dia diminuíram no meio do
  // tratamento): até elas carregarem, a conta pode gastar doses a mais.
  let scheduleLeft = courseDosesAfter(m, counted) ?? Infinity;
  const pendingToday = m.takenToday === undefined || !takesOn(m, today) ? 0 : Math.max(0, m.times.length - m.takenToday);
  let courseLeft = Math.max(0, (dosesLeft(m) ?? Infinity) - pendingToday);
  const done = (ends: StockEstimate['ends']): StockEstimate => {
    const runsOutOn = ends === 'stock' ? (lastFull ?? counted) : null;
    return { unitsLeft, runsOutOn, daysLeft: runsOutOn ? diffDays(today, runsOutOn) : null, ends };
  };
  const horizon = addDays(today > counted ? today : counted, ESTIMATE_HORIZON_DAYS);
  for (let date = addDays(counted, 1); date <= horizon; date = addDays(date, 1)) {
    if (m.endOn && date > m.endOn) return done('treatment');
    if (takesOn(m, date)) {
      for (let dose = 0; dose < m.times.length; dose += 1) {
        if (scheduleLeft <= 0) return done('treatment');
        if (date > today) {
          if (courseLeft <= 0) return done('treatment');
          courseLeft -= 1;
        }
        scheduleLeft -= 1;
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
  /**
   * Pelas contas, já acabou (o app não sabe: pode ter sido comprado sem
   * registrar). `ranOutOn` é o dia da última dose que a caixa cobriu, ou o da
   * contagem, se ela não cobria nem a dose seguinte.
   */
  | { kind: 'out'; estimate: StockEstimate; ranOutOn: string }
  /** Acabou há mais de STALE_DAYS e ninguém atualizou: não pede mais atenção. */
  | { kind: 'stale'; estimate: StockEstimate; ranOutOn: string };

export function stockStatus(m: StockedMedication, today: string): StockStatus {
  if (treatmentOver(m, today)) return { kind: 'none' };
  const estimate = estimateStock(m, today);
  if (!estimate) return { kind: 'none' };
  const { runsOutOn, daysLeft } = estimate;
  if (runsOutOn === null || daysLeft === null) return { kind: 'plenty', estimate };
  // A conta parou no dia da contagem: o que há não cobre nem a próxima dose.
  // Já acabou, no próprio dia também (quem escreveu 0 não lê "acaba hoje").
  if (daysLeft < 0 || runsOutOn === m.stockCountedOn) {
    return { kind: -daysLeft > STALE_DAYS ? 'stale' : 'out', estimate, ranOutOn: runsOutOn };
  }
  return daysLeft <= warnDaysOf(m) ? { kind: 'low', estimate, daysLeft, runsOutOn } : { kind: 'plenty', estimate };
}

export type PrescriptionStatus =
  | { kind: 'none' }
  | { kind: 'soon'; days: number; until: string }
  | { kind: 'today'; until: string }
  | { kind: 'expired'; until: string }
  /** Venceu há mais de STALE_DAYS e ninguém atualizou: não pede mais atenção. */
  | { kind: 'stale'; until: string };

export function prescriptionStatus(m: StockedMedication, today: string): PrescriptionStatus {
  const until = m.prescriptionUntil;
  if (!until || treatmentOver(m, today)) return { kind: 'none' };
  const days = diffDays(today, until);
  if (days < -STALE_DAYS) return { kind: 'stale', until };
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
      // No dia em que foi contado (o que há não cobre a próxima dose), não há "acabou em" a dizer.
      return status.ranOutOn < today
        ? `Deve ter acabado em ${dayMonth(status.ranOutOn, today)}, pelas contas do app.`
        : 'Sem estoque para a próxima dose, pelas contas do app.';
    case 'stale':
      // A saída está nesta tela: contar de novo ou parar de acompanhar.
      return `Estoque sem atualizar desde ${dayMonth(status.ranOutOn, today)}. Escreva quanto tem agora, ou apague o número para o app parar de acompanhar.`;
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
    case 'stale':
      return `A receita venceu em ${dayMonth(status.until, today)}.`;
    case 'today':
      return 'A receita vence hoje.';
    case 'soon':
      return status.days > 1 ? `A receita vence em ${status.days} dias (${dayMonth(status.until, today)}).` : 'A receita vence amanhã.';
  }
}

/** O que há a dizer de um remédio: a caixa acabando (ou acabada) e a receita vencendo (ou vencida). */
export interface RefillAlert {
  about: 'stock' | 'prescription';
  /** O texto do selo: "Acaba em 3 dias", "Deve ter acabado", "Receita vence hoje", "Estoque sem atualizar desde 04/10". */
  label: string;
  /** 'neutral': parado há mais de STALE_DAYS; fica só como selo, sem pedir atenção. */
  tone: 'warning' | 'danger' | 'neutral';
  /** Dias até acontecer (negativo: já passou), para ordenar. */
  days: number;
}

const TONE_ORDER: RefillAlert['tone'][] = ['danger', 'warning', 'neutral'];

/** Os avisos de um remédio, o mais urgente primeiro (o que já passou; depois o estoque antes da receita; o que parou, por último). */
export function refillAlerts(m: StockedMedication, today: string): RefillAlert[] {
  const alerts: RefillAlert[] = [];
  const stock = stockStatus(m, today);
  if (stock.kind === 'out') alerts.push({ about: 'stock', label: 'Deve ter acabado', tone: 'danger', days: diffDays(today, stock.ranOutOn) });
  if (stock.kind === 'stale') {
    const label = `Estoque sem atualizar desde ${dayMonth(stock.ranOutOn, today)}`;
    alerts.push({ about: 'stock', label, tone: 'neutral', days: diffDays(today, stock.ranOutOn) });
  }
  if (stock.kind === 'low') alerts.push({ about: 'stock', label: `Acaba ${inDays(stock.daysLeft)}`, tone: 'warning', days: stock.daysLeft });
  const prescription = prescriptionStatus(m, today);
  if (prescription.kind === 'expired') {
    alerts.push({ about: 'prescription', label: 'Receita vencida', tone: 'danger', days: diffDays(today, prescription.until) });
  }
  if (prescription.kind === 'stale') {
    const label = `Receita venceu em ${dayMonth(prescription.until, today)}`;
    alerts.push({ about: 'prescription', label, tone: 'neutral', days: diffDays(today, prescription.until) });
  }
  if (prescription.kind === 'today') alerts.push({ about: 'prescription', label: 'Receita vence hoje', tone: 'warning', days: 0 });
  if (prescription.kind === 'soon') {
    alerts.push({ about: 'prescription', label: `Receita vence ${inDays(prescription.days)}`, tone: 'warning', days: prescription.days });
  }
  // A ordem de entrada (estoque, receita) desempata.
  return alerts.sort((a, b) => TONE_ORDER.indexOf(a.tone) - TONE_ORDER.indexOf(b.tone));
}

/** Se o aviso pede atenção (o que parou há mais de STALE_DAYS não pede). */
const needsAttention = (alert: RefillAlert) => alert.tone !== 'neutral';

/** O selo do remédio nas listas: o aviso mais urgente; null se não há nenhum. */
export function refillBadge(m: StockedMedication, today: string): RefillAlert | null {
  return refillAlerts(m, today)[0] ?? null;
}

/**
 * O nome que vai para a lista da farmácia: só o do remédio (o campo "Dose" é
 * quanto se toma de cada vez; na lista, leria como quanto comprar). Com
 * `withPerson`, diz de quem é: "Losartana 50 mg — Beto".
 */
export function pharmacyItemName(m: Pick<MedicationSchedule, 'name' | 'personName'>, withPerson = false): string {
  return withPerson ? `${m.name.trim()} — ${m.personName}` : m.name.trim();
}

/** Uma linha das telas Hoje e Saúde: um remédio com a caixa acabando ou a receita vencendo. */
export interface RefillRow {
  id: string;
  /** "Losartana (Ana)". */
  title: string;
  /** Os selos do remédio, o mais urgente primeiro: "Acaba em 3 dias", "Receita vence em 10 dias". */
  alerts: RefillAlert[];
  /** O item que "Pôr na lista da farmácia" cria. */
  itemName: string;
  /** O mesmo item com o nome de quem toma ("Losartana — Ana"): é como ele vai para a lista enquanto outra pessoa da casa usa o mesmo remédio. */
  personItemName: string;
  /**
   * O estoque, que é o que decide as ações da linha: acabando ('low'),
   * acabado ('out') ou parado ('stale'); null se a linha é só da receita
   * (receita vencida não se resolve no balcão da farmácia).
   */
  stock: 'low' | 'out' | 'stale' | null;
  /** false: só avisos parados há mais de STALE_DAYS; a linha não conta como pendência nem aparece na tela Hoje. */
  attention: boolean;
}

/**
 * O que as telas listam: um remédio por linha, o mais urgente primeiro; os
 * que só têm aviso parado (`attention: false`) ficam por último.
 */
export function refillRows(medications: StockedMedication[], today: string): RefillRow[] {
  // Duas pessoas da casa com o mesmo remédio em uso: o item da farmácia diz de
  // quem é. Olha todos os remédios, e não só os que estão acabando: a caixa de
  // um pode acabar com o item do outro ainda pendente na lista.
  const sameName = new Map<string, number>();
  const nameKey = (m: StockedMedication) => normalizeSearch(pharmacyItemName(m));
  for (const m of medications) {
    if (!treatmentOver(m, today)) sameName.set(nameKey(m), (sameName.get(nameKey(m)) ?? 0) + 1);
  }
  const soonest = (row: RefillRow) => Math.min(...row.alerts.filter((a) => a.tone === row.alerts[0].tone).map((a) => a.days));
  return medications
    .map((m): RefillRow => {
      const alerts = refillAlerts(m, today);
      const stock = stockStatus(m, today).kind;
      return {
        id: m.id,
        title: medicationWho(m),
        alerts,
        itemName: pharmacyItemName(m, (sameName.get(nameKey(m)) ?? 0) > 1),
        personItemName: pharmacyItemName(m, true),
        stock: stock === 'low' || stock === 'out' || stock === 'stale' ? stock : null,
        attention: alerts.some(needsAttention),
      };
    })
    .filter((row) => row.alerts.length > 0)
    .sort(
      (a, b) =>
        TONE_ORDER.indexOf(a.alerts[0].tone) - TONE_ORDER.indexOf(b.alerts[0].tone) ||
        soonest(a) - soonest(b) ||
        a.title.localeCompare(b.title),
    );
}

/**
 * Se a caixa da linha já está para comprar. `pending`: os itens pendentes das
 * listas de farmácia abertas, por normalizeSearch. Vale o item de agora e o
 * item com o nome de quem toma: posto na lista quando outra pessoa da casa
 * usava o mesmo remédio, ele segue sendo desta caixa depois que o tratamento
 * da outra termina (e o item de agora volta a ser só o nome). O contrário não
 * vale: com duas pessoas no mesmo remédio, um item só com o nome não diz de
 * quem é, e marcaria as duas linhas.
 */
export function onPharmacyList(row: Pick<RefillRow, 'itemName' | 'personItemName'>, pending: ReadonlySet<string>): boolean {
  return pending.has(normalizeSearch(row.itemName)) || pending.has(normalizeSearch(row.personItemName));
}

/** O que o Nuke fica sabendo do estoque e das receitas (a frase sai de buildNukeContext). */
export interface RefillSummary {
  /** Remédios em uso (tratamento em andamento). */
  inUse: number;
  /** Desses, os que têm o estoque ou a receita acompanhados pelo app. */
  followed: number;
  /** O estado dos que pedem atenção ou pararam: "Losartana (Ana) — acaba em 3 dias, receita vence em 10 dias". Sem os nomes dos outros. */
  lines: string[];
}

/**
 * Sem estoque nem receita informados, o app não sabe nada do remédio: o Nuke
 * precisa distinguir "nenhum acabando" de "ninguém informou", para não
 * tranquilizar sem base.
 */
export function refillSummary(medications: StockedMedication[], today: string): RefillSummary {
  const inUse = medications.filter((m) => !treatmentOver(m, today));
  return {
    inUse: inUse.length,
    followed: inUse.filter((m) => estimateStock(m, today) !== null || Boolean(m.prescriptionUntil)).length,
    lines: refillRows(medications, today).map((row) => `${row.title} — ${row.alerts.map((a) => a.label.toLowerCase()).join(', ')}`),
  };
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
 * O último dia de doses de um tratamento com fim, olhando até `limit`: a data
 * de fim ou, num tratamento por número de doses, o dia da última dose prevista
 * (as que o horário deixa para depois de hoje, como na conta do estoque).
 * null: uso contínuo, termina depois de `limit`, ou não dá para saber (as
 * marcações estão atrás do horário por mais que as doses de hoje).
 */
function lastDoseOn(m: MedicationSchedule, today: string, limit: string): string | null {
  if (m.endOn) return m.endOn;
  const left = dosesLeft(m);
  const after = courseDosesAfter(m, today);
  if (left === null || after === null) return null;
  if (left - after > (takesOn(m, today) ? m.times.length : 0)) return null;
  let budget = Math.min(left, after);
  let last = today;
  for (let date = addDays(today, 1); budget > 0 && date <= limit; date = addDays(date, 1)) {
    if (!takesOn(m, date)) continue;
    budget -= m.times.length;
    last = date;
  }
  return budget > 0 ? null : last;
}

/**
 * Os avisos de cada remédio, de hoje em diante: quando faltam os dias
 * escolhidos para a caixa acabar e no dia em que acaba; uma semana antes de a
 * receita vencer e no dia. Remédio sem estoque acompanhado só avisa a receita;
 * o que já acabou (pelas contas) não avisa de novo.
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
      const warnOn = addDays(runsOutOn, -warn);
      const counted = m.stockCountedOn ?? today;
      const eve = addDays(runsOutOn, -1);
      out.push({ id: m.id, date: warnOn, title: 'Remédio acabando', body: `${who} acaba ${inDays(warn)}.` });
      // A caixa foi contada já dentro do prazo do aviso de antes (que não toca
      // mais, ou toca no próprio dia da contagem): fica um aviso na véspera. Sai
      // da contagem, e não de quando o plano é feito: todo aparelho da casa
      // recebe os mesmos avisos, e refazer o plano não o faz tocar de novo.
      // Contada na véspera, só resta o do dia.
      if (warnOn <= counted && eve > counted) {
        out.push({ id: m.id, date: eve, title: 'Remédio acaba amanhã', body: `${who} acaba amanhã, pelas contas do app.` });
      }
      out.push({ id: m.id, date: runsOutOn, title: 'Remédio acaba hoje', body: `${who} acaba hoje, pelas contas do app.` });
    }
    const until = m.prescriptionUntil;
    if (until && until >= today) {
      const id = `${m.id}@receita`;
      // Tratamento que termina antes: o aviso que cairia depois do fim não sai (na dúvida, sai).
      const last = lastDoseOn(m, today, until);
      const during = (reminder: RefillReminder) => !last || reminder.date <= last;
      out.push(
        ...[
          {
            id,
            date: addDays(until, -PRESCRIPTION_REMINDER_DAYS),
            title: 'Receita vencendo',
            body: `A receita de ${who} vence ${inDays(PRESCRIPTION_REMINDER_DAYS)} (${formatBRDate(until)}).`,
          },
          { id, date: until, title: 'Receita vence hoje', body: `A receita de ${who} vence hoje.` },
        ].filter(during),
      );
    }
  }
  // O que já passou não tem como avisar.
  return out.filter((reminder) => reminder.date >= today);
}

/** O que muda no banco quando o estoque é contado de novo. */
export interface StockCount {
  stockCount: number;
  stockCountedOn: string;
}

/**
 * "Comprei mais": o que a conta diz que sobra hoje, mais a caixa nova,
 * contado de novo hoje. Sem estoque acompanhado, começa pela caixa. Com
 * `base` (o número que a pessoa acabou de escrever em "Quanto tem agora", ver
 * restockBase), a caixa soma a ele, e não à conta.
 */
export function restock(m: StockedMedication, today: string, boxUnits: number, base?: number): StockCount {
  const left = base ?? estimateStock(m, today)?.unitsLeft ?? 0;
  return { stockCount: round(left + Math.max(0, boxUnits)), stockCountedOn: today };
}

type Rule = Pick<MedicationSchedule, 'times' | 'startOn' | 'endOn' | 'frequency' | 'weekdays' | 'intervalDays' | 'totalDoses'>;

/**
 * A regra das doses, para comparar: quantas vezes por dia, regularidade,
 * início, fim e o número de doses do tratamento. O horário em si não entra: a
 * conta só lê quantas doses o dia tem, e trocar 08:00 por 07:30 não muda o que
 * é gasto.
 */
const ruleKey = (m: Rule) =>
  JSON.stringify([
    m.times.length,
    m.frequency ?? 'daily',
    m.weekdays ? [...m.weekdays].sort((a, b) => a - b) : null,
    m.intervalDays ?? null,
    m.startOn,
    m.endOn ?? null,
    m.totalDoses ?? null,
  ]);

/**
 * A regra das doses (ou quanto cada dose usa) mudou num remédio com o estoque
 * acompanhado: o que foi gasto até hoje foi pela regra de antes. A contagem
 * passa a ser o que sobrava hoje por ela, contado hoje, e a regra nova vale
 * de amanhã em diante. Sem isso a mudança valeria para trás, e o estoque
 * pularia sem ninguém ter contado nada. `changes` é o que a seção do estoque
 * já muda (readStockForm): se a pessoa contou de novo, vale o que ela contou.
 * Trocar só o horário não é mudar a regra (ver ruleKey): nada é mexido.
 *
 * Remédio que já tinha acabado: a contagem fica no dia em que acabou, e não
 * em hoje. "Deve ter acabado em 04/10" segue como estava, em vez de virar
 * "acaba hoje" (com aviso por notificação) só porque a regra mudou.
 */
export function keepStockOnRuleChange(changes: StockChanges, before: StockedMedication | undefined, after: Rule, today: string): StockChanges {
  if (!before || changes.stockCount !== undefined) return changes;
  if (changes.doseUnits === undefined && ruleKey(before) === ruleKey(after)) return changes;
  const estimate = estimateStock(before, today);
  if (!estimate) return changes;
  const ranOutOn = estimate.runsOutOn !== null && estimate.runsOutOn < today ? estimate.runsOutOn : null;
  return { ...changes, stockCount: estimate.unitsLeft, stockCountedOn: ranOutOn ?? today };
}

/** "30", "12,5". */
export function formatUnits(units: number): string {
  return round(units).toLocaleString('pt-BR', { maximumFractionDigits: 2, useGrouping: false });
}

/**
 * Unidades digitadas ("30", "12,5", "12.5"); null se não for um número de 0 a
 * 99999. Ponto seguido de exatamente três dígitos, sem vírgula ("1.000"), tanto
 * pode ser mil como um: é recusado, para a pessoa escrever de novo, em vez de
 * virar um número que ela não quis dizer.
 */
export function parseUnits(text: string): number | null {
  if (!text.includes(',') && /\.\d{3}(?!\d)/.test(text)) return null;
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

type FormError = { ok: false; title: string; message: string };

export type StockFormResult = { ok: true; changes: StockChanges } | FormError;

const INVALID_STOCK: FormError = {
  ok: false,
  title: 'Estoque inválido',
  message: 'Em "Quanto tem agora", informe um número, como 30 ou 12,5, ou deixe vazio.',
};

const stockEdited = (form: StockForm, initial: StockForm) => form.stock.trim() !== initial.stock.trim();

/**
 * A base de "Comprei mais": undefined se "Quanto tem agora" está como a tela
 * abriu (vale a conta de hoje); o número digitado, se a pessoa o corrigiu e
 * ainda não salvou (vazio é zero: fica só a caixa). Sem isso a correção seria
 * trocada pela conta antiga mais a caixa, sem aviso. Texto que não é número:
 * o mesmo aviso de salvar, e nada é somado.
 */
export function restockBase(form: StockForm, initial: StockForm): { ok: true; base: number | undefined } | FormError {
  if (!stockEdited(form, initial)) return { ok: true, base: undefined };
  const text = form.stock.trim();
  const typed = text ? parseUnits(text) : 0;
  return typed === null ? INVALID_STOCK : { ok: true, base: typed };
}

/** O texto junto de "Quantas unidades vieram": a que a caixa nova é somada. */
export function restockHint(m: StockedMedication, form: StockForm, initial: StockForm, today: string): string {
  const fromToday = 'passa a contar a partir de hoje.';
  const status = stockStatus(m, today);
  const late = (status.kind === 'out' || status.kind === 'stale') && status.ranOutOn < today;
  if (stockEdited(form, initial)) {
    if (!form.stock.trim()) return `Com “Quanto tem agora” vazio, o app conta só esta caixa e ${fromToday}`;
    // Compra atrasada e a pessoa já escreveu quanto tem: se o número já é o da
    // caixa nova, somar a caixa de novo contaria em dobro. Diz o que tocar.
    return late
      ? 'Se esse número já conta a caixa nova, toque em “Cancelar” e depois em “Salvar”. “Somar ao estoque” soma mais uma caixa a ele.'
      : `O app soma ao número que você escreveu em “Quanto tem agora” e ${fromToday}`;
  }
  // Compra registrada dias depois: o app não sabe se a caixa nova já está em
  // uso (aí somar a caixa inteira é contar a mais) ou se a pessoa ficou esses
  // dias sem o remédio. Não muda a conta sozinho: diz o que fazer.
  if (late) {
    return `Pelas contas do app, a caixa anterior acabou em ${dayMonth(status.ranOutOn, today)}. Se você já está usando a nova, escreva em “Quanto tem agora” quantas unidades ainda tem, em vez de somar a caixa inteira.`;
  }
  return estimateStock(m, today)
    ? `O app soma ao que ainda tem, pelas contas do app, e ${fromToday}`
    : `O app começa a acompanhar por esta caixa e ${fromToday}`;
}

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
    if (text && count === null) return INVALID_STOCK;
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
    // O banco só aceita datas deste intervalo: melhor o aviso daqui que o erro de lá.
    if (until && (until < MIN_STOCK_DATE || until > MAX_STOCK_DATE)) {
      const range = `${formatBRDate(MIN_STOCK_DATE)} e ${formatBRDate(MAX_STOCK_DATE)}`;
      return { ok: false, title: 'Data inválida', message: `Em "Receita vale até", informe uma data entre ${range}, ou deixe vazio.` };
    }
    changes.prescriptionUntil = until;
  }
  return { ok: true, changes };
}

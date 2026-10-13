// O que acaba sem passar por nota fiscal: gás, galão de água, ração, areia do
// gato, refil do filtro. A casa anota cada troca ("Troquei hoje") e a previsão
// de quando o atual acaba sai das trocas anotadas (nos primeiros ciclos, junto
// com uma estimativa). É sempre previsão, nunca certeza: o gás não obedece o app.

import type { IconName } from './categories';
import { addDays, diffDays, formatBRDate, parseBRDate } from './dates';

export type SupplyKind = 'gas' | 'agua' | 'racao' | 'areia' | 'filtro' | 'outros';

export interface SupplyKindInfo {
  key: SupplyKind;
  label: string;
  icon: IconName;
  /** Quanto costuma durar numa casa comum: o ponto de partida até a casa ter as próprias trocas. */
  typicalDays: number | null;
  /** Categoria na lista de mercado; null: chega por entrega (gás, galão), não vai para a lista. */
  listCategory: string | null;
}

// As chaves são as do check de supplies.kind (supabase/migrations).
export const SUPPLY_KINDS: SupplyKindInfo[] = [
  { key: 'gas', label: 'Gás de cozinha', icon: 'gas-cylinder', typicalDays: 45, listCategory: null },
  { key: 'agua', label: 'Galão de água', icon: 'water-outline', typicalDays: 10, listCategory: null },
  { key: 'racao', label: 'Ração', icon: 'paw', typicalDays: 30, listCategory: 'pet' },
  { key: 'areia', label: 'Areia do gato', icon: 'cat', typicalDays: 15, listCategory: 'pet' },
  { key: 'filtro', label: 'Refil do filtro', icon: 'filter-outline', typicalDays: 180, listCategory: 'outros' },
  { key: 'outros', label: 'Outro', icon: 'package-variant-closed', typicalDays: null, listCategory: 'outros' },
];

export function getSupplyKind(key: string): SupplyKindInfo {
  return SUPPLY_KINDS.find((k) => k.key === key) ?? SUPPLY_KINDS[SUPPLY_KINDS.length - 1];
}

export const SUPPLY_NAME_MAX = 60;
export const SUPPLY_NOTES_MAX = 200;
export const SUPPLY_DAYS_MAX = 730;
/** Antes disso é erro de digitação (o banco recusa também). */
export const REFILL_MIN_DATE = '2000-01-01';

/** O que a previsão precisa de uma reposição: o tipo, a estimativa da pessoa e as trocas. */
export interface SupplyLike {
  kind: string;
  typical_days: number | null;
  refills: { refilled_on: string }[];
}

/** A previsão olha as últimas trocas: a casa muda (mais gente, outro fogão) e o costume antigo deixa de valer. */
const INTERVALS_USED = 5;
/**
 * Com menos intervalos que isso, a estimativa (da pessoa ou do tipo) entra na
 * mediana como mais um valor: o primeiro intervalo costuma ser parcial (o
 * botijão já estava em uso no cadastro) e um "Troquei" esquecido dobra o
 * seguinte. Sozinhos, virariam a previsão e o aviso chegaria tarde demais.
 */
const INTERVALS_TRUSTED = 3;
/** O aviso começa nos últimos 15% da duração, entre 2 e 7 dias antes. */
const WARNING_PERCENT = 15;
const WARNING_MIN_DAYS = 2;
const WARNING_MAX_DAYS = 7;
/** Ciclo de até 5 dias (galão numa casa cheia): janela de 1 dia e um aviso só por ciclo, para não virar ruído. */
const SHORT_CYCLE_DAYS = 5;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Os dias de troca que contam, do mais antigo para o mais novo: um por dia
 * (duas no mesmo dia são a mesma troca) e nada depois de hoje. Data futura é
 * relógio errado ou alguém da casa noutro fuso: passa a contar quando o dia chegar.
 */
export function refillDays(refills: { refilled_on: string }[], today: string): string[] {
  return [...new Set(refills.map((r) => r.refilled_on.slice(0, 10)))].filter((day) => day <= today).sort();
}

/**
 * Quantos dias antes da data prevista a reposição passa a pedir atenção. O
 * mínimo de 2 dias não passa de um terço do ciclo: sem isso, o que dura até 5
 * dias ficaria "acabando" quase o tempo todo.
 */
export function warningDays(days: number): number {
  const least = Math.min(WARNING_MIN_DAYS, Math.max(1, Math.floor(days / 3)));
  return Math.min(WARNING_MAX_DAYS, Math.max(least, Math.round((days * WARNING_PERCENT) / 100)));
}

/**
 * De onde vem a duração: das trocas da casa (`trocas`), do que a pessoa
 * estimou (`pessoa`), do costume do tipo (`tipo`) ou, nos primeiros ciclos,
 * da estimativa junto com as trocas (`misto`).
 */
export type DurationSource = 'trocas' | 'misto' | 'pessoa' | 'tipo';

function durationOf(supply: SupplyLike, days: string[]): { days: number; source: DurationSource } | null {
  const intervals = days.slice(1).map((day, i) => diffDays(days[i], day));
  const usual = getSupplyKind(supply.kind).typicalDays;
  const estimate: { days: number; source: DurationSource } | null =
    supply.typical_days && supply.typical_days > 0 ? { days: supply.typical_days, source: 'pessoa' } : usual ? { days: usual, source: 'tipo' } : null;
  if (!intervals.length) return estimate;
  // Poucos intervalos e uma estimativa: ela entra como mais um valor (ver INTERVALS_TRUSTED).
  // Sem estimativa nenhuma, vale o histórico desde o primeiro intervalo.
  const mixed = estimate && intervals.length < INTERVALS_TRUSTED;
  // A mediana só segura um intervalo fora da curva (viagem, botijão esquecido) com três valores ou mais.
  const values = mixed ? [...intervals, estimate.days] : intervals.slice(-INTERVALS_USED);
  return { days: Math.max(1, Math.round(median(values))), source: mixed ? 'misto' : 'trocas' };
}

/** Com data prevista: quando foi a última troca, quanto dura e quando deve acabar. */
export interface SupplyDated {
  refilledOn: string;
  days: number;
  source: DurationSource;
  endsOn: string;
  /** Dias de hoje até a data prevista (negativo: já passou). */
  daysLeft: number;
  warnDays: number;
}

/**
 * - `sem_troca`: nenhuma troca anotada.
 * - `sem_previsao`: uma troca, mas nenhuma duração (tipo "Outro" sem estimativa).
 * - `em_dia`: longe da data prevista, ou trocado hoje.
 * - `acabando`: dentro da janela de aviso, até o dia previsto.
 * - `passou`: depois da data, por até mais uma duração.
 * - `parado`: muito depois; a casa provavelmente parou de anotar. Sem destaque nem aviso.
 */
export type SupplyForecast =
  | { state: 'sem_troca' }
  | { state: 'sem_previsao'; refilledOn: string }
  | ({ state: 'em_dia' | 'acabando' | 'passou' | 'parado' } & SupplyDated);

export type SupplyState = SupplyForecast['state'];

export function supplyForecast(supply: SupplyLike, today: string): SupplyForecast {
  const days = refillDays(supply.refills, today);
  const refilledOn = days[days.length - 1];
  if (!refilledOn) return { state: 'sem_troca' };
  const duration = durationOf(supply, days);
  if (!duration) return { state: 'sem_previsao', refilledOn };
  const endsOn = addDays(refilledOn, duration.days);
  const daysLeft = diffDays(today, endsOn);
  const warnDays = warningDays(duration.days);
  // No dia da própria troca, com dia pela frente, nunca está acabando: o "Troquei" tem de tirar a linha da tela Hoje.
  const fresh = refilledOn === today && daysLeft > 0;
  const state =
    daysLeft > warnDays || fresh ? 'em_dia' : daysLeft >= 0 ? 'acabando' : -daysLeft <= duration.days ? 'passou' : 'parado';
  return { state, refilledOn, ...duration, endsOn, daysLeft, warnDays };
}

// ---------------------------------------------------------------------------
// Textos

const countDays = (n: number) => `${n} ${n === 1 ? 'dia' : 'dias'}`;

/** "28/10"; com o ano quando não é o de hoje ("05/01/2027"). */
function dayMonth(iso: string, today: string): string {
  const full = formatBRDate(iso);
  return iso.slice(0, 4) === today.slice(0, 4) ? full.slice(0, 5) : full;
}

/** O estado em uma frase. Sempre "deve": é previsão. */
export function describeSupply(forecast: SupplyForecast, today: string): string {
  switch (forecast.state) {
    case 'sem_troca':
      return 'Toque em "Troquei hoje" quando começar um novo';
    case 'sem_previsao':
      return `Trocado em ${dayMonth(forecast.refilledOn, today)} · o Kotii aprende a duração na próxima troca`;
    case 'em_dia':
      return `Deve durar até ${dayMonth(forecast.endsOn, today)}`;
    case 'acabando':
      if (forecast.daysLeft === 0) return 'Deve acabar hoje';
      if (forecast.daysLeft === 1) return 'Deve acabar amanhã';
      return `Deve acabar em uns ${forecast.daysLeft} dias`;
    case 'passou':
      return 'Pela conta, já era para ter acabado';
    case 'parado':
      return `Sem troca desde ${dayMonth(forecast.refilledOn, today)}`;
  }
}

/** De onde vem o número, em três formas: sem intervalo, com a estimativa ainda na conta, só o histórico. */
const SOURCE_LABEL: Record<DurationSource, string> = {
  pessoa: 'estimativa',
  tipo: 'estimativa',
  misto: 'estimativa e suas trocas',
  trocas: 'pelas suas trocas',
};

/** De onde vem o número: "dura cerca de 45 dias (pelas suas trocas)". Só enquanto há uma data prevista em jogo. */
export function describeSupplyDuration(forecast: SupplyForecast): string | null {
  if (forecast.state !== 'em_dia' && forecast.state !== 'acabando' && forecast.state !== 'passou') return null;
  return `dura cerca de ${countDays(forecast.days)} (${SOURCE_LABEL[forecast.source]})`;
}

/** A linha da reposição na Despensa: o estado e, quando há, de onde vem o número. */
export function supplyRowText(forecast: SupplyForecast, today: string): string {
  return [describeSupply(forecast, today), describeSupplyDuration(forecast)].filter(Boolean).join(' · ');
}

/** O selo da linha: só para o que pede atenção. */
export function supplyBadge(forecast: SupplyForecast): { label: string; tone: 'warning' | 'danger' } | null {
  if (forecast.state === 'acabando') return { label: 'Acabando', tone: 'warning' };
  if (forecast.state === 'passou') return { label: 'Passou da data', tone: 'danger' };
  return null;
}

/** Pede atenção na tela Hoje? */
export function supplyNeedsAttention(forecast: SupplyForecast): boolean {
  return forecast.state === 'acabando' || forecast.state === 'passou';
}

/** O que dizer depois de anotar uma troca, com a previsão nova: "Anotado. Deve durar até 26/11." */
export function describeRefillSaved(forecast: SupplyForecast, today: string): string {
  if (forecast.state === 'sem_troca') return 'Anotado.';
  if (forecast.state === 'sem_previsao') return 'Anotado. O Kotii aprende a duração na próxima troca.';
  // Troca antiga ("Troquei outro dia…") que pela conta já acabou: a frase do estado
  // ("Sem troca desde…") soaria como se nada tivesse sido anotado.
  if (forecast.state === 'passou' || forecast.state === 'parado') {
    return 'Anotado. Pela conta, esse já deve ter acabado: toque em “Troquei hoje” quando começar um novo.';
  }
  return `Anotado. ${describeSupply(forecast, today)}.`;
}

/** Uma troca no histórico e quanto durou (null: é a mais nova, ainda sem a troca seguinte). */
export interface RefillLine<T> {
  refill: T;
  lastedDays: number | null;
}

/** As trocas da mais nova para a mais antiga, cada uma com os dias até a seguinte. */
export function refillHistory<T extends { refilled_on: string }>(refills: T[]): RefillLine<T>[] {
  const byDay = new Map<string, T>();
  for (const refill of refills) if (!byDay.has(refill.refilled_on)) byDay.set(refill.refilled_on, refill);
  const days = [...byDay.keys()].sort();
  return days
    .map((day, i) => ({ refill: byDay.get(day)!, lastedDays: i < days.length - 1 ? diffDays(day, days[i + 1]) : null }))
    .reverse();
}

/** "03/10/2026 · durou 44 dias"; a mais nova, "em uso". */
export function describeRefill(line: RefillLine<{ refilled_on: string }>, today: string): string {
  const date = formatBRDate(line.refill.refilled_on);
  if (line.lastedDays != null) return `${date} · durou ${countDays(line.lastedDays)}`;
  // Data depois de hoje não entra na previsão (ver refillDays).
  return line.refill.refilled_on > today ? `${date} · data depois de hoje, ainda não conta` : `${date} · em uso`;
}

// ---------------------------------------------------------------------------
// Ordem da seção

const STATE_ORDER: Record<SupplyState, number> = { passou: 0, acabando: 0, em_dia: 1, sem_previsao: 2, sem_troca: 3, parado: 4 };

export interface SupplyRow<T> {
  supply: T;
  forecast: SupplyForecast;
}

/**
 * As reposições com a previsão de cada uma, na ordem da seção: primeiro o que
 * passou da data e o que está acabando (o mais urgente antes), depois o que
 * está em dia pela data prevista, e no fim sem previsão, sem troca e parado.
 * Empate, pelo nome.
 */
export function forecastSupplies<T extends SupplyLike & { name: string }>(supplies: T[], today: string): SupplyRow<T>[] {
  const left = (f: SupplyForecast) => ('daysLeft' in f && f.state !== 'parado' ? f.daysLeft : 0);
  return supplies
    .map((supply) => ({ supply, forecast: supplyForecast(supply, today) }))
    .sort(
      (a, b) =>
        STATE_ORDER[a.forecast.state] - STATE_ORDER[b.forecast.state] ||
        left(a.forecast) - left(b.forecast) ||
        a.supply.name.localeCompare(b.supply.name, 'pt-BR'),
    );
}

/** O que entra na tela Hoje: só o que está acabando ou passou da data, o mais urgente antes. */
export function suppliesNeedingAttention<T extends SupplyLike & { name: string }>(supplies: T[], today: string): SupplyRow<T>[] {
  return forecastSupplies(supplies, today).filter((row) => supplyNeedsAttention(row.forecast));
}

// ---------------------------------------------------------------------------
// Formulário

export interface SupplyValues {
  name: string;
  kind: SupplyKind;
  typical_days: number | null;
  notes: string | null;
}

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

/** Confere o que a pessoa digitou; os limites são os mesmos do banco. */
export function validateSupply(form: { name: string; kind: string; typicalDays: string; notes: string }): Checked<SupplyValues> {
  const name = form.name.trim();
  if (!name) return { ok: false, message: 'Dê um nome, como "Gás de cozinha" ou "Ração da Mel".' };
  if (name.length > SUPPLY_NAME_MAX) return { ok: false, message: `O nome pode ter até ${SUPPLY_NAME_MAX} letras.` };
  const kind = SUPPLY_KINDS.find((k) => k.key === form.kind);
  if (!kind) return { ok: false, message: 'Escolha o tipo.' };
  const typed = form.typicalDays.trim();
  const days = /^\d{1,4}$/.test(typed) ? Number(typed) : null;
  if (typed && !(days != null && days >= 1 && days <= SUPPLY_DAYS_MAX)) {
    return { ok: false, message: `Em "Dura quantos dias?", use um número de 1 a ${SUPPLY_DAYS_MAX} ou deixe em branco.` };
  }
  const notes = form.notes.trim();
  if (notes.length > SUPPLY_NOTES_MAX) return { ok: false, message: `As observações podem ter até ${SUPPLY_NOTES_MAX} letras.` };
  return { ok: true, value: { name, kind: kind.key, typical_days: days, notes: notes || null } };
}

/** O dia de uma troca digitado (dd/mm/aaaa): uma data de verdade e não depois de hoje. */
export function parseRefillDate(text: string, today: string): Checked<string> {
  const date = parseBRDate(text);
  if (!date) return { ok: false, message: 'Use o formato dd/mm/aaaa.' };
  if (date > today) return { ok: false, message: 'A troca não pode ser depois de hoje.' };
  if (date < REFILL_MIN_DATE) return { ok: false, message: 'Confira o ano da data.' };
  return { ok: true, value: date };
}

/** As respostas de "Quando começou o atual?", ao criar. */
export type SupplyStart = 'hoje' | 'outro' | 'nao_sei';

/**
 * O dia da primeira troca, pela resposta a "Quando começou o atual?". Nada
 * vem escolhido: sem resposta (null) é "Não sei", e nenhuma troca é anotada.
 * "Hoje" só para o que começou hoje: um botijão pela metade dado como novo
 * seria avisado depois de o gás acabar.
 */
export function parseSupplyStart(start: SupplyStart | null, day: string, today: string): Checked<string | null> {
  if (start === 'hoje') return { ok: true, value: today };
  if (start === 'outro') return parseRefillDate(day, today);
  return { ok: true, value: null };
}

// ---------------------------------------------------------------------------
// Avisos e Nuke

/**
 * Os avisos de uma reposição (ver planHouseReminders): no começo da janela e
 * no dia previsto. Ciclo curto (até 5 dias) fica com um só por ciclo.
 */
export interface SupplyReminder {
  id: string;
  /** null: a janela começaria no dia da própria troca (dura 1 dia), e nesse dia não se avisa. */
  warnOn: string | null;
  warnTitle: string;
  /** null: ciclo curto, que já avisa no começo da janela. */
  endsOn: string | null;
  endTitle: string;
  body: string;
}

/**
 * O que avisar: só reposição com data prevista pela frente (em dia ou
 * acabando). Sem troca, sem previsão, passou e parado não avisam. O nome vai
 * como a pessoa escreveu, sem artigo: não dá para saber se é "o" ou "a".
 */
export function supplyReminders(supplies: (SupplyLike & { id: string; name: string })[], today: string): SupplyReminder[] {
  return supplies.flatMap((supply) => {
    const f = supplyForecast(supply, today);
    if (f.state !== 'em_dia' && f.state !== 'acabando') return [];
    const start = addDays(f.endsOn, -f.warnDays);
    // O dia da troca está sempre em dia (ver supplyForecast): aviso nele chegaria logo depois do "Troquei".
    const warnOn = start > f.refilledOn ? start : null;
    const lasts = f.source === 'trocas' ? `costuma durar ${countDays(f.days)}` : `deve durar cerca de ${countDays(f.days)} (${SOURCE_LABEL[f.source]})`;
    return [
      {
        id: supply.id,
        warnOn,
        // Janela de 1 dia: "amanhã", nunca "em uns 1 dia".
        warnTitle: f.warnDays === 1 ? `${supply.name} deve acabar amanhã` : `${supply.name} deve acabar em uns ${countDays(f.warnDays)}`,
        // Um aviso por ciclo curto: o do dia previsto só quando o da véspera não existe.
        endsOn: f.days <= SHORT_CYCLE_DAYS && warnOn ? null : f.endsOn,
        endTitle: `${supply.name} deve acabar hoje`,
        body: `Trocado em ${dayMonth(f.refilledOn, today)} · ${lasts}.`,
      },
    ];
  });
}

/** As reposições para o Nuke, uma por item: "Gás de cozinha — deve acabar em 28/10". */
export function supplyLines(supplies: (SupplyLike & { name: string })[], today: string): string[] {
  return forecastSupplies(supplies, today).map(({ supply, forecast: f }) => {
    switch (f.state) {
      case 'sem_troca':
        return `${supply.name} — sem previsão`;
      case 'sem_previsao':
        return `${supply.name} — sem previsão (trocado em ${dayMonth(f.refilledOn, today)})`;
      case 'em_dia':
        return `${supply.name} — deve acabar em ${dayMonth(f.endsOn, today)}`;
      case 'acabando':
        if (f.daysLeft === 0) return `${supply.name} — deve acabar hoje`;
        if (f.daysLeft === 1) return `${supply.name} — deve acabar amanhã`;
        return `${supply.name} — deve acabar em ${dayMonth(f.endsOn, today)} (uns ${f.daysLeft} dias)`;
      case 'passou':
        return `${supply.name} — pela conta, já era para ter acabado em ${dayMonth(f.endsOn, today)}`;
      case 'parado':
        return `${supply.name} — sem troca anotada desde ${dayMonth(f.refilledOn, today)}`;
    }
  });
}

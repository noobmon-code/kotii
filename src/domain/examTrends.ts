// Evolução dos exames de uma pessoa: junta o mesmo item de laudos diferentes
// (pela chave do nome), monta a série dos valores numéricos e escreve o resumo
// para levar à consulta. O app só mostra o que está nos laudos: não decide o
// que é esperado nem lê os valores de referência; a marcação (acima, abaixo,
// alterado) é a que veio do laudo ou de quem digitou.

import type { Exam, Medication, Person } from '@/lib/types';
import { addMonths, diffDays, formatBRDate, isValidISODate } from './dates';
import { ageLabel, EXAM_STATUS, flagLabel, type ResultFlag } from './health';
import { describeCourse, describeFrequency, dosesLeft } from './medications';
import { normalizeSearch } from './search';

// ---------------------------------------------------------------------------
// Nome do item

// Grafias comuns do mesmo item nos laboratórios, já sem acento, maiúsculas e
// pontuação. A primeira de cada linha é a chave do grupo. Só entra aqui o que
// é com certeza a mesma coisa: "colesterol" sozinho, "T4 total", "PSA livre",
// "cálcio iônico" e "PCR ultrassensível" ficam de fora de propósito.
const SYNONYMS: string[][] = [
  ['glicose', 'glicemia', 'glicemia de jejum', 'glicemia em jejum', 'glicemia jejum', 'glicose em jejum', 'glicose de jejum', 'glicose jejum'],
  [
    'hemoglobina glicada',
    'hemoglobina glicosilada',
    'hba1c',
    'a1c',
    'hb glicada',
    'hemoglobina a1c',
    'hemoglobina glicada hba1c',
    'hemoglobina glicada a1c',
    'hba1c hemoglobina glicada',
  ],
  ['colesterol total'],
  ['hdl', 'colesterol hdl', 'hdl colesterol', 'hdl c'],
  ['ldl', 'colesterol ldl', 'ldl colesterol', 'ldl c'],
  ['vldl', 'colesterol vldl', 'vldl colesterol', 'vldl c'],
  ['triglicerideos', 'triglicerides', 'triglicerideo', 'trigliceridios'],
  ['tsh', 'tsh ultrassensivel', 'tsh ultra sensivel', 'hormonio tireoestimulante', 'hormonio tireoestimulante tsh', 'tsh hormonio tireoestimulante'],
  ['t4 livre', 't4l', 'tiroxina livre', 'tiroxina livre t4 livre', 't4 livre tiroxina livre'],
  [
    'vitamina d',
    '25 hidroxivitamina d',
    '25 hidroxi vitamina d',
    '25 oh d',
    '25 oh vitamina d',
    'vitamina d 25 oh',
    'vitamina d 25 hidroxi',
    'vitamina d 25 hidroxivitamina d',
  ],
  ['vitamina b12', 'vitamina b 12', 'b12'],
  ['ferritina'],
  ['ferro serico'],
  ['creatinina'],
  ['ureia'],
  ['acido urico'],
  ['tgo', 'ast', 'tgo ast', 'ast tgo', 'aspartato aminotransferase', 'transaminase oxalacetica', 'transaminase glutamico oxalacetica'],
  ['tgp', 'alt', 'tgp alt', 'alt tgp', 'alanina aminotransferase', 'transaminase piruvica', 'transaminase glutamico piruvica'],
  ['gama gt', 'ggt', 'gamagt', 'gama gt ggt', 'ggt gama gt', 'gama glutamil transferase', 'gama glutamiltransferase', 'gamaglutamil transferase'],
  ['hemoglobina'],
  ['hematocrito'],
  ['leucocitos', 'leucocitos totais'],
  ['plaquetas', 'contagem de plaquetas'],
  ['psa total'],
  ['pcr', 'proteina c reativa', 'proteina c reativa pcr', 'pcr proteina c reativa'],
  ['sodio'],
  ['potassio'],
  ['calcio'],
  ['insulina'],
];

const SYNONYM_KEY = new Map<string, string>(SYNONYMS.flatMap(([key, ...others]) => [key, ...others].map((name) => [name, key] as const)));

/**
 * Chave que junta o mesmo item entre laudos: sem acento, maiúsculas,
 * pontuação e espaços a mais ("GLICOSE (jejum)" e "Glicemia de jejum" dão
 * "glicose"). Nome fora da tabela só junta com ele mesmo.
 */
export function examItemKey(name: string): string {
  const plain = normalizeSearch(name)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  // Nome só de símbolos: vale como foi escrito, para não juntar com outro.
  if (!plain) return name.trim().toLowerCase();
  return SYNONYM_KEY.get(plain) ?? plain;
}

// ---------------------------------------------------------------------------
// Valor e unidade

export type ValueMark = '<' | '>' | '≤' | '≥';

export interface ParsedValue {
  number: number;
  /** Casas depois da vírgula como o laudo escreveu ("5,60" tem 2). */
  decimals: number;
  /** "<" ou ">" na frente do número: é um limite, não uma medida. */
  mark: ValueMark | null;
  /** Unidade digitada junto do valor ("12 mg/dL"). */
  unit: string | null;
}

const MARKS: Record<string, ValueMark> = { '<': '<', '>': '>', '≤': '≤', '≥': '≥', '<=': '≤', '>=': '≥' };
const VALUE = /^(<=|>=|[<>≤≥])?\s*([-−])?\s*(\d[\d.,]*)\s*(.*)$/;
const THOUSANDS = /^[1-9]\d{0,2}(\.\d{3})+$/;
// Uma palavra só, com letra (ou "%"): "mg/dL", "/mm³", "%". "120/80", "1:80",
// "2 a 4 por campo" e "3+" não são um número com unidade.
const INLINE_UNIT = /^(%|\/?[a-zà-ÿµμ][^\s+:]{0,14})$/i;

/**
 * Lê um resultado como número, do jeito brasileiro: vírgula é decimal e ponto
 * seguido de três dígitos é milhar ("1.234" é mil duzentos e trinta e quatro,
 * "7.500" leucócitos é sete mil e quinhentos); ponto fora disso é decimal
 * ("1.2", "1234.5", "0.500"). Aceita "<" e ">" na frente e a unidade junto.
 * "negativo", "reagente", "+++", "1:80" devolvem null (ficam como texto).
 */
export function parseResultValue(value: string): ParsedValue | null {
  const match = value.replace(/ /g, ' ').trim().match(VALUE);
  if (!match) return null;
  const [, mark, minus, body, rest] = match;
  let integer = body;
  let fraction = '';
  const comma = body.indexOf(',');
  if (comma >= 0) {
    integer = body.slice(0, comma);
    fraction = body.slice(comma + 1);
    if (!/^\d+$/.test(fraction)) return null;
  }
  if (THOUSANDS.test(integer)) integer = integer.replace(/\./g, '');
  else if (comma < 0 && /^\d+\.\d+$/.test(integer)) [integer, fraction] = integer.split('.');
  if (!/^\d+$/.test(integer)) return null;
  // Mais dígitos do que um número guarda sem perder: fica como texto.
  if (integer.length + fraction.length > 15) return null;
  if (rest && !INLINE_UNIT.test(rest)) return null;
  const number = Number(`${integer}.${fraction || '0'}`);
  return {
    number: minus && number !== 0 ? -number : number,
    decimals: fraction.length,
    mark: mark ? MARKS[mark] : null,
    unit: rest || null,
  };
}

/** Número em pt-BR com as casas que o laudo escreveu: 5.6 -> "5,6", 108 -> "108", 150000 -> "150.000". */
export function formatResultNumber(value: number, decimals: number): string {
  const [integer, fraction] = Math.abs(value).toFixed(decimals).split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const text = fraction ? `${grouped},${fraction}` : grouped;
  return value < 0 && /[1-9]/.test(text) ? `-${text}` : text;
}

// Unidades que são exatamente a mesma, escritas de outro jeito (depois de
// normalizeUnit tirar maiúsculas, espaços, "µ" e "UI"). Sem conversão de valor:
// o que não é idêntico fica separado.
const SAME_UNIT: Record<string, string> = {
  'mu/l': 'uu/ml',
  'mu/ml': 'u/l',
  'ug/l': 'ng/ml',
  'ng/l': 'pg/ml',
  'mg%': 'mg/dl',
  'g%': 'g/dl',
};

/**
 * Chave da unidade, para saber se dois resultados podem ser comparados:
 * "mg/dL" = "mg/dl"; "µUI/mL" = "uUI/mL" = "mcUI/mL" = "mUI/L"; "U/L" =
 * "UI/L"; "mcg" = "µg"; "/mm³" = "/µL". Sem unidade dá "".
 */
export function normalizeUnit(unit: string | null | undefined): string {
  const key = normalizeSearch((unit ?? '').replace(/[µμ]/g, 'u'))
    .replace(/\s+/g, '')
    .replace(/³/g, '3')
    .replace(/²/g, '2')
    .replace(/\^/g, '')
    .replace(/\.+$/, '')
    .replace(/mc(?=[glu])/g, 'u')
    .replace(/ui(?=\/|$)/g, 'u')
    .replace(/mm3/g, 'ul');
  return SAME_UNIT[key] ?? key;
}

// ---------------------------------------------------------------------------
// Evolução

export type TrendExam = Pick<Exam, 'id' | 'person_id' | 'title' | 'status' | 'exam_date' | 'created_at' | 'results'>;

export interface TrendPoint {
  examId: string;
  examTitle: string;
  date: string;
  /** Como aparece na tela: "5,6", "< 0,5", "1.234,5" ou o texto do laudo ("Não reagente"). */
  value: string;
  /** null nos resultados em texto. */
  number: number | null;
  decimals: number;
  mark: ValueMark | null;
  /** Como foi escrita no laudo. */
  unit: string | null;
  flag: ResultFlag | null;
  reference: string | null;
}

export interface TrendItem {
  /** Única entre as três listas. */
  key: string;
  /** A grafia mais recente que a pessoa tem. */
  name: string;
  /** Do mais antigo para o mais novo. */
  points: TrendPoint[];
  last: TrendPoint;
}

/** Posição de um ponto no gráfico, de 0 a 1 (y = 1 é o maior valor). */
export interface ChartPoint {
  x: number;
  y: number;
}

export interface TrendSeries extends TrendItem {
  /** "subiu 9 (9%) desde 12/03/2026" */
  change: string;
  chart: ChartPoint[];
}

export interface ExamTrends {
  /** Itens numéricos com dois ou mais resultados na mesma unidade. */
  series: TrendSeries[];
  /** Itens numéricos com um resultado só. */
  single: TrendItem[];
  /** Resultados que não são número ("negativo", "reagente"). */
  text: TrendItem[];
  /** Exames realizados com resultados, mas sem data: ficam de fora até a data ser anotada. */
  undated: { id: string; title: string }[];
}

// Os resultados são JSON no banco: um campo que não veio como texto não derruba a tela.
const asText = (value: unknown) => (value == null ? '' : String(value).trim());
const isDone = (exam: TrendExam) => exam.status === 'realizado';
const hasDate = (exam: TrendExam): exam is TrendExam & { exam_date: string } =>
  Boolean(exam.exam_date) && isValidISODate(exam.exam_date!.slice(0, 10));

/** Há o que mostrar na evolução: algum exame realizado com resultados. */
export function hasExamResults(exams: TrendExam[]): boolean {
  return exams.some((e) => isDone(e) && e.results.length > 0);
}

/** "108 mg/dL", "5,6%", "Não reagente". */
export function valueLabel(point: Pick<TrendPoint, 'value' | 'unit'>): string {
  if (!point.unit) return point.value;
  return point.unit === '%' ? `${point.value}%` : `${point.value} ${point.unit}`;
}

/** "1 resultado", "3 resultados". */
export function countLabel(count: number): string {
  return count === 1 ? '1 resultado' : `${count} resultados`;
}

/**
 * O que mudou do resultado anterior para o último, sem dizer se isso é bom ou
 * ruim: "subiu 9 (9%) desde 12/03/2026", "desceu 0,4 (7%) desde…", "igual ao
 * de…". A diferença sai com as casas do laudo; a porcentagem é sobre o valor
 * anterior, arredondada (sem ela quando o anterior é zero). Com "<" ou ">" não
 * há conta: só o valor anterior.
 */
export function changeSentence(last: TrendPoint, previous: TrendPoint): string {
  const sameDay = previous.date === last.date;
  const since = sameDay ? 'o resultado anterior do mesmo dia' : formatBRDate(previous.date);
  const equal = sameDay ? 'igual ao resultado anterior do mesmo dia' : `igual ao de ${since}`;
  if (last.number === null || previous.number === null || last.mark || previous.mark) {
    if (last.value === previous.value) return equal;
    return sameDay ? `era ${previous.value} no resultado anterior do mesmo dia` : `era ${previous.value} em ${since}`;
  }
  const decimals = Math.max(last.decimals, previous.decimals);
  const diff = Number((last.number - previous.number).toFixed(decimals));
  if (diff === 0) return equal;
  const amount = formatResultNumber(Math.abs(diff), decimals);
  const percent = previous.number === 0 ? null : Math.round((Math.abs(diff) / Math.abs(previous.number)) * 100);
  const share = percent === null ? '' : percent < 1 ? ' (menos de 1%)' : ` (${formatResultNumber(percent, 0)}%)`;
  return `${diff > 0 ? 'subiu' : 'desceu'} ${amount}${share} desde ${since}`;
}

/**
 * Pontos do gráfico já na escala de 0 a 1. O x segue o tempo (dois exames
 * próximos ficam próximos); com tudo no mesmo dia, os pontos se espalham por
 * igual. O y vai do menor ao maior valor; todos iguais ficam no meio.
 */
export function chartPoints(points: TrendPoint[]): ChartPoint[] {
  const values = points.map((p) => p.number ?? 0);
  const min = Math.min(...values);
  const span = Math.max(...values) - min;
  const days = points.map((p) => diffDays(points[0].date, p.date));
  const period = days[days.length - 1] ?? 0;
  return points.map((_, index) => ({
    x: period > 0 ? days[index] / period : points.length > 1 ? index / (points.length - 1) : 0.5,
    y: span > 0 ? (values[index] - min) / span : 0.5,
  }));
}

/** Quantos resultados a descrição falada do gráfico lê (os mais recentes). */
const SPOKEN_POINTS = 8;

/** O gráfico em palavras, para leitores de tela: "Glicose, 3 resultados: 92 mg/dL em 10/01/2026, …". */
export function chartDescription(item: TrendItem): string {
  const recent = item.points.slice(-SPOKEN_POINTS);
  const values = recent.map((p) => `${valueLabel(p)} em ${formatBRDate(p.date)}`).join(', ');
  const count = countLabel(item.points.length);
  return recent.length < item.points.length
    ? `${item.name}, ${count}. Os ${recent.length} mais recentes: ${values}.`
    : `${item.name}, ${count}: ${values}.`;
}

// Marcados no último resultado primeiro, depois o mais recente; o nome desempata.
function byAttention(a: TrendItem, b: TrendItem): number {
  return (
    Number(Boolean(b.last.flag)) - Number(Boolean(a.last.flag)) ||
    b.last.date.localeCompare(a.last.date) ||
    a.name.localeCompare(b.name, 'pt-BR') ||
    a.key.localeCompare(b.key)
  );
}

/**
 * Junta os resultados dos exames de UMA pessoa por item. Só entram exames
 * realizados e com data. Um item numérico vira série quando tem dois ou mais
 * resultados na mesma unidade (ou todos sem unidade): unidades diferentes
 * ficam em itens separados, sem conversão. Dois exames no mesmo dia mantêm os
 * dois pontos, na ordem em que foram criados.
 */
export function examTrends(exams: TrendExam[]): ExamTrends {
  const dated = exams
    .filter((e) => isDone(e) && hasDate(e))
    .sort(
      (a, b) =>
        a.exam_date!.localeCompare(b.exam_date!) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
    );
  const names = new Map<string, string>();
  const numeric = new Map<string, { nameKey: string; points: TrendPoint[] }>();
  const textual = new Map<string, { nameKey: string; points: TrendPoint[] }>();

  for (const exam of dated) {
    for (const result of exam.results) {
      const written = asText(result.value);
      if (!written) continue;
      const name = asText(result.name);
      const nameKey = examItemKey(name);
      // Do mais antigo para o mais novo: fica a grafia mais recente.
      names.set(nameKey, name || 'Sem nome');
      const fieldUnit = asText(result.unit) || null;
      let parsed = parseResultValue(written);
      // Unidade no valor diferente da do campo: na dúvida, não é um número comparável.
      if (parsed?.unit && fieldUnit && normalizeUnit(parsed.unit) !== normalizeUnit(fieldUnit)) parsed = null;
      const unit = fieldUnit ?? parsed?.unit ?? null;
      const point: TrendPoint = {
        examId: exam.id,
        examTitle: exam.title,
        date: exam.exam_date!.slice(0, 10),
        value: parsed
          ? `${parsed.mark ? `${parsed.mark} ` : ''}${formatResultNumber(parsed.number, parsed.decimals)}`
          : written,
        number: parsed ? parsed.number : null,
        decimals: parsed ? parsed.decimals : 0,
        mark: parsed ? parsed.mark : null,
        unit,
        flag: result.flag ?? null,
        reference: asText(result.reference) || null,
      };
      const groups = parsed ? numeric : textual;
      const key = parsed ? `n:${nameKey}|${normalizeUnit(unit)}` : `t:${nameKey}`;
      const group = groups.get(key) ?? { nameKey, points: [] };
      group.points.push(point);
      groups.set(key, group);
    }
  }

  const toItem = ([key, group]: [string, { nameKey: string; points: TrendPoint[] }]): TrendItem => ({
    key,
    name: names.get(group.nameKey)!,
    points: group.points,
    last: group.points[group.points.length - 1],
  });
  const numbers = [...numeric].map(toItem);
  return {
    series: numbers
      .filter((item) => item.points.length > 1)
      .map((item) => ({
        ...item,
        change: changeSentence(item.last, item.points[item.points.length - 2]),
        chart: chartPoints(item.points),
      }))
      .sort(byAttention),
    single: numbers.filter((item) => item.points.length === 1).sort(byAttention),
    text: [...textual].map(toItem).sort(byAttention),
    undated: exams.filter((e) => isDone(e) && !hasDate(e) && e.results.length > 0).map((e) => ({ id: e.id, title: e.title })),
  };
}

// ---------------------------------------------------------------------------
// Resumo para a consulta

export type SummaryPerson = Pick<Person, 'id' | 'name' | 'kind' | 'birth_date' | 'allergies' | 'conditions' | 'species'>;

export type SummaryMedication = Pick<
  Medication,
  | 'person_id'
  | 'name'
  | 'dosage'
  | 'times'
  | 'start_on'
  | 'end_on'
  | 'active'
  | 'frequency'
  | 'weekdays'
  | 'interval_days'
  | 'total_doses'
  | 'taken_count'
>;

const oneLine = (text: string | null) => (text ?? '').replace(/\s+/g, ' ').trim();

/** "Losartana 50 mg: todo dia, 08:00 (uso contínuo)" */
function medicationLine(m: SummaryMedication, today: string): string {
  const schedule = {
    frequency: m.frequency,
    weekdays: m.weekdays,
    intervalDays: m.interval_days,
    startOn: m.start_on,
    endOn: m.end_on,
    totalDoses: m.total_doses,
    takenCount: m.taken_count,
  };
  const how = [describeFrequency(schedule), ...[...m.times].sort()].join(', ');
  const starts = m.start_on > today ? `, começa em ${formatBRDate(m.start_on)}` : '';
  return `${[m.name.trim(), oneLine(m.dosage)].filter(Boolean).join(' ')}: ${how} (${describeCourse(schedule)}${starts})`;
}

function resultLine(item: TrendItem): string {
  const flag = flagLabel(item.last.flag);
  return `${item.name}: ${valueLabel(item.last)} em ${formatBRDate(item.last.date)}${flag ? ` (marcado no laudo: ${flag.toLowerCase()})` : ''}`;
}

/**
 * Texto simples para levar à consulta, só com o que está anotado no Kotii:
 * ficha, remédios em uso, últimos resultados, o que mudou nos últimos 12 meses
 * e exames ainda por fazer. Cada bloco só aparece quando tem algo. Recebe as
 * listas da casa e usa só o que é da pessoa. É dado de saúde: quem chama
 * guarda o texto só na memória, até a pessoa copiar ou compartilhar.
 */
export function visitSummary(person: SummaryPerson, exams: TrendExam[], medications: SummaryMedication[], today: string): string {
  const mine = exams.filter((e) => e.person_id === person.id);
  const trends = examTrends(mine);
  const age = person.birth_date ? ageLabel(person.birth_date, today) : null;
  const species = person.kind === 'pet' ? oneLine(person.species) : '';
  const blocks: string[][] = [];
  const list = (title: string, lines: string[]) => {
    if (lines.length) blocks.push([`${title}:`, ...lines.map((line) => `- ${line}`)]);
  };

  const record = [
    oneLine(person.allergies) ? `Alergias: ${oneLine(person.allergies)}` : null,
    oneLine(person.conditions) ? `Condições: ${oneLine(person.conditions)}` : null,
  ].filter((line): line is string => Boolean(line));
  if (record.length) blocks.push(record);

  list(
    'Remédios em uso',
    medications
      .filter(
        (m) =>
          m.person_id === person.id &&
          m.active &&
          (!m.end_on || m.end_on >= today) &&
          dosesLeft({ totalDoses: m.total_doses, takenCount: m.taken_count }) !== 0,
      )
      .map((m) => medicationLine(m, today)),
  );

  // Tudo do exame mais recente, mais o que está marcado no último resultado.
  const items = [...trends.series, ...trends.single, ...trends.text];
  const latest = items.reduce((max, item) => (item.last.date > max ? item.last.date : max), '');
  list(
    'Últimos resultados',
    items
      .filter((item) => item.last.date === latest || item.last.flag)
      .sort((a, b) => b.last.date.localeCompare(a.last.date))
      .map(resultLine),
  );

  const yearAgo = addMonths(today, -12);
  list(
    'O que mudou',
    trends.series
      .filter((s) => s.last.date >= yearAgo)
      .map((s) => `${s.name}: ${valueLabel(s.last)} em ${formatBRDate(s.last.date)}; ${s.change}`),
  );

  list(
    'Exames pedidos ou agendados',
    mine
      .filter((e) => !isDone(e))
      .sort((a, b) => (a.exam_date ?? '9999').localeCompare(b.exam_date ?? '9999') || a.created_at.localeCompare(b.created_at))
      .map((e) => {
        const status = EXAM_STATUS.find((s) => s.value === e.status)!.label.toLowerCase();
        return `${e.title} (${status}${hasDate(e) ? `, ${formatBRDate(e.exam_date)}` : ''})`;
      }),
  );

  list(
    'Exames realizados sem data anotada (os resultados ficaram fora deste resumo)',
    trends.undated.map((e) => e.title),
  );

  if (!blocks.length) blocks.push(['Ainda não há alergias, condições, remédios nem exames anotados no Kotii.']);

  const who = `${person.name.trim()}${species ? ` (${species})` : ''}${age ? `, ${age}` : ''}`;
  return [
    `Resumo para a consulta: ${who}`,
    ...blocks.map((lines) => lines.join('\n')),
    `Gerado pelo Kotii em ${formatBRDate(today)}. Confira com os laudos.`,
  ].join('\n\n');
}

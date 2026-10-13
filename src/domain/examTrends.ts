// Evolução dos exames de uma pessoa: junta o mesmo item de laudos diferentes
// (pela chave do nome), monta a série dos valores numéricos e escreve o resumo
// para levar à consulta. O app só mostra o que está nos laudos: não decide o
// que é esperado nem lê os valores de referência; a marcação (acima, abaixo,
// alterado) é a que veio do laudo ou de quem digitou.

import type { Exam, Medication, Person } from '@/lib/types';
import { addDays, addMonths, diffDays, formatBRDate, isValidISODate } from './dates';
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

// Letra grega vira palavra antes de a pontuação sair: sem isso, α1-globulina e
// β1-globulina dariam a mesma chave, e "γ-GT" não acharia "gama gt".
const GREEK: Record<string, string> = { α: 'alfa', β: 'beta', γ: 'gama', δ: 'delta' };

/**
 * Chave que junta o mesmo item entre laudos: sem acento, maiúsculas,
 * pontuação e espaços a mais ("GLICOSE (jejum)" e "Glicemia de jejum" dão
 * "glicose"). Nome fora da tabela só junta com ele mesmo.
 */
export function examItemKey(name: string): string {
  const plain = normalizeSearch(name)
    .replace(/[αβγδ]/g, (letter) => ` ${GREEK[letter]} `)
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
  /**
   * Lido como milhar, mas com um ponto só e sem vírgula ("1.020", "2.450"):
   * pode ser um decimal escrito com ponto. A leitura fica; a série que mistura
   * as duas escritas perde o gráfico (ver mixedReadings).
   */
  ambiguous: boolean;
}

const MARKS: Record<string, ValueMark> = { '<': '<', '>': '>', '≤': '≤', '≥': '≥', '<=': '≤', '>=': '≥' };
// O limite escrito por extenso, já sem acento e maiúsculas, vale como o símbolo.
const WORDED_MARKS = new Map<string, ValueMark>([
  ['inferior a', '<'],
  ['menor que', '<'],
  ['abaixo de', '<'],
  ['superior a', '>'],
  ['maior que', '>'],
  ['acima de', '>'],
]);
const VALUE = /^(<=|>=|[<>≤≥])?\s*([-−])?\s*(\d[\d.,]*)\s*(.*)$/;
const THOUSANDS = /^[1-9]\d{0,2}(\.\d{3})+$/;
// Uma palavra só, com letra (ou "%"): "mg/dL", "/mm³", "%". "120/80", "1:80",
// "2 a 4 por campo" e "3+" não são um número com unidade.
const INLINE_UNIT = /^(%|\/?[a-zà-ÿµμ][^\s+:]{0,14})$/i;

/**
 * Lê um resultado como número, do jeito brasileiro: vírgula é decimal e ponto
 * seguido de três dígitos é milhar ("1.234" é mil duzentos e trinta e quatro,
 * "7.500" leucócitos é sete mil e quinhentos); ponto fora disso é decimal
 * ("1.2", "1234.5", "0.500"). Aceita "<" e ">" na frente (ou "inferior a",
 * "maior que"…, que valem como o símbolo) e a unidade junto. "negativo",
 * "reagente", "+++", "1:80" devolvem null (ficam como texto).
 */
export function parseResultValue(value: string): ParsedValue | null {
  let text = value.replace(/ /g, ' ').trim();
  const words = text.match(/^[^\d<>≤≥−-]+/)?.[0] ?? '';
  const worded = WORDED_MARKS.get(normalizeSearch(words).replace(/\s+/g, ' '));
  if (worded) text = `${worded} ${text.slice(words.length)}`;
  const match = text.match(VALUE);
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
  const thousands = THOUSANDS.test(integer);
  const ambiguous = thousands && comma < 0 && integer.split('.').length === 2;
  if (thousands) integer = integer.replace(/\./g, '');
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
    ambiguous,
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
  /** Ver ParsedValue: "1.020" lido como milhar, que pode ser um decimal. */
  ambiguous: boolean;
  /** Como foi escrita no laudo ("%" quando só o nome do item diz: "LYM%"). */
  unit: string | null;
  flag: ResultFlag | null;
  reference: string | null;
}

export interface TrendItem {
  /** Única entre as três listas. */
  key: string;
  /** Como está escrito no último resultado do item; com nome genérico, "título do exame: nome". */
  name: string;
  /** Do mais antigo para o mais novo. */
  points: TrendPoint[];
  last: TrendPoint;
  /**
   * Só nos numéricos: o resultado mais novo do mesmo item que ficou em outro
   * grupo, por estar sem unidade ou em outra. Os dois não foram comparados.
   */
  newerElsewhere: TrendPoint | null;
  /**
   * Só nos numéricos: o resultado mais novo do mesmo item que ficou guardado
   * como texto ("Indetectável" depois de um número, ou a unidade do valor
   * diferente da do campo). Não entra nos pontos, na conta nem no gráfico.
   */
  newerText: TrendPoint | null;
  /** Unidades, como escritas, dos outros grupos do mesmo item (ver apartNote). */
  otherUnits: string[];
  /** De que material é, quando o nome ou o título do exame diz ("urina", "24h", "fezes", "liquor"); "" sem isso. */
  material: string;
  /** Só nos numéricos: os materiais dos outros itens de mesmo nome ("" é quem não diz o material). */
  otherMaterials: string[];
  /** Onde o último resultado está: a ordem do exame e a do resultado dentro do laudo. */
  order: [number, number];
}

/** Posição de um ponto no gráfico, de 0 a 1 (y = 1 é o maior valor). */
export interface ChartPoint {
  x: number;
  y: number;
}

export interface TrendSeries extends TrendItem {
  /** "subiu 9 (9%) desde 12/03/2026" */
  change: string;
  /** Vazio quando a série mistura leituras que não se comparam ("1.020" e "1,015"). */
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
  /** Exames realizados com resultados e data depois de hoje: ficam de fora até a data ser conferida. */
  future: { id: string; title: string; date: string }[];
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

// A partir de quantas vezes maior (ou menor) dois resultados seguidos deixam de
// ser comparados: na prática são leituras diferentes (outro material, "2.450"
// lido como milhar ao lado de "2,45"), e não uma mudança de verdade.
const FAR_APART = 10;
// Idem para tirar o gráfico de uma série com milhar ambíguo (ver mixedReadings).
const MIXED_APART = 100;

/** Um número é `times` vezes o outro, ou mais (zero não tem "vezes"). */
function farApart(a: number, b: number, times: number): boolean {
  const [small, big] = [Math.abs(a), Math.abs(b)].sort((x, y) => x - y);
  // A folga cobre a conta de ponto flutuante (11 / 1,1 dá 9,999…).
  return small > 0 && big / small >= times - 1e-9;
}

/** "igual ao de 12/03/2026": a frase de quando o valor não mudou. */
const isUnchanged = (change: string) => change.startsWith('igual');

/**
 * O que mudou do resultado anterior para o último, sem dizer se isso é bom ou
 * ruim: "subiu 9 (9%) desde 12/03/2026", "desceu 0,4 (7%) desde…", "igual ao
 * de…". A diferença sai com as casas do laudo; a porcentagem é sobre o valor
 * anterior, arredondada (sem ela quando o anterior é zero). Em "%", a mudança
 * é em pontos percentuais e não leva porcentagem ("subiu 0,4 ponto
 * percentual…"; plural de 2 em diante). Sem conta, só o valor anterior ("era
 * 0,8 em…"): com "<" ou ">", e quando um valor é dez vezes o outro ou mais.
 */
export function changeSentence(last: TrendPoint, previous: TrendPoint): string {
  const sameDay = previous.date === last.date;
  const since = sameDay ? 'o resultado anterior do mesmo dia' : formatBRDate(previous.date);
  const equal = sameDay ? 'igual ao resultado anterior do mesmo dia' : `igual ao de ${since}`;
  const was = sameDay ? `era ${previous.value} no resultado anterior do mesmo dia` : `era ${previous.value} em ${since}`;
  if (last.number === null || previous.number === null || last.mark || previous.mark) {
    return last.value === previous.value ? equal : was;
  }
  const decimals = Math.max(last.decimals, previous.decimals);
  const diff = Number((last.number - previous.number).toFixed(decimals));
  if (diff === 0) return equal;
  if (farApart(last.number, previous.number, FAR_APART)) return was;
  const amount = formatResultNumber(Math.abs(diff), decimals);
  const moved = `${diff > 0 ? 'subiu' : 'desceu'} ${amount}`;
  if (normalizeUnit(last.unit) === '%') {
    return `${moved} ${Math.abs(diff) < 2 ? 'ponto percentual' : 'pontos percentuais'} desde ${since}`;
  }
  const percent = previous.number === 0 ? null : Math.round((Math.abs(diff) / Math.abs(previous.number)) * 100);
  const share = percent === null ? '' : percent < 1 ? ' (menos de 1%)' : ` (${formatResultNumber(percent, 0)}%)`;
  return `${moved}${share} desde ${since}`;
}

/**
 * A série mistura leituras que não se comparam: um valor de milhar ambíguo
 * ("1.020") cem vezes maior ou menor que outro ponto ("1,015"). O gráfico
 * dela não é desenhado: a linha seria um salto que não existiu.
 */
function mixedReadings(points: TrendPoint[]): boolean {
  return points.some((a) => a.ambiguous && points.some((b) => farApart(a.number ?? 0, b.number ?? 0, MIXED_APART)));
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

// Nomes que não dizem o que foi medido: só valem dentro do próprio exame. A IA
// chama de "Conclusão" o texto de todo laudo descritivo (ultrassom, raio-X…);
// juntos pelo nome, laudos sem relação virariam um item só. A chave tem de ser
// exatamente uma destas (o plural entra escrito, sem regra): "Valor de TSH" é
// um item como outro qualquer, e o nome do que foi medido ("Aspecto", "Cor",
// "Volume", "Total") não entra aqui.
const GENERIC_NAMES = new Set([
  'conclusao',
  'conclusoes',
  'resultado',
  'resultados',
  'laudo',
  'laudos',
  'impressao',
  'impressao diagnostica',
  'hipotese diagnostica',
  'diagnostico',
  'observacao',
  'observacoes',
  'obs',
  'comentario',
  'comentarios',
  'nota',
  'notas',
  'achados',
  'parecer',
  'interpretacao',
  'valor',
  'valores',
]);

// Material que não é sangue, quando o nome do resultado ou o título do exame
// diz. Só separa: a "Creatinina" de um exame de urina não entra na série da do
// sangue, e nada some por causa disso (a linha avisa: ver apartNote). "Sangue
// oculto" é o nome de um exame de fezes, no título e no nome do resultado.
const MATERIALS: [string, RegExp][] = [
  ['urina', /\b(urina|urinari[a-z]*|eas)\b/],
  ['24h', /\b24 ?h(s|oras?)?\b/],
  ['fezes', /\b(fezes|sangue oculto)\b/],
  ['liquor', /\bliquor\b/],
];
const MATERIAL_LABEL: Record<string, string> = { urina: 'urina', '24h': 'urina de 24 horas', fezes: 'fezes', liquor: 'líquor' };

// O que separa as partes de um título. Uns separam dois exames ("+", ",", ";",
// "&", "/", e "e" e "mais" entre palavras); os outros prendem um detalhe ao
// exame do lado (o hífen ou o travessão entre espaços, "|" e "com").
const TITLE_EXAMS = /[+,;&/]|\b(?:e|mais)\b/;
const TITLE_DETAILS = /\||\s[-–—]\s|\bcom\b/;
// O que diz "sangue" num título. Umas palavras são o nome de um exame de
// sangue. As outras dizem como ou por que o exame foi feito e servem para
// qualquer material ("Bioquímica do líquor", "EAS - rotina"): as de análise
// (bioquímica, sérico, plasmático) e as genéricas (rotina, check-up,
// laboratorial). O que elas valem depende de onde estão: ver titleMaterials.
const BLOOD_EXAM = /\b(sangue(?! ocult)|sanguine[oa]s?|hematologic[oa]s?|hemograma|soro|plasma|lipidograma|coagulograma|glicemia)\b/;
const ANALYSIS = /\b(bioquimic[ao]s?|seric[oa]s?|plasmatic[oa]s?)\b/;
const GENERIC = /\b(rotina|check ?up|laboratoria(l|is))\b/;

const plainWords = (text: string) => normalizeSearch(text).replace(/[^a-z0-9]+/g, ' ');

// Exames de um dia inteiro que não são de urina ("Holter 24 horas", "MAPA
// 24h", "pH-metria de 24 horas"): neles, "24h" não diz o material. "MAPA" e
// "pressão" só contam escritos antes do "24h": depois dele são o motivo de um
// exame de urina ("Proteinúria 24h - controle de pressão"). E nada disso vale
// quando o texto fala de urina ou tem um termo da urina de 24 horas. O que
// sobra de limite: o motivo antes do "24h" e sem termo de urina ("Pressão alta
// - sódio 24h") fica sem material.
const DAY_LONG = /\b(holter|ph ?metria|polissonografia|eeg|eletroencefalograma|ecg|eletrocardiograma|monitorizacao)\b/;
const DAY_LONG_BEFORE = /\b(mapa|m a p a|pressao)\b/;
const DAY_URINE = /\b([a-z]+uria|clearance|depuracao|catecolaminas?|metanefrinas?)\b/;
const [[, URINE], [, WHOLE_DAY]] = MATERIALS;
const saysUrine = (plain: string) => URINE.test(plain) || DAY_URINE.test(plain);

function dayLongNotUrine(plain: string): boolean {
  if (saysUrine(plain)) return false;
  if (DAY_LONG.test(plain)) return true;
  const reason = plain.search(DAY_LONG_BEFORE);
  return reason >= 0 && reason < plain.search(WHOLE_DAY);
}

// O título de um exame de um dia inteiro que não é de urina, para o "24h" do
// nome dos resultados dele. "MAPA" sem "24h" nenhum no título também é: os
// resultados trazem o "24h" no nome ("PAS média 24h"), e o laudo seguinte,
// guardado como "MAPA 24h", tem de cair na mesma série.
const MAPA = /\b(mapa|m a p a)\b/;
const dayLongTitle = (plain: string) => dayLongNotUrine(plain) || (!saysUrine(plain) && MAPA.test(plain) && !WHOLE_DAY.test(plain));

/**
 * Os materiais ditos num texto. A urina de 24 horas é um material à parte da
 * urina comum. `inDayLong`: o texto é parte de um exame de um dia inteiro que
 * não é de urina ("FC média 24h" dentro de "Holter 24h"), e o "24h" dele só
 * vale como material se o próprio texto falar de urina.
 */
function materialsIn(text: string, inDayLong = false): string[] {
  const plain = plainWords(text);
  const dayLong = dayLongNotUrine(plain) || (inDayLong && !saysUrine(plain));
  const found = MATERIALS.filter(([material, pattern]) => pattern.test(plain) && !(dayLong && material === '24h')).map(([material]) => material);
  return found.includes('24h') ? found.filter((material) => material !== 'urina') : found;
}

/**
 * O material que o título do exame diz, quando ele é de um material só.
 * Título que junta materiais diferentes ("Hemograma + EAS", "Sangue e urina",
 * "Urina e fezes") não diz de qual é cada resultado: aí só vale o nome do
 * resultado. Cada exame do título pode ter um detalhe preso a ele ("Líquor –
 * bioquímica", "Hemograma com EAS"), e cada pedaço diz uma coisa: o material,
 * se fala de um (mesmo ao lado de "sangue": "Pesquisa de sangue na urina");
 * sangue, se tem o nome de um exame de sangue. A palavra de análise ou
 * genérica vale pela posição: DEPOIS do material, presa a ele, é um detalhe
 * do exame ("Urina com bioquímica", "EAS - rotina" são de urina); ANTES do
 * material, ou sozinha na parte dela, é um exame de sangue ("Bioquímica com
 * EAS", "Bioquímica e EAS", "EAS + bioquímica", "Rotina + EAS" são dois
 * exames). A genérica sozinha numa parte que vem depois de um material não
 * diz nada ("EAS, rotina", "EAS e urocultura de rotina" são de urina). O que
 * sobra de limite: a parte sem material e sem nenhuma dessas palavras
 * ("Glicose e EAS", "TSH + urina") não diz nada, o título continua valendo
 * como urina e o erro fica do lado de não comparar; e a análise escrita antes
 * do material com um traço ("Bioquímica – líquor") lê como dois exames.
 */
function titleMaterials(title: string): string[] {
  // O título inteiro, e não cada parte: em "MAPA - 24 horas" o nome do exame e o "24h" ficam em partes diferentes.
  const dayLong = dayLongNotUrine(plainWords(title));
  const found: string[][] = [];
  // Algum exame anterior do título já disse um material.
  let materialBefore = false;
  for (const exam of normalizeSearch(title).split(TITLE_EXAMS)) {
    const pieces = exam.split(TITLE_DETAILS).map((piece) => ({ materials: materialsIn(piece, dayLong), plain: plainWords(piece) }));
    // O primeiro pedaço deste exame que diz um material (-1: nenhum).
    const first = pieces.findIndex((piece) => piece.materials.length > 0);
    pieces.forEach(({ materials, plain }, at) => {
      if (materials.length) found.push(materials);
      else if (BLOOD_EXAM.test(plain)) found.push(['sangue']);
      // Depois do material, no mesmo exame, a palavra de análise ou genérica é um detalhe dele.
      else if (first >= 0 && at > first) return;
      else if (ANALYSIS.test(plain) || (GENERIC.test(plain) && (first >= 0 || !materialBefore))) found.push(['sangue']);
    });
    if (first >= 0) materialBefore = true;
  }
  // "Urina - 24 horas", "Creatinina urinária - 24h": a urina de uma parte é a
  // de 24 horas da outra, como já é dentro de uma parte só (ver materialsIn).
  const wholeDay = found.some((materials) => materials.includes('24h'));
  const parts = wholeDay
    ? found.map((materials) => [...new Set(materials.map((material) => (material === 'urina' ? '24h' : material)))])
    : found;
  const kinds = new Set(parts.map((materials) => materials.join('+')));
  return kinds.size === 1 && !kinds.has('sangue') ? parts[0] : [];
}

// O nome do resultado que diz sangue. Só o adjetivo e o "no sangue" por
// extenso: a palavra "sangue" solta é também um item da urina ("Sangue", na
// fita) e das fezes ("Sangue oculto").
const BLOOD_NAME = /\b(seric[oa]s?|plasmatic[oa]s?|sanguine[oa]s?|no sangue|no soro|no plasma)\b/;

/**
 * O material do resultado: pelo nome dele e, quando o exame é de um material
 * só, pelo título. O nome que diz sangue e nenhum material ("Creatinina
 * sérica" no laudo do clearance, que é de urina de 24h) não pega o do título.
 * "Sangue oculto" (sem a palavra "fezes" no nome) dentro de um exame que é só
 * de outro material é um item desse exame: o da fita da urina, num EAS.
 */
function materialKey(name: string, title: string): string {
  const plainName = plainWords(name);
  const named = materialsIn(name, dayLongTitle(plainWords(title)));
  if (!named.length && BLOOD_NAME.test(plainName)) return '';
  const fromTitle = titleMaterials(title);
  const occultOnly = named.length === 1 && named[0] === 'fezes' && !/\bfezes\b/.test(plainName);
  const own = occultOnly && fromTitle.length === 1 && fromTitle[0] !== 'fezes' ? [] : named;
  const found = new Set([...own, ...fromTitle]);
  if (found.has('24h')) found.delete('urina');
  return MATERIALS.map(([material]) => material)
    .filter((material) => found.has(material))
    .join('+');
}

/** Na ordem da lista de materiais (quem não diz o material vem antes). */
const materialRank = (material: string) => MATERIALS.findIndex(([name]) => name === material.split('+')[0]);

/** "urina", "urina de 24 horas", "urina e fezes". */
const materialLabel = (material: string) => listWords(material.split('+').map((part) => MATERIAL_LABEL[part] ?? part));

// "LYM%", "LYM#", "Hematócrito (%)": o símbolo no fim do nome.
const NAME_SYMBOL = /([%#])\s*[)\]]?\s*$/;

interface Group {
  key: string;
  /** Qual das vezes do item no laudo (1 quando ele aparece uma vez só): a segunda vez é outro grupo. */
  nth: number;
  /** O item sem a unidade: nome, material e, no nome genérico, o exame. */
  family: string;
  /** A família dos resultados em texto do mesmo item (num grupo de texto, a dele). */
  textFamily: string;
  /** O item sem a unidade nem o material: para avisar que há outro de mesmo nome em outro material. */
  base: string;
  material: string;
  unitKey: string;
  name: string;
  points: TrendPoint[];
  /** Onde o último ponto está: a ordem do exame e a do resultado dentro dele. */
  examIndex: number;
  resultIndex: number;
}

const lastOf = (group: Group) => group.points[group.points.length - 1];

/**
 * Dois grupos do mesmo item em unidades diferentes são "o mesmo em outra
 * unidade"? Não quando algum laudo traz os dois: o percentual e a contagem do
 * diferencial do hemograma (60% e 4.125 /mm³) são duas medidas, e uma não é o
 * resultado mais novo da outra. Já a hemoglobina glicada em % num laudo e em
 * mmol/mol no seguinte é a mesma coisa, e a linha avisa que não foi comparada.
 * "Neutrófilos" e "Neutrófilos #", os dois sem unidade, também ficam sem
 * aviso: os nomes já dizem que são duas linhas.
 */
function sameInOtherUnit(a: Group, b: Group): boolean {
  if (a.unitKey === b.unitKey) return false;
  if ((!a.unitKey && b.unitKey === '#') || (a.unitKey === '#' && !b.unitKey)) return false;
  const exams = new Set(a.points.map((point) => point.examId));
  return !b.points.some((point) => exams.has(point.examId));
}

/** Positivo quando o último ponto de `a` vem depois do de `b`. */
function later(a: Group, b: Group): number {
  return lastOf(a).date.localeCompare(lastOf(b).date) || a.examIndex - b.examIndex || a.resultIndex - b.resultIndex;
}

// Marcados no último resultado primeiro, depois o mais recente; na mesma data,
// a ordem do laudo (o exame, depois a posição do resultado nele), que é única.
function byAttention(a: Group, b: Group): number {
  return (
    Number(Boolean(lastOf(b).flag)) - Number(Boolean(lastOf(a).flag)) ||
    lastOf(b).date.localeCompare(lastOf(a).date) ||
    a.examIndex - b.examIndex ||
    a.resultIndex - b.resultIndex
  );
}

/** "mg/dL", "mg/dL e mmol/L", "mg/dL, mmol/L e g/L". */
function listWords(words: string[]): string {
  return words.length > 1 ? `${words.slice(0, -1).join(', ')} e ${words[words.length - 1]}` : words.join('');
}

/**
 * "Há um resultado mais recente…": o mesmo item tem um resultado mais novo em
 * outra unidade ou guardado como texto (dos dois, o mais novo). O texto sai
 * como foi guardado, sem a unidade do campo ao lado, e a data vem antes dele:
 * um valor que já termina com ponto não leva outro. null sem nenhum dos dois.
 */
function newerNote(item: Pick<TrendItem, 'last' | 'newerElsewhere' | 'newerText'>): string | null {
  const newer = item.newerElsewhere;
  const text = item.newerText;
  if (text && (!newer || text.date > newer.date)) {
    const written = /[.!?…:;]$/.test(text.value) ? text.value : `${text.value}.`;
    return `Há um resultado mais recente em texto (${formatBRDate(text.date)}): ${written} Não foi comparado.`;
  }
  if (!newer) return null;
  const how = !newer.unit ? 'sem unidade' : item.last.unit ? 'em outra unidade' : 'com unidade';
  return `Há um resultado mais recente ${how}: ${valueLabel(newer)} em ${formatBRDate(newer.date)}. Não foi comparado.`;
}

/**
 * O que a linha de um item numérico avisa quando o mesmo item também está em
 * outro grupo, por causa da unidade ou do material (os grupos não são
 * comparados, e isso não pode passar em silêncio): que há um resultado mais
 * novo em outra unidade ou guardado como texto; no grupo sem unidade, por que
 * ele ficou à parte; e, entre materiais, que os de mesmo nome não foram
 * comparados. O item de um material com outro de mesmo nome diz o material
 * antes do outro aviso ("Exame de urina. Há um resultado mais recente…"): é
 * ele que conta qual das duas linhas é qual. null quando não há o que avisar.
 */
export function apartNote(
  item: Pick<TrendItem, 'last' | 'newerElsewhere' | 'newerText' | 'otherUnits' | 'material' | 'otherMaterials'>,
): string | null {
  const exam = item.material && item.otherMaterials.length ? `Exame de ${materialLabel(item.material)}` : null;
  const note =
    newerNote(item) ??
    (!item.last.unit && item.otherUnits.length ? `Sem unidade: não foi comparado com os resultados em ${listWords(item.otherUnits)}.` : null);
  if (note) return exam ? `${exam}. ${note}` : note;
  if (exam) return `${exam}: não foi comparado com os resultados de mesmo nome de outros exames.`;
  if (!item.otherMaterials.length) return null;
  return `Não foi comparado com os resultados de mesmo nome dos exames de ${listWords(item.otherMaterials.map(materialLabel))}.`;
}

/**
 * Junta os resultados dos exames de UMA pessoa por item. Só entram exames
 * realizados e com data; com `today`, os de data no futuro saem (`future`).
 * Um item numérico vira série quando tem dois ou mais resultados na mesma
 * unidade (ou todos sem unidade): unidades diferentes ficam em itens
 * separados, sem conversão. Na dúvida, separa em vez de comparar:
 * - nome genérico ("Conclusão", "Resultado") é um item por exame;
 * - urina, fezes e líquor não se juntam com quem não diz o material (vale o
 *   nome do resultado e, se o exame é de um material só, o título dele);
 * - o mesmo item duas vezes no mesmo laudo, em número ou em texto, são dois
 *   itens (a primeira ocorrência segue a primeira dos outros laudos, a segunda
 *   segue a segunda).
 * A ordem das listas: primeiro o que o último laudo marcou (é o que pede
 * atenção), depois o mais recente; na mesma data, a ordem do laudo.
 * Dois exames no mesmo dia mantêm os dois pontos, na ordem em que foram
 * criados.
 */
export function examTrends(exams: TrendExam[], today?: string): ExamTrends {
  const done = exams.filter(isDone);
  const isFuture = (e: TrendExam) => today !== undefined && hasDate(e) && e.exam_date.slice(0, 10) > today;
  const dated = done
    .filter((e) => hasDate(e) && !isFuture(e))
    .sort(
      (a, b) =>
        a.exam_date!.localeCompare(b.exam_date!) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
    );
  const numeric = new Map<string, Group>();
  const textual = new Map<string, Group>();

  dated.forEach((exam, examIndex) => {
    const title = asText(exam.title);
    // Quantas vezes cada grupo já apareceu neste exame.
    const seen = new Map<string, number>();
    exam.results.forEach((result, resultIndex) => {
      const written = asText(result.value);
      if (!written) return;
      const name = asText(result.name);
      const fieldUnit = asText(result.unit) || null;
      // Sem unidade no campo, o símbolo no fim do nome é o que separa "LYM%" de
      // "LYM#": "%" vale como a unidade; "#" (a contagem), sem unidade nenhuma,
      // fica num grupo à parte do percentual e de quem não diz. O resto do nome
      // continua achando o sinônimo ("HbA1c %" é hemoglobina glicada).
      const symbol = fieldUnit ? null : (name.match(NAME_SYMBOL)?.[1] ?? null);
      const itemKey = examItemKey(name);
      const generic = GENERIC_NAMES.has(itemKey);
      const material = materialKey(name, title);
      const item = [itemKey, material, generic ? exam.id : ''].join('|');
      const knownUnit = fieldUnit ?? (symbol === '%' ? '%' : null);
      let parsed = parseResultValue(written);
      // Unidade no valor diferente da do campo: na dúvida, não é um número comparável. O texto fica como veio
      // ("88 µmol/L"), sem a unidade do campo ao lado.
      const conflict = Boolean(parsed?.unit && knownUnit && normalizeUnit(parsed.unit) !== normalizeUnit(knownUnit));
      if (conflict) parsed = null;
      const unit = parsed ? (knownUnit ?? parsed.unit) : conflict ? null : fieldUnit;
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
        ambiguous: parsed ? parsed.ambiguous : false,
        unit,
        flag: result.flag ?? null,
        reference: asText(result.reference) || null,
      };
      const counted = symbol === '#' && !unit;
      const unitKey = normalizeUnit(unit) || (parsed && counted ? '#' : '');
      // Em texto não há unidade para separar: o "#" segue na chave do item.
      const textFamily = `t:${counted ? `${itemKey} #` : itemKey}|${material}|${generic ? exam.id : ''}`;
      const family = parsed ? `n:${item}` : textFamily;
      const base = `${itemKey}|${generic ? exam.id : ''}`;
      // O mesmo item duas vezes no laudo (em número ou em texto): a segunda ocorrência é outro grupo.
      const slot = parsed ? `${family}|${unitKey}` : family;
      const nth = (seen.get(slot) ?? 0) + 1;
      seen.set(slot, nth);
      const key = nth > 1 ? `${slot}|${nth}` : slot;
      const groups = parsed ? numeric : textual;
      const group = groups.get(key) ?? { key, nth, family, textFamily, base, material, unitKey, name: '', points: [], examIndex, resultIndex };
      group.points.push(point);
      // Do mais antigo para o mais novo: ficam o nome e a posição do último ponto.
      group.name = generic && title ? `${title}: ${name}` : name || 'Sem nome';
      group.examIndex = examIndex;
      group.resultIndex = resultIndex;
      groups.set(key, group);
    });
  });

  // O mesmo item em outra unidade (ou sem unidade) e o de mesmo nome em outro
  // material: só entre grupos numéricos.
  const families = new Map<string, Group[]>();
  const bases = new Map<string, Group[]>();
  for (const group of numeric.values()) {
    families.set(group.family, [...(families.get(group.family) ?? []), group]);
    bases.set(group.base, [...(bases.get(group.base) ?? []), group]);
  }
  // O mesmo item (com o mesmo material e, no nome genérico, o mesmo exame)
  // guardado como texto: só para a linha do número dizer que há um mais novo.
  const texts = new Map<string, Group[]>();
  for (const group of textual.values()) texts.set(group.family, [...(texts.get(group.family) ?? []), group]);
  const newestOf = (groups: Group[]) => groups.reduce<Group | null>((max, other) => (!max || later(other, max) > 0 ? other : max), null);
  const toItem = (group: Group, isNumber: boolean): TrendItem => {
    const last = lastOf(group);
    // O item que aparece duas vezes no laudo segue, nos outros grupos, o resultado da mesma vez: a primeira
    // linha não toma para si o "mais novo" que é da segunda.
    const sameTime = (other: Group) => other.nth === group.nth;
    const others = isNumber ? families.get(group.family)!.filter((other) => sameTime(other) && sameInOtherUnit(other, group)) : [];
    const newest = newestOf(others);
    const written = isNumber ? newestOf((texts.get(group.textFamily) ?? []).filter(sameTime)) : null;
    const sameName = isNumber ? bases.get(group.base)!.filter((other) => other.material !== group.material) : [];
    return {
      key: group.key,
      name: group.name,
      points: group.points,
      last,
      newerElsewhere: newest && lastOf(newest).date > last.date ? lastOf(newest) : null,
      newerText: written && lastOf(written).date > last.date ? lastOf(written) : null,
      otherUnits: [...new Set(others.map((other) => lastOf(other).unit).filter((unit): unit is string => Boolean(unit)))],
      material: group.material,
      otherMaterials: [...new Set(sameName.map((other) => other.material))].sort((a, b) => materialRank(a) - materialRank(b)),
      order: [group.examIndex, group.resultIndex],
    };
  };
  const numbers = [...numeric.values()].sort(byAttention).map((group) => toItem(group, true));
  const outside = (kept: (e: TrendExam) => boolean) => done.filter((e) => kept(e) && e.results.length > 0);
  return {
    series: numbers
      .filter((item) => item.points.length > 1)
      .map((item) => ({
        ...item,
        change: changeSentence(item.last, item.points[item.points.length - 2]),
        chart: mixedReadings(item.points) ? [] : chartPoints(item.points),
      })),
    single: numbers.filter((item) => item.points.length === 1),
    text: [...textual.values()].sort(byAttention).map((group) => toItem(group, false)),
    undated: outside((e) => !hasDate(e)).map((e) => ({ id: e.id, title: e.title })),
    future: outside(isFuture).map((e) => ({ id: e.id, title: e.title, date: e.exam_date!.slice(0, 10) })),
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

/** "Glicose: 108 mg/dL em 05/09/2026 (marcado no laudo: acima)". `name` é o nome como sai no resumo (ver nameOf). */
function resultLine(item: TrendItem, name: string): string {
  const flag = flagLabel(item.last.flag);
  return `${name}: ${valueLabel(item.last)} em ${formatBRDate(item.last.date)}${flag ? ` (marcado no laudo: ${flag.toLowerCase()})` : ''}`;
}

/** Quantos dias antes do exame mais recente ainda contam como "últimos resultados". */
const RECENT_DAYS = 30;

/**
 * Texto simples para levar à consulta, só com o que está anotado no Kotii:
 * ficha, remédios em uso, últimos resultados, o que mudou nos últimos 12 meses
 * e exames ainda por fazer. Cada bloco só aparece quando tem algo. Recebe as
 * listas da casa e usa só o que é da pessoa. É dado de saúde: quem chama
 * guarda o texto só na memória, até a pessoa copiar ou compartilhar.
 */
export function visitSummary(person: SummaryPerson, exams: TrendExam[], medications: SummaryMedication[], today: string): string {
  const mine = exams.filter((e) => e.person_id === person.id);
  const trends = examTrends(mine, today);
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

  // O último resultado de cada item nos 30 dias até o exame mais recente (os
  // laudos de um mesmo pedido saem com datas próximas), mais o que está marcado.
  const items = [...trends.series, ...trends.single, ...trends.text];
  const latest = items.reduce((max, item) => (item.last.date > max ? item.last.date : max), '');
  const since = latest ? addDays(latest, -RECENT_DAYS) : '';
  // Do mais novo para o mais antigo; na mesma data, a ordem do laudo.
  const recent = items
    .filter((item) => item.last.date >= since || item.last.flag)
    .sort((a, b) => b.last.date.localeCompare(a.last.date) || a.order[0] - b.order[0] || a.order[1] - b.order[1]);
  // Itens de mesmo nome em materiais diferentes (a "Creatinina" do sangue e a
  // da urina) sairiam com o mesmo rótulo: o que tem material leva ele ao lado
  // do nome, a não ser que o próprio nome já diga ("Densidade urinária").
  // "Sangue oculto" quer dizer fezes pela regra, mas não está escrito: o
  // material vai ao lado (o da fita da urina e o das fezes saem diferentes).
  const spelled = (name: string) => materialsIn(name).filter((material) => material !== 'fezes' || /fezes/.test(plainWords(name)));
  const materials = new Map<string, Set<string>>();
  for (const item of items) {
    const key = examItemKey(item.name);
    materials.set(key, (materials.get(key) ?? new Set<string>()).add(item.material));
  }
  const nameOf = (item: TrendItem) =>
    item.material && materials.get(examItemKey(item.name))!.size > 1 && !item.material.split('+').every((material) => spelled(item.name).includes(material))
      ? `${item.name} (${materialLabel(item.material)})`
      : item.name;
  // Há resultado mais novo do mesmo item em outro grupo ou em texto: a linha diz, em vez de passar por último.
  // Só esse aviso: o material, quando é o caso, já vai ao lado do nome.
  const noted = (line: string, item: TrendItem) => {
    const note = newerNote(item);
    return note ? `${line}. ${note}` : line;
  };
  list(
    'Últimos resultados',
    recent.map((item) => noted(resultLine(item, nameOf(item)), item)),
  );

  // Série que já está no bloco de cima leva só a mudança; a que não está leva
  // também valor e data. O que ficou igual não entra em "O que mudou".
  const listed = new Set(recent.map((item) => item.key));
  const yearAgo = addMonths(today, -12);
  list(
    'O que mudou',
    trends.series
      .filter((s) => s.last.date >= yearAgo && !isUnchanged(s.change))
      .map((s) => noted(listed.has(s.key) ? `${nameOf(s)}: ${s.change}` : `${resultLine(s, nameOf(s))}; ${s.change}`, s)),
  );

  // Por fazer: primeiro os agendados de hoje em diante, o mais próximo antes;
  // depois o resto, do mais novo para o mais antigo (sem data no fim).
  const dateOf = (e: TrendExam) => (hasDate(e) ? e.exam_date.slice(0, 10) : '');
  const ahead = (e: TrendExam) => e.status === 'agendado' && dateOf(e) >= today;
  const pending = mine.filter((e) => !isDone(e));
  list(
    'Exames pedidos ou agendados',
    [
      ...pending.filter(ahead).sort((a, b) => dateOf(a).localeCompare(dateOf(b)) || a.created_at.localeCompare(b.created_at)),
      ...pending.filter((e) => !ahead(e)).sort((a, b) => dateOf(b).localeCompare(dateOf(a)) || b.created_at.localeCompare(a.created_at)),
    ].map((e) => {
      const status = EXAM_STATUS.find((s) => s.value === e.status)!.label.toLowerCase();
      // No pedido, a data guardada é a do pedido, não a do exame.
      const when = !dateOf(e) ? '' : e.status === 'pedido' ? ` em ${formatBRDate(dateOf(e))}` : `, ${formatBRDate(dateOf(e))}`;
      return `${e.title} (${status}${when})`;
    }),
  );

  list(
    'Exames realizados sem data anotada (os resultados ficaram fora deste resumo)',
    trends.undated.map((e) => e.title),
  );

  // Realizado com data depois de hoje: o mais provável é o ano digitado errado.
  if (trends.future.length) {
    blocks.push([
      'Exames com data no futuro: confira a data. Os resultados ficaram fora deste resumo.',
      ...trends.future.map((e) => `- ${e.title} (${formatBRDate(e.date)})`),
    ]);
  }

  if (!blocks.length) blocks.push(['Ainda não há alergias, condições, remédios nem exames anotados no Kotii.']);

  const who = `${person.name.trim()}${species ? ` (${species})` : ''}${age ? `, ${age}` : ''}`;
  return [
    `Resumo para a consulta: ${who}`,
    ...blocks.map((lines) => lines.join('\n')),
    `Gerado pelo Kotii em ${formatBRDate(today)}. Confira com os laudos.`,
  ].join('\n\n');
}

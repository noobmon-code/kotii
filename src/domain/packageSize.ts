// O tamanho da embalagem que a descrição da nota traz ("ARROZ T1 5KG", "CERV
// LT 350ML C/12", "OVOS C/12"): é o que deixa comparar o preço de um pacote de
// 5 kg com o de 1 kg do mesmo produto (histórico de preço). Na dúvida, não há
// tamanho: um número que não é tamanho ("LEITE 3 MARIAS", "TOMATE 1A", "ARROZ
// TIPO 1"), dois tamanhos que não se somam ("SHAMPOO 350ML + COND 200ML") ou
// uma quantidade que pode ser do pacote ou de cada um ("6UN 480G") dão null.
// Inventar um tamanho faria um preço por kg errado parecer certo.
// O nameSizes de domain/similarNames lê os tamanhos de um nome para dizer se
// dois produtos são o mesmo (cada tamanho à parte, "350ml" e "12un"); aqui o
// que interessa é quanto vem no pacote (12 x 350 ml = 4,2 L), por isso a
// leitura é outra.

import { normalizeSearch } from './search';

/** O tamanho de uma embalagem, na unidade em que os preços se comparam. */
export interface PackageSize {
  /** kg e l para peso e volume; un para pacote com N itens ("C/12"). */
  unit: 'kg' | 'l' | 'un';
  /** Quanto vem na embalagem, em `unit` (500 g são 0,5; 12 latas de 350 ml são 4,2). */
  amount: number;
  /** Como a pessoa lê: "5 kg", "500 g", "1,5 L", "12 x 350 ml", "12 un". */
  label: string;
}

// Peso e volume, com quanto cada um vale em kg ou litro.
const MEASURES: Record<string, { unit: 'kg' | 'l'; inBase: number }> = {
  kg: { unit: 'kg', inBase: 1 },
  kgs: { unit: 'kg', inBase: 1 },
  kilo: { unit: 'kg', inBase: 1 },
  kilos: { unit: 'kg', inBase: 1 },
  quilo: { unit: 'kg', inBase: 1 },
  quilos: { unit: 'kg', inBase: 1 },
  g: { unit: 'kg', inBase: 0.001 },
  gr: { unit: 'kg', inBase: 0.001 },
  grs: { unit: 'kg', inBase: 0.001 },
  grama: { unit: 'kg', inBase: 0.001 },
  gramas: { unit: 'kg', inBase: 0.001 },
  l: { unit: 'l', inBase: 1 },
  lt: { unit: 'l', inBase: 1 },
  lts: { unit: 'l', inBase: 1 },
  litro: { unit: 'l', inBase: 1 },
  litros: { unit: 'l', inBase: 1 },
  ml: { unit: 'l', inBase: 0.001 },
  mls: { unit: 'l', inBase: 0.001 },
};
// Itens soltos ("6UN", "30 unidades"): quantos vêm no pacote.
const COUNTS = new Set(['un', 'und', 'unds', 'unid', 'unids', 'unidade', 'unidades', 'uns']);
const DOZEN = new Set(['dz', 'duzia', 'duzias']);
// Unidades que não são da embalagem ("500MG" de cada comprimido, "30M" de papel, "9W"): o número delas não é contagem.
const OTHER_UNITS = new Set(['mg', 'mcg', 'm', 'mt', 'mts', 'cm', 'mm', 'w', 'v', 'ui', 'cv', 'fps']);
// Depois destas, o número diz quantos vêm no pacote, de cada tamanho ("CX12", "FD 6", "C/12" vira "cmark").
const PACK_MARKS = new Set(['cmark', 'cx', 'fd', 'fardo', 'pack', 'pct', 'emb', 'caixa']);
// Depois destas, o número é a versão do item ("TIPO 1", "T1", "Nº 5"), não um tamanho.
const VERSION_WORDS = new Set(['tipo', 'tp', 't', 'n', 'no', 'num', 'nr', 'numero', 'tam']);
const SHORT_MARKS = new Set(['t', 'n', 'no']);

const NUMBER = /^\d+(?:\.\d+)?$/;
const INTEGER = /^\d+$/;

/** "5 kg", "500 g", "1,5 L", "350 ml": em g ou ml abaixo de 1 kg ou 1 litro. */
function measureLabel(amount: number, unit: 'kg' | 'l'): string {
  const small = amount < 1;
  const value = Math.round((small ? amount * 1000 : amount) * 1000) / 1000;
  const text = value.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  if (unit === 'kg') return `${text} ${small ? 'g' : 'kg'}`;
  return `${text} ${small ? 'ml' : 'L'}`;
}

/** A descrição em tokens: número, unidade e o resto separados ("12x350ml" vira 12, x, 350, ml). */
function tokens(description: string): string[] {
  return (
    normalizeSearch(description)
      // "C/12": doze no pacote. Antes de a barra sair.
      .replace(/\bc\s*\/\s*(?=\d)/g, ' cmark ')
      // "1.000G" é mil gramas; "1,5L" e "1.5L" são um e meio.
      .replace(/(\d)[.,](\d{3})(?=\s*(?:g|gr|grs|ml)\b)/g, '$1$2')
      .replace(/(\d)[.,](\d)/g, '$1.$2')
      // O ponto depois de letra separa, como o espaço ("SADIA.200G", "200G.C/2"), como no servidor;
      // depois de dígito ("1.5L", "200.G") ele fica como está.
      .replace(/([a-z])\./g, '$1 ')
      // Número e letras colados se separam ("5kg", "cx12", "t1"); "350mlx12" também.
      .replace(/(\d)(?=[a-z])/g, '$1 ')
      .replace(/([a-z])(?=\d)/g, '$1 ')
      .replace(/\b(kg|g|gr|grs|l|lt|ml)x\b/g, '$1 x')
      .replace(/[^a-z0-9.]+/g, ' ')
      .split(' ')
      .filter((token) => token && token !== '.')
  );
}

interface Reading {
  /** Peso ou volume de cada embalagem (ou do pacote todo, em "12 x 350 ml"). */
  measures: { unit: 'kg' | 'l'; amount: number; label: string }[];
  /** Quantos vêm no pacote, ditos com "C/12", "CX12" ou "12 x 350 ml": multiplicam o tamanho. */
  packs: number[];
  /** Quantos vêm no pacote, ditos com "6UN" ou "dúzia": com um peso junto, não se sabe se o peso é de cada um ou de todos. */
  counts: number[];
  /** Algo deixou a leitura em dúvida ("1 5L" pode ser 1,5 L). */
  doubtful: boolean;
}

function read(description: string): Reading {
  const raw = tokens(description);
  const reading: Reading = { measures: [], packs: [], counts: [], doubtful: false };
  // Os índices já lidos como parte de um tamanho.
  const used = new Set<number>();
  for (let i = 0; i < raw.length; i++) {
    const token = raw[i];
    if (used.has(i)) continue;
    if (DOZEN.has(token)) {
      // "DZ" sozinha é uma dúzia; "2 DUZIAS" já foi lida no número.
      reading.counts.push(12);
      continue;
    }
    if (!NUMBER.test(token)) continue;
    const prev = raw[i - 1];
    const next = raw[i + 1];
    const value = Number(token);
    const measure = next ? MEASURES[next] : undefined;
    // "TIPO 1", "T1", "Nº 5": a versão do item ("ARROZ TIPO 1 KG" é o tipo 1, e o tamanho não está escrito). Depois
    // de uma marca curta, número de mais de um algarismo com unidade é tamanho ("DETERG N 500ML").
    if (prev && VERSION_WORDS.has(prev) && !(SHORT_MARKS.has(prev) && token.length > 1 && measure)) continue;
    if (measure) {
      used.add(i + 1);
      const amount = value * measure.inBase;
      // "12 x 350 ml": doze de 350 ml.
      const times = prev === 'x' && raw[i - 2] && INTEGER.test(raw[i - 2]) && !used.has(i - 2) ? Number(raw[i - 2]) : null;
      const timesAfter = raw[i + 2] === 'x' && raw[i + 3] && INTEGER.test(raw[i + 3]) ? Number(raw[i + 3]) : null;
      const count = times ?? timesAfter;
      if (count != null) {
        if (times != null) used.add(i - 2);
        else used.add(i + 3);
        reading.measures.push({ unit: measure.unit, amount: amount * count, label: `${count} x ${measureLabel(amount, measure.unit)}` });
        continue;
      }
      // Um algarismo solto logo antes ("AGUA 1 5L"): pode ser 1,5 L com a vírgula perdida.
      const lone = prev && /^\d$/.test(prev) && !used.has(i - 1) && !(raw[i - 2] && VERSION_WORDS.has(raw[i - 2]));
      if (lone) reading.doubtful = true;
      reading.measures.push({ unit: measure.unit, amount, label: measureLabel(amount, measure.unit) });
      continue;
    }
    if (next && OTHER_UNITS.has(next)) {
      used.add(i + 1);
      continue;
    }
    if (!INTEGER.test(token)) continue;
    if (next && COUNTS.has(next)) {
      used.add(i + 1);
      reading.counts.push(value);
    } else if (next && DOZEN.has(next)) {
      used.add(i + 1);
      reading.counts.push(value * 12);
    } else if (prev && PACK_MARKS.has(prev)) {
      reading.packs.push(value);
    }
  }
  return reading;
}

/** Os valores sem repetir (com folga para a conta com vírgula). */
function distinct(values: number[]): number[] {
  return values.filter((value, index) => values.findIndex((other) => Math.abs(other - value) < 1e-9) === index);
}

/**
 * O tamanho da embalagem que a descrição traz, ou null quando ela não diz ou
 * deixa dúvida. "ARROZ T1 5KG": 5 kg. "CERV 12X350ML" e "CERV LT 350ML C/12":
 * 4,2 L. "OVOS C/12", "IOGURTE 6UN": 12 e 6 un. "AGUA 1 5L" (1,5 L com a
 * vírgula perdida?), "SHAMPOO 350ML+COND 200ML" e "LEITE FERM 6UN 480G" (480 g
 * cada ou no total?): null.
 */
export function packageSize(description: string): PackageSize | null {
  const { measures, packs, counts, doubtful } = read(description);
  if (doubtful) return null;
  const amounts = distinct(measures.map((m) => m.amount));
  const kinds = new Set(measures.map((m) => m.unit));
  const packCounts = distinct(packs.filter((n) => n > 0));
  // "1UN" não diz nada além de que é um.
  const itemCounts = distinct(counts.filter((n) => n > 1));
  if (amounts.length > 1 || kinds.size > 1 || packCounts.length > 1 || itemCounts.length > 1) return null;
  const [measure] = measures;
  if (measure) {
    if (!(measure.amount > 0)) return null;
    if (itemCounts.length) return null;
    const [pack] = packCounts;
    if (pack && pack > 1) {
      return { unit: measure.unit, amount: measure.amount * pack, label: `${pack} x ${measure.label}` };
    }
    return { unit: measure.unit, amount: measure.amount, label: measure.label };
  }
  const count = itemCounts[0] ?? packCounts[0];
  if (itemCounts.length && packCounts.length && itemCounts[0] !== packCounts[0]) return null;
  if (!count || count < 2) return null;
  return { unit: 'un', amount: count, label: `${count} un` };
}

/** Os dois tamanhos são a mesma quantidade (5 kg e 5000 g). */
export function samePackageSize(a: PackageSize, b: PackageSize): boolean {
  return a.unit === b.unit && Math.abs(a.amount - b.amount) < 1e-9 * Math.max(1, a.amount);
}

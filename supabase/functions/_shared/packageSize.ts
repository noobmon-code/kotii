// O tamanho da embalagem que a descrição da nota traz ("ARROZ T1 5KG", "CERV
// LT 350ML C/12", "OVOS C/12"), como o app o lê. Aqui o servidor usa só
// sharedPackageSize, a leitura estrita: é o tamanho que vai, com o preço, para
// a base comum de preços (receiptRead, na leitura do QR code).
// Espelho de src/domain/packageSize.ts; um teste do app
// (src/domain/__tests__/packageSize.test.ts) falha se os dois divergirem.
// Sem import: o teste do app lê este arquivo direto.

/** Minúsculas e sem acento, como o normalizeSearch de src/domain/search.ts. */
function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** O tamanho de uma embalagem, na unidade em que os preços se comparam. */
export interface PackageSize {
  /** kg e l para peso e volume; un para pacote com N itens ("C/12"). */
  unit: 'kg' | 'l' | 'un';
  /** Quanto vem na embalagem, em `unit` (500 g são 0,5; 12 latas de 350 ml são 4,2). */
  amount: number;
  /** Como a pessoa lê: "5 kg", "500 g", "1,5 L", "12 x 350 ml", "12 un". É packageLabel({ unit, amount, of }). */
  label: string;
  /** Em kg e l, quantas embalagens iguais somam `amount`, quando o rótulo é "N x …" ("12 x 350 ml": 12); ausente com uma só e em un. */
  of?: number;
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
// Palavras de pacote com vários itens que, sem número logo depois, não dizem quantos: o preço pode ser do pacote todo
// e o tamanho escrito, o de cada um ("CERV 330ML SIXPACK", "CERV 350ML FD", "KIT SHAMPOO 350ML"). Só para a base comum.
const MULTI_WORDS = new Set(['sixpack', 'six', 'multipack', 'pack', 'kit', 'combo', 'fardo', 'fd', 'cx', 'caixa', 'leve', 'pague']);

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
  measures: {
    unit: 'kg' | 'l';
    amount: number;
    label: string;
    /** true quando o tamanho veio com a própria contagem ("12 x 350 ml"): o número do pacote não o multiplica de novo. */
    counted: boolean;
    /** Essa contagem (12 em "12 x 350 ml"), quando há. */
    count?: number;
  }[];
  /** Quantos vêm no pacote, ditos com "C/12", "CX12" ou "FD 6": multiplicam o tamanho, a não ser que ele já traga a sua contagem (ver counted). */
  packs: number[];
  /** Quantos vêm no pacote, ditos com "6UN" ou "dúzia": com um peso junto, não se sabe se o peso é de cada um ou de todos. */
  counts: number[];
  /** Algo deixou a leitura em dúvida ("1 5L" pode ser 1,5 L). */
  doubtful: boolean;
  /**
   * Sobrou um número inteiro de 2 ou mais que a leitura não explicou ("C12", "PC 12", "LATAO 12", "3 CORACOES"), ou uma
   * palavra de pacote sem número ("SIXPACK", "KIT", "FD"): o tamanho lido pode ser o de cada um, e não o do preço.
   * Só sharedPackageSize olha isto.
   */
  loose: boolean;
}

function read(description: string): Reading {
  const raw = tokens(description);
  const reading: Reading = { measures: [], packs: [], counts: [], doubtful: false, loose: false };
  // Os índices já lidos como parte de um tamanho.
  const used = new Set<number>();
  // Os inteiros de 2 ou mais que nada explicou até aqui (um "12 x 350 ml" ainda pode usá-los adiante).
  const unexplained: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const token = raw[i];
    if (used.has(i)) continue;
    // "FD 6", "CX 12X350ML": o número logo depois diz quantos. "FD 350ML", "CX 1L": não diz.
    if (MULTI_WORDS.has(token) && !(raw[i + 1] && INTEGER.test(raw[i + 1]) && !(raw[i + 2] && MEASURES[raw[i + 2]]))) reading.loose = true;
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
        reading.measures.push({ unit: measure.unit, amount: amount * count, label: `${count} x ${measureLabel(amount, measure.unit)}`, counted: true, count });
        continue;
      }
      // Um algarismo solto logo antes ("AGUA 1 5L"): pode ser 1,5 L com a vírgula perdida.
      const lone = prev && /^\d$/.test(prev) && !used.has(i - 1) && !(raw[i - 2] && VERSION_WORDS.has(raw[i - 2]));
      if (lone) reading.doubtful = true;
      reading.measures.push({ unit: measure.unit, amount, label: measureLabel(amount, measure.unit), counted: false });
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
    } else if (value >= 2) {
      unexplained.push(i);
    }
  }
  if (unexplained.some((index) => !used.has(index))) reading.loose = true;
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
    // "CX 12X350ML" e "2X200G C/2" já trazem a contagem no tamanho: não
    // multiplicam de novo pelo número da caixa ou do "C/", como no servidor.
    if (pack && pack > 1 && !measure.counted) {
      return { unit: measure.unit, amount: measure.amount * pack, label: `${pack} x ${measure.label}`, of: pack };
    }
    return { unit: measure.unit, amount: measure.amount, label: measure.label, ...(measure.count != null ? { of: measure.count } : {}) };
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

/**
 * O rótulo de um tamanho já lido ("5 kg", "12 x 350 ml", "12 un"): o mesmo que packageSize dá, refeito do que a
 * linha de outra casa guarda (shared_prices.pack_unit, pack_amount, pack_of).
 */
export function packageLabel(size: Pick<PackageSize, 'unit' | 'amount' | 'of'>): string {
  if (size.unit === 'un') return `${size.amount} un`;
  if (size.of != null) return `${size.of} x ${measureLabel(Math.round((size.amount / size.of) * 1e6) / 1e6, size.unit)}`;
  return measureLabel(size.amount, size.unit);
}

/**
 * O tamanho que vai para a base comum de preços (o servidor usa o espelho, supabase/functions/_shared/packageSize.ts)
 * e com que o app compara os preços de lá: o de packageSize, só quando nada na descrição o põe em dúvida. Mais
 * estrita que packageSize, porque um tamanho errado na base comum vira um preço por litro errado para toda casa:
 * "CERV 350ML LT C12", "AGUA 500ML PC 12", "CERV 473ML LATAO 12" (um número que a leitura não explicou), "CERV 330ML
 * SIXPACK" e "CERV 350ML FD" (pacote sem dizer quantos) e até "CAFE 3 CORACOES 500G" (o 3 do nome) dão null.
 */
export function sharedPackageSize(description: string): PackageSize | null {
  const size = packageSize(description);
  return size && !read(description).loose ? size : null;
}

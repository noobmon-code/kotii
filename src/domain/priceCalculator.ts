// A calculadora de preço da lista de compras: comparar embalagens na gôndola
// (500 g por R$ 8,90 ou 1 kg por R$ 16,50?). Tudo aqui é conta e texto; a
// tela (features/PriceCalculator) só mostra. Nada é guardado: fechar esquece.
//
// Cada opção vira o preço por kg (peso), por litro (volume) ou por unidade
// (un), pelas regras de domain/units. Só se comparam opções da mesma grandeza:
// kg com litro ou com unidade nunca, e a frase diz quais ficaram de fora.

import type { Unit } from '@/lib/types';
import { formatBRL, parseDecimal, parseTypingAmount, THOUSANDS_DOTS } from './money';
import { convertQuantity, pricePerBase, sameDimension } from './units';

/** As unidades dos chips, na ordem da tela (as mesmas da lista). */
export const CALCULATOR_UNITS: readonly Unit[] = ['g', 'kg', 'ml', 'l', 'un'];
/** Na gôndola, a embalagem diz o peso em gramas na maior parte das vezes. */
export const DEFAULT_CALCULATOR_UNIT: Unit = 'g';
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;

/** Uma opção como a pessoa digitou. */
export interface CalcOption {
  /** Preço, em reais ("8,90"); lido como todo campo de dinheiro do app (parseMoney). */
  price: string;
  /** Quantidade da embalagem ("500", "1,5"); lida com parseDecimal. */
  quantity: string;
  unit: Unit;
}

export const newOption = (unit: Unit = DEFAULT_CALCULATOR_UNIT): CalcOption => ({ price: '', quantity: '', unit });

/** O começo e o "Limpar": duas opções vazias. */
export const initialOptions = (): CalcOption[] => Array.from({ length: MIN_OPTIONS }, () => newOption());

/** "Adicionar opção": até MAX_OPTIONS, com a unidade da última (quem compara costuma comparar a mesma coisa). */
export function addOption(options: CalcOption[]): CalcOption[] {
  if (options.length >= MAX_OPTIONS) return options;
  return [...options, newOption(options[options.length - 1]?.unit)];
}

/** Só as opções além da segunda saem; as duas primeiras ficam sempre. */
export const canRemoveOption = (index: number) => index >= MIN_OPTIONS;

export function removeOption(options: CalcOption[], index: number): CalcOption[] {
  return canRemoveOption(index) && index < options.length ? options.filter((_, i) => i !== index) : options;
}

export const optionLabel = (index: number) => `Opção ${index + 1}`;

// Os textos fixos da tela (features/PriceCalculator).
/** O título da calculadora e o nome do ícone para o leitor de tela. */
export const PRICE_CALCULATOR_LABEL = 'Calculadora de preço';
export const CALCULATOR_INTRO = 'Compare embalagens pelo preço do kg, do litro ou da unidade. Nada fica guardado.';
export const CLOSE_CALCULATOR = 'Fechar';
export const CHEAPEST_BADGE = 'Mais barata';
export const PRICE_FIELD = 'Preço (R$)';
export const QUANTITY_FIELD = 'Quantidade';
export const PRICE_PLACEHOLDER = '8,90';
export const QUANTITY_PLACEHOLDER = '500';
/** O botão de mais uma opção: o mesmo texto na tela e para o leitor de tela (e o comando de voz). */
export const ADD_OPTION = 'Adicionar opção';
export const CLEAR_CALCULATOR = 'Limpar';

// Os nomes de cada opção para o leitor de tela: "Preço da opção 1, em reais".
export const priceFieldSpoken = (index: number) => `Preço da opção ${index + 1}, em reais`;
export const quantityFieldSpoken = (index: number) => `Quantidade da opção ${index + 1}`;
export const unitGroupSpoken = (index: number) => `Unidade da opção ${index + 1}`;
export const removeOptionSpoken = (index: number) => `Remover a opção ${index + 1}`;

/** O nome da unidade para o leitor de tela: "g" e "l" sozinhos são lidos como letras. */
export const UNIT_SPOKEN: Record<Unit, string> = { g: 'gramas', kg: 'quilos', ml: 'mililitros', l: 'litros', un: 'unidades' };

/** O chip da unidade para o leitor de tela: "quilos, opção 2". */
export const unitChipSpoken = (unit: Unit, index: number) => `${UNIT_SPOKEN[unit]}, opção ${index + 1}`;

type Measure = 'peso' | 'volume' | 'unidade';
type BaseUnit = 'kg' | 'l' | 'un';

/** A menor unidade de cada grandeza: as contas comparam gramas com gramas, sem dividir por mil. */
const SMALL: Record<Unit, 'g' | 'ml' | 'un'> = { g: 'g', kg: 'g', ml: 'ml', l: 'ml', un: 'un' };
const MEASURE: Record<BaseUnit, Measure> = { kg: 'peso', l: 'volume', un: 'unidade' };
const PER: Record<BaseUnit, string> = { kg: 'o kg', l: 'o litro', un: 'a unidade' };

/**
 * Pontos de milhar numa quantidade ("1.000", "1.500", a forma THOUSANDS_DOTS
 * do parseMoney): tanto pode ser mil como um (mil e quinhentos ou um e meio).
 * O parseDecimal leria "1.000" g como 1 g, e o preço por kg sairia mil vezes
 * maior; a calculadora pede para escrever de novo. Com zero na frente
 * ("0.500") ou com vírgula ("1.000,5") não há dúvida, e a calculadora aceita;
 * nisso ela difere do parseUnits do remédio, que recusa também "0.500".
 */
const AMBIGUOUS_QUANTITY = THOUSANDS_DOTS;

/** A opção lida: o preço em centavos, a quantidade na menor unidade da grandeza e o preço por kg, litro ou unidade. */
export interface ReadOption {
  index: number;
  cents: number;
  /** Em g, ml ou unidades. */
  amount: number;
  base: BaseUnit;
  /** Em reais, sem arredondar: optionLine e o ranking escrevem com formatPerBase. */
  perBase: number;
}

/** O campo que a dica manda conferir. */
export type HintField = 'price' | 'quantity';

type Reading = { ok: true; option: ReadOption } | { ok: false; hint: string | null; field?: HintField };

/**
 * O que um campo diz enquanto a pessoa digita: um valor, ainda nada (vazio, ou
 * zero, que ainda pode virar "0,99") ou algo que não dá para ler.
 */
type FieldReading<T> = { value: T } | { pending: true } | { problem: string };

/**
 * O preço em centavos inteiros; seis casas antes de arredondar, para 1,005 x
 * 100 não virar 100,4999. Lido como o parseMoney, mas com a vírgula ou o ponto
 * no fim já valendo (parseTypingAmount): "8," a caminho de "8,90" é 8, e não
 * um preço errado.
 */
function readPrice(text: string): FieldReading<number> {
  if (!text) return { pending: true };
  const value = parseTypingAmount(text);
  if (value === 0) return { pending: true };
  const cents = value === null ? NaN : Math.round(Number((value * 100).toFixed(6)));
  return cents > 0 && Number.isFinite(cents) ? { value: cents } : { problem: PRICE_HINT };
}

/**
 * A quantidade, pelo parseDecimal, com a vírgula ou o ponto no fim já valendo
 * ("1," a caminho de "1,5" é 1). Com a vírgula no fim, os pontos são de
 * milhar ("1.000," é mil), como no parseTypingAmount.
 */
function readQuantity(text: string): FieldReading<number> {
  if (!text) return { pending: true };
  const typed = text.endsWith(',') ? `${text}0` : text.replace(/\.$/, '');
  if (AMBIGUOUS_QUANTITY.test(typed.replace(/\s/g, ''))) return { problem: ambiguousQuantityHint(typed) };
  const value = parseDecimal(typed);
  if (value === 0) return { pending: true };
  return value !== null && value > 0 && Number.isFinite(value) ? { value } : { problem: QUANTITY_HINT };
}

export const PRICE_HINT = 'Confira o preço.';
export const QUANTITY_HINT = 'Confira a quantidade.';

/**
 * A dica de uma quantidade com ponto de milhar, com as duas leituras do que
 * foi digitado: "1.500" é 1500 ou 1,5? Curta, porque vai embaixo de um campo
 * de meia largura. Com mais de um ponto ("1.000.000") só há a leitura de milhar.
 */
export function ambiguousQuantityHint(text: string): string {
  const typed = text.replace(/\s/g, '');
  const thousands = typed.replace(/\./g, '');
  if ((typed.match(/\./g) ?? []).length > 1) return `Escreva a quantidade sem os pontos: ${thousands}.`;
  const decimal = String(Number(typed)).replace('.', ',');
  return `${typed} é ${thousands} ou ${decimal}? Escreva sem ponto ou com vírgula.`;
}

/**
 * Lê uma opção. Incompleta (um dos campos vazio, ou ainda zero) fica de fora
 * sem dizer nada: a pessoa ainda está digitando. Com o que foi digitado sem
 * dar para ler, a dica diz qual campo conferir (`field`).
 */
export function readOption(option: CalcOption, index: number): Reading {
  const price = readPrice(option.price.trim());
  const quantity = readQuantity(option.quantity.trim());
  if ('problem' in price) return { ok: false, hint: price.problem, field: 'price' };
  if ('problem' in quantity) return { ok: false, hint: quantity.problem, field: 'quantity' };
  if (!('value' in price) || !('value' in quantity)) return { ok: false, hint: null };
  const cents = price.value;
  const small = SMALL[option.unit];
  // Da unidade para a menor da mesma grandeza (kg para g, l para ml): a conversão sempre existe, e a quantidade já é
  // maior que zero.
  const amount = convertQuantity(quantity.value, option.unit, small)!;
  const perBase = pricePerBase(cents / 100 / amount, small);
  return { ok: true, option: { index, cents, amount, base: perBase.unit as BaseUnit, perBase: perBase.unitPrice } };
}

/** Abaixo de R$ 1, um formatador por número de casas (até 20, o limite do Intl). */
const BRL_SMALL = new Map<number, Intl.NumberFormat>();
function formatSmallBRL(value: number): string {
  // Até a terceira casa e, abaixo de um centavo, até o segundo algarismo significativo.
  const digits = Math.min(20, Math.max(3, Math.ceil(-Math.log10(value)) + 1));
  let format = BRL_SMALL.get(digits);
  if (!format) {
    format = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: digits });
    BRL_SMALL.set(digits, format);
  }
  return format.format(value).replace(/\s/g, ' ');
}

/**
 * "R$ 17,80 o kg", "R$ 5,20 o litro", "R$ 1,40 a unidade". Abaixo de R$ 1 vai
 * até a terceira casa ("R$ 0,015 a unidade"), e abaixo de um centavo até o
 * segundo algarismo significativo ("R$ 0,0004", "R$ 0,0024"): o palito de 100
 * por R$ 2,00 e o de 200 por R$ 3,00 não podem aparecer os dois como R$ 0,02,
 * nem a caixa de mil por R$ 0,40 e a de mil por R$ 0,30 como R$ 0,00. Dois
 * preços bem próximos ainda podem aparecer iguais, como em qualquer
 * arredondamento.
 */
export function formatPerBase(perBase: number, base: BaseUnit): string {
  // Doze algarismos antes de arredondar, como as seis casas do preço: 17,799999999 é 17,80.
  const value = Number(perBase.toPrecision(12));
  const text = value > 0 && value < 1 ? formatSmallBRL(value) : formatBRL(value);
  return `${text} ${PER[base]}`;
}

/** O que aparece embaixo da opção: o preço por kg, litro ou unidade, ou nada. A dica fica embaixo do campo (optionHint). */
export function optionLine(option: CalcOption, index: number): string | null {
  const reading = readOption(option, index);
  return reading.ok ? formatPerBase(reading.option.perBase, reading.option.base) : null;
}

/** A dica do campo a conferir, para ir embaixo dele; null quando não há o que conferir. */
export function optionHint(option: CalcOption, index: number): { field: HintField; text: string } | null {
  const reading = readOption(option, index);
  return !reading.ok && reading.hint && reading.field ? { field: reading.field, text: reading.hint } : null;
}

/**
 * a contra b, sem dividir: centavos de a vezes a quantidade de b contra
 * centavos de b vezes a quantidade de a (as duas na mesma grandeza). Iguais
 * dentro de uma parte em um bilhão: R$ 1,01 por 0,67 kg e R$ 3,03 por 2,01 kg
 * são o mesmo preço, mas 2,01 kg vira 2009,9999999999998 g, e as contas dão
 * 203009,99999999997 contra 203010.
 */
function compare(a: ReadOption, b: ReadOption): number {
  const left = a.cents * b.amount;
  const right = b.cents * a.amount;
  if (Math.abs(left - right) <= 1e-9 * Math.max(left, right)) return 0;
  return left < right ? -1 : 1;
}

/**
 * Quanto `cheap` sai mais barata que `other`, em porcento inteiro do preço por
 * kg (litro, unidade) de `other`: 500 g por R$ 8,90 (R$ 17,80 o kg) e 1 kg por
 * R$ 16,50 dão 7% (1,30 de 17,80). A metade arredonda para cima; seis casas
 * antes, para 7,5 não virar 7,4999. Pode dar 0 com preços diferentes: quem
 * escreve a frase diz "quase o mesmo preço".
 */
export function percentCheaper(cheap: ReadOption, other: ReadOption): number {
  const ratio = (cheap.cents * other.amount) / (other.cents * cheap.amount);
  // Nunca "100% mais barata", que seria de graça: 99,6% (500 kg digitado no lugar de 500 g) fica em 99.
  return Math.min(99, Math.round(Number(((1 - ratio) * 100).toFixed(6))));
}

/** "a opção 2", "as opções 1 e 3", "as opções 1, 2 e 4". */
function namesOf(indexes: number[]): string {
  const numbers = indexes.map((i) => String(i + 1));
  if (numbers.length === 1) return `a opção ${numbers[0]}`;
  return `as opções ${numbers.slice(0, -1).join(', ')} e ${numbers[numbers.length - 1]}`;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "opção 1", "opções 1 e 2": o grupo entre parênteses na frase do que não se compara. */
const shortNames = (indexes: number[]) => namesOf(indexes).replace(/^as? /, '');

export interface RankRow {
  index: number;
  /** 1 é a mais barata; empatadas têm a mesma posição. */
  position: number;
  /** "1ª: opção 2, R$ 16,50 o kg". */
  text: string;
}

export interface PriceComparison {
  /** As opções destacadas: as mais baratas de cada grandeza com duas ou mais opções (todas, no empate; nenhuma quando todas saem pelo mesmo preço). */
  cheapest: number[];
  /** A frase de cada comparação, com grandezas diferentes a do que não se compara, e a de cada campo a conferir. */
  sentences: string[];
  /**
   * A frase da comparação de cada opção destacada, pelo índice: vai também no cartão dela, ao lado do "Mais barata",
   * porque o resultado fica no fim da tela e, enquanto se digita, embaixo do teclado.
   */
  cheapestSentences: Record<number, string>;
  /** Com 3 ou mais opções da mesma grandeza: a ordem, da mais barata para a mais cara. */
  ranking: RankRow[];
  /** Tudo o que o resultado diz, numa frase só, para o leitor de tela anunciar quando muda. */
  announcement: string;
}

export const WAITING_SENTENCE = 'Preencha o preço e a quantidade de pelo menos duas opções para comparar.';

/**
 * "Confira o preço da opção 1.": vai no resultado sempre que um campo já
 * digitado não dá para ler (depois das comparações, ou no lugar do pedido de
 * preencher), para quem usa leitor de tela ouvir por que a opção ficou de fora.
 */
export const checkSentence = (field: HintField, index: number) =>
  `Confira ${field === 'price' ? 'o preço' : 'a quantidade'} da opção ${index + 1}.`;

/** As opções de uma grandeza, da mais barata para a mais cara (no empate, na ordem da tela), em grupos do mesmo preço. */
function priceTiers(group: ReadOption[]): ReadOption[][] {
  const sorted = [...group].sort((a, b) => compare(a, b) || a.index - b.index);
  const tiers: ReadOption[][] = [];
  for (const option of sorted) {
    const last = tiers[tiers.length - 1];
    if (last && compare(last[0], option) === 0) last.push(option);
    else tiers.push([option]);
  }
  return tiers;
}

/** A frase de uma grandeza com duas ou mais opções. */
function groupSentence(tiers: ReadOption[][]): string {
  const [first, second] = tiers;
  const firstNames = namesOf(first.map((o) => o.index));
  if (!second) return `Mesmo preço: ${firstNames} saem por ${formatPerBase(first[0].perBase, first[0].base)}.`;
  const plural = first.length > 1;
  const secondNames = namesOf(second.map((o) => o.index));
  const percent = percentCheaper(first[0], second[0]);
  const lead = plural ? `${capitalize(firstNames)} saem pelo mesmo preço` : capitalize(firstNames);
  if (percent === 0) {
    // Preços diferentes que arredondam para 0%: nunca "0% mais barata".
    return plural
      ? `${lead}, só um pouco mais baratas que ${secondNames}.`
      : `Quase o mesmo preço: ${firstNames} sai só um pouco mais barata que ${secondNames}.`;
  }
  return plural
    ? `${lead}, ${percent}% mais baratas que ${secondNames}.`
    : `${lead} sai ${percent}% mais barata que ${secondNames}.`;
}

/** "Não dá para comparar peso (opções 1 e 2) com unidade (opção 3)." */
function incomparableSentence(groups: ReadOption[][]): string {
  const parts = groups.map((g) => `${MEASURE[g[0].base]} (${shortNames(g.map((o) => o.index))})`);
  if (parts.length === 2) return `Não dá para comparar ${parts[0]} com ${parts[1]}.`;
  return `Não dá para comparar ${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]} entre si.`;
}

/**
 * O resultado: as opções completas, agrupadas pela grandeza (domain/units,
 * sameDimension), cada grupo de duas ou mais comparado pelo preço por kg,
 * litro ou unidade. A mais barata leva o destaque e a frase diz quanto ela sai
 * mais barata que a seguinte (porcento inteiro; "Quase o mesmo preço" quando
 * a diferença arredonda para 0%; "Mesmo preço" quando não há diferença). As
 * opções incompletas ficam de fora até serem preenchidas.
 */
export function comparePrices(options: CalcOption[]): PriceComparison {
  const read: ReadOption[] = [];
  const toCheck: string[] = [];
  options.forEach((option, index) => {
    const reading = readOption(option, index);
    if (reading.ok) read.push(reading.option);
    else if (reading.field) toCheck.push(checkSentence(reading.field, index));
  });
  const groups: ReadOption[][] = [];
  for (const option of read) {
    const group = groups.find((g) => sameDimension(g[0].base, option.base));
    if (group) group.push(option);
    else groups.push([option]);
  }
  // Os grupos na ordem em que a primeira opção de cada um aparece na tela.
  const comparable = groups.filter((g) => g.length >= 2);
  const cheapest: number[] = [];
  const cheapestSentences: Record<number, string> = {};
  const sentences: string[] = [];
  const ranking: RankRow[] = [];
  for (const group of comparable) {
    const tiers = priceTiers(group);
    const sentence = groupSentence(tiers);
    sentences.push(sentence);
    if (tiers.length > 1) {
      for (const option of tiers[0]) {
        cheapest.push(option.index);
        cheapestSentences[option.index] = sentence;
      }
    }
    if (group.length >= 3) {
      let position = 1;
      for (const tier of tiers) {
        for (const option of tier) {
          ranking.push({
            index: option.index,
            position,
            text: `${position}ª: opção ${option.index + 1}, ${formatPerBase(option.perBase, option.base)}`,
          });
        }
        position += tier.length;
      }
    }
  }
  if (groups.length > 1) sentences.push(incomparableSentence(groups));
  // O campo a corrigir vai sempre no resultado (a opção some da comparação, e o leitor de tela precisa ouvir por
  // quê); com ele, não se pede para preencher o que já foi preenchido.
  sentences.push(...toCheck);
  if (!sentences.length) sentences.push(WAITING_SENTENCE);
  const announcement = [...sentences, ...ranking.map((row) => `${row.text}.`)].join(' ');
  return { cheapest: cheapest.sort((a, b) => a - b), sentences, cheapestSentences, ranking, announcement };
}

// O item pesado no balcão que a nota traz como "1 un": o queijo fatiado na
// hora, a carne do açougue, os frios, com a etiqueta de preço da balança. O
// valor está certo, mas sem o peso o preço é o daquela bandeja, e não se
// compara com o do kg nem serve à conta da lista. A revisão pergunta quanto
// pesou (o número da etiqueta), e a resposta faz do item uma linha por kg:
// o peso como quantidade e o valor da nota sobre o peso como preço. Só
// pergunta: nada muda sem a resposta, e "É embalagem" deixa como está.

import { packageSize } from './packageSize';
import { unitPriceFromTotal, hasNoValue } from './receiptItem';
import { itemIdentity } from './sameItem';

/** As categorias em que o item costuma ser pesado no balcão. */
const WEIGHED_CATEGORIES = new Set(['carnes', 'peixes', 'frios']);

/** Dos laticínios, só o queijo vai à balança: leite, iogurte, manteiga e requeijão vêm em embalagem. */
function isCheese(name: string): boolean {
  const identity = itemIdentity(name, 'laticinios');
  return identity != null && (identity.key === 'queijo' || identity.family === 'queijo');
}

/** O peso digitado vai até isto, em kg: mais que isso não sai de um balcão (e um "186" sem vírgula são gramas). */
export const MAX_WEIGHT_KG = 20;

/**
 * A linha pode ter sido pesada: em "un", com valor, de carne, peixe, frios ou
 * queijo, e sem tamanho de embalagem na descrição nem no nome do produto
 * ("QUEIJO RALADO 50G" e "SALSICHA 6UN" são pacote, e o preço deles já se
 * compara).
 */
export function asksWeight(
  item: { unit: string; total_price: number; raw_description: string },
  category: string,
  productName?: string | null,
): boolean {
  if (item.unit !== 'un' || hasNoValue(item)) return false;
  const names = [item.raw_description, ...(productName ? [productName] : [])];
  if (!WEIGHED_CATEGORIES.has(category) && !(category === 'laticinios' && names.some(isCheese))) return false;
  return !names.some((name) => packageSize(name) != null);
}

/**
 * O peso como a etiqueta da balança traz, em kg ("0,186"; "0.186" também).
 * Um número a partir de 20 sem vírgula são gramas ("186" é 0,186 kg), e "g"
 * ou "kg" escritos valem. null para o que não dá para ler, zero ou mais de
 * 20 kg.
 */
export function readWeight(text: string): number | null {
  const match = text
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:[.,]\d+)?)\s*(kg|g|gr)?$/);
  if (!match) return null;
  const value = Number(match[1].replace(',', '.'));
  if (!(value > 0)) return null;
  const grams = match[2] === 'g' || match[2] === 'gr' || (!match[2] && value >= MAX_WEIGHT_KG && !/[.,]/.test(match[1]));
  const kg = Math.round((grams ? value / 1000 : value) * 1000) / 1000;
  return kg > 0 && kg <= MAX_WEIGHT_KG ? kg : null;
}

/** A linha por kg com o peso da etiqueta: o valor da nota fica, e o preço é ele sobre o peso. */
export function weighedLine(item: { total_price: number }, weightKg: number): { quantity: number; unit: 'kg'; unit_price: number; total_price: number } {
  return { quantity: weightKg, unit: 'kg', unit_price: unitPriceFromTotal(item.total_price, weightKg), total_price: item.total_price };
}

/** A pergunta na linha: mais de uma peça pesa ao todo. */
export function weightQuestion(item: { quantity: number }): string {
  return item.quantity > 1
    ? 'Veio pesado no balcão? Diga quanto pesou ao todo (está na etiqueta) e o app compara pelo preço do kg.'
    : 'Veio pesado no balcão? Diga quanto pesou (está na etiqueta) e o app compara pelo preço do kg.';
}

export const WEIGHT_PLACEHOLDER = 'Peso em kg (ex.: 0,186)';
export const WEIGHT_UNREADABLE = { title: 'Peso inválido', message: 'Digite o peso da etiqueta em kg, como 0,186 (ou 186 g).' };
/** Na prévia enquanto se digita: o número não dá para ler, e "Salvar peso" não grava nada. */
export const WEIGHT_NOT_READ = 'Não deu para ler o peso';
export const WEIGHT_SAVED_NOT_SHOWN = {
  title: 'Peso salvo',
  message: 'Não deu para atualizar a nota na tela: o item aparece por unidade até ela ser buscada de novo.',
};
/** A linha mudou em outro aparelho desde a leitura da tela: nada foi gravado, e a nota é buscada de novo. */
export const WEIGHT_CHANGED_ELSEWHERE = {
  title: 'Peso não salvo',
  message: 'Este item mudou em outro aparelho. A nota foi buscada de novo: confira e informe o peso outra vez.',
};

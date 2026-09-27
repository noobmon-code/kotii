// Boleto pela câmera ou pela linha digitável: valida os dígitos verificadores
// (padrão FEBRABAN) e tira o que o código traz — valor, vencimento, banco ou
// tipo de conta — para preencher a conta a pagar.
//
// Dois formatos:
// - bancário: código de barras de 44 dígitos, linha digitável de 47;
// - arrecadação (luz, água, telefone, tributos): começa com 8, linha de 48.

import type { FinanceCategory } from './finance';
import { addDays, diffDays } from './dates';

export interface Boleto {
  kind: 'bancario' | 'arrecadacao';
  /** Os 44 dígitos do código de barras. */
  barcode: string;
  /** Linha digitável formatada, para copiar no app do banco. */
  line: string;
  /** Em reais; null quando o boleto não traz o valor. */
  amount: number | null;
  /** AAAA-MM-DD; só o bancário traz. */
  dueDate: string | null;
  suggestedName: string;
  suggestedCategory: FinanceCategory;
}

const onlyDigits = (text: string) => text.replace(/\D/g, '');

/** Módulo 10 (pesos 2 e 1 da direita para a esquerda). */
export function mod10(digits: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = digits.length - 1; i >= 0; i--) {
    const product = Number(digits[i]) * weight;
    sum += product > 9 ? product - 9 : product;
    weight = weight === 2 ? 1 : 2;
  }
  return (10 - (sum % 10)) % 10;
}

function mod11Sum(digits: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += Number(digits[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  return sum % 11;
}

/** DV geral do boleto bancário: 0, 10 e 11 viram 1. */
export function bankMod11(digits: string): number {
  const dv = 11 - mod11Sum(digits);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

/** Módulo 11 da arrecadação: resto 0 ou 1 dá 0. */
export function collectionMod11(digits: string): number {
  const rest = mod11Sum(digits);
  return rest === 0 || rest === 1 ? 0 : 11 - rest;
}

// Fator de vencimento: dias desde 07/10/1997. Chegou a 9999 em 21/02/2025 e
// recomeçou em 1000 no dia seguinte; vale o ciclo mais perto de hoje.
const OLD_BASE = '1997-10-07';
const NEW_BASE = '2025-02-22';

export function dueDateFromFactor(factor: number, today: string): string | null {
  if (!factor) return null;
  const candidates = [addDays(OLD_BASE, factor)];
  if (factor >= 1000) candidates.push(addDays(NEW_BASE, factor - 1000));
  return candidates.reduce((best, date) => (Math.abs(diffDays(today, date)) < Math.abs(diffDays(today, best)) ? date : best));
}

const BANKS: Record<string, string> = {
  '001': 'Banco do Brasil',
  '033': 'Santander',
  '041': 'Banrisul',
  '070': 'BRB',
  '077': 'Inter',
  '104': 'Caixa',
  '208': 'BTG Pactual',
  '212': 'Banco Original',
  '237': 'Bradesco',
  '260': 'Nubank',
  '290': 'PagBank',
  '323': 'Mercado Pago',
  '336': 'C6 Bank',
  '341': 'Itaú',
  '380': 'PicPay',
  '422': 'Safra',
  '623': 'Banco Pan',
  '748': 'Sicredi',
  '756': 'Sicoob',
};

const SEGMENTS: Record<string, { label: string; category: FinanceCategory }> = {
  '1': { label: 'Prefeitura', category: 'moradia' },
  '2': { label: 'Água e esgoto', category: 'contas' },
  '3': { label: 'Energia e gás', category: 'contas' },
  '4': { label: 'Telefone e internet', category: 'contas' },
  '5': { label: 'Órgão do governo', category: 'outros' },
  '6': { label: 'Carnê', category: 'outros' },
  '7': { label: 'Multa de trânsito', category: 'transporte' },
  '9': { label: 'Boleto', category: 'outros' },
};

function bankLine(barcode: string): string {
  const free = barcode.slice(19);
  const f1 = barcode.slice(0, 4) + free.slice(0, 5);
  const f2 = free.slice(5, 15);
  const f3 = free.slice(15, 25);
  const fields = [f1 + mod10(f1), f2 + mod10(f2), f3 + mod10(f3)];
  const [a, b, c] = fields.map((f) => `${f.slice(0, 5)}.${f.slice(5)}`);
  return `${a} ${b} ${c} ${barcode[4]} ${barcode.slice(5, 19)}`;
}

function collectionDigit(block: string, valueType: string): number {
  return valueType === '6' || valueType === '7' ? mod10(block) : collectionMod11(block);
}

function collectionLine(barcode: string): string {
  const valueType = barcode[2];
  return [0, 11, 22, 33]
    .map((start) => {
      const block = barcode.slice(start, start + 11);
      return `${block}-${collectionDigit(block, valueType)}`;
    })
    .join(' ');
}

/** Linha digitável (47 ou 48 dígitos) ou código de barras (44) -> código de barras, se os DVs baterem. */
function toBarcode(digits: string): string | null {
  if (digits.length === 44) return digits;
  if (digits.length === 47) {
    const fields = [digits.slice(0, 10), digits.slice(10, 21), digits.slice(21, 32)];
    if (fields.some((f) => mod10(f.slice(0, -1)) !== Number(f.at(-1)))) return null;
    return digits.slice(0, 4) + digits[32] + digits.slice(33) + digits.slice(4, 9) + digits.slice(10, 20) + digits.slice(21, 31);
  }
  if (digits.length === 48 && digits[0] === '8') {
    const blocks = [0, 12, 24, 36].map((start) => digits.slice(start, start + 12));
    if (blocks.some((b) => collectionDigit(b.slice(0, 11), digits[2]) !== Number(b[11]))) return null;
    return blocks.map((b) => b.slice(0, 11)).join('');
  }
  return null;
}

export function parseBoleto(text: string, today: string): Boleto | null {
  const barcode = toBarcode(onlyDigits(text));
  if (!barcode) return null;
  const withoutDv = barcode.slice(0, 3) + barcode.slice(4);

  if (barcode[0] === '8') {
    const valueType = barcode[2];
    if (!['6', '7', '8', '9'].includes(valueType)) return null;
    if (collectionDigit(withoutDv, valueType) !== Number(barcode[3])) return null;
    // 6 e 8: valor em reais; 7 e 9: quantidade de referência (sem valor em reais).
    const cents = valueType === '6' || valueType === '8' ? Number(barcode.slice(4, 15)) : 0;
    const segment = SEGMENTS[barcode[1]] ?? SEGMENTS['9'];
    return {
      kind: 'arrecadacao',
      barcode,
      line: collectionLine(barcode),
      amount: cents > 0 ? cents / 100 : null,
      dueDate: null,
      suggestedName: segment.label,
      suggestedCategory: segment.category,
    };
  }

  const bankOnly = barcode.slice(0, 4) + barcode.slice(5);
  if (bankMod11(bankOnly) !== Number(barcode[4])) return null;
  const cents = Number(barcode.slice(9, 19));
  const bank = BANKS[barcode.slice(0, 3)];
  return {
    kind: 'bancario',
    barcode,
    line: bankLine(barcode),
    amount: cents > 0 ? cents / 100 : null,
    dueDate: dueDateFromFactor(Number(barcode.slice(5, 9)), today),
    suggestedName: bank ? `Boleto ${bank}` : 'Boleto',
    suggestedCategory: 'contas',
  };
}

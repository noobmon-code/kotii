// Quantos vêm na embalagem do item da nota: "OVOS RANCHO CAIPIRA" a R$ 13,99
// pode ser a cartela de 10, de 12 ou de 20. A descrição às vezes diz ("OVOS
// C/12", "30UN", lidos por packageSize); quando não diz, a revisão pergunta, e
// a resposta fica na linha (receipt_items.pack_count): é o que veio naquela
// compra. Com a conta, o preço diz quanto sai cada um ("10 ovos, R$ 1,40 o
// ovo") e cartelas de tamanhos diferentes se comparam (histórico de preço).

import { formatBRL } from './money';
import { packageSize } from './packageSize';
import { hasNoValue } from './receiptItem';

/** Os tamanhos de cartela que a revisão oferece num toque; outro número se digita. */
export const PACK_CHOICES = [6, 10, 12, 15, 20, 30] as const;
/** O que o banco aceita (check de receipt_items.pack_count): um só não é embalagem. */
export const MIN_PACK = 2;
export const MAX_PACK = 1000;

/**
 * Quantos vêm na embalagem: o que a descrição da nota (ou o nome do produto)
 * diz, e, sem isso, a resposta guardada na linha. null sem nenhum dos dois.
 */
export function packCountOf(item: { raw_description: string; pack_count?: number | null }, productName?: string | null): number | null {
  for (const name of [item.raw_description, productName]) {
    const size = name ? packageSize(name) : null;
    if (size?.unit === 'un') return size.amount;
  }
  return item.pack_count != null && item.pack_count >= MIN_PACK ? item.pack_count : null;
}

/**
 * A linha em que a revisão pergunta quantos vêm: ovos em "un", com valor, sem
 * a conta na descrição nem no nome do produto. Só com a coluna no banco
 * (`pack_count` presente na linha lida, mesmo que null): antes da migração,
 * a resposta não teria onde ficar.
 */
export function asksPackCount(
  item: { unit: string; total_price: number; raw_description: string; pack_count?: number | null },
  category: string,
  productName?: string | null,
): boolean {
  if (category !== 'ovos' || item.unit !== 'un' || hasNoValue(item) || item.pack_count === undefined) return false;
  return packCountOf(item, productName) == null;
}

/** Ovos se contam em ovos; o resto, em unidades. */
const isEggs = (category: string | null | undefined) => category === 'ovos';

/** "10 ovos", "12 un". */
export function packLabel(count: number, category?: string | null): string {
  return isEggs(category) ? `${count} ovos` : `${count} un`;
}

/** Quanto sai cada um: "R$ 1,40 o ovo", "R$ 0,83 cada". */
export function perItemLabel(packPrice: number, count: number, category?: string | null): string {
  const each = formatBRL(Math.round((packPrice / count) * 100) / 100);
  return isEggs(category) ? `${each} o ovo` : `${each} cada`;
}

/** O número digitado em "Outro": inteiro de 2 a 1000. */
export function readPackCount(text: string): number | null {
  const value = text.trim();
  if (!/^\d+$/.test(value)) return null;
  const count = Number(value);
  return count >= MIN_PACK && count <= MAX_PACK ? count : null;
}

/** A pergunta na linha dos ovos. */
export const PACK_QUESTION = 'Quantos ovos vêm na embalagem? Com isso, o preço mostra quanto sai cada ovo.';

/**
 * O que a linha diz quando já se sabe quantos vêm: "10 ovos na embalagem: R$ 1,40 o ovo". Sem valor, a conta daria o
 * zero da leitura: a linha diz só quantos vêm.
 */
export function packLine(item: { total_price: number; quantity: number }, count: number, category?: string | null): string {
  if (hasNoValue(item)) return `${packLabel(count, category)} na embalagem`;
  const packPrice = item.quantity > 0 ? item.total_price / item.quantity : item.total_price;
  return `${packLabel(count, category)} na embalagem: ${perItemLabel(packPrice, count, category)}`;
}

export const PACK_UNREADABLE = { title: 'Número inválido', message: `Digite quantos vêm na embalagem, de ${MIN_PACK} a ${MAX_PACK}.` };
export const PACK_SAVED_NOT_SHOWN = {
  title: 'Quantidade salva',
  message: 'Não deu para atualizar a nota na tela: a quantidade aparece quando ela for buscada de novo.',
};

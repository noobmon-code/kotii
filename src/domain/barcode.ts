// O código de barras do produto, lido pela câmera (ou digitado) no mercado, na
// lista e na tela do produto. A casa guarda em product_barcodes qual produto é
// cada código: a nota confirmada ensina (confirm_receipt) e a leitura pela
// câmera também, quando a pessoa diz qual produto é um código novo.
//
// A chave é a de gtin_key no banco
// (supabase/migrations/20261021150000_store_codes.sql), a única que vale lá: o
// check de product_barcodes.gtin recusa outra. gtinKey é o espelho dela; um
// teste (src/domain/__tests__/barcode.test.ts) roda os casos do banco e
// confere que as faixas excluídas da função SQL são as daqui. As funções que
// leem a nota têm a mesma regra (supabase/functions/_shared/gtin.ts), para o
// código de barras de cada linha ir para os preços compartilhados; o mesmo
// teste confere as duas.

import { genericItem } from './genericItem';

/**
 * As faixas de uso restrito da GS1, pelo começo dos 14 dígitos: o mesmo número
 * é um produto diferente em cada mercado (ou nem é produto). EAN-13 que começa
 * com 2 (uso interno e peso variável, o código da balança), com 02 ou 04 (o
 * UPC-A de número 2 e 4), com 98 ou 99 (cupons e vales); GTIN-14 que começa
 * com 9 (peso variável na embalagem de transporte). Nenhum destes é começo de
 * um GTIN-8 (seis zeros à frente), então valem para os outros tamanhos só.
 */
export const RESTRICTED_GTIN_PREFIXES = ['02', '002', '004', '098', '099', '9'] as const;

/** O primeiro dos oito dígitos de um GTIN-8 de uso restrito (os números curtos dados pelo mercado). */
export const RESTRICTED_GTIN8_FIRST = ['0', '2'] as const;

/** O que se leu: os 14 dígitos, ou por que não serve. */
export type GtinRead = { gtin: string } | { problem: 'invalid' | 'restricted' };

/**
 * Lê o código como o banco: 8, 12, 13 ou 14 dígitos (nada além deles, nem
 * espaço), com o dígito verificador certo (módulo 10, pesos 3 e 1 a partir da
 * direita), completo com zeros até 14. `restricted` é o código certo de uma
 * faixa de uso restrito.
 */
export function readGtin(code: string | null | undefined): GtinRead {
  if (!code || !/^(\d{8}|\d{12,14})$/.test(code)) return { problem: 'invalid' };
  const g = code.padStart(14, '0');
  let total = 0;
  for (let i = 0; i < 13; i++) total += Number(g[i]) * (i % 2 === 0 ? 3 : 1);
  if ((10 - (total % 10)) % 10 !== Number(g[13])) return { problem: 'invalid' };
  const restricted = g.startsWith('000000')
    ? (RESTRICTED_GTIN8_FIRST as readonly string[]).includes(g[6])
    : RESTRICTED_GTIN_PREFIXES.some((prefix) => g.startsWith(prefix));
  return restricted ? { problem: 'restricted' } : { gtin: g };
}

/** "7891000100103" -> "07891000100103"; dígito errado, faixa restrita ou outro tamanho -> null. Como gtin_key. */
export function gtinKey(code: string | null | undefined): string | null {
  const read = readGtin(code);
  return 'gtin' in read ? read.gtin : null;
}

/** O código digitado: espaços, pontos e traços que a pessoa pôs entre os números não contam. */
export function readTypedGtin(text: string): GtinRead {
  return readGtin(text.replace(/[\s.-]+/g, ''));
}

/**
 * O código como está na embalagem, para mostrar: só os dígitos significativos.
 * O GTIN-8 com oito, o UPC-A com doze, o EAN-13 com treze (sem o zero da
 * frente) e o GTIN-14 inteiro.
 */
export function gtinLabel(gtin: string): string {
  if (gtin.startsWith('000000')) return gtin.slice(6);
  if (gtin.startsWith('00')) return gtin.slice(2);
  if (gtin.startsWith('0')) return gtin.slice(1);
  return gtin;
}

export const GTIN_INVALID_TITLE = 'Código não confere';
export const GTIN_INVALID =
  'Algum número não bate. Confira os números embaixo das barras (8, 12 ou 13 números) e digite de novo.';
export const GTIN_RESTRICTED_TITLE = 'Código do próprio mercado';
export const GTIN_RESTRICTED =
  'Este código é do mercado (como o da balança) e muda de loja para loja. Procure outro código de barras na embalagem.';
/** A tabela ainda não chegou ao banco (a migração não foi aplicada). */
export const BARCODES_NOT_READY = 'A leitura do código de barras ainda está sendo ativada. Tente de novo mais tarde.';

/**
 * Ligar o código a um produto, sabendo de quem ele é agora: `same` (já é dele,
 * nada a gravar), `new` (de ninguém: grava) ou `replace` (de outro produto: a
 * pessoa confirma antes de trocar).
 */
export type BarcodeLinkStep = { kind: 'same' } | { kind: 'new' } | { kind: 'replace'; from: string };

export function barcodeLinkStep(productId: string, owner: string | null | undefined): BarcodeLinkStep {
  if (!owner) return { kind: 'new' };
  return owner === productId ? { kind: 'same' } : { kind: 'replace', from: owner };
}

/** A pergunta antes de passar o código de um produto para outro. */
export function replaceBarcodeQuestion(gtin: string, fromName: string | null, toName: string): string {
  const from = fromName ? `"${fromName}"` : 'outro produto';
  return `O código ${gtinLabel(gtin)} está ligado a ${from}. Passar para "${toName}"?`;
}

/**
 * O produto da casa com esse nome, sem contar maiúsculas nem espaços nas
 * pontas: a mesma comparação do banco (products_household_name_key, por
 * lower(name)). Criar outro com o mesmo nome o banco não deixa.
 */
export function productNamed<P extends { name: string }>(products: readonly P[], name: string): P | undefined {
  const key = name.trim().toLowerCase();
  return key ? products.find((product) => product.name.trim().toLowerCase() === key) : undefined;
}

/**
 * O item que o código lido põe na lista: o mesmo da sugestão de produto da
 * busca (productSuggestions, em domain/genericItem), sem a marca no nome e com
 * o produto como dica de preço. A marca se escolhe na hora, ou em "Marca
 * preferida" nos detalhes do item.
 */
export function scannedListItem<P extends { name: string; category?: string | null }>(product: P): { product: P; name: string } {
  return { product, name: genericItem(product.name, product.category).name };
}

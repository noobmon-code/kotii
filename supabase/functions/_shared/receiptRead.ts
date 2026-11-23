// A leitura da nota como o servidor a fez (QR code na Sefaz, função nfce, ou
// foto com IA, função parse-receipt), gravada em receipt_reads com a chave
// secreta. É ela, e não o que a casa grava pelo app, que diz o que pode ir
// para os preços de outras casas: na confirmação, o gatilho do banco só
// compartilha a linha da nota igual (descrição, unidade e preço unitário) a uma
// linha daqui, com o mercado, a chave e o dia daqui. A linha leva também o
// código de barras do produto (gtin), quando o código dela é um de 13 ou 14
// dígitos (sharedGtin): ele vai junto
// para a base comum e acha o mesmo produto escrito de outro jeito em outra rede.
// Na nota do QR code, a linha que a Sefaz vendeu como um item só (single_unit,
// de nfceReadLines) leva ainda o tamanho da embalagem lido na descrição
// (readPack, com sharedPackageSize, a leitura estrita): é com ele que o
// preço de outra casa se compara pelo tamanho do pacote. Na foto nunca: a IA
// escreve "un" também no fardo e na caixa.
//
// Gravar a leitura nunca atrapalha a leitura da nota: qualquer erro (o banco
// ainda sem a tabela, a chave secreta faltando) só deixa a nota sem leitura, e
// ela não compartilha. Os logs levam só o código do erro, nada da nota.

import type { SupabaseClient } from '@supabase/supabase-js';

import { isValidAccessKey, isValidCnpj } from './fiscalIds.ts';
import { sharedGtin } from './gtin.ts';
import { sharedPackageSize } from './packageSize.ts';

export interface ReadLine {
  /** Descrição como impressa, sem espaços nas pontas nem repetidos. */
  description: string;
  /** Unidade do app ('un', 'kg', 'g', 'l', 'ml'), como no rascunho. */
  unit: string;
  /** Preço unitário como no rascunho (4 casas). */
  unit_price: number;
  /**
   * O código de barras do produto: os 14 dígitos de sharedGtin, quando o
   * código da linha é um de 13 ou 14 dígitos. Nunca o código interno do
   * mercado. Sem ele, o campo não vai.
   */
  gtin?: string;
  /**
   * O tamanho da embalagem lido pelo servidor na descrição (sharedPackageSize, o espelho de
   * src/domain/packageSize.ts), só na nota do QR code, na linha em "un" que a Sefaz vendeu como um item só: kg, l ou
   * un, quanto vem na embalagem toda (nessa unidade, 6 casas) e, em kg e l, quantas embalagens iguais ("12 x 350 ml":
   * 12). Sem tamanho, os campos não vão.
   */
  pack_unit?: 'kg' | 'l' | 'un';
  pack_amount?: number;
  pack_of?: number;
}

/**
 * Uma linha como quem lê a nota a entrega: a de ReadLine, mais se a unidade da Sefaz é de um item só (nfceReadLines).
 * single_unit é só entrada (diz se a linha pode levar o tamanho) e nunca vai para o banco; tamanho dado aqui não conta.
 */
export type ReadLineInput = Pick<ReadLine, 'description' | 'unit' | 'unit_price' | 'gtin'> & { single_unit?: boolean };

/** Os limites de shared_prices_pack_check (supabase/migrations/20261122140000_package_sizes.sql). */
export const MAX_PACK_AMOUNT = 100000;
export const MAX_PACK_OF = 1000;

/**
 * O tamanho da embalagem que a linha leva, já dentro do check do banco: só em "un", só quando a leitura estrita
 * (sharedPackageSize) lê um. Fora dos limites, nada; um "N x" fora deles tira só o pack_of.
 */
export function readPack(description: string, unit: string): Pick<ReadLine, 'pack_unit' | 'pack_amount' | 'pack_of'> {
  if (unit !== 'un') return {};
  const size = sharedPackageSize(description);
  if (!size) return {};
  const amount = Math.round(size.amount * 1e6) / 1e6;
  if (!(amount > 0 && amount <= MAX_PACK_AMOUNT)) return {};
  if (size.unit === 'un') return Number.isInteger(amount) && amount >= 2 ? { pack_unit: 'un', pack_amount: amount } : {};
  const of = size.of != null && Number.isInteger(size.of) && size.of >= 2 && size.of <= MAX_PACK_OF ? size.of : null;
  return { pack_unit: size.unit, pack_amount: amount, ...(of != null ? { pack_of: of } : {}) };
}

export interface ReceiptRead {
  household_id: string;
  source: 'qrcode' | 'ai';
  access_key: string | null;
  store_cnpj: string | null;
  store_name: string | null;
  /** AAAA-MM-DD. */
  purchased_on: string | null;
  lines: ReadLine[];
}

/** O banco recusa mais que isso; uma nota com mais de 300 linhas já não compartilha nada. */
export const MAX_READ_LINES = 1000;

/**
 * Descrição mais longa que isso é cortada: a chave compartilhada tem até 200
 * letras (a linha de chave maior nunca entra), e o banco tem um teto em bytes.
 */
export const MAX_DESCRIPTION = 200;

/** Só os dígitos, e só se passarem no verificador: chave ou CNPJ lido errado não vai para a base comum. */
const checked = (value: string | null | undefined, valid: (digits: string) => boolean) => {
  const only = (value ?? '').replace(/\D/g, '');
  return valid(only) ? only : null;
};

/** Dia de um instante em São Paulo (AAAA-MM-DD), ou null se não for uma data. */
export function saoPauloDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  // en-CA escreve AAAA-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** O que vai para receipt_reads, já no formato que o banco aceita. */
export function receiptRead(input: {
  householdId: string;
  source: 'qrcode' | 'ai';
  accessKey: string | null;
  cnpj: string | null;
  storeName: string | null;
  purchasedOn: string | null;
  lines: ReadLineInput[];
}): ReceiptRead {
  const name = input.storeName?.trim().replace(/\s+/g, ' ').slice(0, 300) || null;
  return {
    household_id: input.householdId,
    source: input.source,
    access_key: checked(input.accessKey, isValidAccessKey),
    store_cnpj: checked(input.cnpj, isValidCnpj),
    store_name: name,
    purchased_on: input.purchasedOn && /^\d{4}-\d{2}-\d{2}$/.test(input.purchasedOn) ? input.purchasedOn : null,
    lines: input.lines
      .map((line): ReadLine => {
        const description = line.description.trim().replace(/\s+/g, ' ').slice(0, MAX_DESCRIPTION).trim();
        return {
          description,
          unit: line.unit,
          unit_price: line.unit_price,
          // Só os 14 dígitos que já passam em sharedGtin. Outra coisa (o código interno, o de 8 ou 12 dígitos, o
          // verificador errado, o código sem os zeros à frente) deixa a linha sem ele, e ela vale do mesmo jeito.
          ...(typeof line.gtin === 'string' && sharedGtin(line.gtin) === line.gtin ? { gtin: line.gtin } : {}),
          // O tamanho, só do QR code e da linha que a Sefaz vendeu como um item só: no fardo, na caixa e no pacote o
          // preço é o do pacote todo, e a descrição muitas vezes diz só o tamanho de cada um.
          ...(input.source === 'qrcode' && line.single_unit === true ? readPack(description, line.unit) : {}),
        };
      })
      .filter((line) => line.description && Number.isFinite(line.unit_price))
      .slice(0, MAX_READ_LINES),
  };
}

/**
 * Grava a leitura e devolve o id dela, ou null se não deu (a nota segue sem
 * leitura). `serverDb` cria o cliente com a chave secreta: falhar ao criá-lo
 * também é só "sem leitura".
 */
export async function saveReceiptRead(serverDb: () => SupabaseClient, read: ReceiptRead): Promise<string | null> {
  try {
    const { data, error } = await serverDb().from('receipt_reads').insert(read).select('id').single();
    if (error || !data) {
      console.warn('receipt read not saved', error?.code ?? 'no row');
      return null;
    }
    return (data as { id: string }).id;
  } catch (err) {
    console.warn('receipt read not saved', err instanceof Error ? err.name : 'error');
    return null;
  }
}

/**
 * Grava a nota com a leitura e, se o banco recusar a leitura (23503: a chave
 * estrangeira leva a casa, e a pessoa trocou de casa entre a leitura e a
 * gravação), apaga a leitura e grava a nota sem ela: a nota não se perde por
 * isso, só não compartilha. Qualquer outro erro volta como veio.
 */
export async function insertWithRead<T>(
  insert: (readId: string | null) => PromiseLike<{ data: T | null; error: { code?: string } | null }>,
  readId: string | null,
  dropRead: () => Promise<void>,
): Promise<{ data: T | null; error: { code?: string } | null; readId: string | null }> {
  const first = await insert(readId);
  if (!first.error || !readId || first.error.code !== '23503') return { ...first, readId };
  console.warn('receipt read refused by the receipt, saving without it', first.error.code);
  await dropRead();
  return { ...(await insert(null)), readId: null };
}

/** Apaga a leitura que ficou sem nota (a nota não foi gravada). Falhar aqui só deixa a limpeza diária para depois. */
export async function forgetReceiptRead(serverDb: () => SupabaseClient, id: string): Promise<void> {
  try {
    const { error } = await serverDb().from('receipt_reads').delete().eq('id', id);
    if (error) console.warn('receipt read not removed', error.code);
  } catch (err) {
    console.warn('receipt read not removed', err instanceof Error ? err.name : 'error');
  }
}

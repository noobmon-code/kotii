// A leitura da nota como o servidor a fez (QR code na Sefaz, função nfce, ou
// foto com IA, função parse-receipt), gravada em receipt_reads com a chave
// secreta. É ela, e não o que a casa grava pelo app, que diz o que pode ir
// para os preços de outras casas: na confirmação, o gatilho do banco só
// compartilha a linha da nota igual (descrição, unidade e preço unitário) a uma
// linha daqui, com o mercado, a chave e o dia daqui.
//
// Gravar a leitura nunca atrapalha a leitura da nota: qualquer erro (o banco
// ainda sem a tabela, a chave secreta faltando) só deixa a nota sem leitura, e
// ela não compartilha. Os logs levam só o código do erro, nada da nota.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ReadLine {
  /** Descrição como impressa, sem espaços nas pontas nem repetidos. */
  description: string;
  /** Unidade do app ('un', 'kg', 'g', 'l', 'ml'), como no rascunho. */
  unit: string;
  /** Preço unitário como no rascunho (4 casas). */
  unit_price: number;
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

const digits = (value: string | null | undefined, length: number) => {
  const only = (value ?? '').replace(/\D/g, '');
  return only.length === length ? only : null;
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
  lines: ReadLine[];
}): ReceiptRead {
  const name = input.storeName?.trim().replace(/\s+/g, ' ').slice(0, 300) || null;
  return {
    household_id: input.householdId,
    source: input.source,
    access_key: digits(input.accessKey, 44),
    store_cnpj: digits(input.cnpj, 14),
    store_name: name,
    purchased_on: input.purchasedOn && /^\d{4}-\d{2}-\d{2}$/.test(input.purchasedOn) ? input.purchasedOn : null,
    lines: input.lines
      .map((line) => ({
        description: line.description.trim().replace(/\s+/g, ' ').slice(0, MAX_DESCRIPTION).trim(),
        unit: line.unit,
        unit_price: line.unit_price,
      }))
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

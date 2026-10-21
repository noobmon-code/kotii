// Chave de acesso da nota lida pela foto: a do QR code (quando a Sefaz pediu
// o "não sou robô" e a pessoa foi para a foto), a que a IA leu e a nota
// repetida na casa. A busca por chave no banco é injetada (`FindByKey`), para
// testar sem banco em accessKey.test.ts; index.ts só liga as peças.

import { accessKeyCheckDigit, cnpjFromAccessKey, isValidAccessKey } from '../_shared/fiscalIds.ts';

// Os verificadores ficam em _shared: a leitura gravada no servidor também confere.
export { accessKeyCheckDigit, isValidAccessKey };

/**
 * Chave que o app mandou junto com as fotos (a do QR code). Ausente: null;
 * uma chave válida (44 dígitos e dígito verificador, como o app confere ao
 * ler o QR): a chave; qualquer outra coisa: 'invalid'.
 */
export function requestedAccessKey(value: unknown): string | null | 'invalid' {
  if (value === undefined || value === null) return null;
  return typeof value === 'string' && isValidAccessKey(value) ? value : 'invalid';
}

/**
 * Até quantos dígitos a IA pode ter lido errado sem ser outra nota. Duas
 * notas diferentes, mesmo do mesmo caixa, diferem no número e nos 8 dígitos
 * do código aleatório (cNF), e quase sempre no verificador.
 */
export const MISREAD_DIGITS = 2;

function differingDigits(a: string, b: string): number {
  let count = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) count++;
  return count;
}

export interface KeyChoice {
  /** A chave a gravar na nota (null: nenhuma). */
  key: string | null;
  /** Ela não foi conferida antes da IA: falta ver se a casa já tem a nota. */
  checkAfterRead: boolean;
  /** A foto é de outra nota: a IA leu uma chave válida bem diferente da do QR. */
  mismatch: boolean;
}

/**
 * A chave do QR é exata; a lida na foto pode ter um dígito trocado, e vale a
 * do QR quando a da foto falta, não passa no verificador ou difere em até
 * MISREAD_DIGITS dígitos. Se a da foto é válida e bem diferente, a foto é de
 * outra nota: grava a da foto (os itens são dela) e a do QR fica sem uso,
 * para o QR não abrir a nota errada.
 */
export function chooseAccessKey(given: string | null, read: string | null): KeyChoice {
  if (!given) return { key: read, checkAfterRead: read !== null, mismatch: false };
  if (read && isValidAccessKey(read) && differingDigits(read, given) > MISREAD_DIGITS) {
    return { key: read, checkAfterRead: true, mismatch: true };
  }
  return { key: given, checkAfterRead: false, mismatch: false };
}

/** Id da nota da casa com esta chave, ou null. */
export type FindByKey = (key: string) => Promise<string | null>;

/**
 * Antes de baixar as fotos e gastar a IA: a nota do QR já está na casa (lida
 * por outra pessoa enquanto esta fotografava)? Sem chave do QR, não há o que ver.
 */
export function duplicateBeforeRead(given: string | null, find: FindByKey): Promise<string | null> {
  return given ? find(given) : Promise.resolve(null);
}

/**
 * Depois da IA: a chave a gravar (chooseAccessKey) e a nota da casa que já a
 * tem. Só busca se a chave não foi conferida antes da IA (sem QR, ou a foto
 * de outra nota).
 */
export async function keyAfterRead(
  given: string | null,
  read: string | null,
  find: FindByKey,
): Promise<KeyChoice & { existing: string | null }> {
  const choice = chooseAccessKey(given, read);
  const existing = choice.key && choice.checkAfterRead ? await find(choice.key) : null;
  return { ...choice, existing };
}

/**
 * O insert da nota falhou: se foi o índice único (casa, chave) — outra
 * leitura gravou a mesma nota ao mesmo tempo —, vale a que chegou antes e
 * devolve o id dela. Outro erro, ou nota sem chave: null.
 */
export function existingOnConflict(error: { code?: string } | null, key: string | null, find: FindByKey): Promise<string | null> {
  return error?.code === '23505' && key ? find(key) : Promise.resolve(null);
}

/** Chave e CNPJ da nota da foto, por destino. */
export interface PhotoIds {
  /** O CNPJ com que se acha ou cria o mercado da casa. */
  storeCnpj: string | null;
  /** O que vai para a leitura do servidor (receipt_reads): só o que a IA leu na foto. */
  read: { accessKey: string | null; cnpj: string | null };
}

/**
 * O mercado da casa sai do CNPJ que a IA leu (já conferido no cleanReceipt)
 * e, sem ele, do CNPJ dentro da chave do QR, quando a foto é da nota do QR
 * (sem `mismatch`): é o caminho da Sefaz com "não sou robô", e sem isso a foto
 * em que a IA não pegou o CNPJ criaria outro mercado. A leitura do servidor
 * fica só com o que a IA leu: a chave do QR veio do celular, o servidor não
 * a viu, e a base comum continua só com o que o servidor leu.
 */
export function photoIds(read: { accessKey: string | null; cnpj: string | null }, given: string | null, mismatch: boolean): PhotoIds {
  return {
    storeCnpj: read.cnpj ?? (given && !mismatch ? cnpjFromAccessKey(given) : null),
    read: { accessKey: read.accessKey, cnpj: read.cnpj },
  };
}

/** O código da recusa da nota do QR lida sem nenhum item (só o topo ou o rodapé nos prints). */
export const NO_ITEMS = 'no_items';

/**
 * A nota do QR (a pendente da Sefaz com "não sou robô") lida sem nenhum item: os prints eram só o topo ou o
 * rodapé. Ela não vira nota: com a chave do QR, um rascunho vazio tomaria o lugar da pendente no app e
 * responderia "nota repetida" aos prints certos. Sem a chave (a foto comum), o rascunho vazio continua valendo.
 */
export function readWithoutItems(given: string | null, items: number): boolean {
  return given !== null && items === 0;
}

/**
 * A data da nota que a IA não leu (os prints sem o rodapé): o mês de emissão está na chave (AAMM, logo depois
 * do código da UF). Nota de um mês anterior ao de hoje (em São Paulo) fica no último dia daquele mês, ao meio-dia
 * de Brasília, e não no mês em que os prints foram mandados; a revisão mostra a data para a pessoa conferir. Sem
 * chave, ou do mês de hoje, a data é agora.
 */
export function fallbackPurchasedAt(accessKey: string | null, now: Date = new Date()): string {
  const year = accessKey ? 2000 + Number(accessKey.slice(2, 4)) : NaN;
  const month = accessKey ? Number(accessKey.slice(4, 6)) : NaN;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: 'numeric' }).formatToParts(now);
  const part = (type: 'year' | 'month') => Number(parts.find((p) => p.type === type)?.value);
  const [nowYear, nowMonth] = [part('year'), part('month')];
  if (!Number.isInteger(year) || !(month >= 1 && month <= 12) || year * 12 + month >= nowYear * 12 + nowMonth) return now.toISOString();
  // Dia 0 do mês seguinte: o último dia deste. 15h UTC: meio-dia em Brasília (sem horário de verão).
  return new Date(Date.UTC(year, month, 0, 15)).toISOString();
}

// Chave de acesso da nota lida pela foto: a do QR code (quando a Sefaz pediu
// o "não sou robô" e a pessoa foi para a foto), a que a IA leu e a nota
// repetida na casa. A busca por chave no banco é injetada (`FindByKey`), para
// testar sem banco em accessKey.test.ts; index.ts só liga as peças.

/** Dígito verificador da chave (módulo 11, pesos 2 a 9), como no app (src/domain/nfce.ts). */
export function accessKeyCheckDigit(first43: string): number {
  let sum = 0;
  let weight = 2;
  for (let i = first43.length - 1; i >= 0; i--) {
    sum += Number(first43[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

/** 44 dígitos com o dígito verificador certo. */
export function isValidAccessKey(key: string): boolean {
  return /^\d{44}$/.test(key) && accessKeyCheckDigit(key.slice(0, 43)) === Number(key[43]);
}

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

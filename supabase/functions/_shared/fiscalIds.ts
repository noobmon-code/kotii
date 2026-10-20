// Chave de acesso da nota e CNPJ do emitente: os dígitos verificadores, para
// não gravar nem compartilhar o que foi lido errado. Descartar não junta as
// notas: a foto que fica sem chave continua sem par com o QR da mesma compra.
// Sem rede: testado em fiscalIds.test.ts.

/**
 * Dígito verificador módulo 11, com pesos 2 a 9 da direita para a esquerda:
 * o da chave de acesso (sobre os 43 primeiros dígitos, como no app, em
 * src/domain/nfce.ts) e cada um dos dois do CNPJ.
 */
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
 * 14 dígitos com os dois verificadores certos (a mesma conta da chave, sobre
 * os 12 e os 13 primeiros). Os 14 iguais ("000…", "111…") passam na conta,
 * mas não são CNPJ: é o que sai de um campo em branco lido como número.
 */
export function isValidCnpj(cnpj: string): boolean {
  if (!/^\d{14}$/.test(cnpj) || /^(\d)\1{13}$/.test(cnpj)) return false;
  return accessKeyCheckDigit(cnpj.slice(0, 12)) === Number(cnpj[12]) && accessKeyCheckDigit(cnpj.slice(0, 13)) === Number(cnpj[13]);
}

/** O CNPJ do emitente dentro de uma chave válida (dígitos 7 a 20), se ele também for válido; senão null. */
export function cnpjFromAccessKey(key: string | null | undefined): string | null {
  if (!key || !isValidAccessKey(key)) return null;
  const cnpj = key.slice(6, 20);
  return isValidCnpj(cnpj) ? cnpj : null;
}

// O nome de uma lista de compras ("Mercado", "Compras do mês"), como "Renomear" o grava. Puro.

import { PUSH_TEXT_HIDDEN, PUSH_TEXT_INVISIBLE, type Ranges } from './marketTrips';

/** O nome tem de 1 a 60 letras (contadas como o Array.from conta). */
export const LIST_NAME_MAX = 60;

const inRanges = (char: string, ranges: Ranges) => {
  const code = char.codePointAt(0) ?? 0;
  return ranges.some(([first, last]) => code >= first && code <= last);
};

/**
 * O nome como ele é gravado: os caracteres que não se veem ou mexem na linha (os mesmos que o aviso da ida troca
 * por espaço) viram espaço, e sem espaços nas pontas nem repetidos no meio.
 */
export function cleanListName(text: string): string {
  return Array.from(text, (char) => (inRanges(char, PUSH_TEXT_HIDDEN) ? ' ' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** O que a tela diz do nome digitado, ou null quando ele serve. */
export function listNameError(text: string): string | null {
  const chars = Array.from(cleanListName(text));
  // Só acentos soltos ou junções de emoji: nada que se veja.
  if (chars.every((char) => char === ' ' || inRanges(char, PUSH_TEXT_INVISIBLE))) return 'Escreva o nome da lista.';
  if (chars.length > LIST_NAME_MAX) return `Use até ${LIST_NAME_MAX} letras.`;
  return null;
}

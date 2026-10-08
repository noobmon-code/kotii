// Consultor financeiro (beta): o nome do banco que pode ir para a IA. O
// rótulo de cada banco conectado é digitado pela pessoa ("Conta da Maria",
// "Nubank pessoal") e pode trazer nome de gente; para o consultor vai só o
// nome de uma instituição conhecida ou um neutro ("Banco 1", "Banco 2"...).
// A tela continua mostrando o rótulo que a pessoa deu.

import type { FinConnection } from '@/lib/types';

import { normalizeBankText } from './bankCategories';

/**
 * Instituições reconhecidas e como a pessoa costuma escrever (sem acento,
 * minúsculo, palavra inteira: "inter" não acha "internacional").
 *
 * - `anywhere`: nomes que não são nome de gente nem palavra comum ("nubank",
 *   "itau", "banco do brasil"); valem em qualquer lugar do rótulo.
 * - `alone`: nomes que também são nome, sobrenome ou palavra comum ("rico",
 *   "cora", "stone", "bb" de bebê, "pan"); só valem quando o rótulo é esse nome
 *   e mais nada além de palavras genéricas ("Cora PJ", "Conta BB"). "Conta do
 *   Rico" ou "Maria Stone" não viram banco: o nome iria para a IA.
 */
const BANKS: { name: string; anywhere: string[]; alone?: string[] }[] = [
  { name: 'Nubank', anywhere: ['nubank'], alone: ['nu'] },
  { name: 'Inter', anywhere: ['inter'] },
  { name: 'Santander', anywhere: ['santander'] },
  { name: 'Mercado Pago', anywhere: ['mercado pago', 'mercadopago'] },
  { name: 'Itaú', anywhere: ['itau', 'personnalite'] },
  { name: 'Bradesco', anywhere: ['bradesco'] },
  { name: 'Caixa', anywhere: ['caixa', 'cef'] },
  { name: 'Banco do Brasil', anywhere: ['banco do brasil'], alone: ['bb'] },
  { name: 'C6 Bank', anywhere: ['c6', 'c6bank'] },
  { name: 'PicPay', anywhere: ['picpay', 'pic pay'] },
  { name: 'BTG Pactual', anywhere: ['btg'] },
  { name: 'XP', anywhere: ['xp'] },
  { name: 'Rico', anywhere: [], alone: ['rico'] },
  { name: 'Clear', anywhere: [], alone: ['clear'] },
  { name: 'Sicoob', anywhere: ['sicoob'] },
  { name: 'Sicredi', anywhere: ['sicredi'] },
  // "original" sozinho é adjetivo ("Cartão original"): só "Banco Original".
  { name: 'Banco Original', anywhere: ['banco original'] },
  { name: 'Neon', anywhere: ['banco neon'], alone: ['neon'] },
  { name: 'PagBank', anywhere: ['pagbank', 'pag bank', 'pagseguro', 'pag seguro'] },
  { name: 'Next', anywhere: ['banco next'], alone: ['next'] },
  { name: 'Banrisul', anywhere: ['banrisul'] },
  { name: 'Safra', anywhere: ['banco safra'], alone: ['safra'] },
  { name: 'Will Bank', anywhere: ['will bank', 'willbank'] },
  { name: 'Agibank', anywhere: ['agibank'], alone: ['agi'] },
  { name: 'BS2', anywhere: ['bs2'] },
  { name: 'Banco Pan', anywhere: ['banco pan'], alone: ['pan'] },
  { name: 'Banco BV', anywhere: ['votorantim', 'banco bv'], alone: ['bv'] },
  { name: 'Modal', anywhere: ['modalmais'], alone: ['modal'] },
  { name: 'Stone', anywhere: [], alone: ['stone'] },
  { name: 'Cora', anywhere: [], alone: ['cora'] },
  { name: 'BRB', anywhere: [], alone: ['brb'] },
  { name: 'Banestes', anywhere: ['banestes'] },
  { name: 'Unicred', anywhere: ['unicred'] },
  { name: 'Daycoval', anywhere: ['daycoval'] },
  { name: 'Ame', anywhere: [], alone: ['ame'] },
  { name: 'RecargaPay', anywhere: ['recargapay', 'recarga pay'] },
  { name: '99Pay', anywhere: ['99pay', '99 pay'] },
  { name: 'Banco do Nordeste', anywhere: ['banco do nordeste'], alone: ['bnb'] },
];

/** Palavras que podem acompanhar um nome `alone` sem que o rótulo deixe de ser só o banco. */
const GENERIC_WORDS = new Set([
  'conta',
  'contas',
  'cartao',
  'cartoes',
  'credito',
  'debito',
  'corrente',
  'poupanca',
  'banco',
  'bank',
  'pf',
  'pj',
  'mei',
  'pessoal',
  'empresa',
  'investimento',
  'investimentos',
  'corretora',
  'digital',
]);

/**
 * A instituição que o rótulo cita ("nubank pessoal" -> "Nubank", "Itau" ->
 * "Itaú", "Cora PJ" -> "Cora"), ou null. Um nome `anywhere` sempre ganha de um
 * `alone` ("Rico no Nubank" -> "Nubank"); entre dois `anywhere`, vale o que
 * aparece primeiro.
 */
export function knownBankName(label: string): string | null {
  const text = normalizeBankText(label);
  const padded = ` ${text} `;
  let best: { name: string; at: number; length: number } | null = null;
  for (const bank of BANKS) {
    for (const alias of bank.anywhere) {
      const at = padded.indexOf(` ${alias} `);
      if (at < 0) continue;
      if (!best || at < best.at || (at === best.at && alias.length > best.length)) best = { name: bank.name, at, length: alias.length };
    }
  }
  if (best) return best.name;

  // Sem nome inequívoco: um nome `alone` só vale com palavras genéricas em volta.
  const words = text.split(' ').filter(Boolean);
  for (const bank of BANKS) {
    for (const alias of bank.alone ?? []) {
      if (!words.includes(alias)) continue;
      if (words.every((w) => w === alias || GENERIC_WORDS.has(w) || /^\d+$/.test(w))) return bank.name;
    }
  }
  return null;
}

/**
 * Nome de cada banco conectado para a IA, por id: a instituição reconhecida
 * ("Nubank", e "Nubank 2" para o segundo Nubank) ou "Banco 1", "Banco 2"...
 * Numerados pela ordem em que foram conectados (created_at, depois id), que
 * não muda de uma pergunta para outra.
 */
export function safeBankLabels(connections: Pick<FinConnection, 'id' | 'label' | 'created_at'>[]): Map<string, string> {
  const ordered = [...connections].sort((a, b) =>
    a.created_at !== b.created_at ? (a.created_at < b.created_at ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const seen = new Map<string, number>();
  let unknown = 0;
  const out = new Map<string, string>();
  for (const c of ordered) {
    const known = knownBankName(c.label);
    if (!known) {
      unknown += 1;
      out.set(c.id, `Banco ${unknown}`);
      continue;
    }
    const n = (seen.get(known) ?? 0) + 1;
    seen.set(known, n);
    out.set(c.id, n === 1 ? known : `${known} ${n}`);
  }
  return out;
}

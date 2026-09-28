// Nota fiscal pelo QR code (NFC-e): o QR traz o link da consulta pública da
// Sefaz do estado, com a chave de acesso de 44 dígitos. A função `nfce` busca
// essa página e devolve os itens; aqui ficam a leitura do QR e a conversão
// dos itens da Sefaz para o rascunho de nota, sem IA.

import { guessCategory } from './search';

export interface NfceQr {
  /** Link da consulta (o próprio QR), ou null quando só há a chave. */
  url: string | null;
  accessKey: string;
  /** Código IBGE do estado (35 = SP, 33 = RJ…). */
  uf: string;
  cnpj: string;
  /** "AAAA-MM" da emissão. */
  month: string;
}

/** Dígito verificador da chave de acesso (módulo 11, pesos 2 a 9). */
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

export function isValidAccessKey(key: string): boolean {
  return /^\d{44}$/.test(key) && accessKeyCheckDigit(key.slice(0, 43)) === Number(key[43]);
}

/**
 * Lê o conteúdo do QR (o link com `p=chave|...` ou `chNFe=chave`) ou uma
 * chave digitada (com ou sem espaços). null se não for uma NFC-e válida.
 */
export function parseNfceQr(text: string): NfceQr | null {
  const trimmed = text.trim();
  let url: string | null = null;
  let digits: string | null = null;

  if (/^https?:\/\//i.test(trimmed)) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return null;
    }
    url = parsed.toString();
    const p = parsed.searchParams.get('p') ?? parsed.searchParams.get('chNFe') ?? '';
    digits = p.split('|')[0]?.replace(/\D/g, '') ?? null;
  } else {
    digits = trimmed.replace(/[\s.-]/g, '');
  }

  if (!digits || !isValidAccessKey(digits)) return null;
  // Modelo 65 = NFC-e (a de consumidor, com QR); 55 é a NF-e, sem itens públicos.
  if (digits.slice(20, 22) !== '65') return null;
  return {
    url,
    accessKey: digits,
    uf: digits.slice(0, 2),
    cnpj: digits.slice(6, 20),
    month: `20${digits.slice(2, 4)}-${digits.slice(4, 6)}`,
  };
}

/**
 * Hora local da nota ("AAAA-MM-DDTHH:MM:SS", sem fuso) -> ISO, lida no fuso
 * do celular: quem lê a nota está onde comprou, e o app mostra e soma os
 * gastos pelo dia local. null se o texto não for uma data.
 */
export function localDateTimeToISO(local: string): string | null {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Item como a Sefaz mostra (valores já em número). */
export interface NfceItem {
  description: string;
  code: string | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
}

const UNITS: Record<string, 'un' | 'kg' | 'g' | 'l' | 'ml'> = {
  KG: 'kg',
  KGS: 'kg',
  G: 'g',
  GR: 'g',
  GRS: 'g',
  L: 'l',
  LT: 'l',
  LTS: 'l',
  ML: 'ml',
};

/** Unidade da Sefaz (UN, PCT, KG, LT…) -> unidade do app; o que não for peso ou volume vira "un". */
export function normalizeNfceUnit(unit: string): 'un' | 'kg' | 'g' | 'l' | 'ml' {
  return UNITS[unit.trim().toUpperCase()] ?? 'un';
}

/** "ARROZ T.JOAO TP1 5KG" -> "Arroz t.joao tp1 5kg": sugestão de nome, que a pessoa ajusta na revisão. */
export function prettifyDescription(raw: string): string {
  const text = raw.trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
  return text.charAt(0).toLocaleUpperCase('pt-BR') + text.slice(1);
}

/**
 * Itens da Sefaz -> linhas do rascunho de nota. `aliases` liga a descrição
 * da nota a um produto já conhecido (como na leitura por foto), e a
 * categoria vem do produto ou das palavras da descrição.
 */
export function nfceItemsToDraft(
  items: NfceItem[],
  aliases: Map<string, { productId: string; category: string }>,
) {
  return items
    .filter((item) => item.description.trim() && item.totalPrice >= 0)
    .map((item, position) => {
      const raw = item.description.trim().replace(/\s+/g, ' ');
      const known = aliases.get(raw);
      const quantity = item.quantity > 0 ? Math.round(item.quantity * 1000) / 1000 : 1;
      const total = Math.round(item.totalPrice * 100) / 100;
      const unitPrice = item.unitPrice > 0 ? Math.round(item.unitPrice * 10000) / 10000 : Math.round((total / quantity) * 10000) / 10000;
      return {
        position,
        raw_description: raw,
        suggested_name: prettifyDescription(raw),
        suggested_category: known?.category ?? guessCategory(raw, { abbreviated: true }),
        product_id: known?.productId ?? null,
        quantity,
        unit: normalizeNfceUnit(item.unit),
        unit_price: unitPrice,
        total_price: total,
      };
    });
}

// Nota fiscal pelo QR code (NFC-e): o QR traz o link da consulta pública da
// Sefaz do estado, com a chave de acesso de 44 dígitos. A função `nfce` busca
// essa página e devolve os itens; aqui ficam a leitura do QR e a conversão
// dos itens da Sefaz para o rascunho de nota, sem IA.

import { NO_LEARNED, suggestedNoteName, type LearnedAbbreviations } from './learnedAbbreviations';
import { guessCategory } from './search';
import { storeCodeKey } from './storeCode';

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

/** Um produto já conhecido da casa, com a categoria dele. */
export interface KnownProduct {
  productId: string;
  category: string;
}

/**
 * Itens da Sefaz -> linhas do rascunho de nota. A linha guarda o código do
 * produto naquele mercado (`store_code`, pela chave do banco), que a nota
 * confirmada ensina à casa. O produto vem do código já aprendido (`codes`,
 * de match_store_codes: o do mercado, depois o de barras) e, sem ele, da
 * descrição (`aliases`, como na leitura por foto); a categoria vem do
 * produto ou das palavras da descrição. O nome sugerido traz as abreviações
 * por extenso, as da tabela fixa e as que a casa ensinou (`learned`,
 * domain/learnedAbbreviations): "LT INTEG PIRAC 1L" vira "Leite integral
 * pirac 1l". O que o app não sabe fica como a nota escreve.
 */
export function nfceItemsToDraft(
  items: NfceItem[],
  aliases: Map<string, KnownProduct>,
  codes: Map<string, KnownProduct> = new Map(),
  learned: LearnedAbbreviations = NO_LEARNED,
) {
  return items
    .filter((item) => item.description.trim() && item.totalPrice >= 0)
    .map((item, position) => {
      const raw = item.description.trim().replace(/\s+/g, ' ');
      const storeCode = storeCodeKey(item.code);
      const known = (storeCode ? codes.get(storeCode) : undefined) ?? aliases.get(raw);
      const quantity = item.quantity > 0 ? Math.round(item.quantity * 1000) / 1000 : 1;
      const total = Math.round(item.totalPrice * 100) / 100;
      const unitPrice = item.unitPrice > 0 ? Math.round(item.unitPrice * 10000) / 10000 : Math.round((total / quantity) * 10000) / 10000;
      return {
        position,
        raw_description: raw,
        suggested_name: suggestedNoteName(raw, learned) ?? prettifyDescription(raw),
        suggested_category: known?.category ?? guessCategory(raw, { abbreviated: true }),
        product_id: known?.productId ?? null,
        quantity,
        unit: normalizeNfceUnit(item.unit),
        unit_price: unitPrice,
        total_price: total,
        store_code: storeCode,
      };
    });
}

/** Os códigos da nota, pela chave do banco e sem repetir: o que se pergunta a match_store_codes. */
export function nfceStoreCodes(items: Pick<NfceItem, 'code'>[]): string[] {
  return [...new Set(items.map((item) => storeCodeKey(item.code)).filter((code): code is string => code !== null))];
}

/**
 * A nota (rascunho) criada a partir do QR code. `readId` é o id da leitura que a
 * função `nfce` gravou no servidor: só a nota com ele compartilha preço com
 * outras casas, e só as linhas iguais às lidas. Vai só quando a função devolveu
 * um: o banco de antes da leitura do servidor não tem a coluna, e a nota é
 * salva do mesmo jeito.
 */
export function nfceReceiptRow(
  page: { issuedAtLocal: string | null; total: number | null; readId?: string | null },
  qr: Pick<NfceQr, 'accessKey'>,
  storeId: string | null,
  now: Date = new Date(),
) {
  return {
    store_id: storeId,
    purchased_at: (page.issuedAtLocal && localDateTimeToISO(page.issuedAtLocal)) ?? now.toISOString(),
    total: page.total,
    access_key: qr.accessKey,
    source: 'qrcode' as const,
    status: 'draft' as const,
    ...(page.readId ? { read_id: page.readId } : {}),
  };
}

// ---------------------------------------------------------------------------
// Quando a Sefaz não mostra a nota

/**
 * Código da função `nfce` quando a Sefaz pede a verificação "não sou robô"
 * (reCAPTCHA) antes de mostrar a nota. O app não passa por ela: a nota fica
 * pendente (domain/pendingReceipts), a pessoa passa pela verificação na página
 * da Sefaz e a nota é lida pelos prints dela (ou pela foto), com a chave do QR.
 */
export const NFCE_CAPTCHA = 'captcha';

/**
 * Código (só do app, nunca da função) da nota que nem foi à Sefaz: o estado dela pediu o "não sou robô" há
 * pouco (domain/captchaStates). Vai para a pendente como no CAPTCHA, mas não renova o prazo do estado.
 */
export const NFCE_CAPTCHA_STATE = 'captcha_state';

/**
 * Caminho depois de uma busca na Sefaz que falhou: com o "não sou robô" (pedido
 * agora ou há pouco no mesmo estado), direto para a foto da nota; nos outros
 * erros (Sefaz fora do ar, nota sem itens), a pessoa fica na tela do QR, lê o
 * aviso e decide.
 */
export function nfceFailureRoute(code: string | null): 'photo' | 'stay' {
  return code === NFCE_CAPTCHA || code === NFCE_CAPTCHA_STATE ? 'photo' : 'stay';
}

/** Códigos da função `nfce` quando a Sefaz não trouxe a nota: fora do ar, ou a página sem os itens. */
export const NFCE_SEFAZ_DOWN = 'sefaz_down';
export const NFCE_NO_ITEMS = 'no_items';

/**
 * Código (só do app, nunca da função) do limite do mês das notas pelo QR code: a função `nfce` responde 429 sem
 * código (takeAiQuota com o tipo `nfce`, o único 429 dela), e a frase dela já diz "até lá, dá para tirar foto da nota".
 * A foto tem o limite dela (o tipo `photo`, separado do `nfce`), então ela vai.
 */
export const NFCE_QUOTA = 'nfce_quota';

/** O código de uma falha da função `nfce`: o que ela respondeu ou, no 429 sem código, o limite do mês (NFCE_QUOTA). */
export function nfceFailureCode(code: string | null, status: number | null): string | null {
  return code ?? (status === 429 ? NFCE_QUOTA : null);
}

/**
 * Depois de uma busca que fica na tela do QR (nfceFailureRoute 'stay'): a Sefaz não trouxe a nota (fora do ar, ou a
 * página sem os itens), ou as leituras pelo QR do mês acabaram, e a resposta já diz para tirar foto da nota. A leitura
 * pela foto, com a chave do QR, toma então o lugar da câmera daqui, que leria o mesmo QR e iria de novo à mesma Sefaz
 * (ou ao mesmo limite), com um aviso a cada leitura: quem chegou pela câmera do "Escanear" (que deu lugar a esta
 * tela) não tem uma câmera para onde voltar e fotografar. O limite do mês é só o das notas pelo QR: a foto conta no
 * limite dela, separado. Os outros erros (sem internet, a função que não conferiu o limite) ficam só no aviso de
 * sempre: a pessoa tenta de novo.
 */
export function photoAfterSefazFailure(code: string | null): boolean {
  return code === NFCE_SEFAZ_DOWN || code === NFCE_NO_ITEMS || code === NFCE_QUOTA;
}

export const SEFAZ_PHOTO_TITLE = 'Leia esta nota pela foto';
export const SEFAZ_PHOTO_MESSAGE =
  'A Sefaz não trouxe esta nota agora. Pela foto, a IA lê a nota, e você revisa antes de salvar. Se a nota for comprida, vai em partes.';
const SEFAZ_PHOTO_QUOTA_MESSAGE =
  'As leituras de nota pelo QR code deste mês acabaram, mas a foto tem um limite à parte. Pela foto, a IA lê a nota, e você revisa antes de salvar. Se a nota for comprida, vai em partes.';

/** A frase do cartão da foto, pelo que aconteceu: a Sefaz que não trouxe a nota, ou o limite do mês do QR. */
export const sefazPhotoMessage = (code: string | null) => (code === NFCE_QUOTA ? SEFAZ_PHOTO_QUOTA_MESSAGE : SEFAZ_PHOTO_MESSAGE);
export const SEFAZ_PHOTO_CAMERA = 'Tirar foto da nota';
export const sefazPhotoLibrary = (limit: number) => `Escolher da galeria (até ${limit} fotos)`;
export const SEFAZ_PHOTO_AGAIN = 'Ler o QR code de novo';

/**
 * Próximo passo para um QR lido: buscar na Sefaz ou, se esta nota já esbarrou
 * no "não sou robô" (nesta tela, ou antes: é uma nota pendente), ir direto para
 * os prints e a foto (buscar de novo só gastaria uma leitura do mês e criaria
 * outra pendente). `photoOnly` guarda a mensagem da Sefaz por chave, nesta tela;
 * `pending`, as chaves das pendentes da casa (sem a mensagem: null).
 */
export function qrReadStep(
  accessKey: string,
  photoOnly: ReadonlyMap<string, string>,
  pending: ReadonlySet<string> = new Set(),
): { kind: 'fetch' } | { kind: 'photo'; message: string | null } {
  const message = photoOnly.get(accessKey);
  if (message !== undefined) return { kind: 'photo', message };
  return pending.has(accessKey) ? { kind: 'photo', message: null } : { kind: 'fetch' };
}

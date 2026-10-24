// Estados cuja Sefaz pediu o "não sou robô" há pouco (hoje, a Paraíba). O
// aparelho guarda a UF e quando (lib/captchaStates): por CAPTCHA_STATE_DAYS
// dias, uma nota nova desse estado vai direto para a nota pendente
// (domain/pendingReceipts), sem gastar uma leitura na Sefaz que vai pedir a
// verificação de novo. Passado o prazo, o app tenta a Sefaz outra vez: se ela
// tirou a verificação, a leitura direta volta sozinha. Antes disso, a pendente
// tem "Tentar a Sefaz de novo", que esquece o estado e lê pelo QR.

import { stateOf } from './brStates';
import { stateAbbreviation } from './sharedPrices';

/** Por quantos dias um "não sou robô" vale para as notas novas do mesmo estado. */
export const CAPTCHA_STATE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** UF (código do IBGE, "25") -> quando a Sefaz dela pediu a verificação (ISO). */
export type CaptchaStates = Readonly<Record<string, string>>;

/** A UF da nota: os dois primeiros dígitos da chave, quando são de um estado. */
export function accessKeyUf(accessKey: string): string | null {
  const code = accessKey.slice(0, 2);
  return stateAbbreviation(code) ? code : null;
}

/** O que estava guardado no aparelho; o que não for UF com data fica de fora (texto corrompido: nada). */
export function parseCaptchaStates(raw: string | null): Record<string, string> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const states: Record<string, string> = {};
  for (const [uf, at] of Object.entries(parsed as Record<string, unknown>)) {
    if (stateAbbreviation(uf) && typeof at === 'string' && !Number.isNaN(Date.parse(at))) states[uf] = at;
  }
  return states;
}

/**
 * O "não sou robô" ainda vale: pedido há menos de CAPTCHA_STATE_DAYS dias. Uma data no futuro (o relógio do
 * aparelho mudou) não vale: o app tenta a Sefaz em vez de ficar preso nos prints.
 */
function active(at: string | undefined, now: Date): boolean {
  if (at === undefined) return false;
  const age = now.getTime() - Date.parse(at);
  return age >= 0 && age < CAPTCHA_STATE_DAYS * DAY_MS;
}

/** Guarda que a Sefaz desta UF pediu a verificação agora; as que já venceram saem. */
export function withCaptchaState(states: CaptchaStates, uf: string, now: Date): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [code, at] of Object.entries(states)) if (active(at, now)) kept[code] = at;
  if (stateAbbreviation(uf)) kept[uf] = now.toISOString();
  return kept;
}

/** Uma nota nova: buscar na Sefaz ou ir direto para a pendente (os prints), pelo estado da chave. */
export function captchaStateStep(states: CaptchaStates, accessKey: string, now: Date): 'fetch' | 'photo' {
  const uf = accessKeyUf(accessKey);
  return uf && active(states[uf], now) ? 'photo' : 'fetch';
}

/**
 * Esquece o "não sou robô" desta UF: a pessoa pediu para tentar a Sefaz de novo (o `captcha` da função também
 * cobre um desafio de passagem da Cloudflare, e um só não pode travar o estado por uma semana).
 */
export function withoutCaptchaState(states: CaptchaStates, uf: string): Record<string, string> {
  const { [uf]: _forgotten, ...rest } = states;
  return rest;
}

/**
 * A frase da pendente que nem foi à Sefaz, no lugar de "a Sefaz pede uma confirmação antes de mostrar esta nota"
 * (com esta nota o app nem perguntou). Sem prazo prometido (os dias contam do CAPTCHA guardado); com o link do QR
 * (`canRetry`), lembra que dá para tentar a Sefaz de novo.
 */
export function captchaStateNote(accessKey: string, canRetry: boolean): string {
  const state = stateOf(accessKey.slice(0, 2)) ?? 'deste estado';
  const text = `A Sefaz ${state} pediu há pouco uma confirmação de que você não é robô, que o app não consegue fazer. Por alguns dias, as notas deste estado vão direto para os prints.`;
  return canRetry ? `${text} Se quiser, dá para tentar a Sefaz de novo.` : text;
}

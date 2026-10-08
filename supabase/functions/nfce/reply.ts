// Resposta da função para cada resultado da busca (sefaz.ts) e se a leitura
// volta para o limite mensal da casa. Sem rede: testado em reply.test.ts.

import type { NfcePage } from './parse.ts';
import type { Lookup } from './sefaz.ts';
import { type BrState, stateOfQr } from './uf.ts';

export interface Reply {
  status: number;
  /** `uf` (no captcha): código IBGE da UF da chave ("25" = PB), como o `NfceQr.uf` do app. */
  body: NfcePage | { error: string; code: string; uf?: string | null };
  /** Devolver a leitura ao limite da casa (refundAiQuota). */
  refund: boolean;
}

export const SEFAZ_DOWN_MESSAGE = 'A Sefaz não respondeu agora. Tente de novo em alguns minutos ou tire foto da nota.';
export const NO_ITEMS_MESSAGE = 'A Sefaz não mostrou os itens desta nota. Tente de novo mais tarde ou tire foto da nota.';

/** Aviso de CAPTCHA, com a Sefaz do estado da nota ("deste estado" se não der para saber). */
export function captchaMessage(state: BrState | null): string {
  return `A Sefaz ${state?.of ?? 'deste estado'} pede uma confirmação de que você não é robô, que o app não consegue fazer. Leia a nota pela foto.`;
}

/**
 * Status, corpo e devolução da leitura (a leitura já foi contada antes da busca):
 * - ok: 200 com a nota. Conta.
 * - captcha: 422 `captcha`, com o código IBGE da UF da chave. Volta: nada foi
 *   lido e o app manda a pessoa para a leitura pela foto.
 * - down: 502 `sefaz_down`. Volta: nenhuma página final respondeu 2xx (rede,
 *   tempo esgotado, status de erro, redirecionamento para fora de .gov.br, ou
 *   uma página que só redireciona e o salto seguinte falhou).
 * - empty: 422 `no_items`. Conta: a página final (a que não leva a outra)
 *   respondeu 2xx, mas sem itens e sem CAPTCHA (nota ainda não autorizada,
 *   leiaute que o leitor não conhece).
 */
export function replyFor(result: Lookup, qrUrl: string): Reply {
  switch (result.kind) {
    case 'ok':
      return { status: 200, body: result.page, refund: false };
    case 'captcha': {
      const state = stateOfQr(qrUrl);
      return { status: 422, body: { code: 'captcha', uf: state?.code ?? null, error: captchaMessage(state) }, refund: true };
    }
    case 'down':
      return { status: 502, body: { error: SEFAZ_DOWN_MESSAGE, code: 'sefaz_down' }, refund: true };
    case 'empty':
      return { status: 422, body: { error: NO_ITEMS_MESSAGE, code: 'no_items' }, refund: false };
  }
}

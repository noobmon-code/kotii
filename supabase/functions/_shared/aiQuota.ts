// Limite mensal de IA por casa (tabela ai_usage, funções use_ai e refund_ai):
// cada função conta o uso antes de chamar a IA e devolve se a IA falhar. A
// devolução vai com a chave de serviço: quem usa o app não consegue baixar o
// próprio contador. A nota pelo QR code (nfce) não usa IA, mas faz o servidor
// buscar a Sefaz: entra no mesmo limite.

import { createClient } from '@supabase/supabase-js';

import { secretKey } from './apiKeys.ts';

export type AiKind = 'chat' | 'photo' | 'menu' | 'nfce' | 'finance';

interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

/** Uso contado: o que a devolução precisa (a casa e o mês em que contou). */
export interface AiTicket {
  kind: AiKind;
  household: string;
  month: string;
}

const LIMIT_MESSAGE: Record<AiKind, (limit: number) => string> = {
  chat: (limit) => `A casa já usou as ${limit} mensagens com o Nuke deste mês. O limite volta no dia 1º.`,
  photo: (limit) =>
    `A casa já usou as ${limit} leituras de foto deste mês. O limite volta no dia 1º; até lá, dá para ler a nota pelo QR code ou digitar.`,
  menu: (limit) => `A casa já montou ${limit} cardápios com o Nuke este mês. O limite volta no dia 1º.`,
  nfce: (limit) =>
    `A casa já leu ${limit} notas pelo QR code este mês. O limite volta no dia 1º; até lá, dá para tirar foto da nota ou digitar.`,
  finance: (limit) => `Você já usou as ${limit} mensagens com o consultor financeiro deste mês. O limite volta no dia 1º.`,
};

export class QuotaError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * Conta um uso; lança QuotaError (429) se o mês acabou, (403) se a pessoa não
 * tem acesso a esse uso nesta casa, ou (503) se não deu para conferir.
 */
export async function takeAiQuota(db: RpcClient, kind: AiKind): Promise<AiTicket> {
  const { data, error } = await db.rpc('use_ai', { p_kind: kind });
  const row = (Array.isArray(data) ? data[0] : data) as
    | { allowed?: boolean; lim?: number; household?: string; usage_month?: string }
    | null;
  // use_ai recusa com 42501 quem não tem a liberação (o consultor financeiro
  // é beta, por pessoa e por casa).
  if ((error as { code?: unknown } | null)?.code === '42501') {
    throw new QuotaError('Este uso da IA não está liberado para você nesta casa.', 403);
  }
  if (error || !row) {
    console.error('use_ai failed', error);
    throw new QuotaError('Não consegui conferir o limite de uso da IA agora. Tente de novo.', 503);
  }
  if (!row.allowed) throw new QuotaError(LIMIT_MESSAGE[kind](row.lim ?? 0), 429);
  return { kind, household: row.household ?? '', month: row.usage_month ?? '' };
}

function serviceClient(): RpcClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, secretKey());
}

/** A IA falhou: o uso não conta. Erro aqui só fica no log. */
export async function refundAiQuota(ticket: AiTicket, service: RpcClient = serviceClient()): Promise<void> {
  const { error } = await service.rpc('refund_ai', { p_household: ticket.household, p_month: ticket.month, p_kind: ticket.kind });
  if (error) console.error('refund_ai failed', error);
}

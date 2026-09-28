// Limite mensal de IA por casa (tabela ai_usage, funções use_ai e refund_ai):
// cada função conta o uso antes de chamar a IA e devolve se a IA falhar. A
// devolução vai com a chave de serviço: quem usa o app não consegue baixar o
// próprio contador.

import { createClient } from '@supabase/supabase-js';

export type AiKind = 'chat' | 'photo' | 'menu';

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
};

export class QuotaError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Conta um uso; lança QuotaError (429) se o mês acabou, ou (503) se não deu para conferir. */
export async function takeAiQuota(db: RpcClient, kind: AiKind): Promise<AiTicket> {
  const { data, error } = await db.rpc('use_ai', { p_kind: kind });
  const row = (Array.isArray(data) ? data[0] : data) as
    | { allowed?: boolean; lim?: number; household?: string; usage_month?: string }
    | null;
  if (error || !row) {
    console.error('use_ai failed', error);
    throw new QuotaError('Não consegui conferir o limite de uso da IA agora. Tente de novo.', 503);
  }
  if (!row.allowed) throw new QuotaError(LIMIT_MESSAGE[kind](row.lim ?? 0), 429);
  return { kind, household: row.household ?? '', month: row.usage_month ?? '' };
}

function serviceClient(): RpcClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

/** A IA falhou: o uso não conta. Erro aqui só fica no log. */
export async function refundAiQuota(ticket: AiTicket, service: RpcClient = serviceClient()): Promise<void> {
  const { error } = await service.rpc('refund_ai', { p_household: ticket.household, p_month: ticket.month, p_kind: ticket.kind });
  if (error) console.error('refund_ai failed', error);
}

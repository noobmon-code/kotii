// Leitura inteira de uma consulta, página por página, pelo id. Usada pelo
// Mercado do mês (notas e itens de seis meses) e pelos rascunhos de Finanças
// > Notas: nos dois, uma lista cortada calada mostraria uma conta errada ou
// esconderia uma nota.

import { unwrap } from '@/lib/supabase';

export type PageResult = { data: unknown; error: unknown; count: number | null };

/** O que a leitura diz quando falha. */
export interface ReadAllMessages {
  /** Há mais linhas do que cabem (`room`). */
  tooMany: string;
  /** O servidor diz que há mais e não manda. */
  incomplete: string;
}

const DEFAULT_MESSAGES: ReadAllMessages = {
  tooMany: 'São mais linhas do que o app consegue ler de uma vez.',
  incomplete: 'A leitura não chegou inteira. Tente de novo.',
};

/**
 * Uma consulta inteira, página por página, pelo id: cada página pede o que
 * vem depois do último id da anterior (`after`; null na primeira). Lendo por
 * posição, uma linha apagada ou incluída por outra pessoa da casa entre duas
 * páginas deslocaria as seguintes, e uma linha seria pulada ou repetida,
 * calada; pelo id, não. O servidor diz quantas linhas há dali em diante
 * (`count`) e a leitura só termina quando a página traz todas: página curta
 * não é prova de fim, porque o teto do servidor pode ser menor que a página
 * pedida. Mais linhas do que cabem (`room`): falha, nunca uma lista cortada.
 */
export async function readAll<T extends { id: string }>(
  page: (after: string | null) => PromiseLike<PageResult>,
  room: number,
  messages: ReadAllMessages = DEFAULT_MESSAGES,
): Promise<T[]> {
  const rows: T[] = [];
  let after: string | null = null;
  for (;;) {
    const result = await page(after);
    const got = (unwrap(result) ?? []) as T[];
    rows.push(...got);
    // O que já veio mais o que o servidor diz que ainda falta.
    if (rows.length + Math.max(0, (result.count ?? 0) - got.length) > room) throw new Error(messages.tooMany);
    // Sem a contagem (o servidor sempre manda), só uma página vazia diz que acabou.
    if (result.count == null ? got.length === 0 : got.length >= result.count) return rows;
    // O servidor diz que há mais e não manda: melhor falhar do que seguir com o que veio.
    if (got.length === 0) throw new Error(messages.incomplete);
    after = got[got.length - 1].id;
  }
}

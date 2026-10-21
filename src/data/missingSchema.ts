// O app pode ser publicado antes de uma migração chegar ao banco. Quem usa
// uma tabela ou função nova confere o erro por aqui, para a tela dizer "ainda
// não está disponível" (ou só não mostrar a novidade) em vez de quebrar.

function errorParts(error: unknown): { code: unknown; message: string } {
  if (!error || typeof error !== 'object') return { code: undefined, message: '' };
  const { code, message } = error as { code?: unknown; message?: unknown };
  return { code, message: typeof message === 'string' ? message : '' };
}

/**
 * A tabela ainda não existe no banco: o PostgREST responde PGRST205 ("Could
 * not find the table ... in the schema cache") e o Postgres, 42P01 ("relation
 * ... does not exist"). Com `table`, vale também o erro que perdeu o código
 * no caminho e só traz a mensagem, desde que ela fale dessa tabela.
 */
export function isMissingTable(error: unknown, table?: string): boolean {
  const { code, message } = errorParts(error);
  if (code === 'PGRST205' || code === '42P01') return true;
  return Boolean(table) && message.includes(table!) && /does not exist|could not find the table|schema cache/i.test(message);
}

/**
 * A função ainda não existe no banco: o PostgREST responde PGRST202 ("Could
 * not find the function ... in the schema cache", também quando os parâmetros
 * não são os que ele conhece) e o Postgres, 42883 ("function ... does not
 * exist"). Com `fn`, o 42883 só vale se a mensagem fala dessa função (ele
 * também sai de dentro de uma função que existe e chama outra que não), e vale
 * o erro sem código que fale dela, como em isMissingTable.
 */
export function isMissingFunction(error: unknown, fn?: string): boolean {
  const { code, message } = errorParts(error);
  if (code === 'PGRST202') return true;
  if (!fn) return code === '42883';
  return message.includes(fn) && (code === '42883' || /does not exist|could not find the function|schema cache/i.test(message));
}

/**
 * A coluna ainda não existe no banco: numa leitura o Postgres responde 42703
 * ("column shopping_list_items.brand_preferred does not exist", "column
 * receipt_items.generic_name does not exist") e, numa gravação que a traz no
 * corpo, o PostgREST responde PGRST204 ("Could not find the 'generic_name'
 * column of 'receipt_items' in the schema cache"). Só vale quando o erro fala
 * dessa coluna, com o nome inteiro: outra coluna que falte é erro de verdade
 * (um nome errado no app, por exemplo). Serve a brand_preferred (a "Marca
 * preferida" da lista) e a generic_name (o item genérico da leitura por foto).
 */
export function isMissingColumn(error: unknown, column: string): boolean {
  const { code, message } = errorParts(error);
  const named = message.split(/[^A-Za-z0-9_]+/).includes(column);
  if (!named) return false;
  return code === '42703' || code === 'PGRST204' || /does not exist|could not find the .* column/i.test(message);
}

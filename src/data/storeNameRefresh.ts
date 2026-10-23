import type { QueryClient } from '@tanstack/react-query';

/**
 * As buscas que trazem o nome do mercado: os mercados, as notas (e as pendentes), os gastos (o Resumo, o Mercado
 * do mês e o consultor), as compras recentes, os preços de cada produto e a comparação de juntar produtos.
 */
const STORE_NAME_REFRESHES = ['stores', 'receipts', 'receipt', 'spending', 'purchaseRecords', 'priceHistory', 'mergeFacts'];

/**
 * O nome de algum mercado mudou (a casa renomeou, ou a moderação trocou o nome padrão): busca de novo o que o
 * mostra. Com `sharedPrices`, também os preços de outras casas, que trazem o nome padrão do mercado.
 */
export function refreshStoreNames(queryClient: QueryClient, { sharedPrices = false } = {}) {
  const keys = sharedPrices ? [...STORE_NAME_REFRESHES, 'sharedPrices'] : STORE_NAME_REFRESHES;
  for (const key of keys) void queryClient.invalidateQueries({ queryKey: [key] });
}

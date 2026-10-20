// A categoria do produto vale para todas as compras dele, também as dos meses
// passados: o Mercado do mês, o resumo de gastos e o orçamento leem a
// categoria do produto de agora, não uma cópia guardada em cada nota. É de
// propósito (corrigir a categoria corrige o passado); estas frases só dizem
// isso à pessoa antes de ela mudar.

import { getCategory } from './categories';

/** No seletor de categoria do produto. */
export const PRODUCT_CATEGORY_NOTE =
  'A categoria vale para todas as compras deste produto, também as dos meses passados: o Mercado do mês e os gastos em Finanças mudam junto.';

/**
 * Ao juntar dois produtos de categorias diferentes, o aviso de qual fica: a do produto cujo nome fica (é o que
 * merge_products faz). null quando as duas são a mesma.
 */
export function categoryMergeWarning(keep: { name: string; category: string }, gone: { name: string; category: string }): string | null {
  const kept = getCategory(keep.category);
  const lost = getCategory(gone.category);
  if (kept.key === lost.key) return null;
  return (
    `Os dois estão em categorias diferentes: "${keep.name}" em ${kept.label}, "${gone.name}" em ${lost.label}. ` +
    `Fica ${kept.label}: as compras de "${gone.name}", também as dos meses passados, passam para essa categoria no Mercado do mês e em Finanças.`
  );
}

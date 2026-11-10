// As partes (sub-abas) das abas Compras e Casa, guardadas na URL (?aba=), e os endereços antigos de partes que
// mudaram de aba. Favoritos do navegador e o app instalado na tela inicial guardam o endereço de quando foram
// criados: /casa?aba=compras e /casa?aba=despensa eram a Casa de antes, que tinha as compras e a despensa.

/** Compras: o ciclo do que entra na casa (lista, compra, nota, despensa), nesta ordem na barra das partes. */
export const COMPRAS_TABS = [
  { value: 'listas', label: 'Listas' },
  { value: 'notas', label: 'Notas' },
  { value: 'despensa', label: 'Despensa' },
] as const;

export type ComprasTab = (typeof COMPRAS_TABS)[number]['value'];

/** Casa: o que mantém a casa funcionando, nesta ordem na barra das partes. */
export const CASA_TABS = [
  { value: 'tarefas', label: 'Tarefas' },
  { value: 'agenda', label: 'Agenda' },
  { value: 'aparelhos', label: 'Aparelhos' },
  { value: 'documentos', label: 'Documentos' },
] as const;

export type CasaTab = (typeof CASA_TABS)[number]['value'];

/** A parte pedida na URL; sem ela, ou com um valor que não existe, a primeira (a de abrir). */
export function tabFromParam<T extends string>(tabs: readonly { value: T }[], value: string | string[] | undefined): T {
  const wanted = Array.isArray(value) ? value[0] : value;
  return tabs.find((tab) => tab.value === wanted)?.value ?? tabs[0].value;
}

/** Para onde vai um endereço antigo: a aba (o caminho) e, quando não é a primeira, a parte dela. */
export interface MovedTo {
  pathname: '/compras';
  aba: ComprasTab | null;
}

/**
 * A parte que a Casa tinha e passou para Compras: as listas (/casa?aba=compras) e a despensa
 * (/casa?aba=despensa). Qualquer outro ?aba= fica na Casa (null): as partes de hoje e as que não existem, que
 * abrem a primeira.
 */
export function movedFromCasa(value: string | string[] | undefined): MovedTo | null {
  const wanted = Array.isArray(value) ? value[0] : value;
  if (wanted === 'compras') return { pathname: '/compras', aba: null };
  if (wanted === 'despensa') return { pathname: '/compras', aba: 'despensa' };
  return null;
}

/**
 * A parte que Finanças tinha e passou para Compras: as notas (/financas?aba=notas). Só conta com a chave de
 * Finanças ligada (sem ela, a aba nem existe).
 */
export function movedFromFinance(value: string | string[] | undefined): MovedTo | null {
  const wanted = Array.isArray(value) ? value[0] : value;
  return wanted === 'notas' ? { pathname: '/compras', aba: 'notas' } : null;
}

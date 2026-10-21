// Os textos do topo das abas Casa e Saúde: a linha pequena (a parte aberta) e a
// frase de apoio, que muda com a parte.

export type HouseTab = 'compras' | 'despensa' | 'tarefas' | 'aparelhos';
export type HealthTab = 'resumo' | 'cuidados' | 'treino' | 'dieta';

export const HOUSE_TAB_LABELS: Record<HouseTab, string> = {
  compras: 'Compras',
  despensa: 'Despensa',
  tarefas: 'Tarefas',
  aparelhos: 'Aparelhos',
};

export const HEALTH_TAB_LABELS: Record<HealthTab, string> = {
  resumo: 'Resumo',
  cuidados: 'Cuidados',
  treino: 'Treino',
  dieta: 'Dieta',
};

const HOUSE_SUBTITLES: Record<Exclude<HouseTab, 'compras'>, string> = {
  despensa: 'Gás, água, ração e o que tem em casa',
  tarefas: 'Quem faz o quê, e os pontos das crianças',
  aparelhos: 'Manutenções, garantias e prestadores',
};

const HEALTH_SUBTITLES: Record<HealthTab, string> = {
  resumo: 'Remédios, consultas e o que pede atenção',
  cuidados: 'Fichas, consultas, vacinas e exames',
  treino: 'Os planos de treino da família',
  dieta: 'Os planos de dieta da família',
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "2 listas · 5 itens para comprar": o resumo das listas, ou o convite quando ainda não há nenhuma. */
export function listsSummary(lists: readonly { pending: number }[] | undefined): string {
  if (!lists) return 'As listas da casa, em tempo real';
  if (lists.length === 0) return 'Nenhuma lista ainda';
  const pending = lists.reduce((sum, list) => sum + list.pending, 0);
  const todo = pending === 0 ? 'tudo comprado' : `${plural(pending, 'item', 'itens')} para comprar`;
  return `${plural(lists.length, 'lista', 'listas')} · ${todo}`;
}

export function houseSubtitle(tab: HouseTab, lists: readonly { pending: number }[] | undefined): string {
  return tab === 'compras' ? listsSummary(lists) : HOUSE_SUBTITLES[tab];
}

export function healthSubtitle(tab: HealthTab): string {
  return HEALTH_SUBTITLES[tab];
}

/** Os três ícones de vidro do topo: categorias de produto, na ordem esquerda, meio (o maior) e direita. */
export const HOUSE_ART: Record<HouseTab, readonly [string, string, string]> = {
  compras: ['padaria', 'hortifruti', 'laticinios'],
  despensa: ['oleos', 'graos', 'temperos'],
  tarefas: ['papel', 'limpeza', 'higiene'],
  aparelhos: ['limpeza', 'outros', 'papel'],
};

export const HEALTH_ART: readonly [string, string, string] = ['suplementos', 'medicamentos', 'primeiros_socorros'];

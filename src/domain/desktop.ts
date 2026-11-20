// A versão de computador do site: o mesmo app, arrumado para a janela larga. A partir de DESKTOP_MIN_WIDTH, no
// navegador, a pílula de abas do rodapé dá lugar a uma barra lateral fixa (ui/Sidebar), que fica na tela também
// nas telas abertas por cima das abas, e as abas usam a largura em colunas (ui/desktop). Abaixo disso, e no
// celular, tudo fica como sempre foi. Aqui ficam as medidas e as regras puras: quando a janela é de computador, as
// áreas da barra lateral e a que área pertence cada tela.

/** A partir desta largura da janela, no navegador, o app se arruma como no computador. */
export const DESKTOP_MIN_WIDTH = 1024;

/** A largura da barra lateral (o vidro), sem as margens dela. */
export const SIDEBAR_WIDTH = 232;

/** A margem da barra lateral: solta da borda da janela, como a pílula do celular. */
export const SIDEBAR_MARGIN = 16;

/** O que a barra lateral toma da largura da janela: ela e a margem da esquerda (a da direita é a margem da tela ao lado). */
export const SIDEBAR_SPACE = SIDEBAR_WIDTH + SIDEBAR_MARGIN;

/** A largura máxima do conteúdo das abas no computador (as outras telas, de formulário e de leitura, param em MAX_WIDTH). */
export const DESKTOP_CONTENT_WIDTH = 1120;

/** A largura da coluna do lado (atalhos, sugestões, ações), ao lado da coluna principal. */
export const DESKTOP_SIDE_WIDTH = 360;

/**
 * A coluna do lado nunca passa desta parte da linha: na janela mais estreita do computador (1024), a principal
 * ainda fica mais larga que um celular.
 */
export const DESKTOP_SIDE_MAX_SHARE = 0.45;

/** A coluna do lado mais larga: a que leva um painel inteiro ao lado de outro (a agenda ao lado das tarefas, as contas ao lado do resumo). */
export const DESKTOP_PANEL_SIDE_WIDTH = 400;

/** A largura máxima do seletor das partes de uma aba (Listas, Notas, Despensa…), que no computador não se estica pela coluna. */
export const DESKTOP_TABS_WIDTH = 520;

/** A largura das caixas que abrem no meio da janela (o menu de ações, que no celular é uma folha no rodapé). */
export const DESKTOP_DIALOG_WIDTH = 440;

/**
 * As janelas de formulário (editar um item, renomear, escolher numa lista), que no celular tomam a tela inteira:
 * no computador são uma caixa no meio da janela, desta largura.
 */
export const DESKTOP_SHEET_WIDTH = 560;

/** A caixa nunca passa desta parte da altura da janela: o que não cabe rola dentro dela. */
export const DESKTOP_SHEET_HEIGHT_SHARE = 0.88;

/**
 * A altura da caixa que leva uma lista para escolher (com busca): fixa, até esta medida, para a caixa não mudar de
 * tamanho a cada letra digitada.
 */
export const DESKTOP_SHEET_TALL_HEIGHT = 720;

/** A altura da caixa numa janela desta altura: a máxima (o conteúdo rola) e a fixa das listas para escolher. */
export function sheetHeights(windowHeight: number): { max: number; tall: number } {
  const max = Number.isFinite(windowHeight) && windowHeight > 0 ? Math.floor(windowHeight * DESKTOP_SHEET_HEIGHT_SHARE) : DESKTOP_SHEET_TALL_HEIGHT;
  return { max, tall: Math.min(DESKTOP_SHEET_TALL_HEIGHT, max) };
}

/**
 * As fotos (de um documento, da nota): no celular tomam a tela inteira; no computador, uma caixa no meio da janela,
 * mais larga que a dos formulários (a foto é o que se quer ver), e alta (a da janela, até DESKTOP_SHEET_HEIGHT_SHARE).
 */
export const DESKTOP_PHOTO_WIDTH = 960;

/**
 * As telas que no celular sobem como janela por cima das outras (editar uma tarefa, um remédio, uma consulta, o
 * Nuke…; `presentation: 'modal'` no Stack da raiz): no computador, uma caixa no meio da janela, desta largura (a
 * mesma da coluna das telas de formulário, MAX_WIDTH, para o conteúdo delas caber como sempre coube)…
 */
export const DESKTOP_WINDOW_WIDTH = 720;

/** …e desta altura, no máximo (numa janela mais baixa, a parte dela que as caixas tomam). */
export const DESKTOP_WINDOW_HEIGHT = 860;

/**
 * A altura dessa caixa numa janela desta altura: fixa (o conteúdo rola dentro dela, e a conversa do Nuke e os
 * formulários com rodapé precisam de uma altura para se arrumar), até DESKTOP_WINDOW_HEIGHT.
 */
export function windowHeight(windowHeight: number): number {
  return Math.min(DESKTOP_WINDOW_HEIGHT, sheetHeights(windowHeight).max);
}

/**
 * Para onde vai o "Fechar" de uma dessas caixas quando não há tela para onde voltar (a página aberta direto pelo
 * endereço, ou recarregada): a aba da área da tela (a tarefa é da Casa), ou a Hoje para a que não é de nenhuma (o
 * Nuke). `routeName` é o nome da rota no Stack ("tarefa/[id]").
 */
export function windowFallback(routeName: string): string {
  const area = SCREEN_AREAS[routeName.split('/')[0]];
  return APP_AREAS.find((entry) => entry.key === area)?.href ?? '/';
}

/**
 * A altura máxima da coluna do lado que fica parada enquanto a principal rola (ui/desktop `Columns` com
 * `stickySide`): o lugar que a tela tem para rolar (a janela menos o cabeçalho da tela) menos a margem de cima e a de
 * baixo do conteúdo. Nunca menos que uma altura de botão, para a coluna não sumir numa janela muito baixa.
 */
export function stickySideHeight(windowHeight: number, headerHeight: number, padding: number): number {
  const room = (Number.isFinite(windowHeight) ? windowHeight : 0) - (Number.isFinite(headerHeight) ? headerHeight : 0) - 2 * padding;
  return Math.max(STICKY_SIDE_MIN_HEIGHT, Math.floor(room));
}

/** A coluna parada nunca fica mais baixa que isto. */
export const STICKY_SIDE_MIN_HEIGHT = 240;

/**
 * O nome do botão que, no computador, faz o que puxar a tela para baixo faz no celular (buscar de novo o que ela
 * mostra): no navegador não se puxa a tela.
 */
export const REFRESH_LABEL = 'Atualizar';

/** A janela é de computador: só no navegador, e larga o bastante. Uma largura que não é um número (a janela ainda sem medida) não é. */
export function isDesktop(web: boolean, width: number): boolean {
  return web && Number.isFinite(width) && width >= DESKTOP_MIN_WIDTH;
}

/** As áreas do app: as cinco abas, na ordem da barra. */
export const APP_AREAS = [
  { key: 'hoje', route: 'index', label: 'Hoje', href: '/' },
  { key: 'compras', route: 'compras', label: 'Compras', href: '/compras' },
  { key: 'casa', route: 'casa', label: 'Casa', href: '/casa' },
  { key: 'saude', route: 'saude', label: 'Saúde', href: '/saude' },
  // Na barra lateral cabe o nome inteiro (na pílula do celular a aba é "Ajustes").
  { key: 'configuracoes', route: 'configuracoes', label: 'Configurações', href: '/configuracoes' },
] as const;

export type AppArea = (typeof APP_AREAS)[number]['key'];

/**
 * A área de cada tela aberta por cima das abas, pela primeira parte do endereço: a barra lateral deixa acesa a
 * área de onde a tela vem (a lista é das Compras, a tarefa é da Casa). `null`: a tela não é de nenhuma (o Nuke, o
 * convite, as telas de antes de entrar numa casa). Uma tela nova em src/app precisa entrar aqui
 * (domain/__tests__/desktop.test.ts confere a pasta).
 */
export const SCREEN_AREAS: Record<string, AppArea | null> = {
  // Compras: o que entra na casa.
  lista: 'compras',
  nota: 'compras',
  escanear: 'compras',
  precos: 'compras',
  mercado: 'compras',
  cardapio: 'compras',
  produto: 'compras',
  despensa: 'compras',
  reposicao: 'compras',
  // Casa: o que a mantém funcionando.
  agenda: 'casa',
  tarefa: 'casa',
  compromisso: 'casa',
  pontos: 'casa',
  aparelho: 'casa',
  prestadores: 'casa',
  prestador: 'casa',
  servico: 'casa',
  documento: 'casa',
  financas: 'casa',
  orcamento: 'casa',
  conta: 'casa',
  gasto: 'casa',
  'imposto-de-renda': 'casa',
  consultor: 'casa',
  // Saúde.
  remedio: 'saude',
  consulta: 'saude',
  vacina: 'saude',
  exame: 'saude',
  exames: 'saude',
  treino: 'saude',
  dieta: 'saude',
  // A ficha de saúde de uma pessoa ou de um pet.
  pessoa: 'saude',
  // Configurações.
  clima: 'configuracoes',
  casas: 'configuracoes',
  avisos: 'configuracoes',
  perfil: 'configuracoes',
  recado: 'configuracoes',
  moderacao: 'configuracoes',
  painel: 'configuracoes',
  'primeira-vez': 'configuracoes',
  'apagar-conta': 'configuracoes',
  termos: 'configuracoes',
  familia: 'configuracoes',
  // De nenhuma área.
  nuke: null,
  convite: null,
  entrar: null,
  'nova-senha': null,
  'bem-vindo': null,
};

/**
 * A área da tela aberta, pelas partes do endereço que o roteador dá (useSegments): ['(tabs)', 'compras'] é a aba
 * Compras, ['(tabs)'] é a Hoje, ['lista', '[id]'] é uma tela das Compras. Uma tela que não está em SCREEN_AREAS
 * não acende nenhuma.
 */
export function areaOfSegments(segments: readonly string[]): AppArea | null {
  const [first, second] = segments;
  if (first === undefined) return 'hoje';
  if (first === '(tabs)') return APP_AREAS.find((area) => area.route === (second ?? 'index'))?.key ?? null;
  return SCREEN_AREAS[first] ?? null;
}

/** A tela aberta é uma das abas (e não uma tela por cima delas). */
export function onTabs(segments: readonly string[]): boolean {
  return segments[0] === undefined || segments[0] === '(tabs)';
}

/** Um nó do estado da navegação, só com o que a barra lateral lê dele. */
export interface NavRoute {
  name: string;
  params?: object;
  state?: { routes?: readonly NavRoute[] };
}

/** Onde as abas estão no estado da navegação: o roteador põe o layout da raiz dentro de um nó dele, então a busca desce alguns níveis. */
function findTabs(routes: readonly NavRoute[] | undefined, depth = 0): NavRoute | undefined {
  if (!routes || depth > 3) return undefined;
  for (const route of routes) {
    if (route.name === '(tabs)') return route;
    const inside = findTabs(route.state?.routes, depth + 1);
    if (inside) return inside;
  }
  return undefined;
}

/**
 * Os parâmetros que a aba guarda (a parte aberta dentro dela: ?aba=, ?dia=, ?pessoa=…), lidos do estado da
 * navegação (`routes`: as rotas da raiz): a barra lateral volta para a aba como ela estava, como a pílula do
 * celular faz. Só os que são texto (os da URL); sem a aba no estado (a página abriu direto numa tela por cima),
 * nenhum.
 */
export function tabParams(routes: readonly NavRoute[] | undefined, route: string): Record<string, string> {
  const params = findTabs(routes)?.state?.routes?.find((r) => r.name === route)?.params;
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (typeof value === 'string' && value !== '') kept[key] = value;
  }
  return kept;
}

/** O endereço de uma área com os parâmetros guardados: o `href` do link da barra lateral. */
export function areaHref(href: string, params: Record<string, string>): string {
  const query = Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return query ? `${href}?${query}` : href;
}

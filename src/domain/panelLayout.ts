// O Painel do app no computador: quem mantém o Kotii gerencia os números e os recados numa janela larga. Aqui
// ficam a largura máxima do painel e as faixas de largura da janela que decidem a grade (quantas colunas de
// seções, quantos números do topo numa linha) e se os recados abrem em duas partes, a lista e o recado aberto lado
// a lado. No celular fica a coluna única de sempre. Também aqui: a aba do painel guardada na URL (?aba=).

/** A largura máxima do conteúdo do painel (as outras telas param em MAX_WIDTH, 720). */
export const PANEL_MAX_WIDTH = 1280;

/** A partir desta largura da janela: duas colunas, os quatro números do topo numa linha e os recados em duas partes. */
export const PANEL_WIDE_MIN = 720;

/** A partir desta largura da janela: três colunas de seções. */
export const PANEL_WIDER_MIN = 1100;

/** A largura da lista de recados ao lado do recado aberto (tela larga). */
export const PANEL_LIST_WIDTH = 360;

/** Como o painel se arruma numa largura de janela. */
export interface PanelLayout {
  /** Colunas da grade das seções dos números. */
  columns: 1 | 2 | 3;
  /** Quantos números do topo ("Agora") numa linha. */
  statColumns: 2 | 4;
  /** Os recados em duas partes lado a lado (a lista e o recado aberto), cada uma com a sua rolagem. */
  masterDetail: boolean;
}

/**
 * O arranjo do painel para a largura da janela (useWindowDimensions): abaixo de 720, a coluna única do celular
 * (os números do topo em 2×2, um recado abre na própria lista); de 720 a 1100, duas colunas; de 1100 para cima,
 * três. Uma largura que não é um número (a janela ainda sem medida) fica com a do celular.
 */
export function panelLayout(width: number): PanelLayout {
  if (!Number.isFinite(width) || width < PANEL_WIDE_MIN) return { columns: 1, statColumns: 2, masterDetail: false };
  if (width < PANEL_WIDER_MIN) return { columns: 2, statColumns: 4, masterDetail: true };
  return { columns: 3, statColumns: 4, masterDetail: true };
}

/**
 * A largura de uma seção da grade, em porcentagem da linha (o `flexBasis`/`width` da célula; o espaço entre as
 * colunas fica no padding da célula): `span` colunas de `columns`, nunca mais que a linha inteira. Arredondada
 * para baixo em 4 casas, para as células de uma linha nunca somarem mais que 100% (e a última não descer).
 */
export function panelCellPercent(columns: number, span = 1): `${number}%` {
  const total = Math.max(1, Math.floor(columns));
  const used = Math.min(total, Math.max(1, Math.floor(span)));
  return `${Math.floor((used / total) * 1e6) / 1e4}%`;
}

/** As abas do painel, na ordem da barra. */
export const PANEL_TABS = [
  { value: 'numeros', label: 'Números' },
  { value: 'recados', label: 'Recados' },
] as const;

export type PanelTab = (typeof PANEL_TABS)[number]['value'];

/** A aba pedida na URL (?aba=); sem ela, ou com um valor que não existe, os números. */
export function panelTabFromParam(value: string | string[] | undefined): PanelTab {
  const wanted = Array.isArray(value) ? value[0] : value;
  return PANEL_TABS.find((tab) => tab.value === wanted)?.value ?? 'numeros';
}

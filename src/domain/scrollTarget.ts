// Até onde rolar uma tela para mostrar uma linha de uma seção ("Abrir os avisos" abre a aba Família no interruptor
// de um tipo de aviso): o título da seção no alto, com a linha inteira abaixo dele, acima do lugar do botão do Nuke;
// se não couberem os dois, a linha um pouco abaixo do alto (o fim da linha de cima aparece: é uma lista). Nunca além
// do fim da página (o iOS não para sozinho no fim).

/** Acima do título da seção: a margem do alto das telas (SCREEN_PADDING). */
export const SCROLL_TARGET_TOP = 20;
/** Acima da linha, quando o título não cabe junto. */
export const SCROLL_TARGET_ROOM = 64;
/** Embaixo, onde o botão do Nuke flutua (o mesmo espaço do `fab` do Screen). */
export const SCROLL_TARGET_BOTTOM = 96;

export interface ScrollTargetInput {
  /** O alto da seção, no conteúdo que rola. */
  sectionTop: number;
  /** A linha, no conteúdo que rola; null quando o tipo não tem linha (só a seção). */
  row: { top: number; height: number } | null;
  /** A altura da parte visível. */
  viewport: number;
  /** A altura do conteúdo inteiro. */
  content: number;
}

/** O `y` a rolar, inteiro. */
export function scrollTargetY({ sectionTop, row, viewport, content }: ScrollTargetInput): number {
  const titleY = sectionTop - SCROLL_TARGET_TOP;
  const fitsWithTitle = !row || row.top + row.height - titleY <= viewport - SCROLL_TARGET_BOTTOM;
  const wanted = fitsWithTitle ? titleY : row.top - SCROLL_TARGET_ROOM;
  return Math.round(Math.min(Math.max(0, wanted), Math.max(0, content - viewport)));
}

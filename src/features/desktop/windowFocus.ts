// O teclado numa tela em janela do computador (RouteWindow): o Esc que fecha, o foco que fica dentro da caixa (o Tab
// da última volta para a primeira, o Shift+Tab da primeira vai para a última, como nas janelas de formulário do
// react-native-web) e, ao fechar, o foco de volta para quem abriu a janela. Só do navegador: quem chama confere que
// existe um `document`.

/** O `testID` da caixa (no navegador, `data-testid`): o que separa uma destas caixas de um menu ou formulário aberto por cima. */
export const WINDOW_TEST_ID = 'route-window';

/** Um menu ou formulário aberto (os do react-native-web dizem `aria-modal`), que não é uma destas caixas. */
export const OTHER_WINDOW = `[aria-modal="true"]:not([data-testid="${WINDOW_TEST_ID}"])`;

/** O que pode receber o foco pelo teclado (os toques do react-native-web são `div` com `tabindex`). */
const FOCUSABLE = 'a[href], button, input, select, textarea, iframe, [tabindex], [contenteditable="true"]';

/**
 * Para onde o Tab leva, dentro da caixa: `null` quando o navegador sabe sozinho (o próximo de dentro), ou o elemento
 * que fecha a volta: do último para o primeiro e do primeiro para o último (com o Shift); da própria caixa, ou de fora
 * dela (`active` nulo), para o primeiro ou para o último. Sem nada para o foco dentro, a caixa.
 */
export function wrapFocus<T>(items: readonly T[], active: T | null, box: T, backwards: boolean): T | null {
  if (!items.length) return box;
  const first = items[0];
  const last = items[items.length - 1];
  const fromEdge = active == null || active === box;
  if (backwards) return fromEdge || active === first ? last : null;
  return fromEdge || active === last ? first : null;
}

/** Os elementos de dentro da caixa que o Tab alcança, na ordem da página. */
export function tabStops(box: HTMLElement): HTMLElement[] {
  return Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => {
    if (element.tabIndex < 0 || (element as HTMLInputElement).disabled || (element as HTMLInputElement).type === 'hidden') return false;
    // Escondido (`display: none`, ou dentro de algo assim): sem caixa na tela.
    if (!element.getClientRects().length) return false;
    // Dentro de uma parte da caixa que o leitor de tela não vê (as telas de trás de uma pilha de dentro).
    const hidden = element.closest('[aria-hidden="true"], [inert]');
    return !(hidden && box.contains(hidden));
  });
}

/**
 * Liga o teclado da caixa aberta: o Esc chama `onEscape`, o Tab e o Shift+Tab dão a volta dentro dela, e o foco que
 * escapa para a tela de trás ou para a barra lateral (escurecidas) volta para dentro, do lado de onde saiu. Nada disso
 * com um menu ou um formulário aberto por cima (eles têm o próprio Esc e o próprio foco). Ao ligar, o foco entra na
 * caixa (um campo com foco automático, já dentro dela, fica com ele). Devolve o que desliga.
 */
export function trapWindowFocus(doc: Document, box: HTMLElement, onEscape: () => void): () => void {
  // Para que lado a pessoa ia no Tab de agora: o foco que escapa volta do mesmo lado.
  let backwards = false;
  const focus = (target: HTMLElement) => {
    if (doc.activeElement !== target) target.focus();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') {
      // Na composição de um texto (acentos, teclados asiáticos), o Esc é do campo.
      if (event.isComposing) return;
      // O menu e o formulário abertos por cima fecham no soltar da tecla (react-native-web): aqui, no apertar, eles
      // ainda estão abertos, e o Esc é deles.
      if (doc.querySelector(OTHER_WINDOW)) return;
      event.preventDefault();
      onEscape();
      return;
    }
    if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey || doc.querySelector(OTHER_WINDOW)) return;
    backwards = event.shiftKey;
    const stops = tabStops(box);
    const active = doc.activeElement as HTMLElement | null;
    const inBox = active != null && (active === box || box.contains(active));
    // Um elemento de dentro que o Tab não alcança (uma rolagem tocada com o mouse): o navegador segue dele, e o foco
    // que escapar volta pelo `focusin`.
    if (inBox && active !== box && !stops.includes(active)) return;
    const target = wrapFocus(stops, inBox ? active : null, box, backwards);
    if (!target) return;
    event.preventDefault();
    focus(target);
  };
  const onFocus = (event: FocusEvent) => {
    const target = event.target as Element | null;
    if (!target || target === box || box.contains(target) || target.closest?.(OTHER_WINDOW)) return;
    const stops = tabStops(box);
    focus((backwards ? stops[stops.length - 1] : stops[0]) ?? box);
  };
  // Na captura: o campo de texto do react-native-web não deixa a tecla subir até o documento.
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('focusin', onFocus);
  const active = doc.activeElement;
  if (!active || (active !== box && !box.contains(active))) box.focus();
  return () => {
    doc.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('focusin', onFocus);
  };
}

/**
 * Quem tinha o foco quando a janela abriu (lido no primeiro desenho dela, antes de um campo com foco automático
 * tomá-lo): ao fechar, o foco volta para ele (restoreFocus). Aberta pela opção de um menu de ações (o "Remédio" do
 * "Adicionar"), o foco ainda está dentro do menu, que some em seguida com a opção: é quem abriu o menu, que ele
 * deixou dito ao rodar a opção (`handed`, de ui/focus), que recebe o foco de volta. Um menu de antes, que já fechou,
 * não conta: o foco não está mais dentro dele.
 */
export function windowOpener(doc: Document, handed: { menu: unknown; opener: unknown } | null): Element | null {
  const active = doc.activeElement;
  const menu = handed?.menu as Element | null | undefined;
  const opener = handed?.opener as Element | null | undefined;
  // A caixa inteira do menu na página (a do react-native-web, que diz `aria-modal`), e não só a parte de dentro.
  const area = menu?.closest?.(OTHER_WINDOW) ?? menu;
  if (active && area?.contains?.(active) && opener && opener !== doc.body && doc.contains(opener)) return opener;
  return active;
}

// Quem tinha o foco quando cada tela da pilha abriu, pela caixa dela na página: a caixa de uma tela em janela e a
// caixa sem desenho de uma página (as duas em RouteWindow). Só a primeira vez conta (o elemento é o mesmo enquanto a
// tela está montada, também quando a janela cruza a largura do computador). WeakMap: a tela que sai leva a dela.
const layerOpeners = new WeakMap<object, Element | null>();

/** A tela (pela caixa dela) diz quem tinha o foco quando ela abriu (lido no primeiro desenho dela, windowOpener). */
export function rememberOpener(layer: object | null | undefined, opener: Element | null): void {
  if (layer && !layerOpeners.has(layer)) layerOpeners.set(layer, opener);
}

/**
 * Para onde o foco volta, de fato, quando a janela aberta por `opener` fecha. Ele mesmo, se ainda está na página. Se
 * saiu dela junto com a tela onde estava, porque a janela tomou o lugar daquela tela (`router.replace`: o "Registrar
 * próxima dose" da vacina abre a vacina nova no lugar da de antes, a do QR code vira a nota pendente, a página do
 * Escanear abre a do QR code), quem abriu aquela tela, e assim por diante: a janela que trocou a outra devolve o foco
 * a quem abriu a primeira (a linha da vacina), e não ao começo da página. A tela que saiu continua inteira fora da
 * página (só a caixa de cima sai dela), e o elemento ainda sabe em que caixa estava. `null` quando não há a quem.
 */
export function liveOpener(doc: Document, opener: Element | null): Element | null {
  const seen = new Set<object>();
  let current = opener;
  while (current && current !== doc.body && !doc.contains(current)) {
    let layer: Element | null = null;
    for (let node: Element | null = current; node && !layer; node = node.parentElement) if (layerOpeners.has(node)) layer = node;
    if (!layer || seen.has(layer)) return null;
    seen.add(layer);
    current = layerOpeners.get(layer) ?? null;
  }
  return current;
}

/**
 * Ao fechar a caixa, o foco volta para quem a abriu (o "Nova tarefa", a linha do Nuke na barra lateral), como nas
 * janelas de formulário: sem isto, ele cairia no começo da página. Quem abriu e já saiu da página com a tela que a
 * janela trocou dá o lugar a quem abriu aquela tela (liveOpener). Não quando ninguém assim está na página, ou quando
 * a página foi aberta direto na janela (o foco estava no corpo da página).
 */
export function restoreFocus(doc: Document, opener: Element | null): void {
  const target = liveOpener(doc, opener);
  if (!target || target === doc.body || !doc.contains(target)) return;
  (target as HTMLElement).focus?.();
}

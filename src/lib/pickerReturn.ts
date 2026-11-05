// No navegador, a galeria e a câmera do sistema são um <input type="file"> (expo-image-picker), e a promessa dele só
// termina pelo `change` do campo. Fechado sem nada escolhido, o campo só avisa pelo evento `cancel`, que o Safari tem
// desde o 16.4 e o Chrome desde o 113: antes disso (um iPhone 7 para no iOS 15), a promessa nunca termina. Este vigia
// diz quando a página voltou do seletor sem que um arquivo tenha chegado: a janela com o foco de novo, a aba visível
// de novo ou um toque na página (o seletor cobre a página; se ela recebe um toque, ele já fechou), e PICKER_RETURN_MS
// depois disso nenhum `change` de um campo de arquivo. O Chrome dá o foco à janela antes do `change`, e no Android o
// arquivo chega depois de a câmera devolver a página: o prazo deixa o `change` chegar primeiro. Um toque logo depois de
// abrir não conta: é o segundo toque de um toque duplo, com o seletor ainda aparecendo por cima da página.

/** Quanto esperar, depois de a página voltar, por um arquivo escolhido. */
export const PICKER_RETURN_MS = 1500;

/** Logo depois de abrir, o seletor ainda está aparecendo: um toque na página nesse tempo não é a volta. */
export const PICKER_OPENING_MS = 1000;

interface Listening {
  addEventListener(type: string, listener: (event: Event) => void, capture?: boolean): void;
  removeEventListener(type: string, listener: (event: Event) => void, capture?: boolean): void;
}

export interface PickerPage {
  window: Listening;
  document: Listening & { visibilityState?: string };
}

const canListen = (target: unknown): target is Listening =>
  Boolean(target) && typeof (target as Listening).addEventListener === 'function' && typeof (target as Listening).removeEventListener === 'function';

/** A página de agora, quando há uma (no navegador). */
function currentPage(): PickerPage | null {
  const scope = globalThis as unknown as { window?: unknown; document?: unknown };
  return canListen(scope.window) && canListen(scope.document) ? { window: scope.window, document: scope.document } : null;
}

/**
 * Chama `onReturn` (uma vez) quando a página voltou do seletor de arquivos sem um arquivo escolhido. Devolve o que
 * para de vigiar: quem chama para assim que a promessa do seletor termina. Fora do navegador, não vigia nada.
 */
export function watchPickerReturn(onReturn: () => void, page: PickerPage | null = currentPage()): () => void {
  if (!page) return () => undefined;
  const { window: win, document: doc } = page;
  const openedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Um arquivo chegou: a promessa vai terminar sozinha (o expo-image-picker lê o arquivo depois do `change`).
  let changed = false;
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (timer) clearTimeout(timer);
    win.removeEventListener('focus', back);
    doc.removeEventListener('visibilitychange', visible);
    doc.removeEventListener('pointerdown', touched, true);
    doc.removeEventListener('change', fileChanged, true);
  };
  function back() {
    if (stopped || changed || timer) return;
    timer = setTimeout(() => {
      if (stopped || changed) return;
      stop();
      onReturn();
    }, PICKER_RETURN_MS);
  }
  function visible() {
    if (doc.visibilityState === 'visible') back();
  }
  function touched() {
    if (Date.now() - openedAt >= PICKER_OPENING_MS) back();
  }
  // O campo fica no corpo da página: o `change` dele passa pelo documento (na captura, também o que não borbulha).
  function fileChanged(event: Event) {
    if ((event.target as { type?: unknown } | null)?.type !== 'file') return;
    changed = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
  }

  win.addEventListener('focus', back);
  doc.addEventListener('visibilitychange', visible);
  doc.addEventListener('pointerdown', touched, true);
  doc.addEventListener('change', fileChanged, true);
  return stop;
}

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { OTHER_WINDOW, restoreFocus, tabStops, trapWindowFocus, WINDOW_TEST_ID, windowOpener, wrapFocus } from '@/features/desktop/windowFocus';

// O teclado numa tela em janela do computador (RouteWindow), sobre uma página de mentira: o Esc, a volta do Tab e do
// Shift+Tab dentro da caixa, o foco que escapa e volta, e o foco de volta para quem abriu. O Jest não tem navegador:
// a página aqui é só o que essas regras leem dela.

type Listener = (event: unknown) => void;

/** Um elemento de mentira: sabe quem está dentro dele, recebe o foco e diz o que o Tab lê dele. */
class FakeElement {
  children: FakeElement[] = [];
  tabIndex = 0;
  disabled = false;
  type = '';
  shown = true;
  hiddenBelow = false;
  modal = false;
  constructor(
    readonly name: string,
    readonly parent: FakeElement | null = null,
  ) {
    parent?.children.push(this);
  }
  focus() {
    page.focusOn(this);
  }
  contains(other: unknown): boolean {
    for (let node = other as FakeElement | null; node; node = node.parent) if (node === this) return true;
    return false;
  }
  closest(selector: string): FakeElement | null {
    for (let node: FakeElement | null = this; node; node = node.parent) {
      if (selector === OTHER_WINDOW && node.modal) return node;
      if (selector.includes('aria-hidden') && node.hiddenBelow) return node;
    }
    return null;
  }
  getClientRects() {
    return this.shown ? [{}] : [];
  }
  querySelectorAll() {
    const all: FakeElement[] = [];
    const walk = (node: FakeElement) => node.children.forEach((child) => (all.push(child), walk(child)));
    walk(this);
    return all;
  }
}

/** A página: o corpo, a barra lateral, a tela de trás e a caixa com o que tem dentro. */
const page = {
  listeners: new Map<string, { listener: Listener; capture: boolean }>(),
  activeElement: null as FakeElement | null,
  body: null as unknown as FakeElement,
  openOver: false,
  focusOn(element: FakeElement) {
    this.activeElement = element;
    this.listeners.get('focusin')?.listener({ target: element });
  },
};
let doc: Document;
let sidebar: FakeElement;
let behind: FakeElement;
let box: FakeElement;
let close: FakeElement;
let title: FakeElement;
let save: FakeElement;

beforeEach(() => {
  page.listeners.clear();
  page.openOver = false;
  page.body = new FakeElement('body');
  sidebar = new FakeElement('barra lateral', page.body);
  behind = new FakeElement('Nova tarefa', page.body);
  box = new FakeElement(WINDOW_TEST_ID, page.body);
  box.tabIndex = -1;
  close = new FakeElement('Fechar', box);
  const form = new FakeElement('formulário', box);
  form.tabIndex = -1;
  title = new FakeElement('Título', form);
  save = new FakeElement('Salvar', form);
  page.activeElement = behind;
  doc = {
    get activeElement() {
      return page.activeElement;
    },
    get body() {
      return page.body;
    },
    contains: (node: unknown) => page.body.contains(node),
    querySelector: (selector: string) => (selector === OTHER_WINDOW && page.openOver ? {} : null),
    addEventListener: (type: string, listener: Listener, capture?: boolean) => page.listeners.set(type, { listener, capture: Boolean(capture) }),
    removeEventListener: (type: string, listener: Listener) => {
      if (page.listeners.get(type)?.listener === listener) page.listeners.delete(type);
    },
  } as unknown as Document;
});

const el = (node: FakeElement) => node as unknown as HTMLElement;
/** Uma tecla apertada na página (o que o ouvinte das teclas recebe), com o foco onde estiver. */
function key(name: string, modifiers: Partial<{ shiftKey: boolean; isComposing: boolean; defaultPrevented: boolean }> = {}) {
  const event = { key: name, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, isComposing: false, defaultPrevented: false, ...modifiers, preventDefault: jest.fn() };
  page.listeners.get('keydown')!.listener(event);
  return event;
}
/** O Tab (ou o Shift+Tab): a caixa decide, ou o navegador leva ao próximo elemento da página (aqui, o que o teste disser). */
function tab(shift: boolean, browserGoesTo?: FakeElement) {
  const event = key('Tab', { shiftKey: shift });
  if (!event.preventDefault.mock.calls.length && browserGoesTo) browserGoesTo.focus();
  return event;
}
const focused = () => page.activeElement?.name;

describe('para onde o Tab leva dentro da caixa', () => {
  const items = ['Fechar', 'Título', 'Salvar'];

  it('do último, volta para o primeiro; do primeiro, com o Shift, vai para o último', () => {
    expect(wrapFocus(items, 'Salvar', 'caixa', false)).toBe('Fechar');
    expect(wrapFocus(items, 'Fechar', 'caixa', true)).toBe('Salvar');
  });

  it('no meio, quem sabe é o navegador', () => {
    expect(wrapFocus(items, 'Título', 'caixa', false)).toBeNull();
    expect(wrapFocus(items, 'Título', 'caixa', true)).toBeNull();
    expect(wrapFocus(items, 'Fechar', 'caixa', false)).toBeNull();
    expect(wrapFocus(items, 'Salvar', 'caixa', true)).toBeNull();
  });

  it('da própria caixa (o foco de quando ela abre), ou de fora dela, entra pelo lado do Tab', () => {
    expect(wrapFocus(items, 'caixa', 'caixa', false)).toBe('Fechar');
    expect(wrapFocus(items, 'caixa', 'caixa', true)).toBe('Salvar');
    expect(wrapFocus(items, null, 'caixa', false)).toBe('Fechar');
    expect(wrapFocus(items, null, 'caixa', true)).toBe('Salvar');
  });

  it('sem nada para o foco dentro, fica na caixa', () => {
    expect(wrapFocus([], 'caixa', 'caixa', true)).toBe('caixa');
    expect(wrapFocus([], null, 'caixa', false)).toBe('caixa');
  });

  it('o Tab só para no que alcança: nem desligado, nem escondido, nem fora do alcance do teclado', () => {
    const off = new FakeElement('Desligado', box);
    off.disabled = true;
    const gone = new FakeElement('Escondido', box);
    gone.shown = false;
    const hiddenPart = new FakeElement('parte escondida', box);
    hiddenPart.hiddenBelow = true;
    new FakeElement('Dentro da parte escondida', hiddenPart);
    expect(tabStops(el(box)).map((node) => (node as unknown as FakeElement).name)).toEqual(['Fechar', 'Título', 'Salvar']);
  });
});

describe('o teclado na caixa aberta', () => {
  it('ao abrir, o foco entra na caixa; um campo de dentro que já tinha o foco fica com ele', () => {
    trapWindowFocus(doc, el(box), jest.fn());
    expect(focused()).toBe(WINDOW_TEST_ID);
    page.listeners.clear();
    page.activeElement = title;
    trapWindowFocus(doc, el(box), jest.fn());
    expect(focused()).toBe('Título');
  });

  it('o Esc fecha, no apertar da tecla e na captura (o campo de texto não a deixa subir)', () => {
    const onEscape = jest.fn();
    trapWindowFocus(doc, el(box), onEscape);
    expect(page.listeners.get('keydown')!.capture).toBe(true);
    const event = key('Escape');
    expect(onEscape).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalled();
    key('Enter');
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('o Esc não fecha com um menu ou formulário aberto por cima, na composição de um acento, nem já usado por outro', () => {
    const onEscape = jest.fn();
    trapWindowFocus(doc, el(box), onEscape);
    page.openOver = true;
    key('Escape');
    page.openOver = false;
    key('Escape', { isComposing: true });
    key('Escape', { defaultPrevented: true });
    expect(onEscape).not.toHaveBeenCalled();
  });

  it('o Shift+Tab dá a volta para trás: do primeiro para o último, e nunca fica preso na caixa', () => {
    trapWindowFocus(doc, el(box), jest.fn());
    expect(focused()).toBe(WINDOW_TEST_ID);
    // Da caixa (o foco de quando ela abre), para o último de dentro, e não para a tela de trás.
    expect(tab(true, behind).preventDefault).toHaveBeenCalled();
    expect(focused()).toBe('Salvar');
    tab(true, title);
    expect(focused()).toBe('Título');
    tab(true, close);
    expect(focused()).toBe('Fechar');
    // Do primeiro: o navegador iria para a tela de trás, e a caixa o leva para o último.
    expect(tab(true, behind).preventDefault).toHaveBeenCalled();
    expect(focused()).toBe('Salvar');
  });

  it('o Tab dá a volta para frente: do último para o primeiro', () => {
    trapWindowFocus(doc, el(box), jest.fn());
    tab(false);
    expect(focused()).toBe('Fechar');
    tab(false, title);
    tab(false, save);
    expect(focused()).toBe('Salvar');
    expect(tab(false, sidebar).preventDefault).toHaveBeenCalled();
    expect(focused()).toBe('Fechar');
  });

  it('o foco que escapa para a tela de trás ou para a barra lateral volta para dentro, do lado de onde saiu', () => {
    trapWindowFocus(doc, el(box), jest.fn());
    sidebar.focus();
    expect(focused()).toBe('Fechar');
    // Indo para trás (Shift+Tab), volta pelo último.
    tab(true, title);
    behind.focus();
    expect(focused()).toBe('Salvar');
  });

  it('com um menu ou formulário aberto por cima, o Tab e o foco são dele', () => {
    trapWindowFocus(doc, el(box), jest.fn());
    title.focus();
    page.openOver = true;
    expect(tab(false).preventDefault).not.toHaveBeenCalled();
    const menu = new FakeElement('menu', page.body);
    menu.modal = true;
    const option = new FakeElement('Renomear', menu);
    option.focus();
    expect(focused()).toBe('Renomear');
  });

  it('o que desliga tira os dois ouvintes da página', () => {
    const untrap = trapWindowFocus(doc, el(box), jest.fn());
    expect([...page.listeners.keys()].sort()).toEqual(['focusin', 'keydown']);
    untrap();
    expect(page.listeners.size).toBe(0);
  });
});

describe('ao fechar, o foco volta para quem abriu a janela', () => {
  it('para o botão que a abriu, ainda na página', () => {
    page.activeElement = save;
    restoreFocus(doc, el(behind));
    expect(focused()).toBe('Nova tarefa');
  });

  it('não quando a página foi aberta direto na janela (o foco estava no corpo), nem para quem saiu da página', () => {
    page.activeElement = save;
    restoreFocus(doc, el(page.body));
    restoreFocus(doc, null);
    restoreFocus(doc, el(new FakeElement('fora da página')));
    expect(focused()).toBe('Salvar');
  });
});

describe('quem abriu a janela (para onde o foco volta ao fechar)', () => {
  /** O menu de ações aberto por cima da tela (o do react-native-web diz `aria-modal`), com as opções dentro. */
  function menuOver() {
    const modal = new FakeElement('menu', page.body);
    modal.modal = true;
    const sheet = new FakeElement('caixa do menu', modal);
    const option = new FakeElement('Remédio', sheet);
    return { modal, sheet, option };
  }

  it('quem tinha o foco: o botão que abriu a janela', () => {
    page.activeElement = behind;
    expect(windowOpener(doc, null)).toBe(behind);
  });

  it('aberta pela opção de um menu de ações: quem abriu o menu, que a opção deixou dito, e não a opção, que sai com o menu', () => {
    const { sheet, option } = menuOver();
    page.activeElement = option;
    expect(windowOpener(doc, { menu: sheet, opener: behind })).toBe(behind);
    // O foco em outro lugar do menu (o que o react-native-web escolhe ao abrir) também é dele.
    const { modal } = menuOver();
    page.activeElement = modal;
    expect(windowOpener(doc, { menu: modal.children[0], opener: behind })).toBe(behind);
  });

  it('o menu de antes não conta: o foco já não está nele, ou quem o abriu saiu da página, ou era o corpo da página', () => {
    const { sheet, option } = menuOver();
    page.activeElement = sidebar;
    expect(windowOpener(doc, { menu: sheet, opener: behind })).toBe(sidebar);
    page.activeElement = option;
    const gone = new FakeElement('fora da página');
    expect(windowOpener(doc, { menu: sheet, opener: gone })).toBe(option);
    expect(windowOpener(doc, { menu: sheet, opener: page.body })).toBe(option);
    expect(windowOpener(doc, { menu: null, opener: behind })).toBe(option);
  });
});

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  currentTopLayer,
  liveOpener,
  markTopLayer,
  OTHER_WINDOW,
  rememberOpener,
  restoreFocus,
  tabStops,
  trapWindowFocus,
  WINDOW_TEST_ID,
  windowOpener,
  wrapFocus,
} from '@/features/desktop/windowFocus';

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
    public parent: FakeElement | null = null,
  ) {
    parent?.children.push(this);
  }
  get parentElement() {
    return this.parent;
  }
  /** Sai da página, como a tela que sai da pilha: só a caixa de cima perde o pai; o que está dentro continua nela. */
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
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

describe('a janela que tomou o lugar de outra tela (router.replace): o foco volta para quem abriu aquela tela', () => {
  /**
   * Uma tela na pilha, com quem a abriu e a tela que estava por cima quando ela abriu: a caixa dela (a da janela, ou a
   * sem desenho de uma página) e o que tem dentro.
   */
  function screenOf(name: string, opener: FakeElement | null, below: FakeElement | null = null) {
    const root = new FakeElement(`tela ${name}`, page.body);
    const layer = new FakeElement(`caixa ${name}`, root);
    rememberOpener(layer, el(opener ?? page.body), below);
    return { root, layer };
  }

  it('a vacina aberta pela linha, trocada pela vacina nova ("Registrar próxima dose"): ao fechar, a linha da vacina', () => {
    const row = new FakeElement('Gripe', behind);
    const first = screenOf('vacina/v1', row);
    const nextDose = new FakeElement('Registrar próxima dose', first.layer);
    // A janela nova lê o foco no primeiro desenho dela, com a de antes ainda na página: o botão de dentro da de antes.
    page.activeElement = nextDose;
    const opener = windowOpener(doc, null);
    expect(opener).toBe(nextDose);
    first.root.remove();
    const second = screenOf('vacina/nova', nextDose);
    page.activeElement = second.layer;
    expect(liveOpener(doc, el(nextDose))).toBe(row);
    restoreFocus(doc, opener);
    expect(focused()).toBe('Gripe');
  });

  it('trocas seguidas (o QR code que vira a nota pendente, aberto pela página do Escanear): quem abriu a primeira tela', () => {
    const tile = new FakeElement('Escanear', behind);
    const scan = screenOf('escanear', tile);
    const read = new FakeElement('Ler o link', scan.layer);
    scan.root.remove();
    const qr = screenOf('nota/qrcode', read);
    const pending = new FakeElement('Enviar os prints', qr.layer);
    qr.root.remove();
    screenOf('nota/pendente', pending);
    page.activeElement = save;
    restoreFocus(doc, el(pending));
    expect(focused()).toBe('Escanear');
  });

  it('o aviso "Buscando a nota na Sefaz…" tinha o foco quando o QR code virou a nota pendente: ao fechar, o "Adicionar nota"', () => {
    const addNote = new FakeElement('Adicionar nota', behind);
    const tabs = new FakeElement('caixa das abas', behind);
    const qr = screenOf('nota/qrcode', addNote, tabs);
    // O Modal do react-native-web toma o foco num portal no fim da página, fora da caixa da tela do QR code.
    const portal = new FakeElement('portal', page.body);
    const busy = new FakeElement('Buscando a nota na Sefaz…', portal);
    busy.tabIndex = -1;
    page.activeElement = busy;
    // A nota pendente lê, no primeiro desenho dela, o aviso como quem a abriu, e a do QR code como a de baixo.
    const opener = windowOpener(doc, null);
    expect(opener).toBe(busy);
    qr.root.remove();
    portal.remove();
    screenOf('nota/pendente', busy, qr.layer);
    page.activeElement = save;
    expect(liveOpener(doc, el(busy), qr.layer)).toBe(addNote);
    restoreFocus(doc, opener, qr.layer);
    expect(focused()).toBe('Adicionar nota');
  });

  it('a câmera do Escanear leu o QR code sozinha (o foco no corpo da página): ao fechar, o "Escanear" de Hoje', () => {
    const tile = new FakeElement('Escanear', behind);
    const scan = screenOf('escanear', tile);
    page.activeElement = page.body;
    scan.root.remove();
    const qr = screenOf('nota/qrcode', page.body, scan.layer);
    page.activeElement = save;
    expect(liveOpener(doc, el(page.body), scan.layer)).toBe(tile);
    restoreFocus(doc, el(page.body), scan.layer);
    expect(focused()).toBe('Escanear');
    // E a nota pendente que tomou o lugar desse QR code, aberta com o aviso "Buscando…" no foco: o mesmo "Escanear".
    const portal = new FakeElement('portal', page.body);
    const busy = new FakeElement('Buscando a nota na Sefaz…', portal);
    qr.root.remove();
    portal.remove();
    screenOf('nota/pendente', busy, qr.layer);
    page.activeElement = save;
    restoreFocus(doc, el(busy), qr.layer);
    expect(focused()).toBe('Escanear');
  });

  it('a tela de baixo continua na página (a janela abriu por cima dela, e não no lugar): ela não diz para onde o foco vai', () => {
    const tile = new FakeElement('Preços', behind);
    const prices = screenOf('precos', tile);
    page.activeElement = save;
    // O foco no corpo da página quando a janela abriu: nada a devolver, como sempre.
    expect(liveOpener(doc, el(page.body), prices.layer)).toBe(page.body);
    restoreFocus(doc, el(page.body), prices.layer);
    // Quem abriu saiu da página sem tela que tenha saído com ele.
    const portal = new FakeElement('portal', page.body);
    const busy = new FakeElement('Buscando…', portal);
    portal.remove();
    expect(liveOpener(doc, el(busy), prices.layer)).toBeNull();
    restoreFocus(doc, el(busy), prices.layer);
    expect(focused()).toBe('Salvar');
  });

  it('quem abriu continua na página: ele mesmo (a janela aberta por cima, e não no lugar, da outra)', () => {
    const first = screenOf('tarefa', behind);
    const inside = new FakeElement('Abrir o Nuke', first.layer);
    screenOf('nuke', inside);
    expect(liveOpener(doc, el(inside))).toBe(inside);
  });

  it('sem a quem: fora de qualquer tela, a tela de antes aberta direto na janela (o corpo da página), ou quem a abriu também saiu', () => {
    page.activeElement = save;
    expect(liveOpener(doc, el(new FakeElement('fora da página')))).toBeNull();
    const direct = screenOf('vacina/v1', null);
    const inside = new FakeElement('Registrar próxima dose', direct.layer);
    direct.root.remove();
    expect(liveOpener(doc, el(inside))).toBe(page.body);
    restoreFocus(doc, el(inside));
    const gone = new FakeElement('linha que saiu');
    const lost = screenOf('consulta', gone);
    const button = new FakeElement('Salvar', lost.layer);
    lost.root.remove();
    expect(liveOpener(doc, el(button))).toBeNull();
    restoreFocus(doc, el(button));
    expect(focused()).toBe('Salvar');
  });

  it('só a primeira vez conta: a caixa é a mesma enquanto a tela está montada', () => {
    const row = new FakeElement('Gripe', behind);
    const first = screenOf('vacina/v1', row);
    rememberOpener(first.layer, el(sidebar));
    const inside = new FakeElement('Registrar próxima dose', first.layer);
    first.root.remove();
    expect(liveOpener(doc, el(inside))).toBe(row);
  });
});

describe('a tela de cima da pilha (a de baixo da próxima que abrir)', () => {
  it('a que abre por último fica marcada; a que deixa de ser só desmarca quando ninguém tomou o lugar dela', () => {
    const tabs = new FakeElement('caixa das abas');
    const scan = new FakeElement('caixa do escanear');
    const untab = markTopLayer(tabs);
    expect(currentTopLayer()).toBe(tabs);
    // A página abre por cima das abas: ela é a de cima, e o desmarcar das abas, que vem depois, não a tira.
    const unscan = markTopLayer(scan);
    untab();
    expect(currentTopLayer()).toBe(scan);
    unscan();
    expect(currentTopLayer()).toBeNull();
    // Sem caixa (a tela ainda sem elemento), nada muda.
    markTopLayer(null)();
    expect(currentTopLayer()).toBeNull();
  });

  it('a tela não é a de baixo dela mesma', () => {
    const tile = new FakeElement('Escanear', behind);
    const layer = new FakeElement('caixa', page.body);
    rememberOpener(layer, el(tile), layer);
    layer.remove();
    expect(liveOpener(doc, el(page.body), layer)).toBe(tile);
    const alone = new FakeElement('caixa sozinha', page.body);
    rememberOpener(alone, el(page.body), alone);
    alone.remove();
    expect(liveOpener(doc, el(page.body), alone)).toBe(page.body);
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

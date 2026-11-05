import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { PICKER_OPENING_MS, PICKER_RETURN_MS, watchPickerReturn, type PickerPage } from '../pickerReturn';

// O seletor de arquivos do navegador fechado sem nada, num navegador que não avisa (sem o evento `cancel`): a página
// de volta (foco, aba visível, um toque) sem um arquivo em PICKER_RETURN_MS conta como fechado.

let win: EventTarget;
let doc: EventTarget & { visibilityState: string };
let page: PickerPage;

beforeEach(() => {
  jest.useFakeTimers();
  win = new EventTarget();
  doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  page = { window: win, document: doc };
});

afterEach(() => {
  jest.useRealTimers();
});

/** Um evento do documento vindo de `target` (o campo de arquivo fica no corpo da página). */
function fromTarget(type: string, target: unknown) {
  const event = new Event(type);
  Object.defineProperty(event, 'target', { value: target });
  doc.dispatchEvent(event);
}

describe('watchPickerReturn', () => {
  it('a janela com o foco de novo e nenhum arquivo no prazo: fechado, uma vez só', () => {
    const onReturn = jest.fn();
    watchPickerReturn(onReturn, page);
    win.dispatchEvent(new Event('focus'));
    jest.advanceTimersByTime(PICKER_RETURN_MS - 1);
    expect(onReturn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(onReturn).toHaveBeenCalledTimes(1);
    // Para de vigiar sozinho: outra volta não chama de novo.
    win.dispatchEvent(new Event('focus'));
    jest.advanceTimersByTime(PICKER_RETURN_MS * 2);
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it('a aba visível de novo, ou um toque na página, também é a volta; a aba escondida não', () => {
    const onVisible = jest.fn();
    watchPickerReturn(onVisible, page);
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    jest.advanceTimersByTime(PICKER_RETURN_MS * 2);
    expect(onVisible).not.toHaveBeenCalled();
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    jest.advanceTimersByTime(PICKER_RETURN_MS);
    expect(onVisible).toHaveBeenCalledTimes(1);

    const onTouch = jest.fn();
    watchPickerReturn(onTouch, page);
    jest.advanceTimersByTime(PICKER_OPENING_MS);
    doc.dispatchEvent(new Event('pointerdown'));
    jest.advanceTimersByTime(PICKER_RETURN_MS);
    expect(onTouch).toHaveBeenCalledTimes(1);
  });

  it('o segundo toque de um toque duplo (o seletor ainda aparecendo) não é a volta', () => {
    const onReturn = jest.fn();
    watchPickerReturn(onReturn, page);
    jest.advanceTimersByTime(PICKER_OPENING_MS - 700);
    doc.dispatchEvent(new Event('pointerdown'));
    jest.advanceTimersByTime(PICKER_RETURN_MS * 2);
    expect(onReturn).not.toHaveBeenCalled();
    // O foco de volta, mesmo logo depois de abrir, é a volta (a pessoa fechou o seletor depressa).
    win.dispatchEvent(new Event('focus'));
    jest.advanceTimersByTime(PICKER_RETURN_MS);
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it('o arquivo que chega depois do foco (o Chrome dá o foco antes do `change`): não fecha nada, a promessa termina sozinha', () => {
    const onReturn = jest.fn();
    watchPickerReturn(onReturn, page);
    win.dispatchEvent(new Event('focus'));
    jest.advanceTimersByTime(PICKER_RETURN_MS - 100);
    fromTarget('change', { type: 'file' });
    win.dispatchEvent(new Event('focus'));
    jest.advanceTimersByTime(PICKER_RETURN_MS * 2);
    expect(onReturn).not.toHaveBeenCalled();
  });

  it('o `change` de outro campo (não de arquivo) não conta', () => {
    const onReturn = jest.fn();
    watchPickerReturn(onReturn, page);
    win.dispatchEvent(new Event('focus'));
    fromTarget('change', { type: 'text' });
    jest.advanceTimersByTime(PICKER_RETURN_MS);
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it('parado antes (a promessa terminou, ou a tela saiu): nada, e os ouvintes saem', () => {
    const onReturn = jest.fn();
    const removed: string[] = [];
    const spy = (target: EventTarget) => {
      const remove = target.removeEventListener.bind(target);
      target.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) => {
        removed.push(type);
        remove(type, listener, options);
      };
    };
    spy(win);
    spy(doc);
    const stop = watchPickerReturn(onReturn, page);
    win.dispatchEvent(new Event('focus'));
    stop();
    jest.advanceTimersByTime(PICKER_RETURN_MS * 2);
    expect(onReturn).not.toHaveBeenCalled();
    expect(removed.sort()).toEqual(['change', 'focus', 'pointerdown', 'visibilitychange']);
    // Parar de novo não faz mal.
    stop();
  });

  it('fora do navegador (sem a página), não vigia nada', () => {
    const onReturn = jest.fn();
    const stop = watchPickerReturn(onReturn, null);
    jest.advanceTimersByTime(PICKER_RETURN_MS * 2);
    expect(onReturn).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });
});

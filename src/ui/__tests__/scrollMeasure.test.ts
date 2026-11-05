import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ScrollView, View } from 'react-native';

import { MEASURE_TIMEOUT_MS, measureInScroll, measureScrollArea } from '../scrollMeasure';

// As medidas para rolar até uma parte da tela: em relação à caixa de dentro do ScrollView, e null em qualquer falta
// (sem a caixa, altura 0 de uma aba escondida, erro, nenhuma resposta).

type Callback = (x: number, y: number, width: number, height: number) => void;

const inner = { measure: jest.fn((callback: Callback) => callback(0, 0, 360, 3000)) };
const outer = { measure: jest.fn((callback: Callback) => callback(0, 0, 360, 700)) };
const scroll = (refs: Partial<{ getInnerViewRef: () => unknown; getNativeScrollRef: () => unknown }> = {}) =>
  ({ getInnerViewRef: () => inner, getNativeScrollRef: () => outer, ...refs }) as unknown as ScrollView;
const node = (measureLayout: (relativeTo: unknown, success: Callback, fail: () => void) => void) =>
  ({ measureLayout: jest.fn(measureLayout) }) as unknown as View & { measureLayout: jest.Mock };

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('measureInScroll', () => {
  it('o alto e a altura do nó dentro do conteúdo, medidos em relação à caixa de dentro', async () => {
    const target = node((_relativeTo, success) => success(0, 1200, 360, 90));
    await expect(measureInScroll(scroll(), target)).resolves.toEqual({ top: 1200, height: 90 });
    expect(target.measureLayout.mock.calls[0][0]).toBe(inner);
  });

  it('null sem a caixa de dentro, sem o nó, com altura 0, com falha ou com erro', async () => {
    const ok = node((_relativeTo, success) => success(0, 1200, 360, 90));
    await expect(measureInScroll(scroll({ getInnerViewRef: undefined }), ok)).resolves.toBeNull();
    await expect(measureInScroll({} as ScrollView, ok)).resolves.toBeNull();
    await expect(measureInScroll(null, ok)).resolves.toBeNull();
    await expect(measureInScroll(scroll(), null)).resolves.toBeNull();
    await expect(measureInScroll(scroll(), node((_relativeTo, success) => success(0, 0, 0, 0)))).resolves.toBeNull();
    await expect(measureInScroll(scroll(), node((_relativeTo, _success, fail) => fail()))).resolves.toBeNull();
    await expect(
      measureInScroll(
        scroll(),
        node(() => {
          throw new Error('sem medida');
        }),
      ),
    ).resolves.toBeNull();
  });

  it('sem resposta em MEASURE_TIMEOUT_MS, null; a resposta atrasada não conta', async () => {
    let late: Callback = () => undefined;
    const target = node((_relativeTo, success) => {
      late = success;
    });
    const result = measureInScroll(scroll(), target);
    jest.advanceTimersByTime(MEASURE_TIMEOUT_MS);
    await expect(result).resolves.toBeNull();
    late(0, 1200, 360, 90);
    await expect(result).resolves.toBeNull();
  });
});

describe('measureScrollArea', () => {
  it('a altura visível e a do conteúdo', async () => {
    await expect(measureScrollArea(scroll())).resolves.toEqual({ viewport: 700, content: 3000 });
  });

  it('null sem as caixas ou com altura 0 (aba escondida no navegador)', async () => {
    await expect(measureScrollArea(null)).resolves.toBeNull();
    await expect(measureScrollArea(scroll({ getNativeScrollRef: () => null }))).resolves.toBeNull();
    const hidden = { measure: (callback: Callback) => callback(0, 0, 0, 0) };
    await expect(measureScrollArea(scroll({ getNativeScrollRef: () => hidden }))).resolves.toBeNull();
  });
});

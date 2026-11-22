import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Platform } from 'react-native';

import { primaryPointerIsTouch } from '../pointer';

// O navegador de toque: o que decide se a foto da nota vai pela câmera do celular (domain/scan, shutterUsesPhoneCamera).

const webWindow = globalThis as unknown as { window: { matchMedia?: (query: string) => { matches: boolean } } };

afterEach(() => {
  delete webWindow.window.matchMedia;
  jest.restoreAllMocks();
});

describe('o navegador de toque', () => {
  it('é o do dedo como ponteiro principal (o celular, o tablet); o do mouse não', () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const asked: string[] = [];
    let coarse = true;
    webWindow.window.matchMedia = (query) => {
      asked.push(query);
      return { matches: coarse };
    };
    expect(primaryPointerIsTouch()).toBe(true);
    coarse = false;
    expect(primaryPointerIsTouch()).toBe(false);
    // O ponteiro principal, não "algum" ponteiro: o notebook com tela de toque responde pelo mouse.
    expect(asked).toEqual(['(pointer: coarse)', '(pointer: coarse)']);
  });

  it('sem matchMedia, ou com ele falhando, não é; fora do navegador, nunca', () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    expect(primaryPointerIsTouch()).toBe(false);
    webWindow.window.matchMedia = () => {
      throw new Error('falhou');
    };
    expect(primaryPointerIsTouch()).toBe(false);
    jest.replaceProperty(Platform, 'OS', 'ios');
    webWindow.window.matchMedia = () => ({ matches: true });
    expect(primaryPointerIsTouch()).toBe(false);
  });
});

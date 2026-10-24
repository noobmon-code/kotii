import { afterEach, describe, expect, it, jest } from '@jest/globals';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

import { openExternal } from '../openLink';

jest.mock('expo-linking', () => ({ openURL: jest.fn() }));

const openURL = jest.mocked(Linking.openURL);
const webWindow = globalThis as unknown as { window: { open?: (...args: unknown[]) => unknown } };

afterEach(() => {
  jest.restoreAllMocks();
  openURL.mockReset();
  delete webWindow.window.open;
});

describe('abrir o WhatsApp ou o discador', () => {
  it('no celular, entrega o link ao sistema', async () => {
    openURL.mockResolvedValue(true);
    expect(await openExternal('https://wa.me/5511987654321')).toBe(true);
    expect(await openExternal('tel:+5511987654321')).toBe(true);
    expect(openURL.mock.calls).toEqual([['https://wa.me/5511987654321'], ['tel:+5511987654321']]);
  });

  it('ninguém abre o link (aparelho que não liga): devolve false, sem estourar', async () => {
    openURL.mockRejectedValue(new Error('Unable to open URL: tel:+5511987654321'));
    expect(await openExternal('tel:+5511987654321')).toBe(false);
  });

  it('no navegador, o WhatsApp abre em outra aba (o Kotii continua na dele) e a ligação segue pelo sistema', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const open = jest.fn();
    webWindow.window.open = open;
    openURL.mockResolvedValue(true);
    expect(await openExternal('https://wa.me/5511987654321')).toBe(true);
    expect(open.mock.calls).toEqual([['https://wa.me/5511987654321', '_blank', 'noopener,noreferrer']]);
    expect(openURL).not.toHaveBeenCalled();
    expect(await openExternal('tel:+5511987654321')).toBe(true);
    expect(openURL.mock.calls).toEqual([['tel:+5511987654321']]);
  });

  it('no navegador, o e-mail pronto também abre em outra aba: com o Gmail cuidando do mailto, ele não toma a aba do Kotii', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const open = jest.fn();
    webWindow.window.open = open;
    const url = 'mailto:ana@exemplo.com?subject=Oi';
    expect(await openExternal(url)).toBe(true);
    expect(open.mock.calls).toEqual([[url, '_blank', 'noopener,noreferrer']]);
    expect(openURL).not.toHaveBeenCalled();
  });
});

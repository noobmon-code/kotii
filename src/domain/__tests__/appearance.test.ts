import { describe, expect, it } from '@jest/globals';

import { parseThemeChoice, resolveScheme, THEME_CHOICES } from '../appearance';

describe('tema do app', () => {
  it('três escolhas, o automático primeiro', () => {
    expect(THEME_CHOICES.map((c) => c.label)).toEqual(['Automático', 'Claro', 'Escuro']);
  });

  it('o automático segue o celular; sem resposta do celular, claro', () => {
    expect(resolveScheme('auto', 'dark')).toBe('dark');
    expect(resolveScheme('auto', 'light')).toBe('light');
    expect(resolveScheme('auto', null)).toBe('light');
    expect(resolveScheme('auto', undefined)).toBe('light');
  });

  it('claro e escuro valem qualquer que seja o tema do celular', () => {
    expect(resolveScheme('light', 'dark')).toBe('light');
    expect(resolveScheme('dark', 'light')).toBe('dark');
    expect(resolveScheme('dark', null)).toBe('dark');
  });

  it('o que estava guardado: só "light" e "dark" valem; o resto é o automático', () => {
    expect(parseThemeChoice('light')).toBe('light');
    expect(parseThemeChoice('dark')).toBe('dark');
    for (const raw of [null, undefined, '', 'auto', 'escuro', '"dark"', 1]) expect(parseThemeChoice(raw)).toBe('auto');
  });
});

import { describe, expect, it } from '@jest/globals';

import { maskBRDate, parseBRDate } from '../dates';

/** Digita um caractere por vez, como no teclado. */
function type(keys: string, start = ''): string {
  let value = start;
  for (const key of keys) value = maskBRDate(value + key, value);
  return value;
}

/** Apaga n caracteres do fim, um por vez. */
function erase(start: string, n: number): string {
  let value = start;
  for (let i = 0; i < n; i++) value = maskBRDate(value.slice(0, -1), value);
  return value;
}

describe('maskBRDate', () => {
  it('põe as barras sozinho enquanto digita só números', () => {
    expect(type('2')).toBe('2');
    expect(type('20')).toBe('20/');
    expect(type('2012')).toBe('20/12/');
    expect(type('20122026')).toBe('20/12/2026');
    expect(parseBRDate(type('20122026'))).toBe('2026-12-20');
  });

  it('não passa de 8 dígitos', () => {
    expect(type('2012202699')).toBe('20/12/2026');
  });

  it('apagando, a barra automática não volta', () => {
    expect(erase('20/12/', 1)).toBe('20/12');
    expect(erase('20/12/', 2)).toBe('20/1');
    expect(erase('20/', 1)).toBe('20');
    expect(erase('20/', 2)).toBe('2');
  });

  it('a barra digitada completa o dia e o mês com zero', () => {
    expect(type('1/')).toBe('01/');
    expect(type('1/3/')).toBe('01/03/');
    expect(type('1/3/26')).toBe('01/03/26');
    expect(parseBRDate(type('1/3/26'))).toBe('2026-03-01');
    expect(type('20//')).toBe('20/');
  });

  it('aceita data colada', () => {
    expect(maskBRDate('1/3/2026')).toBe('01/03/2026');
    expect(maskBRDate('20/12/2026')).toBe('20/12/2026');
    expect(maskBRDate('2026-12-20')).toBe('20/12/2026');
    expect(maskBRDate('20.12.2026')).toBe('20/12/2026');
  });

  it('ignora letras', () => {
    expect(type('2a0')).toBe('20/');
  });
});

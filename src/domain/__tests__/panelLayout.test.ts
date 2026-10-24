import { describe, expect, it } from '@jest/globals';

import { PANEL_MAX_WIDTH, PANEL_TABS, panelCellPercent, panelLayout, panelTabFromParam } from '../panelLayout';

describe('o painel no computador', () => {
  it('vai até 1280 de largura', () => {
    expect(PANEL_MAX_WIDTH).toBe(1280);
  });

  it('as faixas: celular, janela média e janela larga', () => {
    const phone = { columns: 1, statColumns: 2, masterDetail: false };
    const medium = { columns: 2, statColumns: 4, masterDetail: true };
    const wide = { columns: 3, statColumns: 4, masterDetail: true };
    expect(panelLayout(320)).toEqual(phone);
    expect(panelLayout(390)).toEqual(phone);
    expect(panelLayout(719.5)).toEqual(phone);
    expect(panelLayout(720)).toEqual(medium);
    expect(panelLayout(1024)).toEqual(medium);
    expect(panelLayout(1099)).toEqual(medium);
    expect(panelLayout(1100)).toEqual(wide);
    expect(panelLayout(1920)).toEqual(wide);
    // A janela ainda sem medida fica com o celular.
    expect(panelLayout(0)).toEqual(phone);
    expect(panelLayout(Number.NaN)).toEqual(phone);
    expect(panelLayout(Number.POSITIVE_INFINITY)).toEqual(phone);
  });

  it('a largura de uma seção na grade', () => {
    expect(panelCellPercent(1)).toBe('100%');
    expect(panelCellPercent(2)).toBe('50%');
    expect(panelCellPercent(3)).toBe('33.3333%');
    expect(panelCellPercent(3, 2)).toBe('66.6666%');
    expect(panelCellPercent(2, 2)).toBe('100%');
    // Nunca mais que a linha, nunca menos que uma coluna.
    expect(panelCellPercent(1, 2)).toBe('100%');
    expect(panelCellPercent(2, 0)).toBe('50%');
    expect(panelCellPercent(0)).toBe('100%');
    // As células de uma linha nunca passam de 100%.
    for (const columns of [1, 2, 3, 4, 6, 7]) {
      for (let span = 1; span < columns; span++) {
        expect(parseFloat(panelCellPercent(columns, span)) + parseFloat(panelCellPercent(columns, columns - span))).toBeLessThanOrEqual(100);
      }
      expect(parseFloat(panelCellPercent(columns)) * columns).toBeLessThanOrEqual(100);
    }
  });

  it('a aba pedida na URL; sem ela, ou com um valor estranho, os números', () => {
    expect(PANEL_TABS).toEqual([
      { value: 'numeros', label: 'Números' },
      { value: 'recados', label: 'Recados' },
    ]);
    expect(panelTabFromParam('recados')).toBe('recados');
    expect(panelTabFromParam('numeros')).toBe('numeros');
    expect(panelTabFromParam(['recados', 'numeros'])).toBe('recados');
    expect(panelTabFromParam(undefined)).toBe('numeros');
    expect(panelTabFromParam('')).toBe('numeros');
    expect(panelTabFromParam('Recados')).toBe('numeros');
    expect(panelTabFromParam('toString')).toBe('numeros');
  });
});

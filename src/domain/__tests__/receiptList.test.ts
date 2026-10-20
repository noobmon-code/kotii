import { describe, expect, it } from '@jest/globals';

import { RECEIPTS_PAGE, receiptsByMonth, receiptsMore } from '../receiptList';

/** Dia do mês, na hora local do aparelho, como a nota guarda a compra. */
const at = (year: number, month: number, day: number, hour = 12) => new Date(year, month - 1, day, hour).toISOString();

describe('o histórico de notas por mês', () => {
  it('separa por mês da compra (no fuso do aparelho), na ordem em que as notas vêm', () => {
    const groups = receiptsByMonth([
      { id: 'a', purchased_at: at(2026, 10, 12) },
      { id: 'b', purchased_at: at(2026, 10, 1, 0) },
      { id: 'c', purchased_at: at(2026, 9, 30, 23) },
      { id: 'd', purchased_at: at(2025, 12, 31) },
    ]);
    expect(groups.map((group) => [group.month, group.title, group.receipts.map((r) => r.id)])).toEqual([
      ['2026-10', 'Outubro de 2026', ['a', 'b']],
      ['2026-09', 'Setembro de 2026', ['c']],
      ['2025-12', 'Dezembro de 2025', ['d']],
    ]);
  });

  it('a nota que veio em duas páginas (mudou de data entre elas) aparece uma vez só', () => {
    const groups = receiptsByMonth([
      { id: 'a', purchased_at: at(2026, 10, 12) },
      { id: 'b', purchased_at: at(2026, 10, 5) },
      { id: 'a', purchased_at: at(2026, 10, 1) },
    ]);
    expect(groups.flatMap((group) => group.receipts.map((r) => r.id))).toEqual(['a', 'b']);
  });

  it('nenhuma nota: nenhum mês', () => {
    expect(receiptsByMonth([])).toEqual([]);
  });
});

describe('o pé do histórico', () => {
  it('quantas estão na tela, de quantas, e o botão diz quantas vêm a seguir', () => {
    expect(RECEIPTS_PAGE).toBe(50);
    expect(receiptsMore(50, 180)).toEqual({ note: 'Mostrando as 50 notas mais recentes de 230.', button: 'Ver mais 50 notas' });
    // A última página: o botão diz quantas faltam.
    expect(receiptsMore(200, 30)).toEqual({ note: 'Mostrando as 200 notas mais recentes de 230.', button: 'Ver as 30 notas mais antigas' });
    expect(receiptsMore(200, 1)).toEqual({ note: 'Mostrando as 200 notas mais recentes de 201.', button: 'Ver a nota mais antiga' });
  });

  it('sem nada faltando, nada; sem a contagem do servidor, só o botão', () => {
    expect(receiptsMore(230, 0)).toBeNull();
    expect(receiptsMore(50, null)).toEqual({ note: null, button: 'Ver notas mais antigas' });
  });
});

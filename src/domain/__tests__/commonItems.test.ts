import { describe, expect, it } from '@jest/globals';

import { CATEGORIES } from '../categories';
import { COMMON_ITEMS, commonItemsByCategory, searchCommonItems } from '../commonItems';
import { normalizeSearch } from '../search';

describe('common items', () => {
  it('has a broad base with valid categories and no duplicates', () => {
    expect(COMMON_ITEMS.length).toBeGreaterThan(200);
    const keys = new Set(CATEGORIES.map((c) => c.key));
    for (const item of COMMON_ITEMS) expect(keys.has(item.category)).toBe(true);
    const names = COMMON_ITEMS.map((i) => normalizeSearch(i.name));
    expect(new Set(names).size).toBe(names.length);
  });

  it('covers every category', () => {
    const covered = new Set(COMMON_ITEMS.map((i) => i.category));
    for (const c of CATEGORIES) expect(covered.has(c.key)).toBe(true);
  });

  it('searches without accents, prefix matches first', () => {
    expect(searchCommonItems('feijao').map((i) => i.name)).toEqual(['Feijão carioca', 'Feijão preto']);
    expect(searchCommonItems('leite')[0].name).toMatch(/^Leite/);
    expect(searchCommonItems('limpeza').length).toBeGreaterThan(0);
    expect(searchCommonItems('')).toEqual([]);
  });

  it('puts pharmacy categories first on pharmacy lists', () => {
    expect(commonItemsByCategory('farmacia')[0].category).toBe('medicamentos');
    expect(commonItemsByCategory('mercado')[0].category).toBe('hortifruti');
  });
});

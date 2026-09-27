import { describe, expect, it } from '@jest/globals';

import { CATEGORIES } from '@/domain/categories';
import { ITEM_ART_KEYS } from '@/domain/itemArt';
import { CATEGORY_ART } from '../categoryArt';
import { ITEM_ART } from '../itemArt';

describe('CATEGORY_ART', () => {
  it('tem uma ilustração para cada categoria, e só para elas', () => {
    expect(Object.keys(CATEGORY_ART).sort()).toEqual(CATEGORIES.map((c) => c.key).sort());
    for (const art of Object.values(CATEGORY_ART)) expect(art.image).toBeTruthy();
  });
});

describe('ITEM_ART', () => {
  it('tem uma ilustração para cada regra de item, e só para elas', () => {
    expect(Object.keys(ITEM_ART).sort()).toEqual([...ITEM_ART_KEYS].sort());
    for (const image of Object.values(ITEM_ART)) expect(image).toBeTruthy();
  });
});

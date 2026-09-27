import { describe, expect, it } from '@jest/globals';

import { CATEGORIES } from '@/domain/categories';
import { CATEGORY_ART } from '../categoryArt';

describe('CATEGORY_ART', () => {
  it('tem uma ilustração para cada categoria, e só para elas', () => {
    expect(Object.keys(CATEGORY_ART).sort()).toEqual(CATEGORIES.map((c) => c.key).sort());
    for (const art of Object.values(CATEGORY_ART)) expect(art.image).toBeTruthy();
  });
});

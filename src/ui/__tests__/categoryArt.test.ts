import { describe, expect, it } from '@jest/globals';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CATEGORIES } from '@/domain/categories';
import { ITEM_ART_KEYS } from '@/domain/itemArt';
import { SKIES } from '@/domain/sky';
import { CATEGORY_ART } from '../categoryArt';
import { CLIMA_ART } from '../climaArt';
import { ICON_ART } from '../iconArt';
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

describe('CLIMA_ART', () => {
  it('tem um desenho para cada céu, de dia e de noite, e só eles', () => {
    const keys = (['dia', 'noite'] as const).flatMap((period) => SKIES.map((sky) => `${period}-${sky}`));
    expect(Object.keys(CLIMA_ART).sort()).toEqual(keys.sort());
    for (const image of Object.values(CLIMA_ART)) expect(image).toBeTruthy();
  });
});

describe('ICON_ART', () => {
  it('tem imagem e tamanho para cada ícone', () => {
    expect(Object.keys(ICON_ART).sort()).toEqual(['camera', 'capsula', 'carrinho', 'seringa', 'tarefa']);
    for (const art of Object.values(ICON_ART)) {
      expect(art.source).toBeTruthy();
      expect(art.width).toBeGreaterThan(0);
      expect(art.height).toBeGreaterThan(0);
    }
  });
});

describe('as imagens das ilustrações', () => {
  it.each(['categoryArt.ts', 'itemArt.ts', 'climaArt.tsx', 'iconArt.tsx'])('%s só aponta para arquivos que existem', (file) => {
    const source = readFileSync(resolve(__dirname, '..', file), 'utf8');
    const paths = [...source.matchAll(/require\('([^']+\.webp)'\)/g)].map((m) => resolve(__dirname, '..', m[1]));
    expect(paths.length).toBeGreaterThan(file === 'iconArt.tsx' ? 4 : 13);
    for (const path of paths) expect(existsSync(path)).toBe(true);
  });
});

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { ReactElement } from 'react';
import { StyleSheet, Text as NativeText } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { COMMON_ITEMS } from '@/domain/commonItems';
import type { RecentItem } from '@/domain/recentPurchases';
import type { RestockItem } from '@/domain/restock';
import { RecentPurchases, RestockStrip } from '@/features/RecentPurchases';
import { CategoryIcon, Text } from '@/ui/primitives';

// As faixas de cima da lista ("Acho que acabou" e "Comprados recentemente"), de verdade: compactas, para a lista
// começar mais cedo. "Comprados recentemente" mostra só o nome (a quantidade de sempre, o leitor de tela diz);
// "Acho que acabou" mantém o "há N dias", que é o porquê da sugestão, e não uma quantidade.

jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('@/ui/art', () => ({}));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));

const milk: RecentItem = {
  name: 'Leite desnatado',
  category: 'laticinios',
  productId: 'il',
  quantity: 2,
  unit: 'l',
  times: 3,
  lastAt: '2026-11-10T12:00:00Z',
};
const coffee: RestockItem = {
  name: 'Café',
  category: 'cafe_cha',
  productId: null,
  quantity: 1,
  unit: 'un',
  lastAt: '2026-11-06T12:00:00Z',
  everyDays: 10,
  daysSince: 14,
  boughtAs: [{ name: 'Café Pilão 500g', productId: null }],
};

let renderer: ReactTestRenderer | undefined;

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

async function mount(element: ReactElement) {
  await act(async () => {
    renderer = create(element);
  });
  return renderer!.root;
}

/** O azulejo de cada item: o botão que põe na lista. */
const tiles = (root: ReactTestInstance) =>
  root.findAll((node) => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function', { deep: false });
const words = (node: ReactTestInstance) => node.findAllByType(Text).map((text) => text.props.children);
const tileStyle = (tile: ReactTestInstance) =>
  StyleSheet.flatten(typeof tile.props.style === 'function' ? tile.props.style({ pressed: false }) : tile.props.style);

/**
 * As larguras de avanço de um arquivo TrueType (tabelas head, hhea, hmtx e o cmap 3/1 de formato 4, o que a Nunito do
 * @expo-google-fonts traz): quanto a linha anda a cada letra, sem o kerning, que só estreita. A letra que a fonte não
 * tem (o glifo 0) falha, em vez de medir errado.
 */
function fontWidths(file: Buffer) {
  const tables: Record<string, number> = {};
  for (let i = 0; i < file.readUInt16BE(4); i++) {
    tables[file.toString('latin1', 12 + 16 * i, 16 + 16 * i)] = file.readUInt32BE(20 + 16 * i);
  }
  const unitsPerEm = file.readUInt16BE(tables.head + 18);
  const metrics = file.readUInt16BE(tables.hhea + 34);
  let sub = -1;
  for (let i = 0; i < file.readUInt16BE(tables.cmap + 2); i++) {
    const record = tables.cmap + 4 + 8 * i;
    if (file.readUInt16BE(record) === 3 && file.readUInt16BE(record + 2) === 1) sub = tables.cmap + file.readUInt32BE(record + 4);
  }
  if (sub < 0 || file.readUInt16BE(sub) !== 4) throw new Error('fonte sem o cmap 3/1 de formato 4');
  const segments = file.readUInt16BE(sub + 6);
  const ends = sub + 14;
  const starts = ends + segments + 2;
  const deltas = starts + segments;
  const offsets = deltas + segments;
  const glyph = (code: number) => {
    for (let s = 0; s < segments; s += 2) {
      if (file.readUInt16BE(ends + s) < code) continue;
      const start = file.readUInt16BE(starts + s);
      if (start > code) return 0;
      const delta = file.readUInt16BE(deltas + s);
      const offset = file.readUInt16BE(offsets + s);
      if (!offset) return (code + delta) & 0xffff;
      const found = file.readUInt16BE(offsets + s + offset + 2 * (code - start));
      return found ? (found + delta) & 0xffff : 0;
    }
    return 0;
  };
  return (text: string, size: number) =>
    ([...text].reduce((sum, letter) => {
      const id = glyph(letter.codePointAt(0)!);
      if (!id) throw new Error(`a fonte não tem "${letter}"`);
      return sum + file.readUInt16BE(tables.hmtx + 4 * Math.min(id, metrics - 1));
    }, 0) *
      size) /
    unitsPerEm;
}

describe('as faixas de cima da lista', () => {
  it('"Comprados recentemente": só o nome no azulejo; a quantidade, o leitor de tela diz, e o toque põe com ela', async () => {
    const onAdd = jest.fn();
    const root = await mount(<RecentPurchases items={[milk]} onAdd={onAdd} />);
    const [tile] = tiles(root);
    expect(words(tile)).toEqual(['Leite desnatado']);
    expect(tile.props.accessibilityLabel).toBe('Adicionar Leite desnatado, 2 l, comprado 3 vezes');
    await act(async () => tile.props.onPress());
    expect(onAdd).toHaveBeenCalledWith(milk);
  });

  it('"Acho que acabou" mantém o "há N dias" embaixo do nome: é o porquê, e não uma quantidade', async () => {
    const root = await mount(<RestockStrip items={[coffee]} onAdd={jest.fn()} />);
    const [tile] = tiles(root);
    expect(words(tile)).toEqual(['Café', 'há 14 dias']);
    expect(tile.props.accessibilityLabel).toBe('Adicionar Café, 1 un. Costuma comprar a cada 10 dias · última há 14 dias');
  });

  it('compactas: desenho menor e menos espaço em cima, o nome em até duas linhas, e o toque continua passando dos 44', async () => {
    const root = await mount(<RecentPurchases items={[milk]} onAdd={jest.fn()} />);
    const [tile] = tiles(root);
    const style = tileStyle(tile);
    // Antes: desenho de 44 e 12 em cima. A largura é a de antes (92), para o nome (ver o teste de baixo).
    expect(style.width).toBe(92);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    expect(style.paddingTop).toBe(8);
    expect(tile.findByType(CategoryIcon).props.size).toBe(36);
    expect(tile.findAllByType(Text)[0].props.numberOfLines).toBe(2);
  });

  it('toda palavra dos itens comuns cabe inteira numa linha do nome, medida no arquivo da fonte que o nome usa', async () => {
    // Uma palavra mais larga que a linha quebra numa letra ("Multivitamíni" / "co"); com hífen, a linha pode quebrar
    // depois dele, e cada parte ("Lustra-", "móveis") é que precisa caber. A mais larga é "Multivitamínico" (87,1), que
    // não cabia nos 84 que o nome teve até aqui; depois dela, "Condicionador" (82,1).
    const root = await mount(<RestockStrip items={[{ ...coffee, name: 'Multivitamínico', category: 'suplementos' }]} onAdd={jest.fn()} />);
    const [tile] = tiles(root);
    const style = tileStyle(tile);
    const nameWidth = Number(style.width) - 2 * Number(style.paddingHorizontal);
    const name = StyleSheet.flatten(tile.findAllByType(Text)[0].findByType(NativeText).props.style);
    expect(name.letterSpacing ?? 0).toBe(0);
    const families: Record<string, string> = { Nunito_600SemiBold: '600SemiBold/Nunito_600SemiBold.ttf' };
    expect(families[String(name.fontFamily)]).toBeDefined();
    const fontFile = join(__dirname, '..', '..', '..', 'node_modules', '@expo-google-fonts', 'nunito', families[String(name.fontFamily)]);
    const width = fontWidths(readFileSync(fontFile));
    // Cada palavra do catálogo; a que tem hífen, em partes que terminam nele.
    const parts = (itemName: string) => itemName.replace(/-/g, '- ').split(' ').filter(Boolean);
    const words = [...new Set(COMMON_ITEMS.flatMap((item) => parts(item.name)))];
    const measured = words.map((word) => ({ word, width: width(word, Number(name.fontSize)) })).sort((a, b) => b.width - a.width);
    expect(measured[0].word).toBe('Multivitamínico');
    expect(measured[0].width).toBeCloseTo(87.11, 2);
    expect(measured.filter((entry) => entry.width > nameWidth)).toEqual([]);
  });

  it('sem item, a faixa não aparece', async () => {
    const root = await mount(<RecentPurchases items={[]} onAdd={jest.fn()} />);
    expect(tiles(root)).toHaveLength(0);
    expect(renderer!.toJSON()).toBeNull();
  });
});

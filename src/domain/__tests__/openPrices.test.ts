import { describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import path from 'path';

import {
  ABBREVIATED_MARKS,
  basePackSize,
  brandFreeItemKey,
  CAN_IS_THE_PACKAGE,
  COOKED_IS_THE_USUAL,
  CURED_HAM_WORDS,
  keyFit,
  keyPackageSize,
  LT_IS_THE_CAN,
  MAX_PACK_AMOUNT,
  MAX_PACK_OF,
  OPEN_KEYS_PER_ENTRY,
  OPEN_MAX_CALLS,
  OPEN_MAX_ENTRIES,
  OPEN_MAX_EXTRA,
  OPEN_MAX_WORDS,
  OPEN_PRICE_FACT,
  openGroupArgument,
  openGroupCalls,
  openGroups,
  openItemsSignature,
  openPriceItem,
  openQuotes,
  openSearchPlan,
  openSizeFact,
  openSizeNote,
  OTHER_PRODUCT_WORDS,
  otherProductMarks,
  ownSameItemKeys,
  parseSharedItemKeys,
  parseSharedItemPrices,
  restorePackMark,
  type OpenGroup,
  type OpenKeysAnswer,
  type OpenPricesAnswer,
  type OpenSearchItem,
  type SharedItemKey,
  type SharedItemPrice,
} from '../openPrices';
import * as sameItem from '../sameItem';

// A base aberta de preços (domain/openPrices): que itens procuram, como a busca se monta, que descrições são o mesmo
// item, o tamanho que a conta usa e como as respostas viram preços da lista.

const item = (id: string, name: string, category: string | null, quantity = 1, unit = 'un', extra: Partial<OpenSearchItem> = {}): OpenSearchItem => ({
  id,
  name,
  category,
  quantity,
  unit,
  ...extra,
});
const key = (k: string, unit: SharedItemKey['unit'] = 'un', seen = 1, week = '2026-11-09'): SharedItemKey => ({ key: k, unit, week, seen });

/** O plano dos itens e uma resposta do passo 1 que dá a cada busca as chaves pedidas. */
function answered(items: OpenSearchItem[], keysOf: (item: OpenSearchItem) => SharedItemKey[]) {
  const plan = openSearchPlan(items);
  const bySignature = new Map<string, SharedItemKey[]>();
  for (const one of items) {
    const signature = plan.entryOf.get(one.id);
    if (signature) bySignature.set(signature, [...(bySignature.get(signature) ?? []), ...keysOf(one)]);
  }
  const answers: OpenKeysAnswer[] = plan.calls.map((call) => ({
    entries: call.map((entry) => entry.signature),
    keys: call.map((entry) => bySignature.get(entry.signature) ?? []),
    more: call.map(() => false),
  }));
  return { plan, answers, groups: openGroups(items, answers, plan) };
}
const groupOf = (groups: OpenGroup[], id: string) => groups.find((group) => group.items.some((one) => one.id === id));
const entryOf = (groups: OpenGroup[], id: string) => groupOf(groups, id)?.items.find((one) => one.id === id);

/**
 * O que shared_item_prices aceita num grupo (supabase/migrations/20261124181819_shared_prices_open.sql, as checagens
 * antes de ler qualquer coisa): um grupo fora disto faz o banco recusar a chamada inteira, de até 40 grupos.
 */
function serverAccepts(group: { k: string[]; w?: string[]; p?: { u: string; a: number; o?: number } }): boolean {
  const w = group.w ?? [];
  const all = [...group.k, ...w];
  if (all.length < 1 || all.length > 60) return false;
  if (!all.every((key) => key.length >= 1 && key.length <= 200 && /^[A-Z0-9]+(?: [A-Z0-9]+)*$/.test(key))) return false;
  if (w.some((key) => group.k.includes(key))) return false;
  const p = group.p;
  if (!p) return true;
  if (!['kg', 'l', 'un'].includes(p.u) || !(p.a > 0 && p.a <= 100000)) return false;
  if (p.u === 'un' && !(Number.isInteger(p.a) && p.a >= 2)) return false;
  if (p.o === undefined) return true;
  return p.u !== 'un' && Number.isInteger(p.o) && p.o >= 2 && p.o <= 1000;
}

describe('que itens procuram preço na base aberta', () => {
  it('o item de qualquer marca, de uma categoria que se compartilha, "outros" ou sem categoria', () => {
    const none = new Set<string>();
    expect(openPriceItem({ name: 'Arroz', category: 'graos' }, none)).toBe(true);
    expect(openPriceItem({ name: 'Detergente', category: null }, none)).toBe(true);
    expect(openPriceItem({ name: 'Leite', category: 'outros' }, none)).toBe(true);
  });

  it('não procuram: "Marca preferida", a marca no nome, o item que o app não conhece, higiene, e ração e fralda (o nome é o item)', () => {
    const none = new Set<string>();
    expect(openPriceItem({ name: 'Arroz', category: 'graos', brandPreferred: true }, none)).toBe(false);
    expect(openPriceItem({ name: 'Biscoito Oreo', category: 'doces' }, none)).toBe(false);
    expect(openPriceItem({ name: 'Leite IL Desnatado', category: 'laticinios' }, none)).toBe(false);
    expect(openPriceItem({ name: 'Pastilha Mentos', category: 'doces' }, none)).toBe(false);
    expect(openPriceItem({ name: 'Shampoo', category: 'higiene' }, none)).toBe(false);
    expect(openPriceItem({ name: 'Ração para cachorro', category: 'pet' }, none)).toBe(false);
    expect(openPriceItem({ name: 'Fralda', category: 'bebe' }, none)).toBe(false);
    expect(brandFreeItemKey({ name: 'Ração para cachorro', category: 'pet' })).toBeNull();
  });

  it('nem o item de um produto da casa com preço: "Arroz" numa casa que comprou "Arroz Camil 5kg"', () => {
    const products = [
      { id: 'camil', name: 'Arroz Camil 5kg', category: 'graos' },
      { id: 'italac', name: 'Leite Italac Integral', category: 'laticinios' },
    ];
    const own = ownSameItemKeys(products, [
      { productId: 'camil', unitPrice: 24.9 },
      // Zero não é preço.
      { productId: 'italac', unitPrice: 0 },
    ]);
    expect([...own]).toEqual(['i:arroz']);
    expect(openPriceItem({ name: 'Arroz', category: 'graos' }, own)).toBe(false);
    expect(openPriceItem({ name: 'Leite integral', category: 'laticinios' }, own)).toBe(true);
  });
});

describe('a busca (passo 1)', () => {
  it('as palavras do item em maiúsculas; itens com as mesmas palavras dividem a busca', () => {
    const plan = openSearchPlan([item('a', 'Leite', 'laticinios'), item('b', 'Leite', null), item('c', 'Leite sem lactose', 'laticinios')]);
    expect(plan.calls).toHaveLength(1);
    expect(plan.calls[0]).toHaveLength(2);
    const leite = plan.calls[0].find((entry) => !entry.extra.length)!;
    expect(leite).toEqual({
      signature: JSON.stringify([leite.first, leite.second, []]),
      first: ['LEITE', 'LEITES', 'LT', 'LTE'],
      second: ['LEITE', 'LEITES', 'LTE'],
      extra: [],
    });
    expect(plan.entryOf.get('a')).toBe(leite.signature);
    expect(plan.entryOf.get('b')).toBe(leite.signature);
    expect(plan.calls[0].find((entry) => entry.extra.length)?.extra).toEqual(['SEM', 'LACTOSE']);
  });

  it('as palavras cabem nos tetos do banco', () => {
    const plan = openSearchPlan([item('a', 'Papel higiênico folha dupla neutro extra macio rolos grandes perfumado com aloe vera e camomila', 'papel')]);
    const [entry] = plan.calls[0];
    expect(entry.first.length).toBeLessThanOrEqual(OPEN_MAX_WORDS);
    expect(entry.second.length).toBeLessThanOrEqual(OPEN_MAX_WORDS);
    expect(entry.extra.length).toBe(OPEN_MAX_EXTRA);
    expect([...entry.first, ...entry.second, ...entry.extra].every((word) => /^[A-Z0-9]{1,40}$/.test(word))).toBe(true);
  });

  it('em chamadas de 40, no máximo 4, na ordem das assinaturas: a ordem da lista não muda os pedaços', () => {
    const names = Array.from({ length: 170 }, (_, n) => `Leite ${'abcdefghij'[n % 10]}${'abcdefghijklmnopq'[Math.floor(n / 10)]}`);
    const items = names.map((name, n) => item(`i${n}`, name, 'laticinios'));
    const plan = openSearchPlan(items);
    expect(plan.calls.map((call) => call.length)).toEqual([OPEN_MAX_ENTRIES, OPEN_MAX_ENTRIES, OPEN_MAX_ENTRIES, OPEN_MAX_ENTRIES]);
    expect(plan.calls).toHaveLength(OPEN_MAX_CALLS);
    // As buscas que não couberam não têm entrada: o item fica sem preço aberto, sem erro.
    expect(plan.entryOf.size).toBe(OPEN_MAX_ENTRIES * OPEN_MAX_CALLS);
    const shuffled = openSearchPlan([...items].reverse());
    expect(shuffled.calls.map((call) => call.map((entry) => entry.signature))).toEqual(plan.calls.map((call) => call.map((entry) => entry.signature)));
  });

  it('a assinatura dos itens não muda com o carrinho, e muda com o que a busca usa', () => {
    const one = item('a', 'Arroz', 'graos', 2, 'kg');
    expect(openItemsSignature([one])).toBe(openItemsSignature([{ ...one }]));
    expect(openItemsSignature([one])).not.toBe(openItemsSignature([{ ...one, quantity: 5 }]));
    expect(openItemsSignature([one])).not.toBe(openItemsSignature([{ ...one, brandPreferred: true }]));
  });

  it('a resposta: uma por busca, conferida; fora da forma é erro, nunca meia resposta', () => {
    const plan = openSearchPlan([item('a', 'Leite', null), item('b', 'Arroz', null)]);
    const entries = plan.calls[0];
    const answer = parseSharedItemKeys(
      [
        { k: [['LEITE INT ITALAC 1L', 'un', '2026-11-09', 3], ['LEITE X', 'cx', '2026-11-09', 1], ['LEITE Y', 'un', '9 nov', 1], ['LEITE Z', 'un', '2026-11-09', 0]], more: true },
        { k: [], more: false },
      ],
      entries,
    );
    expect(answer).toEqual({
      entries: entries.map((entry) => entry.signature),
      keys: [[{ key: 'LEITE INT ITALAC 1L', unit: 'un', week: '2026-11-09', seen: 3 }], []],
      more: [true, false],
    });
    expect(() => parseSharedItemKeys([{ k: [], more: false }], entries)).toThrow();
    expect(() => parseSharedItemKeys(null, entries)).toThrow();
    expect(() => parseSharedItemKeys([{ more: false }, { k: [] }], entries)).toThrow();
  });
});

describe('o mesmo item: as descrições que ficam', () => {
  it('a caixa volta na chave: "C 12" é "C/12", e o "C" de outra coisa fica', () => {
    expect(restorePackMark('CERV SKOL LT 350ML C 12')).toBe('CERV SKOL LT 350ML C/12');
    expect(restorePackMark('OVOS BRANCOS C 30')).toBe('OVOS BRANCOS C/30');
    expect(restorePackMark('OLEO SOJA C 900 ML')).toBe('OLEO SOJA C 900 ML');
    expect(restorePackMark('VIT C 1000MG')).toBe('VIT C 1000MG');
  });

  it('o tamanho da chave pela leitura estrita, com a caixa de volta; o decimal cortado não diz tamanho', () => {
    expect(keyPackageSize('CERV SKOL LT 350ML C 12')).toEqual({ unit: 'l', amount: 4.2, label: '12 x 350 ml', of: 12 });
    expect(keyPackageSize('OVOS BRANCOS C 30')).toEqual({ unit: 'un', amount: 30, label: '30 un' });
    expect(keyPackageSize('ARROZ T1 5KG')).toEqual({ unit: 'kg', amount: 5, label: '5 kg' });
    expect(keyPackageSize('ARROZ 10 1KG')).toBeNull();
    expect(keyPackageSize('CERV BRAHMA 350ML LT C12')).toBeNull();
  });

  it('o tamanho na forma que a base guarda: o "1 x" sai, o "N x" fora de 2 a 1000 também, e o tamanho fora dos limites não é tamanho', () => {
    expect([MAX_PACK_AMOUNT, MAX_PACK_OF]).toEqual([100000, 1000]);
    // Os mesmos limites do tamanho esperado em shared_item_prices (e do check de pack_* de onde vêm).
    const sql = readFileSync(path.join(__dirname, '../../../supabase/migrations/20261124181819_shared_prices_open.sql'), 'utf8');
    expect(sql).toContain(`(e.v -> 'p' ->> 'a')::numeric <= ${MAX_PACK_AMOUNT}`);
    expect(sql).toContain(`(e.v -> 'p' ->> 'o')::numeric between 2 and ${MAX_PACK_OF}`);
    expect(keyPackageSize('REFRI COCA COLA 1X2L')).toEqual({ unit: 'l', amount: 2, label: '2 L' });
    expect(keyPackageSize('CERV SKOL 2000X350ML')).toEqual({ unit: 'l', amount: 700, label: '700 L' });
    expect(keyPackageSize('ARROZ 200000KG')).toBeNull();
    expect(basePackSize({ unit: 'un', amount: 1, label: '1 un' })).toBeNull();
    expect(basePackSize({ unit: 'un', amount: 2.5, label: '2,5 un' })).toBeNull();
    expect(basePackSize({ unit: 'kg', amount: 0.0000001, label: '0 g' })).toBeNull();
    expect(basePackSize({ unit: 'l', amount: 4.2, label: '12 x 350 ml', of: 12 })).toEqual({ unit: 'l', amount: 4.2, label: '12 x 350 ml', of: 12 });
    expect(basePackSize(null)).toBeNull();
  });

  it('só o `mesmo`: o leite zero lactose não é o "Leite"; o integral, sim; o desnatado pedido não leva o integral', () => {
    expect(keyFit({ name: 'Leite', category: 'laticinios' }, 'LEITE INT ITALAC 1L')).toBe(true);
    expect(keyFit({ name: 'Leite', category: 'laticinios' }, 'LT INTEG PIRACANJUBA 1L')).toBe(true);
    expect(keyFit({ name: 'Leite', category: 'laticinios' }, 'LEITE ZERO LACTOSE ITALAC 1L')).toBe(false);
    expect(keyFit({ name: 'Leite desnatado', category: 'laticinios' }, 'LEITE DESN ITALAC 1L')).toBe(true);
    expect(keyFit({ name: 'Leite desnatado', category: 'laticinios' }, 'LEITE INT ITALAC 1L')).toBe(false);
  });

  it('a marca de outro produto (quebrado, tipo 2, cabra) fica de fora; o tipo 1 não marca', () => {
    expect([...otherProductMarks('ARROZ QUEBRADO 5KG')]).toEqual(['quebrado']);
    expect([...otherProductMarks('ARROZ T2 5KG')]).toEqual(['grau']);
    expect([...otherProductMarks('ARROZ TIPO 2 5KG')]).toEqual(['grau']);
    expect([...otherProductMarks('ARROZ 2A 5KG')]).toEqual(['grau']);
    expect([...otherProductMarks('QUEIJO TIPO MUSSARELA KG')]).toEqual(['tipo']);
    expect([...otherProductMarks('ARROZ TIPO 1 5KG')]).toEqual([]);
    expect([...otherProductMarks('ARROZ T1 TIO JOAO 5KG')]).toEqual([]);
    for (const description of ['ARROZ QUEBRADO 5KG', 'ARROZ T2 5KG', 'ARROZ TIPO 2 5KG']) {
      expect(keyFit({ name: 'Arroz', category: 'graos' }, description)).toBe(false);
    }
    expect(keyFit({ name: 'Leite', category: 'laticinios' }, 'LEITE CABRA 1L')).toBe(false);
    expect(keyFit({ name: 'Arroz', category: 'graos' }, 'ARROZ TIPO 1 CAMIL 5KG')).toBe(true);
  });

  it('a forma que a lista não diz fica de fora: "Café" não leva o solúvel nem o grão; o em pó, sim', () => {
    expect(keyFit({ name: 'Café', category: 'cafe_cha' }, 'CAFE SOLUVEL NESCAFE 100G')).toBe(false);
    expect(keyFit({ name: 'Café', category: 'cafe_cha' }, 'CAFE PILAO TORRADO MOIDO 500G')).toBe(true);
    expect(keyFit({ name: 'Café', category: 'cafe_cha' }, 'CAFE PILAO 500G')).toBe(true);
    expect(keyFit({ name: 'Café solúvel', category: 'cafe_cha' }, 'CAFE SOLUVEL NESCAFE 100G')).toBe(true);
  });

  it('o mineral como a nota abrevia: o óleo mineral não é "Óleo", com "MINERAL" ou "MIN"; a água mineral é a água', () => {
    expect([...otherProductMarks('OLEO MIN 100ML')]).toEqual(['mineral']);
    expect([...otherProductMarks('SAL MIN BOVINO 1KG')]).toEqual(['mineral']);
    expect([...otherProductMarks('AGUA MINERAL CRYSTAL 500ML')]).toEqual([]);
    expect([...otherProductMarks('AGUAS MINERAIS')]).toEqual([]);
    expect([...otherProductMarks('QUEIJO MIN FRESCAL KG')]).toEqual([]);
    for (const description of ['OLEO MINERAL 100ML', 'OLEO MIN 100ML']) expect(keyFit({ name: 'Óleo', category: 'oleos' }, description)).toBe(false);
    expect(keyFit({ name: 'Óleo', category: 'oleos' }, 'OLEO SOJA LIZA 900ML')).toBe(true);
    // A água de sempre, como a loja escrever: o mesmo veredito para as três.
    for (const description of ['AGUA MINERAL CRYSTAL 500ML', 'AGUA MIN CRYSTAL 500ML', 'AGUA CRYSTAL 500ML']) {
      expect(keyFit({ name: 'Água', category: 'bebidas' }, description)).toBe(true);
      expect(keyFit({ name: 'Água mineral', category: 'bebidas' }, description)).toBe(true);
    }
    // O "MIN" do queijo é o minas.
    expect(keyFit({ name: 'Queijo', category: 'laticinios' }, 'QUEIJO MIN FRESCAL KG')).toBe(true);
  });

  it('as marcas como a nota abrevia: "OLEO COMP", "QUEIJO RAL", "ARROZ QUEBR", "TP2" marcam como a palavra inteira', () => {
    const abbreviated: [string, string][] = [
      ['OLEO COMP MARIA 500ML', 'composto'],
      ['OLEO COMPOS 500ML', 'composto'],
      ['QUEIJO RAL 50G', 'ralado'],
      ['QJO RAL PARM 50G', 'ralado'],
      ['COCO RAL 100G', 'ralado'],
      ['CHOC GRAN 150G', 'granulado'],
      ['CHOC COB 1KG', 'cobertura'],
      ['ARROZ QUEBR 5KG', 'quebrado'],
      ['ARROZ QBR 5KG', 'quebrado'],
      ['LEITE CABR 1L', 'cabra'],
      ['LEITE CAB 1L', 'cabra'],
      ['FEIJAO VERM 1KG', 'vermelho'],
      ['MILHO COZ 200G', 'cozido'],
      ['FRANGO DESF 170G', 'desfiado'],
      ['TOMATE SEC 200G', 'seco'],
      ['BANANA DESID 100G', 'desidratado'],
      ['LEITE AMEND 1L', 'amendoa'],
      ['OLEO MINER 100ML', 'mineral'],
      ['ARROZ ARBOR 1KG', 'arborio'],
      ['MILHO VERDE CONSERV 200G', 'lata'],
    ];
    for (const [description, mark] of abbreviated) expect([description, [...otherProductMarks(description)]]).toEqual([description, [mark]]);
    // A segunda classificação colada ou com o ponto da nota ("T.2" vira "T 2").
    for (const description of ['ARROZ TIPO2 5KG', 'ARROZ TP2 5KG', 'ARROZ TP 2 5KG', 'ARROZ T 2 5KG', 'ARROZ TIPOII 5KG']) {
      expect([description, [...otherProductMarks(description)]]).toEqual([description, ['grau']]);
    }
    for (const description of ['ARROZ TIPO1 5KG', 'ARROZ TP1 5KG', 'ARROZ T 1 5KG']) expect([description, [...otherProductMarks(description)]]).toEqual([description, []]);
    // As que têm outra leitura só marcam depois da palavra certa: a cabeça de alho, os ovos grandes, a pasta de amendoim.
    for (const description of ['ALHO CAB', 'OVOS BRANCOS GRAN 12UN', 'ACUCAR GRAN 1KG', 'PASTA AMEND 500G', 'QUEIJO MIN FRESCAL KG']) {
      expect([description, [...otherProductMarks(description)]]).toEqual([description, []]);
    }
    // O feminino e o masculino são uma marca; a conserva e a calda são a lata.
    expect([...otherProductMarks('CARNE SECA')]).toEqual(['seco']);
    expect([...otherProductMarks('GOIABA EM CALDA 400G')]).toEqual(['lata']);
    expect([...otherProductMarks('PEPINO CONSERVA 300G')]).toEqual(['lata']);
    // Toda abreviação é de uma palavra da lista.
    for (const mark of new Set(ABBREVIATED_MARKS.values())) expect([mark, OTHER_PRODUCT_WORDS.has(mark)]).toEqual([mark, true]);
  });

  it('com a abreviação da nota, o outro produto fica de fora como por extenso; a lista que diz a palavra leva as duas', () => {
    const plain: [string, string | null, string[]][] = [
      ['Óleo', 'oleos', ['OLEO COMPOSTO GALLO 500ML', 'OLEO COMP MARIA 500ML', 'OLEO COMPOS 500ML']],
      ['Queijo', 'laticinios', ['QUEIJO RALADO 50G', 'QUEIJO RAL 50G', 'QJO RAL PARM 50G']],
      ['Chocolate', 'doces', ['CHOCOLATE GRANULADO 150G', 'CHOC GRAN 150G', 'CHOCOLATE COBERTURA 1KG', 'CHOC COB 1KG']],
      ['Arroz', 'graos', ['ARROZ QUEBRADO 5KG', 'ARROZ QUEBR 5KG', 'ARROZ QBR 5KG', 'ARROZ TIPO2 5KG', 'ARROZ TP2 5KG', 'ARROZ T 2 5KG']],
      ['Leite', 'laticinios', ['LEITE CABRA 1L', 'LEITE CABR 1L', 'LEITE CAB 1L']],
      ['Feijão', 'graos', ['FEIJAO VERMELHO 1KG', 'FEIJAO VERM 1KG', 'FEIJAO PRETO COZ 400G']],
      ['Milho', null, ['MILHO COZIDO 200G', 'MILHO COZ 200G']],
      ['Coco', null, ['COCO RALADO 100G', 'COCO RAL 100G']],
    ];
    for (const [name, category, descriptions] of plain) {
      for (const description of descriptions) expect([name, description, keyFit({ name, category }, description)]).toEqual([name, description, false]);
    }
    for (const [name, category, description] of [
      ['Óleo composto', 'oleos', 'OLEO COMP MARIA 500ML'],
      ['Chocolate granulado', 'doces', 'CHOC GRAN 150G'],
      ['Leite de cabra', 'laticinios', 'LEITE CAB 1L'],
      ['Arroz tipo 2', 'graos', 'ARROZ TP2 5KG'],
      ['Coco ralado', null, 'COCO RAL 100G'],
      ['Carne seca', 'carnes', 'CARNE SECA 500G'],
    ] as const) {
      expect([name, description, keyFit({ name, category }, description)]).toEqual([name, description, true]);
    }
    // O "VERM" depois de "FRUTAS", "CEBOLA" e "MACA" é o feminino, que por extenso não marca: a mesma descrição dá o
    // mesmo veredito abreviada ou por extenso. Depois de outra palavra (também uma marca no meio) é o vermelho.
    const feminine: [string, string | null, string, string][] = [
      ['Iogurte', 'laticinios', 'IOGURTE NESTLE FRUTAS VERMELHAS 170G', 'IOGURTE NESTLE FRUTAS VERM 170G'],
      ['Iogurte', 'laticinios', 'IOG NESTLE FRUTAS VERMELHAS 170G', 'IOG NESTLE FRUT VERM 170G'],
      ['Chá', 'cafe_cha', 'CHA LEAO FRUTAS VERMELHAS 10UN', 'CHA LEAO FRT VERM 10UN'],
      ['Suco', 'bebidas', 'SUCO DEL VALLE FRUTAS VERMELHAS 1L', 'SUCO DEL VALLE FRUTAS VERMEL 1L'],
      ['Gelatina', null, 'GELATINA ROYAL FRUTAS VERMELHAS 25G', 'GELATINA ROYAL FRUTAS VERMELH 25G'],
      ['Cebola', 'hortifruti', 'CEBOLA VERMELHA KG', 'CEBOLA VERM KG'],
      ['Maçã', 'hortifruti', 'MACA VERMELHA KG', 'MACA VERM KG'],
    ];
    for (const [name, category, whole, short] of feminine) {
      expect([name, whole, keyFit({ name, category }, whole)]).toEqual([name, whole, true]);
      expect([name, short, keyFit({ name, category }, short), [...otherProductMarks(short)]]).toEqual([name, short, true, []]);
    }
    for (const description of ['FEIJAO VERM 1KG', 'FEIJAO CAMIL VERM 1KG', 'ARROZ VERM 1KG', 'PIMENTAO VERM KG']) {
      expect([description, [...otherProductMarks(description)]]).toEqual([description, ['vermelho']]);
    }
    expect(keyFit({ name: 'Feijão', category: 'graos' }, 'FEIJAO CAMIL VERM 1KG')).toBe(false);
    // O feminino é o masculino (MARK_OF): "Arroz quebrado" leva "ARROZ QUEBRADA", como o "ARROZ QUEBR" abreviado.
    expect(keyFit({ name: 'Arroz quebrado', category: 'graos' }, 'ARROZ QUEBRADA 1KG')).toBe(true);
    expect(keyFit({ name: 'Arroz quebrado', category: 'graos' }, 'ARROZ QUEBR 1KG')).toBe(true);
    // A marca só decide entre nomes que já são o mesmo item: o leitor lê "CARNE SEC" como a carne fresca, então nem a
    // "Carne seca" (outro item) nem a "Carne" (a marca de "seca") o levam.
    expect(keyFit({ name: 'Carne seca', category: 'carnes' }, 'CARNE SEC 500G')).toBe(false);
    expect(keyFit({ name: 'Carne', category: 'carnes' }, 'CARNE SEC 500G')).toBe(false);
    // O que não é abreviação de marca continua: o alho em cabeça, os ovos grandes.
    expect(keyFit({ name: 'Alho', category: 'hortifruti' }, 'ALHO CAB')).toBe(true);
    expect(keyFit({ name: 'Ovos', category: 'ovos' }, 'OVOS BRANCOS GRAN 12UN')).toBe(true);
  });

  it('a lata é só a embalagem onde o item quase sempre vem nela; em todo outro item, a lata, a conserva e a calda são outro produto', () => {
    expect([...CAN_IS_THE_PACKAGE].sort()).toEqual([
      'achocolatado', 'agua+tonica', 'atum', 'azeite', 'cerveja', 'creme_leite', 'doce_leite', 'extrato_tomate', 'fermento',
      'leite+po', 'leite_condensado', 'molho_tomate', 'oleo', 'polpa_tomate', 'refrigerante', 'sardinha', 'suco', 'tomate_pelado',
    ]);
    expect([...LT_IS_THE_CAN].sort()).toEqual(['abacaxi', 'carne', 'feijao', 'frango', 'goiaba', 'milho', 'salsicha', 'tomate']);
    for (const description of ['FEIJAO CARIOCA LATA 400G', 'FEIJAO CARIOCA LT 400G', 'FEIJAO EM LATA 400G']) {
      expect(keyFit({ name: 'Feijão', category: 'graos' }, description)).toBe(false);
    }
    for (const description of ['MILHO VERDE LATA QUERO 170G', 'MILHO VERDE LT QUERO 170G', 'MILHO VERDE CONSERVA 200G']) {
      expect(keyFit({ name: 'Milho', category: null }, description)).toBe(false);
      // A lista que diz a lata (ou a conserva) leva as três.
      expect(keyFit({ name: 'Milho verde lata', category: null }, description)).toBe(true);
      expect(keyFit({ name: 'Milho em conserva', category: null }, description)).toBe(true);
    }
    expect(keyFit({ name: 'Feijão', category: 'graos' }, 'FEIJAO CARIOCA CAMIL 1KG')).toBe(true);
    // A carne, o frango, a salsicha e a fruta frescos: a forma em lata, em conserva ou em calda é outro produto, como o
    // chá mate em lata para "Chá" e o café em lata para "Café" (na dúvida, fica de fora).
    const fresh: [string, string | null, string[]][] = [
      ['Frango', 'carnes', ['FRANGO DESFIADO LATA', 'FRANGO DESFIADO LATA 170G', 'FRANGO DESF LT 170G']],
      ['Carne', 'carnes', ['CARNE BOVINA LATA', 'CARNE BOVINA LATA 320G', 'CARNE BOVINA CONSERVA 320G']],
      ['Carne moída', 'carnes', ['CARNE MOIDA LATA 320G']],
      ['Salsicha', null, ['SALSICHA VIENA LATA 180G', 'SALSICHA VIENA LT 180G']],
      ['Goiaba', null, ['GOIABA EM CALDA LATA', 'GOIABA EM CALDA 400G']],
      ['Abacaxi', null, ['ABACAXI EM CALDA 400G']],
      ['Pepino', null, ['PEPINO CONSERVA 300G']],
      ['Presunto', 'frios', ['PRESUNTO LATA']],
      ['Chá', 'cafe_cha', ['CHA MATE LEAO LATA 340ML']],
      ['Café', 'cafe_cha', ['CAFE PILAO LATA 400G']],
    ];
    for (const [name, category, descriptions] of fresh) {
      for (const description of descriptions) expect([name, description, keyFit({ name, category }, description)]).toEqual([name, description, false]);
    }
    expect(keyFit({ name: 'Frango', category: 'carnes' }, 'FRANGO INTEIRO')).toBe(true);
    expect(keyFit({ name: 'Goiaba em calda', category: null }, 'GOIABA LATA 400G')).toBe(true);
    // Onde a lata é a embalagem, "LATA", "LT", a conserva e a calda dão o mesmo veredito.
    const asPackage: [string, string | null, string[]][] = [
      ['Cerveja', 'alcoolicas', ['CERVEJA SKOL LATA 350ML', 'CERV SKOL LT 350ML']],
      ['Refrigerante', 'bebidas', ['REFRI COCA COLA LATA 350ML', 'REFRI COCA COLA LT 350ML']],
      ['Atum', 'peixes', ['ATUM GOMES DA COSTA LATA 170G', 'ATUM GOMES DA COSTA LT 170G', 'ATUM CONSERVA 170G']],
      ['Sardinha', 'peixes', ['SARDINHA COQUEIRO LATA 125G', 'SARDINHA CONSERVA 125G']],
      ['Leite condensado', 'laticinios', ['LEITE COND MOCA LATA 395G', 'LEITE COND MOCA LT 395G']],
      ['Creme de leite', 'laticinios', ['CREME LEITE NESTLE LATA 300G']],
      ['Leite em pó', 'laticinios', ['LEITE PO NINHO LATA 400G']],
      ['Achocolatado', null, ['ACHOC NESCAU LATA 400G']],
      ['Óleo', 'oleos', ['OLEO SOJA LIZA LATA 900ML']],
      ['Azeite', 'oleos', ['AZEITE GALLO LATA 500ML']],
      ['Extrato de tomate', null, ['EXTRATO TOMATE ELEFANTE LATA 340G']],
      // O tomate pelado quase sempre vem em lata: "LATA" e "LT" ficam no grupo, como a descrição sem a lata.
      ['Tomate pelado', null, ['TOMATE PELADO LATA 400G', 'TOMATE PELADO LT 400G', 'TOMATE PELADO CONSERVA 400G', 'TOMATE PELADO ARCO BELLO 400G']],
    ];
    for (const [name, category, descriptions] of asPackage) {
      for (const description of descriptions) expect([name, description, keyFit({ name, category }, description)]).toEqual([name, description, true]);
    }
    // O "LT" do leite e do chocolate ao leite não é lata.
    expect(keyFit({ name: 'Leite', category: 'laticinios' }, 'LEITE INTEGRAL LT 1L')).toBe(true);
    expect(keyFit({ name: 'Chocolate', category: 'doces' }, 'CHOC AO LT NESTLE 90G')).toBe(true);
  });

  it('o cozido é o de sempre no presunto, no peito de peru e na mortadela; o cru é outro produto do presunto, nos dois sentidos', () => {
    expect([...COOKED_IS_THE_USUAL].sort()).toEqual(['mortadela', 'peito_peru', 'presunto']);
    expect([...CURED_HAM_WORDS].sort()).toEqual(['cru', 'crua', 'iberico', 'jamon', 'parma', 'serrano']);
    // A nota imprime o presunto de sempre como "PRES COZ" ou "PRESUNTO COZ": é ele, abreviado ou por extenso.
    const cooked = ['PRES COZ SADIA KG', 'PRESUNTO COZ PERDIGAO FAT KG', 'PRESUNTO COZIDO PERDIGAO KG', 'PRES SADIA FAT KG', 'PRESUNTO SADIA COZ FAT'];
    const cured = ['PRESUNTO PARMA FAT KG', 'PRESUNTO CRU FAT KG', 'PRESUNTO SERRANO FAT', 'PRES CRU KG', 'PRESUNTO TIPO PARMA KG'];
    for (const name of ['Presunto', 'Presunto cozido']) {
      for (const description of cooked) expect([name, description, keyFit({ name, category: 'frios' }, description)]).toEqual([name, description, true]);
      for (const description of cured) expect([name, description, keyFit({ name, category: 'frios' }, description)]).toEqual([name, description, false]);
    }
    // A lista que pede o cru leva o cru e não leva o cozido, que daria um preço de outro produto, bem mais barato.
    for (const name of ['Presunto parma', 'Presunto cru', 'Presunto serrano']) {
      for (const description of ['PRESUNTO PARMA FAT KG', 'PRESUNTO CRU FAT KG', 'PRESUNTO SERRANO FAT']) {
        expect([name, description, keyFit({ name, category: 'frios' }, description)]).toEqual([name, description, true]);
      }
      for (const description of cooked) expect([name, description, keyFit({ name, category: 'frios' }, description)]).toEqual([name, description, false]);
    }
    for (const [name, description] of [
      ['Peito de peru', 'PEITO PERU DEFUM COZ'],
      ['Peito de peru', 'PEITO DE PERU COZIDO SADIA'],
      ['Peito de peru', 'PEITO PERU SADIA'],
      ['Mortadela', 'MORTADELA COZ'],
    ] as const) {
      expect([name, description, keyFit({ name, category: 'frios' }, description)]).toEqual([name, description, true]);
    }
    // O cozido continua outro produto na comida que não vem cozida.
    expect(keyFit({ name: 'Milho', category: null }, 'MILHO COZ 200G')).toBe(false);
    expect(keyFit({ name: 'Feijão', category: 'graos' }, 'FEIJAO PRETO COZ 400G')).toBe(false);
    expect(keyFit({ name: 'Lombo', category: 'carnes' }, 'LOMBO SUINO COZ')).toBe(false);
    expect(keyFit({ name: 'Camarão', category: 'peixes' }, 'CAMARAO COZ')).toBe(false);
    // O cru só é marca para o presunto: o camarão cru é o camarão.
    expect(keyFit({ name: 'Camarão', category: 'peixes' }, 'CAMARAO CRU')).toBe(true);
  });

  it('em item de casa o "COZ" é a cozinha: o papel toalha e o detergente de cozinha são o papel toalha e o detergente', () => {
    expect([...otherProductMarks('PAPEL TOALHA COZ SNOB')]).toEqual(['cozido']);
    for (const [name, category, description] of [
      ['Papel toalha', 'papel', 'PAPEL TOALHA COZ SNOB'],
      ['Papel toalha', null, 'PAPEL TOALHA COZ SNOB'],
      ['Papel toalha', 'papel', 'PAP TOALHA COZINHA SNOB'],
      ['Detergente', 'limpeza', 'DETERG COZ'],
    ] as const) {
      expect([name, description, keyFit({ name, category }, description)]).toEqual([name, description, true]);
    }
  });
});

describe('os grupos: as descrições e o tamanho de cada item', () => {
  it('só o mesmo item entra no grupo', () => {
    const { groups } = answered([item('l', 'Leite', 'laticinios')], () => [key('LEITE INT ITALAC 1L'), key('LEITE ZERO LACTOSE ITALAC 1L')]);
    expect(groupOf(groups, 'l')?.keys).toEqual(['LEITE INT ITALAC 1L']);
  });

  it('o outro produto abreviado não vira o pacote do grupo: o óleo composto, o arroz quebrado, o queijo ralado, o frango em lata', () => {
    // "Óleo" 1 l: o composto (por extenso ou abreviado) fica de fora, e o pacote é o de soja.
    const oil = answered([item('o', 'Óleo', 'oleos', 1, 'l')], () => [
      key('OLEO SOJA LIZA 900ML', 'un', 10),
      key('OLEO COMP MARIA 500ML', 'un', 3),
      key('OLEO COMPOSTO GALLO 500ML', 'un', 1),
    ]).groups;
    expect(groupOf(oil, 'o')).toMatchObject({ keys: ['OLEO SOJA LIZA 900ML'], expected: { unit: 'l', amount: 0.9 } });
    // "Arroz": o 5 kg quebrado ou de tipo 2 não entra no grupo do 5 kg.
    const rice = answered([item('a', 'Arroz', 'graos')], () => [key('ARROZ TIO JOAO 5KG', 'un', 2), key('ARROZ QUEBR 5KG', 'un', 2), key('ARROZ TP2 5KG', 'un', 2)]).groups;
    expect(groupOf(rice, 'a')?.keys).toEqual(['ARROZ TIO JOAO 5KG']);
    // "Queijo" 500 g: o parmesão ralado em sachê não é o preço do quilo de queijo.
    const cheese = answered([item('q', 'Queijo', 'laticinios', 500, 'g')], () => [key('QUEIJO RAL PARM 50G', 'un', 4), key('QJO RAL PARM 50G', 'un', 2)]).groups;
    expect(groupOf(cheese, 'q')).toBeUndefined();
    // "Frango" 1 kg: a lata de 170 g não é o pacote do preço por kg; fica o frango vendido a peso.
    const chicken = answered([item('f', 'Frango', 'carnes', 1, 'kg')], () => [key('FRANGO DESFIADO LATA 170G', 'un', 5), key('FRANGO INTEIRO', 'kg', 1)]).groups;
    expect(groupOf(chicken, 'f')).toMatchObject({ keys: [], weightOnly: ['FRANGO INTEIRO'], expected: null });
    expect(entryOf(chicken, 'f')?.perBase).toBeNull();
  });

  it('"Presunto" 1 kg: o cozido da nota ("PRES COZ", "PRESUNTO COZIDO") fica no grupo e o parma não entra', () => {
    // O banco dá, em cada mercado, a linha mais barata do grupo: com o parma no grupo e o cozido fora, o preço de
    // "Presunto" seria o do parma.
    const keys = [key('PRES COZ SADIA KG', 'kg', 5), key('PRESUNTO COZIDO PERDIGAO KG', 'kg', 3), key('PRESUNTO PARMA FAT KG', 'kg', 1)];
    const ham = answered([item('p', 'Presunto', 'frios', 1, 'kg')], () => keys).groups;
    expect(groupOf(ham, 'p')).toMatchObject({ keys: [], weightOnly: ['PRES COZ SADIA KG', 'PRESUNTO COZIDO PERDIGAO KG'] });
    // A lista que pede o parma fica só com ele.
    const parma = answered([item('p', 'Presunto parma', 'frios', 1, 'kg')], () => keys).groups;
    expect(groupOf(parma, 'p')).toMatchObject({ keys: [], weightOnly: ['PRESUNTO PARMA FAT KG'] });
  });

  it('a lata e a caixa de 12: "Cerveja lata 350ml" não leva a caixa; "Cerveja" leva os dois tamanhos e fica com o mais visto', () => {
    const keys = [key('CERV SKOL LT 350ML C 12', 'un', 3), key('CERV SKOL LT 350ML', 'un', 1)];
    const can = answered([item('c', 'Cerveja lata 350ml', 'alcoolicas')], () => keys).groups;
    expect(groupOf(can, 'c')?.keys).toEqual(['CERV SKOL LT 350ML']);
    expect(entryOf(can, 'c')).toMatchObject({ size: null, sizeBy: null });
    const any = answered([item('c', 'Cerveja', 'alcoolicas')], () => keys).groups;
    expect(groupOf(any, 'c')?.keys).toEqual(['CERV SKOL LT 350ML C 12']);
    expect(entryOf(any, 'c')).toMatchObject({ size: '12 x 350 ml', sizeBy: 'most' });
  });

  it('ovos de 12 e de 30: "Ovos" fica com a cartela mais vista, com quantos vêm; "Ovos (dúzia)", só com as de 12', () => {
    const keys = [key('OVOS BRANCOS C 12', 'un', 1), key('OVOS VERMELHOS C 30', 'un', 1), key('OVOS BRANCOS C 30', 'un', 2)];
    const { groups } = answered([item('o', 'Ovos', 'ovos', 12), item('d', 'Ovos (dúzia)', 'ovos')], () => keys);
    expect(groupOf(groups, 'o')?.keys).toEqual(['OVOS BRANCOS C 30']);
    expect(entryOf(groups, 'o')).toMatchObject({ size: '30 un', sizeBy: 'most', pack: { unit: 'un', amount: 30 } });
    expect(groupOf(groups, 'd')?.keys).toEqual(['OVOS BRANCOS C 12']);
    // A lista disse o tamanho: nada a dizer nos detalhes.
    expect(entryOf(groups, 'd')).toMatchObject({ size: null, sizeBy: null, pack: { unit: 'un', amount: 12 } });
  });

  it('o tamanho da lista ("Arroz 5kg") só leva as de 5 kg', () => {
    const { groups } = answered([item('a', 'Arroz 5kg', 'graos')], () => [key('ARROZ CAMIL 5KG'), key('ARROZ T1 TIO JOAO 5KG'), key('ARROZ CAMIL 1KG', 'un', 9)]);
    expect(groupOf(groups, 'a')?.keys).toEqual(['ARROZ CAMIL 5KG', 'ARROZ T1 TIO JOAO 5KG']);
    expect(groupOf(groups, 'a')?.expected).toEqual({ unit: 'kg', amount: 5, label: '5 kg' });
  });

  it('o tamanho mais visto pela soma das vezes; no empate, o menor e "um dos mais vistos"', () => {
    const most = answered([item('a', 'Arroz', 'graos')], () => [key('ARROZ CAMIL 5KG', 'un', 2), key('ARROZ PRATO FINO 5KG', 'un', 2), key('ARROZ CAMIL 1KG', 'un', 3)]).groups;
    expect(entryOf(most, 'a')).toMatchObject({ size: '5 kg', sizeBy: 'most' });
    const tie = answered([item('a', 'Arroz', 'graos')], () => [key('ARROZ CAMIL 5KG', 'un', 2), key('ARROZ CAMIL 1KG', 'un', 2)]).groups;
    expect(entryOf(tie, 'a')).toMatchObject({ size: '1 kg', sizeBy: 'tie' });
    const only = answered([item('a', 'Arroz', 'graos')], () => [key('ARROZ CAMIL 5KG', 'un', 2)]).groups;
    expect(entryOf(only, 'a')).toMatchObject({ size: '5 kg', sizeBy: 'only' });
  });

  it('a granel sempre entra; a sem tamanho sai ao lado de um tamanho, e entra quando nenhuma diz', () => {
    const sized = answered([item('a', 'Arroz', 'graos')], () => [key('ARROZ CAMIL 5KG'), key('ARROZ SEM TAMANHO'), key('ARROZ GRANEL', 'kg')]).groups;
    expect(groupOf(sized, 'a')).toMatchObject({ keys: ['ARROZ CAMIL 5KG'], weightOnly: ['ARROZ GRANEL'] });
    const unsized = answered([item('a', 'Arroz', 'graos')], () => [key('ARROZ SEM TAMANHO'), key('ARROZ GRANEL', 'kg')]).groups;
    expect(groupOf(unsized, 'a')).toMatchObject({ keys: ['ARROZ SEM TAMANHO'], weightOnly: ['ARROZ GRANEL'], expected: null });
  });

  it('pedido em kg: o pacote igual; senão, o que cumpre em pacotes inteiros; senão, o mais visto, pelo preço por kg', () => {
    const fiveOnly = answered([item('a', 'Arroz', 'graos', 2, 'kg')], () => [key('ARROZ CAMIL 5KG', 'un', 4)]).groups;
    expect(entryOf(fiveOnly, 'a')).toMatchObject({ size: null, sizeBy: null, perBase: { unit: 'kg', amount: 5, label: '5 kg', packages: null } });
    const both = [key('ARROZ CAMIL 1KG', 'un', 9), key('ARROZ CAMIL 5KG', 'un', 1)];
    expect(entryOf(answered([item('a', 'Arroz', 'graos', 5, 'kg')], () => both).groups, 'a')?.perBase).toEqual({
      unit: 'kg',
      amount: 5,
      label: '5 kg',
      packages: 1,
    });
    expect(entryOf(answered([item('a', 'Arroz', 'graos', 2, 'kg')], () => both).groups, 'a')?.perBase).toEqual({
      unit: 'kg',
      amount: 1,
      label: '1 kg',
      packages: 2,
    });
    // Em gramas também (500 g são meio pacote de 1 kg, mas cabem em um de 500 g).
    const grams = answered([item('a', 'Arroz', 'graos', 500, 'g')], () => [key('ARROZ CAMIL 1KG', 'un', 5), key('ARROZ CAMIL 500G', 'un', 1)]).groups;
    expect(entryOf(grams, 'a')?.perBase).toEqual({ unit: 'kg', amount: 0.5, label: '500 g', packages: 1 });
  });

  it('dois itens com as mesmas descrições e o mesmo tamanho dividem um grupo, cada um com o seu jeito de contar', () => {
    const { groups } = answered([item('a', 'Arroz 5kg', 'graos'), item('b', 'Arroz', 'graos')], () => [key('ARROZ CAMIL 5KG')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toEqual([
      expect.objectContaining({ id: 'a', size: null, sizeBy: null }),
      expect.objectContaining({ id: 'b', size: '5 kg', sizeBy: 'only' }),
    ]);
  });

  it('"1 x 2 L" é 2 L: o refrigerante vai ao banco sem o "1 x", e junto do "2L" (o banco recusaria a chamada toda)', () => {
    const keys = [key('REFRI COCA COLA 1X2L', 'un', 10), key('REFRI GUARANA ANTARCTICA 2L', 'un', 3)];
    const any = answered([item('r', 'Refrigerante', 'bebidas')], () => keys).groups;
    expect(groupOf(any, 'r')?.keys).toEqual(['REFRI COCA COLA 1X2L', 'REFRI GUARANA ANTARCTICA 2L']);
    expect(entryOf(any, 'r')).toMatchObject({ size: '2 L', sizeBy: 'only' });
    expect(openGroupArgument(groupOf(any, 'r')!)).toEqual({ k: ['REFRI COCA COLA 1X2L', 'REFRI GUARANA ANTARCTICA 2L'], p: { u: 'l', a: 2 } });
    const said = answered([item('r', 'Refrigerante 1x2L', 'bebidas')], () => keys).groups;
    expect(groupOf(said, 'r')?.expected).toEqual({ unit: 'l', amount: 2, label: '2 L' });
    expect(openGroupArgument(groupOf(said, 'r')!).p).toEqual({ u: 'l', a: 2 });
  });

  it('todo grupo vai ao banco numa forma que ele aceita, venha o tamanho da chave ou da lista', () => {
    const descriptions = [
      'REFRI COCA COLA 1X2L', 'REFRI COCA COLA 2L', 'REFRI COCA COLA 2000X350ML', 'REFRI COCA COLA LT 350ML C 12', 'REFRI COCA COLA 6X2L',
      'CERV SKOL 1X350ML', 'CERV SKOL 2000X350ML', 'CERV SKOL LT 350ML C 12', 'CERV SKOL LT 350ML', 'CERV SKOL 1001X350ML',
      'OVOS BRANCOS C 30', 'OVOS BRANCOS C 1', 'OVOS BRANCOS 1500 UN', 'OVOS BRANCOS 200000 UN', 'OVOS BRANCOS C 12',
      'ARROZ CAMIL 5KG', 'ARROZ CAMIL 200000KG', 'ARROZ CAMIL 1X5KG', 'ARROZ CAMIL 2X5KG', 'ARROZ GRANEL',
      'LEITE INT ITALAC 1L', 'LEITE INT ITALAC 1X1L', 'LEITE INT ITALAC 12X1L', 'LEITE INT ITALAC 1200X1L',
    ];
    const units: SharedItemKey['unit'][] = ['un', 'kg', 'l'];
    const keys = descriptions.flatMap((description, n) => units.map((unit) => key(description, unit, 1 + (n % 4))));
    const names = [
      'Refrigerante', 'Refrigerante 1x2L', 'Refrigerante 2000x350ml', 'Cerveja', 'Cerveja 1x350ml', 'Cerveja 1001x350ml', 'Ovos',
      'Ovos 1 un', 'Ovos (dúzia)', 'Ovos 200000 un', 'Arroz', 'Arroz 1x5kg', 'Arroz 200000kg', 'Leite', 'Leite 1x1l', 'Leite 1200x1l',
    ];
    const items = names.flatMap((name, n) =>
      ([['un', 1], ['kg', 2], ['g', 500], ['l', 1], ['ml', 700]] as const).map(([unit, quantity]) => item(`${n}-${unit}`, name, null, quantity, unit)),
    );
    const { groups } = answered(items, () => keys);
    expect(groups.length).toBeGreaterThan(10);
    for (const group of groups) expect([group.signature, serverAccepts(openGroupArgument(group))]).toEqual([group.signature, true]);
    expect(serverAccepts({ k: ['A'], p: { u: 'l', a: 2, o: 1 } })).toBe(false);
  });

  it('a descrição vista a peso e por unidade: a peso ela entra, e a linha por unidade que o app não escolheu fica no banco', () => {
    const garlic = [key('ALHO', 'kg', 3), key('ALHO', 'un', 2), key('ALHO 200G', 'un', 1)];
    const kilo = answered([item('a', 'Alho', 'hortifruti', 0.5, 'kg')], () => garlic).groups;
    const group = groupOf(kilo, 'a')!;
    expect(group).toMatchObject({ keys: ['ALHO 200G'], weightOnly: ['ALHO'], expected: { unit: 'kg', amount: 0.2 } });
    expect(openGroupArgument(group)).toEqual({ k: ['ALHO 200G'], w: ['ALHO'], p: { u: 'kg', a: 0.2 } });
    const lemons = [key('LIMAO TAHITI', 'kg', 4), key('LIMAO TAHITI', 'un', 1), key('LIMAO TAHITI 500G', 'un', 2)];
    const piece = groupOf(answered([item('l', 'Limão', 'hortifruti')], () => lemons).groups, 'l')!;
    expect(piece).toMatchObject({ keys: ['LIMAO TAHITI 500G'], weightOnly: ['LIMAO TAHITI'] });
    // Sem tamanho nenhum por unidade, a solta é a escolhida, e a mesma descrição vale em toda unidade.
    const loose = groupOf(answered([item('l', 'Limão', 'hortifruti')], () => lemons.slice(0, 2)).groups, 'l')!;
    expect(loose).toMatchObject({ keys: ['LIMAO TAHITI'], weightOnly: [], expected: null });
    // Só a peso: o grupo vai sem chave por unidade e sem tamanho esperado.
    const weightOnly = groupOf(answered([item('a', 'Alho', 'hortifruti', 0.5, 'kg')], () => [key('ALHO', 'kg', 3), key('ALHO', 'un', 2)]).groups, 'a')!;
    expect(openGroupArgument(weightOnly)).toEqual({ k: [], w: ['ALHO'] });
  });

  it('em chamadas de 40 grupos; o que vai ao banco são as chaves e o tamanho esperado', () => {
    const groups: OpenGroup[] = Array.from({ length: 90 }, (_, n) => ({
      signature: `K${String(n).padStart(3, '0')}`,
      keys: [`K${n}`],
      weightOnly: [],
      expected: null,
      items: [],
    }));
    expect(openGroupCalls([...groups].reverse()).map((call) => call.length)).toEqual([40, 40, 10]);
    expect(openGroupCalls(groups)[0][0].signature).toBe('K000');
    expect(openGroupArgument({ signature: 's', keys: ['A'], weightOnly: [], expected: null, items: [] })).toEqual({ k: ['A'] });
    expect(
      openGroupArgument({ signature: 's', keys: ['A'], weightOnly: [], expected: { unit: 'l', amount: 4.2, label: '12 x 350 ml', of: 12 }, items: [] }),
    ).toEqual({ k: ['A'], p: { u: 'l', a: 4.2, o: 12 } });
    expect(openGroupArgument({ signature: 's', keys: ['A'], weightOnly: ['B'], expected: null, items: [] })).toEqual({ k: ['A'], w: ['B'] });
  });

  it('refazer a conta não pergunta de novo ao leitor do item: o veredito fica guardado', () => {
    const items = Array.from({ length: 30 }, (_, n) => item(`i${n}`, ['Leite', 'Arroz', 'Café', 'Feijão', 'Açúcar'][n % 5], null, n + 1));
    const keysFor = (one: OpenSearchItem) =>
      Array.from({ length: OPEN_KEYS_PER_ENTRY }, (_, n) => key(`${one.name.toUpperCase().normalize('NFD').replace(/[^A-Z ]/g, '')} MARCA${n} ${n + 1}KG`));
    const started = Date.now();
    const first = answered(items, keysFor);
    expect(Date.now() - started).toBeLessThan(5000);
    const spy = jest.spyOn(sameItem, 'sameItemFit');
    const again = openGroups(items, first.answers, first.plan);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(again.map((group) => group.signature)).toEqual(first.groups.map((group) => group.signature));
  });
});

describe('os preços (passo 2)', () => {
  const STORES = [
    { id: 'meu', cnpj: '11222333000181', name: 'Atacadão da esquina' },
    { id: 'outro-cadastro', cnpj: '11222333000181', name: 'Atacadão (outro)' },
  ];
  const row = (group: number, store_cnpj: string, unit_price: number, partial: Partial<SharedItemPrice> = {}): SharedItemPrice => ({
    group,
    store_cnpj,
    store_name: 'ATACADAO S.A.',
    store_uf: '35',
    unit: 'un',
    unit_price,
    seen_on: '2026-11-09',
    mine: false,
    ...partial,
  });
  const answerFor = (groups: OpenGroup[], rows: SharedItemPrice[]): OpenPricesAnswer => ({ groups: groups.map((group) => group.signature), rows });

  it('a resposta conferida: 8 ou 11 campos; a linha fora da forma sai; uma resposta que não é lista é erro', () => {
    const groups = answered([item('a', 'Arroz', 'graos')], () => [key('ARROZ CAMIL 5KG')]).groups;
    const parsed = parseSharedItemPrices(
      [
        [0, '11222333000181', 'ATACADAO', '35', 'un', 22.9, '2026-11-12', false],
        [0, '11222333000181', 'ATACADAO', '35', 'un', 22.9, '2026-11-09', true, 'kg', 5, null],
        [1, '11222333000181', 'ATACADAO', '35', 'un', 22.9, '2026-11-09', false],
        [0, '1122', 'ATACADAO', '35', 'un', 22.9, '2026-11-09', false],
        [0, '11222333000181', 'ATACADAO', '35', 'un', 0, '2026-11-09', false],
      ],
      groups,
    );
    expect(parsed.groups).toEqual([groups[0].signature]);
    expect(parsed.rows).toEqual([
      // O banco de antes que devolva o dia: a segunda-feira dele.
      row(0, '11222333000181', 22.9, { store_name: 'ATACADAO', seen_on: '2026-11-09' }),
      row(0, '11222333000181', 22.9, { store_name: 'ATACADAO', mine: true, pack_unit: 'kg', pack_amount: 5, pack_of: null }),
    ]);
    expect(() => parseSharedItemPrices({}, groups)).toThrow();
  });

  it('pelo CNPJ: o mercado da casa com o nome dela (os dois cadastros); o "da casa" que ela não tem mais sai; o de fora sem mercado', () => {
    const { groups } = answered([item('a', 'Arroz', 'graos')], () => [key('ARROZ CAMIL 5KG')]);
    const quotes = openQuotes(
      [answerFor(groups, [row(0, '11222333000181', 22.9, { mine: true }), row(0, '99888777000166', 21.5), row(0, '55444333000122', 20, { mine: true })])],
      groups,
      STORES,
    );
    expect(quotes.get('a')).toEqual([
      expect.objectContaining({ storeId: 'meu', storeName: 'Atacadão da esquina', productId: null, unitPrice: 22.9, seenWeek: '2026-11-09' }),
      expect.objectContaining({ storeId: 'outro-cadastro', storeName: 'Atacadão da esquina', productId: null }),
      expect.objectContaining({ storeId: null, storeCnpj: '99888777000166', state: 'SP', unitPrice: 21.5 }),
    ]);
    expect(quotes.get('a')?.[0].open).toEqual({ size: '5 kg', sizeBy: 'only', fromPackage: null, packages: null });
    expect(quotes.get('a')?.[0].pack).toEqual({ unit: 'kg', amount: 5, label: '5 kg' });
  });

  it('por g vira por kg; o pacote do item pedido em kg vira preço por kg', () => {
    const grams = answered([item('q', 'Banana', 'hortifruti')], () => [key('BANANA PRATA', 'g')]).groups;
    const [quote] = openQuotes([answerFor(grams, [row(0, '99888777000166', 0.0499, { unit: 'g' })])], grams, STORES).get('q')!;
    expect(quote).toMatchObject({ unit: 'kg', unitPrice: 49.9, open: { size: null, sizeBy: null, fromPackage: null, packages: null } });
    const kilo = answered([item('a', 'Arroz', 'graos', 2, 'kg')], () => [key('ARROZ CAMIL 5KG')]).groups;
    const [perKg] = openQuotes([answerFor(kilo, [row(0, '99888777000166', 24.9)])], kilo, STORES).get('a')!;
    expect(perKg).toMatchObject({ unit: 'kg', unitPrice: 4.98, open: { size: null, sizeBy: null, fromPackage: '5 kg', packages: null } });
  });

  it('uma resposta só chega ao grupo de agora pela assinatura dele: a de outra lista (ou de antes) nunca põe preço em outro item', () => {
    const { groups } = answered([item('a', 'Arroz', 'graos')], () => [key('ARROZ CAMIL 5KG')]);
    const stale: OpenPricesAnswer = { groups: ['OUTRA LISTA'], rows: [row(0, '99888777000166', 1)] };
    expect(openQuotes([stale], groups, STORES).get('a')).toBeUndefined();
  });

  it('duas listas com as mesmas descrições dividem a resposta, cada item com o seu', () => {
    const first = answered([item('x', 'Arroz', 'graos')], () => [key('ARROZ CAMIL 5KG')]).groups;
    const second = answered([item('y', 'Arroz', 'graos')], () => [key('ARROZ CAMIL 5KG')]).groups;
    expect(second[0].signature).toBe(first[0].signature);
    const answer = answerFor(first, [row(0, '99888777000166', 21.5)]);
    expect(openQuotes([answer], second, STORES).get('y')).toEqual([expect.objectContaining({ unitPrice: 21.5 })]);
  });

  it('um mercado e unidade: a semana mais nova; na mesma semana, a mais barata', () => {
    const { groups } = answered([item('a', 'Arroz', 'graos')], () => [key('ARROZ CAMIL 5KG'), key('ARROZ TIO JOAO 5KG')]);
    const quotes = openQuotes(
      [
        answerFor(groups, [
          row(0, '99888777000166', 20, { seen_on: '2026-11-02' }),
          row(0, '99888777000166', 23, { seen_on: '2026-11-09' }),
          row(0, '99888777000166', 22, { seen_on: '2026-11-09' }),
        ]),
      ],
      groups,
      STORES,
    );
    expect(quotes.get('a')?.map((quote) => quote.unitPrice)).toEqual([22]);
  });

  it('a linha por unidade sem o tamanho lido sai só quando está muito acima das outras (o fardo com a descrição da lata)', () => {
    const can = answered([item('c', 'Cerveja', 'alcoolicas')], () => [key('CERV SKOL LT 350ML', 'un', 3)]).groups;
    const at = (rows: SharedItemPrice[]) => openQuotes([answerFor(can, rows)], can, STORES).get('c')?.map((quote) => `${quote.storeCnpj} ${quote.unitPrice}`);
    const sized = { pack_unit: 'l', pack_amount: 0.35, pack_of: null };
    // O fardo do B ao lado das latas do A (tamanho lido) e do C (sem tamanho): sai.
    expect(at([row(0, '64000000000201', 3.49, sized), row(0, '64000000000202', 39.9), row(0, '64000000000203', 3.59)])).toEqual([
      '64000000000201 3.49',
      '64000000000203 3.59',
    ]);
    // Ao lado de uma lata só: sai também.
    expect(at([row(0, '64000000000201', 3.49, sized), row(0, '64000000000202', 39.9)])).toEqual(['64000000000201 3.49']);
    // Duas sem tamanho e sem acordo: fica a mais barata (o fardo é sempre o mais caro), e o item não fica sem preço.
    expect(at([row(0, '64000000000202', 39.9), row(0, '64000000000203', 3.49)])).toEqual(['64000000000203 3.49']);
    // A linha com o tamanho lido sempre fica; e sozinha, a sem tamanho fica (não há com que comparar: o risco que resta).
    expect(at([row(0, '64000000000202', 3.49), row(0, '64000000000203', 3.59), row(0, '64000000000201', 39.9, sized)])).toEqual([
      '64000000000202 3.49',
      '64000000000203 3.59',
      '64000000000201 39.9',
    ]);
    expect(at([row(0, '64000000000202', 39.9)])).toEqual(['64000000000202 39.9']);
    // Com os fardos em metade ou mais das outras linhas, ficam (o risco que resta).
    expect(at([row(0, '64000000000201', 3.49, sized), row(0, '64000000000202', 39.9), row(0, '64000000000203', 39.9)])).toEqual([
      '64000000000201 3.49',
      '64000000000202 39.9',
      '64000000000203 39.9',
    ]);
    // A 2,5 vezes (inclusive) ainda combina.
    expect(at([row(0, '64000000000201', 4, sized), row(0, '64000000000202', 10)])).toEqual(['64000000000201 4', '64000000000202 10']);
  });

  it('a marca mais barata nunca sai: o café de R$ 12,90 ao lado dos de R$ 34,90 fica, também no mercado da casa', () => {
    const coffee = answered([item('c', 'Café', 'cafe_cha')], () => [key('CAFE PILAO 500G'), key('CAFE ORFEU 500G'), key('CAFE MARATA 500G')]).groups;
    expect(entryOf(coffee, 'c')).toMatchObject({ size: '500 g', sizeBy: 'only' });
    const at = (rows: SharedItemPrice[]) => openQuotes([answerFor(coffee, rows)], coffee, STORES).get('c')?.map((quote) => `${quote.storeCnpj} ${quote.unitPrice}`);
    // Três mercados, três marcas, nenhum tamanho lido: ficam as três.
    expect(at([row(0, '64000000000201', 12.9), row(0, '64000000000202', 34.9), row(0, '64000000000203', 36.9)])).toEqual([
      '64000000000201 12.9',
      '64000000000202 34.9',
      '64000000000203 36.9',
    ]);
    // Dois que não combinam: fica o mais barato, também quando é o da casa.
    expect(at([row(0, '64000000000201', 12.9), row(0, '64000000000202', 34.9)])).toEqual(['64000000000201 12.9']);
    expect(at([row(0, '11222333000181', 12.9, { mine: true }), row(0, '64000000000202', 34.9)])).toEqual([
      '11222333000181 12.9',
      '11222333000181 12.9',
    ]);
  });

  it('no grupo sem tamanho a linha não leva tamanho nenhum, e a faixa não corta: "Alface" a R$ 2,49 e a R$ 6,99 ficam as duas', () => {
    const lettuce = answered([item('a', 'Alface', 'hortifruti')], () => [key('ALFACE CRESPA')]).groups;
    expect(groupOf(lettuce, 'a')?.expected).toBeNull();
    const quotes = openQuotes([answerFor(lettuce, [row(0, '64000000000201', 2.49), row(0, '64000000000202', 6.99)])], lettuce, STORES).get('a');
    expect(quotes?.map((quote) => `${quote.storeCnpj} ${quote.unitPrice}`)).toEqual(['64000000000201 2.49', '64000000000202 6.99']);
    expect(quotes?.every((quote) => quote.pack == null)).toBe(true);
  });

  it('em qualquer mistura de linhas, a mais barata de cada unidade fica e o item nunca perde todos os preços', () => {
    const coffee = answered([item('c', 'Café', 'cafe_cha')], () => [key('CAFE PILAO 500G'), key('CAFE ORFEU 500G')]).groups;
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const sized = { pack_unit: 'kg', pack_amount: 0.5, pack_of: null };
    for (let round = 0; round < 300; round++) {
      const count = 1 + Math.floor(random() * 6);
      const rows = Array.from({ length: count }, (_, n) =>
        row(0, `640000000002${String(n).padStart(2, '0')}`, Math.round((1 + random() * 60) * 100) / 100, random() < 0.3 ? sized : {}),
      );
      const kept = openQuotes([answerFor(coffee, rows)], coffee, STORES).get('c') ?? [];
      const cheapest = Math.min(...rows.map((one) => one.unit_price));
      expect([rows.map((one) => one.unit_price), kept.some((quote) => quote.unitPrice === cheapest)]).toEqual([rows.map((one) => one.unit_price), true]);
      // Uma linha só sai estando a mais de 2,5 vezes de mais da metade das outras.
      for (const one of rows) {
        if (kept.some((quote) => quote.storeCnpj === one.store_cnpj)) continue;
        const others = rows.filter((other) => other !== one);
        const far = others.filter((other) => one.unit_price > other.unit_price * 2.5).length;
        expect(one.pack_unit == null && far * 2 > others.length).toBe(true);
      }
    }
  });

  it('no preço por kg, a bandeja sem tamanho lido se compara com o que é vendido a peso', () => {
    const garlic = answered([item('a', 'Alho', 'hortifruti', 0.5, 'kg')], () => [key('ALHO', 'kg', 3), key('ALHO 200G', 'un', 1)]).groups;
    const at = (rows: SharedItemPrice[]) =>
      openQuotes([answerFor(garlic, rows)], garlic, STORES).get('a')?.map((quote) => `${quote.storeCnpj} ${quote.unit} ${quote.unitPrice}`);
    expect(at([row(0, '64000000000201', 30, { unit: 'kg' }), row(0, '64000000000203', 7.9)])).toEqual([
      '64000000000201 kg 30',
      '64000000000203 kg 39.5',
    ]);
    expect(at([row(0, '64000000000201', 30, { unit: 'kg' }), row(0, '64000000000203', 79)])).toEqual(['64000000000201 kg 30']);
  });
});

describe('os textos', () => {
  it('o que é o preço aberto', () => {
    expect(OPEN_PRICE_FACT).toBe('É o menor preço do mesmo item nas notas de outras casas daquele mercado, naquela semana: a marca ou a variedade pode ser outra.');
  });

  it('o tamanho que a conta usou, nos detalhes e na linha do "Onde comprar"', () => {
    const base = { size: null, sizeBy: null, fromPackage: null, packages: null } as const;
    expect(openSizeFact({ ...base, size: '5 kg', sizeBy: 'most' })).toBe('A lista não diz o tamanho: a conta usa o de 5 kg, o mais visto nas notas.');
    expect(openSizeFact({ ...base, size: '1 kg', sizeBy: 'tie' })).toBe('A lista não diz o tamanho: a conta usa o de 1 kg, um dos mais vistos nas notas.');
    expect(openSizeFact({ ...base, size: '5 kg', sizeBy: 'only' })).toBe('A lista não diz o tamanho: a conta usa o de 5 kg.');
    expect(openSizeFact({ ...base, fromPackage: '5 kg' }, 'kg')).toBe('A conta usa o preço por kg da embalagem de 5 kg.');
    expect(openSizeFact({ ...base, fromPackage: '2 L' }, 'l')).toBe('A conta usa o preço por litro da embalagem de 2 L.');
    expect(openSizeFact({ ...base, fromPackage: '1 kg', packages: 2 }, 'kg')).toBe('A conta usa 2 embalagens de 1 kg.');
    expect(openSizeFact({ ...base, fromPackage: '5 kg', packages: 1 }, 'kg')).toBe('A conta usa a embalagem de 5 kg.');
    expect(openSizeFact(base)).toBeNull();
    expect(openSizeNote({ ...base, size: '5 kg', sizeBy: 'most' })).toBe(' (5 kg)');
    expect(openSizeNote({ ...base, fromPackage: '5 kg' })).toBe(' (da embalagem de 5 kg)');
    expect(openSizeNote({ ...base, fromPackage: '1 kg', packages: 2 })).toBe(' (2 embalagens de 1 kg)');
    expect(openSizeNote({ ...base, fromPackage: '5 kg', packages: 1 })).toBe(' (embalagem de 5 kg)');
    expect(openSizeNote(base)).toBe('');
    expect(openSizeNote(undefined)).toBe('');
  });
});

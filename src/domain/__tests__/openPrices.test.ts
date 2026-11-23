import { describe, expect, it, jest } from '@jest/globals';

import {
  brandFreeItemKey,
  keyFit,
  keyPackageSize,
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
});

describe('os grupos: as descrições e o tamanho de cada item', () => {
  it('só o mesmo item entra no grupo', () => {
    const { groups } = answered([item('l', 'Leite', 'laticinios')], () => [key('LEITE INT ITALAC 1L'), key('LEITE ZERO LACTOSE ITALAC 1L')]);
    expect(groupOf(groups, 'l')?.keys).toEqual(['LEITE INT ITALAC 1L']);
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
    expect(groupOf(sized, 'a')?.keys).toEqual(['ARROZ CAMIL 5KG', 'ARROZ GRANEL']);
    const unsized = answered([item('a', 'Arroz', 'graos')], () => [key('ARROZ SEM TAMANHO'), key('ARROZ GRANEL', 'kg')]).groups;
    expect(groupOf(unsized, 'a')?.keys).toEqual(['ARROZ GRANEL', 'ARROZ SEM TAMANHO']);
    expect(groupOf(unsized, 'a')?.expected).toBeNull();
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

  it('em chamadas de 40 grupos; o que vai ao banco são as chaves e o tamanho esperado', () => {
    const groups: OpenGroup[] = Array.from({ length: 90 }, (_, n) => ({
      signature: `K${String(n).padStart(3, '0')}`,
      keys: [`K${n}`],
      expected: null,
      items: [],
    }));
    expect(openGroupCalls([...groups].reverse()).map((call) => call.length)).toEqual([40, 40, 10]);
    expect(openGroupCalls(groups)[0][0].signature).toBe('K000');
    expect(openGroupArgument({ signature: 's', keys: ['A'], expected: null, items: [] })).toEqual({ k: ['A'] });
    expect(openGroupArgument({ signature: 's', keys: ['A'], expected: { unit: 'l', amount: 4.2, label: '12 x 350 ml', of: 12 }, items: [] })).toEqual({
      k: ['A'],
      p: { u: 'l', a: 4.2, o: 12 },
    });
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

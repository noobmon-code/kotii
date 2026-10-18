import { describe, expect, it } from '@jest/globals';

import {
  describeEstimate,
  estimateList,
  formatItemCost,
  itemFacts,
  listSharedElsewhere,
  listSharedOnly,
  listStorePrices,
  sharedOnlyNote,
  storePriceNote,
  type EstimateItem,
  type EstimatePrice,
} from '../listEstimate';
import { LinkIndex, listNameKey } from '../listLinks';
import { storePriceIndex } from '../priceLevel';
import { describeSharedOffer, recommendStores, sharedStoreOffers } from '../recommendation';
import { SHARED_PRICES_NOTICE, type SharedQuote } from '../sharedPrices';

// Os preços de outras casas na conta da lista e no "Onde comprar": só onde a casa não tem preço, marcados, e os
// mercados que não são da casa à parte.

const item = (id: string, name: string, productId: string | null, quantity = 1, unit = 'un', inCart = false): EstimateItem => ({
  id,
  name,
  productId,
  quantity,
  unit,
  inCart,
});
const price = (productId: string, storeId: string, unitPrice: number, purchasedAt = '2026-10-01T12:00:00Z', unit = 'un'): EstimatePrice => ({
  productId,
  storeId,
  unitPrice,
  unit,
  purchasedAt,
});
/** Visto em outra casa: num mercado da casa (`storeId`) ou num de fora (null), pelo CNPJ. */
const seen = (productId: string, storeId: string | null, unitPrice: number, seenOn: string, extra: Partial<SharedQuote> = {}): SharedQuote => ({
  productId,
  storeId,
  storeCnpj: storeId ? `cnpj-${storeId}` : 'cnpj-fora',
  storeName: storeId ? `Mercado ${storeId}` : 'ATACADAO S.A.',
  state: storeId ? null : 'SP',
  mine: storeId != null,
  unit: 'un',
  unitPrice,
  seenOn,
  ...extra,
});

const prices = [price('arroz', 'assai', 25, '2026-10-01T12:00:00Z'), price('arroz', 'dia', 24, '2026-10-02T12:00:00Z'), price('feijao', 'assai', 8)];
const list = [item('a', 'Arroz', 'arroz'), item('f', 'Feijão', 'feijao')];
const asWanted = (items: EstimateItem[]) => items.map((i) => ({ key: i.id, productId: i.productId, quantity: i.quantity, unit: i.unit }));

describe('preços de outras casas na conta da lista', () => {
  it('num mercado da casa sem o item nas notas, o visto em outras casas vem antes da estimativa', () => {
    const shared = [seen('feijao', 'dia', 7.5, '2026-10-10')];
    const at = listStorePrices(list, prices, { shared });
    expect(at('f', 'dia')).toMatchObject({ source: 'shared', kind: 'known', cost: 7.5, used: null, shared: shared[0] });
    // Sem ele, a estimativa pelo nível de preço, como sempre.
    expect(listStorePrices(list, prices)('f', 'dia')).toMatchObject({ source: 'estimated', kind: 'estimated' });
  });

  it('o preço da casa sempre vence: mesmo mais barato e mais novo o de outras casas, e mesmo de outro produto ligado ao nome', () => {
    const shared = [seen('arroz', 'assai', 10, '2026-10-12'), seen('pilao', 'dia', 9, '2026-10-12')];
    const links = new LinkIndex([
      { name_key: listNameKey('Café'), product_id: 'pilao' },
      { name_key: listNameKey('Café'), product_id: 'melitta' },
    ]);
    const quotes = [...prices, price('pilao', 'assai', 18, '2026-10-05T12:00:00Z'), price('melitta', 'dia', 16, '2026-09-01T12:00:00Z')];
    const at = listStorePrices([...list, item('c', 'Café', null)], quotes, { shared, links });
    expect(at('a', 'assai')).toMatchObject({ source: 'product', cost: 25 });
    expect(at('c', 'dia')).toMatchObject({ source: 'otherProduct', cost: 16 });
    expect(at('c', 'dia')?.shared).toBeUndefined();
  });

  it('sem mercado escolhido, vale o último preço da casa; sem nenhum, o visto em outras casas, de preferência num mercado dela', () => {
    const shared = [seen('arroz', 'assai', 10, '2026-10-12'), seen('leite', null, 4.2, '2026-10-12'), seen('leite', 'dia', 4.9, '2026-10-08')];
    const estimate = estimateList([item('a', 'Arroz', 'arroz'), item('l', 'Leite', 'leite', 2)], prices, { shared });
    expect(estimate.byItem.get('a')).toMatchObject({ cost: 24, used: prices[1] });
    expect(estimate.byItem.get('a')?.shared).toBeUndefined();
    expect(estimate.byItem.get('l')).toMatchObject({ cost: 9.8, kind: 'known', used: null, last: null, lowest: null, productId: 'leite' });
    expect(estimate.byItem.get('l')?.shared).toBe(shared[2]);
    expect(estimate).toMatchObject({ pricedCount: 2, sharedCount: 1, sharedTotal: 9.8, total: 33.8 });
  });

  it('o item só com preço de outras casas: num mercado sem esse preço fica sem preço, e a lista e "Onde comprar" seguem iguais', () => {
    const shared = [seen('leite', 'dia', 4.9, '2026-10-08')];
    const items = [...list, item('l', 'Leite', 'leite')];
    const at = listStorePrices(items, prices, { shared });
    expect(at('l', 'assai')).toBeNull();
    expect(at('l', 'dia')).toMatchObject({ source: 'shared', cost: 4.9 });
    for (const storeId of ['assai', 'dia']) {
      const estimate = estimateList(items, prices, { shared, storeId });
      for (const { id } of items) {
        const answer = at(id, storeId);
        const cost = estimate.byItem.get(id);
        expect(Boolean(answer)).toBe(Boolean(cost));
        if (answer && cost) expect({ ...answer, last: cost.last, lowest: cost.lowest }).toEqual({ ...cost, source: answer.source });
      }
    }
    // Na recomendação, o item sem resposta em algum mercado fica fora dos totais (como sempre).
    const rec = recommendStores(asWanted(items), prices, 1, { storeIndex: storePriceIndex(prices), priceAt: at });
    expect(rec.unpricedKeys).toEqual(['l']);
  });

  it('o produto do item digitado solto vem das ligações também para os preços de outras casas: vale o visto por último', () => {
    const shared = [seen('italac', 'dia', 4.5, '2026-10-01'), seen('ninho', 'dia', 6.9, '2026-10-09')];
    const links = new LinkIndex([
      { name_key: listNameKey('Leite'), product_id: 'italac' },
      { name_key: listNameKey('Leite'), product_id: 'ninho' },
    ]);
    expect(estimateList([item('l', 'Leite', null)], prices, { shared, links }).byItem.get('l')).toMatchObject({ productId: 'ninho', cost: 6.9 });
  });

  it('não entram no nível de preço dos mercados nem na média da estimativa', () => {
    const shared = [seen('feijao', 'dia', 1, '2026-10-10'), seen('arroz', 'novo', 1, '2026-10-10')];
    const withShared = listStorePrices(list, prices, { shared });
    const without = listStorePrices(list, prices);
    // O mercado novo só tem o arroz de outras casas: o feijão de lá sai da mesma estimativa de antes.
    expect(withShared('f', 'novo')).toEqual(without('f', 'novo'));
    expect(withShared('a', 'dia')).toEqual(without('a', 'dia'));
  });

  it('a unidade da lista: o preço por kg serve a quem pede em g', () => {
    const shared = [seen('carne', 'dia', 49.9, '2026-10-10', { unit: 'kg' })];
    expect(listStorePrices([item('c', 'Carne', 'carne', 500, 'g')], [], { shared })('c', 'dia')).toMatchObject({
      cost: 24.95,
      unit: 'kg',
      approximateQuantity: false,
    });
  });

  it('as frases: "~" no custo, o que veio de outras casas no total, a nota da linha e os detalhes do item', () => {
    const shared = [seen('feijao', 'dia', 7.5, '2026-10-10')];
    const estimate = estimateList(list, prices, { shared, storeId: 'dia' });
    const feijao = estimate.byItem.get('f')!;
    expect(formatItemCost(feijao)).toBe('~R$ 7,50');
    expect(describeEstimate(estimate, 'Dia')).toBe('Lugar escolhido: Dia. Todos os itens têm preço; R$ 7,50 do total é de 1 item com preço de outras casas.');
    expect(describeEstimate({ ...estimate, sharedCount: 2, sharedTotal: 12.4 }, null)).toBe(
      'Pelo último preço que a casa pagou em cada item; todos os itens têm preço; R$ 12,40 do total são de 2 itens com preço de outras casas.',
    );
    expect(storePriceNote(listStorePrices(list, prices, { shared })('f', 'dia')!, undefined, 2026)).toBe('Preço de outras casas, visto em 10 out');
    const names: Record<string, string> = { assai: 'Assaí', dia: 'Dia' };
    expect(itemFacts(feijao, undefined, { storeName: (id) => names[id], chosenStore: 'dia', today: '2026-10-12' })).toEqual([
      'Último preço: R$ 8,00/un (Assaí, 1 out).',
      'Preço de outras casas na conta: R$ 7,50/un (Dia, visto em 10 out).',
      SHARED_PRICES_NOTICE,
    ]);
    // Sem preço da casa, só o de outras casas; de fora, com o nome da nota e o estado.
    const leite = estimateList([item('l', 'Leite', 'leite')], [], { shared: [seen('leite', null, 4.2, '2026-10-12')] }).byItem.get('l');
    expect(itemFacts(leite, undefined, { storeName: () => undefined, today: '2026-10-12' })).toEqual([
      'Preço de outras casas na conta: R$ 4,20/un (ATACADAO S.A. (SP), visto em 12 out).',
      SHARED_PRICES_NOTICE,
    ]);
  });
});

describe('o item só com preço de outras casas e a escolha do mercado', () => {
  it('fica à parte, com o mesmo preço que a lista mostra sem mercado escolhido; o item com preço da casa não', () => {
    const shared = [seen('leite', null, 4.2, '2026-10-12'), seen('leite', 'dia', 4.9, '2026-10-08'), seen('feijao', 'dia', 7, '2026-10-10')];
    const items = [...list, item('l', 'Leite', 'leite', 2)];
    const only = listSharedOnly(items, prices, { shared });
    expect([...only.keys()]).toEqual(['l']);
    const lastPaid = estimateList(items, prices, { shared }).byItem.get('l')!;
    expect(only.get('l')).toMatchObject({ cost: lastPaid.cost, shared: lastPaid.shared, source: 'shared' });
    expect(formatItemCost(only.get('l')!)).toBe('~R$ 9,80');
    expect(sharedOnlyNote(only.get('l')!, (id) => (id === 'dia' ? 'Dia' : undefined), 2026)).toBe('Só há preço de outras casas: Dia, visto em 8 out');
    expect(sharedOnlyNote({ shared: shared[0] }, undefined, 2026)).toBe('Só há preço de outras casas: ATACADAO S.A. (SP), visto em 12 out');
    // Fora dos planos, nenhum item fica "sem preço" por causa dele.
    const wanted = items.filter((i) => !only.has(i.id));
    const rec = recommendStores(asWanted(wanted), prices, 1, {
      storeIndex: storePriceIndex(prices),
      priceAt: listStorePrices(wanted, prices, { shared }),
    });
    expect(rec.unpricedKeys).toEqual([]);
  });

  it('"Onde você está comprando?" só oferece mercados com preço da casa, e conta o de outras casas só neles', () => {
    const shared = [seen('feijao', 'dia', 7, '2026-10-10'), seen('arroz', 'so-de-outras', 20, '2026-10-10')];
    const estimate = estimateList(list, prices, { shared });
    expect(estimate.stores).toEqual([
      { storeId: 'assai', knownCount: 2 },
      { storeId: 'dia', knownCount: 2 },
    ]);
  });
});

describe('"Onde comprar": os mercados de fora, à parte', () => {
  it('um preço por mercado de fora, do mesmo produto de onde sai o preço do item', () => {
    const shared = [
      seen('arroz', null, 21, '2026-10-10'),
      seen('arroz', null, 20, '2026-10-01', { storeCnpj: 'cnpj-outro', storeName: 'OUTRO' }),
      seen('arroz', 'dia', 19, '2026-10-10'),
      // Outro produto, que não é o do item: não entra.
      seen('tio-joao', null, 15, '2026-10-10'),
    ];
    const elsewhere = listSharedElsewhere(list, prices, { shared });
    expect([...elsewhere.keys()]).toEqual(['a']);
    expect(elsewhere.get('a')!.map((p) => [p.shared?.storeCnpj, p.cost, p.source])).toEqual([
      ['cnpj-fora', 21, 'shared'],
      ['cnpj-outro', 20, 'shared'],
    ]);
  });

  it('os mercados com mais itens primeiro, com o que esses itens custam no plano; o item sem preço na casa não compara', () => {
    const shared = [
      seen('arroz', null, 21, '2026-10-10'),
      seen('feijao', null, 7, '2026-10-10'),
      seen('arroz', null, 20, '2026-10-01', { storeCnpj: 'cnpj-outro', storeName: 'OUTRO', state: null }),
      seen('leite', null, 4, '2026-10-10', { storeCnpj: 'cnpj-leite', storeName: 'LEITERIA' }),
    ];
    const items = [...list, item('l', 'Leite', null)];
    const links = new LinkIndex([{ name_key: listNameKey('Leite'), product_id: 'leite' }]);
    const at = listStorePrices(items, prices, { shared, links });
    const plan = recommendStores(asWanted(items), prices, 1, { storeIndex: storePriceIndex(prices), priceAt: at }).plans[0];
    const offers = sharedStoreOffers(listSharedElsewhere(items, prices, { shared, links }), plan);
    expect(offers.map((o) => [o.storeLabel, o.items.map((i) => i.itemKey), o.total, o.planTotal])).toEqual([
      ['ATACADAO S.A. (SP)', ['a', 'f'], 28, plan.total],
      // Um item cada: o que economiza mais frente ao plano primeiro; o leite não tem preço na casa.
      ['OUTRO', ['a'], 20, plan.assignments.find((a) => a.itemKey === 'a')!.cost],
      ['LEITERIA (SP)', ['l'], 4, null],
    ]);
    expect(describeSharedOffer(offers[0])).toBe(`2 itens da lista por ~R$ 28,00; no plano acima, R$ ${plan.total.toFixed(2).replace('.', ',')}`);
    expect(describeSharedOffer(offers[2])).toBe('1 item da lista por ~R$ 4,00');
    // No máximo três mercados.
    expect(sharedStoreOffers(listSharedElsewhere(items, prices, { shared, links }), plan, 2)).toHaveLength(2);
  });
});

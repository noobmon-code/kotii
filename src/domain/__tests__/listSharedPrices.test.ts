import { describe, expect, it } from '@jest/globals';

import {
  describeEstimate,
  estimateList,
  formatItemCost,
  itemFacts,
  itemsWithoutPrice,
  listSharedElsewhere,
  listSharedOnly,
  listStorePrices,
  sharedOnlyNote,
  storePriceNote,
  type EstimateItem,
  type EstimatePrice,
} from '../listEstimate';
import { LinkIndex, listNameKey } from '../listLinks';
import { OPEN_PRICE_FACT } from '../openPrices';
import { storePriceIndex } from '../priceLevel';
import { describeSharedOffer, recommendStores, sharedStoreOffers } from '../recommendation';
import { SHARED_PRICES_NOTICE, sharedWeekStart, type SharedQuote } from '../sharedPrices';

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
/** Visto em outra casa: num mercado da casa (`storeId`) ou num de fora (null), pelo CNPJ, na semana do dia dado. */
const seen = (productId: string, storeId: string | null, unitPrice: number, seenOn: string, extra: Partial<SharedQuote> = {}): SharedQuote => ({
  productId,
  storeId,
  storeCnpj: storeId ? `cnpj-${storeId}` : 'cnpj-fora',
  storeName: storeId ? `Mercado ${storeId}` : 'ATACADAO S.A.',
  state: storeId ? null : 'SP',
  mine: storeId != null,
  unit: 'un',
  unitPrice,
  seenWeek: sharedWeekStart(seenOn),
  pack: null,
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
    // Sem mercado escolhido, o começo diz de onde sai a conta: só da casa, da casa e de outras casas, ou só de outras.
    expect(describeEstimate({ ...estimate, sharedCount: 0, sharedTotal: 0 }, null)).toBe('Pelo último preço que a casa pagou em cada item; todos os itens têm preço.');
    expect(describeEstimate({ ...estimate, sharedCount: 1, sharedTotal: 7.5 }, null)).toBe(
      'Pelo último preço que a casa pagou em cada item e, onde ela não tem preço, pelo visto em outras casas; todos os itens têm preço; R$ 7,50 do total é de 1 item com preço de outras casas.',
    );
    expect(describeEstimate({ ...estimate, sharedCount: 2, sharedTotal: 12.4 }, null)).toBe(
      'Pelo preço visto em outras casas, porque a casa ainda não pagou por estes itens; todos os itens têm preço; R$ 12,40 do total são de 2 itens com preço de outras casas.',
    );
    expect(storePriceNote(listStorePrices(list, prices, { shared })('f', 'dia')!, undefined, 2026)).toBe('Preço de outras casas, visto na semana de 5 out');
    const names: Record<string, string> = { assai: 'Assaí', dia: 'Dia' };
    expect(itemFacts(feijao, undefined, { storeName: (id) => names[id], chosenStore: 'dia', today: '2026-10-12' })).toEqual([
      'Último preço: R$ 8,00/un (Assaí, 1 out).',
      'Preço de outras casas na conta: R$ 7,50/un (Dia, visto na semana de 5 out).',
      SHARED_PRICES_NOTICE,
    ]);
    // Sem preço da casa, só o de outras casas; de fora, com o nome da nota e o estado.
    const leite = estimateList([item('l', 'Leite', 'leite')], [], { shared: [seen('leite', null, 4.2, '2026-10-12')] }).byItem.get('l');
    expect(itemFacts(leite, undefined, { storeName: () => undefined, today: '2026-10-12' })).toEqual([
      'Preço de outras casas na conta: R$ 4,20/un (ATACADAO S.A. (SP), visto na semana de 12 out).',
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
    expect(sharedOnlyNote(only.get('l')!, (id) => (id === 'dia' ? 'Dia' : undefined), 2026)).toBe('Só há preço de outras casas: Dia, visto na semana de 5 out');
    expect(sharedOnlyNote({ shared: shared[0] }, undefined, 2026)).toBe('Só há preço de outras casas: ATACADAO S.A. (SP), visto na semana de 12 out');
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

describe('a base aberta: o item que a casa nunca comprou', () => {
  const OPEN = { size: '5 kg', sizeBy: 'most' as const, fromPackage: null, packages: null };
  /** Um preço da base aberta (sem produto): num mercado da casa ou num de fora. */
  const open = (storeId: string | null, unitPrice: number, seenOn: string, extra: Partial<SharedQuote> = {}): SharedQuote => ({
    ...seen('x', storeId, unitPrice, seenOn, extra),
    productId: null,
    open: OPEN,
    ...extra,
  });
  const arroz = item('n', 'Arroz', null);
  const openFor = (quotes: SharedQuote[]) => new Map([['n', quotes]]);

  it('só o item sem preço nenhum: nem da casa, nem de outras casas pelo produto', () => {
    const quotes = openFor([open('dia', 29.9, '2026-11-09')]);
    expect(itemsWithoutPrice([arroz, ...list], prices, {})).toEqual(new Set(['n']));
    expect(estimateList([arroz], [], { open: quotes }).byItem.get('n')).toMatchObject({ cost: 29.9, productId: null, used: null, last: null });
    expect(formatItemCost(estimateList([arroz], [], { open: quotes }).byItem.get('n')!)).toBe('~R$ 29,90');
    // Com preço da casa (o item com produto), o aberto não entra.
    const own = item('n', 'Arroz', 'arroz');
    expect(itemsWithoutPrice([own], prices, {})).toEqual(new Set());
    expect(estimateList([own], prices, { open: quotes }).byItem.get('n')).toMatchObject({ cost: 24 });
    // Com o de outras casas pelo produto (o código de barras, o apelido), também não.
    const byProduct = [seen('leite', 'dia', 4.5, '2026-11-02')];
    const leite = item('n', 'Leite', 'leite');
    expect(itemsWithoutPrice([leite], [], { shared: byProduct })).toEqual(new Set());
    expect(estimateList([leite], [], { shared: byProduct, open: quotes }).byItem.get('n')).toMatchObject({ cost: 4.5, productId: 'leite' });
  });

  it('quando o preço da casa ou o de outras casas pelo produto chega depois, ele vence, e o aberto sai sozinho', () => {
    const quotes = openFor([open('dia', 29.9, '2026-11-09')]);
    const links = new LinkIndex([{ name_key: listNameKey('Arroz'), product_id: 'arroz' }]);
    expect(estimateList([arroz], prices, { open: quotes, links }).byItem.get('n')).toMatchObject({ cost: 24, productId: 'arroz' });
    expect(estimateList([arroz], prices, { open: quotes, links }).byItem.get('n')?.shared).toBeUndefined();
  });

  it('com o mercado escolhido: o preço aberto de lá; sem ele, nenhum (nunca no lugar da estimativa da casa)', () => {
    const quotes = openFor([open('dia', 29.9, '2026-11-09'), open(null, 27, '2026-11-09')]);
    expect(estimateList([arroz], prices, { open: quotes, storeId: 'dia' }).byItem.get('n')).toMatchObject({ cost: 29.9 });
    expect(estimateList([arroz], prices, { open: quotes, storeId: 'assai' }).byItem.get('n')).toBeUndefined();
    // Sem mercado: o visto por último, de preferência num mercado da casa.
    expect(estimateList([arroz], prices, { open: quotes }).byItem.get('n')).toMatchObject({ cost: 29.9 });
  });

  it('no "Onde comprar": à parte ("Só com preço de outras casas") e em "Em outros mercados", nunca nos planos', () => {
    const quotes = openFor([open('dia', 29.9, '2026-11-09'), open(null, 27, '2026-11-09')]);
    const items = [...list, arroz];
    expect([...listSharedOnly(items, prices, { open: quotes }).keys()]).toEqual(['n']);
    expect(listSharedElsewhere(items, prices, { open: quotes }).get('n')?.map((price) => [price.shared?.storeCnpj, price.cost])).toEqual([
      ['cnpj-fora', 27],
    ]);
    const only = listSharedOnly(items, prices, { open: quotes }).get('n')!;
    expect(sharedOnlyNote(only, (id) => (id === 'dia' ? 'Dia' : undefined), 2026)).toBe('Só há preço de outras casas (5 kg): Dia, visto na semana de 9 nov');
    expect(storePriceNote(listStorePrices(items, prices, { open: quotes })('n', 'dia')!, undefined, 2026)).toBe(
      'Preço de outras casas (5 kg), visto na semana de 9 nov',
    );
    const perKg = { ...only, shared: { ...only.shared!, open: { size: null, sizeBy: null, fromPackage: '5 kg', packages: null } } };
    expect(sharedOnlyNote(perKg, () => 'Dia', 2026)).toBe('Só há preço de outras casas (da embalagem de 5 kg): Dia, visto na semana de 9 nov');
    // A conta conta esses itens no que veio de outras casas.
    expect(estimateList(items, prices, { open: quotes })).toMatchObject({ sharedCount: 1, sharedTotal: 29.9 });
  });

  it('os detalhes: o preço, o que ele é, o tamanho que a conta escolheu e o aviso; com o ano quando não é o de agora', () => {
    const estimate = estimateList([arroz], [], { open: openFor([open('dia', 29.9, '2026-11-09')]) }).byItem.get('n');
    expect(itemFacts(estimate, undefined, { storeName: (id) => (id === 'dia' ? 'Dia' : undefined), today: '2026-11-23' })).toEqual([
      'Preço de outras casas na conta: R$ 29,90/un (Dia, visto na semana de 9 nov).',
      OPEN_PRICE_FACT,
      'A lista não diz o tamanho: a conta usa o de 5 kg, o mais visto nas notas.',
      SHARED_PRICES_NOTICE,
    ]);
    const fora = estimateList([arroz], [], { open: openFor([open(null, 27, '2025-12-29')]) }).byItem.get('n');
    expect(itemFacts(fora, undefined, { storeName: () => undefined, today: '2026-11-23' })[0]).toBe(
      'Preço de outras casas na conta: R$ 27,00/un (ATACADAO S.A. (SP), visto na semana de 29 dez 2025).',
    );
  });

  it('os ovos pedidos em ovos contam pela cartela da base aberta, e o tamanho escolhido não se repete nos detalhes', () => {
    const ovos = item('n', 'Ovos', null, 12);
    const thirty = open('dia', 21, '2026-11-09', {
      pack: { unit: 'un', amount: 30, label: '30 un' },
      open: { size: '30 un', sizeBy: 'most', fromPackage: null, packages: null },
    });
    const estimate = estimateList([{ ...ovos, category: 'ovos' }], [], { open: openFor([thirty]) }).byItem.get('n')!;
    expect(estimate).toMatchObject({ cost: 8.4, eggs: { count: 12, pack: 30 } });
    const facts = itemFacts(estimate, undefined, { storeName: () => 'Dia', today: '2026-11-23' });
    expect(facts).toContain('A lista pede 12 ovos: a conta usa R$ 0,70 o ovo, da cartela de 30.');
    expect(facts.some((fact) => fact.startsWith('A lista não diz o tamanho'))).toBe(false);
  });

  it('pedido em kg, pelo preço por kg do pacote: a conta é exata e sem "tamanho" da lista', () => {
    const quote = open('dia', 4.98, '2026-11-09', {
      unit: 'kg',
      pack: { unit: 'kg', amount: 5, label: '5 kg' },
      open: { size: null, sizeBy: null, fromPackage: '5 kg', packages: null },
    });
    const estimate = estimateList([item('n', 'Arroz', null, 2, 'kg')], [], { open: openFor([quote]) }).byItem.get('n')!;
    expect(estimate).toMatchObject({ cost: 9.96, unit: 'kg', approximateQuantity: false });
    expect(itemFacts(estimate, undefined, { storeName: () => 'Dia', today: '2026-11-23' })).toContain('A conta usa o preço por kg da embalagem de 5 kg.');
  });
});

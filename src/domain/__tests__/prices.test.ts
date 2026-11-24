import { describe, expect, it } from '@jest/globals';

import { storeSummaryLine, storeSummaryPrice, summarizePrices, summarizeStorePrices } from '../prices';
import { cheaperSharedPrice, compareSharedPrices, type SharedPrice } from '../sharedPrices';
import { savedPricesByProduct, type SavedPrice } from '../storePrices';

const p = (store_id: string, unit: string, unit_price: number) => ({ store_id, unit, unit_price });

describe('summarizePrices', () => {
  it('compares only prices in the same unit', () => {
    const summary = summarizePrices([p('s1', 'kg', 5.99), p('s2', 'kg', 6.49), p('s3', 'un', 2)]);
    expect(summary?.unit).toBe('kg');
    expect(summary?.cheapest.store_id).toBe('s1');
    expect(summary?.highest).toBe(6.49);
    expect(summary?.storeCount).toBe(2);
    expect(summary?.otherUnits).toEqual(['un']);
  });

  it('breaks ties by unit order and handles a single price', () => {
    expect(summarizePrices([p('s1', 'kg', 5), p('s2', 'un', 2)])?.unit).toBe('un');
    expect(summarizePrices([p('s1', 'l', 4)])).toMatchObject({ unit: 'l', highest: 4, storeCount: 1, otherUnits: [] });
    expect(summarizePrices([])).toBeNull();
  });
});

const STORES: Record<string, string> = { assai: 'Assaí', dia: 'Dia', atacadao: 'Atacadão', s1: 'Mercado 1', s2: 'Mercado 2', s3: 'Mercado 3' };
const storeName = (id: string) => STORES[id];

function row(
  product_id: string,
  store_id: string,
  unit: string,
  unit_price: number,
  purchased_at = '2026-10-01T12:00:00-03:00',
  extra: Partial<SavedPrice> = {},
): SavedPrice {
  return { product_id, store_id, unit, unit_price, purchased_at, ...extra };
}

/** A linha em Preços de um produto, como a tela a monta: o texto de baixo e o preço da direita. */
function line(saved: SavedPrice[], productId: string, category?: string) {
  const summary = summarizeStorePrices(savedPricesByProduct(saved).get(productId) ?? []);
  return summary ? { subtitle: storeSummaryLine(summary, storeName, category), right: storeSummaryPrice(summary, category) } : null;
}

describe('g com kg e ml com litro (tela Preços)', () => {
  it('o preço por g entra por kg, e os dois mercados se comparam', () => {
    const saved = [row('queijo', 's1', 'g', 0.0399), row('queijo', 's2', 'kg', 42.9), row('leite', 's1', 'ml', 0.0049)];
    const summary = summarizeStorePrices(savedPricesByProduct(saved).get('queijo')!);
    expect(summary).toMatchObject({ unit: 'kg', highest: 42.9, storeCount: 2, otherUnits: [], unsizedStores: 0 });
    expect(summary?.cheapest).toMatchObject({ storeId: 's1', unit: 'kg', unitPrice: 39.9 });
    // Nunca "por g" nem "por ml".
    expect(summarizeStorePrices(savedPricesByProduct(saved).get('leite')!)).toMatchObject({ unit: 'l', highest: 4.9 });
    expect(line(saved, 'queijo')).toEqual({ subtitle: 'Mais barato: Mercado 1 · 2 mercados', right: 'R$ 39,90–42,90/kg' });
    expect(line(saved, 'leite')).toEqual({ subtitle: 'Só em Mercado 1', right: 'R$ 4,90/l' });
  });

  it('agrupa por produto uma vez só, sem mudar o que já está por kg, litro ou unidade', () => {
    const byProduct = savedPricesByProduct([row('arroz', 's1', 'un', 24.9), row('arroz', 's2', 'kg', 5.5), row('feijao', 's1', 'l', 8)]);
    expect([...byProduct.keys()]).toEqual(['arroz', 'feijao']);
    expect(byProduct.get('arroz')!.map((price) => `${price.storeId} ${price.unit} ${price.unitPrice}`)).toEqual(['s2 kg 5.5', 's1 un 24.9']);
  });

  it('kg e unidade continuam separados', () => {
    const saved = [row('banana', 's1', 'kg', 6.99), row('banana', 's2', 'g', 0.0075), row('banana', 's3', 'un', 1.2)];
    const summary = summarizeStorePrices(savedPricesByProduct(saved).get('banana')!);
    expect(summary).toMatchObject({ unit: 'kg', storeCount: 2, otherUnits: ['un'], unsizedStores: 0 });
    expect(line(saved, 'banana')?.subtitle).toBe('Mais barato: Mercado 1 · 2 mercados · também vendido por un');
  });

  // latest_prices guarda um preço por mercado e unidade do banco: o queijo lançado por g há um ano e por kg hoje,
  // no mesmo mercado, viraria dois preços por kg.
  const oldGrams = row('queijo', 'assai', 'g', 0.0299, '2025-01-10T12:00:00-03:00');
  const newKilo = row('queijo', 'assai', 'kg', 45.9, '2026-10-01T12:00:00-03:00');
  const dia = row('queijo', 'dia', 'kg', 39.9, '2026-09-20T12:00:00-03:00');
  const shown = (saved: SavedPrice[]) => savedPricesByProduct(saved).get('queijo')!.map((price) => `${price.storeId} ${price.unitPrice}`);

  it('o mesmo mercado por g (antigo) e por kg (novo): vale o preço mais recente', () => {
    expect(shown([oldGrams, newKilo, dia])).toEqual(['dia 39.9', 'assai 45.9']);
    const summary = summarizeStorePrices(savedPricesByProduct([oldGrams, newKilo, dia]).get('queijo')!);
    expect(summary).toMatchObject({ unit: 'kg', highest: 45.9, storeCount: 2, otherUnits: [] });
    expect(summary?.cheapest.storeId).toBe('dia');
    // A ordem das linhas não muda nada: o g antigo depois do kg novo também sai.
    expect(shown([newKilo, dia, oldGrams])).toEqual(['dia 39.9', 'assai 45.9']);
  });

  it('o g mais recente que o kg é o que vale, já por kg', () => {
    const recentGrams = row('queijo', 'assai', 'g', 0.0419, '2026-10-15T12:00:00-03:00');
    expect(shown([newKilo, recentGrams])).toEqual(['assai 41.9']);
  });

  it('no mesmo momento, o menor dos dois', () => {
    const sameTime = row('queijo', 'assai', 'g', 0.0449, newKilo.purchased_at);
    expect(shown([newKilo, sameTime])).toEqual(['assai 44.9']);
    expect(shown([sameTime, newKilo])).toEqual(['assai 44.9']);
  });

  it('o "outra casa viu mais barato" mede contra o preço de hoje, não contra o antigo', () => {
    const seen: SharedPrice = {
      product_id: 'queijo',
      store_cnpj: '1',
      store_name: 'Super Outro',
      store_uf: '35',
      unit: 'kg',
      unit_price: 35,
      seen_on: '2026-10-10',
      mine: false,
    };
    expect(cheaperSharedPrice(compareSharedPrices([seen], [oldGrams, newKilo, dia]))).toMatchObject({ storeName: 'Super Outro', comparedTo: 39.9 });
  });
});

describe('Preços pelo tamanho da embalagem (summarizeStorePrices, storeSummaryLine, storeSummaryPrice)', () => {
  const at = (day: string) => `2026-11-${day}T12:00:00-03:00`;
  const un = (product: string, store: string, price: number, description?: string, extra: Partial<SavedPrice> = {}) =>
    row(product, store, 'un', price, at('10'), { ...(description ? { raw_description: description } : {}), ...extra });

  it('o arroz de 5 kg num mercado e o de 1 kg no outro: por kg, e o mais barato diz o pacote', () => {
    const saved = [un('arroz', 'assai', 24.9, 'ARROZ CAMIL T1 5KG'), un('arroz', 'dia', 5.49, 'ARROZ CAMIL T1 1KG')];
    expect(line(saved, 'arroz')).toEqual({ subtitle: 'Mais barato: Assaí (5 kg por R$ 24,90) · 2 mercados', right: 'R$ 4,98–5,49/kg' });
  });

  it('o mesmo tamanho nos dois: o preço da embalagem, sem parênteses', () => {
    const saved = [un('arroz', 'assai', 24.9, 'ARROZ CAMIL T1 5KG'), un('arroz', 'dia', 23.9, 'ARROZ CAMIL 5 KG')];
    expect(line(saved, 'arroz')).toEqual({ subtitle: 'Mais barato: Dia · 2 mercados', right: 'R$ 23,90–24,90' });
  });

  it('ovos de cartelas diferentes: o ovo, e "30 ovos" só com a categoria', () => {
    const saved = [un('ovos', 'assai', 11.9, 'OVOS BRANCOS C/12'), un('ovos', 'dia', 24.9, 'OVOS 30UN')];
    expect(line(saved, 'ovos', 'ovos')).toEqual({ subtitle: 'Mais barato: Dia (30 ovos por R$ 24,90) · 2 mercados', right: 'R$ 0,83–0,99 o ovo' });
    expect(line(saved, 'ovos', 'laticinios')).toEqual({ subtitle: 'Mais barato: Dia (30 un por R$ 24,90) · 2 mercados', right: 'R$ 0,83–0,99 cada' });
    expect(line(saved, 'ovos')?.right).toBe('R$ 0,83–0,99 cada');
  });

  it('a caixa de 12 latas, a lata e o fardo: por litro', () => {
    const saved = [
      un('cerveja', 'assai', 39.9, 'CERV SKOL LT 350ML C/12'),
      un('cerveja', 'dia', 3.49, 'CERV SKOL LT 350ML'),
      un('cerveja', 'atacadao', 36.9, 'CERV SKOL 12X350ML'),
    ];
    expect(line(saved, 'cerveja')).toEqual({
      subtitle: 'Mais barato: Atacadão (12 x 350 ml por R$ 36,90) · 3 mercados',
      right: 'R$ 8,79–9,97/l',
    });
  });

  it('o mercado cuja nota não diz o tamanho aparece à parte', () => {
    const saved = [un('arroz', 'assai', 24.9, 'ARROZ 5KG'), un('arroz', 'dia', 5.49, 'ARROZ 1KG'), un('arroz', 'atacadao', 6.2, 'ARROZ TIO JOAO')];
    const summary = summarizeStorePrices(savedPricesByProduct(saved).get('arroz')!);
    expect(summary).toMatchObject({ unit: 'kg', storeCount: 2, otherUnits: [], unsizedStores: 1 });
    expect(line(saved, 'arroz')).toEqual({
      subtitle: 'Mais barato: Assaí (5 kg por R$ 24,90) · 2 mercados · mais 1 mercado sem o tamanho na nota',
      right: 'R$ 4,98–5,49/kg',
    });
    const two = [...saved, un('arroz', 's1', 10.9, 'ARROZ 2KG'), un('arroz', 's2', 6.5, 'ARROZ BRANCO')];
    expect(line(two, 'arroz')?.subtitle).toBe('Mais barato: Assaí (5 kg por R$ 24,90) · 3 mercados · mais 2 mercados sem o tamanho na nota');
  });

  it('um tamanho conhecido ao lado de um desconhecido: como no histórico, por unidade', () => {
    const saved = [un('arroz', 'assai', 24.9, 'ARROZ CAMIL T1 5KG'), un('arroz', 'atacadao', 6.2, 'ARROZ TIO JOAO')];
    expect(line(saved, 'arroz')).toEqual({ subtitle: 'Mais barato: Atacadão · 2 mercados', right: 'R$ 6,20–24,90' });
  });

  it('sem a descrição (o banco de antes da coluna): o texto de antes', () => {
    const saved = [un('arroz', 'assai', 24.9), un('arroz', 'dia', 5.49)];
    expect(line(saved, 'arroz')).toEqual({ subtitle: 'Mais barato: Dia · 2 mercados', right: 'R$ 5,49–24,90' });
  });

  it('quantos vinham, respondido na revisão, também compara (sem a descrição)', () => {
    const saved = [un('ovos', 'assai', 11.9, undefined, { pack_count: 12 }), un('ovos', 'dia', 24.9, undefined, { pack_count: 30 })];
    expect(line(saved, 'ovos', 'ovos')).toEqual({ subtitle: 'Mais barato: Dia (30 ovos por R$ 24,90) · 2 mercados', right: 'R$ 0,83–0,99 o ovo' });
  });

  it('a lista por item do pacote fora da principal: "também por item do pacote", "também por ovo" nos ovos', () => {
    const saved = [
      un('ovos', 'assai', 11.9, 'OVOS C/12'),
      un('ovos', 'dia', 24.9, 'OVOS 30UN'),
      row('ovos', 's1', 'kg', 15, at('10')),
      row('ovos', 's2', 'kg', 16, at('10')),
      row('ovos', 's3', 'kg', 17, at('10')),
    ];
    expect(line(saved, 'ovos')?.subtitle).toBe('Mais barato: Mercado 1 · 3 mercados · também por item do pacote');
    expect(line(saved, 'ovos', 'ovos')?.subtitle).toBe('Mais barato: Mercado 1 · 3 mercados · também por ovo');
  });

  it('um mercado só, com e sem o nome conhecido', () => {
    const saved = [un('arroz', 'assai', 24.9, 'ARROZ 5KG'), row('arroz', 'assai', 'kg', 5.2, at('10'))];
    expect(line(saved, 'arroz')).toEqual({ subtitle: 'Só em Assaí (5 kg por R$ 24,90)', right: 'R$ 4,98/kg' });
    const unknown = summarizeStorePrices(savedPricesByProduct([un('arroz', 'x', 24.9), un('arroz', 'y', 20)]).get('arroz')!)!;
    expect(storeSummaryLine(unknown, () => undefined)).toBe('Mais barato: mercado · 2 mercados');
    const single = summarizeStorePrices(savedPricesByProduct([un('arroz', 'x', 24.9)]).get('arroz')!)!;
    expect(storeSummaryLine(single, () => undefined)).toBe('Só em um mercado');
    expect(storeSummaryPrice(single)).toBe('R$ 24,90');
  });

  it('sem preço nenhum, nada', () => {
    expect(summarizeStorePrices([])).toBeNull();
  });
});

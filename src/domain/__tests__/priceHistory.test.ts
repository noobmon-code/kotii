import { describe, expect, it } from '@jest/globals';

import {
  ALL_STORES,
  changeSentence,
  chartPoints,
  countSentence,
  defaultPeriod,
  defaultUnit,
  DISCOUNT_TOLERANCE_CENTS,
  emptyPeriodSentence,
  hasDiscount,
  inPeriod,
  latestSentence,
  medianPrice,
  moreLabel,
  NO_STORE,
  percentChange,
  periodStart,
  priceChart,
  priceHistoryView,
  priceRange,
  purchaseRow,
  purchaseUnits,
  rangeSentence,
  storeOptions,
  summarize,
  toPurchases,
  unitLabel,
  usualSentence,
  type HistoryChoices,
  type PurchaseLine,
} from '../priceHistory';

const TODAY = '2026-10-13';

/** O instante de uma hora local do aparelho, como o banco o guarda (UTC): os testes valem em qualquer fuso. */
const at = (day: string, time = '15:00') => new Date(`${day}T${time}:00`).toISOString();

let serial = 0;
/** Uma linha de nota: 1 un no Assaí, a não ser que se diga outra coisa. O total sai de quantidade x preço. */
function line(day: string, unitPrice: number, partial: Partial<PurchaseLine> & { time?: string } = {}): PurchaseLine {
  const { time, ...rest } = partial;
  const quantity = rest.quantity ?? 1;
  serial += 1;
  return {
    id: `i${serial}`,
    receiptId: `r-${day}-${rest.storeId === undefined ? 'assai' : rest.storeId}`,
    storeId: 'assai',
    storeName: 'Assaí',
    purchasedAt: at(day, time),
    quantity,
    unit: 'un',
    unitPrice,
    totalPrice: Math.round(quantity * unitPrice * 100) / 100,
    ...rest,
  };
}
const atacadao = { storeId: 'atacadao', storeName: 'Atacadão' };
const noStore = { storeId: null, storeName: null };

const NO_CHOICE: HistoryChoices = { unit: null, period: null, store: null, more: 0 };

describe('as compras do produto', () => {
  it('arroz por unidade: o preço é o impresso, e a linha guarda quanto levou e quanto pagou', () => {
    const [rice] = toPurchases([line('2026-10-10', 25.9, { quantity: 2 })]);
    expect(rice).toMatchObject({
      receiptId: 'r-2026-10-10-assai',
      store: 'assai',
      storeName: 'Assaí',
      day: '2026-10-10',
      quantity: 2,
      unit: 'un',
      baseUnit: 'un',
      price: 25.9,
      paid: 51.8,
      discounted: false,
    });
  });

  it('vêm da mais recente para a mais antiga, qualquer que seja a ordem em que o banco as deu', () => {
    const days = toPurchases([line('2026-08-12', 21.9), line('2026-10-10', 25.9), line('2026-07-12', 22.9), line('2026-09-03', 27.9)]).map((p) => p.day);
    expect(days).toEqual(['2026-10-10', '2026-09-03', '2026-08-12', '2026-07-12']);
  });

  it('leite comprado em ml entra por litro; a quantidade continua como na nota', () => {
    const [milk] = toPurchases([line('2026-10-10', 0.0049, { quantity: 500, unit: 'ml', totalPrice: 2.45 })]);
    expect(milk).toMatchObject({ baseUnit: 'l', quantity: 500, unit: 'ml', paid: 2.45, discounted: false });
    expect(milk.price).toBeCloseTo(4.9, 6);
    const [bottle] = toPurchases([line('2026-10-10', 5.49, { unit: 'l' })]);
    expect(bottle).toMatchObject({ baseUnit: 'l', price: 5.49 });
  });

  it('banana por kg e por unidade: cada compra fica na sua unidade', () => {
    const purchases = toPurchases([
      line('2026-10-10', 6.99, { quantity: 1.2, unit: 'kg', totalPrice: 8.39 }),
      line('2026-10-03', 0.0059, { quantity: 800, unit: 'g', totalPrice: 4.72 }),
      line('2026-09-20', 0.9, { quantity: 6 }),
    ]);
    expect(purchases.map((p) => p.baseUnit)).toEqual(['kg', 'kg', 'un']);
    expect(purchases[1].price).toBeCloseTo(5.9, 6);
  });

  it('nota sem mercado conta, com o nome "Mercado não informado"', () => {
    const [purchase] = toPurchases([line('2026-10-10', 25.9, noStore)]);
    expect(purchase).toMatchObject({ store: NO_STORE, storeName: 'Mercado não informado' });
  });

  it('linhas iguais da mesma nota (o caixa passou uma a uma) são uma compra só, somada', () => {
    const purchases = toPurchases([line('2026-10-10', 5.49), line('2026-10-10', 5.49), line('2026-10-10', 5.49), line('2026-10-03', 5.49)]);
    expect(purchases).toHaveLength(2);
    expect(purchases[0]).toMatchObject({ day: '2026-10-10', quantity: 3, paid: 16.47, price: 5.49, discounted: false });
    expect(purchases[1]).toMatchObject({ day: '2026-10-03', quantity: 1, paid: 5.49 });
  });

  it('na mesma nota, preço impresso ou unidade diferentes ficam em compras separadas', () => {
    const purchases = toPurchases([
      line('2026-10-10', 5.49),
      line('2026-10-10', 6.29),
      line('2026-10-10', 6.99, { quantity: 1.2, unit: 'kg', totalPrice: 8.39 }),
    ]);
    expect(purchases).toHaveLength(3);
    expect(new Set(purchases.map((p) => p.receiptId)).size).toBe(1);
  });

  it('notas diferentes no mesmo instante (data digitada cai ao meio-dia) ficam sempre na mesma ordem', () => {
    const a = line('2026-10-10', 5.49, { receiptId: 'r-a', time: '12:00' });
    const b = line('2026-10-10', 6.29, { receiptId: 'r-b', time: '12:00' });
    expect(toPurchases([a, b]).map((p) => p.receiptId)).toEqual(toPurchases([b, a]).map((p) => p.receiptId));
  });

  it('o dia é o do aparelho: 23h30 do dia 31 é julho, e dez minutos depois da meia-noite já é agosto', () => {
    const purchases = toPurchases([
      line('2026-07-31', 22.9, { time: '23:30' }),
      line('2026-08-01', 23.9, { time: '00:10', receiptId: 'r-madrugada' }),
    ]);
    expect(purchases.map((p) => p.day)).toEqual(['2026-08-01', '2026-07-31']);
  });

  it('virada de ano: a compra das 23h50 de 31 de dezembro fica em dezembro', () => {
    const [newYear, eve] = toPurchases([line('2025-12-31', 22.9, { time: '23:50' }), line('2026-01-01', 23.9, { time: '00:05' })]);
    expect([eve.day, newYear.day]).toEqual(['2025-12-31', '2026-01-01']);
  });
});

describe('desconto do item', () => {
  it(`a tolerância é de ${DISCOUNT_TOLERANCE_CENTS} centavos`, () => {
    expect(DISCOUNT_TOLERANCE_CENTS).toBe(2);
  });

  it('item por peso arredonda: um centavo ou dois não é desconto', () => {
    // 0,755 kg x R$ 39,90 = R$ 30,1245; a nota cobra R$ 30,12.
    expect(hasDiscount({ quantity: 0.755, unitPrice: 39.9, totalPrice: 30.12 })).toBe(false);
    expect(hasDiscount({ quantity: 2, unitPrice: 25.9, totalPrice: 51.8 })).toBe(false);
    expect(hasDiscount({ quantity: 2, unitPrice: 25.9, totalPrice: 51.79 })).toBe(false);
    expect(hasDiscount({ quantity: 2, unitPrice: 25.9, totalPrice: 51.78 })).toBe(false);
  });

  it('três centavos abaixo já é desconto; total acima do preço não é', () => {
    expect(hasDiscount({ quantity: 2, unitPrice: 25.9, totalPrice: 51.77 })).toBe(true);
    expect(hasDiscount({ quantity: 2, unitPrice: 25.9, totalPrice: 46.8 })).toBe(true);
    expect(hasDiscount({ quantity: 2, unitPrice: 25.9, totalPrice: 53 })).toBe(false);
  });

  it('a compra com desconto fica marcada e mostra o que foi pago; o preço continua o impresso', () => {
    const [purchase] = toPurchases([line('2026-10-10', 25.9, { quantity: 2, totalPrice: 46.8 })]);
    expect(purchase).toMatchObject({ price: 25.9, paid: 46.8, discounted: true });
    expect(purchaseRow(purchase, TODAY)).toMatchObject({ price: 'R$ 25,90/un', detail: '10 out · 2 un · pagou R$ 46,80', discounted: true });
  });

  it('linhas iguais somadas: basta uma com desconto, e os arredondamentos de cada uma não se somam em desconto', () => {
    const rounded = { quantity: 0.755, unit: 'kg', totalPrice: 30.12 };
    const [weights] = toPurchases([line('2026-10-10', 39.9, rounded), line('2026-10-10', 39.9, rounded), line('2026-10-10', 39.9, rounded), line('2026-10-10', 39.9, rounded), line('2026-10-10', 39.9, rounded), line('2026-10-10', 39.9, rounded)]);
    expect(weights).toMatchObject({ quantity: 4.53, paid: 180.72, discounted: false });
    const [mixed] = toPurchases([line('2026-10-10', 5.49), line('2026-10-10', 5.49, { totalPrice: 4.49 })]);
    expect(mixed).toMatchObject({ quantity: 2, paid: 9.98, discounted: true });
  });
});

describe('unidades que não se comparam', () => {
  const banana = toPurchases([
    line('2026-10-10', 0.9, { quantity: 6 }),
    line('2026-10-03', 6.99, { unit: 'kg' }),
    line('2026-09-20', 5.99, { unit: 'kg' }),
    line('2026-09-01', 0.0059, { quantity: 800, unit: 'g', totalPrice: 4.72 }),
  ]);

  it('as unidades do produto, em ordem fixa (un, kg, l)', () => {
    expect(purchaseUnits(banana)).toEqual(['un', 'kg']);
    expect(purchaseUnits(toPurchases([line('2026-10-10', 5.49, { unit: 'l' }), line('2026-10-01', 4, { unit: 'kg' })]))).toEqual(['kg', 'l']);
    expect([unitLabel('un'), unitLabel('kg'), unitLabel('l')]).toEqual(['por unidade', 'por kg', 'por litro']);
  });

  it('o padrão é a unidade com mais compras (g e kg contam juntos)', () => {
    expect(defaultUnit(banana)).toBe('kg');
  });

  it('no empate, a unidade da compra mais recente', () => {
    expect(defaultUnit(toPurchases([line('2026-10-10', 0.9), line('2026-10-03', 6.99, { unit: 'kg' })]))).toBe('un');
    expect(defaultUnit(toPurchases([line('2026-10-03', 0.9), line('2026-10-10', 6.99, { unit: 'kg' })]))).toBe('kg');
    expect(defaultUnit([])).toBeNull();
  });

  it('a seção mostra uma unidade de cada vez e nunca mistura os preços', () => {
    const view = priceHistoryView(banana, { ...NO_CHOICE, period: 'tudo' }, { today: TODAY, productName: 'Banana' })!;
    expect(view.units).toEqual([
      { value: 'un', label: 'por unidade' },
      { value: 'kg', label: 'por kg' },
    ]);
    expect(view.unit).toBe('kg');
    expect(view.rows.map((r) => r.price)).toEqual(['R$ 6,99/kg', 'R$ 5,99/kg', 'R$ 5,90/kg']);
    expect(view.rows[2].detail).toBe('1 set · 800 g · pagou R$ 4,72');
    const byUnit = priceHistoryView(banana, { ...NO_CHOICE, period: 'tudo', unit: 'un' }, { today: TODAY, productName: 'Banana' })!;
    expect(byUnit.rows.map((r) => r.price)).toEqual(['R$ 0,90/un']);
    expect(byUnit.summary).toEqual(['R$ 0,90/un · Assaí · 10 out', '1 compra']);
  });

  it('produto com uma unidade só não tem o que escolher', () => {
    const view = priceHistoryView(toPurchases([line('2026-10-10', 25.9)]), NO_CHOICE, { today: TODAY, productName: 'Arroz' })!;
    expect(view.units).toEqual([]);
    expect(view.unit).toBe('un');
  });

  it('unidade escolhida que o produto não tem vale o padrão', () => {
    const view = priceHistoryView(banana, { ...NO_CHOICE, unit: 'l' }, { today: TODAY, productName: 'Banana' })!;
    expect(view.unit).toBe('kg');
  });
});

describe('período', () => {
  it('conta para trás a partir de hoje, pelo calendário', () => {
    expect(periodStart('3m', TODAY)).toBe('2026-07-13');
    expect(periodStart('6m', TODAY)).toBe('2026-04-13');
    expect(periodStart('1a', TODAY)).toBe('2025-10-13');
    expect(periodStart('tudo', TODAY)).toBeNull();
    // Dia que não existe no mês de chegada vira o último dia dele.
    expect(periodStart('3m', '2026-05-31')).toBe('2026-02-28');
  });

  it('o primeiro dia do período entra; a véspera, não', () => {
    const purchases = toPurchases([line('2026-07-13', 22.9, { time: '00:10' }), line('2026-07-12', 21.9, { time: '23:50' })]);
    expect(inPeriod(purchases, '3m', TODAY).map((p) => p.day)).toEqual(['2026-07-13']);
    expect(inPeriod(purchases, '6m', TODAY)).toHaveLength(2);
    expect(inPeriod(purchases, 'tudo', TODAY)).toHaveLength(2);
  });

  it('a compra das 22h do dia 31 fica no mês dela', () => {
    // Hoje é 31 de outubro: "3 meses" começa em 31 de julho, e a compra daquela noite entra.
    const purchases = toPurchases([line('2026-07-31', 22.9, { time: '22:00' }), line('2026-07-30', 21.9, { time: '22:00' })]);
    expect(inPeriod(purchases, '3m', '2026-10-31').map((p) => p.day)).toEqual(['2026-07-31']);
  });

  it('o padrão é "6 meses" com pelo menos duas compras neles; senão, "Tudo"', () => {
    expect(defaultPeriod(toPurchases([line('2026-10-10', 25.9), line('2026-05-02', 22.9)]), TODAY)).toBe('6m');
    expect(defaultPeriod(toPurchases([line('2026-10-10', 25.9), line('2026-03-02', 22.9)]), TODAY)).toBe('tudo');
    expect(defaultPeriod(toPurchases([line('2025-03-02', 22.9), line('2025-02-02', 22.9)]), TODAY)).toBe('tudo');
    expect(defaultPeriod([], TODAY)).toBe('tudo');
  });

  it('o padrão olha só a unidade à vista', () => {
    // Duas compras por kg nos últimos 6 meses, mas uma só por unidade.
    const banana = toPurchases([
      line('2026-10-10', 6.99, { unit: 'kg' }),
      line('2026-09-10', 5.99, { unit: 'kg' }),
      line('2026-10-01', 0.9),
      line('2025-10-01', 0.8, { receiptId: 'r-antiga' }),
    ]);
    const context = { today: TODAY, productName: 'Banana' };
    expect(priceHistoryView(banana, { ...NO_CHOICE, unit: 'kg' }, context)!.period).toBe('6m');
    expect(priceHistoryView(banana, { ...NO_CHOICE, unit: 'un' }, context)!.period).toBe('tudo');
    // Escolhido pela pessoa, fica.
    expect(priceHistoryView(banana, { ...NO_CHOICE, unit: 'un', period: '3m' }, context)!.period).toBe('3m');
  });
});

describe('mercados', () => {
  it('"Todos" e um chip por mercado, por nome, com o sem mercado por último', () => {
    const purchases = toPurchases([line('2026-10-10', 25.9, noStore), line('2026-10-03', 25.9), line('2026-09-03', 24.9, atacadao)]);
    expect(storeOptions(purchases)).toEqual([
      { value: ALL_STORES, label: 'Todos' },
      { value: 'assai', label: 'Assaí' },
      { value: 'atacadao', label: 'Atacadão' },
      { value: NO_STORE, label: 'Mercado não informado' },
    ]);
  });

  it('com um mercado só, nenhum chip', () => {
    expect(storeOptions(toPurchases([line('2026-10-10', 25.9), line('2026-10-03', 25.9)]))).toEqual([]);
    expect(storeOptions([])).toEqual([]);
  });
});

describe('porcento', () => {
  it('inteiro, para cima e para baixo', () => {
    expect(percentChange(22.9, 25.9)).toBe(13);
    expect(percentChange(28.1, 25.9)).toBe(-8);
    expect(percentChange(25.9, 25.9)).toBe(0);
    expect(percentChange(10, 30)).toBe(200);
    expect(percentChange(10, 0)).toBe(-100);
  });

  it('0,4% é zero; a metade arredonda para longe do zero, dos dois lados', () => {
    expect(percentChange(100, 100.4)).toBe(0);
    expect(percentChange(100, 99.6)).toBe(0);
    expect(percentChange(8, 8.04)).toBe(1);
    expect(percentChange(8, 7.96)).toBe(-1);
    expect(percentChange(20, 20.1)).toBe(1);
    expect(percentChange(100, 100.49)).toBe(0);
    expect(Object.is(percentChange(100, 99.9), 0)).toBe(true);
  });

  it('preço de partida zero nunca divide', () => {
    expect(percentChange(0, 5)).toBeNull();
    expect(percentChange(0, 0)).toBeNull();
  });
});

describe('as frases do resumo', () => {
  const [last, first] = toPurchases([line('2026-10-10', 25.9), line('2026-07-12', 22.9)]);

  it('a última compra', () => {
    expect(latestSentence(last, TODAY)).toBe('R$ 25,90/un · Assaí · 10 out');
    const [old] = toPurchases([line('2025-12-20', 6.99, { unit: 'kg', ...noStore })]);
    expect(latestSentence(old, TODAY)).toBe('R$ 6,99/kg · Mercado não informado · 20 dez 2025');
  });

  it('subiu, caiu, mesmo preço', () => {
    expect(changeSentence(first, last, TODAY)).toBe('Subiu 13% desde 12 jul (era R$ 22,90)');
    const [, dearer] = toPurchases([line('2026-10-10', 25.9), line('2026-07-12', 28.1)]);
    expect(changeSentence(dearer, last, TODAY)).toBe('Caiu 8% desde 12 jul (era R$ 28,10)');
    const [, same] = toPurchases([line('2026-10-10', 25.9), line('2026-07-12', 25.9)]);
    expect(changeSentence(same, last, TODAY)).toBe('Mesmo preço desde 12 jul');
  });

  it('mudança que arredonda para 0% é "mesmo preço"; meio porcento já é 1%', () => {
    // 0,4% para cima e para baixo.
    const [up, base] = toPurchases([line('2026-10-10', 100.4), line('2026-07-12', 100)]);
    expect(changeSentence(base, up, TODAY)).toBe('Mesmo preço desde 12 jul');
    const [down] = toPurchases([line('2026-10-10', 99.6)]);
    expect(changeSentence(base, down, TODAY)).toBe('Mesmo preço desde 12 jul');
    const [half, eight] = toPurchases([line('2026-10-10', 8.04), line('2026-07-12', 8)]);
    expect(changeSentence(eight, half, TODAY)).toBe('Subiu 1% desde 12 jul (era R$ 8,00)');
    // Diferença que nem aparece na tela (quarta casa do preço).
    const [fine, finer] = toPurchases([line('2026-10-10', 5.9991), line('2026-07-12', 5.999)]);
    expect(changeSentence(finer, fine, TODAY)).toBe('Mesmo preço desde 12 jul');
  });

  it('só com compras em dois dias diferentes', () => {
    const [evening, morning] = toPurchases([line('2026-10-10', 25.9, { time: '19:00', receiptId: 'r-noite' }), line('2026-10-10', 22.9, { time: '09:00' })]);
    expect(changeSentence(morning, evening, TODAY)).toBeNull();
    expect(changeSentence(last, last, TODAY)).toBeNull();
  });

  it('preço de partida zero: diz que subiu, sem porcento', () => {
    const [now, free] = toPurchases([line('2026-10-10', 5.49), line('2026-07-12', 0)]);
    expect(changeSentence(free, now, TODAY)).toBe('Subiu desde 12 jul (era R$ 0,00)');
    const [stillFree, wasFree] = toPurchases([line('2026-10-10', 0), line('2026-07-12', 0)]);
    expect(changeSentence(wasFree, stillFree, TODAY)).toBe('Mesmo preço desde 12 jul');
  });

  it('de um mercado para outro, a frase diz de onde era o preço', () => {
    const [, other] = toPurchases([line('2026-10-10', 25.9), line('2026-07-12', 22.9, atacadao)]);
    expect(changeSentence(other, last, TODAY)).toBe('Subiu 13% desde 12 jul (era R$ 22,90, em outro mercado: Atacadão)');
    const [, sameOther] = toPurchases([line('2026-10-10', 25.9), line('2026-07-12', 25.9, atacadao)]);
    expect(changeSentence(sameOther, last, TODAY)).toBe('Mesmo preço desde 12 jul (em outro mercado: Atacadão)');
    const [, unknown] = toPurchases([line('2026-10-10', 25.9), line('2026-07-12', 22.9, noStore)]);
    expect(changeSentence(unknown, last, TODAY)).toBe('Subiu 13% desde 12 jul (era R$ 22,90, numa compra sem mercado informado)');
    // A última compra sem mercado e a primeira com: o outro mercado é o da primeira.
    const [blank, named] = toPurchases([line('2026-10-10', 25.9, noStore), line('2026-07-12', 22.9)]);
    expect(changeSentence(named, blank, TODAY)).toBe('Subiu 13% desde 12 jul (era R$ 22,90, em outro mercado: Assaí)');
  });

  it('a data leva o ano quando não é o de hoje', () => {
    const [, lastYear] = toPurchases([line('2026-10-10', 25.9), line('2025-11-02', 22.9)]);
    expect(changeSentence(lastYear, last, TODAY)).toBe('Subiu 13% desde 2 nov 2025 (era R$ 22,90)');
  });

  it('menor e maior, com mercado e data', () => {
    const purchases = toPurchases([line('2026-10-10', 25.9), line('2026-09-03', 27.9), line('2026-08-12', 21.9, atacadao), line('2026-07-12', 22.9)]);
    expect(rangeSentence(purchases, '6m', TODAY)).toBe('Menor: R$ 21,90 (Atacadão, 12 ago) · Maior: R$ 27,90 (Assaí, 3 set)');
  });

  it('no empate do menor ou do maior, vale a compra mais recente', () => {
    const purchases = toPurchases([
      line('2026-10-10', 21.9, atacadao),
      line('2026-09-03', 27.9, atacadao),
      line('2026-08-12', 21.9),
      line('2026-07-12', 27.9),
    ]);
    const range = priceRange(purchases)!;
    expect([range.lowest.day, range.highest.day]).toEqual(['2026-10-10', '2026-09-03']);
    // A ordem em que chegam não muda quem vence.
    const reversed = priceRange([...purchases].reverse())!;
    expect([reversed.lowest.day, reversed.highest.day]).toEqual(['2026-10-10', '2026-09-03']);
    expect(rangeSentence(purchases, 'tudo', TODAY)).toBe('Menor: R$ 21,90 (Atacadão, 10 out) · Maior: R$ 27,90 (Atacadão, 3 set)');
  });

  it('todas no mesmo preço: uma frase só', () => {
    const purchases = toPurchases([line('2026-10-10', 25.9), line('2026-09-03', 25.9), line('2026-08-12', 25.9, atacadao)]);
    expect(rangeSentence(purchases, '6m', TODAY)).toBe('Sempre R$ 25,90 neste período');
    expect(rangeSentence(purchases, 'tudo', TODAY)).toBe('Sempre R$ 25,90');
    expect(rangeSentence(purchases.slice(0, 1), '6m', TODAY)).toBeNull();
    expect(rangeSentence([], '6m', TODAY)).toBeNull();
    expect(priceRange([])).toBeNull();
  });

  it('"costuma custar" é a mediana, a partir de três compras', () => {
    const three = toPurchases([line('2026-10-10', 25.9), line('2026-09-03', 27.9), line('2026-08-12', 21.9)]);
    expect(medianPrice(three)).toBe(25.9);
    expect(usualSentence(three)).toBe('Costuma custar R$ 25,90');
    const four = toPurchases([line('2026-10-10', 25.9), line('2026-09-03', 27.9), line('2026-08-12', 21.9), line('2026-07-12', 23.1)]);
    expect(medianPrice(four)).toBeCloseTo(24.5, 6);
    expect(usualSentence(four)).toBe('Costuma custar R$ 24,50');
    expect(usualSentence(three.slice(0, 2))).toBeNull();
    expect(medianPrice([])).toBeNull();
    // Preço que nunca mudou já está dito em "Sempre R$ …".
    expect(usualSentence(toPurchases([line('2026-10-10', 25.9), line('2026-09-03', 25.9), line('2026-08-12', 25.9)]))).toBeNull();
  });

  it('quantas compras, no singular e no plural', () => {
    expect(countSentence(8, '6m')).toBe('8 compras em 6 meses');
    expect(countSentence(1, '6m')).toBe('1 compra em 6 meses');
    expect(countSentence(2, '3m')).toBe('2 compras em 3 meses');
    expect(countSentence(5, '1a')).toBe('5 compras em 1 ano');
    expect(countSentence(1, 'tudo')).toBe('1 compra');
    expect(countSentence(12, 'tudo')).toBe('12 compras');
  });

  it('período sem compra: diz isso e onde ver mais', () => {
    expect(emptyPeriodSentence('3m')).toBe('Nenhuma compra nos últimos 3 meses. Veja em "Tudo".');
    expect(emptyPeriodSentence('6m')).toBe('Nenhuma compra nos últimos 6 meses. Veja em "Tudo".');
    expect(emptyPeriodSentence('1a')).toBe('Nenhuma compra no último ano. Veja em "Tudo".');
    expect(emptyPeriodSentence('tudo')).toBe('Nenhuma compra ainda.');
    expect(summarize([], { period: '3m', today: TODAY })).toEqual(['Nenhuma compra nos últimos 3 meses. Veja em "Tudo".']);
  });

  it('o resumo inteiro, na ordem da tela', () => {
    const purchases = toPurchases([line('2026-10-10', 25.9), line('2026-09-03', 27.9), line('2026-08-12', 21.9, atacadao), line('2026-07-12', 22.9)]);
    expect(summarize(purchases, { period: '6m', today: TODAY })).toEqual([
      'R$ 25,90/un · Assaí · 10 out',
      'Subiu 13% desde 12 jul (era R$ 22,90)',
      'Menor: R$ 21,90 (Atacadão, 12 ago) · Maior: R$ 27,90 (Assaí, 3 set)',
      'Costuma custar R$ 24,40',
      '4 compras em 6 meses',
    ]);
  });

  it('com uma compra, o resumo é ela', () => {
    expect(summarize(toPurchases([line('2026-10-10', 25.9)]), { period: 'tudo', today: TODAY })).toEqual(['R$ 25,90/un · Assaí · 10 out', '1 compra']);
  });

  it('duas compras no mesmo dia: sem "subiu" nem "costuma"; menor e maior continuam', () => {
    const purchases = toPurchases([line('2026-10-10', 25.9, { time: '19:00', ...atacadao }), line('2026-10-10', 22.9, { time: '09:00' })]);
    expect(summarize(purchases, { period: '6m', today: TODAY })).toEqual([
      'R$ 25,90/un · Atacadão · 10 out',
      'Menor: R$ 22,90 (Assaí, 10 out) · Maior: R$ 25,90 (Atacadão, 10 out)',
      '2 compras em 6 meses',
    ]);
  });
});

describe('o gráfico', () => {
  it('pontos da mais antiga para a mais recente: x pelo tempo, y entre o menor e o maior preço', () => {
    // 1 jul, 11 jul (10 dias depois) e 10 ago (40 dias depois).
    const points = chartPoints(toPurchases([line('2026-08-10', 30), line('2026-07-11', 20), line('2026-07-01', 25)]));
    expect(points.map((p) => [p.x, p.y])).toEqual([
      [0, 0.5],
      [0.25, 0],
      [1, 1],
    ]);
    expect(points.map((p) => p.latest)).toEqual([false, false, true]);
  });

  it('um ponto só fica no meio', () => {
    expect(chartPoints(toPurchases([line('2026-10-10', 25.9)]))).toEqual([expect.objectContaining({ x: 0.5, y: 0.5, latest: true })]);
    expect(chartPoints([])).toEqual([]);
  });

  it('todas no mesmo preço: uma linha reta a meia altura', () => {
    const points = chartPoints(toPurchases([line('2026-10-10', 25.9), line('2026-09-10', 25.9), line('2026-08-11', 25.9)]));
    expect(points.map((p) => p.y)).toEqual([0.5, 0.5, 0.5]);
    expect(points.map((p) => p.x)).toEqual([0, 0.5, 1]);
  });

  it('preços que só diferem depois dos centavos também são uma linha reta', () => {
    const points = chartPoints(toPurchases([line('2026-10-10', 5.9991), line('2026-09-10', 5.999)]));
    expect(points.map((p) => p.y)).toEqual([0.5, 0.5]);
  });

  it('duas compras no mesmo dia têm o mesmo x, na ordem da hora', () => {
    const points = chartPoints(
      toPurchases([
        line('2026-10-10', 30, { time: '19:00', receiptId: 'r-noite' }),
        line('2026-10-10', 20, { time: '09:00' }),
        line('2026-10-01', 25),
      ]),
    );
    expect(points.map((p) => [p.x, p.y])).toEqual([
      [0, 0.5],
      [1, 0],
      [1, 1],
    ]);
    expect(points.map((p) => p.latest)).toEqual([false, false, true]);
  });

  it('só as compras de um dia: todas no meio da largura', () => {
    const points = chartPoints(toPurchases([line('2026-10-10', 30, { time: '19:00', receiptId: 'r-noite' }), line('2026-10-10', 20, { time: '09:00' })]));
    expect(points.map((p) => [p.x, p.y])).toEqual([
      [0.5, 0],
      [0.5, 1],
    ]);
  });

  it('o dia do ponto é o do aparelho: a compra das 23h50 não escorrega para o dia seguinte', () => {
    const points = chartPoints(toPurchases([line('2026-08-02', 30), line('2026-07-31', 20, { time: '23:50' }), line('2026-07-30', 25)]));
    expect(points.map((p) => p.x)).toEqual([0, 1 / 3, 1]);
  });

  it('as legendas e o mesmo em palavras', () => {
    const purchases = toPurchases([line('2026-10-10', 25.9), line('2026-09-03', 27.9), line('2026-08-12', 21.9, atacadao), line('2026-07-12', 22.9)]);
    const chart = priceChart(purchases, { productName: 'Arroz', today: TODAY })!;
    expect(chart).toMatchObject({ lowLabel: 'R$ 21,90', highLabel: 'R$ 27,90', firstDate: '12 jul', lastDate: '10 out' });
    expect(chart.label).toBe('Preço de Arroz de 12 jul a 10 out: de R$ 21,90 a R$ 27,90; o último, R$ 25,90');
    expect(chart.points).toHaveLength(4);
  });

  it('preço que não mudou e datas de outro ano', () => {
    const chart = priceChart(toPurchases([line('2026-01-10', 25.9), line('2025-12-03', 25.9)]), { productName: 'Arroz', today: TODAY })!;
    expect(chart).toMatchObject({ lowLabel: 'R$ 25,90', highLabel: 'R$ 25,90', firstDate: '3 dez 2025', lastDate: '10 jan' });
    expect(chart.label).toBe('Preço de Arroz de 3 dez 2025 a 10 jan: sempre R$ 25,90');
  });

  it('sem compras em dois dias diferentes não há gráfico', () => {
    const context = { productName: 'Arroz', today: TODAY };
    expect(priceChart([], context)).toBeNull();
    expect(priceChart(toPurchases([line('2026-10-10', 25.9)]), context)).toBeNull();
    expect(priceChart(toPurchases([line('2026-10-10', 30, { time: '19:00', receiptId: 'r-noite' }), line('2026-10-10', 20, { time: '09:00' })]), context)).toBeNull();
  });
});

describe('as linhas da lista', () => {
  it('mercado, data, quanto levou e pagou, e o preço impresso', () => {
    const [rice] = toPurchases([line('2026-10-10', 25.9, { quantity: 2 })]);
    expect(purchaseRow(rice, TODAY)).toEqual({
      key: rice.key,
      receiptId: 'r-2026-10-10-assai',
      title: 'Assaí',
      detail: '10 out · 2 un · pagou R$ 51,80',
      price: 'R$ 25,90/un',
      discounted: false,
    });
  });

  it('a data leva o ano quando não é o de hoje; peso e volume aparecem como na nota, com o preço por kg ou litro', () => {
    const [cheese] = toPurchases([line('2025-12-20', 39.9, { quantity: 0.755, unit: 'kg', totalPrice: 30.12, ...noStore })]);
    expect(purchaseRow(cheese, TODAY)).toMatchObject({ title: 'Mercado não informado', detail: '20 dez 2025 · 0,755 kg · pagou R$ 30,12', price: 'R$ 39,90/kg' });
    const [milk] = toPurchases([line('2026-10-10', 0.0049, { quantity: 500, unit: 'ml', totalPrice: 2.45 })]);
    expect(purchaseRow(milk, TODAY)).toMatchObject({ detail: '10 out · 500 ml · pagou R$ 2,45', price: 'R$ 4,90/l' });
  });

  it('"Ver mais" diz quantas faltam, no singular e no plural', () => {
    expect(moreLabel(12)).toBe('Ver mais (faltam 12)');
    expect(moreLabel(1)).toBe('Ver mais (falta 1)');
    expect(moreLabel(0)).toBeNull();
  });
});

describe('a seção inteira', () => {
  const context = { today: TODAY, productName: 'Arroz' };
  /** `count` compras, uma por dia, a mais recente em 10 de outubro. */
  const daily = (count: number) =>
    toPurchases(
      Array.from({ length: count }, (_, n) => {
        const day = new Date(2026, 9, 10 - n);
        const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
        return line(iso, 20 + (n % 5));
      }),
    );

  it('produto sem compra nenhuma: nada a mostrar', () => {
    expect(priceHistoryView([], NO_CHOICE, context)).toBeNull();
  });

  it('sem escolha nenhuma: unidade com mais compras, 6 meses, todos os mercados', () => {
    const purchases = toPurchases([
      line('2026-10-10', 25.9, { quantity: 2 }),
      line('2026-09-03', 27.9),
      line('2026-08-12', 21.9, atacadao),
      line('2026-07-12', 22.9),
      line('2025-11-02', 19.9),
    ]);
    const view = priceHistoryView(purchases, NO_CHOICE, context)!;
    expect(view).toMatchObject({ unit: 'un', units: [], period: '6m', store: ALL_STORES, more: null });
    expect(view.periods.map((p) => p.label)).toEqual(['3 meses', '6 meses', '1 ano', 'Tudo']);
    expect(view.stores.map((s) => s.label)).toEqual(['Todos', 'Assaí', 'Atacadão']);
    expect(view.summary).toEqual([
      'R$ 25,90/un · Assaí · 10 out',
      'Subiu 13% desde 12 jul (era R$ 22,90)',
      'Menor: R$ 21,90 (Atacadão, 12 ago) · Maior: R$ 27,90 (Assaí, 3 set)',
      'Costuma custar R$ 24,40',
      '4 compras em 6 meses',
    ]);
    expect(view.chart?.label).toBe('Preço de Arroz de 12 jul a 10 out: de R$ 21,90 a R$ 27,90; o último, R$ 25,90');
    expect(view.rows.map((r) => `${r.title} · ${r.detail} · ${r.price}`)).toEqual([
      'Assaí · 10 out · 2 un · pagou R$ 51,80 · R$ 25,90/un',
      'Assaí · 3 set · 1 un · pagou R$ 27,90 · R$ 27,90/un',
      'Atacadão · 12 ago · 1 un · pagou R$ 21,90 · R$ 21,90/un',
      'Assaí · 12 jul · 1 un · pagou R$ 22,90 · R$ 22,90/un',
    ]);
  });

  it('o período muda o que entra; "Tudo" traz a compra antiga', () => {
    const purchases = toPurchases([line('2026-10-10', 25.9), line('2026-07-12', 22.9), line('2025-11-02', 19.9)]);
    const three = priceHistoryView(purchases, { ...NO_CHOICE, period: '3m' }, context)!;
    expect(three.summary).toEqual(['R$ 25,90/un · Assaí · 10 out', '1 compra em 3 meses']);
    expect(three.chart).toBeNull();
    const all = priceHistoryView(purchases, { ...NO_CHOICE, period: 'tudo' }, context)!;
    expect(all.summary).toEqual([
      'R$ 25,90/un · Assaí · 10 out',
      'Subiu 30% desde 2 nov 2025 (era R$ 19,90)',
      'Menor: R$ 19,90 (Assaí, 2 nov 2025) · Maior: R$ 25,90 (Assaí, 10 out)',
      'Costuma custar R$ 22,90',
      '3 compras',
    ]);
  });

  it('período sem compras: a frase que diz onde ver, sem gráfico nem linhas, e os chips de período continuam', () => {
    const purchases = toPurchases([line('2026-05-10', 25.9), line('2026-04-20', 22.9)]);
    const view = priceHistoryView(purchases, { ...NO_CHOICE, period: '3m' }, context)!;
    expect(view.summary).toEqual(['Nenhuma compra nos últimos 3 meses. Veja em "Tudo".']);
    expect(view).toMatchObject({ chart: null, rows: [], more: null, stores: [] });
    expect(view.periods).toHaveLength(4);
  });

  it('o mercado escolhido filtra o resumo, o gráfico e as linhas, e a frase não fala de outro mercado', () => {
    const purchases = toPurchases([
      line('2026-10-10', 25.9),
      line('2026-09-03', 24.9, atacadao),
      line('2026-08-12', 21.9, atacadao),
      line('2026-07-12', 22.9),
    ]);
    const all = priceHistoryView(purchases, NO_CHOICE, context)!;
    expect(all.summary[1]).toBe('Subiu 13% desde 12 jul (era R$ 22,90)');
    const atacadaoOnly = priceHistoryView(purchases, { ...NO_CHOICE, store: 'atacadao' }, context)!;
    expect(atacadaoOnly.store).toBe('atacadao');
    expect(atacadaoOnly.summary).toEqual([
      'R$ 24,90/un · Atacadão · 3 set',
      'Subiu 14% desde 12 ago (era R$ 21,90)',
      'Menor: R$ 21,90 (Atacadão, 12 ago) · Maior: R$ 24,90 (Atacadão, 3 set)',
      '2 compras em 6 meses',
    ]);
    expect(atacadaoOnly.rows.map((r) => r.title)).toEqual(['Atacadão', 'Atacadão']);
    expect(atacadaoOnly.chart?.points).toHaveLength(2);
    // Os chips continuam todos: dá para voltar a "Todos".
    expect(atacadaoOnly.stores.map((s) => s.label)).toEqual(['Todos', 'Assaí', 'Atacadão']);
  });

  it('entre mercados, sem mercado escolhido, a frase da mudança diz de onde era o preço', () => {
    const purchases = toPurchases([line('2026-10-10', 25.9), line('2026-07-12', 22.9, atacadao)]);
    expect(priceHistoryView(purchases, NO_CHOICE, context)!.summary[1]).toBe('Subiu 13% desde 12 jul (era R$ 22,90, em outro mercado: Atacadão)');
  });

  it('mercado escolhido que saiu de vista (outro período) volta a "Todos"', () => {
    const purchases = toPurchases([line('2026-10-10', 25.9), line('2026-09-20', 24.9), line('2026-05-12', 21.9, atacadao)]);
    const view = priceHistoryView(purchases, { ...NO_CHOICE, period: '3m', store: 'atacadao' }, context)!;
    expect(view.store).toBe(ALL_STORES);
    expect(view.stores).toEqual([]);
    expect(view.rows).toHaveLength(2);
  });

  it('as 10 primeiras compras, e "Ver mais" com quantas faltam: nunca um corte calado', () => {
    const purchases = daily(35);
    const first = priceHistoryView(purchases, NO_CHOICE, context)!;
    expect(first.rows).toHaveLength(10);
    expect(first.rows[0].detail).toContain('10 out');
    expect(first.more).toBe('Ver mais (faltam 25)');
    // O resumo e o gráfico são de todas, não só das que estão à vista.
    expect(first.summary.at(-1)).toBe('35 compras em 6 meses');
    expect(first.chart?.points).toHaveLength(35);
    const second = priceHistoryView(purchases, { ...NO_CHOICE, more: 1 }, context)!;
    expect(second.rows).toHaveLength(30);
    expect(second.more).toBe('Ver mais (faltam 5)');
    const third = priceHistoryView(purchases, { ...NO_CHOICE, more: 2 }, context)!;
    expect(third.rows).toHaveLength(35);
    expect(third.more).toBeNull();
  });

  it('com 10 compras ou menos não há "Ver mais"; com 11, falta 1', () => {
    expect(priceHistoryView(daily(10), NO_CHOICE, context)!.more).toBeNull();
    expect(priceHistoryView(daily(11), NO_CHOICE, context)!.more).toBe('Ver mais (falta 1)');
  });
});

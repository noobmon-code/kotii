import { describe, expect, it } from '@jest/globals';

import {
  ALL_STORES,
  changeSentence,
  chartPoints,
  chooseInHistory,
  countSentence,
  defaultPeriod,
  defaultUnit,
  DISCOUNT_TOLERANCE_CENTS,
  emptyPeriodSentence,
  hasDiscount,
  inPeriod,
  isPriced,
  latestSentence,
  medianPrice,
  moreAccessibilityLabel,
  moreLabel,
  NO_STORE,
  PACK_ITEM,
  noStorePriceSentence,
  noValueSentence,
  percentChange,
  periodStart,
  priceChart,
  priceHistoryView,
  priceRange,
  purchaseRow,
  purchaseUnits,
  rangeSentence,
  roundPrice,
  storeKey,
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

describe('a frase de "Último preço por mercado" sem nenhum mercado', () => {
  it('não diz que não há nota quando as compras existem, em notas sem mercado', () => {
    const loose = { store: NO_STORE };
    expect(noStorePriceSentence([])).toBe('Nenhuma nota confirmada com este produto ainda.');
    expect(noStorePriceSentence([loose])).toBe('A compra deste produto está numa nota sem mercado informado: veja o histórico abaixo.');
    expect(noStorePriceSentence([loose, loose, loose])).toBe('As compras deste produto estão em notas sem mercado informado: veja o histórico abaixo.');
    // Enquanto as compras não chegaram (ou a busca falhou), a frase não afirma nada sobre as notas.
    expect(noStorePriceSentence(undefined)).toBe('Nenhum preço por mercado ainda.');
  });

  it('compra com mercado e fora dos preços por mercado é a sem valor (zero não é preço): a frase não fala em nota sem mercado', () => {
    const atStore = { store: storeKey('Assaí') };
    expect(noStorePriceSentence([atStore])).toBe('A compra deste produto está sem valor: veja o histórico abaixo.');
    expect(noStorePriceSentence([atStore, atStore])).toBe('As compras deste produto estão sem valor: veja o histórico abaixo.');
    expect(noStorePriceSentence([atStore, { store: NO_STORE }])).toBe(
      'As compras deste produto estão sem valor ou em notas sem mercado informado: veja o histórico abaixo.',
    );
  });
});

describe('as compras do produto', () => {
  it('arroz por unidade: o preço é o impresso, e a linha guarda quanto levou e quanto pagou', () => {
    const [rice] = toPurchases([line('2026-10-10', 25.9, { quantity: 2 })]);
    expect(rice).toMatchObject({
      receiptId: 'r-2026-10-10-assai',
      store: storeKey('Assaí'),
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

  it('linha em g ou ml: o preço guardado tem quatro casas, e o que ele perde ali não vira desconto', () => {
    // 900 ml por R$ 7,70 com o preço em branco: o app guarda R$ 0,0086 por ml (7,70 / 900 = 0,008555…).
    expect(hasDiscount({ quantity: 900, unitPrice: 0.0086, totalPrice: 7.7 })).toBe(false);
    const [juice] = toPurchases([line('2026-10-10', 0.0086, { quantity: 900, unit: 'ml', totalPrice: 7.7 })]);
    expect(juice).toMatchObject({ price: 8.6, baseUnit: 'l', paid: 7.7, discounted: false });
    // 1000 g a R$ 39,95 o kg: por grama, R$ 0,03995 é guardado como R$ 0,04.
    expect(hasDiscount({ quantity: 1000, unitPrice: 0.04, totalPrice: 39.95 })).toBe(false);
    // Desconto de verdade numa linha dessas continua marcado.
    expect(hasDiscount({ quantity: 900, unitPrice: 0.0086, totalPrice: 6.99 })).toBe(true);
    expect(hasDiscount({ quantity: 1000, unitPrice: 0.04, totalPrice: 39.9 })).toBe(true);
  });

  it('linhas por unidade e por kg continuam como eram', () => {
    // 0,345 kg x R$ 39,90 = R$ 13,7655.
    expect(hasDiscount({ quantity: 0.345, unitPrice: 39.9, totalPrice: 13.75 })).toBe(false);
    expect(hasDiscount({ quantity: 0.345, unitPrice: 39.9, totalPrice: 13.74 })).toBe(true);
    expect(hasDiscount({ quantity: 3, unitPrice: 1.1, totalPrice: 3.28 })).toBe(false);
    expect(hasDiscount({ quantity: 3, unitPrice: 1.1, totalPrice: 3.27 })).toBe(true);
    // A diferença continua arredondada para centavos antes de comparar: R$ 1,025 pago R$ 1,00 fica nos 2 centavos.
    expect(hasDiscount({ quantity: 1, unitPrice: 1.025, totalPrice: 1 })).toBe(false);
    // De graça com preço impresso: desconto do valor inteiro.
    expect(hasDiscount({ quantity: 1, unitPrice: 5.49, totalPrice: 0 })).toBe(true);
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
      { value: storeKey('Assaí'), label: 'Assaí' },
      { value: storeKey('Atacadão'), label: 'Atacadão' },
      { value: NO_STORE, label: 'Mercado não informado' },
    ]);
  });

  it('com um mercado só, nenhum chip', () => {
    expect(storeOptions(toPurchases([line('2026-10-10', 25.9), line('2026-10-03', 25.9)]))).toEqual([]);
    expect(storeOptions([])).toEqual([]);
  });

  // Duas filiais de uma rede (um CNPJ cada, o mesmo nome na nota), ou a mesma loja cadastrada duas vezes.
  const branchA = { storeId: 'sendas-1', storeName: 'Sendas Distribuidora S/A' };
  const branchB = { storeId: 'sendas-2', storeName: 'Sendas Distribuidora S/A' };

  it('nesta seção o mercado é o nome: duas lojas com o mesmo nome são um chip só', () => {
    const branches = toPurchases([line('2026-10-10', 25.9, branchA), line('2026-09-03', 23.9, branchB)]);
    expect(branches[0].store).toBe(branches[1].store);
    // Um nome só à vista: não há o que escolher.
    expect(storeOptions(branches)).toEqual([]);
    const withOther = toPurchases([line('2026-10-10', 25.9, branchA), line('2026-09-03', 23.9, branchB), line('2026-08-12', 21.9, atacadao)]);
    expect(storeOptions(withOther).map((s) => s.label)).toEqual(['Todos', 'Atacadão', 'Sendas Distribuidora S/A']);
  });

  it('entre duas lojas de mesmo nome a frase não fala em "outro mercado", e o filtro mostra as compras das duas', () => {
    const purchases = toPurchases([line('2026-10-10', 25.9, branchA), line('2026-09-03', 23.9, branchB), line('2026-08-12', 21.9, atacadao)]);
    const context = { today: TODAY, productName: 'Arroz' };
    const [last, first] = purchases;
    expect(changeSentence(first, last, TODAY)).toBe('Subiu 8% desde 3 set (era R$ 23,90)');
    const view = priceHistoryView(purchases, { ...NO_CHOICE, store: storeKey('Sendas Distribuidora S/A') }, context)!;
    expect(view.store).toBe(storeKey('Sendas Distribuidora S/A'));
    expect(view.rows.map((r) => `${r.receiptId} · ${r.title}`)).toEqual([
      'r-2026-10-10-sendas-1 · Sendas Distribuidora S/A',
      'r-2026-09-03-sendas-2 · Sendas Distribuidora S/A',
    ]);
    expect(view.summary).toEqual([
      'R$ 25,90/un · Sendas Distribuidora S/A · 10 out',
      'Subiu 8% desde 3 set (era R$ 23,90)',
      'Menor: R$ 23,90 (Sendas Distribuidora S/A, 3 set) · Maior: R$ 25,90 (Sendas Distribuidora S/A, 10 out)',
      '2 compras em 6 meses',
    ]);
  });

  it('nomes que só mudam na caixa ou nos espaços das pontas são o mesmo mercado; o chip leva o nome da compra mais recente', () => {
    expect(storeKey('  ASSAÍ Atacadista ')).toBe(storeKey('Assaí atacadista'));
    expect(storeKey('Assaí')).not.toBe(storeKey('Assai'));
    const purchases = toPurchases([
      line('2026-10-10', 25.9, { storeId: 'a2', storeName: 'Assaí Atacadista' }),
      line('2026-09-03', 23.9, { storeId: 'a1', storeName: ' ASSAÍ ATACADISTA ' }),
      line('2026-08-12', 21.9, atacadao),
    ]);
    expect(storeOptions(purchases).map((s) => s.label)).toEqual(['Todos', 'Assaí Atacadista', 'Atacadão']);
    // A ordem em que chegam não muda o nome do chip.
    expect(storeOptions([...purchases].reverse()).map((s) => s.label)).toEqual(['Todos', 'Assaí Atacadista', 'Atacadão']);
    expect(changeSentence(purchases[1], purchases[0], TODAY)).toBe('Subiu 8% desde 3 set (era R$ 23,90)');
  });

  it('mercado chamado "Todos" ou "sem-mercado" não se confunde com as opções da seção', () => {
    const purchases = toPurchases([
      line('2026-10-10', 25.9, { storeId: 't', storeName: 'Todos' }),
      line('2026-09-03', 23.9, { storeId: 's', storeName: 'sem-mercado' }),
      line('2026-08-12', 21.9, noStore),
    ]);
    const options = storeOptions(purchases);
    expect(options.map((s) => s.label)).toEqual(['Todos', 'sem-mercado', 'Todos', 'Mercado não informado']);
    expect(new Set(options.map((s) => s.value)).size).toBe(4);
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

  it('mudança que arredonda para 0% com os centavos diferentes é "quase o mesmo preço"; meio porcento já é 1%', () => {
    // 0,4% para cima e para baixo: "Mesmo preço" não pode ficar em cima de "Menor: R$ 100,00 · Maior: R$ 100,40".
    const [up, base] = toPurchases([line('2026-10-10', 100.4), line('2026-07-12', 100)]);
    expect(changeSentence(base, up, TODAY)).toBe('Quase o mesmo preço desde 12 jul (era R$ 100,00)');
    const [down] = toPurchases([line('2026-10-10', 99.6)]);
    expect(changeSentence(base, down, TODAY)).toBe('Quase o mesmo preço desde 12 jul (era R$ 100,00)');
    const [, elsewhere] = toPurchases([line('2026-10-10', 100.4), line('2026-07-12', 100, atacadao)]);
    expect(changeSentence(elsewhere, up, TODAY)).toBe('Quase o mesmo preço desde 12 jul (era R$ 100,00, em outro mercado: Atacadão)');
    const [half, eight] = toPurchases([line('2026-10-10', 8.04), line('2026-07-12', 8)]);
    expect(changeSentence(eight, half, TODAY)).toBe('Subiu 1% desde 12 jul (era R$ 8,00)');
    // Diferença que nem aparece na tela (quarta casa do preço): os centavos são os mesmos.
    const [fine, finer] = toPurchases([line('2026-10-10', 5.9991), line('2026-07-12', 5.999)]);
    expect(changeSentence(finer, fine, TODAY)).toBe('Mesmo preço desde 12 jul');
  });

  it('só com compras em dois dias diferentes', () => {
    const [evening, morning] = toPurchases([line('2026-10-10', 25.9, { time: '19:00', receiptId: 'r-noite' }), line('2026-10-10', 22.9, { time: '09:00' })]);
    expect(changeSentence(morning, evening, TODAY)).toBeNull();
    expect(changeSentence(last, last, TODAY)).toBeNull();
  });

  it('compra sem valor não é preço: com ela numa das pontas não há o que comparar', () => {
    const [now, free] = toPurchases([line('2026-10-10', 5.49), line('2026-07-12', 0)]);
    expect(changeSentence(free, now, TODAY)).toBeNull();
    expect(changeSentence(now, free, TODAY)).toBeNull();
    const [stillFree, wasFree] = toPurchases([line('2026-10-10', 0), line('2026-07-12', 0)]);
    expect(changeSentence(wasFree, stillFree, TODAY)).toBeNull();
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

describe('uma regra só para "o mesmo preço": os centavos', () => {
  const context = { today: TODAY, productName: 'Ovo' };

  it('o preço da compra é arredondado para centavos uma vez, sem tropeçar no ponto flutuante', () => {
    expect([roundPrice(1.005), roundPrice(0.495), roundPrice(0.499), roundPrice(5.8999999999999995), roundPrice(25.9)]).toEqual([1.01, 0.5, 0.5, 5.9, 25.9]);
    // R$ 0,0059 por g são R$ 5,90 por kg, não 5,8999999999999995.
    const [grams, millis, fine] = toPurchases([
      line('2026-10-10', 0.0059, { quantity: 800, unit: 'g', totalPrice: 4.72 }),
      line('2026-10-09', 0.00459, { quantity: 1000, unit: 'ml', totalPrice: 4.59 }),
      line('2026-10-08', 1.005),
    ]);
    expect([grams.price, millis.price, fine.price]).toEqual([5.9, 4.59, 1.01]);
  });

  it('empate do menor entre uma compra em g e outra em kg no mesmo preço: vale a mais recente', () => {
    const purchases = toPurchases([
      line('2026-10-10', 5.9, { unit: 'kg' }),
      line('2026-09-10', 0.0059, { quantity: 1000, unit: 'g', totalPrice: 5.9 }),
      line('2026-08-10', 6.5, { unit: 'kg' }),
    ]);
    expect(priceRange(purchases)!.lowest.day).toBe('2026-10-10');
    expect(rangeSentence(purchases, '6m', TODAY)).toBe('Menor: R$ 5,90 (Assaí, 10 out) · Maior: R$ 6,50 (Assaí, 10 ago)');
    // Os pontos ficam entre 0 e 1, sem sobra do ponto flutuante.
    expect(chartPoints(purchases).map((p) => p.y)).toEqual([1, 0, 0]);
  });

  it('empate do maior entre uma compra em ml e outra em litro no mesmo preço: vale a mais recente', () => {
    const purchases = toPurchases([
      line('2026-10-10', 4.59, { unit: 'l' }),
      line('2026-09-10', 0.00459, { quantity: 1000, unit: 'ml', totalPrice: 4.59 }),
      line('2026-08-10', 3.99, { unit: 'l' }),
    ]);
    expect(rangeSentence(purchases, '6m', TODAY)).toBe('Menor: R$ 3,99 (Assaí, 10 ago) · Maior: R$ 4,59 (Assaí, 10 out)');
    expect(chartPoints(purchases).map((p) => p.y)).toEqual([0, 1, 1]);
  });

  it('R$ 5,899 e R$ 5,90 são o mesmo preço: no empate, a mais recente', () => {
    const purchases = toPurchases([line('2026-10-10', 5.9), line('2026-09-10', 5.899), line('2026-08-10', 6.5)]);
    expect(priceRange(purchases)!.lowest.day).toBe('2026-10-10');
    const ys = chartPoints(purchases).map((p) => p.y);
    expect(ys).toEqual([1, 0, 0]);
  });

  it('ovos a R$ 0,4950 e depois a R$ 0,4990: tudo diz R$ 0,50, e nada diz que subiu', () => {
    const view = priceHistoryView(toPurchases([line('2026-10-10', 0.499, { quantity: 30 }), line('2026-09-10', 0.495, { quantity: 30 }), line('2026-08-10', 0.495, { quantity: 30 })]), NO_CHOICE, context)!;
    expect(view.summary).toEqual(['R$ 0,50/un · Assaí · 10 out', 'Mesmo preço desde 10 ago', 'Sempre R$ 0,50 neste período', '3 compras em 6 meses']);
    expect(view.rows.map((r) => r.price)).toEqual(['R$ 0,50/un', 'R$ 0,50/un', 'R$ 0,50/un']);
    expect(view.chart).toMatchObject({ flat: true, lowLabel: 'R$ 0,50', highLabel: 'R$ 0,50' });
    expect(view.chart!.points.map((p) => p.y)).toEqual([0.5, 0.5, 0.5]);
    expect(view.chart!.label).toBe('Preço de Ovo de 10 ago a 10 out: sempre R$ 0,50');
  });

  it('R$ 1,00 e depois R$ 1,005: a tela inteira trata o último como R$ 1,01', () => {
    const view = priceHistoryView(toPurchases([line('2026-10-10', 1.005), line('2026-09-10', 1), line('2026-08-10', 1)]), NO_CHOICE, context)!;
    expect(view.summary).toEqual([
      'R$ 1,01/un · Assaí · 10 out',
      'Subiu 1% desde 10 ago (era R$ 1,00)',
      'Menor: R$ 1,00 (Assaí, 10 set) · Maior: R$ 1,01 (Assaí, 10 out)',
      'Costuma custar R$ 1,00',
      '3 compras em 6 meses',
    ]);
    // O gráfico não é reto: dois preços nas legendas e o último ponto no alto.
    expect(view.chart).toMatchObject({ flat: false, lowLabel: 'R$ 1,00', highLabel: 'R$ 1,01' });
    expect(view.chart!.points.map((p) => p.y)).toEqual([0, 0, 1]);
  });

  it('o porcento sai dos preços em centavos', () => {
    // R$ 0,1949 e R$ 0,2051: na tela, de R$ 0,19 para R$ 0,21 (11%); pelos preços crus seriam 5%.
    const [up, base] = toPurchases([line('2026-10-10', 0.2051), line('2026-08-10', 0.1949)]);
    expect(changeSentence(base, up, TODAY)).toBe('Subiu 11% desde 10 ago (era R$ 0,19)');
  });

  it('a mediana que cai em meio centavo também sai em centavos', () => {
    const purchases = toPurchases([line('2026-10-10', 0.52), line('2026-09-10', 0.51), line('2026-08-10', 0.5), line('2026-07-10', 0.49)]);
    expect(usualSentence(purchases)).toBe('Costuma custar R$ 0,51');
  });
});

describe('compra sem valor (preço impresso zero) não é preço', () => {
  const context = { today: TODAY, productName: 'Arroz' };
  const free = (day: string, partial: Partial<PurchaseLine> = {}) => line(day, 0, { quantity: 2, totalPrice: 0, ...partial });

  it('continua na lista, com "sem valor" no lugar do preço e do que foi pago', () => {
    const [purchase] = toPurchases([free('2026-10-10')]);
    expect(isPriced(purchase)).toBe(false);
    expect(purchaseRow(purchase, TODAY)).toMatchObject({ title: 'Assaí', detail: '10 out · 2 un · sem valor', price: 'sem valor', priced: false, discounted: false });
    expect(isPriced(toPurchases([line('2026-10-10', 25.9)])[0])).toBe(true);
  });

  it('preço que nem chega a um centavo também é sem valor', () => {
    const [purchase] = toPurchases([line('2026-10-10', 0.004)]);
    expect(isPriced(purchase)).toBe(false);
    expect(purchaseRow(purchase, TODAY).price).toBe('sem valor');
  });

  it('leitura que trouxe o total mas não o preço: a linha diz o que foi pago, e o preço fica sem valor', () => {
    const [purchase] = toPurchases([line('2026-10-10', 0, { quantity: 2, totalPrice: 7 })]);
    expect(purchaseRow(purchase, TODAY)).toMatchObject({ detail: '10 out · 2 un · pagou R$ 7,00', price: 'sem valor', priced: false });
  });

  it('no meio das outras: fica fora da mudança, do menor e maior e do gráfico, e a contagem diz quantas ficaram de fora', () => {
    const view = priceHistoryView(toPurchases([line('2026-10-10', 25.9), free('2026-09-03'), line('2026-07-12', 22.9)]), NO_CHOICE, context)!;
    expect(view.summary).toEqual([
      'R$ 25,90/un · Assaí · 10 out',
      'Subiu 13% desde 12 jul (era R$ 22,90)',
      'Menor: R$ 22,90 (Assaí, 12 jul) · Maior: R$ 25,90 (Assaí, 10 out)',
      '2 compras e 1 sem valor em 6 meses',
    ]);
    expect(view.headline).toBe(true);
    expect(view.chart!.points).toHaveLength(2);
    expect(view.chart).toMatchObject({ lowLabel: 'R$ 22,90', highLabel: 'R$ 25,90' });
    expect(view.rows.map((r) => `${r.detail} · ${r.price}`)).toEqual([
      '10 out · 1 un · pagou R$ 25,90 · R$ 25,90/un',
      '3 set · 2 un · sem valor · sem valor',
      '12 jul · 1 un · pagou R$ 22,90 · R$ 22,90/un',
    ]);
  });

  it('a mais recente sem valor: a última compra do resumo e do gráfico é a última com preço', () => {
    const view = priceHistoryView(toPurchases([free('2026-10-10'), line('2026-09-03', 25.9), line('2026-07-12', 22.9)]), NO_CHOICE, context)!;
    expect(view.summary.slice(0, 2)).toEqual(['R$ 25,90/un · Assaí · 3 set', 'Subiu 13% desde 12 jul (era R$ 22,90)']);
    expect(view.chart).toMatchObject({ firstDate: '12 jul', lastDate: '3 set' });
    expect(view.chart!.label).toBe('Preço de Arroz de 12 jul a 3 set: de R$ 22,90 a R$ 25,90; o último, R$ 25,90');
    expect(view.rows[0].detail).toBe('10 out · 2 un · sem valor');
  });

  it('a mais antiga sem valor: nunca "era R$ 0,00" nem "Menor: R$ 0,00"', () => {
    const view = priceHistoryView(toPurchases([line('2026-10-10', 25.9), line('2026-09-03', 22.9), free('2026-07-12')]), NO_CHOICE, context)!;
    expect(view.summary).toEqual([
      'R$ 25,90/un · Assaí · 10 out',
      'Subiu 13% desde 3 set (era R$ 22,90)',
      'Menor: R$ 22,90 (Assaí, 3 set) · Maior: R$ 25,90 (Assaí, 10 out)',
      '2 compras e 1 sem valor em 6 meses',
    ]);
    expect(view.summary.join(' ')).not.toContain('R$ 0,00');
  });

  it('"costuma custar" é a mediana só das compras com preço, e precisa de três delas', () => {
    const priced = [line('2026-10-10', 25.9), line('2026-09-03', 27.9), line('2026-08-12', 21.9)];
    const view = priceHistoryView(toPurchases([...priced, free('2026-08-01'), free('2026-07-20')]), NO_CHOICE, context)!;
    expect(view.summary).toContain('Costuma custar R$ 25,90');
    expect(view.summary.at(-1)).toBe('3 compras e 2 sem valor em 6 meses');
    const two = priceHistoryView(toPurchases([...priced.slice(0, 2), free('2026-08-01')]), NO_CHOICE, context)!;
    expect(two.summary.some((s) => s.startsWith('Costuma'))).toBe(false);
  });

  it('a contagem, no singular e no plural', () => {
    expect(countSentence(8, '6m', 1)).toBe('8 compras e 1 sem valor em 6 meses');
    expect(countSentence(8, '6m', 2)).toBe('8 compras e 2 sem valor em 6 meses');
    expect(countSentence(1, 'tudo', 2)).toBe('1 compra e 2 sem valor');
    expect(countSentence(8, '6m', 0)).toBe('8 compras em 6 meses');
  });

  it('com uma compra com preço e outra sem, o resumo é a que tem preço', () => {
    const view = priceHistoryView(toPurchases([free('2026-10-10'), line('2026-09-03', 25.9)]), NO_CHOICE, context)!;
    expect(view.summary).toEqual(['R$ 25,90/un · Assaí · 3 set', '1 compra e 1 sem valor']);
    expect(view.chart).toBeNull();
  });

  it('o período padrão conta as compras com preço: duas nos 6 meses, senão "Tudo"', () => {
    const one = toPurchases([line('2026-10-10', 25.9), free('2026-09-03'), line('2025-11-02', 19.9)]);
    expect(defaultPeriod(one, TODAY)).toBe('tudo');
    expect(priceHistoryView(one, NO_CHOICE, context)!.period).toBe('tudo');
    expect(defaultPeriod(toPurchases([line('2026-10-10', 25.9), free('2026-09-03'), line('2026-08-02', 19.9)]), TODAY)).toBe('6m');
  });

  it('a unidade padrão é a que tem mais compras com preço', () => {
    const banana = toPurchases([free('2026-10-10'), free('2026-10-03', { receiptId: 'r-outra' }), line('2026-09-20', 6.99, { unit: 'kg' })]);
    expect(defaultUnit(banana)).toBe('kg');
    // As duas unidades continuam à escolha: as compras sem valor estão na lista da delas.
    const view = priceHistoryView(banana, NO_CHOICE, { today: TODAY, productName: 'Banana' })!;
    expect(view.unit).toBe('kg');
    expect(view.units.map((u) => u.value)).toEqual(['un', 'kg']);
    // Nenhuma com preço: vale a unidade com mais compras.
    expect(defaultUnit(toPurchases([free('2026-10-10'), free('2026-10-03', { receiptId: 'r-outra' }), free('2026-09-20', { unit: 'kg' })]))).toBe('un');
  });

  it('produto só com compras sem valor: a lista e uma frase no lugar do resumo', () => {
    const purchases = toPurchases([free('2026-10-10'), free('2026-09-03')]);
    const view = priceHistoryView(purchases, NO_CHOICE, context)!;
    expect(view).toMatchObject({ period: 'tudo', summary: ['Nenhuma compra com valor ainda.'], headline: false, chart: null, more: null });
    expect(view.rows.map((r) => r.detail)).toEqual(['10 out · 2 un · sem valor', '3 set · 2 un · sem valor']);
    expect(priceHistoryView(purchases, { ...NO_CHOICE, period: '6m' }, context)!.summary).toEqual(['Nenhuma compra com valor neste período.']);
    expect([noValueSentence('3m'), noValueSentence('1a'), noValueSentence('tudo')]).toEqual([
      'Nenhuma compra com valor neste período.',
      'Nenhuma compra com valor neste período.',
      'Nenhuma compra com valor ainda.',
    ]);
    // Período sem compra nenhuma continua com a frase de sempre.
    expect(priceHistoryView(toPurchases([free('2026-05-10')]), { ...NO_CHOICE, period: '3m' }, context)!.summary).toEqual(['Nenhuma compra nos últimos 3 meses. Veja em "Tudo".']);
  });

  it('o mercado que só tem compra sem valor tem o seu chip, e escolhê-lo mostra a compra', () => {
    const purchases = toPurchases([line('2026-10-10', 25.9), line('2026-09-20', 24.9), free('2026-09-03', atacadao)]);
    const view = priceHistoryView(purchases, { ...NO_CHOICE, store: storeKey('Atacadão') }, context)!;
    expect(view.stores.map((s) => s.label)).toEqual(['Todos', 'Assaí', 'Atacadão']);
    expect(view.summary).toEqual(['Nenhuma compra com valor neste período.']);
    expect(view.rows.map((r) => `${r.title} · ${r.price}`)).toEqual(['Atacadão · sem valor']);
  });

  it('o gráfico, o menor e maior e a mediana ignoram a compra sem valor mesmo recebendo-a', () => {
    const purchases = toPurchases([line('2026-10-10', 25.9), free('2026-09-03'), line('2026-07-12', 22.9)]);
    expect(priceChart(purchases, { productName: 'Arroz', today: TODAY })!.points).toHaveLength(2);
    expect(summarize(purchases, { period: 'tudo', today: TODAY })).toEqual([
      'R$ 25,90/un · Assaí · 10 out',
      'Subiu 13% desde 12 jul (era R$ 22,90)',
      'Menor: R$ 22,90 (Assaí, 12 jul) · Maior: R$ 25,90 (Assaí, 10 out)',
      '2 compras e 1 sem valor',
    ]);
  });

  it('"Ver mais" conta todas as compras da lista, com ou sem valor', () => {
    const lines = Array.from({ length: 12 }, (_, n) => (n % 2 ? free(`2026-09-${String(10 + n).padStart(2, '0')}`) : line(`2026-09-${String(10 + n).padStart(2, '0')}`, 20 + n)));
    const view = priceHistoryView(toPurchases(lines), NO_CHOICE, context)!;
    expect(view.rows).toHaveLength(10);
    expect(view.more).toBe('Ver mais (faltam 2)');
    expect(view.summary.at(-1)).toBe('6 compras e 6 sem valor em 6 meses');
  });
});

describe('o mercado escolhido não volta sozinho', () => {
  const context = { today: TODAY, productName: 'Arroz' };
  const purchases = toPurchases([
    line('2026-10-10', 25.9),
    line('2026-09-03', 27.9),
    line('2026-06-12', 21.9, atacadao),
    line('2025-11-02', 19.9, atacadao),
    line('2026-05-02', 23.9, { storeId: 'extra', storeName: 'Extra' }),
  ]);

  it('mercado, depois um período sem ele, depois um período com ele: continua em "Todos"', () => {
    let choices = chooseInHistory(purchases, NO_CHOICE, { store: storeKey('Atacadão') }, context);
    expect(choices.store).toBe(storeKey('Atacadão'));
    expect(priceHistoryView(purchases, choices, context)!.rows.map((r) => r.title)).toEqual(['Atacadão']);
    // Em 3 meses o Atacadão não tem compra: a seção mostra todos, e a escolha é esquecida.
    choices = chooseInHistory(purchases, choices, { period: '3m' }, context);
    expect(choices).toMatchObject({ period: '3m', store: null });
    expect(priceHistoryView(purchases, choices, context)!.rows).toHaveLength(2);
    // Em 1 ano o Atacadão volta a ter chip, mas ninguém tocou nele.
    choices = chooseInHistory(purchases, choices, { period: '1a' }, context);
    const view = priceHistoryView(purchases, choices, context)!;
    expect(view.store).toBe(ALL_STORES);
    expect(view.stores.map((s) => s.label)).toEqual(['Todos', 'Assaí', 'Atacadão', 'Extra']);
    expect(view.rows).toHaveLength(5);
    expect(view.summary.at(-1)).toBe('5 compras em 1 ano');
  });

  it('o mercado que continua à vista no novo período fica escolhido', () => {
    let choices = chooseInHistory(purchases, NO_CHOICE, { store: storeKey('Atacadão') }, context);
    choices = chooseInHistory(purchases, choices, { period: 'tudo' }, context);
    expect(choices.store).toBe(storeKey('Atacadão'));
    expect(priceHistoryView(purchases, choices, context)!.rows.map((r) => r.detail)).toEqual(['12 jun · 1 un · pagou R$ 21,90', '2 nov 2025 · 1 un · pagou R$ 19,90']);
  });

  it('na troca de unidade: o mercado que não tem compra na outra unidade é esquecido', () => {
    const banana = toPurchases([
      line('2026-10-10', 6.99, { unit: 'kg' }),
      line('2026-09-10', 5.99, { unit: 'kg', ...atacadao }),
      line('2026-08-10', 5.49, { unit: 'kg' }),
      line('2026-10-01', 0.9),
      line('2026-09-01', 0.8, { receiptId: 'r-un-2' }),
      line('2025-10-20', 0.7, atacadao),
    ]);
    const bananaContext = { today: TODAY, productName: 'Banana' };
    let choices = chooseInHistory(banana, NO_CHOICE, { store: storeKey('Atacadão') }, bananaContext);
    expect(priceHistoryView(banana, choices, bananaContext)!).toMatchObject({ unit: 'kg', store: storeKey('Atacadão') });
    // Por unidade, nos 6 meses, só há Assaí.
    choices = chooseInHistory(banana, choices, { unit: 'un' }, bananaContext);
    expect(choices).toMatchObject({ unit: 'un', store: null });
    // "Tudo" traz a compra antiga do Atacadão: o chip aparece, sem ficar escolhido.
    choices = chooseInHistory(banana, choices, { period: 'tudo' }, bananaContext);
    const view = priceHistoryView(banana, choices, bananaContext)!;
    expect(view.store).toBe(ALL_STORES);
    expect(view.rows).toHaveLength(3);
  });

  it('cada escolha volta a lista às primeiras compras; tocar em "Todos" guarda nenhum mercado', () => {
    const choices = chooseInHistory(purchases, { ...NO_CHOICE, store: storeKey('Atacadão'), more: 2 }, { store: ALL_STORES }, context);
    expect(choices).toEqual({ unit: null, period: null, store: null, more: 0 });
    expect(chooseInHistory(purchases, { ...NO_CHOICE, more: 3 }, { period: '1a' }, context)).toEqual({ unit: null, period: '1a', store: null, more: 0 });
    // Sem compra nenhuma não há o que decidir.
    expect(chooseInHistory([], NO_CHOICE, { period: '1a' }, context)).toEqual({ unit: null, period: '1a', store: null, more: 0 });
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
    expect(chart).toMatchObject({ lowLabel: 'R$ 21,90', highLabel: 'R$ 27,90', flat: false, firstDate: '12 jul', lastDate: '10 out' });
    expect(chart.label).toBe('Preço de Arroz de 12 jul a 10 out: de R$ 21,90 a R$ 27,90; o último, R$ 25,90');
    expect(chart.points).toHaveLength(4);
  });

  it('preço que não mudou e datas de outro ano', () => {
    const chart = priceChart(toPurchases([line('2026-01-10', 25.9), line('2025-12-03', 25.9)]), { productName: 'Arroz', today: TODAY })!;
    expect(chart).toMatchObject({ lowLabel: 'R$ 25,90', highLabel: 'R$ 25,90', flat: true, firstDate: '3 dez 2025', lastDate: '10 jan' });
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
      size: null,
      priced: true,
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

  it('para o leitor de tela, o "Ver mais" diz que é do histórico (a tela do produto tem outros)', () => {
    expect(moreAccessibilityLabel(12)).toBe('Ver mais (faltam 12) do histórico de preço');
    expect(moreAccessibilityLabel(1)).toBe('Ver mais (falta 1) do histórico de preço');
    expect(moreAccessibilityLabel(0)).toBeNull();
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
    const atacadaoOnly = priceHistoryView(purchases, { ...NO_CHOICE, store: storeKey('Atacadão') }, context)!;
    expect(atacadaoOnly.store).toBe(storeKey('Atacadão'));
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
    const view = priceHistoryView(purchases, { ...NO_CHOICE, period: '3m', store: storeKey('Atacadão') }, context)!;
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
    expect(first.moreAccessibilityLabel).toBe('Ver mais (faltam 25) do histórico de preço');
    // O resumo e o gráfico são de todas, não só das que estão à vista.
    expect(first.summary.at(-1)).toBe('35 compras em 6 meses');
    expect(first.chart?.points).toHaveLength(35);
    const second = priceHistoryView(purchases, { ...NO_CHOICE, more: 1 }, context)!;
    expect(second.rows).toHaveLength(30);
    expect(second.more).toBe('Ver mais (faltam 5)');
    const third = priceHistoryView(purchases, { ...NO_CHOICE, more: 2 }, context)!;
    expect(third.rows).toHaveLength(35);
    expect(third.more).toBeNull();
    expect(third.moreAccessibilityLabel).toBeNull();
  });

  it('com 10 compras ou menos não há "Ver mais"; com 11, falta 1', () => {
    expect(priceHistoryView(daily(10), NO_CHOICE, context)!.more).toBeNull();
    expect(priceHistoryView(daily(11), NO_CHOICE, context)!.more).toBe('Ver mais (falta 1)');
  });
});

describe('embalagens de tamanhos diferentes', () => {
  const context = { today: TODAY, productName: 'Arroz' };
  const sized = (description: string) => ({ description });

  it('o arroz de 5 kg e o de 1 kg se comparam pelo preço por kg, não pelo pacote', () => {
    const purchases = toPurchases([
      line('2026-10-10', 24.9, sized('ARROZ TIO JOAO T1 5KG')),
      line('2026-08-12', 5.49, { ...atacadao, ...sized('ARROZ TIO JOAO T1 1KG') }),
    ]);
    expect(purchases.map((p) => [p.baseUnit, p.price, p.packagePrice])).toEqual([
      ['kg', 4.98, 24.9],
      ['kg', 5.49, 5.49],
    ]);
    const view = priceHistoryView(purchases, NO_CHOICE, context)!;
    expect(view).toMatchObject({ unit: 'kg', units: [] });
    // Por pacote, pareceria que o arroz subiu 354%; por kg, caiu.
    expect(view.summary).toEqual([
      'R$ 4,98/kg · Assaí · 10 out',
      'Caiu 9% desde 12 ago (era R$ 5,49, em outro mercado: Atacadão)',
      'Menor: R$ 4,98 (Assaí, 10 out) · Maior: R$ 5,49 (Atacadão, 12 ago)',
      '2 compras em 6 meses',
    ]);
    expect(view.chart).toMatchObject({ lowLabel: 'R$ 4,98', highLabel: 'R$ 5,49' });
    // A linha da compra mostra o preço impresso do pacote e, embaixo, o tamanho com o preço por kg.
    expect(view.rows.map((row) => [row.detail, row.price, row.size])).toEqual([
      ['10 out · 1 un · pagou R$ 24,90', 'R$ 24,90/un', '5 kg · R$ 4,98/kg'],
      ['12 ago · 1 un · pagou R$ 5,49', 'R$ 5,49/un', '1 kg · R$ 5,49/kg'],
    ]);
  });

  it('gramas e quilos, litros e mililitros: o preço sai por kg ou por litro', () => {
    const beans = toPurchases([
      line('2026-10-10', 4.79, sized('FEIJAO CARIOCA KICALDO 500G')),
      line('2026-09-10', 8.99, sized('FEIJAO CARIOCA KICALDO 1KG')),
    ]);
    expect(beans.map((p) => `${p.price}/${p.baseUnit}`)).toEqual(['9.58/kg', '8.99/kg']);
    const soda = toPurchases([
      line('2026-10-10', 10.99, sized('REFRIG COCA COLA PET 2L')),
      line('2026-09-10', 4.49, sized('REFRIG COCA COLA LT 350ML')),
      line('2026-08-10', 39.9, sized('REFRIG COCA COLA LT 350ML C/12')),
    ]);
    expect(soda.map((p) => `${p.price}/${p.baseUnit}`)).toEqual(['5.5/l', '12.83/l', '9.5/l']);
    expect(purchaseRow(soda[2], TODAY).size).toBe('12 x 350 ml · R$ 9,50/l');
  });

  it('o preço por kg sai do preço impresso, com as quatro casas, e é arredondado uma vez só', () => {
    const [rice] = toPurchases([
      line('2026-10-10', 24.9249, { ...sized('ARROZ 5KG'), totalPrice: 24.92 }),
      line('2026-09-10', 5.49, sized('ARROZ 1KG')),
    ]);
    // 24,9249 / 5 = 4,98498: R$ 4,98. Do preço do pacote já arredondado (R$ 24,92), sairia R$ 4,98 também; o que
    // importa é não arredondar o que já foi arredondado de um jeito que mude o centavo.
    expect(rice).toMatchObject({ price: 4.98, packagePrice: 24.92 });
    const [eggs] = toPurchases([line('2026-10-10', 9.9, sized('OVOS C/12')), line('2026-09-10', 21.9, sized('OVOS C/30'))]);
    // 9,90 / 12 = 0,825: meio centavo arredonda para cima.
    expect(eggs.price).toBe(0.83);
  });

  it('com um tamanho só, nada muda: o preço do pacote já se compara', () => {
    const purchases = toPurchases([line('2026-10-10', 24.9, sized('ARROZ T1 5KG')), line('2026-09-10', 23.9, sized('ARROZ TIPO 1 5 KG'))]);
    expect(purchases.map((p) => [p.baseUnit, p.price, p.packagePrice])).toEqual([
      ['un', 24.9, null],
      ['un', 23.9, null],
    ]);
    expect(purchaseRow(purchases[0], TODAY)).toMatchObject({ price: 'R$ 24,90/un', size: null });
  });

  it('a compra sem tamanho conhecido fica à parte, por unidade, como antes', () => {
    const purchases = toPurchases([
      line('2026-10-10', 24.9, sized('ARROZ TIO JOAO T1 5KG')),
      line('2026-09-10', 5.49, sized('ARROZ TIO JOAO T1 1KG')),
      line('2026-08-10', 19.9, sized('ARROZ TIO JOAO')),
      // Sem a descrição, também não há tamanho.
      line('2026-07-10', 21.9),
    ]);
    expect(purchases.map((p) => p.baseUnit)).toEqual(['kg', 'kg', 'un', 'un']);
    const view = priceHistoryView(purchases, NO_CHOICE, context)!;
    expect(view.units).toEqual([
      { value: 'un', label: 'por unidade' },
      { value: 'kg', label: 'por kg' },
    ]);
    const perPack = priceHistoryView(purchases, { ...NO_CHOICE, unit: 'un' }, context)!;
    expect(perPack.summary[0]).toBe('R$ 19,90/un · Assaí · 10 ago');
    expect(perPack.rows.map((row) => row.size)).toEqual([null, null]);
  });

  it('número que não é tamanho não vira preço por kg', () => {
    const purchases = toPurchases([
      line('2026-10-10', 4.99, sized('LEITE UHT 3 MARIAS INTEGRAL')),
      line('2026-09-10', 5.29, sized('TOMATE 1A')),
      line('2026-08-10', 4.49, sized('AGUA MIN 1 5L')),
      line('2026-07-10', 9.9, sized('ARROZ TIPO 1 KG')),
    ]);
    expect(purchases.every((p) => p.baseUnit === 'un' && p.pack === null)).toBe(true);
  });

  it('vendido a peso e em pacote: o pacote entra no histórico por kg, junto com a compra a granel', () => {
    const purchases = toPurchases([
      line('2026-10-10', 49.9, { quantity: 0.412, unit: 'kg', totalPrice: 20.56, ...sized('QUEIJO MUSSARELA FATIADO KG') }),
      line('2026-09-10', 12.9, sized('QUEIJO MUSSARELA TIROLEZ 150G')),
    ]);
    expect(purchases.map((p) => [p.baseUnit, p.price])).toEqual([
      ['kg', 49.9],
      ['kg', 86],
    ]);
    // A compra a peso não tem tamanho de pacote: o preço por kg já é o da nota.
    expect(purchases[0]).toMatchObject({ pack: null, packagePrice: null });
    const view = priceHistoryView(purchases, NO_CHOICE, { ...context, productName: 'Queijo' })!;
    expect(view.rows.map((row) => [row.price, row.size])).toEqual([
      ['R$ 49,90/kg', null],
      ['R$ 12,90/un', '150 g · R$ 86,00/kg'],
    ]);
  });

  it('pacotes com quantidades diferentes de itens: o preço de cada um', () => {
    const purchases = toPurchases([
      line('2026-10-10', 9.9, sized('OVOS BRANCOS C/12')),
      line('2026-09-10', 21.9, sized('OVO BRANCO GRANJA 30UN')),
    ]);
    expect(purchases.map((p) => [p.baseUnit, p.price])).toEqual([
      [PACK_ITEM, 0.83],
      [PACK_ITEM, 0.73],
    ]);
    const view = priceHistoryView(purchases, NO_CHOICE, { ...context, productName: 'Ovos' })!;
    expect(view.summary[0]).toBe('R$ 0,83 cada · Assaí · 10 out');
    expect(view.rows.map((row) => row.size)).toEqual(['12 un · R$ 0,83 cada', '30 un · R$ 0,73 cada']);
    expect(unitLabel(PACK_ITEM)).toBe('por item do pacote');
  });

  it('cartela sem a conta na nota: vale quantos a pessoa disse na revisão', () => {
    const purchases = toPurchases([
      line('2026-10-20', 13.99, { description: 'OVOS RANCHO CAIPIRA', packCount: 20 }),
      line('2026-10-11', 8.99, { description: 'OVO DONINHO CAIPIRA', packCount: 10 }),
      // Sem resposta: fica por unidade, à parte.
      line('2026-09-11', 9.49, { description: 'OVO DONINHO CAIPIRA' }),
    ]);
    expect(purchases.map((p) => [p.baseUnit, p.price, p.pack?.label ?? null])).toEqual([
      [PACK_ITEM, 0.7, '20 un'],
      [PACK_ITEM, 0.9, '10 un'],
      ['un', 9.49, null],
    ]);
  });

  it('peso, volume e itens do pacote não se misturam', () => {
    const purchases = toPurchases([
      line('2026-10-10', 9.9, sized('OVOS C/12')),
      line('2026-09-10', 21.9, sized('OVOS C/30')),
      line('2026-08-10', 12.9, sized('OVOS LIQUIDOS 1KG')),
    ]);
    // Um tamanho só por peso: fica por unidade.
    expect(purchaseUnits(purchases)).toEqual(['un', PACK_ITEM]);
  });

  it('linhas da mesma nota somadas com tamanhos diferentes não têm tamanho', () => {
    const purchases = toPurchases([
      line('2026-10-10', 5.49, sized('ARROZ 1KG')),
      line('2026-10-10', 5.49, sized('ARROZ 1000G')),
      line('2026-09-10', 5.49, sized('ARROZ 1KG')),
      line('2026-09-10', 5.49, sized('ARROZ 2KG')),
      line('2026-08-10', 24.9, sized('ARROZ 5KG')),
    ]);
    expect(purchases.map((p) => [p.day, p.quantity, p.pack?.label ?? null, p.baseUnit])).toEqual([
      ['2026-10-10', 2, '1 kg', 'kg'],
      ['2026-09-10', 2, null, 'un'],
      ['2026-08-10', 1, '5 kg', 'kg'],
    ]);
  });

  it('compra sem valor de um tamanho conhecido: a linha diz o tamanho e "sem valor"', () => {
    const purchases = toPurchases([line('2026-10-10', 0, { ...sized('ARROZ 5KG'), totalPrice: 0 }), line('2026-09-10', 5.49, sized('ARROZ 1KG'))]);
    expect(purchaseRow(purchases[0], TODAY)).toMatchObject({ price: 'sem valor', size: '5 kg', priced: false });
    expect(priceHistoryView(purchases, NO_CHOICE, context)!.summary.at(-1)).toBe('1 compra e 1 sem valor');
  });
});

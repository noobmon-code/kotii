import { describe, expect, it } from '@jest/globals';

import { toISODate } from '../dates';
import { buildEntries, monthRange, summarize } from '../finance';
import { marketMonth, monthFromParam, totalQuantity, type MarketLine, type MarketReceipt } from '../marketSpend';

const MONTH = '2026-10';
/** Mês já fechado: o anterior entra inteiro nas comparações. */
const AFTER = '2026-11-05';

/** Dia `day` do mês `month` ("AAAA-MM"), na hora local do aparelho, como a nota guarda a compra. */
const at = (month: string, day: number, hour = 12, minute = 0, second = 0) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, day, hour, minute, second).toISOString();
};

let nextId = 0;

/** Item ligado a um produto (o id é o nome). */
const line = (name: string, category: string, totalPrice: number | null, quantity = 1, unit = 'un'): MarketLine => ({
  productId: name,
  productName: name,
  productCategory: category,
  rawDescription: name.toUpperCase(),
  suggestedName: null,
  suggestedCategory: null,
  quantity,
  unit,
  totalPrice,
});

/** Item sem produto ("Não acompanhar preço deste item"). */
const loose = (description: string, totalPrice: number | null, partial: Partial<MarketLine> = {}): MarketLine => ({
  productId: null,
  productName: null,
  productCategory: null,
  rawDescription: description,
  suggestedName: null,
  suggestedCategory: null,
  quantity: 1,
  unit: 'un',
  totalPrice,
  ...partial,
});

const receipt = (purchasedAt: string, lines: MarketLine[], partial: Partial<MarketReceipt> = {}): MarketReceipt => ({
  id: `r${++nextId}`,
  purchasedAt,
  status: 'confirmed',
  total: null,
  storeId: 'assai',
  storeName: 'Assaí',
  lines,
  ...partial,
});

const rows = <T extends { amount: string }>(list: T[], name: (row: T) => string) => list.map((row) => [name(row), row.amount]);

describe('o que conta como dinheiro do mercado', () => {
  it('limpeza, higiene, papel, bebê e pet entram; remédio fica de fora e aparece à parte', () => {
    const month = marketMonth(
      [
        receipt(at(MONTH, 10), [
          line('Arroz', 'graos', 30),
          line('Detergente', 'limpeza', 3.5),
          line('Sabonete', 'higiene', 4),
          line('Papel higiênico', 'papel', 20),
          line('Fralda', 'bebe', 60),
          line('Ração', 'pet', 80),
          line('Dipirona', 'medicamentos', 12),
          line('Vitamina C', 'suplementos', 25),
          line('Curativo', 'primeiros_socorros', 5),
        ]),
      ],
      MONTH,
      AFTER,
    );
    expect(month.totalCents).toBe(19750);
    expect(month.headline).toBe('R$ 197,50 em 1 ida');
    expect(rows(month.categories, (c) => c.label)).toEqual([
      ['Pet', 'R$ 80,00'],
      ['Bebê', 'R$ 60,00'],
      ['Grãos, massas e cereais', 'R$ 30,00'],
      ['Papel e descartáveis', 'R$ 20,00'],
      ['Higiene pessoal', 'R$ 4,00'],
      ['Limpeza', 'R$ 3,50'],
    ]);
    expect(month.items.map((i) => i.name)).not.toContain('Dipirona');
    expect(month.pharmacy).toBe('Farmácia, fora desta conta: R$ 42,00');
    // A ida mostra o que saiu dela.
    expect(month.trips[0].detail).toBe('10 out · 6 itens · farmácia fora: R$ 42,00');
  });

  it('nota só de farmácia não é ida ao mercado, e a diferença do total dela não entra', () => {
    const month = marketMonth(
      [
        receipt(at(MONTH, 3), [line('Dipirona', 'medicamentos', 12), line('Vitamina C', 'suplementos', 25)], {
          total: 30,
          storeId: 'drogasil',
          storeName: 'Drogasil',
        }),
        receipt(at(MONTH, 4), [line('Arroz', 'graos', 30)], { total: 30 }),
      ],
      MONTH,
      AFTER,
    );
    expect(month.headline).toBe('R$ 30,00 em 1 ida');
    expect(month.trips.map((t) => t.storeName)).toEqual(['Assaí']);
    expect(month.stores.map((s) => s.name)).toEqual(['Assaí']);
    expect(month.discount).toBeNull();
    expect(month.pharmacy).toBe('Farmácia, fora desta conta: R$ 37,00');
  });

  it('mês só com farmácia: nenhuma ida, e o valor continua à vista', () => {
    const month = marketMonth([receipt(at(MONTH, 3), [line('Dipirona', 'medicamentos', 12)])], MONTH, AFTER);
    expect(month.trips).toEqual([]);
    expect(month.totalCents).toBe(0);
    expect(month.comparison).toBeNull();
    expect(month.pharmacy).toBe('Farmácia, fora desta conta: R$ 12,00');
    expect(month.emptyTitle).toBe('Nenhuma nota de mercado em outubro');
  });

  it('a categoria do item é a do produto; sem produto, a sugerida; sem nenhuma, outros', () => {
    const month = marketMonth(
      [
        receipt(at(MONTH, 10), [
          // O produto manda, mesmo com outra sugestão na leitura.
          { ...line('Sabão em pó', 'limpeza', 20), suggestedCategory: 'graos' },
          loose('SACOLA', 0.5, { suggestedCategory: 'papel' }),
          loose('TAXA ENTREGA', 9.9),
          loose('COISA', 1, { suggestedCategory: 'categoria_que_nao_existe' }),
        ]),
      ],
      MONTH,
      AFTER,
    );
    expect(rows(month.categories, (c) => c.key)).toEqual([
      ['limpeza', 'R$ 20,00'],
      ['outros', 'R$ 10,90'],
      ['papel', 'R$ 0,50'],
    ]);
  });

  it('rascunho não conta, e o mês diz quantos esperam a revisão', () => {
    const confirmed = receipt(at(MONTH, 10), [line('Arroz', 'graos', 30)]);
    const draft = () => receipt(at(MONTH, 11), [line('Feijão', 'graos', 9)], { status: 'draft', total: 9 });
    const one = marketMonth([confirmed, draft()], MONTH, AFTER);
    expect(one.headline).toBe('R$ 30,00 em 1 ida');
    expect(one.items.map((i) => i.name)).toEqual(['Arroz']);
    expect(one.drafts).toBe('1 nota de outubro ainda espera a revisão. Ela entra nesta conta quando for confirmada.');
    expect(marketMonth([confirmed, draft(), draft()], MONTH, AFTER).drafts).toBe(
      '2 notas de outubro ainda esperam a revisão. Elas entram nesta conta quando forem confirmadas.',
    );
    expect(marketMonth([confirmed], MONTH, AFTER).drafts).toBeNull();
    // Rascunho de outro mês não é deste.
    expect(marketMonth([confirmed, receipt(at('2026-09', 30), [], { status: 'draft' })], MONTH, AFTER).drafts).toBeNull();
  });
});

describe('valor impresso e as diferenças do total da nota', () => {
  it('desconto no total: os itens ficam com o valor impresso e o desconto vem à parte', () => {
    const month = marketMonth(
      [receipt(at(MONTH, 10), [line('Arroz', 'graos', 60), line('Detergente', 'limpeza', 40), line('Ração', 'pet', 10)], { total: 100 })],
      MONTH,
      AFTER,
    );
    // Nada é ajustado na proporção: 60, 40 e 10, como na nota.
    expect(rows(month.items, (i) => i.name)).toEqual([
      ['Arroz', 'R$ 60,00'],
      ['Detergente', 'R$ 40,00'],
      ['Ração', 'R$ 10,00'],
    ]);
    expect(month.itemsCents).toBe(11000);
    expect(month.discount).toEqual({
      label: 'Descontos no total das notas',
      value: '−R$ 10,00',
      accessibilityLabel: 'Descontos no total das notas: menos R$ 10,00',
    });
    expect(month.unread).toBeNull();
    // O total do mês é o que foi pago.
    expect(month.totalCents).toBe(10000);
    expect(month.headline).toBe('R$ 100,00 em 1 ida');
    expect(month.trips[0].amount).toBe('R$ 100,00');
  });

  it('total acima da soma dos itens: o que falta aparece como "sem item lido", com a nota para abrir', () => {
    const lost = receipt(at(MONTH, 12), [line('Arroz', 'graos', 30)], { total: 50 });
    const fine = receipt(at(MONTH, 13), [line('Feijão', 'graos', 9)], { total: 9 });
    const month = marketMonth([lost, fine], MONTH, AFTER);
    expect(month.unread).toEqual({
      label: 'Nas notas, sem item lido',
      value: 'R$ 20,00',
      accessibilityLabel: 'Nas notas, sem item lido: R$ 20,00',
      receipts: [
        { receiptId: lost.id, storeName: 'Assaí', date: '12 out', value: 'R$ 20,00', accessibilityLabel: 'Assaí, 12 out: R$ 20,00. Abrir a nota' },
      ],
    });
    expect(month.discount).toBeNull();
    expect(month.itemsCents).toBe(3900);
    expect(month.totalCents).toBe(5900);
    expect(rows(month.categories, (c) => c.key)).toEqual([['graos', 'R$ 39,00']]);
  });

  it('desconto numa nota e item perdido em outra, no mesmo mês: as duas linhas, sem uma abater a outra', () => {
    const discounted = receipt(at(MONTH, 5), [line('Arroz', 'graos', 60)], { total: 50 });
    const lost = receipt(at(MONTH, 6), [line('Feijão', 'graos', 9)], { total: 29 });
    const lostToo = receipt(at(MONTH, 7), [line('Café', 'cafe_cha', 18)], { total: 18.5, storeId: null, storeName: null });
    const month = marketMonth([discounted, lost, lostToo], MONTH, AFTER);
    expect(month.discount?.value).toBe('−R$ 10,00');
    expect(month.unread?.value).toBe('R$ 20,50');
    // Da nota mais recente para a mais antiga.
    expect(month.unread?.receipts.map((r) => [r.receiptId, r.storeName, r.value])).toEqual([
      [lostToo.id, 'Sem mercado informado', 'R$ 0,50'],
      [lost.id, 'Assaí', 'R$ 20,00'],
    ]);
    expect(month.itemsCents).toBe(8700);
    expect(month.totalCents).toBe(8700 - 1000 + 2050);
  });

  it('nota digitada à mão não tem total: vale a soma dos itens, sem diferença', () => {
    const month = marketMonth([receipt(at(MONTH, 10), [line('Arroz', 'graos', 30), line('Feijão', 'graos', 9.9)], { total: null })], MONTH, AFTER);
    expect(month.totalCents).toBe(3990);
    expect(month.discount).toBeNull();
    expect(month.unread).toBeNull();
    // Total zero é nota sem total, como no resumo.
    expect(marketMonth([receipt(at(MONTH, 10), [line('Arroz', 'graos', 30)], { total: 0 })], MONTH, AFTER).totalCents).toBe(3000);
  });

  it('nota com farmácia e desconto no total: a farmácia sai pelo valor impresso e o desconto fica inteiro na conta', () => {
    const month = marketMonth(
      [receipt(at(MONTH, 10), [line('Arroz', 'graos', 70), line('Dipirona', 'medicamentos', 30)], { total: 90 })],
      MONTH,
      AFTER,
    );
    expect(month.itemsCents).toBe(7000);
    expect(month.discount?.value).toBe('−R$ 10,00');
    expect(month.totalCents).toBe(6000);
    expect(month.pharmacy).toBe('Farmácia, fora desta conta: R$ 30,00');
  });

  it('item sem valor conta zero e é contado à parte, com a nota', () => {
    const first = receipt(at(MONTH, 8), [line('Arroz', 'graos', 30), line('Brinde', 'outros', 0), loose('SACOLA', null)]);
    const second = receipt(at(MONTH, 9), [line('Feijão', 'graos', 9), line('Arroz', 'graos', 0)], { storeId: 'dia', storeName: 'Dia' });
    const month = marketMonth([first, second], MONTH, AFTER);
    expect(month.totalCents).toBe(3900);
    expect(month.noValue).toEqual({
      label: '3 itens sem valor',
      receipts: [
        { receiptId: second.id, storeName: 'Dia', date: '9 out', value: '1 item', accessibilityLabel: 'Dia, 9 out: 1 item. Abrir a nota' },
        { receiptId: first.id, storeName: 'Assaí', date: '8 out', value: '2 itens', accessibilityLabel: 'Assaí, 8 out: 2 itens. Abrir a nota' },
      ],
    });
    // O item continua na lista, no fim, sem um valor inventado; o arroz soma só a compra que tem valor.
    expect(rows(month.items, (i) => i.name)).toEqual([
      ['Arroz', 'R$ 30,00'],
      ['Feijão', 'R$ 9,00'],
      ['Brinde', 'sem valor'],
      ['SACOLA', 'sem valor'],
    ]);
    expect(month.items[0].detail).toBe('2 un · em 2 idas');
    expect(marketMonth([receipt(at(MONTH, 8), [line('Arroz', 'graos', 30), line('Brinde', 'outros', 0)])], MONTH, AFTER).noValue?.label).toBe(
      '1 item sem valor',
    );
    expect(marketMonth([receipt(at(MONTH, 8), [line('Arroz', 'graos', 30)])], MONTH, AFTER).noValue).toBeNull();
  });

  it('nota com total e nenhum item: o valor inteiro fica como "sem item lido"', () => {
    const month = marketMonth([receipt(at(MONTH, 10), [], { total: 80 })], MONTH, AFTER);
    expect(month.headline).toBe('R$ 80,00 em 1 ida');
    expect(month.unread?.value).toBe('R$ 80,00');
    expect(month.categories).toEqual([]);
    expect(month.trips[0].detail).toBe('10 out · 0 itens');
  });

  it('fecha com o resumo: mercado do mês mais a farmácia é o que o resumo conta das notas', () => {
    const receipts = [
      receipt(at(MONTH, 2), [line('Arroz', 'graos', 60), line('Detergente', 'limpeza', 40), line('Ração', 'pet', 10)], { total: 100 }),
      receipt(at(MONTH, 9), [line('Feijão', 'graos', 9), line('Dipirona', 'medicamentos', 12)], { total: 41 }),
      receipt(at(MONTH, 15), [line('Café', 'cafe_cha', 18.9), loose('SACOLA', 0.1)]),
      receipt(at(MONTH, 20), [line('Vitamina C', 'suplementos', 25)], { total: 25 }),
    ];
    const month = marketMonth(receipts, MONTH, AFTER);
    const entries = buildEntries(
      receipts.map((r) => ({
        id: r.id,
        purchased_at_date: toISODate(new Date(r.purchasedAt)),
        total: r.total,
        store_name: r.storeName,
        items: r.lines.map((l) => ({ total_price: l.totalPrice ?? 0, category: l.productCategory ?? l.suggestedCategory })),
      })),
      [],
      [],
    );
    const resumo = summarize(entries, monthRange(MONTH)).total;
    expect(month.totalCents).toBe(14800);
    expect(month.pharmacy).toBe('Farmácia, fora desta conta: R$ 37,00');
    expect(resumo).toBe(185);
    expect(month.totalCents + 3700).toBe(Math.round(resumo * 100));
  });
});

describe('por categoria', () => {
  it('da maior para a menor, com a parte do mês; as partes somam 100% (com o arredondamento)', () => {
    const month = marketMonth(
      [
        receipt(at(MONTH, 10), [
          line('Picanha', 'carnes', 100),
          line('Arroz', 'graos', 33.33),
          line('Banana', 'hortifruti', 33.33),
          line('Leite', 'laticinios', 33.34),
          line('Sal', 'temperos', 0.5),
        ]),
      ],
      MONTH,
      AFTER,
    );
    expect(month.categories.map((c) => [c.label, c.amount, c.share])).toEqual([
      ['Carnes', 'R$ 100,00', '50%'],
      ['Laticínios', 'R$ 33,34', '17%'],
      ['Frutas e verduras', 'R$ 33,33', '17%'],
      ['Grãos, massas e cereais', 'R$ 33,33', '17%'],
      ['Temperos e molhos', 'R$ 0,50', '<1%'],
    ]);
    const percents = month.categories.map((c) => Number(c.share.replace(/\D/g, ''))).reduce((sum, p) => sum + p, 0);
    expect(Math.abs(percents - 100)).toBeLessThanOrEqual(2);
    // Em centavos fecha exato: categorias somam os itens, e os itens somam as categorias.
    expect(month.categories.reduce((sum, c) => sum + c.cents, 0)).toBe(month.itemsCents);
    expect(month.items.reduce((sum, i) => sum + i.cents, 0)).toBe(month.itemsCents);
    expect(month.categories[0].accessibilityLabel).toBe('Carnes: R$ 100,00, 50% do mês, não teve em setembro');
    expect(month.categories[4].accessibilityLabel).toBe('Temperos e molhos: R$ 0,50, menos de 1% do mês, não teve em setembro');
  });

  it('a parte é sobre a soma dos itens: com desconto no total, as categorias continuam somando 100%', () => {
    const month = marketMonth([receipt(at(MONTH, 10), [line('Arroz', 'graos', 75), line('Ração', 'pet', 25)], { total: 80 })], MONTH, AFTER);
    expect(month.categories.map((c) => c.share)).toEqual(['75%', '25%']);
  });

  it('empate no valor: pelo nome, sempre na mesma ordem', () => {
    const lines = [line('Sal', 'temperos', 10), line('Arroz', 'graos', 10), line('Leite', 'laticinios', 10), line('Água', 'bebidas', 10)];
    const forward = marketMonth([receipt(at(MONTH, 10), lines)], MONTH, AFTER);
    const backward = marketMonth([receipt(at(MONTH, 10), [...lines].reverse())], MONTH, AFTER);
    expect(forward.categories.map((c) => c.label)).toEqual(['Bebidas', 'Grãos, massas e cereais', 'Laticínios', 'Temperos e molhos']);
    expect(backward.categories.map((c) => c.label)).toEqual(forward.categories.map((c) => c.label));
    expect(forward.items.map((i) => i.name)).toEqual(['Água', 'Arroz', 'Leite', 'Sal']);
    expect(backward.items.map((i) => i.name)).toEqual(forward.items.map((i) => i.name));
  });
});

describe('por item', () => {
  it('o mesmo produto em várias idas e duas vezes na mesma nota é um item só', () => {
    const month = marketMonth(
      [
        receipt(at(MONTH, 3), [line('Leite', 'laticinios', 12, 2), line('Leite', 'laticinios', 6, 1), line('Arroz', 'graos', 30)]),
        receipt(at(MONTH, 12), [line('Leite', 'laticinios', 24, 4)], { storeId: 'dia', storeName: 'Dia' }),
        receipt(at(MONTH, 20), [line('Leite', 'laticinios', 6.5, 1)]),
      ],
      MONTH,
      AFTER,
    );
    expect(month.items.map((i) => [i.name, i.amount, i.share, i.detail])).toEqual([
      ['Leite', 'R$ 48,50', '62%', '8 un · em 3 idas'],
      ['Arroz', 'R$ 30,00', '38%', '1 un · em 1 ida'],
    ]);
    expect(month.items[0]).toMatchObject({ productId: 'Leite', category: 'laticinios', key: 'p:Leite' });
    expect(month.items[0].accessibilityLabel).toBe('Leite: R$ 48,50, 62% do mês, 8 un, em 3 idas');
  });

  it('item sem produto junta pelo nome sem acento, maiúscula nem pontuação, e não abre produto', () => {
    const month = marketMonth(
      [
        receipt(at(MONTH, 3), [loose('SACOLA PLAST.', 0.5), loose('PAO FRANCES KG', 8, { suggestedName: 'Pão francês', suggestedCategory: 'padaria' })]),
        receipt(at(MONTH, 12), [loose('Sacola plast', 0.25), loose('PAO FR', 6, { suggestedName: 'pao frances', suggestedCategory: 'padaria' })]),
      ],
      MONTH,
      AFTER,
    );
    expect(month.items.map((i) => [i.name, i.amount, i.detail, i.productId])).toEqual([
      // O nome é o da compra mais recente.
      ['pao frances', 'R$ 14,00', '2 un · em 2 idas', null],
      ['Sacola plast', 'R$ 0,75', '2 un · em 2 idas', null],
    ]);
  });

  it('nome parecido não junta: "Arroz 5kg" e "Arroz Tio João 5 kg" são duas linhas', () => {
    const month = marketMonth(
      [receipt(at(MONTH, 3), [line('Arroz 5kg', 'graos', 25), line('Arroz Tio João 5 kg', 'graos', 28), loose('ARROZ', 20, { suggestedCategory: 'graos' })])],
      MONTH,
      AFTER,
    );
    expect(month.items.map((i) => i.name)).toEqual(['Arroz Tio João 5 kg', 'Arroz 5kg', 'ARROZ']);
  });

  it('o mesmo nome solto em duas categorias fica em cada uma: os itens de uma categoria somam o valor dela', () => {
    const month = marketMonth(
      [receipt(at(MONTH, 3), [loose('DIVERSOS', 5, { suggestedCategory: 'limpeza' }), loose('DIVERSOS', 7)])],
      MONTH,
      AFTER,
    );
    expect(month.items.map((i) => [i.name, i.category, i.amount])).toEqual([
      ['DIVERSOS', 'outros', 'R$ 7,00'],
      ['DIVERSOS', 'limpeza', 'R$ 5,00'],
    ]);
    for (const category of month.categories) {
      expect(month.items.filter((i) => i.category === category.key).reduce((sum, i) => sum + i.cents, 0)).toBe(category.cents);
    }
  });

  it('quantidades da mesma grandeza se somam; as que não se somam viram número de compras', () => {
    const month = marketMonth(
      [
        receipt(at(MONTH, 3), [
          line('Banana', 'hortifruti', 6, 1.2, 'kg'),
          line('Banana', 'hortifruti', 2, 300, 'g'),
          line('Suco', 'bebidas', 9, 1, 'l'),
          line('Suco', 'bebidas', 4, 500, 'ml'),
          line('Queijo', 'laticinios', 10, 250, 'g'),
          line('Queijo', 'laticinios', 10, 0.25, 'kg'),
          line('Tomate', 'hortifruti', 5, 0.8, 'kg'),
        ]),
        receipt(at(MONTH, 9), [line('Tomate', 'hortifruti', 3, 4, 'un'), line('Tomate', 'hortifruti', 2, 0.3, 'kg')]),
      ],
      MONTH,
      AFTER,
    );
    const detail = (name: string) => month.items.find((i) => i.name === name)?.detail;
    expect(detail('Banana')).toBe('1,5 kg · em 1 ida');
    expect(detail('Suco')).toBe('1,5 l · em 1 ida');
    expect(detail('Queijo')).toBe('500 g · em 1 ida');
    // kg e un não se somam.
    expect(detail('Tomate')).toBe('3 compras · em 2 idas');
  });

  it('totalQuantity', () => {
    expect(totalQuantity([])).toBeNull();
    expect(totalQuantity([{ quantity: 2, unit: 'un' }, { quantity: 10, unit: 'un' }])).toBe('12 un');
    expect(totalQuantity([{ quantity: 0.1, unit: 'kg' }, { quantity: 0.2, unit: 'kg' }])).toBe('300 g');
    expect(totalQuantity([{ quantity: 1.234, unit: 'kg' }, { quantity: 500, unit: 'g' }])).toBe('1,734 kg');
    expect(totalQuantity([{ quantity: 700, unit: 'ml' }, { quantity: 300, unit: 'ml' }])).toBe('1 l');
    expect(totalQuantity([{ quantity: 2, unit: 'l' }, { quantity: 1, unit: 'kg' }])).toBeNull();
    expect(totalQuantity([{ quantity: 2, unit: 'un' }, { quantity: 1, unit: 'kg' }])).toBeNull();
  });
});

describe('idas e mercados', () => {
  it('as idas vêm da mais recente para a mais antiga, com o que foi pago e os itens', () => {
    const early = receipt(at(MONTH, 3, 9), [line('Arroz', 'graos', 30)]);
    const sameDayLater = receipt(at(MONTH, 3, 19), [line('Feijão', 'graos', 9), line('Café', 'cafe_cha', 18)], { storeId: 'dia', storeName: 'Dia' });
    const last = receipt(at(MONTH, 28), [line('Leite', 'laticinios', 6)], { storeId: null, storeName: null });
    const month = marketMonth([sameDayLater, last, early], MONTH, AFTER);
    expect(month.trips).toEqual([
      { receiptId: last.id, storeName: 'Sem mercado informado', cents: 600, amount: 'R$ 6,00', detail: '28 out · 1 item', accessibilityLabel: 'Sem mercado informado: R$ 6,00, 28 out, 1 item' },
      { receiptId: sameDayLater.id, storeName: 'Dia', cents: 2700, amount: 'R$ 27,00', detail: '3 out · 2 itens', accessibilityLabel: 'Dia: R$ 27,00, 3 out, 2 itens' },
      { receiptId: early.id, storeName: 'Assaí', cents: 3000, amount: 'R$ 30,00', detail: '3 out · 1 item', accessibilityLabel: 'Assaí: R$ 30,00, 3 out, 1 item' },
    ]);
    expect(month.headline).toBe('R$ 63,00 em 3 idas');
  });

  it('por mercado: junta pelo id, não pelo nome, e as notas sem mercado ficam juntas', () => {
    const month = marketMonth(
      [
        receipt(at(MONTH, 3), [line('Arroz', 'graos', 30)], { storeId: 'a1', storeName: 'Assaí' }),
        receipt(at(MONTH, 5), [line('Arroz', 'graos', 31)], { storeId: 'a1', storeName: 'Assaí' }),
        // Outro mercado com o mesmo nome (outra unidade).
        receipt(at(MONTH, 6), [line('Arroz', 'graos', 29)], { storeId: 'a2', storeName: 'Assaí' }),
        receipt(at(MONTH, 7), [line('Arroz', 'graos', 10)], { storeId: null, storeName: null, total: 12 }),
        receipt(at(MONTH, 8), [line('Arroz', 'graos', 5)], { storeId: null, storeName: null }),
      ],
      MONTH,
      AFTER,
    );
    expect(month.stores).toEqual([
      { key: 'a1', name: 'Assaí', cents: 6100, amount: 'R$ 61,00', detail: '2 idas', accessibilityLabel: 'Assaí: R$ 61,00 em 2 idas' },
      { key: 'a2', name: 'Assaí', cents: 2900, amount: 'R$ 29,00', detail: '1 ida', accessibilityLabel: 'Assaí: R$ 29,00 em 1 ida' },
      // O que foi pago, com o valor sem item lido.
      { key: '', name: 'Sem mercado informado', cents: 1700, amount: 'R$ 17,00', detail: '2 idas', accessibilityLabel: 'Sem mercado informado: R$ 17,00 em 2 idas' },
    ]);
    expect(month.stores.reduce((sum, s) => sum + s.cents, 0)).toBe(month.totalCents);
    expect(month.trips.reduce((sum, t) => sum + t.cents, 0)).toBe(month.totalCents);
  });
});

describe('os limites do mês', () => {
  it('vale a data da compra no fuso do aparelho: da meia-noite do dia 1 ao último segundo do último dia', () => {
    const month = marketMonth(
      [
        receipt(at(MONTH, 1, 0, 0, 0), [line('Primeiro', 'graos', 1)]),
        receipt(at(MONTH, 31, 23, 59, 59), [line('Último', 'graos', 2)]),
        // Um segundo antes e a meia-noite seguinte: outros meses.
        receipt(at('2026-09', 30, 23, 59, 59), [line('Setembro', 'graos', 4)]),
        receipt(at('2026-11', 1, 0, 0, 0), [line('Novembro', 'graos', 8)]),
        receipt(at('2025-10', 15), [line('Ano passado', 'graos', 16)]),
      ],
      MONTH,
      '2026-12-01',
    );
    expect(month.items.map((i) => i.name)).toEqual(['Último', 'Primeiro']);
    expect(month.totalCents).toBe(300);
    expect(month.title).toBe('Mercado de outubro');
  });

  it('mês sem nota nenhuma', () => {
    const month = marketMonth([], MONTH, '2026-10-13');
    expect(month).toMatchObject({
      title: 'Mercado de outubro até hoje',
      totalCents: 0,
      itemsCents: 0,
      headline: 'R$ 0,00 em 0 idas',
      comparison: null,
      trips: [],
      categories: [],
      items: [],
      stores: [],
      discount: null,
      unread: null,
      noValue: null,
      pharmacy: null,
      drafts: null,
      emptyTitle: 'Nenhuma nota de mercado em outubro',
    });
    // Só o mês anterior tem nota: este continua vazio, sem frase de comparação.
    expect(marketMonth([receipt(at('2026-09', 10), [line('Arroz', 'graos', 30)])], MONTH, '2026-10-13').comparison).toBeNull();
  });

  it('data que não dá para ler fica de fora', () => {
    expect(marketMonth([receipt('não é data', [line('Arroz', 'graos', 30)])], MONTH, AFTER).trips).toEqual([]);
  });

  it('monthFromParam: o mês da URL, se existe e não passa do corrente', () => {
    expect(monthFromParam('2026-09', '2026-10')).toBe('2026-09');
    expect(monthFromParam('2026-10', '2026-10')).toBe('2026-10');
    expect(monthFromParam(['2026-08', '2026-09'], '2026-10')).toBe('2026-08');
    expect(monthFromParam('2026-11', '2026-10')).toBe('2026-10');
    expect(monthFromParam('2026-13', '2026-10')).toBe('2026-10');
    expect(monthFromParam('setembro', '2026-10')).toBe('2026-10');
    expect(monthFromParam(undefined, '2026-10')).toBe('2026-10');
  });
});

describe('comparação com o mês anterior', () => {
  const september = [
    receipt(at('2026-09', 5), [line('Arroz', 'graos', 30), line('Picanha', 'carnes', 100)]),
    receipt(at('2026-09', 20), [line('Arroz', 'graos', 32), line('Ração', 'pet', 80), line('Sal', 'temperos', 4)], { total: 110 }),
  ];
  const october = [
    receipt(at(MONTH, 4), [line('Arroz', 'graos', 65), line('Picanha', 'carnes', 100), line('Café', 'cafe_cha', 18), line('Sal', 'temperos', 2)]),
  ];

  it('mês fechado: contra o mês anterior inteiro', () => {
    const month = marketMonth([...september, ...october], MONTH, AFTER);
    // Setembro pagou 130 + 110 = 240; outubro, 185.
    expect(month.comparison).toBe('R$ 55,00 a menos que em setembro');
    expect(month.categories.map((c) => [c.label, c.versusPrevious])).toEqual([
      ['Carnes', 'Igual a setembro'],
      ['Grãos, massas e cereais', 'R$ 3,00 a mais que em setembro'],
      ['Café e chá', 'Não teve em setembro'],
      ['Temperos e molhos', 'R$ 2,00 a menos que em setembro'],
    ]);
    expect(month.items.map((i) => [i.name, i.detail])).toEqual([
      ['Picanha', '1 un · em 1 ida · setembro: R$ 100,00'],
      ['Arroz', '1 un · em 1 ida · setembro: R$ 62,00'],
      ['Café', '1 un · em 1 ida'],
      ['Sal', '1 un · em 1 ida · setembro: R$ 4,00'],
    ]);
  });

  it('mês corrente: o total e as categorias contra o anterior só até o mesmo dia; o item mostra o mês anterior inteiro', () => {
    const month = marketMonth([...september, ...october], MONTH, '2026-10-13');
    expect(month.title).toBe('Mercado de outubro até hoje');
    // Até 13 de setembro só existia a ida do dia 5 (R$ 130,00).
    expect(month.comparison).toBe('R$ 55,00 a mais que até o dia 13 de setembro');
    expect(month.categories.map((c) => [c.label, c.versusPrevious])).toEqual([
      ['Carnes', 'Igual ao gasto até o dia 13 de setembro'],
      ['Grãos, massas e cereais', 'R$ 35,00 a mais que até o dia 13 de setembro'],
      ['Café e chá', 'Não teve até o dia 13 de setembro'],
      ['Temperos e molhos', 'Não teve até o dia 13 de setembro'],
    ]);
    expect(month.items.find((i) => i.name === 'Arroz')?.detail).toBe('1 un · em 1 ida · setembro: R$ 62,00');
    expect(month.items.find((i) => i.name === 'Sal')?.detail).toBe('1 un · em 1 ida · setembro: R$ 4,00');
  });

  it('o dia de hoje entra na janela, e o seguinte não', () => {
    expect(marketMonth([...september, ...october], MONTH, '2026-10-05').comparison).toBe('R$ 55,00 a mais que até o dia 5 de setembro');
    expect(marketMonth([...september, ...october], MONTH, '2026-10-04').comparison).toBe('Não teve nota de mercado até o dia 4 de setembro');
    expect(marketMonth([...september, ...october], MONTH, '2026-10-20').comparison).toBe('R$ 55,00 a menos que até o dia 20 de setembro');
  });

  it('último dia do mês contra um mês mais curto: o anterior inteiro', () => {
    expect(marketMonth([...september, ...october], MONTH, '2026-10-31').comparison).toBe('R$ 55,00 a menos que em setembro');
  });

  it('igual, e mês anterior sem nota', () => {
    const same = [receipt(at('2026-09', 5), [line('Arroz', 'graos', 30)]), receipt(at(MONTH, 4), [line('Arroz', 'graos', 30)])];
    expect(marketMonth(same, MONTH, AFTER).comparison).toBe('Igual ao gasto em setembro');
    expect(marketMonth(october, MONTH, AFTER).comparison).toBe('Não teve nota de mercado em setembro');
    // Janeiro compara com dezembro do ano anterior.
    const turn = [receipt(at('2025-12', 5), [line('Arroz', 'graos', 30)]), receipt(at('2026-01', 4), [line('Arroz', 'graos', 40)])];
    expect(marketMonth(turn, '2026-01', '2026-02-01').comparison).toBe('R$ 10,00 a mais que em dezembro');
  });

  it('a farmácia e as notas só de farmácia do mês anterior não entram na comparação', () => {
    const receipts = [
      receipt(at('2026-09', 5), [line('Arroz', 'graos', 30), line('Dipirona', 'medicamentos', 50)]),
      receipt(at('2026-09', 6), [line('Vitamina C', 'suplementos', 25)]),
      receipt(at(MONTH, 4), [line('Arroz', 'graos', 30)]),
    ];
    expect(marketMonth(receipts, MONTH, AFTER).comparison).toBe('Igual ao gasto em setembro');
  });
});

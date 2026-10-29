import { beforeAll, describe, expect, it } from '@jest/globals';

import { MARKET_TREND_MONTHS, marketMonth, marketTrend, shortAmount, type MarketLine, type MarketReceipt } from '../marketSpend';

// As datas da nota são do fuso do aparelho: aqui, o de São Paulo, o da casa, que a suíte toda usa
// (scripts/jestTimezone.js, o globalSetup do Jest). A virada do mês às 23h30 de um dia 30 é 2h30 do dia 1º em
// UTC, e a nota tem de ficar no mês de São Paulo.
beforeAll(() => {
  // Garante que o fuso valeu: sem isso, um teste de virada de mês passaria por acaso noutro fuso.
  expect(new Date('2026-10-01T02:30:00Z').getDate()).toBe(30);
});

let nextId = 0;

const line = (name: string, category: string, totalPrice: number | null): MarketLine => ({
  productId: name,
  productName: name,
  productCategory: category,
  rawDescription: name.toUpperCase(),
  suggestedName: null,
  suggestedCategory: null,
  quantity: 1,
  unit: 'un',
  totalPrice,
});

/** Nota confirmada; `purchasedAt` com o fuso escrito, como o banco devolve. */
const receipt = (purchasedAt: string, lines: MarketLine[], partial: Partial<MarketReceipt> = {}): MarketReceipt => ({
  id: `r${++nextId}`,
  purchasedAt,
  status: 'confirmed',
  total: null,
  storeId: 's1',
  storeName: 'Assaí',
  lines,
  ...partial,
});

/** Meio-dia em São Paulo. */
const noon = (date: string) => `${date}T12:00:00-03:00`;

describe('tendência do mercado', () => {
  it('seis meses, do mais antigo ao da tela; mês sem ida aparece como "sem ida" e fica fora da média', () => {
    const receipts = [
      receipt(noon('2026-05-10'), [line('Arroz', 'graos', 100)]),
      // Junho sem nota nenhuma.
      receipt(noon('2026-07-02'), [line('Arroz', 'graos', 200)]),
      receipt(noon('2026-08-15'), [line('Carne', 'carnes', 250), line('Leite', 'laticinios', 50)]),
      receipt(noon('2026-09-20'), [line('Arroz', 'graos', 150)]),
      receipt(noon('2026-10-05'), [line('Arroz', 'graos', 80)]),
    ];
    const trend = marketTrend(receipts, '2026-10', '2026-10-13');
    expect(trend.bars).toHaveLength(MARKET_TREND_MONTHS);
    expect(trend.bars.map((bar) => bar.month)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(trend.bars.map((bar) => bar.label)).toEqual(['mai', 'jun', 'jul', 'ago', 'set', 'out']);
    expect(trend.bars.map((bar) => bar.cents)).toEqual([10000, 0, 20000, 30000, 15000, 8000]);
    expect(trend.bars[1]).toMatchObject({ hasTrips: false, amount: 'sem ida ao mercado', short: 'sem ida', partial: false, year: null });
    // O mês corrente vem marcado e só até hoje.
    expect(trend.bars[5]).toMatchObject({ partial: true, note: 'hoje', amount: 'R$ 80,00', short: '80' });
    expect(trend.bars.slice(0, 5).every((bar) => bar.note === null && !bar.partial)).toBe(true);
    // Média dos meses fechados com nota: maio, julho, agosto e setembro (junho fora, outubro pela metade).
    expect(trend.averageCents).toBe(18750);
    expect(trend.average).toBe('Média dos meses fechados: R$ 187,50');
    expect(trend.averageNote).toBe('1 mês sem ida ao mercado fica fora da média.');
    expect(trend.maxCents).toBe(30000);
    expect(trend.title).toBe('Últimos 6 meses');
    expect(trend.hasAny).toBe(true);
    // Cada mês é um botão: o leitor de tela diz o mês e o valor (sem o título, que a tela escreve logo acima).
    expect(trend.bars.map((bar) => bar.spoken)).toEqual([
      'Maio: R$ 100,00',
      'Junho: sem ida ao mercado',
      'Julho: R$ 200,00',
      'Agosto: R$ 300,00',
      'Setembro: R$ 150,00',
      'Outubro até hoje: R$ 80,00',
    ]);
    expect([trend.average, trend.averageNote]).toEqual(['Média dos meses fechados: R$ 187,50', '1 mês sem ida ao mercado fica fora da média.']);
  });

  it('a nota fica no mês de São Paulo, na virada do mês e do ano', () => {
    const receipts = [
      // 23h30 do último dia: ainda é setembro, embora já seja outubro em UTC.
      receipt('2026-09-30T23:30:00-03:00', [line('Arroz', 'graos', 10)]),
      // Dez minutos depois da meia-noite: outubro.
      receipt('2026-10-01T00:10:00-03:00', [line('Arroz', 'graos', 20)]),
      // A mesma virada, gravada em UTC.
      receipt('2026-09-01T02:59:00Z', [line('Feijão', 'graos', 5)]),
      receipt('2026-09-01T03:00:00Z', [line('Feijão', 'graos', 7)]),
    ];
    const trend = marketTrend(receipts, '2026-10', '2026-10-31');
    const byMonth = Object.fromEntries(trend.bars.map((bar) => [bar.month, bar.cents]));
    expect(byMonth['2026-08']).toBe(500);
    expect(byMonth['2026-09']).toBe(1700);
    expect(byMonth['2026-10']).toBe(2000);

    // A janela atravessa o ano: de outubro de 2025 a março de 2026.
    const newYear = [
      receipt('2025-12-31T23:59:00-03:00', [line('Arroz', 'graos', 40)]),
      receipt('2026-01-01T00:00:00-03:00', [line('Arroz', 'graos', 60)]),
    ];
    const across = marketTrend(newYear, '2026-03', '2026-10-13');
    expect(across.bars.map((bar) => bar.month)).toEqual(['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03']);
    expect(across.bars.map((bar) => bar.cents)).toEqual([0, 0, 4000, 6000, 0, 0]);
    // Mês já fechado: nenhuma barra pela metade, e o título diz até quando.
    expect(across.bars.some((bar) => bar.partial)).toBe(false);
    expect(across.title).toBe('6 meses até março');
    expect(across.averageCents).toBe(5000);
    expect(across.averageNote).toBe('4 meses sem ida ao mercado ficam fora da média.');
    // O ano aparece no primeiro mês de cada ano da janela, e o leitor de tela diz o ano de cada mês.
    expect(across.bars.map((bar) => bar.year)).toEqual(['2025', null, null, '2026', null, null]);
    expect(across.bars[0].spoken).toBe('Outubro de 2025: sem ida ao mercado');
    expect(across.bars.map((bar) => bar.spoken)).toEqual(expect.arrayContaining(['Dezembro de 2025: R$ 40,00', 'Janeiro de 2026: R$ 60,00']));
    // Dentro de um ano só, nada de ano.
    expect(trend.bars.every((bar) => bar.year === null)).toBe(true);
  });

  it('mês corrente: só até hoje; a nota com data depois de hoje fica de fora, como no cabeçalho', () => {
    const receipts = [
      receipt(noon('2026-10-13'), [line('Arroz', 'graos', 30)]),
      // Hoje às 23h50 ainda é hoje.
      receipt('2026-10-13T23:50:00-03:00', [line('Feijão', 'graos', 12)]),
      // Amanhã: data futura, de fora até o dia chegar.
      receipt('2026-10-14T00:05:00-03:00', [line('Carne', 'carnes', 90)]),
    ];
    const today = '2026-10-13';
    const trend = marketTrend(receipts, '2026-10', today);
    const current = trend.bars.at(-1)!;
    expect(current).toMatchObject({ cents: 4200, partial: true, note: 'hoje' });
    // A barra do mês é o total do cabeçalho, das mesmas notas.
    expect(current.cents).toBe(marketMonth(receipts, '2026-10', today).totalCents);
    // Só o mês corrente: não há mês fechado com nota, então não há média.
    expect(trend.averageCents).toBeNull();
    expect(trend.average).toBeNull();
    expect(trend.averageNote).toBeNull();
    // Quando o dia chega, a nota entra.
    expect(marketTrend(receipts, '2026-10', '2026-10-14').bars.at(-1)!.cents).toBe(13200);
    // O mesmo outubro, olhado de novembro: fechado e inteiro.
    const closed = marketTrend(receipts, '2026-10', '2026-11-02');
    expect(closed.bars.at(-1)).toMatchObject({ cents: 13200, partial: false, note: null });
    expect(closed.averageCents).toBe(13200);
  });

  it('o total é o que foi pago: com o desconto do total, sem a farmácia e sem rascunho', () => {
    const receipts = [
      // 100 de mercado e 50 de remédio, pagos 135: o desconto de 15 se reparte, 10 no mercado.
      receipt(noon('2026-09-10'), [line('Carne', 'carnes', 100), line('Dipirona', 'medicamentos', 50)], { total: 135 }),
      // Nota só de farmácia não é ida ao mercado: agosto fica sem ida.
      receipt(noon('2026-08-10'), [line('Dipirona', 'medicamentos', 20)]),
      // Rascunho não conta.
      receipt(noon('2026-07-10'), [line('Arroz', 'graos', 99)], { status: 'draft' }),
      // Nota com total acima dos itens: o valor sem item lido entra no total.
      receipt(noon('2026-06-10'), [line('Arroz', 'graos', 20)], { total: 25 }),
    ];
    const trend = marketTrend(receipts, '2026-09', '2026-10-13');
    const byMonth = Object.fromEntries(trend.bars.map((bar) => [bar.month, bar]));
    expect(byMonth['2026-09'].cents).toBe(9000);
    expect(byMonth['2026-09'].cents).toBe(marketMonth(receipts, '2026-09', '2026-10-13').totalCents);
    expect(byMonth['2026-08']).toMatchObject({ hasTrips: false, cents: 0, amount: 'sem ida ao mercado', short: 'sem ida' });
    expect(byMonth['2026-07']).toMatchObject({ hasTrips: false, cents: 0 });
    expect(byMonth['2026-06'].cents).toBe(2500);
  });

  it('uma categoria: a soma dos itens dela pelo valor impresso, com zero no mês com notas sem ela', () => {
    const receipts = [
      receipt(noon('2026-08-03'), [line('Banana', 'hortifruti', 12), line('Arroz', 'graos', 30)], { total: 40 }),
      receipt(noon('2026-09-03'), [line('Arroz', 'graos', 30)]),
      receipt(noon('2026-10-03'), [line('Banana', 'hortifruti', 8), line('Maçã', 'hortifruti', 10)]),
      receipt(noon('2026-10-04'), [line('Banana', 'hortifruti', 99)], { status: 'draft' }),
    ];
    const today = '2026-10-13';
    const trend = marketTrend(receipts, '2026-10', today, 'hortifruti');
    const byMonth = Object.fromEntries(trend.bars.map((bar) => [bar.month, bar]));
    // Agosto: o valor impresso, sem a parte do desconto do total (é a conta da linha da categoria).
    expect(byMonth['2026-08']).toMatchObject({ cents: 1200, amount: 'R$ 12,00', hasTrips: true });
    // Setembro teve ida, mas nada de hortifrúti: zero, não "sem ida".
    expect(byMonth['2026-09']).toMatchObject({ cents: 0, amount: 'R$ 0,00', short: '0', hasTrips: true });
    expect(byMonth['2026-07']).toMatchObject({ hasTrips: false, short: 'sem ida' });
    expect(byMonth['2026-10']).toMatchObject({ cents: 1800, partial: true });
    // A barra do mês é a linha da categoria na tela.
    expect(byMonth['2026-10'].cents).toBe(marketMonth(receipts, '2026-10', today).categories.find((c) => c.key === 'hortifruti')!.cents);
    // A média conta setembro (com ida, zero de hortifrúti) e deixa de fora os meses sem nota nenhuma.
    expect(trend.averageCents).toBe(600);
    expect(trend.averageNote).toBe('3 meses sem ida ao mercado ficam fora da média.');
    expect(trend.title).toMatch(/ nos últimos 6 meses$/);
    expect(marketTrend(receipts, '2026-09', today, 'hortifruti').title).toMatch(/ em 6 meses até setembro$/);
  });

  it('sem nenhuma nota na janela: tudo "sem ida", sem média, e a tela não mostra o cartão', () => {
    const trend = marketTrend([], '2026-10', '2026-10-13');
    expect(trend.hasAny).toBe(false);
    expect(trend.bars.every((bar) => bar.short === 'sem ida' && bar.cents === 0)).toBe(true);
    expect(trend.maxCents).toBe(0);
    expect(trend.average).toBeNull();
  });

  it('o valor curto cabe embaixo da barra', () => {
    expect(shortAmount(0)).toBe('0');
    expect(shortAmount(84_049)).toBe('840');
    expect(shortAmount(99_960)).toBe('1 mil');
    expect(shortAmount(124_000)).toBe('1,2 mil');
    expect(shortAmount(1_000_000)).toBe('10 mil');
    expect(shortAmount(1_249_900)).toBe('12 mil');
  });
});

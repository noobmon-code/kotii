import { describe, expect, it } from '@jest/globals';

import { toISODate } from '../dates';
import { buildEntries, monthRange, summarize } from '../finance';
import {
  MARKET_ITEMS_SHOWN,
  MARKET_VIEWS,
  RECEIPT_CHECK_CENTS,
  receiptTotalMismatch,
  marketMonth,
  marketTotal,
  monthFromParam,
  totalQuantity,
  viewFromParam,
  type MarketLine,
  type MarketReceipt,
  type MarketTotalReceipt,
} from '../marketSpend';

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

  it('nota só de farmácia não é ida ao mercado: o desconto do total dela não entra na conta, e a farmácia aparece pelo que foi pago', () => {
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
    // Impresso: 37; pago: 30. A linha da farmácia diz o que foi pago, como na nota que mistura as duas coisas.
    expect(month.pharmacy).toBe('Farmácia, fora desta conta: R$ 30,00');
    expect(month.pharmacyCents).toBe(3000);
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
    expect(one.drafts?.label).toBe('1 nota de outubro ainda espera a revisão. Ela entra nesta conta quando for confirmada.');
    expect(marketMonth([confirmed, draft(), draft()], MONTH, AFTER).drafts?.label).toBe(
      '2 notas de outubro ainda esperam a revisão. Elas entram nesta conta quando forem confirmadas.',
    );
    expect(marketMonth([confirmed], MONTH, AFTER).drafts).toBeNull();
    // Rascunho de outro mês não é deste.
    expect(marketMonth([confirmed, receipt(at('2026-09', 30), [], { status: 'draft' })], MONTH, AFTER).drafts).toBeNull();
  });

  it('os rascunhos do mês vêm um a um, com mercado e data, para abrir a nota: até três, e o resto é contado', () => {
    const confirmed = receipt(at(MONTH, 10), [line('Arroz', 'graos', 30)]);
    const draft = (day: number, partial: Partial<MarketReceipt> = {}) => receipt(at(MONTH, day), [], { status: 'draft', ...partial });
    const first = draft(11, { storeId: 'dia', storeName: 'Dia' });
    const second = draft(12, { storeId: null, storeName: null });
    const one = marketMonth([confirmed, first], MONTH, AFTER);
    expect(one.drafts).toEqual({
      label: '1 nota de outubro ainda espera a revisão. Ela entra nesta conta quando for confirmada.',
      receipts: [{ receiptId: first.id, storeName: 'Dia', date: '11 out', value: 'Revisar', accessibilityLabel: 'Dia, 11 out. Abrir a nota para revisar' }],
      more: null,
    });
    const third = draft(13);
    // Da mais recente para a mais antiga; com três, ainda cabem todas.
    const three = marketMonth([first, confirmed, third, second], MONTH, AFTER);
    expect(three.drafts?.receipts.map((r) => [r.receiptId, r.storeName, r.date])).toEqual([
      [third.id, 'Assaí', '13 out'],
      [second.id, 'Sem mercado informado', '12 out'],
      [first.id, 'Dia', '11 out'],
    ]);
    expect(three.drafts?.more).toBeNull();
    const fourth = draft(14);
    const four = marketMonth([first, second, third, fourth, confirmed], MONTH, AFTER);
    expect(four.drafts?.label).toBe('4 notas de outubro ainda esperam a revisão. Elas entram nesta conta quando forem confirmadas.');
    expect(four.drafts?.receipts.map((r) => r.receiptId)).toEqual([fourth.id, third.id, second.id]);
    expect(four.drafts?.more).toBe('e mais 1 em Finanças > Notas');
    expect(marketMonth([first, second, third, fourth, draft(15), draft(16)], MONTH, AFTER).drafts?.more).toBe('e mais 3 em Finanças > Notas');
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

  it('diferença de poucos centavos: os valores ficam exatos, mas a nota só é listada para conferir acima de 5 centavos', () => {
    const cheaper = receipt(at(MONTH, 5), [line('Arroz', 'graos', 60.01)], { total: 60 });
    const oneCent = receipt(at(MONTH, 6), [line('Feijão', 'graos', 9)], { total: 9.01 });
    const fiveCents = receipt(at(MONTH, 7), [line('Café', 'cafe_cha', 18)], { total: 18.05 });
    const exact = marketMonth([cheaper, oneCent, fiveCents], MONTH, AFTER);
    // As categorias e as duas linhas continuam somando o total do mês, centavo por centavo.
    expect(exact.headline).toBe('R$ 87,06 em 3 idas');
    expect(exact.discount?.value).toBe('−R$ 0,01');
    expect(exact.unread).toEqual({ label: 'Nas notas, sem item lido', value: 'R$ 0,06', accessibilityLabel: 'Nas notas, sem item lido: R$ 0,06', receipts: [] });
    expect(exact.itemsCents - 1 + 6).toBe(exact.totalCents);
    // 6 centavos: a tela da nota já avisa que a soma não bate, e a nota entra na lista.
    const sixCents = receipt(at(MONTH, 8), [line('Leite', 'laticinios', 6)], { total: 6.06 });
    const listed = marketMonth([cheaper, oneCent, fiveCents, sixCents], MONTH, AFTER);
    expect(listed.unread?.value).toBe('R$ 0,12');
    expect(listed.unread?.receipts.map((r) => [r.receiptId, r.value])).toEqual([[sixCents.id, 'R$ 0,06']]);
    expect(RECEIPT_CHECK_CENTS).toBe(5);
  });

  describe('nota com itens de mercado e de farmácia', () => {
    const paidTogether = (month: ReturnType<typeof marketMonth>) => month.totalCents + month.pharmacyCents;

    it('desconto no total: repartido entre o mercado e a farmácia na proporção do que está impresso', () => {
      const month = marketMonth(
        [receipt(at(MONTH, 10), [line('Arroz', 'graos', 70), line('Dipirona', 'medicamentos', 30)], { total: 90 })],
        MONTH,
        AFTER,
      );
      // O item continua com o valor impresso.
      expect(rows(month.items, (i) => i.name)).toEqual([['Arroz', 'R$ 70,00']]);
      expect(month.itemsCents).toBe(7000);
      // Dos 10 de desconto, 7 são do mercado (70 de 100) e 3 da farmácia.
      expect(month.discount?.value).toBe('−R$ 7,00');
      expect(month.totalCents).toBe(6300);
      expect(month.pharmacy).toBe('Farmácia, fora desta conta: R$ 27,00');
      expect(month.trips[0].detail).toBe('10 out · 1 item · farmácia fora: R$ 27,00');
      expect(paidTogether(month)).toBe(9000);
    });

    it('remédio com desconto grande e um item de higiene: a ida não fica negativa nem leva o desconto do remédio', () => {
      const drugstore = receipt(at(MONTH, 10), [line('Shampoo', 'higiene', 12), line('Losartana', 'medicamentos', 200)], {
        total: 172,
        storeId: 'drogasil',
        storeName: 'Drogasil',
      });
      const month = marketMonth([drugstore, receipt(at(MONTH, 11), [line('Arroz', 'graos', 30)], { total: 30 })], MONTH, AFTER);
      // 40 de desconto: 12/212 dele é do shampoo (R$ 2,26).
      expect(month.headline).toBe('R$ 39,74 em 2 idas');
      expect(month.discount?.value).toBe('−R$ 2,26');
      expect(month.trips.find((t) => t.receiptId === drugstore.id)).toMatchObject({ amount: 'R$ 9,74', detail: '10 out · 1 item · farmácia fora: R$ 162,26' });
      expect(month.stores.find((s) => s.key === 'drogasil')?.amount).toBe('R$ 9,74');
      expect(month.pharmacy).toBe('Farmácia, fora desta conta: R$ 162,26');
      expect(month.items.find((i) => i.name === 'Shampoo')?.amount).toBe('R$ 12,00');
    });

    it('desconto maior que os itens de mercado da nota: ainda assim nenhum valor negativo', () => {
      const chocolate = marketMonth([receipt(at(MONTH, 10), [line('Chocolate', 'doces', 8), line('Remédio', 'medicamentos', 150)], { total: 98 })], MONTH, AFTER);
      expect(chocolate.headline).toBe('R$ 4,96 em 1 ida');
      expect(chocolate.discount?.value).toBe('−R$ 3,04');
      expect(chocolate.pharmacy).toBe('Farmácia, fora desta conta: R$ 93,04');
      const shampoo = marketMonth([receipt(at(MONTH, 10), [line('Shampoo', 'higiene', 20), line('Remédio', 'medicamentos', 40)], { total: 20 })], MONTH, AFTER);
      expect(shampoo.trips[0].cents).toBe(667);
      expect(shampoo.stores[0].cents).toBe(667);
      expect(shampoo.pharmacyCents).toBe(1333);
    });

    it('total acima da soma: o valor sem item lido também é repartido, e a nota listada mostra a parte do mercado', () => {
      const mixed = receipt(at(MONTH, 9), [line('Feijão', 'graos', 9), line('Dipirona', 'medicamentos', 12)], { total: 41 });
      const month = marketMonth([mixed], MONTH, AFTER);
      // 20 a mais: 9/21 no mercado (R$ 8,57), o resto na farmácia.
      expect(month.unread?.value).toBe('R$ 8,57');
      expect(month.unread?.receipts.map((r) => [r.receiptId, r.value])).toEqual([[mixed.id, 'R$ 8,57']]);
      expect(month.discount).toBeNull();
      expect(month.totalCents).toBe(1757);
      expect(month.pharmacy).toBe('Farmácia, fora desta conta: R$ 23,43');
      expect(paidTogether(month)).toBe(4100);
    });

    it('o centavo que sobra da divisão fica com a farmácia, e as duas partes somam o total da nota', () => {
      const month = marketMonth([receipt(at(MONTH, 9), [line('Arroz', 'graos', 1), line('Dipirona', 'medicamentos', 2)], { total: 2 })], MONTH, AFTER);
      expect(month.discount?.value).toBe('−R$ 0,33');
      expect(month.totalCents).toBe(67);
      expect(month.pharmacyCents).toBe(133);
    });

    it('itens de mercado todos sem valor: a diferença inteira é da farmácia', () => {
      const month = marketMonth([receipt(at(MONTH, 9), [line('Brinde', 'outros', 0), line('Dipirona', 'medicamentos', 50)], { total: 40 })], MONTH, AFTER);
      expect(month.headline).toBe('R$ 0,00 em 1 ida');
      expect(month.trips[0].cents).toBe(0);
      expect(month.discount).toBeNull();
      expect(month.unread).toBeNull();
      expect(month.pharmacy).toBe('Farmácia, fora desta conta: R$ 40,00');
      expect(month.noValue?.label).toBe('1 item sem valor');
    });

    it('nenhum item com valor: não há proporção, e o total fica todo no mercado como "sem item lido"', () => {
      const month = marketMonth([receipt(at(MONTH, 9), [line('Brinde', 'outros', 0), line('Amostra', 'medicamentos', 0)], { total: 30 })], MONTH, AFTER);
      expect(month.headline).toBe('R$ 30,00 em 1 ida');
      expect(month.unread?.value).toBe('R$ 30,00');
      expect(month.pharmacy).toBeNull();
    });
  });

  it('item sem valor conta zero e é contado à parte, com a nota', () => {
    const first = receipt(at(MONTH, 8), [line('Arroz', 'graos', 30), line('Brinde', 'outros', 0), loose('SACOLA', null)]);
    const second = receipt(at(MONTH, 9), [line('Feijão', 'graos', 9), line('Arroz', 'graos', 0)], { storeId: 'dia', storeName: 'Dia' });
    const month = marketMonth([first, second], MONTH, AFTER);
    expect(month.totalCents).toBe(3900);
    expect(month.noValue).toEqual({
      label: '3 itens sem valor',
      // Nota confirmada não se edita: a frase não manda preencher nada.
      hint: 'Entram como zero neste total. Abra a nota para ver quais são.',
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
    expect(marketMonth([receipt(at(MONTH, 8), [line('Arroz', 'graos', 30), line('Brinde', 'outros', 0)])], MONTH, AFTER).noValue).toMatchObject({
      label: '1 item sem valor',
      hint: 'Entra como zero neste total. Abra a nota para ver qual é.',
    });
    expect(marketMonth([receipt(at(MONTH, 8), [line('Arroz', 'graos', 30)])], MONTH, AFTER).noValue).toBeNull();
  });

  it('mês só de farmácia com item sem valor: a frase não fala de um total que a tela não mostra', () => {
    const one = marketMonth([receipt(at(MONTH, 8), [line('Dipirona', 'medicamentos', 12), line('Gaze', 'medicamentos', 0)], { total: 10 })], MONTH, AFTER);
    expect(one.trips).toEqual([]);
    expect(one.noValue).toMatchObject({ label: '1 item sem valor', hint: 'Veio sem valor na nota. Abra a nota para ver qual é.' });
    const two = marketMonth(
      [receipt(at(MONTH, 8), [line('Dipirona', 'medicamentos', 12), line('Gaze', 'medicamentos', 0), line('Algodão', 'medicamentos', 0)], { total: 10 })],
      MONTH,
      AFTER,
    );
    expect(two.noValue).toMatchObject({ label: '2 itens sem valor', hint: 'Vieram sem valor na nota. Abra a nota para ver quais são.' });
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
      // Mercado e farmácia na mesma nota, com o total acima e abaixo da soma dos itens.
      receipt(at(MONTH, 9), [line('Feijão', 'graos', 9), line('Dipirona', 'medicamentos', 12)], { total: 41 }),
      receipt(at(MONTH, 10), [line('Shampoo', 'higiene', 12), line('Losartana', 'medicamentos', 200)], { total: 172 }),
      receipt(at(MONTH, 15), [line('Café', 'cafe_cha', 18.9), loose('SACOLA', 0.1)]),
      // Só farmácia, com desconto no total: também fecha, porque a farmácia conta o que foi pago.
      receipt(at(MONTH, 20), [line('Vitamina C', 'suplementos', 25)], { total: 20 }),
      receipt(at(MONTH, 21), [], { total: 7.77 }),
      receipt(at(MONTH, 22), [line('Brinde', 'outros', 0), line('Amostra', 'medicamentos', 0)], { total: 3 }),
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
    // 100 + 17,57 + 9,74 + 19 + 7,77 + 3 de mercado; 23,43 + 162,26 + 20 de farmácia.
    expect(month.totalCents).toBe(15708);
    expect(month.pharmacy).toBe('Farmácia, fora desta conta: R$ 205,69');
    expect(month.pharmacyCents).toBe(20569);
    expect(resumo).toBe(362.77);
    expect(month.totalCents + month.pharmacyCents).toBe(Math.round(resumo * 100));
  });

  it('fecha com o resumo em notas de todo jeito, e nenhuma ida ou mercado fica negativo', () => {
    // Sorteio com semente: os mesmos números a cada vez.
    let seed = 20261013;
    const random = (max: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % max;
    };
    const categories = ['graos', 'limpeza', 'pet', 'medicamentos', 'suplementos', 'higiene', 'outros'];
    for (let round = 0; round < 300; round++) {
      const receipts = Array.from({ length: 1 + random(4) }, (_, n) => {
        const lines = Array.from({ length: random(5) }, (__, i) => line(`Item ${i}`, categories[random(categories.length)], random(6) === 0 ? 0 : random(20000) / 100));
        const printed = lines.reduce((sum, l) => sum + Math.round((l.totalPrice ?? 0) * 100), 0);
        // Sem total, com o total certo, com desconto (até pagar quase nada) ou com valor a mais.
        const total = [null, printed / 100, Math.max(1, printed - random(printed + 1)) / 100, (printed + 1 + random(5000)) / 100][random(4)];
        return receipt(at(MONTH, 1 + n), lines, { total, storeId: `s${random(2)}` });
      });
      const month = marketMonth(receipts, MONTH, AFTER);
      const entries = buildEntries(
        receipts.map((r) => ({
          id: r.id,
          purchased_at_date: toISODate(new Date(r.purchasedAt)),
          total: r.total,
          store_name: r.storeName,
          items: r.lines.map((l) => ({ total_price: l.totalPrice ?? 0, category: l.productCategory })),
        })),
        [],
        [],
      );
      expect(month.totalCents + month.pharmacyCents).toBe(Math.round(summarize(entries, monthRange(MONTH)).total * 100));
      expect(Math.min(0, ...month.trips.map((t) => t.cents), ...month.stores.map((s) => s.cents))).toBe(0);
      expect(month.trips.reduce((sum, t) => sum + t.cents, 0)).toBe(month.totalCents);
      // As categorias mais as duas linhas de diferença somam o total do mês.
      const signed = (value: string | undefined) => Math.round(Number((value ?? '0').replace(/[^\d,]/g, '').replace(',', '.')) * 100);
      expect(month.itemsCents - signed(month.discount?.value) + signed(month.unread?.value)).toBe(month.totalCents);
    }
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
    // Setembro não teve nota de mercado nenhuma: o cabeçalho já diz isso, e as categorias não repetem.
    expect(month.comparison).toBe('Não teve nota de mercado em setembro');
    expect(month.categories.map((c) => c.versusPrevious)).toEqual(['', '', '', '', '']);
    expect(month.categories[0].accessibilityLabel).toBe('Carnes: R$ 100,00, 50% do mês');
    expect(month.categories[4].accessibilityLabel).toBe('Temperos e molhos: R$ 0,50, menos de 1% do mês');
    // O total pago é a soma dos itens: não há o que explicar sobre as porcentagens.
    expect(month.shareBasis).toBeNull();
  });

  it('mês anterior com nota de mercado: a categoria que ele não teve continua dizendo isso', () => {
    const receipts = [
      receipt(at('2026-09', 5), [line('Arroz', 'graos', 30)]),
      receipt(at(MONTH, 4), [line('Arroz', 'graos', 30), line('Café', 'cafe_cha', 18)]),
    ];
    const month = marketMonth(receipts, MONTH, AFTER);
    expect(month.categories.map((c) => [c.label, c.versusPrevious, c.accessibilityLabel])).toEqual([
      ['Grãos, massas e cereais', 'Igual a setembro', 'Grãos, massas e cereais: R$ 30,00, 63% do mês, igual a setembro'],
      ['Café e chá', 'Não teve em setembro', 'Café e chá: R$ 18,00, 38% do mês, não teve em setembro'],
    ]);
    // No mês corrente a janela é até o mesmo dia: sem nota de mercado nela, as categorias também se calam.
    const running = marketMonth(receipts, MONTH, '2026-10-04');
    expect(running.comparison).toBe('Não teve nota de mercado até o dia 4 de setembro');
    expect(running.categories.map((c) => c.versusPrevious)).toEqual(['', '']);
    expect(running.categories[1].accessibilityLabel).toBe('Café e chá: R$ 18,00, 38% do mês');
  });

  it('a parte é sobre a soma dos itens: com desconto no total, as categorias continuam somando 100%', () => {
    const month = marketMonth([receipt(at(MONTH, 10), [line('Arroz', 'graos', 75), line('Ração', 'pet', 25)], { total: 80 })], MONTH, AFTER);
    expect(month.categories.map((c) => c.share)).toEqual(['75%', '25%']);
  });

  it('total pago diferente da soma dos itens: uma frase diz sobre o que são as porcentagens, e a parte falada é "dos itens"', () => {
    // A leitura perdeu itens de uma nota, e a outra veio sem item nenhum.
    const month = marketMonth(
      [receipt(at(MONTH, 10), [line('Arroz', 'graos', 37.39)], { total: 137.39 }), receipt(at(MONTH, 11), [], { total: 80 })],
      MONTH,
      AFTER,
    );
    expect(month.headline).toBe('R$ 217,39 em 2 idas');
    expect(month.categories.map((c) => [c.amount, c.share])).toEqual([['R$ 37,39', '100%']]);
    expect(month.shareBasis).toBe('As porcentagens são sobre os itens lidos (R$ 37,39).');
    expect(month.categories[0].accessibilityLabel).toBe('Grãos, massas e cereais: R$ 37,39, 100% dos itens');
    expect(month.items[0].accessibilityLabel).toBe('Arroz: R$ 37,39, 100% dos itens, 1 un, em 1 ida');
    // Com desconto no total, também.
    const discounted = marketMonth([receipt(at(MONTH, 10), [line('Arroz', 'graos', 75), line('Sal', 'temperos', 0.25)], { total: 70 })], MONTH, AFTER);
    expect(discounted.shareBasis).toBe('As porcentagens são sobre os itens lidos (R$ 75,25).');
    expect(discounted.categories[1].accessibilityLabel).toBe('Temperos e molhos: R$ 0,25, menos de 1% dos itens');
    // Nota em que nenhum valor foi lido: não há porcentagem, e a frase não aparece para falar de R$ 0,00.
    const unreadValues = marketMonth([receipt(at(MONTH, 10), [line('Brinde', 'outros', 0)], { total: 50 })], MONTH, AFTER);
    expect(unreadValues.headline).toBe('R$ 50,00 em 1 ida');
    expect(unreadValues.shareBasis).toBeNull();
  });

  it('com mais itens do que a lista mostra de início, as regras dizem quantos aparecem e o que os botões dizem', () => {
    const lines = (count: number) => Array.from({ length: count }, (_, i) => line(`Item ${String(i + 1).padStart(2, '0')}`, 'graos', count - i));
    const cut = (count: number) => marketMonth([receipt(at(MONTH, 8), lines(count))], MONTH, AFTER).itemsCut;
    // Até o limite cabem todos: não há corte nem botão.
    expect(MARKET_ITEMS_SHOWN).toBe(10);
    expect(cut(1)).toBeNull();
    expect(cut(10)).toBeNull();
    expect(cut(11)).toEqual({ shown: 10, more: 'Ver todos os 11 itens', less: 'Mostrar só os 10 primeiros' });
    expect(cut(25)).toEqual({ shown: 10, more: 'Ver todos os 25 itens', less: 'Mostrar só os 10 primeiros' });
    expect(marketMonth([], MONTH, AFTER).itemsCut).toBeNull();
  });

  it('a tela da nota e a do mês usam a mesma folga, em centavos: exatamente 5 centavos não avisa em nenhuma das duas', () => {
    // Em reais a conta engana: 10,05 - 10,00 passa um fio de 0,05.
    expect(Math.abs(10.05 - 10) > 0.05).toBe(true);
    expect(receiptTotalMismatch(10.05, 10)).toBe(false);
    expect(receiptTotalMismatch(10, 10.05)).toBe(false);
    expect(receiptTotalMismatch(10.06, 10)).toBe(true);
    expect(receiptTotalMismatch(10, 10.06)).toBe(true);
    expect(receiptTotalMismatch(0.3, 0.1 + 0.2)).toBe(false);
    expect(receiptTotalMismatch(null, 10)).toBe(false);
    // E a tela do mês lista a nota para conferir exatamente nos mesmos casos.
    const listed = (total: number) =>
      marketMonth([receipt(at(MONTH, 8), [line('Arroz', 'graos', 10)], { total })], MONTH, AFTER).unread?.receipts.length ?? 0;
    for (const total of [10.01, 10.04, 10.05, 10.06, 10.5]) expect([total, listed(total) > 0]).toEqual([total, receiptTotalMismatch(total, 10)]);
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
      // Dois mercados de mesmo nome, sem endereço nem CNPJ: "loja 1" e "loja 2", na ordem da lista.
      { key: 'a1', name: 'Assaí', place: 'loja 1', cents: 6100, amount: 'R$ 61,00', detail: 'loja 1 · 2 idas', accessibilityLabel: 'Assaí, loja 1: R$ 61,00 em 2 idas' },
      { key: 'a2', name: 'Assaí', place: 'loja 2', cents: 2900, amount: 'R$ 29,00', detail: 'loja 2 · 1 ida', accessibilityLabel: 'Assaí, loja 2: R$ 29,00 em 1 ida' },
      // O que foi pago, com o valor sem item lido.
      { key: '', name: 'Sem mercado informado', place: null, cents: 1700, amount: 'R$ 17,00', detail: '2 idas', accessibilityLabel: 'Sem mercado informado: R$ 17,00 em 2 idas' },
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
      pharmacyCents: 0,
      drafts: null,
      shareBasis: null,
      closing: null,
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

  it('viewFromParam: a parte da tela pedida na URL; sem ela, ou com um valor estranho, os itens', () => {
    expect(MARKET_VIEWS).toEqual([
      { value: 'itens', label: 'Itens' },
      { value: 'categorias', label: 'Categorias' },
      { value: 'idas', label: 'Idas' },
      { value: 'mercados', label: 'Mercados' },
    ]);
    expect(viewFromParam('categorias')).toBe('categorias');
    expect(viewFromParam('idas')).toBe('idas');
    expect(viewFromParam('mercados')).toBe('mercados');
    expect(viewFromParam('itens')).toBe('itens');
    expect(viewFromParam(['idas', 'mercados'])).toBe('idas');
    expect(viewFromParam(undefined)).toBe('itens');
    expect(viewFromParam('')).toBe('itens');
    expect(viewFromParam('Categorias')).toBe('itens');
    expect(viewFromParam('toString')).toBe('itens');
  });
});

describe('o total do mês, numa conta só', () => {
  const receipts = [
    receipt(at('2026-09', 5), [line('Arroz', 'graos', 30)]),
    receipt(at(MONTH, 2), [line('Arroz', 'graos', 60), line('Detergente', 'limpeza', 40), line('Ração', 'pet', 10)], { total: 100 }),
    receipt(at(MONTH, 9), [line('Feijão', 'graos', 9), line('Dipirona', 'medicamentos', 12)], { total: 41 }),
    receipt(at(MONTH, 12), [line('Vitamina C', 'suplementos', 25)], { total: 20 }),
    receipt(at(MONTH, 15), [line('Café', 'cafe_cha', 18.9), loose('SACOLA', 0.1)]),
    receipt(at(MONTH, 16), [line('Leite', 'laticinios', 6)], { status: 'draft', total: 6 }),
  ];

  it('marketTotal dá o total e as idas que a tela mostra no cabeçalho', () => {
    const total = marketTotal(receipts, MONTH);
    expect(total).toEqual({ totalCents: 13657, trips: 3, headline: 'R$ 136,57 em 3 idas', emptyTitle: 'Nenhuma nota de mercado em outubro' });
    const month = marketMonth(receipts, MONTH, AFTER);
    expect(month.totalCents).toBe(total.totalCents);
    expect(month.headline).toBe(total.headline);
    expect(month.trips).toHaveLength(total.trips);
    expect(month.emptyTitle).toBe(total.emptyTitle);
    expect(marketTotal(receipts, '2026-09')).toMatchObject({ totalCents: 3000, trips: 1, headline: 'R$ 30,00 em 1 ida' });
    expect(marketTotal(receipts, '2026-08')).toEqual({ totalCents: 0, trips: 0, headline: 'R$ 0,00 em 0 idas', emptyTitle: 'Nenhuma nota de mercado em agosto' });
  });

  it('basta o que o resumo de gastos já tem de cada nota: data, total e, de cada item, o valor e a categoria', () => {
    const lean: MarketTotalReceipt[] = receipts.map((r) => ({
      purchasedAt: r.purchasedAt,
      status: r.status,
      total: r.total,
      lines: r.lines.map((l) => ({ productCategory: l.productCategory, suggestedCategory: l.suggestedCategory, totalPrice: l.totalPrice })),
    }));
    expect(marketTotal(lean, MONTH)).toEqual(marketTotal(receipts, MONTH));
    // A categoria é a do produto; sem produto, a sugerida: remédio sugerido na leitura também fica de fora.
    const suggested: MarketTotalReceipt = {
      purchasedAt: at(MONTH, 20),
      status: 'confirmed',
      total: null,
      lines: [
        { productCategory: null, suggestedCategory: 'medicamentos', totalPrice: 12 },
        { productCategory: 'limpeza', suggestedCategory: 'medicamentos', totalPrice: 5 },
      ],
    };
    expect(marketTotal([suggested], MONTH)).toMatchObject({ totalCents: 500, trips: 1 });
  });
});

describe('como o total fecha', () => {
  const closing = (list: MarketReceipt[]) => marketMonth(list, MONTH, AFTER).closing;
  const plain = receipt(at(MONTH, 2), [line('Arroz', 'graos', 30)], { total: 30 });
  const lost = receipt(at(MONTH, 3), [line('Feijão', 'graos', 9)], { total: 29 });
  const discounted = receipt(at(MONTH, 4), [line('Café', 'cafe_cha', 60)], { total: 50 });
  const pharmacy = receipt(at(MONTH, 5), [line('Dipirona', 'medicamentos', 12)]);
  const free = receipt(at(MONTH, 6), [line('Leite', 'laticinios', 6), line('Brinde', 'outros', 0)]);
  const draft = () => receipt(at(MONTH, 7), [], { status: 'draft' });

  it('mês em que o total é só a soma dos itens: nada a dizer', () => {
    expect(closing([plain])).toBeNull();
  });

  it('diz numa frase o que entra no total além dos itens lidos', () => {
    expect(closing([plain, lost, discounted])).toBe('Inclui R$ 20,00 de notas sem item lido e R$ 10,00 de descontos.');
    expect(closing([plain, lost])).toBe('Inclui R$ 20,00 de notas sem item lido.');
    expect(closing([plain, discounted])).toBe('Inclui R$ 10,00 de descontos.');
  });

  it('e o que ficou de fora dele: a farmácia, os itens sem valor e as notas por revisar', () => {
    expect(closing([plain, pharmacy])).toBe('Sem contar R$ 12,00 de farmácia.');
    expect(closing([plain, free])).toBe('Sem contar 1 item sem valor.');
    expect(closing([plain, draft()])).toBe('Sem contar 1 nota que espera a revisão.');
    expect(closing([plain, lost, discounted, pharmacy, free, draft(), draft()])).toBe(
      'Inclui R$ 20,00 de notas sem item lido e R$ 10,00 de descontos. Sem contar R$ 12,00 de farmácia, 1 item sem valor e 2 notas que esperam a revisão.',
    );
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

  it('mês corrente: a nota com data depois de hoje fica de fora da conta "até hoje", e a tela diz', () => {
    const today = '2026-10-13';
    const past = receipt(at(MONTH, 10), [line('Arroz', 'graos', 30)]);
    // Hoje, tarde da noite: ainda é hoje.
    const tonight = receipt(at(MONTH, 13, 23, 30), [line('Feijão', 'graos', 9)]);
    const future = receipt(at(MONTH, 20), [line('Picanha', 'carnes', 100)], { storeId: 'dia', storeName: 'Dia' });
    const futureDraft = receipt(at(MONTH, 25), [], { status: 'draft' });
    const month = marketMonth([past, tonight, future, futureDraft], MONTH, today);
    expect(month.title).toBe('Mercado de outubro até hoje');
    expect(month.headline).toBe('R$ 39,00 em 2 idas');
    expect(month.items.map((i) => i.name)).toEqual(['Arroz', 'Feijão']);
    expect(month.trips).toHaveLength(2);
    expect(month.categories.map((c) => [c.label, c.amount])).toEqual([['Grãos, massas e cereais', 'R$ 39,00']]);
    expect(month.later).toEqual({
      label: '1 nota com data depois de hoje',
      hint: 'Fica de fora desta conta até o dia chegar. Se a data está errada, abra a nota para conferir.',
      receipts: [{ receiptId: future.id, storeName: 'Dia', date: '20 out', value: 'R$ 100,00', accessibilityLabel: 'Dia, 20 out: R$ 100,00. Abrir a nota' }],
    });
    expect(month.closing).toBe('Sem contar 1 nota que espera a revisão e 1 nota com data depois de hoje.');
    // O rascunho de data futura continua entre os que esperam a revisão.
    expect(month.drafts?.receipts.map((r) => r.receiptId)).toEqual([futureDraft.id]);
    // A linha do resumo de gastos faz a mesma conta.
    expect(marketTotal([past, tonight, future, futureDraft], MONTH, today).headline).toBe('R$ 39,00 em 2 idas');

    // Mês que já fechou (ou sem o dia de hoje): o mês inteiro, e nada "depois de hoje".
    const closed = marketMonth([past, tonight, future], MONTH, AFTER);
    expect(closed.headline).toBe('R$ 139,00 em 3 idas');
    expect(closed.later).toBeNull();
    expect(marketTotal([past, tonight, future], MONTH).headline).toBe('R$ 139,00 em 3 idas');
    // No último dia do mês não há "depois de hoje" dentro dele.
    expect(marketMonth([past, future], MONTH, '2026-10-31').later).toBeNull();
    expect(marketMonth([past, future], MONTH, '2026-10-31').headline).toBe('R$ 130,00 em 2 idas');

    // Só nota de data futura no mês corrente: nenhuma ida ainda, e a tela diz o que ficou de fora.
    const onlyLater = marketMonth([future], MONTH, today);
    expect(onlyLater.trips).toEqual([]);
    expect(onlyLater.closing).toBe('Sem contar 1 nota com data depois de hoje.');
    // A nota de data futura só com itens de farmácia não é ida ao mercado, mas aparece: senão ninguém a acha para conferir a data.
    const drugstore = receipt(at(MONTH, 22), [line('Dipirona', 'medicamentos', 12)], { storeId: 'dr', storeName: 'Drogasil' });
    const mixed = receipt(at(MONTH, 23), [line('Arroz', 'graos', 30), line('Gaze', 'medicamentos', 10)], { storeId: 'dia', storeName: 'Dia' });
    const withDrugstore = marketMonth([past, drugstore, mixed], MONTH, today);
    expect(withDrugstore.headline).toBe('R$ 30,00 em 1 ida');
    expect(withDrugstore.pharmacy).toBeNull();
    expect(withDrugstore.later?.label).toBe('2 notas com data depois de hoje');
    // O valor é o da nota inteira, mercado e farmácia.
    expect(withDrugstore.later?.receipts.map((r) => [r.storeName, r.date, r.value])).toEqual([
      ['Dia', '23 out', 'R$ 40,00'],
      ['Drogasil', '22 out', 'R$ 12,00'],
    ]);
    expect(withDrugstore.closing).toBe('Sem contar 2 notas com data depois de hoje.');
    // Plural.
    const two = marketMonth([past, future, receipt(at(MONTH, 21), [line('Sal', 'temperos', 4)])], MONTH, today);
    expect(two.later?.label).toBe('2 notas com data depois de hoje');
    expect(two.later?.hint).toBe('Ficam de fora desta conta até o dia chegar. Se a data está errada, abra a nota para conferir.');
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

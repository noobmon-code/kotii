import { describe, expect, it } from '@jest/globals';

import { MARKET_CHANGES_SHOWN, type MarketChange } from '../marketChange';
import { marketMonth, type MarketLine, type MarketReceipt } from '../marketSpend';

// "O que mudou" sai de marketMonth, com as notas de verdade: a mesma janela, os mesmos itens e o mesmo
// escopo (farmácia, rascunhos, data depois de hoje) do resto da tela.

const MONTH = '2026-10';
const SEPTEMBER = '2026-09';
/** Mês já fechado: a janela é setembro inteiro. */
const AFTER = '2026-11-05';

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

const changeOf = (receipts: MarketReceipt[], today = AFTER, month = MONTH): MarketChange => {
  const change = marketMonth(receipts, month, today).change;
  expect(change).not.toBeNull();
  return change!;
};

const parts = (change: MarketChange) => change.parts.map((p) => [p.label, p.amount, p.detail]);
const items = (change: MarketChange) => change.items.map((i) => [i.name, i.amount, i.detail]);
const partSum = (change: MarketChange) => change.parts.reduce((sum, p) => sum + p.cents, 0);

describe('o que mudou: as partes da diferença dos itens', () => {
  it('preço, quantidade, os dois, um item novo e um que saiu: as partes somam a diferença', () => {
    const change = changeOf([
      receipt(at(SEPTEMBER, 5), [line('Arroz', 'graos', 30), line('Leite', 'laticinios', 6), line('Picanha', 'carnes', 102, 3, 'kg'), line('Ração', 'pet', 80)]),
      receipt(at(MONTH, 4), [line('Arroz', 'graos', 33), line('Leite', 'laticinios', 12, 2), line('Picanha', 'carnes', 160, 4, 'kg'), line('Café', 'cafe_cha', 18)]),
    ]);
    // Setembro: R$ 218,00 nos itens; outubro: R$ 223,00.
    expect(change.diffCents).toBe(500);
    expect(change.headline).toBe('Nos itens, R$ 5,00 a mais que em setembro');
    // Arroz: só o preço (+3). Leite: só a quantidade (+6). Picanha: 4 kg a R$ 34,00 seriam R$ 136,00, e
    // custaram R$ 160,00: +24 de preço e +34 de quantidade.
    expect(parts(change)).toEqual([
      ['Preço', '+R$ 27,00', 'Os mesmos 3 itens ficaram 15% mais caros'],
      ['Quantidade', '+R$ 40,00', 'Comprou mais dos mesmos itens'],
      ['Itens que não teve em setembro', '+R$ 18,00', '1 item'],
      ['Itens que não comprou em outubro', '−R$ 80,00', '1 item'],
    ]);
    expect(partSum(change)).toBe(change.diffCents);
    expect(items(change)).toEqual([
      ['Ração', '−R$ 80,00', 'Não teve em outubro'],
      ['Picanha', '+R$ 58,00', 'kg: R$ 34,00 → R$ 40,00 · 3 kg → 4 kg'],
      ['Café', '+R$ 18,00', 'Não teve em setembro'],
      ['Leite', '+R$ 6,00', 'Unidade: R$ 6,00 → R$ 6,00 · 1 un → 2 un'],
      ['Arroz', '+R$ 3,00', 'Unidade: R$ 30,00 → R$ 33,00 · 1 un → 1 un'],
    ]);
    expect(change.items.reduce((sum, i) => sum + i.cents, 0)).toBe(change.diffCents);
    // O item que saiu é o da janela: o produto e a categoria continuam, para abrir e para o desenho.
    expect(change.items[0]).toMatchObject({ key: 'p:Ração', productId: 'Ração', category: 'pet', cents: -8000 });
    expect(change.items[1].accessibilityLabel).toBe('Picanha: mais R$ 58,00, preço do quilo de R$ 34,00 para R$ 40,00, quantidade de 3 kg para 4 kg');
    expect(change.items[0].accessibilityLabel).toBe('Ração: menos R$ 80,00, não teve em outubro');
    expect(change.items[2].accessibilityLabel).toBe('Café: mais R$ 18,00, não teve em setembro');
    expect(change.items[3].accessibilityLabel).toBe('Leite: mais R$ 6,00, preço da unidade de R$ 6,00 para R$ 6,00, quantidade de 1 un para 2 un');
    expect(change.parts.map((p) => p.accessibilityLabel)).toEqual([
      'Preço: mais R$ 27,00. Os mesmos 3 itens ficaram 15% mais caros',
      'Quantidade: mais R$ 40,00. Comprou mais dos mesmos itens',
      'Itens que não teve em setembro: mais R$ 18,00. 1 item',
      'Itens que não comprou em outubro: menos R$ 80,00. 1 item',
    ]);
    // Sem diferença no total das notas, nada a explicar sobre o total pago.
    expect(change.totalNote).toBeNull();
    expect(change.itemsCut).toEqual({ shown: MARKET_CHANGES_SHOWN, more: 'Ver todas as 5 mudanças', less: 'Mostrar só as 3 maiores' });
    expect(MARKET_CHANGES_SHOWN).toBe(3);
  });

  it('só a quantidade: a parte do preço é zero e não aparece', () => {
    const change = changeOf([receipt(at(SEPTEMBER, 5), [line('Leite', 'laticinios', 6)]), receipt(at(MONTH, 4), [line('Leite', 'laticinios', 18, 3)])]);
    expect(parts(change)).toEqual([['Quantidade', '+R$ 12,00', 'Comprou mais dos mesmos itens']]);
    expect(items(change)).toEqual([['Leite', '+R$ 12,00', 'Unidade: R$ 6,00 → R$ 6,00 · 1 un → 3 un']]);
    const less = changeOf([receipt(at(SEPTEMBER, 5), [line('Leite', 'laticinios', 18, 3)]), receipt(at(MONTH, 4), [line('Leite', 'laticinios', 6)])]);
    expect(parts(less)).toEqual([['Quantidade', '−R$ 12,00', 'Comprou menos dos mesmos itens']]);
    expect(less.headline).toBe('Nos itens, R$ 12,00 a menos que em setembro');
  });

  it('o mesmo total com outra composição: "o mesmo", e as partes ainda aparecem', () => {
    const change = changeOf([
      receipt(at(SEPTEMBER, 5), [line('Arroz', 'graos', 30), line('Feijão', 'graos', 10)]),
      receipt(at(MONTH, 4), [line('Arroz', 'graos', 40)]),
    ]);
    expect(change.headline).toBe('Nos itens, o mesmo que em setembro');
    expect(parts(change)).toEqual([
      ['Preço', '+R$ 10,00', 'O mesmo item ficou 33% mais caro'],
      ['Itens que não comprou em outubro', '−R$ 10,00', '1 item'],
    ]);
    expect(partSum(change)).toBe(0);
    // Tudo igual: nenhuma parte e nenhum item.
    const same = changeOf([receipt(at(SEPTEMBER, 5), [line('Arroz', 'graos', 30)]), receipt(at(MONTH, 4), [line('Arroz', 'graos', 30)])]);
    expect(same).toEqual({ diffCents: 0, headline: 'Nos itens, o mesmo que em setembro', parts: [], totalNote: null, items: [], itemsCut: null });
  });

  it('quantidades na unidade base: kg com g e l com ml se somam, o preço médio é por kg e por litro', () => {
    const change = changeOf([
      receipt(at(SEPTEMBER, 5), [line('Queijo', 'laticinios', 30, 0.5, 'kg'), line('Suco', 'bebidas', 8, 1, 'l'), line('Presunto', 'frios', 10, 200, 'g')]),
      receipt(at(MONTH, 4), [line('Queijo', 'laticinios', 20, 300, 'g'), line('Suco', 'bebidas', 9, 1, 'l'), line('Presunto', 'frios', 18, 300, 'g')]),
      receipt(at(MONTH, 9), [line('Queijo', 'laticinios', 14, 0.2, 'kg'), line('Suco', 'bebidas', 5, 500, 'ml')]),
    ]);
    expect(items(change)).toEqual([
      // 300 g + 0,2 kg = 0,5 kg; R$ 34,00 por 0,5 kg = R$ 68,00 o kg.
      ['Presunto', '+R$ 8,00', 'kg: R$ 50,00 → R$ 60,00 · 0,2 kg → 0,3 kg'],
      // 1 l + 500 ml = 1,5 l; R$ 14,00 por 1,5 l = R$ 9,33 o litro.
      ['Suco', '+R$ 6,00', 'Litro: R$ 8,00 → R$ 9,33 · 1 l → 1,5 l'],
      ['Queijo', '+R$ 4,00', 'kg: R$ 60,00 → R$ 68,00 · 0,5 kg → 0,5 kg'],
    ]);
    // Queijo: +4 de preço. Suco: 1,5 l a R$ 8,00 seriam R$ 12,00 (+2 de preço, +4 de quantidade). Presunto: 0,3 kg
    // a R$ 50,00 seriam R$ 15,00 (+3 de preço, +5 de quantidade).
    expect(parts(change)).toEqual([
      // A base é o que as quantidades de agora custariam antes: 30 + 12 + 15 = R$ 57,00; 9 de 57 são 16%.
      ['Preço', '+R$ 9,00', 'Os mesmos 3 itens ficaram 16% mais caros'],
      ['Quantidade', '+R$ 9,00', 'Comprou mais dos mesmos itens'],
    ]);
    expect(change.items[1].accessibilityLabel).toBe('Suco: mais R$ 6,00, preço do litro de R$ 8,00 para R$ 9,33, quantidade de 1 l para 1,5 l');
  });

  it('o que não dá para separar: unidades diferentes, compra sem valor e sem quantidade', () => {
    const change = changeOf([
      receipt(at(SEPTEMBER, 5), [
        line('Tomate', 'hortifruti', 8, 1, 'kg'),
        line('Pão', 'padaria', 10),
        // Uma compra do pão veio sem valor: o preço médio dele seria um palpite.
        line('Pão', 'padaria', 0),
        // Todas as compras do brinde vieram sem valor: ele não é "novo" em outubro.
        line('Brinde', 'outros', 0),
        line('Ovos', 'ovos', 12, 0),
        line('Água', 'bebidas', 5),
      ]),
      receipt(at(MONTH, 4), [
        line('Tomate', 'hortifruti', 6, 4, 'un'),
        line('Pão', 'padaria', 12),
        line('Brinde', 'outros', 5),
        line('Ovos', 'ovos', 15, 12),
        // E a água comprada agora sem valor não "saiu" do carrinho.
        line('Água', 'bebidas', null),
      ]),
    ]);
    expect(items(change)).toEqual([
      // Empate no valor: pelo nome.
      ['Água', '−R$ 5,00', 'R$ 5,00 → R$ 0,00 · compra sem valor'],
      ['Brinde', '+R$ 5,00', 'R$ 0,00 → R$ 5,00 · compra sem valor'],
      ['Ovos', '+R$ 3,00', 'R$ 12,00 → R$ 15,00 · sem quantidade'],
      ['Pão', '+R$ 2,00', 'R$ 10,00 → R$ 12,00 · compra sem valor'],
      ['Tomate', '−R$ 2,00', 'R$ 8,00 → R$ 6,00 · unidades diferentes'],
    ]);
    expect(parts(change)).toEqual([['Sem como comparar', '+R$ 3,00', '5 itens']]);
    expect(change.diffCents).toBe(300);
    expect(change.items[4].accessibilityLabel).toBe('Tomate: menos R$ 2,00, de R$ 8,00 para R$ 6,00, unidades diferentes');
    // Sem item comparável não há porcentagem nem parte de preço.
    expect(change.parts.find((p) => p.key === 'preco')).toBeUndefined();
  });

  it('o mesmo produto duas vezes na mesma nota e em várias idas é um item só', () => {
    const change = changeOf([
      receipt(at(SEPTEMBER, 5), [line('Leite', 'laticinios', 6), line('Leite', 'laticinios', 6)]),
      receipt(at(MONTH, 4), [line('Leite', 'laticinios', 12, 2)]),
      receipt(at(MONTH, 20), [line('Leite', 'laticinios', 7)], { storeId: 'dia', storeName: 'Dia' }),
    ]);
    // 3 litros de leite ao preço de setembro seriam R$ 18,00: +1 de preço e +6 de quantidade.
    expect(items(change)).toEqual([['Leite', '+R$ 7,00', 'Unidade: R$ 6,00 → R$ 6,33 · 2 un → 3 un']]);
    expect(parts(change)).toEqual([
      ['Preço', '+R$ 1,00', 'O mesmo item ficou 6% mais caro'],
      ['Quantidade', '+R$ 6,00', 'Comprou mais dos mesmos itens'],
    ]);
  });

  it('item sem produto junta pelo nome, como no ranking, e não abre produto', () => {
    const change = changeOf([
      receipt(at(SEPTEMBER, 5), [loose('PAO FRANCES KG', 8, { suggestedName: 'Pão francês', suggestedCategory: 'padaria', quantity: 0.5, unit: 'kg' })]),
      receipt(at(MONTH, 4), [loose('PAO FR', 10.2, { suggestedName: 'pao frances', suggestedCategory: 'padaria', quantity: 0.6, unit: 'kg' })]),
    ]);
    expect(change.items).toEqual([
      {
        key: 'n:padaria:pao frances',
        productId: null,
        // O nome é o de agora.
        name: 'pao frances',
        category: 'padaria',
        cents: 220,
        amount: '+R$ 2,20',
        detail: 'kg: R$ 16,00 → R$ 17,00 · 0,5 kg → 0,6 kg',
        accessibilityLabel: 'pao frances: mais R$ 2,20, preço do quilo de R$ 16,00 para R$ 17,00, quantidade de 0,5 kg para 0,6 kg',
      },
    ]);
  });

  it('valores que não dividem exato: o centavo do arredondamento vai para a quantidade, e as partes fecham', () => {
    // 3 un por R$ 10,00; agora 2 un por R$ 7,00. 2 un ao preço antigo: R$ 6,666… = R$ 6,67.
    const change = changeOf([receipt(at(SEPTEMBER, 5), [line('Iogurte', 'laticinios', 10, 3)]), receipt(at(MONTH, 4), [line('Iogurte', 'laticinios', 7, 2)])]);
    expect(parts(change)).toEqual([
      ['Preço', '+R$ 0,33', 'O mesmo item ficou 5% mais caro'],
      ['Quantidade', '−R$ 3,33', 'Comprou menos dos mesmos itens'],
    ]);
    expect(partSum(change)).toBe(-300);
    expect(items(change)).toEqual([['Iogurte', '−R$ 3,00', 'Unidade: R$ 3,33 → R$ 3,50 · 3 un → 2 un']]);
  });
});

describe('a porcentagem do preço', () => {
  const pair = (before: MarketLine[], now: MarketLine[]) => changeOf([receipt(at(SEPTEMBER, 5), before), receipt(at(MONTH, 4), now)]);
  const priceDetail = (change: MarketChange) => change.parts.find((p) => p.key === 'preco')?.detail;

  it('mais caro, mais barato e praticamente o mesmo; um item ou vários', () => {
    expect(priceDetail(pair([line('Arroz', 'graos', 30)], [line('Arroz', 'graos', 33)]))).toBe('O mesmo item ficou 10% mais caro');
    expect(priceDetail(pair([line('Arroz', 'graos', 40), line('Feijão', 'graos', 10)], [line('Arroz', 'graos', 38), line('Feijão', 'graos', 9.5)]))).toBe(
      'Os mesmos 2 itens ficaram 5% mais baratos',
    );
    expect(priceDetail(pair([line('Arroz', 'graos', 30)], [line('Arroz', 'graos', 27)]))).toBe('O mesmo item ficou 10% mais barato');
    // R$ 0,20 em R$ 100,00 é 0,2%: arredonda para 0%.
    const tiny = pair([line('Arroz', 'graos', 100)], [line('Arroz', 'graos', 100.2)]);
    expect(parts(tiny)).toEqual([['Preço', '+R$ 0,20', 'O mesmo item custou praticamente o mesmo']]);
    expect(priceDetail(pair([line('Arroz', 'graos', 100), line('Feijão', 'graos', 10)], [line('Arroz', 'graos', 100.2), line('Feijão', 'graos', 10)]))).toBe(
      'Os mesmos 2 itens custaram praticamente o mesmo',
    );
  });

  it('conta os itens comparáveis, mesmo os que não mudaram; o meio ponto arredonda para longe do zero', () => {
    // O feijão não mudou, mas é um dos "mesmos itens".
    expect(priceDetail(pair([line('Arroz', 'graos', 10), line('Feijão', 'graos', 5)], [line('Arroz', 'graos', 10.45), line('Feijão', 'graos', 5)]))).toBe(
      'Os mesmos 2 itens ficaram 3% mais caros',
    );
    expect(priceDetail(pair([line('Arroz', 'graos', 10)], [line('Arroz', 'graos', 10.45)]))).toBe('O mesmo item ficou 5% mais caro');
    expect(priceDetail(pair([line('Arroz', 'graos', 10)], [line('Arroz', 'graos', 9.55)]))).toBe('O mesmo item ficou 5% mais barato');
    // A base é o que a quantidade de agora custaria antes: 2 un a R$ 10,00 = R$ 20,00; pagou R$ 22,00.
    expect(priceDetail(pair([line('Arroz', 'graos', 10)], [line('Arroz', 'graos', 22, 2)]))).toBe('O mesmo item ficou 10% mais caro');
  });
});

describe('o mesmo escopo do resto da tela', () => {
  it('farmácia, rascunho e nota com data depois de hoje ficam de fora; a janela é a do cabeçalho, até a meia-noite', () => {
    const today = '2026-10-13';
    const receipts = [
      receipt(at(SEPTEMBER, 2), [line('Sal', 'temperos', 4), line('Dipirona', 'medicamentos', 10)]),
      // Último segundo do dia 13 de setembro: dentro da janela.
      receipt(at(SEPTEMBER, 13, 23, 59, 59), [line('Arroz', 'graos', 30)]),
      // Meia-noite do dia 14: fora.
      receipt(at(SEPTEMBER, 14, 0, 0, 0), [line('Feijão', 'graos', 9)]),
      receipt(at(MONTH, 5), [line('Arroz', 'graos', 33), line('Feijão', 'graos', 10), line('Dipirona', 'medicamentos', 25)]),
      receipt(at(MONTH, 6), [line('Arroz', 'graos', 100)], { status: 'draft' }),
      receipt(at(MONTH, 20), [line('Picanha', 'carnes', 100)]),
    ];
    const month = marketMonth(receipts, MONTH, today);
    expect(month.comparison).toBe('R$ 9,00 a mais que até o dia 13 de setembro');
    const change = month.change!;
    expect(change.headline).toBe('Nos itens, R$ 9,00 a mais que até o dia 13 de setembro');
    expect(parts(change)).toEqual([
      ['Preço', '+R$ 3,00', 'O mesmo item ficou 10% mais caro'],
      ['Itens que não teve até o dia 13 de setembro', '+R$ 10,00', '1 item'],
      ['Itens que não comprou neste mês até hoje', '−R$ 4,00', '1 item'],
    ]);
    expect(items(change)).toEqual([
      ['Feijão', '+R$ 10,00', 'Não teve até o dia 13 de setembro'],
      ['Sal', '−R$ 4,00', 'Não teve neste mês até hoje'],
      ['Arroz', '+R$ 3,00', 'Unidade: R$ 30,00 → R$ 33,00 · 1 un → 1 un'],
    ]);
    expect(change.items.map((i) => i.name)).not.toContain('Dipirona');
    expect(change.items.map((i) => i.name)).not.toContain('Picanha');
    expect(change.itemsCut).toBeNull();
    // Um dia depois, a compra do dia 14 de setembro entra na janela e o feijão passa a ser comparável.
    const nextDay = marketMonth(receipts, MONTH, '2026-10-14').change!;
    expect(items(nextDay).find(([name]) => name === 'Feijão')).toEqual(['Feijão', '+R$ 1,00', 'Unidade: R$ 9,00 → R$ 10,00 · 1 un → 1 un']);
  });

  it('não aparece sem nota de mercado na janela, nem num mês sem ida', () => {
    const october = receipt(at(MONTH, 4), [line('Arroz', 'graos', 30)]);
    expect(marketMonth([october], MONTH, AFTER).change).toBeNull();
    // Na janela só farmácia: não é ida, e não há comparação.
    expect(marketMonth([receipt(at(SEPTEMBER, 5), [line('Dipirona', 'medicamentos', 10)]), october], MONTH, AFTER).change).toBeNull();
    // A ida de setembro fica depois da janela do dia 4.
    expect(marketMonth([receipt(at(SEPTEMBER, 10), [line('Arroz', 'graos', 30)]), october], MONTH, '2026-10-04').change).toBeNull();
    // Mês sem ida, com o anterior cheio.
    expect(marketMonth([receipt(at(SEPTEMBER, 5), [line('Arroz', 'graos', 30)])], MONTH, AFTER).change).toBeNull();
    expect(marketMonth([], MONTH, AFTER).change).toBeNull();
  });

  it('empate na mudança: pelo nome e depois pela chave, em qualquer ordem das notas', () => {
    const twins = [
      { ...line('Arroz', 'graos', 10), productId: 'arroz-2' },
      { ...line('Arroz', 'graos', 10), productId: 'arroz-1' },
      line('Sal', 'temperos', 10),
      line('Açúcar', 'mercearia', 10),
    ];
    const september = receipt(at(SEPTEMBER, 5), [line('Feijão', 'graos', 10)]);
    const forward = changeOf([september, receipt(at(MONTH, 4), twins)]);
    const backward = changeOf([receipt(at(MONTH, 4), [...twins].reverse()), september]);
    expect(forward.items.map((i) => [i.name, i.key])).toEqual([
      ['Açúcar', 'p:Açúcar'],
      ['Arroz', 'p:arroz-1'],
      ['Arroz', 'p:arroz-2'],
      ['Feijão', 'p:Feijão'],
      ['Sal', 'p:Sal'],
    ]);
    expect(backward.items).toEqual(forward.items);
  });
});

describe('o total pago e os itens', () => {
  const september = receipt(at(SEPTEMBER, 5), [line('Arroz', 'graos', 30)]);

  it('com desconto ou valor sem item lido, uma frase diz por que o total pago muda diferente, sem outro número', () => {
    const discounted = changeOf([september, receipt(at(MONTH, 4), [line('Arroz', 'graos', 40)], { total: 35 })]);
    expect(discounted.headline).toBe('Nos itens, R$ 10,00 a mais que em setembro');
    expect(discounted.totalNote).toBe('O total pago muda diferente porque inclui os descontos no total das notas.');
    const unread = changeOf([september, receipt(at(MONTH, 4), [line('Arroz', 'graos', 40)], { total: 60 })]);
    expect(unread.totalNote).toBe('O total pago muda diferente porque inclui os valores sem item lido.');
    // Desconto em setembro e valor sem item em outubro.
    const both = changeOf([
      receipt(at(SEPTEMBER, 5), [line('Arroz', 'graos', 30)], { total: 25 }),
      receipt(at(MONTH, 4), [line('Arroz', 'graos', 40)], { total: 60 }),
    ]);
    expect(both.totalNote).toBe('O total pago muda diferente porque inclui os descontos no total das notas e os valores sem item lido.');
    expect(both.headline).toBe('Nos itens, R$ 10,00 a mais que em setembro');
  });

  it('a mesma diferença no total das notas nos dois períodos: o total pago muda igual aos itens, e a frase não aparece', () => {
    const change = changeOf([
      receipt(at(SEPTEMBER, 5), [line('Arroz', 'graos', 30)], { total: 25 }),
      receipt(at(MONTH, 4), [line('Arroz', 'graos', 40)], { total: 35 }),
    ]);
    expect(change.totalNote).toBeNull();
  });
});

describe('as partes fecham a diferença, em notas de todo jeito', () => {
  it('preço + quantidade + novos + que saíram + sem comparação = itens agora − itens na janela, centavo por centavo', () => {
    // Sorteio com semente: os mesmos números a cada vez.
    let seed = 20261014;
    const random = (max: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % max;
    };
    const names = ['Arroz', 'Feijão', 'Leite', 'Queijo', 'Banana', 'Suco', 'Café', 'Sabão', 'Ração', 'Pão'];
    const categories = ['graos', 'limpeza', 'pet', 'medicamentos', 'laticinios', 'outros'];
    const units = ['un', 'kg', 'g', 'l', 'ml'];
    const randomLine = (): MarketLine => {
      const value = [null, 0, random(30000) / 100, random(997) / 100 + 0.01][random(4)];
      const quantity = [0, random(5000) / 1000, 1 + random(20), random(1000)][random(4)];
      const base = line(names[random(names.length)], categories[random(categories.length)], value, quantity, units[random(units.length)]);
      // Às vezes sem produto, agrupado pelo nome.
      return random(5) === 0 ? { ...base, productId: null, productName: null, productCategory: null, suggestedCategory: base.productCategory } : base;
    };
    const randomReceipts = (month: string) =>
      Array.from({ length: 1 + random(4) }, (_, n) => {
        const lines = Array.from({ length: 1 + random(6) }, randomLine);
        const printed = lines.reduce((sum, l) => sum + Math.round((l.totalPrice ?? 0) * 100), 0);
        const total = [null, printed / 100, Math.max(1, printed - random(printed + 1)) / 100, (printed + 1 + random(5000)) / 100][random(4)];
        return receipt(at(month, 1 + n * 3, 8 + random(12)), lines, { total, status: random(10) === 0 ? 'draft' : 'confirmed' });
      });
    let checked = 0;
    for (let round = 0; round < 400; round++) {
      const receipts = [...randomReceipts(SEPTEMBER), ...randomReceipts(MONTH)];
      const october = marketMonth(receipts, MONTH, AFTER);
      const september = marketMonth(receipts, SEPTEMBER, AFTER);
      if (!october.change) {
        expect(october.trips.length === 0 || september.trips.length === 0).toBe(true);
        continue;
      }
      checked += 1;
      const { change } = october;
      expect(change.diffCents).toBe(october.itemsCents - september.itemsCents);
      expect(partSum(change)).toBe(change.diffCents);
      expect(change.items.reduce((sum, i) => sum + i.cents, 0)).toBe(change.diffCents);
      expect(change.parts.every((p) => p.cents !== 0)).toBe(true);
      expect(change.items.every((i) => i.cents !== 0)).toBe(true);
      // A frase do total pago aparece exatamente quando as duas diferenças não batem.
      expect(change.totalNote !== null).toBe(october.totalCents - september.totalCents !== change.diffCents);
      // Da maior mudança para a menor.
      const sizes = change.items.map((i) => Math.abs(i.cents));
      expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    }
    expect(checked).toBeGreaterThan(200);
  });
});

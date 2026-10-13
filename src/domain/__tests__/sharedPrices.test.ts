import { describe, expect, it } from '@jest/globals';

import {
  cheaperSharedHint,
  cheaperSharedPrice,
  describeSharedPrice,
  type OwnPrice,
  saoPauloDay,
  seenLabel,
  SHARED_PRICES_NOTICE,
  type SharedPrice,
  sharedPriceLabel,
  sharedPriceRows,
  sharedRowsByProduct,
  SHARING_ABOUT,
  visibleSharedPrices,
} from '../sharedPrices';

const ATACADAO = '11222333000181';
const SUPER = '99888777000166';

const shared = (store_cnpj: string, unit_price: number, seen_on: string, partial: Partial<SharedPrice> = {}): SharedPrice => ({
  product_id: 'arroz',
  store_cnpj,
  store_name: store_cnpj === ATACADAO ? 'Atacadão Mooca' : 'Super Outro',
  unit: 'un',
  unit_price,
  seen_on,
  ...partial,
});

const own = (store_id: string, unit_price: number, purchased_at: string, partial: Partial<OwnPrice> = {}): OwnPrice => ({
  product_id: 'arroz',
  store_id,
  unit: 'un',
  unit_price,
  purchased_at,
  ...partial,
});

/** A casa conhece o atacadão pelo CNPJ; o mercadinho foi criado à mão, sem CNPJ. */
const STORES = [
  { id: 'meu-atacadao', cnpj: ATACADAO },
  { id: 'mercadinho', cnpj: null },
];

describe('o dia em São Paulo', () => {
  it('é o mesmo que o banco grava: 22:30 ainda é o dia, 00:30 já é o seguinte', () => {
    // 22:30 em São Paulo é 01:30 do dia seguinte em UTC.
    expect(saoPauloDay('2026-10-02T01:30:00Z')).toBe('2026-10-01');
    expect(saoPauloDay('2026-10-02T03:30:00+00:00')).toBe('2026-10-02');
    expect(saoPauloDay('2026-10-01T22:30:00-03:00')).toBe('2026-10-01');
    // Virada do ano.
    expect(saoPauloDay('2027-01-01T02:59:59Z')).toBe('2026-12-31');
  });

  it('texto que não é data não vira dia nenhum', () => {
    expect(saoPauloDay('ontem')).toBe('');
  });
});

describe('o que vale mostrar', () => {
  it('some a compra da própria casa: mesmo produto, mesmo CNPJ, mesmo dia', () => {
    const rows = visibleSharedPrices([shared(ATACADAO, 22.9, '2026-10-10')], [own('meu-atacadao', 22.9, '2026-10-10T15:00:00-03:00')], STORES);
    expect(rows).toEqual([]);
  });

  it('some a notícia mais velha que a da casa, e fica a mais nova', () => {
    const mine = [own('meu-atacadao', 23.5, '2026-10-10T15:00:00-03:00')];
    expect(visibleSharedPrices([shared(ATACADAO, 21.9, '2026-10-08')], mine, STORES)).toEqual([]);
    expect(visibleSharedPrices([shared(ATACADAO, 21.9, '2026-10-11')], mine, STORES)).toHaveLength(1);
  });

  it('o dia da compra da casa é o de São Paulo: 22:30 do dia 10 não esconde o que foi visto no dia 11', () => {
    // Em UTC a compra já é do dia 11.
    const mine = [own('meu-atacadao', 23.5, '2026-10-11T01:30:00Z')];
    expect(visibleSharedPrices([shared(ATACADAO, 21.9, '2026-10-11')], mine, STORES)).toHaveLength(1);
    expect(visibleSharedPrices([shared(ATACADAO, 21.9, '2026-10-10')], mine, STORES)).toEqual([]);
  });

  it('vale a compra mais recente da casa naquele mercado, em qualquer unidade', () => {
    const mine = [own('meu-atacadao', 23.5, '2026-10-01T12:00:00-03:00'), own('meu-atacadao', 4.7, '2026-10-12T12:00:00-03:00', { unit: 'kg' })];
    expect(visibleSharedPrices([shared(ATACADAO, 21.9, '2026-10-11')], mine, STORES)).toEqual([]);
  });

  it('mercado só se reconhece pelo CNPJ: o da casa sem CNPJ nunca esconde nada', () => {
    const mine = [own('mercadinho', 22.9, '2026-10-10T15:00:00-03:00'), own('sumiu', 22.9, '2026-10-10T15:00:00-03:00')];
    expect(visibleSharedPrices([shared(ATACADAO, 22.9, '2026-10-10')], mine, STORES)).toHaveLength(1);
  });

  it('outro produto e outro mercado não escondem', () => {
    const mine = [own('meu-atacadao', 9, '2026-10-12T12:00:00-03:00', { product_id: 'feijao' })];
    const rows = visibleSharedPrices([shared(ATACADAO, 22.9, '2026-10-10'), shared(SUPER, 24, '2026-10-01')], mine, STORES);
    expect(rows.map((row) => row.store_cnpj)).toEqual([ATACADAO, SUPER]);
  });

  it('preço zerado não é preço', () => {
    expect(visibleSharedPrices([shared(ATACADAO, 0, '2026-10-10')], [], STORES)).toEqual([]);
  });
});

describe('as linhas de um produto', () => {
  it('o mais barato primeiro; no empate, o visto por último', () => {
    const rows = sharedPriceRows(
      [
        shared('3', 22.9, '2026-10-05', { store_name: 'C' }),
        shared('1', 24.5, '2026-10-12', { store_name: 'A' }),
        shared('2', 22.9, '2026-10-09', { store_name: 'B' }),
      ],
      [],
    );
    expect(rows.map((row) => row.storeName)).toEqual(['B', 'C', 'A']);
  });

  it('unidades não se misturam: por g vira por kg, e a unidade principal do produto vem na frente', () => {
    const banana = [
      shared(ATACADAO, 0.0049, '2026-10-10', { unit: 'g' }),
      shared(SUPER, 5.5, '2026-10-10', { unit: 'kg' }),
      // Por unidade é mais "barato" em número, mas não se compara com o quilo.
      shared('3', 1.2, '2026-10-10', { unit: 'un', store_name: 'Quitanda' }),
    ];
    // A casa compra banana por quilo.
    const rows = sharedPriceRows(banana, [{ store_id: 'meu-atacadao', unit: 'kg', unit_price: 6.99 }]);
    expect(rows.map((row) => `${sharedPriceLabel(row)} ${row.storeName}`)).toEqual(['R$ 4,90/kg Atacadão Mooca', 'R$ 5,50/kg Super Outro', 'R$ 1,20/un Quitanda']);
    // 0,0049 x 1000 não vira 4,8999999999999995.
    expect(rows[0].unitPrice).toBe(4.9);
  });

  it('sem preço da casa, a unidade principal é a que tem mais mercados entre os vistos', () => {
    const rows = sharedPriceRows(
      [shared('1', 2, '2026-10-10', { store_name: 'A' }), shared('2', 30, '2026-10-10', { unit: 'kg', store_name: 'B' }), shared('3', 28, '2026-10-10', { unit: 'kg', store_name: 'C' })],
      [],
    );
    expect(rows.map((row) => row.storeName)).toEqual(['C', 'B', 'A']);
  });

  it('o mesmo mercado por g e por kg fica com uma linha, a mais recente', () => {
    const rows = sharedPriceRows(
      [shared(ATACADAO, 0.006, '2026-10-01', { unit: 'g' }), shared(ATACADAO, 5.2, '2026-10-08', { unit: 'kg' })],
      [],
    );
    expect(rows).toEqual([{ storeCnpj: ATACADAO, storeName: 'Atacadão Mooca', unit: 'kg', unitPrice: 5.2, seenOn: '2026-10-08' }]);
  });

  it('por produto: só os produtos com algo a mostrar, já sem o que a casa sabe', () => {
    const byProduct = sharedRowsByProduct(
      [
        shared(ATACADAO, 22.9, '2026-10-10'),
        shared(SUPER, 24, '2026-10-09'),
        shared(ATACADAO, 7.5, '2026-10-10', { product_id: 'feijao' }),
        shared(SUPER, 4.2, '2026-10-10', { product_id: 'leite' }),
      ],
      // O arroz no atacadão a casa comprou depois; o feijão de lá, no mesmo dia.
      [own('meu-atacadao', 23, '2026-10-12T10:00:00-03:00'), own('meu-atacadao', 7.5, '2026-10-10T10:00:00-03:00', { product_id: 'feijao' })],
      STORES,
    );
    expect([...byProduct.keys()].sort()).toEqual(['arroz', 'leite']);
    expect(byProduct.get('arroz')?.map((row) => row.storeName)).toEqual(['Super Outro']);
  });
});

describe('visto mais barato em outra casa', () => {
  const rows = sharedPriceRows([shared(ATACADAO, 21.9, '2026-10-10'), shared(SUPER, 24, '2026-10-11')], []);

  it('só quando é menor que o menor da casa', () => {
    expect(cheaperSharedPrice([{ unit: 'un', unit_price: 23.5 }, { unit: 'un', unit_price: 26 }], rows, 'un')?.storeName).toBe('Atacadão Mooca');
    expect(cheaperSharedPrice([{ unit: 'un', unit_price: 21.9 }], rows, 'un')).toBeNull();
    expect(cheaperSharedPrice([{ unit: 'un', unit_price: 19 }, { unit: 'un', unit_price: 26 }], rows, 'un')).toBeNull();
  });

  it('diferença que some nos centavos não é mais barato', () => {
    expect(cheaperSharedPrice([{ unit: 'un', unit_price: 21.9049 }], rows, 'un')).toBeNull();
    expect(cheaperSharedPrice([{ unit: 'un', unit_price: 21.91 }], rows, 'un')).not.toBeNull();
  });

  it('só na mesma unidade de comparação: quilo com quilo (ou grama), nunca com unidade', () => {
    const kilo = sharedPriceRows([shared(ATACADAO, 0.0049, '2026-10-10', { unit: 'g' })], []);
    expect(cheaperSharedPrice([{ unit: 'kg', unit_price: 6.99 }], kilo, 'kg')?.unitPrice).toBe(4.9);
    expect(cheaperSharedPrice([{ unit: 'g', unit_price: 0.00699 }], kilo, 'g')?.unitPrice).toBe(4.9);
    expect(cheaperSharedPrice([{ unit: 'un', unit_price: 6.99 }], kilo, 'un')).toBeNull();
    // A casa só tem preço por unidade: não há com o que comparar o quilo.
    expect(cheaperSharedPrice([{ unit: 'un', unit_price: 6.99 }], kilo, 'kg')).toBeNull();
    expect(cheaperSharedPrice([], rows, 'un')).toBeNull();
  });
});

describe('as frases', () => {
  const row = { storeCnpj: ATACADAO, storeName: 'Atacadão Mooca', unit: 'un', unitPrice: 22.9, seenOn: '2026-10-10' };

  it('a linha de um preço: valor com a unidade, o mercado como veio (sem artigo) e o dia', () => {
    expect(describeSharedPrice(row, 2026)).toBe('R$ 22,90/un · Atacadão Mooca · visto em 10 out');
    expect(sharedPriceLabel({ unit: 'kg', unitPrice: 5.5 })).toBe('R$ 5,50/kg');
  });

  it('o ano aparece quando não é o de agora', () => {
    expect(seenLabel(row, 2026)).toBe('visto em 10 out');
    expect(seenLabel(row, 2027)).toBe('visto em 10 out 2026');
    expect(describeSharedPrice(row, 2027)).toBe('R$ 22,90/un · Atacadão Mooca · visto em 10 out 2026');
  });

  it('a linha em Preços', () => {
    expect(cheaperSharedHint({ ...row, unitPrice: 21.9 }, 2026)).toBe('Visto por R$ 21,90/un · Atacadão Mooca · 10 out, em outra casa');
    expect(cheaperSharedHint({ ...row, unitPrice: 21.9 }, 2027)).toBe('Visto por R$ 21,90/un · Atacadão Mooca · 10 out 2026, em outra casa');
  });

  it('o aviso diz que não é em tempo real e que não diz de quem; a casa lê o que ela compartilha', () => {
    expect(SHARED_PRICES_NOTICE).toBe(
      'Preços de notas de outras casas que usam o Kotii, sem dizer de quem. Não são em tempo real: cada preço vale para o dia em que foi visto.',
    );
    expect(SHARING_ABOUT).toBe(
      'Os preços das notas lidas pelo app (mercado, item, preço e dia) entram numa base comum, sem dizer de qual casa são, para que outras casas vejam quanto cada coisa custa em cada mercado. Notas digitadas à mão e remédios ficam de fora.',
    );
  });
});

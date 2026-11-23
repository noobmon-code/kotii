import { describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';

import { CATEGORIES } from '../categories';
import { PACK_ITEM } from '../priceHistory';
import {
  cheaperSharedHint,
  cheaperSharedPrice,
  comparedSharedByProduct,
  comparedSharedForProduct,
  compareSharedPrices,
  describeSharedPrice,
  fitsHouseholdPack,
  type OwnPrice,
  ownSharedPack,
  saoPauloDay,
  seenLabel,
  SHARED_CATEGORIES,
  SHARED_PRICE_BAND,
  SHARED_PRICES_NOTICE,
  sharedPack,
  sharedPackDetail,
  type SharedPrice,
  sharedPriceLabel,
  type SharedPriceRow,
  sharedPriceRows,
  sharedQuotes,
  sharedRowDetail,
  sharedRowsByProduct,
  SHARING_ABOUT,
  SIZE_UNKNOWN,
  stateAbbreviation,
  unitPricePool,
  visibleSharedPrices,
  withinBand,
} from '../sharedPrices';

const ATACADAO = '11222333000181';
const SUPER = '99888777000166';

const shared = (store_cnpj: string, unit_price: number, seen_on: string, partial: Partial<SharedPrice> = {}): SharedPrice => ({
  product_id: 'arroz',
  store_cnpj,
  store_name: store_cnpj === ATACADAO ? 'Atacadão Mooca' : 'Super Outro',
  store_uf: null,
  unit: 'un',
  unit_price,
  seen_on,
  mine: false,
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

/** A casa conhece o atacadão pelo CNPJ (com o nome que ela mesma leu); o mercadinho foi criado à mão, sem CNPJ. */
const STORES = [
  { id: 'meu-atacadao', cnpj: ATACADAO, name: 'Atacadão da esquina' },
  { id: 'mercadinho', cnpj: null, name: 'Mercadinho' },
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

  it('a compra da casa sem valor (preço zero) não esconde: a casa não sabe quanto pagou ali', () => {
    const mine = [own('meu-atacadao', 0, '2026-10-12T12:00:00-03:00')];
    expect(visibleSharedPrices([shared(ATACADAO, 21.9, '2026-10-11')], mine, STORES)).toHaveLength(1);
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
    expect(rows).toEqual([{ storeCnpj: ATACADAO, storeName: 'Atacadão Mooca', state: null, mine: false, unit: 'kg', unitPrice: 5.2, seenOn: '2026-10-08' }]);
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
  /** O que Preços mostra embaixo do produto: o mais barato de fora comparado com os preços da casa. */
  const cheaper = (seen: SharedPrice[], mine: OwnPrice[], stores = STORES) => cheaperSharedPrice(compareSharedPrices(seen, mine, stores));
  const rows = [shared(ATACADAO, 21.9, '2026-10-10'), shared(SUPER, 24, '2026-10-11')];
  const at = '2026-10-01T12:00:00-03:00';

  it('só quando é menor que o menor da casa', () => {
    expect(cheaper(rows, [own('a', 23.5, at), own('b', 26, at)])?.storeName).toBe('Atacadão Mooca');
    expect(cheaper(rows, [own('a', 21.9, at)])).toBeNull();
    expect(cheaper(rows, [own('a', 19, at), own('b', 26, at)])).toBeNull();
  });

  it('diferença que some nos centavos não é mais barato', () => {
    expect(cheaper(rows, [own('a', 21.9049, at)])).toBeNull();
    expect(cheaper(rows, [own('a', 21.91, at)])).not.toBeNull();
  });

  it('"mais barato" é o que a tela escreve: 1,005 e 1,01 saem os dois como R$ 1,01', () => {
    // A conta em centavos arredondava 1,005 x 100 (100,49999…) para baixo, e a linha repetia o preço da casa.
    const half = [shared(ATACADAO, 1.005, '2026-10-10', { unit: 'kg' })];
    expect(cheaper(half, [own('a', 1.01, at, { unit: 'kg' })])).toBeNull();
    expect(cheaper(half, [own('a', 1.02, at, { unit: 'kg' })])?.unitPrice).toBe(1.01);
  });

  it('prefere o mercado da própria casa; sem ele, o mais barato dos outros', () => {
    const seen = [
      shared(SUPER, 20, '2026-10-11'),
      shared('3', 19, '2026-10-09', { store_name: 'Mais Barato de Todos' }),
      // No atacadão da casa: mais caro que os dois, mas mais barato que o que a casa pagou.
      shared(ATACADAO, 21.9, '2026-10-10', { mine: true }),
    ];
    expect(cheaper(seen, [own('a', 23.5, at)])?.storeName).toBe('Atacadão da esquina');
    // O do mercado da casa não é mais barato que o dela: vale o mais barato dos outros.
    expect(cheaper(seen, [own('a', 21.9, at)])?.storeName).toBe('Mais Barato de Todos');
    expect(cheaper(seen, [own('a', 19, at)])).toBeNull();
  });

  it('no empate de preço, o visto por último', () => {
    const seen = [shared(SUPER, 20, '2026-10-09'), shared('3', 20, '2026-10-11', { store_name: 'Mais novo' })];
    expect(cheaper(seen, [own('a', 23.5, at)])?.storeName).toBe('Mais novo');
  });

  it('só na mesma unidade de comparação: quilo com quilo (ou grama), nunca com unidade', () => {
    const kilo = [shared(ATACADAO, 0.0049, '2026-10-10', { unit: 'g' })];
    expect(cheaper(kilo, [own('a', 6.99, at, { unit: 'kg' })])?.unitPrice).toBe(4.9);
    expect(cheaper(kilo, [own('a', 0.00699, at, { unit: 'g' })])?.unitPrice).toBe(4.9);
    // A casa só tem preço por unidade: não há com o que comparar o quilo.
    expect(cheaper(kilo, [own('a', 6.99, at)])).toBeNull();
    expect(cheaper(rows, [])).toBeNull();
  });

  it('nunca a mais de 2,5 vezes do preço da casa: quase sempre é outra embalagem (no limite, ainda compara)', () => {
    expect(cheaper([shared(SUPER, 3.49, '2026-10-11')], [own('a', 39.9, at)])).toBeNull();
    expect(cheaper([shared(SUPER, 10, '2026-10-11')], [own('a', 25, at)])?.unitPrice).toBe(10);
    expect(cheaper([shared(SUPER, 9.99, '2026-10-11')], [own('a', 25, at)])).toBeNull();
  });
});

describe('o tamanho da embalagem nos preços de outras casas', () => {
  const OUTRO = '55444333000122';
  const seenOn = '2026-11-15';
  const at = '2026-11-10T12:00:00-03:00';
  /** A linha de outra casa no SUPER OUTRO (SP), vista em 15 nov, com o tamanho que o servidor leu. */
  const other = (unit_price: number, pack?: Pick<SharedPrice, 'pack_unit' | 'pack_amount' | 'pack_of'>, partial: Partial<SharedPrice> = {}) =>
    shared(OUTRO, unit_price, seenOn, { store_name: 'SUPER OUTRO', store_uf: '35', ...(pack ?? {}), ...partial });
  const mine = (store: string, unit_price: number, raw_description?: string, partial: Partial<OwnPrice> = {}) =>
    own(store, unit_price, at, { ...(raw_description ? { raw_description } : {}), ...partial });
  /** O que as duas telas mostram: a dica de Preços e, por linha, o subtítulo e o preço da direita da tela do produto. */
  function shown(seen: SharedPrice[], ownRows: OwnPrice[], mainUnit?: string) {
    const compared = compareSharedPrices(seen, ownRows, STORES, mainUnit);
    const hint = cheaperSharedPrice(compared);
    return {
      hint: hint ? cheaperSharedHint(hint, 2026) : null,
      rows: compared.rows.map((row) => `${sharedRowDetail(row, 2026)} / ${sharedPriceLabel(row)}`),
    };
  }
  const can = { pack_unit: 'l', pack_amount: 0.35 };
  const twelve = { pack_unit: 'l', pack_amount: 4.2, pack_of: 12 };

  it('a caixa de 12 da casa e a lata avulsa de fora: dois tamanhos conhecidos nunca se comparam', () => {
    expect(shown([other(3.29, can)], [mine('a', 39.9, 'CERV SKOL LT 350ML C/12')])).toEqual({ hint: null, rows: ['350 ml · visto em 15 nov / R$ 3,29/un'] });
  });

  it('a mesma caixa de 12 de fora, mais barata: a dica diz o tamanho', () => {
    expect(shown([other(36.9, twelve)], [mine('a', 39.9, 'CERV SKOL LT 350ML C/12')])).toEqual({
      hint: 'Visto por R$ 36,90/un (12 x 350 ml) · SUPER OUTRO (SP) · 15 nov, em outra casa',
      rows: ['12 x 350 ml · visto em 15 nov / R$ 36,90/un'],
    });
  });

  it('sem tamanho, 11 vezes mais barato: fora da faixa, sem dica; a linha diz que o tamanho não foi informado', () => {
    expect(shown([other(3.49)], [mine('a', 39.9, 'CERV SKOL LT 350ML C/12')])).toEqual({
      hint: null,
      rows: ['tamanho não informado · visto em 15 nov / R$ 3,49/un'],
    });
  });

  it('um tamanho só na casa: o de fora fica por unidade, e só o mesmo tamanho se compara (um mercado com dois tamanhos, duas linhas)', () => {
    expect(shown([other(22.9, { pack_unit: 'kg', pack_amount: 5 }), other(4.99, { pack_unit: 'kg', pack_amount: 1 })], [mine('a', 24.9, 'ARROZ CAMIL 5KG')])).toEqual({
      hint: 'Visto por R$ 22,90/un (5 kg) · SUPER OUTRO (SP) · 15 nov, em outra casa',
      rows: ['5 kg · visto em 15 nov / R$ 22,90/un', '1 kg · visto em 15 nov / R$ 4,99/un'],
    });
  });

  it('a casa compara por kg: o de fora vira preço por kg, e o sem tamanho fica por unidade, depois', () => {
    const result = shown(
      [other(22.9, { pack_unit: 'kg', pack_amount: 5 }), other(4.99, { pack_unit: 'kg', pack_amount: 1 }), other(3.49)],
      [mine('a', 24.9, 'ARROZ CAMIL 5KG'), mine('b', 5.49, 'ARROZ CAMIL 1KG')],
    );
    expect(result).toEqual({
      hint: 'Visto por R$ 4,58/kg (5 kg por R$ 22,90) · SUPER OUTRO (SP) · 15 nov, em outra casa',
      rows: [
        '5 kg por R$ 22,90 · visto em 15 nov / R$ 4,58/kg',
        '1 kg por R$ 4,99 · visto em 15 nov / R$ 4,99/kg',
        'tamanho não informado · visto em 15 nov / R$ 3,49/un',
      ],
    });
    const compared = compareSharedPrices(
      [other(22.9, { pack_unit: 'kg', pack_amount: 5 }), other(3.49)],
      [mine('a', 24.9, 'ARROZ CAMIL 5KG'), mine('b', 5.49, 'ARROZ CAMIL 1KG')],
      STORES,
    );
    expect(compared.unit).toBe('kg');
    expect(compared.rows.map((row) => [row.unit, row.unitPrice, row.packagePrice, row.comparedTo, row.sizeUnknown])).toEqual([
      ['kg', 4.58, 22.9, 4.98, false],
      ['un', 3.49, null, null, true],
    ]);
    expect(describeSharedPrice(compared.rows[0], 2026)).toBe('R$ 4,58/kg · 5 kg por R$ 22,90 · SUPER OUTRO (SP) · visto em 15 nov');
  });

  it('a contagem da casa (12 un) e o volume de fora (350 ml): outra grandeza, não se compara', () => {
    expect(shown([other(3.29, can)], [mine('a', 39.9, 'CERV SKOL C/12')])).toEqual({ hint: null, rows: ['350 ml · visto em 15 nov / R$ 3,29/un'] });
  });

  it('o arroz de 5 kg da casa e o pacote de 12 un de fora: não se comparam', () => {
    expect(shown([other(9.9, { pack_unit: 'un', pack_amount: 12 })], [mine('a', 24.9, 'ARROZ CAMIL 5KG')])).toEqual({
      hint: null,
      rows: ['12 un · visto em 15 nov / R$ 9,90/un'],
    });
  });

  it('a casa compra a caixa de 6 e o pote de 170 g: o de 170 g de fora se compara com o pote, não com a caixa', () => {
    expect(shown([other(2.3, { pack_unit: 'kg', pack_amount: 0.17 })], [mine('a', 12, 'IOGURTE NESTLE C/6'), mine('b', 2.5, 'IOGURTE NESTLE 170G')])).toEqual({
      hint: 'Visto por R$ 2,30/un (170 g) · SUPER OUTRO (SP) · 15 nov, em outra casa',
      rows: ['170 g · visto em 15 nov / R$ 2,30/un'],
    });
  });

  it('ovos respondidos na revisão (30) e uma linha sem tamanho: o tamanho desconhecido se compara', () => {
    expect(shown([other(21.9)], [mine('a', 24.9, 'OVOS RANCHO CAIPIRA', { pack_count: 30 })])).toEqual({
      hint: 'Visto por R$ 21,90/un (tamanho não informado) · SUPER OUTRO (SP) · 15 nov, em outra casa',
      rows: ['tamanho não informado · visto em 15 nov / R$ 21,90/un'],
    });
  });

  it('ovos respondidos (30) e a cartela de 12 de fora: dois tamanhos conhecidos', () => {
    expect(shown([other(11.9, { pack_unit: 'un', pack_amount: 12 })], [mine('a', 24.9, 'OVOS RANCHO CAIPIRA', { pack_count: 30 })])).toEqual({
      hint: null,
      rows: ['12 un · visto em 15 nov / R$ 11,90/un'],
    });
  });

  it('a lata comprada como fardo (o preço do fardo sob a descrição da lata): a faixa segura', () => {
    expect(shown([other(3.29, can)], [mine('a', 39.9, 'CERV SKOL LT 350ML')])).toEqual({ hint: null, rows: ['350 ml · visto em 15 nov / R$ 3,29/un'] });
  });

  it('um tamanho mal lido (12 x 1 L) contra o preço por litro da casa: aparece convertido, mas sem dica', () => {
    expect(shown([other(4.99, { pack_unit: 'l', pack_amount: 12, pack_of: 12 })], [mine('a', 4.79, undefined, { unit: 'l' }), mine('b', 5, undefined, { unit: 'l' })])).toEqual({
      hint: null,
      rows: ['12 x 1 L por R$ 4,99 · visto em 15 nov / R$ 0,42/l'],
    });
  });

  it('sem tamanho em lugar nenhum (os dados de hoje): os textos de antes', () => {
    expect(shown([other(21.9)], [mine('a', 24.9)])).toEqual({
      hint: 'Visto por R$ 21,90/un · SUPER OUTRO (SP) · 15 nov, em outra casa',
      rows: ['visto em 15 nov / R$ 21,90/un'],
    });
    const [row] = compareSharedPrices([other(21.9)], [mine('a', 24.9)], STORES).rows;
    expect(describeSharedPrice(row, 2026)).toBe('R$ 21,90/un · SUPER OUTRO (SP) · visto em 15 nov');
  });

  it('ovos de dois tamanhos na casa: por item do pacote; "o ovo" e "30 ovos" só com a categoria', () => {
    const compared = compareSharedPrices([other(21.9, { pack_unit: 'un', pack_amount: 30 })], [mine('a', 11.9, 'OVOS C/12'), mine('b', 24.9, 'OVOS 30UN')], STORES);
    expect(compared.unit).toBe(PACK_ITEM);
    const hint = cheaperSharedPrice(compared)!;
    expect(hint).toMatchObject({ unit: PACK_ITEM, unitPrice: 0.73, packagePrice: 21.9, comparedTo: 0.83 });
    expect(cheaperSharedHint(hint, 2026)).toBe('Visto por R$ 0,73 cada (30 un por R$ 21,90) · SUPER OUTRO (SP) · 15 nov, em outra casa');
    expect(cheaperSharedHint(hint, 2026, 'ovos')).toBe('Visto por R$ 0,73 o ovo (30 ovos por R$ 21,90) · SUPER OUTRO (SP) · 15 nov, em outra casa');
    expect(sharedPriceLabel(hint)).toBe('R$ 0,73 cada');
    expect(sharedPriceLabel(hint, 'ovos')).toBe('R$ 0,73 o ovo');
    expect(sharedPackDetail(hint, 'ovos')).toBe('30 ovos por R$ 21,90');
    expect(sharedRowDetail(hint, 2026, 'ovos')).toBe('30 ovos por R$ 21,90 · visto em 15 nov');
    expect(describeSharedPrice(hint, 2026, 'ovos')).toBe('R$ 0,73 o ovo · 30 ovos por R$ 21,90 · SUPER OUTRO (SP) · visto em 15 nov');
    expect(describeSharedPrice(hint, 2026)).toBe('R$ 0,73 cada · 30 un por R$ 21,90 · SUPER OUTRO (SP) · visto em 15 nov');
  });

  it('a unidade da tela do produto (mainUnit) vale no lugar da dos preços guardados', () => {
    const seen = [other(22.9, { pack_unit: 'kg', pack_amount: 5 })];
    // Nos preços guardados, a lista por unidade tem mais mercados; na tela do produto (o histórico inteiro), a por kg.
    const ownRows = [mine('a', 24.9), mine('b', 26), mine('c', 5.2, undefined, { unit: 'kg' })];
    expect(compareSharedPrices(seen, ownRows, STORES).unit).toBe('un');
    expect(compareSharedPrices(seen, ownRows, STORES).rows.map((row) => [row.unit, row.unitPrice, row.comparedTo])).toEqual([['un', 22.9, 24.9]]);
    const byKilo = compareSharedPrices(seen, ownRows, STORES, 'kg');
    expect(byKilo.unit).toBe('kg');
    expect(byKilo.rows.map((row) => [row.unit, row.unitPrice, row.comparedTo])).toEqual([['kg', 4.58, 5.2]]);
  });

  it('as que se comparam vêm primeiro; depois a unidade da casa, un, item, kg e l; depois a mais barata', () => {
    const compared = compareSharedPrices(
      [
        other(8, undefined, { unit: 'kg', store_cnpj: '1', store_name: 'K' }),
        other(30, undefined, { store_cnpj: '2', store_name: 'Longe' }),
        other(22, undefined, { store_cnpj: '3', store_name: 'Perto' }),
        other(4, undefined, { unit: 'l', store_cnpj: '4', store_name: 'L' }),
        other(1, undefined, { store_cnpj: '5', store_name: 'Barato demais' }),
      ],
      [mine('a', 24.9)],
      STORES,
    );
    expect(compared.rows.map((row) => `${row.storeName} ${row.unit} ${row.comparedTo ?? '-'}`)).toEqual([
      'Perto un 24.9',
      'Longe un 24.9',
      'Barato demais un -',
      'K kg -',
      'L l -',
    ]);
  });

  it('a casa sem preço nenhum: nada se compara, e a unidade principal é null', () => {
    const compared = compareSharedPrices([other(22.9, { pack_unit: 'kg', pack_amount: 5 })], [], STORES);
    expect(compared.unit).toBeNull();
    expect(compared.rows.map((row) => [row.unit, row.unitPrice, row.comparedTo, row.sizeUnknown])).toEqual([['un', 22.9, null, false]]);
    expect(cheaperSharedPrice(compared)).toBeNull();
  });

  it('por produto: o que a casa já sabe fica de fora, e produto sem linha não entra', () => {
    const seen = [other(22.9), other(4.5, undefined, { product_id: 'leite' }), shared(ATACADAO, 21, '2026-11-01', { product_id: 'leite' })];
    const ownRows = [mine('meu-atacadao', 4.9, undefined, { product_id: 'leite', purchased_at: '2026-11-05T12:00:00-03:00' })];
    const all = comparedSharedByProduct(seen, ownRows, STORES);
    expect([...all.keys()].sort()).toEqual(['arroz', 'leite']);
    expect(all.get('leite')?.rows.map((row) => row.storeName)).toEqual(['SUPER OUTRO']);
    expect(comparedSharedForProduct(seen, ownRows, STORES, 'leite')).toEqual(all.get('leite'));
    expect(comparedSharedForProduct(seen, ownRows, STORES, 'feijao')).toBeNull();
  });
});

describe('o tamanho de cada lado', () => {
  it('sharedPack: só na forma do check do banco', () => {
    expect(sharedPack({ unit: 'un', pack_unit: 'l', pack_amount: 4.2, pack_of: 12 })).toEqual({ unit: 'l', amount: 4.2, of: 12, label: '12 x 350 ml' });
    expect(sharedPack({ unit: 'un', pack_unit: 'un', pack_amount: 30 })).toEqual({ unit: 'un', amount: 30, label: '30 un' });
    expect(sharedPack({ unit: 'un', pack_unit: 'kg', pack_amount: 5, pack_of: null })).toEqual({ unit: 'kg', amount: 5, label: '5 kg' });
    for (const row of [
      { unit: 'kg', pack_unit: 'kg', pack_amount: 5 },
      { unit: 'un', pack_unit: 'g', pack_amount: 500 },
      { unit: 'un', pack_unit: 'kg', pack_amount: 0 },
      { unit: 'un', pack_unit: 'un', pack_amount: 1.5 },
      { unit: 'un', pack_unit: 'un', pack_amount: 1 },
      { unit: 'un', pack_unit: 'un', pack_amount: 12, pack_of: 2 },
      { unit: 'un', pack_unit: 'l', pack_amount: 4.2, pack_of: 1 },
      { unit: 'un', pack_unit: 'l', pack_amount: null },
      { unit: 'un', pack_unit: null, pack_amount: 5 },
      { unit: 'un' },
    ]) {
      expect(sharedPack(row)).toBeNull();
    }
  });

  it('ownSharedPack: a leitura estrita da descrição, senão quantos vinham', () => {
    expect(ownSharedPack({ raw_description: 'CERV SKOL LT 350ML C/12' })?.label).toBe('12 x 350 ml');
    // O leitor da casa lê 350 ml; o estrito, que vai contra a base comum, não lê nada.
    expect(ownSharedPack({ raw_description: 'CERV BRAHMA 350ML LT C12' })).toBeNull();
    expect(ownSharedPack({ raw_description: 'OVOS RANCHO', pack_count: 30 })?.label).toBe('30 un');
    expect(ownSharedPack({ raw_description: null, pack_count: 1 })).toBeNull();
    expect(ownSharedPack({})).toBeNull();
  });

  it('withinBand: até 2,5 vezes, inclusive, para os dois lados', () => {
    expect(SHARED_PRICE_BAND).toBe(2.5);
    expect(withinBand(10, 25)).toBe(true);
    expect(withinBand(25, 10)).toBe(true);
    expect(withinBand(9.99, 25)).toBe(false);
    expect(withinBand(25, 9.99)).toBe(false);
    expect(withinBand(0, 1)).toBe(false);
    expect(withinBand(1, 0)).toBe(false);
  });

  it('unitPricePool: o mesmo tamanho primeiro; sem ele, os sem tamanho; sem tamanho de fora, todos', () => {
    const kilo = { unit: 'kg' as const, amount: 1, label: '1 kg' };
    const five = { unit: 'kg' as const, amount: 5, label: '5 kg' };
    const ownUn = [
      { price: 24.9, pack: five },
      { price: 6.2, pack: null },
      { price: 5.49, pack: kilo },
    ];
    expect(unitPricePool(ownUn, { unit: 'kg', amount: 5000 / 1000, label: '5 kg' })).toEqual([24.9]);
    expect(unitPricePool(ownUn, { unit: 'kg', amount: 2, label: '2 kg' })).toEqual([6.2]);
    expect(unitPricePool(ownUn, null)).toEqual([24.9, 6.2, 5.49]);
    expect(unitPricePool([{ price: 24.9, pack: five }], kilo)).toEqual([]);
  });
});

describe('o preço por unidade de fora na lista e no "Onde comprar" (fitsHouseholdPack)', () => {
  const at = '2026-11-10T12:00:00-03:00';
  const box = own('a', 39.9, at, { product_id: 'cerveja', raw_description: 'CERV SKOL LT 350ML C/12' });
  const beer = (unit_price: number, partial: Partial<SharedPrice> = {}) => shared(SUPER, unit_price, '2026-11-15', { product_id: 'cerveja', ...partial });

  it('a casa compra a caixa de 12: a lata de fora não entra, com ou sem tamanho; a caixa entra, com ou sem tamanho', () => {
    const fits = fitsHouseholdPack([box]);
    expect(fits(beer(3.29, { pack_unit: 'l', pack_amount: 0.35 }))).toBe(false);
    expect(fits(beer(3.49))).toBe(false);
    expect(fits(beer(36.9, { pack_unit: 'l', pack_amount: 4.2, pack_of: 12 }))).toBe(true);
    expect(fits(beer(36.9))).toBe(true);
  });

  it('por kg ou litro, sempre; produto sem preço por unidade da casa, sempre', () => {
    const fits = fitsHouseholdPack([box, own('a', 5, at, { product_id: 'banana', unit: 'kg' })]);
    expect(fits(beer(0.5, { unit: 'kg' }))).toBe(true);
    expect(fits(shared(SUPER, 0.5, '2026-11-15', { product_id: 'banana' }))).toBe(true);
    expect(fits(shared(SUPER, 0.5, '2026-11-15', { product_id: 'feijao' }))).toBe(true);
    expect(fitsHouseholdPack([])(beer(3.29))).toBe(true);
  });

  it('sharedQuotes tira exatamente essas linhas', () => {
    const quotes = sharedQuotes([beer(3.29, { pack_unit: 'l', pack_amount: 0.35 }), beer(36.9, { store_cnpj: '3', store_name: 'Caixa' })], [box], STORES);
    expect(quotes.map((quote) => quote.storeName)).toEqual(['Caixa']);
  });

  it('sem tamanho e dentro da faixa, sharedQuotes dá o mesmo de antes', () => {
    const seen = [shared(SUPER, 21.5, '2026-11-15'), shared(ATACADAO, 22.9, '2026-11-15', { mine: true })];
    const mine = [own('mercadinho', 24.9, at)];
    expect(sharedQuotes(seen, mine, STORES)).toEqual(sharedQuotes(seen.map((row) => ({ ...row, pack_unit: null, pack_amount: null, pack_of: null })), mine, STORES));
    expect(sharedQuotes(seen, mine, STORES).map((quote) => quote.unitPrice)).toEqual([21.5, 22.9]);
  });
});

describe('de quem é o mercado', () => {
  it('o mercado da própria casa leva o nome que a casa conhece; o dos outros, o nome da nota e o estado', () => {
    const rows = sharedPriceRows(
      [
        shared(ATACADAO, 22.9, '2026-10-10', { store_name: 'ATACADAO S.A.', store_uf: '35', mine: true }),
        shared(SUPER, 24, '2026-10-09', { store_name: 'SENDAS DISTRIBUIDORA S/A', store_uf: '33' }),
        shared('3', 25, '2026-10-09', { store_name: 'MERCADO DA FOTO' }),
      ],
      [],
      STORES,
    );
    expect(rows.map((row) => [row.storeName, row.state, row.mine])).toEqual([
      ['Atacadão da esquina', null, true],
      ['SENDAS DISTRIBUIDORA S/A', 'RJ', false],
      ['MERCADO DA FOTO', null, false],
    ]);
    expect(rows.map((row) => describeSharedPrice(row, 2026))).toEqual([
      'R$ 22,90/un · Atacadão da esquina · visto em 10 out',
      'R$ 24,00/un · SENDAS DISTRIBUIDORA S/A (RJ) · visto em 9 out',
      'R$ 25,00/un · MERCADO DA FOTO · visto em 9 out',
    ]);
  });

  it('o mercado da casa que a lista de mercados ainda não tem fica com o nome da nota', () => {
    const [row] = sharedPriceRows([shared(SUPER, 24, '2026-10-09', { mine: true, store_uf: '35' })], [], STORES);
    expect([row.storeName, row.state, row.mine]).toEqual(['Super Outro', null, true]);
  });

  it('por produto, cada linha já vem com o nome certo', () => {
    const byProduct = sharedRowsByProduct([shared(ATACADAO, 22.9, '2026-10-10', { mine: true })], [], STORES);
    expect(byProduct.get('arroz')?.map((row) => row.storeName)).toEqual(['Atacadão da esquina']);
  });

  it('o estado sai dos dois primeiros dígitos da chave de acesso (código do IBGE): os 27', () => {
    const codes = ['11', '12', '13', '14', '15', '16', '17', '21', '22', '23', '24', '25', '26', '27', '28', '29', '31', '32', '33', '35', '41', '42', '43', '50', '51', '52', '53'];
    expect(codes.map(stateAbbreviation).join(' ')).toBe('RO AC AM RR PA AP TO MA PI CE RN PB PE AL SE BA MG ES RJ SP PR SC RS MS MT GO DF');
    // Código que não é de estado nenhum, ou linha sem estado: nada a escrever.
    expect(['34', '00', '99', '', null, undefined].map(stateAbbreviation)).toEqual([null, null, null, null, null, null]);
  });
});

describe('o que se compartilha', () => {
  // A definição em vigor do gatilho: a da última migração que o (re)cria.
  const migrations = path.resolve(__dirname, '../../../supabase/migrations');
  const migration = readdirSync(migrations)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(path.join(migrations, name), 'utf8'))
    .filter((sql) => /function public.share_receipt_prices()/.test(sql) && sql.includes('v_shared constant'))
    .at(-1)!;
  /** A lista que o gatilho declara com esse nome: v_nome constant text[] := array['a', 'b', …]. */
  const sqlList = (name: string) => {
    const declared = new RegExp(`${name} constant text\\[\\] := array\\[([^\\]]*)\\]`).exec(migration);
    return [...(declared?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
  };

  it('a lista do app é a mesma do gatilho no banco', () => {
    expect(sqlList('v_shared')).toEqual([...SHARED_CATEGORIES]);
  });

  it('só a linha de remédio segura a nota inteira: a chave que o gatilho usa é a de uma categoria de verdade, fora da lista', () => {
    // O app não tem lista para esta camada (não decide nada com ela): o que se confere aqui é que a chave
    // escrita no gatilho continua existindo. Trocada a chave da categoria, a camada pararia sem aviso.
    const medicine = /v_medicine constant text := '([a-z_]+)'/.exec(migration)?.[1];
    expect(medicine).toBe('medicamentos');
    expect(CATEGORIES.map((category) => category.key)).toContain(medicine);
    expect(SHARED_CATEGORIES).not.toContain(medicine);
  });

  it('a casa lê, sobre o que compartilha, o mesmo que fica de fora pelo gatilho e o que a revisão segura', () => {
    for (const part of ['remédios', 'farmácia', 'suplementos', 'primeiros socorros', 'higiene pessoal', 'não reconheceu', 'corrige na revisão']) {
      expect(SHARING_ABOUT).toContain(part);
    }
  });

  it('toda categoria tem lugar decidido: uma categoria nova não entra sozinha', () => {
    const keys = CATEGORIES.map((category) => category.key);
    expect(SHARED_CATEGORIES.filter((key) => !keys.includes(key))).toEqual([]);
    // Fora: higiene pessoal (mistura xampu com item íntimo), saúde, e "outros" (onde cai o remédio que o app não reconheceu).
    expect(keys.filter((key) => !SHARED_CATEGORIES.includes(key))).toEqual(['higiene', 'medicamentos', 'suplementos', 'primeiros_socorros', 'outros']);
  });
});

describe('as frases', () => {
  const row: SharedPriceRow = { storeCnpj: ATACADAO, storeName: 'Atacadão Mooca', state: null, mine: false, unit: 'un', unitPrice: 22.9, seenOn: '2026-10-10' };

  it('a linha de um preço: valor com a unidade, o mercado como veio (sem artigo) e o dia', () => {
    expect(describeSharedPrice(row, 2026)).toBe('R$ 22,90/un · Atacadão Mooca · visto em 10 out');
    expect(sharedPriceLabel({ unit: 'kg', unitPrice: 5.5 })).toBe('R$ 5,50/kg');
  });

  it('o ano aparece quando não é o de agora', () => {
    expect(seenLabel(row, 2026)).toBe('visto em 10 out');
    expect(seenLabel(row, 2027)).toBe('visto em 10 out 2026');
    expect(describeSharedPrice(row, 2027)).toBe('R$ 22,90/un · Atacadão Mooca · visto em 10 out 2026');
  });

  it('o tamanho, quando se sabe, vai na linha e entre parênteses na dica; sem nada, os textos de antes', () => {
    const five = { pack: { unit: 'kg' as const, amount: 5, label: '5 kg' }, packagePrice: null, sizeUnknown: false };
    expect(sharedPackDetail(row)).toBeNull();
    expect(sharedRowDetail(row, 2026)).toBe('visto em 10 out');
    expect(sharedPackDetail({ ...row, ...five })).toBe('5 kg');
    expect(sharedPackDetail({ ...row, ...five, packagePrice: 22.9 })).toBe('5 kg por R$ 22,90');
    expect(sharedPackDetail({ ...row, ...five, sizeUnknown: true })).toBe(SIZE_UNKNOWN);
    expect(sharedPackDetail({ ...row, pack: null, packagePrice: null, sizeUnknown: true })).toBe('tamanho não informado');
    expect(sharedRowDetail({ ...row, ...five }, 2026)).toBe('5 kg · visto em 10 out');
    expect(describeSharedPrice({ ...row, ...five }, 2026)).toBe('R$ 22,90/un · 5 kg · Atacadão Mooca · visto em 10 out');
    expect(cheaperSharedHint({ ...row, ...five, unitPrice: 21.9 }, 2026)).toBe('Visto por R$ 21,90/un (5 kg) · Atacadão Mooca · 10 out, em outra casa');
    // Fora dos ovos, a categoria não muda nada.
    const thirty = { pack: { unit: 'un' as const, amount: 30, label: '30 un' }, packagePrice: null, sizeUnknown: false };
    expect(sharedRowDetail({ ...row, ...thirty }, 2026, 'laticinios')).toBe('30 un · visto em 10 out');
    expect(sharedRowDetail({ ...row, ...thirty }, 2026, 'ovos')).toBe('30 ovos · visto em 10 out');
    expect(cheaperSharedHint({ ...row, unitPrice: 21.9 }, 2026, 'ovos')).toBe('Visto por R$ 21,90/un · Atacadão Mooca · 10 out, em outra casa');
  });

  it('a linha em Preços', () => {
    expect(cheaperSharedHint({ ...row, unitPrice: 21.9 }, 2026)).toBe('Visto por R$ 21,90/un · Atacadão Mooca · 10 out, em outra casa');
    expect(cheaperSharedHint({ ...row, unitPrice: 21.9, state: 'SP' }, 2026)).toBe('Visto por R$ 21,90/un · Atacadão Mooca (SP) · 10 out, em outra casa');
    expect(cheaperSharedHint({ ...row, unitPrice: 21.9 }, 2027)).toBe('Visto por R$ 21,90/un · Atacadão Mooca · 10 out 2026, em outra casa');
  });

  it('o aviso diz que não é em tempo real e que não diz de quem; a casa lê o que ela compartilha', () => {
    expect(SHARED_PRICES_NOTICE).toBe(
      'Preços de notas de outras casas que usam o Kotii, sem dizer de quem. Não são em tempo real: cada preço vale para o dia em que foi visto.',
    );
    expect(SHARING_ABOUT).toBe(
      'Os preços das notas lidas pelo app (mercado, item, código de barras, tamanho da embalagem, preço e dia) entram numa base comum, sem dizer de qual casa são, para que outras casas vejam quanto cada coisa custa nos mercados. Ficam de fora as notas digitadas à mão, remédios e compras em farmácia, suplementos, primeiros socorros, itens de higiene pessoal e o que o app não reconheceu; o que você corrige na revisão também fica na casa. Cada preço aparece para as outras casas a partir do dia seguinte.',
    );
  });
});

describe('os preços de outras casas como entram na lista (sharedQuotes)', () => {
  it('ligados ao mercado da casa pelo CNPJ, com o nome que ela conhece; os de fora sem mercado da casa', () => {
    const quotes = sharedQuotes(
      [shared(ATACADAO, 22.9, '2026-10-10', { mine: true }), shared(SUPER, 21.5, '2026-10-09', { store_uf: '35' })],
      [],
      STORES,
    );
    expect(quotes).toEqual([
      expect.objectContaining({ productId: 'arroz', storeId: null, storeCnpj: SUPER, storeName: 'Super Outro', state: 'SP', unitPrice: 21.5 }),
      expect.objectContaining({ productId: 'arroz', storeId: 'meu-atacadao', storeCnpj: ATACADAO, storeName: 'Atacadão da esquina', unitPrice: 22.9 }),
    ]);
  });

  it('dois mercados da casa com o mesmo CNPJ recebem o preço os dois', () => {
    const stores = [...STORES, { id: 'outro-atacadao', cnpj: ATACADAO, name: 'Atacadão (outro cadastro)' }];
    const quotes = sharedQuotes([shared(ATACADAO, 22.9, '2026-10-10', { mine: true })], [], stores);
    expect(quotes.map((quote) => quote.storeId).sort()).toEqual(['meu-atacadao', 'outro-atacadao']);
  });

  it('o que a casa já sabe fica de fora, e o "mercado da casa" que ela não tem mais não vira mercado de fora', () => {
    const quotes = sharedQuotes(
      [shared(ATACADAO, 22.9, '2026-10-01', { mine: true }), shared(SUPER, 21.5, '2026-10-09', { mine: true })],
      [own('meu-atacadao', 24.9, '2026-10-05T15:00:00Z')],
      STORES,
    );
    expect(quotes).toEqual([]);
  });

  it('por g vira por kg, como nas outras telas', () => {
    const [quote] = sharedQuotes([shared(SUPER, 0.0499, '2026-10-09', { unit: 'g' })], [], STORES);
    expect(quote).toMatchObject({ unit: 'kg', unitPrice: 49.9, storeId: null });
  });
});

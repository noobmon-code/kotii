import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  barcodeLinkStep,
  gtinKey,
  gtinLabel,
  productNamed,
  readGtin,
  readTypedGtin,
  replaceBarcodeQuestion,
  RESTRICTED_GTIN8_FIRST,
  RESTRICTED_GTIN_PREFIXES,
  scannedListItem,
} from '../barcode';
import { productSuggestions } from '../genericItem';
import { normalizeSearch } from '../search';

const MIGRATION = join(__dirname, '../../../supabase/migrations/20261021150000_store_codes.sql');

/** O corpo da função gtin_key da migração, do create até o fim do $$. */
function sqlGtinKey(): string {
  const sql = readFileSync(MIGRATION, 'utf8');
  const start = sql.indexOf('create function public.gtin_key');
  expect(start).toBeGreaterThanOrEqual(0);
  return sql.slice(start, sql.indexOf('$$;', start));
}

describe('gtinKey', () => {
  // Os casos do bloco de gtin_key em scripts/db/test.sql, um por um.
  it('dá a mesma resposta que o banco nos casos do teste do banco', () => {
    expect(gtinKey('7891000100103')).toBe('07891000100103');
    expect(gtinKey('7891000100104')).toBeNull();
    expect(gtinKey('96385074')).toBe('00000096385074');
    expect(gtinKey('01234565')).toBeNull();
    expect(gtinKey('20000004')).toBeNull();
    expect(gtinKey('2000000000008')).toBeNull();
    expect(gtinKey('036000291452')).toBe('00036000291452');
    expect(gtinKey('212345678992')).toBeNull();
    expect(gtinKey('0212345678992')).toBeNull();
    expect(gtinKey('412345678996')).toBeNull();
    expect(gtinKey('9800000000007')).toBeNull();
    expect(gtinKey('9900000000004')).toBeNull();
    expect(gtinKey('17891000100100')).toBe('17891000100100');
    expect(gtinKey('97891000100106')).toBeNull();
    expect(gtinKey('07891000100103')).toBe('07891000100103');
    expect(gtinKey('789100010010A')).toBeNull();
    expect(gtinKey('ABC')).toBeNull();
    expect(gtinKey('250474')).toBeNull();
    expect(gtinKey('1234567890')).toBeNull();
    expect(gtinKey(null)).toBeNull();
    expect(gtinKey(undefined)).toBeNull();
    expect(gtinKey(' 7891000100103')).toBeNull();
  });

  it('a chave da chave é ela mesma', () => {
    for (const code of ['7891000100103', '96385074', '036000291452', '17891000100100']) {
      const key = gtinKey(code)!;
      expect(key).toMatch(/^\d{14}$/);
      expect(gtinKey(key)).toBe(key);
    }
  });

  it('diz se o código está errado ou é de uma faixa restrita', () => {
    expect(readGtin('7891000100104')).toEqual({ problem: 'invalid' });
    expect(readGtin('2000000000008')).toEqual({ problem: 'restricted' });
    expect(readGtin('7891000100103')).toEqual({ gtin: '07891000100103' });
  });

  it('as faixas excluídas e os tamanhos são os da função gtin_key da migração', () => {
    const body = sqlGtinKey();
    // Os começos que a função testa com like: tirando os dois que só dizem o tamanho (o GTIN-8, com seis zeros, e
    // o EAN-13, com um), são as faixas restritas.
    const prefixes = [...body.matchAll(/like '(\d+)%'/g)].map((m) => m[1]).filter((p) => p !== '000000' && p !== '0');
    expect([...prefixes].sort()).toEqual([...RESTRICTED_GTIN_PREFIXES].sort());
    const gtin8 = body.match(/substr\(g, 7, 1\) in \(([^)]*)\)/);
    expect(gtin8).not.toBeNull();
    expect([...gtin8![1].matchAll(/'(\d)'/g)].map((m) => m[1]).sort()).toEqual([...RESTRICTED_GTIN8_FIRST].sort());
    expect(body).toContain(`'^([0-9]{8}|[0-9]{12,14})$'`);
    expect(body).toContain("lpad(p, 14, '0')");
    // Cada faixa restrita, com o dígito verificador certo, fica de fora; o mesmo número fora dela vale.
    for (const prefix of RESTRICTED_GTIN_PREFIXES) {
      const body13 = (prefix + '7891000100').padEnd(13, '1').slice(0, 13);
      expect(gtinKey(withCheckDigit(body13))).toBeNull();
    }
  });

  it('o código digitado pode ter espaços, pontos e traços', () => {
    expect(readTypedGtin(' 789 1000 10010-3 ')).toEqual({ gtin: '07891000100103' });
    expect(readTypedGtin('7891000100104')).toEqual({ problem: 'invalid' });
    expect(readTypedGtin('')).toEqual({ problem: 'invalid' });
    expect(readTypedGtin('2000000000008')).toEqual({ problem: 'restricted' });
  });
});

/** Os 13 primeiros dígitos de um GTIN-14 e o verificador certo. */
function withCheckDigit(first13: string): string {
  let total = 0;
  for (let i = 0; i < 13; i++) total += Number(first13[i]) * (i % 2 === 0 ? 3 : 1);
  return first13 + ((10 - (total % 10)) % 10);
}

describe('gtinLabel', () => {
  it('mostra o código como está na embalagem', () => {
    expect(gtinLabel('07891000100103')).toBe('7891000100103');
    expect(gtinLabel('00036000291452')).toBe('036000291452');
    expect(gtinLabel('00000096385074')).toBe('96385074');
    expect(gtinLabel('17891000100100')).toBe('17891000100100');
  });
});

describe('ligar o código a um produto', () => {
  it('novo, já dele ou de outro (aí pergunta antes)', () => {
    expect(barcodeLinkStep('p1', null)).toEqual({ kind: 'new' });
    expect(barcodeLinkStep('p1', undefined)).toEqual({ kind: 'new' });
    expect(barcodeLinkStep('p1', 'p1')).toEqual({ kind: 'same' });
    expect(barcodeLinkStep('p1', 'p2')).toEqual({ kind: 'replace', from: 'p2' });
  });

  it('a pergunta diz o código, de quem ele é e para quem vai', () => {
    expect(replaceBarcodeQuestion('07891000100103', 'Leite Italac', 'Leite Piracanjuba')).toBe(
      'O código 7891000100103 está ligado a "Leite Italac". Passar para "Leite Piracanjuba"?',
    );
    expect(replaceBarcodeQuestion('07891000100103', null, 'Leite')).toBe('O código 7891000100103 está ligado a outro produto. Passar para "Leite"?');
  });

  it('o nome que já é de um produto da casa, como o banco compara', () => {
    const products = [{ id: 'a', name: 'Arroz Tio João 5kg' }, { id: 'b', name: 'Leite' }];
    expect(productNamed(products, '  arroz tio joão 5KG ')?.id).toBe('a');
    expect(productNamed(products, 'Leite desnatado')).toBeUndefined();
    expect(productNamed(products, '   ')).toBeUndefined();
  });
});

describe('o código lido na lista', () => {
  it('põe o mesmo item que a sugestão de produto da busca: sem a marca, com o produto', () => {
    for (const product of [
      { id: 'p1', name: 'Leite IL Desnatado', category: 'laticinios' },
      { id: 'p2', name: 'Café Pilão em Pó 500g', category: 'cafe_cha' },
      { id: 'p3', name: 'Ração Golden Adulto', category: 'pet' },
      { id: 'p4', name: 'Banana', category: 'hortifruti' },
    ]) {
      const [suggested] = productSuggestions([product], normalizeSearch(product.name), new Map());
      expect(scannedListItem(product)).toEqual({ product, name: suggested.name });
    }
    expect(scannedListItem({ id: 'p1', name: 'Leite IL Desnatado', category: 'laticinios' }).name).toBe('Leite desnatado');
  });
});

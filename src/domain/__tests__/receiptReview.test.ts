import { describe, expect, it } from '@jest/globals';
import { buildConfirmPayload, resolveItem, type CatalogProduct, type ReviewItem } from '../receiptReview';

const catalog = new Map<string, CatalogProduct>([
  ['p-arroz', { id: 'p-arroz', name: 'Arroz Tio João 5kg', category: 'graos', shelf_life_days: 30 }],
  ['p-deter', { id: 'p-deter', name: 'Detergente Ypê', category: 'limpeza', shelf_life_days: null }],
]);

const item = (patch: Partial<ReviewItem> = {}): ReviewItem => ({
  id: 'i1',
  raw_description: 'ARROZ T.JOAO 5KG',
  suggested_name: 'Arroz Tio João 5kg',
  suggested_category: 'graos',
  product_id: null,
  ...patch,
});

describe('resolveItem', () => {
  it('uses the known product and its learned shelf life', () => {
    const r = resolveItem(item({ product_id: 'p-arroz' }), undefined, catalog, '2026-09-20');
    expect(r).toMatchObject({
      product: { kind: 'existing', productId: 'p-arroz' },
      productName: 'Arroz Tio João 5kg',
      category: 'graos',
      pantry: true,
      expiresOn: '2026-10-20',
      expirySource: 'produto',
    });
  });

  it('proposes a new product from the AI suggestion with category default expiry', () => {
    const r = resolveItem(item(), undefined, catalog, '2026-09-20');
    expect(r.product).toEqual({ kind: 'new', name: 'Arroz Tio João 5kg', category: 'graos' });
    expect(r).toMatchObject({ pantry: true, expiresOn: '2027-03-19', expirySource: 'categoria' });
  });

  it('ignores a product id that is not in the catalog', () => {
    expect(resolveItem(item({ product_id: 'gone' }), undefined, catalog, '2026-09-20').product.kind).toBe('new');
  });

  // The product picked in the review was joined into another one on another phone: its id is gone.
  it('ignores a chosen product that is not in the catalog and falls back to the line', () => {
    const stale = { product: { kind: 'existing' as const, productId: 'gone' }, pantry: false };
    expect(resolveItem(item({ product_id: 'p-arroz' }), stale, catalog, '2026-09-20')).toMatchObject({
      product: { kind: 'existing', productId: 'p-arroz' },
      productName: 'Arroz Tio João 5kg',
      // The rest of what the person changed still counts.
      pantry: false,
    });
    expect(resolveItem(item(), stale, catalog, '2026-09-20').product).toEqual({ kind: 'new', name: 'Arroz Tio João 5kg', category: 'graos' });
    expect(resolveItem(item({ product_id: 'gone' }), stale, catalog, '2026-09-20').product.kind).toBe('new');
  });

  it('keeps the other choices as they are: a new product, no product, a product in the catalog', () => {
    const chosen = (product: NonNullable<Parameters<typeof resolveItem>[1]>['product']) =>
      resolveItem(item({ product_id: 'p-arroz' }), { product }, catalog, '2026-09-20').product;
    expect(chosen({ kind: 'new', name: 'Arroz', category: 'graos' })).toEqual({ kind: 'new', name: 'Arroz', category: 'graos' });
    expect(chosen({ kind: 'none' })).toEqual({ kind: 'none' });
    expect(chosen({ kind: 'existing', productId: 'p-deter' })).toEqual({ kind: 'existing', productId: 'p-deter' });
  });

  it('recomputes pantry default when the user switches product', () => {
    const r = resolveItem(item(), { product: { kind: 'existing', productId: 'p-deter' } }, catalog, '2026-09-20');
    expect(r).toMatchObject({ category: 'limpeza', pantry: false, expiresOn: null });
  });

  it('keeps a manual expiry', () => {
    const r = resolveItem(item(), { expiryManual: true, expiresOn: '2026-12-01' }, catalog, '2026-09-20');
    expect(r).toMatchObject({ expiresOn: '2026-12-01', expirySource: 'manual' });
  });
});

describe('buildConfirmPayload', () => {
  it('never sends a product id that is not in the catalog', () => {
    const items = [item({ id: 'a', product_id: 'p-arroz' }), item({ id: 'b', product_id: 'gone' }), item({ id: 'c' })];
    const stale = { product: { kind: 'existing' as const, productId: 'gone' } };
    const payload = buildConfirmPayload(items, { a: stale, b: stale, c: stale }, catalog, '2026-09-20');
    expect(payload.map((entry) => [entry.id, entry.product_id, entry.new_product?.name])).toEqual([
      ['a', 'p-arroz', undefined],
      ['b', undefined, 'Arroz Tio João 5kg'],
      ['c', undefined, 'Arroz Tio João 5kg'],
    ]);
  });

  it('builds the RPC payload', () => {
    const items = [
      item({ id: 'a', product_id: 'p-arroz' }),
      item({ id: 'b', raw_description: 'DETERG YPE', suggested_name: 'Detergente Ypê', suggested_category: 'limpeza' }),
      item({ id: 'c', raw_description: 'SACOLA', suggested_name: 'Sacola', suggested_category: 'outros' }),
    ];
    const payload = buildConfirmPayload(items, { c: { product: { kind: 'none' } } }, catalog, '2026-09-20');
    expect(payload).toEqual([
      {
        id: 'a',
        product_id: 'p-arroz',
        pantry: {
          name: 'Arroz Tio João 5kg',
          category: 'graos',
          purchased_on: '2026-09-20',
          expires_on: '2026-10-20',
          expiry_source: 'produto',
        },
      },
      { id: 'b', new_product: { name: 'Detergente Ypê', category: 'limpeza' } },
      { id: 'c' },
    ]);
  });
});

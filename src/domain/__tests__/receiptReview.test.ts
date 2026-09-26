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

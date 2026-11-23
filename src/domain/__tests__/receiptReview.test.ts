import { describe, expect, it } from '@jest/globals';
import { DEFAULT_FREEZE_DAYS } from '../freezer';
import {
  allArrived,
  buildConfirmPayload,
  confirmBlock,
  GONE_CHOICE_HINT,
  goneProducts,
  pantryChoiceLabel,
  pantryEntry,
  pantryPayload,
  receiptExpiryHint,
  receiptFreezeKind,
  REFRESH_FAILED_NOTICE,
  resolveItem,
  toggleFrozen,
  type CatalogProduct,
  type ItemOverride,
  type ReviewItem,
} from '../receiptReview';

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

describe('produto que sumiu do catálogo com a revisão aberta (foi juntado com outro em outro aparelho)', () => {
  const picked = (productId: string) => ({ product: { kind: 'existing' as const, productId } });

  it('separa a escolha que sumiu do produto do próprio item que sumiu', () => {
    const items = [
      item({ id: 'a' }),
      item({ id: 'b', product_id: 'p-arroz' }),
      item({ id: 'c', product_id: 'gone' }),
      item({ id: 'd', product_id: 'gone' }),
      item({ id: 'e', product_id: 'p-arroz' }),
      item({ id: 'f' }),
    ];
    const overrides = {
      // Escolheu um produto que foi juntado: a escolha tem de ser refeita.
      a: picked('gone'),
      // Escolheu outro que existe por cima de um item cujo produto sumiu: nada a fazer.
      d: picked('p-deter'),
      // Escolheu um que sumiu por cima de um item que tinha produto: também é escolha a refazer.
      e: picked('gone'),
      // Produto novo: escolha da pessoa que não depende do catálogo.
      f: { product: { kind: 'new' as const, name: 'Arroz', category: 'graos' } },
    };
    expect(goneProducts(items, overrides, catalog)).toEqual({ chosen: ['a', 'e'], own: ['c:gone'] });
    expect(goneProducts(items, { ...overrides, a: { product: { kind: 'none' as const } }, e: picked('p-arroz') }, catalog)).toEqual({ chosen: [], own: ['c:gone'] });
    // Só o que não é produto (despensa, validade) mudado num item: o produto do item continua valendo.
    expect(goneProducts([item({ id: 'c', product_id: 'gone' })], { c: { pantry: false } }, catalog)).toEqual({ chosen: [], own: ['c:gone'] });
    // O mesmo item, depois, com o produto que ficou também juntado com outro: é outro par.
    expect(goneProducts([item({ id: 'c', product_id: 'gone-too' })], {}, catalog)).toEqual({ chosen: [], own: ['c:gone-too'] });
    expect(goneProducts([], {}, catalog)).toEqual({ chosen: [], own: [] });
  });

  it('a escolha que sumiu impede a confirmação até ser refeita, com a frase no singular e no plural', () => {
    expect(confirmBlock({ chosen: ['a'], own: [] }, [])).toEqual({
      kind: 'choose',
      title: 'Escolha o produto de novo',
      message: 'O produto escolhido para um item desta nota foi juntado com outro ou excluído em outro aparelho. Escolha de novo o produto desse item.',
    });
    expect(confirmBlock({ chosen: ['a', 'e'], own: ['c:gone'] }, ['c:gone'])).toEqual({
      kind: 'choose',
      title: 'Escolha o produto de novo',
      message: 'Os produtos escolhidos para 2 itens desta nota foram juntados com outros ou excluídos em outro aparelho. Escolha de novo o produto desses itens.',
    });
  });

  it('no item, a escolha que sumiu diz que o produto foi juntado ou excluído', () => {
    expect(GONE_CHOICE_HINT).toBe('O produto escolhido foi juntado com outro ou excluído. Escolha de novo.');
  });

  it('o produto do próprio item fora do catálogo pede uma busca nova, e impede até as duas buscas chegarem', () => {
    const refresh = {
      kind: 'refresh',
      title: 'Produtos atualizados',
      message: 'Um produto desta nota mudou em outro aparelho. Confira os itens e confirme de novo.',
    };
    expect(confirmBlock({ chosen: [], own: ['c:gone'] }, [])).toEqual(refresh);
    // A busca falhou (a tela não guarda o par): continua impedindo, quantas vezes a pessoa tentar.
    expect(confirmBlock({ chosen: [], own: ['c:gone'] }, [])).toEqual(refresh);
    // As duas buscas chegaram e ele continua fora: segue como produto novo, como sempre foi com o catálogo atrasado.
    expect(confirmBlock({ chosen: [], own: ['c:gone'] }, ['c:gone'])).toBeNull();
    // Outro item some depois (outra junção): pede a busca de novo.
    expect(confirmBlock({ chosen: [], own: ['c:gone', 'g:gone'] }, ['c:gone'])).toEqual(refresh);
    expect(confirmBlock({ chosen: [], own: ['c:gone', 'g:gone'] }, ['c:gone', 'g:gone'])).toBeNull();
    // O MESMO item some de novo: depois da primeira busca ele passou para o produto B, e B foi juntado com C.
    // A busca já feita valia para o produto de antes, não para este.
    expect(confirmBlock({ chosen: [], own: ['c:b'] }, ['c:gone'])).toEqual(refresh);
    expect(confirmBlock({ chosen: [], own: ['c:b'] }, ['c:gone', 'c:b'])).toBeNull();
    expect(confirmBlock({ chosen: [], own: [] }, [])).toBeNull();
    expect(REFRESH_FAILED_NOTICE).toEqual({
      title: 'Não deu para atualizar',
      message: 'Um produto desta nota mudou em outro aparelho, e não deu para buscar os produtos e a nota de novo. Confira a internet e confirme outra vez.',
    });
  });
});

describe('as buscas novas dos produtos e da nota', () => {
  const ok = async () => ({ isSuccess: true });
  // A busca que falha com o dado de antes guardado responde, sem dar erro, dizendo que não deu certo.
  const kept = async () => ({ isSuccess: false });
  const broken = async (): Promise<{ isSuccess: boolean }> => {
    throw new Error('sem rede');
  };

  it('só chegaram quando as duas deram certo', async () => {
    expect(await allArrived([ok, ok])).toBe(true);
    // A da nota chegou e a dos produtos não: o catálogo pode continuar sem o produto.
    expect(await allArrived([kept, ok])).toBe(false);
    expect(await allArrived([ok, kept])).toBe(false);
    expect(await allArrived([broken, ok])).toBe(false);
    expect(await allArrived([ok, broken])).toBe(false);
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

describe('"Congelou?" na revisão da nota', () => {
  const freezer = DEFAULT_FREEZE_DAYS;
  const meat = new Map<string, CatalogProduct>([
    ['p-frango', { id: 'p-frango', name: 'Coxa de frango', category: 'carnes', shelf_life_days: null }],
    ['p-pao', { id: 'p-pao', name: 'Pão francês', category: 'padaria', shelf_life_days: null }],
  ]);
  const frango = item({ id: 'f', raw_description: 'COXA FRANGO KG', suggested_name: 'Coxa de frango', suggested_category: 'carnes', product_id: 'p-frango', unit: 'kg' });
  const tilapia = item({ id: 't', raw_description: 'FILE TILAPIA CONG', suggested_name: 'Filé de tilápia', suggested_category: 'peixes', unit: 'un' });

  it('pergunta em carnes e peixes; marcada, a validade é a do congelador e a de antes é a estimada', () => {
    const asked = resolveItem(frango, undefined, meat, '2026-11-10', freezer);
    expect(asked).toMatchObject({ freezeKind: 'frango', frozen: false, expiresOn: '2026-11-13', expirySource: 'categoria' });
    const frozen = resolveItem(frango, toggleFrozen(undefined, true), meat, '2026-11-10', freezer);
    expect(frozen).toMatchObject({
      frozen: true,
      expiresOn: '2027-02-08',
      expirySource: 'congelado',
      freshExpiresOn: '2026-11-13',
      freshExpirySource: 'categoria',
    });
    expect(receiptExpiryHint(frozen, freezer)).toBe('Validade estimada no congelador (frango: 90 dias) — ajuste se quiser.');
  });

  it('a data digitada antes de marcar vira a de antes (manual); desmarcar a devolve', () => {
    const typed: ItemOverride = { expiryManual: true, expiresOn: '2026-11-15' };
    const on = toggleFrozen(typed, true);
    expect(on).toEqual({ frozen: true, freshExpiresOn: '2026-11-15', freshManual: true, expiryManual: false, expiresOn: undefined });
    expect(resolveItem(frango, on, meat, '2026-11-10', freezer)).toMatchObject({
      expiresOn: '2027-02-08',
      expirySource: 'congelado',
      freshExpiresOn: '2026-11-15',
      freshExpirySource: 'manual',
    });
    const off = toggleFrozen(on, false);
    expect(off).toEqual({ frozen: false, expiresOn: '2026-11-15', expiryManual: true, freshExpiresOn: undefined, freshManual: undefined });
    expect(resolveItem(frango, off, meat, '2026-11-10', freezer)).toMatchObject({ frozen: false, expiresOn: '2026-11-15', expirySource: 'manual' });
  });

  it('a data digitada com "Congelei" marcado é a do congelador (manual), e sai ao desmarcar', () => {
    const on = { ...toggleFrozen(undefined, true), expiryManual: true, expiresOn: '2027-01-01' };
    const resolved = resolveItem(frango, on, meat, '2026-11-10', freezer);
    expect(resolved).toMatchObject({ frozen: true, expiresOn: '2027-01-01', expirySource: 'manual', freshExpiresOn: '2026-11-13' });
    expect(receiptExpiryHint(resolved, freezer)).toBeNull();
    const [payload] = buildConfirmPayload([frango], { f: on }, meat, '2026-11-10', freezer);
    expect(payload.pantry).toEqual({
      name: 'Coxa de frango',
      category: 'carnes',
      purchased_on: '2026-11-10',
      expires_on: '2027-01-01',
      expiry_source: 'manual',
      frozen_on: '2026-11-10',
      freeze_kind: 'frango',
      fresh_expires_on: '2026-11-13',
      fresh_expiry_source: 'categoria',
    });
    expect(resolveItem(frango, toggleFrozen(on, false), meat, '2026-11-10', freezer)).toMatchObject({
      frozen: false,
      expiresOn: '2026-11-13',
      expirySource: 'categoria',
    });
  });

  it('"CONG" no nome começa marcado, e a pessoa pode desmarcar', () => {
    expect(resolveItem(tilapia, undefined, meat, '2026-11-10', freezer)).toMatchObject({ freezeKind: 'peixe', frozen: true, expirySource: 'congelado' });
    expect(resolveItem(tilapia, toggleFrozen(undefined, false), meat, '2026-11-10', freezer).frozen).toBe(false);
  });

  it('sem o congelador no banco nada é congelado, e o payload é o de antes (também na linha "CONG")', () => {
    const payload = buildConfirmPayload([frango, tilapia], { f: toggleFrozen(undefined, true) }, meat, '2026-11-10', null);
    expect(JSON.stringify(payload)).toBe(
      JSON.stringify([
        {
          id: 'f',
          product_id: 'p-frango',
          pantry: { name: 'Coxa de frango', category: 'carnes', purchased_on: '2026-11-10', expires_on: '2026-11-13', expiry_source: 'categoria' },
        },
        {
          id: 't',
          new_product: { name: 'Filé de tilápia', category: 'peixes' },
          pantry: { name: 'Filé de tilápia', category: 'peixes', purchased_on: '2026-11-10', expires_on: '2026-11-12', expiry_source: 'categoria' },
        },
      ]),
    );
    expect(resolveItem(tilapia, undefined, meat, '2026-11-10', null)).toMatchObject({ freezeKind: null, frozen: false });
  });

  it('sem despensa ou sem produto não pergunta; pão e frios comprados como frios também não; linguiça no açougue sim', () => {
    expect(resolveItem(frango, { pantry: false, frozen: true }, meat, '2026-11-10', freezer)).toMatchObject({ freezeKind: null, frozen: false });
    expect(resolveItem(frango, { product: { kind: 'none' }, frozen: true }, meat, '2026-11-10', freezer).freezeKind).toBeNull();
    const [payload] = buildConfirmPayload([frango], { f: { pantry: false, frozen: true } }, meat, '2026-11-10', freezer);
    expect(payload.pantry).toBeUndefined();
    const pao = item({ id: 'p', raw_description: 'PAO FRANCES KG', suggested_name: 'Pão francês', suggested_category: 'padaria', product_id: 'p-pao' });
    expect(resolveItem(pao, undefined, meat, '2026-11-10', freezer).freezeKind).toBeNull();
    const salsicha = item({ id: 's', raw_description: 'SALSICHA HOT DOG', suggested_name: 'Salsicha', suggested_category: 'frios' });
    expect(resolveItem(salsicha, undefined, meat, '2026-11-10', freezer).freezeKind).toBeNull();
    const linguica = item({ id: 'l', raw_description: 'LINGUICA TOSCANA', suggested_name: 'Linguiça toscana', suggested_category: 'carnes' });
    expect(resolveItem(linguica, undefined, meat, '2026-11-10', freezer).freezeKind).toBe('frios');
  });

  it('o texto embaixo da validade diz de onde ela veio', () => {
    expect(receiptExpiryHint(resolveItem(item({ product_id: 'p-arroz' }), undefined, catalog, '2026-09-20'), null)).toBe(
      'Validade que o produto aprendeu — ajuste se quiser.',
    );
    expect(receiptExpiryHint(resolveItem(item(), undefined, catalog, '2026-09-20'), null)).toBe('Validade estimada pela categoria — ajuste se quiser.');
    expect(receiptExpiryHint(resolveItem(item(), { expiryManual: true, expiresOn: '2027-01-01' }, catalog, '2026-09-20'), null)).toBeNull();
    expect(receiptExpiryHint(resolveItem(item(), { pantry: false }, catalog, '2026-09-20'), null)).toBeNull();
    expect(pantryChoiceLabel(true)).toBe('Vai para a despensa');
    expect(pantryChoiceLabel(false)).toBe('Não vai para a despensa');
  });

  it('a linha incluída depois numa nota confirmada usa as mesmas regras (pantryEntry, pantryPayload)', () => {
    const freezeKind = receiptFreezeKind(['Coxa de frango', 'COXA FRANGO KG'], 'carnes', 'kg', freezer);
    expect(freezeKind).toBe('frango');
    expect(receiptFreezeKind(['Coxa de frango'], 'carnes', 'kg', null)).toBeNull();
    const entry = pantryEntry({ category: 'carnes', purchasedOn: '2026-11-10', freezeKind, names: ['COXA FRANGO KG'], override: { frozen: true }, freezer });
    expect(pantryPayload({ ...entry, freezeKind }, { name: 'Coxa de frango', category: 'carnes', purchasedOn: '2026-11-10' })).toEqual({
      name: 'Coxa de frango',
      category: 'carnes',
      purchased_on: '2026-11-10',
      expires_on: '2027-02-08',
      expiry_source: 'congelado',
      frozen_on: '2026-11-10',
      freeze_kind: 'frango',
      fresh_expires_on: '2026-11-13',
      fresh_expiry_source: 'categoria',
    });
  });
});

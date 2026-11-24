import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import path from 'path';

import { CATEGORIES } from '../categories';
import { COMMON_ITEMS } from '../commonItems';
import { addDays } from '../dates';
import { DEFAULT_FREEZE_DAYS, FREEZE_KINDS } from '../freezer';
import { asksPackCount } from '../packCount';
import { estimateExpiry } from '../pantry';
import { PRODUCT_MERGED_AWAY } from '../productMerge';
import {
  ADD_ITEM_ACCESSIBILITY,
  ADD_ITEM_INTRO,
  ADD_ITEM_NEEDS_VALUE,
  ADD_ITEM_PICKER_TITLE,
  ADD_ITEM_SAVE,
  ADD_ITEM_TITLE,
  addedItemPantry,
  addedItemPantryDefault,
  addedItemRequest,
  addedProduct,
  ADDED_BEFORE,
  addItemPickerMessage,
  addItemProductLine,
  addItemSummary,
  CATEGORY_SHELF_LIFE_DAYS,
  CHANGE_ADDED_PRODUCT_MESSAGE,
  CHANGE_PRODUCT_LABEL,
  CHANGE_PRODUCT_MESSAGE,
  CHANGE_PRODUCT_TITLE,
  changedFreezeKind,
  changeProductButton,
  changeProductMessage,
  CHOOSE_PRODUCT_LABEL,
  CORRECTION_CODES,
  CORRECTION_NOT_FOUND,
  CORRECTION_STALE,
  correctionActions,
  correctionCatchUp,
  correctionCurrent,
  correctionNameChoice,
  correctionNotice,
  correctionOffline,
  newProductActionTitle,
  newProductCategory,
  NO_NOTE_NAMES,
  PRODUCT_SAVED_NOT_SHOWN,
  productCorrection,
  suggestionSubtitle,
  type AddedProduct,
  type CorrectionRefusal,
} from '../receiptCorrection';
import { RECEIPT_GONE } from '../receiptEdit';
import { pantryChoiceLabel, type CatalogProduct } from '../receiptReview';
import { indexNames, nameCandidates } from '../similarNames';

const MIGRATION = readFileSync(
  path.join(__dirname, '../../../supabase/migrations/20261122120000_confirmed_receipt_items.sql'),
  'utf8',
);

const catalog = new Map<string, CatalogProduct>([
  ['p1', { id: 'p1', name: 'Feijão carioca', category: 'graos', shelf_life_days: null }],
  ['p2', { id: 'p2', name: 'Arroz', category: 'graos', shelf_life_days: null }],
  ['p3', { id: 'p3', name: 'Leite Ninho', category: 'laticinios', shelf_life_days: 30 }],
  ['p4', { id: 'p4', name: 'Detergente', category: 'limpeza', shelf_life_days: null }],
  ['p5', { id: 'p5', name: 'Carne moída', category: 'carnes', shelf_life_days: null }],
]);
const existing = (id: string): AddedProduct => {
  const product = catalog.get(id)!;
  return { kind: 'existing', productId: id, name: product.name, category: product.category, shelfLifeDays: product.shelf_life_days };
};
const values = (patch: Partial<{ raw_description: string; quantity: number; unit: 'un' | 'kg'; unit_price: number; total_price: number }> = {}) => ({
  raw_description: 'Feijão carioca',
  quantity: 2,
  unit: 'un' as const,
  unit_price: 7.9,
  total_price: 15.8,
  ...patch,
});
const DAY = '2026-06-10';

describe('as validades padrão que o app manda ao banco', () => {
  it('têm toda categoria do app, com os dias dela (null: sem padrão)', () => {
    expect(Object.keys(CATEGORY_SHELF_LIFE_DAYS).sort()).toEqual(CATEGORIES.map((c) => c.key).sort());
    for (const category of CATEGORIES) expect(CATEGORY_SHELF_LIFE_DAYS[category.key]).toBe(category.shelfLifeDays);
  });

  it('são a regra do app: o banco refaz a validade estimada como estimateExpiry', () => {
    for (const category of CATEGORIES) {
      const days = CATEGORY_SHELF_LIFE_DAYS[category.key];
      expect(estimateExpiry({ purchasedOn: DAY, category: category.key }).expiresOn).toBe(days == null ? null : addDays(DAY, days));
      // O que o banco aceita do mapa (1 a 3650 dias) cobre toda categoria que tem padrão.
      if (days != null) expect(days >= 1 && days <= 3650 && Number.isInteger(days)).toBe(true);
    }
  });
});

describe('a categoria do produto novo criado na nota confirmada', () => {
  it('é a do nome', () => {
    expect(newProductCategory('Leite integral')).toBe('laticinios');
    expect(newProductCategory('Detergente', { suggested_category: 'graos', raw_description: 'ARROZ' })).toBe('limpeza');
  });

  it('sem nome que diga, a sugerida da linha; depois a descrição abreviada da nota; senão "outros"', () => {
    expect(newProductCategory('Coisa da Ana', { suggested_category: 'padaria', raw_description: 'XYZ' })).toBe('padaria');
    expect(newProductCategory('Coisa da Ana', { suggested_category: null, raw_description: 'DETERG YPE 500ML' })).toBe('limpeza');
    expect(newProductCategory('Coisa da Ana', { suggested_category: null, raw_description: 'XYZ 123' })).toBe('outros');
    expect(newProductCategory('Coisa da Ana')).toBe('outros');
  });

  it('nunca a do produto de antes: a linha de arroz confirmada como feijão, trocada para "Leite", é laticínio', () => {
    expect(correctionCurrent('Leite', { suggested_category: 'graos', raw_description: 'ARROZ TJ 5KG' })).toEqual({ category: 'laticinios' });
  });

  it('o botão de criar e o subtítulo do nome sem produto dizem a categoria', () => {
    expect(newProductActionTitle('Novo produto "Leite"', 'laticinios')).toBe('Novo produto "Leite" (Laticínios)');
    expect(newProductActionTitle('Criar "Leite" mesmo assim', 'laticinios')).toBe('Criar "Leite" mesmo assim (Laticínios)');
    expect(suggestionSubtitle('Está na lista de compras', 'laticinios')).toBe('Está na lista de compras · Laticínios');
  });
});

describe('os botões e os nomes parecidos do seletor na nota confirmada', () => {
  const house = indexNames(
    nameCandidates({
      products: [...catalog.values()],
      listItems: [{ id: 'l1', list_id: 'x', name: 'Banana nanica', category: 'outros', product_id: null } as never],
      purchases: [],
      common: COMMON_ITEMS,
    }),
  );
  const line = { suggested_category: 'graos', raw_description: 'ARROZ TJ 5KG' };

  it('criar: a categoria do nome digitado, dita no botão e na escolha que vai', () => {
    const { existing, create } = correctionActions('Pão de milho caseiro', house, line, catalog);
    expect(existing).toBeNull();
    expect(create).toEqual({
      title: 'Novo produto "Pão de milho caseiro" (Padaria)',
      choice: { kind: 'new', name: 'Pão de milho caseiro', category: 'padaria' },
    });
  });

  it('"Usar" o nome da lista com outra grafia: o nome em "Outros" fica com a categoria do nome, não a do produto de antes', () => {
    const { existing, create } = correctionActions('Bananas nanicas', house, line, catalog);
    expect(existing).toEqual({ label: 'Usar "Banana nanica" (já existe)', choice: { kind: 'new', name: 'Banana nanica', category: 'hortifruti' } });
    expect(create!.title).toBe('Criar "Bananas nanicas" mesmo assim (Frutas e verduras)');
  });

  it('o nome de um produto da casa é ele: "Usar" o produto, e nada a criar', () => {
    expect(correctionActions('arroz', house, line, catalog)).toEqual({
      existing: { label: 'Usar "Arroz" (já existe)', choice: { kind: 'existing', productId: 'p2' } },
      create: null,
    });
    expect(correctionNameChoice({ name: 'Arroz', category: 'graos', productId: 'p2' }, line, catalog)).toEqual({ kind: 'existing', productId: 'p2' });
  });

  it('em branco, nada; e o índice da nota é vazio (não há nomes dados nesta revisão)', () => {
    expect(correctionActions('  ', house, line, catalog)).toEqual({ existing: null, create: null });
    expect(NO_NOTE_NAMES.byKey.size).toBe(0);
  });
});

describe('o que a escolha no seletor faz na linha (Trocar produto)', () => {
  const line = { product_id: 'p1', unit: 'un' };

  it('o mesmo produto, none e nome em branco: nada', () => {
    expect(productCorrection(line, { kind: 'existing', productId: 'p1' }, catalog)).toEqual({ kind: 'nothing' });
    expect(productCorrection(line, { kind: 'none' }, catalog)).toEqual({ kind: 'nothing' });
    expect(productCorrection(line, { kind: 'new', name: '   ', category: 'graos' }, catalog)).toEqual({ kind: 'nothing' });
  });

  it('outro produto, também numa linha sem produto', () => {
    expect(productCorrection(line, { kind: 'existing', productId: 'p2' }, catalog)).toEqual({
      kind: 'write',
      target: { productId: 'p2' },
      freezeKind: null,
    });
    expect(productCorrection({ product_id: null }, { kind: 'existing', productId: 'p4' }, catalog)).toEqual({
      kind: 'write',
      target: { productId: 'p4' },
      freezeKind: null,
    });
  });

  it('um nome novo, aparado, com a categoria da escolha', () => {
    expect(productCorrection(line, { kind: 'new', name: '  Leite  ', category: 'laticinios' }, catalog)).toEqual({
      kind: 'write',
      target: { newProduct: { name: 'Leite', category: 'laticinios' } },
      freezeKind: null,
    });
  });

  it('o produto que saiu do catálogo entre o desenho e o toque', () => {
    expect(productCorrection(line, { kind: 'existing', productId: 'sumiu' }, catalog)).toEqual({ kind: 'gone' });
  });

  it('o tipo do congelador do produto escolhido vai junto (a compra no congelador passa a ele); null deixa o de antes', () => {
    expect(productCorrection({ product_id: 'p2', unit: 'kg' }, { kind: 'existing', productId: 'p5' }, catalog)).toMatchObject({ freezeKind: 'carne_moida' });
    expect(changedFreezeKind({ name: 'Frango inteiro', category: 'carnes' }, 'kg')).toBe('frango');
    expect(changedFreezeKind({ name: 'Detergente', category: 'limpeza' }, 'un')).toBeNull();
    // O tipo que vai é um dos que o banco aceita.
    expect(MIGRATION).toContain(`not in (${FREEZE_KINDS.map((k) => `'${k.key}'`).join(', ')})`);
  });
});

describe('o produto do item que faltou', () => {
  it('nada, sumiu, o da casa (com a validade aprendida) e o novo', () => {
    expect(addedProduct({ kind: 'none' }, catalog)).toEqual({ kind: 'nothing' });
    expect(addedProduct({ kind: 'new', name: ' ', category: 'outros' }, catalog)).toEqual({ kind: 'nothing' });
    expect(addedProduct({ kind: 'existing', productId: 'sumiu' }, catalog)).toEqual({ kind: 'gone' });
    expect(addedProduct({ kind: 'existing', productId: 'p3' }, catalog)).toEqual({
      kind: 'ok',
      product: { kind: 'existing', productId: 'p3', name: 'Leite Ninho', category: 'laticinios', shelfLifeDays: 30 },
    });
    expect(addedProduct({ kind: 'new', name: ' Esponja ', category: 'limpeza' }, catalog)).toEqual({
      kind: 'ok',
      product: { kind: 'new', name: 'Esponja', category: 'limpeza' },
    });
  });

  it('a despensa começa no padrão da categoria, como na revisão, e o chip tem as palavras dela', () => {
    expect(addedItemPantryDefault(existing('p3'))).toBe(true);
    expect(addedItemPantryDefault(existing('p4'))).toBe(false);
    expect(pantryChoiceLabel(true)).toBe('Vai para a despensa');
    expect(pantryChoiceLabel(false)).toBe('Não vai para a despensa');
  });

  it('a linha do produto no formulário', () => {
    expect(addItemProductLine(existing('p1'))).toBe('Produto: Feijão carioca (Grãos, massas e cereais)');
    expect(addItemProductLine({ kind: 'new', name: 'Detergente', category: 'limpeza' })).toBe('Produto novo: Detergente (Limpeza)');
  });
});

describe('o pedido do item que faltou (add_confirmed_receipt_item)', () => {
  it('o produto da casa vai pelo id, com a despensa estimada pela categoria e o dia da compra da nota', () => {
    expect(
      addedItemRequest({ id: 'i1', values: values(), product: existing('p1'), choice: { pantry: true }, purchasedOn: DAY, freezer: null }),
    ).toEqual({
      id: 'i1',
      raw_description: 'Feijão carioca',
      quantity: 2,
      unit: 'un',
      unit_price: 7.9,
      total_price: 15.8,
      product_id: 'p1',
      pantry: { name: 'Feijão carioca', category: 'graos', purchased_on: DAY, expires_on: '2026-12-07', expiry_source: 'categoria' },
    });
  });

  it('o produto novo vai pelo nome e a categoria; sem a despensa, a chave não vai', () => {
    const request = addedItemRequest({
      id: 'i2',
      values: values({ raw_description: '  ESPONJA 3M  ', quantity: 1, unit_price: 4.5, total_price: 4.5 }),
      product: { kind: 'new', name: 'Esponja', category: 'limpeza' },
      choice: { pantry: false },
      purchasedOn: DAY,
      freezer: null,
    });
    expect(request).toEqual({
      id: 'i2',
      raw_description: 'ESPONJA 3M',
      quantity: 1,
      unit: 'un',
      unit_price: 4.5,
      total_price: 4.5,
      new_product: { name: 'Esponja', category: 'limpeza' },
    });
    expect(request).not.toHaveProperty('pantry');
  });

  it('a validade aprendida do produto dá "produto"; a categoria sem padrão, nenhuma', () => {
    expect(
      addedItemRequest({ id: 'i3', values: values(), product: existing('p3'), choice: { pantry: true }, purchasedOn: DAY, freezer: null }).pantry,
    ).toMatchObject({ expires_on: '2026-07-10', expiry_source: 'produto' });
    expect(
      addedItemRequest({ id: 'i4', values: values(), product: existing('p4'), choice: { pantry: true }, purchasedOn: DAY, freezer: null }).pantry,
    ).toMatchObject({ expires_on: null, expiry_source: null });
  });

  it('carne com o congelador no banco: pergunta "Congelou?", e "Congelei" leva o dia da compra, o tipo e a validade de antes', () => {
    const product = existing('p5');
    const kg = values({ raw_description: 'Carne moída', unit: 'kg', quantity: 1, unit_price: 40, total_price: 40 });
    expect(addedItemPantry({ product, description: kg.raw_description, unit: 'kg', choice: { pantry: true }, purchasedOn: DAY, freezer: DEFAULT_FREEZE_DAYS })).toMatchObject({
      pantry: true,
      freezeKind: 'carne_moida',
      frozen: false,
      expiresOn: '2026-06-13',
    });
    const frozen = addedItemRequest({ id: 'i5', values: kg, product, choice: { pantry: true, frozen: true }, purchasedOn: DAY, freezer: DEFAULT_FREEZE_DAYS });
    expect(frozen.pantry).toEqual({
      name: 'Carne moída',
      category: 'carnes',
      purchased_on: DAY,
      expires_on: addDays(DAY, DEFAULT_FREEZE_DAYS.carne_moida),
      expiry_source: 'congelado',
      frozen_on: DAY,
      freeze_kind: 'carne_moida',
      fresh_expires_on: '2026-06-13',
      fresh_expiry_source: 'categoria',
    });
    // Sem o congelador no banco, nada pergunta e nada vai congelado.
    expect(addedItemPantry({ product, description: kg.raw_description, unit: 'kg', choice: { pantry: true, frozen: true }, purchasedOn: DAY, freezer: null })).toMatchObject({
      freezeKind: null,
      frozen: false,
    });
    // Fora da despensa, também não.
    expect(addedItemPantry({ product, description: kg.raw_description, unit: 'kg', choice: { pantry: false }, purchasedOn: DAY, freezer: DEFAULT_FREEZE_DAYS }).freezeKind).toBeNull();
  });

  it('o nome que diz "congelado" já começa com "Congelei", como na revisão', () => {
    const product = existing('p5');
    expect(
      addedItemPantry({ product, description: 'CARNE MOIDA CONGELADA', unit: 'kg', choice: { pantry: true }, purchasedOn: DAY, freezer: DEFAULT_FREEZE_DAYS }).frozen,
    ).toBe(true);
  });
});

describe('a pergunta antes de incluir', () => {
  const request = (pantry: boolean, frozen = false) =>
    addedItemRequest({
      id: 'i1',
      values: values(),
      product: frozen ? existing('p5') : existing('p1'),
      choice: { pantry, frozen },
      purchasedOn: DAY,
      freezer: frozen ? DEFAULT_FREEZE_DAYS : null,
    });

  it('com a despensa', () => {
    expect(addItemSummary(request(true), 'Feijão carioca')).toEqual({
      title: 'Incluir este item?',
      message:
        'Feijão carioca: 2 un, R$ 15,80, e vai para a despensa. Depois de incluído, a quantidade e o valor não mudam mais, e o item só sai da nota excluindo a nota inteira.',
      confirmLabel: 'Incluir',
      cancelLabel: 'Voltar',
    });
  });

  it('sem a despensa, e no congelador', () => {
    expect(addItemSummary(request(false), 'Feijão carioca').message).toBe(
      'Feijão carioca: 2 un, R$ 15,80. Depois de incluído, a quantidade e o valor não mudam mais, e o item só sai da nota excluindo a nota inteira.',
    );
    expect(addItemSummary(request(true, true), 'Carne moída').message).toMatch(/^Carne moída: 2 un, R\$ 15,80, e vai para o congelador\./);
  });
});

describe('as frases', () => {
  it('o chip de cada item', () => {
    expect(changeProductButton('Feijão', true)).toEqual({ title: CHANGE_PRODUCT_LABEL, accessibilityLabel: 'Trocar o produto de Feijão' });
    expect(changeProductButton('DET YPE 500ML', false)).toEqual({ title: CHOOSE_PRODUCT_LABEL, accessibilityLabel: 'Escolher o produto de DET YPE 500ML' });
    expect([CHANGE_PRODUCT_LABEL, CHOOSE_PRODUCT_LABEL]).toEqual(['Trocar produto', 'Escolher produto']);
  });

  it('o seletor da troca e o do item que faltou', () => {
    expect(CHANGE_PRODUCT_TITLE).toBe('Qual produto é este?');
    expect(CHANGE_PRODUCT_MESSAGE).toBe(
      'A compra passa para o produto escolhido no histórico de preço e nos gastos, e na despensa, se foi para lá. A casa aprende junto: as próximas notas com esta descrição costumam vir com ele.',
    );
    expect(ADD_ITEM_ACCESSIBILITY).toBe('Incluir um item que faltou na nota');
    expect(ADD_ITEM_PICKER_TITLE).toBe('Qual produto faltou?');
    expect(addItemPickerMessage('ai')).toBe('Escolha o produto do item que a leitura não pegou. Depois vêm a quantidade e o valor.');
    expect(addItemPickerMessage('qrcode')).toBe(addItemPickerMessage('ai'));
    expect(addItemPickerMessage('manual')).toBe('Escolha o produto do item que ficou fora da nota. Depois vêm a quantidade e o valor.');
  });

  it('a frase da troca promete que a casa aprende só na linha que veio na nota, como o banco faz', () => {
    expect(changeProductMessage({ added_after_confirmation: false })).toBe(CHANGE_PRODUCT_MESSAGE);
    // O banco de antes da coluna, e a linha que sumiu da nota com o seletor aberto: a frase de sempre.
    expect(changeProductMessage({})).toBe(CHANGE_PRODUCT_MESSAGE);
    expect(changeProductMessage(undefined)).toBe(CHANGE_PRODUCT_MESSAGE);
    // A linha incluída depois da confirmação: o que muda, sem a promessa de aprender.
    expect(changeProductMessage({ added_after_confirmation: true })).toBe(CHANGE_ADDED_PRODUCT_MESSAGE);
    expect(CHANGE_ADDED_PRODUCT_MESSAGE).toBe(
      'A compra passa para o produto escolhido no histórico de preço e nos gastos, e na despensa, se foi para lá.',
    );
    expect(CHANGE_ADDED_PRODUCT_MESSAGE).not.toMatch(/aprende|próximas notas/);
    expect(CHANGE_PRODUCT_MESSAGE.startsWith(`${CHANGE_ADDED_PRODUCT_MESSAGE} `)).toBe(true);
    // A regra de onde as duas frases saem: o passo do apelido não corre na linha incluída, e só a inclusão a marca.
    expect(MIGRATION).toContain("if v_key <> '' and not item.added_after_confirmation then");
    expect(MIGRATION).toContain('alter table public.receipt_items add column added_after_confirmation boolean not null default false;');
    expect(MIGRATION).toMatch(/\n {4}added_after_confirmation\n {2}\) values \(\n[^)]*, v_total, true\n {2}\);/);
  });

  it('o formulário do item que faltou', () => {
    expect(ADD_ITEM_TITLE).toBe('Item que faltou');
    expect(ADD_ITEM_SAVE).toBe('Incluir item');
    // Não fala do Mercado do mês: um remédio vai para a linha da farmácia lá.
    expect(ADD_ITEM_INTRO).toBe(
      'O item entra nesta nota, e com ela nos gastos e no histórico de preço do produto. Ele não vai para os preços compartilhados entre casas.',
    );
    expect(ADD_ITEM_NEEDS_VALUE).toEqual({
      title: 'Informe o valor',
      message:
        'O item que faltou entra com o que foi pago por ele. Para guardar na despensa algo que veio de graça, use "Adicionar à despensa", em Compras > Despensa.',
    });
    expect(ADDED_BEFORE).toEqual({
      title: 'Item já incluído',
      message: 'O item já tinha entrado na nota com o que foi salvo da primeira vez, e esta mudança não foi gravada. Confira o item na nota.',
    });
    expect(PRODUCT_SAVED_NOT_SHOWN).toEqual({
      title: 'Produto trocado',
      message: 'Não deu para atualizar a nota na tela: o item pode aparecer com o produto de antes até ela ser buscada de novo.',
    });
  });

  it('sem internet', () => {
    expect(correctionOffline('change')).toEqual({ title: 'Sem internet agora', message: 'Troque o produto quando a conexão voltar.' });
    expect(correctionOffline('add')).toEqual({ title: 'Sem internet agora', message: 'Inclua o item quando a conexão voltar.' });
  });

  it('a nota buscada antes da correção: sem falar em confirmar (a nota já está confirmada)', () => {
    expect(correctionCatchUp('change')).toEqual({
      caughtUp: { title: 'Nota atualizada', message: 'Confira o item e toque de novo, se ainda precisar trocar o produto.' },
      behind: {
        title: 'A nota ainda não atualizou',
        message: 'Os itens na tela podem estar diferentes do que está salvo. Confira a internet e tente de novo.',
      },
      failed: CORRECTION_STALE,
    });
    expect(correctionCatchUp('add').caughtUp.message).toBe('Confira os itens e toque em "Item" de novo, se ainda faltar um.');
    expect(CORRECTION_STALE).toEqual({
      title: 'Não deu para buscar a nota',
      message: 'Os itens na tela podem estar diferentes do que está salvo. Toque em "Tentar de novo" e corrija o item depois.',
    });
    for (const action of ['change', 'add'] as const) {
      const notices = correctionCatchUp(action);
      for (const notice of [notices.caughtUp, notices.behind, notices.failed]) expect(notice.message).not.toMatch(/confirm/i);
    }
  });

  it('as recusas', () => {
    const messages: Record<CorrectionRefusal, string> = {
      notReady: 'Ainda não dá para corrigir os itens de uma nota confirmada: falta atualizar o banco do app.',
      receiptGone: RECEIPT_GONE,
      notConfirmed: 'Esta nota ainda está em revisão. Confira os itens e confirme a nota.',
      itemGone: 'Este item não está mais na nota.',
      itemChanged: 'O produto deste item já tinha mudado, e nada foi trocado. Confira o produto na nota e troque de novo, se precisar.',
      productGone: PRODUCT_MERGED_AWAY,
    };
    for (const [kind, message] of Object.entries(messages) as [CorrectionRefusal, string][]) {
      expect(correctionNotice(kind, 'change')).toEqual({ title: 'Produto não trocado', message });
      expect(correctionNotice(kind, 'add')).toEqual({ title: 'Item não incluído', message });
    }
    // Pode ter sido o toque anterior deste aparelho, cuja resposta se perdeu: não culpa outro aparelho.
    expect(messages.itemChanged).not.toMatch(/outro aparelho/);
  });
});

describe('a migração diz o que o app lê', () => {
  it('as recusas NK018 e NK019, com as mensagens', () => {
    expect(CORRECTION_CODES).toEqual({ itemChanged: 'NK018', notConfirmed: 'NK019' });
    expect(MIGRATION).toContain(`raise exception 'receipt item changed' using errcode = '${CORRECTION_CODES.itemChanged}'`);
    expect(MIGRATION.match(new RegExp(`'receipt not confirmed' using errcode = '${CORRECTION_CODES.notConfirmed}'`, 'g'))).toHaveLength(2);
  });

  it('os três P0002 de CORRECTION_NOT_FOUND', () => {
    for (const message of Object.values(CORRECTION_NOT_FOUND)) {
      expect(MIGRATION).toContain(`raise exception '${message}' using errcode = 'P0002'`);
    }
  });

  it("o 'ovos' que guarda a contagem da embalagem é uma categoria do app, a única que pergunta por ela", () => {
    expect(MIGRATION).toContain("when new_p.category = 'ovos' then item.pack_count");
    expect(CATEGORIES.map((c) => c.key)).toContain('ovos');
    const line = { raw_description: 'CAIXA', unit: 'un', total_price: 10, pack_count: null };
    expect(CATEGORIES.filter((c) => asksPackCount(line, c.key, null)).map((c) => c.key)).toEqual(['ovos']);
  });
});

import { describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';

import {
  DELETE_CONFIRM,
  DELETE_GONE_TITLE,
  DELETE_IN_REVIEW,
  DELETE_IN_REVIEW_TITLE,
  DELETE_PREFER_JOIN,
  DELETE_PURCHASED,
  DELETE_PURCHASED_TITLE,
  DELETE_TITLE,
  deleteInReviewMessage,
  deleteQuestion,
  deleteStep,
  isProductInReview,
  isProductPurchased,
  missingProductView,
  PRODUCT_NOT_IN_HOUSE,
  type DeleteFacts,
} from '../productDelete';
import { MERGE_IRREVERSIBLE } from '../productMerge';

const facts = (patch: Partial<DeleteFacts> = {}): DeleteFacts => ({
  product: { id: 'p1', name: 'Biscoito errado' },
  purchased: false,
  review: null,
  inPantry: false,
  onList: false,
  barcodes: { count: 0, first: null },
  ...patch,
});

const draft = { receiptId: 'r1', store: 'Assaí', day: '2026-11-12' };
const ENDING = `${DELETE_PREFER_JOIN} ${MERGE_IRREVERSIBLE}`;

describe('deleteStep: o que o toque faz, pelo que a leitura trouxe', () => {
  it('o produto que sumiu: avisa, com a frase neutra', () => {
    expect(deleteStep(facts({ product: null }))).toEqual({ kind: 'gone', title: DELETE_GONE_TITLE, message: PRODUCT_NOT_IN_HOUSE });
    // Sumiu vence o resto: o que a leitura diz das outras tabelas é de um produto que não existe mais.
    expect(deleteStep(facts({ product: null, purchased: true, review: draft })).kind).toBe('gone');
  });

  it('com compra, recusa; a compra vence o rascunho', () => {
    const refused = { kind: 'refuse', reason: 'purchased', title: DELETE_PURCHASED_TITLE, message: DELETE_PURCHASED };
    expect(deleteStep(facts({ purchased: true }))).toEqual(refused);
    expect(deleteStep(facts({ purchased: true, review: draft }))).toEqual(refused);
  });

  it('só num rascunho: recusa dizendo qual nota, e leva o id dela para "Abrir a nota"', () => {
    expect(deleteStep(facts({ review: draft }), 2026)).toEqual({
      kind: 'refuse',
      reason: 'inReview',
      title: DELETE_IN_REVIEW_TITLE,
      message:
        'Um item de uma nota para revisar (Assaí, 12 nov), em Compras > Notas, está com este produto. Confirme a nota com outro produto nesse item, ou exclua a nota, e tente de novo.',
      receiptId: 'r1',
    });
  });

  it('senão, pergunta com o nome lido do banco', () => {
    expect(deleteStep(facts({ product: { id: 'p1', name: 'Biscoito Errado (de agora)' } }))).toEqual({
      kind: 'ask',
      name: 'Biscoito Errado (de agora)',
      title: DELETE_TITLE,
      message: `"Biscoito Errado (de agora)" sai dos produtos da casa. ${ENDING}`,
      confirmLabel: 'Excluir',
    });
    expect(DELETE_CONFIRM).toBe('Excluir');
  });
});

describe('deleteInReviewMessage', () => {
  it('com o mercado, sem o mercado, e sem saber qual nota', () => {
    expect(deleteInReviewMessage(draft, 2026)).toBe(
      'Um item de uma nota para revisar (Assaí, 12 nov), em Compras > Notas, está com este produto. Confirme a nota com outro produto nesse item, ou exclua a nota, e tente de novo.',
    );
    expect(deleteInReviewMessage({ ...draft, store: null, day: '2025-03-01' }, 2026)).toBe(
      'Um item de uma nota para revisar (Mercado não informado, 1 mar 2025), em Compras > Notas, está com este produto. Confirme a nota com outro produto nesse item, ou exclua a nota, e tente de novo.',
    );
    expect(deleteInReviewMessage(null)).toBe(DELETE_IN_REVIEW);
    expect(DELETE_IN_REVIEW).toBe(
      'Um item de uma nota para revisar, em Compras > Notas, está com este produto. Confirme a nota com outro produto nesse item, ou exclua a nota, e tente de novo.',
    );
  });
});

describe('deleteQuestion: o que acontece, frase por frase', () => {
  const none = { count: 0, first: null };
  it('sem nada ligado', () => {
    expect(deleteQuestion('Biscoito errado', { inPantry: false, onList: false, barcodes: none })).toBe(
      '"Biscoito errado" sai dos produtos da casa. Se ele é o mesmo que outro produto, junte os dois em vez de excluir. Não dá para desfazer.',
    );
  });

  it('a despensa, a lista e as duas', () => {
    expect(deleteQuestion('Biscoito errado', { inPantry: true, onList: false, barcodes: none })).toBe(
      `"Biscoito errado" sai dos produtos da casa. O que está na despensa continua lá, sem ligação com este produto. ${ENDING}`,
    );
    expect(deleteQuestion('Biscoito errado', { inPantry: false, onList: true, barcodes: none })).toBe(
      `"Biscoito errado" sai dos produtos da casa. O que está na lista continua lá, sem ligação com este produto. ${ENDING}`,
    );
    expect(deleteQuestion('Biscoito errado', { inPantry: true, onList: true, barcodes: { count: 1, first: '07891000100103' } })).toBe(
      '"Biscoito errado" sai dos produtos da casa. O que está na despensa e na lista continua lá, sem ligação com este produto. Lido de novo, o código de barras 7891000100103 pergunta qual produto é. Se ele é o mesmo que outro produto, junte os dois em vez de excluir. Não dá para desfazer.',
    );
  });

  it('um código (como a pessoa lê, sem os zeros da frente), vários, e um sem o primeiro (não diz "null")', () => {
    expect(deleteQuestion('Sal', { inPantry: false, onList: false, barcodes: { count: 1, first: '00000096385074' } })).toBe(
      `"Sal" sai dos produtos da casa. Lido de novo, o código de barras 96385074 pergunta qual produto é. ${ENDING}`,
    );
    expect(deleteQuestion('Sal', { inPantry: false, onList: false, barcodes: { count: 3, first: '07891000100103' } })).toBe(
      `"Sal" sai dos produtos da casa. Lidos de novo, os 3 códigos de barras ligados a ele perguntam qual produto é. ${ENDING}`,
    );
    const odd = deleteQuestion('Sal', { inPantry: false, onList: false, barcodes: { count: 1, first: null } });
    expect(odd).toBe(`"Sal" sai dos produtos da casa. ${ENDING}`);
    expect(odd).not.toContain('null');
  });

  it('sempre termina em juntar em vez de excluir, e que não tem volta', () => {
    for (const inPantry of [false, true]) {
      for (const onList of [false, true]) {
        for (const barcodes of [none, { count: 1, first: '07891000100103' }, { count: 2, first: '07891000100103' }]) {
          expect(deleteQuestion('X', { inPantry, onList, barcodes }).endsWith(ENDING)).toBe(true);
        }
      }
    }
  });
});

describe('missingProductView: a tela do produto que não está no catálogo dela', () => {
  it('buscando, espera; conferido, não está na casa; sem conferir, diz que não deu', () => {
    expect(missingProductView({ fetching: true, checked: false })).toBe('loading');
    expect(missingProductView({ fetching: true, checked: true })).toBe('loading');
    expect(missingProductView({ fetching: false, checked: true })).toBe('gone');
    expect(missingProductView({ fetching: false, checked: false })).toBe('unchecked');
  });
});

describe('as recusas do banco, pelo código', () => {
  it('NK016 é a compra, NK017 o rascunho; a mensagem não decide', () => {
    expect(isProductPurchased({ code: 'NK016', message: 'product has purchases' })).toBe(true);
    expect(isProductInReview({ code: 'NK017', message: 'product is on a receipt under review' })).toBe(true);
    expect(isProductPurchased({ code: 'NK017', message: 'product has purchases' })).toBe(false);
    expect(isProductInReview({ code: 'NK016', message: 'product is on a receipt under review' })).toBe(false);
    for (const code of ['P0002', 'NK008', '55000', '40P01', '23503', '']) {
      expect(isProductPurchased({ code, message: 'product has purchases' })).toBe(false);
      expect(isProductInReview({ code, message: 'product is on a receipt under review' })).toBe(false);
    }
    expect(isProductPurchased(new Error('NK016'))).toBe(false);
    expect(isProductPurchased(null)).toBe(false);
    expect(isProductInReview(undefined)).toBe(false);
    expect(isProductInReview('NK017')).toBe(false);
  });
});

describe('a migração de excluir produto', () => {
  const dir = path.join(__dirname, '../../../supabase/migrations');
  const name = readdirSync(dir).find((file) => file.endsWith('_delete_product.sql'));
  const sql = readFileSync(path.join(dir, name!), 'utf8');
  const body = (fn: string) => {
    const start = sql.indexOf(`create function public.${fn}(`);
    expect(start).toBeGreaterThan(-1);
    return sql.slice(start, sql.indexOf('$$;', sql.indexOf('as $$', start)));
  };

  it('delete_product responde cada recusa com o código que o app lê, como quem chama, sem search_path', () => {
    const fn = body('delete_product');
    for (const code of ['NK016', 'NK017', 'NK008', 'P0002', '55000']) expect(fn).toContain(`errcode = '${code}'`);
    expect(fn).toContain('security invoker');
    expect(fn).toContain("set search_path = ''");
    expect(fn).toContain('for update');
  });

  it('o gatilho recusa com os mesmos códigos, só pelos papéis da API', () => {
    const guard = body('products_keep_receipt_lines');
    expect(guard).toContain("errcode = 'NK016'");
    expect(guard).toContain("errcode = 'NK017'");
    expect(guard).toContain("current_user in ('authenticated', 'anon')");
    expect(guard).toContain('security invoker');
    expect(sql).toMatch(/create trigger products_keep_receipt_lines\s+before delete on public\.products/);
  });

  it('o código de mercado fica sem produto (set null) em vez de sair junto, e a pergunta de que existe está lá', () => {
    expect(sql).toContain('on delete set null (product_id)');
    expect(sql).toContain('alter table public.product_store_codes alter column product_id drop not null');
    expect(body('delete_product_available')).toContain('select true');
  });
});

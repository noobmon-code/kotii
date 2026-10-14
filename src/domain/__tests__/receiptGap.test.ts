import { describe, expect, it } from '@jest/globals';

import { RECEIPT_CHECK_CENTS, receiptTotalMismatch } from '../marketSpend';
import {
  confirmUnpricedQuestion,
  gapNotices,
  hasReceiptTotal,
  ITEM_SAVED_NOT_SHOWN,
  pendingUnpriced,
  quantityText,
  readReceiptTotal,
  receiptGap,
  receiptTotalAccess,
  receiptTotalField,
  receiptTotalText,
  TOTAL_TOLERANCE_CENTS,
  unpricedPrompt,
  RECEIPT_CAUGHT_UP,
  RECEIPT_STILL_BEHIND,
  VALUE_NOT_SAVED,
  VALUE_SAVED_NOT_SHOWN,
  type GapLine,
} from '../receiptGap';

const line = (id: string, total_price: number, patch: Partial<GapLine> = {}): GapLine => ({
  id,
  quantity: 1,
  unit: 'un',
  unit_price: total_price,
  total_price,
  ...patch,
});
/** Itens com valor que somam `sum`, mais os `unpriced` sem valor. */
const gapOf = (total: number | null, sum: number, ...unpriced: GapLine[]) => receiptGap(total, [line('a', sum), ...unpriced]);

const draft = { status: 'draft', source: 'ai' } as const;
const confirmed = { status: 'confirmed', source: 'qrcode' } as const;

describe('a diferença entre o total da nota e a soma dos itens', () => {
  it('é feita em centavos: o que em reais não fecha por um fio, aqui fecha', () => {
    expect(receiptGap(0.3, [line('a', 0.1), line('b', 0.2)])).toEqual({ itemsTotal: 0.3, missingCents: 0, unpriced: [], suggestion: null });
    // 0,1 + 0,7 dá 0,7999999999999999, e 1,1 * 3 dá 3,3000000000000003.
    expect(receiptGap(0.8, [line('a', 0.1), line('b', 0.7)]).missingCents).toBe(0);
    expect(receiptGap(3.3, [line('a', 1.1), line('b', 1.1), line('c', 1.1)]).missingCents).toBe(0);
    expect(receiptGap(100, [line('a', 33.33), line('b', 33.33), line('c', 33.33)]).missingCents).toBe(1);
    expect(receiptGap(null, [line('a', 12.9), line('b', 7.1)])).toEqual({ itemsTotal: 20, missingCents: null, unpriced: [], suggestion: null });
    expect(receiptGap(50, [])).toEqual({ itemsTotal: 0, missingCents: 5000, unpriced: [], suggestion: null });
  });

  it('até 5 centavos é arredondamento; com 6 já é aviso, para mais ou para menos', () => {
    expect(TOTAL_TOLERANCE_CENTS).toBe(5);
    expect(gapNotices(gapOf(10.04, 10))).toEqual([]);
    // Em reais, 10,05 - 10 dá 0,05000000000000071, que é "mais que 0,05".
    expect(gapNotices(gapOf(10.05, 10))).toEqual([]);
    expect(gapNotices(gapOf(10.06, 10))).toEqual(['Faltam R$ 0,06: a soma dos itens é menor que o total da nota.']);
    expect(gapNotices(gapOf(9.96, 10))).toEqual([]);
    expect(gapNotices(gapOf(9.95, 10))).toEqual([]);
    expect(gapNotices(gapOf(9.94, 10))).toEqual(['A soma dos itens passa do total em R$ 0,06. Pode ser desconto.']);
    expect(gapNotices(gapOf(10, 10))).toEqual([]);
  });
});

describe('o aviso do cabeçalho diz o que é a diferença', () => {
  it('a soma menor que o total: quanto falta e quantos itens estão sem valor', () => {
    const less = 'Faltam R$ 12,90: a soma dos itens é menor que o total da nota.';
    expect(gapNotices(gapOf(62.9, 50))).toEqual([less]);
    expect(gapNotices(gapOf(62.9, 50, line('x', 0)))).toEqual([less, '1 item sem valor.']);
    expect(gapNotices(gapOf(62.9, 50, line('x', 0), line('y', 0)))).toEqual([less, '2 itens sem valor.']);
    expect(gapNotices(gapOf(1284.5, 50))).toEqual(['Faltam R$ 1.234,50: a soma dos itens é menor que o total da nota.']);
  });

  it('"falta" um real e pouco, "faltam" centavos e dois reais em diante', () => {
    expect(gapNotices(gapOf(51, 50))).toEqual(['Falta R$ 1,00: a soma dos itens é menor que o total da nota.']);
    expect(gapNotices(gapOf(51.99, 50))).toEqual(['Falta R$ 1,99: a soma dos itens é menor que o total da nota.']);
    expect(gapNotices(gapOf(52, 50))).toEqual(['Faltam R$ 2,00: a soma dos itens é menor que o total da nota.']);
    expect(gapNotices(gapOf(50.5, 50))).toEqual(['Faltam R$ 0,50: a soma dos itens é menor que o total da nota.']);
  });

  it('a soma maior que o total: pode ser desconto, com ou sem item sem valor', () => {
    expect(gapNotices(gapOf(45, 50))).toEqual(['A soma dos itens passa do total em R$ 5,00. Pode ser desconto.']);
    expect(gapNotices(gapOf(45, 50, line('x', 0)))).toEqual(['A soma dos itens passa do total em R$ 5,00. Pode ser desconto.']);
  });

  it('sem total, ou com a soma no total, nada: o item sem valor fala por si', () => {
    expect(gapNotices(gapOf(null, 50, line('x', 0)))).toEqual([]);
    expect(gapNotices(gapOf(50, 50, line('x', 0)))).toEqual([]);
  });
});

describe('total que não passa de zero é "sem total"', () => {
  it('o zero que a leitura gravou não vira aviso de desconto nem sugestão', () => {
    // Antes: "A soma dos itens passa do total em R$ 50,00. Pode ser desconto.", com os gastos contando R$ 50,00.
    const gap = gapOf(0, 50, line('x', 0));
    expect(gap).toEqual({ itemsTotal: 50, missingCents: null, unpriced: ['x'], suggestion: null });
    expect(gapNotices(gap)).toEqual([]);
    expect(unpricedPrompt(gap, 'x', { status: 'draft', source: 'ai' })?.text).toBe('Sem valor: a leitura não pegou o preço deste item.');
    expect(receiptGap(0, []).missingCents).toBeNull();
    expect(gapOf(0.004, 50).missingCents).toBeNull();
    expect(gapOf(-5, 50).missingCents).toBeNull();
  });

  it('um centavo já é total', () => {
    expect(gapOf(0.01, 50).missingCents).toBe(-4999);
    expect(hasReceiptTotal(0.01)).toBe(true);
    expect(hasReceiptTotal(62.9)).toBe(true);
    expect(hasReceiptTotal(0)).toBe(false);
    expect(hasReceiptTotal(0.004)).toBe(false);
    expect(hasReceiptTotal(-5)).toBe(false);
    expect(hasReceiptTotal(null)).toBe(false);
  });

  it('a conta de "Mercado do mês" (domain/marketSpend) é a mesma: a folga é uma só, e o total zerado também é "sem total" lá', () => {
    expect(RECEIPT_CHECK_CENTS).toBe(TOTAL_TOLERANCE_CENTS);
    // Onde a tela da nota avisa de diferença, a conta do mês diz que a nota não fecha; e só ali.
    for (const total of [null, 0, 0.004, 9.94, 9.95, 10, 10.05, 10.06, 62.9]) {
      expect([total, receiptTotalMismatch(total, 10)]).toEqual([total, gapNotices(gapOf(total, 10)).length > 0]);
    }
  });
});

describe('itens sem valor', () => {
  it('sem valor é o total zerado, com ou sem preço unitário', () => {
    const gap = receiptGap(null, [line('a', 10), line('b', 0), line('c', 0, { unit_price: 4.5 }), line('d', 0.01), line('e', 0.004)]);
    expect(gap.unpriced).toEqual(['b', 'c', 'e']);
    expect(gap.itemsTotal).toBe(10.01);
  });

  it('o que aparece no lugar de "2 un × R$ 0,00"', () => {
    expect(quantityText(line('a', 8.6, { quantity: 2, unit_price: 4.3 }))).toBe('2 un × R$ 4,30');
    expect(quantityText(line('a', 0, { quantity: 2 }))).toBe('2 un');
    expect(quantityText(line('a', 0, { quantity: 0.345, unit: 'kg' }))).toBe('0,345 kg');
    // A leitura por foto pode trazer o preço unitário sem o total: ele continua à vista.
    expect(quantityText(line('a', 0, { quantity: 2, unit_price: 4.3 }))).toBe('2 un × R$ 4,30');
    // Item com valor e preço unitário zerado fica como sempre foi.
    expect(quantityText(line('a', 5, { unit_price: 0 }))).toBe('1 un × R$ 0,00');
  });
});

describe('a sugestão: o que falta para o total pode ser o valor do único item sem valor', () => {
  it('um item sem valor e o total acima da soma dos outros', () => {
    // O item como a tela o entrega, com a descrição e o resto.
    const gap = gapOf(62.9, 50, { ...line('x', 0), raw_description: 'QJO MUSS KG' } as GapLine);
    expect(gap.suggestion).toEqual({
      itemId: 'x',
      amount: 12.9,
      values: { unit_price: 12.9, total_price: 12.9 },
    });
    // Só o preço e o total: nem a descrição (para "Usar" não regravar o nome que outro aparelho corrigiu), nem a
    // quantidade e a unidade (na nota confirmada elas já foram para a despensa).
    expect(Object.keys(gap.suggestion!.values).sort()).toEqual(['total_price', 'unit_price']);
    expect(unpricedPrompt(gap, 'x', draft)).toEqual({
      text: 'Faltam R$ 12,90 para o total da nota. Pode ser o valor deste item.',
      suggestion: gap.suggestion,
      useLabel: 'Usar R$ 12,90',
      fillLabel: 'Preencher valor',
      leaveLabel: 'Deixar sem valor',
      caveat: 'Se a nota teve desconto, o valor impresso do item é maior.',
    });
    // O item que tem valor não pergunta nada.
    expect(unpricedPrompt(gap, 'a', draft)).toBeNull();
  });

  it('o preço unitário sai da quantidade do item, com as quatro casas que a coluna guarda', () => {
    const values = (patch: Partial<GapLine>, total = 62.9) => gapOf(total, 50, line('x', 0, patch)).suggestion?.values;
    expect(values({ quantity: 3 })).toEqual({ unit_price: 4.3, total_price: 12.9 });
    expect(values({ quantity: 0.345, unit: 'kg' })).toEqual({ unit_price: 37.3913, total_price: 12.9 });
    expect(values({ quantity: 3 }, 60)).toMatchObject({ unit_price: 3.3333, total_price: 10 });
    // O preço unitário que a leitura trouxe sem o total é refeito: vale o que fecha a nota.
    expect(values({ quantity: 2, unit_price: 9.99 })).toEqual({ unit_price: 6.45, total_price: 12.9 });
  });

  it('o valor sugerido é o que falta, em centavos exatos', () => {
    // 0,1 + 0,2 em reais daria 0,09999999999999998 de diferença para 0,4.
    expect(receiptGap(0.4, [line('a', 0.1), line('b', 0.2), line('x', 0)]).suggestion?.amount).toBe(0.1);
    expect(receiptGap(100, [line('a', 33.33), line('b', 33.33), line('x', 0)]).suggestion?.values).toMatchObject({ unit_price: 33.34, total_price: 33.34 });
    expect(unpricedPrompt(gapOf(51.5, 50, line('x', 0)), 'x', draft)?.text).toBe('Falta R$ 1,50 para o total da nota. Pode ser o valor deste item.');
  });

  it('dois itens sem valor: não dá para saber quanto é de cada um, só a pergunta', () => {
    const gap = gapOf(62.9, 50, line('x', 0), line('y', 0));
    expect(gap.suggestion).toBeNull();
    const plain = {
      text: 'Sem valor: a leitura não pegou o preço deste item.',
      suggestion: null,
      useLabel: null,
      fillLabel: 'Preencher valor',
      leaveLabel: 'Deixar sem valor',
      caveat: null,
    };
    expect(unpricedPrompt(gap, 'x', draft)).toEqual(plain);
    expect(unpricedPrompt(gap, 'y', draft)).toEqual(plain);
  });

  it('sem total, com a soma já no total, dentro da tolerância ou acima dele: não falta nada a sugerir', () => {
    expect(gapOf(null, 50, line('x', 0)).suggestion).toBeNull();
    expect(gapOf(50, 50, line('x', 0)).suggestion).toBeNull();
    expect(gapOf(50.05, 50, line('x', 0)).suggestion).toBeNull();
    expect(gapOf(50.06, 50, line('x', 0)).suggestion?.amount).toBe(0.06);
    expect(gapOf(45, 50, line('x', 0)).suggestion).toBeNull();
    // Falta valor, mas nenhum item está sem valor: não há em quem sugerir.
    expect(gapOf(62.9, 50).suggestion).toBeNull();
    expect(unpricedPrompt(gapOf(null, 50, line('x', 0)), 'x', draft)?.text).toBe('Sem valor: a leitura não pegou o preço deste item.');
  });

  it('nota digitada à mão não teve leitura: a pergunta não fala dela', () => {
    const gap = gapOf(null, 50, line('x', 0));
    expect(unpricedPrompt(gap, 'x', { status: 'draft', source: 'manual' })?.text).toBe('Sem valor: este item está sem preço.');
    expect(unpricedPrompt(gap, 'x', { status: 'draft', source: 'qrcode' })?.text).toBe('Sem valor: a leitura não pegou o preço deste item.');
  });

  it('"Deixar sem valor" tira a pergunta do item nesta revisão', () => {
    const gap = gapOf(62.9, 50, line('x', 0));
    expect(unpricedPrompt(gap, 'x', draft, new Set(['x']))).toBeNull();
    expect(unpricedPrompt(gap, 'x', draft, new Set(['y']))).not.toBeNull();
  });

  it('na nota confirmada só dá para preencher: sem "Deixar sem valor", e a frase só vem com a sugestão', () => {
    const one = gapOf(62.9, 50, line('x', 0));
    expect(unpricedPrompt(one, 'x', confirmed)).toEqual({
      text: 'Faltam R$ 12,90 para o total da nota. Pode ser o valor deste item.',
      suggestion: one.suggestion,
      useLabel: 'Usar R$ 12,90',
      fillLabel: 'Preencher',
      leaveLabel: null,
      caveat: 'Se a nota teve desconto, o valor impresso do item é maior.',
    });
    const two = gapOf(62.9, 50, line('x', 0), line('y', 0));
    expect(unpricedPrompt(two, 'x', confirmed)).toEqual({ text: null, suggestion: null, useLabel: null, fillLabel: 'Preencher', leaveLabel: null, caveat: null });
    // O que foi deixado sem valor na revisão continua podendo ser preenchido depois.
    expect(unpricedPrompt(two, 'x', confirmed, new Set(['x']))).not.toBeNull();
    // O que a tela acabou de gravar e a nota ainda não mostra não pergunta de novo, na confirmada e na revisão.
    expect(unpricedPrompt(two, 'x', confirmed, undefined, new Set(['x']))).toBeNull();
    expect(unpricedPrompt(two, 'y', confirmed, undefined, new Set(['x']))).not.toBeNull();
    expect(unpricedPrompt(two, 'x', { status: 'draft', source: 'ai' }, new Set(), new Set(['x']))).toBeNull();
    expect(unpricedPrompt(two, 'a', confirmed)).toBeNull();
  });
});

describe('confirmar com itens ainda sem valor', () => {
  it('pergunta só pelos que a pessoa nem preencheu nem deixou de propósito', () => {
    const gap = gapOf(62.9, 50, line('x', 0), line('y', 0));
    expect(pendingUnpriced(gap, new Set())).toEqual(['x', 'y']);
    expect(pendingUnpriced(gap, new Set(['x']))).toEqual(['y']);
    expect(pendingUnpriced(gap, new Set(['x', 'y']))).toEqual([]);
    expect(pendingUnpriced(gapOf(62.9, 50), new Set())).toEqual([]);
  });

  it('a pergunta, no singular e no plural', () => {
    // Só o que é verdade: a frase não promete nada sobre o histórico de preço.
    expect(confirmUnpricedQuestion(1)).toEqual({
      title: '1 item está sem valor',
      message: 'Ele entra como R$ 0,00 nos gastos. Confirmar assim mesmo?',
      confirmLabel: 'Confirmar',
      cancelLabel: 'Cancelar',
    });
    expect(confirmUnpricedQuestion(2)).toEqual({
      title: '2 itens estão sem valor',
      message: 'Eles entram como R$ 0,00 nos gastos. Confirmar assim mesmo?',
      confirmLabel: 'Confirmar',
      cancelLabel: 'Cancelar',
    });
    expect(confirmUnpricedQuestion(3).title).toBe('3 itens estão sem valor');
  });

  it('o aviso de "Usar" ou "Salvar valor" que não achou o item sem valor', () => {
    // Sem dizer que a nota foi atualizada: o aviso sai antes de a nota voltar, e ela pode não voltar.
    expect(VALUE_NOT_SAVED).toEqual({ title: 'Valor não salvo', message: 'Este item já tem valor ou não existe mais.' });
  });

  it('gravou e a nota não voltou: o aviso diz que salvou, para o valor e para o item novo', () => {
    expect(VALUE_SAVED_NOT_SHOWN.title).toBe('Valor salvo');
    expect(ITEM_SAVED_NOT_SHOWN).toEqual({ title: 'Item salvo', message: 'Não deu para atualizar a nota na tela: o item aparece quando ela for buscada de novo.' });
  });

  it('"Confirmar nota" com a tela atrás do que foi gravado: a nota é buscada, e o toque é pedido de novo', () => {
    expect(RECEIPT_CAUGHT_UP).toEqual({ title: 'Nota atualizada', message: 'Confira os itens e toque em "Confirmar nota" de novo.' });
    expect(RECEIPT_STILL_BEHIND).toEqual({
      title: 'A nota ainda não atualizou',
      message: 'Os itens na tela podem estar diferentes do que foi salvo. Confira a internet e toque em "Confirmar nota" de novo.',
    });
  });
});

describe('o total da nota, que a revisão deixa corrigir', () => {
  it('a linha mostra o valor, ou o convite para informar', () => {
    expect(receiptTotalText(62.9)).toBe('R$ 62,90');
    expect(receiptTotalText(null)).toBe('informar');
    // O zero gravado pela leitura é "sem total", como nos gastos.
    expect(receiptTotalText(0)).toBe('informar');
  });

  it('o que o leitor de tela diz da linha, que é um botão', () => {
    expect(receiptTotalAccess(46.38)).toEqual({ label: 'Total da nota: R$ 46,38', hint: 'Toque para corrigir' });
    expect(receiptTotalAccess(null)).toEqual({ label: 'Total da nota: informar' });
    expect(receiptTotalAccess(0)).toEqual({ label: 'Total da nota: informar' });
  });

  it('o campo abre com o total como ele é lido de volta', () => {
    expect(receiptTotalField(null)).toBe('');
    expect(receiptTotalField(0)).toBe('');
    expect(receiptTotalField(62.9)).toBe('62,90');
    expect(receiptTotalField(1234.5)).toBe('1234,50');
    for (const total of [62.9, 1234.5, 0.07, 1500]) expect(readReceiptTotal(receiptTotalField(total))).toEqual({ ok: true, total });
  });

  it('em branco é "sem total"; o que não dá para ler avisa, em vez de apagar', () => {
    expect(readReceiptTotal('')).toEqual({ ok: true, total: null });
    expect(readReceiptTotal('  ')).toEqual({ ok: true, total: null });
    expect(readReceiptTotal('62,90')).toEqual({ ok: true, total: 62.9 });
    expect(readReceiptTotal('R$ 62,90')).toEqual({ ok: true, total: 62.9 });
    // Dinheiro: sem vírgula, o ponto de três em três dígitos é de milhar.
    expect(readReceiptTotal('1.500')).toEqual({ ok: true, total: 1500 });
    // Zero digitado é o mesmo que em branco: os gastos já leem total zero como "sem total".
    expect(readReceiptTotal('0')).toEqual({ ok: true, total: null });
    expect(readReceiptTotal('0,00')).toEqual({ ok: true, total: null });
    expect(readReceiptTotal('0,01')).toEqual({ ok: true, total: 0.01 });
    const unreadable = { ok: false, title: 'Confira o total', message: 'Confira o total da nota, ou deixe em branco.' };
    expect(readReceiptTotal('62,9,0')).toEqual(unreadable);
    expect(readReceiptTotal('abc')).toEqual(unreadable);
    expect(readReceiptTotal('-5')).toEqual(unreadable);
    expect(readReceiptTotal('1.5000')).toEqual(unreadable);
  });
});

import { describe, expect, it } from '@jest/globals';

import {
  billAboveUsual,
  billsAboveUsual,
  billUsual,
  billUsualNote,
  compareToUsual,
  describeAboveForNuke,
  describeAboveUsual,
  describeBillAbove,
  describeUsual,
  describeUsualAverage,
  judgePayments,
  knownNextAmount,
  paymentsAboveUsual,
  payUsualNote,
  usualAmount,
  usualPaymentsSince,
  type BillUsualPayment,
  type UsualBill,
} from '../billUsual';
import { mod10 } from '../boleto';
import { shiftMonth } from '../finance';

const TODAY = '2026-10-12';

const pay = (due_on: string, amount: number, bill_id = 'luz'): BillUsualPayment => ({ bill_id, due_on, amount });

/** Um pagamento por mês, no dia 10, do mais antigo ao mais novo, terminando em `last` ("AAAA-MM"). */
const monthly = (amounts: number[], last = '2026-09', bill_id = 'luz') =>
  amounts.map((amount, index) => pay(`${shiftMonth(last, index - amounts.length + 1)}-10`, amount, bill_id));

/** Seis meses de luz (abril a setembro) com média de R$ 225,00. */
const SIX = monthly([210, 220, 230, 240, 225, 225]);

/** Conta de luz válida (arrecadação, valor em reais) com o valor em centavos. */
function boletoOf(cents: number): string {
  const body = `836${String(cents).padStart(11, '0')}00010000000000000123456789012`;
  return body.slice(0, 3) + mod10(body) + body.slice(3);
}

const bill = (partial: Partial<UsualBill> = {}): UsualBill => ({
  id: 'luz',
  recurrence: 'monthly',
  next_due_on: '2026-10-10',
  active: true,
  amount: null,
  boleto: null,
  ...partial,
});

describe('usualAmount', () => {
  it('não existe com menos de 3 pagamentos', () => {
    expect(usualAmount([], { before: '2026-10-10' })).toBeNull();
    expect(usualAmount(monthly([200, 210]), { before: '2026-10-10' })).toBeNull();
  });

  it('com exatamente 3 já existe, e diz quantos entraram', () => {
    expect(usualAmount(monthly([200, 210, 220]), { before: '2026-10-10' })).toEqual({ average: 210, count: 3 });
    expect(usualAmount(SIX, { before: '2026-10-10' })).toEqual({ average: 225, count: 6 });
  });

  it('com mais de 6 na janela, só os 6 mais recentes contam', () => {
    // O vencimento mudou de dia em setembro: 7 pagamentos nos 6 meses. O de abril (R$ 900) sai.
    const payments = [...monthly([900, 100, 100, 100, 100], '2026-08'), pay('2026-09-05', 100), pay('2026-09-25', 160)];
    expect(usualAmount(payments, { before: '2026-10-10' })).toEqual({ average: 110, count: 6 });
  });

  it('ignora o que venceu há mais de 6 meses; o de 6 meses atrás, no mesmo dia, ainda vale', () => {
    // De janeiro a setembro: janeiro, fevereiro e março (R$ 900) ficam de fora.
    expect(usualAmount(monthly([900, 900, 900, 100, 100, 100, 100, 100, 100]), { before: '2026-10-10' })).toEqual({ average: 100, count: 6 });
    expect(usualAmount([pay('2026-04-09', 900), ...monthly([100, 100, 100])], { before: '2026-10-10' })).toEqual({ average: 100, count: 3 });
    // Sobram só dois dentro dos 6 meses: sem normal.
    expect(usualAmount(monthly([100, 100, 100, 100, 100], '2026-05'), { before: '2026-10-10' })).toBeNull();
  });

  it('o pagamento que está sendo julgado não entra no próprio normal, nem os de depois', () => {
    const payments = [...SIX, pay('2026-10-10', 900), pay('2026-11-10', 900)];
    expect(usualAmount(payments, { before: '2026-10-10' })).toEqual({ average: 225, count: 6 });
  });

  it('arredonda a média para centavos', () => {
    expect(usualAmount(monthly([20, 30, 50]), { before: '2026-10-10' })).toEqual({ average: 33.33, count: 3 });
    expect(usualAmount(monthly([0.1, 0.2, 0.3]), { before: '2026-10-10' })).toEqual({ average: 0.2, count: 3 });
  });

  it('média zerada não vira normal', () => {
    expect(usualAmount(monthly([0, 0, 0]), { before: '2026-10-10' })).toBeNull();
  });
});

describe('compareToUsual', () => {
  const usual = (average: number) => ({ average, count: 6 });

  it('diz quanto e quantos por cento acima do normal', () => {
    expect(compareToUsual(310, usual(225))).toEqual({ kind: 'acima', diff: 85, percent: 38 });
    expect(compareToUsual(45, usual(33.33))).toEqual({ kind: 'acima', diff: 11.67, percent: 35 });
  });

  it('precisa das duas coisas: 20% e R$ 10,00 acima', () => {
    // R$ 12 a mais numa conta de R$ 40: 30% e mais de R$ 10.
    expect(compareToUsual(52, usual(40))).toEqual({ kind: 'acima', diff: 12, percent: 30 });
    // R$ 8 a mais numa conta de R$ 40: 20%, mas menos de R$ 10.
    expect(compareToUsual(48, usual(40))).toEqual({ kind: 'normal', diff: 8, percent: 20 });
    // R$ 15 a mais numa conta de R$ 100: mais de R$ 10, mas só 15%.
    expect(compareToUsual(115, usual(100))).toEqual({ kind: 'normal', diff: 15, percent: 15 });
  });

  it('os limites contam: exatamente 20% e exatamente R$ 10,00 já é acima', () => {
    expect(compareToUsual(60, usual(50))).toEqual({ kind: 'acima', diff: 10, percent: 20 });
    expect(compareToUsual(59.99, usual(50))).toEqual({ kind: 'normal', diff: 9.99, percent: 20 });
    // 19,99% aparece como 20 arredondado, mas não chega.
    expect(compareToUsual(119.99, usual(100))).toEqual({ kind: 'normal', diff: 19.99, percent: 20 });
    expect(compareToUsual(120, usual(100))?.kind).toBe('acima');
  });

  it('abaixo do normal não tem aviso', () => {
    expect(compareToUsual(150, usual(225))).toEqual({ kind: 'normal', diff: -75, percent: -33 });
    expect(compareToUsual(224.5, usual(225))).toEqual({ kind: 'normal', diff: -0.5, percent: 0 });
    expect(compareToUsual(225, usual(225))).toEqual({ kind: 'normal', diff: 0, percent: 0 });
  });

  it('sem valor ou sem normal, não compara', () => {
    expect(compareToUsual(null, usual(225))).toBeNull();
    expect(compareToUsual(undefined, usual(225))).toBeNull();
    expect(compareToUsual(Number.NaN, usual(225))).toBeNull();
    expect(compareToUsual(310, null)).toBeNull();
  });
});

describe('judgePayments', () => {
  it('conta que sobe devagar não ganha selo', () => {
    const payments = monthly([100, 105, 110, 116, 122, 128, 134, 141]);
    const judged = judgePayments(payments);
    // Os três primeiros ainda não tinham normal.
    expect(judged.slice(0, 3)).toEqual([null, null, null]);
    expect(judged.slice(3).map((j) => j?.kind)).toEqual(['normal', 'normal', 'normal', 'normal', 'normal']);
    expect(paymentsAboveUsual(bill(), payments).size).toBe(0);
  });

  it('marca só o pico, e o mês seguinte é julgado com a média que já inclui o pico', () => {
    // Do mais novo para o mais antigo, como a tela da conta recebe.
    const payments = monthly([100, 100, 100, 100, 100, 200, 130]).reverse();
    const judged = judgePayments(payments);
    // Agosto (R$ 200) contra a média de R$ 100.
    expect(judged[1]).toEqual({ kind: 'acima', diff: 100, percent: 100 });
    // Setembro (R$ 130) contra R$ 116,67: sem o pico na média (R$ 100), seria 30% acima.
    expect(judged[0]).toEqual({ kind: 'normal', diff: 13.33, percent: 11 });
    expect([...paymentsAboveUsual(bill(), payments)]).toEqual(['2026-08-10']);
  });

  it('lista cortada: quem não tem a janela inteira entre os pagamentos que vieram fica sem selo', () => {
    // De janeiro a setembro; o primeiro pico é em abril, com janeiro, fevereiro e março antes dele.
    const payments = monthly([100, 100, 100, 200, 100, 100, 100, 100, 200]).reverse();
    expect([...paymentsAboveUsual(bill(), payments)]).toEqual(['2026-09-10', '2026-04-10']);
    // Se a busca parou em janeiro, o normal de abril (desde outubro) pode ter pagamentos que não vieram.
    expect([...paymentsAboveUsual(bill(), payments, { complete: false })]).toEqual(['2026-09-10']);
    // A janela de julho começa no próprio 10/01, o mais antigo que veio: está inteira.
    const july = monthly([100, 100, 100, 100, 100, 100, 200], '2026-07').reverse();
    expect([...paymentsAboveUsual(bill(), july, { complete: false })]).toEqual(['2026-07-10']);
  });

  it('conta anual ou de uma vez só não tem selo no histórico', () => {
    const payments = monthly([100, 100, 100, 100, 100, 200]);
    expect(paymentsAboveUsual(bill(), payments).size).toBe(1);
    expect(paymentsAboveUsual(bill({ recurrence: 'yearly' }), payments).size).toBe(0);
    expect(paymentsAboveUsual(bill({ recurrence: 'once' }), payments).size).toBe(0);
  });
});

describe('billUsual', () => {
  it('usa só os pagamentos da conta, antes do vencimento em aberto', () => {
    const payments = [...SIX, ...monthly([900, 900, 900], '2026-09', 'agua')];
    expect(billUsual(bill(), payments)).toEqual({ average: 225, count: 6 });
    expect(billUsual(bill({ id: 'agua' }), payments)).toEqual({ average: 900, count: 3 });
    expect(billUsual(bill({ id: 'gas' }), payments)).toBeNull();
    // Vencimento em aberto ainda em agosto: os pagamentos de agosto e setembro não entram.
    expect(billUsual(bill({ next_due_on: '2026-08-10' }), payments)).toEqual({ average: 225, count: 4 });
  });

  it('conta anual ou de uma vez só não tem normal', () => {
    expect(billUsual(bill({ recurrence: 'yearly' }), SIX)).toBeNull();
    expect(billUsual(bill({ recurrence: 'once' }), SIX)).toBeNull();
  });
});

describe('knownNextAmount', () => {
  it('vale o boleto guardado; sem ele, o valor fixo; senão, não se sabe', () => {
    expect(knownNextAmount(bill({ boleto: boletoOf(31000) }), TODAY)).toEqual({ amount: 310, source: 'boleto' });
    expect(knownNextAmount(bill({ boleto: boletoOf(31000), amount: 250 }), TODAY)).toEqual({ amount: 310, source: 'boleto' });
    expect(knownNextAmount(bill({ amount: 250 }), TODAY)).toEqual({ amount: 250, source: 'fixo' });
    expect(knownNextAmount(bill(), TODAY)).toBeNull();
  });

  it('boleto sem valor ou ilegível não conta', () => {
    expect(knownNextAmount(bill({ boleto: boletoOf(0) }), TODAY)).toBeNull();
    expect(knownNextAmount(bill({ boleto: '123', amount: 250 }), TODAY)).toEqual({ amount: 250, source: 'fixo' });
  });
});

describe('billsAboveUsual', () => {
  const payments = [
    ...SIX,
    ...monthly([100, 100, 100, 100, 100, 100], '2026-09', 'internet'),
    ...monthly([80, 80, 80, 80, 80, 80], '2026-09', 'agua'),
    ...monthly([1200, 1200, 1200, 1200, 1200, 1200], '2026-09', 'aluguel'),
    ...monthly([300, 300, 300, 300, 300, 300], '2026-09', 'iptu'),
    ...monthly([50, 50, 50, 50, 50, 50], '2026-09', 'academia'),
  ];

  it('diz quais contas estão acima do normal agora: pelo boleto, pelo valor fixo; valor desconhecido fica de fora', () => {
    const bills = [
      bill({ boleto: boletoOf(31000) }), // boleto de R$ 310 contra R$ 225
      bill({ id: 'internet', amount: 120 }), // valor fixo subiu de R$ 100 para R$ 120
      bill({ id: 'agua' }), // varia e não tem boleto: não se sabe
      bill({ id: 'aluguel', amount: 1200 }), // igual ao normal
      bill({ id: 'iptu', recurrence: 'yearly', boleto: boletoOf(90000) }), // anual
      bill({ id: 'academia', amount: 90, active: false }), // encerrada
      bill({ id: 'nova', amount: 500 }), // sem pagamentos
    ];
    const above = billsAboveUsual(bills, payments, TODAY);
    expect([...above.keys()]).toEqual(['luz', 'internet']);
    expect(above.get('luz')).toEqual({
      known: { amount: 310, source: 'boleto' },
      usual: { average: 225, count: 6 },
      comparison: { kind: 'acima', diff: 85, percent: 38 },
    });
    expect(above.get('internet')).toMatchObject({ known: { amount: 120, source: 'fixo' }, comparison: { diff: 20, percent: 20 } });
  });

  it('sem pagamentos (carregando ou com erro), nenhuma conta é marcada', () => {
    expect(billsAboveUsual([bill({ boleto: boletoOf(31000) })], [], TODAY).size).toBe(0);
  });

  it('busca os pagamentos de 7 meses e deixa de fora a conta atrasada há mais tempo que isso cobre', () => {
    expect(usualPaymentsSince(TODAY)).toBe('2026-03-12');
    // Vencida em 10/09 (um mês e pouco): os 6 meses dela começam em 10/03, antes do que a busca traz.
    const late = bill({ next_due_on: '2026-09-10', boleto: boletoOf(31000) });
    const before = monthly([210, 220, 230, 240, 225, 225], '2026-08');
    expect(billsAboveUsual([late], before, TODAY).size).toBe(0);
    // Com todos os pagamentos da conta (tela da conta), o aviso existe.
    expect(billAboveUsual(late, before, TODAY)?.comparison).toEqual({ kind: 'acima', diff: 85, percent: 38 });
    // Vencida em 15/09: os 6 meses começam em 15/03 e a busca cobre.
    const covered = bill({ next_due_on: '2026-09-15', boleto: boletoOf(31000) });
    expect(billsAboveUsual([covered], before, TODAY).has('luz')).toBe(true);
  });
});

describe('textos', () => {
  const usual = { average: 225, count: 6 };
  const comparison = compareToUsual(310, usual)!;

  it('aviso de acima do normal, com a contagem real de pagamentos', () => {
    expect(describeAboveUsual(comparison, usual)).toBe(
      'R$ 85,00 (38%) acima do normal desta conta. A média dos últimos 6 pagamentos é R$ 225,00.',
    );
    expect(describeAboveUsual(comparison, { average: 225, count: 4 })).toContain('A média dos últimos 4 pagamentos é R$ 225,00.');
    expect(describeAboveUsual(compareToUsual(45, { average: 33.33, count: 3 })!, { average: 33.33, count: 3 })).toBe(
      'R$ 11,67 (35%) acima do normal desta conta. A média dos últimos 3 pagamentos é R$ 33,33.',
    );
  });

  it('média e normal como informação', () => {
    expect(describeUsualAverage(usual)).toBe('Média dos últimos 6 pagamentos: R$ 225,00.');
    expect(describeUsual(usual)).toBe('Normal desta conta: cerca de R$ 225,00 (média dos últimos 6 pagamentos)');
  });

  it('singular, se um dia a média vier de um pagamento só', () => {
    const one = { average: 225, count: 1 };
    expect(describeUsualAverage(one)).toBe('Média do último pagamento: R$ 225,00.');
    expect(describeAboveUsual(comparison, one)).toContain('A média do último pagamento é R$ 225,00.');
    expect(describeUsual(one)).toBe('Normal desta conta: cerca de R$ 225,00 (média do último pagamento)');
  });

  it('aviso da tela da conta: o boleto guardado ou o valor fixo', () => {
    expect(describeBillAbove({ known: { amount: 310, source: 'boleto' }, usual, comparison })).toBe(
      'Este boleto veio R$ 310,00: R$ 85,00 (38%) acima do normal desta conta. A média dos últimos 6 pagamentos é R$ 225,00.',
    );
    expect(describeBillAbove({ known: { amount: 310, source: 'fixo' }, usual, comparison })).toBe(
      'O valor cadastrado é R$ 310,00: R$ 85,00 (38%) acima do normal desta conta. A média dos últimos 6 pagamentos é R$ 225,00.',
    );
  });

  it('linha para o Nuke, com os números prontos', () => {
    expect(describeAboveForNuke({ known: { amount: 310, source: 'boleto' }, usual, comparison })).toBe(
      'boleto de R$ 310,00, R$ 85,00 (38%) acima do normal: média R$ 225,00 dos últimos 6 pagamentos',
    );
    expect(describeAboveForNuke({ known: { amount: 310, source: 'fixo' }, usual, comparison })).toBe(
      'R$ 85,00 (38%) acima do normal: média R$ 225,00 dos últimos 6 pagamentos',
    );
  });
});

describe('payUsualNote', () => {
  it('conta de valor variável: a média enquanto o valor é normal, o aviso quando passa', () => {
    const average = { text: 'Média dos últimos 6 pagamentos: R$ 225,00.', above: false };
    expect(payUsualNote(bill(), SIX, null)).toEqual(average);
    expect(payUsualNote(bill(), SIX, 230)).toEqual(average);
    expect(payUsualNote(bill(), SIX, 150)).toEqual(average);
    expect(payUsualNote(bill(), SIX, 310)).toEqual({
      text: 'R$ 85,00 (38%) acima do normal desta conta. A média dos últimos 6 pagamentos é R$ 225,00.',
      above: true,
    });
  });

  it('conta de valor fixo só fala quando está acima', () => {
    const fixed = bill({ amount: 225 });
    expect(payUsualNote(fixed, SIX, 225)).toBeNull();
    expect(payUsualNote(fixed, SIX, 310)?.above).toBe(true);
  });

  it('sem normal (poucos pagamentos, conta anual), não diz nada', () => {
    expect(payUsualNote(bill(), monthly([200, 210]), 900)).toBeNull();
    expect(payUsualNote(bill({ recurrence: 'yearly' }), SIX, 900)).toBeNull();
  });
});

describe('billUsualNote', () => {
  it('boleto guardado acima do normal vira aviso', () => {
    expect(billUsualNote(bill({ boleto: boletoOf(31000) }), SIX, TODAY)).toEqual({
      text: 'Este boleto veio R$ 310,00: R$ 85,00 (38%) acima do normal desta conta. A média dos últimos 6 pagamentos é R$ 225,00.',
      above: true,
    });
  });

  it('conta de valor variável sem aviso mostra o normal atual', () => {
    const usual = { text: 'Normal desta conta: cerca de R$ 225,00 (média dos últimos 6 pagamentos)', above: false };
    expect(billUsualNote(bill(), SIX, TODAY)).toEqual(usual);
    expect(billUsualNote(bill({ boleto: boletoOf(23000) }), SIX, TODAY)).toEqual(usual);
  });

  it('valor fixo: só o aviso de acima; conta encerrada, anual ou sem normal não mostra nada', () => {
    expect(billUsualNote(bill({ amount: 225 }), SIX, TODAY)).toBeNull();
    expect(billUsualNote(bill({ amount: 300 }), SIX, TODAY)?.text).toBe(
      'O valor cadastrado é R$ 300,00: R$ 75,00 (33%) acima do normal desta conta. A média dos últimos 6 pagamentos é R$ 225,00.',
    );
    expect(billUsualNote(bill({ active: false, boleto: boletoOf(31000) }), SIX, TODAY)).toBeNull();
    expect(billUsualNote(bill({ recurrence: 'yearly', boleto: boletoOf(31000) }), SIX, TODAY)).toBeNull();
    expect(billUsualNote(bill({ boleto: boletoOf(31000) }), monthly([200, 210]), TODAY)).toBeNull();
  });
});

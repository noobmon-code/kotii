// O item de nota digitado à mão (ou corrigido depois da leitura): o que os
// três números querem dizer e o que gravar.
import { parseDecimal, parseMoney } from './money';

/** O formulário como a pessoa digitou. */
export interface ReceiptItemForm {
  description: string;
  quantity: string;
  unitPrice: string;
  total: string;
}

/**
 * "Sem valor" é o total zerado (em centavos): é assim que as duas leituras
 * gravam o item cujo valor não pegaram. O preço unitário não entra na conta,
 * porque a leitura por foto pode trazer um sem o total. Um brinde fica igual
 * nos dados, e por isso a nota pergunta em vez de decidir (domain/receiptGap).
 */
export function hasNoValue(item: { total_price: number }): boolean {
  return !(Math.round(item.total_price * 100) > 0);
}

/** O preço unitário que sai do total: quatro casas, que é o que a coluna guarda. */
export function unitPriceFromTotal(total: number, quantity: number): number {
  return Math.round((total / quantity) * 10000) / 10000;
}

/** O número como o app escreve num campo: vírgula decimal e sem ponto de milhar, para ser lido de volta igual. */
const toField = (n: number, digits: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: digits, useGrouping: false });

/**
 * Os campos com que o formulário abre. O item sem valor abre com os dois
 * preços em branco: com "0" no total, quem digitasse só o preço unitário
 * salvaria o total zerado, porque total preenchido vale. Em branco, o que a
 * pessoa digitar é o que conta (e "0" digitado de propósito continua zero).
 */
export function receiptItemForm(initial?: {
  raw_description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}): ReceiptItemForm {
  if (!initial) return { description: '', quantity: toField(1, 3), unitPrice: '', total: '' };
  const blank = hasNoValue(initial);
  return {
    description: initial.raw_description,
    quantity: toField(initial.quantity, 3),
    unitPrice: blank ? '' : toField(initial.unit_price, 4),
    total: blank ? '' : toField(initial.total_price, 2),
  };
}

export type ReceiptItemResult =
  | { ok: true; values: { raw_description: string; quantity: number; unit_price: number; total_price: number } }
  | { ok: false; message: string };

/**
 * O preço unitário digitado. Ele pode ter três casas de verdade (o litro da
 * gasolina a "5.899"), então sozinho o ponto é a vírgula decimal, como nas
 * quantidades. Com o total do item também digitado, "1.500" pode ser lido dos
 * dois jeitos, e vale o que fecha melhor com o total: 1 un a "1.500" com total
 * "1.500" é mil e quinhentos; 40 l a "5.899" com total "235,96" continua 5,899.
 * O que só tem uma leitura fica com ela: "1.500.000" é um milhão e meio, e
 * "1.5000" (quatro casas, que a coluna guarda) é 1,5.
 */
export function parseUnitPrice(input: string, quantity: number, total: number | null): number | null {
  const plain = parseDecimal(input);
  const money = parseMoney(input);
  if (plain == null || money == null || plain === money) return plain ?? money;
  if (total == null) return plain;
  return Math.abs(money * quantity - total) < Math.abs(plain * quantity - total) ? money : plain;
}

/**
 * Confere o item e devolve o que gravar, ou o que pedir à pessoa. Sem o
 * preço unitário, ele sai do total; sem o total, do preço vezes a quantidade.
 * Total preenchido que não deu para ler ("1.350,") não é "vazio": avisa, em
 * vez de gravar no lugar dele o preço vezes a quantidade.
 */
export function readReceiptItem(form: ReceiptItemForm): ReceiptItemResult {
  const quantity = parseDecimal(form.quantity);
  if (!form.description.trim() || !quantity || quantity <= 0) {
    return { ok: false, message: 'Informe a descrição e uma quantidade maior que zero.' };
  }
  const total = parseMoney(form.total);
  if (form.total.trim() && total == null) {
    return { ok: false, message: 'Confira o total do item, ou deixe em branco para calcular.' };
  }
  const price = parseUnitPrice(form.unitPrice, quantity, total);
  if (price == null && total == null) return { ok: false, message: 'Informe o preço unitário ou o total.' };
  const unit_price = price ?? unitPriceFromTotal(total ?? 0, quantity);
  const total_price = total ?? Math.round(unit_price * quantity * 100) / 100;
  return { ok: true, values: { raw_description: form.description.trim(), quantity, unit_price, total_price } };
}

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
  const unit_price = price ?? Math.round(((total ?? 0) / quantity) * 10000) / 10000;
  const total_price = total ?? Math.round(unit_price * quantity * 100) / 100;
  return { ok: true, values: { raw_description: form.description.trim(), quantity, unit_price, total_price } };
}

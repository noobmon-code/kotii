const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatBRL(value: number): string {
  // Intl usa espaço não separável entre "R$" e o número.
  return BRL.format(value).replace(/\s/g, ' ');
}

/** Aceita "12,90", "1.234,56", "12.9" e "R$ 3". Retorna null se inválido. */
export function parseDecimal(input: string): number | null {
  let s = input.replace(/[R$\s]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/**
 * Um valor em reais, como parseDecimal, com duas diferenças. Sem vírgula,
 * pontos de três em três dígitos são de milhar ("1.500" é mil e quinhentos e
 * "12.345.678" também; dinheiro não tem três casas depois do ponto). E um
 * ponto só com quatro ou mais dígitos depois ("1.5000") não é valor nenhum
 * (null): quem digitou mais um zero em "1.500" não quis dizer R$ 1,50. "1.5",
 * "15.90" e "1.500,50" continuam como lá. Só para dinheiro: numa quantidade,
 * "1.500" kg é um quilo e meio, e é o parseDecimal que lê.
 */
export function parseMoney(input: string): number | null {
  const s = input.replace(/[R$\s]/g, '');
  // Com zero na frente ("0.500") não é milhar: fica com a leitura de sempre.
  if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ''));
  if (/^\d+\.\d{4,}$/.test(s)) return null;
  return parseDecimal(input);
}

/**
 * O valor enquanto a pessoa ainda digita: "310," e "310." já valem 310, para a dica ao lado do campo
 * não piscar no instante da vírgula. A vírgula no fim já diz que os pontos são de milhar: "1.234," é mil
 * duzentos e trinta e quatro (quem apaga os centavos de "1.234,00" passa por aí). Na hora de salvar,
 * vale o parseDecimal.
 */
export function parseTypingAmount(input: string): number | null {
  const typed = input.replace(/\s+$/, '');
  return typed.endsWith(',') ? parseDecimal(`${typed}0`) : parseDecimal(typed.replace(/\.$/, ''));
}

export function formatQuantity(quantity: number, unit: string): string {
  const q = Number.isInteger(quantity) ? String(quantity) : quantity.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  return unit === 'un' ? `${q} un` : `${q} ${unit}`;
}

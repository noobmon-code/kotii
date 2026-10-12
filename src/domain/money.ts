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
 * O valor enquanto a pessoa ainda digita: "310," e "310." já valem 310, para a dica ao lado do campo
 * não piscar no instante da vírgula. Na hora de salvar, vale o parseDecimal.
 */
export function parseTypingAmount(input: string): number | null {
  return parseDecimal(input.replace(/[.,]\s*$/, ''));
}

export function formatQuantity(quantity: number, unit: string): string {
  const q = Number.isInteger(quantity) ? String(quantity) : quantity.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  return unit === 'un' ? `${q} un` : `${q} ${unit}`;
}

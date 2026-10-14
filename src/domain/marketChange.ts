// "O que mudou" no Mercado do mês: por que o dinheiro dos itens subiu ou
// desceu em relação à janela do mês anterior. A diferença dos itens (valor
// impresso, a soma sobre a qual as partes são contadas) é repartida em preço,
// quantidade, itens que entraram, itens que saíram e o que não dá para
// separar; as cinco partes somam exatamente a diferença, em centavos. Os
// itens e as janelas chegam prontos de marketSpend (figures, itemKey,
// previousWindow): aqui só se compara.

import { joinNames } from './cartPantry';
import { formatBRL, formatQuantity } from './money';
import { convertQuantity, sameDimension } from './units';

/** Uma compra de um item: a quantidade, a unidade e o valor impresso, em centavos (zero sem valor). */
export interface ChangePurchase {
  quantity: number;
  unit: string;
  value: number;
}

/** Um item num dos dois períodos, como marketSpend o soma. */
export interface ChangeItemFigures {
  key: string;
  productId: string | null;
  name: string;
  category: string;
  cents: number;
  purchases: ChangePurchase[];
}

export interface MarketChangeInput {
  /** Os itens do período da tela (no mês corrente, só até hoje). */
  current: Map<string, ChangeItemFigures>;
  /** Os itens da janela do mês anterior. */
  previous: Map<string, ChangeItemFigures>;
  /** A janela, para o meio da frase: "até o dia 14 de setembro", "em setembro". */
  previousWhen: string;
  /** O período da tela, para o meio da frase: "neste mês até hoje", "em outubro". */
  currentWhen: string;
  /** A diferença do total pago (a do cabeçalho), em centavos. */
  paidDiffCents: number;
  /** O que, nos dois períodos, faz o total pago não ser a soma dos itens. */
  receiptDifferences: { discounts: boolean; unread: boolean };
}

export type MarketChangePartKey = 'preco' | 'quantidade' | 'novos' | 'fora' | 'sem_comparacao';

export interface MarketChangePart {
  key: MarketChangePartKey;
  label: string;
  /** Com sinal: o quanto esta parte explica da diferença. */
  cents: number;
  /** "+R$ 12,00", "−R$ 4,00" */
  amount: string;
  /** "Os mesmos 14 itens ficaram 4% mais caros", "3 itens"; null sem nada a dizer. */
  detail: string | null;
  accessibilityLabel: string;
}

export interface MarketChangeItem {
  key: string;
  productId: string | null;
  name: string;
  category: string;
  /** A diferença do item, com sinal. */
  cents: number;
  amount: string;
  /** Por que mudou: "kg: R$ 34,00 → R$ 40,00 · 3 kg → 4 kg", "Não teve em setembro". */
  detail: string;
  accessibilityLabel: string;
}

/** Quantas mudanças aparecem antes de "Ver todas". */
export const MARKET_CHANGES_SHOWN = 3;

export interface MarketChange {
  /** A diferença dos itens, em centavos: as partes somam exatamente isto. */
  diffCents: number;
  /** "Nos itens, R$ 120,00 a mais que até o dia 14 de setembro" */
  headline: string;
  /** Só as partes diferentes de zero, na ordem: preço, quantidade, novos, que saíram, sem como comparar. */
  parts: MarketChangePart[];
  /** Quando o total pago muda diferente dos itens: a frase que diz por quê, sem outro número. */
  totalNote: string | null;
  /** Os itens que mudaram, da maior mudança (em valor absoluto) para a menor. */
  items: MarketChangeItem[];
  /** Com mais mudanças do que a lista mostra de início: quantas e o que os dois botões dizem; null quando cabem todas. */
  itemsCut: { shown: number; more: string; less: string } | null;
}

/** Por que um item comprado nos dois períodos não tem preço e quantidade separáveis. */
type NotComparable = 'compra sem valor' | 'sem quantidade' | 'unidades diferentes';

const money = (amount: number) => formatBRL(amount / 100);
// Sinal de menos de verdade (−), como o desconto da tela, não hífen.
const signed = (amount: number) => `${amount > 0 ? '+' : '−'}${money(Math.abs(amount))}`;
// Como as outras linhas da tela falam dinheiro: "menos R$ 10,00".
const spoken = (amount: number) => `${amount > 0 ? 'mais' : 'menos'} ${money(Math.abs(amount))}`;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** Arredonda para longe do zero no meio: −4,5% vira −5%, como 4,5% vira 5%. */
const roundHalfAway = (value: number) => Math.sign(value) * Math.round(Math.abs(value));

/** A unidade em que as quantidades do item se somam: kg para peso, l para volume, a própria unidade nas outras. */
function baseUnit(unit: string): string {
  if (convertQuantity(1, unit, 'kg') != null) return 'kg';
  if (convertQuantity(1, unit, 'l') != null) return 'l';
  return unit;
}

/** A quantidade da compra em milésimos inteiros da unidade base (como totalQuantity, sem 0,1 + 0,2 a mais). */
const thousandths = (purchase: ChangePurchase, base: string) => Math.round((convertQuantity(purchase.quantity, purchase.unit, base) ?? 0) * 1000);

/** O que impede separar preço e quantidade de um item comprado nos dois períodos; null quando dá. */
function notComparable(before: ChangeItemFigures, now: ChangeItemFigures): NotComparable | null {
  const all = [...before.purchases, ...now.purchases];
  if (before.cents <= 0 || now.cents <= 0 || all.some((purchase) => purchase.value <= 0)) return 'compra sem valor';
  if (all.some((purchase) => !(purchase.quantity > 0))) return 'sem quantidade';
  const first = all[0].unit;
  if (!all.every((purchase) => sameDimension(purchase.unit, first))) return 'unidades diferentes';
  // Quantidade que nem chega a um milésimo da unidade base não dá preço médio.
  if (all.some((purchase) => thousandths(purchase, baseUnit(first)) <= 0)) return 'sem quantidade';
  return null;
}

interface Split {
  item: ChangeItemFigures;
  diff: number;
  kind: 'comparavel' | 'novo' | 'fora' | 'sem_comparacao';
  /** No comparável: o que a quantidade de agora teria custado ao preço médio de antes. */
  expected: number;
  price: number;
  detail: string;
  spokenDetail: string;
}

/** Como a linha chama a unidade base ("kg: R$ 34,00 → R$ 40,00") e como o leitor de tela a diz. */
const UNIT_LABEL: Record<string, { label: string; spoken: string }> = {
  kg: { label: 'kg', spoken: 'do quilo' },
  l: { label: 'Litro', spoken: 'do litro' },
  un: { label: 'Unidade', spoken: 'da unidade' },
};

/**
 * Preço e quantidade de um item comparável. A quantidade de agora ao preço
 * médio de antes custaria round(c0 × q1 / q0): a parte do preço é o que foi
 * pago a mais ou a menos que isso, e a da quantidade é o resto. É a divisão
 * de sempre, com a mudança de preço pesada pela quantidade de agora; as duas
 * somam exatamente a diferença do item.
 */
function comparable(before: ChangeItemFigures, now: ChangeItemFigures): Omit<Split, 'kind' | 'diff'> {
  const base = baseUnit(before.purchases[0].unit);
  const q0 = before.purchases.reduce((sum, purchase) => sum + thousandths(purchase, base), 0);
  const q1 = now.purchases.reduce((sum, purchase) => sum + thousandths(purchase, base), 0);
  const expected = Math.round((before.cents * q1) / q0);
  // O preço médio por kg, litro ou unidade, em centavos; a quantidade, com formatQuantity na unidade base.
  const p0 = Math.round((before.cents * 1000) / q0);
  const p1 = Math.round((now.cents * 1000) / q1);
  const quantity0 = formatQuantity(q0 / 1000, base);
  const quantity1 = formatQuantity(q1 / 1000, base);
  const unit = UNIT_LABEL[base] ?? { label: base, spoken: `por ${base}` };
  return {
    item: now,
    expected,
    price: now.cents - expected,
    detail: `${unit.label}: ${money(p0)} → ${money(p1)} · ${quantity0} → ${quantity1}`,
    spokenDetail: `preço ${unit.spoken} de ${money(p0)} para ${money(p1)}, quantidade de ${quantity0} para ${quantity1}`,
  };
}

/** "Os mesmos 14 itens ficaram 4% mais caros", "O mesmo item custou praticamente o mesmo". */
function priceSentence(count: number, percent: number): string {
  const one = count === 1;
  const subject = one ? 'O mesmo item' : `Os mesmos ${count} itens`;
  if (percent === 0) return `${subject} ${one ? 'custou' : 'custaram'} praticamente o mesmo`;
  const how = `${Math.abs(percent)}% mais ${percent > 0 ? 'caro' : 'barato'}${one ? '' : 's'}`;
  return `${subject} ${one ? 'ficou' : 'ficaram'} ${how}`;
}

const byChange = (a: Split, b: Split) =>
  Math.abs(b.diff) - Math.abs(a.diff) || a.item.name.localeCompare(b.item.name, 'pt-BR') || a.item.key.localeCompare(b.item.key);

/** Por que o dinheiro dos itens mudou entre a janela do mês anterior e o período da tela. */
export function marketChange(input: MarketChangeInput): MarketChange {
  const { current, previous, previousWhen, currentWhen } = input;
  const splits: Split[] = [];
  for (const now of current.values()) {
    const before = previous.get(now.key);
    if (!before) {
      const when = `não teve ${previousWhen}`;
      splits.push({ item: now, diff: now.cents, kind: 'novo', expected: 0, price: 0, detail: capitalize(when), spokenDetail: when });
      continue;
    }
    const reason = notComparable(before, now);
    if (reason) {
      const detail = `${money(before.cents)} → ${money(now.cents)} · ${reason}`;
      splits.push({ item: now, diff: now.cents - before.cents, kind: 'sem_comparacao', expected: 0, price: 0, detail, spokenDetail: `de ${money(before.cents)} para ${money(now.cents)}, ${reason}` });
      continue;
    }
    splits.push({ ...comparable(before, now), diff: now.cents - before.cents, kind: 'comparavel' });
  }
  for (const before of previous.values()) {
    if (current.has(before.key)) continue;
    const when = `não teve ${currentWhen}`;
    splits.push({ item: before, diff: -before.cents, kind: 'fora', expected: 0, price: 0, detail: capitalize(when), spokenDetail: when });
  }

  const sum = (list: Split[], value: (split: Split) => number) => list.reduce((total, split) => total + value(split), 0);
  const of = (kind: Split['kind']) => splits.filter((split) => split.kind === kind);
  // Só o que mudou é contado: o item que entrou ou saiu sem valor nenhum não muda nada.
  const changed = (kind: Split['kind']) => of(kind).filter((split) => split.diff !== 0);
  const comparables = of('comparavel');
  const price = sum(comparables, (split) => split.price);
  const quantity = sum(comparables, (split) => split.diff - split.price);
  const priceBase = sum(comparables, (split) => split.expected);
  const diffCents = sum(splits, (split) => split.diff);

  const part = (key: MarketChangePartKey, label: string, cents: number, detail: string | null): MarketChangePart => ({
    key,
    label,
    cents,
    amount: signed(cents),
    detail,
    // O detalhe é uma frase própria ("Os mesmos 14 itens…"), não o meio de uma lista.
    accessibilityLabel: [`${label}: ${spoken(cents)}`, detail].filter(Boolean).join('. '),
  });
  const count = (kind: Split['kind']) => plural(changed(kind).length, 'item', 'itens');
  const parts = [
    part('preco', 'Preço', price, comparables.length && priceBase > 0 ? priceSentence(comparables.length, roundHalfAway((price * 100) / priceBase)) : null),
    part('quantidade', 'Quantidade', quantity, quantity > 0 ? 'Comprou mais dos mesmos itens' : 'Comprou menos dos mesmos itens'),
    part('novos', `Itens que não teve ${previousWhen}`, sum(of('novo'), (split) => split.diff), count('novo')),
    part('fora', `Itens que não comprou ${currentWhen}`, sum(of('fora'), (split) => split.diff), count('fora')),
    part('sem_comparacao', 'Sem como comparar', sum(of('sem_comparacao'), (split) => split.diff), count('sem_comparacao')),
  ].filter((entry) => entry.cents !== 0);

  // O total pago tem as diferenças das notas; os itens, não. Uma frase diz por que os dois mudam diferente, sem
  // outro número. Se as duas diferenças não batem, alguma nota dos dois períodos tem desconto ou valor sem item.
  const reasons = [
    input.receiptDifferences.discounts ? 'os descontos no total das notas' : null,
    input.receiptDifferences.unread ? 'os valores sem item lido' : null,
  ].filter((reason): reason is string => reason !== null);
  const totalNote = input.paidDiffCents !== diffCents && reasons.length ? `O total pago muda diferente porque inclui ${joinNames(reasons)}.` : null;

  const items = splits
    .filter((split) => split.diff !== 0)
    .sort(byChange)
    .map(({ item, diff, detail, spokenDetail }): MarketChangeItem => ({
      key: item.key,
      productId: item.productId,
      name: item.name,
      category: item.category,
      cents: diff,
      amount: signed(diff),
      detail,
      accessibilityLabel: `${item.name}: ${spoken(diff)}, ${spokenDetail}`,
    }));

  return {
    diffCents,
    headline:
      diffCents === 0 ? `Nos itens, o mesmo que ${previousWhen}` : `Nos itens, ${money(Math.abs(diffCents))} a ${diffCents > 0 ? 'mais' : 'menos'} que ${previousWhen}`,
    parts,
    totalNote,
    items,
    // Nunca um corte calado: as maiores vêm com o botão de ver todas.
    itemsCut:
      items.length > MARKET_CHANGES_SHOWN
        ? { shown: MARKET_CHANGES_SHOWN, more: `Ver todas as ${items.length} mudanças`, less: `Mostrar só as ${MARKET_CHANGES_SHOWN} maiores` }
        : null,
  };
}

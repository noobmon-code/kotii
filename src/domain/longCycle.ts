// Prazos de troca ("Hora de trocar"): o que dura meses e precisa ser trocado de tempos em tempos (a escova de dente,
// o refil do filtro, o travesseiro). "Acho que acabou" (domain/restock) nunca os sugere: pede três compras em 180
// dias e desiste do que se compra menos que a cada mês e meio. Aqui, uma tabela fixa do app diz o prazo de cada item
// (decisão do dono de 2026-11-21: "seria bom ter a tabela, mas a pessoa poder modificar para a casa dela"), e cada
// casa muda o prazo dela ou deixa de receber a sugestão (long_cycle_settings, src/data/longCycle.ts).
//
// O item é reconhecido pela chave da tabela, nunca pela chave do item sem a marca (genericItem: a parte `i:` leva os
// índices dos tipos do vocabulário, que mudam com ele; a parte `n:` é o nome inteiro, com a marca) nem pelo produto:
// a marca, o nome novo e o produto juntado não mudam nada. O reconhecimento só reusa o motor de termos (itemTerms) e
// as abreviações de nota (spelledOut); o vocabulário de sameItem e genericItem não muda.

import type { Chore, Equipment, Unit } from '@/lib/types';
import { addMonths, deviceDayError, diffDays, isValidISODate, toISODate } from './dates';
import { suggestMaintenance } from './equipment';
import { decidesPurchase, genericItem } from './genericItem';
import { compileTerms, firstProductTerm, termText } from './itemTerms';
import { hasAnyWord } from './nameWords';
import { isExcluded, listQuantity, type ListExclusion, type PurchaseRecord } from './recentPurchases';
import type { RestockItem } from './restock';
import { spelledOut, spelledOutFirstWords } from './sameItem';

// ---------------------------------------------------------------------------
// A tabela

export interface LongCycleItem {
  /** Guardada em long_cycle_settings.item_key: nunca muda de nome (a casa perderia o que mudou). */
  key: string;
  /** Como aparece. */
  name: string;
  /** A categoria de sempre (o desenho, e o item da lista quando nada foi comprado). */
  category: string;
  /** O prazo do app, em meses. */
  months: number;
  /** Casados no começo do nome (spelledOut, termos de itemTerms), sem acento e em minúsculas. */
  terms: readonly string[];
  /** Palavras (no singular, como hasAnyWord lê) que fazem do nome outra coisa: "Vassoura elétrica" não é vassoura. */
  unless?: readonly string[];
  /** As categorias em que o nome é este item, além de 'outros' e de nenhuma. */
  categories: readonly string[];
  /** A lista leva o nome da última compra (a idade, o tamanho e o fluxo decidem o que serve ao bebê). */
  keepName?: boolean;
  /** O desenho sem o nome: o do nome seria o de outro item (as duas esponjas dariam a esponja da cozinha). */
  noArt?: boolean;
}

/**
 * Conservadora: nomes sem marca, coisas que a casa compra no mercado ou na farmácia e troca num prazo bem conhecido,
 * e, onde os conselhos variam, o prazo maior (o app insiste menos). A ordem é a da tela dos prazos, depois dos que
 * estão na hora. Um item novo é mais uma linha aqui e mais um caso no teste; nada no banco.
 *
 * De fora, de propósito: o que depende da embalagem ou da marca (esponja de cozinha, lâmina, coleira, vermífugo), o que
 * não se compra no mercado (colchão, extintor, filtro do ar-condicionado), aparelho de saúde (lente de contato) e o
 * refil da escova elétrica (vem só com o nome da marca).
 */
export const LONG_CYCLE_ITEMS: readonly LongCycleItem[] = [
  {
    key: 'chupeta',
    name: 'Chupeta',
    category: 'bebe',
    months: 2,
    terms: ['chupeta'],
    unless: ['prendedor', 'porta', 'estojo', 'clip', 'corrente', 'esterilizador'],
    categories: ['bebe', 'higiene'],
    keepName: true,
  },
  {
    key: 'escova_dente',
    name: 'Escova de dente',
    category: 'higiene',
    months: 3,
    // "ESC DENT" e "ESC DENTAL" da nota viram "escova dental" (spelledOut).
    terms: ['escova de dente', 'escova dental'],
    unless: ['eletrica', 'eletrico', 'interdental', 'refil', 'refis', 'pet', 'cachorro', 'cao', 'caes', 'gato'],
    categories: ['higiene', 'bebe'],
  },
  {
    key: 'bico_mamadeira',
    name: 'Bico de mamadeira',
    category: 'bebe',
    months: 3,
    terms: ['bico de mamadeira', 'bico para mamadeira'],
    categories: ['bebe', 'higiene'],
    keepName: true,
  },
  {
    key: 'esponja_banho',
    name: 'Esponja de banho',
    category: 'higiene',
    months: 3,
    // "ESPO BANHO" e "ESPONJ BANHO" da nota viram "esponja banho" (spelledOut).
    terms: ['esponja de banho', 'esponja para banho', 'bucha de banho', 'bucha para banho'],
    categories: ['higiene', 'limpeza', 'bebe'],
    noArt: true,
  },
  {
    key: 'esponja_maquiagem',
    name: 'Esponja de maquiagem',
    category: 'higiene',
    months: 3,
    terms: ['esponja de maquiagem', 'esponja para maquiagem'],
    categories: ['higiene', 'limpeza'],
    noArt: true,
  },
  {
    key: 'coador_pano',
    name: 'Coador de pano',
    category: 'cafe_cha',
    months: 3,
    terms: ['coador de pano', 'coador de cafe de pano', 'filtro de pano'],
    unless: ['suporte', 'papel'],
    categories: ['cafe_cha', 'papel', 'limpeza'],
  },
  {
    key: 'refil_filtro_agua',
    name: 'Refil do filtro de água',
    category: 'outros',
    months: 6,
    terms: [
      'refil de filtro', 'refil para filtro', 'refil de purificador', 'refil para purificador', 'vela de filtro',
      'vela para filtro', 'elemento filtrante',
    ],
    unless: ['cafe', 'cafeteira', 'ar', 'aspirador', 'piscina', 'aquario', 'oleo', 'carro', 'combustivel', 'chuveiro', 'ducha'],
    // guessCategory põe "Refil do filtro de água" em bebidas.
    categories: ['limpeza', 'bebidas'],
  },
  {
    key: 'refil_mop',
    name: 'Refil de mop',
    category: 'limpeza',
    months: 6,
    terms: ['refil de mop', 'refil para mop'],
    categories: ['limpeza'],
  },
  {
    key: 'escova_sanitaria',
    name: 'Escova sanitária',
    category: 'limpeza',
    months: 12,
    terms: ['escova sanitaria', 'escova de vaso', 'escova para vaso', 'escova de privada', 'escova para privada'],
    unless: ['refil', 'refis', 'descartavel'],
    categories: ['limpeza', 'higiene'],
  },
  {
    key: 'vassoura',
    name: 'Vassoura',
    category: 'limpeza',
    months: 12,
    terms: ['vassoura'],
    unless: ['sanitaria', 'brinquedo', 'infantil', 'eletrica', 'eletrico', 'robo', 'magica'],
    categories: ['limpeza'],
  },
  {
    key: 'travesseiro',
    name: 'Travesseiro',
    category: 'outros',
    months: 24,
    terms: ['travesseiro'],
    unless: ['capa', 'fronha', 'protetor', 'pescoco', 'viagem', 'pet', 'cachorro', 'gato'],
    categories: ['bebe'],
  },
];

/** O mesmo check de item_key no banco (20261122130000_long_cycle_settings.sql; um teste compara). */
export const LONG_CYCLE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
/** Os limites do prazo da casa (o mesmo check de every_months no banco). */
export const LONG_CYCLE_MIN_MONTHS = 1;
export const LONG_CYCLE_MAX_MONTHS = 24;
/** Os prazos que a folha "Mudar o prazo" oferece (um prazo guardado fora deles ganha o chip dele). */
export const LONG_CYCLE_PERIOD_CHOICES = [1, 2, 3, 4, 6, 9, 12, 18, 24] as const;
/** Duas vezes o prazo sem comprar: a casa deve comprar em outro lugar, e o app para de sugerir. */
export const LONG_CYCLE_GIVE_UP_FACTOR = 2;
/** Quanto do histórico a leitura longa olha (cobre o prazo maior vezes o fator; um teste confere). */
export const LONG_CYCLE_HISTORY_MONTHS = 48;
/** Quantas linhas o Hoje mostra. */
export const LONG_CYCLE_SHOWN = 3;
/** O verbo de troca no começo do título de uma tarefa ("Trocar refil do filtro"). */
export const LONG_CYCLE_REPLACE_VERBS = ['trocar', 'troca', 'substituir', 'comprar', 'repor'] as const;

// ---------------------------------------------------------------------------
// Os tipos

/** Uma linha de long_cycle_settings: o que a casa mudou num item. */
export interface LongCycleSetting {
  item_key: string;
  /** null: o prazo do app. */
  every_months: number | null;
  off: boolean;
  /** O dia do "Já troquei". */
  replaced_on: string | null;
}

/** O que uma gravação muda (só as chaves presentes vão para o banco). */
export interface LongCycleChange {
  every_months?: number | null;
  off?: boolean;
  replaced_on?: string | null;
}

export type LongCycleStatus = 'off' | 'sem_compra' | 'em_dia' | 'trocar' | 'parou';

export interface LongCycleState {
  item: LongCycleItem;
  /** O prazo da casa, senão o do app. */
  months: number;
  /** A casa tem um prazo seu, diferente do do app. */
  custom: boolean;
  off: boolean;
  /** A última vez: o dia da compra mais nova ou do "Já troquei", o mais novo dos dois (no empate, a compra). */
  last: { day: string; via: 'compra' | 'troca' } | null;
  /** A compra mais nova reconhecida como este item. */
  record: PurchaseRecord | null;
  /** A mais nova delas que veio de uma lista (a quantidade de lista vale mais que a da nota). */
  listRecord: PurchaseRecord | null;
  /** O produto da mais nova delas que tem produto (a dica de preço da lista). */
  productId: string | null;
  /** addMonths(last.day, months). */
  dueOn: string | null;
  status: LongCycleStatus;
}

/** O item que vai para a lista. */
export interface LongCycleSuggestion {
  state: LongCycleState;
  /** = state.item.key, vai como cycleKey (useAddItemsToList pula o item que a lista já tem com outro nome). */
  key: string;
  name: string;
  category: string;
  productId: string | null;
  quantity: number;
  unit: Unit;
}

export type LongCycleUndoKind = 'replaced' | 'off' | 'period';

// ---------------------------------------------------------------------------
// Reconhecer o item

const ITEMS_BY_KEY = new Map(LONG_CYCLE_ITEMS.map((item) => [item.key, item]));
const UNLESS = new Map(LONG_CYCLE_ITEMS.map((item) => [item.key, new Set(item.unless ?? [])]));
const COMPILED = compileTerms(LONG_CYCLE_ITEMS.map((item) => [item.key, item.terms] as const));

export function longCycleItem(key: string): LongCycleItem | undefined {
  return ITEMS_BY_KEY.get(key);
}

// O Hoje lê umas duas mil compras: o resultado fica guardado, como em readItem e genericItem.
const KEYS = new Map<string, string | null>();
const KEYS_LIMIT = 4000;

/**
 * O item da tabela que o nome é, ou null. O termo tem que abrir o nome (spelledOut, para "ESC DENT" da nota): "Kit
 * escova de dente" e "Capa de travesseiro" não são o item. Uma palavra de `unless` (também no singular) ou uma
 * categoria fora das do item (a não ser 'outros' e nenhuma) fazem do nome outra coisa: "Vassoura elétrica", "Escova
 * de dente" em pet.
 */
export function longCycleKeyOf(name: string, category?: string | null): string | null {
  const cacheKey = `${category ?? ''}\u0000${name}`;
  const known = KEYS.get(cacheKey);
  if (known !== undefined) return known;
  const result = readKey(name, category);
  if (KEYS.size >= KEYS_LIMIT) KEYS.clear();
  KEYS.set(cacheKey, result);
  return result;
}

function readKey(name: string, category: string | null | undefined): string | null {
  const text = spelledOut(name);
  if (!text) return null;
  const hit = firstProductTerm(COMPILED, text);
  if (!hit || hit.index !== 0) return null;
  const item = ITEMS_BY_KEY.get(hit.key);
  if (!item || hasAnyWord(text, UNLESS.get(item.key) ?? new Set())) return null;
  if (category && category !== 'outros' && !item.categories.includes(category)) return null;
  return item.key;
}

/** As formas no singular e no plural que o motor de termos (itemTerms) aceita para a palavra. */
export function wordForms(word: string): string[] {
  if (word.endsWith('ao')) {
    const stem = word.slice(0, -2);
    return [word, `${stem}oes`, `${stem}aes`, `${stem}aos`];
  }
  if (/[rz]$/.test(word)) return [word, `${word}es`, `${word}s`];
  if (word.endsWith('s')) return [word, `${word}es`];
  if (word.endsWith('l')) return [word, `${word.slice(0, -1)}is`];
  if (word.endsWith('m')) return [word, `${word.slice(0, -1)}ns`];
  return [word, `${word}s`];
}

/**
 * As primeiras palavras que a leitura longa pede ao servidor (long_cycle_purchases só devolve os nomes que começam
 * por uma delas): a primeira palavra de cada termo, no singular e no plural, e as abreviações de nota que viram uma
 * delas ("esc", "espo", "esponj"). Uma abreviação nova em spelledOut entra sozinha.
 */
export function longCycleFirstWords(): string[] {
  return spelledOutFirstWords(LONG_CYCLE_ITEMS.flatMap((item) => item.terms.flatMap((term) => wordForms(term.split(' ')[0]))));
}

// ---------------------------------------------------------------------------
// O estado de cada item

const validMonths = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= LONG_CYCLE_MIN_MONTHS && value <= LONG_CYCLE_MAX_MONTHS;

const isNewer = (a: PurchaseRecord, b: PurchaseRecord | null) => !b || Date.parse(a.at) > Date.parse(b.at);

/**
 * Um estado por item da tabela, na ordem dela. As compras (as dos 180 dias e as da leitura longa; repetidas não
 * importam, só a mais nova conta) com data inválida ou de um dia depois de hoje ficam de fora: a nota com data no
 * futuro espera o dia dela, como no Mercado do mês. O "Já troquei" de outro aparelho com o relógio adiantado conta
 * como hoje. `settings` null (antes da migração) é o mesmo que nenhuma linha; uma chave que o app não conhece (de uma
 * versão mais nova) não conta.
 */
export function longCycleStates({
  records,
  settings,
  today,
}: {
  records: readonly PurchaseRecord[];
  settings: readonly LongCycleSetting[] | null;
  today: string;
}): LongCycleState[] {
  const newest = new Map<string, { record: PurchaseRecord | null; listRecord: PurchaseRecord | null; withProduct: PurchaseRecord | null }>();
  for (const record of records) {
    const time = Date.parse(record.at);
    if (Number.isNaN(time) || !record.name?.trim()) continue;
    if (toISODate(new Date(time)) > today) continue;
    const key = longCycleKeyOf(record.name, record.category);
    if (!key) continue;
    const found = newest.get(key) ?? { record: null, listRecord: null, withProduct: null };
    if (isNewer(record, found.record)) found.record = record;
    if (record.source === 'list' && isNewer(record, found.listRecord)) found.listRecord = record;
    if (record.productId && isNewer(record, found.withProduct)) found.withProduct = record;
    newest.set(key, found);
  }
  return LONG_CYCLE_ITEMS.map((item) => {
    const found = newest.get(item.key);
    return stateFor(
      item,
      { record: found?.record ?? null, listRecord: found?.listRecord ?? null, productId: found?.withProduct?.productId ?? null },
      settings?.find((s) => s.item_key === item.key),
      today,
    );
  });
}

/**
 * O mesmo item com outro ajuste da casa (o que acabou de ser gravado): as compras são as mesmas. Diz se o prazo novo
 * ainda deixa o item na hora de trocar.
 */
export function longCycleRestate(state: LongCycleState, setting: LongCycleSetting | undefined, today: string): LongCycleState {
  return stateFor(state.item, state, setting, today);
}

function stateFor(
  item: LongCycleItem,
  { record, listRecord, productId }: Pick<LongCycleState, 'record' | 'listRecord' | 'productId'>,
  setting: LongCycleSetting | undefined,
  today: string,
): LongCycleState {
  const bought = record ? toISODate(new Date(Date.parse(record.at))) : null;
  const replacedOn = setting?.replaced_on && isValidISODate(setting.replaced_on) ? setting.replaced_on : null;
  const replaced = replacedOn && replacedOn > today ? today : replacedOn;
  let last: LongCycleState['last'] = null;
  if (bought && (!replaced || bought >= replaced)) last = { day: bought, via: 'compra' };
  else if (replaced) last = { day: replaced, via: 'troca' };
  const houseMonths = setting?.every_months;
  const months = validMonths(houseMonths) ? houseMonths : item.months;
  const custom = validMonths(houseMonths) && houseMonths !== item.months;
  const off = setting?.off === true;
  const dueOn = last ? addMonths(last.day, months) : null;
  let status: LongCycleStatus;
  if (off) status = 'off';
  else if (!last || !dueOn) status = 'sem_compra';
  else if (today < dueOn) status = 'em_dia';
  else if (today < addMonths(last.day, months * LONG_CYCLE_GIVE_UP_FACTOR)) status = 'trocar';
  else status = 'parou';
  return { item, months, custom, off, last, record, listRecord, productId, dueOn, status };
}

// ---------------------------------------------------------------------------
// O que a casa já acompanha de outro jeito

const VERBS = new RegExp(`^(?:${LONG_CYCLE_REPLACE_VERBS.join('|')})(?: (?:o|a|os|as))? (.+)$`);

/** O item que o título de uma tarefa troca ("Trocar refil do filtro"), ou null ("Limpar filtros", "Trocar óleo"). */
export function longCycleChoreKey(title: string): string | null {
  const rest = VERBS.exec(termText(title))?.[1];
  return rest ? longCycleKeyOf(rest, null) : null;
}

/**
 * Os itens que o Hoje não sugere porque a casa já os acompanha: em "Acho que acabou" logo acima (pelo nome e por cada
 * nome com que foi comprado), em "Gás, água e ração" (a reposição do tipo "filtro" é o refil do filtro; uma de nome
 * que é o item, esse item) ou numa tarefa que se repete (cujo título troca o item, ou de um aparelho cuja manutenção
 * de sempre troca o item: o purificador com qualquer manutenção esconde o refil).
 */
export function longCycleSkipKeys({
  restock,
  supplies,
  chores,
  equipment,
}: {
  restock: readonly Pick<RestockItem, 'name' | 'category' | 'boughtAs'>[];
  supplies: readonly { name: string; kind: string }[];
  chores: readonly Pick<Chore, 'title' | 'recurrence' | 'equipment_id'>[];
  equipment: readonly Pick<Equipment, 'id' | 'name' | 'category'>[];
}): Set<string> {
  const skip = new Set<string>();
  const add = (key: string | null) => {
    if (key) skip.add(key);
  };
  for (const item of restock) {
    add(longCycleKeyOf(item.name, item.category));
    for (const bought of item.boughtAs) add(longCycleKeyOf(bought.name, item.category));
  }
  for (const supply of supplies) {
    if (supply.kind === 'filtro') skip.add('refil_filtro_agua');
    add(longCycleKeyOf(supply.name, null));
  }
  for (const chore of chores) {
    if (chore.recurrence === 'none') continue;
    add(longCycleChoreKey(chore.title));
    const appliance = chore.equipment_id ? equipment.find((e) => e.id === chore.equipment_id) : undefined;
    if (appliance) for (const usual of suggestMaintenance(appliance.name, appliance.category, [])) add(longCycleChoreKey(usual.title));
  }
  return skip;
}

// ---------------------------------------------------------------------------
// O item da lista

/**
 * O nome que vai para a lista: o da tabela ("ESC DENT COLGATE CLAS" vai como "Escova de dente"), a lista sem a marca.
 * Quando a última compra tem uma palavra que decide o que se pode comprar ("infantil", "kids", "sem lactose":
 * decidesPurchase), ou o item é dos que guardam o nome (a chupeta e o bico: a idade, o tamanho e o fluxo), o nome que
 * genericItem dá a essa compra: o mesmo que "Acho que acabou" poria.
 */
export function longCycleListName(item: LongCycleItem, record: PurchaseRecord | null): string {
  if (!record) return item.name;
  if (item.keepName || decidesPurchase(record.name)) return genericItem(record.name, record.category).name || item.name;
  return item.name;
}

/** O item da lista: o nome, a categoria da última compra, o produto como dica de preço e a quantidade de sempre. */
export function longCycleSuggestion(state: LongCycleState): LongCycleSuggestion {
  const { item, record, listRecord } = state;
  // A quantidade de lista mais recente vale mais que a do cupom (a regra de groupPurchases); só o "Já troquei", 1 un.
  const quantity = listRecord ? listRecord.quantity : record ? listQuantity(record.quantity, record.unit) : 1;
  const unit: Unit = listRecord ? listRecord.unit : record ? record.unit : 'un';
  return {
    state,
    key: item.key,
    name: longCycleListName(item, record),
    category: record?.category || item.category,
    productId: state.productId,
    quantity,
    unit,
  };
}

/**
 * O item já está numa lista aberta (ou acabou de ir para uma): pelo nome que iria, pelo nome da tabela, pelo produto,
 * pelo item sem a marca (isExcluded) ou por um item da lista que é este item com outro nome ("Travesseiro Nasa").
 */
export function longCycleOnList(
  state: LongCycleState,
  { lists, exclude }: { lists: readonly { name: string; category?: string | null; product_id: string | null }[]; exclude: ListExclusion },
): boolean {
  const suggestion = longCycleSuggestion(state);
  return (
    isExcluded({ name: suggestion.name, category: suggestion.category, productId: suggestion.productId }, exclude) ||
    isExcluded({ name: state.item.name, category: state.item.category, productId: null }, exclude) ||
    lists.some((i) => longCycleKeyOf(i.name, i.category) === state.item.key)
  );
}

const byDueThenName = (a: LongCycleState, b: LongCycleState) =>
  (a.dueOn ?? '').localeCompare(b.dueOn ?? '') || a.item.name.localeCompare(b.item.name, 'pt-BR');

/**
 * O grupo do Hoje: o que está na hora, menos o que a casa acompanha de outro jeito (`skip`) e o que já está numa
 * lista; o que venceu antes primeiro, depois pelo nome. `total` conta todos (o "Ver os outros").
 */
export function longCycleSuggestions(
  states: readonly LongCycleState[],
  {
    lists,
    exclude,
    skip,
    limit = LONG_CYCLE_SHOWN,
  }: {
    lists: readonly { name: string; category?: string | null; product_id: string | null }[];
    exclude: ListExclusion;
    skip: ReadonlySet<string>;
    limit?: number;
  },
): { shown: LongCycleSuggestion[]; total: number } {
  const due = states
    .filter((s) => s.status === 'trocar' && !skip.has(s.item.key) && !longCycleOnList(s, { lists, exclude }))
    .sort(byDueThenName);
  return { shown: due.slice(0, limit).map(longCycleSuggestion), total: due.length };
}

/** A ordem da tela dos prazos: o que está na hora primeiro (o que venceu antes, depois o nome), o resto na da tabela. */
export function longCycleScreenOrder(states: readonly LongCycleState[]): LongCycleState[] {
  return [...states.filter((s) => s.status === 'trocar').sort(byDueThenName), ...states.filter((s) => s.status !== 'trocar')];
}

/** O que "Salvar" grava: null no prazo do app (a casa acompanha se o padrão mudar). Só os chips chamam. */
export function longCycleSaveMonths(item: LongCycleItem, chosen: number): number | null {
  if (!validMonths(chosen)) throw new Error(`prazo fora de ${LONG_CYCLE_MIN_MONTHS}..${LONG_CYCLE_MAX_MONTHS}: ${chosen}`);
  return chosen === item.months ? null : chosen;
}

/** O que "Desfazer" grava: o que a gravação trocou, como estava antes dela (null também). */
export function longCycleUndo(kind: LongCycleUndoKind, setting: LongCycleSetting | undefined): LongCycleChange {
  if (kind === 'replaced') return { replaced_on: setting?.replaced_on ?? null };
  if (kind === 'off') return { off: false };
  return { every_months: setting?.every_months ?? null };
}

/** Os chips da folha do prazo: as escolhas e, fora delas, o prazo guardado (de uma versão mais nova), em ordem. */
export function longCyclePeriodChoices(current: number): number[] {
  const choices: number[] = [...LONG_CYCLE_PERIOD_CHOICES];
  return choices.includes(current) ? choices : [...choices, current].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Os textos (palavras sem gênero de propósito: "Última compra", "troca anotada"; escova e travesseiro diferem)

export const LONG_CYCLE_TITLE = 'Prazos de troca';
export const LONG_CYCLE_ROW_SUBTITLE = 'Quando trocar a escova de dente, o refil do filtro, o travesseiro…';
export const LONG_CYCLE_INTRO =
  'O que dura meses e precisa ser trocado aparece em Hoje, em "Hora de trocar", quando passa o prazo. O prazo conta da última compra do item, numa lista ou numa nota, de qualquer marca. Mude o prazo de um item ou deixe de sugeri-lo: vale para a casa toda.';
export const LONG_CYCLE_FOOTNOTE =
  'Comprou fora do app? Toque no item e em "Já troquei", e o prazo recomeça hoje. Hoje não sugere o que já está numa lista nem o que a casa acompanha em "Gás, água e ração" ou numa tarefa que se repete.';
export const LONG_CYCLE_NOT_READY = 'Mudar os prazos ainda não está disponível. Por enquanto vale o padrão do Kotii.';
export const LONG_CYCLE_OFFLINE = 'Sem internet: não deu para abrir os prazos de troca.';
export const LONG_CYCLE_HISTORY_FAILED =
  'Não deu para ler as compras mais antigas: a última compra de algum item pode estar faltando.';
export const LONG_CYCLE_ACTIONS = {
  add: 'Pôr na lista',
  replaced: 'Já troquei',
  undoReplaced: 'Desfazer o “Já troquei”',
  period: 'Mudar o prazo',
  off: 'Não sugerir mais',
  on: 'Voltar a sugerir',
} as const;
export const LONG_CYCLE_BADGES = { due: 'Hora de trocar', onList: 'Na lista', off: 'Não sugerido' } as const;
export const LONG_CYCLE_PERIOD_QUESTION = 'Trocar a cada';
export const LONG_CYCLE_SHEET = { save: 'Salvar', cancel: 'Cancelar' } as const;
export const LONG_CYCLE_UNDO = 'Desfazer';
/** O título do erro (o mesmo do `onError` do Hoje). */
export const LONG_CYCLE_ERROR_TITLE = 'Erro';
/** Para deviceDayError: "… para o Kotii guardar quando foi a troca." */
export const LONG_CYCLE_DAY_PURPOSE = 'quando foi a troca';

export const longCycleRowSubtitle = (houseName: string | null) =>
  houseName ? `${houseName} · ${LONG_CYCLE_ROW_SUBTITLE}` : LONG_CYCLE_ROW_SUBTITLE;
export const longCycleOptionsLabel = (name: string) => `Opções de ${name}`;
export const longCycleAddLabel = (name: string) => `Pôr ${name} na lista`;

/** "1 mês", "3 meses", "1 ano", "1 ano e meio", "2 anos e meio", "1 ano e 1 mês": a mesma forma nos chips e nas frases. */
export function longCycleMonthsText(months: number): string {
  if (months < 12) return months === 1 ? '1 mês' : `${months} meses`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const head = years === 1 ? '1 ano' : `${years} anos`;
  if (rest === 0) return head;
  if (rest === 6) return `${head} e meio`;
  return `${head} e ${rest === 1 ? '1 mês' : `${rest} meses`}`;
}

/** "todo mês", "todo ano", "a cada 3 meses" (a forma de describeRecurrence). */
export function longCycleEvery(months: number): string {
  if (months === 1) return 'todo mês';
  if (months === 12) return 'todo ano';
  return `a cada ${longCycleMonthsText(months)}`;
}

/** Há quanto tempo: "hoje", "há 1 dia", "há 20 dias", "há 4 meses", "há 1 ano e meio" (meses inteiros, por addMonths). */
export function longCycleWhen(from: string, today: string): string {
  if (from >= today) return 'hoje';
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = today.split('-').map(Number);
  let months = (ty - fy) * 12 + (tm - fm);
  while (months > 0 && addMonths(from, months) > today) months -= 1;
  if (months === 0) {
    const days = diffDays(from, today);
    return days === 1 ? 'há 1 dia' : `há ${days} dias`;
  }
  return `há ${longCycleMonthsText(months)}`;
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "Última compra há 4 meses · trocar a cada 3 meses" (a linha do Hoje e a mensagem das opções). */
export function describeLongCycle(state: Pick<LongCycleState, 'last' | 'months'>, today: string): string {
  const every = `trocar ${longCycleEvery(state.months)}`;
  if (!state.last) return capitalized(every);
  return `Última ${state.last.via} ${longCycleWhen(state.last.day, today)} · ${every}`;
}

/** A linha da tela dos prazos: o prazo ("A cada 3 meses (prazo da casa)"), depois o estado. */
export function longCycleRowText(state: Pick<LongCycleState, 'last' | 'months' | 'custom' | 'status'>, today: string): string {
  const period = `${capitalized(longCycleEvery(state.months))}${state.custom ? ' (prazo da casa)' : ''}`;
  const last = state.last ? `última ${state.last.via} ${longCycleWhen(state.last.day, today)}` : null;
  switch (state.status) {
    case 'sem_compra':
      return `${period} · nenhuma compra pelo app`;
    case 'parou':
      return `${period} · ${last} (já não aparece em Hoje)`;
    default:
      // "off": o selo diz "Não sugerido"; "trocar": o selo diz "Hora de trocar".
      return last ? `${period} · ${last}` : period;
  }
}

export const longCycleDefaultLine = (months: number) => `O padrão do Kotii é ${longCycleMonthsText(months)}.`;
export const longCycleDefaultChipLabel = (months: number) => `${longCycleMonthsText(months)}, o padrão do Kotii`;

export const longCycleReplacedNotice = (name: string) => `${name}: troca anotada hoje.`;
export const longCycleOffNotice = (name: string) =>
  `${name} não vai mais aparecer aqui. Para voltar, abra Configurações → Casa → Prazos de troca.`;
export const longCyclePeriodNotice = (name: string, months: number) => `${name}: agora ${longCycleEvery(months)}.`;

export function longCycleNotice(kind: LongCycleUndoKind, name: string, months: number): string {
  if (kind === 'replaced') return longCycleReplacedNotice(name);
  if (kind === 'off') return longCycleOffNotice(name);
  return longCyclePeriodNotice(name, months);
}

export function longCycleUndoLabel(kind: LongCycleUndoKind, name: string): string {
  if (kind === 'replaced') return `Desfazer a troca de ${name}`;
  if (kind === 'off') return `Voltar a sugerir ${name}`;
  return `Voltar ao prazo de antes de ${name}`;
}

export const longCycleSeeMore = (hidden: number) => (hidden === 1 ? 'Ver o outro (1)' : `Ver os outros (${hidden})`);
export const longCycleSeeMoreLabel = (hidden: number) =>
  hidden === 1 ? 'Ver o outro item na hora de trocar' : `Ver os outros ${hidden} itens na hora de trocar`;

/** O aparelho com a data fora do que o banco aceita (APP_MIN_DATE..APP_MAX_DATE): o aviso, antes de gravar. */
export const longCycleDayError = (today: string) => deviceDayError(today, LONG_CYCLE_DAY_PURPOSE);

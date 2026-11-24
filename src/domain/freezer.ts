// Congelador da despensa: a compra que vai para o congelador ganha a validade do congelador (o dia em que foi
// congelada + o tempo do tipo dela), e "Descongelei" volta a contar a validade de antes de onde ela parou. As regras e
// todas as frases ficam aqui; os dados, em data/freezer.ts. O banco tem a palavra final sobre a data
// (pantry_freeze_days e o gatilho pantry_items_freezer_expiry, em 20261124173722_pantry_freezer.sql): o que o app
// calcula aqui é a prévia, que bate com a de lá porque os tempos são os mesmos (um teste lê a migração).

import { joinNames } from './cartPantry';
import { addDays, diffDays, formatShortDate } from './dates';
import { hasAnyWord } from './nameWords';
import { isFrozen, PANTRY_CHANGED, PANTRY_CHANGED_TITLE, type ExpiryEstimate, type ExpirySource, type PantryLot } from './pantry';
import { itemIdentity, spelledOut } from './sameItem';

export { isFrozen };

/** O tipo do alimento na tabela do congelador. */
export type FreezeKind = 'carne' | 'frango' | 'carne_moida' | 'peixe' | 'pao' | 'frios';

export interface FreezeKindInfo {
  key: FreezeKind;
  /** Como a frase chama o tipo: "90 dias para frango". */
  noun: string;
  /** Quantos dias fica bom no congelador, contados de quando foi congelado. */
  days: number;
  /** A revisão da nota pergunta "Congelou?" para este tipo (carnes e peixes). */
  askOnReceipt: boolean;
}

/**
 * A tabela do congelador (decisão do dono de 2026-11-21: um tempo fixo por tipo, contado do dia em que foi
 * congelado). É a única: não há tempos por casa. O mesmo case está em pantry_freeze_days, no banco.
 */
export const FREEZE_KINDS: readonly FreezeKindInfo[] = [
  { key: 'carne', noun: 'carne bovina e suína', days: 90, askOnReceipt: true },
  { key: 'frango', noun: 'frango', days: 90, askOnReceipt: true },
  { key: 'carne_moida', noun: 'carne moída', days: 60, askOnReceipt: true },
  { key: 'peixe', noun: 'peixe e frutos do mar', days: 60, askOnReceipt: true },
  { key: 'pao', noun: 'pão', days: 60, askOnReceipt: false },
  { key: 'frios', noun: 'frios e embutidos', days: 30, askOnReceipt: false },
];

export type FreezeDays = Readonly<Record<FreezeKind, number>>;

/** Os dias de cada tipo, como o banco calcula. */
export const DEFAULT_FREEZE_DAYS: FreezeDays = Object.fromEntries(FREEZE_KINDS.map((k) => [k.key, k.days])) as Record<
  FreezeKind,
  number
>;

const info = (kind: FreezeKind) => FREEZE_KINDS.find((k) => k.key === kind)!;

export const isFreezeKind = (value: unknown): value is FreezeKind => FREEZE_KINDS.some((k) => k.key === value);

/** A compra já esteve no congelador (está nele ou saiu dele). */
export const wasFrozen = (lot: { frozen_on?: string | null }): boolean => Boolean(lot.frozen_on);

/**
 * A cópia da compra traz as colunas do congelador: a cópia guardada de antes desta versão, ou a leitura que repetiu
 * sem elas (o cache de esquema da API ainda sem as colunas), não traz, e congelar fica de fora até chegar uma que traga.
 */
export const hasFreezerFields = (lot: { frozen_on?: string | null }): boolean => lot.frozen_on !== undefined;

// ---------------------------------------------------------------------------
// O tipo pelo nome

// Palavras inteiras do nome (de spelledOut), no singular.
const GROUND: ReadonlySet<string> = new Set(['moido', 'moida', 'kafta', 'quibe', 'kibe', 'almondega']);
const FRANGO_WORDS: ReadonlySet<string> = new Set(['frango', 'galinha', 'galeto', 'moela', 'chester']);
const CANNED: ReadonlySet<string> = new Set([
  'lata', 'enlatado', 'enlatada', 'ralado', 'ralada', 'solido', 'solida', 'pedaco', 'conserva', 'oleo', 'molho', 'natural',
]);
const FRESH_FISH: ReadonlySet<string> = new Set(['fresco', 'fresca', 'posta', 'inteiro', 'inteira']);
// Os embutidos que o vocabulário conhece: vão como frios.
const EMBUTIDOS: ReadonlySet<string> = new Set(['linguica', 'salsicha', 'bacon', 'presunto', 'peito_peru', 'mortadela', 'salame']);
// Os itens compostos (o item com a palavra que faz outra coisa) que ainda vão ao congelador como o item.
const FREEZABLE_COMPOSITES: ReadonlyMap<string, FreezeKind> = new Map([['pao+doce', 'pao']]);

type Reading = { kind: FreezeKind | null; known: boolean };

/** O tipo pelo vocabulário do "mesmo item" (regras 1 a 11), ou, sem item conhecido, pela categoria (regra 13). */
function read(name: string, category: string, unit?: string | null): Reading {
  // 1. Comprado congelado: já tem os 90 dias da categoria.
  if (category === 'congelados') return { kind: null, known: true };
  const text = spelledOut(name);
  if (!text) return { kind: null, known: false };
  const ground = hasAnyWord(text, GROUND);
  const frangoWords = hasAnyWord(text, FRANGO_WORDS);
  const meat = (): FreezeKind => (ground ? 'carne_moida' : frangoWords ? 'frango' : 'carne');
  const identity = itemIdentity(name, category);
  if (identity) {
    const { key, family } = identity;
    // 3. Composto: outra coisa ("Frango empanado", "Pão de alho"), fora o pão doce.
    if (key.includes('+')) return { kind: FREEZABLE_COMPOSITES.get(key) ?? null, known: true };
    // 4. Frango.
    if (key === 'frango' || family === 'frango') return { kind: ground ? 'carne_moida' : 'frango', known: true };
    // 5. Hambúrguer.
    if (key === 'hamburguer') return { kind: 'carne_moida', known: true };
    // 6. Embutidos.
    if (EMBUTIDOS.has(key)) return { kind: 'frios', known: true };
    // 7. Carne: moída, de frango ("Fígado de frango") ou carne.
    if (key === 'carne' || family === 'carne') return { kind: meat(), known: true };
    // 8. Peixe e frutos do mar.
    if (family === 'peixe' || key === 'peixe' || key === 'camarao') return { kind: 'peixe', known: true };
    // 9. Atum e sardinha: só os frescos (a lata é o comum).
    if (key === 'atum' || key === 'sardinha') {
      if (hasAnyWord(text, CANNED)) return { kind: null, known: true };
      const fresh = category === 'peixes' && (unit === 'kg' || unit === 'g' || hasAnyWord(text, FRESH_FISH));
      return { kind: fresh ? 'peixe' : null, known: true };
    }
    // 10. Pão.
    if (key === 'pao' || family === 'pao') return { kind: 'pao', known: true };
    // 11. Outro item conhecido: pão de queijo, bolo, torrada, queijo, nuggets…
    return { kind: null, known: true };
  }
  // 13. Sem item conhecido, pela categoria.
  switch (category) {
    case 'carnes':
      return { kind: meat(), known: false };
    case 'peixes':
      return { kind: hasAnyWord(text, CANNED) ? null : 'peixe', known: false };
    case 'frios':
      return { kind: 'frios', known: false };
    case 'padaria':
      return { kind: ground ? null : 'pao', known: false };
    default:
      return { kind: null, known: false };
  }
}

/** O tipo do congelador de um nome, ou null quando não vai ao congelador por aqui. */
export function freezeKind(name: string, category: string, unit?: string | null): FreezeKind | null {
  return read(name, category, unit).kind;
}

/**
 * O tipo pelos nomes de uma compra (o produto, o sugerido, o impresso na nota): o primeiro nome que o vocabulário
 * conhece decide, antes de qualquer palpite pela categoria ("Filé de peito" com "FILE PEITO FGO SADIA" é frango);
 * sem nenhum conhecido, a categoria pelo primeiro nome que não está vazio.
 */
export function freezeKindOf(
  names: readonly (string | null | undefined)[],
  category: string,
  unit?: string | null,
): FreezeKind | null {
  const filled = names.flatMap((name) => (name && name.trim() ? [name] : []));
  for (const name of filled) {
    const reading = read(name, category, unit);
    if (reading.known) return reading.kind;
  }
  return filled.length ? read(filled[0], category, unit).kind : null;
}

/**
 * A revisão da nota pergunta "Congelou?": carne, frango, carne moída e peixe; e, na categoria carnes ou peixes,
 * qualquer tipo (a linguiça comprada no açougue, com os 30 dias dos frios). Pão e frios comprados como frios não:
 * congelam depois, na despensa.
 */
export const asksFrozenOnReceipt = (kind: FreezeKind | null, category: string): boolean =>
  kind != null && (info(kind).askOnReceipt || category === 'carnes' || category === 'peixes');

const FROZEN_WORDS: ReadonlySet<string> = new Set(['congelado', 'congelada']);

/** O nome diz que foi comprado congelado ("FILE TILAPIA CONG"): a linha já começa com "Congelei" marcado. */
export function boughtFrozen(names: readonly (string | null | undefined)[]): boolean {
  return names.some((name) => Boolean(name) && hasAnyWord(spelledOut(name!), FROZEN_WORDS));
}

// ---------------------------------------------------------------------------
// As datas

/** Uma validade e de onde ela veio. */
export interface Fresh {
  expiresOn: string | null;
  source: ExpirySource | null;
}

/**
 * A validade no congelador: o dia em que foi congelado + o tempo do tipo. A que já tinha passado antes desse dia
 * fica como estava (o congelador não devolve a validade a quem já venceu), com a origem dela.
 */
export function frozenExpiryFor({
  frozenOn,
  fresh,
  kind,
  days,
}: {
  frozenOn: string;
  fresh: Fresh;
  kind: FreezeKind;
  days: FreezeDays;
}): Fresh {
  if (fresh.expiresOn && fresh.expiresOn < frozenOn) return fresh;
  return { expiresOn: addDays(frozenOn, days[kind]), source: 'congelado' };
}

/**
 * Descongelar: o congelador pausa a validade. O que faltava quando foi congelada (ou o quanto já tinha passado)
 * volta a contar do dia em que saiu, com a origem `descongelado`; sem validade de antes, fica sem. No mesmo dia em
 * que foi congelada (ou antes), desfaz (`undo`): a compra volta a ser o que era, com a validade de antes. A que
 * nunca tinha ido ao congelador volta sem ele; a descongelada que voltou para ele volta a ser a descongelada (o
 * banco guarda os dias dela, prev_frozen_on e prev_thawed_on, e devolve frozen_on), e segue sem ensinar o produto.
 * thaw_pantry_items é o espelho da validade.
 */
export function thawedExpiry(
  lot: { frozen_on: string; fresh_expires_on?: string | null; fresh_expiry_source?: ExpirySource | null },
  thawOn: string,
): { expiresOn: string | null; source: ExpirySource | null; undo: boolean } {
  if (thawOn <= lot.frozen_on) {
    return { expiresOn: lot.fresh_expires_on ?? null, source: lot.fresh_expiry_source ?? null, undo: true };
  }
  if (!lot.fresh_expires_on) return { expiresOn: null, source: null, undo: false };
  return { expiresOn: addDays(thawOn, diffDays(lot.frozen_on, lot.fresh_expires_on)), source: 'descongelado', undo: false };
}

/** Uma escolha do menu da despensa: o texto e o dia mandado ao banco. */
export interface FreezeChoice {
  label: string;
  frozenOn: string;
}

/** O dia em que a compra saiu do congelador, quando foi depois do dia da compra (a descongelada de volta à despensa). */
const thawedAfterPurchase = (lot: Pick<PantryLot, 'purchased_on' | 'thawed_on'>): string | null =>
  lot.thawed_on && lot.thawed_on > lot.purchased_on ? lot.thawed_on : null;

/**
 * As escolhas de "Congelar" no menu de um grupo, pelo dia mais cedo em que cada compra pode ter ido para o
 * congelador: o da compra, ou o dia em que saiu dele (o banco nunca congela antes disso, freeze_pantry_items, e o
 * formulário também não, frozenOnFits). Todas podem só hoje: "Congelar". Senão "Congelei hoje" e, comprado antes,
 * "Congelei no dia da compra" (o dia dela; com compras de dias diferentes, "no dia de cada compra", que manda o dia
 * da mais antiga: o banco congela cada uma no dia dela). A descongelada não foi para o congelador no dia da compra:
 * com todas descongeladas no mesmo dia, "Congelei no dia em que descongelou"; misturada com outras, só "Congelei
 * hoje" (outro dia, no item).
 */
export function freezeChoices(lots: readonly Pick<PantryLot, 'purchased_on' | 'thawed_on'>[], today: string): FreezeChoice[] {
  if (!lots.length) return [];
  const several = lots.length > 1;
  const all = several ? ' (tudo)' : '';
  const tudo = several ? ', tudo' : '';
  const thawed = lots.map(thawedAfterPurchase);
  const days = [...new Set(lots.map((lot, i) => thawed[i] ?? lot.purchased_on))].sort();
  if (days[0] >= today) return [{ label: `Congelar${all}`, frozenOn: today }];
  const year = Number(today.slice(0, 4));
  const now = { label: `Congelei hoje${all}`, frozenOn: today };
  if (thawed.some(Boolean)) {
    if (days.length > 1 || !thawed.every(Boolean)) return [now];
    return [now, { label: `Congelei no dia em que descongelou (${formatShortDate(days[0], year)}${tudo})`, frozenOn: days[0] }];
  }
  if (days.length === 1) {
    return [now, { label: `Congelei no dia da compra (${formatShortDate(days[0], year)}${tudo})`, frozenOn: days[0] }];
  }
  return [now, { label: 'Congelei no dia de cada compra (tudo)', frozenOn: days[0] }];
}

// ---------------------------------------------------------------------------
// O formulário da compra

/** As colunas do congelador numa gravação da despensa. */
export interface FreezerFields {
  frozen_on: string | null;
  thawed_on: string | null;
  freeze_kind: FreezeKind | null;
  fresh_expires_on: string | null;
  fresh_expiry_source: ExpirySource | null;
}

/** A cópia da compra que o formulário abriu (as colunas do congelador faltam numa cópia de antes da migração). */
export interface FreezerCopy {
  expires_on: string | null;
  expiry_source?: ExpirySource | null;
  frozen_on?: string | null;
  thawed_on?: string | null;
  freeze_kind?: string | null;
  fresh_expires_on?: string | null;
  fresh_expiry_source?: ExpirySource | null;
}

export interface PantryFormFreezeInput {
  /** A cópia; null para um item novo. */
  item: FreezerCopy | null;
  /** "Congelei" ligado num item fora do congelador. */
  freezing: boolean;
  /** "Congelado em", já conferido. */
  frozenOn: string | null;
  kind: FreezeKind | null;
  /** A validade estimada do formulário (estimateExpiry). */
  estimate: ExpiryEstimate | null;
  /** A data digitada antes de ligar "Congelei" (null: apagada); undefined quando não digitou. */
  freshTyped?: string | null;
  /** A data digitada agora no campo (null: apagada); undefined quando não digitou. */
  expiryTyped?: string | null;
  days: FreezeDays;
}

export interface PantryFormFreeze {
  expires_on: string | null;
  expiry_source: ExpirySource | null;
  /** Só com o item congelando agora (as cinco) ou já no congelador (o dia e o tipo); vazio no resto. */
  freezer: Partial<FreezerFields>;
}

const typedFresh = (typed: string | null): Fresh => ({ expiresOn: typed, source: typed ? 'manual' : null });
const withSource = (fresh: Fresh): Fresh => ({ expiresOn: fresh.expiresOn, source: fresh.expiresOn ? fresh.source : null });

/**
 * O que o formulário da despensa grava da validade e do congelador. Congelando agora: a validade de antes é a data
 * digitada antes de ligar "Congelei" (vira `manual`, e é dela que o descongelar conta), senão a da cópia, senão a
 * estimada; a do campo é a do congelador, ou a digitada com "Congelei" ligado (`manual`). Já no congelador: o dia e
 * o tipo, e a validade digitada, a que alguém já tinha digitado, ou a do congelador refeita com o dia do campo. Fora
 * do congelador: a regra de sempre, e nenhuma coluna do congelador.
 */
export function pantryFormFreeze(input: PantryFormFreezeInput): PantryFormFreeze {
  const { item, freezing, frozenOn, kind, estimate, freshTyped, expiryTyped, days } = input;
  const finish = (expiry: Fresh, freezer: Partial<FreezerFields>): PantryFormFreeze => {
    const shown = withSource(expiry);
    return { expires_on: shown.expiresOn, expiry_source: shown.source, freezer };
  };
  if (item && isFrozen(item) && frozenOn && kind) {
    const freezer = { frozen_on: frozenOn, freeze_kind: kind };
    if (expiryTyped !== undefined) return finish(typedFresh(expiryTyped), freezer);
    if (item.expiry_source === 'manual') return finish({ expiresOn: item.expires_on, source: 'manual' }, freezer);
    const fresh = { expiresOn: item.fresh_expires_on ?? null, source: item.fresh_expiry_source ?? null };
    return finish(frozenExpiryFor({ frozenOn, fresh, kind, days }), freezer);
  }
  if (freezing && frozenOn && kind) {
    const fresh = withSource(
      freshTyped !== undefined
        ? typedFresh(freshTyped)
        : item
          ? { expiresOn: item.expires_on, source: item.expiry_source ?? null }
          : { expiresOn: estimate?.expiresOn ?? null, source: estimate?.source ?? null },
    );
    const freezer: FreezerFields = {
      frozen_on: frozenOn,
      thawed_on: null,
      freeze_kind: kind,
      fresh_expires_on: fresh.expiresOn,
      fresh_expiry_source: fresh.source,
    };
    const expiry = expiryTyped !== undefined ? typedFresh(expiryTyped) : frozenExpiryFor({ frozenOn, fresh, kind, days });
    return finish(expiry, freezer);
  }
  const expiry =
    expiryTyped !== undefined
      ? typedFresh(expiryTyped)
      : item
        ? { expiresOn: item.expires_on, source: item.expiry_source ?? null }
        : { expiresOn: estimate?.expiresOn ?? null, source: estimate?.source ?? null };
  return finish(expiry, {});
}

/**
 * O dia de "Congelado em" serve: uma data entre a compra (ou o dia em que saiu do congelador, quando já saiu) e hoje.
 */
export function frozenOnFits(frozenOn: string | null, { purchasedOn, thawedOn, today }: { purchasedOn: string | null; thawedOn?: string | null; today: string }): boolean {
  if (!frozenOn) return false;
  const from = [purchasedOn, thawedOn].filter((d): d is string => Boolean(d)).sort().at(-1);
  return (!from || frozenOn >= from) && frozenOn <= today;
}

// ---------------------------------------------------------------------------
// "Já está na despensa" respondido "Não colocar"

/** As compras do carrinho que uma linha "Congelei" da nota repete: congeladas depois da confirmação. */
export interface RepeatFreeze {
  kind: FreezeKind;
  frozenOn: string;
  ids: string[];
  names: string[];
}

/**
 * Sem colocar de novo, a linha "Congelei" da nota perde a despensa, e o congelador com ela: congela a compra do
 * carrinho que ela repete (`entryId`), no dia da compra da nota, agrupada por tipo e dia (um pedido por grupo).
 */
export function repeatFreezes(
  repeats: readonly { id: string; name: string; entryId?: string }[],
  payload: readonly { id: string; pantry?: { frozen_on?: string | null; freeze_kind?: string | null } | null }[],
): RepeatFreeze[] {
  const groups = new Map<string, RepeatFreeze>();
  for (const repeat of repeats) {
    if (!repeat.entryId) continue;
    const pantry = payload.find((line) => line.id === repeat.id)?.pantry;
    if (!pantry?.frozen_on || !isFreezeKind(pantry.freeze_kind)) continue;
    const key = `${pantry.freeze_kind}|${pantry.frozen_on}`;
    const group = groups.get(key) ?? { kind: pantry.freeze_kind, frozenOn: pantry.frozen_on, ids: [], names: [] };
    if (!group.ids.includes(repeat.entryId)) group.ids.push(repeat.entryId);
    if (!group.names.includes(repeat.name)) group.names.push(repeat.name);
    groups.set(key, group);
  }
  return [...groups.values()];
}

// ---------------------------------------------------------------------------
// Frases

const shortDate = (iso: string, today: string) => formatShortDate(iso, Number(today.slice(0, 4)));

export const FROZEN_QUESTION = 'Congelou?';
export const FROZEN_CHIP = 'Congelei';
/** O "Congelei" de uma linha da nota, para o leitor de tela: "Congelei: FILE TILAPIA CONG". */
export const frozenChipLabel = (raw: string) => `${FROZEN_CHIP}: ${raw}`;
export const FREEZER_SECTION = 'No congelador';
export const FROZEN_ON_LABEL = 'Congelado em';
export const THAW_ACTION = 'Descongelei';
export const FROZEN_ROW_SUBTITLE = 'No congelador';
export const thawedRowSubtitle = (thawedOn: string, today: string) => `Descongelado em ${shortDate(thawedOn, today)}`;
export const thawedSuffix = (thawedOn: string, today: string) => ` · descongelado em ${shortDate(thawedOn, today)}`;
export const frozenFormLine = (frozenOn: string, today: string) => `No congelador desde ${shortDate(frozenOn, today)}.`;
export const thawedFormLine = (thawedOn: string, today: string) => `Descongelado em ${shortDate(thawedOn, today)}.`;

export const FROZEN_TITLE = 'No congelador';
export const THAWED_TITLE = 'Descongelado';
export const FROZEN_ON_INVALID_TITLE = 'Data inválida';
export const FROZEN_ON_INVALID =
  'Confira a data em que foi congelado (dd/mm/aaaa): não pode ser antes da compra nem depois de hoje.';
export const FREEZE_PARTIAL = 'Parte foi para o congelador; o resto mudou em outro aparelho. Confira a despensa.';
export const THAW_PARTIAL = 'Parte saiu do congelador; o resto mudou em outro aparelho. Confira a despensa.';
export const PANTRY_ITEM_CHANGED = 'Este item da despensa mudou em outro aparelho e nada foi salvo. Abra de novo e confira.';
export const FREEZER_NOT_READY = 'O congelador da despensa ainda está sendo ativado no Kotii. Tente de novo mais tarde.';
/** O fim da frase de deviceDayError (domain/dates) antes de congelar ou descongelar. */
export const FREEZER_DAY_PURPOSE = 'o dia do congelador';

/** Uma compra como congelar e descongelar devolvem. */
export interface FreezerRow {
  id: string;
  expiresOn: string | null;
  expirySource: ExpirySource | null;
  /** null depois de um descongelar no mesmo dia (desfeito), menos o da descongelada que tinha voltado ao congelador. */
  frozenOn: string | null;
}

/**
 * Uma compra como descongelar devolve: `undone` quando o banco desfez (descongelada no dia em que foi congelada, ou
 * antes; item_undone de thaw_pantry_items). frozenOn não diz isso: a descongelada que tinha voltado ao congelador e
 * sai no mesmo dia volta com o dia em que foi congelada antes.
 */
export interface ThawedRow extends FreezerRow {
  undone: boolean;
}

export const FROZEN_SOME_KEPT = ' O que já tinha passado da validade ficou como estava.';

/** Tudo já tinha passado da validade quando foi para o congelador. */
export const frozenKeptText = (name: string, expiresOn: string, today: string) =>
  `${name} foi para o congelador, mas já tinha passado da validade (${shortDate(expiresOn, today)}), e ela fica como estava. Se congelou antes disso, corrija "Congelado em" no item.`;

const earliest = (dates: readonly (string | null)[]) => dates.filter((d): d is string => Boolean(d)).sort()[0] ?? null;

/** O aviso de "Congelar": a validade estimada mais próxima, e o que ficou como estava. */
export function frozenText(name: string, rows: readonly FreezerRow[], today: string): string {
  const moved = rows.filter((row) => row.expirySource === 'congelado');
  if (!moved.length) {
    const kept = earliest(rows.map((row) => row.expiresOn));
    return kept ? frozenKeptText(name, kept, today) : `${name} foi para o congelador.`;
  }
  const date = earliest(moved.map((row) => row.expiresOn));
  const base = date ? `${name} foi para o congelador. Validade estimada: ${shortDate(date, today)}.` : `${name} foi para o congelador.`;
  return moved.length < rows.length ? `${base}${FROZEN_SOME_KEPT}` : base;
}

/** Uma saída do congelador, feita (o que o banco devolveu) ou prevista (thawedExpiry): a validade e se desfez. */
interface ThawOutcome {
  expiresOn: string | null;
  undo: boolean;
}

/**
 * A saída de que o aviso e a prévia falam: a que vence primeiro (sem validade por último; na mesma data, a
 * desfeita). Uma regra só para as duas frases, para o aviso dizer o que a prévia prometeu.
 */
function firstThaw<T extends ThawOutcome>(outcomes: readonly T[]): T | undefined {
  return [...outcomes].sort(
    (a, b) => (a.expiresOn ?? '9999-12-31').localeCompare(b.expiresOn ?? '9999-12-31') || Number(b.undo) - Number(a.undo),
  )[0];
}

/**
 * O aviso de "Descongelei", pela compra que vence primeiro, como a prévia (thawPreviewText): desfeita (a validade
 * de antes, digitada ou não), a validade que volta a contar, ou sem validade.
 */
export function thawedText(name: string, rows: readonly ThawedRow[], today: string): string {
  const first = firstThaw(rows.map((row) => ({ expiresOn: row.expiresOn, undo: row.undone })));
  if (first?.undo) return `${name} saiu do congelador, com a validade de antes.`;
  const date = first?.expiresOn;
  if (!date) return `${name} saiu do congelador.`;
  return date >= today
    ? `${name} saiu do congelador. A validade volta a contar de onde parou: vence por volta de ${shortDate(date, today)}.`
    : `${name} saiu do congelador. A validade volta a contar de onde parou, e ela já tinha passado (${shortDate(date, today)}).`;
}

/** O aviso depois de congelar `asked` compras: todas, parte (o resto mudou em outro aparelho) ou nenhuma. */
export function freezeNotice(name: string, asked: number, rows: readonly FreezerRow[], today: string): { title: string; message: string } {
  if (!rows.length) return { title: PANTRY_CHANGED_TITLE, message: PANTRY_CHANGED };
  if (rows.length < asked) return { title: PANTRY_CHANGED_TITLE, message: FREEZE_PARTIAL };
  return { title: FROZEN_TITLE, message: frozenText(name, rows, today) };
}

/** O aviso depois de descongelar `asked` compras. */
export function thawNotice(name: string, asked: number, rows: readonly ThawedRow[], today: string): { title: string; message: string } {
  if (!rows.length) return { title: PANTRY_CHANGED_TITLE, message: PANTRY_CHANGED };
  if (rows.length < asked) return { title: PANTRY_CHANGED_TITLE, message: THAW_PARTIAL };
  return { title: THAWED_TITLE, message: thawedText(name, rows, today) };
}

type FrozenLot = { frozen_on?: string | null; fresh_expires_on?: string | null; fresh_expiry_source?: ExpirySource | null };

/** O que descongelar hoje faria, pela compra cuja validade vem primeiro: "Se descongelar hoje: vence por volta de 23 nov." */
export function thawPreviewText(lots: readonly FrozenLot[], today: string): string | null {
  const previews = lots.flatMap((lot) =>
    lot.frozen_on
      ? [thawedExpiry({ frozen_on: lot.frozen_on, fresh_expires_on: lot.fresh_expires_on, fresh_expiry_source: lot.fresh_expiry_source }, today)]
      : [],
  );
  const first = firstThaw(previews);
  if (!first) return null;
  if (first.undo) return 'Se descongelar hoje, volta para a validade de antes.';
  if (!first.expiresOn) return 'Se descongelar hoje, fica sem validade.';
  return first.expiresOn >= today
    ? `Se descongelar hoje: vence por volta de ${shortDate(first.expiresOn, today)}.`
    : `Se descongelar hoje, a validade já tinha passado (${shortDate(first.expiresOn, today)}).`;
}

/** O texto do menu de um grupo no congelador: desde quando, e o que descongelar hoje faria. */
export function frozenSheetText(lots: readonly FrozenLot[], today: string): string {
  const since = earliest(lots.map((lot) => lot.frozen_on ?? null));
  const preview = thawPreviewText(lots, today);
  return [since ? frozenFormLine(since, today) : null, preview].filter(Boolean).join(' ');
}

/**
 * "A nota foi salva, mas não deu para marcar Frango e Peixe como congelados." O que fazer aponta para o menu do item,
 * sem dizer o nome da escolha: ela muda com o dia da compra ("Congelar" só para o que foi comprado hoje; senão
 * "Congelei hoje" e "Congelei no dia da compra", freezeChoices), e a compra do carrinho costuma ser de outro dia.
 */
export function repeatFreezeFailedText(names: readonly string[]): string {
  const several = names.length > 1;
  return `A nota foi salva, mas não deu para marcar ${joinNames([...names])} como ${several ? 'congelados' : 'congelado'}. Em Compras > Despensa, toque ${several ? 'em cada item' : 'no item'} e escolha quando ele foi para o congelador.`;
}

/** No formulário, a validade estimada pelo congelador. */
export const frozenExpiryHint = (kind: FreezeKind, days: FreezeDays) =>
  `Estimada pelo congelador: ${days[kind]} dias para ${info(kind).noun}, contados de quando foi congelado. Se corrigir, fica só neste item.`;
/** No formulário, a compra que já esteve no congelador: corrigir a validade não ensina o produto. */
export const THAWED_EXPIRY_HINT = 'Este item já foi congelado: se corrigir a validade, ela fica só nele.';
/** Na revisão da nota, a linha marcada "Congelei" sem data digitada. */
export const frozenReceiptHint = (kind: FreezeKind, days: FreezeDays) =>
  `Validade estimada no congelador (${info(kind).noun}: ${days[kind]} dias) — ajuste se quiser.`;

export const THAW_UNSAVED_TITLE = 'Descongelar agora?';
export const THAW_UNSAVED_MESSAGE = 'O que você mudou neste item e ainda não salvou vai se perder.';
export const THAW_UNSAVED_CONFIRM = 'Descongelar';

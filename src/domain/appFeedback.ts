// Recados para quem faz o Kotii (app_feedback, migração 20261024150000_app_feedback.sql): o que a pessoa diz do
// próprio app pelo Nuke (um problema, uma sugestão, um elogio ou outra coisa), que só vai depois do toque dela em
// "Enviar", e a caixa de entrada de quem mantém o app, na aba Recados do Painel do app. Aqui ficam o vocabulário
// (os mesmos tipos, situações e limites da migração: __tests__/appFeedback confere), as frases, a leitura
// defensiva da resposta (parseFeedbackList, parseFeedbackItem), o filtro e a busca (filterFeedback) e tudo o que
// a caixa de entrada mostra (feedbackInboxView, feedbackDetail). As telas só desenham.

import { normalizeSearch } from './search';

// ---------------------------------------------------------------------------
// Vocabulário (o mesmo da migração e da função nuke)

/** Os tipos de recado, na ordem dos filtros: a coluna app_feedback.kind e o FEEDBACK_KINDS da função nuke. */
export const FEEDBACK_KINDS = ['problema', 'sugestao', 'elogio', 'outro'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = {
  problema: 'Problema',
  sugestao: 'Sugestão',
  elogio: 'Elogio',
  outro: 'Outro',
};

/** A situação de um recado na caixa de entrada; todo recado chega `novo`. */
export const FEEDBACK_STATUSES = ['novo', 'lido', 'resolvido', 'arquivado'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  novo: 'Novo',
  lido: 'Lido',
  resolvido: 'Resolvido',
  arquivado: 'Arquivado',
};

/** De onde o recado foi mandado (Platform.OS do app; a coluna aceita só estes). */
export const FEEDBACK_PLATFORMS = ['web', 'ios', 'android'] as const;
export type FeedbackPlatform = (typeof FEEDBACK_PLATFORMS)[number];

export const FEEDBACK_PLATFORM_LABELS: Record<FeedbackPlatform, string> = {
  web: 'Navegador',
  ios: 'iPhone/iPad',
  android: 'Android',
};

/** O tamanho máximo do recado e da nota, em caracteres (char_length no banco: conta um emoji como um). */
export const FEEDBACK_MAX_LENGTH = 2000;

/** Recados de uma pessoa em 24 horas (janela que corre); o próximo é recusado com NK015. */
export const FEEDBACK_DAILY_LIMIT = 10;

/** Quantos recados a caixa de entrada pede de uma vez (o padrão de app_feedback_list, que aceita de 1 a 500). */
export const FEEDBACK_LIST_LIMIT = 200;

/** O título de uma linha da caixa de entrada: a primeira linha do recado, cortada perto daqui. */
export const FEEDBACK_TITLE_MAX = 90;

// ---------------------------------------------------------------------------
// Frases

/** Embaixo do cartão do Nuke: quem lê o recado. */
export const FEEDBACK_DISCLOSURE = 'Vai para quem faz o Kotii, com o seu e-mail, para poder te responder.';

/** Depois do toque em "Enviar". */
export const FEEDBACK_SENT = 'Recado enviado. Obrigado!';

/** O banco ainda sem a migração dos recados (send_app_feedback não existe). */
export const FEEDBACK_NOT_READY = 'Ainda não dá para mandar recados por aqui. Tente de novo mais tarde.';

/** A recusa NK015: a mesma frase do servidor. */
export const FEEDBACK_LIMIT = `Você já mandou ${FEEDBACK_DAILY_LIMIT} recados nas últimas 24 horas. Tente de novo amanhã.`;

/** A caixa de entrada com o banco ainda sem a migração (app_feedback_list não existe). */
export const FEEDBACK_INBOX_NOT_READY = 'Os recados ainda não estão disponíveis: falta aplicar a migração dos recados no banco.';

/** A recusa P0002 de set_app_feedback: a mesma frase do servidor. */
export const FEEDBACK_GONE = 'Este recado não existe mais.';

/** A resposta da rpc veio num formato que esta versão do app não lê. */
export const FEEDBACK_INVALID = 'Os recados chegaram num formato que esta versão do app não entende. Atualize o app e tente de novo.';

/** A recusa de uma nota longa demais: a mesma frase do servidor. */
export const FEEDBACK_NOTE_TOO_LONG = `A nota pode ter até ${FEEDBACK_MAX_LENGTH} caracteres.`;

export const FEEDBACK_SEARCH_PLACEHOLDER = 'Buscar no texto, no e-mail ou na nota';
export const FEEDBACK_NOTE_LABEL = 'Nota (só você vê)';
export const FEEDBACK_NOTE_PLACEHOLDER = 'Ex.: corrigido na próxima versão';
export const FEEDBACK_NOTE_SAVE = 'Salvar nota';
export const FEEDBACK_REPLY = 'Responder por e-mail';

/** No lugar de "Responder por e-mail", quando a conta não tem e-mail. */
export const FEEDBACK_NO_EMAIL = 'Esta conta não tem e-mail: não dá para responder por aqui.';

/** O painel de detalhe, na tela larga, antes de escolher um recado. */
export const FEEDBACK_DETAIL_EMPTY = 'Escolha um recado na lista para ler.';

/** Na tela larga, no navegador: as teclas que mudam o recado aberto. */
export const FEEDBACK_KEYS_HINT = 'Dica: ↑ e ↓ (ou j e k) passam de um recado para o outro.';

/** O assunto do e-mail de resposta. */
export const FEEDBACK_REPLY_SUBJECT = 'Sobre o seu recado no Kotii';

// ---------------------------------------------------------------------------
// O texto do recado

/** O tamanho como o banco conta (char_length): um emoji é um caractere, não dois. */
export function feedbackLength(text: string): number {
  return Array.from(text).length;
}

/**
 * O texto do recado como vai para o banco: aparado e cortado em `FEEDBACK_MAX_LENGTH` caracteres, sem partir um
 * emoji ao meio (o mesmo corte da função nuke). '' quando não é texto ou fica vazio.
 */
export function cleanFeedbackText(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  const chars = Array.from(text);
  return chars.length > FEEDBACK_MAX_LENGTH ? chars.slice(0, FEEDBACK_MAX_LENGTH).join('').trimEnd() : text;
}

/** O aparelho de `Platform.OS` como a coluna guarda; outro valor (windows, macos) vai sem aparelho. */
export function feedbackPlatform(os: string): FeedbackPlatform | null {
  return FEEDBACK_PLATFORMS.find((platform) => platform === os) ?? null;
}

// ---------------------------------------------------------------------------
// A resposta das rpc, lida

/** Um recado, como app_feedback_list e set_app_feedback devolvem, conferido e em camelCase. */
export interface FeedbackItem {
  id: string;
  /** Quando chegou (ISO 8601 em UTC, "2026-10-24T17:05:00Z"). */
  createdAt: string;
  /** A última mudança de situação ou de nota (igual a `createdAt` enquanto ninguém mexeu). */
  updatedAt: string;
  /** Um tipo que esta versão do app não conhece chega como `outro`: o recado continua na caixa. */
  kind: FeedbackKind;
  message: string;
  /** null: o app não disse (ou disse um aparelho que esta versão não conhece). */
  platform: FeedbackPlatform | null;
  appVersion: string | null;
  status: FeedbackStatus;
  /** A nota de quem mantém o app; null sem nota. */
  note: string | null;
  /** O e-mail da conta, lido na hora; null quando a conta não tem. */
  email: string | null;
}

/** A resposta de app_feedback_list. */
export interface FeedbackList {
  /** Todos os recados por situação, qualquer que seja o filtro (zero também). */
  counts: Record<FeedbackStatus, number>;
  /** Quantos recados o filtro de situação pegou (pode ser mais do que `items`, cortado no limite). */
  total: number;
  /** Os mais novos do filtro, do mais novo para o mais antigo. */
  items: FeedbackItem[];
}

type Fields = Record<string, unknown>;

function invalid(): never {
  throw new Error(FEEDBACK_INVALID);
}

function fields(value: unknown): Fields {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Fields;
}

/** Uma contagem: inteiro, finito e sem sinal (-0 vira 0). */
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid();
  return value === 0 ? 0 : value;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) invalid();
  return value;
}

/** Um texto que pode faltar: null, ausente ou em branco é null; outro tipo é resposta quebrada. */
function optionalText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') invalid();
  return value.trim() ? value : null;
}

function instant(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) invalid();
  return value;
}

/** O recado lido; null quando a situação é uma que esta versão do app não conhece (fica de fora da lista). */
function readItem(raw: unknown): FeedbackItem | null {
  const row = fields(raw);
  const kind = text(row.kind);
  const status = text(row.status);
  const platform = optionalText(row.platform);
  // Os outros campos são conferidos mesmo quando a situação deixa o recado de fora.
  const item: Omit<FeedbackItem, 'status'> = {
    id: text(row.id),
    createdAt: instant(row.created_at),
    updatedAt: instant(row.updated_at),
    kind: FEEDBACK_KINDS.find((known) => known === kind) ?? 'outro',
    message: text(row.message),
    platform: platform ? feedbackPlatform(platform) : null,
    appVersion: optionalText(row.app_version),
    note: optionalText(row.note),
    email: optionalText(row.email),
  };
  const known = FEEDBACK_STATUSES.find((candidate) => candidate === status);
  return known ? { ...item, status: known } : null;
}

/**
 * Confere um recado (a resposta de set_app_feedback). Falta de um campo, um tipo errado ou uma situação que esta
 * versão não conhece lança `FEEDBACK_INVALID`.
 */
export function parseFeedbackItem(raw: unknown): FeedbackItem {
  return readItem(raw) ?? invalid();
}

/**
 * Confere a resposta de app_feedback_list e passa para camelCase. As quatro contagens e o total têm de ser
 * inteiros sem sinal; `items`, uma lista (nunca null) sem id repetido. Um tipo de recado que esta versão do app não
 * conhece vira `outro` (o recado aparece); uma situação desconhecida deixa o recado de fora (não cabe em nenhum
 * filtro nem botão), e aparece quando o app for atualizado.
 */
export function parseFeedbackList(raw: unknown): FeedbackList {
  const root = fields(raw);
  const rawCounts = fields(root.counts);
  const counts = Object.fromEntries(FEEDBACK_STATUSES.map((status) => [status, count(rawCounts[status])])) as Record<FeedbackStatus, number>;
  // As situações que este app não conhece também têm de ser contagens.
  for (const [key, value] of Object.entries(rawCounts)) if (!(key in counts)) count(value);
  if (!Array.isArray(root.items)) invalid();
  const items = root.items.map(readItem).filter((item): item is FeedbackItem => item !== null);
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) invalid();
    seen.add(item.id);
  }
  return { counts, total: count(root.total), items };
}

/**
 * A lista guardada com o recado que set_app_feedback devolveu no lugar do antigo, e as contagens acompanhando a
 * mudança de situação (sai de uma, entra na outra), para os filtros não mostrarem o número velho até a próxima
 * busca. Um recado que não está nesta lista não muda nada nela: sem saber a situação antiga, as contagens ficam
 * para a próxima busca. `total` e a ordem não mudam (o recado continua no filtro em que estava até a busca).
 */
export function applyFeedbackUpdate(list: FeedbackList, item: FeedbackItem): FeedbackList {
  const before = list.items.find((entry) => entry.id === item.id);
  if (!before) return list;
  const counts = { ...list.counts };
  if (before.status !== item.status) {
    counts[before.status] = Math.max(0, counts[before.status] - 1);
    counts[item.status] += 1;
  }
  return { ...list, counts, items: list.items.map((entry) => (entry.id === item.id ? item : entry)) };
}

// ---------------------------------------------------------------------------
// Filtros e busca

/** O filtro de situação da caixa de entrada; `todos` pede a lista sem filtro. */
export type FeedbackStatusFilter = FeedbackStatus | 'todos';

/** O filtro de tipo; `todos` não filtra. */
export type FeedbackKindFilter = FeedbackKind | 'todos';

/** O `p_status` de app_feedback_list (e o fim da chave da busca): null é sem filtro. */
export function feedbackStatusParam(filter: FeedbackStatusFilter): FeedbackStatus | null {
  return filter === 'todos' ? null : filter;
}

/** O filtro com que a caixa abre: os novos quando há algum, senão todos. */
export function defaultFeedbackStatus(counts: Record<FeedbackStatus, number>): FeedbackStatusFilter {
  return counts.novo > 0 ? 'novo' : 'todos';
}

/** As palavras da busca, minúsculas e sem acento. */
function searchWords(query: string): string[] {
  return normalizeSearch(query).split(/\s+/).filter(Boolean);
}

/**
 * Os recados do tipo escolhido que têm todas as palavras da busca no texto, no e-mail ou na nota (sem diferença
 * de maiúsculas e acentos: "sugestao" acha "Sugestão"). Busca em branco e tipo `todos` não filtram. A ordem fica.
 */
export function filterFeedback(
  items: readonly FeedbackItem[],
  { kind = 'todos', query = '' }: { kind?: FeedbackKindFilter; query?: string } = {},
): FeedbackItem[] {
  const words = searchWords(query);
  return items.filter((item) => {
    if (kind !== 'todos' && item.kind !== kind) return false;
    if (!words.length) return true;
    const haystack = normalizeSearch([item.message, item.email ?? '', item.note ?? ''].join('\n'));
    return words.every((word) => haystack.includes(word));
  });
}

// ---------------------------------------------------------------------------
// O que a caixa de entrada mostra

const NUMBER = new Intl.NumberFormat('pt-BR');
const num = (value: number) => NUMBER.format(value);
const plural = (value: number, one: string, many: string) => `${num(value)} ${value === 1 ? one : many}`;
const pad = (value: number) => String(value).padStart(2, '0');

/** As partes de um instante no fuso do aparelho. */
function local(iso: string) {
  const date = new Date(iso);
  return { year: date.getFullYear(), day: `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`, time: `${pad(date.getHours())}:${pad(date.getMinutes())}` };
}

/** "24/10 14:05", no fuso do aparelho; de outro ano que o de `now`, "24/10/2025 14:05". */
export function feedbackWhen(iso: string, now: Date = new Date()): string {
  const { year, day, time } = local(iso);
  return year === now.getFullYear() ? `${day} ${time}` : `${day}/${year} ${time}`;
}

/** "24/10/2026 às 14:05", no fuso do aparelho: o detalhe sempre com o ano. */
export function feedbackDateTime(iso: string): string {
  const { year, day, time } = local(iso);
  return `${day}/${year} às ${time}`;
}

/** "Navegador · versão 1.4.0", "Android", "versão 1.4.0"; null quando o recado não trouxe nenhum dos dois. */
export function feedbackDevice(item: Pick<FeedbackItem, 'platform' | 'appVersion'>): string | null {
  const parts = [item.platform ? FEEDBACK_PLATFORM_LABELS[item.platform] : null, item.appVersion ? `versão ${item.appVersion}` : null];
  return parts.filter(Boolean).join(' · ') || null;
}

/**
 * O título da linha: a primeira linha do recado, com os espaços juntados, cortada perto de `FEEDBACK_TITLE_MAX`
 * caracteres (no último espaço, quando ele não deixa o título curto demais) com "…".
 */
export function feedbackTitle(message: string): string {
  const first = message.trim().split(/\r\n|\r|\n/)[0].replace(/\s+/g, ' ').trim();
  const chars = Array.from(first);
  if (chars.length <= FEEDBACK_TITLE_MAX) return first;
  let cut = chars.slice(0, FEEDBACK_TITLE_MAX - 1).join('');
  const space = cut.lastIndexOf(' ');
  if (space >= FEEDBACK_TITLE_MAX * 0.6) cut = cut.slice(0, space);
  return `${cut.replace(/[\s,;:.–-]+$/, '')}…`;
}

/** Uma linha da lista de recados. */
export interface FeedbackRow {
  id: string;
  kind: FeedbackKind;
  status: FeedbackStatus;
  /** A primeira linha do recado, cortada (feedbackTitle). */
  title: string;
  kindLabel: string;
  statusLabel: string;
  /** "24/10 14:05" */
  when: string;
  email: string | null;
  /** "Navegador · versão 1.4.0"; null sem os dois. */
  device: string | null;
  /** Ainda não foi aberto: a linha aparece em destaque. */
  isNew: boolean;
  /** Tem nota de quem mantém o app. */
  hasNote: boolean;
  /** Tudo da linha numa frase só, para o leitor de tela. */
  accessibilityLabel: string;
}

/** Um botão de filtro (situação ou tipo). */
export interface FeedbackChip<K extends string> {
  key: K;
  /** "Novos (3)", "Todos os tipos" */
  label: string;
  accessibilityLabel: string;
}

/** Tudo o que a lista da caixa de entrada mostra, para um filtro, um tipo e uma busca. */
export interface FeedbackInboxView {
  /** Novos, Lidos, Resolvidos, Arquivados e Todos, com as contagens. */
  statusChips: FeedbackChip<FeedbackStatusFilter>[];
  /** Todos os tipos e os quatro tipos. */
  kindChips: FeedbackChip<FeedbackKindFilter>[];
  /** Os recados que passaram pelo tipo e pela busca, do mais novo para o mais antigo. */
  rows: FeedbackRow[];
  /** "3 recados"; "3 de 12 recados" quando o tipo ou a busca deixou alguns de fora. */
  countLabel: string;
  /** "Mostrando 200 de 340 recados." quando a lista veio cortada; null quando veio inteira. */
  cutNote: string | null;
  /** A frase no lugar da lista vazia, conforme o filtro; null quando há linhas. */
  empty: string | null;
  /** Recados novos (de todos, não só do filtro): o número da aba e da linha da aba Números. */
  newCount: number;
}

const STATUS_CHIP_LABELS: Record<FeedbackStatusFilter, string> = {
  novo: 'Novos',
  lido: 'Lidos',
  resolvido: 'Resolvidos',
  arquivado: 'Arquivados',
  todos: 'Todos',
};

/** Os filtros de situação, na ordem da barra. */
export const FEEDBACK_STATUS_FILTERS: readonly FeedbackStatusFilter[] = ['novo', 'lido', 'resolvido', 'arquivado', 'todos'];

/** Os filtros de tipo, na ordem da barra. */
export const FEEDBACK_KIND_FILTERS: readonly FeedbackKindFilter[] = ['todos', ...FEEDBACK_KINDS];

const STATUS_EMPTY: Record<FeedbackStatusFilter, string> = {
  novo: 'Nenhum recado novo.',
  lido: 'Nenhum recado lido.',
  resolvido: 'Nenhum recado resolvido.',
  arquivado: 'Nenhum recado arquivado.',
  todos: 'Ainda não chegou nenhum recado.',
};

const AMONG: Record<FeedbackStatus, string> = {
  novo: 'entre os novos',
  lido: 'entre os lidos',
  resolvido: 'entre os resolvidos',
  arquivado: 'entre os arquivados',
};

/** Frases para o leitor de tela: cada parte vira uma frase com ponto. */
function spoken(...parts: (string | null)[]): string {
  return parts
    .filter((part): part is string => Boolean(part))
    .map((part) => (/[.!?…]$/.test(part) ? part : `${part}.`))
    .join(' ');
}

/** Uma linha da lista; `now` decide se a data leva o ano. */
export function feedbackRow(item: FeedbackItem, now: Date = new Date()): FeedbackRow {
  const kindLabel = FEEDBACK_KIND_LABELS[item.kind];
  const statusLabel = FEEDBACK_STATUS_LABELS[item.status];
  const when = feedbackWhen(item.createdAt, now);
  const title = feedbackTitle(item.message);
  const device = feedbackDevice(item);
  return {
    id: item.id,
    kind: item.kind,
    status: item.status,
    title,
    kindLabel,
    statusLabel,
    when,
    email: item.email,
    device,
    isNew: item.status === 'novo',
    hasNote: item.note !== null,
    accessibilityLabel: spoken(
      `${kindLabel}, ${statusLabel.toLowerCase()}`,
      when.replace(' ', ' às '),
      item.email ? `De ${item.email}` : 'Sem e-mail',
      title,
      item.note !== null ? 'Tem nota' : null,
    ),
  };
}

/**
 * A lista da caixa de entrada: os filtros com as contagens, as linhas do tipo e da busca escolhidos, o aviso de
 * lista cortada e a frase de lista vazia. `status` é o filtro com que a lista foi pedida ao servidor (as linhas já
 * vêm filtradas por ele); o tipo e a busca filtram aqui, só nos recados que vieram.
 */
export function feedbackInboxView(
  list: FeedbackList,
  { status, kind = 'todos', query = '', now = new Date() }: { status: FeedbackStatusFilter; kind?: FeedbackKindFilter; query?: string; now?: Date },
): FeedbackInboxView {
  const all = FEEDBACK_STATUSES.reduce((sum, key) => sum + list.counts[key], 0);
  const statusChips = FEEDBACK_STATUS_FILTERS.map((key): FeedbackChip<FeedbackStatusFilter> => {
    const value = key === 'todos' ? all : list.counts[key];
    const label = STATUS_CHIP_LABELS[key];
    return { key, label: `${label} (${num(value)})`, accessibilityLabel: `${label}: ${plural(value, 'recado', 'recados')}` };
  });
  const kindChips = FEEDBACK_KIND_FILTERS.map(
    (key): FeedbackChip<FeedbackKindFilter> =>
      key === 'todos'
        ? { key, label: 'Todos os tipos', accessibilityLabel: 'Todos os tipos' }
        : { key, label: FEEDBACK_KIND_LABELS[key], accessibilityLabel: `Tipo ${FEEDBACK_KIND_LABELS[key]}` },
  );

  const shown = filterFeedback(list.items, { kind, query });
  const filtering = kind !== 'todos' || searchWords(query).length > 0;
  const rows = shown.map((item) => feedbackRow(item, now));
  const loaded = list.items.length;
  const countLabel =
    filtering && shown.length < loaded ? `${num(shown.length)} de ${plural(loaded, 'recado', 'recados')}` : plural(shown.length, 'recado', 'recados');

  const cut = list.total > loaded;
  const cutNote = cut
    ? `Mostrando ${num(loaded)} de ${num(list.total)} recados.${filtering ? ' O tipo e a busca olham só esses.' : ''}`
    : null;

  let empty: string | null = null;
  if (!rows.length) {
    if (!loaded) empty = STATUS_EMPTY[status];
    else {
      const what = [
        kind !== 'todos' ? `do tipo ${FEEDBACK_KIND_LABELS[kind]}` : null,
        searchWords(query).length ? `com “${query.trim()}”` : null,
        status !== 'todos' ? AMONG[status] : null,
      ];
      empty = `Nenhum recado ${what.filter(Boolean).join(' ')}.`;
    }
  }

  return { statusChips, kindChips, rows, countLabel, cutNote, empty, newCount: list.counts.novo };
}

/** Um botão de situação no detalhe. */
export interface FeedbackStatusAction {
  /** A situação que o botão grava. */
  status: FeedbackStatus;
  label: string;
}

const ACTIONS: Record<FeedbackStatus, FeedbackStatusAction[]> = {
  novo: [
    { status: 'resolvido', label: 'Marcar como resolvido' },
    { status: 'arquivado', label: 'Arquivar' },
    { status: 'lido', label: 'Marcar como lido' },
  ],
  lido: [
    { status: 'resolvido', label: 'Marcar como resolvido' },
    { status: 'arquivado', label: 'Arquivar' },
    { status: 'novo', label: 'Marcar como novo' },
  ],
  resolvido: [
    { status: 'arquivado', label: 'Arquivar' },
    { status: 'lido', label: 'Voltar para lidos' },
  ],
  arquivado: [
    { status: 'lido', label: 'Voltar para lidos' },
    { status: 'resolvido', label: 'Marcar como resolvido' },
  ],
};

/** Os botões de situação de um recado, o principal primeiro; nunca a situação em que ele já está. */
export function feedbackStatusActions(status: FeedbackStatus): FeedbackStatusAction[] {
  return ACTIONS[status];
}

/** Tudo o que o detalhe de um recado mostra. */
export interface FeedbackDetail {
  id: string;
  kind: FeedbackKind;
  status: FeedbackStatus;
  kindLabel: string;
  statusLabel: string;
  /** "24/10/2026 às 14:05" */
  sentAt: string;
  /** "Última mudança em 25/10/2026 às 09:12"; null quando ninguém mexeu desde que chegou. */
  changed: string | null;
  /** "Navegador · versão 1.4.0"; null sem os dois. */
  device: string | null;
  email: string | null;
  /** O e-mail de resposta pronto (replyMailto); null sem e-mail, e aí vale `noEmail`. */
  replyUrl: string | null;
  /** `FEEDBACK_NO_EMAIL` quando não há e-mail; null quando há. */
  noEmail: string | null;
  /** O recado inteiro, como chegou. */
  message: string;
  /** A nota guardada; null sem nota. O campo começa com `note ?? ''`. */
  note: string | null;
  actions: FeedbackStatusAction[];
  /** O cabeçalho do detalhe numa frase, para o leitor de tela. */
  accessibilityLabel: string;
}

/** O detalhe de um recado. */
export function feedbackDetail(item: FeedbackItem): FeedbackDetail {
  const kindLabel = FEEDBACK_KIND_LABELS[item.kind];
  const statusLabel = FEEDBACK_STATUS_LABELS[item.status];
  const sentAt = feedbackDateTime(item.createdAt);
  const changedAt = feedbackDateTime(item.updatedAt);
  const changed = changedAt !== sentAt && Date.parse(item.updatedAt) > Date.parse(item.createdAt) ? `Última mudança em ${changedAt}` : null;
  const device = feedbackDevice(item);
  return {
    id: item.id,
    kind: item.kind,
    status: item.status,
    kindLabel,
    statusLabel,
    sentAt,
    changed,
    device,
    email: item.email,
    replyUrl: replyMailto(item),
    noEmail: item.email ? null : FEEDBACK_NO_EMAIL,
    message: item.message,
    note: item.note,
    actions: feedbackStatusActions(item.status),
    accessibilityLabel: spoken(
      `Recado: ${kindLabel.toLowerCase()}, ${statusLabel.toLowerCase()}`,
      `Mandado em ${sentAt}`,
      device ? device.replace(' · ', ', ') : null,
      item.email ? `De ${item.email}` : 'Sem e-mail',
    ),
  };
}

// ---------------------------------------------------------------------------
// A nota

/** A nota como vai para set_app_feedback: aparada; '' apaga a nota. */
export function feedbackNoteToSave(draft: string): string {
  return draft.trim();
}

/** O campo mudou em relação à nota guardada (espaços nas pontas não contam; vazio é sem nota). */
export function feedbackNoteChanged(saved: string | null, draft: string): boolean {
  return feedbackNoteToSave(draft) !== (saved ?? '').trim();
}

/** Por que a nota não pode ser salva; null quando pode. */
export function feedbackNoteError(draft: string): string | null {
  return feedbackLength(feedbackNoteToSave(draft)) > FEEDBACK_MAX_LENGTH ? FEEDBACK_NOTE_TOO_LONG : null;
}

// ---------------------------------------------------------------------------
// A resposta por e-mail

/**
 * O `mailto:` da resposta: o assunto "Sobre o seu recado no Kotii" e o corpo com um espaço para escrever e, embaixo,
 * o recado citado com "> " em cada linha (a linha vazia vira ">"). null sem e-mail. O endereço vai codificado,
 * menos a arroba (um "+" ou um "?" no endereço não quebram o link).
 */
export function replyMailto(item: Pick<FeedbackItem, 'email' | 'message' | 'createdAt'>): string | null {
  const email = item.email?.trim();
  if (!email) return null;
  const quoted = item.message
    .split(/\r\n|\r|\n/)
    .map((line) => (line.trim() ? `> ${line}` : '>'))
    .join('\n');
  const body = `Oi!\n\n\n\nO seu recado de ${feedbackDateTime(item.createdAt)}:\n${quoted}\n`;
  const to = encodeURIComponent(email).replace(/%40/g, '@');
  return `mailto:${to}?subject=${encodeURIComponent(FEEDBACK_REPLY_SUBJECT)}&body=${encodeURIComponent(body)}`;
}

// ---------------------------------------------------------------------------
// O painel: a aba e a linha da aba Números

/** O nome da aba no painel: "Recados", ou "Recados (3)" com recados novos. */
export function feedbackTabLabel(newCount: number): string {
  return newCount > 0 ? `Recados (${num(newCount)})` : 'Recados';
}

/** A linha da aba Números: "1 recado novo", "3 recados novos"; null sem nenhum novo. */
export function newFeedbackLine(newCount: number): string | null {
  return newCount > 0 ? plural(newCount, 'recado novo', 'recados novos') : null;
}

// ---------------------------------------------------------------------------
// O teclado (tela larga, no navegador)

/** A tecla que muda o recado aberto: ↓ ou j, o próximo (1); ↑ ou k, o anterior (-1); outra, null. */
export function feedbackKeyStep(key: string): 1 | -1 | null {
  if (key === 'ArrowDown' || key === 'j') return 1;
  if (key === 'ArrowUp' || key === 'k') return -1;
  return null;
}

/**
 * O recado aberto depois de um passo na lista (`ids` na ordem da tela): o próximo ou o anterior, parando nas
 * pontas. Sem nenhum aberto (ou com um que não está mais na lista), qualquer passo abre o primeiro. null com a
 * lista vazia.
 */
export function nextFeedbackSelection(ids: readonly string[], selected: string | null, step: 1 | -1): string | null {
  if (!ids.length) return null;
  const index = selected === null ? -1 : ids.indexOf(selected);
  if (index < 0) return ids[0];
  return ids[Math.min(ids.length - 1, Math.max(0, index + step))];
}

// Painel do app: os números de uso que só quem mantém o Kotii vê (rpc
// app_dashboard, que confere no servidor quem está em app_admins). São só
// totais: a rpc nunca devolve id, e-mail ou nome de pessoa ou de casa, nem nada
// por pessoa ou por casa. Aqui ficam a leitura defensiva da resposta
// (parseAppDashboard) e tudo o que a tela mostra (dashboardView): os números já
// escritos em pt-BR, as frases, as barras e o que o leitor de tela diz. A tela
// (app/painel.tsx) só desenha.

import { AI_KIND_LABELS, type AiKind } from './aiUsage';
import { joinNames } from './cartPantry';
import { addDays, formatBRDate, formatShortDate, isValidISODate, toISODate } from './dates';
import { monthLabel, monthShortLabel, shiftMonth } from './finance';

export const APP_DASHBOARD_TITLE = 'Painel do app';

/** A recusa da rpc (42501) para quem não está em app_admins: a mesma frase do servidor. */
export const APP_DASHBOARD_FORBIDDEN = 'Este painel é só para quem mantém o app.';

/** O banco ainda sem a migração do painel (a rpc não existe). */
export const APP_DASHBOARD_NOT_READY = 'O painel ainda não está disponível: falta aplicar a migração do painel no banco.';

/** A resposta da rpc veio num formato que esta versão do app não lê. */
export const APP_DASHBOARD_INVALID = 'O painel chegou num formato que esta versão do app não entende. Atualize o app e tente de novo.';

/** Embaixo de tudo: o painel nunca mostra uma pessoa ou uma casa. */
export const APP_DASHBOARD_PRIVACY = 'Só números totais: nenhuma pessoa ou casa aparece aqui.';

/** Embaixo de tudo: como "ativa" é medida, e os limites dessa medida. */
export const APP_DASHBOARD_ACTIVITY_NOTE =
  'Ativa é a pessoa que abriu o app com a conta conectada. Quem saiu da conta antes de o dia acabar pode não aparecer ' +
  'naquele dia, e um dia sem registro é um dia em que a contagem diária não rodou.';

/** Os gráficos por dia mostram os 30 dias que terminam hoje (o dia de São Paulo que a rpc manda). */
export const DASHBOARD_DAYS = 30;

/** O gráfico do Nuke por mês mostra os 6 meses que terminam no mês corrente, como a rpc. */
export const DASHBOARD_MONTHS = 6;

// ---------------------------------------------------------------------------
// Vocabulário

/** Os usos da IA, na ordem da aba Família. */
export const APP_AI_KINDS: readonly AiKind[] = ['chat', 'photo', 'menu', 'nfce', 'finance'];

/** As funções que o painel conta, na ordem da rpc, com o nome que a tela mostra. */
export const APP_FEATURES = [
  { key: 'lista', label: 'Lista de compras' },
  { key: 'notas', label: 'Notas fiscais' },
  { key: 'despensa', label: 'Despensa' },
  { key: 'gastos', label: 'Gastos' },
  { key: 'contas', label: 'Contas a pagar' },
  { key: 'orcamento', label: 'Orçamento' },
  { key: 'remedios', label: 'Remédios' },
  { key: 'consultas', label: 'Consultas' },
  { key: 'exames', label: 'Exames' },
  { key: 'vacinas', label: 'Vacinas' },
  { key: 'tarefas', label: 'Tarefas' },
  { key: 'compromissos', label: 'Compromissos' },
  { key: 'cardapio', label: 'Cardápio' },
  { key: 'suprimentos', label: 'Gás, água e ração' },
  { key: 'aparelhos', label: 'Aparelhos' },
  { key: 'documentos', label: 'Documentos' },
  { key: 'prestadores', label: 'Prestadores' },
  { key: 'treinos', label: 'Treinos' },
  { key: 'dieta', label: 'Dieta' },
] as const;

export type AppFeatureKey = (typeof APP_FEATURES)[number]['key'];

/** De onde vem a sessão, pelo user agent (app_platform no banco). */
export type AppPlatform = 'ios' | 'android' | 'computador' | 'outro';

export const APP_PLATFORM_LABELS: Record<AppPlatform, string> = {
  ios: 'iPhone/iPad',
  android: 'Android',
  computador: 'Computador',
  outro: 'Outro',
};

/** Navegador (inclusive o app da tela de início, que é a página) ou app instalado (app_client no banco). */
export type AppClient = 'navegador' | 'app' | 'outro';

const CLIENT_LABELS: Record<AppClient, string> = {
  navegador: 'pelo navegador',
  app: 'pelo app instalado',
  outro: 'por outro meio',
};

/** Como a nota entrou: pelo QR code, pela foto (IA) ou digitada. */
export type AppReceiptSource = 'qrcode' | 'ai' | 'manual';

const SOURCES: readonly AppReceiptSource[] = ['qrcode', 'ai', 'manual'];

const SOURCE_LABELS: Record<AppReceiptSource, string> = {
  qrcode: 'pelo QR code',
  ai: 'por foto',
  manual: 'à mão',
};

/** O uso da IA dentro de uma frase ("1 casa em leituras de foto"). */
const AI_KIND_NOUNS: Record<AiKind, string> = {
  chat: 'mensagens com o Nuke',
  photo: 'leituras de foto',
  menu: 'cardápios do Nuke',
  nfce: 'notas pelo QR code',
  finance: 'consultor financeiro',
};

/** A liberação do consultor financeiro em beta_access. */
const FINANCE_BETA = 'finance';

// ---------------------------------------------------------------------------
// A resposta da rpc, lida

/** Um dia guardado pela contagem diária (app_daily_stats). */
export interface AppDashboardDay {
  /** AAAA-MM-DD, o dia de São Paulo. */
  day: string;
  accounts: number;
  activeUsers: number;
  households: number;
  /**
   * O uso da IA acumulado no mês daquele dia, somado nas casas, na última contagem do dia ({ chat: 4 }); null
   * quando a contagem guardou `{}` (o dia reconstruído, ou um dia sem uso nenhum: não dá para separar).
   */
  ai: Partial<Record<AiKind, number>> | null;
  /** Dia reconstruído quando o painel foi instalado: conta só quem ainda estava conectado. */
  backfilled: boolean;
}

/** Um uso da IA num mês, somado nas casas. */
export interface AppDashboardAiMonth {
  /** AAAA-MM */
  month: string;
  kind: AiKind;
  uses: number;
  /** Casas que usaram (contagem acima de zero). */
  households: number;
}

/** A resposta de app_dashboard, conferida e em camelCase. */
export interface AppDashboard {
  /** Quando o servidor montou a resposta (ISO, com fuso). */
  generatedAt: string;
  /** AAAA-MM-DD, o dia de São Paulo no servidor: os 30 dias dos gráficos terminam nele. */
  today: string;
  accounts: { total: number; new7d: number; new30d: number; confirmed: number; inHousehold: number };
  active: { d1: number; d7: number; d30: number };
  retention: { eligible: number; returned: number };
  households: { total: number; shared: number; members: number; peopleWithoutApp: number; pets: number; new30d: number };
  signups: { day: string; count: number }[];
  daily: AppDashboardDay[];
  ai: {
    /** AAAA-MM, o mês do limite no servidor. */
    month: string;
    limits: Partial<Record<AiKind, number>>;
    months: AppDashboardAiMonth[];
    nearLimit: { kind: AiKind; households: number }[];
    atLimit: { kind: AiKind; households: number }[];
  };
  features: { key: AppFeatureKey; households: number; households30d: number; events30d: number }[];
  receiptSources: { source: AppReceiptSource; receipts30d: number }[];
  platforms: { platform: AppPlatform; users: number }[];
  clients: { client: AppClient; users: number }[];
  push: { subscriptions: number; users: number };
  terms: { version: string; users: number }[];
  beta: { feature: string; users: number }[];
  sharedPrices: { rows: number };
}

type Fields = Record<string, unknown>;

function invalid(): never {
  throw new Error(APP_DASHBOARD_INVALID);
}

function fields(value: unknown): Fields {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Fields;
}

function list(value: unknown): Fields[] {
  if (!Array.isArray(value)) invalid();
  return value.map(fields);
}

/** Uma contagem: inteiro, finito e sem sinal (-0 vira 0, para não escrever "-0"). */
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid();
  return value === 0 ? 0 : value;
}

function flag(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid();
  return value;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) invalid();
  return value;
}

function day(value: unknown): string {
  if (typeof value !== 'string' || !isValidISODate(value)) invalid();
  return value;
}

function month(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) invalid();
  return value;
}

function instant(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) invalid();
  return value;
}

/** O valor, se é um dos conhecidos; senão null (e a linha fica de fora). */
function known<T extends string>(values: readonly T[], value: unknown): T | null {
  const key = text(value);
  return values.find((candidate) => candidate === key) ?? null;
}

/** Duas linhas com a mesma chave são uma resposta quebrada: o gráfico contaria o dia duas vezes. */
function unique<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) invalid();
    seen.add(k);
  }
  return items;
}

function present<T>(item: T | null): item is T {
  return item !== null;
}

/** Um número por uso da IA ({ "chat": 4 }): só os tipos conhecidos ficam. */
function aiCounts(value: unknown): Partial<Record<AiKind, number>> {
  const raw = fields(value);
  const counts: Partial<Record<AiKind, number>> = {};
  for (const kind of APP_AI_KINDS) if (raw[kind] !== undefined) counts[kind] = count(raw[kind]);
  // Os tipos que este app não conhece também têm de ser contagens.
  for (const [key, entry] of Object.entries(raw)) if (!APP_AI_KINDS.includes(key as AiKind)) count(entry);
  return counts;
}

function limitRows(value: unknown): { kind: AiKind; households: number }[] {
  const rows = list(value).map((row) => {
    const kind = known(APP_AI_KINDS, row.kind);
    const households = count(row.households);
    return kind ? { kind, households } : null;
  });
  return unique(rows.filter(present), (row) => row.kind);
}

/**
 * Confere a resposta de app_dashboard e passa para camelCase. Toda contagem tem de ser um inteiro finito, sem
 * sinal; os dias, AAAA-MM-DD válidos; os meses, AAAA-MM. Falta de um objeto, de uma lista ou de um número, ou uma
 * chave repetida numa lista, é resposta quebrada: lança `APP_DASHBOARD_INVALID`. Um valor que esta versão do app
 * não conhece (uma função, um uso da IA, um tipo de aparelho ou uma origem de nota novos no servidor) fica de
 * fora, sempre do mesmo jeito: aparece quando o app for atualizado.
 */
export function parseAppDashboard(raw: unknown): AppDashboard {
  const root = fields(raw);
  const accounts = fields(root.accounts);
  const active = fields(root.active);
  const retention = fields(root.retention);
  const households = fields(root.households);
  const ai = fields(root.ai);
  const push = fields(root.push);
  const sharedPrices = fields(root.shared_prices);

  const aiMonths = list(ai.months).map((row): AppDashboardAiMonth | null => {
    const kind = known(APP_AI_KINDS, row.kind);
    const entry = { month: month(row.month), uses: count(row.uses), households: count(row.households) };
    return kind ? { ...entry, kind } : null;
  });

  const features = list(root.features).map((row) => {
    const key = known(
      APP_FEATURES.map((feature) => feature.key),
      row.key,
    );
    const entry = { households: count(row.households), households30d: count(row.households_30d), events30d: count(row.events_30d) };
    return key ? { ...entry, key } : null;
  });

  const sources = list(root.receipt_sources).map((row) => {
    const source = known(SOURCES, row.source);
    const receipts30d = count(row.receipts_30d);
    return source ? { source, receipts30d } : null;
  });

  const platforms = list(root.platforms).map((row) => {
    const platform = known(Object.keys(APP_PLATFORM_LABELS) as AppPlatform[], row.platform);
    const users = count(row.users);
    return platform ? { platform, users } : null;
  });

  const clients = list(root.clients).map((row) => {
    const client = known(Object.keys(CLIENT_LABELS) as AppClient[], row.client);
    const users = count(row.users);
    return client ? { client, users } : null;
  });

  return {
    generatedAt: instant(root.generated_at),
    today: day(root.today),
    accounts: {
      total: count(accounts.total),
      new7d: count(accounts.new_7d),
      new30d: count(accounts.new_30d),
      confirmed: count(accounts.confirmed),
      inHousehold: count(accounts.in_household),
    },
    active: { d1: count(active.d1), d7: count(active.d7), d30: count(active.d30) },
    retention: { eligible: count(retention.eligible), returned: count(retention.returned) },
    households: {
      total: count(households.total),
      shared: count(households.shared),
      members: count(households.members),
      peopleWithoutApp: count(households.people_without_app),
      pets: count(households.pets),
      new30d: count(households.new_30d),
    },
    signups: unique(
      list(root.signups).map((row) => ({ day: day(row.day), count: count(row.count) })),
      (row) => row.day,
    ),
    daily: unique(
      list(root.daily).map((row): AppDashboardDay => {
        const counts = aiCounts(row.ai);
        return {
          day: day(row.day),
          accounts: count(row.accounts),
          activeUsers: count(row.active_users),
          households: count(row.households),
          // `{}` é a contagem que não sabe o uso; um objeto só com tipos novos sabe que os conhecidos deram zero.
          ai: Object.keys(row.ai as Fields).length ? counts : null,
          backfilled: flag(row.backfilled),
        };
      }),
      (row) => row.day,
    ),
    ai: {
      month: month(ai.month),
      limits: aiCounts(ai.limits),
      months: unique(aiMonths.filter(present), (row) => `${row.month}:${row.kind}`),
      nearLimit: limitRows(ai.near_limit),
      atLimit: limitRows(ai.at_limit),
    },
    features: unique(features.filter(present), (row) => row.key),
    receiptSources: unique(sources.filter(present), (row) => row.source),
    platforms: unique(platforms.filter(present), (row) => row.platform),
    clients: unique(clients.filter(present), (row) => row.client),
    push: { subscriptions: count(push.subscriptions), users: count(push.users) },
    terms: unique(
      list(root.terms).map((row) => ({ version: text(row.version), users: count(row.users) })),
      (row) => row.version,
    ),
    beta: unique(
      list(root.beta).map((row) => ({ feature: text(row.feature), users: count(row.users) })),
      (row) => row.feature,
    ),
    sharedPrices: { rows: count(sharedPrices.rows) },
  };
}

// ---------------------------------------------------------------------------
// O que a tela mostra

/** Um número grande do topo ("Agora"). */
export interface DashboardStat {
  key: 'contas' | 'ativas' | 'casas' | 'nuke';
  /** "Contas", "Ativas em 7 dias", "Casas", "Nuke no mês" */
  label: string;
  /** O número, já escrito: "1.234" */
  value: string;
  /** A palavra pequena ao lado do número ("mensagens", no Nuke); null nos outros. */
  unit: string | null;
  /** A linha de baixo: "+1 em 7 dias", "2 em 24 h · 5 em 30 dias". */
  detail: string;
  accessibilityLabel: string;
}

/** Uma barra de um gráfico. */
export interface DashboardBar {
  /** O dia (AAAA-MM-DD) ou o mês (AAAA-MM): a chave da coluna. */
  key: string;
  /** null: sem registro (só o pé da barra, na cor da borda); 0 não tem altura. */
  value: number | null;
  /** Embaixo da barra, nos gráficos por mês ("out"); null nos gráficos por dia (30 colunas não têm espaço). */
  label: string | null;
  /** O valor curto embaixo do rótulo, nos gráficos por mês ("4"); null nos por dia. */
  short: string | null;
  /** Hoje, ou o mês corrente: ainda contando (tracejado, como o mês corrente do mercado). */
  partial: boolean;
  /** Dia reconstruído quando o painel foi instalado: uma estimativa por baixo (tom mais claro). */
  estimate: boolean;
}

/** Um gráfico de barras, pronto para desenhar. */
export interface DashboardBars {
  /** Da mais antiga para a mais recente. */
  bars: DashboardBar[];
  /** A maior barra (0 quando nenhuma tem valor): é a altura cheia do gráfico. */
  max: number;
  /** Embaixo da primeira barra, nos gráficos por dia ("24/09"); null nos por mês, que têm rótulo em cada barra. */
  startLabel: string | null;
  /** Embaixo da última barra, nos gráficos por dia ("hoje, até agora"); null nos por mês. */
  endLabel: string | null;
  /** O gráfico inteiro como uma imagem para o leitor de tela. */
  accessibilityLabel: string;
  /** Embaixo do gráfico ("Antes de 23/10, conta só quem ainda estava conectado."); null sem nada a dizer. */
  note: string | null;
  /** Quando não há nada para desenhar: a frase vai no lugar do gráfico. */
  empty: string | null;
}

/** Uma linha com barra de proporção (funções, aparelhos, usos da IA). */
export interface DashboardMeterRow {
  key: string;
  /** À esquerda: "Lista de compras" */
  label: string;
  /** À direita: "2 de 4 casas" */
  value: string;
  /** Embaixo, em letra pequena: "7 registros em 30 dias"; null sem nada a dizer. */
  detail: string | null;
  /** 0 a 1: o comprimento da barra. */
  ratio: number;
  accessibilityLabel: string;
}

/** Um número com nome, sem barra ("Contas sem casa: 1 de 5 contas"). */
export interface DashboardFact {
  key: string;
  label: string;
  value: string;
  /** Embaixo, em letra pequena; null sem nada a dizer. */
  detail: string | null;
  accessibilityLabel: string;
}

/** Tudo o que a tela do painel mostra, na ordem da tela. */
export interface DashboardView {
  title: string;
  /** "Agora": a grade 2×2 do topo. */
  stats: { title: string; items: DashboardStat[] };
  /** "Uso por dia": pessoas ativas nos 30 dias que terminam hoje. */
  activity: { title: string; chart: DashboardBars };
  /** "Novas contas": contas criadas por dia, e o total do período. */
  signups: { title: string; chart: DashboardBars; summary: string };
  /** "Nuke": o mês, o mês passado, os 6 meses e, quando se sabe, cada dia. */
  nuke: {
    title: string;
    facts: DashboardFact[];
    monthsTitle: string;
    months: DashboardBars;
    perDayTitle: string;
    /** null quando menos de 2 dias têm como saber: aí a tela não mostra o gráfico. */
    perDay: DashboardBars | null;
  };
  /** "IA": cada uso neste mês, e o aviso de limite quando alguma casa está perto ou chegou. */
  ai: { title: string; intro: string; rows: DashboardMeterRow[]; limitNote: string | null };
  /** "O que as casas usam": as funções usadas em 30 dias, as paradas atrás de "Ver todas", e as notas. */
  features: {
    title: string;
    intro: string;
    /** Com alguma casa nos últimos 30 dias, mais usada primeiro. */
    active: DashboardMeterRow[];
    /** Sem uso nos últimos 30 dias: aparecem só depois de "Ver todas". */
    idle: DashboardMeterRow[];
    /** "Sem uso nos últimos 30 dias: Treinos e Dieta."; null quando todas foram usadas. */
    idleSummary: string | null;
    showAll: string;
    showLess: string;
    /** As notas confirmadas em 30 dias, por origem. */
    receipts: string;
    /** "Ainda não há casas." no lugar das linhas; null quando há casas. */
    empty: string | null;
  };
  /** "Entrada": contas sem casa, quem voltou depois do primeiro dia, termos aceitos. */
  funnel: { title: string; facts: DashboardFact[] };
  /** "Aparelhos": por plataforma (30 dias), navegador ou app, e a nota de que uma pessoa conta em mais de um. */
  devices: { title: string; rows: DashboardMeterRow[]; clients: string | null; note: string; empty: string | null };
  /** "Outros": avisos do navegador, consultor beta, preços compartilhados. */
  extras: { title: string; facts: DashboardFact[] };
  /** Embaixo de tudo, em letra pequena, nesta ordem. */
  footer: { updated: string; notes: string[] };
}

const NUMBER = new Intl.NumberFormat('pt-BR');
const num = (value: number) => NUMBER.format(value);
const plural = (value: number, one: string, many: string) => `${num(value)} ${value === 1 ? one : many}`;
const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const monthName = (value: string) => monthLabel(value).split(' ')[0];
/** "24/09" */
const dayMonth = (iso: string) => formatBRDate(iso).slice(0, 5);
const share = (part: number, whole: number) => (whole > 0 ? Math.min(1, part / whole) : 0);
const pad = (value: number) => String(value).padStart(2, '0');

/**
 * A porcentagem inteira, sem mentir nas pontas: uma parte que não é o todo nunca vira "100%", e uma parte acima
 * de zero nunca vira "0%".
 */
export function wholePercent(part: number, whole: number): string {
  if (whole <= 0) return '0%';
  let value = Math.round((part / whole) * 100);
  if (part > 0 && value === 0) value = 1;
  if (part < whole && value === 100) value = 99;
  return `${value}%`;
}

/** "3 de 4 contas (75%)"; "Nenhuma conta" sem nenhuma. Os nomes contados aqui (conta, casa, pessoa) são femininos. */
function partOf(part: number, whole: number, one: string, many: string): string {
  if (whole === 0) return `Nenhuma ${one}`;
  return `${num(part)} de ${plural(whole, one, many)} (${wholePercent(part, whole)})`;
}

/** "Nenhuma casa" ou "2 casas". */
const houses = (value: number) => (value === 0 ? 'Nenhuma casa' : plural(value, 'casa', 'casas'));

/**
 * O que o leitor de tela diz de uma linha: cada parte vira uma frase, e o " · " da tela (que o leitor lê mal)
 * também separa frases. "Lista de compras: 2 de 4 casas. 7 registros em 30 dias. 3 casas já usaram."
 */
function spoken(...parts: (string | null)[]): string {
  return parts
    .flatMap((part) => (part ? part.split(' · ') : []))
    .map((part) => capitalize(part.endsWith('.') ? part : `${part}.`))
    .join(' ');
}

function fact(key: string, label: string, value: string, detail: string | null): DashboardFact {
  return { key, label, value, detail, accessibilityLabel: spoken(`${label}: ${value}`, detail) };
}

/** `spokenValue` é o valor como o leitor de tela diz, quando a tela deixa parte dele para o título da seção. */
function meter(key: string, label: string, value: string, detail: string | null, ratio: number, spokenValue = value): DashboardMeterRow {
  return { key, label, value, detail, ratio, accessibilityLabel: spoken(`${label}: ${spokenValue}`, detail) };
}

/** Os dias do gráfico: os `DASHBOARD_DAYS` que terminam em `today`, do mais antigo para hoje. */
function windowDays(today: string): string[] {
  return Array.from({ length: DASHBOARD_DAYS }, (_, index) => addDays(today, index - (DASHBOARD_DAYS - 1)));
}

/**
 * As mensagens com o Nuke de cada dia, tiradas do uso acumulado do mês que a contagem diária guarda: o dia D é
 * o acumulado de D menos o de D-1, quando D-1 é o dia anterior no mesmo mês e os dois dias foram contados de
 * verdade (não reconstruídos) e sabem o uso da IA (`ai` não é null); no dia 1º, é o acumulado de D. Uma queda
 * (um uso devolvido) conta zero. Os outros dias ficam de fora: não há como saber.
 */
export function nukeMessagesByDay(daily: AppDashboardDay[]): Map<string, number> {
  const rows = new Map(daily.map((row) => [row.day, row]));
  const chat = (row: AppDashboardDay | undefined) => (row && !row.backfilled && row.ai ? (row.ai.chat ?? 0) : null);
  const result = new Map<string, number>();
  for (const row of daily) {
    const total = chat(row);
    if (total == null) continue;
    if (row.day.endsWith('-01')) {
      result.set(row.day, total);
      continue;
    }
    const before = chat(rows.get(addDays(row.day, -1)));
    if (before != null) result.set(row.day, Math.max(0, total - before));
  }
  return result;
}

interface DayChartWords {
  /** "Pessoas ativas por dia" */
  title: string;
  /** ['pessoa', 'pessoas'] */
  unit: [string, string];
  /** "sem registro": o que um dia sem valor é. */
  missing: string;
  /** Todos os dias com valor deram zero: "Nenhuma pessoa ativa nos dias com registro." */
  none: string;
}

/** Um gráfico dos 30 dias que terminam em `today`. */
function dayChart(
  today: string,
  valueOf: (day: string) => { value: number | null; estimate: boolean },
  words: DayChartWords,
  note: string | null,
  empty: string | null,
): DashboardBars {
  const bars = windowDays(today).map((key): DashboardBar => {
    const { value, estimate } = valueOf(key);
    return { key, value, label: null, short: null, partial: key === today, estimate };
  });
  const values = bars.filter((bar): bar is DashboardBar & { value: number } => bar.value != null);
  const max = Math.max(0, ...values.map((bar) => bar.value));
  const unit = (value: number) => plural(value, ...words.unit);
  const last = bars[bars.length - 1];
  // Dos dias com o maior valor, o mais recente.
  const peak = [...values].reverse().find((bar) => bar.value === max);
  const missing = bars.filter((bar) => bar.value == null).length;
  const spoken = [
    `${words.title}, de ${dayMonth(bars[0].key)} a hoje.`,
    last.value == null ? `Hoje: ${words.missing}.` : `Hoje, até agora: ${unit(last.value)}.`,
    peak && max > 0 ? `Maior dia: ${unit(max)}, ${peak.key === today ? 'hoje' : `em ${dayMonth(peak.key)}`}.` : null,
    values.length > 0 && max === 0 ? words.none : null,
    missing ? `${plural(missing, 'dia', 'dias')} ${words.missing}.` : null,
    note,
  ];
  return {
    bars,
    max,
    startLabel: dayMonth(bars[0].key),
    endLabel: 'hoje, até agora',
    accessibilityLabel: spoken.filter(Boolean).join(' '),
    note,
    empty,
  };
}

/** O gráfico de pessoas ativas por dia, a partir das linhas de app_daily_stats. */
function activityChart(d: AppDashboard): DashboardBars {
  const days = windowDays(d.today);
  const rows = new Map(d.daily.map((row) => [row.day, row]));
  const inWindow = days.map((key) => rows.get(key)).filter((row): row is AppDashboardDay => row != null);
  const lastEstimate = [...inWindow].reverse().find((row) => row.backfilled);
  let note: string | null = null;
  if (lastEstimate) {
    // O primeiro dia contado de verdade depois dos reconstruídos.
    const firstReal = inWindow.find((row) => !row.backfilled && row.day > lastEstimate.day);
    note = firstReal
      ? `Antes de ${dayMonth(firstReal.day)}, conta só quem ainda estava conectado.`
      : 'Os dias em tom mais claro contam só quem ainda estava conectado.';
  }
  return dayChart(
    d.today,
    (key) => {
      const row = rows.get(key);
      return { value: row ? row.activeUsers : null, estimate: row?.backfilled ?? false };
    },
    {
      title: 'Pessoas ativas por dia',
      unit: ['pessoa', 'pessoas'],
      missing: 'sem registro',
      none: 'Nenhuma pessoa ativa nos dias com registro.',
    },
    note,
    inWindow.length ? null : 'O primeiro registro por dia aparece depois que a contagem diária rodar.',
  );
}

/** O uso de um tipo da IA num mês, somado nas casas (zero quando a rpc não mandou a linha). */
function aiMonth(d: AppDashboard, month: string, kind: AiKind): { uses: number; households: number } {
  const row = d.ai.months.find((entry) => entry.month === month && entry.kind === kind);
  return { uses: row?.uses ?? 0, households: row?.households ?? 0 };
}

function nukeSection(d: AppDashboard): DashboardView['nuke'] {
  const current = d.ai.month;
  const previous = shiftMonth(current, -1);
  const thisMonth = aiMonth(d, current, 'chat');
  const lastMonth = aiMonth(d, previous, 'chat');
  const usedBy = (value: number) => (value === 0 ? 'Nenhuma casa usou' : `De ${plural(value, 'casa', 'casas')}`);
  const messages = (value: number) => plural(value, 'mensagem', 'mensagens');
  const facts = [
    fact('mes', `${capitalize(monthName(current))}, até agora`, messages(thisMonth.uses), usedBy(thisMonth.households)),
    fact('anterior', capitalize(monthName(previous)), messages(lastMonth.uses), usedBy(lastMonth.households)),
  ];

  const first = shiftMonth(current, -(DASHBOARD_MONTHS - 1));
  const crossesYear = first.slice(0, 4) !== current.slice(0, 4);
  // Na virada do ano, "dezembro de 2025": sem o ano, dezembro e janeiro lado a lado confundem.
  const spokenMonth = (value: string) => (crossesYear ? monthLabel(value) : monthName(value));
  const bars = Array.from({ length: DASHBOARD_MONTHS }, (_, index): DashboardBar => {
    const key = shiftMonth(first, index);
    const value = aiMonth(d, key, 'chat').uses;
    return { key, value, label: monthShortLabel(key), short: num(value), partial: key === current, estimate: false };
  });
  const spoken = bars.map(
    (bar) => `${spokenMonth(bar.key)}${bar.partial ? ' até agora' : ''}: ${messages(bar.value ?? 0)}`,
  );
  const months: DashboardBars = {
    bars,
    max: Math.max(0, ...bars.map((bar) => bar.value ?? 0)),
    startLabel: null,
    endLabel: null,
    accessibilityLabel: `Mensagens com o Nuke por mês. ${capitalize(spoken.join('; '))}.`,
    note: null,
    empty: bars.some((bar) => (bar.value ?? 0) > 0) ? null : `Nenhuma mensagem com o Nuke nos últimos ${DASHBOARD_MONTHS} meses.`,
  };

  const byDay = nukeMessagesByDay(d.daily);
  const days = windowDays(d.today);
  const knownDays = days.filter((key) => byDay.has(key)).length;
  const perDay =
    knownDays >= 2
      ? dayChart(
          d.today,
          (key) => ({ value: byDay.get(key) ?? null, estimate: false }),
          {
            title: 'Mensagens com o Nuke por dia',
            unit: ['mensagem', 'mensagens'],
            missing: 'sem como saber',
            none: 'Nenhuma mensagem nos dias que dá para saber.',
          },
          knownDays < days.length ? 'Um dia sem valor não tem a contagem dele ou a do dia anterior.' : null,
          null,
        )
      : null;

  return { title: 'Nuke', facts, monthsTitle: 'Por mês', months, perDayTitle: 'Por dia', perDay };
}

function aiSection(d: AppDashboard): DashboardView['ai'] {
  const total = d.households.total;
  const rows = APP_AI_KINDS.map((kind) => {
    const { uses, households } = aiMonth(d, d.ai.month, kind);
    const limit = d.ai.limits[kind];
    const reach = total === 0 ? 'Nenhuma casa' : `${num(households)} de ${plural(total, 'casa', 'casas')}`;
    const detail = limit == null ? reach : `${reach} · limite de ${num(limit)} por casa`;
    return meter(kind, AI_KIND_LABELS[kind], num(uses), detail, share(households, total), `${num(uses)} neste mês`);
  });
  const parts = (entries: { kind: AiKind; households: number }[]) =>
    joinNames(
      APP_AI_KINDS.flatMap((kind) => {
        const households = entries.find((entry) => entry.kind === kind)?.households ?? 0;
        return households > 0 ? [`${plural(households, 'casa', 'casas')} em ${AI_KIND_NOUNS[kind]}`] : [];
      }),
    );
  const near = parts(d.ai.nearLimit);
  const at = parts(d.ai.atLimit);
  const limitNote = [at ? `No limite: ${at}.` : null, near ? `Perto do limite: ${near}.` : null].filter(Boolean).join(' ') || null;
  return {
    title: 'IA',
    intro: `Em ${monthName(d.ai.month)}, somando todas as casas. O limite é de cada casa e volta a zero no dia 1º.`,
    rows,
    limitNote,
  };
}

/** A frase das notas confirmadas em 30 dias, por origem. */
function receiptsSentence(d: AppDashboard): string {
  const counts = SOURCES.map((source) => ({
    source,
    value: d.receiptSources.find((row) => row.source === source)?.receipts30d ?? 0,
  })).filter((entry) => entry.value > 0);
  const total = counts.reduce((sum, entry) => sum + entry.value, 0);
  if (total === 0) return 'Nenhuma nota confirmada nos últimos 30 dias.';
  const head = `${plural(total, 'nota confirmada', 'notas confirmadas')} nos últimos 30 dias`;
  if (counts.length === 1) return `${head}, ${total === 1 ? '' : 'todas '}${SOURCE_LABELS[counts[0].source]}.`;
  return `${head}: ${joinNames(counts.map((entry) => `${num(entry.value)} ${SOURCE_LABELS[entry.source]}`))}.`;
}

function featuresSection(d: AppDashboard): DashboardView['features'] {
  const total = d.households.total;
  const rows = APP_FEATURES.map((feature) => {
    const row = d.features.find((entry) => entry.key === feature.key);
    return {
      key: feature.key,
      label: feature.label,
      households: row?.households ?? 0,
      households30d: row?.households30d ?? 0,
      events30d: row?.events30d ?? 0,
    };
  }).sort(
    (a, b) => b.households30d - a.households30d || b.households - a.households || a.label.localeCompare(b.label, 'pt-BR'),
  );
  const reach = (value: number) => (total === 0 ? 'Nenhuma casa' : `${num(value)} de ${plural(total, 'casa', 'casas')}`);
  const ever = (value: number) => plural(value, 'casa já usou', 'casas já usaram');
  const active = rows
    .filter((row) => row.households30d > 0)
    .map((row) => {
      const events = `${plural(row.events30d, 'registro', 'registros')} em 30 dias`;
      const detail = row.households > row.households30d ? `${events} · ${ever(row.households)}` : events;
      const value = reach(row.households30d);
      return meter(row.key, row.label, value, detail, share(row.households30d, total), `${value} em 30 dias`);
    });
  const idleRows = rows.filter((row) => row.households30d === 0);
  const idle = idleRows.map((row) =>
    meter(
      row.key,
      row.label,
      reach(0),
      row.households > 0 ? `${ever(row.households)}, nenhuma em 30 dias` : 'Nenhuma casa usou ainda',
      0,
    ),
  );
  return {
    title: 'O que as casas usam',
    intro: 'Quantas casas usaram cada função nos últimos 30 dias.',
    active,
    idle,
    idleSummary: idle.length ? `Sem uso nos últimos 30 dias: ${joinNames(idle.map((row) => row.label))}.` : null,
    showAll: 'Ver todas',
    showLess: 'Ver menos',
    receipts: receiptsSentence(d),
    empty: total === 0 ? 'Ainda não há casas.' : null,
  };
}

function funnelSection(d: AppDashboard, termsVersion: string): DashboardView['funnel'] {
  const total = d.accounts.total;
  const withoutHouse = Math.max(0, total - d.accounts.inHousehold);
  const { eligible, returned } = d.retention;
  const accepted = d.terms.find((row) => row.version === termsVersion)?.users ?? 0;
  const version = isValidISODate(termsVersion) ? formatBRDate(termsVersion) : termsVersion;
  return {
    title: 'Entrada',
    facts: [
      fact(
        'sem-casa',
        'Contas sem casa',
        partOf(withoutHouse, total, 'conta', 'contas'),
        'Criaram a conta e ainda não entraram em nenhuma casa.',
      ),
      eligible === 0
        ? fact(
            'voltaram',
            'Voltaram depois do primeiro dia',
            'Nenhuma conta ainda',
            'Aparece quando houver conta criada há mais de 7 dias.',
          )
        : fact(
            'voltaram',
            'Voltaram depois do primeiro dia',
            partOf(returned, eligible, 'conta', 'contas'),
            'Entre as contas criadas há mais de 7 dias.',
          ),
      fact('termos', 'Aceitaram os termos atuais', partOf(accepted, total, 'conta', 'contas'), `Versão de ${version}.`),
    ],
  };
}

function devicesSection(d: AppDashboard): DashboardView['devices'] {
  // Uma pessoa com dois aparelhos conta nos dois: a barra é sobre as pessoas ativas em 30 dias.
  const whole = Math.max(d.active.d30, ...d.platforms.map((row) => row.users));
  const rows = d.platforms
    .filter((row) => row.users > 0)
    .map((row) => ({ ...row, label: APP_PLATFORM_LABELS[row.platform] }))
    .sort((a, b) => b.users - a.users || a.label.localeCompare(b.label, 'pt-BR'))
    .map((row) => meter(row.platform, row.label, plural(row.users, 'pessoa', 'pessoas'), null, share(row.users, whole)));
  const clients = d.clients
    .filter((row) => row.users > 0)
    .sort((a, b) => b.users - a.users || a.client.localeCompare(b.client))
    .map((row) => `${plural(row.users, 'pessoa', 'pessoas')} ${CLIENT_LABELS[row.client]}`);
  return {
    title: 'Aparelhos',
    rows,
    clients: clients.length ? `${joinNames(clients)}.` : null,
    note: 'Conta quem usou o app nos últimos 30 dias sem sair da conta. Quem usa mais de um aparelho conta em cada um.',
    empty: rows.length ? null : 'Nenhum aparelho conectado nos últimos 30 dias.',
  };
}

function extrasSection(d: AppDashboard): DashboardView['extras'] {
  const beta = d.beta.find((row) => row.feature === FINANCE_BETA)?.users ?? 0;
  return {
    title: 'Outros',
    facts: [
      fact(
        'avisos',
        'Avisos do navegador',
        plural(d.push.users, 'pessoa', 'pessoas'),
        plural(d.push.subscriptions, 'navegador inscrito', 'navegadores inscritos'),
      ),
      fact('consultor', 'Consultor financeiro (beta)', plural(beta, 'pessoa', 'pessoas'), 'Com o acesso liberado.'),
      fact('precos', 'Preços compartilhados', plural(d.sharedPrices.rows, 'registro', 'registros'), 'Somando todas as casas.'),
    ],
  };
}

/** "Atualizado hoje às 14:05", no relógio do aparelho. */
function updatedText(generatedAt: string, now: Date): string {
  const at = new Date(generatedAt);
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const when = toISODate(at);
  const today = toISODate(now);
  if (when === today) return `Atualizado hoje às ${time}.`;
  if (when === addDays(today, -1)) return `Atualizado ontem às ${time}.`;
  return `Atualizado em ${formatShortDate(when, now.getFullYear())} às ${time}.`;
}

/**
 * Tudo o que a tela do painel mostra, montado da resposta lida: os números já escritos em pt-BR, as frases, as
 * barras e o que o leitor de tela diz de cada gráfico. Os 30 dias terminam em `d.today` (o dia de São Paulo no
 * servidor) e o mês é o do limite da IA (`d.ai.month`), nunca a data do aparelho; `now` só decide como dizer a
 * hora da atualização. `termsVersion` é a versão dos termos que conta como atual (TERMS_ACCEPT_VERSION).
 */
export function dashboardView(d: AppDashboard, opts: { termsVersion: string; now?: Date }): DashboardView {
  const now = opts.now ?? new Date();
  const nuke = aiMonth(d, d.ai.month, 'chat');
  const lastNuke = aiMonth(d, shiftMonth(d.ai.month, -1), 'chat').uses;

  const accountsDetail = d.accounts.new7d === 0 ? 'Nenhuma nova em 7 dias' : `+${num(d.accounts.new7d)} em 7 dias`;
  const activeDetail = `${num(d.active.d1)} em 24 h · ${num(d.active.d30)} em 30 dias`;
  const sharedDetail =
    d.households.shared === 0 ? 'Nenhuma com 2 ou mais pessoas' : `${num(d.households.shared)} com 2 ou mais pessoas`;
  const nukeUnit = nuke.uses === 1 ? 'mensagem' : 'mensagens';
  const nukeDetail = `${houses(nuke.households)} · mês passado ${num(lastNuke)}`;
  const nukeMessages = plural(nuke.uses, 'mensagem', 'mensagens');
  const nukeSpoken = nuke.households ? `${nukeMessages}, de ${plural(nuke.households, 'casa', 'casas')}` : nukeMessages;
  const stats: DashboardStat[] = [
    {
      key: 'contas',
      label: 'Contas',
      value: num(d.accounts.total),
      unit: null,
      detail: accountsDetail,
      accessibilityLabel: `Contas: ${num(d.accounts.total)}. ${accountsDetail}.`,
    },
    {
      key: 'ativas',
      label: 'Ativas em 7 dias',
      value: num(d.active.d7),
      unit: null,
      detail: activeDetail,
      accessibilityLabel:
        `Pessoas ativas em 7 dias: ${num(d.active.d7)}. ` +
        `Em 24 horas: ${num(d.active.d1)}. Em 30 dias: ${num(d.active.d30)}.`,
    },
    {
      key: 'casas',
      label: 'Casas',
      value: num(d.households.total),
      unit: null,
      detail: sharedDetail,
      accessibilityLabel: `Casas: ${num(d.households.total)}. ${sharedDetail}.`,
    },
    {
      key: 'nuke',
      label: 'Nuke no mês',
      value: num(nuke.uses),
      unit: nukeUnit,
      detail: nukeDetail,
      accessibilityLabel: `Nuke no mês: ${nukeSpoken}. Mês passado: ${num(lastNuke)}.`,
    },
  ];

  const signupsByDay = new Map(d.signups.map((row) => [row.day, row.count]));
  const signupsChart = dayChart(
    d.today,
    // A rpc manda todos os dias; um dia que faltar não teve conta nova.
    (key) => ({ value: signupsByDay.get(key) ?? 0, estimate: false }),
    { title: 'Contas novas por dia', unit: ['conta', 'contas'], missing: 'sem registro', none: 'Nenhuma conta nova no período.' },
    null,
    null,
  );
  const newAccounts = signupsChart.bars.reduce((sum, bar) => sum + (bar.value ?? 0), 0);

  return {
    title: APP_DASHBOARD_TITLE,
    stats: { title: 'Agora', items: stats },
    activity: { title: 'Uso por dia', chart: activityChart(d) },
    signups: {
      title: 'Novas contas',
      chart: signupsChart,
      summary:
        newAccounts === 0
          ? `Nenhuma conta nova nos últimos ${DASHBOARD_DAYS} dias.`
          : `${plural(newAccounts, 'conta nova', 'contas novas')} nos últimos ${DASHBOARD_DAYS} dias.`,
    },
    nuke: nukeSection(d),
    ai: aiSection(d),
    features: featuresSection(d),
    funnel: funnelSection(d, opts.termsVersion),
    devices: devicesSection(d),
    extras: extrasSection(d),
    footer: { updated: updatedText(d.generatedAt, now), notes: [APP_DASHBOARD_PRIVACY, APP_DASHBOARD_ACTIVITY_NOTE] },
  };
}

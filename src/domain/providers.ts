// Prestadores e consertos: quem faz serviço para a casa (diarista,
// eletricista, técnico da máquina…) e o histórico do que cada um fez. Aqui
// ficam os ofícios, o telefone brasileiro (como guardar e os links de
// WhatsApp e de ligação), a lista agrupada, os textos das linhas, a busca e
// a conferência dos dois formulários.

import type { ServiceJob, ServiceProvider } from '@/lib/types';

import type { IconName } from './categories';
import { formatBRDate, formatShortDate, parseBRDate } from './dates';
import { getFinanceCategory, type FinanceCategory } from './finance';
import { formatBRL, parseMoney } from './money';
import { normalizeSearch } from './search';

// ---------------------------------------------------------------------------
// O que a pessoa faz

export type ProviderTrade =
  | 'diarista'
  | 'eletricista'
  | 'encanador'
  | 'tecnico'
  | 'ar_condicionado'
  | 'pintor'
  | 'pedreiro'
  | 'marceneiro'
  | 'jardineiro'
  | 'chaveiro'
  | 'dedetizacao'
  | 'mecanico'
  | 'vidraceiro'
  | 'montador'
  | 'outros';

/** Espelho do check de service_providers.trade no banco; "outros" sempre por último. */
export const PROVIDER_TRADES: { key: ProviderTrade; label: string; icon: IconName }[] = [
  { key: 'diarista', label: 'Diarista', icon: 'broom' },
  { key: 'eletricista', label: 'Eletricista', icon: 'flash-outline' },
  { key: 'encanador', label: 'Encanador', icon: 'pipe-wrench' },
  { key: 'tecnico', label: 'Técnico de aparelhos', icon: 'washing-machine' },
  { key: 'ar_condicionado', label: 'Ar-condicionado', icon: 'air-conditioner' },
  { key: 'pintor', label: 'Pintor', icon: 'format-paint' },
  { key: 'pedreiro', label: 'Pedreiro', icon: 'wall' },
  { key: 'marceneiro', label: 'Marceneiro', icon: 'hand-saw' },
  { key: 'jardineiro', label: 'Jardineiro', icon: 'flower-outline' },
  { key: 'chaveiro', label: 'Chaveiro', icon: 'key-variant' },
  { key: 'dedetizacao', label: 'Dedetização', icon: 'bug-outline' },
  { key: 'mecanico', label: 'Mecânico', icon: 'car-wrench' },
  { key: 'vidraceiro', label: 'Vidraceiro', icon: 'window-closed-variant' },
  { key: 'montador', label: 'Montador de móveis', icon: 'screwdriver' },
  { key: 'outros', label: 'Outros', icon: 'tools' },
];

export function getProviderTrade(key: string) {
  return PROVIDER_TRADES.find((t) => t.key === key) ?? PROVIDER_TRADES[PROVIDER_TRADES.length - 1];
}

/** Limites dos textos, os mesmos dos checks do banco. */
export const PROVIDER_LIMITS = { name: 80, phone: 40, notes: 500, description: 200 } as const;

// ---------------------------------------------------------------------------
// Telefone

// DDDs que existem (Anatel). Um número com "DDD" fora daqui não é do Brasil
// ou foi digitado errado: fica guardado como a pessoa escreveu, sem os atalhos.
const AREA_CODES = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48,
  49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

const MOBILE = /^9\d{8}$/;
// Celular de antes do nono dígito (começava de 6 a 9): hoje leva o 9 na frente.
const OLD_MOBILE = /^[6-9]\d{7}$/;
// Fixo: 8 dígitos começando de 2 a 5 (os 4003/4004 das empresas entram aqui).
const LANDLINE = /^[2-5]\d{7}$/;
// 0800, 0300 e parecidos: valem no país todo, sem DDD.
const TOLL_FREE = /^0[3589]00\d{7}$/;

export type PhoneKind =
  /** Celular com DDD. */
  | 'celular'
  /** Fixo com DDD. */
  | 'fixo'
  /** Número do Brasil sem DDD: dá para ligar de perto, mas não para abrir o WhatsApp. */
  | 'sem_ddd'
  /** 0800 e parecidos. */
  | 'gratuito'
  /** Digitado com "+" e o código de outro país. */
  | 'exterior';

export interface ParsedPhone {
  kind: PhoneKind;
  /**
   * Só os dígitos, como vão para `phone_digits`: com 55 na frente quando o
   * número brasileiro está completo (5511987654321), o número como é
   * discado quando não tem DDD ou é 0800, e com o código do país no exterior.
   */
  digits: string;
}

/** Número local (sem DDD) já no formato de hoje, ou null. */
function localNumber(number: string): { number: string; mobile: boolean } | null {
  if (MOBILE.test(number)) return { number, mobile: true };
  if (OLD_MOBILE.test(number)) return { number: `9${number}`, mobile: true };
  if (LANDLINE.test(number)) return { number, mobile: false };
  return null;
}

/** DDD + número (10 ou 11 dígitos) de um telefone brasileiro, ou null. */
function nationalNumber(digits: string): ParsedPhone | null {
  if (digits.length !== 10 && digits.length !== 11) return null;
  if (!AREA_CODES.has(Number(digits.slice(0, 2)))) return null;
  // Com 11 dígitos só passa o celular já com o 9; com 10, o fixo ou o celular antigo.
  const local = localNumber(digits.slice(2));
  if (!local) return null;
  return { kind: local.mobile ? 'celular' : 'fixo', digits: `55${digits.slice(0, 2)}${local.number}` };
}

/**
 * Os trechos do texto que podem ser um telefone: o que sobra entre letras,
 * barras, vírgulas e qualquer coisa que não seja dígito, espaço, parêntese,
 * ponto, "+" ou traço, ficando só os trechos com algum dígito. Um telefone
 * escrito sozinho dá um trecho só, mesmo com palavras em volta ("zap (11)
 * 98765-4321 falar com a Ana"); "3456-7890 ramal 22" e "3456-7890/91" dão dois.
 */
function phonePieces(input: string): string[] {
  return (
    input
      // Número colado de outro app: marcas invisíveis de direção do texto e
      // traços tipográficos, que a pessoa nem vê, não partem o número.
      .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
      .replace(/[\u2010-\u2015\u2212]/g, '-')
      // "0xx11": o "xx" guarda o lugar da operadora, não separa dois números. Só
      // logo depois do zero do interurbano: em "3456-7890 xx 22" o zero é o fim
      // do número, e o "xx" continua separando o que vem depois.
      .replace(/(^|\D)0\s*xx\s*/i, (_, before: string) => `${before}0`)
      .split(/[^0-9\s().+-]+/)
      .map((piece) => piece.trim())
      .filter((piece) => /\d/.test(piece))
  );
}

// Nenhum telefone tem mais dígitos que isto (é também o limite de `phone_digits` no banco).
const MAX_PHONE_DIGITS = 15;

/** O trecho como ele é lido: "tel. +1 (415) …", o ponto de antes do número não esconde o "+". */
function pieceText(piece: string): string {
  return piece.replace(/^[.\s-]+/, '');
}

/**
 * Um número local inteiro, no jeito de sempre (4 + 4 ou 5 + 4 dígitos:
 * "3456-7890", "98765-4321"), com mais dígitos depois dele no mesmo trecho:
 * "3456-7890 (22)", "3456-7890 22", "011 3456-7890 22". O que vem depois é o
 * ramal, ou o DDD escrito no fim, e os dígitos juntos dariam outro DDD e o
 * número de outra pessoa ("34 5678-9022"). Número de fora do país ("+" sem o
 * 55) fica de fora: lá os grupos são outros.
 */
function localNumberThenMore(text: string): boolean {
  if (text.startsWith('+') && !text.replace(/\D/g, '').startsWith('55')) return false;
  const groups = text.split(/\D+/).filter(Boolean);
  return groups.some((group, i) => (group.length === 4 || group.length === 5) && groups[i + 1]?.length === 4 && i + 2 < groups.length);
}

/**
 * Lê um telefone digitado de qualquer jeito: "(11) 98765-4321", "11 3456 7890",
 * "+55 11 98765-4321", "011 98765-4321", "0xx11 3456-7890", "98765-4321",
 * "0800 701 0102". Espaços, traços, parênteses e palavras em volta não contam.
 * Devolve null quando não dá para reconhecer um número (curto ou comprido
 * demais, DDD que não existe, número que não começa como fixo nem celular) e
 * quando o texto tem mais de um (outro telefone, ramal, "casa 12"): juntar os
 * dígitos de dois trechos (ou de um número inteiro e o que vem depois dele)
 * daria um número completo, só que de outra pessoa.
 */
export function parsePhone(input: string | null | undefined): ParsedPhone | null {
  const pieces = phonePieces(input ?? '');
  if (pieces.length !== 1) return null;
  const text = pieceText(pieces[0]);
  const digits = text.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > MAX_PHONE_DIGITS) return null;
  if (localNumberThenMore(text)) return null;

  if (text.startsWith('+') && !digits.startsWith('55')) {
    return digits.length >= 10 ? { kind: 'exterior', digits } : null;
  }
  if (!text.startsWith('+') && TOLL_FREE.test(digits)) return { kind: 'gratuito', digits };

  // Com o 55 do país na frente (12 ou 13 dígitos: não se confunde com o DDD 55, que dá 10 ou 11).
  if (digits.startsWith('55') && digits.length >= 12) {
    const rest = digits.slice(2);
    // "+55 (0xx11) …", "+55 011 …": o zero do interurbano depois do 55. Nenhum
    // DDD começa com zero, então tirá-lo nunca troca um número por outro.
    return nationalNumber(rest) ?? (rest.startsWith('0') ? nationalNumber(rest.slice(1)) : null);
  }
  if (text.startsWith('+')) return null;

  if (digits.startsWith('0')) {
    // "00351 …", "001 415 …": o 00 de ligar para fora (no jeito europeu, seguido do país; aqui, da operadora).
    // Nenhuma operadora começa com zero, então não é o "zero + operadora" de baixo: tirar três dígitos deixaria
    // um DDD e um número daqui, de outra pessoa.
    if (digits.startsWith('00')) return null;
    // "011 98765-4321" (zero do interurbano) ou "015 11 98765-4321" (zero + operadora).
    const withoutZero = nationalNumber(digits.slice(1));
    return withoutZero ?? nationalNumber(digits.slice(3));
  }

  const national = nationalNumber(digits);
  if (national) return national;
  const local = localNumber(digits);
  return local ? { kind: 'sem_ddd', digits: local.number } : null;
}

/** O que vai para `phone_digits`; null quando o telefone não foi reconhecido. */
export function normalizePhone(input: string | null | undefined): string | null {
  return parsePhone(input)?.digits ?? null;
}

/**
 * Conversa no WhatsApp, a partir de `phone_digits`: só para número
 * brasileiro completo (com DDD), fixo ou celular. Sem DDD o WhatsApp não
 * sabe de quem é o número.
 */
export function whatsappLink(phoneDigits: string | null | undefined): string | null {
  if (!phoneDigits || !phoneDigits.startsWith('55')) return null;
  // Confere de novo: o que está guardado pode ter vindo de outra versão do app.
  return nationalNumber(phoneDigits.slice(2))?.digits === phoneDigits ? `https://wa.me/${phoneDigits}` : null;
}

/** Ligação, a partir de `phone_digits`. Sem DDD e 0800 vão como são discados. */
export function telLink(phoneDigits: string | null | undefined): string | null {
  if (!phoneDigits || !/^\d{8,15}$/.test(phoneDigits)) return null;
  return phoneDigits.length <= 9 || phoneDigits.startsWith('0') ? `tel:${phoneDigits}` : `tel:+${phoneDigits}`;
}

/** O aviso embaixo do campo, enquanto a pessoa digita; null quando está tudo certo (ou vazio). */
export function phoneHint(input: string): string | null {
  if (!input.trim()) return null;
  // Mais de um número, ou número com ramal (também dois números separados só
  // por espaço ou traço, que têm dígitos demais para um só, e o número inteiro
  // seguido de mais dígitos): "incompleto" não é o problema, e o aviso diz o
  // que fazer.
  const pieces = phonePieces(input);
  const [only] = pieces.length === 1 ? pieces.map(pieceText) : [];
  const digits = only?.replace(/\D/g, '') ?? '';
  const onlyOne = 'Para os atalhos de WhatsApp e de ligar, deixe aqui um número só, com DDD. Outro número ou o ramal cabem nas observações.';
  if (pieces.length > 1) return onlyOne;
  // O 00 de ligar para fora (os grupos que vêm depois são os de outro país): com o "+" no lugar, o app sabe que
  // o número é de lá.
  if (!only?.startsWith('+') && digits.startsWith('00')) {
    return 'Com o 00 na frente, o número fica guardado sem os atalhos. Se ele é de fora do país, escreva com o + e o código do país, como +351 912 345 678.';
  }
  if (only && (digits.length > MAX_PHONE_DIGITS || localNumberThenMore(only))) return onlyOne;
  const parsed = parsePhone(input);
  if (!parsed) return 'Não parece um telefone completo. Ele fica guardado assim, mas sem os atalhos de WhatsApp e de ligar.';
  if (parsed.kind === 'sem_ddd') return 'Sem o DDD não dá para abrir o WhatsApp. Ex.: (11) 98765-4321.';
  return null;
}

// ---------------------------------------------------------------------------
// Lista de prestadores

type ProviderLike = Pick<ServiceProvider, 'id' | 'name' | 'trade'>;
type JobLike = Pick<ServiceJob, 'id' | 'provider_id' | 'equipment_id' | 'done_on' | 'description' | 'amount' | 'created_at'>;

/** O mais recente primeiro; no mesmo dia, o registrado por último. */
export function newestFirst<T extends Pick<ServiceJob, 'done_on' | 'created_at'>>(a: T, b: T): number {
  return b.done_on.localeCompare(a.done_on) || b.created_at.localeCompare(a.created_at);
}

export interface ProviderRow<P, J> {
  provider: P;
  /** O serviço mais recente; null para quem ainda não fez nenhum. */
  lastJob: J | null;
  jobCount: number;
}

export interface ProviderGroup<P, J> {
  trade: (typeof PROVIDER_TRADES)[number];
  rows: ProviderRow<P, J>[];
}

/**
 * Prestadores por ofício, na ordem da lista de ofícios (só os que têm
 * alguém). Dentro do grupo, quem fez serviço há menos tempo vem primeiro;
 * quem nunca fez fica no fim, por nome.
 */
export function groupProviders<P extends ProviderLike, J extends JobLike>(providers: P[], jobs: J[]): ProviderGroup<P, J>[] {
  const byProvider = new Map<string, J[]>();
  for (const job of jobs) {
    const list = byProvider.get(job.provider_id);
    if (list) list.push(job);
    else byProvider.set(job.provider_id, [job]);
  }
  const rows = providers.map((provider): ProviderRow<P, J> => {
    const own = byProvider.get(provider.id) ?? [];
    return { provider, lastJob: own.length ? [...own].sort(newestFirst)[0] : null, jobCount: own.length };
  });
  const byName = (a: ProviderRow<P, J>, b: ProviderRow<P, J>) => a.provider.name.localeCompare(b.provider.name, 'pt-BR');
  rows.sort((a, b) => {
    if (a.lastJob && b.lastJob) return newestFirst(a.lastJob, b.lastJob) || byName(a, b);
    if (a.lastJob || b.lastJob) return a.lastJob ? -1 : 1;
    return byName(a, b);
  });
  return PROVIDER_TRADES.map((trade) => ({
    trade,
    rows: rows.filter((row) => getProviderTrade(row.provider.trade).key === trade.key),
  })).filter((group) => group.rows.length > 0);
}

/** Com mais prestadores que isto, a lista ganha o campo de busca. */
export const PROVIDER_SEARCH_MIN = 8;

/**
 * Busca sem acento nem maiúscula, por nome, ofício e pelo que foi feito (com
 * o nome do aparelho do serviço: "geladeira" acha quem consertou a
 * geladeira). Com mais de uma palavra, todas precisam aparecer.
 */
export function searchProviders<P extends ProviderLike, J extends JobLike>(
  query: string,
  providers: P[],
  jobs: J[],
  equipmentNames: ReadonlyMap<string, string> = new Map(),
): P[] {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (!words.length) return providers;
  return providers.filter((provider) => {
    const own = jobs.filter((job) => job.provider_id === provider.id);
    const haystack = normalizeSearch(
      [
        provider.name,
        getProviderTrade(provider.trade).label,
        ...own.map((job) => job.description),
        ...own.map((job) => (job.equipment_id ? equipmentNames.get(job.equipment_id) : null)),
      ]
        .filter(Boolean)
        .join(' \n '),
    );
    return words.every((word) => haystack.includes(word));
  });
}

/**
 * O que a busca não conseguiu olhar: os serviços (o que foi feito e, por
 * eles, o aparelho) ou só os nomes dos aparelhos. `loading`: ainda chegando.
 */
export interface SearchGap {
  what: 'jobs' | 'equipment';
  loading: boolean;
}

/** A leitura dos serviços ou dos aparelhos que a busca olha, como está nesta visita à lista. */
export interface SearchSource {
  /** Há linhas guardadas (desta visita ou de uma anterior). */
  hasRows: boolean;
  isFetching: boolean;
  /** Uma busca terminou depois que a lista abriu (do TanStack: conta também a que falhou). */
  isFetchedAfterMount: boolean;
  isError: boolean;
}

function sourceGap(what: SearchGap['what'], source: SearchSource): SearchGap | null {
  // Nada guardado: ainda chegando, ou não chegou.
  if (!source.hasRows) return { what, loading: source.isFetching };
  // O guardado é de uma visita anterior (ou de antes de uma busca que falhou), e a busca nova ainda anda: outro
  // celular pode ter registrado o conserto depois.
  if (source.isFetching && (!source.isFetchedAfterMount || source.isError)) return { what, loading: true };
  // A busca desta visita falhou: o guardado pode estar velho.
  if (source.isError) return { what, loading: false };
  return null;
}

/**
 * O que a busca não pôde olhar (ver emptySearchNote): os serviços e os
 * aparelhos só valem depois da leitura desta visita. Os de uma visita
 * anterior, guardados, podem não ter o que outro celular registrou depois;
 * eles valem enquanto ninguém os está buscando de novo (ainda novos), não
 * enquanto a busca anda nem depois de ela falhar.
 */
export function searchGap(jobs: SearchSource, equipment: SearchSource): SearchGap | null {
  return sourceGap('jobs', jobs) ?? sourceGap('equipment', equipment);
}

const SEARCH_GAP: Record<SearchGap['what'], { loading: string; failed: string }> = {
  jobs: { loading: 'Buscando também nos serviços…', failed: 'Não deu para buscar nos serviços: a busca olhou só o nome e o ofício.' },
  equipment: { loading: 'Buscando também nos aparelhos…', failed: 'Não deu para buscar nos aparelhos: a busca não olhou o nome deles.' },
};

/**
 * A linha da busca que não achou ninguém. "Nada encontrado" só quando ela
 * olhou tudo: com os serviços ou os aparelhos ainda chegando, ou sem eles, quem
 * consertou a geladeira pode existir. `onWeb`: no navegador não há o que puxar.
 */
export function emptySearchNote(query: string, gap: SearchGap | null, onWeb: boolean): string {
  if (!gap) return `Nada encontrado para “${query.trim()}”.`;
  if (gap.loading) return SEARCH_GAP[gap.what].loading;
  return `${SEARCH_GAP[gap.what].failed} ${onWeb ? 'Recarregue a página para tentar de novo.' : 'Puxe para atualizar.'}`;
}

// ---------------------------------------------------------------------------
// Textos dos serviços

/**
 * O último serviço, numa linha: "Consertou a máquina de lavar · 12/03/2026 ·
 * R$ 180,00". O aparelho entra depois do que foi feito, a não ser que o
 * texto já fale dele; sem valor, a linha acaba na data.
 */
export function jobLine(job: Pick<ServiceJob, 'description' | 'done_on' | 'amount'>, equipmentName?: string | null): string {
  const appliance = equipmentName?.trim();
  const mentioned = Boolean(appliance) && normalizeSearch(job.description).includes(normalizeSearch(appliance!));
  return [
    job.description,
    appliance && !mentioned ? appliance : null,
    formatBRDate(job.done_on),
    job.amount != null ? formatBRL(job.amount) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** "garantia do serviço até 12/06/2026" enquanto ela vale (o último dia conta); depois, null. */
export function serviceWarrantyText(warrantyUntil: string | null, today: string): string | null {
  if (!warrantyUntil || warrantyUntil < today) return null;
  return `garantia do serviço até ${formatBRDate(warrantyUntil)}`;
}

/**
 * O que vai embaixo do "o que foi feito" nos históricos: data, quem fez (na
 * tela do aparelho) ou em qual aparelho (na tela do prestador), valor e a
 * garantia do serviço, se ainda vale.
 */
export function jobDetails(
  job: Pick<ServiceJob, 'done_on' | 'amount' | 'warranty_until'>,
  { who, today }: { who?: string | null; today: string },
): string {
  return [
    formatBRDate(job.done_on),
    who || null,
    job.amount != null ? formatBRL(job.amount) : null,
    serviceWarrantyText(job.warranty_until, today),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Na linha do aparelho, na aba Casa: "Último serviço: 12 mar". */
export function lastServiceMention(job: Pick<ServiceJob, 'done_on'>, referenceYear?: number): string {
  return `Último serviço: ${formatShortDate(job.done_on, referenceYear)}`;
}

/**
 * A pergunta antes de excluir um prestador: o histórico dele vai junto.
 * `jobCount` nulo: os serviços não carregaram, então o aviso fala do histórico todo.
 */
export function deleteProviderWarning(name: string, jobCount: number | null): string {
  if (jobCount === 0) return `Excluir ${name}?`;
  const history =
    jobCount == null ? 'todo o histórico de serviços' : jobCount === 1 ? 'o serviço registrado' : `os ${jobCount} serviços registrados`;
  return `Excluir ${name} e ${history}? Não dá para desfazer. Os gastos já lançados em Finanças continuam lá.`;
}

// ---------------------------------------------------------------------------
// Gasto da casa

/**
 * Onde entra o serviço lançado nos gastos: Moradia, a categoria da manutenção
 * da casa; o do mecânico e o feito num veículo vão para Transporte, onde as
 * regras do banco já põem oficina e mecânica (domain/bankCategories).
 */
export function serviceExpenseCategory(trade: string | null | undefined, equipmentCategory: string | null | undefined): FinanceCategory {
  return trade === 'mecanico' || equipmentCategory === 'veiculo' ? 'transporte' : 'moradia';
}

export type ExpenseCopyGap = 'provider' | 'equipment';

/**
 * Como está, nesta visita à tela do serviço, a leitura de onde vêm o
 * prestador (a lista) ou o aparelho (a lista, ou ele sozinho). A tela pede
 * as duas ao abrir, mesmo com o guardado de segundos atrás: o ofício ou o
 * aparelho podem ter mudado em outro celular, e a categoria do gasto sai
 * deles. "Confirmada" quer dizer que uma leitura terminou depois que a tela
 * abriu (`isFetchedAfterMount` do TanStack, que conta só as respostas que
 * chegaram depois) e que a última terminou bem (sem erro depois dela). Uma
 * busca nova depois disso não desfaz o que chegou nesta visita; uma que
 * falhou, sim.
 */
export type SourceRead = 'confirmed' | 'loading' | 'failed' | 'offline';

export function readOnThisVisit(query: { isFetchedAfterMount: boolean; isError: boolean; isFetching: boolean; isPaused: boolean }): SourceRead {
  if (query.isFetchedAfterMount && !query.isError) return 'confirmed';
  if (query.isFetching) return 'loading';
  // Sem internet a busca fica parada, e recomeça sozinha quando ela volta.
  if (query.isPaused) return 'offline';
  if (query.isError) return 'failed';
  // Ainda não saiu (a busca de quem abre a tela sai em seguida).
  return 'loading';
}

/** O prestador ou o aparelho do serviço, para a cópia: se há um escolhido, se ele está no que a tela tem e a leitura de onde ele vem. */
export interface ExpenseCopySource {
  chosen: boolean;
  found: boolean;
  read: SourceRead;
}

/** Por que a cópia espera: a leitura ainda anda, falhou, ou está parada sem internet. */
export type ExpenseCopyWait = Exclude<SourceRead, 'confirmed'>;

function sourceWait({ chosen, found, read }: ExpenseCopySource): ExpenseCopyWait | null {
  if (!chosen) return null;
  // A leitura chegou e não o trouxe: não deu para carregar (a pessoa pode tentar de novo).
  if (read === 'confirmed') return found ? null : 'failed';
  return read;
}

/**
 * O que a tela do serviço ainda não sabe e segura a cópia para os gastos. Sem
 * o prestador não se sabe o ofício (o do mecânico vai para Transporte) nem o
 * nome que vai na descrição do gasto; sem o aparelho, não se sabe se é um
 * veículo, e um conserto do carro entraria em Moradia. Não basta estar nas
 * listas da tela: elas podem ser de antes de ele ser cadastrado, ou de antes
 * de uma mudança feita por outra pessoa da casa; vale o que chegou da leitura
 * desta visita (ver readOnThisVisit). O aparelho não faz falta quando o
 * prestador é o mecânico: já é Transporte.
 */
export function expenseCopyGap(
  trade: string | null | undefined,
  sources: Record<ExpenseCopyGap, ExpenseCopySource>,
): { gap: ExpenseCopyGap; wait: ExpenseCopyWait } | null {
  const provider = sourceWait(sources.provider);
  if (provider) return { gap: 'provider', wait: provider };
  if (trade === 'mecanico') return null;
  const equipment = sourceWait(sources.equipment);
  return equipment ? { gap: 'equipment', wait: equipment } : null;
}

const EXPENSE_COPY_GAP: Record<ExpenseCopyGap, { loading: string; what: string; decides: string }> = {
  provider: {
    loading: 'Carregando o prestador deste serviço…',
    what: 'o prestador deste serviço',
    decides: 'é o ofício dele que diz se o gasto entra em Moradia ou em Transporte',
  },
  equipment: {
    loading: 'Carregando o aparelho deste serviço…',
    what: 'o aparelho deste serviço',
    decides: 'é ele que diz se o gasto entra em Moradia ou em Transporte',
  },
};

function whyGap(gap: ExpenseCopyGap): string {
  return `Não deu para carregar ${EXPENSE_COPY_GAP[gap].what}, e ${EXPENSE_COPY_GAP[gap].decides}.`;
}

/**
 * A linha do cartão "Lançar também nos gastos da casa" enquanto a cópia espera
 * (ver expenseCopyGap): carregando; sem internet (a busca volta sozinha com
 * ela, não há o que tentar); ou não chegou, com o porquê e o que dá para fazer
 * (a tela põe o "Tentar de novo" embaixo). Nunca manda escolher outro
 * prestador ou outro aparelho: o do serviço pode não estar na lista de
 * escolha, e trocar mudaria o serviço e a categoria.
 */
export function expenseCopyGapNote(gap: ExpenseCopyGap, wait: ExpenseCopyWait): string {
  if (wait === 'loading') return EXPENSE_COPY_GAP[gap].loading;
  if (wait === 'offline') {
    return `Sem internet, não dá para conferir ${EXPENSE_COPY_GAP[gap].what}, e ${EXPENSE_COPY_GAP[gap].decides}. Quando a internet voltar, dá para lançar daqui.`;
  }
  return `${whyGap(gap)} Tente de novo, ou lance o gasto em Finanças.`;
}

/** Para quem salvou com a cópia ligada e o dado se perdeu antes: o serviço foi salvo, o gasto fica por conta da pessoa. */
export function expenseCopySkippedNote(gap: ExpenseCopyGap): string {
  return `${whyGap(gap)} Lance o gasto em Finanças.`;
}

/** A descrição do gasto: "Trocou a resistência do chuveiro (Zé Eletricista)". */
export function expenseDescription(description: string, providerName: string): string {
  const what = description.trim();
  const who = providerName.trim();
  return who ? `${what} (${who})` : what;
}

/** O valor como fica guardado no serviço: arredondado para centavos inteiros (numeric(12, 2) no banco). */
function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Só serviço com valor acima de zero vira gasto (um gasto não pode ser de
 * R$ 0,00). Conta o valor como ele é guardado: "0,004" é R$ 0,00, e o cartão
 * do gasto não aparece para ele.
 */
export function canCopyToExpenses(amount: number | null): amount is number {
  return amount != null && roundToCents(amount) > 0;
}

/**
 * A linha embaixo de "Lançar também nos gastos da casa": o gasto é uma cópia
 * feita na hora de salvar. Num serviço que já existia, lembra que lançar de
 * novo cria outro gasto (o app não sabe se ele já foi lançado). `category` é
 * a de serviceExpenseCategory: a linha diz onde o gasto entra de verdade.
 */
export function expenseCopyNote(editing: boolean, category: FinanceCategory): string {
  const label = getFinanceCategory(category).label;
  return editing
    ? `Cria um gasto novo em ${label} (se este serviço já foi lançado, fica em dobro). Mudar o serviço depois não muda o gasto.`
    : `Entra em ${label}, uma vez só: mudar o serviço depois não muda o gasto.`;
}

/** Prazos de garantia de serviço comuns, para preencher a data com um toque (contam do dia do serviço). */
export const SERVICE_WARRANTY_PRESETS = [
  { months: 3, label: '3 meses' },
  { months: 6, label: '6 meses' },
  { months: 12, label: '1 ano' },
];

// ---------------------------------------------------------------------------
// Formulários

export type ProviderValues = Omit<ServiceProvider, 'id' | 'created_at'>;
export type JobValues = Omit<ServiceJob, 'id' | 'created_at'>;

type Invalid = { ok: false; title: string; message: string };
const invalid = (title: string, message: string): Invalid => ({ ok: false, title, message });

/** O formulário do prestador como a pessoa digitou. */
export interface ProviderForm {
  name: string;
  trade: string;
  phone: string;
  notes: string;
  recommended: boolean;
}

/** Confere o formulário e devolve o que gravar, ou o aviso para a pessoa. */
export function validateProvider(form: ProviderForm): { ok: true; values: ProviderValues } | Invalid {
  const name = form.name.trim();
  if (!name) return invalid('Confira os dados', 'Informe o nome de quem presta o serviço (pessoa ou empresa).');
  if (name.length > PROVIDER_LIMITS.name) return invalid('Nome comprido demais', `O nome pode ter até ${PROVIDER_LIMITS.name} letras.`);
  if (!PROVIDER_TRADES.some((t) => t.key === form.trade)) return invalid('Confira os dados', 'Escolha o que a pessoa faz.');
  const phone = form.phone.trim();
  if (phone.length > PROVIDER_LIMITS.phone) {
    return invalid('Telefone comprido demais', `O telefone pode ter até ${PROVIDER_LIMITS.phone} caracteres. Outros contatos cabem nas observações.`);
  }
  const notes = form.notes.trim();
  if (notes.length > PROVIDER_LIMITS.notes) {
    return invalid('Texto comprido demais', `As observações podem ter até ${PROVIDER_LIMITS.notes} letras.`);
  }
  return {
    ok: true,
    values: {
      name,
      trade: form.trade,
      phone: phone || null,
      phone_digits: normalizePhone(phone),
      notes: notes || null,
      recommended: form.recommended,
    },
  };
}

// numeric(12, 2) no banco, que também confere de 0 até aqui.
const MAX_AMOUNT = 9_999_999_999.99;
// As datas de um serviço, como no banco: fora disso é erro de digitação no ano.
const JOB_DATE_MIN = '2000-01-01';
const JOB_DATE_MAX = '2100-12-31';
const inJobDateRange = (iso: string) => iso >= JOB_DATE_MIN && iso <= JOB_DATE_MAX;

/** O formulário do serviço como a pessoa digitou. */
export interface JobForm {
  providerId: string | null;
  /** dd/mm/aaaa. */
  date: string;
  description: string;
  equipmentId: string | null;
  /** Vazio: sem valor. */
  amount: string;
  /** dd/mm/aaaa ou vazio (sem garantia). */
  warranty: string;
  notes: string;
}

/** Confere o formulário e devolve o que gravar, ou o aviso para a pessoa. */
export function validateJob(form: JobForm): { ok: true; values: JobValues } | Invalid {
  if (!form.providerId) return invalid('Confira os dados', 'Escolha quem fez o serviço.');
  const description = form.description.trim();
  if (!description) return invalid('Confira os dados', 'Conte o que foi feito (ex.: Trocou a resistência do chuveiro).');
  if (description.length > PROVIDER_LIMITS.description) {
    return invalid('Texto comprido demais', `"O que foi feito" pode ter até ${PROVIDER_LIMITS.description} letras. O resto cabe nas observações.`);
  }
  const doneOn = parseBRDate(form.date);
  if (!doneOn) return invalid('Data inválida', 'Informe o dia do serviço como dd/mm/aaaa.');
  if (!inJobDateRange(doneOn)) return invalid('Data inválida', 'Confira o ano da data do serviço.');
  let amount: number | null = null;
  if (form.amount.trim()) {
    // Dinheiro: "1.500" aqui é mil e quinhentos.
    const value = parseMoney(form.amount);
    if (value == null || value > MAX_AMOUNT) return invalid('Valor inválido', 'Use um valor como 180,00, ou deixe em branco.');
    amount = roundToCents(value);
  }
  const warranty = form.warranty.trim() ? parseBRDate(form.warranty) : null;
  if (form.warranty.trim() && !warranty) return invalid('Data inválida', 'Informe a garantia como dd/mm/aaaa, ou deixe em branco.');
  if (warranty && !inJobDateRange(warranty)) return invalid('Data inválida', 'Confira o ano da garantia.');
  if (warranty && warranty < doneOn) return invalid('Data inválida', 'A garantia não pode acabar antes do dia do serviço.');
  const notes = form.notes.trim();
  if (notes.length > PROVIDER_LIMITS.notes) {
    return invalid('Texto comprido demais', `As observações podem ter até ${PROVIDER_LIMITS.notes} letras.`);
  }
  return {
    ok: true,
    values: {
      provider_id: form.providerId,
      equipment_id: form.equipmentId,
      done_on: doneOn,
      description,
      amount,
      warranty_until: warranty,
      notes: notes || null,
    },
  };
}

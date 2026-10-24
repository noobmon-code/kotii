// "Estou indo ao mercado": quem está saindo para as compras avisa a casa com
// um toque, para os outros porem na lista o que falta enquanto dá tempo. O
// servidor guarda a ida e manda o aviso (announce_market_trip, que também
// monta o título e o texto da notificação); aqui ficam as regras do que o app
// mostra: quais idas valem agora e os textos da faixa e do resultado.

import type { ListKind } from '@/lib/types';

/** Uma ida, como a casa a lê em public.market_trips. */
export interface MarketTrip {
  id: string;
  list_id: string;
  user_id: string;
  /** O nome que foi no aviso (o do morador naquela casa, já limpo pelo servidor). */
  display_name: string;
  created_at: string;
  /** Duas horas depois do aviso. */
  ends_at: string;
  ended_at: string | null;
  /**
   * A lista da ida, lida junto com ela: a faixa não depende de a tela já
   * conhecer a lista (a que outra pessoa acabou de criar ainda não está nas
   * listas guardadas neste aparelho).
   */
  list: { name: string; kind: ListKind; archived_at: string | null };
}

/** O que announce_market_trip devolve. */
export interface AnnounceResult {
  /** Nulo quando não havia mais ninguém na casa: nenhuma ida foi criada. */
  trip_id: string | null;
  created_at: string | null;
  /** Outros moradores com pelo menos um aviso posto na fila. */
  notified: number;
  /** Outros moradores da casa. */
  members: number;
  /** A casa já tinha sido avisada desta lista há menos de 30 minutos: nada foi mandado de novo. */
  repeated: boolean;
}

/** O banco ainda não tem a tabela, a coluna ou as funções (o app pode chegar antes da migração). */
export const TRIP_NOT_READY = 'O aviso de ida ao mercado ainda está sendo ativado no Kotii. Tente de novo mais tarde.';
/** NK005: o limite de idas novas por pessoa em 24 horas (as últimas 24, e não o dia do calendário: não diz "hoje"). */
export const TRIP_LIMIT_REACHED = 'Você já avisou a casa muitas vezes nas últimas 24 horas. Tente de novo mais tarde.';
/** Sem internet, ou sem resposta do servidor (no mercado o sinal some): o que dizer em cada pedido. */
export const TRIP_OFFLINE = {
  announce: 'Sem internet agora. Tente avisar de novo quando a conexão voltar.',
  end: 'Sem internet agora. Encerre quando a conexão voltar.',
};

/** A confirmação antes de avisar. */
export const TRIP_CONFIRM = {
  title: 'Avisar a casa?',
  message: 'Quem mora com você recebe um aviso para pôr na lista o que está faltando.',
  action: 'Avisar agora',
};

/** A opção em Família → "Avisos neste navegador" (o texto de ajuda ganha o ponto final lá, como os outros). */
export const TRIP_PUSH_OPTION = {
  label: 'Alguém indo ao mercado',
  hint: 'Quando alguém da casa avisa que está saindo para as compras. Chega em até um minuto',
};

/** Só há quem avisar com mais alguém na casa. */
export function canAnnounceTrip(members: number): boolean {
  return members > 1;
}

/** O botão da lista: "mercado" só na lista de mercado. */
export function tripActionLabel(kind: ListKind): string {
  return kind === 'mercado' ? 'Estou indo ao mercado' : 'Estou indo às compras';
}

/**
 * As idas que valem em `now`: não encerradas, antes do fim (em duas horas
 * exatas já acabou) e de uma lista que continua aberta (arquivada, ninguém
 * mais põe nada nela). De cada pessoa em cada lista, só a mais nova; da mais
 * nova para a mais antiga.
 */
export function liveTrips(trips: readonly MarketTrip[], now: Date): MarketTrip[] {
  const at = now.getTime();
  const newest = new Map<string, MarketTrip>();
  for (const trip of trips) {
    if (trip.ended_at || trip.list.archived_at || !(Date.parse(trip.ends_at) > at)) continue;
    const key = `${trip.user_id}|${trip.list_id}`;
    const seen = newest.get(key);
    if (!seen || Date.parse(trip.created_at) > Date.parse(seen.created_at)) newest.set(key, trip);
  }
  return [...newest.values()].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

/**
 * A ida que vale agora de quem está com o app (`userId`) nesta lista, ou null. Só quem avisou pode encerrar, e é
 * quem está no mercado: o selo "Novo" e a pergunta depois de "Limpar" partem dela.
 */
export function ownLiveTrip(
  trips: readonly MarketTrip[],
  { listId, userId, now }: { listId: string; userId: string | undefined; now: Date },
): MarketTrip | null {
  if (!userId) return null;
  return liveTrips(trips, now).find((trip) => trip.list_id === listId && trip.user_id === userId) ?? null;
}

/** O que o selo "Novo" usa de cada item da lista. */
export interface TripListItem {
  id: string;
  checked_at: string | null;
  created_at: string;
}

/**
 * Os itens que entraram na lista depois do aviso da ida e ainda estão para comprar: para quem está no mercado,
 * são o que a casa pediu depois que a pessoa saiu. Os que este aparelho pôs (`addedHere`) ficam de fora: a pessoa
 * já sabe deles. Sem ida (`trip` null), nenhum. As duas horas vêm do servidor (o item e a ida), sem o relógio do
 * aparelho; não há autor no item, então o selo não diz quem pôs.
 */
export function newDuringTrip(
  items: readonly TripListItem[],
  trip: Pick<MarketTrip, 'created_at'> | null,
  addedHere: ReadonlySet<string>,
): Set<string> {
  const ids = new Set<string>();
  if (!trip) return ids;
  const since = Date.parse(trip.created_at);
  if (Number.isNaN(since)) return ids;
  for (const item of items) {
    if (item.checked_at || addedHere.has(item.id)) continue;
    if (Date.parse(item.created_at) > since) ids.add(item.id);
  }
  return ids;
}

/**
 * Há quanto tempo: "agora há pouco", "há 12 min", "há 1 h 05 min". O relógio
 * do aparelho pode estar atrás do do servidor: um aviso "do futuro" também é
 * "agora há pouco", nunca um tempo negativo.
 */
export function tripAgo(createdAt: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - Date.parse(createdAt)) / 60_000);
  if (!(minutes >= 1)) return 'agora há pouco';
  if (minutes < 60) return `há ${minutes} min`;
  const rest = minutes % 60;
  return rest ? `há ${Math.floor(minutes / 60)} h ${String(rest).padStart(2, '0')} min` : `há ${Math.floor(minutes / 60)} h`;
}

/** A hora do aviso no relógio do aparelho: "10:32". */
export function tripClock(createdAt: string): string {
  const at = new Date(createdAt);
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

/** Até quantos caracteres (contados como o Array.from conta) do nome da lista a faixa da tela Hoje mostra. */
const TRIP_LIST_NAME_MAX = 40;

/** Faixas de caracteres, de [primeiro, último] código. */
export type Ranges = readonly (readonly [number, number])[];

/**
 * Os que push_text (no banco, ao montar o aviso) troca por espaço: controles, espaços especiais, os de direção do
 * texto (um "da direita para a esquerda" solto no meio da frase viraria o resto da linha) e os que não se veem.
 * Esta e a próxima são cópias das duas classes do push_text, mais o U+0000: um teste lê a migração e falha se
 * elas se separarem.
 */
export const PUSH_TEXT_HIDDEN: Ranges = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x00a0, 0x00a0],
  [0x00ad, 0x00ad],
  [0x034f, 0x034f],
  [0x061c, 0x061c],
  [0x115f, 0x1160],
  [0x1680, 0x1680],
  [0x17b4, 0x17b5],
  [0x180e, 0x180e],
  [0x2000, 0x200b],
  [0x200e, 0x200f],
  [0x2028, 0x202f],
  [0x205f, 0x206f],
  [0x2800, 0x2800],
  [0x3000, 0x3000],
  [0x3164, 0x3164],
  [0xfeff, 0xfeff],
  [0xffa0, 0xffa0],
  [0xfff0, 0xfffc],
  [0x1bca0, 0x1bca3],
  [0x1d159, 0x1d159],
  [0x1d173, 0x1d17a],
];
/**
 * Os que push_text não conta como algo que se vê (um nome só deles é vazio): acentos soltos, as junções dos
 * emojis, os seletores de variação e as etiquetas. Todos se juntam ao caractere de antes.
 */
export const PUSH_TEXT_INVISIBLE: Ranges = [
  [0x0300, 0x036f],
  [0x180b, 0x180f],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x200c, 0x200d],
  [0x20d0, 0x20ff],
  [0xfe00, 0xfe0f],
  [0xfe20, 0xfe2f],
  [0xe0000, 0xe007f],
  [0xe0100, 0xe01ef],
];
/** Os tons de pele, que também se juntam ao emoji de antes. */
const SKIN_TONES: Ranges = [[0x1f3fb, 0x1f3ff]];
/** As letras das bandeiras: cada bandeira é um par delas. */
const REGIONAL: Ranges = [[0x1f1e6, 0x1f1ff]];
const ZWJ = '\u200D';

function inRanges(char: string, ranges: Ranges): boolean {
  const code = char.codePointAt(0) ?? 0;
  return ranges.some(([first, last]) => code >= first && code <= last);
}

/**
 * O nome da lista de uma ida, como a tela Hoje o mostra: entre aspas, como no
 * aviso que o servidor manda, limpo como lá (os caracteres que push_text troca
 * por espaço, e os espaços e quebras de linha juntados num só) e, se for
 * comprido demais, cortado com reticências, sem partir um emoji, uma bandeira
 * ou uma letra acentuada. Vazio quando não sobra nada que se veja.
 */
export function tripListName(name: string): string {
  const clean = Array.from(name, (char) => (inRanges(char, PUSH_TEXT_HIDDEN) ? ' ' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(clean);
  if (chars.every((char) => char === ' ' || inRanges(char, PUSH_TEXT_INVISIBLE))) return '';
  if (chars.length <= TRIP_LIST_NAME_MAX) return `“${clean}”`;
  // Fica o que vem antes de `end`. O corte recua enquanto cairia dentro do que se vê como um caractere só: antes de
  // algo que se junta ao de antes, ou logo depois de uma junção (o emoji de família é um só).
  let end = TRIP_LIST_NAME_MAX - 1;
  while (end > 0 && (inRanges(chars[end], PUSH_TEXT_INVISIBLE) || inRanges(chars[end], SKIN_TONES) || chars[end - 1] === ZWJ)) end--;
  // Um número ímpar de letras de bandeira no fim deixaria meia bandeira.
  let flagLetters = 0;
  while (flagLetters < end && inRanges(chars[end - 1 - flagLetters], REGIONAL)) flagLetters++;
  if (flagLetters % 2) end--;
  // O nome que é um caractere só do começo ao corte (uma letra com dezenas de acentos, letras ligadas por junções):
  // corta no limite mesmo, para não sobrar só as reticências.
  if (end <= 0) end = TRIP_LIST_NAME_MAX - 1;
  return `“${chars.slice(0, end).join('').trimEnd()}…”`;
}

/**
 * O que o leitor de tela diz nos botões de uma ida na tela Hoje, onde há
 * vários "Encerrar" e "Abrir a lista": de qual lista é cada um e, no
 * "Encerrar", também a hora do aviso (duas listas podem ter o mesmo nome,
 * como "Mercado"). Sem nome que se veja, "Abrir a lista" fica só com o título.
 */
export function tripButtonLabels(trip: MarketTrip): { end: string; open: string | undefined } {
  const name = tripListName(trip.list.name);
  const clock = tripClock(trip.created_at);
  return {
    end: name ? `Encerrar a ida das ${clock} da lista ${name}` : `Encerrar a ida das ${clock}`,
    open: name ? `Abrir a lista ${name}` : undefined,
  };
}

/**
 * A linha da faixa (tela Hoje e lista). Para quem avisou, a hora em que
 * avisou; para os outros, quem está indo e há quanto tempo, com as mesmas
 * palavras do aviso que o servidor manda ("mercado" só na lista de mercado).
 * `withList`: também o nome da lista, para a tela Hoje, que junta as idas de
 * todas as listas (a mesma pessoa pode ter avisado de duas). Na lista, ela já
 * é a da tela.
 */
export function tripBannerText(
  trip: MarketTrip,
  { userId, now, withList = false }: { userId: string | undefined; now: Date; withList?: boolean },
): string {
  const name = withList ? tripListName(trip.list.name) : '';
  const list = name ? ` · lista ${name}` : '';
  if (trip.user_id === userId) return `Você avisou a casa às ${tripClock(trip.created_at)}${list}`;
  const going = trip.list.kind === 'mercado' ? 'está indo ao mercado' : 'está indo às compras';
  return `${trip.display_name} ${going}${list} · ${tripAgo(trip.created_at, now)}`;
}

/**
 * O que aconteceu depois de "Avisar agora", como foi: quantas pessoas
 * tiveram aviso mandado, de quantas (quem ficou sem a notificação só vê o
 * aviso ao abrir o app, e quem avisou precisa saber), ou nenhuma.
 */
export function announceResultText(result: AnnounceResult, now: Date): string {
  // O aviso repetido não mandou nada, e o primeiro pode não ter chegado a ninguém: só diz que a pessoa já avisou.
  if (result.repeated) return `Você já avisou a casa ${result.created_at ? tripAgo(result.created_at, now) : 'agora há pouco'}.`;
  // Ficou só na casa entre abrir a tela e tocar.
  if (result.members < 1) return 'Não há mais ninguém nesta casa para avisar.';
  if (result.notified < 1) {
    return 'Ninguém da casa está com os avisos do Kotii ligados no navegador. Quem abrir o app vê o aviso na tela Hoje.';
  }
  const missed = result.members - result.notified;
  if (missed < 1) return `Aviso enviado para ${result.notified} ${result.notified === 1 ? 'pessoa' : 'pessoas'}.`;
  const others = missed === 1 ? 'A outra vê o aviso quando abrir o app.' : 'As outras veem o aviso quando abrirem o app.';
  return `Aviso enviado para ${result.notified} de ${result.members} pessoas. ${others}`;
}

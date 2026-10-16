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

/**
 * A linha da faixa (tela Hoje e lista). Para quem avisou, a hora em que
 * avisou; para os outros, quem está indo e há quanto tempo, com as mesmas
 * palavras do aviso que o servidor manda ("mercado" só na lista de mercado).
 */
export function tripBannerText(trip: MarketTrip, { userId, now }: { userId: string | undefined; now: Date }): string {
  if (trip.user_id === userId) return `Você avisou a casa às ${tripClock(trip.created_at)}`;
  const going = trip.list.kind === 'mercado' ? 'está indo ao mercado' : 'está indo às compras';
  return `${trip.display_name} ${going} · ${tripAgo(trip.created_at, now)}`;
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

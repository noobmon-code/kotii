import { describe, expect, it } from '@jest/globals';

import {
  announceResultText,
  canAnnounceTrip,
  liveTrips,
  tripActionLabel,
  tripAgo,
  tripBannerText,
  tripClock,
  tripListName,
  type AnnounceResult,
  type MarketTrip,
} from '../marketTrips';

const at = (iso: string) => new Date(iso);

/** Uma ida avisada em `created`, que vale duas horas, de uma lista de mercado aberta. */
const trip = (id: string, created: string, over: Partial<MarketTrip> = {}): MarketTrip => ({
  id,
  list_id: 'lista',
  user_id: 'ana',
  display_name: 'Ana',
  created_at: created,
  ends_at: new Date(Date.parse(created) + 2 * 3_600_000).toISOString(),
  ended_at: null,
  list: { name: 'Mercado', kind: 'mercado', archived_at: null },
  ...over,
});

/** A lista que veio com a ida, de outro tipo ou arquivada. */
const listOf = (over: Partial<MarketTrip['list']>): MarketTrip['list'] => ({ name: 'Farmácia', kind: 'farmacia', archived_at: null, ...over });

describe('liveTrips', () => {
  it('vale por duas horas: um instante antes ainda aparece, em duas horas exatas não', () => {
    const trips = [trip('a', '2026-10-13T10:00:00Z')];
    expect(liveTrips(trips, at('2026-10-13T10:00:00Z')).map((t) => t.id)).toEqual(['a']);
    expect(liveTrips(trips, at('2026-10-13T11:59:59.999Z')).map((t) => t.id)).toEqual(['a']);
    expect(liveTrips(trips, at('2026-10-13T12:00:00Z'))).toEqual([]);
    expect(liveTrips(trips, at('2026-10-13T15:00:00Z'))).toEqual([]);
  });

  it('encerrada sai na hora, mesmo dentro das duas horas', () => {
    const trips = [trip('a', '2026-10-13T10:00:00Z', { ended_at: '2026-10-13T10:05:00Z' })];
    expect(liveTrips(trips, at('2026-10-13T10:06:00Z'))).toEqual([]);
  });

  it('duas pessoas indo: as duas aparecem, a que avisou por último primeiro', () => {
    const trips = [
      trip('ana', '2026-10-13T10:00:00Z'),
      trip('beto', '2026-10-13T10:20:00Z', { user_id: 'beto', display_name: 'Beto' }),
    ];
    expect(liveTrips(trips, at('2026-10-13T10:30:00Z')).map((t) => t.id)).toEqual(['beto', 'ana']);
  });

  it('a mesma pessoa em duas listas: uma ida por lista', () => {
    const trips = [trip('mercado', '2026-10-13T10:00:00Z'), trip('farmacia', '2026-10-13T10:10:00Z', { list_id: 'farmacia' })];
    expect(liveTrips(trips, at('2026-10-13T10:30:00Z')).map((t) => t.id)).toEqual(['farmacia', 'mercado']);
  });

  it('a mesma pessoa avisou a mesma lista de novo: só a ida mais nova, venha em que ordem vier', () => {
    const old = trip('velha', '2026-10-13T10:00:00Z');
    const fresh = trip('nova', '2026-10-13T10:40:00Z');
    expect(liveTrips([old, fresh], at('2026-10-13T10:50:00Z')).map((t) => t.id)).toEqual(['nova']);
    expect(liveTrips([fresh, old], at('2026-10-13T10:50:00Z')).map((t) => t.id)).toEqual(['nova']);
    // A nova foi encerrada: a anterior, que ainda vale, continua.
    expect(liveTrips([old, { ...fresh, ended_at: '2026-10-13T10:45:00Z' }], at('2026-10-13T10:50:00Z')).map((t) => t.id)).toEqual(['velha']);
  });

  it('relógio do aparelho atrasado: a ida "do futuro" já aparece', () => {
    expect(liveTrips([trip('a', '2026-10-13T10:01:00Z')], at('2026-10-13T10:00:00Z')).map((t) => t.id)).toEqual(['a']);
  });

  it('lista arquivada: a ida dela não aparece, as das listas abertas sim', () => {
    const archived = listOf({ archived_at: '2026-10-13T10:15:00Z' });
    const trips = [trip('arquivada', '2026-10-13T10:10:00Z', { list_id: 'velha', list: archived }), trip('aberta', '2026-10-13T10:00:00Z')];
    expect(liveTrips(trips, at('2026-10-13T10:30:00Z')).map((t) => t.id)).toEqual(['aberta']);
    // A mesma pessoa avisou a lista duas vezes antes de ela ser arquivada: nenhuma das duas idas volta.
    const twice = [trip('a', '2026-10-13T10:00:00Z', { list: archived }), trip('b', '2026-10-13T10:10:00Z', { list: archived })];
    expect(liveTrips(twice, at('2026-10-13T10:30:00Z'))).toEqual([]);
  });

  it('data que não dá para ler não aparece (nem derruba a tela)', () => {
    expect(liveTrips([trip('a', '2026-10-13T10:00:00Z', { ends_at: 'x' })], at('2026-10-13T10:01:00Z'))).toEqual([]);
    expect(liveTrips([], at('2026-10-13T10:01:00Z'))).toEqual([]);
  });
});

describe('tripAgo', () => {
  const since = '2026-10-13T10:00:00Z';

  it('menos de um minuto é "agora há pouco"', () => {
    expect(tripAgo(since, at('2026-10-13T10:00:00Z'))).toBe('agora há pouco');
    expect(tripAgo(since, at('2026-10-13T10:00:59.999Z'))).toBe('agora há pouco');
  });

  it('aviso "do futuro" (relógio do aparelho atrasado) também, nunca um tempo negativo', () => {
    expect(tripAgo(since, at('2026-10-13T09:59:00Z'))).toBe('agora há pouco');
    expect(tripAgo(since, at('2026-10-13T08:00:00Z'))).toBe('agora há pouco');
    expect(tripAgo('x', at('2026-10-13T08:00:00Z'))).toBe('agora há pouco');
  });

  it('minutos inteiros até uma hora; depois, horas e minutos', () => {
    expect(tripAgo(since, at('2026-10-13T10:01:00Z'))).toBe('há 1 min');
    expect(tripAgo(since, at('2026-10-13T10:12:40Z'))).toBe('há 12 min');
    expect(tripAgo(since, at('2026-10-13T10:59:59Z'))).toBe('há 59 min');
    expect(tripAgo(since, at('2026-10-13T11:00:00Z'))).toBe('há 1 h');
    expect(tripAgo(since, at('2026-10-13T11:05:00Z'))).toBe('há 1 h 05 min');
    expect(tripAgo(since, at('2026-10-13T11:59:59Z'))).toBe('há 1 h 59 min');
  });
});

describe('tripClock', () => {
  it('a hora do aviso no relógio do aparelho, com dois dígitos', () => {
    expect(tripClock(new Date(2026, 9, 13, 10, 32, 50).toISOString())).toBe('10:32');
    expect(tripClock(new Date(2026, 9, 13, 7, 5).toISOString())).toBe('07:05');
    expect(tripClock(new Date(2026, 9, 13, 0, 0).toISOString())).toBe('00:00');
  });
});

describe('tripBannerText', () => {
  const created = new Date(2026, 9, 13, 10, 32).toISOString();
  const now = new Date(2026, 9, 13, 10, 44);
  const going = trip('a', created);
  // O tipo é o da lista que veio com a ida: a tela não precisa conhecer a lista.
  const pharmacy = trip('f', created, { list: listOf({ kind: 'farmacia' }) });
  const other = trip('o', created, { list: listOf({ kind: 'outros' }) });

  it('para os outros: quem está indo e há quanto tempo', () => {
    expect(tripBannerText(going, { userId: 'beto', now })).toBe('Ana está indo ao mercado · há 12 min');
    expect(tripBannerText(going, { userId: 'beto', now: new Date(2026, 9, 13, 10, 32, 20) })).toBe('Ana está indo ao mercado · agora há pouco');
  });

  it('para quem avisou: a hora em que avisou', () => {
    expect(tripBannerText(going, { userId: 'ana', now })).toBe('Você avisou a casa às 10:32');
    expect(tripBannerText(pharmacy, { userId: 'ana', now })).toBe('Você avisou a casa às 10:32');
  });

  it('lista que não é de mercado: "às compras"', () => {
    expect(tripBannerText(pharmacy, { userId: 'beto', now })).toBe('Ana está indo às compras · há 12 min');
    expect(tripBannerText(other, { userId: undefined, now })).toBe('Ana está indo às compras · há 12 min');
  });

  it('na tela Hoje (withList), também o nome da lista, entre aspas', () => {
    expect(tripBannerText(going, { userId: 'beto', now, withList: true })).toBe('Ana está indo ao mercado · lista “Mercado” · há 12 min');
    expect(tripBannerText(pharmacy, { userId: 'beto', now, withList: true })).toBe('Ana está indo às compras · lista “Farmácia” · há 12 min');
    expect(tripBannerText(going, { userId: 'ana', now, withList: true })).toBe('Você avisou a casa às 10:32 · lista “Mercado”');
  });

  it('sem withList (a faixa da própria lista), sem o nome, como antes', () => {
    expect(tripBannerText(going, { userId: 'beto', now, withList: false })).toBe('Ana está indo ao mercado · há 12 min');
    expect(tripBannerText(going, { userId: 'ana', now, withList: false })).toBe('Você avisou a casa às 10:32');
  });

  it('a lista com um nome só de espaços fica sem ele', () => {
    const blank = trip('b', created, { list: listOf({ name: ' \n\t ', kind: 'mercado' }) });
    expect(tripBannerText(blank, { userId: 'beto', now, withList: true })).toBe('Ana está indo ao mercado · há 12 min');
    expect(tripBannerText(blank, { userId: 'ana', now, withList: true })).toBe('Você avisou a casa às 10:32');
  });
});

describe('tripListName', () => {
  it('entre aspas, com os espaços e as quebras de linha juntados num só', () => {
    expect(tripListName('Feira')).toBe('“Feira”');
    expect(tripListName('  Feira\n de   sábado ')).toBe('“Feira de sábado”');
  });

  it('até 40 letras inteiro; mais que isso, cortado com reticências', () => {
    expect(tripListName('a'.repeat(40))).toBe(`“${'a'.repeat(40)}”`);
    expect(tripListName('a'.repeat(41))).toBe(`“${'a'.repeat(39)}…”`);
    // O corte que cai num espaço não deixa o espaço antes das reticências.
    expect(tripListName(`${'a'.repeat(38)} bbbbb`)).toBe(`“${'a'.repeat(38)}…”`);
  });

  it('conta por letra, e não parte um emoji ao meio', () => {
    expect(tripListName(`${'a'.repeat(38)}🛒🛒`)).toBe(`“${'a'.repeat(38)}🛒🛒”`);
    expect(tripListName(`${'a'.repeat(38)}🛒bbbbb`)).toBe(`“${'a'.repeat(38)}🛒…”`);
  });

  it('só espaços: vazio', () => {
    expect(tripListName('')).toBe('');
    expect(tripListName(' \n ')).toBe('');
  });
});

describe('announceResultText', () => {
  const now = at('2026-10-13T10:12:00Z');
  const result = (over: Partial<AnnounceResult>): AnnounceResult => ({
    trip_id: 'ida',
    created_at: '2026-10-13T10:12:00Z',
    notified: 0,
    members: 2,
    repeated: false,
    ...over,
  });

  it('todos os outros tiveram aviso mandado: quantas pessoas, no singular e no plural', () => {
    expect(announceResultText(result({ notified: 1, members: 1 }), now)).toBe('Aviso enviado para 1 pessoa.');
    expect(announceResultText(result({ notified: 2, members: 2 }), now)).toBe('Aviso enviado para 2 pessoas.');
    expect(announceResultText(result({ notified: 4, members: 4 }), now)).toBe('Aviso enviado para 4 pessoas.');
  });

  it('só parte da casa teve aviso mandado: diz de quantas, e que as outras veem no app', () => {
    expect(announceResultText(result({ notified: 1, members: 3 }), now)).toBe(
      'Aviso enviado para 1 de 3 pessoas. As outras veem o aviso quando abrirem o app.',
    );
    expect(announceResultText(result({ notified: 2, members: 4 }), now)).toBe(
      'Aviso enviado para 2 de 4 pessoas. As outras veem o aviso quando abrirem o app.',
    );
    // Uma só ficou sem a notificação.
    expect(announceResultText(result({ notified: 1, members: 2 }), now)).toBe('Aviso enviado para 1 de 2 pessoas. A outra vê o aviso quando abrir o app.');
    expect(announceResultText(result({ notified: 2, members: 3 }), now)).toBe('Aviso enviado para 2 de 3 pessoas. A outra vê o aviso quando abrir o app.');
  });

  it('mais avisos do que moradores na conta (alguém saiu da casa no meio): só o número, sem "de"', () => {
    expect(announceResultText(result({ notified: 3, members: 2 }), now)).toBe('Aviso enviado para 3 pessoas.');
  });

  it('ninguém com os avisos ligados: diz que o aviso fica na tela Hoje', () => {
    expect(announceResultText(result({ notified: 0 }), now)).toBe(
      'Ninguém da casa está com os avisos do Kotii ligados no navegador. Quem abrir o app vê o aviso na tela Hoje.',
    );
  });

  it('avisada de novo em menos de 30 minutos: há quanto tempo a pessoa avisou, sem dizer que chegou a alguém', () => {
    expect(announceResultText(result({ repeated: true, created_at: '2026-10-13T10:00:00Z' }), now)).toBe('Você já avisou a casa há 12 min.');
    expect(announceResultText(result({ repeated: true, created_at: '2026-10-13T10:11:30Z' }), now)).toBe('Você já avisou a casa agora há pouco.');
    // O relógio do aparelho atrás do servidor.
    expect(announceResultText(result({ repeated: true, created_at: '2026-10-13T10:13:00Z' }), now)).toBe('Você já avisou a casa agora há pouco.');
    expect(announceResultText(result({ repeated: true, created_at: null }), now)).toBe('Você já avisou a casa agora há pouco.');
    // O servidor repete sem contar ninguém (notified 0): é o aviso repetido, não "ninguém com os avisos ligados".
    expect(announceResultText(result({ repeated: true, notified: 0, members: 3, created_at: '2026-10-13T10:00:00Z' }), now)).toBe(
      'Você já avisou a casa há 12 min.',
    );
  });

  it('ficou só na casa: não há quem avisar', () => {
    expect(announceResultText(result({ trip_id: null, created_at: null, members: 0 }), now)).toBe('Não há mais ninguém nesta casa para avisar.');
  });
});

describe('o botão da lista', () => {
  it('"mercado" só na lista de mercado', () => {
    expect(tripActionLabel('mercado')).toBe('Estou indo ao mercado');
    expect(tripActionLabel('farmacia')).toBe('Estou indo às compras');
    expect(tripActionLabel('outros')).toBe('Estou indo às compras');
  });

  it('só aparece com mais alguém na casa', () => {
    expect(canAnnounceTrip(0)).toBe(false);
    expect(canAnnounceTrip(1)).toBe(false);
    expect(canAnnounceTrip(2)).toBe(true);
    expect(canAnnounceTrip(5)).toBe(true);
  });
});

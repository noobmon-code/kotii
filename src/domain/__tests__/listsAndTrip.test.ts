import { describe, expect, it } from '@jest/globals';

import { CHOSEN_STORE_MS, parseStoreChoice } from '../listEstimate';
import { type MarketTrip, newDuringTrip, ownLiveTrip } from '../marketTrips';
import { cleanListName, LIST_NAME_MAX, listNameError } from '../shoppingListName';

const NOW = new Date('2026-10-24T15:00:00Z');

const trip = (patch: Partial<MarketTrip> = {}): MarketTrip => ({
  id: 't1',
  list_id: 'l1',
  user_id: 'eu',
  display_name: 'Ana',
  created_at: '2026-10-24T14:00:00Z',
  ends_at: '2026-10-24T16:00:00Z',
  ended_at: null,
  list: { name: 'Mercado', kind: 'mercado', archived_at: null },
  ...patch,
});

const item = (id: string, created_at: string, checked_at: string | null = null) => ({ id, created_at, checked_at });

describe('ownLiveTrip: a ida de quem está com o app nesta lista', () => {
  it('acha a própria ida que vale agora nesta lista', () => {
    expect(ownLiveTrip([trip()], { listId: 'l1', userId: 'eu', now: NOW })?.id).toBe('t1');
  });

  it('a ida de outra pessoa, de outra lista, encerrada, vencida ou sem sessão: nenhuma', () => {
    expect(ownLiveTrip([trip({ user_id: 'outra' })], { listId: 'l1', userId: 'eu', now: NOW })).toBeNull();
    expect(ownLiveTrip([trip({ list_id: 'l2' })], { listId: 'l1', userId: 'eu', now: NOW })).toBeNull();
    expect(ownLiveTrip([trip({ ended_at: '2026-10-24T14:30:00Z' })], { listId: 'l1', userId: 'eu', now: NOW })).toBeNull();
    expect(ownLiveTrip([trip({ ends_at: '2026-10-24T15:00:00Z' })], { listId: 'l1', userId: 'eu', now: NOW })).toBeNull();
    expect(ownLiveTrip([trip()], { listId: 'l1', userId: undefined, now: NOW })).toBeNull();
  });

  it('com duas idas da pessoa na lista, vale a mais nova', () => {
    const older = trip({ id: 'velha', created_at: '2026-10-24T13:30:00Z' });
    expect(ownLiveTrip([older, trip()], { listId: 'l1', userId: 'eu', now: NOW })?.id).toBe('t1');
  });
});

describe('newDuringTrip: o selo "Novo" na ida ao mercado', () => {
  const items = [
    item('antes', '2026-10-24T13:59:59Z'),
    item('no-aviso', '2026-10-24T14:00:00Z'),
    item('depois', '2026-10-24T14:20:00Z'),
    item('no-carrinho', '2026-10-24T14:25:00Z', '2026-10-24T14:40:00Z'),
    item('deste-aparelho', '2026-10-24T14:30:00Z'),
  ];

  it('só o que entrou depois do aviso, ainda para comprar, e que este aparelho não pôs', () => {
    expect([...newDuringTrip(items, trip(), new Set(['deste-aparelho']))]).toEqual(['depois']);
  });

  it('sem ida (de ninguém, ou a de outra pessoa, que ownLiveTrip não devolve), nenhum selo', () => {
    const others = ownLiveTrip([trip({ user_id: 'outra' })], { listId: 'l1', userId: 'eu', now: NOW });
    expect(newDuringTrip(items, others, new Set()).size).toBe(0);
    expect(newDuringTrip(items, null, new Set()).size).toBe(0);
  });

  it('a hora da ida que não se lê não marca nada', () => {
    expect(newDuringTrip(items, { created_at: 'quando?' }, new Set()).size).toBe(0);
  });
});

describe('parseStoreChoice: o "Onde estou" guardado no aparelho', () => {
  const at = NOW.getTime();

  it('a escolha guardada volta enquanto as 6 horas não passaram', () => {
    expect(parseStoreChoice(JSON.stringify({ storeId: 's1', at }), at + CHOSEN_STORE_MS - 1)).toEqual({ storeId: 's1', at });
  });

  it('depois das 6 horas, some', () => {
    expect(parseStoreChoice(JSON.stringify({ storeId: 's1', at }), at + CHOSEN_STORE_MS)).toBeNull();
  });

  it.each([
    ['nada guardado', null],
    ['texto vazio', ''],
    ['texto que não é JSON', '{s1'],
    ['sem o mercado', JSON.stringify({ at })],
    ['mercado vazio', JSON.stringify({ storeId: '', at })],
    ['hora em texto', JSON.stringify({ storeId: 's1', at: String(at) })],
    ['um número solto', '42'],
  ])('%s: nenhuma escolha', (_why, raw) => {
    expect(parseStoreChoice(raw, at)).toBeNull();
  });
});

describe('o nome da lista ao renomear', () => {
  it('sai sem espaços nas pontas nem repetidos, e sem os caracteres que não se veem', () => {
    const hidden = String.fromCodePoint(0x200b);
    expect(cleanListName(`  Feira${hidden}do   sábado \n`)).toBe('Feira do sábado');
  });

  it('vazio, só espaços ou só um acento solto: pede o nome', () => {
    expect(listNameError('')).toBe('Escreva o nome da lista.');
    expect(listNameError('   ')).toBe('Escreva o nome da lista.');
    expect(listNameError(String.fromCodePoint(0x0301))).toBe('Escreva o nome da lista.');
  });

  it('até 60 letras, contando um emoji como uma', () => {
    expect(listNameError('a'.repeat(LIST_NAME_MAX))).toBeNull();
    expect(listNameError(`${'a'.repeat(LIST_NAME_MAX - 1)}${String.fromCodePoint(0x1f6d2)}`)).toBeNull();
    expect(listNameError('a'.repeat(LIST_NAME_MAX + 1))).toBe('Use até 60 letras.');
  });
});

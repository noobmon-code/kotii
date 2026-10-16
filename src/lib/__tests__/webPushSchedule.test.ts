import { describe, expect, it } from '@jest/globals';

import { base64UrlToBytes, isServerPush, sameKey, scheduleRow, TRIGGER_TYPES } from '../webPushSchedule';

describe('agenda do navegador', () => {
  const content = { title: 'Amoxicilina — Ana', body: 'Hora de tomar: 5 ml', data: { medicationId: 'm1' } };

  it('todo dia e toda semana guardam a hora local; o servidor calcula a próxima vez', () => {
    expect(scheduleRow('a', 's', { content, trigger: { type: TRIGGER_TYPES.DAILY, hour: 8, minute: 30 } })).toEqual({
      id: 'a',
      subscription_id: 's',
      title: 'Amoxicilina — Ana',
      body: 'Hora de tomar: 5 ml',
      data: { medicationId: 'm1' },
      repeat: 'daily',
      hour: 8,
      minute: 30,
    });
    expect(scheduleRow('b', 's', { content, trigger: { type: TRIGGER_TYPES.WEEKLY, weekday: 2, hour: 9, minute: 0 } })).toMatchObject({
      repeat: 'weekly',
      weekday: 2,
      hour: 9,
      minute: 0,
    });
  });

  it('numa data, o instante exato (o fuso do aparelho já está na data)', () => {
    const date = new Date(Date.UTC(2026, 9, 1, 12, 0));
    expect(scheduleRow('c', 's', { content: { title: 'Conta vence hoje' }, trigger: { type: TRIGGER_TYPES.DATE, date } })).toEqual({
      id: 'c',
      subscription_id: 's',
      title: 'Conta vence hoje',
      body: '',
      data: {},
      repeat: 'once',
      fire_at: '2026-10-01T12:00:00.000Z',
    });
  });

  it('linha posta pelo servidor (a marca data.server, a mesma que a poda do banco olha) não é lembrete do app', () => {
    expect(isServerPush({ reminder: 'ida:t1', server: true, householdId: 'h1' })).toBe(true);
    // A marca é a chave existir, como no banco (data ? 'server').
    expect(isServerPush({ server: false })).toBe(true);
    expect(isServerPush({ reminder: 'bills:b1:2026-10-10', householdId: 'h1' })).toBe(false);
    expect(isServerPush({ medicationId: 'm1' })).toBe(false);
    expect(isServerPush({})).toBe(false);
    expect(isServerPush(null)).toBe(false);
    expect(isServerPush(undefined)).toBe(false);
    expect(isServerPush('server')).toBe(false);
    expect(isServerPush(['server'])).toBe(false);
  });

  it('a chave pública do servidor vira os bytes que o navegador pede', () => {
    const bytes = base64UrlToBytes('BP_-AQ');
    expect([...bytes]).toEqual([0x04, 0xff, 0xfe, 0x01]);
    expect(sameKey(bytes.buffer, bytes)).toBe(true);
    expect(sameKey(new Uint8Array([4, 255, 254, 2]).buffer, bytes)).toBe(false);
    expect(sameKey(null, bytes)).toBe(false);
  });
});

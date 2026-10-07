import { describe, expect, it } from '@jest/globals';

import { connectionWarnings } from '../bankHealth';

const now = new Date('2026-10-07T15:00:00Z');

const connection = (over: Partial<Parameters<typeof connectionWarnings>[0][number]>) => ({
  id: 'c1',
  label: 'Inter',
  status: 'UPDATED',
  item_updated_at: '2026-10-07T06:00:00Z',
  last_synced_at: '2026-10-07T14:00:00Z',
  ...over,
});

describe('connectionWarnings', () => {
  it('banco em dia não gera aviso', () => {
    expect(connectionWarnings([connection({})], now)).toEqual([]);
    // Dois dias em ponto ainda não é atraso.
    expect(connectionWarnings([connection({ item_updated_at: '2026-10-05T15:00:00Z' })], now)).toEqual([]);
    expect(connectionWarnings([connection({ status: 'UPDATING' })], now)).toEqual([]);
  });

  it('sem atualizar há mais de 2 dias pede reautorização', () => {
    expect(connectionWarnings([connection({ item_updated_at: '2026-10-02T10:00:00Z' })], now)).toEqual([
      { connectionId: 'c1', label: 'Inter', kind: 'parado', message: 'Inter sem atualizar há 5 dias. Reautorize no MeuPluggy.' },
    ]);
  });

  it('erro na Pluggy vem antes do atraso', () => {
    const [login] = connectionWarnings([connection({ label: 'Nubank', status: 'LOGIN_ERROR', item_updated_at: '2026-09-01T00:00:00Z' })], now);
    expect(login).toMatchObject({ kind: 'erro', message: 'Nubank pediu uma nova autorização. Reautorize no MeuPluggy.' });
    const [outdated] = connectionWarnings([connection({ status: 'OUTDATED' })], now);
    expect(outdated.message).toBe('Inter não conseguiu atualizar na Pluggy. Reautorize no MeuPluggy.');
    const [waiting] = connectionWarnings([connection({ status: 'WAITING_USER_INPUT' })], now);
    expect(waiting.message).toBe('Inter está esperando uma confirmação sua no MeuPluggy.');
  });

  it('banco que nunca sincronizou', () => {
    expect(connectionWarnings([connection({ status: null, item_updated_at: null, last_synced_at: null })], now)).toEqual([
      { connectionId: 'c1', label: 'Inter', kind: 'nunca', message: 'Inter ainda não sincronizou. Toque em Atualizar.' },
    ]);
  });

  it('um aviso por banco, na ordem dos bancos', () => {
    const warnings = connectionWarnings(
      [
        connection({ id: 'a', label: 'Santander', item_updated_at: '2026-10-01T00:00:00Z' }),
        connection({ id: 'b', label: 'Mercado Pago' }),
        connection({ id: 'c', label: 'Nubank', status: 'OUTDATED' }),
      ],
      now,
    );
    expect(warnings.map((w) => [w.connectionId, w.kind])).toEqual([
      ['a', 'parado'],
      ['c', 'erro'],
    ]);
  });
});

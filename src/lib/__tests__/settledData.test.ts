import { describe, expect, it } from '@jest/globals';

import { settledData } from '../settledData';

describe('settledData', () => {
  const rows = [1, 2];

  it('em dia: devolve os dados', () => {
    expect(settledData({ data: rows, isSuccess: true, isFetching: false })).toBe(rows);
  });

  it('buscando de novo, o que ficou guardado ainda não vale', () => {
    expect(settledData({ data: rows, isSuccess: true, isFetching: true })).toBeUndefined();
  });

  it('a busca falhou: os dados de antes não valem', () => {
    expect(settledData({ data: rows, isSuccess: false, isFetching: false })).toBeUndefined();
  });

  it('ainda carregando: nada', () => {
    expect(settledData({ data: undefined, isSuccess: false, isFetching: true })).toBeUndefined();
  });
});

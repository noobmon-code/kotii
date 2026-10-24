import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import path from 'path';

import { STATE_NAMES, stateOf } from '../brStates';

describe('nome dos estados', () => {
  it('é o mesmo da função nfce (o aviso de CAPTCHA de lá e a pendente daqui falam igual)', () => {
    const source = readFileSync(path.resolve(__dirname, '../../../supabase/functions/nfce/uf.ts'), 'utf8');
    const entries = [...source.matchAll(/'(\d{2})': \['[A-Z]{2}', '([^']+)', '(da|do|de)'\]/g)].map((m) => [m[1], [m[2], m[3]]]);
    expect(entries).toHaveLength(27);
    expect(Object.fromEntries(entries)).toEqual(STATE_NAMES);
  });

  it('dá o nome com a preposição; código que não é de estado, nada', () => {
    expect(stateOf('25')).toBe('da Paraíba');
    expect(stateOf('35')).toBe('de São Paulo');
    expect(stateOf('23')).toBe('do Ceará');
    expect(stateOf('99')).toBeNull();
    expect(stateOf('toString')).toBeNull();
  });
});

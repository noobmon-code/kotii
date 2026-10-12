import { describe, expect, it } from '@jest/globals';

import { clearLinkNotice, linkNotice, setLinkNotice } from '../linkNotice';

describe('aviso do link que não deu certo', () => {
  it('fica guardado até ser visto, e depois some', () => {
    expect(linkNotice()).toBeNull();
    setLinkNotice('Este link venceu ou já foi usado.');
    expect(linkNotice()).toBe('Este link venceu ou já foi usado.');
    clearLinkNotice();
    expect(linkNotice()).toBeNull();
  });
});

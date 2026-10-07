import { describe, expect, it } from '@jest/globals';

import { aiUsageRows } from '../aiUsage';

describe('aiUsageRows', () => {
  it('rotula cada uso e avisa quando está perto ou acabou', () => {
    const rows = aiUsageRows([
      { kind: 'chat', used: 12, lim: 300 },
      { kind: 'photo', used: 85, lim: 100 },
      { kind: 'menu', used: 20, lim: 20 },
      { kind: 'nfce', used: 3, lim: 200 },
      { kind: 'video', used: 1, lim: 1 },
    ]);
    expect(rows.map((r) => [r.label, r.level, r.ratio])).toEqual([
      ['Mensagens com o Nuke', 'ok', 0.04],
      ['Leituras de foto (notas e saúde)', 'perto', 0.85],
      ['Cardápios montados pelo Nuke', 'acabou', 1],
      ['Notas lidas pelo QR code', 'ok', 0.015],
    ]);
  });

  it('mostra o consultor financeiro quando o servidor manda a linha (beta)', () => {
    const rows = aiUsageRows([
      { kind: 'chat', used: 0, lim: 300 },
      { kind: 'finance', used: 85, lim: 100 },
    ]);
    expect(rows.map((r) => [r.kind, r.label, r.used, r.limit, r.level])).toEqual([
      ['chat', 'Mensagens com o Nuke', 0, 300, 'ok'],
      ['finance', 'Mensagens com o consultor financeiro', 85, 100, 'perto'],
    ]);
  });
});

import { describe, expect, it } from '@jest/globals';

import { aiUsageRows, aiUsageSubtitle } from '../aiUsage';

describe('aiUsageRows', () => {
  it('rotula cada uso e avisa quando está perto ou acabou', () => {
    const rows = aiUsageRows(
      [
        { kind: 'chat', used: 12, lim: 300 },
        { kind: 'photo', used: 85, lim: 100 },
        { kind: 'menu', used: 20, lim: 20 },
        { kind: 'nfce', used: 3, lim: 200 },
        { kind: 'video', used: 1, lim: 1 },
      ],
      { finance: true },
    );
    expect(rows.map((r) => [r.label, r.level, r.ratio])).toEqual([
      ['Mensagens com o Nuke', 'ok', 0.04],
      ['Leituras de foto (notas e saúde)', 'perto', 0.85],
      ['Cardápios montados pelo Nuke', 'acabou', 1],
      ['Notas lidas pelo QR code', 'ok', 0.015],
    ]);
  });

  const withAdvisor = [
    { kind: 'chat', used: 0, lim: 300 },
    { kind: 'finance', used: 85, lim: 100 },
  ];

  it('com Finanças ligada (lib/features), mostra o consultor financeiro quando o servidor manda a linha (beta)', () => {
    const rows = aiUsageRows(withAdvisor, { finance: true });
    expect(rows.map((r) => [r.kind, r.label, r.used, r.limit, r.level])).toEqual([
      ['chat', 'Mensagens com o Nuke', 0, 300, 'ok'],
      ['finance', 'Mensagens com o consultor financeiro', 85, 100, 'perto'],
    ]);
  });

  it('com Finanças desligada, a linha do consultor não aparece, mesmo vindo do servidor: ele está atrás da chave', () => {
    expect(aiUsageRows(withAdvisor, { finance: false }).map((r) => r.kind)).toEqual(['chat']);
  });
});

describe('aiUsageSubtitle (a linha fechada em Configurações → Sobre o Kotii)', () => {
  const rows = (...used: [string, number, number][]) => aiUsageRows(used.map(([kind, u, lim]) => ({ kind, used: u, lim })), { finance: true });

  it('o limite que acabou vem primeiro, pelo nome; dois ou mais, pela conta', () => {
    expect(aiUsageSubtitle(rows(['chat', 300, 300], ['photo', 90, 100]))).toBe('Acabou o limite de mensagens com o Nuke');
    expect(aiUsageSubtitle(rows(['menu', 20, 20]))).toBe('Acabou o limite de cardápios montados pelo Nuke');
    expect(aiUsageSubtitle(rows(['chat', 300, 300], ['nfce', 200, 200]))).toBe('2 limites acabaram neste mês');
  });

  it('sem limite acabado, o que está perto do fim', () => {
    expect(aiUsageSubtitle(rows(['chat', 12, 300], ['photo', 85, 100]))).toBe('Perto do limite de leituras de foto (notas e saúde)');
    expect(aiUsageSubtitle(rows(['photo', 85, 100], ['nfce', 170, 200]))).toBe('2 usos perto do limite');
  });

  it('com tudo longe do limite, ou sem uso nenhum na resposta, só o que a linha mostra aberta', () => {
    expect(aiUsageSubtitle(rows(['chat', 12, 300]))).toBe('Quanto a casa já usou do limite do mês');
    expect(aiUsageSubtitle([])).toBe('Quanto a casa já usou do limite do mês');
  });

  it('com Finanças desligada, o consultor perto do limite não aparece nem na linha fechada', () => {
    const answer = [
      { kind: 'chat', used: 0, lim: 300 },
      { kind: 'finance', used: 100, lim: 100 },
    ];
    expect(aiUsageSubtitle(aiUsageRows(answer, { finance: false }))).toBe('Quanto a casa já usou do limite do mês');
  });
});

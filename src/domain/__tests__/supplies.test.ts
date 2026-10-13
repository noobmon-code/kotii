import { describe, expect, it } from '@jest/globals';

import { addDays } from '../dates';
import {
  describeRefill,
  describeRefillSaved,
  describeSupply,
  describeSupplyDuration,
  forecastSupplies,
  getSupplyKind,
  parseRefillDate,
  refillDays,
  refillHistory,
  SUPPLY_KINDS,
  suppliesNeedingAttention,
  supplyBadge,
  supplyForecast,
  supplyLines,
  supplyNeedsAttention,
  supplyReminders,
  supplyRowText,
  validateSupply,
  warningDays,
} from '../supplies';

const today = '2026-10-12';

const supply = (kind: string, days: string[], typical_days: number | null = null, name = 'Gás de cozinha') => ({
  id: name,
  name,
  kind,
  typical_days,
  refills: days.map((refilled_on) => ({ refilled_on })),
});

/** Dias de troca a partir de `start`, com estes intervalos entre uma e outra. */
const chain = (start: string, gaps: number[]) => gaps.reduce((days, gap) => [...days, addDays(days[days.length - 1], gap)], [start]);

const state = (kind: string, days: string[], on: string, typical: number | null = null) => supplyForecast(supply(kind, days, typical), on).state;

describe('tipos', () => {
  it('cada tipo tem rótulo, ícone e a estimativa de partida; só "Outro" fica sem', () => {
    expect(SUPPLY_KINDS.map((k) => [k.key, k.label, k.typicalDays])).toEqual([
      ['gas', 'Gás de cozinha', 45],
      ['agua', 'Galão de água', 10],
      ['racao', 'Ração', 30],
      ['areia', 'Areia do gato', 15],
      ['filtro', 'Refil do filtro', 180],
      ['outros', 'Outro', null],
    ]);
    expect(SUPPLY_KINDS.every((k) => k.icon)).toBe(true);
  });

  it('só o que se compra em loja vai para a lista de mercado; tipo desconhecido vira "Outro"', () => {
    expect(SUPPLY_KINDS.filter((k) => k.listCategory).map((k) => k.key)).toEqual(['racao', 'areia', 'filtro', 'outros']);
    expect(getSupplyKind('lenha').key).toBe('outros');
  });
});

describe('previsão', () => {
  it('sem troca anotada não há previsão, mesmo com estimativa', () => {
    expect(supplyForecast(supply('gas', []), today)).toEqual({ state: 'sem_troca' });
    expect(supplyForecast(supply('gas', [], 60), today)).toEqual({ state: 'sem_troca' });
  });

  it('uma troca: vale a estimativa da pessoa; sem ela, a do tipo; sem nenhuma, fica sem previsão', () => {
    expect(supplyForecast(supply('gas', ['2026-09-01']), '2026-10-01')).toEqual({
      state: 'em_dia',
      refilledOn: '2026-09-01',
      days: 45,
      source: 'tipo',
      endsOn: '2026-10-16',
      daysLeft: 15,
      warnDays: 7,
    });
    expect(supplyForecast(supply('gas', ['2026-09-01'], 60), '2026-10-01')).toMatchObject({
      days: 60,
      source: 'pessoa',
      endsOn: '2026-10-31',
      daysLeft: 30,
    });
    expect(supplyForecast(supply('outros', ['2026-09-01'], 20), '2026-09-05')).toMatchObject({ days: 20, source: 'pessoa', endsOn: '2026-09-21' });
    expect(supplyForecast(supply('outros', ['2026-09-01']), '2026-10-01')).toEqual({ state: 'sem_previsao', refilledOn: '2026-09-01' });
  });

  it('duas trocas: o intervalo da casa passa a valer, por cima de qualquer estimativa', () => {
    expect(supplyForecast(supply('gas', ['2026-08-01', '2026-09-10'], 60), '2026-09-12')).toMatchObject({
      state: 'em_dia',
      refilledOn: '2026-09-10',
      days: 40,
      source: 'trocas',
      endsOn: '2026-10-20',
    });
    // "Outro" sem estimativa ganha previsão na segunda troca.
    expect(supplyForecast(supply('outros', ['2026-08-01', '2026-09-10']), '2026-09-12')).toMatchObject({ days: 40, source: 'trocas' });
  });

  it('mediana dos intervalos: quantidade ímpar, par (arredonda) e um intervalo fora da curva', () => {
    const days = (gaps: number[]) => {
      const refills = chain('2026-01-01', gaps);
      const f = supplyForecast(supply('gas', refills), refills[refills.length - 1]);
      return 'days' in f ? f.days : null;
    };
    expect(days([40, 50, 45])).toBe(45);
    expect(days([44, 45])).toBe(45);
    expect(days([40, 41])).toBe(41);
    expect(days([40, 44, 46, 50])).toBe(45);
    // A viagem de 200 dias não puxa a previsão.
    expect(days([45, 44, 200, 46, 45])).toBe(45);
  });

  it('com seis trocas ou mais, só os cinco últimos intervalos contam', () => {
    const refills = chain('2025-06-01', [10, 10, 44, 46, 45, 47, 43]);
    const last = refills[refills.length - 1];
    // Com os sete intervalos a mediana seria 44.
    expect(supplyForecast(supply('gas', refills), last)).toMatchObject({ days: 45, source: 'trocas', refilledOn: last, endsOn: addDays(last, 45) });
  });

  it('trocas fora de ordem e repetidas dão no mesmo', () => {
    const messy = supply('gas', ['2026-09-10', '2026-08-01', '2026-09-10', '2026-08-01']);
    expect(refillDays(messy.refills, today)).toEqual(['2026-08-01', '2026-09-10']);
    expect(supplyForecast(messy, '2026-09-12')).toEqual(supplyForecast(supply('gas', ['2026-08-01', '2026-09-10']), '2026-09-12'));
  });

  it('troca com data depois de hoje não conta até o dia chegar', () => {
    const alone = supplyForecast(supply('gas', ['2026-09-01']), '2026-10-01');
    expect(supplyForecast(supply('gas', ['2026-09-01', '2026-12-25']), '2026-10-01')).toEqual(alone);
    expect(supplyForecast(supply('gas', ['2026-12-25']), '2026-10-01')).toEqual({ state: 'sem_troca' });
    // No dia, ela vale como qualquer outra.
    expect(supplyForecast(supply('gas', ['2026-09-01', '2026-12-25']), '2026-12-25')).toMatchObject({ refilledOn: '2026-12-25', days: 115, daysLeft: 115 });
  });

  it('cada estado nas suas bordas', () => {
    // Gás trocado em 01/09: 45 dias, deve acabar em 16/10, aviso 7 dias antes.
    const gas = ['2026-09-01'];
    expect(state('gas', gas, '2026-10-08')).toBe('em_dia');
    expect(state('gas', gas, '2026-10-09')).toBe('acabando');
    expect(state('gas', gas, '2026-10-15')).toBe('acabando');
    expect(state('gas', gas, '2026-10-16')).toBe('acabando');
    expect(state('gas', gas, '2026-10-17')).toBe('passou');
    // Mais uma duração inteira depois da data: até 30/11.
    expect(state('gas', gas, '2026-11-30')).toBe('passou');
    expect(state('gas', gas, '2026-12-01')).toBe('parado');
    expect(supplyForecast(supply('gas', gas), '2026-12-01')).toMatchObject({ daysLeft: -46, endsOn: '2026-10-16' });
  });

  it('janela de aviso: 15% da duração, no mínimo 2 e no máximo 7 dias', () => {
    const windows = [1, 3, 10, 13, 14, 16, 17, 30, 43, 44, 45, 46, 47, 180, 730].map((d) => [d, warningDays(d)]);
    expect(windows).toEqual([
      [1, 2],
      [3, 2],
      [10, 2],
      [13, 2],
      [14, 2],
      [16, 2],
      [17, 3],
      [30, 5],
      [43, 6],
      [44, 7],
      [45, 7],
      [46, 7],
      [47, 7],
      [180, 7],
      [730, 7],
    ]);
  });
});

describe('textos', () => {
  const gas = supply('gas', ['2026-09-01']);
  const text = (on: string) => describeSupply(supplyForecast(gas, on), on);

  it('cada estado com a sua frase, sempre como previsão', () => {
    expect(describeSupply(supplyForecast(supply('gas', []), today), today)).toBe('Toque em "Troquei hoje" quando começar um novo');
    expect(describeSupply(supplyForecast(supply('outros', ['2026-10-03']), today), today)).toBe(
      'Trocado em 03/10 · o Kotii aprende a duração na próxima troca',
    );
    expect(text('2026-10-01')).toBe('Deve durar até 16/10');
    expect(text('2026-10-09')).toBe('Deve acabar em uns 7 dias');
    expect(text('2026-10-14')).toBe('Deve acabar em uns 2 dias');
    expect(text('2026-10-15')).toBe('Deve acabar amanhã');
    expect(text('2026-10-16')).toBe('Deve acabar hoje');
    expect(text('2026-10-17')).toBe('Pela conta, já era para ter acabado');
    expect(text('2026-12-01')).toBe('Sem troca desde 01/09');
  });

  it('a data leva o ano quando não é o de hoje', () => {
    const late = supply('gas', ['2026-11-20']);
    expect(describeSupply(supplyForecast(late, '2026-11-20'), '2026-11-20')).toBe('Deve durar até 04/01/2027');
    expect(describeSupply(supplyForecast(supply('gas', ['2026-09-01']), '2027-03-01'), '2027-03-01')).toBe('Sem troca desde 01/09/2026');
  });

  it('a linha diz de onde vem o número, no singular e no plural', () => {
    expect(supplyRowText(supplyForecast(gas, '2026-10-01'), '2026-10-01')).toBe('Deve durar até 16/10 · dura cerca de 45 dias (estimativa)');
    expect(supplyRowText(supplyForecast(supply('gas', ['2026-08-01', '2026-09-10']), '2026-09-12'), '2026-09-12')).toBe(
      'Deve durar até 20/10 · dura cerca de 40 dias (pelas suas trocas)',
    );
    const daily = supplyForecast(supply('outros', [today], 1), today);
    expect(supplyRowText(daily, today)).toBe('Deve acabar amanhã · dura cerca de 1 dia (estimativa)');
    expect(supplyRowText(supplyForecast(gas, '2026-10-17'), '2026-10-17')).toBe(
      'Pela conta, já era para ter acabado · dura cerca de 45 dias (estimativa)',
    );
    // Sem data prevista em jogo, só o estado.
    expect(describeSupplyDuration(supplyForecast(gas, '2026-12-01'))).toBeNull();
    expect(describeSupplyDuration(supplyForecast(supply('gas', []), today))).toBeNull();
    expect(supplyRowText(supplyForecast(gas, '2026-12-01'), '2026-12-01')).toBe('Sem troca desde 01/09');
  });

  it('selo e atenção só para o que está acabando ou passou da data', () => {
    const on = (day: string) => supplyForecast(gas, day);
    expect(supplyBadge(on('2026-10-01'))).toBeNull();
    expect(supplyBadge(on('2026-10-09'))).toEqual({ label: 'Acabando', tone: 'warning' });
    expect(supplyBadge(on('2026-10-17'))).toEqual({ label: 'Passou da data', tone: 'danger' });
    expect(supplyBadge(on('2026-12-01'))).toBeNull();
    expect(supplyBadge(supplyForecast(supply('gas', []), today))).toBeNull();
    expect(['2026-10-01', '2026-10-09', '2026-10-16', '2026-10-17', '2026-11-30', '2026-12-01'].map((d) => supplyNeedsAttention(on(d)))).toEqual([
      false,
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  it('confirmação da troca traz a previsão nova', () => {
    expect(describeRefillSaved(supplyForecast(supply('gas', [today]), today), today)).toBe('Anotado. Deve durar até 26/11.');
    expect(describeRefillSaved(supplyForecast(supply('outros', [today]), today), today)).toBe(
      'Anotado. O Kotii aprende a duração na próxima troca.',
    );
    // Troca anotada com uma data antiga ("Troquei outro dia").
    expect(describeRefillSaved(supplyForecast(supply('gas', ['2026-09-01']), '2026-10-14'), '2026-10-14')).toBe('Anotado. Deve acabar em uns 2 dias.');
  });

  it('histórico: da mais nova para a mais antiga, com quanto cada uma durou', () => {
    const refills = [
      { id: 'a', refilled_on: '2026-08-20' },
      { id: 'c', refilled_on: '2026-10-04' },
      { id: 'b', refilled_on: '2026-10-03' },
    ];
    const lines = refillHistory(refills);
    expect(lines.map((l) => [l.refill.id, l.lastedDays])).toEqual([
      ['c', null],
      ['b', 1],
      ['a', 44],
    ]);
    expect(lines.map((l) => describeRefill(l, today))).toEqual(['04/10/2026 · em uso', '03/10/2026 · durou 1 dia', '20/08/2026 · durou 44 dias']);
    expect(refillHistory([])).toEqual([]);
    // Data depois de hoje aparece (para poder apagar), dizendo que ainda não conta.
    expect(describeRefill(refillHistory([{ refilled_on: '2026-12-25' }])[0], today)).toBe('25/12/2026 · data depois de hoje, ainda não conta');
  });
});

describe('ordem da seção', () => {
  const ago = (days: number) => addDays(today, -days);

  const house = [
    supply('gas', [ago(300)], null, 'Velho'),
    supply('gas', [], null, 'Alfa'),
    supply('filtro', [ago(40)], null, 'Filtro'),
    supply('outros', [ago(11)], null, 'Zeta'),
    supply('gas', [ago(43)], null, 'Gás'),
    supply('agua', [], null, 'Água'),
    supply('agua', [ago(5)], null, 'Galão'),
    supply('areia', [ago(13)], null, 'Areia'),
    supply('racao', [ago(33)], null, 'Ração'),
  ];

  it('passou e acabando primeiro (o mais urgente antes), depois em dia pela data, depois o resto; empate pelo nome', () => {
    const rows = forecastSupplies(house, today);
    expect(rows.map((r) => [r.supply.name, r.forecast.state])).toEqual([
      ['Ração', 'passou'],
      ['Areia', 'acabando'],
      ['Gás', 'acabando'],
      ['Galão', 'em_dia'],
      ['Filtro', 'em_dia'],
      ['Zeta', 'sem_previsao'],
      ['Água', 'sem_troca'],
      ['Alfa', 'sem_troca'],
      ['Velho', 'parado'],
    ]);
  });

  it('na tela Hoje entra só o que está acabando ou passou da data', () => {
    expect(suppliesNeedingAttention(house, today).map((r) => r.supply.name)).toEqual(['Ração', 'Areia', 'Gás']);
    expect(suppliesNeedingAttention([supply('gas', [ago(5)]), supply('gas', []), supply('gas', [ago(300)])], today)).toEqual([]);
    expect(suppliesNeedingAttention([], today)).toEqual([]);
  });

  it('entre os que passaram, o mais atrasado vem antes', () => {
    const rows = forecastSupplies([supply('gas', [ago(46)], null, 'A'), supply('gas', [ago(60)], null, 'B'), supply('gas', [ago(45)], null, 'C')], today);
    expect(rows.map((r) => r.supply.name)).toEqual(['B', 'A', 'C']);
  });
});

describe('formulário', () => {
  const form = { name: 'Gás de cozinha', kind: 'gas', typicalDays: '', notes: '' };

  it('nome obrigatório, sem espaços nas pontas, com até 60 letras', () => {
    expect(validateSupply({ ...form, name: '  Ração da Mel  ', kind: 'racao' })).toEqual({
      ok: true,
      value: { name: 'Ração da Mel', kind: 'racao', typical_days: null, notes: null },
    });
    expect(validateSupply({ ...form, name: '   ' })).toEqual({ ok: false, message: 'Dê um nome, como "Gás de cozinha" ou "Ração da Mel".' });
    expect(validateSupply({ ...form, name: 'x'.repeat(60) }).ok).toBe(true);
    expect(validateSupply({ ...form, name: 'x'.repeat(61) })).toEqual({ ok: false, message: 'O nome pode ter até 60 letras.' });
    expect(validateSupply({ ...form, kind: 'lenha' })).toEqual({ ok: false, message: 'Escolha o tipo.' });
  });

  it('"dura quantos dias?": em branco ou um número inteiro de 1 a 730', () => {
    const days = (typicalDays: string) => {
      const checked = validateSupply({ ...form, typicalDays });
      return checked.ok ? checked.value.typical_days : checked.message;
    };
    const refused = 'Em "Dura quantos dias?", use um número de 1 a 730 ou deixe em branco.';
    expect([days(''), days('  '), days('1'), days(' 45 '), days('730')]).toEqual([null, null, 1, 45, 730]);
    expect([days('0'), days('731'), days('4,5'), days('-3'), days('uns 40'), days('99999')]).toEqual(Array(6).fill(refused));
  });

  it('observações opcionais, com até 200 letras', () => {
    expect(validateSupply({ ...form, notes: ' Disk gás: 3333-0000 ' })).toMatchObject({ ok: true, value: { notes: 'Disk gás: 3333-0000' } });
    expect(validateSupply({ ...form, notes: 'x'.repeat(200) }).ok).toBe(true);
    expect(validateSupply({ ...form, notes: 'x'.repeat(201) })).toEqual({ ok: false, message: 'As observações podem ter até 200 letras.' });
  });

  it('dia da troca: uma data de verdade, nunca depois de hoje', () => {
    expect(parseRefillDate('12/10/2026', today)).toEqual({ ok: true, value: today });
    expect(parseRefillDate(' 03/10/26 ', today)).toEqual({ ok: true, value: '2026-10-03' });
    expect(parseRefillDate('13/10/2026', today)).toEqual({ ok: false, message: 'A troca não pode ser depois de hoje.' });
    expect(parseRefillDate('31/02/2026', today)).toEqual({ ok: false, message: 'Use o formato dd/mm/aaaa.' });
    expect(parseRefillDate('', today)).toEqual({ ok: false, message: 'Use o formato dd/mm/aaaa.' });
    expect(parseRefillDate('03/10/1999', today)).toEqual({ ok: false, message: 'Confira o ano da data.' });
    expect(parseRefillDate('01/01/2000', today)).toEqual({ ok: true, value: '2000-01-01' });
  });
});

describe('avisos e Nuke', () => {
  it('dois avisos por reposição com previsão: no começo da janela e no dia previsto', () => {
    expect(supplyReminders([supply('gas', ['2026-08-19', '2026-10-03'])], today)).toEqual([
      {
        id: 'Gás de cozinha',
        warnOn: '2026-11-10',
        warnTitle: 'Gás de cozinha deve acabar em uns 7 dias',
        endsOn: '2026-11-17',
        endTitle: 'Gás de cozinha deve acabar hoje',
        body: 'Trocado em 03/10 · costuma durar 45 dias.',
      },
    ]);
    // Pela estimativa, o texto não diz "costuma".
    expect(supplyReminders([supply('agua', ['2026-10-10'], null, 'Galão de água')], today)).toEqual([
      expect.objectContaining({
        warnOn: '2026-10-18',
        warnTitle: 'Galão de água deve acabar em uns 2 dias',
        endsOn: '2026-10-20',
        body: 'Trocado em 10/10 · deve durar cerca de 10 dias (estimativa).',
      }),
    ]);
  });

  it('sem troca, sem previsão, passou e parado não avisam', () => {
    const none = [
      supply('gas', []),
      supply('outros', ['2026-10-03']),
      supply('gas', ['2026-08-20']),
      supply('gas', ['2026-01-01']),
    ];
    expect(forecastSupplies(none, today).map((r) => r.forecast.state).sort()).toEqual(['parado', 'passou', 'sem_previsao', 'sem_troca']);
    expect(supplyReminders(none, today)).toEqual([]);
  });

  it('duração curta demais para a janela: só o aviso do dia', () => {
    expect(supplyReminders([supply('outros', [today], 1, 'Pão')], today)).toEqual([
      expect.objectContaining({ warnOn: null, endsOn: '2026-10-13', endTitle: 'Pão deve acabar hoje', body: 'Trocado em 12/10 · deve durar cerca de 1 dia (estimativa).' }),
    ]);
  });

  it('linhas para o Nuke, na ordem da seção', () => {
    expect(
      supplyLines(
        [
          supply('agua', [], null, 'Galão de água'),
          supply('gas', ['2026-09-13']),
          supply('racao', ['2026-09-15'], null, 'Ração da Mel'),
          supply('areia', ['2026-09-20'], null, 'Areia'),
          supply('outros', ['2026-10-03'], null, 'Sabão'),
          supply('gas', ['2026-01-01'], null, 'Gás da churrasqueira'),
          supply('agua', ['2026-10-02'], null, 'Água'),
          supply('agua', ['2026-10-03'], null, 'Galão do escritório'),
        ],
        today,
      ),
    ).toEqual([
      'Areia — pela conta, já era para ter acabado em 05/10',
      'Água — deve acabar hoje',
      'Galão do escritório — deve acabar amanhã',
      'Ração da Mel — deve acabar em 15/10 (uns 3 dias)',
      'Gás de cozinha — deve acabar em 28/10',
      'Sabão — sem previsão (trocado em 03/10)',
      'Galão de água — sem previsão',
      'Gás da churrasqueira — sem troca anotada desde 01/01',
    ]);
  });
});

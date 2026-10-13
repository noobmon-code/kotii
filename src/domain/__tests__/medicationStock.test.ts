import { describe, expect, it } from '@jest/globals';

import {
  describePrescription,
  describeStock,
  estimateStock,
  formatUnits,
  keepStockOnRuleChange,
  parseUnits,
  pharmacyItemName,
  prescriptionStatus,
  readStockForm,
  refillAlerts,
  refillBadge,
  refillReminders,
  refillRows,
  refillSummary,
  restock,
  restockBase,
  restockHint,
  STALE_DAYS,
  stockFormOf,
  stockStatus,
  type StockedMedication,
} from '../medicationStock';
import { normalizeSearch } from '../search';

// 12/10/2026 é uma segunda-feira.
const today = '2026-10-12';

/** Losartana da Ana: um comprimido por dia, 30 contados hoje, aviso com 7 dias. */
const med = (patch: Partial<StockedMedication> = {}): StockedMedication => ({
  id: 'm1',
  personName: 'Ana',
  name: 'Losartana',
  dosage: null,
  times: ['08:00'],
  startOn: '2026-01-01',
  endOn: null,
  active: true,
  stockCount: 30,
  stockCountedOn: today,
  doseUnits: 1,
  warnDays: 7,
  prescriptionUntil: null,
  ...patch,
});

const estimate = (patch: Partial<StockedMedication> = {}, on = today) => estimateStock(med(patch), on);
const sentence = (patch: Partial<StockedMedication> = {}, on = today) => describeStock(stockStatus(med(patch), on), on);
const labels = (patch: Partial<StockedMedication> = {}, on = today) => refillAlerts(med(patch), on).map((a) => a.label);

describe('estimateStock: a conta pelo horário das doses', () => {
  it('todo dia, uma vez: uma unidade por dia a partir do dia seguinte à contagem', () => {
    expect(estimate()).toEqual({ unitsLeft: 30, runsOutOn: '2026-11-11', daysLeft: 30, ends: 'stock' });
    // Contado há 10 dias: dez doses a menos, e o dia em que acaba é o mesmo.
    expect(estimate({ stockCountedOn: '2026-10-02' })).toEqual({ unitsLeft: 20, runsOutOn: '2026-11-01', daysLeft: 20, ends: 'stock' });
  });

  it('o dia da contagem não desconta nada; o dia seguinte desconta as doses dele', () => {
    expect(estimate({ times: ['08:00', '14:00', '20:00'] })?.unitsLeft).toBe(30);
    expect(estimate({ times: ['08:00', '14:00', '20:00'] }, '2026-10-13')?.unitsLeft).toBe(27);
    // Contagem com data à frente (relógio de outro aparelho): nada descontado ainda.
    expect(estimate({ stockCountedOn: '2026-10-13' })?.unitsLeft).toBe(30);
  });

  it('três vezes por dia: acaba no dia da última dose inteira', () => {
    expect(estimate({ times: ['08:00', '14:00', '20:00'] })).toMatchObject({ runsOutOn: '2026-10-22', daysLeft: 10 });
    // Acabou no meio do dia de hoje (duas das três doses): não sobra nada, e "acaba hoje".
    expect(estimate({ times: ['08:00', '14:00', '20:00'], stockCount: 2, stockCountedOn: '2026-10-11' })).toEqual({
      unitsLeft: 0,
      runsOutOn: today,
      daysLeft: 0,
      ends: 'stock',
    });
    // Com 31, a dose que sobra é a primeira do 11º dia.
    expect(estimate({ times: ['08:00', '14:00', '20:00'], stockCount: 31 })).toMatchObject({ runsOutOn: '2026-10-23', daysLeft: 11 });
  });

  it('meio comprimido por dose dura o dobro; dois por dose, a metade', () => {
    expect(estimate({ doseUnits: 0.5, stockCount: 10 })).toMatchObject({ runsOutOn: '2026-11-01', daysLeft: 20 });
    expect(estimate({ doseUnits: 0.5, stockCount: 10, stockCountedOn: '2026-10-09' })?.unitsLeft).toBe(8.5);
    expect(estimate({ doseUnits: 2, stockCount: 10 })).toMatchObject({ runsOutOn: '2026-10-17', daysLeft: 5 });
    // O que não completa uma dose fica sobrando, sem virar dose.
    expect(estimate({ doseUnits: 2, stockCount: 5 })).toMatchObject({ runsOutOn: '2026-10-14' });
    expect(estimate({ doseUnits: 2, stockCount: 5 }, '2026-10-20')?.unitsLeft).toBe(1);
    // Um décimo por dose, trinta vezes: a soma fecha em 3, sem sobra de arredondamento.
    expect(estimate({ doseUnits: 0.1, stockCount: 3 })).toMatchObject({ runsOutOn: '2026-11-11' });
  });

  it('dias da semana: só os dias escolhidos gastam', () => {
    // Segunda, quarta e sexta, 3 contados na segunda: quarta 14, sexta 16 e segunda 19.
    const weekly = { frequency: 'weekdays' as const, weekdays: [1, 3, 5], stockCount: 3 };
    expect(estimate(weekly)).toEqual({ unitsLeft: 3, runsOutOn: '2026-10-19', daysLeft: 7, ends: 'stock' });
    expect(estimate(weekly, '2026-10-15')).toMatchObject({ unitsLeft: 2, daysLeft: 4 });
  });

  it('a cada X dias: conta do início do tratamento', () => {
    // A cada 3 dias desde 01/10: 13, 16, 19...
    const every3 = { frequency: 'interval' as const, intervalDays: 3, startOn: '2026-10-01', stockCount: 2 };
    expect(estimate(every3)).toMatchObject({ unitsLeft: 2, runsOutOn: '2026-10-16', daysLeft: 4 });
  });

  it('uma vez por mês: no dia do início, ou no último dia do mês mais curto', () => {
    const monthly = { frequency: 'monthly' as const, startOn: '2026-01-31', stockCount: 2 };
    expect(estimate(monthly)).toMatchObject({ runsOutOn: '2026-11-30', daysLeft: 49 });
  });

  it('início no futuro: nada gasta até começar', () => {
    expect(estimate({ startOn: '2026-10-20', stockCount: 5 })).toEqual({ unitsLeft: 5, runsOutOn: '2026-10-24', daysLeft: 12, ends: 'stock' });
  });

  it('tratamento que termina antes de o estoque acabar nunca "acaba"', () => {
    expect(estimate({ endOn: '2026-10-20' })).toEqual({ unitsLeft: 30, runsOutOn: null, daysLeft: null, ends: 'treatment' });
    // Oito doses até o fim, oito unidades: dá certinho.
    expect(estimate({ endOn: '2026-10-20', stockCount: 8 })).toMatchObject({ runsOutOn: null, ends: 'treatment' });
    // Sete não dão: acaba na véspera do fim.
    expect(estimate({ endOn: '2026-10-20', stockCount: 7 })).toMatchObject({ runsOutOn: '2026-10-19', ends: 'stock' });
    expect(sentence({ endOn: '2026-10-20' })).toBe('Dá para o tratamento todo, pelas contas do app.');
    expect(labels({ endOn: '2026-10-20', stockCount: 8 })).toEqual([]);
  });

  it('tratamento por número de doses: de amanhã em diante, só as doses que faltam', () => {
    // 10 doses, uma por dia desde 09/10: com a de hoje, 4 previstas e 4 tomadas; faltam 6.
    const course = { startOn: '2026-10-09', totalDoses: 10, takenCount: 4 };
    expect(estimate(course)).toMatchObject({ unitsLeft: 30, runsOutOn: null, ends: 'treatment' });
    expect(estimate({ ...course, stockCount: 6 })).toMatchObject({ runsOutOn: null, ends: 'treatment' });
    expect(estimate({ ...course, stockCount: 3 })).toMatchObject({ runsOutOn: '2026-10-15', daysLeft: 3, ends: 'stock' });
    // Até hoje vale o horário, não as marcações: contado há 3 dias, três doses a menos.
    expect(estimate({ startOn: '2026-09-27', totalDoses: 20, takenCount: 15, stockCount: 10, stockCountedOn: '2026-10-09' })).toMatchObject({
      unitsLeft: 7,
      runsOutOn: null,
      ends: 'treatment',
    });
  });

  describe('tratamento por número de doses: a dose de hoje não conta duas vezes', () => {
    // 10 doses, uma por dia, de 12/10 a 21/10; a caixa foi contada na véspera do início.
    const course = (patch: Partial<StockedMedication> = {}, on = today) =>
      stockStatus(med({ startOn: today, totalDoses: 10, takenCount: 0, stockCountedOn: '2026-10-11', ...patch }), on);

    it('estoque igual às doses que faltam dá para o tratamento, antes e depois de marcar a de hoje', () => {
      for (const takenCount of [0, 1]) {
        expect(course({ stockCount: 10, takenCount })).toMatchObject({ kind: 'plenty', estimate: { ends: 'treatment', runsOutOn: null } });
        // Uma a mais também; uma a menos acaba na véspera da última dose.
        expect(course({ stockCount: 11, takenCount })).toMatchObject({ kind: 'plenty', estimate: { ends: 'treatment' } });
        expect(course({ stockCount: 9, takenCount })).toMatchObject({ kind: 'plenty', estimate: { ends: 'stock', runsOutOn: '2026-10-20', daysLeft: 8 } });
      }
      const text = (takenCount: number) => describeStock(course({ stockCount: 10, takenCount }), today);
      expect(text(0)).toBe('Dá para o tratamento todo, pelas contas do app.');
      expect(text(1)).toBe(text(0));
    });

    it('marcar a dose do dia não muda o estado, em nenhum dia do tratamento', () => {
      // No 4º dia (15/10), antes de marcar (3 tomadas) e depois (4).
      for (const stockCount of [9, 10, 11]) {
        expect(course({ stockCount, takenCount: 3 }, '2026-10-15')).toEqual(course({ stockCount, takenCount: 4 }, '2026-10-15'));
      }
      expect(course({ stockCount: 10, takenCount: 3 }, '2026-10-15')).toMatchObject({ kind: 'plenty', estimate: { unitsLeft: 6, ends: 'treatment' } });
      // Com uma a menos, o dia em que acaba é o mesmo de antes (20/10), agora dentro do aviso.
      expect(course({ stockCount: 9, takenCount: 3 }, '2026-10-15')).toMatchObject({ kind: 'low', daysLeft: 5, runsOutOn: '2026-10-20' });
    });

    it('contado no meio do tratamento, na noite de um dia anterior', () => {
      // 5 tomadas até 16/10 e 5 comprimidos contados naquela noite; na manhã de 17/10, a do dia ainda sem marcar.
      const midway = { stockCountedOn: '2026-10-16', takenCount: 5 };
      expect(course({ ...midway, stockCount: 5 }, '2026-10-17')).toMatchObject({ kind: 'plenty', estimate: { unitsLeft: 4, ends: 'treatment' } });
      expect(course({ ...midway, stockCount: 5, takenCount: 6 }, '2026-10-17')).toEqual(course({ ...midway, stockCount: 5 }, '2026-10-17'));
      expect(course({ ...midway, stockCount: 4 }, '2026-10-17')).toMatchObject({ kind: 'low', daysLeft: 3, runsOutOn: '2026-10-20' });
      expect(course({ ...midway, stockCount: 6 }, '2026-10-17')).toMatchObject({ kind: 'plenty', estimate: { ends: 'treatment' } });
    });

    it('três doses por dia: 21 doses em 7 dias', () => {
      const thrice = (stockCount: number, takenCount: number) =>
        course({ times: ['08:00', '14:00', '20:00'], totalDoses: 21, stockCount, takenCount });
      // Nenhuma, uma ou as três de hoje marcadas: o mesmo estado.
      for (const takenCount of [0, 1, 3]) {
        expect(thrice(21, takenCount)).toMatchObject({ kind: 'plenty', estimate: { ends: 'treatment' } });
        expect(thrice(22, takenCount)).toMatchObject({ kind: 'plenty', estimate: { ends: 'treatment' } });
        // Uma a menos: falta a última dose do último dia (18/10).
        expect(thrice(20, takenCount)).toMatchObject({ kind: 'low', daysLeft: 6, runsOutOn: '2026-10-18' });
      }
    });

    it('tratamento que passou do fim pelo horário, com doses sem marcar: o estoque não segue sendo gasto', () => {
      // 10 doses, uma por dia, de 01/10 a 10/10, nenhuma marcada; a caixa foi contada na véspera do início.
      const course = { startOn: '2026-10-01', totalDoses: 10, takenCount: 0, stockCountedOn: '2026-09-30' };
      // A caixa era a do tratamento: no dia seguinte ao fim ela não "acabou", o tratamento é que terminou.
      expect(estimate({ ...course, stockCount: 10 })).toEqual({ unitsLeft: 0, runsOutOn: null, daysLeft: null, ends: 'treatment' });
      expect(labels({ ...course, stockCount: 10 })).toEqual([]);
      // Com sobra, a sobra fica: o horário não gasta mais doses do que o tratamento tem.
      expect(estimate({ ...course, stockCount: 12 })).toMatchObject({ unitsLeft: 2, ends: 'treatment' });
      expect(estimate({ ...course, stockCount: 12 }, '2026-10-30')).toMatchObject({ unitsLeft: 2, ends: 'treatment' });
      // Faltando para o próprio tratamento, acabou de verdade: no dia da última dose que a caixa cobriu.
      expect(estimate({ ...course, stockCount: 8 })).toMatchObject({ unitsLeft: 0, runsOutOn: '2026-10-08', ends: 'stock' });
    });

    it('quem não marca as doses: vale o horário; quem adiantou doses: valem as que faltam', () => {
      // Pelo horário, as 10 doses (03/10 a 12/10) terminam hoje: nada mais a gastar, com ou sem marcação.
      expect(estimate({ startOn: '2026-10-03', totalDoses: 10, takenCount: 0, stockCount: 5 })).toMatchObject({ unitsLeft: 5, ends: 'treatment' });
      // 8 marcadas no primeiro dia: só faltam 2 (amanhã e depois).
      expect(estimate({ startOn: today, totalDoses: 10, takenCount: 8, stockCount: 3 })).toMatchObject({ ends: 'treatment' });
      expect(estimate({ startOn: today, totalDoses: 10, takenCount: 8, stockCount: 1 })).toMatchObject({ ends: 'stock', runsOutOn: '2026-10-13' });
    });
  });

  it('contado há muito tempo: acabou, e o que sobra nunca fica negativo', () => {
    expect(estimate({ stockCountedOn: '2026-01-01' })).toEqual({ unitsLeft: 0, runsOutOn: '2026-01-31', daysLeft: -254, ends: 'stock' });
    expect(estimate({ stockCountedOn: '2026-01-01', doseUnits: 4 })?.unitsLeft).toBe(2);
    // Contado zero: a conta para no dia da contagem (e o estado já é o de quem acabou, ver stockStatus).
    expect(estimate({ stockCount: 0 })).toEqual({ unitsLeft: 0, runsOutOn: today, daysLeft: 0, ends: 'stock' });
  });

  it('estoque para mais do que a conta alcança', () => {
    expect(estimate({ stockCount: 5000 })).toMatchObject({ unitsLeft: 5000, runsOutOn: null, ends: 'far' });
    expect(sentence({ stockCount: 5000 })).toBe('Dá para mais de 3 anos, pelas contas do app.');
  });

  it('sem contagem, o app não acompanha', () => {
    expect(estimate({ stockCount: null, stockCountedOn: null })).toBeNull();
    // Banco de antes do estoque: os campos nem vêm.
    const legacy: StockedMedication = { id: 'm', personName: 'Ana', name: 'X', dosage: null, times: ['08:00'], startOn: '2026-01-01', endOn: null, active: true };
    expect(estimateStock(legacy, today)).toBeNull();
    expect(stockStatus(legacy, today)).toEqual({ kind: 'none' });
    expect(refillAlerts(legacy, today)).toEqual([]);
  });
});

describe('estados e textos do estoque', () => {
  it('tem bastante: nada nas listas, só a frase na tela do remédio', () => {
    expect(stockStatus(med(), today).kind).toBe('plenty');
    expect(sentence()).toBe('Dá para mais 30 dias (até 11/11), pelas contas do app.');
    expect(labels()).toEqual([]);
    expect(refillBadge(med(), today)).toBeNull();
    // Acaba no ano que vem: a data vai com o ano.
    expect(sentence({ stockCount: 100 })).toBe('Dá para mais 100 dias (até 20/01/2027), pelas contas do app.');
  });

  it('a janela do aviso: exatamente N dias já avisa, N+1 ainda não', () => {
    expect(stockStatus(med({ stockCount: 7 }), today)).toMatchObject({ kind: 'low', daysLeft: 7, runsOutOn: '2026-10-19' });
    expect(stockStatus(med({ stockCount: 8 }), today).kind).toBe('plenty');
    expect(stockStatus(med({ stockCount: 3, warnDays: 3 }), today).kind).toBe('low');
    expect(stockStatus(med({ stockCount: 4, warnDays: 3 }), today).kind).toBe('plenty');
    // Sem os dias escolhidos (banco antigo), uma semana.
    expect(stockStatus(med({ stockCount: 7, warnDays: undefined }), today).kind).toBe('low');
    expect(stockStatus(med({ stockCount: 8, warnDays: null }), today).kind).toBe('plenty');
  });

  it('acabando: "em N dias", "amanhã", "hoje"', () => {
    expect(labels({ stockCount: 3 })).toEqual(['Acaba em 3 dias']);
    expect(labels({ stockCount: 2 })).toEqual(['Acaba em 2 dias']);
    expect(labels({ stockCount: 1 })).toEqual(['Acaba amanhã']);
    // A última dose que a caixa cobre é a de hoje (1 contado ontem).
    const lastToday = { stockCount: 1, stockCountedOn: '2026-10-11' };
    expect(labels(lastToday)).toEqual(['Acaba hoje']);
    expect(sentence({ stockCount: 3 })).toBe('Acaba em 3 dias (15/10), pelas contas do app.');
    expect(sentence({ stockCount: 1 })).toBe('Acaba amanhã, pelas contas do app.');
    expect(sentence(lastToday)).toBe('Acaba hoje, pelas contas do app.');
    expect(refillBadge(med({ stockCount: 3 }), today)).toEqual({ about: 'stock', label: 'Acaba em 3 dias', tone: 'warning', days: 3 });
  });

  it('estoque que não cobre nem a próxima dose já acabou, no dia da contagem também', () => {
    // A pessoa disse que não tem (ou que tem menos que uma dose): o app não responde "acaba hoje".
    for (const none of [{ stockCount: 0 }, { stockCount: 1, doseUnits: 2 }, { stockCount: 0.5 }]) {
      expect(stockStatus(med(none), today)).toMatchObject({ kind: 'out', ranOutOn: today });
      expect(labels(none)).toEqual(['Deve ter acabado']);
      expect(refillBadge(med(none), today)).toMatchObject({ tone: 'danger', days: 0 });
      expect(sentence(none)).toBe('Sem estoque para a próxima dose, pelas contas do app.');
      // Nem aviso por notificação.
      expect(refillReminders([med(none)], today)).toEqual([]);
    }
    // O que sobra (menos que uma dose) continua lá.
    expect(stockStatus(med({ stockCount: 1, doseUnits: 2 }), today)).toMatchObject({ estimate: { unitsLeft: 1 } });
    // A próxima dose é só na quarta (remédio de segunda, quarta e sexta): já não há para ela.
    expect(sentence({ stockCount: 0, frequency: 'weekdays', weekdays: [1, 3, 5] })).toBe('Sem estoque para a próxima dose, pelas contas do app.');
    // Do dia seguinte em diante, a frase de quem acabou, com o dia da contagem.
    expect(sentence({ stockCount: 0 }, '2026-10-13')).toBe('Deve ter acabado em 12/10, pelas contas do app.');
  });

  it(`acabou há mais de ${STALE_DAYS} dias sem ninguém atualizar: o aviso vira um selo neutro`, () => {
    // 3 contados em 01/10: acabou em 04/10. No 14º dia depois (18/10) ainda pede atenção; no 15º, não mais.
    const out = { stockCount: 3, stockCountedOn: '2026-10-01' };
    expect(STALE_DAYS).toBe(14);
    expect(stockStatus(med(out), '2026-10-18')).toMatchObject({ kind: 'out', ranOutOn: '2026-10-04' });
    expect(refillAlerts(med(out), '2026-10-18')).toEqual([{ about: 'stock', label: 'Deve ter acabado', tone: 'danger', days: -14 }]);
    expect(stockStatus(med(out), '2026-10-19')).toMatchObject({ kind: 'stale', ranOutOn: '2026-10-04' });
    expect(refillAlerts(med(out), '2026-10-19')).toEqual([{ about: 'stock', label: 'Estoque sem atualizar desde 04/10', tone: 'neutral', days: -15 }]);
    expect(sentence(out, '2026-10-19')).toBe(
      'Estoque sem atualizar desde 04/10. Escreva quanto tem agora, ou apague o número para o app parar de acompanhar.',
    );
    // No ano seguinte, a data vai com o ano. E nada de notificação.
    expect(labels(out, '2027-01-10')).toEqual(['Estoque sem atualizar desde 04/10/2026']);
    expect(refillReminders([med(out)], '2026-10-19')).toEqual([]);
    // Contado zero: os 14 dias contam do dia da contagem.
    expect(stockStatus(med({ stockCount: 0 }), '2026-10-26').kind).toBe('out');
    expect(stockStatus(med({ stockCount: 0 }), '2026-10-27').kind).toBe('stale');
  });

  it('pelas contas já acabou: o app não sabe, só estima', () => {
    const out = { stockCount: 3, stockCountedOn: '2026-10-01' };
    expect(stockStatus(med(out), today)).toMatchObject({ kind: 'out', ranOutOn: '2026-10-04' });
    expect(labels(out)).toEqual(['Deve ter acabado']);
    expect(sentence(out)).toBe('Deve ter acabado em 04/10, pelas contas do app.');
    expect(refillBadge(med(out), today)).toMatchObject({ tone: 'danger', days: -8 });
    // No dia seguinte ao último comprimido.
    expect(labels({ stockCount: 0 }, '2026-10-13')).toEqual(['Deve ter acabado']);
  });

  it('remédio encerrado, terminado ou com todas as doses tomadas não mostra nada', () => {
    const quiet = { stockCount: 1, prescriptionUntil: '2026-10-13' };
    expect(labels(quiet)).toEqual(['Acaba amanhã', 'Receita vence amanhã']);
    for (const ended of [{ active: false }, { endOn: '2026-10-11' }, { totalDoses: 10, takenCount: 10 }]) {
      expect(stockStatus(med({ ...quiet, ...ended }), today)).toEqual({ kind: 'none' });
      expect(prescriptionStatus(med({ ...quiet, ...ended }), today)).toEqual({ kind: 'none' });
      expect(labels({ ...quiet, ...ended })).toEqual([]);
      expect(sentence({ ...quiet, ...ended })).toBeNull();
      expect(refillReminders([med({ ...quiet, ...ended })], today)).toEqual([]);
    }
    // No último dia do tratamento ainda vale.
    expect(labels({ ...quiet, endOn: today })).toEqual(['Receita vence amanhã']);
  });
});

describe('receita', () => {
  const on = (until: string) => med({ stockCount: null, stockCountedOn: null, prescriptionUntil: until });
  const text = (until: string) => describePrescription(prescriptionStatus(on(until), today), today);

  it('aparece 15 dias antes, no dia e depois de vencida', () => {
    expect(prescriptionStatus(on('2026-10-28'), today)).toEqual({ kind: 'none' });
    expect(prescriptionStatus(on('2026-10-27'), today)).toEqual({ kind: 'soon', days: 15, until: '2026-10-27' });
    expect(prescriptionStatus(on('2026-10-13'), today)).toEqual({ kind: 'soon', days: 1, until: '2026-10-13' });
    expect(prescriptionStatus(on('2026-10-12'), today)).toEqual({ kind: 'today', until: '2026-10-12' });
    expect(prescriptionStatus(on('2026-10-11'), today)).toEqual({ kind: 'expired', until: '2026-10-11' });
  });

  it('os textos: selo e frase', () => {
    const label = (until: string) => refillAlerts(on(until), today).map((a) => [a.label, a.tone]);
    expect(label('2026-10-28')).toEqual([]);
    expect(label('2026-10-27')).toEqual([['Receita vence em 15 dias', 'warning']]);
    expect(label('2026-10-13')).toEqual([['Receita vence amanhã', 'warning']]);
    expect(label('2026-10-12')).toEqual([['Receita vence hoje', 'warning']]);
    expect(label('2026-10-11')).toEqual([['Receita vencida', 'danger']]);
    expect(text('2026-10-28')).toBeNull();
    expect(text('2026-10-27')).toBe('A receita vence em 15 dias (27/10).');
    expect(text('2026-10-13')).toBe('A receita vence amanhã.');
    expect(text('2026-10-12')).toBe('A receita vence hoje.');
    expect(text('2026-10-11')).toBe('A receita venceu em 11/10.');
  });

  it('não depende do estoque, e os dois avisos convivem (o que já passou primeiro)', () => {
    expect(labels({ stockCount: 3, prescriptionUntil: '2026-10-22' })).toEqual(['Acaba em 3 dias', 'Receita vence em 10 dias']);
    expect(labels({ stockCount: 3, prescriptionUntil: '2026-10-01' })).toEqual(['Receita vencida', 'Acaba em 3 dias']);
    expect(refillBadge(med({ stockCount: 3, prescriptionUntil: '2026-10-01' }), today)?.label).toBe('Receita vencida');
    // O que parou de pedir atenção (estoque acabado há mais de 14 dias) fica por último.
    expect(labels({ stockCount: 3, stockCountedOn: '2026-09-01', prescriptionUntil: '2026-10-22' })).toEqual([
      'Receita vence em 10 dias',
      'Estoque sem atualizar desde 04/09',
    ]);
  });

  it(`vencida há mais de ${STALE_DAYS} dias sem ninguém atualizar: selo neutro, com o dia`, () => {
    // Venceu em 01/10: no 14º dia depois (15/10) ainda pede atenção; no 15º, não mais.
    const expired = on('2026-10-01');
    expect(prescriptionStatus(expired, '2026-10-15')).toEqual({ kind: 'expired', until: '2026-10-01' });
    expect(refillAlerts(expired, '2026-10-15')).toEqual([{ about: 'prescription', label: 'Receita vencida', tone: 'danger', days: -14 }]);
    expect(prescriptionStatus(expired, '2026-10-16')).toEqual({ kind: 'stale', until: '2026-10-01' });
    expect(refillAlerts(expired, '2026-10-16')).toEqual([{ about: 'prescription', label: 'Receita venceu em 01/10', tone: 'neutral', days: -15 }]);
    expect(describePrescription(prescriptionStatus(expired, '2026-10-16'), '2026-10-16')).toBe('A receita venceu em 01/10.');
    expect(refillAlerts(expired, '2027-02-01')[0].label).toBe('Receita venceu em 01/10/2026');
  });
});

describe('"Comprei mais"', () => {
  it('soma a caixa ao que a conta diz que sobra hoje, contado de novo hoje', () => {
    // 30 contados há 10 dias: sobram 20.
    expect(restock(med({ stockCountedOn: '2026-10-02' }), today, 30)).toEqual({ stockCount: 50, stockCountedOn: today });
    expect(restock(med({ doseUnits: 0.5, stockCount: 10, stockCountedOn: '2026-10-09' }), today, 20)).toEqual({ stockCount: 28.5, stockCountedOn: today });
  });

  it('sobre zero (acabou, ou o app ainda não acompanhava): fica a caixa', () => {
    expect(restock(med({ stockCountedOn: '2026-01-01' }), today, 30)).toEqual({ stockCount: 30, stockCountedOn: today });
    expect(restock(med({ stockCount: null, stockCountedOn: null }), today, 60)).toEqual({ stockCount: 60, stockCountedOn: today });
    // E a conta recomeça de hoje.
    const next = restock(med({ stockCountedOn: '2026-01-01' }), today, 30);
    expect(estimateStock(med(next), today)).toMatchObject({ unitsLeft: 30, runsOutOn: '2026-11-11' });
  });

  it('a pessoa corrigiu "Quanto tem agora" antes de somar: a caixa soma ao número digitado', () => {
    // 30 contados há 10 dias: o campo abre com 20.
    const saved = med({ stockCountedOn: '2026-10-02' });
    const initial = stockFormOf(saved, today);
    // Campo como abriu: vale a conta de hoje.
    expect(restockBase(initial, initial)).toEqual({ ok: true, base: undefined });
    expect(restock(saved, today, 30, undefined)).toEqual({ stockCount: 50, stockCountedOn: today });
    // Corrigido para 5 (na caixa só havia 5): 35, e não 50.
    expect(restockBase({ ...initial, stock: ' 5 ' }, initial)).toEqual({ ok: true, base: 5 });
    expect(restock(saved, today, 30, 5)).toEqual({ stockCount: 35, stockCountedOn: today });
    expect(restockBase({ ...initial, stock: '12,5' }, initial)).toEqual({ ok: true, base: 12.5 });
    expect(restock(saved, today, 30, 12.5)).toEqual({ stockCount: 42.5, stockCountedOn: today });
    // Campo apagado: fica só a caixa.
    expect(restockBase({ ...initial, stock: '  ' }, initial)).toEqual({ ok: true, base: 0 });
    expect(restock(saved, today, 30, 0)).toEqual({ stockCount: 30, stockCountedOn: today });
    // Texto que não é número: o mesmo aviso de salvar, e nada é gravado.
    const invalid = restockBase({ ...initial, stock: 'uns 5' }, initial);
    expect(invalid).toEqual(readStockForm({ ...initial, stock: 'uns 5' }, initial, today));
    expect(invalid).toMatchObject({ ok: false, title: 'Estoque inválido' });
    // Primeira vez (o app ainda não acompanhava): 10 digitados mais a caixa de 30.
    const untracked = med({ stockCount: null, stockCountedOn: null });
    const empty = stockFormOf(untracked, today);
    expect(restockBase(empty, empty)).toEqual({ ok: true, base: undefined });
    expect(restockBase({ ...empty, stock: '10' }, empty)).toEqual({ ok: true, base: 10 });
    expect(restock(untracked, today, 30, 10)).toEqual({ stockCount: 40, stockCountedOn: today });
  });

  it('o texto ao lado da caixa diz a que ela é somada', () => {
    const hint = (patch: Partial<StockedMedication>, typed?: string, on = today) => {
      const initial = stockFormOf(med(patch), on);
      return restockHint(med(patch), typed === undefined ? initial : { ...initial, stock: typed }, initial, on);
    };
    const counted = { stockCountedOn: '2026-10-02' };
    expect(hint(counted)).toBe('O app soma ao que ainda tem, pelas contas do app, e passa a contar a partir de hoje.');
    // Com o número corrigido na tela, a base é ele, e não a conta do app.
    expect(hint(counted, '5')).toBe('O app soma ao número que você escreveu em “Quanto tem agora” e passa a contar a partir de hoje.');
    expect(hint(counted, '')).toBe('Com “Quanto tem agora” vazio, o app conta só esta caixa e passa a contar a partir de hoje.');
    // O app ainda não acompanhava este remédio.
    expect(hint({ stockCount: null, stockCountedOn: null })).toBe('O app começa a acompanhar por esta caixa e passa a contar a partir de hoje.');
    expect(hint({ stockCount: null, stockCountedOn: null }, '10')).toBe(hint(counted, '5'));
  });

  it('compra registrada dias depois de a caixa acabar: o app diz o que fazer, sem mudar a conta sozinho', () => {
    const hint = (on: string, typed?: string) => {
      const initial = stockFormOf(med(), on);
      return restockHint(med(), typed === undefined ? initial : { ...initial, stock: typed }, initial, on);
    };
    const late =
      'Pelas contas do app, a caixa anterior acabou em 11/11. Se você já está usando a nova, escreva em “Quanto tem agora” quantas unidades ainda tem, em vez de somar a caixa inteira.';
    // 30 contados em 12/10: a caixa acaba em 11/11. No dia, ainda é a frase de sempre; do dia seguinte em diante, a da compra atrasada.
    expect(hint('2026-11-11')).toBe('O app soma ao que ainda tem, pelas contas do app, e passa a contar a partir de hoje.');
    expect(hint('2026-11-12')).toBe(late);
    expect(hint('2026-11-21')).toBe(late);
    // Parado há mais de 14 dias: a mesma orientação.
    expect(hint('2026-12-20')).toBe(late);
    // A pessoa seguiu a orientação e escreveu quanto tem: somar a caixa agora contaria em dobro, e o texto diz o que tocar.
    const typed = 'Se esse número já conta a caixa nova, toque em “Cancelar” e depois em “Salvar”. “Somar ao estoque” soma mais uma caixa a ele.';
    expect(hint('2026-11-21', '20')).toBe(typed);
    expect(hint('2026-12-20', '20')).toBe(typed);
    // No dia em que a caixa acaba ainda não é compra atrasada; e com o campo apagado a caixa entra sozinha.
    expect(hint('2026-11-11', '20')).toBe('O app soma ao número que você escreveu em “Quanto tem agora” e passa a contar a partir de hoje.');
    expect(hint('2026-11-21', '')).toBe('Com “Quanto tem agora” vazio, o app conta só esta caixa e passa a contar a partir de hoje.');
    // A conta em si não muda: quem comprou hoje, depois de dias sem o remédio, soma a caixa inteira.
    expect(restock(med(), '2026-11-21', 30)).toEqual({ stockCount: 30, stockCountedOn: '2026-11-21' });
    expect(restock(med(), '2026-11-21', 30, 20)).toEqual({ stockCount: 50, stockCountedOn: '2026-11-21' });
  });
});

describe('o que as telas Hoje e Saúde listam', () => {
  const meds = [
    med({ id: 'ok', name: 'Vitamina D' }),
    med({ id: 'baixo', name: 'Losartana', dosage: '50 mg', stockCount: 3 }),
    med({ id: 'acabou', name: 'Puran', personName: 'Beto', stockCount: 3, stockCountedOn: '2026-10-01' }),
    med({ id: 'receita', name: 'Insulina', personName: 'Rex', stockCount: null, stockCountedOn: null, prescriptionUntil: '2026-10-22' }),
    med({ id: 'os-dois', name: 'Anticoncepcional', stockCount: 1, prescriptionUntil: '2026-10-14' }),
    // Acabou em 04/09 e ninguém atualizou: não pede mais atenção.
    med({ id: 'parado', name: 'Rivotril', personName: 'Beto', stockCount: 3, stockCountedOn: '2026-09-01' }),
    med({ id: 'encerrado', name: 'Antigo', stockCount: 0, active: false }),
  ];

  it('um remédio por linha, o mais urgente primeiro e o que parou de pedir atenção por último', () => {
    const rows = refillRows(meds, today);
    expect(rows.map((row) => [row.id, row.title, row.alerts.map((a) => a.label), row.itemName, row.stock, row.attention])).toEqual([
      ['acabou', 'Puran (Beto)', ['Deve ter acabado'], 'Puran', 'out', true],
      ['os-dois', 'Anticoncepcional (Ana)', ['Acaba amanhã', 'Receita vence em 2 dias'], 'Anticoncepcional', 'low', true],
      ['baixo', 'Losartana (Ana)', ['Acaba em 3 dias'], 'Losartana', 'low', true],
      // Só a receita: `stock` nulo, sem ação de farmácia.
      ['receita', 'Insulina (Rex)', ['Receita vence em 10 dias'], 'Insulina', null, true],
      ['parado', 'Rivotril (Beto)', ['Estoque sem atualizar desde 04/09'], 'Rivotril', 'stale', false],
    ]);
    // O primeiro selo de cada linha é o mais urgente: é o que dá a cor.
    expect(rows.map((row) => row.alerts[0].tone)).toEqual(['danger', 'warning', 'warning', 'warning', 'neutral']);
    expect(refillRows([med()], today)).toEqual([]);
  });

  it('estoque parado com a receita vencendo: a linha segue pedindo atenção, pela receita', () => {
    const [row] = refillRows([med({ stockCount: 3, stockCountedOn: '2026-09-01', prescriptionUntil: '2026-10-22' })], today);
    expect(row).toMatchObject({ stock: 'stale', attention: true });
    expect(row.alerts.map((a) => [a.label, a.tone])).toEqual([
      ['Receita vence em 10 dias', 'warning'],
      ['Estoque sem atualizar desde 04/09', 'neutral'],
    ]);
    // A receita vencida há muito tempo e a caixa acabando: o contrário.
    const [other] = refillRows([med({ stockCount: 3, prescriptionUntil: '2026-09-01' })], today);
    expect(other).toMatchObject({ stock: 'low', attention: true });
    expect(other.alerts.map((a) => a.label)).toEqual(['Acaba em 3 dias', 'Receita venceu em 01/09']);
    // As duas coisas paradas: nada pede atenção.
    expect(refillRows([med({ stockCount: 3, stockCountedOn: '2026-09-01', prescriptionUntil: '2026-09-01' })], today)[0]).toMatchObject({
      stock: 'stale',
      attention: false,
    });
  });

  it('o item da lista da farmácia é só o nome do remédio (a dose de cada tomada não vai)', () => {
    expect(pharmacyItemName({ name: ' Losartana 50 mg ', personName: 'Ana' })).toBe('Losartana 50 mg');
    expect(refillRows([med({ name: 'Losartana 50mg', dosage: '1 comprimido', stockCount: 3 })], today)[0].itemName).toBe('Losartana 50mg');
  });

  it('duas pessoas com o mesmo remédio: o item leva de quem é', () => {
    const ana = med({ id: 'a', name: 'Losartana 50 mg', stockCount: 3 });
    const beto = med({ id: 'b', name: 'Losartana 50 mg', personName: 'Beto', stockCount: 3 });
    // As duas caixas acabando ao mesmo tempo: dois itens, um de cada pessoa.
    expect(refillRows([ana, beto], today).map((row) => [row.id, row.itemName])).toEqual([
      ['a', 'Losartana 50 mg — Ana'],
      ['b', 'Losartana 50 mg — Beto'],
    ]);
    // Só a da Ana acabando (a do Beto tem bastante): o item dela já vai com o nome...
    const [anaRow] = refillRows([ana, { ...beto, stockCount: 30 }], today);
    expect(anaRow.itemName).toBe('Losartana 50 mg — Ana');
    // ...e, com ele ainda pendente na lista, a caixa do Beto acabando não se confunde com ele.
    const pending = new Set([normalizeSearch(anaRow.itemName)]);
    const betoRow = refillRows([ana, beto], '2026-10-20').find((row) => row.id === 'b');
    expect(betoRow?.itemName).toBe('Losartana 50 mg — Beto');
    expect(pending.has(normalizeSearch(betoRow?.itemName ?? ''))).toBe(false);
    // O nome igual vale sem acento nem maiúscula, e remédio sem estoque acompanhado também conta.
    const [same] = refillRows([ana, { ...beto, name: ' LOSARTANA 50 MG', stockCount: null, stockCountedOn: null }], today);
    expect(same.itemName).toBe('Losartana 50 mg — Ana');
    // Tratamento do outro encerrado ou terminado: o item volta a ser só o nome.
    for (const ended of [{ active: false }, { endOn: '2026-10-11' }, { totalDoses: 10, takenCount: 10 }]) {
      expect(refillRows([ana, { ...beto, ...ended }], today).map((row) => row.itemName)).toEqual(['Losartana 50 mg']);
    }
    // Outro remédio da casa não muda nada.
    expect(refillRows([ana, { ...beto, name: 'Puran' }], today).map((row) => row.itemName)).toEqual(['Losartana 50 mg', 'Puran']);
  });

  it('o resumo para o Nuke: quantos remédios em uso o app acompanha e o estado dos que pedem atenção ou pararam', () => {
    const untracked = med({ id: 'sem', name: 'Dipirona', stockCount: null, stockCountedOn: null });
    expect(refillSummary([...meds, untracked], today)).toEqual({
      inUse: 7,
      followed: 6,
      lines: [
        'Puran (Beto) — deve ter acabado',
        'Anticoncepcional (Ana) — acaba amanhã, receita vence em 2 dias',
        'Losartana (Ana) — acaba em 3 dias',
        'Insulina (Rex) — receita vence em 10 dias',
        'Rivotril (Beto) — estoque sem atualizar desde 04/09',
      ],
    });
    // Nenhum remédio em uso; em uso sem nada acompanhado; acompanhados sem nada a dizer.
    expect(refillSummary([], today)).toEqual({ inUse: 0, followed: 0, lines: [] });
    expect(refillSummary([med({ active: false }), med({ endOn: '2026-10-11' })], today)).toEqual({ inUse: 0, followed: 0, lines: [] });
    expect(refillSummary([untracked, { ...untracked, id: 'sem2' }], today)).toEqual({ inUse: 2, followed: 0, lines: [] });
    expect(refillSummary([med(), untracked], today)).toEqual({ inUse: 2, followed: 1, lines: [] });
    // Só a data da receita também é acompanhar.
    expect(refillSummary([{ ...untracked, prescriptionUntil: '2027-03-01' }], today)).toEqual({ inUse: 1, followed: 1, lines: [] });
  });
});

describe('os avisos por notificação', () => {
  it('quando faltam os dias escolhidos e no dia em que acaba', () => {
    expect(refillReminders([med({ stockCount: 20 })], today)).toEqual([
      { id: 'm1', date: '2026-10-25', title: 'Remédio acabando', body: 'Losartana (Ana) acaba em 7 dias.' },
      { id: 'm1', date: '2026-11-01', title: 'Remédio acaba hoje', body: 'Losartana (Ana) acaba hoje, pelas contas do app.' },
    ]);
    // Aviso com 1 dia: "amanhã".
    expect(refillReminders([med({ stockCount: 20, warnDays: 1 })], today)[0]).toEqual({
      id: 'm1',
      date: '2026-10-31',
      title: 'Remédio acabando',
      body: 'Losartana (Ana) acaba amanhã.',
    });
  });

  it('uma semana antes de a receita vencer e no dia', () => {
    const only = med({ stockCount: null, stockCountedOn: null, prescriptionUntil: '2026-10-30' });
    expect(refillReminders([only], today)).toEqual([
      { id: 'm1@receita', date: '2026-10-23', title: 'Receita vencendo', body: 'A receita de Losartana (Ana) vence em 7 dias (30/10/2026).' },
      { id: 'm1@receita', date: '2026-10-30', title: 'Receita vence hoje', body: 'A receita de Losartana (Ana) vence hoje.' },
    ]);
    // Vencida: sem aviso.
    expect(refillReminders([{ ...only, prescriptionUntil: '2026-10-11' }], today)).toEqual([]);
  });

  it('nada para remédio sem estoque acompanhado, que já acabou ou que termina antes', () => {
    expect(refillReminders([med({ stockCount: null, stockCountedOn: null })], today)).toEqual([]);
    // Acabou há poucos dias (ainda pede atenção nas telas) ou há muito tempo (parado): sem aviso.
    expect(refillReminders([med({ stockCount: 3, stockCountedOn: '2026-10-01' })], today)).toEqual([]);
    expect(refillReminders([med({ stockCountedOn: '2026-01-01' })], today)).toEqual([]);
    expect(refillReminders([med({ endOn: '2026-10-20' })], today)).toEqual([]);
  });

  describe('caixa contada já dentro dos dias de aviso: o aviso da véspera', () => {
    const dated = (patch: Partial<StockedMedication>, on = today) => refillReminders([med(patch)], on).map((r) => [r.date, r.title, r.body]);
    const eve = ['Remédio acaba amanhã', 'Losartana (Ana) acaba amanhã, pelas contas do app.'];
    const day = ['Remédio acaba hoje', 'Losartana (Ana) acaba hoje, pelas contas do app.'];

    it('contada com 4 dias, aviso de 7: o de antes já passou; ficam a véspera e o dia', () => {
      expect(dated({ stockCount: 4 })).toEqual([
        ['2026-10-15', ...eve],
        ['2026-10-16', ...day],
      ]);
    });

    it('contada com 1 dia: a véspera é hoje mesmo; fica só o dia', () => {
      expect(dated({ stockCount: 1 })).toEqual([['2026-10-13', ...day]]);
    });

    it('contada com bastante: o aviso de antes e o dia, sem a véspera', () => {
      expect(dated({ stockCount: 20 })).toEqual([
        ['2026-10-25', 'Remédio acabando', 'Losartana (Ana) acaba em 7 dias.'],
        ['2026-11-01', ...day],
      ]);
      // Aviso de 1 dia: o aviso de antes já é o da véspera, um só.
      expect(dated({ stockCount: 20, warnDays: 1 })).toEqual([
        ['2026-10-31', 'Remédio acabando', 'Losartana (Ana) acaba amanhã.'],
        ['2026-11-01', ...day],
      ]);
      expect(dated({ stockCount: 20, warnDays: 1 }, '2026-10-31')).toEqual(dated({ stockCount: 20, warnDays: 1 }));
    });

    it('a véspera sai da contagem, e não de quando o plano é feito: todo aparelho recebe os mesmos avisos', () => {
      // Contada com bastante: quem abre o app só depois do aviso de antes (25/10) não ganha um aviso a mais.
      expect(dated({ stockCount: 20 }, '2026-10-25').map(([date]) => date)).toEqual(['2026-10-25', '2026-11-01']);
      for (const on of ['2026-10-26', '2026-10-30', '2026-10-31', '2026-11-01']) {
        expect(dated({ stockCount: 20 }, on)).toEqual([['2026-11-01', ...day]]);
      }
      // Contada já no fim (4 dias, aviso de 7): a véspera fica no plano até a manhã dela, em qualquer dia em que ele for feito.
      for (const on of ['2026-10-12', '2026-10-14', '2026-10-15']) {
        expect(dated({ stockCount: 4 }, on)).toEqual([
          ['2026-10-15', ...eve],
          ['2026-10-16', ...day],
        ]);
      }
      expect(dated({ stockCount: 4 }, '2026-10-16')).toEqual([['2026-10-16', ...day]]);
    });

    it('contada no próprio dia do aviso de antes (cartela de 7, aviso de 7): ele, a véspera e o dia', () => {
      expect(dated({ stockCount: 7 }).map(([date, title]) => [date, title])).toEqual([
        ['2026-10-12', 'Remédio acabando'],
        ['2026-10-18', 'Remédio acaba amanhã'],
        ['2026-10-19', 'Remédio acaba hoje'],
      ]);
    });
  });

  describe('receita de um tratamento que termina antes', () => {
    const dates = (patch: Partial<StockedMedication>) => refillReminders([med(patch)], today).map((r) => [r.id, r.date]);

    it('com data de fim: os avisos da receita que cairiam depois dela não saem', () => {
      // Termina em 15/10; a receita vale até 24/10 (avisos em 17/10 e 24/10).
      expect(dates({ endOn: '2026-10-15', prescriptionUntil: '2026-10-24' })).toEqual([]);
      // Termina em 20/10: o de 17/10 ainda cai dentro do tratamento.
      expect(dates({ endOn: '2026-10-20', prescriptionUntil: '2026-10-24' })).toEqual([['m1@receita', '2026-10-17']]);
      // Termina no dia em que a receita vence: os dois.
      expect(dates({ endOn: '2026-10-24', prescriptionUntil: '2026-10-24' })).toEqual([
        ['m1@receita', '2026-10-17'],
        ['m1@receita', '2026-10-24'],
      ]);
    });

    it('por número de doses: vale o dia da última dose prevista, com a de hoje marcada ou não', () => {
      // 10 doses, uma por dia desde 05/10: a última é em 14/10. A receita vale até 21/10 (avisos em 14/10 e 21/10).
      const course = { stockCount: null, stockCountedOn: null, startOn: '2026-10-05', totalDoses: 10, prescriptionUntil: '2026-10-21' };
      for (const takenCount of [7, 8]) {
        expect(dates({ ...course, takenCount })).toEqual([['m1@receita', '2026-10-14']]);
      }
      // Adiantou doses (9 tomadas): a última é amanhã, e nenhum aviso cai antes dela.
      expect(dates({ ...course, takenCount: 9 })).toEqual([]);
    });

    it('por número de doses, com as marcações bem atrás do horário: na dúvida, os avisos ficam', () => {
      // Pelo horário faltariam 2 doses; pelas marcações, 8: não dá para saber quando termina.
      const course = { stockCount: null, stockCountedOn: null, startOn: '2026-10-05', totalDoses: 10, takenCount: 2, prescriptionUntil: '2026-10-21' };
      expect(dates(course)).toEqual([
        ['m1@receita', '2026-10-14'],
        ['m1@receita', '2026-10-21'],
      ]);
    });

    it('uso contínuo: os dois avisos, como sempre', () => {
      expect(dates({ stockCount: null, stockCountedOn: null, prescriptionUntil: '2026-10-21' })).toEqual([
        ['m1@receita', '2026-10-14'],
        ['m1@receita', '2026-10-21'],
      ]);
    });
  });
});

describe('a seção "Estoque e receita" do remédio', () => {
  const fresh = { stock: '', doseUnits: '1', warnDays: '7', prescription: '' };

  it('remédio novo abre vazio, com 1 por dose e 7 dias de aviso', () => {
    expect(stockFormOf(undefined, today)).toEqual(fresh);
  });

  it('"Quanto tem agora" abre com o que a conta diz que sobra hoje', () => {
    const saved = med({ doseUnits: 0.5, stockCount: 10, stockCountedOn: '2026-10-09', warnDays: 10, prescriptionUntil: '2026-12-20' });
    expect(stockFormOf(saved, today)).toEqual({ stock: '8,5', doseUnits: '0,5', warnDays: '10', prescription: '20/12/2026' });
    expect(stockFormOf(med({ stockCount: null, stockCountedOn: null }), today)).toEqual(fresh);
  });

  it('salvar sem mexer não muda nada (a conta não recomeça)', () => {
    const initial = stockFormOf(med({ stockCountedOn: '2026-10-02' }), today);
    expect(initial.stock).toBe('20');
    expect(readStockForm(initial, initial, today)).toEqual({ ok: true, changes: {} });
    expect(readStockForm(fresh, fresh, today)).toEqual({ ok: true, changes: {} });
  });

  it('um número em "Quanto tem agora" vale como contado hoje; vazio, o app para de acompanhar', () => {
    const initial = stockFormOf(med({ stockCountedOn: '2026-10-02' }), today);
    expect(readStockForm({ ...initial, stock: ' 25 ' }, initial, today)).toEqual({ ok: true, changes: { stockCount: 25, stockCountedOn: today } });
    expect(readStockForm({ ...initial, stock: '12,5' }, initial, today)).toEqual({ ok: true, changes: { stockCount: 12.5, stockCountedOn: today } });
    expect(readStockForm({ ...initial, stock: '0' }, initial, today)).toEqual({ ok: true, changes: { stockCount: 0, stockCountedOn: today } });
    expect(readStockForm({ ...initial, stock: '' }, initial, today)).toEqual({ ok: true, changes: { stockCount: null, stockCountedOn: null } });
  });

  it('só entra o campo em que a pessoa mexeu', () => {
    expect(readStockForm({ stock: '30', doseUnits: '0,5', warnDays: '10', prescription: '20/12/2026' }, fresh, today)).toEqual({
      ok: true,
      changes: { stockCount: 30, stockCountedOn: today, doseUnits: 0.5, warnDays: 10, prescriptionUntil: '2026-12-20' },
    });
    expect(readStockForm({ ...fresh, doseUnits: '2' }, fresh, today)).toEqual({ ok: true, changes: { doseUnits: 2 } });
    const dated = { ...fresh, prescription: '20/12/2026' };
    expect(readStockForm({ ...dated, prescription: '' }, dated, today)).toEqual({ ok: true, changes: { prescriptionUntil: null } });
  });

  it('recusa o que não dá para entender, dizendo o campo', () => {
    const title = (form: Partial<typeof fresh>) => {
      const result = readStockForm({ ...fresh, ...form }, fresh, today);
      return result.ok ? null : result.title;
    };
    expect(title({ stock: 'muitos' })).toBe('Estoque inválido');
    expect(title({ stock: '-3' })).toBe('Estoque inválido');
    expect(title({ stock: '100000' })).toBe('Estoque inválido');
    expect(title({ doseUnits: '0' })).toBe('Dose inválida');
    expect(title({ doseUnits: '' })).toBe('Dose inválida');
    expect(title({ warnDays: '0' })).toBe('Aviso inválido');
    expect(title({ warnDays: '61' })).toBe('Aviso inválido');
    expect(title({ warnDays: '2,5' })).toBe('Aviso inválido');
    expect(title({ warnDays: '60' })).toBeNull();
    expect(title({ prescription: '31/02/2027' })).toBe('Data inválida');
  });

  it('mudar a regra das doses não muda o que já foi gasto: a contagem recomeça de hoje, com o que sobrava', () => {
    // 60 contados há 20 dias, um por dia: sobram 40.
    const saved = med({ stockCount: 60, stockCountedOn: '2026-09-22' });
    const rule = { times: saved.times, startOn: saved.startOn, endOn: saved.endOn, frequency: 'daily' as const, weekdays: null, intervalDays: null };
    expect(estimateStock(saved, today)?.unitsLeft).toBe(40);
    // Nada mudou: nada a gravar.
    expect(keepStockOnRuleChange({}, saved, rule, today)).toEqual({});
    expect(keepStockOnRuleChange({ warnDays: 10 }, saved, { ...rule, times: ['08:00'] }, today)).toEqual({ warnDays: 10 });
    // Passou a duas vezes por dia: os 40 de hoje duram 20 dias, e não "sobram 20".
    const twice = { ...rule, times: ['08:00', '20:00'] };
    const rebased = keepStockOnRuleChange({}, saved, twice, today);
    expect(rebased).toEqual({ stockCount: 40, stockCountedOn: today });
    expect(estimateStock({ ...saved, ...twice, ...rebased }, today)).toMatchObject({ unitsLeft: 40, runsOutOn: '2026-11-01' });
    // Regularidade, início, fim e quanto cada dose usa também contam.
    expect(keepStockOnRuleChange({}, saved, { ...rule, frequency: 'weekdays', weekdays: [1, 3] }, today)).toEqual(rebased);
    expect(keepStockOnRuleChange({}, saved, { ...rule, startOn: '2026-10-01' }, today)).toEqual(rebased);
    expect(keepStockOnRuleChange({}, saved, { ...rule, endOn: '2026-12-31' }, today)).toEqual(rebased);
    expect(keepStockOnRuleChange({ doseUnits: 2 }, saved, rule, today)).toEqual({ doseUnits: 2, ...rebased });
    // A pessoa contou de novo (ou parou de acompanhar): vale o que ela disse.
    expect(keepStockOnRuleChange({ stockCount: 12, stockCountedOn: today }, saved, twice, today)).toEqual({ stockCount: 12, stockCountedOn: today });
    expect(keepStockOnRuleChange({ stockCount: null, stockCountedOn: null }, saved, twice, today)).toEqual({ stockCount: null, stockCountedOn: null });
    // Remédio novo, ou sem estoque acompanhado: nada a manter.
    expect(keepStockOnRuleChange({}, undefined, twice, today)).toEqual({});
    expect(keepStockOnRuleChange({}, med({ stockCount: null, stockCountedOn: null }), twice, today)).toEqual({});
  });

  it('remédio que já tinha acabado: mudar a regra não muda o dia em que acabou nem cria aviso', () => {
    // 3 contados em 01/10, um por dia: acabou em 04/10.
    const saved = med({ stockCount: 3, stockCountedOn: '2026-10-01' });
    const rule = { times: saved.times, startOn: saved.startOn, endOn: saved.endOn, frequency: 'daily' as const, weekdays: null, intervalDays: null };
    expect(sentence(saved)).toBe('Deve ter acabado em 04/10, pelas contas do app.');
    const changes = [
      // Só o horário; uma vez por semana; duas vezes por dia.
      { ...rule, times: ['07:00'] },
      { ...rule, frequency: 'weekdays' as const, weekdays: [1] },
      { ...rule, times: ['08:00', '20:00'] },
    ];
    for (const next of changes) {
      // A contagem passa a ser o que sobrava (nada), no dia em que acabou, e não hoje.
      const rebased = keepStockOnRuleChange({}, saved, next, today);
      expect(rebased).toEqual({ stockCount: 0, stockCountedOn: '2026-10-04' });
      const after = { ...saved, ...next, ...rebased };
      expect(stockStatus(after, today)).toMatchObject({ kind: 'out', ranOutOn: '2026-10-04' });
      expect(describeStock(stockStatus(after, today), today)).toBe('Deve ter acabado em 04/10, pelas contas do app.');
      expect(refillAlerts(after, today).map((a) => a.label)).toEqual(['Deve ter acabado']);
      expect(refillReminders([after], today)).toEqual([]);
    }
    // Sobra menor que uma dose: 3 contados, 2 por dose (acabou em 02/10, sobra 1); a dose passa a 1.
    const half = med({ stockCount: 3, stockCountedOn: '2026-10-01', doseUnits: 2 });
    expect(stockStatus(half, today)).toMatchObject({ kind: 'out', ranOutOn: '2026-10-02', estimate: { unitsLeft: 1 } });
    const rebased = keepStockOnRuleChange({ doseUnits: 1 }, half, rule, today);
    expect(rebased).toEqual({ doseUnits: 1, stockCount: 1, stockCountedOn: '2026-10-02' });
    // A sobra dava para a dose de 03/10: continua acabado, sem voltar a "acaba hoje".
    expect(stockStatus({ ...half, ...rebased }, today)).toMatchObject({ kind: 'out', ranOutOn: '2026-10-03' });
    expect(refillReminders([{ ...half, ...rebased }], today)).toEqual([]);
    // Contado zero hoje e, em seguida, o horário muda: segue contado hoje.
    expect(keepStockOnRuleChange({}, med({ stockCount: 0 }), changes[0], today)).toEqual({ stockCount: 0, stockCountedOn: today });
  });

  it('unidades: vírgula decimal, sem separador de milhar', () => {
    expect(formatUnits(30)).toBe('30');
    expect(formatUnits(12.5)).toBe('12,5');
    expect(formatUnits(1500)).toBe('1500');
    expect(formatUnits(9.6667)).toBe('9,67');
    expect(parseUnits('12,5')).toBe(12.5);
    expect(parseUnits('0')).toBe(0);
    expect(parseUnits('abc')).toBeNull();
  });
});

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
  refillLines,
  refillReminders,
  refillRows,
  restock,
  stockFormOf,
  stockStatus,
  type StockedMedication,
} from '../medicationStock';

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
    // 10 doses, 4 tomadas: faltam 6.
    const course = { totalDoses: 10, takenCount: 4 };
    expect(estimate(course)).toMatchObject({ unitsLeft: 30, runsOutOn: null, ends: 'treatment' });
    expect(estimate({ ...course, stockCount: 6 })).toMatchObject({ runsOutOn: null, ends: 'treatment' });
    expect(estimate({ ...course, stockCount: 3 })).toMatchObject({ runsOutOn: '2026-10-15', daysLeft: 3, ends: 'stock' });
    // Até hoje vale o horário, não as marcações: contado há 3 dias, três doses a menos.
    expect(estimate({ totalDoses: 20, takenCount: 15, stockCount: 10, stockCountedOn: '2026-10-09' })).toMatchObject({
      unitsLeft: 7,
      runsOutOn: null,
      ends: 'treatment',
    });
  });

  it('contado há muito tempo: acabou, e o que sobra nunca fica negativo', () => {
    expect(estimate({ stockCountedOn: '2026-01-01' })).toEqual({ unitsLeft: 0, runsOutOn: '2026-01-31', daysLeft: -254, ends: 'stock' });
    expect(estimate({ stockCountedOn: '2026-01-01', doseUnits: 4 })?.unitsLeft).toBe(2);
    // Contado zero: acabou no dia da contagem.
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
    expect(labels({ stockCount: 0 })).toEqual(['Acaba hoje']);
    expect(sentence({ stockCount: 3 })).toBe('Acaba em 3 dias (15/10), pelas contas do app.');
    expect(sentence({ stockCount: 1 })).toBe('Acaba amanhã, pelas contas do app.');
    expect(sentence({ stockCount: 0 })).toBe('Acaba hoje, pelas contas do app.');
    expect(refillBadge(med({ stockCount: 3 }), today)).toEqual({ about: 'stock', label: 'Acaba em 3 dias', tone: 'warning', days: 3 });
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
});

describe('o que a tela Hoje lista', () => {
  const meds = [
    med({ id: 'ok', name: 'Vitamina D' }),
    med({ id: 'baixo', name: 'Losartana', dosage: '50 mg', stockCount: 3 }),
    med({ id: 'acabou', name: 'Puran', personName: 'Beto', stockCount: 3, stockCountedOn: '2026-10-01' }),
    med({ id: 'receita', name: 'Insulina', personName: 'Rex', stockCount: null, stockCountedOn: null, prescriptionUntil: '2026-10-22' }),
    med({ id: 'os-dois', name: 'Anticoncepcional', stockCount: 1, prescriptionUntil: '2026-10-14' }),
    med({ id: 'encerrado', name: 'Antigo', stockCount: 0, active: false }),
  ];

  it('um remédio por linha, só os que pedem atenção, o mais urgente primeiro', () => {
    const rows = refillRows(meds, today);
    expect(rows.map((row) => [row.id, row.title, row.alerts.map((a) => a.label), row.itemName])).toEqual([
      ['acabou', 'Puran (Beto)', ['Deve ter acabado'], 'Puran'],
      ['os-dois', 'Anticoncepcional (Ana)', ['Acaba amanhã', 'Receita vence em 2 dias'], 'Anticoncepcional'],
      ['baixo', 'Losartana (Ana)', ['Acaba em 3 dias'], 'Losartana (50 mg)'],
      ['receita', 'Insulina (Rex)', ['Receita vence em 10 dias'], 'Insulina'],
    ]);
    // O primeiro selo de cada linha é o mais urgente: é o que dá a cor.
    expect(rows.map((row) => row.alerts[0].tone)).toEqual(['danger', 'warning', 'warning', 'warning']);
    expect(refillRows([med()], today)).toEqual([]);
  });

  it('as linhas do Nuke dizem o estado de cada um', () => {
    expect(refillLines(meds, today)).toEqual([
      'Puran (Beto) — deve ter acabado',
      'Anticoncepcional (Ana) — acaba amanhã, receita vence em 2 dias',
      'Losartana (Ana) — acaba em 3 dias',
      'Insulina (Rex) — receita vence em 10 dias',
    ]);
  });

  it('o item da lista da farmácia leva o nome e a dose', () => {
    expect(pharmacyItemName({ name: ' Losartana ', dosage: ' 50 mg ' })).toBe('Losartana (50 mg)');
    expect(pharmacyItemName({ name: 'Losartana', dosage: '  ' })).toBe('Losartana');
    expect(pharmacyItemName({ name: 'Losartana', dosage: null })).toBe('Losartana');
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
    expect(refillReminders([med({ stockCountedOn: '2026-01-01' })], today)).toEqual([]);
    expect(refillReminders([med({ endOn: '2026-10-20' })], today)).toEqual([]);
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

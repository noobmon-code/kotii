import { describe, expect, it } from '@jest/globals';

import { addDays } from '../dates';
import { pendingNextDoses } from '../health';
import { EVE_SUMMARY_TIME, eveSummary, HOUSE_REMINDER_LIMIT, planHouseReminders, type HouseReminderInput } from '../houseReminders';

// Sem o resumo de amanhã (os testes dele vêm mais abaixo): com ele desligado, o plano é o de sempre.
const all = { bills: true, documents: true, chores: true, appointments: true, vaccines: true, weather: true, eve: false };
const base: HouseReminderInput = { kinds: all, bills: [], documents: [], chores: [], today: '2026-09-27', nowTime: '08:00' };
const bill = { id: 'b1', name: 'Luz', amount: 230, next_due_on: '2026-10-05', active: true, autopay: false };
const doc = { id: 'd1', title: 'Passaporte — Ana', expires_on: '2026-10-20', remind_days: 15 };
const chore = { id: 'c1', title: 'Limpar filtro do ar', due_on: '2026-09-30', active: true, equipment_id: 'e1' };

describe('planHouseReminders', () => {
  it('avisa conta na véspera e no dia, às 9h (atraso não é marcado de antemão)', () => {
    const plan = planHouseReminders({ ...base, bills: [bill] });
    expect(plan.map((r) => [r.date, r.time, r.title, r.body])).toEqual([
      ['2026-10-04', '09:00', 'Conta vence amanhã', 'Luz — R$ 230,00'],
      ['2026-10-05', '09:00', 'Conta vence hoje', 'Luz — R$ 230,00'],
    ]);
  });

  it('não avisa débito automático nem conta desativada', () => {
    const bills = [
      { ...bill, id: 'auto', autopay: true },
      { ...bill, id: 'off', active: false },
    ];
    expect(planHouseReminders({ ...base, bills })).toEqual([]);
  });

  it('conta atrasada avisa no próximo horário, uma vez só', () => {
    const late = { ...bill, id: 'late', amount: null, next_due_on: '2026-09-20' };
    expect(planHouseReminders({ ...base, nowTime: '10:00', bills: [late] })).toEqual([
      expect.objectContaining({
        key: 'bills:late:2026-09-28',
        title: 'Conta atrasada',
        body: 'Luz: venceu em 20/09/2026.',
        overdue: 'late:2026-09-20',
      }),
    ]);
    // Depois que o aviso tocou, o app marca e ele não se repete.
    expect(planHouseReminders({ ...base, nowTime: '10:00', bills: [late], overdueWarned: ['late:2026-09-20'] })).toEqual([]);
  });

  it('documento: quando abre o prazo de renovar, uma semana antes e no dia em que vence', () => {
    const plan = planHouseReminders({ ...base, documents: [doc, { ...doc, id: 'sem', expires_on: null }] });
    expect(plan.map((r) => [r.date, r.title, r.body])).toEqual([
      ['2026-10-05', 'Hora de renovar', 'Passaporte — Ana vence em 15 dias (20/10/2026).'],
      ['2026-10-13', 'Hora de renovar', 'Passaporte — Ana vence em 7 dias (20/10/2026).'],
      ['2026-10-20', 'Documento vence hoje', 'Passaporte — Ana'],
    ]);
  });

  it('documento ligado já dentro do prazo ainda recebe um lembrete antes do dia', () => {
    const plan = planHouseReminders({ ...base, today: '2026-10-10', documents: [doc] });
    expect(plan.map((r) => [r.date, r.title])).toEqual([
      ['2026-10-13', 'Hora de renovar'],
      ['2026-10-20', 'Documento vence hoje'],
    ]);
  });

  it('documento com prazo de 0 ou 1 dia: sem aviso repetido nem "1 dias"', () => {
    const zero = planHouseReminders({ ...base, documents: [{ ...doc, remind_days: 0 }] });
    expect(zero.map((r) => [r.key, r.title])).toEqual([['documents:d1:2026-10-20', 'Documento vence hoje']]);
    const one = planHouseReminders({ ...base, documents: [{ ...doc, remind_days: 1 }] });
    expect(one.map((r) => r.body)).toEqual(['Passaporte — Ana vence amanhã (20/10/2026).', 'Passaporte — Ana']);
  });

  it('tarefa e manutenção no dia; hoje só se o horário ainda não passou', () => {
    const today = { ...chore, id: 'hoje', title: 'Lavar a louça', due_on: '2026-09-27', equipment_id: null };
    expect(planHouseReminders({ ...base, chores: [chore, today] }).map((r) => r.title)).toEqual([
      'Tarefa de hoje',
      'Manutenção de hoje',
    ]);
    expect(planHouseReminders({ ...base, nowTime: '09:30', chores: [today] })).toEqual([]);
  });

  it('só o que a pessoa escolheu, dentro de 30 dias e com limite', () => {
    const kinds = { bills: false, documents: false, chores: true, appointments: false, vaccines: false, weather: false, eve: false };
    expect(planHouseReminders({ ...base, kinds, bills: [bill], documents: [doc], chores: [chore] })).toHaveLength(1);
    expect(planHouseReminders({ ...base, chores: [{ ...chore, due_on: '2026-11-30' }] })).toEqual([]);
    const many = Array.from({ length: 40 }, (_, i) => ({ ...chore, id: `c${i}` }));
    expect(planHouseReminders({ ...base, chores: many })).toHaveLength(HOUSE_REMINDER_LIMIT);
    // Com os remédios ocupando o teto do iPhone, só o que sobra.
    expect(planHouseReminders({ ...base, chores: many, limit: 3 })).toHaveLength(3);
    expect(planHouseReminders({ ...base, chores: many, limit: -5 })).toEqual([]);
  });

  it('avisa consulta na véspera às 19h e 2 horas antes', () => {
    const appointment = { id: 'a1', title: 'Pediatra', person: 'Lia', date: '2026-10-02', time: '14:30', location: 'Clínica Sol', status: 'agendada' };
    const plan = planHouseReminders({ ...base, appointments: [appointment, { ...appointment, id: 'a2', status: 'cancelada' }] });
    expect(plan.map((r) => [r.key, r.date, r.time, r.title, r.body])).toEqual([
      ['appointments:a1:2026-10-01:19:00', '2026-10-01', '19:00', 'Consulta amanhã', 'Pediatra — Lia, às 14:30 (Clínica Sol).'],
      ['appointments:a1:2026-10-02:12:30', '2026-10-02', '12:30', 'Consulta daqui a 2 horas', 'Pediatra — Lia, às 14:30 (Clínica Sol).'],
    ]);
    // Consulta às 7h: só a véspera.
    expect(planHouseReminders({ ...base, appointments: [{ ...appointment, time: '07:00' }] })).toHaveLength(1);
  });

  it('avisa vacina uma semana antes e no dia; atrasada, uma vez', () => {
    const vaccine = { id: 'v1', name: 'Tríplice viral', dose: '2ª dose', person: 'Lia', next_dose_on: '2026-10-10' };
    expect(planHouseReminders({ ...base, vaccines: [vaccine] }).map((r) => [r.date, r.title, r.body])).toEqual([
      ['2026-10-03', 'Vacina na semana que vem', 'Lia: Tríplice viral (2ª dose) em 10/10/2026.'],
      ['2026-10-10', 'Dia de vacina', 'Lia: Tríplice viral (2ª dose).'],
    ]);
    const late = planHouseReminders({ ...base, vaccines: [{ ...vaccine, next_dose_on: '2026-09-01' }] });
    expect(late.map((r) => [r.date, r.title, r.overdue])).toEqual([['2026-09-27', 'Vacina atrasada', 'v1:2026-09-01']]);
    // Depois que o aviso tocou, não se repete.
    const warned = { ...base, vaccines: [{ ...vaccine, next_dose_on: '2026-09-01' }], overdueWarned: ['v1:2026-09-01'] };
    expect(planHouseReminders(warned)).toEqual([]);
    expect(planHouseReminders({ ...base, vaccines: [{ ...vaccine, next_dose_on: '2026-05-01' }] })).toEqual([]);
  });

  it('dica do clima na hora marcada de cada manhã; a de hoje só se a hora ainda não passou', () => {
    const weather = [
      { date: '2026-09-27', time: '07:00', title: 'Hoje é dia de lavar roupa', body: 'Sem chuva até o fim da tarde e umidade de 60%.' },
      { date: '2026-09-28', time: '07:00', title: 'Roupa no varal? Recolha antes das 15h', body: 'A chuva deve chegar por volta das 15h.' },
    ];
    expect(planHouseReminders({ ...base, nowTime: '06:30', weather }).map((r) => [r.key, r.date, r.time, r.title])).toEqual([
      ['weather:dia:2026-09-27:07:00', '2026-09-27', '07:00', 'Hoje é dia de lavar roupa'],
      ['weather:dia:2026-09-28:07:00', '2026-09-28', '07:00', 'Roupa no varal? Recolha antes das 15h'],
    ]);
    expect(planHouseReminders({ ...base, weather }).map((r) => r.date)).toEqual(['2026-09-28']);
    expect(planHouseReminders({ ...base, kinds: { ...all, weather: false }, weather })).toEqual([]);
  });
});

describe('eveSummary (resumo de amanhã)', () => {
  type Sources = Parameters<typeof eveSummary>[0];
  // 29/09/2026 é uma terça-feira.
  const day = '2026-09-29';
  const empty: Sources = { bills: [], documents: [], chores: [], appointments: [], vaccines: [], equipment: [] };
  const consulta = { id: 'a1', title: 'Pediatra', person: 'Bia', date: day, time: '09:00', location: 'Clínica Sol', status: 'agendada' };
  const luz = { id: 'b1', name: 'Luz', amount: 180, next_due_on: day, active: true, autopay: false };
  const vacina = { id: 'v1', name: 'Tríplice', dose: '2ª dose', person: 'Bia', next_dose_on: day };
  const lixo = { id: 'c1', title: 'Pôr o lixo para fora', due_on: day, active: true, equipment_id: null, recurrence: 'weekly' as const, interval_count: 1 };
  const filtro = { id: 'c2', title: 'Limpar o filtro', due_on: day, active: true, equipment_id: 'e1', recurrence: 'monthly' as const, interval_count: 3 };
  const cnh = { id: 'd1', title: 'CNH do Beto', expires_on: day, remind_days: 30 };
  const geladeira = { id: 'e2', name: 'Geladeira', warranty_until: day };
  const summary = (input: Partial<Sources>, on = day) => eveSummary({ ...empty, ...input }, on);

  it('um item só: o texto é o item, sem pontuação de lista', () => {
    const alone: [Partial<Sources>, string][] = [
      [{ appointments: [consulta] }, '9h Pediatra (Bia)'],
      [{ appointments: [{ ...consulta, time: '09:30' }] }, '9h30 Pediatra (Bia)'],
      [{ appointments: [{ ...consulta, time: '14:05', person: '' }] }, '14h05 Pediatra'],
      [{ bills: [luz] }, 'Luz (R$ 180,00)'],
      [{ bills: [{ ...luz, amount: null }] }, 'Luz'],
      [{ vaccines: [vacina] }, 'Vacina de Bia: Tríplice (2ª dose)'],
      [{ vaccines: [{ ...vacina, dose: null, person: '' }] }, 'Vacina: Tríplice'],
      [{ chores: [lixo] }, 'Pôr o lixo para fora'],
      [{ chores: [filtro] }, 'Manutenção: Limpar o filtro'],
      [{ documents: [cnh] }, 'Vence: CNH do Beto'],
      [{ equipment: [geladeira] }, 'Fim da garantia: Geladeira'],
    ];
    for (const [input, text] of alone) {
      expect(summary(input)).toMatchObject({ title: 'Amanhã, terça-feira', body: text, written: 1 });
    }
  });

  it('o título diz que dia da semana é amanhã', () => {
    // 27/09/2026 é um domingo.
    const titles = Array.from({ length: 7 }, (_, i) => {
      const on = addDays('2026-09-27', i);
      return summary({ bills: [{ ...luz, next_due_on: on }] }, on)?.title;
    });
    expect(titles).toEqual([
      'Amanhã, domingo',
      'Amanhã, segunda-feira',
      'Amanhã, terça-feira',
      'Amanhã, quarta-feira',
      'Amanhã, quinta-feira',
      'Amanhã, sexta-feira',
      'Amanhã, sábado',
    ]);
  });

  it('tudo junto: consultas pela hora, depois contas, vacinas, tarefas e manutenções, documentos e garantias', () => {
    const dentista = { ...consulta, id: 'a2', title: 'Dentista', person: 'Beto', time: '16:30' };
    const everything = summary({
      equipment: [geladeira],
      documents: [cnh],
      chores: [lixo, filtro],
      vaccines: [vacina],
      bills: [luz],
      appointments: [dentista, consulta],
    });
    expect(everything?.items.map((i) => i.text)).toEqual([
      '9h Pediatra (Bia)',
      '16h30 Dentista (Beto)',
      'Luz (R$ 180,00)',
      'Vacina de Bia: Tríplice (2ª dose)',
      'Manutenção: Limpar o filtro',
      'Pôr o lixo para fora',
      'Vence: CNH do Beto',
      'Fim da garantia: Geladeira',
    ]);
    expect(everything).toMatchObject({ body: '9h Pediatra (Bia) · 16h30 Dentista (Beto) · Luz (R$ 180,00) e mais 5', written: 3 });
  });

  it('até 4 itens vão escritos; com mais, os 3 primeiros e "e mais N"', () => {
    expect(summary({ bills: [luz], documents: [cnh] })?.body).toBe('Luz (R$ 180,00) · Vence: CNH do Beto');
    expect(summary({ appointments: [consulta], bills: [luz], documents: [cnh], equipment: [geladeira] })?.body).toBe(
      '9h Pediatra (Bia) · Luz (R$ 180,00) · Vence: CNH do Beto · Fim da garantia: Geladeira',
    );
    expect(summary({ appointments: [consulta], bills: [luz], vaccines: [vacina], documents: [cnh], equipment: [geladeira] })?.body).toBe(
      '9h Pediatra (Bia) · Luz (R$ 180,00) · Vacina de Bia: Tríplice (2ª dose) e mais 2',
    );
  });

  it('dia sem nada não tem resumo; o que é de outro dia não entra', () => {
    const full = { appointments: [consulta], bills: [luz], vaccines: [vacina], chores: [lixo, filtro], documents: [cnh], equipment: [geladeira] };
    expect(summary({})).toBeNull();
    expect(summary(full, '2026-09-28')).toBeNull();
    expect(summary(full, '2026-09-30')).toBeNull();
  });

  it('ficam de fora: tarefa de todo dia, débito automático, o que está desativado e consulta que não está agendada', () => {
    const daily = { ...lixo, id: 'c3', title: 'Lavar a louça', recurrence: 'daily' as const };
    const everyOtherDay = { ...lixo, id: 'c4', title: 'Regar as plantas', recurrence: 'daily' as const, interval_count: 2 };
    expect(summary({ chores: [daily] })).toBeNull();
    // A semanal e a de dia sim, dia não, que caem naquele dia, entram.
    expect(summary({ chores: [daily, lixo, everyOtherDay, { ...filtro, active: false }] })?.body).toBe('Pôr o lixo para fora · Regar as plantas');
    expect(summary({ bills: [{ ...luz, autopay: true }, { ...luz, id: 'b2', active: false }] })).toBeNull();
    expect(summary({ appointments: [{ ...consulta, status: 'cancelada' }, { ...consulta, id: 'a2', status: 'realizada' }] })).toBeNull();
    expect(
      summary({
        documents: [{ ...cnh, expires_on: null }],
        equipment: [{ ...geladeira, warranty_until: null }],
        vaccines: [{ ...vacina, next_dose_on: null }],
      }),
    ).toBeNull();
  });

  it('vacina já tomada não entra (a sincronização só passa as doses por tomar)', () => {
    const records = [
      { id: 'v1', person_id: 'p1', name: 'Tríplice', dose: '1ª dose', applied_on: '2026-03-01', next_dose_on: day },
      // A 2ª dose foi aplicada antes da data marcada: a próxima dose do registro anterior já foi.
      { id: 'v2', person_id: 'p1', name: 'Tríplice', dose: '2ª dose', applied_on: '2026-09-20', next_dose_on: null },
    ];
    const pending = (list: typeof records) =>
      pendingNextDoses(list).map((v) => ({ id: v.id, name: v.name, dose: v.dose, person: 'Bia', next_dose_on: v.next_dose_on }));
    expect(summary({ vaccines: pending(records.slice(0, 1)) })?.body).toBe('Vacina de Bia: Tríplice (1ª dose)');
    expect(summary({ vaccines: pending(records) })).toBeNull();
  });

  it('nunca passa de 180 caracteres: o item comprido é cortado com "…" e os curtos ficam inteiros', () => {
    const long = { ...consulta, title: 'Ortodontia'.repeat(30) };
    const text = `9h ${long.title} (Bia)`;
    const cut = summary({ appointments: [long], bills: [luz], documents: [cnh], equipment: [geladeira] });
    expect(cut?.body).toBe(`${text.slice(0, 111)}… · Luz (R$ 180,00) · Vence: CNH do Beto · Fim da garantia: Geladeira`);
    expect(cut?.body).toHaveLength(180);
    // Sozinho, usa a linha toda.
    expect(summary({ appointments: [long] })?.body).toBe(`${text.slice(0, 179)}…`);
    // Dois compridos dividem o espaço.
    const contract = { ...cnh, title: 'Contrato'.repeat(40) };
    expect(summary({ appointments: [long], documents: [contract] })?.body).toBe(
      `${text.slice(0, 87)}… · ${`Vence: ${contract.title}`.slice(0, 87)}…`,
    );
    // Com "e mais N", ele também conta no limite.
    const many = summary({
      appointments: [long, { ...long, id: 'a2', time: '10:00' }, { ...long, id: 'a3', time: '11:00' }],
      bills: [luz],
      documents: [cnh],
    });
    expect(many?.body).toHaveLength(180);
    expect(many?.body.split(' · ').map((part) => part.slice(0, 12))).toEqual(['9h Ortodonti', '10h Ortodont', '11h Ortodont']);
    expect(many?.body.endsWith('… e mais 2')).toBe(true);
  });

  it('o corte não parte um emoji ao meio', () => {
    const teeth = { ...consulta, person: '', title: `A${'🦷'.repeat(120)}` };
    expect(summary({ appointments: [teeth] })?.body).toBe(`9h A${'🦷'.repeat(87)}…`);
  });
});

describe('planHouseReminders: resumo de amanhã', () => {
  const none = { bills: false, documents: false, chores: false, appointments: false, vaccines: false, weather: false, eve: false };
  const onlyEve = { ...none, eve: true };
  const both = { ...none, appointments: true, eve: true };
  const weekly = (due_on: string) => ({
    id: `t-${due_on}`,
    title: 'Trocar a roupa de cama',
    due_on,
    active: true,
    equipment_id: null,
    recurrence: 'weekly' as const,
    interval_count: 1,
  });
  const appointment = { id: 'a1', title: 'Pediatra', person: 'Lia', date: '2026-10-02', time: '14:30', location: 'Clínica Sol', status: 'agendada' };
  const keys = (plan: ReturnType<typeof planHouseReminders>) => plan.map((r) => r.key);

  it('toca às 20h da véspera, nas próximas 7 noites, só nas que têm algo no dia seguinte', () => {
    // Uma tarefa por dia, de hoje (domingo, 27/09) a 06/10: a de hoje e as de depois de 04/10 não têm noite na janela.
    const chores = Array.from({ length: 10 }, (_, i) => weekly(addDays(base.today, i)));
    const plan = planHouseReminders({ ...base, kinds: onlyEve, chores });
    const weekdays = ['segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado', 'domingo'];
    expect(plan.map((r) => [r.key, r.kind, r.date, r.time, r.title, r.body])).toEqual(
      weekdays.map((weekday, i) => {
        const evening = addDays(base.today, i);
        return [`eve:amanha:${evening}:20:00`, 'eve', evening, EVE_SUMMARY_TIME, `Amanhã, ${weekday}`, 'Trocar a roupa de cama'];
      }),
    );
    // A última noite é a de daqui a 6 dias (03/10), sobre o dia 04/10.
    expect(plan[plan.length - 1].date).toBe('2026-10-03');
    // Noite sem nada no dia seguinte fica em silêncio.
    const some = planHouseReminders({ ...base, kinds: onlyEve, chores: [weekly('2026-09-30'), weekly('2026-10-02')] });
    expect(some.map((r) => [r.date, r.title])).toEqual([
      ['2026-09-29', 'Amanhã, quarta-feira'],
      ['2026-10-01', 'Amanhã, sexta-feira'],
    ]);
    expect(planHouseReminders({ ...base, kinds: onlyEve })).toEqual([]);
  });

  it('a noite de hoje só entra se ainda não deu 20h', () => {
    const chores = [weekly('2026-09-28'), weekly('2026-09-29')];
    const evenings = (nowTime: string) => planHouseReminders({ ...base, kinds: onlyEve, nowTime, chores }).map((r) => r.date);
    expect(evenings('19:59')).toEqual(['2026-09-27', '2026-09-28']);
    expect(evenings('20:00')).toEqual(['2026-09-28']);
    expect(evenings('23:10')).toEqual(['2026-09-28']);
  });

  it('com o resumo ligado, a consulta vai nele e o "Consulta amanhã" das 19h não toca junto', () => {
    const input = { ...base, appointments: [appointment] };
    expect(planHouseReminders({ ...input, kinds: both }).map((r) => [r.key, r.title, r.body])).toEqual([
      ['eve:amanha:2026-10-01:20:00', 'Amanhã, sexta-feira', '14h30 Pediatra (Lia)'],
      ['appointments:a1:2026-10-02:12:30', 'Consulta daqui a 2 horas', 'Pediatra — Lia, às 14:30 (Clínica Sol).'],
    ]);
    // Resumo desligado: os avisos da consulta são os de sempre.
    expect(keys(planHouseReminders({ ...input, kinds: { ...both, eve: false } }))).toEqual([
      'appointments:a1:2026-10-01:19:00',
      'appointments:a1:2026-10-02:12:30',
    ]);
    // Só o resumo ligado: a consulta aparece nele, sem os avisos de consulta.
    expect(keys(planHouseReminders({ ...input, kinds: onlyEve }))).toEqual(['eve:amanha:2026-10-01:20:00']);
  });

  it('consulta cuja véspera ainda não tem resumo (além das 7 noites) continua com o aviso das 19h', () => {
    const on = (date: string) => keys(planHouseReminders({ ...base, kinds: both, appointments: [{ ...appointment, date }] }));
    // Véspera daqui a 6 dias: a última noite com resumo.
    expect(on('2026-10-04')).toEqual(['eve:amanha:2026-10-03:20:00', 'appointments:a1:2026-10-04:12:30']);
    expect(on('2026-10-05')).toEqual(['appointments:a1:2026-10-04:19:00', 'appointments:a1:2026-10-05:12:30']);
    expect(on('2026-10-10')).toEqual(['appointments:a1:2026-10-09:19:00', 'appointments:a1:2026-10-10:12:30']);
  });

  it('consulta de amanhã, com a noite de hoje já passada: sem aviso à noite, com o resumo ou sem ele', () => {
    const tomorrow = { ...appointment, date: '2026-09-28' };
    const at = (nowTime: string, eve: boolean) => keys(planHouseReminders({ ...base, nowTime, kinds: { ...both, eve }, appointments: [tomorrow] }));
    expect(at('20:30', true)).toEqual(['appointments:a1:2026-09-28:12:30']);
    expect(at('20:30', false)).toEqual(['appointments:a1:2026-09-28:12:30']);
    // Entre as 19h e as 20h, o resumo ainda toca.
    expect(at('19:30', true)).toEqual(['eve:amanha:2026-09-27:20:00', 'appointments:a1:2026-09-28:12:30']);
    expect(at('19:30', false)).toEqual(['appointments:a1:2026-09-28:12:30']);
  });

  it('consulta que não coube escrita no resumo ("e mais N") fica com o aviso das 19h', () => {
    const five = ['08:00', '09:00', '10:00', '11:00', '15:00'].map((time, i) => ({ ...appointment, id: `a${i}`, time }));
    const night = planHouseReminders({ ...base, kinds: both, appointments: five }).filter((r) => r.date === '2026-10-01');
    expect(night.map((r) => [r.key, r.body])).toEqual([
      ['appointments:a3:2026-10-01:19:00', 'Pediatra — Lia, às 11:00 (Clínica Sol).'],
      ['appointments:a4:2026-10-01:19:00', 'Pediatra — Lia, às 15:00 (Clínica Sol).'],
      ['eve:amanha:2026-10-01:20:00', '8h Pediatra (Lia) · 9h Pediatra (Lia) · 10h Pediatra (Lia) e mais 2'],
    ]);
  });

  // Uma casa com um pouco de tudo na semana (hoje é domingo, 27/09, 8h) e uma conta mais adiante.
  const house: HouseReminderInput = {
    ...base,
    kinds: { ...all, eve: true },
    bills: [
      { id: 'luz', name: 'Luz', amount: 180, next_due_on: '2026-09-29', active: true, autopay: false },
      { id: 'agua', name: 'Água', amount: null, next_due_on: '2026-10-01', active: true, autopay: false },
      { id: 'net', name: 'Internet', amount: 99.9, next_due_on: '2026-10-15', active: true, autopay: false },
    ],
    chores: [weekly('2026-10-04')],
    appointments: [{ ...appointment, id: 'ped', date: '2026-09-30', location: null }],
    vaccines: [{ id: 'vac', name: 'Tríplice viral', dose: '2ª dose', person: 'Lia', next_dose_on: '2026-10-03' }],
    equipment: [],
  };
  // Os avisos próprios dos dias do resumo (até 04/10), sem o "Consulta amanhã".
  const week = [
    'bills:luz:2026-09-28',
    'bills:luz:2026-09-29',
    'bills:agua:2026-09-30',
    'appointments:ped:2026-09-30:12:30',
    'bills:agua:2026-10-01',
    'vaccines:vac:2026-10-03',
    'chores:t-2026-10-04:2026-10-04',
  ];
  const later = ['bills:net:2026-10-14', 'bills:net:2026-10-15'];

  it('desligado: nenhum resumo, e o resto do plano é o de sempre', () => {
    const off = planHouseReminders({ ...house, kinds: all });
    expect(keys(off)).toEqual([...week.slice(0, 2), 'appointments:ped:2026-09-29:19:00', ...week.slice(2), ...later]);
    // Ligado: os mesmos avisos, mais os resumos, menos o "Consulta amanhã" da noite que tem resumo.
    const on = planHouseReminders(house);
    expect(on.filter((r) => r.kind !== 'eve')).toEqual(off.filter((r) => r.key !== 'appointments:ped:2026-09-29:19:00'));
    expect(on.filter((r) => r.kind === 'eve').map((r) => [r.date, r.time, r.title, r.body])).toEqual([
      ['2026-09-28', '20:00', 'Amanhã, terça-feira', 'Luz (R$ 180,00)'],
      ['2026-09-29', '20:00', 'Amanhã, quarta-feira', '14h30 Pediatra (Lia)'],
      ['2026-09-30', '20:00', 'Amanhã, quinta-feira', 'Água'],
      ['2026-10-02', '20:00', 'Amanhã, sábado', 'Vacina de Lia: Tríplice viral (2ª dose)'],
      ['2026-10-03', '20:00', 'Amanhã, domingo', 'Trocar a roupa de cama'],
    ]);
  });

  it('teto curto (várias casas): o resumo sai primeiro, da noite mais distante, e nunca um aviso próprio daqueles dias', () => {
    const at = (limit: number) => keys(planHouseReminders({ ...house, limit }));
    const summaryOf = (evening: string) => `eve:amanha:${evening}:20:00`;
    // Com 8 vagas (o teto de cada casa para quem tem três), cabem os avisos
    // próprios da semana e o resumo que está no lugar do "Consulta amanhã".
    expect(at(8).sort()).toEqual([...week, summaryOf('2026-09-29')].sort());
    // Duas vagas a mais: os resumos das duas noites mais próximas. A conta de
    // mais adiante espera a janela andar.
    expect(at(10).sort()).toEqual([...week, summaryOf('2026-09-28'), summaryOf('2026-09-29'), summaryOf('2026-09-30')].sort());
    // Com folga, tudo: os 5 resumos e os avisos de mais adiante.
    expect(at(24)).toHaveLength(week.length + 5 + later.length);
    // Em qualquer teto: aviso próprio daqueles dias que cabia sem o resumo continua cabendo com ele.
    for (let limit = 0; limit <= 16; limit++) {
      const off = planHouseReminders({ ...house, kinds: all, limit }).filter((r) => r.date <= '2026-10-04');
      const expected = off.map((r) => (r.key === 'appointments:ped:2026-09-29:19:00' ? summaryOf('2026-09-29') : r.key));
      expect(at(limit)).toEqual(expect.arrayContaining(expected));
      expect(at(limit)).toHaveLength(Math.min(limit, week.length + 5 + later.length));
    }
  });

  it('o resumo que leva a consulta não sai pelo teto antes do "Consulta amanhã" que ele substitui', () => {
    // Três vagas: sem o resumo, os dois avisos da luz e o "Consulta amanhã".
    expect(keys(planHouseReminders({ ...house, kinds: all, limit: 3 }))).toEqual([
      'bills:luz:2026-09-28',
      'bills:luz:2026-09-29',
      'appointments:ped:2026-09-29:19:00',
    ]);
    // Com ele, o resumo da consulta fica no mesmo lugar; o da noite anterior
    // (só a conta de luz), embora toque antes, é o que sai.
    expect(keys(planHouseReminders({ ...house, limit: 3 }))).toEqual(['bills:luz:2026-09-28', 'bills:luz:2026-09-29', 'eve:amanha:2026-09-29:20:00']);
    // Ele toca às 20h, mas entra na fila às 19h, a hora do aviso que substitui: um
    // aviso das 19h30 daquela noite (2 horas antes de uma consulta das 21h30) não passa na frente.
    const late = { ...appointment, id: 'noite', date: '2026-10-01', time: '21:30' };
    const two = { ...base, kinds: both, appointments: [appointment, late], limit: 2 };
    expect(keys(planHouseReminders({ ...two, kinds: { ...both, eve: false } }))).toEqual(['appointments:noite:2026-09-30:19:00', 'appointments:a1:2026-10-01:19:00']);
    expect(keys(planHouseReminders(two))).toEqual(['eve:amanha:2026-09-30:20:00', 'eve:amanha:2026-10-01:20:00']);
  });

  it('entre as 19h e as 20h, o resumo desta noite com a consulta de amanhã também não sai pelo teto', () => {
    // Às 19h30 o "Consulta amanhã" já não toca (com o resumo ligado, nem chegou
    // a ser agendado): só o resumo das 20h avisa da consulta.
    const input = { ...house, nowTime: '19:30', appointments: [{ ...appointment, id: 'ped', date: '2026-09-28' }] };
    expect(planHouseReminders({ ...input, limit: 2 }).map((r) => [r.key, r.body])).toEqual([
      ['eve:amanha:2026-09-27:20:00', '14h30 Pediatra (Lia)'],
      ['bills:luz:2026-09-28', 'Luz — R$ 180,00'],
    ]);
    // Com os avisos de consulta desligados, ele é um extra como os outros: sai antes da conta.
    expect(keys(planHouseReminders({ ...input, kinds: { ...input.kinds, appointments: false }, limit: 2 }))).toEqual([
      'bills:luz:2026-09-28',
      'bills:luz:2026-09-29',
    ]);
  });
});

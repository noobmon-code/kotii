import { describe, expect, it } from '@jest/globals';

import type { Appointment, Chore, Equipment, HomeDocument, PantryItem, Receipt, Supply } from '@/lib/types';
import { choreStatus } from '../chores';
import { addDays } from '../dates';
import { documentStatus } from '../documents';
import { warrantyStatus } from '../equipment';
import { billStatus } from '../finance';
import { toTimestamp, vaccineStatus } from '../health';
import type { RefillAlert } from '../medicationStock';
import { expiryStatus } from '../pantry';
import { supplyForecast } from '../supplies';
import {
  allClearMessage,
  appointmentPlacement,
  arrangeToday,
  billPlacement,
  budgetPlacement,
  chorePlacement,
  documentPlacement,
  dosePlacement,
  eventPlacement,
  expiryPlacement,
  marketListShortcut,
  nothingPending,
  PANTRY_SHOWN,
  refillPlacement,
  seeAllLabel,
  supplyPlacement,
  TODAY_KIND_ORDER,
  todayAttention,
  todayItems,
  todaySummary,
  vaccinePlacement,
  warrantyPlacement,
  type Placed,
  type Placement,
  type TodayInput,
  type TodayItem,
  type TodayKind,
} from '../today';

const today = '2026-11-10';
const day = (offset: number) => addDays(today, offset);

const LATE: Placement = { urgency: 'atrasado' };
const TODAY: Placement = { urgency: 'hoje' };
const soon = (days: number | null): Placement => ({ urgency: 'breve', days });

describe('o lugar de cada coisa, pelo estado que o assunto já calcula', () => {
  it('dose: atrasada quando o horário passou (o mesmo "atrasada" da linha), senão de hoje', () => {
    expect(dosePlacement('08:00', '09:30')).toEqual(LATE);
    expect(dosePlacement('09:30', '09:30')).toEqual(TODAY);
    expect(dosePlacement('20:00', '09:30')).toEqual(TODAY);
  });

  it('tarefa: atrasada, de hoje; a de amanhã não entra', () => {
    expect(chorePlacement(choreStatus(day(-3), today))).toEqual(LATE);
    expect(chorePlacement(choreStatus(today, today))).toEqual(TODAY);
    expect(chorePlacement(choreStatus(day(1), today))).toBeNull();
  });

  it('despensa: vencido em Agora, "vence hoje" também; "vence logo" em Em breve, pelos dias; o resto não entra', () => {
    expect(expiryPlacement(expiryStatus(day(-2), today))).toEqual(LATE);
    expect(expiryPlacement(expiryStatus(today, today))).toEqual(TODAY);
    expect(expiryPlacement(expiryStatus(day(1), today))).toEqual(soon(1));
    expect(expiryPlacement(expiryStatus(day(3), today))).toEqual(soon(3));
    expect(expiryPlacement(expiryStatus(day(10), today))).toBeNull();
    expect(expiryPlacement(expiryStatus(null, today))).toBeNull();
  });

  it('gás, água e ração: passou da data é atrasado, acaba hoje é de hoje, acabando vem logo; em dia não entra', () => {
    const supply = (refilledDaysAgo: number) => ({ kind: 'gas', typical_days: 30, refills: [{ refilled_on: day(-refilledDaysAgo) }] });
    // 30 dias de duração: a janela de aviso é de 5 (round(15%)), e passou da data até mais uma duração.
    expect(supplyPlacement(supplyForecast(supply(40), today))).toEqual(LATE);
    expect(supplyPlacement(supplyForecast(supply(30), today))).toEqual(TODAY);
    expect(supplyPlacement(supplyForecast(supply(27), today))).toEqual(soon(3));
    expect(supplyPlacement(supplyForecast(supply(10), today))).toBeNull();
    // Parado (muito depois da data): sem destaque, como na tela.
    expect(supplyPlacement(supplyForecast(supply(100), today))).toBeNull();
  });

  it('remédio: acabou ou venceu (vermelho) é atrasado; acaba ou vence hoje é de hoje; o resto pelo aviso mais perto', () => {
    const alert = (tone: RefillAlert['tone'], days: number, about: RefillAlert['about'] = 'stock'): RefillAlert => ({ about, label: '', tone, days });
    expect(refillPlacement([alert('danger', 0)])).toEqual(LATE);
    expect(refillPlacement([alert('danger', -4), alert('warning', 5, 'prescription')])).toEqual(LATE);
    expect(refillPlacement([alert('warning', 0)])).toEqual(TODAY);
    expect(refillPlacement([alert('warning', 6), alert('warning', 2, 'prescription')])).toEqual(soon(2));
    // O parado há mais de duas semanas não pede atenção: só ele, nada.
    expect(refillPlacement([alert('neutral', -20)])).toBeNull();
    expect(refillPlacement([alert('neutral', -20), alert('warning', 4, 'prescription')])).toEqual(soon(4));
    expect(refillPlacement([])).toBeNull();
  });

  it('documento: vencido é atrasado, vence hoje é de hoje, a renovar vem logo; válido não entra', () => {
    expect(documentPlacement(documentStatus(day(-1), 30, today))).toEqual(LATE);
    expect(documentPlacement(documentStatus(today, 30, today))).toEqual(TODAY);
    expect(documentPlacement(documentStatus(day(20), 30, today))).toEqual(soon(20));
    expect(documentPlacement(documentStatus(day(40), 30, today))).toBeNull();
    expect(documentPlacement(documentStatus(null, 30, today))).toBeNull();
  });

  it('garantia: acaba hoje é de hoje, nos últimos 30 dias vem logo; a vigente e a vencida não entram', () => {
    expect(warrantyPlacement(warrantyStatus(today, today))).toEqual(TODAY);
    expect(warrantyPlacement(warrantyStatus(day(28), today))).toEqual(soon(28));
    expect(warrantyPlacement(warrantyStatus(day(31), today))).toBeNull();
    expect(warrantyPlacement(warrantyStatus(day(-1), today))).toBeNull();
    expect(warrantyPlacement(warrantyStatus(null, today))).toBeNull();
  });

  it('consulta: a de hoje (também a que já passou da hora) é de hoje, a de amanhã vem logo, depois disso não entra', () => {
    expect(appointmentPlacement(toTimestamp(today, '08:00'), today)).toEqual(TODAY);
    expect(appointmentPlacement(toTimestamp(today, '23:30'), today)).toEqual(TODAY);
    expect(appointmentPlacement(toTimestamp(day(1), '00:15'), today)).toEqual(soon(1));
    expect(appointmentPlacement(toTimestamp(day(2), '09:00'), today)).toBeNull();
  });

  it('vacina: só a dose atrasada (a próxima fica em Saúde)', () => {
    expect(vaccinePlacement(vaccineStatus(day(-5), today))).toEqual(LATE);
    expect(vaccinePlacement(vaccineStatus(today, today))).toBeNull();
    expect(vaccinePlacement(vaccineStatus(day(10), today))).toBeNull();
  });

  it('compromisso: o de hoje é de hoje, o de amanhã vem logo', () => {
    expect(eventPlacement(today, today)).toEqual(TODAY);
    expect(eventPlacement(day(1), today)).toEqual(soon(1));
  });

  it('conta e orçamento (com Finanças ligada)', () => {
    expect(billPlacement(billStatus(day(-2), today))).toEqual(LATE);
    expect(billPlacement(billStatus(today, today))).toEqual(TODAY);
    expect(billPlacement(billStatus(day(3), today))).toEqual(soon(3));
    expect(budgetPlacement('estourou')).toEqual(TODAY);
    expect(budgetPlacement('perto')).toEqual(soon(null));
    expect(budgetPlacement('ok')).toBeNull();
  });
});

describe('os dois blocos', () => {
  const item = (kind: TodayKind, placement: Placement, name: string) => ({ kind, placement, name });
  const names = (items: { name: string }[]) => items.map((i) => i.name);

  it('Agora: o atrasado antes do que é de hoje; no mesmo nível, os assuntos na ordem; dentro do assunto, a ordem de chegada', () => {
    const { agora, emBreve } = arrangeToday([
      item('pantry', TODAY, 'leite vence hoje'),
      item('chore', TODAY, 'lixo hoje'),
      item('dose', TODAY, 'remédio 20h'),
      item('chore', LATE, 'banheiro atrasado'),
      item('dose', LATE, 'remédio 8h'),
      item('dose', LATE, 'remédio 9h'),
      item('document', LATE, 'RG vencido'),
    ]);
    expect(names(agora.items)).toEqual(['remédio 8h', 'remédio 9h', 'banheiro atrasado', 'RG vencido', 'remédio 20h', 'lixo hoje', 'leite vence hoje']);
    expect(emBreve.items).toEqual([]);
  });

  it('Em breve: o mais perto antes, o sem data por último; no empate, a ordem dos assuntos (uma garantia do mês não passa à frente)', () => {
    const { agora, emBreve } = arrangeToday([
      item('receipt', soon(null), 'nota para revisar'),
      item('warranty', soon(28), 'garantia em 28 dias'),
      item('pantry', soon(1), 'leite amanhã'),
      item('document', soon(10), 'CNH em 10 dias'),
      item('appointment', soon(1), 'consulta amanhã'),
      item('plan', soon(null), 'treino para revisar'),
      item('pendingReceipt', soon(null), 'nota da Sefaz'),
    ]);
    expect(agora.items).toEqual([]);
    expect(names(emBreve.items)).toEqual([
      'consulta amanhã',
      'leite amanhã',
      'CNH em 10 dias',
      'garantia em 28 dias',
      'nota da Sefaz',
      'nota para revisar',
      'treino para revisar',
    ]);
  });

  it('a despensa mostra até PANTRY_SHOWN nos dois blocos juntos, "Agora" primeiro, e o "Ver todos" conta os dois', () => {
    const many = Array.from({ length: PANTRY_SHOWN + 3 }, (_, i) => item('pantry', LATE, `vencido ${i}`));
    const { agora, emBreve } = arrangeToday([...many, item('chore', LATE, 'tarefa'), item('pantry', soon(2), 'vence logo')]);
    expect(agora.items).toHaveLength(PANTRY_SHOWN + 1);
    expect(names(agora.items)).toContain('tarefa');
    expect(names(agora.items)).not.toContain(`vencido ${PANTRY_SHOWN}`);
    // "Agora" usou as seis: o que vence logo fica no "Ver todos", no bloco da última linha mostrada.
    expect(emBreve.items).toEqual([]);
    expect(agora.cut).toEqual([{ kind: 'pantry', total: PANTRY_SHOWN + 4 }]);
    expect(seeAllLabel(agora.cut[0])).toBe(`Ver todos da despensa (${PANTRY_SHOWN + 4})`);
    expect(emBreve.cut).toEqual([]);
  });

  it('com poucos vencidos, "Em breve" fica com o resto das seis, e o "Ver todos" vai com ele', () => {
    const late = Array.from({ length: 2 }, (_, i) => item('pantry', LATE, `vencido ${i}`));
    const later = Array.from({ length: PANTRY_SHOWN }, (_, i) => item('pantry', soon(i + 1), `vence em ${i + 1}`));
    const { agora, emBreve } = arrangeToday([...later, ...late, item('document', soon(3), 'CNH')]);
    expect(names(agora.items)).toEqual(['vencido 0', 'vencido 1']);
    expect(names(emBreve.items)).toEqual(['vence em 1', 'vence em 2', 'vence em 3', 'CNH', 'vence em 4']);
    expect(agora.cut).toEqual([]);
    expect(emBreve.cut).toEqual([{ kind: 'pantry', total: PANTRY_SHOWN + 2 }]);
  });

  it('até seis, nos dois blocos, nada de "Ver todos"', () => {
    const { agora, emBreve } = arrangeToday([
      ...Array.from({ length: 3 }, (_, i) => item('pantry', LATE, `vencido ${i}`)),
      ...Array.from({ length: PANTRY_SHOWN - 3 }, (_, i) => item('pantry', soon(1), `amanhã ${i}`)),
    ]);
    expect(agora.items).toHaveLength(3);
    expect(emBreve.items).toHaveLength(PANTRY_SHOWN - 3);
    expect([...agora.cut, ...emBreve.cut]).toEqual([]);
  });

  it('cada assunto tem o seu lugar na ordem', () => {
    const kinds: TodayKind[] = [
      'dose',
      'refill',
      'appointment',
      'vaccine',
      'workout',
      'event',
      'chore',
      'bill',
      'budget',
      'pantry',
      'supply',
      'document',
      'warranty',
      'pendingReceipt',
      'receipt',
      'plan',
    ];
    expect([...TODAY_KIND_ORDER].sort()).toEqual([...kinds].sort());
    // O remédio vem antes de tudo; a nota e o plano para revisar, por último.
    expect(TODAY_KIND_ORDER[0]).toBe('dose');
    expect(TODAY_KIND_ORDER.slice(-3)).toEqual(['pendingReceipt', 'receipt', 'plan']);
  });
});

describe('a frase do topo e o "Tudo em dia"', () => {
  it('conta tudo dos dois blocos, menos compromissos e aniversários', () => {
    const items: Placed[] = [
      { kind: 'dose', placement: { urgency: 'hoje' } },
      { kind: 'event', placement: { urgency: 'hoje' } },
      { kind: 'event', placement: { urgency: 'breve', days: 1 } },
      { kind: 'receipt', placement: { urgency: 'breve', days: null } },
    ];
    expect(todayAttention(items)).toBe(2);
    expect(todayAttention([{ kind: 'event', placement: { urgency: 'hoje' } }])).toBe(0);
  });

  it('"Tudo em dia" só depois de tudo carregado e sem nada que conte', () => {
    expect(nothingPending(true, 0)).toBe(true);
    expect(nothingPending(false, 0)).toBe(false);
    expect(nothingPending(true, 1)).toBe(false);
    expect(todaySummary(true, 0)).toBe('Tudo em dia por aqui.');
    expect(todaySummary(false, 0)).toBe('Veja o que tem para hoje.');
    expect(todaySummary(false, 1)).toBe('1 coisa pede sua atenção.');
    expect(todaySummary(true, 3)).toBe('3 coisas pedem sua atenção.');
  });

  it('o cartão só fala de conta com Finanças ligada', () => {
    expect(allClearMessage(false)).toBe('Nenhum remédio, consulta, tarefa, validade ou documento pedindo atenção agora.');
    expect(allClearMessage(true)).toBe('Nenhum remédio, consulta, tarefa, conta, validade ou documento pedindo atenção agora.');
  });
});

describe('todayItems: as coisas da casa nos blocos', () => {
  const empty: TodayInput = {
    today,
    nowTime: '12:00',
    doses: [],
    refills: [],
    appointments: [],
    overdueAppointments: [],
    vaccines: [],
    workouts: [],
    planDrafts: [],
    events: [],
    chores: [],
    bills: [],
    budgets: [],
    pantry: [],
    supplies: [],
    documents: [],
    equipment: [],
    pendingReceipts: [],
    drafts: [],
  };
  const chore = (id: string, due_on: string): Chore => ({
    id,
    title: id,
    notes: null,
    recurrence: 'weekly',
    interval_count: 1,
    due_on,
    assigned_to: null,
    active: true,
    equipment_id: null,
    kid_id: null,
    points: 0,
  });
  const pantry = (id: string, expires_on: string | null): PantryItem => ({
    id,
    product_id: null,
    name: id,
    category: 'laticinios',
    quantity: 1,
    unit: 'un',
    purchased_on: day(-5),
    expires_on,
    expiry_source: 'manual',
    consumed_at: null,
  });
  const document = (id: string, expires_on: string): HomeDocument => ({
    id,
    person_id: null,
    kind: 'cnh',
    title: id,
    number: null,
    issued_on: null,
    expires_on,
    remind_days: 30,
    notes: null,
    file_paths: [],
    created_at: day(-400),
  });
  const appliance = (id: string, warranty_until: string | null): Equipment => ({
    id,
    name: id,
    category: 'eletrodomestico',
    brand: null,
    model: null,
    serial_number: null,
    location: null,
    purchased_on: null,
    price: null,
    store: null,
    warranty_until,
    notes: null,
    file_paths: [],
    created_at: day(-300),
  });
  const gas: Supply = {
    id: 'gas',
    name: 'Gás',
    kind: 'gas',
    typical_days: 30,
    notes: null,
    created_at: day(-100),
    refills: [{ id: 'r1', refilled_on: day(-40) }],
  };
  const appointment = (id: string, date: string, time: string): Appointment =>
    ({ id, title: id, starts_at: toTimestamp(date, time), status: 'agendada', person_id: 'p1', professional: null }) as unknown as Appointment;
  /** "assunto:id" de cada linha, bloco por bloco. */
  const where = (items: TodayItem[]) => {
    const id = (i: TodayItem): string => {
      switch (i.kind) {
        case 'chore':
          return i.data.chore.id;
        case 'pantry':
        case 'warranty':
          return i.data.item.id;
        case 'document':
          return i.data.document.id;
        case 'supply':
          return i.data.supply.id;
        case 'appointment':
          return i.data.appointment.id;
        case 'receipt':
          return i.data.id;
        default:
          return i.kind;
      }
    };
    const { agora, emBreve } = arrangeToday(items);
    return { agora: agora.items.map((i) => `${i.kind}:${id(i)}`), emBreve: emBreve.items.map((i) => `${i.kind}:${id(i)}`) };
  };

  it('cada coisa no bloco do estado dela, e o que o estado deixa de fora não entra', () => {
    const items = todayItems({
      ...empty,
      chores: [chore('lixo', today), chore('banheiro', day(-2)), chore('janelas', day(1))],
      pantry: [pantry('iogurte', day(-1)), pantry('leite', day(1)), pantry('arroz', day(60)), pantry('sal', null)],
      documents: [document('cnh', day(12)), document('rg', day(300))],
      equipment: [appliance('geladeira', day(20)), appliance('fogão', day(400))],
      supplies: [gas],
      appointments: [appointment('pediatra', today, '15:00'), appointment('dentista', day(1), '09:00'), appointment('oculista', day(9), '09:00')],
      overdueAppointments: [appointment('cardiologista', day(-3), '10:00')],
      drafts: [{ id: 'nota1', store: null } as unknown as Receipt],
    });
    expect(where(items)).toEqual({
      agora: [
        'appointment:cardiologista',
        'chore:banheiro',
        'pantry:iogurte',
        'supply:gas',
        'appointment:pediatra',
        'chore:lixo',
      ],
      emBreve: ['appointment:dentista', 'pantry:leite', 'document:cnh', 'warranty:geladeira', 'receipt:nota1'],
    });
    // A conta do topo é a mesma das linhas (nenhum compromisso aqui).
    expect(todayAttention(items)).toBe(11);
  });

  it('o treino já feito hoje sai; o de hoje por fazer é de hoje', () => {
    const plan = { id: 'w1' } as never;
    const session = { name: 'Treino A', weekdays: [], exercises: [] };
    const items = todayItems({ ...empty, workouts: [{ plan, session, done: true }, { plan, session: { ...session, name: 'Treino B' }, done: false }] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'workout', placement: TODAY });
  });

  it('sem nada pedindo atenção, nada nos blocos', () => {
    const items = todayItems({ ...empty, chores: [chore('janelas', day(3))], pantry: [pantry('arroz', day(60))] });
    expect(items).toEqual([]);
    expect(todayAttention(items)).toBe(0);
  });
});

describe('o atalho "Lista de mercado"', () => {
  const list = (id: string, kind: string, created_at: string, archived_at: string | null = null) => ({ id, kind, created_at, archived_at });

  it('com internet, quem diz é o servidor (a guardada pode ter sido arquivada em outro aparelho)', () => {
    expect(marketListShortcut(true, [list('a', 'mercado', '2026-11-01T10:00:00Z')])).toEqual({ kind: 'ask' });
    expect(marketListShortcut(true, undefined)).toEqual({ kind: 'ask' });
  });

  it('sem internet, a lista de mercado aberta mais nova que o aparelho guardou', () => {
    const lists = [
      list('farmacia', 'farmacia', '2026-11-09T10:00:00Z'),
      list('arquivada', 'mercado', '2026-11-08T10:00:00Z', '2026-11-08T20:00:00Z'),
      list('velha', 'mercado', '2026-10-01T10:00:00Z'),
      list('nova', 'mercado', '2026-11-05T10:00:00Z'),
    ];
    expect(marketListShortcut(false, lists)).toEqual({ kind: 'open', id: 'nova' });
  });

  it('sem internet e sem nenhuma guardada, não tem o que abrir', () => {
    expect(marketListShortcut(false, [list('farmacia', 'farmacia', '2026-11-09T10:00:00Z')])).toEqual({ kind: 'offline' });
    expect(marketListShortcut(false, undefined)).toEqual({ kind: 'offline' });
  });
});

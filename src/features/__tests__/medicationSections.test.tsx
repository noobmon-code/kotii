import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { addDays, todayISO } from '@/domain/dates';
import { refillRows, stockFormOf, type RefillRow } from '@/domain/medicationStock';
import { toSchedules } from '@/data/home';
import { MedicationList, MedicationRefills, useRefills } from '@/features/health/MedicationSections';
import { MedicationStockSection } from '@/features/health/MedicationStockSection';
import type { Medication, MedicationDose } from '@/lib/types';

// As seções de remédios de verdade (telas Hoje e Saúde), com as buscas trocadas por respostas prontas: o que se
// confere aqui é que as doses de hoje já marcadas chegam à conta do estoque, e o que a linha faz com a lista da farmácia.

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockQueries: { medications?: Medication[]; doses?: MedicationDose[]; dosesAsked: string[]; lists: unknown[] } = { dosesAsked: [], lists: [] };
const mockAdd = jest.fn();

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/supabase', () => ({ supabase: {}, unwrap: (r: { data: unknown }) => r.data, errorMessage: (error: unknown) => String(error) }));
jest.mock('@/data/home', () => ({
  ...jest.requireActual<typeof import('@/data/home')>('@/data/home'),
  useMedications: () => ({ data: mockQueries.medications }),
  useDoses: (date: string) => {
    mockQueries.dosesAsked.push(date);
    return { data: mockQueries.doses };
  },
  useToggleDose: () => ({ mutate: jest.fn() }),
  useRestockMedication: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('@/data/market', () => ({
  useShoppingLists: () => ({ data: mockQueries.lists }),
  useAddToPharmacyList: () => ({ mutateAsync: mockAdd }),
}));
jest.mock('@/ui/dialogs', () => ({ notify: jest.fn() }));
jest.mock('@/lib/reminders', () => ({ REMINDER_PLACE: 'neste celular', remindersSupported: false }));
jest.mock('@/lib/medicationBox', () => ({ lastBoxUnits: async () => null, rememberBoxUnits: jest.fn() }));
// Os desenhos animados (reanimated) e o fundo não entram no que se confere aqui.
jest.mock('@/ui/art', () => ({ Mascot: () => null, Spot: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));

const today = todayISO();

const medication = (patch: Partial<Medication> = {}): Medication => ({
  id: 'm1',
  person_id: null,
  person_name: 'Ana',
  name: 'Losartana',
  dosage: null,
  times: ['08:00'],
  start_on: addDays(today, -200),
  end_on: null,
  notes: null,
  active: true,
  frequency: 'daily',
  weekdays: null,
  interval_days: null,
  total_doses: null,
  taken_count: 0,
  stock_count: 3,
  stock_counted_on: today,
  dose_units: 1,
  stock_warn_days: 7,
  prescription_until: null,
  ...patch,
});

/**
 * Amoxicilina, 20 doses: começou há 3 dias com três por dia (9 marcadas) e hoje passou a duas por dia, com 10
 * comprimidos contados hoje. Sobram 9 doses depois das duas de hoje: dá para o tratamento todo.
 */
const course = (tickedToday: number) =>
  medication({
    name: 'Amoxicilina',
    times: ['08:00', '20:00'],
    start_on: addDays(today, -3),
    total_doses: 20,
    taken_count: 9 + tickedToday,
    stock_count: 10,
  });
const ticks = (count: number): MedicationDose[] =>
  ['08:00', '20:00'].slice(0, count).map((time) => ({ id: time, medication_id: 'm1', scheduled_on: today, scheduled_time: time, taken_at: `${today}T12:00:00Z` }));

let renderer: ReactTestRenderer | undefined;

type Rendered = ReturnType<ReactTestRenderer['toJSON']> | string;
const texts = (node: Rendered): string[] =>
  node == null ? [] : typeof node === 'string' ? [node] : Array.isArray(node) ? node.flatMap(texts) : (node.children ?? []).flatMap(texts);

async function mount(element: React.ReactElement) {
  await act(async () => {
    renderer = create(element);
  });
  return texts(renderer!.toJSON());
}

beforeEach(() => {
  Object.assign(mockQueries, { medications: undefined, doses: undefined, dosesAsked: [], lists: [] });
  mockAdd.mockReset();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

describe('as doses de hoje já marcadas chegam à conta do estoque', () => {
  let seen: ReturnType<typeof useRefills> | undefined;
  /** Entrega o que o hook devolve a cada desenho. */
  function Probe({ onRefills }: { onRefills: (refills: ReturnType<typeof useRefills>) => void }) {
    const refills = useRefills(today);
    useEffect(() => onRefills(refills));
    return null;
  }
  const probe = () => (
    <Probe
      onRefills={(refills) => {
        seen = refills;
      }}
    />
  );

  it('telas Hoje e Saúde (useRefills): a mesma resposta com nenhuma, uma ou as duas doses de hoje marcadas', async () => {
    for (const ticked of [0, 1, 2]) {
      mockQueries.medications = [course(ticked)];
      mockQueries.doses = ticks(ticked);
      await mount(probe());
      expect(seen).toMatchObject({ rows: [], attention: [] });
      expect(seen?.badges.size).toBe(0);
      await act(async () => renderer?.unmount());
    }
    // As marcações pedidas são as do dia que a tela mostra.
    expect(new Set(mockQueries.dosesAsked)).toEqual(new Set([today]));
  });

  it('enquanto as marcações de hoje não carregam, vale a conta de antes; carregadas, a linha sai', async () => {
    mockQueries.medications = [course(0)];
    await mount(probe());
    expect(seen?.attention.map((row) => [row.title, row.alerts[0].label])).toEqual([['Amoxicilina (Ana)', 'Acaba em 5 dias']]);
    mockQueries.doses = [];
    await act(async () => renderer?.update(probe()));
    expect(seen?.rows).toEqual([]);
  });

  it('lista de remédios da aba Cuidados: o selo é o mesmo das outras telas', async () => {
    // Nenhuma dose de hoje marcada, e as marcações carregadas: sem selo, como na tela Hoje.
    const list = () => <MedicationList medications={[course(0)]} personId={null} />;
    mockQueries.doses = [];
    expect((await mount(list())).join('\n')).not.toContain('Acaba');
    // Sem elas, a conta de antes.
    mockQueries.doses = undefined;
    await act(async () => renderer?.update(list()));
    expect(texts(renderer!.toJSON())).toContain('Acaba em 5 dias');
  });

  it('tela do remédio ("Estoque e receita"): a frase do estoque é a mesma das outras telas', async () => {
    const form = stockFormOf(toSchedules([course(0)], today, [])[0], today);
    const section = () => (
      <MedicationStockSection medication={course(0)} form={form} initial={form} today={today} onChange={jest.fn()} onRestocked={jest.fn()} />
    );
    mockQueries.doses = [];
    expect(await mount(section())).toContain('Dá para o tratamento todo, pelas contas do app.');
    // Sem as marcações de hoje, a conta de antes.
    mockQueries.doses = undefined;
    await act(async () => renderer?.update(section()));
    expect(texts(renderer!.toJSON()).join(' ')).toContain('Acaba em 5 dias');
  });
});

describe('"Na lista da farmácia"', () => {
  const pharmacy = (...names: string[]) => [
    { id: 'l1', name: 'Farmácia', kind: 'farmacia', items: names.map((name) => ({ name, product_id: null, checked_at: null })) },
  ];
  const rows = (medications: Medication[]): RefillRow[] => refillRows(toSchedules(medications, today, []), today);
  const ana = medication({ id: 'a' });
  const beto = medication({ id: 'b', person_name: 'Beto', stock_count: 30 });
  const offer = 'Pôr na lista da farmácia';
  const listed = 'Na lista da farmácia';

  it('o item pendente com o nome do remédio: a linha diz que já está na lista', async () => {
    mockQueries.lists = pharmacy('losartana');
    const seen = await mount(<MedicationRefills rows={rows([ana])} />);
    expect(seen).toContain(listed);
    expect(seen).not.toContain(offer);
  });

  it('o item foi posto com o nome de quem toma e o tratamento da outra pessoa terminou: segue na lista, sem oferecer de novo', async () => {
    mockQueries.lists = pharmacy('Losartana — Ana');
    const seen = await mount(<MedicationRefills rows={rows([ana, { ...beto, active: false }])} />);
    expect(seen).toContain(listed);
    expect(seen).not.toContain(offer);
  });

  it('duas pessoas no mesmo remédio e um item só com o nome: não diz de quem é, e a linha segue oferecendo', async () => {
    mockQueries.lists = pharmacy('Losartana');
    const seen = await mount(<MedicationRefills rows={rows([ana, beto])} />);
    expect(seen).toContain(offer);
    expect(seen).not.toContain(listed);
  });

  it('"Pôr na lista da farmácia" manda o item e o mesmo item com o nome de quem toma, para o banco não repetir nenhum dos dois', async () => {
    mockAdd.mockImplementation(async () => ({ id: 'l1', name: 'Farmácia', added: true }));
    const tap = async (medications: Medication[]) => {
      mockAdd.mockClear();
      await mount(<MedicationRefills rows={rows(medications)} />);
      const offers = renderer!.root.findAll((node) => node.props.title === offer && typeof node.props.onPress === 'function');
      await act(async () => offers[0].props.onPress());
      return mockAdd.mock.calls.map(([item]) => item);
    };
    expect(await tap([ana])).toEqual([
      { name: 'Losartana', altName: 'Losartana — Ana', category: 'medicamentos', productId: null, quantity: 1, unit: 'un' },
    ]);
    // Duas pessoas no mesmo remédio: o item já é o com o nome (e o só com o nome não vale por ele).
    await act(async () => renderer?.unmount());
    expect(await tap([ana, beto])).toEqual([
      { name: 'Losartana — Ana', altName: 'Losartana — Ana', category: 'medicamentos', productId: null, quantity: 1, unit: 'un' },
    ]);
  });

  it('item já comprado (riscado), ou de uma lista que não é de farmácia: não conta', async () => {
    mockQueries.lists = [
      { id: 'l1', name: 'Farmácia', kind: 'farmacia', items: [{ name: 'Losartana', product_id: null, checked_at: '2026-10-01T12:00:00Z' }] },
      { id: 'l2', name: 'Mercado', kind: 'mercado', items: [{ name: 'Losartana', product_id: null, checked_at: null }] },
    ];
    const seen = await mount(<MedicationRefills rows={rows([ana])} />);
    expect(seen).toContain(offer);
    expect(seen).not.toContain(listed);
  });
});

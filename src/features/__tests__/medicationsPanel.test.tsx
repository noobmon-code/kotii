import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { router } from 'expo-router';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { addDays, todayISO } from '@/domain/dates';
import { MedicationsPanel } from '@/features/health/MedicationsPanel';
import { StaleNotice } from '@/features/health/StaleNotice';
import type { Medication } from '@/lib/types';
import { Badge, Button, Chip, ErrorNotice, ListRow, Loading, Section } from '@/ui/primitives';

// Saúde → Remédios de verdade (as seções de remédios inteiras), com as buscas trocadas por respostas prontas: as
// doses de hoje, os remédios acabando e os em uso, com "Novo remédio" no alto; a pessoa escolhida (?pessoa=, a mesma
// de Cuidados e Planos) filtra as três seções e o remédio novo nasce dela.

interface Query {
  data: unknown;
  isError: boolean;
  error: unknown;
  refetch: jest.Mock;
}

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockQueries: { people: Query; medications: Query } = {} as never;
const mockLists: { data: unknown[] } = { data: [] };
const mockAdd = jest.fn<(item: unknown) => Promise<unknown>>();

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/supabase', () => ({ supabase: {}, unwrap: (r: { data: unknown }) => r.data, errorMessage: (error: unknown) => String(error) }));
jest.mock('@/data/health', () => ({ usePeople: () => mockQueries.people }));
jest.mock('@/data/home', () => ({
  ...jest.requireActual<typeof import('@/data/home')>('@/data/home'),
  useMedications: () => mockQueries.medications,
  // Nenhuma dose de hoje marcada, e as marcações carregadas.
  useDoses: () => ({ data: [] }),
  useToggleDose: () => ({ mutate: jest.fn() }),
}));
jest.mock('@/data/market', () => ({
  useShoppingLists: () => mockLists,
  useAddToPharmacyList: () => ({ mutateAsync: mockAdd }),
}));
jest.mock('@/ui/dialogs', () => ({ notify: jest.fn() }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));

const today = todayISO();

const loaded = (data: unknown): Query => ({ data, isError: false, error: null, refetch: jest.fn() });
const failed = (): Query => ({ ...loaded(undefined), isError: true, error: new Error('sem rede') });
const stale = (data: unknown): Query => ({ ...loaded(data), isError: true, error: new Error('sem rede') });

const person = (id: string, name: string) => ({
  id,
  name,
  kind: 'pessoa',
  birth_date: null,
  species: null,
  blood_type: null,
  allergies: null,
  conditions: null,
  health_plan: null,
  health_plan_number: null,
  notes: null,
  member_user_id: null,
});

const medication = (patch: Partial<Medication>): Medication => ({
  id: 'm',
  person_id: null,
  person_name: '',
  name: '',
  dosage: null,
  times: ['23:59'],
  start_on: addDays(today, -30),
  end_on: null,
  notes: null,
  active: true,
  frequency: 'daily',
  weekdays: null,
  interval_days: null,
  total_doses: null,
  taken_count: 0,
  stock_count: null,
  stock_counted_on: null,
  dose_units: 1,
  stock_warn_days: 7,
  prescription_until: null,
  ...patch,
});

// A losartana da Ana está acabando (3 comprimidos, um por dia); a vitamina do Beto não tem estoque acompanhado; a
// dipirona é de um remédio antigo, que só guarda o nome de quem toma.
const losartana = medication({ id: 'los', person_id: 'ana', person_name: 'Ana', name: 'Losartana', stock_count: 3, stock_counted_on: today });
const vitamina = medication({ id: 'vit', person_id: 'beto', person_name: 'Beto', name: 'Vitamina D', times: ['23:58'] });
const dipirona = medication({ id: 'dip', person_id: null, person_name: 'Ana', name: 'Dipirona', times: ['23:57'] });

let renderer: ReactTestRenderer | undefined;

function open(personId: string | null) {
  act(() => {
    renderer = create(<MedicationsPanel personId={personId} onPersonChange={jest.fn()} />);
  });
}

const has = (component: Parameters<ReactTestRenderer['root']['findAllByType']>[0]) => renderer!.root.findAllByType(component).length > 0;
const chips = () => renderer!.root.findAllByType(Chip).map((chip) => chip.props.label);
const sections = () => renderer!.root.findAllByType(Section).map((section) => section.props.title);
/** Os títulos das linhas de cada seção. */
const rowsOf = (title: string) =>
  renderer!.root
    .findAllByType(Section)
    .find((section) => section.props.title === title)
    ?.findAllByType(ListRow)
    .map((row) => (typeof row.props.title === 'string' ? row.props.title : null)) ?? [];
const newMedication = () => renderer!.root.findAllByType(Button).find((button) => button.props.title === 'Novo remédio')!;

beforeEach(() => {
  jest.mocked(router.push).mockClear();
  mockLists.data = [];
  mockAdd.mockReset();
  Object.assign(mockQueries, {
    people: loaded([person('ana', 'Ana'), person('beto', 'Beto')]),
    medications: loaded([losartana, vitamina, dipirona]),
  });
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

describe('Saúde → Remédios', () => {
  it('em "Todos": as doses de hoje, os acabando e os em uso da casa toda, com "Novo remédio" no alto', () => {
    open(null);
    expect(chips()).toEqual(['Todos', 'Ana', 'Beto']);
    expect(sections()).toEqual(['Remédios de hoje', 'Remédios e receitas acabando', 'Em uso']);
    expect(rowsOf('Remédios de hoje')).toEqual(['23:57 · Dipirona', '23:58 · Vitamina D', '23:59 · Losartana']);
    expect(rowsOf('Remédios e receitas acabando')).toEqual(['Losartana (Ana)']);
    expect(rowsOf('Em uso')).toEqual(['Losartana', 'Vitamina D', 'Dipirona']);
    // O botão de criar é um só, o do alto (a seção da lista não tem mais o "+ Remédio").
    const create = renderer!.root.findAllByType(Button).filter((button) => /rem[eé]dio/i.test(button.props.title));
    expect(create.map((button) => button.props.title)).toEqual(['Novo remédio']);
    act(() => newMedication().props.onPress());
    expect(router.push).toHaveBeenCalledWith({ pathname: '/remedio/[id]', params: { id: 'novo', pessoa: '' } });
  });

  it('com uma pessoa escolhida, as três seções são só dela, e o remédio novo já nasce dela', () => {
    open('ana');
    expect(renderer!.root.findAllByType(Chip).find((chip) => chip.props.selected)?.props.label).toBe('Ana');
    // A dipirona antiga só guarda o nome: fica de fora, como ficava na lista dos Cuidados.
    expect(rowsOf('Remédios de hoje')).toEqual(['23:59 · Losartana']);
    expect(rowsOf('Remédios e receitas acabando')).toEqual(['Losartana (Ana)']);
    expect(rowsOf('Em uso')).toEqual(['Losartana']);
    act(() => newMedication().props.onPress());
    expect(router.push).toHaveBeenCalledWith({ pathname: '/remedio/[id]', params: { id: 'novo', pessoa: 'ana' } });
  });

  it('a pessoa sem remédio: nada para hoje, nada acabando, e o aviso de nenhum em uso', () => {
    mockQueries.medications = loaded([losartana, dipirona]);
    open('beto');
    expect(sections()).toEqual(['Em uso']);
    expect(rowsOf('Em uso')).toEqual([]);
  });

  it('a ficha escolhida que não existe mais vale "Todos"', () => {
    open('sumiu');
    expect(renderer!.root.findAllByType(Chip).find((chip) => chip.props.selected)?.props.label).toBe('Todos');
    expect(rowsOf('Em uso')).toEqual(['Losartana', 'Vitamina D', 'Dipirona']);
  });

  it('com uma pessoa só não há o que escolher: nem os selos, nem o filtro', () => {
    mockQueries.people = loaded([person('ana', 'Ana')]);
    open('ana');
    expect(chips()).toEqual([]);
    expect(rowsOf('Em uso')).toEqual(['Losartana', 'Vitamina D', 'Dipirona']);
    act(() => newMedication().props.onPress());
    expect(router.push).toHaveBeenCalledWith({ pathname: '/remedio/[id]', params: { id: 'novo', pessoa: '' } });
  });
});

describe('Saúde → Remédios: o item da farmácia com a pessoa escolhida', () => {
  // A Ana e o Beto tomam losartana; a da Ana está acabando, a do Beto não tem estoque acompanhado. O item da farmácia
  // diz de quem é (as linhas são contadas com todos os remédios da casa), também com a Ana escolhida, quando o remédio
  // do Beto está fora da tela: o mesmo item de "Todos".
  const losartanaBeto = medication({ id: 'los-beto', person_id: 'beto', person_name: 'Beto', name: 'Losartana', times: ['23:56'] });
  const pharmacy = (...names: string[]) => [
    { id: 'l1', name: 'Farmácia', kind: 'farmacia', items: names.map((name) => ({ name, product_id: null, checked_at: null })) },
  ];
  const refillSection = () => renderer!.root.findAllByType(Section).find((section) => section.props.title === 'Remédios e receitas acabando')!;
  const offers = () =>
    refillSection().findAll((node) => node.props.title === 'Pôr na lista da farmácia' && typeof node.props.onPress === 'function');
  const listed = () => refillSection().findAllByType(Badge).some((badge) => badge.props.label === 'Na lista da farmácia');

  beforeEach(() => {
    mockQueries.medications = loaded([losartana, losartanaBeto]);
  });

  const choices: [string, string | null][] = [
    ['em "Todos"', null],
    ['com a Ana escolhida', 'ana'],
  ];

  it.each(choices)('%s: o item só com o nome, pendente, não vale pela caixa da Ana, e o toque manda o item com o nome dela', async (_, chosen) => {
    mockLists.data = pharmacy('Losartana');
    mockAdd.mockImplementation(async () => ({ id: 'l1', name: 'Farmácia', added: true }));
    open(chosen);
    expect(rowsOf('Remédios e receitas acabando')).toEqual(['Losartana (Ana)']);
    expect(listed()).toBe(false);
    expect(offers()).toHaveLength(1);
    await act(async () => offers()[0].props.onPress());
    expect(mockAdd.mock.calls.map(([item]) => item)).toEqual([
      { name: 'Losartana — Ana', altName: 'Losartana — Ana', category: 'medicamentos', productId: null, quantity: 1, unit: 'un' },
    ]);
  });

  it.each(choices)('%s: o item com o nome da Ana, pendente, põe a linha "Na lista da farmácia"', (_, chosen) => {
    mockLists.data = pharmacy('Losartana — Ana');
    open(chosen);
    expect(listed()).toBe(true);
    expect(offers()).toHaveLength(0);
  });
});

describe('Saúde → Remédios: carregando e com falha', () => {
  it('espera os remédios e as fichas', () => {
    mockQueries.people = loaded(undefined);
    open(null);
    expect(has(Loading)).toBe(true);
  });

  it('sem os remédios e com erro: o erro inteiro, e "Tentar de novo" refaz as duas buscas', () => {
    mockQueries.medications = failed();
    open(null);
    expect(has(ErrorNotice)).toBe(true);
    act(() => renderer!.root.findByType(ErrorNotice).props.onRetry());
    expect(mockQueries.medications.refetch).toHaveBeenCalledTimes(1);
    expect(mockQueries.people.refetch).toHaveBeenCalledTimes(1);
  });

  it('a atualização que falha com os remédios na tela deixa o que já estava, com o aviso acima', () => {
    mockQueries.medications = stale([losartana]);
    open(null);
    expect(has(ErrorNotice)).toBe(false);
    expect(has(StaleNotice)).toBe(true);
    expect(rowsOf('Em uso')).toEqual(['Losartana']);
    act(() => renderer!.root.findByType(StaleNotice).props.onRetry());
    expect(mockQueries.medications.refetch).toHaveBeenCalledTimes(1);
    expect(mockQueries.people.refetch).not.toHaveBeenCalled();
  });
});

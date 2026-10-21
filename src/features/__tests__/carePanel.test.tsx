import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { CarePanel } from '@/features/health/CarePanel';
import { StaleNotice } from '@/features/health/StaleNotice';
import { Button, ErrorNotice, Loading } from '@/ui/primitives';

// O painel de verdade, com as buscas trocadas por respostas prontas. O que se confere aqui: a busca de "quem tem
// resultados de exame" (a casa toda) só segura o painel em "Todos", que é onde ela decide alguma coisa; e uma
// atualização que falha com o dado já carregado não tira o painel da frente.

interface Query {
  data: unknown;
  isError: boolean;
  error: unknown;
  refetch: jest.Mock;
}

type Name = 'people' | 'appointments' | 'vaccines' | 'exams' | 'owners' | 'medications';
// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockQueries: Record<Name, Query> = {} as never;

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/data/health', () => ({
  usePeople: () => mockQueries.people,
  useAppointments: () => mockQueries.appointments,
  useVaccines: () => mockQueries.vaccines,
  useExams: () => mockQueries.exams,
  useExamResultOwners: () => mockQueries.owners,
}));
jest.mock('@/data/home', () => ({ useMedications: () => mockQueries.medications }));
// A lista de remédios tem as buscas dela (doses do dia), e os desenhos não entram no que se confere aqui.
jest.mock('@/features/health/MedicationSections', () => ({ MedicationList: () => null }));
// O ícone carrega a fonte depois de montado, fora do act: aqui ele não desenha nada.
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));

const loaded = (data: unknown): Query => ({ data, isError: false, error: null, refetch: jest.fn() });
/** Ainda buscando: sem dados e sem erro. */
const pending = (): Query => loaded(undefined);
/** Nunca carregou e a busca falhou. */
const failed = (): Query => ({ ...loaded(undefined), isError: true, error: new Error('sem rede') });
/** Já tinha carregado, e a atualização em segundo plano falhou: o dado continua lá. */
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
const exam = (id: string, personId: string) => ({
  id,
  person_id: personId,
  title: 'Hemograma',
  status: 'realizado',
  exam_date: '2026-09-05',
  requested_by: null,
  lab: null,
  notes: null,
  file_paths: [],
  results: [{ name: 'Glicose', value: '92', unit: 'mg/dL', reference: null, flag: null }],
  created_at: '2026-09-05T10:00:00Z',
});

let renderer: ReactTestRenderer;
function open(personId: string | null) {
  act(() => {
    renderer = create(<CarePanel personId={personId} onPersonChange={jest.fn()} />);
  });
}
const has = (component: Parameters<ReactTestRenderer['root']['findAllByType']>[0]) => renderer.root.findAllByType(component).length > 0;
const buttons = () => renderer.root.findAllByType(Button).map((button) => button.props.title);

beforeEach(() => {
  Object.assign(mockQueries, {
    people: loaded([person('ana', 'Ana'), person('beto', 'Beto')]),
    appointments: loaded([]),
    vaccines: loaded([]),
    exams: loaded([exam('e1', 'ana')]),
    owners: loaded(['ana']),
    medications: loaded([]),
  });
});

describe('painel de cuidados: a busca de quem tem resultados de exame', () => {
  it('com uma pessoa escolhida, a falha dela não tira o painel da frente: a entrada da evolução é sempre a da pessoa', () => {
    mockQueries.owners = failed();
    open('ana');
    expect(has(ErrorNotice)).toBe(false);
    expect(has(Loading)).toBe(false);
    expect(buttons()).toContain('Evolução e resumo para a consulta');
  });

  it('com uma pessoa escolhida, o painel também não espera por ela', () => {
    mockQueries.owners = pending();
    open('beto');
    expect(has(Loading)).toBe(false);
    expect(has(ErrorNotice)).toBe(false);
    // O Beto não tem resultados: a entrada é a do resumo.
    expect(buttons()).toContain('Resumo para a consulta');
  });

  it('em "Todos" ela decide para onde vai a entrada: a falha aparece, com como tentar de novo', () => {
    mockQueries.owners = failed();
    open(null);
    expect(has(ErrorNotice)).toBe(true);
    act(() => renderer.root.findByType(ErrorNotice).props.onRetry());
    for (const name of ['people', 'appointments', 'vaccines', 'exams', 'owners', 'medications'] as Name[]) {
      expect([name, mockQueries[name].refetch.mock.calls.length]).toEqual([name, 1]);
    }
  });

  it('em "Todos", enquanto ela não chega, o painel espera', () => {
    mockQueries.owners = pending();
    open(null);
    expect(has(Loading)).toBe(true);
  });

  it('em "Todos", com uma pessoa só com resultados, a entrada vai direto para ela', () => {
    open(null);
    expect(has(ErrorNotice)).toBe(false);
    expect(buttons()).toContain('Evolução e resumo para a consulta');
  });

  it('a pessoa escolhida não existe mais (ficha apagada): vale como "Todos", e a busca volta a contar', () => {
    mockQueries.owners = failed();
    open('sumiu');
    expect(has(ErrorNotice)).toBe(true);
  });

  it('as outras buscas continuam segurando o painel com uma pessoa escolhida', () => {
    mockQueries.vaccines = failed();
    open('ana');
    expect(has(ErrorNotice)).toBe(true);
  });
});

describe('painel de cuidados: a atualização que falha com o dado já carregado', () => {
  const retried = () => (['people', 'appointments', 'vaccines', 'exams', 'owners', 'medications'] as Name[]).filter((name) => mockQueries[name].refetch.mock.calls.length > 0);

  it('em "Todos", a de quem tem resultados não esconde o painel: ele fica, com o aviso e a entrada de antes', () => {
    mockQueries.owners = stale(['ana']);
    open(null);
    expect(has(ErrorNotice)).toBe(false);
    expect(has(Loading)).toBe(false);
    expect(has(StaleNotice)).toBe(true);
    expect(buttons()).toContain('Evolução e resumo para a consulta');
    // "Tentar de novo" refaz só a busca que falhou.
    act(() => renderer.root.findByType(StaleNotice).props.onRetry());
    expect(retried()).toEqual(['owners']);
  });

  it('a de qualquer outra busca também não: o painel fica com o que tinha, e o aviso diz que não atualizou', () => {
    mockQueries.vaccines = stale([]);
    mockQueries.exams = stale([exam('e1', 'ana')]);
    open('ana');
    expect(has(ErrorNotice)).toBe(false);
    expect(has(StaleNotice)).toBe(true);
    act(() => renderer.root.findByType(StaleNotice).props.onRetry());
    expect(retried()).toEqual(['vaccines', 'exams']);
  });

  it('com uma pessoa escolhida, a de quem tem resultados nem aparece no aviso: ali ela não decide nada', () => {
    mockQueries.owners = stale(['ana']);
    open('ana');
    expect(has(ErrorNotice)).toBe(false);
    expect(has(StaleNotice)).toBe(false);
  });

  it('uma busca sem dado nenhum e com erro continua mostrando o erro inteiro, mesmo com outra só desatualizada', () => {
    mockQueries.vaccines = stale([]);
    mockQueries.exams = failed();
    open('ana');
    expect(has(ErrorNotice)).toBe(true);
    expect(has(StaleNotice)).toBe(false);
  });

  it('sem falha nenhuma, não há aviso', () => {
    open(null);
    expect(has(StaleNotice)).toBe(false);
  });
});

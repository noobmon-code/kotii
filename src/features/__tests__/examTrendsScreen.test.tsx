import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { router } from 'expo-router';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import ExamTrendsScreen from '@/app/exames/[pessoa]';
import type { ExamResult } from '@/domain/health';
import type { Exam } from '@/lib/types';

// A tela da evolução de verdade, com as buscas trocadas por respostas prontas: o que se confere aqui é o que ela
// faz quando uma busca falha (com e sem dados já carregados) e com o exame que ficou fora da evolução, que as
// regras de domain/ não enxergam.

interface Query {
  data: unknown;
  isError: boolean;
  error: unknown;
  refetch: jest.Mock;
}

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockQueries: Record<'people' | 'exams' | 'medications', Query> = {} as never;

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ pessoa: 'ana' }),
}));
jest.mock('@/data/health', () => ({ usePeople: () => mockQueries.people, usePersonExams: () => mockQueries.exams }));
jest.mock('@/data/home', () => ({ useMedications: () => mockQueries.medications }));
// Os desenhos animados (reanimated), o fundo, o gráfico (SVG) e a tela do resumo não entram no que se confere aqui.
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@/features/health/TrendChart', () => ({ TrendChart: () => null }));
jest.mock('@/features/health/VisitSummaryModal', () => ({ VisitSummaryModal: () => null }));

const loaded = (data: unknown): Query => ({ data, isError: false, error: null, refetch: jest.fn() });
/** Já tinha carregado, e a atualização em segundo plano falhou: os dados de antes continuam lá. */
const stale = (data: unknown): Query => ({ ...loaded(data), isError: true, error: new Error('sem rede') });
/** Nunca carregou e a busca falhou. */
const failed = (): Query => stale(undefined);

const result = (name: string, value: string, unit: string | null = null): ExamResult => ({ name, value, unit, reference: null, flag: null });
const exam = (id: string, exam_date: string, results: ExamResult[], partial: Partial<Exam> = {}): Exam => ({
  id,
  person_id: 'ana',
  title: 'Hemograma',
  status: 'realizado',
  exam_date,
  requested_by: null,
  lab: null,
  notes: null,
  file_paths: [],
  results,
  created_at: `${exam_date}T10:00:00Z`,
  ...partial,
});

const NOTICE = 'Não foi possível atualizar. Mostrando o que já estava carregado.';
const RETRY = 'Tentar de novo';

let renderer: ReactTestRenderer | undefined;

const textOf = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map(textOf).join(''));

/** Abre a tela e devolve tudo o que ela escreve. */
async function mount() {
  await act(async () => {
    renderer = create(<ExamTrendsScreen />);
  });
  return textOf(renderer!.root);
}

/** Toca no que tem esse texto (o botão, ou a linha de uma lista). */
async function press(label: string) {
  const [target] = renderer!.root.findAll((node) => typeof node.props.onPress === 'function' && textOf(node).includes(label));
  await act(async () => {
    target.props.onPress();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(mockQueries, {
    people: loaded([{ id: 'ana', name: 'Ana', kind: 'pessoa', birth_date: null, allergies: null, conditions: null, species: null }]),
    exams: loaded([exam('e1', '2020-03-01', [result('Hemoglobina', '13', 'g/dL')])]),
    medications: loaded([]),
  });
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

describe('uma busca que falhou com os dados já carregados', () => {
  it('tudo carregado: a evolução aparece, sem aviso', async () => {
    const page = await mount();
    expect(page).toContain('Só um resultado');
    expect(page).toContain('13 g/dL · 01/03/2020');
    expect(page).not.toContain(NOTICE);
    expect(page).not.toContain(RETRY);
  });

  it.each(['people', 'exams', 'medications'] as const)('a atualização de %s falhou: a tela continua com o que tinha e avisa', async (key) => {
    mockQueries[key] = stale(mockQueries[key].data);
    const page = await mount();
    expect(page).toContain(NOTICE);
    // Nada sai do lugar: a pessoa, o resumo e as listas continuam ali.
    expect(page).toContain('Resumo para a consulta');
    expect(page).toContain('13 g/dL · 01/03/2020');
    // E o erro da busca não toma a tela.
    expect(page).not.toContain('sem rede');
  });

  it('"Tentar de novo" refaz só as buscas que falharam', async () => {
    mockQueries.exams = stale(mockQueries.exams.data);
    mockQueries.medications = stale(mockQueries.medications.data);
    await mount();
    await press(RETRY);
    expect(mockQueries.exams.refetch).toHaveBeenCalledTimes(1);
    expect(mockQueries.medications.refetch).toHaveBeenCalledTimes(1);
    expect(mockQueries.people.refetch).not.toHaveBeenCalled();
  });

  it('sem dados e com erro, a tela é só o erro, e tentar de novo refaz as três buscas', async () => {
    mockQueries.exams = failed();
    const page = await mount();
    expect(page).toContain('sem rede');
    expect(page).not.toContain(NOTICE);
    expect(page).not.toContain('Resumo para a consulta');
    await press(RETRY);
    for (const query of Object.values(mockQueries)) expect(query.refetch).toHaveBeenCalledTimes(1);
  });
});

describe('exame com resultados que não está como realizado', () => {
  it('fica numa seção à parte, e a linha abre o exame', async () => {
    mockQueries.exams = loaded([
      exam('e1', '2020-03-01', [result('Hemoglobina', '13', 'g/dL')]),
      exam('e2', '2020-09-01', [result('Hemoglobina', '10', 'g/dL')], { title: 'Hemograma de setembro', status: 'agendado' }),
    ]);
    const page = await mount();
    expect(page).toContain('Exames que não estão como realizados');
    expect(page).toContain('Têm resultados anotados, mas estão como pedido ou agendado');
    expect(page).toContain('Hemograma de setembroAgendado');
    // O resultado dele não entrou na evolução.
    expect(page).not.toContain('10 g/dL');
    await press('Hemograma de setembro');
    expect(jest.mocked(router.push).mock.calls).toEqual([[{ pathname: '/exame/[id]', params: { id: 'e2' } }]]);
  });

  it('sem nenhum assim, a seção não aparece', async () => {
    expect(await mount()).not.toContain('Exames que não estão como realizados');
  });
});

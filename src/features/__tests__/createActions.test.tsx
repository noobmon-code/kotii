import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { router } from 'expo-router';
import type { ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { AgendaPanel } from '@/features/AgendaPanel';
import { ChoresPanel } from '@/features/ChoresPanel';
import { DocumentsSection } from '@/features/DocumentsSection';
import { EquipmentPanel } from '@/features/EquipmentPanel';
import { BillsPanel } from '@/features/finance/BillsPanel';
import { FinanceSummaryPanel } from '@/features/finance/FinanceSummaryPanel';
import { MedicationsPanel } from '@/features/health/MedicationsPanel';
import { PlansPanel } from '@/features/health/PlansPanel';
import { Button, Section, Tile } from '@/ui/primitives';

// Um jeito só de criar: a ação principal de cada parte é um botão primário no alto (o primeiro botão da parte),
// o "+" no título fica só para seções secundárias dentro de uma tela, e azulejo só na tela Hoje. Aqui, as partes
// com uma ação principal só, com as buscas trocadas por respostas vazias (cada painel tem os testes dele). As que
// criam mais de uma coisa do mesmo peso (Saúde → Resumo e Cuidados: "Adicionar", que pergunta o quê) estão em
// healthScreen.test e carePanel.test; Compras → Listas em marketShortcuts.test, Despensa em despensa.test, Notas
// em marketShortcuts.test.

const mockLoaded = (data: unknown) => ({ data, isPending: false, isError: false, isSuccess: true, error: null, refetch: jest.fn() });
const mockMutation = () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false });

jest.mock('expo-router', () => ({ router: { push: jest.fn(), setParams: jest.fn(), navigate: jest.fn() } }));
jest.mock('@/data/home', () => ({
  useChores: () => mockLoaded([]),
  useChoreRotations: () => mockLoaded([]),
  useCompleteChore: () => mockMutation(),
  useMedications: () => mockLoaded([]),
}));
jest.mock('@/data/health', () => ({
  usePeople: () => mockLoaded([]),
  useAppointments: () => mockLoaded([]),
  useVaccines: () => mockLoaded([]),
  useWorkoutPlans: () => mockLoaded([]),
  useDietPlans: () => mockLoaded([]),
}));
jest.mock('@/data/house', () => ({ useEquipmentList: () => mockLoaded([]), useDocuments: () => mockLoaded([]) }));
jest.mock('@/data/family', () => ({ useFamilyCalendar: () => ({ calendar: { events: [], days: [], people: [] }, refetch: jest.fn() }) }));
jest.mock('@/data/finance', () => ({
  useBills: () => mockLoaded([]),
  useBudgets: () => mockLoaded([]),
  useRecentBillPayments: () => mockLoaded([]),
  useSpending: () => mockLoaded([]),
  useSpendingReceipts: () => mockLoaded([]),
}));
jest.mock('@/data/providers', () => ({
  useServiceJobs: () => mockLoaded({ rows: [], missing: false }),
  useServiceProviders: () => mockLoaded({ rows: [], missing: false }),
}));
jest.mock('@/lib/auth', () => ({ useHousehold: () => ({ data: { members: [] } }) }));
jest.mock('@/lib/supabase', () => ({ errorMessage: (error: unknown) => String(error) }));
jest.mock('@/features/health/MedicationSections', () => ({
  MedicationList: () => null,
  MedicationRefills: () => null,
  MedicationsToday: () => null,
  useRefills: () => ({ rows: [] }),
}));
jest.mock('@/features/health/usePlanImport', () => ({ usePlanImport: () => ({ start: jest.fn(), element: null }) }));
jest.mock('@/features/finance/BudgetSection', () => ({ BudgetSection: () => null }));
jest.mock('@/features/finance/MarketMonthTotal', () => ({ MarketMonthTotal: () => null }));
jest.mock('@/features/finance/SplitSection', () => ({ SplitSection: () => null }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));

let renderer: ReactTestRenderer | undefined;

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
});

describe('a ação principal de cada parte é um botão primário no alto', () => {
  it.each<[string, string, ReactElement, unknown]>([
    ['Casa → Tarefas', 'Nova tarefa', <ChoresPanel key="tarefas" />, { pathname: '/tarefa/[id]', params: { id: 'nova' } }],
    ['Casa → Agenda', 'Novo compromisso', <AgendaPanel key="agenda" />, { pathname: '/compromisso/[id]', params: { id: 'novo', dia: expect.any(String) } }],
    ['Casa → Aparelhos', 'Novo aparelho', <EquipmentPanel key="aparelhos" />, { pathname: '/aparelho/[id]', params: { id: 'novo' } }],
    ['Casa → Documentos', 'Novo documento', <DocumentsSection key="documentos" />, { pathname: '/documento/[id]', params: { id: 'novo' } }],
    [
      'Saúde → Remédios',
      'Novo remédio',
      <MedicationsPanel key="remedios" personId={null} onPersonChange={jest.fn()} />,
      { pathname: '/remedio/[id]', params: { id: 'novo', pessoa: '' } },
    ],
    // Sem ninguém cadastrado, o botão leva a cadastrar a pessoa primeiro (PersonChips): aqui só a forma dele.
    ['Saúde → Planos', 'Nova ficha de treino', <PlansPanel key="planos" kind="workout" personId={null} onPersonChange={jest.fn()} />, null],
    ['Finanças → Contas (com a chave ligada)', 'Nova conta', <BillsPanel key="contas" />, { pathname: '/conta/[id]', params: { id: 'nova' } }],
    ['Finanças → Resumo (com a chave ligada)', 'Registrar gasto', <FinanceSummaryPanel key="resumo" />, { pathname: '/gasto/[id]', params: { id: 'novo' } }],
  ])('%s: "%s"', async (_part, title, panel, href) => {
    jest.mocked(router.push).mockClear();
    await act(async () => {
      renderer = create(panel);
    });
    const [first] = renderer!.root.findAllByType(Button);
    expect(first.props.title).toBe(title);
    expect(first.props.variant ?? 'primary').toBe('primary');
    // Nem azulejo, nem "+" no título de uma seção da parte.
    expect(renderer!.root.findAllByType(Tile)).toHaveLength(0);
    expect(renderer!.root.findAllByType(Section).filter((section) => section.props.action)).toHaveLength(0);
    if (href) {
      await act(async () => first.props.onPress());
      expect(router.push).toHaveBeenCalledWith(href);
    }
  });

  it('o secundário que é outra tela, e não criar, fica secundário: "Prestadores" ao lado de "Novo aparelho"', async () => {
    await act(async () => {
      renderer = create(<EquipmentPanel />);
    });
    const buttons = renderer!.root.findAllByType(Button).map((button) => [button.props.title, button.props.variant ?? 'primary']);
    expect(buttons).toEqual([
      ['Novo aparelho', 'primary'],
      ['Prestadores', 'secondary'],
    ]);
  });
});

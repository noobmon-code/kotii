import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import HouseScreen from '@/app/(tabs)/casa';
import ShoppingScreen from '@/app/(tabs)/compras';
import HealthScreen from '@/app/(tabs)/saude';
import { Dimensions, StyleSheet } from 'react-native';

import { CASA_NARROW_WIDTH, CASA_ROOMY_WIDTH, CASA_TABS, casaTabs, casaTabsFit, DIA_A_DIA, FINANCAS, SAUDE_TABS } from '@/domain/tabs';
import { FEATURES } from '@/lib/features';
import { Screen, Segmented } from '@/ui/primitives';
import { SCREEN_PADDING, space } from '@/ui/theme';

// Compras, Casa e Saúde não têm o cartão de topo (a barra de abas já diz a aba): a primeira coisa da tela é o
// seletor das partes, dentro da margem de cima do aparelho, e puxar para atualizar continua. O nome da aba fica só
// para o leitor de tela, como o título da página. (Configurações começa pela categoria Casa: settingsScreen.test.)
// Na Casa, o Dia a dia e Finanças têm um segundo seletor, logo abaixo do das partes.

const mockQuery = () => ({ data: [], isRefetching: false, isSuccess: true, refetch: jest.fn() });
jest.mock('@/data/home', () => ({ useChores: () => mockQuery(), usePantry: () => mockQuery(), useMedications: () => mockQuery() }));
jest.mock('@/data/house', () => ({ useEquipmentList: () => mockQuery() }));
jest.mock('@/data/market', () => ({ ARCHIVED_LISTS_KEY: 'archivedLists', useShoppingLists: () => mockQuery() }));
jest.mock('@/data/providers', () => ({ JOBS_KEY: 'serviceJobs', PROVIDERS_KEY: 'serviceProviders' }));
jest.mock('@/data/supplies', () => ({ useSupplies: () => mockQuery() }));
jest.mock('@/data/financeBeta', () => ({ useBeta: () => ({ data: false }) }));
// As partes de cada aba ficam de fora: aqui só importa o topo.
jest.mock('@/features/ChoresPanel', () => ({ ChoresPanel: () => null }));
jest.mock('@/features/EquipmentPanel', () => ({ EquipmentPanel: () => null }));
jest.mock('@/features/PantryPanel', () => ({ PantryAddButton: () => null, PantryPanel: () => null }));
jest.mock('@/features/ShoppingListsPanel', () => ({ ShoppingListsPanel: () => null }));
jest.mock('@/features/SuppliesSection', () => ({ SuppliesSection: () => null }));
jest.mock('@/features/AgendaPanel', () => ({ AgendaPanel: () => null, agendaQueryKeys: () => [] }));
jest.mock('@/features/DocumentsSection', () => ({ DocumentsSection: () => null }));
jest.mock('@/features/finance/BillsPanel', () => ({ BillsPanel: () => null }));
jest.mock('@/features/finance/ConsultorCard', () => ({ ConsultorCard: () => null }));
jest.mock('@/features/finance/FinanceSummaryPanel', () => ({ FinanceSummaryPanel: () => null }));
jest.mock('@/features/market/ReceiptsPanel', () => ({ ReceiptsPanel: () => null }));
jest.mock('@/features/health/CarePanel', () => ({ CarePanel: () => null }));
jest.mock('@/features/health/HealthTodaySections', () => ({ HealthTodaySections: () => null }));
jest.mock('@/features/health/MedicationSections', () => ({
  MedicationRefills: () => null,
  MedicationsToday: () => null,
  useRefills: () => ({ rows: [] }),
}));
jest.mock('@/features/health/MedicationsPanel', () => ({ MedicationsPanel: () => null }));
jest.mock('@/features/health/PlansPanel', () => ({ PlansPanel: () => null }));
jest.mock('@/features/health/useHealthOverview', () => ({
  useHealthOverview: () => ({ loaded: false, workoutsToday: [], upcoming: [], toConfirm: [], vaccinesDue: [], drafts: [] }),
}));
// A parte aberta (?aba=) e o que está aberto dentro dela.
const mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), setParams: jest.fn() },
  useLocalSearchParams: () => mockParams,
  useFocusEffect: () => undefined,
}));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));

let renderer: ReactTestRenderer | undefined;

const rawText = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map(rawText).join(''));

async function mount(screen: React.ReactElement) {
  const queryClient = new QueryClient();
  await act(async () => {
    renderer = create(<QueryClientProvider client={queryClient}>{screen}</QueryClientProvider>);
  });
}

const WINDOW = Dimensions.get('window');
/** A largura da janela, como o useWindowDimensions a lê. */
const setWidth = (width: number) => act(async () => Dimensions.set({ window: { ...WINDOW, width } }));

beforeEach(() => {
  for (const key of Object.keys(mockParams)) delete mockParams[key];
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  await act(async () => Dimensions.set({ window: WINDOW }));
  // A chave de Finanças volta a ser a de verdade.
  jest.restoreAllMocks();
});

describe('o topo das abas sem o cartão de cabeçalho', () => {
  it.each([
    ['Compras', <ShoppingScreen key="compras" />, 'ListasNotasDespensa'],
    // A Casa abre no Dia a dia, e o Dia a dia nas Tarefas: o seletor dele vem logo depois do das partes.
    ['Casa', <HouseScreen key="casa" />, 'Dia a diaFinançasAparelhosDocumentosTarefasAgenda'],
    ['Saúde', <HealthScreen key="saude" />, 'ResumoRemédiosCuidadosPlanos'],
  ])('%s começa pelo seletor das partes', async (name, screen, segments) => {
    await mount(screen);
    const page = renderer!.root.findByType(Screen);
    // O primeiro filho da tela é o seletor; nada de título, sobretítulo ou frase antes dele.
    const first = ([] as React.ReactNode[]).concat(page.props.children).find(Boolean) as React.ReactElement;
    expect(first.type).toBe(Segmented);
    // O nome da aba é o título da página para o leitor de tela, e só para ele: um ponto fora da vista.
    const headers = renderer!.root.findAll((node) => typeof node.type === 'string' && node.props.accessibilityRole === 'header');
    expect(headers.map(rawText)[0]).toBe(name);
    expect(StyleSheet.flatten(headers[0].props.style)).toMatchObject({ position: 'absolute', width: 1, height: 1, overflow: 'hidden' });
    const text = rawText(renderer!.root);
    expect(text.startsWith(`${name}${segments}`)).toBe(true);
    expect(text.split(name)).toHaveLength(2);
    // A margem de cima do aparelho (o padrão do Screen) e o puxar para atualizar continuam.
    expect(page.props.edges).toBeUndefined();
    expect(typeof page.props.onRefresh).toBe('function');
  });
});

describe('a Casa: o Dia a dia e Finanças', () => {
  const segmentLabels = () =>
    renderer!.root.findAllByType(Segmented).map((segmented) => segmented.props.options.map((option: { label: string }) => option.label));
  const openPart = () => renderer!.root.findAllByType(Segmented).map((segmented) => segmented.props.value);

  it('o Dia a dia abre nas Tarefas, com a Agenda como a segunda opção do seletor dele', async () => {
    await mount(<HouseScreen />);
    expect(segmentLabels()).toEqual([['Dia a dia', 'Finanças', 'Aparelhos', 'Documentos'], ['Tarefas', 'Agenda']]);
    expect(openPart()).toEqual(['dia', 'tarefas']);
    expect(DIA_A_DIA.map((part) => part.label)).toEqual(['Tarefas', 'Agenda']);
  });

  it('?dia=agenda abre a Agenda dentro do Dia a dia', async () => {
    Object.assign(mockParams, { aba: 'dia', dia: 'agenda' });
    await mount(<HouseScreen />);
    expect(openPart()).toEqual(['dia', 'agenda']);
  });

  it('Finanças é uma parte da Casa, com o Resumo e as Contas no seletor dela', async () => {
    Object.assign(mockParams, { aba: 'financas' });
    await mount(<HouseScreen />);
    expect(segmentLabels()).toEqual([['Dia a dia', 'Finanças', 'Aparelhos', 'Documentos'], ['Resumo', 'Contas']]);
    expect(openPart()).toEqual(['financas', 'resumo']);
    expect(FINANCAS.map((part) => part.label)).toEqual(['Resumo', 'Contas']);
  });

  it('com a chave de Finanças desligada, a parte não entra no seletor, e o endereço dela abre o Dia a dia', async () => {
    jest.replaceProperty(FEATURES, 'finance', false);
    Object.assign(mockParams, { aba: 'financas', financas: 'contas' });
    await mount(<HouseScreen />);
    expect(segmentLabels()).toEqual([['Dia a dia', 'Aparelhos', 'Documentos'], ['Tarefas', 'Agenda']]);
    expect(openPart()).toEqual(['dia', 'tarefas']);
  });

  it('Aparelhos e Documentos não têm um segundo seletor', async () => {
    for (const aba of ['aparelhos', 'documentos']) {
      Object.assign(mockParams, { aba });
      await mount(<HouseScreen />);
      expect(openPart()).toEqual([aba]);
      await act(async () => renderer!.unmount());
      renderer = undefined;
    }
  });
});

describe('as partes da Casa num celular de 360', () => {
  // Largura de cada rótulo em Nunito 15 Bold (o `label` do seletor), medida no TTF de @expo-google-fonts/nunito
  // (a soma dos avanços, sem kerning): Dia a dia 60,8, Finanças 60,6, Aparelhos 71,9 e Documentos 87,6. (As do
  // seletor do Dia a dia, Tarefas 52,5 e Agenda 54,3, cabem com folga em duas metades.)
  const LABELS: Record<string, number> = { 'Dia a dia': 60.8, Finanças: 60.6, Aparelhos: 71.9, Documentos: 87.6 };
  const sum = (labels: string[]) => labels.reduce((total, label) => total + LABELS[label], 0);
  // O seletor ocupa a largura da tela menos as margens; dentro dele, a borda (1 de cada lado) e o recuo (4).
  const room = (width: number) => width - 2 * SCREEN_PADDING - 2 - 2 * 4;
  /** A largura das partes juntas: os rótulos mais o recuo de cada parte (space.xs de cada lado; apertado, a metade). */
  const content = (labels: string[]) => sum(labels) + labels.length * 2 * space.xs;
  /** Apertado: os rótulos em 14 em vez de 15, e a metade do recuo. Justo: os rótulos em 13. */
  const denseContent = (labels: string[], size = 14) => (sum(labels) * size) / 15 + labels.length * space.xs;
  /** O ajuste (`fit`) de cada seletor da tela, de cima para baixo; o padrão é o normal. */
  const fits = () => renderer!.root.findAllByType(Segmented).map((segmented) => segmented.props.fit ?? 'normal');
  const four = CASA_TABS.map((tab) => tab.label);
  const three = casaTabs(false).map((tab) => tab.label);

  it('"Documentos" não cabe numa parte igual às outras, e por isso cada parte tem o tamanho do rótulo', async () => {
    expect(four).toEqual(Object.keys(LABELS));
    expect(LABELS.Documentos).toBeGreaterThan(room(360) / four.length);
    await mount(<HouseScreen />);
    expect(renderer!.root.findAllByType(Segmented)[0].props.widths).toBe('content');
    // O seletor de dentro (Tarefas e Agenda) é de partes iguais.
    expect(renderer!.root.findAllByType(Segmented)[1].props.widths).toBeUndefined();
  });

  it('as quatro juntas passam da largura de um celular de 360: ali o seletor aperta, e elas cabem inteiras', async () => {
    expect(content(four)).toBeGreaterThan(room(360));
    expect(denseContent(four)).toBeLessThanOrEqual(room(360));
    // A partir de 375 cabem do tamanho normal.
    expect(content(four)).toBeLessThanOrEqual(room(CASA_ROOMY_WIDTH));
    expect(casaTabsFit(4, 360)).toBe('dense');
    expect(casaTabsFit(4, CASA_ROOMY_WIDTH - 1)).toBe('dense');
    expect(casaTabsFit(4, CASA_ROOMY_WIDTH)).toBe('normal');

    await setWidth(360);
    await mount(<HouseScreen />);
    // Só o seletor das partes aperta; o de dentro (Tarefas e Agenda) cabe sempre.
    expect(fits()).toEqual(['dense', 'normal']);
    await setWidth(390);
    expect(fits()).toEqual(['normal', 'normal']);
  });

  it('num celular de 320 nem apertadas cabem: os rótulos ficam dois pontos menores, e cabem inteiros', async () => {
    expect(denseContent(four)).toBeGreaterThan(room(320));
    expect(denseContent(four, 13)).toBeLessThanOrEqual(room(320));
    // Apertadas, cabem a partir da largura em que o seletor deixa de ser justo.
    expect(denseContent(four)).toBeLessThanOrEqual(room(CASA_NARROW_WIDTH));
    expect(casaTabsFit(4, 320)).toBe('tight');
    expect(casaTabsFit(4, CASA_NARROW_WIDTH - 1)).toBe('tight');
    expect(casaTabsFit(4, CASA_NARROW_WIDTH)).toBe('dense');

    await setWidth(320);
    await mount(<HouseScreen />);
    expect(fits()).toEqual(['tight', 'normal']);
  });

  it('sem Finanças são três partes, que cabem do tamanho normal até num celular de 320', async () => {
    expect(three).toEqual(['Dia a dia', 'Aparelhos', 'Documentos']);
    expect(content(three)).toBeLessThanOrEqual(room(320));
    expect(casaTabsFit(3, 320)).toBe('normal');
    jest.replaceProperty(FEATURES, 'finance', false);
    await setWidth(320);
    await mount(<HouseScreen />);
    expect(fits()).toEqual(['normal', 'normal']);
  });
});

describe('as partes da Saúde num celular de 360', () => {
  // Largura de cada rótulo em Nunito 15 Bold, medida no TTF de @expo-google-fonts/nunito (a soma dos avanços, sem
  // kerning): Resumo 56,2, Remédios 68,5, Cuidados 64,9 e Planos 47,5.
  const LABELS: Record<string, number> = { Resumo: 56.2, Remédios: 68.5, Cuidados: 64.9, Planos: 47.5 };
  const room = 360 - 2 * SCREEN_PADDING - 2 - 2 * 4;

  it('as quatro cabem em partes iguais: o rótulo mais comprido, "Remédios", cabe num quarto', async () => {
    expect(SAUDE_TABS.map((tab) => tab.label)).toEqual(Object.keys(LABELS));
    expect(Math.max(...Object.values(LABELS))).toBeLessThanOrEqual(room / SAUDE_TABS.length);
    await mount(<HealthScreen />);
    expect(renderer!.root.findAllByType(Segmented)[0].props.widths).toBeUndefined();
  });
});

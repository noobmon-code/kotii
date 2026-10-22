import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { ComponentType, ReactElement } from 'react';
import { Switch } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import ProviderScreen from '@/app/prestador/[id]';
import ProvidersScreen from '@/app/prestadores';
import ServiceJobScreen from '@/app/servico/[id]';
import { DELETE_CHECK_MS, fetchServiceProviders, JOBS_KEY, PROVIDER_JOBS_CHANGED, PROVIDERS_KEY, type SoftList } from '@/data/providers';
import { EquipmentPanel } from '@/features/EquipmentPanel';
import { StaleNotice } from '@/features/health/StaleNotice';
import { EquipmentServices } from '@/features/providers/EquipmentServices';
import type { Equipment, ServiceJob, ServiceProvider } from '@/lib/types';
import { confirmAction, notify } from '@/ui/dialogs';
import { PickerModal } from '@/ui/PickerModal';
import { Button, Chip, DateField, ErrorNotice, ListRow, Loading, Screen, TextField } from '@/ui/primitives';

// As telas dos prestadores de verdade, com as buscas de verdade e o cache de verdade, em cima de um banco de
// mentira: o que se confere aqui é o que cada tela faz enquanto uma busca anda, quando ela falha e quando o que
// está guardado é de antes. As regras de domain/ não enxergam nada disso.

type Result = { data: unknown; error: unknown; count?: number };
interface Request {
  /** A tabela, ou a função do banco (verbo 'rpc'). */
  table: string;
  verb: 'select' | 'insert' | 'update' | 'delete' | 'rpc';
  values?: Record<string, unknown>;
  filters: Record<string, unknown>;
  /** Pedido de uma linha só (.single() ou .maybeSingle()). */
  one: boolean;
}

// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockNet = {
  providers: [] as ServiceProvider[],
  jobs: [] as ServiceJob[],
  equipment: [] as Equipment[],
  asked: [] as Request[],
  /** O que a rede faz com cada pedido: responde, segura (até `release`) ou falha. */
  mode: (_request: Request): 'ok' | 'hold' | 'fail' => 'ok',
  held: [] as { request: Request; settle: (result: Result) => void }[],
};
const mockRoute = { params: {} as Record<string, string>, title: undefined as string | undefined };

/** O que o banco responde, como o PostgREST. */
function mockAnswer(request: Request): Result {
  const { table, verb, values, filters } = request;
  if (verb === 'rpc' && table === 'delete_service_provider') {
    // Como a função do banco: com o prestador travado, confere o número de serviços que a pessoa leu.
    const id = values?.p_id;
    if (!mockNet.providers.some((p) => p.id === id)) return { data: false, error: null };
    const jobs = mockNet.jobs.filter((job) => job.provider_id === id).length;
    if (values?.p_expected_jobs != null && values.p_expected_jobs !== jobs) {
      return { data: null, error: { code: 'NK010', message: 'Os serviços deste prestador mudaram em outro aparelho, e nada foi excluído.' } };
    }
    mockNet.providers = mockNet.providers.filter((p) => p.id !== id);
    mockNet.jobs = mockNet.jobs.filter((job) => job.provider_id !== id);
    return { data: true, error: null };
  }
  if (verb === 'insert') {
    if (table === 'service_jobs') mockNet.jobs.push({ id: 'j-novo', created_at: '2026-10-13T12:00:00Z', ...values } as ServiceJob);
    if (table === 'service_providers') mockNet.providers.push({ id: 'p-novo', created_at: '2026-10-13T12:00:00Z', ...values } as ServiceProvider);
    return { data: { id: table === 'service_jobs' ? 'j-novo' : table === 'service_providers' ? 'p-novo' : 'novo' }, error: null };
  }
  if (verb === 'update') {
    if (table === 'service_jobs') mockNet.jobs = mockNet.jobs.map((job) => (job.id === filters.id ? { ...job, ...values } : job));
    return { data: { id: filters.id }, error: null };
  }
  if (verb === 'delete') return { data: null, error: null };
  if (table === 'service_providers') return { data: mockNet.providers, error: null };
  if (table === 'service_jobs') {
    if (request.one) return { data: mockNet.jobs.find((job) => job.id === filters.id) ?? null, error: null };
    const rows = mockNet.jobs.filter(
      (job) => (!filters.provider_id || job.provider_id === filters.provider_id) && (!filters.equipment_id || job.equipment_id === filters.equipment_id),
    );
    // Quantos são ao todo, como o PostgREST responde a um pedido com count: 'exact'.
    return { data: rows, error: null, count: rows.length };
  }
  if (table === 'equipment') {
    if (!request.one) return { data: mockNet.equipment, error: null };
    const row = mockNet.equipment.find((item) => item.id === filters.id);
    return row ? { data: row, error: null } : { data: null, error: { code: 'PGRST116', message: 'Cannot coerce the result to a single JSON object' } };
  }
  return { data: [], error: null };
}

/** O pedido chega à rede: ela responde, segura ou falha, como `mockNet.mode` disser. */
function mockSend(request: Request, resolve: (result: Result) => unknown, reject: (error: unknown) => unknown) {
  mockNet.asked.push(request);
  const mode = mockNet.mode(request);
  const answer =
    mode === 'hold'
      ? new Promise<Result>((settle) => mockNet.held.push({ request, settle }))
      : Promise.resolve(mode === 'fail' ? { data: null, error: { message: 'TypeError: Network request failed' } } : mockAnswer(request));
  return answer.then(resolve, reject);
}

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const request: Request = { table, verb: 'select', filters: {}, one: false };
      const write = (verb: Request['verb']) => (values?: Record<string, unknown>) => {
        request.verb = verb;
        request.values = values;
        return query;
      };
      const one = () => {
        request.one = true;
        return query;
      };
      const query = {
        select: () => query,
        order: () => query,
        insert: write('insert'),
        update: write('update'),
        delete: write('delete'),
        eq: (column: string, value: unknown) => {
          request.filters[column] = value;
          return query;
        },
        single: one,
        maybeSingle: one,
        then: (resolve: (result: Result) => unknown, reject: (error: unknown) => unknown) => mockSend(request, resolve, reject),
      };
      return query;
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      const request: Request = { table: fn, verb: 'rpc', values: args, filters: {}, one: false };
      return { then: (resolve: (result: Result) => unknown, reject: (error: unknown) => unknown) => mockSend(request, resolve, reject) };
    },
  },
  unwrap: (result: Result) => {
    if (result.error) throw result.error;
    return result.data;
  },
  errorMessage: (error: { message?: string } | null) => error?.message ?? 'Algo deu errado. Tente novamente.',
}));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn(), push: jest.fn(), canGoBack: () => true },
  Stack: {
    Screen: ({ options }: { options: { title?: string } }) => {
      mockRoute.title = options.title;
      return null;
    },
  },
  useLocalSearchParams: () => mockRoute.params,
}));
jest.mock('@/ui/dialogs', () => ({ confirmAction: jest.fn(), notify: jest.fn() }));
// As fotos dos aparelhos (e, por elas, a sessão e os lembretes) não entram nestas telas.
jest.mock('@/data/images', () => ({ removeImages: jest.fn(), signedImageUrl: jest.fn() }));
// Os desenhos animados (reanimated) e o fundo não entram no que se confere aqui.
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@/ui/PickerModal', () => ({ PickerModal: () => null }));

const provider = (id: string, name: string, trade: string): ServiceProvider => ({
  id,
  name,
  trade,
  phone: null,
  phone_digits: null,
  notes: null,
  recommended: true,
  created_at: '2026-01-10T12:00:00Z',
});
const appliance = (id: string, name: string, category: string) => ({ id, name, category, location: null, file_paths: [] }) as unknown as Equipment;
const job = (over: Partial<ServiceJob> = {}): ServiceJob => ({
  id: 'j1',
  provider_id: 'p-ze',
  equipment_id: null,
  done_on: '2026-09-01',
  description: 'Trocou o disjuntor',
  amount: 180,
  warranty_until: null,
  notes: null,
  created_at: '2026-09-01T12:00:00Z',
  ...over,
});

const ZE = provider('p-ze', 'Zé Eletricista', 'eletricista');
const SILVA = provider('p-out', 'Auto Center Silva', 'outros');
const OFICINA = provider('p-mec', 'Oficina do Tonho', 'mecanico');
const GELADEIRA = appliance('e1', 'Geladeira', 'eletrodomestico');
const CARRO = appliance('e-car', 'Carro', 'veiculo');

const DESCRIPTION = 'Ex.: Trocou a resistência do chuveiro';
const AMOUNT = '0,00';
const SEARCH = 'Buscar por nome, serviço ou conserto';
const COPY = 'Lançar também nos gastos da casa';

let queryClient: QueryClient;
let renderer: ReactTestRenderer | undefined;

/** Guardado há dez minutos: a tela mostra e busca de novo. */
const old = (key: unknown[], data: unknown) => queryClient.setQueryData(key, data, { updatedAt: Date.now() - 10 * 60_000 });
/** Acabou de chegar: a tela não busca de novo. */
const fresh = (key: unknown[], data: unknown) => queryClient.setQueryData(key, data);
const list = <T,>(rows: T[]) => ({ rows, missing: false });

const only = (table: string, one?: boolean) => (request: Request) =>
  request.verb === 'select' && request.table === table && (one === undefined || request.one === one);
const hold = (match: (request: Request) => boolean) => {
  mockNet.mode = (request) => (match(request) ? 'hold' : 'ok');
};
const fail = (match: (request: Request) => boolean) => {
  mockNet.mode = (request) => (match(request) ? 'fail' : 'ok');
};
const online = () => {
  mockNet.mode = () => 'ok';
};

/** Deixa as buscas e os avisos do cache andarem. */
async function settle(turns = 6) {
  for (let turn = 0; turn < turns; turn++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Os pedidos que estavam seguros chegam (ou falham); os próximos seguem o que `mockNet.mode` disser. */
async function release(how: 'ok' | 'fail') {
  const held = mockNet.held.splice(0);
  await act(async () => {
    for (const { request, settle: answer } of held) {
      answer(how === 'ok' ? mockAnswer(request) : { data: null, error: { message: 'TypeError: Network request failed' } });
    }
  });
  await settle();
}

async function open(ScreenComponent: ComponentType, params: Record<string, string>) {
  mockRoute.params = params;
  mockRoute.title = undefined;
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={queryClient}>
        <ScreenComponent />
      </QueryClientProvider>,
    );
  });
  await settle();
}

type Rendered = ReturnType<ReactTestRenderer['toJSON']> | string;
/** Os textos de um pedaço da tela; os pedaços de um mesmo texto ("Nada encontrado para “", a busca, "”.") vêm juntos. */
function texts(node: Rendered): string[] {
  if (node == null) return [];
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(texts);
  const children = node.children ?? [];
  return children.length && children.every((child) => typeof child === 'string') ? [children.join('')] : children.flatMap(texts);
}
/** Tudo o que a tela escreve, uma frase por linha. */
const page = () => texts(renderer!.toJSON()).join('\n');
const has = (component: ComponentType<never>) => renderer!.root.findAllByType(component as ComponentType).length > 0;
const field = (placeholder: string) => renderer!.root.findAllByType(TextField).find((input) => input.props.placeholder === placeholder);
const button = (title: string) => renderer!.root.findAllByType(Button).find((item) => item.props.title === title);
const copySwitch = () => renderer!.root.findAllByType(Switch).find((item) => item.props.accessibilityLabel === COPY);
/** Uma lista de escolha da tela (de mentira aqui: o que se confere é o que a tela entrega a ela). */
const picker = (title: string) => renderer!.root.findAllByType(PickerModal).find((item) => item.props.title === title);
/** O que a lista de quem fez mostra no topo, acima dos prestadores (o "Novo prestador"), ou nada. */
const newProviderAction = () =>
  picker('Quem fez o serviço')!.props.extraActions?.('') as ReactElement<{ title: string; icon?: string; onPress: () => void }> | null | undefined;
const asked = (table: string, verb: Request['verb']) => mockNet.asked.filter((request) => request.table === table && request.verb === verb);

async function type(placeholder: string, text: string) {
  await act(async () => field(placeholder)!.props.onChangeText(text));
}
/** Toca no botão, sem esperar o que ele começou (o Salvar espera as buscas que o teste pode estar segurando). */
async function press(title: string) {
  await act(async () => {
    button(title)!.props.onPress();
  });
  await settle();
}

beforeEach(() => {
  // Como no app (lib/queryClient), menos a segunda tentativa e a limpeza do cache, que só fariam o teste esperar.
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: false, gcTime: Infinity },
      mutations: { networkMode: 'always', gcTime: Infinity },
    },
  });
  Object.assign(mockNet, { providers: [ZE], jobs: [], equipment: [], asked: [], held: [] });
  online();
  jest.clearAllMocks();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  queryClient.clear();
  onlineManager.setOnline(true);
});

describe('o serviço que já existe espera a busca que a tela pediu', () => {
  beforeEach(() => {
    fresh([PROVIDERS_KEY], list([ZE]));
    fresh(['equipment'], []);
  });

  it('guardado de antes de uma mudança: o formulário só aparece com o que veio do banco, e é isso que vai para o gasto', async () => {
    old([JOBS_KEY, 'job', 'j1'], job({ description: 'Orçamento da embreagem', amount: 180 }));
    mockNet.jobs = [job({ description: 'Trocou a embreagem', amount: 1500 })];
    hold(only('service_jobs', true));
    await open(ServiceJobScreen, { id: 'j1' });
    expect(has(Loading)).toBe(true);
    expect(field(DESCRIPTION)).toBeUndefined();

    online();
    await release('ok');
    expect(field(DESCRIPTION)!.props.value).toBe('Trocou a embreagem');
    expect(field(AMOUNT)!.props.value).toBe('1.500,00');

    await act(async () => copySwitch()!.props.onValueChange(true));
    await press('Salvar');
    expect(asked('service_jobs', 'update')[0].values).toMatchObject({ description: 'Trocou a embreagem', amount: 1500 });
    expect(asked('expenses', 'insert')[0].values).toMatchObject({ description: 'Trocou a embreagem (Zé Eletricista)', amount: 1500, category: 'moradia' });
  });

  it('guardado agora há pouco (menos de 30 s) e mudado em outro celular: espera a busca mesmo assim, e o formulário nunca mostra o guardado', async () => {
    fresh([JOBS_KEY, 'job', 'j1'], job({ description: 'Orçamento da embreagem', amount: 180 }));
    mockNet.jobs = [job({ description: 'Trocou a embreagem', amount: 1500 })];
    hold(only('service_jobs', true));
    await open(ServiceJobScreen, { id: 'j1' });
    expect(has(Loading)).toBe(true);
    expect(field(DESCRIPTION)).toBeUndefined();

    // Se o formulário tivesse aparecido com o guardado, nem que fosse por um instante, ficaria com ele (a trava
    // da tela): vir com o que está no banco mostra que ele não apareceu.
    online();
    await release('ok');
    expect(field(DESCRIPTION)!.props.value).toBe('Trocou a embreagem');
    expect(field(AMOUNT)!.props.value).toBe('1.500,00');
  });

  it('sem internet: o formulário abre com o que está guardado', async () => {
    fresh([JOBS_KEY, 'job', 'j1'], job());
    onlineManager.setOnline(false);
    await open(ServiceJobScreen, { id: 'j1' });
    expect(has(Loading)).toBe(false);
    expect(field(DESCRIPTION)!.props.value).toBe('Trocou o disjuntor');
    expect(field(AMOUNT)!.props.value).toBe('180,00');
    expect(asked('service_jobs', 'select')).toHaveLength(0);
  });

  it('a busca falhou e há o que estava guardado: o formulário vem com ele', async () => {
    old([JOBS_KEY, 'job', 'j1'], job());
    fail(only('service_jobs', true));
    await open(ServiceJobScreen, { id: 'j1' });
    expect(field(DESCRIPTION)!.props.value).toBe('Trocou o disjuntor');
    expect(field(AMOUNT)!.props.value).toBe('180,00');
  });

  it('com o formulário aberto, outra busca do serviço não o tira da frente nem apaga o que foi digitado', async () => {
    mockNet.jobs = [job()];
    await open(ServiceJobScreen, { id: 'j1' });
    await type(DESCRIPTION, 'Trocou a correia');

    hold(only('service_jobs', true));
    await act(async () => {
      queryClient.invalidateQueries({ queryKey: [JOBS_KEY] });
    });
    await settle();
    expect(mockNet.held).toHaveLength(1);
    expect(has(Loading)).toBe(false);
    expect(field(DESCRIPTION)!.props.value).toBe('Trocou a correia');

    await release('ok');
    expect(field(DESCRIPTION)!.props.value).toBe('Trocou a correia');
  });

  it('serviço novo abre na hora, sem busca de serviço nenhum', async () => {
    await open(ServiceJobScreen, { id: 'novo' });
    expect(mockRoute.title).toBe('Novo serviço');
    expect(field(DESCRIPTION)).toBeDefined();
    expect(asked('service_jobs', 'select')).toHaveLength(0);
  });
});

describe('o prestador que já existe espera a busca que a tela pediu', () => {
  const NAME = 'Pessoa ou empresa';
  const NOTES = 'Ex.: só atende de manhã, cobra a visita';

  beforeEach(() => {
    fresh(['equipment'], []);
  });

  it('guardado agora há pouco e mudado em outro celular: o formulário só aparece com o que veio do banco, e é isso que Salvar grava', async () => {
    fresh([PROVIDERS_KEY], list([ZE]));
    mockNet.providers = [{ ...ZE, name: 'Zé da Luz', notes: 'Só atende de manhã' }];
    hold(only('service_providers'));
    await open(ProviderScreen, { id: 'p-ze' });
    expect(has(Loading)).toBe(true);
    expect(field(NAME)).toBeUndefined();

    online();
    await release('ok');
    expect(field(NAME)!.props.value).toBe('Zé da Luz');
    expect(field(NOTES)!.props.value).toBe('Só atende de manhã');
    await press('Salvar');
    expect(asked('service_providers', 'update')[0].values).toMatchObject({ name: 'Zé da Luz', notes: 'Só atende de manhã' });
  });

  it('sem internet: o formulário abre com a lista guardada', async () => {
    fresh([PROVIDERS_KEY], list([ZE]));
    onlineManager.setOnline(false);
    await open(ProviderScreen, { id: 'p-ze' });
    expect(has(Loading)).toBe(false);
    expect(field(NAME)!.props.value).toBe('Zé Eletricista');
    expect(asked('service_providers', 'select')).toHaveLength(0);
  });

  it('a busca falhou e há a lista guardada: o formulário vem com o que estava nela', async () => {
    old([PROVIDERS_KEY], list([ZE]));
    fail(only('service_providers'));
    await open(ProviderScreen, { id: 'p-ze' });
    expect(has(ErrorNotice)).toBe(false);
    expect(field(NAME)!.props.value).toBe('Zé Eletricista');
  });

  it('com o formulário aberto, outra busca da lista não o tira da frente nem apaga o que foi digitado', async () => {
    fresh([PROVIDERS_KEY], list([ZE]));
    await open(ProviderScreen, { id: 'p-ze' });
    await type(NAME, 'Zé da Luz Elétrica');

    hold(only('service_providers'));
    await act(async () => {
      queryClient.invalidateQueries({ queryKey: [PROVIDERS_KEY] });
    });
    await settle();
    expect(mockNet.held).toHaveLength(1);
    expect(has(Loading)).toBe(false);
    expect(field(NAME)!.props.value).toBe('Zé da Luz Elétrica');

    await release('ok');
    expect(field(NAME)!.props.value).toBe('Zé da Luz Elétrica');
  });

  it('a lista guardada ainda não o tem (acabou de ser criado): espera a que chega com ele', async () => {
    fresh([PROVIDERS_KEY], list([ZE]));
    mockNet.providers = [ZE, OFICINA];
    hold(only('service_providers'));
    await open(ProviderScreen, { id: 'p-mec' });
    expect(has(Loading)).toBe(true);
    expect(page()).not.toContain('não existe mais');

    await release('ok');
    expect(field(NAME)!.props.value).toBe('Oficina do Tonho');
  });

  it('a busca falhou e a lista guardada não o tem: pede de novo, sem dizer que ele não existe mais', async () => {
    old([PROVIDERS_KEY], list([ZE]));
    fail(only('service_providers'));
    await open(ProviderScreen, { id: 'p-mec' });
    expect(has(ErrorNotice)).toBe(true);
    expect(page()).not.toContain('não existe mais');
  });

  it('a lista chegou e não o tem: "não existe mais"', async () => {
    fresh([PROVIDERS_KEY], list([ZE]));
    await open(ProviderScreen, { id: 'p-mec' });
    expect(page()).toContain('Este prestador não existe mais.');
  });

  it('prestador novo abre na hora, sem esperar a lista', async () => {
    fresh([PROVIDERS_KEY], list([ZE]));
    hold(only('service_providers'));
    await open(ProviderScreen, { id: 'novo' });
    expect(mockRoute.title).toBe('Novo prestador');
    expect(field(NAME)).toBeDefined();
    expect(asked('service_providers', 'select')).toHaveLength(0);
  });
});

describe('salvar o serviço', () => {
  beforeEach(async () => {
    fresh([PROVIDERS_KEY], list([ZE]));
    fresh(['equipment'], []);
    mockNet.jobs = [job()];
    await open(ServiceJobScreen, { id: 'j1' });
    await type(AMOUNT, '250,00');
  });

  it('não fica preso à busca do serviço salvo: o gasto é gravado e a tela fecha, e quem abre o mesmo serviço em seguida espera a busca', async () => {
    await act(async () => copySwitch()!.props.onValueChange(true));
    // Depois de salvar, nenhuma busca responde (internet lenta, ou que caiu).
    hold((request) => request.verb === 'select');
    await press('Salvar');
    expect(asked('service_jobs', 'update')[0].values).toMatchObject({ amount: 250 });
    expect(mockNet.held.length).toBeGreaterThan(0);
    // O gasto não espera a busca, nem o fechar da tela: o serviço já foi salvo.
    expect(asked('expenses', 'insert').map((request) => request.values)).toEqual([expect.objectContaining({ amount: 250 })]);
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();

    // O mesmo serviço aberto de novo, com a busca ainda a caminho: espera por ela (e o guardado já é o salvo).
    await act(async () => renderer?.unmount());
    expect(queryClient.getQueryData<ServiceJob>([JOBS_KEY, 'job', 'j1'])?.amount).toBe(250);
    await open(ServiceJobScreen, { id: 'j1' });
    expect(has(Loading)).toBe(true);
    expect(field(AMOUNT)).toBeUndefined();

    online();
    await release('ok');
    expect(field(AMOUNT)!.props.value).toBe('250,00');
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(asked('expenses', 'insert')).toHaveLength(1);
  });

  it('a busca depois de salvar falhou: o serviço foi salvo, e a tela fecha sem aviso de erro', async () => {
    fail((request) => request.verb === 'select');
    await press('Salvar');
    expect(asked('service_jobs', 'update')).toHaveLength(1);
    expect(notify).not.toHaveBeenCalled();
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('a busca depois de salvar falhou e o mesmo serviço é aberto de novo: vem o valor salvo, não o de antes', async () => {
    fail((request) => request.verb === 'select');
    await press('Salvar');
    await act(async () => renderer?.unmount());
    // O que ficou guardado é o serviço salvo, não o de antes (R$ 180,00).
    expect(queryClient.getQueryData<ServiceJob>([JOBS_KEY, 'job', 'j1'])).toMatchObject({ id: 'j1', amount: 250, created_at: '2026-09-01T12:00:00Z' });

    hold(only('service_jobs', true));
    await open(ServiceJobScreen, { id: 'j1' });
    expect(has(Loading)).toBe(true);
    expect(field(AMOUNT)).toBeUndefined();

    online();
    await release('ok');
    expect(field(AMOUNT)!.props.value).toBe('250,00');
  });
});

describe('o guardado depois de salvar é o que foi salvo', () => {
  it('o serviço: a busca depois de salvar falhou, e ele é aberto de novo sem internet com o que foi salvo', async () => {
    fresh([PROVIDERS_KEY], list([ZE]));
    fresh(['equipment'], []);
    mockNet.jobs = [job()];
    await open(ServiceJobScreen, { id: 'j1' });
    await type(AMOUNT, '250,00');
    await type(DESCRIPTION, 'Trocou o disjuntor e a tomada');
    fail((request) => request.verb === 'select');
    await press('Salvar');
    expect(asked('service_jobs', 'update')).toHaveLength(1);
    await act(async () => renderer?.unmount());

    onlineManager.setOnline(false);
    await open(ServiceJobScreen, { id: 'j1' });
    expect(has(Loading)).toBe(false);
    expect(field(AMOUNT)!.props.value).toBe('250,00');
    expect(field(DESCRIPTION)!.props.value).toBe('Trocou o disjuntor e a tomada');
  });

  it('o prestador: a busca depois de salvar falhou, e ele é aberto de novo sem internet com o que foi salvo', async () => {
    const NAME = 'Pessoa ou empresa';
    fresh([PROVIDERS_KEY], list([ZE, OFICINA]));
    fresh(['equipment'], []);
    mockNet.providers = [ZE, OFICINA];
    await open(ProviderScreen, { id: 'p-ze' });
    await type(NAME, 'Zé da Luz');
    fail((request) => request.verb === 'select');
    await press('Salvar');
    expect(asked('service_providers', 'update')[0].values).toMatchObject({ name: 'Zé da Luz' });
    expect(router.back).toHaveBeenCalledTimes(1);
    await act(async () => renderer?.unmount());
    // Só a linha salva muda; as outras ficam como estavam.
    expect(queryClient.getQueryData([PROVIDERS_KEY])).toEqual(list([{ ...ZE, name: 'Zé da Luz' }, OFICINA]));

    onlineManager.setOnline(false);
    await open(ProviderScreen, { id: 'p-ze' });
    expect(field(NAME)!.props.value).toBe('Zé da Luz');
  });
});

describe('salvar o prestador não espera as buscas', () => {
  const NAME = 'Pessoa ou empresa';

  beforeEach(() => {
    fresh([PROVIDERS_KEY], list([ZE]));
    fresh(['equipment'], []);
  });

  /** O formulário de um prestador novo, preenchido: Maria, diarista. */
  async function fillNew(params: Record<string, string>) {
    await open(ProviderScreen, params);
    await type(NAME, 'Maria Diarista');
    await act(async () => renderer!.root.findAllByType(Chip).find((chip) => chip.props.label === 'Diarista')!.props.onPress());
  }

  /** Um prestador novo, salvo: o cadastro chega ao banco, e a internet cai antes da busca da lista. */
  async function saveNewThenOffline(params: Record<string, string>) {
    await fillNew(params);
    hold((request) => request.verb === 'insert');
    await press('Salvar prestador');
    await act(async () => onlineManager.setOnline(false));
    online();
    await release('ok');
  }

  it('editar: a tela fecha logo depois de gravar, com as buscas ainda a caminho', async () => {
    await open(ProviderScreen, { id: 'p-ze' });
    await type(NAME, 'Zé da Luz');
    hold((request) => request.verb === 'select');
    await press('Salvar');
    expect(asked('service_providers', 'update')).toHaveLength(1);
    expect(mockNet.held.length).toBeGreaterThan(0);
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(button('Salvar')!.props.loading).toBe(false);
    expect(queryClient.getQueryData<SoftList<ServiceProvider>>([PROVIDERS_KEY])?.rows.map((p) => p.name)).toEqual(['Zé da Luz']);
  });

  it('o novo: segue para a tela dele com as buscas ainda a caminho, e ele já está na lista guardada', async () => {
    await fillNew({ id: 'novo' });
    hold((request) => request.verb === 'select');
    await press('Salvar prestador');
    expect(asked('service_providers', 'insert')).toHaveLength(1);
    expect(mockNet.held.length).toBeGreaterThan(0);
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/prestador/[id]', params: { id: 'p-novo' } });
    // Na ordem do nome, como o banco manda.
    expect(queryClient.getQueryData<SoftList<ServiceProvider>>([PROVIDERS_KEY])).toEqual({
      rows: [expect.objectContaining({ id: 'p-novo', name: 'Maria Diarista', trade: 'diarista' }), ZE],
      missing: false,
    });
  });

  it('a internet cai logo depois de salvar o novo: a tela dele abre com o que foi salvo, e não com "não existe mais"', async () => {
    await saveNewThenOffline({ id: 'novo' });
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/prestador/[id]', params: { id: 'p-novo' } });
    await act(async () => renderer?.unmount());
    await open(ProviderScreen, { id: 'p-novo' });
    expect(page()).not.toContain('não existe mais');
    expect(field(NAME)!.props.value).toBe('Maria Diarista');
  });

  it('vindo de um aparelho, na casa sem prestador nenhum: o serviço abre com quem acabou de ser salvo, sem mandar cadastrar de novo', async () => {
    mockNet.providers = [];
    mockNet.equipment = [GELADEIRA];
    fresh([PROVIDERS_KEY], list([]));
    fresh(['equipment'], [GELADEIRA]);
    await saveNewThenOffline({ id: 'novo', aparelho: 'e1' });
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/servico/[id]', params: { id: 'novo', prestador: 'p-novo', aparelho: 'e1' } });
    await act(async () => renderer?.unmount());
    await open(ServiceJobScreen, { id: 'novo', prestador: 'p-novo', aparelho: 'e1' });
    expect(page()).not.toContain('Cadastre primeiro o prestador');
    expect(page()).toContain('Maria Diarista');
    expect(field(DESCRIPTION)).toBeDefined();
  });
});

describe('sem internet, quem a lista guardada não tem não é "não existe mais"', () => {
  it('a tela do prestador avisa que está sem internet, e abre sozinha quando ela volta', async () => {
    const NAME = 'Pessoa ou empresa';
    fresh([PROVIDERS_KEY], list([ZE]));
    fresh(['equipment'], []);
    mockNet.providers = [ZE, OFICINA];
    onlineManager.setOnline(false);
    await open(ProviderScreen, { id: 'p-mec' });
    expect(page()).toContain('Sem internet: não deu para abrir este prestador.');
    expect(page()).not.toContain('não existe mais');

    await act(async () => onlineManager.setOnline(true));
    await settle();
    expect(field(NAME)!.props.value).toBe('Oficina do Tonho');
  });

  it('a tela do serviço, com a lista guardada vazia, espera a conexão em vez de mandar cadastrar o prestador', async () => {
    old([PROVIDERS_KEY], list([]));
    fresh(['equipment'], []);
    onlineManager.setOnline(false);
    await open(ServiceJobScreen, { id: 'novo', prestador: 'p-ze' });
    expect(page()).not.toContain('Cadastre primeiro o prestador');
    expect(button('Novo prestador')).toBeUndefined();
    expect(has(Loading)).toBe(true);

    await act(async () => onlineManager.setOnline(true));
    await settle();
    expect(page()).toContain('Zé Eletricista');
    expect(field(DESCRIPTION)).toBeDefined();
  });
});

describe('a cópia para os gastos espera a leitura desta visita do prestador e do aparelho', () => {
  const TONHO = provider('p-ton', 'Tonho', 'mecanico');

  beforeEach(() => {
    mockNet.jobs = [job({ provider_id: 'p-ton', amount: 180 })];
  });

  it('o guardado diz Mecânico e o banco, Eletricista: a cópia espera a leitura, e sai em Moradia com o nome novo', async () => {
    fresh([PROVIDERS_KEY], list([TONHO]));
    fresh(['equipment'], []);
    mockNet.providers = [{ ...TONHO, name: 'Tonho Eletricista', trade: 'eletricista' }];
    hold(only('service_providers'));
    await open(ServiceJobScreen, { id: 'j1' });
    // O formulário não espera esta leitura; só a cópia.
    expect(field(DESCRIPTION)!.props.value).toBe('Trocou o disjuntor');
    expect(page()).toContain('Carregando o prestador deste serviço…');
    expect(page()).not.toContain('Transporte');
    expect(copySwitch()!.props).toMatchObject({ value: false, disabled: true });

    online();
    await release('ok');
    expect(page()).toContain('Cria um gasto novo em Moradia');
    expect(copySwitch()!.props.disabled).toBe(false);
    await act(async () => copySwitch()!.props.onValueChange(true));
    await press('Salvar');
    expect(asked('expenses', 'insert')[0].values).toMatchObject({
      description: 'Trocou o disjuntor (Tonho Eletricista)',
      category: 'moradia',
      amount: 180,
    });
  });

  it('o aparelho guardado não é veículo e o do banco é: a cópia espera, e sai em Transporte', async () => {
    fresh([PROVIDERS_KEY], list([SILVA]));
    fresh(['equipment'], [GELADEIRA]);
    mockNet.providers = [SILVA];
    mockNet.equipment = [{ ...GELADEIRA, name: 'Moto', category: 'veiculo' } as Equipment];
    mockNet.jobs = [job({ provider_id: 'p-out', equipment_id: 'e1' })];
    hold(only('equipment'));
    await open(ServiceJobScreen, { id: 'j1' });
    expect(page()).toContain('Carregando o aparelho deste serviço…');
    expect(copySwitch()!.props).toMatchObject({ value: false, disabled: true });

    await release('ok');
    expect(page()).toContain('Cria um gasto novo em Transporte');
    expect(copySwitch()!.props.disabled).toBe(false);
  });

  it('a leitura falhou: o motivo e "Tentar de novo", mesmo com o prestador na lista guardada', async () => {
    fresh([PROVIDERS_KEY], list([TONHO]));
    fresh(['equipment'], []);
    mockNet.providers = [TONHO];
    fail(only('service_providers'));
    await open(ServiceJobScreen, { id: 'j1' });
    expect(has(ErrorNotice)).toBe(false);
    expect(page()).toContain(
      'Não deu para carregar o prestador deste serviço, e é o ofício dele que diz se o gasto entra em Moradia ou em Transporte. Tente de novo, ou lance o gasto em Finanças.',
    );
    expect(copySwitch()!.props).toMatchObject({ value: false, disabled: true });

    online();
    await press('Tentar de novo');
    expect(page()).toContain('Cria um gasto novo em Transporte');
    expect(copySwitch()!.props.disabled).toBe(false);
    expect(button('Tentar de novo')).toBeUndefined();
  });

  it('sem internet: o formulário abre com o guardado, e a cópia fica desligada até a leitura chegar', async () => {
    fresh([PROVIDERS_KEY], list([TONHO]));
    fresh(['equipment'], []);
    fresh([JOBS_KEY, 'job', 'j1'], job({ provider_id: 'p-ton', amount: 180 }));
    mockNet.providers = [TONHO];
    onlineManager.setOnline(false);
    await open(ServiceJobScreen, { id: 'j1' });
    expect(field(DESCRIPTION)!.props.value).toBe('Trocou o disjuntor');
    expect(page()).toContain(
      'Sem internet, não dá para conferir o prestador deste serviço, e é o ofício dele que diz se o gasto entra em Moradia ou em Transporte. Quando a internet voltar, dá para lançar daqui.',
    );
    expect(copySwitch()!.props).toMatchObject({ value: false, disabled: true });
    // A busca volta sozinha com a internet: não há o que tentar de novo.
    expect(button('Tentar de novo')).toBeUndefined();

    await act(async () => onlineManager.setOnline(true));
    await settle();
    expect(page()).toContain('Cria um gasto novo em Transporte');
    expect(copySwitch()!.props.disabled).toBe(false);
  });

  it('salvar o serviço não espera estas leituras', async () => {
    fresh([PROVIDERS_KEY], list([TONHO]));
    fresh(['equipment'], []);
    hold((request) => request.verb === 'select' && request.table !== 'service_jobs');
    await open(ServiceJobScreen, { id: 'j1' });
    await type(AMOUNT, '200,00');
    await press('Salvar');
    expect(asked('service_jobs', 'update')[0].values).toMatchObject({ amount: 200 });
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(asked('expenses', 'insert')).toHaveLength(0);
  });
});

describe('a lista de prestadores que a tela do serviço tem é de antes', () => {
  it('vazia e a nova ainda a caminho: espera, em vez de mandar cadastrar quem já está no banco', async () => {
    old([PROVIDERS_KEY], list([]));
    fresh(['equipment'], []);
    mockNet.jobs = [job()];
    hold(only('service_providers'));
    await open(ServiceJobScreen, { id: 'j1' });
    expect(page()).not.toContain('Cadastre primeiro o prestador');
    expect(button('Novo prestador')).toBeUndefined();
    expect(has(Loading)).toBe(true);

    await release('ok');
    expect(mockRoute.title).toBe('Serviço');
    expect(page()).toContain('Zé Eletricista');
  });

  it('vazia de verdade, num serviço novo: o convite para cadastrar o prestador', async () => {
    mockNet.providers = [];
    fresh([PROVIDERS_KEY], list([]));
    fresh(['equipment'], []);
    await open(ServiceJobScreen, { id: 'novo' });
    expect(page()).toContain('Quem fez o serviço?');
    expect(button('Novo prestador')).toBeDefined();
  });

  it('a busca falha com o formulário já aberto: ele fica, com o que foi digitado', async () => {
    old([PROVIDERS_KEY], list([ZE]));
    fresh(['equipment'], []);
    mockNet.providers = [ZE, OFICINA];
    hold(only('service_providers'));
    await open(ServiceJobScreen, { id: 'novo', prestador: 'p-mec' });
    await type(DESCRIPTION, 'Trocou o óleo');
    await type(AMOUNT, '300');

    await release('fail');
    expect(has(ErrorNotice)).toBe(false);
    expect(field(DESCRIPTION)!.props.value).toBe('Trocou o óleo');
    expect(field(AMOUNT)!.props.value).toBe('300');
  });

  it('a busca já tinha falhado antes de o formulário aparecer, e a lista não tem quem acabou de ser salvo: o aviso, com "Tentar de novo"', async () => {
    old([PROVIDERS_KEY], list([ZE]));
    fresh(['equipment'], [CARRO]);
    // A tela lê os aparelhos de novo ao abrir: o banco também tem o carro.
    mockNet.equipment = [CARRO];
    fail(only('service_providers'));
    await queryClient.fetchQuery({ queryKey: [PROVIDERS_KEY], queryFn: () => fetchServiceProviders() }).catch(() => undefined);
    await open(ServiceJobScreen, { id: 'novo', prestador: 'p-mec', aparelho: 'e-car' });
    expect(has(ErrorNotice)).toBe(true);
    expect(field(DESCRIPTION)).toBeUndefined();

    mockNet.providers = [ZE, OFICINA];
    online();
    await press('Tentar de novo');
    expect(has(ErrorNotice)).toBe(false);
    expect(page()).toContain('Oficina do Tonho');
    expect(page()).toContain('Carro');
  });
});

describe('a cópia para os gastos espera o prestador ou o aparelho que a tela não tem', () => {
  it('o prestador ainda chegando: a linha diz que está carregando; se falhar, o motivo e "Tentar de novo"', async () => {
    old([PROVIDERS_KEY], list([ZE]));
    fresh(['equipment'], []);
    mockNet.providers = [ZE, OFICINA];
    mockNet.jobs = [job({ provider_id: 'p-mec', description: 'Trocou a embreagem', amount: 1500 })];
    hold(only('service_providers'));
    await open(ServiceJobScreen, { id: 'j1' });
    expect(page()).toContain('Carregando o prestador deste serviço…');
    expect(page()).not.toContain('Não deu para carregar');
    expect(copySwitch()!.props).toMatchObject({ value: false, disabled: true });
    expect(button('Tentar de novo')).toBeUndefined();

    await release('fail');
    expect(page()).toContain(
      'Não deu para carregar o prestador deste serviço, e é o ofício dele que diz se o gasto entra em Moradia ou em Transporte. Tente de novo, ou lance o gasto em Finanças.',
    );
    // Quem fez o serviço não está na lista: a linha não manda escolher outra pessoa.
    expect(page()).not.toContain('escolha');
    expect(copySwitch()!.props).toMatchObject({ value: false, disabled: true });

    online();
    const before = asked('service_providers', 'select').length;
    await press('Tentar de novo');
    expect(asked('service_providers', 'select')).toHaveLength(before + 1);
    expect(page()).toContain('Oficina do Tonho');
    expect(page()).toContain('Cria um gasto novo em Transporte');
    expect(copySwitch()!.props.disabled).toBe(false);
    expect(button('Tentar de novo')).toBeUndefined();
  });

  it('o aparelho ainda chegando: a mesma coisa, e "Tentar de novo" busca o aparelho', async () => {
    fresh([PROVIDERS_KEY], list([SILVA]));
    fresh(['equipment'], [GELADEIRA]);
    mockNet.providers = [SILVA];
    mockNet.equipment = [GELADEIRA, CARRO];
    mockNet.jobs = [job({ provider_id: 'p-out', equipment_id: 'e-car', description: 'Trocou a embreagem', amount: 1500 })];
    // A lista (lida de novo ao abrir) e o aparelho sozinho, os dois ainda a caminho.
    hold(only('equipment'));
    await open(ServiceJobScreen, { id: 'j1' });
    expect(page()).toContain('Carregando o aparelho deste serviço…');
    expect(copySwitch()!.props).toMatchObject({ value: false, disabled: true });
    expect(button('Tentar de novo')).toBeUndefined();

    fail(only('equipment'));
    await release('fail');
    expect(page()).toContain(
      'Não deu para carregar o aparelho deste serviço, e é ele que diz se o gasto entra em Moradia ou em Transporte. Tente de novo, ou lance o gasto em Finanças.',
    );
    expect(page()).not.toContain('escolha');
    expect(copySwitch()!.props).toMatchObject({ value: false, disabled: true });

    online();
    await press('Tentar de novo');
    expect(page()).toContain('Carro');
    expect(page()).toContain('Cria um gasto novo em Transporte');
    expect(copySwitch()!.props.disabled).toBe(false);
    // O serviço continua no aparelho dele.
    await press('Salvar');
    expect(asked('service_jobs', 'update')[0].values).toMatchObject({ equipment_id: 'e-car' });
  });
});

describe('valor que vira R$ 0,00 ao ser guardado', () => {
  it('não oferece a cópia para os gastos, e salvar não cria gasto', async () => {
    fresh([PROVIDERS_KEY], list([ZE]));
    fresh(['equipment'], []);
    await open(ServiceJobScreen, { id: 'novo', prestador: 'p-ze' });
    await type(AMOUNT, '0,004');
    expect(copySwitch()).toBeUndefined();
    expect(page()).not.toContain(COPY);
    // Meio centavo já vira um centavo.
    await type(AMOUNT, '0,005');
    expect(copySwitch()).toBeDefined();

    await type(AMOUNT, '0,004');
    await type(DESCRIPTION, 'Apertou um parafuso');
    await press('Salvar');
    expect(asked('service_jobs', 'insert')[0].values).toMatchObject({ amount: 0 });
    expect(asked('expenses', 'insert')).toHaveLength(0);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('serviço novo aberto de um aparelho: quem fez é a pessoa que escolhe', () => {
  // A casa só cadastrou o mecânico, e o conserto é da geladeira.
  beforeEach(() => {
    mockNet.providers = [OFICINA];
    mockNet.equipment = [GELADEIRA, CARRO];
    fresh([PROVIDERS_KEY], list([OFICINA]));
    fresh(['equipment'], [GELADEIRA, CARRO]);
  });

  it('o único prestador da casa, de outro ofício, não vem escolhido: Salvar pede quem fez, e escolhido na lista ele é gravado com o aparelho', async () => {
    await open(ServiceJobScreen, { id: 'novo', aparelho: 'e1' });
    expect(page()).toContain('Escolher prestador');
    expect(page()).not.toContain('Oficina do Tonho');
    // Sem ninguém escolhido, o teclado não abre na descrição, embaixo de "Quem fez".
    expect(field(DESCRIPTION)!.props.autoFocus).toBe(false);

    await type(DESCRIPTION, 'Trocou o termostato');
    await press('Salvar');
    expect(notify).toHaveBeenCalledWith('Confira os dados', 'Escolha quem fez o serviço.');
    expect(asked('service_jobs', 'insert')).toHaveLength(0);
    expect(router.back).not.toHaveBeenCalled();

    await act(async () => picker('Quem fez o serviço')!.props.onSelect('p-mec'));
    expect(page()).toContain('Oficina do Tonho');
    await press('Salvar');
    expect(asked('service_jobs', 'insert').map((request) => request.values)).toEqual([
      expect.objectContaining({ provider_id: 'p-mec', equipment_id: 'e1', description: 'Trocou o termostato' }),
    ]);
    expect(router.back).toHaveBeenCalledTimes(1);
  });
});

describe('"Novo prestador" na lista de quem fez', () => {
  const NOTES = 'Peças trocadas, o que ficou combinado…';
  const QUESTION = 'Cadastrar um prestador novo? O que você escreveu neste serviço não fica salvo.';
  const TO_NEW = { pathname: '/prestador/[id]', params: { id: 'novo', aparelho: 'e1' } };
  /** A pessoa toca em "Cadastrar" na pergunta (o "Cancelar" só fecha a pergunta). */
  async function answerRegister() {
    await act(async () => ((confirmAction as jest.Mock).mock.calls.at(-1)?.[3] as () => void)());
  }
  async function openProviderList() {
    await act(async () => renderer!.root.findAllByType(ListRow).find((row) => row.props.title === 'Escolher prestador')!.props.onPress());
  }

  beforeEach(() => {
    mockNet.providers = [OFICINA];
    mockNet.equipment = [GELADEIRA, CARRO];
    fresh([PROVIDERS_KEY], list([OFICINA]));
    fresh(['equipment'], [GELADEIRA, CARRO]);
  });

  it('num serviço novo de um aparelho, com nada escrito: vai direto para o cadastro, com o aparelho (de lá o serviço volta com ele)', async () => {
    await open(ServiceJobScreen, { id: 'novo', aparelho: 'e1' });
    await openProviderList();
    expect(picker('Quem fez o serviço')!.props.visible).toBe(true);
    const action = newProviderAction();
    expect(action?.type).toBe(Button);
    expect(action?.props).toMatchObject({ title: 'Novo prestador', icon: 'plus' });

    await act(async () => action!.props.onPress());
    expect(confirmAction).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith(TO_NEW);
    expect(picker('Quem fez o serviço')!.props.visible).toBe(false);
  });

  it('de ponta a ponta: quem foi cadastrado volta para um serviço novo, já escolhido, com o aparelho', async () => {
    await open(ServiceJobScreen, { id: 'novo', aparelho: 'e1' });
    await act(async () => newProviderAction()!.props.onPress());
    await act(async () => renderer?.unmount());
    await open(ProviderScreen, TO_NEW.params);
    await type('Pessoa ou empresa', 'Rafa Refrigeração');
    await act(async () => renderer!.root.findAllByType(Chip).find((chip) => chip.props.label === 'Técnico de aparelhos')!.props.onPress());
    await press('Salvar prestador');
    const back = { pathname: '/servico/[id]', params: { id: 'novo', prestador: 'p-novo', aparelho: 'e1' } };
    expect(router.replace).toHaveBeenLastCalledWith(back);

    await act(async () => renderer?.unmount());
    await open(ServiceJobScreen, back.params);
    expect(page()).toContain('Rafa Refrigeração');
    expect(page()).toContain('Geladeira');
    await type(DESCRIPTION, 'Trocou o termostato');
    await type(AMOUNT, '350');
    await act(async () => copySwitch()!.props.onValueChange(true));
    await press('Salvar');
    expect(asked('service_jobs', 'insert').map((request) => request.values)).toEqual([
      expect.objectContaining({ provider_id: 'p-novo', equipment_id: 'e1', description: 'Trocou o termostato', amount: 350 }),
    ]);
    expect(asked('expenses', 'insert').map((request) => request.values)).toEqual([
      expect.objectContaining({ description: 'Trocou o termostato (Rafa Refrigeração)', category: 'moradia' }),
    ]);
  });

  it('com algo escrito, pergunta antes: "Cancelar" deixa o formulário como estava, e "Cadastrar" leva ao cadastro', async () => {
    await open(ServiceJobScreen, { id: 'novo', aparelho: 'e1' });
    await type(DESCRIPTION, 'Trocou o termostato');
    await type(AMOUNT, '350');
    await openProviderList();
    await act(async () => newProviderAction()!.props.onPress());
    expect(confirmAction).toHaveBeenCalledTimes(1);
    expect(confirmAction).toHaveBeenCalledWith('Novo prestador', QUESTION, 'Cadastrar', expect.any(Function));
    // Até a resposta, nada muda: quem cancela continua com a lista aberta e o que escreveu.
    expect(router.replace).not.toHaveBeenCalled();
    expect(picker('Quem fez o serviço')!.props.visible).toBe(true);
    expect(field(DESCRIPTION)!.props.value).toBe('Trocou o termostato');
    expect(field(AMOUNT)!.props.value).toBe('350');

    await answerRegister();
    expect(router.replace).toHaveBeenCalledWith(TO_NEW);
  });

  it.each([
    { what: 'o valor digitado', fill: () => type(AMOUNT, '350') },
    {
      what: 'a garantia de um atalho',
      fill: () => act(async () => renderer!.root.findAllByType(Chip).find((chip) => chip.props.label === '3 meses')!.props.onPress()),
    },
    { what: 'as observações escritas', fill: () => type(NOTES, 'Trocou a borracha da porta também') },
    {
      what: 'outra data',
      fill: () => act(async () => renderer!.root.findAllByType(DateField).find((date) => date.props.label === 'Data')!.props.onChangeText('10/10/2026')),
    },
  ])('só com $what, também pergunta antes', async ({ fill }) => {
    await open(ServiceJobScreen, { id: 'novo', aparelho: 'e1' });
    await fill();
    await act(async () => newProviderAction()!.props.onPress());
    expect(confirmAction).toHaveBeenCalledWith('Novo prestador', QUESTION, 'Cadastrar', expect.any(Function));
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('o que foi apagado de novo não conta: só espaços, ou o campo esvaziado, vai direto', async () => {
    await open(ServiceJobScreen, { id: 'novo', aparelho: 'e1' });
    await type(DESCRIPTION, 'Trocou');
    await type(DESCRIPTION, '');
    await type(NOTES, '   ');
    await act(async () => newProviderAction()!.props.onPress());
    expect(confirmAction).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith(TO_NEW);
  });

  it('vai com o aparelho escolhido no formulário: outro aparelho, ou nenhum', async () => {
    await open(ServiceJobScreen, { id: 'novo', aparelho: 'e1' });
    await act(async () => picker('Em qual aparelho')!.props.onSelect('e-car'));
    await act(async () => newProviderAction()!.props.onPress());
    expect(router.replace).toHaveBeenLastCalledWith({ pathname: '/prestador/[id]', params: { id: 'novo', aparelho: 'e-car' } });

    await act(async () => picker('Em qual aparelho')!.props.onSelect('nenhum'));
    await act(async () => newProviderAction()!.props.onPress());
    expect(router.replace).toHaveBeenLastCalledWith({ pathname: '/prestador/[id]', params: { id: 'novo' } });
  });

  it('num serviço novo aberto da tela de um prestador, também: quem fez pode ser outra pessoa', async () => {
    await open(ServiceJobScreen, { id: 'novo', prestador: 'p-mec' });
    expect(page()).toContain('Oficina do Tonho');
    await act(async () => newProviderAction()!.props.onPress());
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/prestador/[id]', params: { id: 'novo' } });
  });

  it('num serviço que já existe, não há: trocar de tela deixaria para trás o serviço aberto', async () => {
    mockNet.jobs = [job({ provider_id: 'p-mec', equipment_id: 'e1' })];
    await open(ServiceJobScreen, { id: 'j1' });
    expect(field(DESCRIPTION)!.props.value).toBe('Trocou o disjuntor');
    expect(newProviderAction()).toBeFalsy();
  });

  it('enquanto o Salvar grava, não há: o serviço escrito está sendo salvo', async () => {
    await open(ServiceJobScreen, { id: 'novo', aparelho: 'e1' });
    await act(async () => picker('Quem fez o serviço')!.props.onSelect('p-mec'));
    await type(DESCRIPTION, 'Trocou o termostato');
    hold((request) => request.verb === 'insert');
    await press('Salvar');
    expect(mockNet.held).toHaveLength(1);
    expect(newProviderAction()).toBeFalsy();

    online();
    await release('ok');
    expect(asked('service_jobs', 'insert')).toHaveLength(1);
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('a tela do serviço fechada enquanto o Salvar grava', () => {
  beforeEach(() => {
    fresh([PROVIDERS_KEY], list([ZE]));
    fresh(['equipment'], []);
  });

  /** Salvar com a gravação segura; a pessoa fecha a tela (arrasta para baixo, ou o voltar do Android), e aí ela chega. */
  async function saveThenClose(how: 'ok' | 'fail' = 'ok') {
    hold((request) => request.verb === 'insert');
    await press('Salvar');
    expect(mockNet.held).toHaveLength(1);
    expect(router.back).not.toHaveBeenCalled();
    await act(async () => renderer?.unmount());
    renderer = undefined;
    online();
    await release(how);
  }

  it('o serviço é gravado, e a tela que estava embaixo não fecha', async () => {
    await open(ServiceJobScreen, { id: 'novo', prestador: 'p-ze' });
    await type(DESCRIPTION, 'Trocou o disjuntor');
    await saveThenClose();
    expect(asked('service_jobs', 'insert').map((request) => request.values)).toEqual([
      expect.objectContaining({ provider_id: 'p-ze', description: 'Trocou o disjuntor' }),
    ]);
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('com a cópia ligada, o gasto pedido também é gravado, e a tela de baixo não fecha', async () => {
    await open(ServiceJobScreen, { id: 'novo', prestador: 'p-ze' });
    await type(DESCRIPTION, 'Trocou o disjuntor');
    await type(AMOUNT, '180');
    await act(async () => copySwitch()!.props.onValueChange(true));
    await saveThenClose();
    expect(asked('service_jobs', 'insert')).toHaveLength(1);
    expect(asked('expenses', 'insert').map((request) => request.values)).toEqual([
      expect.objectContaining({ description: 'Trocou o disjuntor (Zé Eletricista)', amount: 180, category: 'moradia' }),
    ]);
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('o gasto falha depois de a tela fechar: o aviso aparece do mesmo jeito, e a tela de baixo não fecha', async () => {
    await open(ServiceJobScreen, { id: 'novo', prestador: 'p-ze' });
    await type(DESCRIPTION, 'Trocou o disjuntor');
    await type(AMOUNT, '180');
    await act(async () => copySwitch()!.props.onValueChange(true));
    hold((request) => request.verb === 'insert');
    await press('Salvar');
    await act(async () => renderer?.unmount());
    renderer = undefined;
    // O serviço chega; o gasto, que sai depois dele, falha.
    fail((request) => request.table === 'expenses');
    await release('ok');
    expect(asked('service_jobs', 'insert')).toHaveLength(1);
    expect(asked('expenses', 'insert')).toHaveLength(1);
    expect(notify).toHaveBeenCalledWith('O serviço foi salvo, mas o gasto não', 'TypeError: Network request failed Lance o gasto em Finanças.');
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('a gravação falha depois de a tela fechar: o aviso aparece do mesmo jeito', async () => {
    await open(ServiceJobScreen, { id: 'novo', prestador: 'p-ze' });
    await type(DESCRIPTION, 'Trocou o disjuntor');
    await saveThenClose('fail');
    expect(notify).toHaveBeenCalledWith('Não deu para salvar', expect.any(String));
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('um serviço que já existe, editado: a mesma coisa', async () => {
    mockNet.jobs = [job()];
    await open(ServiceJobScreen, { id: 'j1' });
    await type(AMOUNT, '250,00');
    hold((request) => request.verb === 'update');
    await press('Salvar');
    expect(mockNet.held).toHaveLength(1);
    await act(async () => renderer?.unmount());
    renderer = undefined;
    online();
    await release('ok');
    expect(asked('service_jobs', 'update')[0].values).toMatchObject({ amount: 250 });
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('excluir o prestador', () => {
  const asks = () => (confirmAction as jest.Mock).mock.calls.at(-1)?.[1];
  const whole = 'Excluir Zé Eletricista e todo o histórico de serviços? Não dá para desfazer. Os gastos já lançados em Finanças continuam lá.';
  const one = 'Excluir Zé Eletricista e o serviço registrado? Não dá para desfazer. Os gastos já lançados em Finanças continuam lá.';
  /** A pessoa toca em "Excluir" na pergunta. */
  async function confirm() {
    await act(async () => ((confirmAction as jest.Mock).mock.calls.at(-1)?.[3] as () => void)());
    await settle();
  }
  const deletes = () => asked('delete_service_provider', 'rpc').map((request) => request.values);

  beforeEach(() => {
    fresh([PROVIDERS_KEY], list([ZE]));
    fresh(['equipment'], []);
  });

  it('os serviços guardados são de antes e os novos ainda não chegaram: a pergunta fala do histórico todo', async () => {
    old([JOBS_KEY, 'provider', 'p-ze'], list([]));
    mockNet.jobs = [job()];
    hold(only('service_jobs'));
    await open(ProviderScreen, { id: 'p-ze' });
    await press('Excluir prestador');
    expect(asks()).toBe(whole);

    // O toque seguinte busca de novo (ver abaixo): agora a rede responde.
    online();
    await release('ok');
    await press('Excluir prestador');
    expect(asks()).toBe(one);
  });

  it('a lista guardada há segundos não vale: a tela busca os serviços de novo ao abrir, e a pergunta conta o que veio', async () => {
    fresh([JOBS_KEY, 'provider', 'p-ze'], { ...list([]), total: 0 });
    mockNet.jobs = [job({ description: 'Trocou o quadro de luz', amount: 1500 })];
    await open(ProviderScreen, { id: 'p-ze' });
    expect(asked('service_jobs', 'select')).toHaveLength(1);
    expect(page()).toContain('Trocou o quadro de luz');
    await press('Excluir prestador');
    expect(asks()).toBe(one);
  });

  it('com a tela aberta, outro celular registra um serviço: o toque busca de novo, a pergunta conta o novo, e o banco confere esse número', async () => {
    await open(ProviderScreen, { id: 'p-ze' });
    expect(page()).toContain('Nenhum serviço registrado ainda.');
    mockNet.jobs = [job({ description: 'Instalou o chuveiro novo', amount: 350 })];
    const before = asked('service_jobs', 'select').length;
    await press('Excluir prestador');
    expect(asked('service_jobs', 'select')).toHaveLength(before + 1);
    expect(asks()).toBe(one);
    expect(page()).toContain('Instalou o chuveiro novo');

    await confirm();
    expect(deletes()).toEqual([{ p_id: 'p-ze', p_expected_jobs: 1 }]);
    expect(asked('service_providers', 'delete')).toHaveLength(0);
    expect(mockNet.providers).toEqual([]);
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(notify).not.toHaveBeenCalled();
  });

  it('outro celular registra um serviço entre a pergunta e o "Excluir": o banco recusa, nada é excluído, e o histórico vem de novo', async () => {
    await open(ProviderScreen, { id: 'p-ze' });
    await press('Excluir prestador');
    expect(asks()).toBe('Excluir Zé Eletricista?');

    mockNet.jobs = [job({ description: 'Instalou o chuveiro novo', amount: 350 })];
    await confirm();
    expect(deletes()).toEqual([{ p_id: 'p-ze', p_expected_jobs: 0 }]);
    expect(notify).toHaveBeenCalledWith('Não deu para excluir', PROVIDER_JOBS_CHANGED);
    expect(mockNet.providers).toEqual([ZE]);
    expect(router.back).not.toHaveBeenCalled();
    expect(page()).toContain('Instalou o chuveiro novo');

    // A próxima pergunta já conta o serviço novo, e aí o banco aceita.
    await press('Excluir prestador');
    expect(asks()).toBe(one);
    await confirm();
    expect(deletes().at(-1)).toEqual({ p_id: 'p-ze', p_expected_jobs: 1 });
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('a pergunta que falou do histórico todo vai ao banco sem número: sai o que houver', async () => {
    old([JOBS_KEY, 'provider', 'p-ze'], list([]));
    mockNet.jobs = [job()];
    hold(only('service_jobs'));
    await open(ProviderScreen, { id: 'p-ze' });
    await press('Excluir prestador');
    expect(asks()).toBe(whole);
    await confirm();
    expect(deletes()).toEqual([{ p_id: 'p-ze', p_expected_jobs: null }]);
    expect(mockNet.jobs).toEqual([]);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('sem internet: o toque não busca, e a lista guardada não vale como "nenhum serviço"', async () => {
    fresh([JOBS_KEY, 'provider', 'p-ze'], { ...list([]), total: 0 });
    onlineManager.setOnline(false);
    await open(ProviderScreen, { id: 'p-ze' });
    await press('Excluir prestador');
    expect(asks()).toBe(whole);
    expect(asked('service_jobs', 'select')).toHaveLength(0);
  });

  it('a busca do toque não responde: o botão espera, e depois do prazo a pergunta fala do histórico todo', async () => {
    await open(ProviderScreen, { id: 'p-ze' });
    hold(only('service_jobs'));
    jest.useFakeTimers();
    try {
      await act(async () => {
        button('Excluir prestador')!.props.onPress();
        await jest.advanceTimersByTimeAsync(DELETE_CHECK_MS - 1);
      });
      expect(confirmAction).not.toHaveBeenCalled();
      expect(button('Excluir prestador')!.props.loading).toBe(true);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1);
      });
      expect(asks()).toBe(whole);
      expect(button('Excluir prestador')!.props.loading).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('a pessoa sai da tela enquanto o toque busca: a pergunta não aparece depois, em outra tela', async () => {
    await open(ProviderScreen, { id: 'p-ze' });
    hold(only('service_jobs'));
    await press('Excluir prestador');
    expect(confirmAction).not.toHaveBeenCalled();
    await act(async () => renderer?.unmount());
    renderer = undefined;
    await release('ok');
    expect(confirmAction).not.toHaveBeenCalled();
  });

  it('a busca dos serviços falhou: a lista de antes não vale como "nenhum serviço"', async () => {
    old([JOBS_KEY, 'provider', 'p-ze'], list([]));
    mockNet.jobs = [job()];
    fail(only('service_jobs'));
    await open(ProviderScreen, { id: 'p-ze' });
    await press('Excluir prestador');
    expect(asks()).toBe(whole);
  });

  it('os serviços chegaram e não há nenhum: a pergunta curta', async () => {
    await open(ProviderScreen, { id: 'p-ze' });
    await press('Excluir prestador');
    expect(asks()).toBe('Excluir Zé Eletricista?');
  });
});

describe('uma atualização que falha não tira da frente o que já estava carregado', () => {
  const STALE = 'Não foi possível atualizar. Mostrando o que já estava carregado.';

  it('a lista de prestadores: puxar para atualizar falhou, e ela continua, com o aviso e "Tentar de novo"', async () => {
    fresh([PROVIDERS_KEY], list([ZE]));
    await open(ProvidersScreen, {});
    expect(page()).toContain('Zé Eletricista');

    fail(only('service_providers'));
    await act(async () => renderer!.root.findByType(Screen).props.onRefresh());
    await settle();
    expect(has(ErrorNotice)).toBe(false);
    expect(page()).toContain('Zé Eletricista');
    expect(page()).toContain(STALE);

    mockNet.providers = [ZE, OFICINA];
    online();
    const before = asked('service_providers', 'select').length;
    await press('Tentar de novo');
    expect(asked('service_providers', 'select')).toHaveLength(before + 1);
    expect(has(StaleNotice)).toBe(false);
    expect(page()).toContain('Oficina do Tonho');
  });

  it('a lista de prestadores sem nada guardado e a busca falhou: o aviso de erro, com "Tentar de novo"', async () => {
    fail(only('service_providers'));
    await open(ProvidersScreen, {});
    expect(has(ErrorNotice)).toBe(true);
    expect(has(StaleNotice)).toBe(false);

    online();
    await press('Tentar de novo');
    expect(has(ErrorNotice)).toBe(false);
    expect(page()).toContain('Zé Eletricista');
  });

  it('os serviços na tela do prestador: a busca falhou, e os que estavam continuam, com o aviso', async () => {
    fresh([PROVIDERS_KEY], list([ZE]));
    fresh(['equipment'], []);
    old([JOBS_KEY, 'provider', 'p-ze'], list([job()]));
    fail(only('service_jobs'));
    await open(ProviderScreen, { id: 'p-ze' });
    expect(has(ErrorNotice)).toBe(false);
    expect(page()).toContain('Trocou o disjuntor');
    expect(page()).toContain(STALE);

    mockNet.jobs = [job(), job({ id: 'j2', description: 'Trocou a tomada', done_on: '2026-10-01' })];
    online();
    await press('Tentar de novo');
    expect(has(StaleNotice)).toBe(false);
    expect(page()).toContain('Trocou a tomada');
  });

  it('os serviços na tela do prestador, sem nada guardado: o aviso de erro no lugar deles', async () => {
    fresh([PROVIDERS_KEY], list([ZE]));
    fresh(['equipment'], []);
    fail(only('service_jobs'));
    await open(ProviderScreen, { id: 'p-ze' });
    expect(has(ErrorNotice)).toBe(true);
    expect(has(StaleNotice)).toBe(false);
  });
});

describe('a busca na lista de prestadores', () => {
  const nine = Array.from({ length: 9 }, (_, n) => provider(`p${n + 1}`, `Prestador ${n + 1}`, 'eletricista'));
  const found = 'Trocou a borracha · Geladeira · 01/09/2026 · R$ 90,00';

  beforeEach(() => {
    mockNet.providers = nine;
    mockNet.equipment = [GELADEIRA];
    mockNet.jobs = [job({ provider_id: 'p3', equipment_id: 'e1', description: 'Trocou a borracha', amount: 90 })];
  });

  it('os serviços ainda chegando: diz que ainda busca neles, e não "Nada encontrado"', async () => {
    hold(only('service_jobs'));
    await open(ProvidersScreen, {});
    await type(SEARCH, 'geladeira');
    expect(page()).toContain('Buscando também nos serviços…');
    expect(page()).not.toContain('Nada encontrado');

    await release('ok');
    expect(page()).toContain('Prestador 3');
    expect(page()).toContain(found);
  });

  it('os serviços não chegaram: diz onde a busca olhou, e puxar para atualizar busca de novo', async () => {
    fail(only('service_jobs'));
    await open(ProvidersScreen, {});
    await type(SEARCH, 'borracha');
    expect(page()).toContain('Não deu para buscar nos serviços: a busca olhou só o nome e o ofício. Puxe para atualizar.');
    expect(page()).not.toContain('Nada encontrado');

    online();
    await act(async () => renderer!.root.findByType(Screen).props.onRefresh());
    await settle();
    expect(page()).toContain(found);
  });

  it('os aparelhos não chegaram: diz que não olhou o nome deles, e puxar para atualizar busca os aparelhos também', async () => {
    fail(only('equipment'));
    await open(ProvidersScreen, {});
    await type(SEARCH, 'geladeira');
    expect(page()).toContain('Não deu para buscar nos aparelhos: a busca não olhou o nome deles. Puxe para atualizar.');
    expect(page()).not.toContain('Nada encontrado');

    online();
    await act(async () => renderer!.root.findByType(Screen).props.onRefresh());
    await settle();
    expect(page()).toContain(found);
  });

  it('tudo chegou e ninguém combina: "Nada encontrado"', async () => {
    await open(ProvidersScreen, {});
    await type(SEARCH, 'piscina');
    expect(page()).toContain('Nada encontrado para “piscina”.');
  });

  it('com os serviços de uma visita anterior: busca também neles enquanto a nova busca anda, e avisa se ela falhar', async () => {
    // Guardados há dez minutos, sem o conserto que outro celular registrou depois.
    old([JOBS_KEY], list([]));
    fresh(['equipment'], [GELADEIRA]);
    hold(only('service_jobs'));
    await open(ProvidersScreen, {});
    await type(SEARCH, 'geladeira');
    expect(page()).toContain('Buscando também nos serviços…');
    expect(page()).not.toContain('Nada encontrado');

    await release('fail');
    expect(page()).toContain('Não deu para buscar nos serviços: a busca olhou só o nome e o ofício. Puxe para atualizar.');
    expect(page()).not.toContain('Nada encontrado');
    expect(has(StaleNotice)).toBe(true);

    online();
    await press('Tentar de novo');
    expect(page()).toContain('Prestador 3');
    expect(page()).toContain(found);
    expect(has(StaleNotice)).toBe(false);
  });
});

describe('Casa → Aparelhos: uma atualização que falha não tira a lista da frente', () => {
  async function openPanel() {
    await act(async () => {
      renderer = create(
        <QueryClientProvider client={queryClient}>
          <EquipmentPanel />
        </QueryClientProvider>,
      );
    });
    await settle();
  }

  beforeEach(() => {
    fresh([PROVIDERS_KEY], list([ZE]));
    fresh([JOBS_KEY], list([]));
    fresh(['chores'], []);
  });

  it('a lista guardada e a busca de novo falhou: os aparelhos continuam, com o aviso e "Tentar de novo"', async () => {
    fresh(['equipment'], [GELADEIRA]);
    await openPanel();
    expect(page()).toContain('Geladeira');

    // Outra tela (a do serviço) leu os aparelhos de novo, e a busca falhou.
    fail(only('equipment'));
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['equipment'] });
    });
    await settle();
    expect(has(ErrorNotice)).toBe(false);
    expect(page()).toContain('Geladeira');
    expect(has(StaleNotice)).toBe(true);

    mockNet.equipment = [GELADEIRA, CARRO];
    online();
    await press('Tentar de novo');
    expect(has(StaleNotice)).toBe(false);
    expect(page()).toContain('Carro');
  });

  it('nada guardado e a busca falhou: o aviso de erro, com "Tentar de novo"', async () => {
    fail(only('equipment'));
    await openPanel();
    expect(has(ErrorNotice)).toBe(true);
    expect(has(StaleNotice)).toBe(false);

    mockNet.equipment = [GELADEIRA];
    online();
    await press('Tentar de novo');
    expect(has(ErrorNotice)).toBe(false);
    expect(page()).toContain('Geladeira');
  });
});

describe('a seção de consertos na tela do aparelho, antes da migração', () => {
  async function openSection() {
    await act(async () => {
      renderer = create(
        <QueryClientProvider client={queryClient}>
          <EquipmentServices equipmentId="e1" today="2026-10-14" />
        </QueryClientProvider>,
      );
    });
    await settle();
  }

  it('a lista de prestadores já disse que o banco não tem as tabelas: a seção não aparece nem enquanto a busca dos serviços anda', async () => {
    fresh([PROVIDERS_KEY], { rows: [], missing: true });
    hold(only('service_jobs'));
    await openSection();
    expect(mockNet.held).toHaveLength(1);
    expect(page()).not.toContain('Consertos e serviços');
    expect(button('Registrar serviço')).toBeUndefined();
  });

  it('com as tabelas no banco, a seção aparece já enquanto a busca dos serviços anda', async () => {
    fresh([PROVIDERS_KEY], list([ZE]));
    hold(only('service_jobs'));
    await openSection();
    expect(page()).toContain('Consertos e serviços');
    expect(button('Registrar serviço')).toBeDefined();
  });

  it('a busca deste aparelho já respondeu que as tabelas existem: vale mais que a lista guardada de antes da migração', async () => {
    fresh([PROVIDERS_KEY], { rows: [], missing: true });
    mockNet.jobs = [job({ equipment_id: 'e1', description: 'Trocou a borracha' })];
    await openSection();
    expect(page()).toContain('Consertos e serviços');
    expect(page()).toContain('Trocou a borracha');
  });

  it('a busca deste aparelho respondeu que o banco não tem as tabelas: a seção some', async () => {
    fresh([PROVIDERS_KEY], list([ZE]));
    hold(only('service_jobs'));
    await openSection();
    const held = mockNet.held.splice(0);
    await act(async () => {
      for (const { settle: answer } of held) {
        answer({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.service_jobs' in the schema cache" } });
      }
    });
    await settle();
    expect(page()).not.toContain('Consertos e serviços');
  });
});

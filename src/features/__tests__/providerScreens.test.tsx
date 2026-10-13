import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { ComponentType } from 'react';
import { Switch } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import ProviderScreen from '@/app/prestador/[id]';
import ProvidersScreen from '@/app/prestadores';
import ServiceJobScreen from '@/app/servico/[id]';
import { fetchServiceProviders, JOBS_KEY, PROVIDERS_KEY } from '@/data/providers';
import type { Equipment, ServiceJob, ServiceProvider } from '@/lib/types';
import { confirmAction, notify } from '@/ui/dialogs';
import { Button, ErrorNotice, Loading, Screen, TextField } from '@/ui/primitives';

// As telas dos prestadores de verdade, com as buscas de verdade e o cache de verdade, em cima de um banco de
// mentira: o que se confere aqui é o que cada tela faz enquanto uma busca anda, quando ela falha e quando o que
// está guardado é de antes. As regras de domain/ não enxergam nada disso.

type Result = { data: unknown; error: unknown };
interface Request {
  table: string;
  verb: 'select' | 'insert' | 'update' | 'delete';
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
  if (verb === 'insert') {
    if (table === 'service_jobs') mockNet.jobs.push({ id: 'j-novo', created_at: '2026-10-13T12:00:00Z', ...values } as ServiceJob);
    return { data: { id: table === 'service_jobs' ? 'j-novo' : 'novo' }, error: null };
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
    return { data: rows, error: null };
  }
  if (table === 'equipment') {
    if (!request.one) return { data: mockNet.equipment, error: null };
    const row = mockNet.equipment.find((item) => item.id === filters.id);
    return row ? { data: row, error: null } : { data: null, error: { code: 'PGRST116', message: 'Cannot coerce the result to a single JSON object' } };
  }
  return { data: [], error: null };
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
        then: (resolve: (result: Result) => unknown, reject: (error: unknown) => unknown) => {
          mockNet.asked.push(request);
          const mode = mockNet.mode(request);
          const answer =
            mode === 'hold'
              ? new Promise<Result>((settle) => mockNet.held.push({ request, settle }))
              : Promise.resolve(mode === 'fail' ? { data: null, error: { message: 'TypeError: Network request failed' } } : mockAnswer(request));
          return answer.then(resolve, reject);
        },
      };
      return query;
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
jest.mock('@/ui/art', () => ({ Mascot: () => null, Spot: () => null }));
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

describe('salvar o serviço', () => {
  beforeEach(async () => {
    fresh([PROVIDERS_KEY], list([ZE]));
    fresh(['equipment'], []);
    mockNet.jobs = [job()];
    await open(ServiceJobScreen, { id: 'j1' });
    await type(AMOUNT, '250,00');
  });

  it('espera o serviço salvo voltar para o cache antes de fechar, com o formulário na frente', async () => {
    hold(only('service_jobs', true));
    await press('Salvar');
    expect(asked('service_jobs', 'update')[0].values).toMatchObject({ amount: 250 });
    // A busca do serviço salvo ainda anda: a tela não fechou, e o formulário não virou "carregando".
    expect(router.back).not.toHaveBeenCalled();
    expect(has(Loading)).toBe(false);
    expect(field(AMOUNT)!.props.value).toBe('250,00');

    await release('ok');
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData<ServiceJob>([JOBS_KEY, 'job', 'j1'])?.amount).toBe(250);
    expect(notify).not.toHaveBeenCalled();
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
    // O que ficou guardado é o serviço de antes de salvar (R$ 180,00).
    expect(queryClient.getQueryData<ServiceJob>([JOBS_KEY, 'job', 'j1'])?.amount).toBe(180);

    hold(only('service_jobs', true));
    await open(ServiceJobScreen, { id: 'j1' });
    expect(has(Loading)).toBe(true);
    expect(field(AMOUNT)).toBeUndefined();

    online();
    await release('ok');
    expect(field(AMOUNT)!.props.value).toBe('250,00');
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
    hold(only('equipment', true));
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
    await open(ServiceJobScreen, { id: 'novo' });
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

describe('excluir o prestador', () => {
  const asks = () => (confirmAction as jest.Mock).mock.calls.at(-1)?.[1];
  const whole = 'Excluir Zé Eletricista e todo o histórico de serviços? Não dá para desfazer. Os gastos já lançados em Finanças continuam lá.';

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

    await release('ok');
    await press('Excluir prestador');
    expect(asks()).toBe('Excluir Zé Eletricista e o serviço registrado? Não dá para desfazer. Os gastos já lançados em Finanças continuam lá.');
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
});

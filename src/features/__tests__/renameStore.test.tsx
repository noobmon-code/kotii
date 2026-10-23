import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { fetchStores } from '@/data/market';
import { canRenameStore, STORE_CHAIN_TITLE, STORE_RENAME_GONE, STORE_RENAME_LABEL, STORE_STANDARD_GONE, STORE_STANDARD_LINE } from '@/domain/storeName';
import { RenameStoreModal } from '@/features/RenameStoreModal';
import type { Store } from '@/lib/types';
import { notify } from '@/ui/dialogs';
import { Button, CheckCircle, TextField } from '@/ui/primitives';

// Dar outro nome ao mercado, com o banco de mentira fazendo o que o gatilho faz (o nome impresso guardado na
// primeira troca, limpo na volta a ele): o que é gravado, as lojas da mesma empresa e o que a tela busca de novo.

type Row = Store & Record<string, unknown>;
// "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockDb = {
  stores: [] as Row[],
  /** O banco antes da migração 20261022170000: a coluna do nome impresso não existe. */
  noPrintedColumn: false,
  /** O banco antes da migração 20261023120000: o nome padrão não existe. */
  noStandardColumn: false,
  updates: [] as { values: Record<string, unknown>; ids: string[] }[],
  reads: [] as string[],
  /** O nome padrão de cada CNPJ no banco agora (o que a lista tem pode ser de antes). */
  standards: {} as Record<string, string>,
  /** As chamadas de follow_store_standard. */
  follows: [] as string[],
  /** A leitura falha por outro motivo. */
  failOther: false,
  /** A gravação segura no caminho (a resposta só vem quando o teste solta). */
  hold: null as Promise<void> | null,
};
jest.mock('@/lib/supabase', () => {
  const table = () => {
    let columns = '';
    let update: Record<string, unknown> | null = null;
    let ids: string[] = [];
    const run = async () => {
      if (update) {
        if (mockDb.hold) await mockDb.hold;
        const found = mockDb.stores.filter((s) => ids.includes(s.id));
        mockDb.updates.push({ values: update, ids });
        // O gatilho stores_keep_printed_name.
        for (const store of found) {
          const name = update.name as string;
          if (name === store.name) continue;
          const base = store.printed_name ?? store.name;
          store.printed_name = name === base ? null : base;
          store.name = name;
        }
        return { data: found.map((s) => ({ id: s.id })), error: null };
      }
      mockDb.reads.push(columns);
      if (mockDb.failOther) return { data: null, error: { code: '42501', message: 'permission denied for table stores' } };
      if (mockDb.noPrintedColumn && columns.includes('printed_name')) {
        return { data: null, error: { code: '42703', message: 'column stores.printed_name does not exist' } };
      }
      if (mockDb.noStandardColumn && columns.includes('standard_name')) {
        return { data: null, error: { code: '42703', message: 'column stores.standard_name does not exist' } };
      }
      const keys = columns.split(',').map((c) => c.trim());
      return { data: mockDb.stores.map((s) => Object.fromEntries(keys.map((k) => [k, s[k]]))), error: null };
    };
    const builder: Record<string, unknown> = {
      select: (cols: string) => {
        if (!update) columns = cols;
        return builder;
      },
      order: () => builder,
      update: (values: Record<string, unknown>) => {
        update = values;
        return builder;
      },
      in: (_column: string, values: string[]) => {
        ids = values;
        return builder;
      },
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => run().then(resolve, reject),
    };
    return builder;
  };
  /** follow_store_standard: o nome padrão de agora, no mercado da casa, com o nome de antes guardado. */
  const rpc = async (name: string, args: { p_store_id: string }) => {
    if (name !== 'follow_store_standard') throw new Error(`rpc inesperada: ${name}`);
    mockDb.follows.push(args.p_store_id);
    const store = mockDb.stores.find((s) => s.id === args.p_store_id);
    const standard = store?.cnpj ? mockDb.standards[store.cnpj] : undefined;
    if (!store || !standard || store.name === standard) return { data: [], error: null };
    const base = store.printed_name ?? store.name;
    store.printed_name = standard === base ? null : base;
    store.name = standard;
    store.standard_name = standard;
    return { data: [store.id], error: null };
  };
  return {
    supabase: { from: () => table(), rpc },
    unwrap: (result: { data: unknown; error: unknown }) => {
      if (result.error) throw result.error;
      return result.data;
    },
    errorMessage: (error: unknown) => (error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error)),
  };
});
jest.mock('@/ui/dialogs', () => ({ notify: jest.fn() }));
jest.mock('@/ui/Backdrop', () => ({ Backdrop: () => null }));
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => ({ __esModule: true, default: () => null }));

const CBD = 'COMPANHIA BRASILEIRA DE DISTRIBUICAO';
const store = (id: string, name: string, cnpj: string | null, patch: Partial<Row> = {}): Row => ({
  id,
  name,
  cnpj,
  address: null,
  printed_name: null,
  standard_name: null,
  ...patch,
});

/** As buscas que mostram o nome do mercado, já na memória: depois de renomear, todas são buscadas de novo. */
const SHOWING_NAMES = [['stores'], ['receipts', 'history'], ['receipt', 'r1'], ['spending', 'market', '2026-10'], ['purchaseRecords'], ['priceHistory', 'purchases', 'p1'], ['mergeFacts', 'p1', 'p2']];

let client: QueryClient;
let renderer: ReactTestRenderer | undefined;
let closed = 0;

const rawText = (node: ReactTestInstance | string): string => (typeof node === 'string' ? node : node.children.map(rawText).join(''));
const page = () => rawText(renderer!.root);
const button = (title: string) => renderer!.root.findAllByType(Button).find((entry) => entry.props.title === title);
const nameField = () => renderer!.root.findAllByType(TextField).find((entry) => entry.props.label === STORE_RENAME_LABEL)!;
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

async function open(target: Row, stores: Row[] = mockDb.stores) {
  await act(async () => {
    renderer = create(
      <QueryClientProvider client={client}>
        <RenameStoreModal store={target} stores={stores} onClose={() => (closed += 1)} />
      </QueryClientProvider>,
    );
  });
}
async function type(text: string) {
  await act(async () => nameField().props.onChangeText(text));
}
async function press(title: string) {
  const target = button(title);
  expect(target).toBeDefined();
  await act(async () => target!.props.onPress());
  await settle();
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
  for (const key of SHOWING_NAMES) client.setQueryData(key, []);
  mockDb.stores = [];
  mockDb.noPrintedColumn = false;
  mockDb.noStandardColumn = false;
  mockDb.failOther = false;
  mockDb.standards = {};
  mockDb.follows = [];
  mockDb.updates = [];
  mockDb.reads = [];
  mockDb.hold = null;
  closed = 0;
  jest.mocked(notify).mockReset();
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  client.clear();
});

describe('renomear o mercado', () => {
  it('grava o nome para a casa, o banco guarda o da nota, e o que mostra o nome é buscado de novo', async () => {
    mockDb.stores = [store('s1', CBD, '47508411114402', { address: 'Av. Epitácio Pessoa, 4200' })];
    await open(mockDb.stores[0]);
    // Ainda sem nome trocado: nada de "Na nota", nem "Voltar".
    expect(page()).toContain('Av. Epitácio Pessoa, 4200');
    expect(page()).not.toContain('Na nota:');
    expect(nameField().props.value).toBe(CBD);
    expect(nameField().props.hint).toBe('Vale para toda a casa. O nome que vem na nota fica guardado.');
    expect(button('Voltar ao nome da nota')).toBeUndefined();
    await type('  Pão   de Açúcar ');
    await press('Salvar');
    expect(mockDb.updates).toEqual([{ values: { name: 'Pão de Açúcar' }, ids: ['s1'] }]);
    expect(mockDb.stores[0]).toMatchObject({ name: 'Pão de Açúcar', printed_name: CBD });
    expect(closed).toBe(1);
    expect(SHOWING_NAMES.filter((key) => !client.getQueryState(key)?.isInvalidated)).toEqual([]);
  });

  it('as outras lojas da mesma empresa aparecem para marcar: só a marcada vai junto, e a de outra empresa nem aparece', async () => {
    mockDb.stores = [
      store('s1', CBD, '47508411114402'),
      store('s2', CBD, '47508411000999', { address: 'Rua do Extra, 10' }),
      store('s3', CBD, '47508411000888', { address: 'Av. do Minuto, 5' }),
      store('s4', 'SUPERMERCADOS MANAIRA LTDA', '09143892000154'),
    ];
    await open(mockDb.stores[0]);
    expect(page()).toContain(STORE_CHAIN_TITLE);
    const marks = () => renderer!.root.findAllByType(CheckCircle);
    expect(marks().map((mark) => mark.props.label)).toEqual([
      `Usar o nome novo também em ${CBD}, Rua do Extra, 10`,
      `Usar o nome novo também em ${CBD}, Av. do Minuto, 5`,
    ]);
    expect(marks().map((mark) => mark.props.checked)).toEqual([false, false]);
    await act(async () => marks()[0].props.onPress());
    expect(marks().map((mark) => mark.props.checked)).toEqual([true, false]);
    await type('Pão de Açúcar');
    await press('Salvar');
    expect(mockDb.updates).toEqual([{ values: { name: 'Pão de Açúcar' }, ids: ['s1', 's2'] }]);
    expect(mockDb.stores.map((s) => s.name)).toEqual(['Pão de Açúcar', 'Pão de Açúcar', CBD, 'SUPERMERCADOS MANAIRA LTDA']);
  });

  it('sem CNPJ, ou sem outra loja da empresa, não há o que marcar', async () => {
    mockDb.stores = [store('s1', 'Feira do bairro', null), store('s2', 'Outra feira', null)];
    await open(mockDb.stores[0]);
    expect(page()).not.toContain(STORE_CHAIN_TITLE);
  });

  it('nome vazio avisa e não grava; o nome de agora fecha sem gravar', async () => {
    mockDb.stores = [store('s1', 'Assaí', '06057223000171')];
    await open(mockDb.stores[0]);
    await type('   ');
    await press('Salvar');
    expect(page()).toContain('Escreva o nome do mercado.');
    expect(mockDb.updates).toEqual([]);
    expect(closed).toBe(0);
    await type('x'.repeat(61));
    await press('Salvar');
    expect(page()).toContain('Use até 60 letras.');
    await type(' Assaí ');
    await press('Salvar');
    expect(mockDb.updates).toEqual([]);
    expect(closed).toBe(1);
  });

  it('com o nome trocado: mostra o da nota, e "Voltar ao nome da nota" grava esse nome (o banco limpa o guardado)', async () => {
    mockDb.stores = [store('s1', 'Pão de Açúcar', '47508411114402', { printed_name: CBD })];
    await open(mockDb.stores[0]);
    expect(page()).toContain(`Na nota: ${CBD}`);
    await press('Voltar ao nome da nota');
    expect(mockDb.updates).toEqual([{ values: { name: CBD }, ids: ['s1'] }]);
    expect(mockDb.stores[0]).toMatchObject({ name: CBD, printed_name: null });
    expect(closed).toBe(1);
  });

  it('o nome da nota volta como está, também com mais de 60 letras ou espaços repetidos (o banco o compara letra por letra)', async () => {
    const long = 'COMERCIO VAREJISTA DE GENEROS ALIMENTICIOS SAO JOSE DO BAIRRO LTDA';
    const spaced = 'PADARIA  SAO JOSE';
    mockDb.stores = [store('s1', 'Padaria', '11222333000181', { printed_name: long }), store('s2', 'São José', '11222333000262', { printed_name: spaced })];
    await open(mockDb.stores[0]);
    await press('Voltar ao nome da nota');
    await act(async () => renderer?.unmount());
    await open(mockDb.stores[1]);
    await press('Voltar ao nome da nota');
    expect(mockDb.updates).toEqual([
      { values: { name: long }, ids: ['s1'] },
      { values: { name: spaced }, ids: ['s2'] },
    ]);
    expect(mockDb.stores.map((s) => s.printed_name)).toEqual([null, null]);
  });

  it('o mercado sem CNPJ (digitado no seletor): fala do nome anterior, não do da nota', async () => {
    mockDb.stores = [store('s1', 'Feira do bairro', null, { printed_name: 'Feira do bairo' })];
    await open(mockDb.stores[0]);
    expect(page()).toContain('Nome anterior: Feira do bairo');
    expect(page()).not.toContain('Na nota');
    expect(nameField().props.hint).toBe('Vale para toda a casa.');
    await press('Voltar ao nome anterior');
    expect(mockDb.updates).toEqual([{ values: { name: 'Feira do bairo' }, ids: ['s1'] }]);
  });

  it('uma gravação por vez: o Enter do campo com o Salvar a caminho não manda outra', async () => {
    mockDb.stores = [store('s1', CBD, '47508411114402')];
    let release = () => {};
    mockDb.hold = new Promise<void>((resolve) => (release = resolve));
    await open(mockDb.stores[0]);
    await type('Pão de Açúcar');
    await press('Salvar');
    await act(async () => nameField().props.onSubmitEditing());
    expect(closed).toBe(0);
    await act(async () => release());
    await settle();
    expect(mockDb.updates).toHaveLength(1);
    expect(closed).toBe(1);
  });

  it('o mercado que a casa aberta não tem mais: nada gravado, avisa, fecha, e os mercados são buscados de novo', async () => {
    const gone = store('s9', CBD, '47508411114402');
    await open(gone, [gone]);
    await type('Pão de Açúcar');
    await press('Salvar');
    expect(jest.mocked(notify)).toHaveBeenCalledWith('Não deu para renomear o mercado', STORE_RENAME_GONE);
    expect(closed).toBe(1);
    expect(client.getQueryState(['stores'])?.isInvalidated).toBe(true);
  });
});

describe('o nome padrão do CNPJ', () => {
  it('com um nome padrão que a casa não usa: "Usar o nome padrão" pede ao banco o de agora, e o que mostra o nome é buscado de novo', async () => {
    mockDb.stores = [store('s1', CBD, '47508411114402', { standard_name: 'Pão de Açúcar' })];
    mockDb.standards = { '47508411114402': 'Pão de Açúcar' };
    await open(mockDb.stores[0]);
    expect(page()).not.toContain(STORE_STANDARD_LINE);
    await press('Usar o nome padrão: Pão de Açúcar');
    expect(mockDb.follows).toEqual(['s1']);
    expect(mockDb.updates).toEqual([]);
    expect(mockDb.stores[0]).toMatchObject({ name: 'Pão de Açúcar', printed_name: CBD });
    expect(closed).toBe(1);
    expect(SHOWING_NAMES.filter((key) => !client.getQueryState(key)?.isInvalidated)).toEqual([]);
  });

  it('a moderação trocou o nome padrão depois que a lista foi lida: fica o de agora, não o da lista', async () => {
    mockDb.stores = [store('s1', 'PA', '47508411114402', { printed_name: CBD, standard_name: 'Pão de Açúcar' })];
    mockDb.standards = { '47508411114402': 'Pão de Açúcar Brasil' };
    await open(mockDb.stores[0]);
    await press('Usar o nome padrão: Pão de Açúcar');
    expect(mockDb.stores[0]).toMatchObject({ name: 'Pão de Açúcar Brasil', printed_name: CBD });
    expect(notify).not.toHaveBeenCalled();
  });

  it('a moderação tirou o nome padrão: nada gravado, avisa, fecha, e os mercados são buscados de novo', async () => {
    mockDb.stores = [store('s1', 'PA', '47508411114402', { printed_name: CBD, standard_name: 'Pão de Açúcar' })];
    await open(mockDb.stores[0]);
    await press('Usar o nome padrão: Pão de Açúcar');
    expect(mockDb.stores[0].name).toBe('PA');
    expect(jest.mocked(notify)).toHaveBeenCalledWith('Não deu para usar o nome padrão', STORE_STANDARD_GONE);
    expect(closed).toBe(1);
    expect(client.getQueryState(['stores'])?.isInvalidated).toBe(true);
  });

  it('o "CNPJ …" guardado (a nota sem nome) não aparece, nem se oferece voltar a ele', async () => {
    mockDb.stores = [store('s1', 'Mercadinho', '11222333000181', { printed_name: 'CNPJ 11222333000181' })];
    await open(mockDb.stores[0]);
    expect(page()).not.toContain('CNPJ 11222333000181');
    expect(button('Voltar ao nome da nota')).toBeUndefined();
  });

  it('com o nome padrão: diz que é o padrão, e não oferece voltar a ele; o nome da nota continua', async () => {
    mockDb.stores = [store('s1', 'Pão de Açúcar', '47508411114402', { printed_name: CBD, standard_name: 'Pão de Açúcar' })];
    await open(mockDb.stores[0]);
    expect(page()).toContain(STORE_STANDARD_LINE);
    expect(page()).toContain(`Na nota: ${CBD}`);
    expect(button('Usar o nome padrão: Pão de Açúcar')).toBeUndefined();
    expect(button('Voltar ao nome da nota')).toBeDefined();
  });

  it('sem nome padrão (ou sem a coluna), nada dele', async () => {
    mockDb.stores = [store('s1', CBD, '47508411114402'), store('s2', CBD, '47508411000999', { standard_name: undefined })];
    for (const target of mockDb.stores) {
      await open(target);
      expect(page()).not.toContain('nome padrão');
      await act(async () => renderer?.unmount());
    }
  });
});

describe('a lista de mercados', () => {
  it('traz o nome impresso e o nome padrão; o banco antes das migrações lê sem a coluna que falta', async () => {
    mockDb.stores = [store('s1', 'Pão de Açúcar', '47508411114402', { printed_name: CBD, standard_name: 'Pão de Açúcar' })];
    const read = await fetchStores();
    expect(mockDb.reads).toEqual(['id, name, cnpj, address, printed_name, standard_name']);
    expect(read).toEqual([{ id: 's1', name: 'Pão de Açúcar', cnpj: '47508411114402', address: null, printed_name: CBD, standard_name: 'Pão de Açúcar' }]);
    expect(canRenameStore(read[0])).toBe(true);

    // Antes de 20261023120000: sem o nome padrão.
    mockDb.noStandardColumn = true;
    mockDb.reads = [];
    const withoutStandard = await fetchStores();
    expect(mockDb.reads).toEqual(['id, name, cnpj, address, printed_name, standard_name', 'id, name, cnpj, address, printed_name']);
    expect(withoutStandard).toEqual([{ id: 's1', name: 'Pão de Açúcar', cnpj: '47508411114402', address: null, printed_name: CBD }]);

    // Antes de 20261022170000: sem as duas; não se oferece renomear.
    mockDb.noPrintedColumn = true;
    mockDb.reads = [];
    const old = await fetchStores();
    expect(mockDb.reads).toEqual([
      'id, name, cnpj, address, printed_name, standard_name',
      'id, name, cnpj, address, standard_name',
      'id, name, cnpj, address',
    ]);
    expect(old).toEqual([{ id: 's1', name: 'Pão de Açúcar', cnpj: '47508411114402', address: null }]);
    expect(canRenameStore(old[0])).toBe(false);
  });

  it('outro erro da leitura não é coluna que falta: sobe', async () => {
    mockDb.stores = [store('s1', CBD, null)];
    mockDb.noStandardColumn = true;
    mockDb.noPrintedColumn = true;
    mockDb.failOther = true;
    await expect(fetchStores()).rejects.toMatchObject({ code: '42501' });
    expect(mockDb.reads).toHaveLength(1);
  });
});

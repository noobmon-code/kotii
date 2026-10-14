import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, create } from 'react-test-renderer';

import {
  fetchSupplies,
  isSuppliesMissing,
  SUPPLIES_NOT_READY,
  SUPPLY_GONE,
  useDeleteRefill,
  useDeleteSupply,
  useRecordRefill,
  useSaveSupply,
  useSupplies,
} from '../supplies';

// O cliente do Supabase de verdade, com a rede trocada: o que se confere aqui é o pedido que sai
// (a busca limitada, o "troquei hoje" que não duplica) e o que o app faz com a resposta de um banco
// que ainda não tem as tabelas. "mock" no nome: o jest.mock só enxerga variáveis assim.
const mockCalls: { method: string; path: string; query: Record<string, string>; prefer: string; body: unknown }[] = [];
// `hang`: a resposta nunca chega (rede ruim), para ver quem espera por ela.
const mockReplies: { status: number; body?: unknown; hang?: boolean }[] = [];

jest.mock('@/lib/supabase', () => {
  const { createClient } = jest.requireActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
  const supabase = createClient('http://localhost:54321', 'anon', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        mockCalls.push({
          method: init?.method ?? 'GET',
          path: url.pathname,
          query: Object.fromEntries(url.searchParams),
          prefer: new Headers(init?.headers).get('Prefer') ?? '',
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        });
        const reply = mockReplies.shift() ?? { status: 200, body: [] };
        if (reply.hang) return new Promise<Response>(() => undefined);
        return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
          status: reply.status,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  });
  return {
    supabase,
    unwrap: (result: { data: unknown; error: unknown }) => {
      if (result.error) throw result.error;
      return result.data;
    },
  };
});

const db = jest.requireMock<{ supabase: Parameters<typeof fetchSupplies>[0] }>('@/lib/supabase').supabase;

const missingTable = { status: 404, body: { code: 'PGRST205', details: null, hint: null, message: "Could not find the table 'public.supplies' in the schema cache" } };

beforeEach(() => {
  mockCalls.length = 0;
  mockReplies.length = 0;
});

/** O hook montado com um cache próprio; `current` é o que ele devolveu por último. */
function mount<T>(useIt: () => T): { current: T } {
  const result = { current: undefined as T };
  // gcTime infinito: sem ele, o cache deixa um timer de 5 minutos e o Jest não termina.
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  function Probe() {
    result.current = useIt();
    return null;
  }
  act(() => {
    create(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  return result;
}

/** Dentro do act, e esperando o cache avisar a tela (ele avisa num setTimeout). */
const settled = (task: () => Promise<unknown>) =>
  act(async () => {
    await task();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe('busca das reposições', () => {
  it('uma busca só, com as 12 trocas mais recentes de cada reposição', async () => {
    mockReplies.push({
      status: 200,
      body: [
        { id: 's1', name: 'Gás de cozinha', kind: 'gas', typical_days: 45, notes: null, created_at: '2026-10-01T10:00:00Z', supply_refills: [{ id: 'r2', refilled_on: '2026-10-03' }, { id: 'r1', refilled_on: '2026-08-19' }] },
        { id: 's2', name: 'Galão de água', kind: 'agua', typical_days: null, notes: null, created_at: '2026-10-02T10:00:00Z', supply_refills: [] },
      ],
    });
    const data = await fetchSupplies(db);
    expect(mockCalls).toHaveLength(1);
    expect(mockCalls[0]).toMatchObject({ method: 'GET', path: '/rest/v1/supplies' });
    expect(mockCalls[0].query).toEqual({
      select: 'id,name,kind,typical_days,notes,created_at,supply_refills(id,refilled_on)',
      order: 'created_at.asc',
      limit: '100',
      // Ordem e limite dentro de cada reposição, não no total.
      'supply_refills.order': 'refilled_on.desc',
      'supply_refills.limit': '12',
    });
    expect(data.available).toBe(true);
    expect(data.supplies.map((s) => [s.id, s.refills.map((r) => r.refilled_on)])).toEqual([
      ['s1', ['2026-10-03', '2026-08-19']],
      ['s2', []],
    ]);
    expect('supply_refills' in data.supplies[0]).toBe(false);
  });

  it('banco ainda sem as tabelas: não é erro, é "nenhuma reposição" (e a seção não aparece)', async () => {
    const replies = [
      missingTable,
      // Direto do Postgres.
      { status: 404, body: { code: '42P01', details: null, hint: null, message: 'relation "public.supplies" does not exist' } },
      // Já conhece `supplies`, mas ainda não a ligação com as trocas.
      { status: 400, body: { code: 'PGRST200', details: null, hint: null, message: "Could not find a relationship between 'supplies' and 'supply_refills' in the schema cache" } },
    ];
    for (const reply of replies) {
      mockReplies.push(reply);
      await expect(fetchSupplies(db)).resolves.toEqual({ available: false, supplies: [] });
    }
  });

  it('qualquer outro erro continua sendo erro', async () => {
    mockReplies.push({ status: 403, body: { code: '42501', details: null, hint: null, message: 'permission denied for table supplies' } });
    await expect(fetchSupplies(db)).rejects.toMatchObject({ code: '42501' });
    mockReplies.push({ status: 500, body: { code: 'XX000', details: null, hint: null, message: 'boom' } });
    await expect(fetchSupplies(db)).rejects.toMatchObject({ message: 'boom' });
    expect([isSuppliesMissing(null), isSuppliesMissing(new Error('Network request failed')), isSuppliesMissing({ code: 'PGRST116' })]).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe('gravações', () => {
  it('"Troquei hoje" grava ignorando a troca que já existe no dia', async () => {
    const record = mount(() => useRecordRefill());
    mockReplies.push({ status: 201 });
    await settled(async () => {
      await record.current.mutateAsync({ supplyId: 's1', date: '2026-10-12' });
    });
    expect(mockCalls[0]).toMatchObject({
      method: 'POST',
      path: '/rest/v1/supply_refills',
      query: { on_conflict: 'supply_id,refilled_on' },
      body: { supply_id: 's1', refilled_on: '2026-10-12' },
    });
    expect(mockCalls[0].prefer).toContain('resolution=ignore-duplicates');
  });

  it('"Troquei" numa reposição que outra pessoa da casa acabou de excluir: aviso em português e a lista é buscada de novo', async () => {
    const screen = mount(() => ({ list: useSupplies(), record: useRecordRefill() }));
    const listed = () => mockCalls.filter((c) => c.method === 'GET' && c.path === '/rest/v1/supplies').length;
    // A lista que a tela ainda mostra, com a reposição que já não existe.
    await settled(async () => undefined);
    expect(listed()).toBe(1);
    // A chave estrangeira das trocas recusa: a reposição sumiu.
    mockReplies.push({
      status: 409,
      body: {
        code: '23503',
        details: 'Key (supply_id, household_id)=(s1, h1) is not present in table "supplies".',
        hint: null,
        message: 'insert or update on table "supply_refills" violates foreign key constraint "supply_refills_supply_id_household_id_fkey"',
      },
    });
    await settled(async () => {
      await expect(screen.current.record.mutateAsync({ supplyId: 's1', date: '2026-10-12' })).rejects.toMatchObject({ message: 'Esta reposição não existe mais.' });
    });
    expect(SUPPLY_GONE).toBe('Esta reposição não existe mais.');
    // Mesmo com a falha, a lista volta do servidor e a linha velha some.
    expect(listed()).toBe(2);
  });

  it('a gravação que falha avisa na hora: o erro não espera a lista ser buscada de novo', async () => {
    const screen = mount(() => ({ list: useSupplies(), record: useRecordRefill(), save: useSaveSupply() }));
    await settled(async () => undefined);
    // A troca falha e a nova busca da lista fica sem resposta (rede ruim): o erro tem de chegar mesmo assim.
    mockReplies.push({ status: 500, body: { code: 'XX000', details: null, hint: null, message: 'falhou' } }, { status: 200, hang: true });
    await settled(async () => {
      await expect(screen.current.record.mutateAsync({ supplyId: 's1', date: '2026-10-12' })).rejects.toMatchObject({ message: 'falhou' });
    });
    // Mesmo assim a lista foi pedida de novo.
    expect(mockCalls.filter((c) => c.method === 'GET' && c.path === '/rest/v1/supplies').length).toBe(2);
  });

  it('criar com "quando começou o atual": a reposição e a primeira troca', async () => {
    const save = mount(() => useSaveSupply());
    const values = { name: 'Gás de cozinha', kind: 'gas' as const, typical_days: null, notes: null };
    mockReplies.push({ status: 201, body: { id: 's1' } }, { status: 201 });
    let id = '';
    await settled(async () => {
      id = await save.current.mutateAsync({ values, startedOn: '2026-10-12' });
    });
    expect(id).toBe('s1');
    expect(mockCalls.slice(0, 2).map((c) => [c.method, c.path, c.body])).toEqual([
      ['POST', '/rest/v1/supplies', values],
      ['POST', '/rest/v1/supply_refills', { supply_id: 's1', refilled_on: '2026-10-12' }],
    ]);
  });

  it('"Não sei": só a reposição, nenhuma troca', async () => {
    const save = mount(() => useSaveSupply());
    mockReplies.push({ status: 201, body: { id: 's1' } });
    await settled(async () => {
      await save.current.mutateAsync({ values: { name: 'Ração', kind: 'racao', typical_days: 30, notes: null }, startedOn: null });
    });
    expect(mockCalls.filter((c) => c.method !== 'GET').map((c) => [c.method, c.path])).toEqual([['POST', '/rest/v1/supplies']]);
  });

  it('a primeira troca falhou: salvar de novo atualiza a mesma reposição, sem criar outra', async () => {
    const save = mount(() => useSaveSupply());
    const values = { name: 'Gás de cozinha', kind: 'gas' as const, typical_days: null, notes: null };
    mockReplies.push({ status: 201, body: { id: 's1' } }, { status: 500, body: { code: 'XX000', details: null, hint: null, message: 'caiu' } });
    await settled(async () => {
      await expect(save.current.mutateAsync({ values, startedOn: '2026-10-12' })).rejects.toMatchObject({ message: 'caiu' });
    });
    mockCalls.length = 0;
    mockReplies.length = 0;
    mockReplies.push({ status: 200, body: [{ id: 's1' }] }, { status: 201 });
    await settled(async () => {
      await expect(save.current.mutateAsync({ values: { ...values, name: 'Gás' }, startedOn: '2026-10-12' })).resolves.toBe('s1');
    });
    expect(mockCalls.filter((c) => c.method !== 'GET').map((c) => [c.method, c.path, c.query.id ?? null])).toEqual([
      ['PATCH', '/rest/v1/supplies', 'eq.s1'],
      ['POST', '/rest/v1/supply_refills', null],
    ]);
  });

  it('a primeira troca falhou e, antes de salvar de novo, a reposição foi excluída: cria outra, com a troca', async () => {
    const save = mount(() => useSaveSupply());
    const values = { name: 'Gás de cozinha', kind: 'gas' as const, typical_days: null, notes: null };
    mockReplies.push({ status: 201, body: { id: 's1' } }, { status: 500, body: { code: 'XX000', details: null, hint: null, message: 'caiu' } });
    await settled(async () => {
      await expect(save.current.mutateAsync({ values, startedOn: '2026-10-12' })).rejects.toMatchObject({ message: 'caiu' });
    });
    mockCalls.length = 0;
    mockReplies.length = 0;
    // A mudança não alcança nenhuma linha (outra pessoa da casa excluiu a s1): uma nova, a s2, e a troca vai nela.
    mockReplies.push({ status: 200, body: [] }, { status: 201, body: { id: 's2' } }, { status: 201 });
    await settled(async () => {
      await expect(save.current.mutateAsync({ values, startedOn: '2026-10-12' })).resolves.toBe('s2');
    });
    expect(mockCalls.filter((c) => c.method !== 'GET').map((c) => [c.method, c.path, c.query.id ?? null, c.body])).toEqual([
      ['PATCH', '/rest/v1/supplies', 'eq.s1', values],
      ['POST', '/rest/v1/supplies', null, values],
      ['POST', '/rest/v1/supply_refills', null, { supply_id: 's2', refilled_on: '2026-10-12' }],
    ]);
  });

  it('editar uma reposição que outra pessoa da casa excluiu: aviso em português, nada criado, e a lista é buscada de novo', async () => {
    const screen = mount(() => ({ list: useSupplies(), save: useSaveSupply() }));
    const listed = () => mockCalls.filter((c) => c.method === 'GET' && c.path === '/rest/v1/supplies').length;
    await settled(async () => undefined);
    expect(listed()).toBe(1);
    // O PostgREST responde que deu certo, mas sem nenhuma linha: não havia mais o que mudar.
    mockReplies.push({ status: 200, body: [] });
    await settled(async () => {
      await expect(
        screen.current.save.mutateAsync({ id: 's9', values: { name: 'Areia', kind: 'areia', typical_days: 15, notes: null } }),
      ).rejects.toThrow(SUPPLY_GONE);
    });
    expect(mockCalls.filter((c) => c.method !== 'GET').map((c) => [c.method, c.path, c.query.id])).toEqual([['PATCH', '/rest/v1/supplies', 'eq.s9']]);
    // A lista volta do servidor e a tela cai no "não existe mais".
    expect(listed()).toBe(2);
  });

  it('editar e apagar vão na linha certa', async () => {
    const save = mount(() => useSaveSupply());
    const removeRefill = mount(() => useDeleteRefill());
    const remove = mount(() => useDeleteSupply());
    mockReplies.push({ status: 200, body: [{ id: 's9' }] }, { status: 204 }, { status: 204 });
    await settled(async () => {
      await expect(save.current.mutateAsync({ id: 's9', values: { name: 'Areia', kind: 'areia', typical_days: 15, notes: 'Saco de 4 kg' } })).resolves.toBe('s9');
      await removeRefill.current.mutateAsync('r1');
      await remove.current.mutateAsync('s9');
    });
    expect(mockCalls.filter((c) => c.method !== 'GET').map((c) => [c.method, c.path, c.query.id])).toEqual([
      ['PATCH', '/rest/v1/supplies', 'eq.s9'],
      ['DELETE', '/rest/v1/supply_refills', 'eq.r1'],
      ['DELETE', '/rest/v1/supplies', 'eq.s9'],
    ]);
    // A mudança pede a linha de volta: é como se sabe que ela ainda existia.
    expect(mockCalls[0].query.select).toBe('id');
    expect(mockCalls[0].prefer).toContain('return=representation');
  });

  it('banco ainda sem as tabelas: gravar avisa que os avisos estão sendo ativados', async () => {
    const save = mount(() => useSaveSupply());
    const record = mount(() => useRecordRefill());
    const removeRefill = mount(() => useDeleteRefill());
    const remove = mount(() => useDeleteSupply());
    const values = { name: 'Gás de cozinha', kind: 'gas' as const, typical_days: null, notes: null };
    expect(SUPPLIES_NOT_READY).toBe('Os avisos de gás, água e ração ainda estão sendo ativados no Kotii. Tente de novo mais tarde.');
    const attempts = [
      () => save.current.mutateAsync({ values, startedOn: '2026-10-12' }),
      // Editar também: o aviso das tabelas vem antes do "não existe mais".
      () => save.current.mutateAsync({ id: 's1', values }),
      () => record.current.mutateAsync({ supplyId: 's1', date: '2026-10-12' }),
      () => removeRefill.current.mutateAsync('r1'),
      () => remove.current.mutateAsync('s1'),
    ];
    for (const attempt of attempts) {
      mockReplies.length = 0;
      mockReplies.push(missingTable);
      await settled(async () => {
        await expect(attempt()).rejects.toThrow(SUPPLIES_NOT_READY);
      });
    }
  });
});

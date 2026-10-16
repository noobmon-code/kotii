import { describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import path from 'path';

import type { JobValues, ProviderValues } from '@/domain/providers';

import {
  deleteServiceProvider,
  fetchProviderJobs,
  fetchServiceJob,
  fetchServiceJobs,
  fetchServiceProviders,
  isMissingTable,
  PROVIDER_JOBS_CHANGED,
  providerErrorMessage,
  PROVIDERS_UNAVAILABLE,
  saveServiceJob,
  saveServiceProvider,
} from '../providers';

jest.mock('@/lib/supabase', () => ({
  supabase: {},
  unwrap: (r: { data: unknown; error: unknown }) => {
    if (r.error) throw r.error;
    return r.data;
  },
  errorMessage: (error: { message?: string }) => error?.message ?? 'Algo deu errado. Tente novamente.',
}));

type Result = { data: unknown; error: unknown; count?: number | null };

/**
 * Um banco de mentira: guarda cada passo do pedido ("tabela.verbo(args)", "rpc.função(args)") e responde
 * `result`; com mais de uma resposta, uma por pedido, na ordem (a última se repete).
 */
function fakeDb(...results: Result[]) {
  const calls: string[] = [];
  let asked = 0;
  const chain = (name: string) => {
    const query: Record<string, unknown> = {
      then: (resolve: (value: Result) => void) => resolve(results[Math.min(asked++, results.length - 1)]),
    };
    for (const step of ['select', 'insert', 'update', 'delete', 'eq', 'order', 'single', 'maybeSingle']) {
      query[step] = (...args: unknown[]) => {
        calls.push(`${name}.${step}(${args.map((arg) => JSON.stringify(arg)).join(', ')})`);
        return query;
      };
    }
    return query;
  };
  const db = {
    from: (table: string) => chain(table),
    rpc: (fn: string, args: unknown) => {
      calls.push(`rpc.${fn}(${JSON.stringify(args)})`);
      return chain(fn);
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

// Como o PostgREST e o Postgres respondem quando a tabela ainda não existe.
const notInCache = { code: 'PGRST205', message: "Could not find the table 'public.service_providers' in the schema cache" };
const noRelation = { code: '42P01', message: 'relation "public.service_jobs" does not exist' };
const offline = { message: 'TypeError: Network request failed' };

describe('banco ainda sem as tabelas', () => {
  it('reconhece a tabela que falta pelo código ou pela mensagem, e só ela', () => {
    expect(isMissingTable(notInCache)).toBe(true);
    expect(isMissingTable(noRelation)).toBe(true);
    expect(isMissingTable({ message: 'relation "public.service_jobs" does not exist' })).toBe(true);
    expect(isMissingTable({ message: "Could not find the table 'public.service_providers' in the schema cache" })).toBe(true);
    expect(isMissingTable(offline)).toBe(false);
    expect(isMissingTable({ code: '42501', message: 'new row violates row-level security policy for table "service_providers"' })).toBe(false);
    expect(isMissingTable({ message: 'relation "public.outra_tabela" does not exist' })).toBe(false);
    expect(isMissingTable(null)).toBe(false);
    expect(isMissingTable('PGRST205')).toBe(false);
  });

  it('as listas vêm vazias e dizem que a tabela falta, em vez de dar erro', async () => {
    expect(await fetchServiceProviders(fakeDb({ data: null, error: notInCache }).db)).toEqual({ rows: [], missing: true });
    expect(await fetchServiceJobs({}, fakeDb({ data: null, error: noRelation }).db)).toEqual({ rows: [], missing: true });
    expect(await fetchServiceJobs({ equipmentId: 'e1' }, fakeDb({ data: null, error: notInCache }).db)).toEqual({ rows: [], missing: true });
    expect(await fetchServiceJob('j1', fakeDb({ data: null, error: noRelation }).db)).toBeNull();
  });

  it('outro erro continua sendo erro (sem internet não é "nenhum prestador")', async () => {
    await expect(fetchServiceProviders(fakeDb({ data: null, error: offline }).db)).rejects.toBe(offline);
    await expect(fetchServiceJobs({}, fakeDb({ data: null, error: offline }).db)).rejects.toBe(offline);
    await expect(fetchServiceJob('j1', fakeDb({ data: null, error: offline }).db)).rejects.toBe(offline);
  });

  it('salvar avisa com a frase de "ainda sendo ativados"', async () => {
    const values = { name: 'Zé da Luz' } as ProviderValues;
    const error = await saveServiceProvider({ values }, fakeDb({ data: null, error: notInCache }).db).catch((err: unknown) => err);
    expect(providerErrorMessage(error)).toBe(PROVIDERS_UNAVAILABLE);
    expect(PROVIDERS_UNAVAILABLE).toBe('Os prestadores ainda estão sendo ativados no Kotii. Tente de novo mais tarde.');
    const jobError = await saveServiceJob({ values: {} as JobValues }, fakeDb({ data: null, error: noRelation }).db).catch((err: unknown) => err);
    expect(providerErrorMessage(jobError)).toBe(PROVIDERS_UNAVAILABLE);
  });
});

describe('prestadores e serviços', () => {
  it('lista os prestadores por nome', async () => {
    const rows = [{ id: 'p1', name: 'Ana' }];
    const { db, calls } = fakeDb({ data: rows, error: null });
    expect(await fetchServiceProviders(db)).toEqual({ rows, missing: false });
    expect(calls).toEqual([
      'service_providers.select("id, name, trade, phone, phone_digits, notes, recommended, created_at")',
      'service_providers.order("name")',
    ]);
  });

  it('os serviços vêm do mais recente para o mais antigo, de todos, de um prestador ou de um aparelho', async () => {
    const select = 'service_jobs.select("id, provider_id, equipment_id, done_on, description, amount, warranty_until, notes, created_at")';
    const order = ['service_jobs.order("done_on", {"ascending":false})', 'service_jobs.order("created_at", {"ascending":false})'];
    const all = fakeDb({ data: [], error: null });
    expect(await fetchServiceJobs({}, all.db)).toEqual({ rows: [], missing: false });
    expect(all.calls).toEqual([select, ...order]);
    const ofProvider = fakeDb({ data: null, error: null });
    expect(await fetchServiceJobs({ providerId: 'p1' }, ofProvider.db)).toEqual({ rows: [], missing: false });
    expect(ofProvider.calls).toEqual([select, 'service_jobs.eq("provider_id", "p1")', ...order]);
    const ofEquipment = fakeDb({ data: [], error: null });
    await fetchServiceJobs({ equipmentId: 'e1' }, ofEquipment.db);
    expect(ofEquipment.calls).toEqual([select, 'service_jobs.eq("equipment_id", "e1")', ...order]);
  });

  it('um serviço que não existe mais vem nulo', async () => {
    expect(await fetchServiceJob('j1', fakeDb({ data: null, error: null }).db)).toBeNull();
    expect(await fetchServiceJob('j1', fakeDb({ data: { id: 'j1' }, error: null }).db)).toEqual({ id: 'j1' });
  });

  it('cria e devolve o id; muda pelo id', async () => {
    const values = { name: 'Zé da Luz' } as ProviderValues;
    const created = fakeDb({ data: { id: 'p9' }, error: null });
    expect(await saveServiceProvider({ values }, created.db)).toEqual({ id: 'p9' });
    expect(created.calls).toEqual(['service_providers.insert({"name":"Zé da Luz"})', 'service_providers.select("id")', 'service_providers.single()']);
    const changed = fakeDb({ data: { id: 'p1' }, error: null });
    expect(await saveServiceProvider({ id: 'p1', values }, changed.db)).toEqual({ id: 'p1' });
    expect(changed.calls).toEqual([
      'service_providers.update({"name":"Zé da Luz"})',
      'service_providers.eq("id", "p1")',
      'service_providers.select("id")',
      'service_providers.maybeSingle()',
    ]);
    const job = fakeDb({ data: { id: 'j1' }, error: null });
    await saveServiceJob({ id: 'j1', values: { description: 'Trocou a placa' } as JobValues }, job.db);
    expect(job.calls[0]).toBe('service_jobs.update({"description":"Trocou a placa"})');
  });

  it('mudar o que já foi apagado avisa, em vez de fingir que salvou (sem dizer quem apagou: o app não sabe)', async () => {
    const gone = fakeDb({ data: null, error: null });
    const error = await saveServiceProvider({ id: 'p1', values: {} as ProviderValues }, gone.db).catch((err: unknown) => err);
    expect((error as Error).message).toBe('Este cadastro não existe mais.');
  });

  it('os erros chegam em palavras de gente', () => {
    expect(providerErrorMessage({ code: '23503', message: 'insert or update on table "service_jobs" violates foreign key constraint' })).toBe(
      'O prestador ou o aparelho deste serviço não existe mais. Volte e escolha de novo.',
    );
    expect(providerErrorMessage(offline)).toBe('TypeError: Network request failed');
    expect(providerErrorMessage(null)).toBe('Algo deu errado. Tente novamente.');
  });
});

describe('excluir um prestador', () => {
  // Como o banco responde quando o número de serviços que a pessoa leu não é mais o do prestador.
  const changed = { code: 'NK010', message: 'Os serviços deste prestador mudaram em outro aparelho, e nada foi excluído. Confira o histórico e tente de novo.' };
  // O PostgREST ainda sem a função no cache de esquema (ou o banco sem ela).
  const noFunction = { code: 'PGRST202', message: 'Could not find the function public.delete_service_provider(p_expected_jobs, p_id) in the schema cache' };

  it('os serviços dele vêm com quantos são ao todo, contados pelo banco (a lista pode vir cortada em 1000)', async () => {
    const rows = [{ id: 'j1' }];
    const { db, calls } = fakeDb({ data: rows, error: null, count: 1043 });
    expect(await fetchProviderJobs('p1', db)).toEqual({ rows, missing: false, total: 1043 });
    expect(calls).toEqual([
      'service_jobs.select("id, provider_id, equipment_id, done_on, description, amount, warranty_until, notes, created_at", {"count":"exact"})',
      'service_jobs.eq("provider_id", "p1")',
      'service_jobs.order("done_on", {"ascending":false})',
      'service_jobs.order("created_at", {"ascending":false})',
    ]);
    // Sem o número do banco, não se sabe quantos são.
    expect(await fetchProviderJobs('p1', fakeDb({ data: rows, error: null }).db)).toEqual({ rows, missing: false, total: null });
    expect(await fetchProviderJobs('p1', fakeDb({ data: null, error: notInCache }).db)).toEqual({ rows: [], missing: true, total: 0 });
    await expect(fetchProviderJobs('p1', fakeDb({ data: null, error: offline }).db)).rejects.toBe(offline);
  });

  it('pela função do banco, com o número de serviços que a pessoa leu na pergunta (ou sem número: o histórico todo)', async () => {
    const counted = fakeDb({ data: true, error: null });
    expect(await deleteServiceProvider({ id: 'p1', expectedJobs: 2 }, counted.db)).toBe(true);
    expect(counted.calls).toEqual(['rpc.delete_service_provider({"p_id":"p1","p_expected_jobs":2})']);
    const whole = fakeDb({ data: true, error: null });
    await deleteServiceProvider({ id: 'p1', expectedJobs: null }, whole.db);
    expect(whole.calls).toEqual(['rpc.delete_service_provider({"p_id":"p1","p_expected_jobs":null})']);
    // Já tinha sido excluído (em outro aparelho): não é erro, o que a pessoa queria já está feito.
    expect(await deleteServiceProvider({ id: 'p1', expectedJobs: 0 }, fakeDb({ data: false, error: null }).db)).toBe(false);
  });

  it('o número mudou em outro aparelho (NK010): nada foi excluído, e o aviso diz isso', async () => {
    const error = await deleteServiceProvider({ id: 'p1', expectedJobs: 0 }, fakeDb({ data: null, error: changed }).db).catch((err: unknown) => err);
    expect(error).toBe(changed);
    expect(providerErrorMessage(error)).toBe(PROVIDER_JOBS_CHANGED);
    expect(PROVIDER_JOBS_CHANGED).toBe('Os serviços deste prestador mudaram em outro aparelho, e nada foi excluído. Confira o histórico e tente de novo.');
    // Só o NK010: outro código não vira esta frase.
    expect(providerErrorMessage({ code: 'NK008', message: 'product renamed' })).toBe('product renamed');
  });

  it('o banco (ou o cache de esquema do PostgREST) ainda sem a função: exclui do jeito de antes', async () => {
    const stale = fakeDb({ data: null, error: noFunction }, { data: null, error: null });
    expect(await deleteServiceProvider({ id: 'p1', expectedJobs: 2 }, stale.db)).toBe(true);
    expect(stale.calls).toEqual([
      'rpc.delete_service_provider({"p_id":"p1","p_expected_jobs":2})',
      'service_providers.delete()',
      'service_providers.eq("id", "p1")',
    ]);
    const old = fakeDb({ data: null, error: { code: '42883', message: 'function public.delete_service_provider(uuid, integer) does not exist' } }, { data: null, error: null });
    await deleteServiceProvider({ id: 'p1', expectedJobs: null }, old.db);
    expect(old.calls).toContain('service_providers.delete()');
    // Sem as tabelas também: o aviso de "ainda sendo ativados".
    const error = await deleteServiceProvider({ id: 'p1', expectedJobs: 1 }, fakeDb({ data: null, error: noFunction }, { data: null, error: notInCache }).db).catch(
      (err: unknown) => err,
    );
    expect(providerErrorMessage(error)).toBe(PROVIDERS_UNAVAILABLE);
  });

  it('outro erro da função (ou de outra função lá dentro) não vira o excluir de antes', async () => {
    const inner = { code: '42883', message: 'function public.outra_funcao(uuid) does not exist' };
    const failed = fakeDb({ data: null, error: inner });
    await expect(deleteServiceProvider({ id: 'p1', expectedJobs: 1 }, failed.db)).rejects.toBe(inner);
    await expect(deleteServiceProvider({ id: 'p1', expectedJobs: 1 }, fakeDb({ data: null, error: offline }).db)).rejects.toBe(offline);
    expect(failed.calls).toEqual(['rpc.delete_service_provider({"p_id":"p1","p_expected_jobs":1})']);
  });
});

describe('nomes e telefones de gente de fora da casa', () => {
  const source = (file: string) => readFileSync(path.resolve(__dirname, '../..', file), 'utf8');

  it('não entram no retrato que vai para o Nuke', () => {
    for (const file of ['data/nuke.ts', 'domain/nuke.ts']) {
      expect({ file, mentions: /providers|service_|serviceJobs|serviceProviders/i.test(source(file)) }).toEqual({ file, mentions: false });
    }
  });

  it('nada daqui é escrito em log', () => {
    for (const file of ['data/providers.ts', 'domain/providers.ts', 'lib/openLink.ts', 'features/providers/ProviderContact.tsx']) {
      expect({ file, logs: /console\./.test(source(file)) }).toEqual({ file, logs: false });
    }
  });
});

import { describe, expect, it, jest } from '@jest/globals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import path from 'path';

import type { JobValues, ProviderValues } from '@/domain/providers';

import {
  fetchServiceJob,
  fetchServiceJobs,
  fetchServiceProviders,
  isMissingTable,
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

type Result = { data: unknown; error: unknown };

/** Um banco de mentira: guarda cada passo do pedido ("tabela.verbo(args)") e responde `result`. */
function fakeDb(result: Result) {
  const calls: string[] = [];
  const db = {
    from: (table: string) => {
      const query: Record<string, unknown> = {
        then: (resolve: (value: Result) => void) => resolve(result),
      };
      for (const step of ['select', 'insert', 'update', 'delete', 'eq', 'order', 'single', 'maybeSingle']) {
        query[step] = (...args: unknown[]) => {
          calls.push(`${table}.${step}(${args.map((arg) => JSON.stringify(arg)).join(', ')})`);
          return query;
        };
      }
      return query;
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

// Apaga as fotos de uma casa (<bucket>/<casa>/<arquivo>) depois que o banco
// já apagou a casa, a partir da fila household_file_cleanup (quem falhar
// fica para a próxima vez). Sem rede: testado em cleanup.test.ts com um
// Storage e uma fila falsos.

export const BUCKETS = ['receipts', 'health', 'documents'] as const;

/** O pedaço da API de Storage que a limpeza usa. */
export interface BucketApi {
  list(prefix: string, options: { limit: number }): Promise<{ data: { name: string; id: string | null }[] | null; error: unknown }>;
  remove(paths: string[]): Promise<{ data: unknown[] | null; error: unknown }>;
}

const PAGE = 100;

/** Apaga tudo em <bucket>/<casa>/ em cada bucket. Devolve quantos arquivos saíram. */
export async function removeHouseholdFiles(bucket: (name: string) => BucketApi, householdId: string): Promise<number> {
  let removed = 0;
  for (const name of BUCKETS) {
    const api = bucket(name);
    for (;;) {
      const listed = await api.list(householdId, { limit: PAGE });
      if (listed.error) throw listed.error;
      // Pastas vêm sem id; as fotos ficam direto na pasta da casa.
      const paths = (listed.data ?? []).filter((file) => file.id).map((file) => `${householdId}/${file.name}`);
      if (!paths.length) break;
      const result = await api.remove(paths);
      if (result.error) throw result.error;
      const count = result.data?.length ?? 0;
      removed += count;
      // Nada apagado: não fica em laço.
      if (!count) break;
    }
  }
  return removed;
}

/** A fila household_file_cleanup, vista pela função. */
export interface CleanupQueue {
  pending(limit: number): Promise<{ householdId: string; attempts: number }[]>;
  done(householdId: string): Promise<void>;
  failed(householdId: string, attempts: number): Promise<void>;
}

/** Limpa as casas da fila (as que falharam menos vezes primeiro). */
export async function drainCleanupQueue(
  queue: CleanupQueue,
  bucket: (name: string) => BucketApi,
  limit = 5,
): Promise<{ done: string[]; failed: string[] }> {
  const result = { done: [] as string[], failed: [] as string[] };
  for (const { householdId, attempts } of await queue.pending(limit)) {
    try {
      await removeHouseholdFiles(bucket, householdId);
      await queue.done(householdId);
      result.done.push(householdId);
    } catch (err) {
      console.error('file cleanup failed', householdId, err);
      await queue.failed(householdId, attempts + 1);
      result.failed.push(householdId);
    }
  }
  return result;
}

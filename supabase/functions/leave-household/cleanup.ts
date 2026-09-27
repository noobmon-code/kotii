// Apaga as fotos de uma casa (<bucket>/<casa>/<arquivo>) depois que o banco
// já apagou a casa. Sem rede: testado em cleanup.test.ts com um Storage falso.

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

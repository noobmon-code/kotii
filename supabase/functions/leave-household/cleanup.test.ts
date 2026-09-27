import { assertEquals, assertRejects } from '@std/assert';

import { type BucketApi, removeHouseholdFiles } from './cleanup.ts';

function fakeStorage(files: Record<string, string[]>, { stuck = false } = {}) {
  const calls: string[] = [];
  const bucket = (name: string): BucketApi => ({
    list: (prefix, { limit }) => {
      calls.push(`list ${name}/${prefix}`);
      const inFolder = (files[name] ?? []).filter((path) => path.startsWith(`${prefix}/`));
      const data = inFolder.slice(0, limit).map((path) => ({ name: path.slice(prefix.length + 1), id: path }));
      return Promise.resolve({ data, error: null });
    },
    remove: (paths) => {
      calls.push(`remove ${name} ${paths.length}`);
      if (stuck) return Promise.resolve({ data: [], error: null });
      files[name] = (files[name] ?? []).filter((path) => !paths.includes(path));
      return Promise.resolve({ data: paths, error: null });
    },
  });
  return { bucket, calls, files };
}

Deno.test('apaga só a pasta da casa, em todos os buckets, página por página', async () => {
  const many = Array.from({ length: 150 }, (_, i) => `casa-1/${i}.jpg`);
  const storage = fakeStorage({
    receipts: [...many, 'casa-2/fica.jpg'],
    health: ['casa-1/exame.jpg'],
    documents: ['casa-2/rg.jpg'],
  });
  assertEquals(await removeHouseholdFiles(storage.bucket, 'casa-1'), 151);
  assertEquals(storage.files.receipts, ['casa-2/fica.jpg']);
  assertEquals(storage.files.health, []);
  assertEquals(storage.files.documents, ['casa-2/rg.jpg']);
});

Deno.test('para quando nada é apagado, em vez de ficar em laço', async () => {
  const storage = fakeStorage({ receipts: ['casa-1/a.jpg'] }, { stuck: true });
  assertEquals(await removeHouseholdFiles(storage.bucket, 'casa-1'), 0);
  assertEquals(storage.calls.filter((c) => c.startsWith('remove')).length, 1);
});

Deno.test('erro do Storage sobe', async () => {
  const bucket = (): BucketApi => ({
    list: () => Promise.resolve({ data: null, error: new Error('falhou') }),
    remove: () => Promise.resolve({ data: null, error: null }),
  });
  await assertRejects(() => removeHouseholdFiles(bucket, 'casa-1'), Error, 'falhou');
});

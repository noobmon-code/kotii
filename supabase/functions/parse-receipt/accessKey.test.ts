import { assert, assertEquals } from '@std/assert';

import {
  accessKeyCheckDigit,
  chooseAccessKey,
  duplicateBeforeRead,
  existingOnConflict,
  isValidAccessKey,
  keyAfterRead,
  requestedAccessKey,
} from './accessKey.ts';

// Chaves fictícias com dígito verificador válido: A e B são duas notas do
// mesmo caixa (número e código aleatório diferentes); NEAR é A com um dígito
// do código trocado e o verificador refeito (2 dígitos diferentes).
const A = '25260912345678000190650010000123451000012347';
const B = '25260912345678000190650010000123461839205717';
const NEAR = '25260912345678000190650010000123451100012349';
// A com um dígito do número trocado: não passa no verificador.
const A_TYPO = '25260912345678000190650010000133451000012347';

/** Busca falsa por chave: guarda as chaves buscadas. */
function fakeFind(rows: Record<string, string> = {}) {
  const calls: string[] = [];
  const find = (key: string) => {
    calls.push(key);
    return Promise.resolve(rows[key] ?? null);
  };
  return { find, calls };
}

Deno.test('chaves de teste: válidas, e as variações com o número de dígitos esperado', () => {
  for (const key of [A, B, NEAR]) assert(isValidAccessKey(key), key);
  assert(!isValidAccessKey(A_TYPO));
  assertEquals([...A].filter((d, i) => d !== NEAR[i]).length, 2);
  assertEquals(accessKeyCheckDigit(A.slice(0, 43)), 7);
});

Deno.test('requestedAccessKey: chave válida do QR; sem ela, null; o resto é recusado', () => {
  assertEquals(requestedAccessKey(A), A);
  assertEquals(requestedAccessKey(undefined), null);
  assertEquals(requestedAccessKey(null), null);
  assertEquals(requestedAccessKey(''), 'invalid');
  assertEquals(requestedAccessKey(A.slice(1)), 'invalid');
  assertEquals(requestedAccessKey(`${A}0`), 'invalid');
  assertEquals(requestedAccessKey(A_TYPO), 'invalid', 'o app só manda chave com o verificador certo');
  assertEquals(requestedAccessKey(A.replace(/(\d{4})/g, '$1 ')), 'invalid', 'o app manda só os dígitos');
  assertEquals(requestedAccessKey(Number(A)), 'invalid');
  assertEquals(requestedAccessKey("3526' or '1'='1"), 'invalid');
});

Deno.test('chooseAccessKey: sem QR, vale a chave lida na foto', () => {
  assertEquals(chooseAccessKey(null, B), { key: B, checkAfterRead: true, mismatch: false });
  assertEquals(chooseAccessKey(null, null), { key: null, checkAfterRead: false, mismatch: false });
});

Deno.test('chooseAccessKey: a chave do QR vale mais que a lida na mesma nota', () => {
  const qr = { key: A, checkAfterRead: false, mismatch: false };
  // A IA não leu a chave, leu igual, trocou um dígito (verificador falha) ou dois.
  assertEquals(chooseAccessKey(A, null), qr);
  assertEquals(chooseAccessKey(A, A), qr);
  assertEquals(chooseAccessKey(A, A_TYPO), qr);
  assertEquals(chooseAccessKey(A, NEAR), qr);
  // Bem diferente, mas sem o verificador certo: leitura ruim, não outra nota.
  assertEquals(chooseAccessKey(A, `${B.slice(0, 43)}0`), qr);
});

Deno.test('chooseAccessKey: foto de outra nota (chave válida bem diferente) grava a da foto', () => {
  assertEquals(chooseAccessKey(A, B), { key: B, checkAfterRead: true, mismatch: true });
});

Deno.test('duplicateBeforeRead: busca a chave do QR antes da IA; sem ela, não busca', async () => {
  const withKey = fakeFind({ [A]: 'nota-a' });
  assertEquals(await duplicateBeforeRead(A, withKey.find), 'nota-a');
  assertEquals(withKey.calls, [A]);
  const without = fakeFind({ [A]: 'nota-a' });
  assertEquals(await duplicateBeforeRead(null, without.find), null);
  assertEquals(without.calls, []);
});

Deno.test('keyAfterRead: com a chave do QR já conferida antes da IA, não busca de novo', async () => {
  for (const read of [null, A, NEAR, A_TYPO]) {
    const { find, calls } = fakeFind({ [A]: 'nota-a', [NEAR]: 'nota-near' });
    assertEquals(await keyAfterRead(A, read, find), { key: A, checkAfterRead: false, mismatch: false, existing: null });
    assertEquals(calls, [], String(read));
  }
});

Deno.test('keyAfterRead: sem QR, busca a chave da foto (e acha a nota repetida)', async () => {
  const { find, calls } = fakeFind({ [B]: 'nota-b' });
  assertEquals(await keyAfterRead(null, B, find), { key: B, checkAfterRead: true, mismatch: false, existing: 'nota-b' });
  assertEquals(calls, [B]);
  const none = fakeFind();
  assertEquals(await keyAfterRead(null, null, none.find), { key: null, checkAfterRead: false, mismatch: false, existing: null });
  assertEquals(none.calls, []);
});

Deno.test('keyAfterRead: foto de outra nota busca a chave da foto, nunca grava a do QR', async () => {
  const { find, calls } = fakeFind({ [A]: 'nota-a' });
  assertEquals(await keyAfterRead(A, B, find), { key: B, checkAfterRead: true, mismatch: true, existing: null });
  assertEquals(calls, [B]);
  const repeated = fakeFind({ [B]: 'nota-b' });
  assertEquals((await keyAfterRead(A, B, repeated.find)).existing, 'nota-b');
});

Deno.test('existingOnConflict: índice único (23505) com chave devolve a nota que chegou antes', async () => {
  const { find, calls } = fakeFind({ [A]: 'nota-a' });
  assertEquals(await existingOnConflict({ code: '23505' }, A, find), 'nota-a');
  assertEquals(calls, [A]);
});

Deno.test('existingOnConflict: outro erro ou nota sem chave: null, sem buscar', async () => {
  const { find, calls } = fakeFind({ [A]: 'nota-a' });
  assertEquals(await existingOnConflict({ code: '23503' }, A, find), null);
  assertEquals(await existingOnConflict({}, A, find), null);
  assertEquals(await existingOnConflict(null, A, find), null);
  assertEquals(await existingOnConflict({ code: '23505' }, null, find), null);
  assertEquals(calls, []);
});

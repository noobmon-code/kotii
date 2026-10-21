import { assert, assertEquals } from '@std/assert';

import {
  accessKeyCheckDigit,
  chooseAccessKey,
  duplicateBeforeRead,
  existingOnConflict,
  fallbackPurchasedAt,
  isValidAccessKey,
  keyAfterRead,
  photoIds,
  readWithoutItems,
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

// Chave do QR com um CNPJ que passa no verificador (11.222.333/0001-81); o de A não passa.
const QR_CNPJ = '11222333000181';
const QR = '25261011222333000181650010000123451000012345';

Deno.test('photoIds: sem CNPJ lido, o da chave do QR acha o mercado, e a leitura do servidor fica sem ele', () => {
  assert(isValidAccessKey(QR));
  assertEquals(photoIds({ accessKey: null, cnpj: null }, QR, false), {
    storeCnpj: QR_CNPJ,
    read: { accessKey: null, cnpj: null },
  });
});

Deno.test('photoIds: o CNPJ lido pela IA vale para os dois; a foto de outra nota não usa o QR', () => {
  const read = { accessKey: B, cnpj: '12345678000195' };
  assertEquals(photoIds(read, QR, false), { storeCnpj: '12345678000195', read });
  assertEquals(photoIds({ accessKey: B, cnpj: null }, QR, true).storeCnpj, null);
  // Sem QR, ou com um QR cujo CNPJ não passa no verificador: só o que a IA leu.
  assertEquals(photoIds({ accessKey: null, cnpj: null }, null, false).storeCnpj, null);
  assertEquals(photoIds({ accessKey: null, cnpj: null }, A, false).storeCnpj, null);
});

Deno.test('readWithoutItems: a nota do QR lida sem itens não vira nota; a foto comum sem itens continua valendo', () => {
  assertEquals(readWithoutItems(QR, 0), true);
  assertEquals(readWithoutItems(QR, 1), false);
  assertEquals(readWithoutItems(null, 0), false);
});

Deno.test('fallbackPurchasedAt: sem a data lida, a nota de um mês anterior fica no último dia dele, ao meio-dia de Brasília', () => {
  const now = new Date('2026-10-02T13:00:00.000Z');
  // A é de setembro de 2026: os prints mandados em outubro não mudam o mês da compra.
  assertEquals(fallbackPurchasedAt(A, now), '2026-09-30T15:00:00.000Z');
  // Do mês de hoje (QR, outubro de 2026), sem chave ou com um mês que não existe: agora.
  assertEquals(fallbackPurchasedAt(QR, now), now.toISOString());
  assertEquals(fallbackPurchasedAt(null, now), now.toISOString());
  assertEquals(fallbackPurchasedAt('25261312345678000190650010000123451000012347', now), now.toISOString());
  // Fevereiro de ano bissexto.
  assertEquals(fallbackPurchasedAt('25280212345678000190650010000123451000012347', new Date('2028-03-05T12:00:00.000Z')), '2028-02-29T15:00:00.000Z');
  // 1º de novembro às 2h UTC ainda é 31 de outubro em São Paulo: a nota de outubro é do mês de hoje.
  const lateOctober = new Date('2026-11-01T02:00:00.000Z');
  assertEquals(fallbackPurchasedAt(QR, lateOctober), lateOctober.toISOString());
});

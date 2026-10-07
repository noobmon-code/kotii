import { assert } from '@std/assert';

import { sameSecret } from './secret.ts';

Deno.test('segredo do agendamento: só o igual passa', () => {
  assert(sameSecret('abc123', 'abc123'));
  assert(!sameSecret('abc124', 'abc123'));
  assert(!sameSecret('abc', 'abc123'));
  assert(!sameSecret(null, 'abc123'));
});

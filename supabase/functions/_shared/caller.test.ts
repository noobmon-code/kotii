import { assertEquals } from '@std/assert';

import { callerHeaders } from './caller.ts';

Deno.test('repassa o token e a casa aberta', () => {
  const req = new Request('https://x', { headers: { Authorization: 'Bearer t', 'x-household-id': 'casa-2' } });
  assertEquals(callerHeaders(req), { Authorization: 'Bearer t', 'x-household-id': 'casa-2' });
});

Deno.test('sem a casa (app antigo), só o token', () => {
  const req = new Request('https://x', { headers: { Authorization: 'Bearer t' } });
  assertEquals(callerHeaders(req), { Authorization: 'Bearer t' });
});

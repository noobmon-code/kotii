import { assertEquals, assertThrows } from '@std/assert';

import { publishableKey, secretKey } from './apiKeys.ts';

const env = (vars: Record<string, string>) => (name: string) => vars[name];

Deno.test('chaves novas: a "default" do JSON, mesmo com a antiga ainda lá', () => {
  const vars = env({
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'sb_publishable_a' }),
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_a' }),
    SUPABASE_ANON_KEY: 'eyJ.anon',
    SUPABASE_SERVICE_ROLE_KEY: 'eyJ.service',
  });
  assertEquals(publishableKey(vars), 'sb_publishable_a');
  assertEquals(secretKey(vars), 'sb_secret_a');
});

Deno.test('com várias chaves, vale a "default"', () => {
  const vars = env({ SUPABASE_SECRET_KEYS: JSON.stringify({ cron: 'sb_secret_cron', default: 'sb_secret_a' }) });
  assertEquals(secretKey(vars), 'sb_secret_a');
});

Deno.test('sem a "default" (trocada no painel), a primeira que houver', () => {
  const vars = env({ SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ app: 'sb_publishable_app', web: 'sb_publishable_web' }) });
  assertEquals(publishableKey(vars), 'sb_publishable_app');
});

Deno.test('projeto só com as antigas: usa a anon e a service role', () => {
  const vars = env({ SUPABASE_ANON_KEY: 'eyJ.anon', SUPABASE_SERVICE_ROLE_KEY: 'eyJ.service' });
  assertEquals(publishableKey(vars), 'eyJ.anon');
  assertEquals(secretKey(vars), 'eyJ.service');
});

Deno.test('JSON vazio ou inválido: cai na antiga', () => {
  for (const raw of ['', '{}', '{"default": ""}', 'não é json', 'null', '"sb_secret_solta"']) {
    const vars = env({ SUPABASE_SECRET_KEYS: raw, SUPABASE_SERVICE_ROLE_KEY: 'eyJ.service' });
    assertEquals(secretKey(vars), 'eyJ.service', raw);
  }
});

Deno.test('sem nenhuma chave, o erro diz qual falta', () => {
  assertThrows(() => publishableKey(env({})), Error, 'SUPABASE_PUBLISHABLE_KEYS (ou SUPABASE_ANON_KEY)');
  assertThrows(() => secretKey(env({ SUPABASE_SECRET_KEYS: '{}' })), Error, 'SUPABASE_SECRET_KEYS (ou SUPABASE_SERVICE_ROLE_KEY)');
});

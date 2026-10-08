import { assertEquals } from '@std/assert';

import { FINANCE_DEFAULT_MODEL, financeConfig, MISSING_KEY_MESSAGE } from './config.ts';

const env = (vars: Record<string, string>) => (name: string) => vars[name];

Deno.test('financeConfig fails closed without the Anthropic key, even with OpenRouter set', () => {
  assertEquals(financeConfig(env({})), MISSING_KEY_MESSAGE);
  assertEquals(financeConfig(env({ ANTHROPIC_API_KEY: '  ' })), MISSING_KEY_MESSAGE);
  assertEquals(
    financeConfig(env({ OPENROUTER_API_KEY: 'or', FINANCE_PROVIDER: 'openrouter', NUKE_PROVIDER: 'openrouter' })),
    MISSING_KEY_MESSAGE,
  );
});

Deno.test('financeConfig always uses Anthropic, Sonnet 5.5 unless FINANCE_MODEL says otherwise', () => {
  assertEquals(FINANCE_DEFAULT_MODEL, 'claude-sonnet-5-5');
  assertEquals(financeConfig(env({ ANTHROPIC_API_KEY: 'an', OPENROUTER_API_KEY: 'or', FINANCE_PROVIDER: 'openrouter' })), {
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    modelEnv: 'FINANCE_MODEL',
    apiKey: 'an',
  });
  const custom = financeConfig(env({ ANTHROPIC_API_KEY: 'an', FINANCE_MODEL: ' claude-opus-5-5 ', NUKE_MODEL: 'x' }));
  assertEquals(typeof custom !== 'string' && custom.model, 'claude-opus-5-5');
  const blank = financeConfig(env({ ANTHROPIC_API_KEY: 'an', FINANCE_MODEL: '  ' }));
  assertEquals(typeof blank !== 'string' && blank.model, 'claude-sonnet-5-5');
});

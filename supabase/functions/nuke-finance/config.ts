// Provedor e modelo do consultor financeiro: só a API da Anthropic. Dados do
// banco nunca vão para a OpenRouter, mesmo com a chave dela cadastrada.
//
// Secrets: ANTHROPIC_API_KEY (obrigatório) e FINANCE_MODEL (opcional).

import type { VisionConfig } from '../_shared/vision.ts';

export const FINANCE_DEFAULT_MODEL = 'claude-haiku-5-5';

export const MISSING_KEY_MESSAGE =
  'O consultor financeiro ainda não está configurado: cadastre ANTHROPIC_API_KEY nos secrets do Supabase.';

/** Configuração da IA do consultor, ou a mensagem de erro quando falta a chave. */
export function financeConfig(
  env: (name: string) => string | undefined = (name) => Deno.env.get(name),
): VisionConfig | string {
  const apiKey = env('ANTHROPIC_API_KEY');
  if (!apiKey?.trim()) return MISSING_KEY_MESSAGE;
  return {
    provider: 'anthropic',
    model: env('FINANCE_MODEL')?.trim() || FINANCE_DEFAULT_MODEL,
    modelEnv: 'FINANCE_MODEL',
    apiKey,
  };
}

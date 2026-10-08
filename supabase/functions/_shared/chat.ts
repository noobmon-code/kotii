// Conversa com IA devolvendo dados estruturados (schema zod), via Anthropic
// ou OpenRouter, com o mesmo esquema de provedor e modelo da leitura de
// imagens (ver visionConfig). Usado pelo Nuke, o assistente da casa, e pelo
// Nuke consultor financeiro (nuke-finance, que só usa a Anthropic).

import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

import { ExtractionError, parseModelJson, type VisionConfig } from './vision.ts';

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface ChatInput<S extends z.ZodType> {
  config: VisionConfig;
  schema: S;
  /** Nome curto do schema (a-z, _), exigido pela saída estruturada da OpenRouter. */
  schemaName: string;
  system: string;
  /** Histórico em ordem; a última fala é da pessoa. */
  turns: ChatTurn[];
  fetchImpl?: typeof fetch;
  anthropic?: Anthropic;
}

let sharedAnthropic: Anthropic | null = null;
function anthropicClient(): Anthropic {
  sharedAnthropic ??= new Anthropic({ timeout: 60_000, maxRetries: 1 });
  return sharedAnthropic;
}

export function chatStructured<S extends z.ZodType>(input: ChatInput<S>): Promise<z.infer<S>> {
  if (!input.config.apiKey) {
    return Promise.reject(new ExtractionError('O Nuke ainda não está configurado: falta a chave da IA no Supabase.', 503));
  }
  if (input.turns.at(-1)?.role !== 'user') {
    return Promise.reject(new ExtractionError('A conversa precisa terminar com uma mensagem.', 400));
  }
  return input.config.provider === 'openrouter' ? chatWithOpenRouter(input) : chatWithAnthropic(input);
}

// Conversa na tela: esforço baixo responde rápido e basta para perguntas da casa.
async function chatWithAnthropic<S extends z.ZodType>(input: ChatInput<S>): Promise<z.infer<S>> {
  const client = input.anthropic ?? anthropicClient();
  const model = input.config.model;
  const useFallbacks = /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);
  let response;
  try {
    response = await client.beta.messages.parse({
      model,
      max_tokens: 8000,
      output_config: { effort: 'low', format: betaZodOutputFormat(input.schema) },
      // Recusa por engano do classificador: a API refaz no modelo de fallback.
      ...(useFallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      system: input.system,
      messages: input.turns.map((turn) => ({ role: turn.role, content: turn.text })),
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      throw new ExtractionError('Muita conversa agora. Tente de novo em instantes.', 429);
    }
    if (err instanceof Anthropic.APIError) {
      console.error('anthropic error', err.status, err.message);
      throw new ExtractionError('Não consegui responder agora. Tente de novo.', 502);
    }
    throw err;
  }

  if (response.stop_reason === 'refusal') {
    throw new ExtractionError('Não posso ajudar com isso.', 422);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new ExtractionError('A resposta ficou longa demais. Pergunte de outro jeito.', 422);
  }
  if (!response.parsed_output) {
    throw new ExtractionError('Me enrolei na resposta. Tente de novo.', 502);
  }
  return response.parsed_output;
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('');
  }
  return '';
}

// OpenRouter: instruções e schema vão na última mensagem da pessoa, porque
// alguns modelos recusam mensagem de sistema.
async function chatWithOpenRouter<S extends z.ZodType>(input: ChatInput<S>): Promise<z.infer<S>> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const { $schema: _dialect, ...responseSchema } = z.toJSONSchema(input.schema) as Record<string, unknown>;
  const history = input.turns.slice(0, -1);
  const last = input.turns[input.turns.length - 1];
  const prompt = `${input.system}\n\nMensagem da pessoa:\n${last.text}\n\nResponda somente com um objeto JSON válido neste schema:\n${JSON.stringify(responseSchema)}`;

  let response: Response;
  try {
    response = await fetchImpl(OPENROUTER_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.config.apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'Kotii',
      },
      body: JSON.stringify({
        model: input.config.model,
        max_tokens: 8000,
        temperature: 0.4,
        messages: [
          ...history.map((turn) => ({ role: turn.role, content: turn.text })),
          { role: 'user', content: prompt },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: input.schemaName, strict: true, schema: responseSchema },
        },
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    console.error('openrouter request failed', err);
    throw new ExtractionError('Não consegui falar com a IA agora. Tente de novo.', 502);
  }

  const body = await response.json().catch(() => null);
  if (!response.ok || body?.error) {
    const status = Number(body?.error?.code) || response.status;
    console.error('openrouter error', status, body?.error?.message);
    if (status === 429) throw new ExtractionError('Limite do modelo atingido agora. Tente de novo mais tarde.', 429);
    if (status === 402) throw new ExtractionError('Sem créditos na OpenRouter para o Nuke.', 502);
    if (status === 401) throw new ExtractionError('Chave da OpenRouter inválida. Confira OPENROUTER_API_KEY no Supabase.', 502);
    throw new ExtractionError('Não consegui responder agora. Tente de novo.', 502);
  }

  const choice = body?.choices?.[0];
  if (choice?.finish_reason === 'length') {
    throw new ExtractionError('A resposta ficou longa demais. Pergunte de outro jeito.', 422);
  }
  let parsed: unknown;
  try {
    parsed = parseModelJson(messageText(choice?.message?.content));
  } catch {
    throw new ExtractionError('Me enrolei na resposta. Tente de novo.', 502);
  }
  const result = input.schema.safeParse(parsed);
  if (!result.success) {
    console.error('openrouter chat output did not match schema', result.error.issues.slice(0, 5));
    throw new ExtractionError('Me enrolei na resposta. Tente de novo.', 502);
  }
  return result.data;
}

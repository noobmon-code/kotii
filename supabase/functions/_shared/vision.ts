// Leitura de imagens com IA devolvendo dados estruturados (schema zod), via
// Anthropic ou OpenRouter. Usado pela leitura de notas e de documentos de saúde.
//
// Secrets: ANTHROPIC_API_KEY ou OPENROUTER_API_KEY (uma das duas);
// <PREFIXO>_PROVIDER ("anthropic" | "openrouter") e <PREFIXO>_MODEL opcionais.
// Com a chave da OpenRouter, ela é usada (modelo padrão: DeepSeek V4.1 Flash,
// que lê texto e imagem); a Anthropic só com a chave dela sozinha ou com
// <PREFIXO>_PROVIDER=anthropic.

import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { Buffer } from 'node:buffer';
import { z } from 'zod';

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface VisionImage {
  base64: string;
  mediaType: ImageMediaType;
}

export class ExtractionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const OPENROUTER_DEFAULT_MODEL = 'deepseek/deepseek-v4.1-flash';
export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5';
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export interface VisionConfig {
  provider: 'anthropic' | 'openrouter';
  model: string;
  /** Variável que o usuário ajusta para trocar de modelo (vai nas mensagens de erro). */
  modelEnv: string;
  apiKey: string | undefined;
}

/**
 * Provedor e modelo a partir dos secrets. `prefixes` em ordem de prioridade:
 * ['HEALTH', 'RECEIPT'] lê HEALTH_MODEL e, se ausente, RECEIPT_MODEL.
 */
export function visionConfig(
  prefixes: string[],
  env: (name: string) => string | undefined = (name) => Deno.env.get(name),
): VisionConfig {
  const pick = (suffix: string) => {
    for (const prefix of prefixes) {
      const value = env(`${prefix}_${suffix}`)?.trim();
      if (value) return { value, name: `${prefix}_${suffix}` };
    }
    return null;
  };
  const openRouterKey = env('OPENROUTER_API_KEY');
  const anthropicKey = env('ANTHROPIC_API_KEY');
  const requested = pick('PROVIDER')?.value;
  const provider =
    requested === 'anthropic' || requested === 'openrouter' ? requested : openRouterKey ? 'openrouter' : 'anthropic';
  const model = pick('MODEL');
  return {
    provider,
    model: model?.value ?? (provider === 'openrouter' ? OPENROUTER_DEFAULT_MODEL : ANTHROPIC_DEFAULT_MODEL),
    modelEnv: model?.name ?? `${prefixes[0]}_MODEL`,
    apiKey: provider === 'openrouter' ? openRouterKey : anthropicKey,
  };
}

// A API aceita até 5 MB por imagem em base64 (+33%). O app já manda a foto
// reduzida para ~3,75 MP, que fica bem abaixo disso.
export const MAX_IMAGE_BYTES = 3_700_000;
const MEDIA_TYPES: Record<string, ImageMediaType> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function mediaTypeOf(path: string): ImageMediaType | null {
  return MEDIA_TYPES[path.split('.').pop()?.toLowerCase() ?? ''] ?? null;
}

export async function toVisionImage(blob: Blob, mediaType: ImageMediaType): Promise<VisionImage> {
  if (blob.size > MAX_IMAGE_BYTES) throw new ExtractionError('Imagem grande demais.', 413);
  return { base64: Buffer.from(await blob.arrayBuffer()).toString('base64'), mediaType };
}

/** JSON da resposta, tolerando cercas ```json e texto em volta do objeto. */
export function parseModelJson(content: string): unknown {
  const text = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new SyntaxError('no JSON object in model output');
  return JSON.parse(text.slice(start, end + 1));
}

export interface ExtractInput<S extends z.ZodType> {
  config: VisionConfig;
  schema: S;
  /** Nome curto do schema (a-z, _), exigido pela saída estruturada da OpenRouter. */
  schemaName: string;
  system: string;
  prompt: string;
  images: VisionImage[];
  /** Como o documento aparece nas mensagens: "a nota", "a ficha". */
  subject: string;
  fetchImpl?: typeof fetch;
  anthropic?: Anthropic;
}

// Criado só quando usado: sem ANTHROPIC_API_KEY o construtor falharia na
// inicialização, mesmo quem usa só a OpenRouter.
let sharedAnthropic: Anthropic | null = null;
function anthropicClient(): Anthropic {
  sharedAnthropic ??= new Anthropic({ timeout: 120_000, maxRetries: 1 });
  return sharedAnthropic;
}

export function extractStructured<S extends z.ZodType>(input: ExtractInput<S>): Promise<z.infer<S>> {
  if (!input.config.apiKey) {
    return Promise.reject(new ExtractionError('Leitura com IA não configurada: falta a chave da IA no Supabase.', 503));
  }
  return input.config.provider === 'openrouter' ? extractWithOpenRouter(input) : extractWithAnthropic(input);
}

// Leitura interativa (o usuário espera na tela): esforço médio equilibra
// precisão e latência.
async function extractWithAnthropic<S extends z.ZodType>(input: ExtractInput<S>): Promise<z.infer<S>> {
  const client = input.anthropic ?? anthropicClient();
  const model = input.config.model;
  const useFallbacks = /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);
  let response;
  try {
    response = await client.beta.messages.parse({
      model,
      max_tokens: 16000,
      output_config: { effort: 'medium', format: betaZodOutputFormat(input.schema) },
      // Se o modelo recusar por engano (classificador de segurança), a API
      // reexecuta no modelo de fallback dentro da mesma chamada.
      ...(useFallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      system: input.system,
      messages: [
        {
          role: 'user',
          content: [
            ...input.images.map((image) => ({
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: image.mediaType, data: image.base64 },
            })),
            { type: 'text', text: input.prompt },
          ],
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      throw new ExtractionError('Muitas leituras agora. Tente de novo em instantes.', 429);
    }
    if (err instanceof Anthropic.APIError) {
      console.error('anthropic error', err.status, err.message);
      throw new ExtractionError(`Falha ao ler ${input.subject}. Tente novamente.`, 502);
    }
    throw err;
  }

  if (response.stop_reason === 'refusal') {
    throw new ExtractionError('Não foi possível ler esta imagem.', 422);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new ExtractionError('Documento longo demais para ler de uma vez.', 422);
  }
  if (!response.parsed_output) {
    throw new ExtractionError('A leitura veio incompleta. Tente outra foto.', 502);
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

function openRouterError(status: number, config: VisionConfig, subject: string): ExtractionError {
  switch (status) {
    case 401:
      return new ExtractionError('Chave da OpenRouter inválida. Confira OPENROUTER_API_KEY no Supabase.', 502);
    case 402:
      return new ExtractionError('Sem créditos na OpenRouter para a leitura com IA.', 502);
    case 429:
      return new ExtractionError('Limite de leituras do modelo atingido agora. Tente de novo mais tarde.', 429);
    case 400:
    case 404:
    case 413:
      return new ExtractionError(
        `O modelo "${config.model}" recusou o pedido. Confira ${config.modelEnv} (precisa aceitar imagem).`,
        502,
      );
    default:
      return new ExtractionError(`Falha ao ler ${subject}. Tente novamente.`, 502);
  }
}

// OpenRouter: API compatível com OpenAI, para usar modelos de outros
// provedores com uma chave só.
async function extractWithOpenRouter<S extends z.ZodType>(input: ExtractInput<S>): Promise<z.infer<S>> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const { $schema: _dialect, ...responseSchema } = z.toJSONSchema(input.schema) as Record<string, unknown>;
  // Instruções vão na mensagem do usuário: modelos como o Gemma recusam
  // mensagem de sistema em alguns provedores da OpenRouter.
  const prompt = `${input.system}\n\n${input.prompt}\n\nResponda somente com um objeto JSON válido neste schema:\n${JSON.stringify(responseSchema)}`;

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
        max_tokens: 16000,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              ...input.images.map((image) => ({
                type: 'image_url',
                image_url: { url: `data:${image.mediaType};base64,${image.base64}` },
              })),
              { type: 'text', text: prompt },
            ],
          },
        ],
        // Modelos que suportam saída estruturada seguem o schema; os demais
        // seguem a instrução do texto e a resposta é validada abaixo.
        response_format: {
          type: 'json_schema',
          json_schema: { name: input.schemaName, strict: true, schema: responseSchema },
        },
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    console.error('openrouter request failed', err);
    throw new ExtractionError('Falha ao falar com a OpenRouter. Tente novamente.', 502);
  }

  const body = await response.json().catch(() => null);
  // A OpenRouter às vezes responde 200 com um objeto `error` (erro do provedor).
  if (!response.ok || body?.error) {
    const status = Number(body?.error?.code) || response.status;
    console.error('openrouter error', status, body?.error?.message);
    throw openRouterError(status, input.config, input.subject);
  }

  const choice = body?.choices?.[0];
  if (choice?.finish_reason === 'length') {
    throw new ExtractionError('Documento longo demais para ler de uma vez.', 422);
  }
  const content = messageText(choice?.message?.content);
  if (!content.trim()) {
    throw new ExtractionError('A leitura veio vazia. Tente outra foto.', 502);
  }

  let parsed: unknown;
  try {
    parsed = parseModelJson(content);
  } catch {
    throw new ExtractionError('O modelo não devolveu os dados no formato certo. Tente outra foto.', 502);
  }
  const result = input.schema.safeParse(parsed);
  if (!result.success) {
    console.error('openrouter output did not match schema', result.error.issues.slice(0, 5));
    throw new ExtractionError('A leitura veio incompleta ou fora do formato. Tente outra foto.', 502);
  }
  return result.data;
}

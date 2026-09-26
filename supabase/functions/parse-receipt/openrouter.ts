// Leitura de nota via OpenRouter (API compatível com OpenAI), para usar
// modelos de outros provedores com uma chave só.

import { z } from 'zod';

import {
  type CatalogProduct,
  type ExtractedReceipt,
  ExtractedReceiptSchema,
  ExtractionError,
  type ImageMediaType,
  instructions,
  SYSTEM,
} from './extract.ts';

export const OPENROUTER_DEFAULT_MODEL = 'google/gemma-4-31b-it:free';
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

const { $schema: _dialect, ...RESPONSE_SCHEMA } = z.toJSONSchema(ExtractedReceiptSchema) as Record<string, unknown>;

/** JSON da resposta, tolerando cercas ```json e texto em volta do objeto. */
export function parseModelJson(content: string): unknown {
  const text = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new SyntaxError('no JSON object in model output');
  return JSON.parse(text.slice(start, end + 1));
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('');
  }
  return '';
}

function openRouterError(status: number, model: string): ExtractionError {
  switch (status) {
    case 401:
      return new ExtractionError('Chave da OpenRouter inválida. Confira OPENROUTER_API_KEY no Supabase.', 502);
    case 402:
      return new ExtractionError('Sem créditos na OpenRouter para ler notas.', 502);
    case 429:
      return new ExtractionError('Limite de leituras do modelo atingido agora. Tente de novo mais tarde.', 429);
    case 400:
    case 404:
      return new ExtractionError(
        `O modelo "${model}" recusou o pedido. Confira RECEIPT_MODEL (precisa aceitar imagem).`,
        502,
      );
    default:
      return new ExtractionError('Falha ao ler a nota. Tente novamente.', 502);
  }
}

export async function extractWithOpenRouter(input: {
  apiKey: string;
  model: string;
  imageBase64: string;
  mediaType: ImageMediaType;
  catalog: CatalogProduct[];
  fetchImpl?: typeof fetch;
}): Promise<ExtractedReceipt> {
  const fetchImpl = input.fetchImpl ?? fetch;
  // Instruções vão na mensagem do usuário: modelos como o Gemma recusam
  // mensagem de sistema em alguns provedores da OpenRouter.
  const prompt = `${SYSTEM}\n\n${instructions(input.catalog)}\n\nResponda somente com um objeto JSON válido neste schema:\n${JSON.stringify(RESPONSE_SCHEMA)}`;

  let response: Response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'Nooky',
      },
      body: JSON.stringify({
        model: input.model,
        max_tokens: 16000,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${input.mediaType};base64,${input.imageBase64}` } },
              { type: 'text', text: prompt },
            ],
          },
        ],
        // Modelos que suportam saída estruturada seguem o schema; os demais
        // seguem a instrução do texto e a resposta é validada abaixo.
        response_format: { type: 'json_schema', json_schema: { name: 'receipt', strict: true, schema: RESPONSE_SCHEMA } },
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
    throw openRouterError(status, input.model);
  }

  const choice = body?.choices?.[0];
  if (choice?.finish_reason === 'length') {
    throw new ExtractionError('Nota longa demais para ler de uma vez.', 422);
  }
  const content = messageText(choice?.message?.content);
  if (!content.trim()) {
    throw new ExtractionError('A leitura da nota veio vazia. Tente outra foto.', 502);
  }

  let parsed: unknown;
  try {
    parsed = parseModelJson(content);
  } catch {
    throw new ExtractionError('O modelo não devolveu os dados no formato certo. Tente outra foto.', 502);
  }
  const result = ExtractedReceiptSchema.safeParse(parsed);
  if (!result.success) {
    console.error('openrouter output did not match schema', result.error.issues.slice(0, 5));
    throw new ExtractionError('A leitura veio incompleta ou fora do formato. Tente outra foto.', 502);
  }
  return result.data;
}

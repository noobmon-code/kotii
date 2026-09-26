import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

import { CATEGORY_KEYS } from '../_shared/categories.ts';

export const UNITS = ['un', 'kg', 'g', 'l', 'ml'] as const;

export const ExtractedReceiptSchema = z.object({
  is_receipt: z.boolean(),
  store_name: z.string().nullable(),
  cnpj: z.string().nullable(),
  address: z.string().nullable(),
  purchased_at: z.string().nullable(),
  access_key: z.string().nullable(),
  total: z.number().nullable(),
  items: z.array(
    z.object({
      raw_description: z.string(),
      normalized_name: z.string(),
      category: z.enum(CATEGORY_KEYS),
      quantity: z.number(),
      unit: z.enum(UNITS),
      unit_price: z.number(),
      total_price: z.number(),
      matched_product_id: z.string().nullable(),
    }),
  ),
});
export type ExtractedReceipt = z.infer<typeof ExtractedReceiptSchema>;

export interface CatalogProduct {
  id: string;
  name: string;
}

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp';

export const SYSTEM = `Você lê fotos de notas fiscais de compra brasileiras (NFC-e, cupom fiscal, DANFE) e devolve os dados estruturados. Os dados alimentam um comparativo de preços entre mercados, então preço e quantidade de cada item precisam bater com o impresso.`;

export function instructions(catalog: CatalogProduct[]): string {
  const catalogText = catalog.length
    ? catalog.map((p) => `${p.id} | ${p.name}`).join('\n')
    : '(nenhum ainda)';
  return `Extraia os dados desta nota.

- items: um por produto, na ordem impressa. Não inclua descontos gerais, troco, formas de pagamento nem tributos. Desconto de um item específico entra no total_price dele (valor líquido).
- raw_description: a descrição exatamente como impressa.
- normalized_name: nome legível em português com marca e tamanho quando houver. Ex.: "ARROZ T.JOAO TP1 5KG" -> "Arroz Tio João Tipo 1 5kg".
- quantity/unit: itens pesados usam "kg" com a quantidade pesada (ex.: 0,535 kg de banana); demais usam a unidade impressa, ou "un".
- unit_price: preço por unidade de "unit"; total_price: valor do item.
- matched_product_id: o id de um produto da lista abaixo se for o mesmo produto (mesma marca e mesmo tamanho); senão null. Na dúvida, null.
- purchased_at: data/hora de emissão em ISO 8601; sem fuso impresso, use -03:00.
- cnpj: 14 dígitos do emitente, sem pontuação. access_key: os 44 dígitos da chave de acesso, se visível.
- Campo ilegível: null. Não invente valores.
- Se a imagem não for uma nota de compra, is_receipt=false e items vazio.

Produtos já cadastrados (id | nome):
${catalogText}`;
}

export class ExtractionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// Leitura interativa (o usuário espera na tela): esforço médio equilibra
// precisão e latência. Modelo configurável por RECEIPT_MODEL.
export async function extractWithAnthropic(input: {
  client: Anthropic;
  model: string;
  imageBase64: string;
  mediaType: ImageMediaType;
  catalog: CatalogProduct[];
}): Promise<ExtractedReceipt> {
  const useFallbacks = /^claude-(opus-5|fable-5)/.test(input.model);
  const response = await input.client.beta.messages.parse({
    model: input.model,
    max_tokens: 16000,
    output_config: { effort: 'medium', format: betaZodOutputFormat(ExtractedReceiptSchema) },
    // Se o modelo recusar por engano (classificador de segurança), a API
    // reexecuta no modelo de fallback dentro da mesma chamada.
    ...(useFallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: input.mediaType, data: input.imageBase64 } },
          { type: 'text', text: instructions(input.catalog) },
        ],
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new ExtractionError('Não foi possível ler esta imagem.', 422);
  }
  if (response.stop_reason === 'max_tokens') {
    throw new ExtractionError('Nota longa demais para ler de uma vez.', 422);
  }
  if (!response.parsed_output) {
    throw new ExtractionError('A leitura da nota veio incompleta. Tente outra foto.', 502);
  }
  return response.parsed_output;
}

export interface CleanItem {
  position: number;
  raw_description: string;
  suggested_name: string;
  suggested_category: string;
  product_id: string | null;
  quantity: number;
  unit: (typeof UNITS)[number];
  unit_price: number;
  total_price: number;
}

export interface CleanReceipt {
  storeName: string | null;
  cnpj: string | null;
  address: string | null;
  purchasedAt: string | null;
  accessKey: string | null;
  total: number | null;
  items: CleanItem[];
}

const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;

/**
 * Normaliza o que veio da IA para o que o banco aceita: dígitos de CNPJ e
 * chave, data válida, quantidades positivas, preço unitário coerente e ids de
 * produto que realmente existem na família (alias exato tem prioridade).
 */
export function cleanReceipt(
  extracted: ExtractedReceipt,
  catalogIds: Set<string>,
  aliasMatches: Map<string, string>,
): CleanReceipt {
  const digits = (s: string | null) => (s ?? '').replace(/\D/g, '');
  const cnpj = digits(extracted.cnpj);
  const accessKey = digits(extracted.access_key);
  const purchasedAt =
    extracted.purchased_at && !Number.isNaN(Date.parse(extracted.purchased_at))
      ? new Date(extracted.purchased_at).toISOString()
      : null;

  const items: CleanItem[] = [];
  for (const it of extracted.items) {
    const raw = it.raw_description.trim();
    if (!raw) continue;
    const quantity = it.quantity > 0 ? round(it.quantity, 3) : 1;
    const total = Math.max(0, round(it.total_price, 2));
    const unitPrice = it.unit_price > 0 ? round(it.unit_price, 4) : round(total / quantity, 4);
    const suggested = it.matched_product_id && catalogIds.has(it.matched_product_id) ? it.matched_product_id : null;
    items.push({
      position: items.length,
      raw_description: raw,
      suggested_name: it.normalized_name.trim() || raw,
      suggested_category: it.category,
      product_id: aliasMatches.get(raw) ?? suggested,
      quantity,
      unit: it.unit,
      unit_price: unitPrice,
      total_price: total,
    });
  }

  return {
    storeName: extracted.store_name?.trim() || null,
    cnpj: cnpj.length === 14 ? cnpj : null,
    address: extracted.address?.trim() || null,
    purchasedAt,
    accessKey: accessKey.length === 44 ? accessKey : null,
    total: extracted.total != null && extracted.total >= 0 ? round(extracted.total, 2) : null,
    items,
  };
}

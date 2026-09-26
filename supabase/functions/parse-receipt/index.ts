// POST { image_path } -> lê a foto da nota (já enviada ao bucket "receipts"),
// extrai os itens com IA e cria um rascunho de nota para o usuário revisar.
//
// Roda com o JWT do usuário: todas as leituras e escritas passam pela RLS.
// Secrets: ANTHROPIC_API_KEY (obrigatório), RECEIPT_MODEL (opcional).

import Anthropic from '@anthropic-ai/sdk';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Buffer } from 'node:buffer';

import { cleanReceipt, extractReceipt, ExtractionError, type ImageMediaType } from './extract.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// A API aceita até 5 MB por imagem em base64 (+33%). O app já manda a foto
// reduzida para ~3,75 MP, que fica bem abaixo disso.
const MAX_IMAGE_BYTES = 3_700_000;
const MEDIA_TYPES: Record<string, ImageMediaType> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const anthropic = new Anthropic({ timeout: 120_000, maxRetries: 1 });
const model = Deno.env.get('RECEIPT_MODEL') ?? 'claude-opus-5';

async function findOrCreateStore(
  db: SupabaseClient,
  store: { name: string | null; cnpj: string | null; address: string | null },
): Promise<string | null> {
  if (!store.name && !store.cnpj) return null;

  const lookup = store.cnpj
    ? db.from('stores').select('id').eq('cnpj', store.cnpj)
    : db.from('stores').select('id').is('cnpj', null).ilike('name', store.name!);
  const { data: existing, error: lookupError } = await lookup.limit(1).maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) return existing.id;

  const { data, error } = await db
    .from('stores')
    .insert({ name: store.name ?? `CNPJ ${store.cnpj}`, cnpj: store.cnpj, address: store.address })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método não suportado.' }, 405);

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
  );

  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return json({ error: 'Não autenticado.' }, 401);

  const { data: householdId } = await db.rpc('current_household_id');
  if (!householdId) return json({ error: 'Crie ou entre em uma família primeiro.' }, 403);

  let imagePath: unknown;
  try {
    ({ image_path: imagePath } = await req.json());
  } catch {
    return json({ error: 'Corpo inválido.' }, 400);
  }
  if (typeof imagePath !== 'string' || !imagePath.startsWith(`${householdId}/`)) {
    return json({ error: 'Imagem inválida.' }, 400);
  }
  const mediaType = MEDIA_TYPES[imagePath.split('.').pop()?.toLowerCase() ?? ''];
  if (!mediaType) return json({ error: 'Formato de imagem não suportado.' }, 400);

  const { data: blob, error: downloadError } = await db.storage.from('receipts').download(imagePath);
  if (downloadError || !blob) return json({ error: 'Imagem não encontrada.' }, 404);
  if (blob.size > MAX_IMAGE_BYTES) return json({ error: 'Imagem grande demais.' }, 413);
  const imageBase64 = Buffer.from(await blob.arrayBuffer()).toString('base64');

  const { data: catalog, error: catalogError } = await db
    .from('products')
    .select('id, name')
    .order('name')
    .limit(400);
  if (catalogError) return json({ error: 'Falha ao ler produtos.' }, 500);

  let extracted;
  try {
    extracted = await extractReceipt({ client: anthropic, model, imageBase64, mediaType, catalog });
  } catch (err) {
    if (err instanceof ExtractionError) return json({ error: err.message }, err.status);
    if (err instanceof Anthropic.RateLimitError) {
      return json({ error: 'Muitas leituras agora. Tente de novo em instantes.' }, 429);
    }
    if (err instanceof Anthropic.APIError) {
      console.error('anthropic error', err.status, err.message);
      return json({ error: 'Falha ao ler a nota. Tente novamente.' }, 502);
    }
    throw err;
  }
  if (!extracted.is_receipt) {
    return json({ error: 'A imagem não parece ser uma nota fiscal de compra.' }, 422);
  }

  const descriptions = extracted.items.map((i) => i.raw_description.trim()).filter(Boolean);
  const { data: aliasRows } = await db.rpc('match_aliases', { p_descriptions: descriptions });
  const aliasMatches = new Map<string, string>(
    ((aliasRows ?? []) as { description: string; product_id: string }[]).map((r) => [r.description, r.product_id]),
  );
  const receipt = cleanReceipt(extracted, new Set(catalog.map((p) => p.id)), aliasMatches);

  if (receipt.accessKey) {
    const { data: dup } = await db
      .from('receipts')
      .select('id')
      .eq('access_key', receipt.accessKey)
      .maybeSingle();
    if (dup) return json({ receipt_id: dup.id, duplicate: true });
  }

  try {
    const storeId = await findOrCreateStore(db, {
      name: receipt.storeName,
      cnpj: receipt.cnpj,
      address: receipt.address,
    });

    const { data: created, error: receiptError } = await db
      .from('receipts')
      .insert({
        store_id: storeId,
        purchased_at: receipt.purchasedAt ?? new Date().toISOString(),
        total: receipt.total,
        access_key: receipt.accessKey,
        image_path: imagePath,
        source: 'ai',
        status: 'draft',
      })
      .select('id')
      .single();
    if (receiptError) throw receiptError;

    if (receipt.items.length) {
      const { error: itemsError } = await db
        .from('receipt_items')
        .insert(receipt.items.map((item) => ({ ...item, receipt_id: created.id })));
      if (itemsError) {
        await db.from('receipts').delete().eq('id', created.id);
        throw itemsError;
      }
    }

    return json({ receipt_id: created.id, duplicate: false, items: receipt.items.length });
  } catch (err) {
    console.error('db error', err);
    return json({ error: 'Falha ao salvar a nota.' }, 500);
  }
});

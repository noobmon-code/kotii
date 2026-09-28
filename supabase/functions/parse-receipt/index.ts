// POST { image_paths } (ou { image_path }) -> lê as fotos da nota (já enviadas
// ao bucket "receipts", em ordem; nota comprida vem em partes), extrai os
// itens com IA e cria um rascunho de nota para o usuário revisar.
//
// Roda com o JWT do usuário: todas as leituras e escritas passam pela RLS.
// Secrets: ANTHROPIC_API_KEY ou OPENROUTER_API_KEY (uma das duas);
// RECEIPT_MODEL e RECEIPT_PROVIDER ("anthropic" | "openrouter") opcionais.
// Com a chave da OpenRouter, ela é usada (padrão: DeepSeek V4.1 Flash).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { ExtractionError, extractStructured, mediaTypeOf, toVisionImage, visionConfig } from '../_shared/vision.ts';
import { cleanReceipt, ExtractedReceiptSchema, instructions, MAX_PHOTOS, SYSTEM } from './extract.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const config = visionConfig(['RECEIPT']);

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

  if (!config.apiKey) {
    return json({ error: 'Leitura de nota não configurada: falta a chave da IA no Supabase.' }, 503);
  }

  let body: { image_path?: unknown; image_paths?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Corpo inválido.' }, 400);
  }
  const imagePaths = Array.isArray(body.image_paths) ? body.image_paths : [body.image_path];
  if (
    !imagePaths.length ||
    imagePaths.length > MAX_PHOTOS ||
    imagePaths.some((p) => typeof p !== 'string' || !p.startsWith(`${householdId}/`))
  ) {
    return json({ error: 'Imagem inválida.' }, 400);
  }
  const images = [];
  for (const path of imagePaths as string[]) {
    const mediaType = mediaTypeOf(path);
    if (!mediaType) return json({ error: 'Formato de imagem não suportado.' }, 400);
    const { data: blob, error: downloadError } = await db.storage.from('receipts').download(path);
    if (downloadError || !blob) return json({ error: 'Imagem não encontrada.' }, 404);
    try {
      images.push(await toVisionImage(blob, mediaType));
    } catch (err) {
      // Foto grande demais: responde com o motivo, e o app apaga as fotos enviadas.
      if (err instanceof ExtractionError) return json({ error: err.message }, err.status);
      throw err;
    }
  }

  const { data: catalog, error: catalogError } = await db
    .from('products')
    .select('id, name')
    .order('name')
    .limit(400);
  if (catalogError) return json({ error: 'Falha ao ler produtos.' }, 500);

  let extracted;
  try {
    extracted = await extractStructured({
      config,
      schema: ExtractedReceiptSchema,
      schemaName: 'receipt',
      system: SYSTEM,
      prompt: instructions(catalog, images.length),
      images,
      subject: 'a nota',
    });
  } catch (err) {
    if (err instanceof ExtractionError) return json({ error: err.message }, err.status);
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
        image_path: imagePaths[0],
        extra_image_paths: imagePaths.slice(1),
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

// POST { image_paths } (ou { image_path }) -> lê as fotos da nota (já enviadas
// ao bucket "receipts", em ordem; nota comprida vem em partes, até MAX_PHOTOS),
// extrai os itens com IA e cria um rascunho de nota para o usuário revisar.
// As imagens podem ser fotos do papel ou prints da página da Sefaz com a nota.
// `access_key` (opcional): a chave do QR code, quando a Sefaz pediu o "não
// sou robô" e a nota veio pelos prints ou pela foto. Se a casa já tem uma nota com ela,
// devolve a existente (duplicate), sem gastar a IA; senão a nota guarda essa
// chave, a menos que a foto seja de outra nota, e o CNPJ dela acha o mercado
// quando a IA não leu um CNPJ válido (regras em accessKey.ts). Com a chave, a
// leitura sem nenhum item (só o topo ou o rodapé) não vira nota: 422 `no_items`,
// e a pendente continua no app; sem a data lida, a nota fica no mês da chave.
//
// Roda com o JWT do usuário: todas as leituras e escritas passam pela RLS,
// menos uma. O que a IA leu também vai para receipt_reads, com a chave secreta,
// e a nota guarda o id dessa leitura (read_id): só assim ela compartilha preço
// com outras casas (_shared/receiptRead.ts).
// Secrets: ANTHROPIC_API_KEY ou OPENROUTER_API_KEY (uma das duas);
// RECEIPT_MODEL e RECEIPT_PROVIDER ("anthropic" | "openrouter") opcionais.
// Com a chave da OpenRouter, ela é usada (padrão: DeepSeek V4.1 Flash).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { QuotaError, refundAiQuota, takeAiQuota } from '../_shared/aiQuota.ts';
import { publishableKey, secretKey } from '../_shared/apiKeys.ts';
import { ExtractionError, extractStructured, mediaTypeOf, toVisionImage, visionConfig } from '../_shared/vision.ts';
import { ALLOWED_HEADERS, callerHeaders } from '../_shared/caller.ts';
import { forgetReceiptRead, insertWithRead, receiptRead, saoPauloDay, saveReceiptRead } from '../_shared/receiptRead.ts';
import {
  duplicateBeforeRead,
  existingOnConflict,
  fallbackPurchasedAt,
  keyAfterRead,
  NO_ITEMS,
  photoIds,
  readWithoutItems,
  requestedAccessKey,
} from './accessKey.ts';
import {
  BOUGHT_RECEIPTS,
  type BoughtReceipt,
  boughtProducts,
  CATALOG_LIMIT,
  cleanReceipt,
  ExtractedReceiptSchema,
  imagePathsError,
  instructions,
  MAX_TOTAL_IMAGE_BYTES,
  promptCatalog,
  sameStoreName,
  SYSTEM,
} from './extract.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': ALLOWED_HEADERS,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const config = visionConfig(['RECEIPT']);

const STORE_PAGE = 1000;

const serverDb = () => createClient(Deno.env.get('SUPABASE_URL')!, secretKey());

async function findOrCreateStore(
  db: SupabaseClient,
  store: { name: string | null; cnpj: string | null; address: string | null },
): Promise<string | null> {
  if (!store.name && !store.cnpj) return null;

  // Sem CNPJ, pelo nome, comparado aqui: num ILIKE, "%", "_" e "*" no nome
  // que a IA leu seriam curingas e casariam com qualquer loja da casa.
  if (store.cnpj) {
    const { data: existing, error } = await db.from('stores').select('id').eq('cnpj', store.cnpj).limit(1).maybeSingle();
    if (error) throw error;
    if (existing) return existing.id;
  } else {
    // Página a página: a API devolve até 1000 linhas por pedido.
    for (let from = 0; ; from += STORE_PAGE) {
      const { data: unnamed, error } = await db.from('stores').select('id, name').is('cnpj', null).order('id').range(from, from + STORE_PAGE - 1);
      if (error) throw error;
      const existing = (unnamed ?? []).find((s) => sameStoreName(s.name, store.name!));
      if (existing) return existing.id;
      if ((unnamed ?? []).length < STORE_PAGE) break;
    }
  }

  const { data, error } = await db
    .from('stores')
    .insert({ name: store.name ?? `CNPJ ${store.cnpj}`, cnpj: store.cnpj, address: store.address })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

/** A nota da casa com esta chave de acesso (a RLS só mostra as da casa). */
async function receiptWithKey(db: SupabaseClient, accessKey: string): Promise<string | null> {
  const { data, error } = await db.from('receipts').select('id').eq('access_key', accessKey).maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método não suportado.' }, 405);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, publishableKey(), { global: { headers: callerHeaders(req) } });

  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return json({ error: 'Não autenticado.' }, 401);

  const { data: householdId } = await db.rpc('current_household_id');
  if (!householdId) return json({ error: 'Crie ou entre em uma família primeiro.' }, 403);

  if (!config.apiKey) {
    return json({ error: 'Leitura de nota não configurada: falta a chave da IA no Supabase.' }, 503);
  }

  let body: { image_path?: unknown; image_paths?: unknown; access_key?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Corpo inválido.' }, 400);
  }
  const imagePaths = Array.isArray(body.image_paths) ? body.image_paths : [body.image_path];
  const pathsError = imagePathsError(imagePaths, householdId);
  if (pathsError) return json(pathsError, 400);
  const givenKey = requestedAccessKey(body.access_key);
  if (givenKey === 'invalid') return json({ error: 'Chave de acesso inválida.' }, 400);
  const findByKey = (key: string) => receiptWithKey(db, key);
  // Nota do QR já na casa (lida por outra pessoa enquanto esta fotografava):
  // abre a existente, antes de baixar as fotos e gastar a IA.
  let existingBefore;
  try {
    existingBefore = await duplicateBeforeRead(givenKey, findByKey);
  } catch (err) {
    console.error('db error', err);
    return json({ error: 'Falha ao ler as notas.' }, 500);
  }
  if (existingBefore) return json({ receipt_id: existingBefore, duplicate: true });
  const images = [];
  let totalBytes = 0;
  for (const path of imagePaths as string[]) {
    const mediaType = mediaTypeOf(path);
    if (!mediaType) return json({ error: 'Formato de imagem não suportado.' }, 400);
    const { data: blob, error: downloadError } = await db.storage.from('receipts').download(path);
    if (downloadError || !blob) return json({ error: 'Imagem não encontrada.' }, 404);
    // Todas juntas vão num pedido só à IA: passando do que ele aceita, o app apaga as fotos e a pessoa manda menos.
    totalBytes += blob.size;
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
      return json({ error: 'As fotos juntas ficaram grandes demais para uma leitura. Mande menos fotos de uma vez.' }, 413);
    }
    try {
      images.push(await toVisionImage(blob, mediaType));
    } catch (err) {
      // Foto grande demais: responde com o motivo, e o app apaga as fotos enviadas.
      if (err instanceof ExtractionError) return json({ error: err.message }, err.status);
      throw err;
    }
  }

  // Os produtos que a IA vê: os mais comprados nas notas mais novas e, depois,
  // os cadastrados por último (promptCatalog). Sem as compras, só os mais novos.
  // As compras vêm pelas notas da casa (índice household_id + purchased_at) e
  // os itens de cada uma (índice receipt_id + position): pela receipt_items
  // direto, sem índice na casa nem na data, a busca varreria as linhas de todas as casas.
  const [newestResult, boughtResult] = await Promise.all([
    db.from('products').select('id, name').order('created_at', { ascending: false }).order('id').limit(CATALOG_LIMIT),
    db
      .from('receipts')
      .select('receipt_items(position, product:products(id, name))')
      .eq('household_id', householdId)
      .order('purchased_at', { ascending: false })
      .order('id')
      .limit(BOUGHT_RECEIPTS),
  ]);
  if (newestResult.error) return json({ error: 'Falha ao ler produtos.' }, 500);
  if (boughtResult.error) console.warn('parse-receipt: purchases not read for the catalog', boughtResult.error.code);
  const catalog = promptCatalog(boughtProducts((boughtResult.data ?? []) as unknown as BoughtReceipt[]), newestResult.data ?? []);

  let ticket;
  try {
    ticket = await takeAiQuota(db, 'photo');
  } catch (err) {
    if (err instanceof QuotaError) return json({ error: err.message }, err.status);
    throw err;
  }

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
    // A IA falhou (ou recusou por engano): a leitura não conta no limite do mês.
    if (!(err instanceof ExtractionError && err.status === 422)) await refundAiQuota(ticket);
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
  // A nota do QR sem itens (os prints só do topo ou do rodapé) não vira nota: a pendente fica no app, para os
  // prints da lista de itens. A leitura não conta no limite do mês.
  if (readWithoutItems(givenKey, receipt.items.length)) {
    await refundAiQuota(ticket).catch((e) => console.error('refund_ai failed', e));
    return json(
      { error: 'Não achei os itens da nota nas imagens. Mande de novo junto com a lista de itens (nos prints da Sefaz ou na foto do papel).', code: NO_ITEMS },
      422,
    );
  }

  try {
    // A chave do QR vale mais que a lida na foto, menos quando a foto é de outra nota.
    const { key: accessKey, existing, mismatch } = await keyAfterRead(givenKey, receipt.accessKey, findByKey);
    if (mismatch) console.warn('parse-receipt: the photo is not the note whose QR code was read; keeping the key read from the photo');
    if (existing) return json({ receipt_id: existing, duplicate: true });

    // Sem CNPJ lido, o da chave do QR acha o mercado da casa; a leitura do servidor fica só com o que a IA leu.
    const ids = photoIds({ accessKey: receipt.accessKey, cnpj: receipt.cnpj }, givenKey, mismatch);
    const storeId = await findOrCreateStore(db, {
      name: receipt.storeName,
      cnpj: ids.storeCnpj,
      address: receipt.address,
    });

    // A leitura antes da nota: a nota nasce apontando para ela. Sem leitura
    // (o banco ainda sem a tabela, a chave secreta faltando), a nota é salva do
    // mesmo jeito, só não compartilha preço.
    let readId = await saveReceiptRead(
      serverDb,
      receiptRead({
        householdId,
        source: 'ai',
        // A chave e o CNPJ que a IA leu na foto, não os da chave que o app mandou (essa é do QR que o celular
        // leu: a nota guarda, o mercado usa o CNPJ dela, mas o servidor não a viu).
        accessKey: ids.read.accessKey,
        cnpj: ids.read.cnpj,
        storeName: receipt.storeName,
        purchasedOn: saoPauloDay(receipt.purchasedAt),
        // Sem a linha de preço que a nota não imprimiu (quantidade e preço unitário ilegíveis): ela não compartilha.
        lines: receipt.readLines,
      }),
    );
    const dropRead = () => (readId ? forgetReceiptRead(serverDb, readId) : Promise.resolve());

    const saved = await insertWithRead<{ id: string }>(
      (withRead) =>
        db
          .from('receipts')
          .insert({
            ...(withRead ? { read_id: withRead } : {}),
            store_id: storeId,
            // Sem a data lida (os prints sem o rodapé), o mês da chave: a nota pendente de outro mês não cai no de hoje.
            purchased_at: receipt.purchasedAt ?? fallbackPurchasedAt(accessKey),
            total: receipt.total,
            access_key: accessKey,
            image_path: imagePaths[0],
            extra_image_paths: imagePaths.slice(1),
            source: 'ai',
            status: 'draft',
          })
          .select('id')
          .single(),
      readId,
      dropRead,
    );
    readId = saved.readId;
    const { data: created, error: receiptError } = saved;
    if (receiptError || !created) {
      await dropRead();
      // Mesma chave gravada ao mesmo tempo por outra leitura: vale a que chegou antes.
      const first = await existingOnConflict(receiptError, accessKey, findByKey);
      if (first) return json({ receipt_id: first, duplicate: true });
      throw receiptError ?? new Error('receipt not returned');
    }

    if (receipt.items.length) {
      const { error: itemsError } = await db
        .from('receipt_items')
        .insert(receipt.items.map((item) => ({ ...item, receipt_id: created.id })));
      if (itemsError) {
        await db.from('receipts').delete().eq('id', created.id);
        await dropRead();
        throw itemsError;
      }
    }

    return json({ receipt_id: created.id, duplicate: false, items: receipt.items.length });
  } catch (err) {
    console.error('db error', err);
    // Nenhuma nota ficou desta leitura (se os itens falharam, ela foi apagada acima): ela não conta no limite do mês.
    await refundAiQuota(ticket).catch((e) => console.error('refund_ai failed', e));
    return json({ error: 'Falha ao salvar a nota.' }, 500);
  }
});

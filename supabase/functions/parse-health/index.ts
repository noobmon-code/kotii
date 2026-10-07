// POST { kind: "workout" | "diet" | "exam", image_paths: string[] } -> lê as
// fotos (já enviadas ao bucket "health") e devolve { kind, data } com o
// documento organizado. O app grava como rascunho para o usuário revisar.
//
// Roda com o JWT do usuário: o download passa pela RLS do storage.
// Secrets: ANTHROPIC_API_KEY ou OPENROUTER_API_KEY; HEALTH_PROVIDER e
// HEALTH_MODEL opcionais (sem eles, valem RECEIPT_PROVIDER e RECEIPT_MODEL).

import { createClient } from '@supabase/supabase-js';

import { QuotaError, refundAiQuota, takeAiQuota } from '../_shared/aiQuota.ts';
import { publishableKey } from '../_shared/apiKeys.ts';
import {
  ExtractionError,
  extractStructured,
  mediaTypeOf,
  toVisionImage,
  type VisionImage,
  visionConfig,
} from '../_shared/vision.ts';
import { ALLOWED_HEADERS, callerHeaders } from '../_shared/caller.ts';
import {
  cleanDiet,
  cleanExam,
  cleanWorkout,
  DietSchema,
  ExamSchema,
  HEALTH_KINDS,
  type HealthKind,
  PROMPTS,
  WorkoutSchema,
} from './extract.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': ALLOWED_HEADERS,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_IMAGES = 6;
// Soma das fotos: mantém o pedido abaixo do limite de tamanho das APIs.
const MAX_TOTAL_BYTES = 16_000_000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const config = visionConfig(['HEALTH', 'RECEIPT']);

async function read(kind: HealthKind, images: VisionImage[]) {
  const { system, prompt, subject, notThis } = PROMPTS[kind];
  const common = { config, system, prompt, images, subject };
  switch (kind) {
    case 'workout': {
      const out = await extractStructured({ ...common, schema: WorkoutSchema, schemaName: 'workout_plan' });
      if (!out.is_workout) throw new ExtractionError(notThis, 422);
      return cleanWorkout(out);
    }
    case 'diet': {
      const out = await extractStructured({ ...common, schema: DietSchema, schemaName: 'diet_plan' });
      if (!out.is_diet) throw new ExtractionError(notThis, 422);
      return cleanDiet(out);
    }
    case 'exam': {
      const out = await extractStructured({ ...common, schema: ExamSchema, schemaName: 'exam' });
      if (!out.is_exam) throw new ExtractionError(notThis, 422);
      return cleanExam(out);
    }
  }
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
    return json({ error: 'Leitura com IA não configurada: falta a chave da IA no Supabase.' }, 503);
  }

  let body: { kind?: unknown; image_paths?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Corpo inválido.' }, 400);
  }
  const kind = body.kind as HealthKind;
  if (!HEALTH_KINDS.includes(kind)) return json({ error: 'Tipo de documento inválido.' }, 400);
  const paths = body.image_paths;
  if (
    !Array.isArray(paths) ||
    paths.length === 0 ||
    paths.length > MAX_IMAGES ||
    !paths.every((p) => typeof p === 'string' && p.startsWith(`${householdId}/`))
  ) {
    return json({ error: `Envie de 1 a ${MAX_IMAGES} fotos.` }, 400);
  }

  const images: VisionImage[] = [];
  let totalBytes = 0;
  try {
    for (const path of paths as string[]) {
      const mediaType = mediaTypeOf(path);
      if (!mediaType) return json({ error: 'Formato de imagem não suportado.' }, 400);
      const { data: blob, error } = await db.storage.from('health').download(path);
      if (error || !blob) return json({ error: 'Imagem não encontrada.' }, 404);
      totalBytes += blob.size;
      if (totalBytes > MAX_TOTAL_BYTES) return json({ error: 'Fotos grandes demais. Envie menos páginas.' }, 413);
      images.push(await toVisionImage(blob, mediaType));
    }
    const ticket = await takeAiQuota(db, 'photo');
    try {
      return json({ kind, data: await read(kind, images) });
    } catch (err) {
      // "Não é este documento" (422) usou a IA e conta; falha da IA não.
      if (!(err instanceof ExtractionError && err.status === 422)) await refundAiQuota(ticket);
      throw err;
    }
  } catch (err) {
    if (err instanceof QuotaError || err instanceof ExtractionError) return json({ error: err.message }, err.status);
    throw err;
  }
});

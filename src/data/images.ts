// Fotos para leitura com IA: escolher, reduzir, enviar ao storage e tratar
// erros das Edge Functions. Usado por notas fiscais e documentos de saúde.

import { FunctionsHttpError } from '@supabase/supabase-js';
import { decode } from 'base64-arraybuffer';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { fitForVision } from '@/domain/image';
import { supabase } from '@/lib/supabase';

export type ScanSource = 'camera' | 'library';

/** Abre câmera ou galeria; lista vazia se o usuário desistir. */
export async function pickImages(source: ScanSource, limit = 1): Promise<string[]> {
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error(
      source === 'camera'
        ? 'Sem acesso à câmera. Libere nas configurações do aparelho.'
        : 'Sem acesso às fotos. Libere nas configurações do aparelho.',
    );
  }
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 1,
    ...(source === 'library' && limit > 1
      ? { allowsMultipleSelection: true, selectionLimit: limit, orderedSelection: true }
      : {}),
  };
  const result =
    source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled) return [];
  return result.assets.slice(0, limit).map((asset) => asset.uri);
}

/**
 * Reduz a foto e devolve o JPEG em base64. Por padrão, no tamanho que a IA
 * aproveita; `fit` e `compress` trocam isso (ex.: foto pequena de produto).
 */
export async function prepareImage(
  uri: string,
  { fit = fitForVision, compress = 0.8 }: { fit?: (width: number, height: number) => { width: number; height: number }; compress?: number } = {},
): Promise<string> {
  const context = ImageManipulator.manipulate(uri);
  const original = await context.renderAsync();
  const target = fit(original.width, original.height);
  let image = original;
  if (target.width < original.width) {
    context.resize(target);
    image = await context.renderAsync();
  }
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress, base64: true });
  if (!saved.base64) throw new Error('Não foi possível processar a imagem.');
  return saved.base64;
}

/** Envia a foto para <bucket>/<família>/<arquivo>.jpg e devolve o caminho. */
export async function uploadImage(bucket: string, householdId: string, uri: string): Promise<string> {
  const base64 = await prepareImage(uri);
  const path = `${householdId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const { error } = await supabase.storage.from(bucket).upload(path, decode(base64), { contentType: 'image/jpeg' });
  if (error) throw error;
  return path;
}

/** Várias fotos de uma vez; se uma falhar, as já enviadas são apagadas. */
export async function uploadImages(bucket: string, householdId: string, uris: string[]): Promise<string[]> {
  const paths: string[] = [];
  try {
    for (const uri of uris) paths.push(await uploadImage(bucket, householdId, uri));
  } catch (err) {
    await removeImages(bucket, paths).catch(() => undefined);
    throw err;
  }
  return paths;
}

export async function removeImages(bucket: string, paths: string[]): Promise<void> {
  if (paths.length) await supabase.storage.from(bucket).remove(paths);
}

export async function signedImageUrl(bucket: string, path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 600);
  return data?.signedUrl ?? null;
}

/** Mensagem de erro que a Edge Function devolveu, ou `fallback`. */
export async function functionErrorMessage(error: unknown, fallback: string): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (typeof body?.error === 'string') return body.error;
    } catch {
      // corpo não era JSON
    }
  }
  return fallback;
}

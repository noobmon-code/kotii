// Foto do item da lista (o produto certo). Tirada sem internet, fica
// guardada no aparelho e sobe quando a conexão volta, numa fila própria
// (uma foto grande não atrasa as marcações). A foto trocada ou de item que
// saiu da lista vai para a lixeira do banco (storage_trash), que o app esvazia.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { type QueryClient, useMutation, useMutationState, useQuery } from '@tanstack/react-query';
import { decode } from 'base64-arraybuffer';

import { fitForProductPhoto } from '@/domain/image';
import { supabase, unwrap } from '@/lib/supabase';

import { prepareImage } from './images';
import { queuedDefaults, requireQueueSession } from './market';

/** Mesmo bucket das fotos de aparelhos: políticas e limpeza da casa apagada já valem. */
export const LIST_PHOTO_BUCKET = 'documents';
export const LIST_PHOTO_KEY = ['listItemPhoto'];
export const LIST_PHOTO_SCOPE = { id: 'list-photos' };

const PENDING_PREFIX = 'nooky:pending-photo:';
const WEEK_SECONDS = 7 * 24 * 60 * 60;

export interface ListPhotoInput {
  itemId: string;
  listId: string;
  householdId: string;
  /** Quem tirou: a fila não sai com a sessão de outra conta. */
  userId: string;
  /** Onde a foto espera no aparelho; também dá nome ao arquivo (repetir o envio não duplica). */
  photoKey: string;
}

export function inPhotoQueue(mutation: { options: { scope?: { id: string } } }) {
  return mutation.options.scope?.id === LIST_PHOTO_SCOPE.id;
}

function randomKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Reduz a foto e guarda no aparelho até subir; devolve a chave. */
export async function keepPendingPhoto(uri: string): Promise<string> {
  const base64 = await prepareImage(uri, { fit: fitForProductPhoto, compress: 0.6 });
  const key = randomKey();
  try {
    await AsyncStorage.setItem(PENDING_PREFIX + key, base64);
  } catch {
    throw new Error('Sem espaço no aparelho para guardar a foto até ter internet.');
  }
  return key;
}

/** A foto que ainda não subiu, para mostrar (data URI), ou null se já não está no aparelho. */
export async function pendingPhotoUri(key: string): Promise<string | null> {
  const base64 = await AsyncStorage.getItem(PENDING_PREFIX + key);
  return base64 ? `data:image/jpeg;base64,${base64}` : null;
}

async function uploadListPhoto({ itemId, householdId, userId, photoKey }: ListPhotoInput) {
  await requireQueueSession(userId);
  const base64 = await AsyncStorage.getItem(PENDING_PREFIX + photoKey);
  // Já subiu numa tentativa anterior, ou o aparelho apagou os dados do app.
  if (!base64) return;
  const path = `${householdId}/item-${photoKey}.jpg`;
  const { error } = await supabase.storage
    .from(LIST_PHOTO_BUCKET)
    .upload(path, decode(base64), { contentType: 'image/jpeg', cacheControl: String(WEEK_SECONDS) });
  // Já existe: subiu numa tentativa que caiu antes de gravar no item.
  const status = (error as { statusCode?: string; status?: number } | null)?.statusCode ?? (error as { status?: number } | null)?.status;
  if (error && String(status) !== '409') throw error;
  const updated = unwrap(
    await supabase.from('shopping_list_items').update({ photo_path: path }).eq('id', itemId).select('id'),
  ) as { id: string }[];
  // O item saiu da lista enquanto a foto esperava: o arquivo não serve mais.
  if (!updated.length) await supabase.storage.from(LIST_PHOTO_BUCKET).remove([path]);
  await AsyncStorage.removeItem(PENDING_PREFIX + photoKey);
}

/** O que a fila de fotos precisa para rodar um envio restaurado depois de o app reabrir. */
export function registerListPhotoMutations(queryClient: QueryClient) {
  queryClient.setMutationDefaults(LIST_PHOTO_KEY, {
    ...queuedDefaults(LIST_PHOTO_SCOPE),
    mutationFn: (input: ListPhotoInput) => uploadListPhoto(input),
    onSuccess: (_: unknown, input: ListPhotoInput) => {
      queryClient.invalidateQueries({ queryKey: ['listItems', input.listId] });
      emptyPhotoTrash();
    },
  });
}

/**
 * Tira da fila as fotos deste item que ainda esperam internet (trocada por
 * outra, removida, ou o item saiu da lista) e apaga as guardadas no aparelho.
 */
export function dropPendingPhotos(queryClient: QueryClient, itemId: string) {
  const cache = queryClient.getMutationCache();
  const waiting = cache.findAll({
    mutationKey: LIST_PHOTO_KEY,
    predicate: (m) => m.state.isPaused && (m.state.variables as ListPhotoInput | undefined)?.itemId === itemId,
  });
  for (const mutation of waiting) {
    cache.remove(mutation);
    AsyncStorage.removeItem(PENDING_PREFIX + (mutation.state.variables as ListPhotoInput).photoKey).catch(() => undefined);
  }
}

/** Saiu da conta: as fotos que esperavam internet saem do aparelho junto com a fila. */
export async function forgetPendingPhotos(): Promise<void> {
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(PENDING_PREFIX));
  if (keys.length) await AsyncStorage.multiRemove(keys);
}

export function useSetListItemPhoto() {
  return useMutation<unknown, Error, ListPhotoInput>({ mutationKey: LIST_PHOTO_KEY });
}

/** Fotos esperando para subir, por item (a mais nova vale). */
export function usePendingListPhotos(): Map<string, string> {
  const pending = useMutationState({
    filters: { mutationKey: LIST_PHOTO_KEY, status: 'pending' },
    select: (mutation) => mutation.state.variables as ListPhotoInput,
  });
  return new Map(pending.map((input) => [input.itemId, input.photoKey]));
}

export function usePendingPhotoUri(key: string | undefined) {
  return useQuery({
    queryKey: ['pendingPhoto', key],
    enabled: Boolean(key),
    staleTime: Infinity,
    // A foto em base64 pesa: depois que ela sobe (ninguém mais a pede), sai da memória logo.
    gcTime: 60_000,
    queryFn: () => pendingPhotoUri(key!),
  }).data;
}

/**
 * Links das fotos já enviadas. Valem uma semana e ficam guardados no
 * aparelho: sem internet, a foto vista antes continua aparecendo.
 */
export function useListPhotoUrls(paths: string[]) {
  const sorted = [...new Set(paths)].sort();
  return useQuery({
    queryKey: ['listPhotos', ...sorted],
    enabled: sorted.length > 0,
    staleTime: 24 * 60 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(LIST_PHOTO_BUCKET).createSignedUrls(sorted, WEEK_SECONDS);
      if (error) throw error;
      return Object.fromEntries((data ?? []).flatMap((row) => (row.path && row.signedUrl ? [[row.path, row.signedUrl]] : []))) as Record<
        string,
        string
      >;
    },
  }).data;
}

let emptying: Promise<void> | null = null;

/**
 * Apaga do storage as fotos da lixeira da casa e as linhas. Sem pressa e sem
 * aviso: o que falhar fica para a próxima (abrir a lista, subir outra foto).
 */
export function emptyPhotoTrash(): Promise<void> {
  emptying ??= (async () => {
    try {
      const rows = unwrap(
        await supabase.from('storage_trash').select('id, bucket, path').order('id').limit(100),
      ) as { id: number; bucket: string; path: string }[];
      for (const bucket of new Set(rows.map((r) => r.bucket))) {
        const batch = rows.filter((r) => r.bucket === bucket);
        const { error } = await supabase.storage.from(bucket).remove(batch.map((r) => r.path));
        if (error) continue;
        await supabase.from('storage_trash').delete().in('id', batch.map((r) => r.id));
      }
    } catch {
      // Sem internet ou sem sessão: tenta de novo depois.
    } finally {
      emptying = null;
    }
  })();
  return emptying;
}

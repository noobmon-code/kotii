// Foto do item da lista (o produto certo). Tirada sem internet, fica
// guardada no aparelho e sobe quando a conexão volta, numa fila própria
// (uma foto grande não atrasa as marcações). A foto trocada ou de item que
// saiu da lista vai para a lixeira do banco (storage_trash), que o app esvazia.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { type QueryClient, useMutation, useMutationState, useQuery } from '@tanstack/react-query';
import { decode } from 'base64-arraybuffer';

import { fitForProductPhoto } from '@/domain/image';
import type { QueueCounts } from '@/domain/listQueue';
import { supabase, unwrap } from '@/lib/supabase';
import type { ShoppingListItem } from '@/lib/types';

import { prepareImage } from './images';
import {
  ADD_ITEM_KEY,
  CLEAR_CHECKED_KEY,
  countingFailures,
  EDIT_ITEM_KEY,
  queuedAddSettled,
  queuedDefaults,
  REMOVE_ITEM_KEY,
  requireQueueSession,
  TOGGLE_ITEM_KEY,
} from './market';

/** Mesmo bucket das fotos de aparelhos: políticas e limpeza da casa apagada já valem. */
export const LIST_PHOTO_BUCKET = 'documents';
export const LIST_PHOTO_KEY = ['listItemPhoto'];
export const LIST_PHOTO_SCOPE = { id: 'list-photos' };

const PENDING_PREFIX = 'kotii:pending-photo:';
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

/** Há foto da lista esperando para subir (ou subindo). */
export function photoQueueBusy(queryClient: QueryClient) {
  return queryClient.isMutating({ predicate: inPhotoQueue }) > 0;
}

/** Quanto de cada coisa espera para sair (ou está saindo), nas filas da lista e das fotos: o mesmo do aviso da lista. */
export function waitingCounts(queryClient: QueryClient): QueueCounts {
  const pending = (mutationKey: readonly string[]) => queryClient.isMutating({ mutationKey: [...mutationKey] });
  return {
    adds: pending(ADD_ITEM_KEY),
    marks: pending(TOGGLE_ITEM_KEY),
    edits: pending(EDIT_ITEM_KEY),
    removes: pending(REMOVE_ITEM_KEY),
    clears: pending(CLEAR_CHECKED_KEY),
    photos: pending(LIST_PHOTO_KEY),
  };
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

/**
 * Prazo do envio da foto. O storage-js não tem um, e no Android o pedido sem resposta não acaba nunca: a fila de
 * fotos (uma de cada vez) e a troca de casa ficariam presas. Cortado, ele volta como falta de resposta e a fila
 * tenta de novo (o que já tinha subido dá 409 e só grava no item). Folgado: a foto reduzida passa disso só com
 * o sinal quase parado.
 */
export const PHOTO_UPLOAD_TIMEOUT_MS = 120_000;

/** Fotos tiradas da fila enquanto subiam ou esperavam a vez (dropPendingPhotos): não vão para o item. */
const droppedPhotos = new Set<string>();

function withinUploadTimeout<T>(upload: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Network request timed out')), PHOTO_UPLOAD_TIMEOUT_MS);
  });
  return Promise.race([upload, timeout]).finally(() => clearTimeout(timer));
}

/** Sobe a foto e grava no item; devolve o caminho gravado (null se não gravou). */
async function uploadListPhoto({ itemId, householdId, userId, photoKey }: ListPhotoInput): Promise<string | null> {
  await requireQueueSession(userId);
  if (droppedPhotos.delete(photoKey)) return null;
  const base64 = await AsyncStorage.getItem(PENDING_PREFIX + photoKey);
  // Já subiu numa tentativa anterior, ou o aparelho apagou os dados do app.
  if (!base64) return null;
  const path = `${householdId}/item-${photoKey}.jpg`;
  const { error } = await withinUploadTimeout(
    supabase.storage.from(LIST_PHOTO_BUCKET).upload(path, decode(base64), { contentType: 'image/jpeg', cacheControl: String(WEEK_SECONDS) }),
  );
  // Já existe: subiu numa tentativa que caiu antes de gravar no item.
  const status = (error as { statusCode?: string; status?: number } | null)?.statusCode ?? (error as { status?: number } | null)?.status;
  if (error && String(status) !== '409') throw error;
  // Tirada (ou trocada por outra) enquanto subia: o arquivo não serve mais.
  if (droppedPhotos.delete(photoKey)) {
    await supabase.storage.from(LIST_PHOTO_BUCKET).remove([path]);
    return null;
  }
  const updated = unwrap(
    await supabase.from('shopping_list_items').update({ photo_path: path }).eq('id', itemId).select('id'),
  ) as { id: string }[];
  // O item saiu da lista enquanto a foto esperava: o arquivo não serve mais.
  if (!updated.length) await supabase.storage.from(LIST_PHOTO_BUCKET).remove([path]);
  await AsyncStorage.removeItem(PENDING_PREFIX + photoKey);
  return updated.length ? path : null;
}

/** O que a fila de fotos precisa para rodar um envio restaurado depois de o app reabrir. */
export function registerListPhotoMutations(queryClient: QueryClient) {
  queryClient.setMutationDefaults(LIST_PHOTO_KEY, {
    ...queuedDefaults(LIST_PHOTO_SCOPE),
    // A foto de um item posto sem internet espera o item chegar ao servidor (ele anda na fila da lista).
    mutationFn: countingFailures(async (input: ListPhotoInput) => {
      await queuedAddSettled(queryClient, input.itemId);
      return uploadListPhoto(input);
    }),
    onSuccess: async (path: string | null, input: ListPhotoInput) => {
      const key = ['listItems', input.listId];
      // A foto sai da fila agora: a lista já passa a tê-la, sem esperar a
      // busca (que pode demorar ou falhar), para o item não parecer sem foto.
      if (path) {
        await queryClient.cancelQueries({ queryKey: key });
        queryClient.setQueryData<ShoppingListItem[]>(key, (items) =>
          items?.map((i) => (i.id === input.itemId ? { ...i, photo_path: path } : i)),
        );
      }
      queryClient.invalidateQueries({ queryKey: key });
      emptyPhotoTrash();
    },
  });
  // A foto que espera internet sai quando o item saiu de verdade: o tirar apagou a linha no servidor, ou o item
  // posto sem internet foi tirado antes de sair (os dois se cancelaram). Tirar que não deu certo (a fila desistiu,
  // ou o item foi para o carrinho enquanto isso) deixa o item com a foto. Aqui, e não na tela: vale também para a
  // fila guardada que sai depois de reabrir o app.
  queryClient.getMutationCache().subscribe((event) => {
    const { mutation } = event;
    const itemId = (mutation?.state.variables as { id?: string } | undefined)?.id;
    if (!mutation || !itemId) return;
    const key = mutation.options.mutationKey?.[0];
    const deleted =
      key === REMOVE_ITEM_KEY[0] &&
      event.type === 'updated' &&
      event.action.type === 'success' &&
      Array.isArray(mutation.state.data) &&
      mutation.state.data.length > 0;
    const cancelled = key === ADD_ITEM_KEY[0] && event.type === 'removed' && mutation.state.status === 'pending';
    if (deleted || cancelled) dropPendingPhotos(queryClient, itemId);
  });
}

/**
 * Tira da fila as fotos deste item que ainda não foram para ele (trocada por
 * outra, removida, ou o item saiu da lista) e apaga as guardadas no aparelho.
 * A que está parada sai da fila; a que está andando (subindo, esperando o pôr
 * do item ou a próxima tentativa depois de uma falha) termina sem ir para o
 * item. Também é a saída para a foto que não consegue subir: tirá-la do item
 * libera a fila de fotos (e a troca de casa).
 */
export function dropPendingPhotos(queryClient: QueryClient, itemId: string) {
  const cache = queryClient.getMutationCache();
  const waiting = cache.findAll({
    mutationKey: LIST_PHOTO_KEY,
    status: 'pending',
    predicate: (m) => (m.state.variables as ListPhotoInput | undefined)?.itemId === itemId,
  });
  for (const mutation of waiting) {
    const { photoKey } = mutation.state.variables as ListPhotoInput;
    if (mutation.state.isPaused) cache.remove(mutation);
    else droppedPhotos.add(photoKey);
    AsyncStorage.removeItem(PENDING_PREFIX + photoKey).catch(() => undefined);
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

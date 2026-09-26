import { useEffect, useRef, useState } from 'react';

import { removeImages, uploadImages } from '@/data/images';
import { useHouseholdId } from '@/lib/auth';
import { errorMessage } from '@/lib/supabase';
import { notify } from '@/ui/dialogs';

/**
 * Fotos de um formulário que ainda pode ser cancelado. As enviadas nesta
 * edição somem do storage se a pessoa sair sem salvar; as removidas só
 * somem depois de salvar (`commit`).
 */
export function useDraftPhotos(bucket: string, initial: string[]) {
  const householdId = useHouseholdId();
  const [paths, setPaths] = useState(initial);
  const [uploading, setUploading] = useState(false);
  const unsaved = useRef<string[]>([]);
  const removed = useRef<string[]>([]);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      removeImages(bucket, unsaved.current).catch(() => undefined);
    };
  }, [bucket]);

  /** Envia e devolve a lista nova de fotos, ou null se falhar. */
  async function add(uris: string[]): Promise<string[] | null> {
    if (!householdId) return null;
    setUploading(true);
    try {
      const added = await uploadImages(bucket, householdId, uris);
      // Saiu da tela durante o envio: ninguém vai salvar essas fotos.
      if (!mounted.current) {
        await removeImages(bucket, added).catch(() => undefined);
        return null;
      }
      unsaved.current.push(...added);
      const next = [...paths, ...added];
      setPaths(next);
      return next;
    } catch (err) {
      if (mounted.current) notify('Não foi possível enviar as fotos', errorMessage(err));
      return null;
    } finally {
      if (mounted.current) setUploading(false);
    }
  }

  function remove(path: string) {
    setPaths((current) => current.filter((p) => p !== path));
    if (unsaved.current.includes(path)) {
      unsaved.current = unsaved.current.filter((p) => p !== path);
      removeImages(bucket, [path]).catch(() => undefined);
    } else {
      removed.current.push(path);
    }
  }

  /** Depois de salvar: as novas passam a ser do registro; as removidas saem. */
  function commit() {
    unsaved.current = [];
    removeImages(bucket, removed.current).catch(() => undefined);
    removed.current = [];
  }

  /** Enviadas nesta edição e ainda não salvas (para apagar junto com o registro). */
  function pending(): string[] {
    return unsaved.current;
  }

  return { paths, uploading, add, remove, commit, pending };
}

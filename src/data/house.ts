// Aparelhos da casa (garantia, fotos, manutenção) e documentos da família.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';

import { supabase, unwrap } from '@/lib/supabase';
import type { Chore, ChoreCompletion, Equipment, HomeDocument } from '@/lib/types';
import { removeImages, signedImageUrl } from './images';

/** Bucket das fotos de documentos e de aparelhos. */
export const DOCUMENTS_BUCKET = 'documents';

export function documentImageUrl(path: string): Promise<string | null> {
  return signedImageUrl(DOCUMENTS_BUCKET, path);
}

export function removeDocumentImages(paths: string[]): Promise<void> {
  return removeImages(DOCUMENTS_BUCKET, paths);
}

// ---------------------------------------------------------------------------
// Aparelhos

const EQUIPMENT_COLUMNS =
  'id, name, category, brand, model, serial_number, location, purchased_on, price, store, warranty_until, notes, file_paths, created_at';

export async function fetchEquipmentList(db: SupabaseClient = supabase): Promise<Equipment[]> {
  return unwrap(await db.from('equipment').select(EQUIPMENT_COLUMNS).order('name')) as Equipment[];
}

export function useEquipmentList() {
  return useQuery({ queryKey: ['equipment'], queryFn: () => fetchEquipmentList() });
}

export function useEquipment(id: string | undefined) {
  return useQuery({
    queryKey: ['equipment', id],
    enabled: Boolean(id),
    queryFn: async () =>
      unwrap(await supabase.from('equipment').select(EQUIPMENT_COLUMNS).eq('id', id!).single()) as Equipment,
  });
}

export type EquipmentValues = Omit<Equipment, 'id' | 'created_at'>;

export function useSaveEquipment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: Partial<EquipmentValues> }) =>
      id
        ? (unwrap(await supabase.from('equipment').update(values).eq('id', id).select('id').single()) as { id: string })
        : (unwrap(await supabase.from('equipment').insert(values).select('id').single()) as { id: string }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['equipment'] }),
  });
}

export function useDeleteEquipment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (equipment: Pick<Equipment, 'id' | 'file_paths'>) => {
      // As manutenções (tarefas) saem junto, em cascata no banco.
      unwrap(await supabase.from('equipment').delete().eq('id', equipment.id));
      await removeDocumentImages(equipment.file_paths).catch(() => undefined);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['equipment'] });
      queryClient.invalidateQueries({ queryKey: ['chores'] });
    },
  });
}

const MAINTENANCE_COLUMNS = 'id, title, notes, recurrence, interval_count, due_on, assigned_to, active, equipment_id';

/** Manutenções do aparelho (ativas e já encerradas) e o histórico de conclusões. */
export function useMaintenance(equipmentId: string | undefined) {
  const chores = useQuery({
    queryKey: ['chores', 'equipment', equipmentId],
    enabled: Boolean(equipmentId),
    queryFn: async () =>
      unwrap(
        await supabase
          .from('chores')
          .select(MAINTENANCE_COLUMNS)
          .eq('equipment_id', equipmentId!)
          .order('active', { ascending: false })
          .order('due_on'),
      ) as Chore[],
  });
  const choreIds = (chores.data ?? []).map((c) => c.id);
  const history = useQuery({
    queryKey: ['choreHistory', equipmentId, choreIds],
    enabled: choreIds.length > 0,
    queryFn: async () =>
      unwrap(
        await supabase
          .from('chore_completions')
          .select('id, chore_id, completed_by, completed_at')
          .in('chore_id', choreIds)
          .order('completed_at', { ascending: false })
          .limit(30),
      ) as ChoreCompletion[],
  });
  return { chores, history };
}

// ---------------------------------------------------------------------------
// Documentos

const DOCUMENT_COLUMNS =
  'id, person_id, kind, title, number, issued_on, expires_on, remind_days, notes, file_paths, created_at';

export async function fetchDocuments(db: SupabaseClient = supabase): Promise<HomeDocument[]> {
  return unwrap(
    await db.from('documents').select(DOCUMENT_COLUMNS).order('expires_on', { ascending: true, nullsFirst: false }).order('title'),
  ) as HomeDocument[];
}

export function useDocuments() {
  return useQuery({ queryKey: ['documents'], queryFn: () => fetchDocuments() });
}

export function useDocument(id: string | undefined) {
  return useQuery({
    queryKey: ['documents', id],
    enabled: Boolean(id),
    queryFn: async () =>
      unwrap(await supabase.from('documents').select(DOCUMENT_COLUMNS).eq('id', id!).single()) as HomeDocument,
  });
}

export type DocumentValues = Omit<HomeDocument, 'id' | 'created_at'>;

export function useSaveDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id?: string; values: DocumentValues }) =>
      id
        ? unwrap(await supabase.from('documents').update(values).eq('id', id))
        : unwrap(await supabase.from('documents').insert(values)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents'] }),
  });
}

export function useDeleteDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (document: Pick<HomeDocument, 'id' | 'file_paths'>) => {
      unwrap(await supabase.from('documents').delete().eq('id', document.id));
      await removeDocumentImages(document.file_paths).catch(() => undefined);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['documents'] }),
  });
}

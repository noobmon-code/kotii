import { router } from 'expo-router';
import { useState } from 'react';

import {
  readHealthDocument,
  removeHealthImages,
  uploadHealthImages,
  useCreateDietPlan,
  useCreateWorkoutPlan,
  usePeople,
  type DietPlanValues,
  type WorkoutPlanValues,
} from '@/data/health';
import { useHouseholdId } from '@/lib/auth';
import { errorMessage } from '@/lib/supabase';
import { ActionSheet } from '@/ui/ActionSheet';
import { BusyOverlay } from '@/ui/BusyOverlay';
import { notify } from '@/ui/dialogs';
import { openNewPerson } from './PersonChips';
import { usePhotoSheet } from './useHealthPhotos';

export type PlanKind = 'workout' | 'diet';

type PlanDraft<K extends PlanKind> = K extends 'workout'
  ? Pick<WorkoutPlanValues, 'title' | 'professional' | 'valid_until' | 'notes' | 'sessions'>
  : Pick<DietPlanValues, 'title' | 'professional' | 'valid_until' | 'notes' | 'meals' | 'guidelines' | 'shopping_items'>;

const LABELS: Record<PlanKind, { noun: string; defaultTitle: string; reading: string }> = {
  workout: { noun: 'ficha de treino', defaultTitle: 'Ficha de treino', reading: 'Organizando treinos e exercícios.' },
  diet: { noun: 'plano alimentar', defaultTitle: 'Plano alimentar', reading: 'Organizando refeições e a lista de compras.' },
};

/**
 * Novo plano de treino ou dieta: para quem -> fotos (ou digitar) -> leitura
 * com IA -> rascunho para revisar. Se a leitura falhar, o rascunho é criado
 * com as fotos para preencher à mão.
 */
export function usePlanImport() {
  const householdId = useHouseholdId();
  const people = usePeople();
  const createWorkout = useCreateWorkoutPlan();
  const createDiet = useCreateDietPlan();
  const [target, setTarget] = useState<{ kind: PlanKind; personId: string } | null>(null);
  const [askPersonFor, setAskPersonFor] = useState<PlanKind | null>(null);
  const [busy, setBusy] = useState(false);

  async function createDraft(kind: PlanKind, personId: string, paths: string[], data: Partial<PlanDraft<PlanKind>> | null) {
    const base = {
      person_id: personId,
      title: data?.title || LABELS[kind].defaultTitle,
      professional: data?.professional ?? null,
      valid_until: data?.valid_until ?? null,
      notes: data?.notes ?? null,
      file_paths: paths,
      status: 'draft' as const,
    };
    if (kind === 'workout') {
      const draft = data as Partial<PlanDraft<'workout'>> | null;
      const { id } = await createWorkout.mutateAsync({ ...base, sessions: draft?.sessions ?? [] });
      router.push({ pathname: '/treino/[id]', params: { id } });
    } else {
      const draft = data as Partial<PlanDraft<'diet'>> | null;
      const { id } = await createDiet.mutateAsync({
        ...base,
        meals: draft?.meals ?? [],
        guidelines: draft?.guidelines ?? [],
        shopping_items: draft?.shopping_items ?? [],
      });
      router.push({ pathname: '/dieta/[id]', params: { id } });
    }
  }

  async function importPhotos(uris: string[]) {
    if (!target || !householdId) return;
    const { kind, personId } = target;
    setBusy(true);
    let paths: string[] = [];
    try {
      paths = await uploadHealthImages(householdId, uris);
    } catch (err) {
      setBusy(false);
      notify('Não foi possível enviar as fotos', errorMessage(err));
      return;
    }
    let data: Partial<PlanDraft<PlanKind>> | null = null;
    let readError: unknown = null;
    try {
      data = await readHealthDocument<PlanDraft<PlanKind>>(kind, paths);
    } catch (err) {
      readError = err;
    }
    try {
      await createDraft(kind, personId, paths, data);
      if (readError) {
        notify(
          'Não deu para ler com IA',
          `${errorMessage(readError)}\n\nO rascunho foi criado com as fotos para você preencher.`,
        );
      }
    } catch (err) {
      // Sem plano, ninguém mais alcança essas fotos pelo app.
      await removeHealthImages(paths).catch(() => undefined);
      notify('Erro', errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const photos = usePhotoSheet({
    title: target ? `Nova ${LABELS[target.kind].noun}` : '',
    message: 'Fotografe todas as páginas. A IA organiza e você revisa antes de ativar.',
    onPhotos: importPhotos,
    manual: {
      label: 'Digitar manualmente',
      onPress: () => {
        if (!target) return;
        createDraft(target.kind, target.personId, [], null).catch((err) => notify('Erro', errorMessage(err)));
      },
    },
  });

  function start(kind: PlanKind, personId: string | null) {
    if (personId) {
      setTarget({ kind, personId });
      photos.open();
    } else {
      setAskPersonFor(kind);
    }
  }

  const element = (
    <>
      <ActionSheet
        visible={askPersonFor !== null}
        onClose={() => setAskPersonFor(null)}
        title="Para quem é?"
        actions={[
          ...(people.data ?? [])
            .filter((p) => p.kind === 'pessoa')
            .map((p) => ({
              label: p.name,
              icon: 'account-outline' as const,
              onPress: () => {
                if (!askPersonFor) return;
                setTarget({ kind: askPersonFor, personId: p.id });
                photos.open();
              },
            })),
          { label: 'Cadastrar pessoa', icon: 'account-plus-outline', onPress: openNewPerson },
        ]}
      />
      {photos.element}
      <BusyOverlay
        visible={busy}
        title={target ? `Lendo a ${LABELS[target.kind].noun}…` : 'Lendo…'}
        message={target ? `${LABELS[target.kind].reading} Pode levar até um minuto.` : undefined}
      />
    </>
  );

  return { start, element };
}

import { useEffect } from 'react';
import { StyleSheet } from 'react-native';

import { useAnyList, useAnyReceipt } from '@/data/firstSteps';
import {
  FIRST_STEP_DONE,
  FIRST_STEPS_DISMISS,
  FIRST_STEPS_TITLE,
  firstSteps,
  firstStepsProgress,
  showFirstSteps,
  type FirstStep,
  type FirstStepKey,
} from '@/domain/firstSteps';
import type { IconName } from '@/domain/categories';
import { useActiveHouseholdId } from '@/lib/activeHousehold';
import { dismissFirstSteps, useFirstStepsDismissed } from '@/lib/firstSteps';
import type { Person } from '@/lib/types';
import { Icon, IconBadge, LinkButton, ListCard, ListRow, Section, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

const STEP_ICONS: Record<FirstStepKey, IconName> = {
  convidar: 'account-plus-outline',
  lista: 'cart-outline',
  nota: 'receipt-text-outline',
  pessoas: 'account-child-outline',
};

/** O que a busca de um passo diz (useAnyList, useAnyReceipt), como chegou. */
interface StepQuery {
  data: boolean | undefined;
  status: 'pending' | 'error' | 'success';
  fetchStatus: 'fetching' | 'paused' | 'idle';
}

/**
 * A resposta da busca: o "sim" vale sempre (a casa teve; quando a lista ou a nota some, a pergunta volta e diz). O
 * "não" só vale de uma busca que terminou bem e não está buscando de novo: guardado de antes (do aparelho, de uma
 * busca velha) ou de uma busca que agora falhou, ele pode já não ser verdade, e um passo dado não pode aparecer como
 * por fazer.
 */
function stepAnswer(query: StepQuery): boolean | undefined {
  if (query.data === true) return true;
  return query.data === false && query.status === 'success' && query.fetchStatus === 'idle' ? false : undefined;
}

/** A resposta a caminho: o cartão talvez apareça já, e quem ficaria no lugar dele espera. */
const arriving = (query: StepQuery) => query.data !== true && query.fetchStatus === 'fetching';

/**
 * Os primeiros passos da casa aberta (domain/firstSteps): o que ela já tem decide cada passo, e só o que a tela
 * Hoje ainda não leu é perguntado ao banco (uma lista arquivada, uma nota confirmada), e só enquanto o cartão pode
 * aparecer (dispensado neste aparelho, nada é pedido). `shown` só depois de saber os quatro e de ler a dispensa.
 * Com os quatro feitos, o cartão fecha de vez neste aparelho (a mesma marca do "Dispensar"): uma casa que já
 * andou não o vê de volta quando alguém sai dela ou a ficha do pet é apagada.
 */
export function useFirstSteps({
  householdId,
  members,
  openLists,
  drafts,
  people,
}: {
  householdId: string | undefined;
  /** Quantos moradores a casa tem. */
  members: number | undefined;
  /** As listas abertas (useShoppingLists), as notas para revisar (useDraftReceipts) e as fichas (usePeople), como chegaram. */
  openLists: readonly unknown[] | undefined;
  drafts: readonly unknown[] | undefined;
  people: readonly Pick<Person, 'member_user_id'>[] | undefined;
}) {
  const dismissed = useFirstStepsDismissed(householdId);
  const asking = dismissed === false;
  // Uma lista aberta, ou um rascunho, já respondem: a pergunta ao banco só sai sem nenhum (e o "sim" visto fica).
  const askList = asking && openLists?.length === 0;
  const askReceipt = asking && drafts?.length === 0;
  const anyList = useAnyList(askList, asking && Boolean(openLists?.length));
  const anyReceipt = useAnyReceipt(askReceipt, asking && Boolean(drafts?.length));
  const steps = firstSteps({
    members,
    anyList: openLists === undefined ? undefined : openLists.length > 0 || stepAnswer(anyList),
    anyReceipt: drafts === undefined ? undefined : drafts.length > 0 || stepAnswer(anyReceipt),
    peopleWithoutApp: people?.filter((person) => !person.member_user_id).length,
  });
  // Os quatro feitos fecham o cartão de vez, mas só com tudo da casa aberta: no meio de uma troca de casa, a tela
  // ainda tem a casa anterior (os moradores dela) enquanto as listas e as fichas já são da próxima, que passou a ser
  // a aberta (lib/activeHousehold) antes de a casa nova chegar.
  const activeId = useActiveHouseholdId();
  const finished = asking && Boolean(householdId) && householdId === activeId && steps !== null && steps.every((step) => step.done);
  useEffect(() => {
    if (finished && householdId) dismissFirstSteps(householdId);
  }, [finished, householdId]);
  return {
    /** Os passos, quando o cartão aparece; null quando não. */
    shown: showFirstSteps(steps, dismissed) ? steps : null,
    /**
     * Ainda decidindo se o cartão aparece (a dispensa sendo lida, ou uma resposta a caminho): quem ficaria no lugar
     * dele (o "Tudo em dia") espera, sem piscar. Sem internet (a busca parada) ou com a busca falhando, não se espera:
     * o cartão não aparece, e a tela segue sem ele.
     */
    deciding: dismissed === undefined || (askList && arriving(anyList)) || (askReceipt && arriving(anyReceipt)),
    dismiss: () => {
      if (householdId) dismissFirstSteps(householdId);
    },
    // Puxar para atualizar: só as perguntas que estão valendo (o refetch busca também uma desligada).
    refresh: () => {
      if (askList) anyList.refetch();
      if (askReceipt) anyReceipt.refetch();
    },
  };
}

/** O cartão: os quatro passos, cada um levando aonde se faz; o que já foi feito fica marcado, sem ação. */
export function FirstStepsCard({
  steps,
  onStep,
  onDismiss,
}: {
  steps: FirstStep[];
  onStep: (key: FirstStepKey) => void;
  onDismiss: () => void;
}) {
  return (
    <Section title={FIRST_STEPS_TITLE} action={<LinkButton title={FIRST_STEPS_DISMISS} onPress={onDismiss} />}>
      <Text variant="muted" style={styles.progress}>
        {firstStepsProgress(steps)}
      </Text>
      <ListCard>
        {steps.map((step) => (
          <ListRow
            key={step.key}
            left={<IconBadge icon={step.done ? 'check' : STEP_ICONS[step.key]} tone={step.done ? 'primary' : 'neutral'} />}
            title={step.title}
            subtitle={step.done ? FIRST_STEP_DONE : step.hint}
            dimmed={step.done}
            right={step.done ? undefined : <Icon name="chevron-right" color="textMuted" />}
            onPress={step.done ? undefined : () => onStep(step.key)}
          />
        ))}
      </ListCard>
    </Section>
  );
}

const styles = StyleSheet.create({
  progress: { paddingHorizontal: space.xs },
});

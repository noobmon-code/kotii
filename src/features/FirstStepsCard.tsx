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

/**
 * Os primeiros passos da casa aberta (domain/firstSteps): o que ela já tem decide cada passo, e só o que a tela
 * Hoje ainda não leu é perguntado ao banco (uma lista arquivada, uma nota confirmada), e só enquanto o cartão pode
 * aparecer (dispensado neste aparelho, nada é pedido). `shown` só depois de saber os quatro e de ler a dispensa.
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
  // Uma lista aberta, ou um rascunho, já respondem: a pergunta ao banco só sai sem nenhum.
  const askList = asking && openLists?.length === 0;
  const askReceipt = asking && drafts?.length === 0;
  const anyList = useAnyList(askList);
  const anyReceipt = useAnyReceipt(askReceipt);
  const steps = firstSteps({
    members,
    anyList: openLists === undefined ? undefined : openLists.length > 0 || anyList.data,
    anyReceipt: drafts === undefined ? undefined : drafts.length > 0 || anyReceipt.data,
    peopleWithoutApp: people?.filter((person) => !person.member_user_id).length,
  });
  // A primeira resposta a caminho (ou a dispensa ainda sendo lida): o cartão talvez apareça já. Sem internet (a
  // busca parada) ou com a busca falhando, não se espera: o cartão não aparece, e a tela segue sem ele.
  const arriving = (query: { data: unknown; fetchStatus: string }) => query.data === undefined && query.fetchStatus === 'fetching';
  return {
    /** Os passos, quando o cartão aparece; null quando não. */
    shown: showFirstSteps(steps, dismissed) ? steps : null,
    /** Ainda decidindo se o cartão aparece: quem ficaria no lugar dele (o "Tudo em dia") espera, sem piscar. */
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

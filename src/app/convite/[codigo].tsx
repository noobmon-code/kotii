import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { inviteCodeFrom } from '@/domain/onboarding';
import { useAuth, useHousehold } from '@/lib/auth';
import { clearPendingInvite, savePendingInvite } from '@/lib/onboarding';
import { Loading, Screen } from '@/ui/primitives';

/**
 * O link do convite (…/convite/ABC234, na mensagem de "Chamar a casa"): guarda o código neste aparelho e segue para
 * onde a pessoa está. Sem conta, para entrar ou criar a conta (e o código vem preenchido depois: no bem-vindo, para
 * quem ainda não tem casa; em "Suas casas", que a Hoje abre com ele, para quem já tem, features/onboarding/
 * OnboardingContinuation); com conta e sem casa, para a tela de boas-vindas; já numa casa, para "Suas casas", com o
 * código no "Tenho um código". Abre em qualquer estado (fica fora das guardas do layout), e um link estragado só leva
 * para a primeira tela.
 *
 * O código é guardado no efeito desta tela, que roda no mesmo ciclo do Redirect (que só troca de tela no efeito dele):
 * a tela seguinte já o encontra na memória. Já numa casa, ele vai no endereço de "Suas casas" e não fica guardado
 * (nem um de um link anterior): guardado, a Hoje levaria a pessoa para lá de novo depois.
 */
export default function InviteLinkScreen() {
  const { codigo } = useLocalSearchParams<{ codigo?: string }>();
  const code = inviteCodeFrom(`/convite/${codigo ?? ''}`);
  const { session } = useAuth();
  const household = useHousehold();
  // Para onde vai (null enquanto a casa de quem tem conta ainda chega).
  const target = !session ? 'entrar' : household.isPending ? null : household.data ? 'casas' : 'bem-vindo';

  useEffect(() => {
    if (!code || !target) return;
    if (target === 'casas') clearPendingInvite();
    else savePendingInvite(code);
  }, [code, target]);

  if (!target) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  if (target === 'entrar') return <Redirect href="/entrar" />;
  if (target === 'bem-vindo') return <Redirect href="/bem-vindo" />;
  return <Redirect href={code ? { pathname: '/casas', params: { codigo: code } } : '/'} />;
}

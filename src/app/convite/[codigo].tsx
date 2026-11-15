import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { inviteCodeFrom } from '@/domain/onboarding';
import { useAuth, useHousehold } from '@/lib/auth';
import { savePendingInvite } from '@/lib/onboarding';
import { Loading, Screen } from '@/ui/primitives';

/**
 * O link do convite (…/convite/ABC234, na mensagem de "Chamar a casa"): guarda o código neste aparelho e segue para
 * onde a pessoa está. Sem conta, para entrar ou criar a conta (e o código vem preenchido depois); com conta e sem casa,
 * para a tela de boas-vindas; já numa casa, para "Suas casas", com o código no "Tenho um código". Abre em qualquer
 * estado (fica fora das guardas do layout), e um link estragado só leva para a primeira tela.
 *
 * O código é guardado no efeito desta tela, que roda no mesmo ciclo do Redirect (que só troca de tela no efeito dele):
 * a tela seguinte já o encontra na memória.
 */
export default function InviteLinkScreen() {
  const { codigo } = useLocalSearchParams<{ codigo?: string }>();
  const code = inviteCodeFrom(`/convite/${codigo ?? ''}`);
  const { session } = useAuth();
  const household = useHousehold();

  useEffect(() => {
    if (code) savePendingInvite(code);
  }, [code]);

  if (session && household.isPending) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  if (!session) return <Redirect href="/entrar" />;
  if (!household.data) return <Redirect href="/bem-vindo" />;
  return <Redirect href={code ? { pathname: '/casas', params: { codigo: code } } : '/'} />;
}

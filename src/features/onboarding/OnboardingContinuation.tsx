import { router, useIsFocused } from 'expo-router';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { useOpenMarketList } from '@/data/market';
import { JOINED_OK, JOINED_TITLE, JOINED_WRONG, joinedText, type OnboardingNext } from '@/domain/onboarding';
import { useHousehold } from '@/lib/auth';
import { clearOnboardingNext, clearPendingInvite, useOnboardingNext, usePendingInvite } from '@/lib/onboarding';
import { errorMessage } from '@/lib/supabase';
import { ActionSheet } from '@/ui/ActionSheet';
import { notify } from '@/ui/dialogs';
import { NukeAvatar } from '@/ui/NukeArt';

/**
 * O que a tela Hoje faz quando abre numa casa que acabou de nascer pelo começo (lib/onboarding guarda o passo, por
 * casa): quem criou a casa vai direto para a lista de mercado, com o catálogo aberto (`primeira=1`, a faixa da
 * primeira lista); quem entrou com o código vê "Você entrou na casa!" com o nome dela (agora é moradora: o nome já pode
 * aparecer). Cada passo vale uma vez: sai do aparelho quando é feito. Sem passo guardado, um código de link de convite
 * que espera no aparelho (o link aberto antes de entrar, por quem já tem casa: app/convite) vai para "Suas casas".
 * Sem nenhum dos dois, nada é montado.
 */
export function OnboardingContinuation() {
  const house = useHousehold().data?.household;
  const next = useOnboardingNext(house?.id);
  const invite = usePendingInvite();
  if (!house || next === undefined) return null;
  if (next) return <NextStep house={house} next={next} />;
  if (invite) return <InviteHandoff house={house} code={invite} />;
  return null;
}

/**
 * O link de um convite aberto sem conta, por quem já tem casa: depois de entrar, a conta cai na Hoje da casa dela, e o
 * código ia ficar esquecido no aparelho (só o bem-vindo, de quem não tem casa, o lê). A Hoje o leva para "Suas casas",
 * já em "Tenho um código" e preenchido (app/casas), uma vez, com a Hoje à vista: o código sai do aparelho (vai no
 * endereço), então voltar de lá sem entrar não leva de novo. O convite da própria casa aberta só sai do aparelho.
 */
function InviteHandoff({ house, code }: { house: { invite_code: string }; code: string }) {
  const focused = useIsFocused();
  const own = code === house.invite_code;
  const handed = useRef(false);

  useEffect(() => {
    if (!focused || handed.current) return;
    handed.current = true;
    clearPendingInvite();
    if (!own) router.push({ pathname: '/casas', params: { codigo: code } });
  }, [code, focused, own]);

  return null;
}

/**
 * O passo, só com a Hoje à vista: as abas ficam montadas por baixo de outras telas, e a prévia abre a casa nova antes
 * de voltar para cá.
 */
function NextStep({ house, next }: { house: { id: string; name: string }; next: OnboardingNext }) {
  const focused = useIsFocused();
  const openMarketList = useOpenMarketList().mutateAsync;
  const opening = useRef(false);

  useEffect(() => {
    if (!focused || next !== 'lista' || opening.current) return;
    opening.current = true;
    clearOnboardingNext(house.id);
    // A lista de mercado da casa nova: a mais recente aberta, ou uma "Mercado" nova (open_market_list).
    openMarketList()
      .then(
        ({ id }) => router.push({ pathname: '/lista/[id]', params: { id, primeira: '1' } }),
        (err: unknown) => notify('Não deu para abrir a lista', errorMessage(err)),
      )
      .finally(() => {
        opening.current = false;
      });
  }, [focused, house.id, next, openMarketList]);

  if (next !== 'entrou' || !focused) return null;
  return (
    <ActionSheet
      visible
      title={JOINED_TITLE}
      message={`${joinedText(house.name)} ${JOINED_WRONG}`}
      actions={[]}
      cancelLabel={JOINED_OK}
      onClose={() => clearOnboardingNext(house.id)}>
      <View style={styles.nuke}>
        <NukeAvatar size={72} mood="joy" />
      </View>
    </ActionSheet>
  );
}

const styles = StyleSheet.create({
  nuke: { alignItems: 'center' },
});

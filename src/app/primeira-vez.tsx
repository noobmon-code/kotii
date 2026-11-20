import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';

import { useIsAppAdmin } from '@/data/appDashboard';
import { PASSWORD_MIN, PREVIEW_NOTICE, PREVIEW_ONLY_ADMINS, PREVIEW_TITLE } from '@/domain/onboarding';
import { AccountForm, ConfirmEmailStep, useResendWait } from '@/features/onboarding/AccountForm';
import { HouseSetupFlow } from '@/features/onboarding/HouseSetupFlow';
import { PreviewNotice } from '@/features/onboarding/OnboardingHero';
import { WelcomeStep } from '@/features/onboarding/WelcomeStep';
import { useHousehold } from '@/lib/auth';
import { turnOnOnboardingPreview } from '@/lib/onboarding';
import { notify } from '@/ui/dialogs';
import { Button, EmptyState, Loading, Screen } from '@/ui/primitives';

type Step = 'boas-vindas' | 'criar' | 'confirmar' | 'entrar' | 'casa';

/**
 * A prévia do começo (domain/onboarding), para quem mantém o app ver o que uma conta nova vê, com a conta de sempre:
 * as boas-vindas, criar a conta e confirmar o e-mail são só as telas (nada é criado nem enviado); do nome em diante é
 * de verdade: a casa nasce, abre por cima das outras, e a Hoje segue com a primeira lista, o convite e a tela de
 * início. Só para app_admins (Configurações → Manutenção do app). Com a chave do começo desligada (lib/features), abrir
 * a prévia liga, neste aparelho, as partes do começo novo que ficam dentro do app (lib/onboarding); com ela ligada,
 * essas partes já valem para todos.
 */
export default function OnboardingPreviewScreen() {
  const admin = useIsAppAdmin();
  const household = useHousehold();
  const [step, setStep] = useState<Step>('boas-vindas');
  // Ver como quem chegou por um link de convite: com o código da casa aberta (a pessoa já mora nela, então entrar só
  // responde "Você já está nessa casa"; um código inventado poderia ser o de outra casa).
  const [invited, setInvited] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const resend = useResendWait();
  const isAdmin = admin.data === true;

  useEffect(() => {
    if (isAdmin) turnOnOnboardingPreview();
  }, [isAdmin]);

  if (admin.isPending) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  if (!isAdmin) {
    return (
      <Screen>
        <EmptyState icon="lock-outline" title={PREVIEW_TITLE} message={PREVIEW_ONLY_ADMINS} />
      </Screen>
    );
  }

  // A mesma conferência da tela de entrar, sem mandar nada.
  function filled(): boolean {
    if (email.trim() && password.length >= PASSWORD_MIN) return true;
    notify('Confira os dados', `Informe o e-mail e uma senha com pelo menos ${PASSWORD_MIN} caracteres.`);
    return false;
  }

  const inviteCode = invited ? (household.data?.household.invite_code ?? null) : null;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <PreviewNotice text={PREVIEW_NOTICE} />
        {step === 'boas-vindas' ? (
          <>
            <WelcomeStep invited={invited} onCreate={() => setStep('criar')} onSignIn={() => setStep('entrar')} />
            <Button
              title={invited ? 'Ver como quem chega sem convite' : 'Ver como quem chegou por um convite'}
              variant="ghost"
              compact
              onPress={() => setInvited((on) => !on)}
            />
          </>
        ) : null}
        {step === 'criar' || step === 'entrar' ? (
          <AccountForm
            mode={step}
            email={email}
            password={password}
            onEmail={setEmail}
            onPassword={setPassword}
            onSubmit={() => {
              if (filled()) setStep(step === 'criar' ? 'confirmar' : 'casa');
            }}
            onSwitch={() => setStep(step === 'criar' ? 'entrar' : 'criar')}
            onForgot={() => notify('Prévia', 'Numa conta de verdade, aqui começa a recuperação da senha, como hoje.')}
            busy={false}
          />
        ) : null}
        {step === 'confirmar' ? (
          <ConfirmEmailStep
            email={email.trim()}
            onDone={() => setStep('entrar')}
            onResend={resend.start}
            onChange={() => setStep('criar')}
            resendWait={resend.wait}
            busy={false}
          />
        ) : null}
        {step === 'casa' ? <HouseSetupFlow preview pendingInvite={inviteCode} /> : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});

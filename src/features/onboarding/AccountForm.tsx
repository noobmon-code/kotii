import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  CONFIRM_EMAIL_CHANGE,
  CONFIRM_EMAIL_DONE,
  CONFIRM_EMAIL_TITLE,
  confirmEmailText,
  HIDE_PASSWORD,
  PASSWORD_HINT,
  RESEND_SECONDS,
  resendLabel,
  SHOW_PASSWORD,
  SIGN_IN_TITLE,
  SIGN_UP_TITLE,
  SWITCH_TO_SIGN_UP,
  WELCOME_SIGN_IN,
} from '@/domain/onboarding';
import { TERMS_CONSENT, TERMS_TITLE } from '@/domain/terms';
import { Button, Text, TextField } from '@/ui/primitives';
import { space } from '@/ui/theme';

import { OnboardingHero } from './OnboardingHero';

export type AccountMode = 'entrar' | 'criar';

/**
 * Criar a conta ou entrar, um de cada vez (sem o seletor de antes): o título diz qual é, a senha pode ser mostrada, a
 * regra dela aparece antes do erro, e um botão leva ao outro. O que acontece no toque é de quem usa (a tela de entrar
 * fala com o Supabase; a prévia só segue).
 */
export function AccountForm({
  mode,
  email,
  password,
  onEmail,
  onPassword,
  onSubmit,
  onSwitch,
  onForgot,
  busy,
}: {
  mode: AccountMode;
  email: string;
  password: string;
  onEmail: (text: string) => void;
  onPassword: (text: string) => void;
  onSubmit: () => void;
  onSwitch: () => void;
  /** "Esqueci minha senha", só em Entrar. */
  onForgot?: () => void;
  busy: boolean;
}) {
  const [shown, setShown] = useState(false);
  const creating = mode === 'criar';
  return (
    <View style={styles.form}>
      <OnboardingHero size={88} title={creating ? SIGN_UP_TITLE : SIGN_IN_TITLE} />
      <TextField
        label="E-mail"
        value={email}
        onChangeText={onEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        editable={!busy}
      />
      <TextField
        label="Senha"
        value={password}
        onChangeText={onPassword}
        secureTextEntry={!shown}
        autoComplete={creating ? 'new-password' : 'current-password'}
        textContentType={creating ? 'newPassword' : 'password'}
        hint={creating ? PASSWORD_HINT : undefined}
        editable={!busy}
        onSubmitEditing={onSubmit}
      />
      <Button title={shown ? HIDE_PASSWORD : SHOW_PASSWORD} variant="ghost" compact onPress={() => setShown((open) => !open)} />
      <Button title={creating ? SIGN_UP_TITLE : SIGN_IN_TITLE} onPress={onSubmit} loading={busy} />
      {!creating && onForgot ? <Button title="Esqueci minha senha" variant="ghost" compact disabled={busy} onPress={onForgot} /> : null}
      <Button title={creating ? WELCOME_SIGN_IN : SWITCH_TO_SIGN_UP} variant="ghost" compact disabled={busy} onPress={onSwitch} />
      {/* Um botão, não um trecho de texto tocável: área de toque de botão e, no navegador, abre com Enter. */}
      <View style={styles.consent}>
        <Text variant="small" style={styles.center}>
          {TERMS_CONSENT}
        </Text>
        <Button title={TERMS_TITLE} variant="ghost" compact onPress={() => router.push('/termos')} />
      </View>
    </View>
  );
}

/** A espera para mandar o e-mail de novo (o Supabase recusa outro para o mesmo endereço antes disso). */
export function useResendWait() {
  const [until, setUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const wait = until !== null && until > now ? Math.ceil((until - now) / 1000) : 0;
  const waiting = wait > 0;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waiting]);
  return {
    wait,
    start: () => {
      const at = Date.now();
      setNow(at);
      setUntil(at + RESEND_SECONDS * 1000);
    },
  };
}

/**
 * A conta foi criada e o e-mail precisa ser confirmado (pelo link: o e-mail ainda não traz código). A pessoa abre o
 * link e volta para entrar; dá para mandar o e-mail de novo ou trocar o endereço.
 */
export function ConfirmEmailStep({
  email,
  onDone,
  onResend,
  onChange,
  resendWait,
  busy,
}: {
  email: string;
  onDone: () => void;
  onResend: () => void;
  onChange: () => void;
  resendWait: number;
  busy: boolean;
}) {
  return (
    <View style={styles.form}>
      <OnboardingHero mood="think" title={CONFIRM_EMAIL_TITLE} text={confirmEmailText(email)} />
      <Button title={CONFIRM_EMAIL_DONE} onPress={onDone} disabled={busy} />
      <Button
        title={resendLabel(resendWait)}
        variant="ghost"
        compact
        loading={busy}
        disabled={resendWait > 0}
        onPress={onResend}
      />
      <Button title={CONFIRM_EMAIL_CHANGE} variant="ghost" compact disabled={busy} onPress={onChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: space.lg },
  consent: { alignItems: 'center' },
  center: { textAlign: 'center' },
});

import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { SESSION_ENDED } from '@/lib/accessErrors';
import { resendWaitSeconds, translateAuthError } from '@/lib/authErrors';
import { finishRecovery } from '@/lib/passwordRecovery';
import { useSessionEnded } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { notify } from '@/ui/dialogs';
import { FamilyArt, Logo } from '@/ui/art';
import { Button, Card, Icon, Row, Screen, Segmented, Text, TextField } from '@/ui/primitives';
import { space } from '@/ui/theme';

type Mode = 'entrar' | 'criar';
/** Esqueci a senha: o e-mail para mandar o código, depois o código. */
type Recovery = 'email' | 'codigo';

/** O Supabase só manda outro e-mail de recuperação para o mesmo endereço depois disso. */
const RESEND_SECONDS = 60;

export default function SignInScreen() {
  const [mode, setMode] = useState<Mode>('entrar');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [code, setCode] = useState('');
  /** Quando dá para pedir outro código (ms). */
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // A sessão acabou sem a pessoa tocar em "Sair": diz por que o app voltou para cá.
  const sessionEnded = useSessionEnded();

  const wait = resendAt !== null && resendAt > now ? Math.ceil((resendAt - now) / 1000) : 0;
  const waiting = wait > 0;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waiting]);

  async function submit() {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || password.length < 6) {
      notify('Confira os dados', 'Informe o e-mail e uma senha com pelo menos 6 caracteres.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'entrar') {
        // Entrar com a senha encerra uma recuperação que ficou pela metade neste aparelho.
        await finishRecovery();
        const { error } = await supabase.auth.signInWithPassword({ email: trimmed, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email: trimmed, password });
        if (error) throw error;
        if (!data.session) {
          notify('Confirme seu e-mail', 'Enviamos um link de confirmação. Depois é só entrar.');
          setMode('entrar');
        }
      }
    } catch (err) {
      notify('Não foi possível continuar', translateAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  function showCodeStep(resendInSeconds: number | null) {
    const at = Date.now();
    setEmail(email.trim().toLowerCase());
    setCode('');
    setNow(at);
    if (resendInSeconds !== null) setResendAt(at + resendInSeconds * 1000);
    setRecovery('codigo');
  }

  async function sendCode() {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      notify('Falta o e-mail', 'Digite o e-mail da sua conta.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(trimmed);
      // Pedido de novo cedo demais: o código do e-mail anterior ainda vale. A tela segue igual nos dois casos
      // (mesmo passo, mesma contagem), sem acrescentar um jeito de saber se o e-mail tem conta: o Supabase só
      // faz essa espera para quem tem.
      if (error && resendWaitSeconds(error) === null) throw error;
      showCodeStep(RESEND_SECONDS);
    } catch (err) {
      notify('Não deu para mandar o código', translateAuthError(err));
    } finally {
      setBusy(false);
    }
  }

  function haveCode() {
    if (!email.trim()) {
      notify('Falta o e-mail', 'Digite o e-mail da sua conta.');
      return;
    }
    showCodeStep(null);
  }

  // Código certo: o Supabase entra numa sessão de recuperação e o app abre a senha nova (app/nova-senha).
  async function checkCode() {
    const token = code.replace(/\D/g, '');
    if (token.length < 6) {
      notify('Confira o código', 'Digite os números do código que chegou no e-mail.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token, type: 'recovery' });
      if (error) throw error;
    } catch (err) {
      notify('Não deu para usar o código', translateAuthError(err));
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen edges={['top', 'bottom']}>
        <View style={styles.hero}>
          <FamilyArt width={260} />
          <Logo size={36} />
          <Text variant="body" style={styles.center}>
            A casa em ordem, sem esforço: compras, contas, tarefas e saúde da família num lugar só.
          </Text>
        </View>
        {sessionEnded ? (
          <Card>
            <Row>
              <Icon name="information-outline" color="primary" />
              <Text variant="body" style={styles.flex}>
                {SESSION_ENDED}
              </Text>
            </Row>
          </Card>
        ) : null}
        {recovery ? (
          <View style={styles.form}>
            <Text variant="label">Recuperar a senha</Text>
            {recovery === 'email' ? (
              <>
                <Text variant="muted">
                  Digite o e-mail da sua conta. Mandamos um código para você criar uma senha nova aqui mesmo.
                </Text>
                <TextField
                  label="E-mail"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  onSubmitEditing={sendCode}
                />
                <Button title="Enviar código" onPress={sendCode} loading={busy} />
                <Button title="Já tenho um código" variant="ghost" compact disabled={busy} onPress={haveCode} />
              </>
            ) : (
              <>
                <Text variant="muted">
                  Se {email} tiver conta no Kotii, o código chega em instantes (olhe também o spam). Vale o do e-mail
                  mais recente.
                </Text>
                <TextField
                  label="Código do e-mail"
                  value={code}
                  onChangeText={(text) => setCode(text.replace(/\D/g, '').slice(0, 10))}
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  maxLength={10}
                  onSubmitEditing={checkCode}
                />
                <Button title="Continuar" onPress={checkCode} loading={busy} />
                <Button
                  title={wait > 0 ? `Reenviar o código em ${wait} s` : 'Reenviar o código'}
                  variant="ghost"
                  compact
                  disabled={busy || wait > 0}
                  onPress={sendCode}
                />
              </>
            )}
            <Button
              title="Voltar para entrar"
              variant="ghost"
              compact
              disabled={busy}
              onPress={() => {
                setRecovery(null);
                setCode('');
              }}
            />
          </View>
        ) : (
          <>
            <Segmented
              value={mode}
              onChange={setMode}
              options={[
                { value: 'entrar', label: 'Entrar' },
                { value: 'criar', label: 'Criar conta' },
              ]}
            />
            <View style={styles.form}>
              <TextField
                label="E-mail"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                textContentType="emailAddress"
              />
              <TextField
                label="Senha"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete={mode === 'entrar' ? 'current-password' : 'new-password'}
                textContentType={mode === 'entrar' ? 'password' : 'newPassword'}
                onSubmitEditing={submit}
              />
              <Button title={mode === 'entrar' ? 'Entrar' : 'Criar conta'} onPress={submit} loading={busy} />
              {mode === 'entrar' ? (
                <Button
                  title="Esqueci minha senha"
                  variant="ghost"
                  compact
                  disabled={busy}
                  onPress={() => {
                    setCode('');
                    setRecovery('email');
                  }}
                />
              ) : null}
            </View>
          </>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  hero: { alignItems: 'center', gap: space.md, paddingTop: space.xl },
  form: { gap: space.lg },
});

import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { errorMessage, supabase } from '@/lib/supabase';
import { notify } from '@/ui/dialogs';
import { FamilyArt, Logo } from '@/ui/art';
import { Button, Screen, Segmented, Text, TextField } from '@/ui/primitives';
import { space } from '@/ui/theme';

type Mode = 'entrar' | 'criar';

export default function SignInScreen() {
  const [mode, setMode] = useState<Mode>('entrar');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || password.length < 6) {
      notify('Confira os dados', 'Informe o e-mail e uma senha com pelo menos 6 caracteres.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'entrar') {
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
      notify('Não foi possível continuar', translateAuthError(errorMessage(err)));
    } finally {
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
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

function translateAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'E-mail ou senha incorretos.';
  if (/already registered/i.test(message)) return 'Este e-mail já tem conta. Use "Entrar".';
  if (/email not confirmed/i.test(message)) return 'Confirme seu e-mail pelo link que enviamos.';
  return message;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  hero: { alignItems: 'center', gap: space.md, paddingTop: space.xl },
  form: { gap: space.lg },
});

import { AuthSessionMissingError } from '@supabase/supabase-js';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { signOut, useAuth } from '@/lib/auth';
import { isSessionGone, translateAuthError } from '@/lib/authErrors';
import { finishRecovery, recoveringUserId } from '@/lib/passwordRecovery';
import { supabase } from '@/lib/supabase';
import { notify } from '@/ui/dialogs';
import { Logo } from '@/ui/art';
import { Button, Screen, Text, TextField } from '@/ui/primitives';
import { space } from '@/ui/theme';

/** A mesma regra de "Criar conta". */
const MIN_PASSWORD = 6;

/**
 * Depois do código do e-mail de recuperação: a senha nova, antes de abrir a
 * casa. Salvar volta ao app (o USER_UPDATED, em lib/auth, tira a marca).
 */
export default function NewPasswordScreen() {
  const email = useAuth().session?.user.email;
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    if (password.length < MIN_PASSWORD) {
      notify('Senha curta', `Use uma senha com pelo menos ${MIN_PASSWORD} caracteres.`);
      return;
    }
    if (password !== repeat) {
      notify('As senhas não batem', 'Digite a mesma senha nos dois campos.');
      return;
    }
    setBusy(true);
    try {
      // A senha só vai para a conta que entrou pelo código (e não para outra que esteja neste aparelho).
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!data.session) throw new AuthSessionMissingError();
      if (data.session.user.id !== recoveringUserId()) {
        throw new Error('A conta aberta mudou. Peça um código novo em "Esqueci minha senha".');
      }
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
    } catch (err) {
      notify('Não deu para salvar a senha', translateAuthError(err));
      setBusy(false);
      // A sessão de recuperação acabou: volta para entrar (lá dá para pedir outro código).
      if (isSessionGone(err)) void cancel();
    }
  }

  // Sai antes de tirar a marca: com a marca fora e a sessão ainda aqui, a casa abriria.
  async function cancel() {
    setBusy(true);
    try {
      await signOut();
      await finishRecovery();
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen edges={['top', 'bottom']}>
        <View style={styles.hero}>
          <Logo size={36} />
          <Text variant="title" style={styles.center}>
            Crie uma senha nova
          </Text>
          <Text variant="body" style={styles.center}>
            {email ? `Para ${email}. ` : ''}Ela passa a valer em todos os aparelhos.
          </Text>
        </View>
        <View style={styles.form}>
          <TextField
            label="Senha nova"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            autoFocus
          />
          <TextField
            label="Repita a senha nova"
            value={repeat}
            onChangeText={setRepeat}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            onSubmitEditing={save}
          />
          <Button title="Salvar senha nova" onPress={save} loading={busy} />
          <Button title="Cancelar e sair" variant="ghost" compact disabled={busy} onPress={() => void cancel()} />
        </View>
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

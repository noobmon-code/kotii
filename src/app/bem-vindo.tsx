import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { errorMessage, supabase } from '@/lib/supabase';
import { notify } from '@/ui/dialogs';
import { Spot } from '@/ui/art';
import { Button, Card, Screen, Segmented, Text, TextField } from '@/ui/primitives';
import { space } from '@/ui/theme';

type Mode = 'criar' | 'entrar';

export default function WelcomeScreen() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>('criar');
  const [displayName, setDisplayName] = useState('');
  const [householdName, setHouseholdName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!displayName.trim()) {
      notify('Como você quer ser chamado?', 'Informe seu nome para a família te reconhecer.');
      return;
    }
    if (mode === 'criar' && !householdName.trim()) {
      notify('Dê um nome para a casa', 'Ex.: "Casa da Ana e do Beto".');
      return;
    }
    if (mode === 'entrar' && code.trim().length < 6) {
      notify('Código inválido', 'O código de convite tem 6 caracteres.');
      return;
    }
    setBusy(true);
    try {
      const { error } =
        mode === 'criar'
          ? await supabase.rpc('create_household', { p_name: householdName, p_display_name: displayName })
          : await supabase.rpc('join_household', { p_invite_code: code, p_display_name: displayName });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['household'] });
    } catch (err) {
      const message = errorMessage(err);
      notify(
        'Não foi possível continuar',
        /invalid invite code/i.test(message) ? 'Código não encontrado. Confira com quem te convidou.' : message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.hero}>
        <Spot tint="purple" size={140} shape="bean" />
        <Text variant="title">Sua casa</Text>
        <Text variant="muted" style={styles.center}>
          Tudo no Nooky é compartilhado com quem mora com você. Crie a casa ou entre com o código de convite.
        </Text>
      </View>
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: 'criar', label: 'Criar casa' },
          { value: 'entrar', label: 'Tenho um código' },
        ]}
      />
      <Card style={styles.form}>
        <TextField label="Seu nome" value={displayName} onChangeText={setDisplayName} autoCapitalize="words" />
        {mode === 'criar' ? (
          <TextField
            label="Nome da casa"
            value={householdName}
            onChangeText={setHouseholdName}
            placeholder="Casa da família Silva"
          />
        ) : (
          <TextField
            label="Código de convite"
            value={code}
            onChangeText={(v) => setCode(v.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={6}
            placeholder="ABC123"
          />
        )}
        <Button title={mode === 'criar' ? 'Criar casa' : 'Entrar na casa'} onPress={submit} loading={busy} />
      </Card>
      <Button title="Sair" variant="ghost" onPress={() => supabase.auth.signOut()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  hero: { alignItems: 'center', gap: space.md, paddingTop: space.xl },
  form: { gap: space.lg },
});

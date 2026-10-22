import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { AccountDeletionUnavailable, HousesChangedError, useAccountDeletionPreview, useDeleteAccount } from '@/data/account';
import { accountDeletionNotes, accountDeletionUnavailable, housesToDelete } from '@/domain/account';
import { TERMS_CONTACT } from '@/domain/terms';
import { useAuth } from '@/lib/auth';
import { confirmAction, notify } from '@/ui/dialogs';
import { Button, Card, ErrorNotice, Loading, Screen, Section, Text, TextField } from '@/ui/primitives';
import { space } from '@/ui/theme';

/**
 * Apagar a conta (Configurações → Conta, na aba Família). Antes, o que acontece com cada casa (a que
 * passa adiante, a que é apagada por ela ser a última), depois a senha de
 * novo e a confirmação. Quem confere a senha e apaga é a função
 * delete-account; sem ela publicada, a tela manda escrever para o contato.
 */
export default function DeleteAccountScreen() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const preview = useAccountDeletionPreview(userId);
  const remove = useDeleteAccount(userId);
  const [password, setPassword] = useState('');
  // A função respondeu que não existe (a prévia do banco já existia).
  const [unavailable, setUnavailable] = useState(false);

  if (preview.isError) {
    return (
      <Screen>
        <ErrorNotice error={preview.error} onRetry={() => preview.refetch()} />
      </Screen>
    );
  }
  if (preview.data === undefined) return <Loading />;
  const houses = preview.data;

  if (!houses || unavailable) {
    return (
      <Screen>
        <Card style={styles.card}>
          <Text variant="body" selectable>
            {accountDeletionUnavailable(TERMS_CONTACT)}
          </Text>
        </Card>
      </Screen>
    );
  }
  const deleteHouseholds = housesToDelete(houses);

  // Só o que é da tela: o aviso de cada erro sai do hook, mesmo com a tela já fechada.
  function onError(err: Error) {
    if (err instanceof AccountDeletionUnavailable) {
      setUnavailable(true);
    } else if (err instanceof HousesChangedError) {
      // O aviso de cima muda com a releitura; a pessoa confirma de novo.
      preview.refetch();
    }
  }

  function submit() {
    if (remove.isPending) return;
    if (!password) {
      notify('Digite a sua senha', 'Para apagar a conta, confirme com a senha com que você entra no app.');
      return;
    }
    confirmAction(
      'Apagar a conta',
      deleteHouseholds.length
        ? 'Isso não tem volta: a conta e as casas em que você é a última pessoa são apagadas para sempre.'
        : 'Isso não tem volta: a conta é apagada para sempre.',
      'Apagar para sempre',
      () => remove.mutate({ password, deleteHouseholds }, { onError }),
    );
  }

  return (
    <Screen>
      <Card style={styles.card}>
        {accountDeletionNotes(houses).map((note) => (
          <Text key={note} variant="body">
            {note}
          </Text>
        ))}
      </Card>
      <Section title="Confirme com a sua senha">
        <TextField
          label="Senha"
          hint={session?.user.email ? `A senha de ${session.user.email}.` : undefined}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          onSubmitEditing={submit}
        />
        <Button title="Apagar minha conta" variant="danger" icon="account-remove-outline" loading={remove.isPending} onPress={submit} />
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
});

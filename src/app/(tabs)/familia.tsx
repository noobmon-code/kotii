import { Share, StyleSheet } from 'react-native';

import { useAuth, useHousehold } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { confirmAction } from '@/ui/dialogs';
import { Badge, Button, Card, IconBadge, ListCard, ListRow, Loading, Screen, Section, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

export default function FamilyScreen() {
  const { session } = useAuth();
  const household = useHousehold();

  if (!household.data) return <Loading />;
  const { household: house, members, me } = household.data;

  function shareInvite() {
    Share.share({
      message: `Entre na nossa casa "${house.name}" no Nooky com o código ${house.invite_code}.`,
    }).catch(() => undefined);
  }

  return (
    <Screen>
      <Text variant="title">{house.name}</Text>

      <Card style={styles.invite}>
        <Text variant="muted">Código de convite</Text>
        <Text variant="title" style={styles.code} selectable>
          {house.invite_code}
        </Text>
        <Text variant="small" style={styles.center}>
          Quem entrar com este código vê e edita listas, notas, despensa, tarefas e remédios da casa.
        </Text>
        <Button title="Compartilhar convite" icon="share-variant-outline" variant="secondary" onPress={shareInvite} />
      </Card>

      <Section title={`Moradores (${members.length})`}>
        <ListCard>
          {members.map((m) => (
            <ListRow
              key={m.user_id}
              left={<IconBadge icon="account-outline" tone={m.user_id === me.user_id ? 'primary' : 'neutral'} />}
              title={m.user_id === me.user_id ? `${m.display_name} (você)` : m.display_name}
              right={m.role === 'owner' ? <Badge label="Criou a casa" /> : null}
            />
          ))}
        </ListCard>
      </Section>

      <Section title="Conta">
        <Text variant="muted">{session?.user.email}</Text>
        <Button
          title="Sair"
          variant="danger"
          icon="logout"
          onPress={() => confirmAction('Sair', 'Deseja sair desta conta?', 'Sair', () => supabase.auth.signOut())}
        />
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  invite: { alignItems: 'center', gap: space.md },
  code: { letterSpacing: 6 },
});

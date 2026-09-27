import { Share, StyleSheet } from 'react-native';

import { useLeaveHousehold } from '@/data/household';
import { DocumentsSection } from '@/features/DocumentsSection';
import { clearConversation } from '@/features/nuke/conversation';
import { useAuth, useHousehold } from '@/lib/auth';
import { errorMessage, supabase } from '@/lib/supabase';
import { confirmAction, notify } from '@/ui/dialogs';
import { Badge, Button, Card, IconBadge, ListCard, ListRow, Loading, PageTitle, Screen, Section, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

export default function FamilyScreen() {
  const { session } = useAuth();
  const household = useHousehold();
  const leave = useLeaveHousehold();

  if (!household.data) return <Loading />;
  const { household: house, members, me } = household.data;
  const heir = members.find((m) => m.user_id !== me.user_id);

  async function confirmLeave() {
    // A lista de moradores pode ter mudado: o aviso precisa dizer se a casa
    // será apagada. Quem decide de fato é o servidor.
    const fresh = (await household.refetch()).data;
    if (!fresh) return;
    const next = fresh.members.find((m) => m.user_id !== fresh.me.user_id);
    const onConfirm = () =>
      leave.mutate(undefined, {
        onSuccess: () => clearConversation(fresh.me.user_id),
        onError: (err) => notify('Não deu para sair', errorMessage(err)),
      });
    if (!next) {
      confirmAction(
        'Apagar a casa',
        `Você é a última pessoa em "${fresh.household.name}". Ao sair, a casa e tudo o que ela tem (listas, notas, despensa, tarefas, saúde, documentos e fotos) são apagados para sempre.`,
        'Apagar e sair',
        onConfirm,
      );
      return;
    }
    const handOver = fresh.me.role === 'owner' ? ` ${next.display_name} fica responsável pela casa.` : '';
    confirmAction(
      'Sair da casa',
      `Você deixa de ver os dados de "${fresh.household.name}". O que você registrou continua com a casa.${handOver} Para voltar, só com o código de convite.`,
      'Sair da casa',
      onConfirm,
    );
  }

  function shareInvite() {
    Share.share({
      message: `Entre na nossa casa "${house.name}" no Nooky com o código ${house.invite_code}.`,
    }).catch(() => undefined);
  }

  return (
    <Screen fab>
      <PageTitle title={house.name} subtitle="Família" tint="purple" />

      <Card style={styles.invite}>
        <Text variant="muted">Código de convite</Text>
        <Text variant="title" style={styles.code} selectable>
          {house.invite_code}
        </Text>
        <Text variant="small" style={styles.center}>
          Quem entrar com este código vê e edita tudo da casa: listas, notas, despensa, tarefas, saúde e documentos.
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
              right={m.role === 'owner' ? <Badge label="Responsável" /> : null}
            />
          ))}
        </ListCard>
      </Section>

      <DocumentsSection />

      <Section title="Casa">
        <Text variant="muted">
          {heir
            ? 'Saindo, você pode criar outra casa ou entrar em uma com um código.'
            : 'Você é a única pessoa aqui. Saindo, a casa é apagada.'}
        </Text>
        <Button
          title="Sair da casa"
          variant="secondary"
          icon="home-export-outline"
          loading={leave.isPending}
          onPress={confirmLeave}
        />
      </Section>

      <Section title="Conta">
        <Text variant="muted">{session?.user.email}</Text>
        <Button
          title="Sair da conta"
          variant="danger"
          icon="logout"
          onPress={() => confirmAction('Sair da conta', 'Deseja sair desta conta neste aparelho?', 'Sair', () => supabase.auth.signOut())}
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

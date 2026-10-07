import { router } from 'expo-router';
import { Share, StyleSheet } from 'react-native';

import { usePeople } from '@/data/health';
import { useKidPoints } from '@/data/home';
import { LastMemberError, useLeaveHousehold, useRegenerateInviteCode, useRemoveMember } from '@/data/household';
import { AiUsageSection } from '@/features/AiUsageSection';
import { DocumentsSection } from '@/features/DocumentsSection';
import { HouseRemindersSection } from '@/features/HouseRemindersSection';
import { signOut, useAuth, useHousehold } from '@/lib/auth';
import { errorMessage } from '@/lib/supabase';
import { confirmAction, notify } from '@/ui/dialogs';
import { Badge, Button, Card, Icon, IconBadge, IconButton, ListCard, ListRow, Loading, PageTitle, Row, Screen, Section, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

export default function FamilyScreen() {
  const { session } = useAuth();
  const household = useHousehold();
  const leave = useLeaveHousehold(session?.user.id);
  const removeMember = useRemoveMember();
  const regenerateCode = useRegenerateInviteCode();
  const people = usePeople();
  const kidPoints = useKidPoints();

  if (!household.data) return <Loading />;
  const { household: house, members, me, households } = household.data;
  const isOwner = me.role === 'owner';
  const heir = members.find((m) => m.user_id !== me.user_id);
  const otherHouse = households.find((h) => h.id !== house.id);
  const leaveHint = [
    heir ? null : 'Você é a única pessoa aqui: sair apaga a casa.',
    otherHouse
      ? `Depois de sair, o app abre em "${otherHouse.name}".`
      : heir
        ? 'Saindo, você pode criar outra casa ou entrar em uma com um código.'
        : null,
  ]
    .filter(Boolean)
    .join(' ');
  // Quem não usa o app: crianças, dependentes e pets, com ficha, remédios e vacinas.
  const withoutApp = (people.data ?? []).filter((p) => !p.member_user_id);
  const points = kidPoints.data ?? {};
  const addPerson = (kind: 'pessoa' | 'pet') => router.push({ pathname: '/pessoa/[id]', params: { id: 'nova', kind } });

  function confirmDelete(houseId: string, houseName: string) {
    confirmAction(
      'Apagar a casa',
      `Você é a última pessoa em "${houseName}". Ao sair, a casa e tudo o que ela tem (listas, notas, despensa, tarefas, saúde, documentos e fotos) são apagados para sempre.`,
      'Apagar e sair',
      () =>
        leave.mutate(
          { householdId: houseId, deleteIfLast: true },
          { onError: (err) => notify('Não deu para sair', errorMessage(err)) },
        ),
    );
  }

  async function confirmLeave() {
    // A lista de moradores pode ter mudado: o aviso precisa dizer se a casa
    // será apagada. Quem decide de fato é o servidor, que só apaga com a
    // confirmação de apagar.
    const fresh = (await household.refetch()).data;
    if (!fresh) return;
    const next = fresh.members.find((m) => m.user_id !== fresh.me.user_id);
    if (!next) {
      confirmDelete(fresh.household.id, fresh.household.name);
      return;
    }
    const handOver = fresh.me.role === 'owner' ? ` ${next.display_name} fica responsável pela casa.` : '';
    confirmAction(
      'Sair da casa',
      `Você deixa de ver os dados de "${fresh.household.name}". O que você registrou continua com a casa.${handOver} Para voltar, só com o código de convite.`,
      'Sair da casa',
      () =>
        leave.mutate(
          { householdId: fresh.household.id, deleteIfLast: false },
          {
            // Os outros saíram enquanto isso: agora sair apaga a casa, e isso precisa de outro sim.
            onError: (err) =>
              err instanceof LastMemberError
                ? confirmDelete(fresh.household.id, fresh.household.name)
                : notify('Não deu para sair', errorMessage(err)),
          },
        ),
    );
  }

  function shareInvite() {
    Share.share({
      message: `Entre na nossa casa "${house.name}" no Nooky com o código ${house.invite_code}.`,
    }).catch(() => undefined);
  }

  // Código que vazou (ou alguém que saiu e não deve voltar): o antigo para de valer na hora.
  function confirmRegenerateCode() {
    confirmAction(
      'Trocar o código de convite',
      'O código atual deixa de valer na hora; quem já está na casa continua. Quem ainda vai entrar precisa do código novo.',
      'Trocar código',
      () => regenerateCode.mutate(house.id, { onError: (err) => notify('Não deu para trocar o código', errorMessage(err)) }),
      false,
    );
  }

  function confirmRemove(member: { user_id: string; display_name: string }) {
    confirmAction(
      'Tirar da casa',
      `${member.display_name} deixa de ver os dados de "${house.name}". O que registrou continua com a casa; a ficha de pessoa fica como dependente. Para voltar, só com o código de convite.`,
      'Tirar da casa',
      () =>
        removeMember.mutate(
          { householdId: house.id, userId: member.user_id },
          { onError: (err) => notify('Não deu para tirar da casa', errorMessage(err)) },
        ),
    );
  }

  return (
    <Screen fab>
      <PageTitle title={house.name} subtitle="Família" tint="purple" />

      <ListCard>
        <ListRow
          left={<IconBadge icon="home-switch-outline" tone="primary" />}
          title={households.length > 1 ? `Suas casas (${households.length})` : 'Suas casas'}
          subtitle={households.length > 1 ? 'Trocar de casa, criar ou entrar em outra' : 'Criar ou entrar em outra casa'}
          right={<Icon name="chevron-right" color="textMuted" />}
          onPress={() => router.push('/casas')}
        />
      </ListCard>

      <Card style={styles.invite}>
        <Text variant="muted">Código de convite</Text>
        <Text variant="title" style={styles.code} selectable>
          {house.invite_code}
        </Text>
        <Text variant="small" style={styles.center}>
          Quem entrar com este código vê e edita tudo da casa: listas, notas, despensa, tarefas, saúde e documentos.
        </Text>
        <Button title="Compartilhar convite" icon="share-variant-outline" variant="secondary" onPress={shareInvite} />
        {isOwner ? (
          <Button
            title="Trocar código"
            icon="refresh"
            variant="ghost"
            compact
            loading={regenerateCode.isPending}
            onPress={confirmRegenerateCode}
          />
        ) : null}
      </Card>

      <Section title={`Moradores (${members.length})`}>
        <ListCard>
          {members.map((m) => (
            <ListRow
              key={m.user_id}
              left={<IconBadge icon="account-outline" tone={m.user_id === me.user_id ? 'primary' : 'neutral'} />}
              title={m.user_id === me.user_id ? `${m.display_name} (você)` : m.display_name}
              right={
                m.role === 'owner' ? (
                  <Badge label="Responsável" />
                ) : isOwner ? (
                  <IconButton icon="account-remove-outline" label={`Tirar ${m.display_name} da casa`} onPress={() => confirmRemove(m)} />
                ) : null
              }
            />
          ))}
        </ListCard>
      </Section>

      <Section title="Sem celular">
        <Text variant="muted">
          Crianças, idosos e pets que não usam o app: remédios, vacinas, consultas e documentos ficam no nome deles.
        </Text>
        {withoutApp.length ? (
          <ListCard>
            {withoutApp.map((p) => (
              <ListRow
                key={p.id}
                left={<IconBadge icon={p.kind === 'pet' ? 'paw' : 'account-child-outline'} tone="neutral" />}
                title={p.name}
                subtitle={
                  p.kind === 'pet'
                    ? (p.species ?? 'Pet')
                    : points[p.id]
                      ? `${points[p.id]} ${points[p.id] === 1 ? 'ponto' : 'pontos'} nas tarefas`
                      : 'Sem conta no app'
                }
                onPress={() => router.push({ pathname: '/pessoa/[id]', params: { id: p.id } })}
              />
            ))}
          </ListCard>
        ) : null}
        <Row style={styles.wrap}>
          <Button title="Adicionar pessoa" icon="account-plus-outline" variant="secondary" compact onPress={() => addPerson('pessoa')} />
          <Button title="Adicionar pet" icon="paw" variant="secondary" compact onPress={() => addPerson('pet')} />
        </Row>
      </Section>

      <DocumentsSection />

      <HouseRemindersSection />

      <AiUsageSection />

      <Section title="Casa">
        <Text variant="muted">
          {leaveHint}
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
          onPress={() => confirmAction('Sair da conta', 'Deseja sair desta conta neste aparelho?', 'Sair', () => signOut())}
        />
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  invite: { alignItems: 'center', gap: space.md },
  code: { letterSpacing: 6 },
  wrap: { flexWrap: 'wrap' },
});

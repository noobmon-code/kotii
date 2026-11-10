import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Share, StyleSheet, View } from 'react-native';

import { useIsAppAdmin } from '@/data/appDashboard';
import { usePeople } from '@/data/health';
import { useKidPoints } from '@/data/home';
import {
  LastMemberError,
  useLeaveHousehold,
  useRegenerateInviteCode,
  useRemoveMember,
  useSignOutQuestion,
} from '@/data/household';
import { useIsModerator } from '@/data/storeModeration';
import { useHouseholdLocation } from '@/data/weather';
import { APP_DASHBOARD_TITLE } from '@/domain/appDashboard';
import { FEEDBACK_FORM_TITLE } from '@/domain/appFeedback';
import { THEME_CHOICES, THEME_HINT } from '@/domain/appearance';
import { HOUSE_PLACE_TITLE, housePlaceRowSubtitle, openHouseName } from '@/domain/housePlace';
import { MODERATION_TITLE } from '@/domain/storeModeration';
import { TERMS_TITLE, termsVersionLabel } from '@/domain/terms';
import { AiUsageCard } from '@/features/AiUsageCard';
import { SharedPricesAbout } from '@/features/SharedPrices';
import { signOut, useAuth, useHousehold } from '@/lib/auth';
import { REMINDER_PLACE } from '@/lib/reminders';
import { errorMessage } from '@/lib/supabase';
import { confirmAction, notify } from '@/ui/dialogs';
import {
  Badge,
  Button,
  Card,
  Icon,
  IconBadge,
  IconButton,
  ListCard,
  ListRow,
  Loading,
  Row,
  Screen,
  Section,
  Segmented,
  Text,
} from '@/ui/primitives';
import { space, useThemeChoice } from '@/ui/theme';

const THEME_OPTIONS = [...THEME_CHOICES];

const chevron = <Icon name="chevron-right" color="textMuted" />;

/**
 * Configurações (a aba "Ajustes" da barra, que juntou a antiga aba Família e a tela de Configurações), do mais usado
 * ao mais raro, com as saídas no fim: Casa (moradores, convite, pessoas e pets sem celular, clima da casa, suas
 * casas), Avisos, Você (perfil e tema), Sobre o Kotii (uso da IA, preços compartilhados, termos e recado), Conta
 * (sair, sair da casa, apagar a conta) e, só para quem tem acesso, Manutenção do app. Fica curta: os avisos, o perfil
 * e o recado são linhas que abrem telas próprias (/avisos, /perfil, /recado), e o uso da IA e os preços
 * compartilhados são linhas que abrem ali mesmo, ao tocar (como o "Convidar"); só a casa e o tema ficam abertos aqui.
 * Sem cartão de topo (a barra de abas já diz a aba): o título da página é só para o leitor de tela.
 */
export default function SettingsScreen() {
  const { session } = useAuth();
  const household = useHousehold();
  const leave = useLeaveHousehold(session?.user.id);
  const removeMember = useRemoveMember();
  const regenerateCode = useRegenerateInviteCode();
  const people = usePeople();
  const kidPoints = useKidPoints();
  const theme = useThemeChoice();
  const signOutQuestion = useSignOutQuestion();
  const isAdmin = useIsAppAdmin().data === true;
  const moderator = useIsModerator().data === true;
  const location = useHouseholdLocation();
  const [inviteOpen, setInviteOpen] = useState(false);

  if (!household.data) return <Loading />;
  const { household: house, members, me, households } = household.data;
  const isOwner = me.role === 'owner';
  const heir = members.find((m) => m.user_id !== me.user_id);
  const otherHouse = households.find((h) => h.id !== house.id);
  // A explicação diz de qual saída fala ("sair desta casa"): na categoria Conta, ela vem logo depois de "Sair da
  // conta", que não apaga nada.
  const leaveHint = [
    heir ? null : 'Você é a única pessoa aqui: sair desta casa apaga a casa.',
    otherHouse
      ? `Depois de sair desta casa, o app abre em "${otherHouse.name}".`
      : heir
        ? 'Saindo desta casa, você pode criar outra ou entrar em uma com um código.'
        : null,
  ]
    .filter(Boolean)
    .join(' ');
  // Quem não usa o app: crianças, dependentes e pets, com ficha, remédios e vacinas.
  const withoutApp = (people.data ?? []).filter((p) => !p.member_user_id);
  // A ficha de quem usa o app (a da saúde), pelo usuário: tocar no morador abre a dele.
  const recordOf = (userId: string) => people.data?.find((p) => p.member_user_id === userId) ?? null;
  const points = kidPoints.data ?? {};
  const addPerson = (kind: 'pessoa' | 'pet') => router.push({ pathname: '/pessoa/[id]', params: { id: 'nova', kind } });
  const email = session?.user.email;

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
      message: `Entre na nossa casa "${house.name}" no Kotii com o código ${house.invite_code}.`,
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
    <Screen fab heading="Configurações">
      <Section title="Casa">
        <View style={styles.groups}>
          <Group title={`Moradores (${members.length})`}>
            <ListCard>
              {members.map((m) => {
                const record = recordOf(m.user_id);
                return (
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
                    // Sem a ficha (as fichas ainda carregando), a linha só mostra.
                    onPress={record ? () => router.push({ pathname: '/pessoa/[id]', params: { id: record.id } }) : undefined}
                  />
                );
              })}
              {/* O código só aparece pedido: na tela, à vista de quem passa, ele abriria a casa. */}
              <ListRow
                left={<IconBadge icon="account-plus-outline" tone="primary" />}
                title="Convidar"
                subtitle={inviteOpen ? 'Código de convite desta casa' : 'Mostrar o código de convite'}
                right={<Icon name={inviteOpen ? 'chevron-up' : 'chevron-down'} color="textMuted" />}
                expanded={inviteOpen}
                onPress={() => setInviteOpen((open) => !open)}
              />
              {inviteOpen ? (
                <View style={styles.invite}>
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
                </View>
              ) : null}
            </ListCard>
          </Group>

          {/* A lista das fichas de quem não usa o app, e onde elas se cadastram (Saúde → Cuidados filtra e edita, mas
              não tem mais "Adicionar"; os formulários com o seletor de pessoa ainda cadastram alguém na hora). */}
          <Group title="Pessoas e pets sem celular">
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
          </Group>

          {/* Da casa aberta (com mais de uma casa, o nome dela vem na linha): o bairro do clima. */}
          <ListCard>
            <ListRow
              left={<IconBadge icon="weather-partly-cloudy" tone="neutral" />}
              title={HOUSE_PLACE_TITLE}
              subtitle={housePlaceRowSubtitle(location.data, openHouseName(household.data))}
              right={chevron}
              onPress={() => router.push('/clima')}
            />
            <ListRow
              left={<IconBadge icon="home-switch-outline" tone="neutral" />}
              title={households.length > 1 ? `Suas casas (${households.length})` : 'Suas casas'}
              subtitle={households.length > 1 ? 'Trocar de casa, criar ou entrar em outra' : 'Criar ou entrar em outra casa'}
              right={chevron}
              onPress={() => router.push('/casas')}
            />
          </ListCard>
        </View>
      </Section>

      {/* Os interruptores (nove, ou mais no navegador) ficam numa tela própria: abertos aqui, a aba ficaria comprida. */}
      <Section title="Avisos">
        <ListCard>
          <ListRow
            left={<IconBadge icon="bell-outline" tone="neutral" />}
            title={`Avisos ${REMINDER_PLACE}`}
            subtitle="Tarefas, remédios, consultas e mais, por notificação"
            right={chevron}
            onPress={() => router.push('/avisos')}
          />
        </ListCard>
      </Section>

      <Section title="Você">
        <View style={styles.groups}>
          <ListCard>
            <ListRow
              left={<IconBadge icon="account-circle-outline" tone="neutral" />}
              title="Perfil"
              subtitle={[me.display_name, email].filter(Boolean).join(' · ')}
              right={chevron}
              onPress={() => router.push('/perfil')}
            />
          </ListCard>
          {/* O tema deste aparelho (ui/ThemeChoiceProvider): a escolha muda as cores na hora, então fica aqui, aberta. */}
          <Card style={styles.card}>
            <Text variant="label">Tema</Text>
            <Segmented options={THEME_OPTIONS} value={theme.choice} onChange={theme.setChoice} />
            <Text variant="small">{THEME_HINT}</Text>
          </Card>
        </View>
      </Section>

      <Section title="Sobre o Kotii">
        <View style={styles.groups}>
          <AiUsageCard />
          <SharedPricesAbout />
          <ListCard>
            <ListRow
              left={<IconBadge icon="shield-account-outline" tone="neutral" />}
              title={TERMS_TITLE}
              subtitle={termsVersionLabel()}
              right={chevron}
              onPress={() => router.push('/termos')}
            />
            <ListRow
              left={<IconBadge icon="message-text-outline" tone="neutral" />}
              title={FEEDBACK_FORM_TITLE}
              subtitle="Um problema, uma sugestão ou um elogio sobre o app"
              right={chevron}
              onPress={() => router.push('/recado')}
            />
          </ListCard>
        </View>
      </Section>

      <Section title="Conta">
        <View style={styles.groups}>
          <Button
            title="Sair da conta"
            variant="danger"
            icon="logout"
            onPress={() => confirmAction('Sair da conta', signOutQuestion(), 'Sair', () => signOut())}
          />
          {/* A explicação fica junto do botão que ela explica, e longe de "Sair da conta". */}
          <View style={styles.group}>
            {leaveHint ? <Text variant="muted">{leaveHint}</Text> : null}
            <Button title="Sair desta casa" variant="secondary" icon="home-export-outline" loading={leave.isPending} onPress={confirmLeave} />
          </View>
          {/* A tela explica antes o que fica com cada casa e pede a senha de novo. */}
          <Button
            title="Apagar minha conta"
            variant="ghost"
            compact
            icon="account-remove-outline"
            onPress={() => router.push('/apagar-conta')}
          />
        </View>
      </Section>

      {/* Só para quem mantém o app (app_admins: os números de uso, só totais) e para quem modera os nomes dos mercados. */}
      {isAdmin || moderator ? (
        <Section title="Manutenção do app">
          <ListCard>
            {isAdmin ? (
              <ListRow
                left={<IconBadge icon="chart-box-outline" tone="neutral" />}
                title={APP_DASHBOARD_TITLE}
                subtitle="Contas, pessoas ativas, Nuke e funções"
                right={chevron}
                onPress={() => router.push('/painel')}
              />
            ) : null}
            {moderator ? (
              <ListRow
                left={<IconBadge icon="store-edit-outline" tone="neutral" />}
                title={MODERATION_TITLE}
                subtitle="O nome padrão de cada mercado"
                right={chevron}
                onPress={() => router.push('/moderacao')}
              />
            ) : null}
          </ListCard>
        </Section>
      ) : null}
    </Screen>
  );
}

/** Um grupo dentro de uma categoria: o nome dele (também para quem navega pelos títulos) e o que ele tem. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <Text variant="label" accessibilityRole="header" style={styles.groupTitle}>
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  groups: { gap: space.lg },
  group: { gap: space.sm },
  groupTitle: { paddingHorizontal: space.xs },
  card: { gap: space.md },
  center: { textAlign: 'center' },
  invite: { alignItems: 'center', gap: space.md, paddingVertical: space.md },
  code: { letterSpacing: 6 },
  wrap: { flexWrap: 'wrap' },
});

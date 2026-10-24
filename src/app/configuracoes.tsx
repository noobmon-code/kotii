import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet } from 'react-native';

import { useIsAppAdmin } from '@/data/appDashboard';
import { useSignOutQuestion } from '@/data/household';
import { useMyProfile, useSaveProfile, type MyProfile } from '@/data/profile';
import { useIsModerator } from '@/data/storeModeration';
import { APP_DASHBOARD_TITLE } from '@/domain/appDashboard';
import { THEME_CHOICES, THEME_HINT } from '@/domain/appearance';
import { formatBRDate, todayISO } from '@/domain/dates';
import { MODERATION_TITLE } from '@/domain/storeModeration';
import {
  maskPhone,
  phoneFieldText,
  PROFILE_NAME_HINT,
  PROFILE_NOT_READY,
  PROFILE_PRIVACY,
  profileChanged,
  validateProfile,
  type ProfileValues,
} from '@/domain/profile';
import { TERMS_TITLE, termsVersionLabel } from '@/domain/terms';
import { signOut, useAuth, useHousehold } from '@/lib/auth';
import { confirmAction, notify } from '@/ui/dialogs';
import {
  Button,
  Card,
  DateField,
  ErrorNotice,
  Icon,
  IconBadge,
  ListCard,
  ListRow,
  Loading,
  Row,
  Screen,
  Section,
  Segmented,
  Text,
  TextField,
} from '@/ui/primitives';
import { space, useThemeChoice } from '@/ui/theme';

const THEME_OPTIONS = [...THEME_CHOICES];

/**
 * Configurações (da aba Família: a engrenagem do topo e a linha do fim). Perfil: o nome, que vale em todas as
 * casas da pessoa, e a data de nascimento e o telefone, que só ela vê (data/profile). Aparência: o tema deste
 * aparelho (ui/ThemeChoiceProvider). Moderação, só para quem modera: os nomes padrão dos mercados. Conta: os
 * termos, sair e apagar a conta, que antes ficavam na aba Família.
 */
export default function SettingsScreen() {
  const { session } = useAuth();
  const household = useHousehold();
  const theme = useThemeChoice();
  const signOutQuestion = useSignOutQuestion();
  const isAdmin = useIsAppAdmin().data === true;
  const moderator = useIsModerator();
  const email = session?.user.email;

  return (
    <Screen>
      <Section title="Perfil">
        <ProfileSection name={household.data?.me.display_name ?? ''} />
        {email ? (
          <Card style={styles.card}>
            <Text variant="label">E-mail da conta</Text>
            <Text variant="body" selectable>
              {email}
            </Text>
          </Card>
        ) : null}
      </Section>

      <Section title="Aparência">
        <Card style={styles.card}>
          <Text variant="label">Tema</Text>
          <Segmented options={THEME_OPTIONS} value={theme.choice} onChange={theme.setChoice} />
          <Text variant="small">{THEME_HINT}</Text>
        </Card>
      </Section>

      {/* Só para quem mantém o app (app_admins): os números de uso, só totais. */}
      {isAdmin ? (
        <Section title="Painel">
          <ListCard>
            <ListRow
              left={<IconBadge icon="chart-box-outline" tone="neutral" />}
              title={APP_DASHBOARD_TITLE}
              subtitle="Contas, pessoas ativas, Nuke e funções"
              right={<Icon name="chevron-right" color="textMuted" />}
              onPress={() => router.push('/painel')}
            />
          </ListCard>
        </Section>
      ) : null}

      {moderator.data ? (
        <Section title="Moderação">
          <ListCard>
            <ListRow
              left={<IconBadge icon="store-edit-outline" tone="neutral" />}
              title={MODERATION_TITLE}
              subtitle="O nome padrão de cada mercado"
              right={<Icon name="chevron-right" color="textMuted" />}
              onPress={() => router.push('/moderacao')}
            />
          </ListCard>
        </Section>
      ) : null}

      <Section title="Conta">
        <ListCard>
          <ListRow
            left={<IconBadge icon="shield-account-outline" tone="neutral" />}
            title={TERMS_TITLE}
            subtitle={termsVersionLabel()}
            right={<Icon name="chevron-right" color="textMuted" />}
            onPress={() => router.push('/termos')}
          />
        </ListCard>
        <Button
          title="Sair da conta"
          variant="danger"
          icon="logout"
          onPress={() => confirmAction('Sair da conta', signOutQuestion(), 'Sair', () => signOut())}
        />
        {/* A tela explica antes o que fica com cada casa e pede a senha de novo. */}
        <Button
          title="Apagar minha conta"
          variant="ghost"
          compact
          icon="account-remove-outline"
          onPress={() => router.push('/apagar-conta')}
        />
      </Section>
    </Screen>
  );
}

/** O perfil: espera a linha da pessoa para preencher os campos uma vez só. Sem a tabela, só o nome e o aviso. */
function ProfileSection({ name }: { name: string }) {
  const profile = useMyProfile();
  if (profile.data === undefined) {
    if (profile.isError) return <ErrorNotice error={profile.error} onRetry={() => profile.refetch()} />;
    // Sem internet, a busca espera a conexão (e volta sozinha): melhor dizer que girar sem fim.
    if (profile.isPaused) return <Text variant="muted">Sem internet: o perfil abre quando a conexão voltar.</Text>;
    return <Loading />;
  }
  if (!profile.data.available) {
    return (
      <Card style={styles.card}>
        <Text variant="label">Nome</Text>
        <Text variant="body">{name}</Text>
        <Text variant="muted">{PROFILE_NOT_READY}</Text>
      </Card>
    );
  }
  return <ProfileForm name={name} profile={profile.data.profile} />;
}

function ProfileForm({ name: savedName, profile }: { name: string; profile: MyProfile | null }) {
  const save = useSaveProfile();
  // O que está gravado: muda a cada "Salvar" que deu certo, para o botão saber se há o que salvar.
  const [saved, setSaved] = useState<ProfileValues>(() => ({
    name: savedName,
    birthDate: profile?.birth_date ?? null,
    phone: profile?.phone ?? null,
  }));
  const [name, setName] = useState(saved.name);
  const [birthDate, setBirthDate] = useState(saved.birthDate ? formatBRDate(saved.birthDate) : '');
  const [phone, setPhone] = useState(phoneFieldText(saved.phone));
  const [done, setDone] = useState(false);
  // Dois toques rápidos mandam um pedido só.
  const sending = useRef(false);

  const form = { name, birthDate, phone };
  const changed = profileChanged(form, saved, todayISO());
  const edit = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setDone(false);
  };

  function submit() {
    if (sending.current || save.isPending) return;
    const read = validateProfile(form, todayISO());
    if (!read.ok) {
      notify(read.title, read.message);
      return;
    }
    sending.current = true;
    save.mutate(read.values, {
      onSuccess: (result) => {
        const values = { name: result.name, birthDate: result.birth_date, phone: result.phone };
        setSaved(values);
        // Os campos ficam como o banco gravou (o nome sem espaços nas pontas, o telefone com a máscara).
        setName(values.name);
        setPhone(phoneFieldText(values.phone));
        setDone(true);
      },
      onSettled: () => {
        sending.current = false;
      },
    });
  }

  return (
    <Card style={styles.card}>
      <TextField
        label="Nome"
        hint={PROFILE_NAME_HINT}
        value={name}
        onChangeText={edit(setName)}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
      />
      <DateField label="Data de nascimento" hint="Opcional." value={birthDate} onChangeText={edit(setBirthDate)} />
      <TextField
        label="Telefone"
        hint="Opcional. Com o DDD."
        placeholder="(83) 99999-9999"
        value={phone}
        onChangeText={edit((text: string) => setPhone(maskPhone(text, phone)))}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
      />
      <Text variant="small">{PROFILE_PRIVACY}</Text>
      <Button title="Salvar" icon="content-save-outline" loading={save.isPending} disabled={!changed} onPress={submit} />
      {done && !changed ? (
        <Row>
          <Icon name="check-circle-outline" size={18} color="primary" />
          <Text variant="small" color="primary">
            Perfil salvo.
          </Text>
        </Row>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
});

import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native';

import { useIsAppAdmin } from '@/data/appDashboard';
import { useSendAppFeedback } from '@/data/appFeedback';
import { useSignOutQuestion } from '@/data/household';
import { useMyProfile, useSaveProfile, type MyProfile } from '@/data/profile';
import { useIsModerator } from '@/data/storeModeration';
import { APP_DASHBOARD_TITLE } from '@/domain/appDashboard';
import {
  FEEDBACK_DISCLOSURE,
  FEEDBACK_FORM_INTRO,
  FEEDBACK_FORM_KIND_LABEL,
  FEEDBACK_FORM_LABEL,
  FEEDBACK_FORM_PLACEHOLDER,
  FEEDBACK_FORM_SEND,
  FEEDBACK_FORM_TITLE,
  FEEDBACK_KIND_LABELS,
  FEEDBACK_KINDS,
  FEEDBACK_SENT,
  feedbackCounter,
  feedbackLimitNotice,
  readFeedbackDraft,
  type FeedbackKind,
} from '@/domain/appFeedback';
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
  Chip,
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
 * aparelho (ui/ThemeChoiceProvider). Mandar recado: um recado escrito pela própria pessoa, que vai direto para quem
 * faz o Kotii, sem IA no meio (o mesmo send_app_feedback do cartão do Nuke, data/appFeedback). Painel, só para
 * quem mantém o app, e Moderação, só para quem modera: os nomes padrão dos mercados. Conta: os termos, sair e
 * apagar a conta, que antes ficavam na aba Família.
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

      <Section title={FEEDBACK_FORM_TITLE}>
        <FeedbackForm />
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

/** O id da dica do campo do recado (o contador, ou por que "Enviar" está parado), para o navegador ligá-la a ele. */
const FEEDBACK_HINT_ID = 'feedback-hint';

/**
 * O recado escrito pela pessoa: o tipo (nenhum marcado; sem escolha vai como "outro"), o texto e "Enviar". O
 * rascunho fica só no estado desta tela: não vai para o aparelho nem para o cache. Um toque, um pedido; deu certo,
 * o campo e o tipo se limpam e a confirmação fica até a pessoa escrever de novo. O erro é avisado pelo hook.
 */
function FeedbackForm() {
  const send = useSendAppFeedback();
  const [kind, setKind] = useState<FeedbackKind | null>(null);
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  // Dois toques rápidos mandam um pedido só.
  const sending = useRef(false);

  const draft = readFeedbackDraft(kind, text);
  const counter = feedbackCounter(text);
  const limitNotice = feedbackLimitNotice(text);
  const busy = send.isPending;

  // O limite chega ao leitor de tela quando muda de estado (perto, passou, voltou), não a cada tecla: a dica do campo
  // só é lida quando o foco chega nele, e "Enviar" esmaecido sozinho não diz por quê. No aparelho, pelo anúncio; no
  // navegador (onde o anúncio não faz nada), pela região aria-live escondida embaixo do campo.
  const lastNotice = useRef<string | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web' && limitNotice && limitNotice !== lastNotice.current) {
      AccessibilityInfo.announceForAccessibility(limitNotice);
    }
    lastNotice.current = limitNotice;
  }, [limitNotice]);

  function submit() {
    if (sending.current || send.isPending || !draft.ok) return;
    sending.current = true;
    send.mutate(
      { kind: draft.kind, message: draft.message },
      {
        onSuccess: () => {
          setText('');
          setKind(null);
          setSent(true);
          // O campo esvazia: sem o anúncio, quem usa leitor de tela não sabe que foi. No navegador esta chamada
          // não faz nada (react-native-web 0.21): lá, quem fala é a região aria-live da confirmação.
          AccessibilityInfo.announceForAccessibility(FEEDBACK_SENT);
        },
        onSettled: () => {
          sending.current = false;
        },
      },
    );
  }

  return (
    <Card style={styles.card}>
      <Text variant="body">{FEEDBACK_FORM_INTRO}</Text>
      <Text variant="label">{FEEDBACK_FORM_KIND_LABEL}</Text>
      <View style={styles.chips}>
        {FEEDBACK_KINDS.map((option) => (
          <Chip
            key={option}
            label={FEEDBACK_KIND_LABELS[option]}
            selected={kind === option}
            toggle
            // Enquanto vai, o tipo fica como saiu.
            disabled={busy}
            // De novo no marcado, desmarca: sem tipo, o recado vai como "outro".
            onPress={() => setKind((before) => (before === option ? null : option))}
          />
        ))}
      </View>
      <TextField
        label={FEEDBACK_FORM_LABEL}
        placeholder={FEEDBACK_FORM_PLACEHOLDER}
        value={text}
        onChangeText={(value) => {
          setText(value);
          setSent(false);
        }}
        // Enquanto vai, o texto fica como saiu: o que se escrevesse agora sumiria com a limpeza do fim.
        editable={!busy}
        multiline
        autoCapitalize="sentences"
        // O rótulo e a dica desenhados não ficam ligados ao campo: o leitor de tela lê o nome e o contador (ou por
        // que "Enviar" está parado) com o campo, daqui no aparelho e pelo hintId (aria-describedby) no navegador.
        // Quando o limite muda de estado enquanto se escreve, quem avisa é o efeito acima.
        accessibilityLabel={FEEDBACK_FORM_LABEL}
        accessibilityHint={counter?.text}
        hint={counter?.text}
        hintColor={counter?.over ? 'danger' : undefined}
        hintId={FEEDBACK_HINT_ID}
      />
      {Platform.OS === 'web' ? (
        <View aria-live="polite" style={styles.offscreen} testID="feedback-limit-region">
          {limitNotice ? <Text variant="small">{limitNotice}</Text> : null}
        </View>
      ) : null}
      <Text variant="small">{FEEDBACK_DISCLOSURE}</Text>
      <View>
        <Button title={FEEDBACK_FORM_SEND} icon="send-outline" loading={busy} disabled={!draft.ok} onPress={submit} />
        {/* No navegador, a região aria-live fica sempre na página e só o que tem dentro muda: uma região que já
            entra com o texto quase nunca é lida (o VoiceOver do Safari fica quieto). No aparelho quem fala é o
            announceForAccessibility, sem região, para não ler duas vezes. */}
        <View aria-live={Platform.OS === 'web' ? 'polite' : undefined} testID="feedback-sent-region">
          {sent ? (
            <View style={styles.sent}>
              <Icon name="check-circle-outline" size={18} color="primary" />
              <Text variant="small" color="primary">
                {FEEDBACK_SENT}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  sent: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md },
  // Só para o leitor de tela: o que se vê é a dica do campo.
  offscreen: { position: 'absolute', width: 1, height: 1, overflow: 'hidden' },
});

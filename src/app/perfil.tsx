import { useRef, useState } from 'react';
import { StyleSheet } from 'react-native';

import { useMyProfile, useSaveProfile, type MyProfile } from '@/data/profile';
import { formatBRDate, todayISO } from '@/domain/dates';
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
import { useAuth, useHousehold } from '@/lib/auth';
import { notify } from '@/ui/dialogs';
import { Button, Card, DateField, ErrorNotice, Icon, Loading, Row, Screen, Text, TextField } from '@/ui/primitives';
import { space } from '@/ui/theme';

/**
 * O perfil (de Configurações → Você): o nome, que vale em todas as casas da pessoa, a data de nascimento e o
 * telefone, que só ela vê (data/profile), e o e-mail da conta, só para ler.
 */
export default function ProfileScreen() {
  const { session } = useAuth();
  const household = useHousehold();
  const email = session?.user.email;
  return (
    <Screen edges={[]}>
      <ProfileSection name={household.data?.me.display_name ?? ''} />
      {email ? (
        <Card style={styles.card}>
          <Text variant="label">E-mail da conta</Text>
          <Text variant="body" selectable>
            {email}
          </Text>
        </Card>
      ) : null}
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

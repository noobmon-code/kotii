import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAddHousehold } from '@/data/household';
import { PLACE_NOT_SAVED_TITLE, placeNotSavedMessage } from '@/domain/housePlace';
import {
  CHOICE_INVITE,
  CHOICE_NEW,
  CHOICE_TITLE,
  CODE_HINT,
  CODE_JOIN,
  CODE_NOTHING_TO_PASTE,
  CODE_PASTE,
  CODE_TITLE,
  HOUSE_CREATE,
  HOUSE_PLACE_ROW,
  HOUSE_PLACEHOLDER,
  HOUSE_TITLE,
  inviteCodeFrom,
  NAME_HINT,
  NAME_TITLE,
  readDisplayName,
  readHouseName,
  readInviteCode,
  typedInviteCode,
} from '@/domain/onboarding';
import { HousePlacePicker, useNewHousePlace } from '@/features/HousePlacePicker';
import { useAuth } from '@/lib/auth';
import { clearPendingInvite, setOnboardingNext } from '@/lib/onboarding';
import { errorMessage } from '@/lib/supabase';
import { notify } from '@/ui/dialogs';
import { FeatureCard } from '@/ui/FeatureCard';
import { Button, Icon, IconBadge, ListCard, ListRow, TextField } from '@/ui/primitives';
import { space } from '@/ui/theme';

import { OnboardingHero } from './OnboardingHero';

type Step = 'nome' | 'escolha' | 'casa' | 'codigo';

/**
 * O começo depois da conta, sem casa ainda: o nome (uma pergunta só), "Alguém da sua casa já usa o Kotii?" e então o
 * nome da casa (com o lugar fechado numa linha, porque é opcional) ou o código do convite. Quem chegou por um link de
 * convite pula a pergunta: o código já vem preenchido. Entrar com o código é direto, sem esperar ninguém, e nada da
 * casa aparece antes (domain/onboarding).
 *
 * A casa nasce pelo mesmo caminho de "Suas casas" (useAddHousehold: cria ou entra e já abre nela) e deixa o passo
 * seguinte para a tela Hoje (lib/onboarding): a primeira lista, para quem criou; "Você entrou na casa!", para quem
 * entrou. Na prévia (`preview`), a pessoa já tem casa: a nova abre por cima das outras e a prévia vai para a Hoje.
 */
export function HouseSetupFlow({
  preview = false,
  pendingInvite,
  footer,
}: {
  preview?: boolean;
  /** O código de um link de convite, que espera a pessoa entrar na casa. */
  pendingInvite: string | null;
  /** Embaixo dos dois primeiros passos: sair da conta, apagar a conta (a tela de boas-vindas de verdade). */
  footer?: ReactNode;
}) {
  const userId = useAuth().session?.user.id;
  const add = useAddHousehold(userId);
  const [step, setStep] = useState<Step>('nome');
  const [displayName, setDisplayName] = useState('');
  const [houseName, setHouseName] = useState('');
  const [code, setCode] = useState('');
  const [placeOpen, setPlaceOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  // Onde fica a casa (opcional, só ao criar): salvo nela depois de ela existir.
  const newPlace = useNewHousePlace(step === 'casa');
  // Dois toques rápidos (ou o Enter do campo junto com o botão) criam uma casa só.
  const sending = useRef(false);
  const searching = step === 'casa' && newPlace.search.searching !== null;
  const busy = add.isPending || newPlace.resolving;

  function nameDone() {
    const name = readDisplayName(displayName);
    if (!name.ok) {
      notify(name.title, name.message);
      return;
    }
    if (pendingInvite) {
      setCode(pendingInvite);
      setStep('codigo');
    } else setStep('escolha');
  }

  async function create() {
    if (sending.current || busy || searching) return;
    const name = readDisplayName(displayName);
    const house = readHouseName(houseName);
    if (!name.ok) return notify(name.title, name.message);
    if (!house.ok) return notify(house.title, house.message);
    sending.current = true;
    try {
      // Um CEP digitado e ainda não buscado é buscado antes: sem ele achado, nada é criado.
      const where = await newPlace.resolve();
      if (!where.ok) return;
      const added = await add.mutateAsync({ mode: 'criar', name: house.value, displayName: name.value, place: where.place });
      setOnboardingNext(added.house.id, 'lista');
      if (preview) router.replace('/');
      if (added.placeNotSaved) notify(PLACE_NOT_SAVED_TITLE, placeNotSavedMessage(added.placeNotSaved));
    } catch (err) {
      notify('Não foi possível criar a casa', errorMessage(err));
    } finally {
      sending.current = false;
    }
  }

  async function join() {
    if (sending.current || busy) return;
    const name = readDisplayName(displayName);
    const typed = readInviteCode(code);
    if (!name.ok) return notify(name.title, name.message);
    if (!typed.ok) return notify(typed.title, typed.message);
    sending.current = true;
    setFailed(false);
    try {
      const added = await add.mutateAsync({ mode: 'entrar', code: typed.value, displayName: name.value });
      clearPendingInvite();
      setOnboardingNext(added.house.id, 'entrou');
      if (preview) router.replace('/');
    } catch (err) {
      setFailed(true);
      notify('Não deu para entrar na casa', errorMessage(err));
    } finally {
      sending.current = false;
    }
  }

  async function paste() {
    const text = await Clipboard.getStringAsync().catch(() => '');
    const found = inviteCodeFrom(text);
    if (found) setCode(found);
    else notify(CODE_PASTE, CODE_NOTHING_TO_PASTE);
  }

  if (step === 'nome') {
    return (
      <View style={styles.step}>
        <OnboardingHero mood="talk" title={NAME_TITLE} text={NAME_HINT} />
        <TextField
          label="Seu nome"
          value={displayName}
          onChangeText={setDisplayName}
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          autoFocus
          onSubmitEditing={nameDone}
        />
        <Button title="Continuar" onPress={nameDone} />
        {footer}
      </View>
    );
  }

  if (step === 'escolha') {
    return (
      <View style={styles.step}>
        <OnboardingHero title={CHOICE_TITLE} />
        <FeatureCard gradient="pessego" title={CHOICE_NEW.title} subtitle={CHOICE_NEW.subtitle} onPress={() => setStep('casa')} />
        <FeatureCard gradient="caramelo" title={CHOICE_INVITE.title} subtitle={CHOICE_INVITE.subtitle} onPress={() => setStep('codigo')} />
        <Button title="Voltar" variant="ghost" compact onPress={() => setStep('nome')} />
        {footer}
      </View>
    );
  }

  if (step === 'casa') {
    return (
      <View style={styles.step}>
        <OnboardingHero size={88} title={HOUSE_TITLE} />
        <TextField
          label="Nome da casa"
          value={houseName}
          onChangeText={setHouseName}
          placeholder={HOUSE_PLACEHOLDER}
          editable={!busy}
          autoFocus
        />
        {/* O lugar é opcional: fica numa linha, e só abre (com o CEP e a localização) se a pessoa quiser. Achado um
            lugar, a parte fica aberta para mostrá-lo. */}
        {placeOpen || newPlace.place ? (
          <HousePlacePicker place={newPlace.place} search={newPlace.search} onRemove={newPlace.remove} disabled={busy} />
        ) : (
          <ListCard>
            <ListRow
              left={<IconBadge icon="map-marker-outline" tone="neutral" />}
              title={HOUSE_PLACE_ROW.title}
              subtitle={HOUSE_PLACE_ROW.subtitle}
              right={<Icon name="chevron-down" color="textMuted" />}
              onPress={() => setPlaceOpen(true)}
            />
          </ListCard>
        )}
        <Button title={HOUSE_CREATE} icon="home-plus-outline" onPress={() => void create()} loading={busy} disabled={searching} />
        <Button title="Voltar" variant="ghost" compact disabled={busy} onPress={() => setStep('escolha')} />
      </View>
    );
  }

  return (
    <View style={styles.step}>
      <OnboardingHero size={88} mood={failed ? 'oops' : 'idle'} title={CODE_TITLE} text={CODE_HINT} />
      <TextField
        label="Código de convite"
        value={code}
        onChangeText={(text) => {
          setFailed(false);
          setCode(typedInviteCode(text));
        }}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="ABC234"
        editable={!busy}
        autoFocus={!pendingInvite}
        onSubmitEditing={() => void join()}
      />
      <Button title={CODE_PASTE} icon="content-paste" variant="secondary" compact disabled={busy} onPress={() => void paste()} />
      <Button title={CODE_JOIN} icon="login" onPress={() => void join()} loading={busy} />
      <Button title="Voltar" variant="ghost" compact disabled={busy} onPress={() => setStep('escolha')} />
    </View>
  );
}

const styles = StyleSheet.create({
  step: { gap: space.lg },
});

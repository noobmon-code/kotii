import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet } from 'react-native';

import { useAddHousehold, useSwitchHousehold } from '@/data/household';
import { PLACE_NOT_SAVED_TITLE, placeNotSavedMessage } from '@/domain/housePlace';
import { HousePlacePicker, useNewHousePlace } from '@/features/HousePlacePicker';
import { useAuth, useHousehold } from '@/lib/auth';
import { FEATURES } from '@/lib/features';
import { errorMessage } from '@/lib/supabase';
import { notify } from '@/ui/dialogs';
import { Badge, Button, Card, IconBadge, ListCard, ListRow, Loading, Screen, Section, Segmented, Text, TextField } from '@/ui/primitives';
import { space } from '@/ui/theme';

/** Até quantas casas uma conta participa (o banco confere: max_households_per_user). */
const MAX_HOUSEHOLDS = 5;

type Mode = 'criar' | 'entrar';

/**
 * As casas da pessoa: qual está aberta neste celular, trocar de casa e criar
 * ou entrar em outra. Cada casa tem os próprios moradores, listas e contas.
 */
export default function HouseholdsScreen() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const household = useHousehold();
  const switchTo = useSwitchHousehold(userId);
  const add = useAddHousehold(userId);
  const [mode, setMode] = useState<Mode>('criar');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState<string | null>(null);
  // Onde fica a casa nova (opcional, só ao criar): salvo nela depois de ela existir.
  const newPlace = useNewHousePlace(mode === 'criar');
  // Dois toques rápidos (ou o Enter do CEP junto com o botão) criam uma casa só.
  const sending = useRef(false);

  if (!household.data) return <Loading />;
  const { household: open, households, me } = household.data;
  const full = households.length >= MAX_HOUSEHOLDS;
  // A busca do bairro só segura o criar: entrar com um código e abrir outra casa não dependem dela (o seletor pode ir
  // para "Tenho um código" com ela em andamento, sem nada na tela que a mostre).
  const searching = mode === 'criar' && newPlace.search.searching !== null;
  // O envio: a busca do CEP do toque de criar e depois o pedido. O toque já leu os campos, então eles ficam travados.
  const submitting = add.isPending || newPlace.resolving;
  const busy = switchTo.isPending || submitting;
  const yourName = displayName ?? me.display_name;

  function choose(id: string) {
    if (id === open.id || busy) return;
    switchTo.mutate(id, {
      onSuccess: () => router.replace('/'),
      onError: (err) => notify('Não deu para trocar de casa', errorMessage(err)),
    });
  }

  async function submit() {
    if (sending.current || busy || searching) return;
    if (!yourName.trim()) {
      notify('Como você quer ser chamado?', 'Informe seu nome para a família te reconhecer.');
      return;
    }
    if (mode === 'criar' && !name.trim()) {
      notify('Dê um nome para a casa', 'Ex.: "Casa da praia" ou "Apartamento da mãe".');
      return;
    }
    if (mode === 'entrar' && code.trim().length < 6) {
      notify('Código inválido', 'O código de convite tem 6 caracteres.');
      return;
    }
    sending.current = true;
    try {
      // Um CEP digitado e ainda não buscado é buscado antes: sem ele achado, nada é criado.
      const where = mode === 'criar' ? await newPlace.resolve() : ({ ok: true, place: null } as const);
      if (!where.ok) return;
      const added = await add.mutateAsync(
        mode === 'criar'
          ? { mode, name: name.trim(), displayName: yourName.trim(), place: where.place }
          : { mode, code: code.trim(), displayName: yourName.trim() },
      );
      router.replace('/');
      if (added.placeNotSaved) notify(PLACE_NOT_SAVED_TITLE, placeNotSavedMessage(added.placeNotSaved));
    } catch (err) {
      notify('Não foi possível continuar', errorMessage(err));
    } finally {
      sending.current = false;
    }
  }

  return (
    <Screen>
      <Section title="Suas casas">
        <Text variant="muted">
          {/* As contas são de Finanças: sem ela (lib/features), a frase não as cita. */}
          {`Cada casa tem os próprios moradores, listas${FEATURES.finance ? ', contas' : ''} e tarefas. O celular mostra uma por vez; os avisos chegam de todas.`}
        </Text>
        <ListCard>
          {households.map((h) => (
            <ListRow
              key={h.id}
              left={<IconBadge icon={h.id === open.id ? 'home' : 'home-outline'} tone={h.id === open.id ? 'primary' : 'neutral'} />}
              title={h.name}
              subtitle={h.role === 'owner' ? 'Você é responsável' : undefined}
              right={h.id === open.id ? <Badge label="Aberta" tone="primary" /> : <Text variant="label" color="primary">Abrir</Text>}
              onPress={h.id === open.id || busy ? undefined : () => choose(h.id)}
            />
          ))}
        </ListCard>
        {switchTo.isPending ? <Loading label="Abrindo a casa" /> : null}
      </Section>

      <Section title="Outra casa">
        {full ? (
          <Card>
            <Text variant="muted">Uma conta pode estar em até {MAX_HOUSEHOLDS} casas. Para criar ou entrar em outra, saia de uma delas.</Text>
          </Card>
        ) : (
          <>
            <Segmented
              value={mode}
              // Durante o envio, o toque já decidiu entre criar e entrar.
              onChange={(next) => (sending.current ? undefined : setMode(next))}
              options={[
                { value: 'criar', label: 'Criar casa' },
                { value: 'entrar', label: 'Tenho um código' },
              ]}
            />
            <Card style={styles.form}>
              {mode === 'criar' ? (
                <TextField label="Nome da casa" value={name} onChangeText={setName} placeholder="Casa da praia" editable={!submitting} />
              ) : (
                <TextField
                  label="Código de convite"
                  value={code}
                  onChangeText={(t) => setCode(t.toUpperCase())}
                  autoCapitalize="characters"
                  maxLength={6}
                  placeholder="ABC234"
                  editable={!submitting}
                />
              )}
              <TextField
                label="Seu nome"
                value={yourName}
                onChangeText={setDisplayName}
                autoCapitalize="words"
                editable={!submitting}
              />
              {mode === 'criar' ? (
                <HousePlacePicker
                  place={newPlace.place}
                  search={newPlace.search}
                  onRemove={newPlace.remove}
                  disabled={switchTo.isPending || submitting}
                />
              ) : null}
              <Button
                title={mode === 'criar' ? 'Criar e abrir' : 'Entrar e abrir'}
                icon={mode === 'criar' ? 'home-plus-outline' : 'login'}
                loading={submitting}
                disabled={busy || searching}
                onPress={submit}
              />
            </Card>
          </>
        )}
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: space.md },
});

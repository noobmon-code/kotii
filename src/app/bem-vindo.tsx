import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { householdErrorMessage, INVITE_NOT_FOUND, savePlaceOfNewHouse } from '@/data/household';
import { PLACE_NOT_SAVED_TITLE, placeNotSavedMessage } from '@/domain/housePlace';
import { HousePlacePicker, useNewHousePlace } from '@/features/HousePlacePicker';
import { signOut } from '@/lib/auth';
import { errorMessage, supabase } from '@/lib/supabase';
import { notify } from '@/ui/dialogs';
import { NukeLive } from '@/ui/NukeLive';
import { Button, Card, Screen, Segmented, Text, TextField } from '@/ui/primitives';
import { space } from '@/ui/theme';

type Mode = 'criar' | 'entrar';

export default function WelcomeScreen() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>('criar');
  const [displayName, setDisplayName] = useState('');
  const [householdName, setHouseholdName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  // Onde fica a casa (opcional, só ao criar): salvo nela depois de ela existir.
  const newPlace = useNewHousePlace(mode === 'criar');
  // Dois toques rápidos (ou o Enter do CEP junto com o botão) criam uma casa só.
  const sending = useRef(false);
  // A busca do bairro só segura o criar: entrar com um código não depende dela (e o seletor pode ir para "Tenho um
  // código" com ela em andamento, sem nada na tela que a mostre).
  const searching = mode === 'criar' && newPlace.search.searching !== null;

  async function submit() {
    if (sending.current || busy || searching) return;
    if (!displayName.trim()) {
      notify('Como você quer ser chamado?', 'Informe seu nome para a família te reconhecer.');
      return;
    }
    if (mode === 'criar' && !householdName.trim()) {
      notify('Dê um nome para a casa', 'Ex.: "Casa da Ana e do Beto".');
      return;
    }
    if (mode === 'entrar' && code.trim().length < 6) {
      notify('Código inválido', 'O código de convite tem 6 caracteres.');
      return;
    }
    sending.current = true;
    setBusy(true);
    try {
      // Um CEP digitado e ainda não buscado é buscado antes: sem ele achado, nada é criado.
      const where = mode === 'criar' ? await newPlace.resolve() : ({ ok: true, place: null } as const);
      if (!where.ok) return;
      const { data, error } =
        mode === 'criar'
          ? await supabase.rpc('create_household', { p_name: householdName, p_display_name: displayName })
          : await supabase.rpc('join_household', { p_invite_code: code, p_display_name: displayName });
      if (error) throw new Error(householdErrorMessage(error));
      // Código errado: o banco devolve uma casa vazia (e conta a tentativa) em
      // vez de erro. O PostgREST manda o registro nulo como objeto com campos nulos.
      const houseId = (data as { id?: string | null } | null)?.id;
      if (!houseId) throw new Error(INVITE_NOT_FOUND);
      // O lugar vai antes de buscar a casa de novo: com ela, esta tela sai (a guarda do _layout), e o pedido leva o id
      // da casa nova, que ainda não é a aberta neste aparelho. Se a tela sair antes (a casa buscada de novo por conta
      // própria), o pedido segue e o aviso também.
      const placeNotSaved = where.place ? await savePlaceOfNewHouse(queryClient, houseId, where.place) : null;
      await queryClient.invalidateQueries({ queryKey: ['household'] });
      if (placeNotSaved) notify(PLACE_NOT_SAVED_TITLE, placeNotSavedMessage(placeNotSaved));
    } catch (err) {
      notify('Não foi possível continuar', errorMessage(err));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    // O CEP fica embaixo do formulário: no iOS, o teclado numérico o cobriria (como em entrar e nova-senha).
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen edges={['top', 'bottom']}>
        <View style={styles.hero}>
          <NukeLive size={132} hop />
          <Text variant="title">Sua casa</Text>
          <Text variant="muted" style={styles.center}>
            Tudo no Kotii é compartilhado com quem mora com você. Crie a casa ou entre com o código de convite.
          </Text>
        </View>
        <Segmented
          value={mode}
          // Durante o envio (a busca do CEP no toque de criar pode demorar), o toque já decidiu entre criar e entrar.
          onChange={(next) => (sending.current ? undefined : setMode(next))}
          options={[
            { value: 'criar', label: 'Criar casa' },
            { value: 'entrar', label: 'Tenho um código' },
          ]}
        />
        <Card style={styles.form}>
          <TextField label="Seu nome" value={displayName} onChangeText={setDisplayName} autoCapitalize="words" editable={!busy} />
          {mode === 'criar' ? (
            <TextField
              label="Nome da casa"
              value={householdName}
              onChangeText={setHouseholdName}
              placeholder="Casa da família Silva"
              editable={!busy}
            />
          ) : (
            <TextField
              label="Código de convite"
              value={code}
              onChangeText={(v) => setCode(v.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={6}
              placeholder="ABC123"
              editable={!busy}
            />
          )}
          {mode === 'criar' ? (
            <HousePlacePicker place={newPlace.place} search={newPlace.search} onRemove={newPlace.remove} disabled={busy} />
          ) : null}
          <Button
            title={mode === 'criar' ? 'Criar casa' : 'Entrar na casa'}
            onPress={submit}
            loading={busy}
            disabled={searching}
          />
        </Card>
        <Button title="Sair" variant="ghost" onPress={() => signOut()} />
        <Button title="Apagar minha conta" variant="ghost" compact onPress={() => router.push('/apagar-conta')} />
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  hero: { alignItems: 'center', gap: space.md, paddingTop: space.xl },
  form: { gap: space.lg },
});

import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { useAddHousehold, useSwitchHousehold } from '@/data/household';
import { useAuth, useHousehold } from '@/lib/auth';
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

  if (!household.data) return <Loading />;
  const { household: open, households, me } = household.data;
  const full = households.length >= MAX_HOUSEHOLDS;
  const busy = switchTo.isPending || add.isPending;
  const yourName = displayName ?? me.display_name;

  function choose(id: string) {
    if (id === open.id || busy) return;
    switchTo.mutate(id, {
      onSuccess: () => router.replace('/'),
      onError: (err) => notify('Não deu para trocar de casa', errorMessage(err)),
    });
  }

  function submit() {
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
    add.mutate(
      mode === 'criar'
        ? { mode, name: name.trim(), displayName: yourName.trim() }
        : { mode, code: code.trim(), displayName: yourName.trim() },
      {
        onSuccess: () => router.replace('/'),
        onError: (err) => notify('Não foi possível continuar', errorMessage(err)),
      },
    );
  }

  return (
    <Screen>
      <Section title="Suas casas">
        <Text variant="muted">
          Cada casa tem os próprios moradores, listas, contas e tarefas. O celular mostra uma por vez; os avisos chegam de todas.
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
              onChange={setMode}
              options={[
                { value: 'criar', label: 'Criar casa' },
                { value: 'entrar', label: 'Tenho um código' },
              ]}
            />
            <Card style={styles.form}>
              {mode === 'criar' ? (
                <TextField label="Nome da casa" value={name} onChangeText={setName} placeholder="Casa da praia" />
              ) : (
                <TextField
                  label="Código de convite"
                  value={code}
                  onChangeText={(t) => setCode(t.toUpperCase())}
                  autoCapitalize="characters"
                  maxLength={6}
                  placeholder="ABC234"
                />
              )}
              <TextField
                label="Seu nome nesta casa"
                value={yourName}
                onChangeText={setDisplayName}
                autoCapitalize="words"
              />
              <Button
                title={mode === 'criar' ? 'Criar e abrir' : 'Entrar e abrir'}
                icon={mode === 'criar' ? 'home-plus-outline' : 'login'}
                loading={add.isPending}
                disabled={busy}
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

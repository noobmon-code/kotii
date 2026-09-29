import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  findPlaceByCep,
  findPlaceByDevice,
  useClearHouseholdLocation,
  useSaveHouseholdLocation,
  type HouseholdLocation,
} from '@/data/weather';
import { addDays, todayISO } from '@/domain/dates';
import { daySummary, describeSummary, maskCep, normalizeCep, type WeatherTip } from '@/domain/weather';
import { useHouseWeather } from '@/features/useHouseWeather';
import { remindersSupported } from '@/lib/reminders';
import { errorMessage } from '@/lib/supabase';
import { confirmAction, notify } from '@/ui/dialogs';
import { Button, Card, ErrorNotice, IconBadge, ListCard, ListRow, Loading, Screen, Section, Text, TextField } from '@/ui/primitives';
import { space } from '@/ui/theme';

/** Clima da casa: onde ela fica (o bairro) e as dicas de hoje e de amanhã. */
export default function WeatherScreen() {
  const now = new Date();
  const today = todayISO(now);
  const { location, forecast, tipsFor } = useHouseWeather(today);
  const save = useSaveHouseholdLocation();
  const clear = useClearHouseholdLocation();
  const [cep, setCep] = useState('');
  const [searching, setSearching] = useState<'cep' | 'gps' | null>(null);

  async function place(source: 'cep' | 'gps') {
    const digits = normalizeCep(cep);
    if (source === 'cep' && !digits) {
      notify('CEP incompleto', 'Digite os 8 números do CEP.');
      return;
    }
    setSearching(source);
    try {
      const found: HouseholdLocation = source === 'cep' ? await findPlaceByCep(digits!) : await findPlaceByDevice();
      await save.mutateAsync(found);
      setCep('');
    } catch (err) {
      notify('Não foi possível definir o bairro', errorMessage(err));
    } finally {
      setSearching(null);
    }
  }

  const days = [
    { date: today, fromHour: now.getHours(), dayWord: 'Hoje' },
    { date: addDays(today, 1), fromHour: 7, dayWord: 'Amanhã' },
  ];

  return (
    <Screen refreshing={forecast.isRefetching} onRefresh={() => forecast.refetch()}>
      <Section title="Onde fica a casa">
        <Card style={styles.card}>
          {location.isPending ? (
            <Loading />
          ) : location.data ? (
            <View style={styles.gap}>
              <Text variant="heading">{location.data.label}</Text>
              <Text variant="small">{location.data.source === 'gps' ? 'Pela localização do celular' : 'Pelo CEP'}</Text>
            </View>
          ) : (
            <Text variant="muted">Diga onde fica a casa para receber dicas do tempo do seu bairro: dia de lavar roupa, chuva chegando, calor, frio.</Text>
          )}
          <TextField
            label={location.data ? 'Mudar pelo CEP' : 'CEP'}
            value={cep}
            onChangeText={(text) => setCep(maskCep(text))}
            placeholder="00000-000"
            keyboardType="number-pad"
            maxLength={9}
            onSubmitEditing={() => place('cep')}
          />
          <Button title="Buscar pelo CEP" icon="magnify" loading={searching === 'cep'} disabled={searching !== null} onPress={() => place('cep')} />
          <Button
            title="Usar a localização do celular"
            icon="crosshairs-gps"
            variant="secondary"
            loading={searching === 'gps'}
            disabled={searching !== null}
            onPress={() => place('gps')}
          />
          <Text variant="small">
            Fica guardado só o bairro (um ponto com cerca de 1 km de precisão), não o endereço. Vale para toda a casa.
          </Text>
          {location.data ? (
            <Button
              title="Tirar o local"
              variant="ghost"
              compact
              disabled={clear.isPending}
              onPress={() =>
                confirmAction('Tirar o local', 'Sem o bairro, a casa fica sem as dicas do clima.', 'Tirar', () =>
                  clear.mutate(undefined, { onError: (err) => notify('Erro', errorMessage(err)) }),
                )
              }
            />
          ) : null}
        </Card>
      </Section>

      {location.data && forecast.isPending ? <Loading label="Buscando a previsão" /> : null}
      {location.data && forecast.error && !forecast.data ? <ErrorNotice error={forecast.error} onRetry={() => forecast.refetch()} /> : null}

      {location.data && forecast.data
        ? days.map((day) => {
            const summary = daySummary(forecast.data, day.date);
            return (
              <Section key={day.date} title={day.dayWord}>
                {summary ? <Text variant="muted">{describeSummary(summary)}</Text> : null}
                <TipList tips={tipsFor(day)} />
              </Section>
            );
          })
        : null}

      {location.data ? (
        <Card style={styles.card}>
          <Text variant="label">Dica por notificação</Text>
          {remindersSupported ? (
            <>
              <Text variant="muted">
                Às 7h, quando o tempo pede algo. Cada pessoa liga no próprio celular, em Família, “Avisos neste celular”.
              </Text>
              <Button title="Abrir os avisos" icon="bell-outline" variant="secondary" compact onPress={() => router.push('/familia')} />
            </>
          ) : (
            <Text variant="muted">O aviso das 7h funciona no app instalado no celular. Aqui, as dicas aparecem na tela Hoje.</Text>
          )}
        </Card>
      ) : null}

      <Text variant="small" style={styles.credits}>
        Previsão: Open-Meteo. Bairros: © colaboradores do OpenStreetMap. CEP: ViaCEP.
      </Text>
    </Screen>
  );
}

function TipList({ tips }: { tips: WeatherTip[] }) {
  if (!tips.length) {
    return (
      <Card>
        <Text variant="muted">Nada de especial no tempo.</Text>
      </Card>
    );
  }
  return (
    <ListCard>
      {tips.map((tip) => (
        <ListRow key={tip.key} left={<IconBadge icon={tip.icon} tone="info" />} title={tip.title} subtitle={tip.body} />
      ))}
    </ListCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  gap: { gap: space.xs },
  credits: { textAlign: 'center' },
});

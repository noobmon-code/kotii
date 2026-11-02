import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useClearHouseholdLocation, useRefreshWeather, useSaveHouseholdLocation } from '@/data/weather';
import { addDays, todayISO } from '@/domain/dates';
import { cepFieldLabel, HOUSE_PLACE_CLIMA_INTRO, HOUSE_PLACE_REMOVE, housePlaceHouseLine, openHouseName, placeSourceLabel } from '@/domain/housePlace';
import { daySummary, describeSummary, houseClock, type WeatherTip } from '@/domain/weather';
import { PlaceSearchFields, usePlaceSearch } from '@/features/HousePlacePicker';
import { useHouseWeather } from '@/features/useHouseWeather';
import { useHousehold } from '@/lib/auth';
import { REMINDER_PLACE, remindersSupported, remindersUnavailableReason } from '@/lib/reminders';
import { errorMessage } from '@/lib/supabase';
import { confirmAction, notify } from '@/ui/dialogs';
import { Button, Card, ErrorNotice, IconBadge, ListCard, ListRow, Loading, Screen, Section, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

/**
 * Clima da casa: onde ela fica (o bairro) e as dicas de hoje e de amanhã. Abre por Configurações → Clima da casa; o
 * bairro também pode ser dito ao criar a casa.
 */
export default function WeatherScreen() {
  const now = new Date();
  const today = todayISO(now);
  const { location, forecast, tipsFor } = useHouseWeather(today);
  const save = useSaveHouseholdLocation();
  const clear = useClearHouseholdLocation();
  const refreshWeather = useRefreshWeather();
  // Com mais de uma casa, a tela diz de qual é o lugar (o da casa aberta).
  const houseName = openHouseName(useHousehold().data);
  // O bairro achado vale na hora, para toda a casa (a mesma busca de quem cria uma casa, em HousePlacePicker).
  const search = usePlaceSearch((found) => save.mutateAsync(found));

  // Hoje e amanhã da casa (pelo fuso dela), e não do celular.
  const clock = forecast.data ? houseClock(forecast.data, now) : { date: today, hour: now.getHours() };
  const days = [
    { date: clock.date, fromHour: clock.hour, dayWord: 'Hoje' },
    { date: addDays(clock.date, 1), fromHour: 7, dayWord: 'Amanhã' },
  ];

  return (
    <Screen refreshing={location.isRefetching || forecast.isRefetching} onRefresh={refreshWeather}>
      <Section title="Onde fica a casa">
        <Card style={styles.card}>
          {houseName ? <Text variant="small">{housePlaceHouseLine(houseName)}</Text> : null}
          {location.isPending ? (
            <Loading />
          ) : location.data ? (
            <View style={styles.gap}>
              <Text variant="heading">{location.data.label}</Text>
              <Text variant="small">{placeSourceLabel(location.data.source)}</Text>
            </View>
          ) : (
            <Text variant="muted">{HOUSE_PLACE_CLIMA_INTRO}</Text>
          )}
          <PlaceSearchFields search={search} label={cepFieldLabel(Boolean(location.data))} />
          {location.data ? (
            <Button
              title={HOUSE_PLACE_REMOVE}
              variant="ghost"
              compact
              disabled={clear.isPending}
              onPress={() =>
                confirmAction(HOUSE_PLACE_REMOVE, 'Sem o bairro, a casa fica sem as dicas do clima.', 'Tirar', () =>
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
                Às 7h, quando o tempo pede algo. Cada pessoa liga no próprio aparelho, em Família, “Avisos {REMINDER_PLACE}”.
              </Text>
              <Button title="Abrir os avisos" icon="bell-outline" variant="secondary" compact onPress={() => router.push('/familia')} />
            </>
          ) : (
            <Text variant="muted">{remindersUnavailableReason()} As dicas ficam aqui, nesta tela.</Text>
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

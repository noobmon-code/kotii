import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import { marketTripErrorMessage, useAnnounceMarketTrip, useEndMarketTrip, useMarketTrips } from '@/data/marketTrips';
import { announceResultText, canAnnounceTrip, liveTrips, TRIP_CONFIRM, tripActionLabel, tripBannerText } from '@/domain/marketTrips';
import { useAuth, useHousehold } from '@/lib/auth';
import type { ListKind } from '@/lib/types';
import { ActionSheet } from '@/ui/ActionSheet';
import { notify } from '@/ui/dialogs';
import { Button, Card, IconBadge, Row, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

/** O que a faixa e o botão usam da lista. */
interface TripList {
  id: string;
  kind: ListKind;
}

/**
 * "Estou indo ao mercado", na lista: confirma e avisa a casa (o servidor
 * manda o aviso aos navegadores dos outros e a faixa aparece para todos);
 * depois diz o que aconteceu. Sem mais ninguém na casa, não aparece.
 */
export function MarketTripAction({ list }: { list: TripList }) {
  const members = useHousehold().data?.members.length ?? 0;
  const announce = useAnnounceMarketTrip();
  const [asking, setAsking] = useState(false);
  if (!canAnnounceTrip(members)) return null;

  const label = tripActionLabel(list.kind);
  const tell = () =>
    announce.mutate(list.id, {
      // Com o relógio de agora: "já foi avisada há N min".
      onSuccess: (result) => notify(label, announceResultText(result, new Date())),
      onError: (err) => notify('Não deu para avisar a casa', marketTripErrorMessage(err)),
    });

  return (
    <>
      <Button title={label} icon="cart-arrow-right" variant="secondary" compact loading={announce.isPending} onPress={() => setAsking(true)} />
      <ActionSheet
        visible={asking}
        title={TRIP_CONFIRM.title}
        message={TRIP_CONFIRM.message}
        actions={[{ label: TRIP_CONFIRM.action, icon: 'bullhorn-outline', onPress: tell }]}
        onClose={() => setAsking(false)}
      />
    </>
  );
}

/** De quanto em quanto tempo a faixa refaz o "há 12 min" (e some quando as duas horas passam). */
const TICK_MS = 30_000;

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * A faixa de quem está indo às compras, por duas horas ou até a pessoa
 * encerrar: na tela Hoje, as idas das listas abertas, com "Abrir a lista"
 * (`openable`); na lista, só as dela (`lists` com essa lista). Quem avisou vê
 * a hora do aviso e "Encerrar". Sem resposta do servidor (sem internet, ou o
 * banco ainda sem as idas), não há faixa nem erro.
 */
export function MarketTripBanner({ lists, openable = false }: { lists: readonly TripList[] | undefined; openable?: boolean }) {
  const userId = useAuth().session?.user.id;
  const trips = useMarketTrips();
  const end = useEndMarketTrip();
  const now = useNow();

  // Outra pessoa pode ter avisado enquanto a tela estava atrás de outra ou o
  // app, fechado: confere ao voltar (a busca que já estiver no ar serve).
  const { refetch } = trips;
  useFocusEffect(
    useCallback(() => {
      void refetch({ cancelRefetch: false });
    }, [refetch]),
  );
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refetch({ cancelRefetch: false });
    });
    return () => subscription.remove();
  }, [refetch]);

  // Só das listas que a tela conhece: a ida de uma lista arquivada não aparece.
  const kinds = new Map((lists ?? []).map((list) => [list.id, list.kind]));
  const live = liveTrips(trips.data ?? [], now).filter((trip) => kinds.has(trip.list_id));
  if (!live.length) return null;

  return (
    <Card style={styles.card}>
      {live.map((trip) => {
        const mine = trip.user_id === userId;
        return (
          <View key={trip.id} style={styles.trip}>
            <Row gap={space.md}>
              <IconBadge icon="cart-arrow-right" tone="primary" />
              <Text variant="body" style={styles.flex}>
                {tripBannerText(trip, { userId, kind: kinds.get(trip.list_id) ?? 'outros', now })}
              </Text>
            </Row>
            {mine || openable ? (
              <Row style={styles.actions}>
                {mine ? (
                  <Button
                    title="Encerrar"
                    variant="ghost"
                    compact
                    loading={end.isPending && end.variables === trip.id}
                    onPress={() => end.mutate(trip.id, { onError: (err) => notify('Não deu para encerrar', marketTripErrorMessage(err)) })}
                  />
                ) : null}
                {openable ? (
                  <Button
                    title="Abrir a lista"
                    variant="ghost"
                    compact
                    onPress={() => router.push({ pathname: '/lista/[id]', params: { id: trip.list_id } })}
                  />
                ) : null}
              </Row>
            ) : null}
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  trip: { gap: space.xs },
  flex: { flex: 1 },
  actions: { justifyContent: 'flex-end' },
});

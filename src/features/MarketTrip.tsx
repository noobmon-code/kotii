import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import { marketTripErrorMessage, useAnnounceMarketTrip, useEndingMarketTrips, useEndMarketTrip, useMarketTrips } from '@/data/marketTrips';
import { announceResultText, canAnnounceTrip, liveTrips, TRIP_CONFIRM, tripActionLabel, tripBannerText, tripButtonLabels } from '@/domain/marketTrips';
import { useAuth, useHousehold } from '@/lib/auth';
import type { ListKind } from '@/lib/types';
import { ActionSheet } from '@/ui/ActionSheet';
import { notify } from '@/ui/dialogs';
import { Button, Card, IconBadge, Row, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

/** O que o botão usa da lista. */
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
  // A mesma busca da faixa (sem pedido a mais): null é o banco dizendo que ainda não tem as idas.
  const notDeployed = useMarketTrips().data === null;
  const announce = useAnnounceMarketTrip();
  const [asking, setAsking] = useState(false);
  if (!canAnnounceTrip(members)) return null;
  // Antes da migração o botão só poderia falhar: não aparece. Enquanto a busca
  // não respondeu, sem internet ou com outro erro, ele fica (não some nem pisca).
  if (notDeployed) return null;

  const label = tripActionLabel(list.kind);
  // A resposta é esperada aqui, e não nas opções do mutate (que só valem com a tela aberta): quem volta para as
  // listas com o pedido no ar fica sabendo do resultado, ou do erro, do mesmo jeito.
  const tell = async () => {
    try {
      // Com o relógio de agora: "você já avisou a casa há N min".
      notify(label, announceResultText(await announce.mutateAsync(list.id), new Date()));
    } catch (err) {
      notify('Não deu para avisar a casa', marketTripErrorMessage(err, 'announce'));
    }
  };

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
 * encerrar: na tela Hoje, as idas das listas abertas, com o nome da lista e
 * "Abrir a lista" (`openable`); na lista, só as dela (`listId`). Quem avisou
 * vê a hora do aviso e "Encerrar". Sem resposta do servidor (sem internet, ou
 * o banco ainda sem as idas), não há faixa nem erro.
 *
 * A lista de cada ida vem com a ida (o tipo, e se foi arquivada): a faixa não
 * depende das listas que a tela já buscou, que não sabem da lista que outra
 * pessoa criou há pouco.
 */
export function MarketTripBanner({ listId, openable = false }: { listId?: string; openable?: boolean }) {
  const userId = useAuth().session?.user.id;
  const trips = useMarketTrips();
  const end = useEndMarketTrip();
  const ending = useEndingMarketTrips();
  const now = useNow();
  // Cada "Encerrar" espera o seu pedido: o erro de uma ida aparece mesmo com outra encerrada logo depois.
  const close = (tripId: string) =>
    void end.mutateAsync(tripId).catch((err: unknown) => notify('Não deu para encerrar', marketTripErrorMessage(err, 'end')));

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

  const live = liveTrips(trips.data ?? [], now).filter((trip) => !listId || trip.list_id === listId);
  if (!live.length) return null;

  return (
    <Card style={styles.card}>
      {live.map((trip) => {
        const mine = trip.user_id === userId;
        // Na tela Hoje, vários "Encerrar" e "Abrir a lista": o leitor de tela diz de qual ida é cada um. Na lista,
        // o "Encerrar" é um só, o de quem avisou.
        const labels = openable ? tripButtonLabels(trip) : undefined;
        return (
          <View key={trip.id} style={styles.trip}>
            <Row gap={space.md}>
              <IconBadge icon="cart-arrow-right" tone="primary" />
              <Text variant="body" style={styles.flex}>
                {tripBannerText(trip, { userId, now, withList: openable })}
              </Text>
            </Row>
            {mine || openable ? (
              <Row style={styles.actions}>
                {mine ? (
                  <Button
                    title="Encerrar"
                    accessibilityLabel={labels?.end}
                    variant="ghost"
                    compact
                    loading={ending.includes(trip.id)}
                    onPress={() => close(trip.id)}
                  />
                ) : null}
                {openable ? (
                  <Button
                    title="Abrir a lista"
                    accessibilityLabel={labels?.open}
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
  // minWidth 0: no navegador, uma palavra comprida sem espaço (no nome de quem avisou ou da lista) quebra dentro da
  // faixa, em vez de empurrar a linha para fora da tela.
  flex: { flex: 1, minWidth: 0 },
  actions: { justifyContent: 'flex-end' },
});

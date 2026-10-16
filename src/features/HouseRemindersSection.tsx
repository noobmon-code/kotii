import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { MARKET_TRIP_PUSH_KEY, marketTripErrorMessage, useMarketTripPush } from '@/data/marketTrips';
import { useSupplies } from '@/data/supplies';
import { shownHouseReminderKinds, type HouseReminderKind } from '@/domain/houseReminders';
import { TRIP_PUSH_OPTION } from '@/domain/marketTrips';
import { syncOtherHouses, useHouseReminderData, useHouseReminderTarget } from '@/features/useReminderSync';
import { useHousehold } from '@/lib/auth';
import {
  getHouseReminderKinds,
  PERMISSION_HINT,
  REMINDER_PLACE,
  remindersSupported,
  remindersUnavailableReason,
  setHouseReminderKind,
  syncHouseReminders,
} from '@/lib/reminders';
import { errorMessage } from '@/lib/supabase';
import { notify } from '@/ui/dialogs';
import { Card, ListCard, Row, Section, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

/** Avisos da casa por notificação: cada pessoa escolhe no próprio celular (ou navegador). */
export function HouseRemindersSection() {
  const c = useColors();
  const { data } = useHouseReminderData();
  // A mesma busca que os avisos já fazem: aqui, só para saber se este banco tem as tabelas das reposições.
  const suppliesAvailable = useSupplies().data?.available;
  const target = useHouseReminderTarget();
  const households = useHousehold().data?.households;
  const queryClient = useQueryClient();
  const [kinds, setKinds] = useState<Record<HouseReminderKind, boolean> | null>(null);
  // "Alguém indo ao mercado": não é um aviso agendado aqui, e sim uma opção deste navegador no servidor.
  const tripPush = useMarketTripPush();

  useEffect(() => {
    if (remindersSupported) getHouseReminderKinds().then(setKinds).catch(() => undefined);
  }, []);

  async function toggle(kind: HouseReminderKind, enabled: boolean) {
    if (!kinds) return;
    setKinds((current) => current && { ...current, [kind]: enabled });
    // No navegador, ligar também inscreve o navegador no servidor: pode falhar sem internet.
    const ok = await setHouseReminderKind(kind, enabled).catch((err: unknown) => err);
    if (ok !== true) {
      // Só este tipo volta: outros toques feitos durante o pedido de permissão ficam.
      setKinds((current) => current && { ...current, [kind]: !enabled });
      if (ok === false) notify('Sem permissão', `Para receber os avisos: ${PERMISSION_HINT.charAt(0).toLowerCase()}${PERMISSION_HINT.slice(1)}`);
      else notify('Não deu para ligar os avisos', errorMessage(ok));
      return;
    }
    // O primeiro aviso ligado inscreve o navegador, e a inscrição nasce com "Alguém indo ao mercado" ligado.
    const rereadTripPush = () => void queryClient.invalidateQueries({ queryKey: [MARKET_TRIP_PUSH_KEY] });
    if (data && target) syncHouseReminders(data, target).catch(() => undefined).then(rereadTripPush);
    else rereadTripPush();
    // As outras casas também, sem esperar o app abrir de novo.
    if (target && households) syncOtherHouses(queryClient, households, target.householdId).catch(() => undefined);
  }

  async function toggleTripPush(enabled: boolean) {
    // Ligar pede a permissão e inscreve o navegador no servidor: pode falhar sem internet.
    const ok = await tripPush.set(enabled).catch((err: unknown) => err);
    if (ok === true) return;
    if (ok === false) notify('Sem permissão', `Para receber os avisos: ${PERMISSION_HINT.charAt(0).toLowerCase()}${PERMISSION_HINT.slice(1)}`);
    else notify(enabled ? 'Não deu para ligar o aviso' : 'Não deu para desligar o aviso', marketTripErrorMessage(ok));
  }

  return (
    <Section title={`Avisos ${REMINDER_PLACE}`}>
      {remindersSupported ? (
        <ListCard>
          {shownHouseReminderKinds(suppliesAvailable).map((kind) => (
            <Row key={kind.key} style={styles.row}>
              <View style={styles.flex}>
                <Text variant="label">{kind.label}</Text>
                <Text variant="small">{kind.hint}.</Text>
              </View>
              <Switch
                accessibilityLabel={`Avisos de ${kind.label.toLowerCase()}`}
                value={kinds?.[kind.key] ?? false}
                disabled={!kinds}
                onValueChange={(value) => toggle(kind.key, value)}
                trackColor={{ true: c.primary }}
              />
            </Row>
          ))}
          {/* Só onde existe: no navegador, com a opção já no banco (e depois de lida). */}
          {typeof tripPush.value === 'boolean' ? (
            <Row style={styles.row}>
              <View style={styles.flex}>
                <Text variant="label">{TRIP_PUSH_OPTION.label}</Text>
                <Text variant="small">{TRIP_PUSH_OPTION.hint}.</Text>
              </View>
              <Switch
                accessibilityLabel={`Avisos de ${TRIP_PUSH_OPTION.label.toLowerCase()}`}
                value={tripPush.value}
                // Uma mudança por vez: com a anterior no ar, a última escolha poderia perder para ela.
                disabled={tripPush.pending}
                onValueChange={toggleTripPush}
                trackColor={{ true: c.primary }}
              />
            </Row>
          ) : null}
        </ListCard>
      ) : (
        <Card>
          <Text variant="small">{remindersUnavailableReason()}</Text>
        </Card>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.md, paddingVertical: space.md },
  flex: { flex: 1, gap: 2 },
});

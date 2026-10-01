import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { HOUSE_REMINDER_KINDS, type HouseReminderKind } from '@/domain/houseReminders';
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
  const target = useHouseReminderTarget();
  const households = useHousehold().data?.households;
  const queryClient = useQueryClient();
  const [kinds, setKinds] = useState<Record<HouseReminderKind, boolean> | null>(null);

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
    if (data && target) syncHouseReminders(data, target).catch(() => undefined);
    // As outras casas também, sem esperar o app abrir de novo.
    if (target && households) syncOtherHouses(queryClient, households, target.householdId).catch(() => undefined);
  }

  return (
    <Section title={`Avisos ${REMINDER_PLACE}`}>
      {remindersSupported ? (
        <ListCard>
          {HOUSE_REMINDER_KINDS.map((kind) => (
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

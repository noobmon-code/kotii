import { useEffect, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { HOUSE_REMINDER_KINDS, type HouseReminderKind } from '@/domain/houseReminders';
import { useHouseReminderData } from '@/features/useReminderSync';
import { getHouseReminderKinds, remindersSupported, setHouseReminderKind, syncHouseReminders } from '@/lib/reminders';
import { notify } from '@/ui/dialogs';
import { Card, ListCard, Row, Section, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

/** Avisos da casa por notificação: cada pessoa escolhe no próprio celular. */
export function HouseRemindersSection() {
  const c = useColors();
  const { data } = useHouseReminderData();
  const [kinds, setKinds] = useState<Record<HouseReminderKind, boolean> | null>(null);

  useEffect(() => {
    if (remindersSupported) getHouseReminderKinds().then(setKinds).catch(() => undefined);
  }, []);

  async function toggle(kind: HouseReminderKind, enabled: boolean) {
    if (!kinds) return;
    setKinds((current) => current && { ...current, [kind]: enabled });
    const ok = await setHouseReminderKind(kind, enabled).catch(() => false);
    if (!ok) {
      // Só este tipo volta: outros toques feitos durante o pedido de permissão ficam.
      setKinds((current) => current && { ...current, [kind]: !enabled });
      notify('Sem permissão', 'Para receber os avisos, permita as notificações do Nooky nos ajustes do celular.');
      return;
    }
    if (data) syncHouseReminders(data).catch(() => undefined);
  }

  return (
    <Section title="Avisos neste celular">
      {remindersSupported ? (
        <ListCard>
          {HOUSE_REMINDER_KINDS.map((kind) => (
            <Row key={kind.key} style={styles.row}>
              <View style={styles.flex}>
                <Text variant="label">{kind.label}</Text>
                <Text variant="small">{kind.hint}, às 9h.</Text>
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
          <Text variant="small">
            Os avisos por notificação (contas, documentos, tarefas e remédios) funcionam no app instalado no celular. Na versão
            web e no Expo Go do Android eles ficam desligados.
          </Text>
        </Card>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.md, paddingVertical: space.md },
  flex: { flex: 1, gap: 2 },
});

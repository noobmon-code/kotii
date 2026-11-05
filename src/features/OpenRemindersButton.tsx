import { router } from 'expo-router';

import type { HouseReminderKind } from '@/domain/houseReminders';
import { Button } from '@/ui/primitives';

// "Abrir os avisos": a aba Família abre já no interruptor deste tipo de aviso (useReminderSpotlight). Um módulo à
// parte, pequeno: importar a seção dos avisos traria junto a sincronização dos avisos para estas telas.

/** Abre a aba Família no interruptor do tipo de aviso. */
export function openHouseReminder(kind: HouseReminderKind) {
  router.push({ pathname: '/familia', params: { aviso: kind } });
}

export function OpenRemindersButton({ kind }: { kind: HouseReminderKind }) {
  return <Button title="Abrir os avisos" icon="bell-outline" variant="secondary" compact onPress={() => openHouseReminder(kind)} />;
}

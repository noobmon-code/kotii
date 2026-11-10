import { HouseRemindersSection } from '@/features/HouseRemindersSection';
import { Screen } from '@/ui/primitives';

/**
 * Os avisos deste aparelho (de Configurações → Avisos): os interruptores de cada aviso da casa, que cada pessoa liga
 * no próprio celular ou navegador. É também aonde levam os "Abrir os avisos" do clima, de "Gás, água e ração" e do
 * estoque dos remédios.
 */
export default function RemindersScreen() {
  return (
    <Screen edges={[]}>
      <HouseRemindersSection />
    </Screen>
  );
}

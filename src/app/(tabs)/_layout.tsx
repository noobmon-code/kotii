import { Tabs } from 'expo-router/js-tabs';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NukeButton } from '@/features/nuke/NukeButton';
import { useReminderSync } from '@/features/useReminderSync';
import { FEATURES } from '@/lib/features';
import { TAB_BAR_HEIGHT, TabBar, tabBarBottomGap } from '@/ui/TabBar';
import { space } from '@/ui/theme';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  useReminderSync();
  return (
    <View style={{ flex: 1 }}>
      <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
        <Tabs.Screen name="index" options={{ title: 'Hoje' }} />
        {/* Compras é o ciclo do que entra na casa (lista, compra, nota, despensa); Casa, o que a mantém funcionando. */}
        <Tabs.Screen name="compras" options={{ title: 'Compras' }} />
        <Tabs.Screen name="casa" options={{ title: 'Casa' }} />
        {/* Com a chave de Finanças desligada (lib/features), a aba nem entra no navegador: some da barra e o
            endereço dela não abre. */}
        <Tabs.Protected guard={FEATURES.finance}>
          <Tabs.Screen name="financas" options={{ title: 'Finanças' }} />
        </Tabs.Protected>
        <Tabs.Screen name="saude" options={{ title: 'Saúde' }} />
        {/* "Configurações" não cabe na barra (ui/TabBar): lá a aba é "Ajustes", e o título da página (o do navegador
            e o do leitor de tela) continua "Configurações". O endereço é o de antes, /configuracoes. */}
        <Tabs.Screen name="configuracoes" options={{ title: 'Configurações', tabBarLabel: 'Ajustes' }} />
      </Tabs>
      <NukeButton style={{ position: 'absolute', right: space.lg, bottom: TAB_BAR_HEIGHT + tabBarBottomGap(insets) + space.md }} />
    </View>
  );
}

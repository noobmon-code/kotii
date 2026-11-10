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
        <Tabs.Screen name="casa" options={{ title: 'Casa' }} />
        {/* Com a chave de Finanças desligada (lib/features), a aba nem entra no navegador: some da barra e o
            endereço dela não abre. */}
        <Tabs.Protected guard={FEATURES.finance}>
          <Tabs.Screen name="financas" options={{ title: 'Finanças' }} />
        </Tabs.Protected>
        <Tabs.Screen name="saude" options={{ title: 'Saúde' }} />
        <Tabs.Screen name="familia" options={{ title: 'Família' }} />
      </Tabs>
      <NukeButton style={{ position: 'absolute', right: space.lg, bottom: TAB_BAR_HEIGHT + tabBarBottomGap(insets) + space.md }} />
    </View>
  );
}

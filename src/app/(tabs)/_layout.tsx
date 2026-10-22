import { Tabs } from 'expo-router/js-tabs';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NukeButton } from '@/features/nuke/NukeButton';
import { useReminderSync } from '@/features/useReminderSync';
import { TAB_BAR_HEIGHT, TabBar, tabBarBottomGap } from '@/ui/TabBar';
import { space } from '@/ui/theme';

const TABS: { name: string; title: string }[] = [
  { name: 'index', title: 'Hoje' },
  { name: 'casa', title: 'Casa' },
  { name: 'financas', title: 'Finanças' },
  { name: 'saude', title: 'Saúde' },
  { name: 'familia', title: 'Família' },
];

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  useReminderSync();
  return (
    <View style={{ flex: 1 }}>
      <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
        {TABS.map((tab) => (
          <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.title }} />
        ))}
      </Tabs>
      <NukeButton style={{ position: 'absolute', right: space.lg, bottom: TAB_BAR_HEIGHT + tabBarBottomGap(insets) + space.md }} />
    </View>
  );
}

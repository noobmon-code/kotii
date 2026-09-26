import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Tabs } from 'expo-router/js-tabs';

import type { IconName } from '@/domain/categories';
import { useReminderSync } from '@/features/useReminderSync';
import { useColors } from '@/ui/theme';

const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: 'index', title: 'Hoje', icon: 'white-balance-sunny' },
  { name: 'casa', title: 'Casa', icon: 'home-outline' },
  { name: 'financas', title: 'Finanças', icon: 'wallet-outline' },
  { name: 'saude', title: 'Saúde', icon: 'heart-pulse' },
  { name: 'familia', title: 'Família', icon: 'account-group-outline' },
];

export default function TabsLayout() {
  const c = useColors();
  useReminderSync();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.textMuted,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border },
      }}>
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name={tab.icon} color={color} size={size} />,
          }}
        />
      ))}
    </Tabs>
  );
}

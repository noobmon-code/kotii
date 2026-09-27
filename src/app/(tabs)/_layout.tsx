import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Tabs } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { IconName } from '@/domain/categories';
import { useReminderSync } from '@/features/useReminderSync';
import { fonts, useColors } from '@/ui/theme';

const TABS: { name: string; title: string; icon: IconName }[] = [
  { name: 'index', title: 'Hoje', icon: 'white-balance-sunny' },
  { name: 'casa', title: 'Casa', icon: 'home-outline' },
  { name: 'financas', title: 'Finanças', icon: 'wallet-outline' },
  { name: 'saude', title: 'Saúde', icon: 'heart-pulse' },
  { name: 'familia', title: 'Família', icon: 'account-group-outline' },
];

export default function TabsLayout() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  useReminderSync();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.text,
        tabBarInactiveTintColor: c.textMuted,
        // Nunito é mais alta que a fonte do sistema: a barra ganha altura para o rótulo não cortar.
        tabBarLabelStyle: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 15 },
        tabBarStyle: {
          backgroundColor: c.surface,
          borderTopColor: c.border,
          height: 70 + insets.bottom,
          paddingTop: 6,
          paddingBottom: insets.bottom + 8,
        },
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

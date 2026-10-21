import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Tabs } from 'expo-router/js-tabs';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { IconName } from '@/domain/categories';
import { NukeButton } from '@/features/nuke/NukeButton';
import { useReminderSync } from '@/features/useReminderSync';
import { fonts, radius, shadows, space, useColors, withAlpha } from '@/ui/theme';

// A barra é uma pílula de vidro solta do rodapé; o botão do Nuke fica logo acima dela.
const TAB_BAR_HEIGHT = 64;

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
  // Pílula flutuante: a margem de baixo é a área segura (ou um respiro, onde não há).
  const bottomGap = Math.max(insets.bottom, space.md);
  useReminderSync();
  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: c.primary,
          tabBarInactiveTintColor: c.textMuted,
          tabBarActiveBackgroundColor: withAlpha(c.primary, 0.12),
          tabBarItemStyle: { borderRadius: radius.pill, marginVertical: 6, marginHorizontal: 2 },
          // Nunito é mais alta que a fonte do sistema: a barra ganha altura para o rótulo não cortar.
          tabBarLabelStyle: { fontFamily: fonts.heavy, fontSize: 11, lineHeight: 15 },
          tabBarStyle: {
            backgroundColor: c.glassStrong,
            borderWidth: 1,
            borderColor: c.glassBorder,
            borderTopWidth: 1,
            borderRadius: radius.pill,
            borderCurve: 'continuous',
            boxShadow: shadows.float,
            height: TAB_BAR_HEIGHT,
            marginHorizontal: space.lg,
            marginBottom: bottomGap,
            paddingTop: 0,
            paddingBottom: 0,
            paddingHorizontal: 6,
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
      <NukeButton style={{ position: 'absolute', right: space.lg, bottom: TAB_BAR_HEIGHT + bottomGap + space.md }} />
    </View>
  );
}

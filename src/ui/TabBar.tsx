// Barra de abas "Hora dourada": uma pílula de vidro solta do rodapé, com a aba aberta num destaque redondo
// (ícone de linha e rótulo juntos). Feita à mão, porque o destaque da barra do navegador é um retângulo de
// cantos vivos, que vaza da curva da pílula.

import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { Pressable, StyleSheet, View } from 'react-native';
import { type EdgeInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { Text } from './primitives';
import { TAB_ICON_BOX, TAB_ICON_PATHS, type TabIconName } from './tabIcons';
import { fonts, radius, shadows, space, useColors, withAlpha } from './theme';

/** Altura da pílula: o botão do Nuke fica logo acima dela. */
export const TAB_BAR_HEIGHT = 72;

/** A margem de baixo da pílula: a área segura, ou um respiro onde não há. */
export const tabBarBottomGap = (insets: Pick<EdgeInsets, 'bottom'>) => Math.max(insets.bottom, space.md);

/** A aba de cada rota, na ordem em que aparecem. */
export const TAB_ICONS: Record<string, TabIconName> = {
  index: 'sun',
  casa: 'home',
  financas: 'wallet',
  saude: 'heart',
  familia: 'users',
};

export function TabIcon({ name, color, size = TAB_ICON_BOX }: { name: TabIconName; color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${TAB_ICON_BOX} ${TAB_ICON_BOX}`} accessible={false}>
      <Path d={TAB_ICON_PATHS[name]} fill={color} />
    </Svg>
  );
}

export function TabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const c = useColors();
  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.bar,
        {
          backgroundColor: c.glassStrong,
          borderColor: c.glassBorder,
          marginBottom: tabBarBottomGap(insets),
          boxShadow: shadows.float,
        },
      ]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const { options } = descriptors[route.key];
        const label = typeof options.tabBarLabel === 'string' ? options.tabBarLabel : (options.title ?? route.name);
        const color = focused ? c.primary : c.textMuted;
        const icon = TAB_ICONS[route.name];

        const press = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        };
        const longPress = () => navigation.emit({ type: 'tabLongPress', target: route.key });

        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
            testID={options.tabBarButtonTestID}
            onPress={press}
            onLongPress={longPress}
            style={styles.item}>
            <View style={[styles.pill, focused && { backgroundColor: withAlpha(c.primary, 0.12) }]}>
              {icon ? <TabIcon name={icon} color={color} /> : null}
              <Text style={[styles.label, focused && styles.labelActive, { color }]} numberOfLines={1}>
                {label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: TAB_BAR_HEIGHT,
    marginHorizontal: space.lg,
    paddingHorizontal: 6,
    borderRadius: radius.pill,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pill: {
    minWidth: 46,
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  label: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 15 },
  labelActive: { fontFamily: fonts.heavy },
});
